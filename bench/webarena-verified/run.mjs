/** WebArena-Verified browser pilot. Run via mx-env; no credential-file reads. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const preflight = process.argv.includes('--preflight');
assert(preflight || process.argv.includes('--run'), 'Pass --preflight (no model) or --run (real model calls)');
const browserAt = process.argv.indexOf('--chromium');
const executablePath = browserAt >= 0 ? process.argv[browserAt + 1] : undefined;
const runDir = join(here, 'jobs', `${preflight ? 'preflight' : 'pilot'}-${Date.now()}`);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const fromDemo = createRequire(join(repo, 'examples/react-demo/package.json'));
const fromGateway = createRequire(join(repo, 'packages/gateway/package.json'));
async function load(from, name) { const m = await import(pathToFileURL(from.resolve(name)).href); return { ...m.default, ...m }; }
const { chromium } = await load(fromDemo, 'playwright');
const { Client } = await load(fromGateway, '@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await load(fromGateway, '@modelcontextprotocol/sdk/client/streamableHttp.js');
const { StdioClientTransport } = await load(fromGateway, '@modelcontextprotocol/sdk/client/stdio.js');
const fromVite = createRequire(fromDemo.resolve('vite'));
const { build } = await load(fromVite, 'esbuild');
const python = join(here, '.venv/bin/python');
const gatewayPort = await freePort();
const gateway = `http://127.0.0.1:${gatewayPort}/mcp`;
const container = `hfe-wa-${randomUUID().slice(0, 8)}`;
let siteCreated = false;
let gatewayProcess;
const activeContexts = [], activeClients = [];
const report = { manifest, runDir, mode: preflight ? 'preflight' : 'pilot', trials: [], startedAt: new Date().toISOString() };
const save = () => writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
const log = (value) => console.log(JSON.stringify({ time: new Date().toISOString(), ...value }));

async function exec(command, args, options = {}) {
    const child = spawn(command, args, { cwd: repo, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (b) => { stdout += b; }); child.stderr?.on('data', (b) => { stderr += b; });
    const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
    if (code !== 0) {
        writeFileSync(join(runDir, 'last-process-error.log'), stderr + stdout, { mode: 0o600 });
        throw new Error(`${command} exited ${code}; diagnostic details are in the local run directory`);
    }
    return stdout.trim();
}
function lastJson(output) {
    const line = output.split('\n').findLast((s) => s.trim().startsWith('{'));
    assert(line, 'Child process did not return a JSON result'); return JSON.parse(line);
}
async function waitFor(probe, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const result = await probe().catch(() => undefined); if (result) return result; await sleep(500); }
    throw new Error(`Timed out waiting for ${label}`);
}
async function freePort() {
    const server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port; await new Promise((r) => server.close(r)); return port;
}
const text = (result) => JSON.parse(result.content.find((c) => c.type === 'text').text);

async function resetSite() {
    if (siteCreated) { await exec('docker', ['rm', '-fv', container]); siteCreated = false; }
    log({ event: 'site-reset-start' });
    await exec('docker', ['run', '-d', '--platform', 'linux/amd64', '--name', container,
        '--label', 'harness-fe.benchmark=webarena-verified', '--memory', '3g', '--cpus', '3',
        '-p', '127.0.0.1:7780:80', '-p', '127.0.0.1:7781:8877',
        '-e', `WA_ENV_CTRL_EXTERNAL_SITE_URL=${manifest.siteOrigin}/`, report.imageDigest]);
    siteCreated = true;
    await waitFor(async () => {
        const r = await fetch('http://127.0.0.1:7781/status', { signal: AbortSignal.timeout(5000) });
        return r.ok && (await r.json()).success;
    }, 'official site services', 180000);
    const initialized = await fetch('http://127.0.0.1:7781/init', { method: 'POST', signal: AbortSignal.timeout(180000) });
    const result = await initialized.json();
    writeFileSync(join(runDir, 'site-init.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    assert(initialized.ok && result.success, 'Official environment init failed');
    log({ event: 'site-ready' });
}

const allowedHarness = new Set(['tab.list', 'page.snapshot', 'page.dom_query', 'page.click', 'page.type',
    'page.select', 'page.check', 'page.scroll', 'page.screenshot', 'page.navigate', 'page.reload',
    'console.tail', 'errors.tail', 'network.tail', 'network.wait_for_idle', 'page.set_dialog_handler']);
const allowedDevtools = new Set(['list_pages', 'select_page', 'navigate_page', 'take_snapshot', 'take_screenshot',
    'click', 'fill', 'fill_form', 'press_key', 'hover', 'scroll', 'wait_for', 'handle_dialog', 'drag',
    'list_console_messages', 'get_console_message', 'list_network_requests', 'get_network_request']);

async function browserSession(dir, condition, task) {
    mkdirSync(dir, { recursive: true });
    const debugPort = await freePort();
    const profile = realpathSync(mkdtempSync(join(tmpdir(), 'hfe-webarena-profile-')));
    const headers = JSON.parse(readFileSync(join(runDir, 'fixture-auth.json'), 'utf8'));
    const context = await chromium.launchPersistentContext(profile, {
        headless: true, ...(executablePath ? { executablePath } : {}), viewport: { width: 1280, height: 900 },
        args: [`--remote-debugging-port=${debugPort}`], bypassCSP: true, serviceWorkers: 'block',
        extraHTTPHeaders: headers, recordHar: { path: join(dir, 'network.har'), content: 'embed', mode: 'full' },
    });
    activeContexts.push(context);
    report.browserVersion ??= context.browser().version();
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === manifest.siteOrigin) await route.continue(); else await route.abort('blockedbyclient');
    });
    const projectId = `webarena-${randomUUID()}`;
    if (condition === 'harness-fe') await context.addInitScript({ content:
        `window.__HARNESS_FE__=${JSON.stringify({ projectId, mcpUrl: `ws://127.0.0.1:${gatewayPort}/ws`,
            overlay: false, deferStart: true, consent: 'off', buildId: report.runtimeBundleSha256 })};\n${runtimeBundle}` });
    const page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', () => {});
    await page.goto(task.start_urls[0], { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('body').waitFor();
    await waitFor(async () => (await page.locator('.admin__menu').count()) > 0, 'authenticated admin UI', 60000);
    let mcp, transport, tab, pageId;
    const name = condition === 'harness-fe' ? 'harness-fe' : 'chrome-devtools';
    const entry = condition === 'harness-fe'
        ? { command: process.execPath, args: [join(repo, 'packages/cli/dist/cli.js'), 'mcp', '--port', String(gatewayPort)] }
        : { command: 'chrome-devtools-mcp', args: ['--browserUrl', `http://127.0.0.1:${debugPort}`,
            '--no-usage-statistics', '--no-performance-crux', '--no-javascript-evaluation', '--screenshotMaxWidth', '1280'] };
    mcp = new Client({ name: 'webarena-trusted-observer', version: '1' });
    activeClients.push(mcp);
    transport = condition === 'harness-fe' ? new StreamableHTTPClientTransport(new URL(gateway))
        : new StdioClientTransport({ ...entry, stderr: 'pipe' });
    await mcp.connect(transport);
    const catalog = (await mcp.listTools()).tools;
    const allow = condition === 'harness-fe' ? allowedHarness : allowedDevtools;
    const disallowed = catalog.filter((t) => !allow.has(t.name)).map((t) => `mcp__${name}__${t.name.replaceAll('.', '_')}`);
    if (condition === 'harness-fe') {
        assert(catalog.find((t) => t.name === 'page.screenshot')?.description.includes('native MCP image'), 'Old gateway image implementation detected');
        tab = await waitFor(async () => text(await mcp.callTool({ name: 'tab.list', arguments: {} }))
            .find((t) => t.projectId === projectId), 'harness runtime');
    } else {
        const pages = await mcp.callTool({ name: 'list_pages', arguments: {} });
        const line = pages.content.filter((c) => c.type === 'text').map((c) => c.text)
            .join('\n').split('\n').find((line) => line.includes(manifest.siteOrigin));
        const match = line?.match(/^(\d+):/);
        assert(match, 'DevTools did not list the benchmark page');
        pageId = Number(match[1]);
    }
    const config = join(dir, 'mcp.json'); writeFileSync(config, JSON.stringify({ mcpServers: { [name]: entry } }), { mode: 0o600 });
    return { context, page, mcp, config, tabId: tab?.tabId, pageId, serverName: name, disallowed,
        visibleTools: catalog.filter((t) => allow.has(t.name)).map((t) => t.name) };
}

async function callAgent(session, task, trialDir, condition) {
    const file = join(trialDir, 'transcript.stream.json'), stderr = join(trialDir, 'agent.stderr.log');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'hfe-webarena-agent-')));
    const prompt = `Complete this task through the web browser UI: ${task.intent}\n` +
        `The browser is already logged in at ${task.start_urls.join(', ')}. ` +
        (session.tabId ? `Use tabId ${session.tabId} for all page tools. ` : `Use the existing pageId ${session.pageId}; check list_pages if needed. `) +
        `Use only normal page navigation, inspection, screenshots and input tools. Do not use JavaScript execution, ` +
        `direct API requests, source/files, database access, browser cookies, or any benchmark internals. ` +
        `Stay on ${manifest.siteUrl}. Finish within 40 tool calls. ` +
        `Return ONLY JSON: {"task_type":"${task.task_type}","status":"SUCCESS","retrieved_data":` +
        `${task.task_type === 'RETRIEVE' ? '["values read from the page"]' : 'null'},"error_details":null}. ` +
        `If unable to complete, use status UNKNOWN_ERROR and describe the failure. ` +
        `The task is in an isolated test site; requested changes there are authorized.`;
    writeFileSync(join(trialDir, 'prompt.txt'), prompt);
    writeFileSync(file, '', { mode: 0o600 }); writeFileSync(stderr, '', { mode: 0o600 });
    const args = ['-p', prompt, '--model', manifest.model, '--tools', '', '--output-format', 'stream-json',
        '--verbose', '--no-session-persistence', '--mcp-config', session.config, '--strict-mcp-config',
        '--permission-mode', 'acceptEdits', '--allowedTools', `mcp__${session.serverName}`];
    if (session.disallowed.length) args.push('--disallowedTools', session.disallowed.join(','));
    const started = Date.now(); let buffer = '', toolCalls = 0, limitReached = false;
    const child = spawn('claude', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (bytes) => {
        appendFileSync(file, bytes); buffer += bytes.toString();
        for (;;) {
            const at = buffer.indexOf('\n'); if (at < 0) break;
            const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
            try {
                const e = JSON.parse(line);
                if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
                    toolCalls += e.message.content.filter((b) => b.type === 'tool_use').length;
                    if (toolCalls > 40) { limitReached = true; child.kill('SIGTERM'); }
                }
            } catch {}
        }
    });
    child.stderr.on('data', (bytes) => appendFileSync(stderr, bytes));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, manifest.timeoutSeconds * 1000);
    const code = await new Promise((accept, reject) => { child.once('exit', accept); child.once('error', reject); });
    clearTimeout(timer);
    const events = readFileSync(file, 'utf8').split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const end = events.findLast((e) => e.type === 'result');
    const messages = events.filter((e) => e.type === 'assistant').map((e) => e.message);
    if (!timedOut && !limitReached) assert(code === 0 && end && !end.is_error,
        'Model/CLI execution failed; matrix stopped instead of counting infrastructure errors as task failures');
    const tools = messages.flatMap((m) => Array.isArray(m?.content) ? m.content.filter((b) => b.type === 'tool_use').map((b) => b.name) : []);
    let response;
    try { response = JSON.parse(end.result.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); }
    catch { response = { task_type: task.task_type, status: 'UNKNOWN_ERROR', retrieved_data: null,
        error_details: timedOut ? 'Agent time limit reached' : 'Agent did not return valid final JSON' }; }
    writeFileSync(join(trialDir, 'agent_response.json'), JSON.stringify(response, null, 2));
    return { taskId: task.task_id, condition, code, timedOut, limitReached, toolCalls: tools.length,
        tools, costUsd: end?.total_cost_usd ?? 0, seconds: (Date.now() - started) / 1000,
        models: [...new Set(messages.map((m) => m?.model).filter(Boolean))],
        responseStatus: response.status, cliError: end?.is_error,
        visibleTools: session.visibleTools };
}

let runtimeBundle;
try {
    report.upstreamCommit = (await exec('git', ['-C', join(here, 'vendor/webarena-verified'), 'rev-parse', 'HEAD']));
    assert.equal(report.upstreamCommit, manifest.commit, 'Dataset checkout drifted from manifest');
    const image = JSON.parse(await exec('docker', ['image', 'inspect', manifest.image, '--format', '{{json .}}']));
    report.imageDigest = image.RepoDigests[0];
    report.chromeDevtoolsVersion = await exec('chrome-devtools-mcp', ['--version']);
    report.gatewayBuildSha256 = createHash('sha256').update(readFileSync(join(repo, 'packages/gateway/dist/mcp.js'))).digest('hex');
    report.gatewayPort = gatewayPort;
    gatewayProcess = spawn(process.execPath, [join(repo, 'packages/cli/dist/cli.js'), 'serve',
        '--port', String(gatewayPort), '--core-data-dir', join(runDir, 'gateway-core'),
        '--data-dir', join(runDir, 'gateway-state')], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [gatewayProcess.stdout, gatewayProcess.stderr]) stream.on('data', (bytes) =>
        appendFileSync(join(runDir, 'gateway.log'), bytes, { mode: 0o600 }));
    await waitFor(async () => {
        assert(gatewayProcess.exitCode === null, 'Isolated workspace gateway exited');
        return (await fetch(`http://127.0.0.1:${gatewayPort}/console/api/meta`)).ok;
    }, 'isolated workspace gateway');
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await exec(python, [join(here, 'evaluate.py'), 'prepare', runDir]);
    const tasks = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8'));
    const bundled = await build({ entryPoints: [fromDemo.resolve('@harness-fe/runtime')], bundle: true,
        write: false, format: 'iife', platform: 'browser', target: 'es2020', minify: true,
        define: { 'process.env.NODE_ENV': '"development"' } });
    runtimeBundle = bundled.outputFiles[0].text;
    report.runtimeBundleSha256 = createHash('sha256').update(runtimeBundle).digest('hex');
    log({ event: 'matrix-ready', tasks: manifest.taskIds, conditions: manifest.conditions,
        upstreamCommit: report.upstreamCommit, imageDigest: report.imageDigest, runDir }); save();

    if (preflight) {
        await resetSite();
        const initial = await browserSession(join(runDir, 'negative'), 'harness-fe', { ...tasks[0], start_urls: [`${manifest.siteUrl}/`] });
        try {
            const shot = await initial.mcp.callTool({ name: 'page.screenshot', arguments: { tabId: initial.tabId, maxWidth: 1280 } });
            const img = shot.content.find((c) => c.type === 'image');
            assert(img, 'No native screenshot image from the real benchmark site');
            writeFileSync(join(runDir, 'preflight.png'), Buffer.from(img.data, 'base64'));
        } finally { await initial.mcp.close(); await initial.context.close(); }
        for (const task of tasks) {
            const trial = join(runDir, 'negative');
            writeFileSync(join(trial, 'agent_response.json'), JSON.stringify({ task_type: task.task_type,
                status: 'SUCCESS', retrieved_data: task.task_type === 'RETRIEVE' ? [] : null, error_details: null }));
            const grade = lastJson(await exec(python, [join(here, 'evaluate.py'), 'score', String(task.task_id), trial]));
            writeFileSync(join(trial, `eval-${task.task_id}.json`), readFileSync(join(trial, 'eval_result.json')));
            report.trials.push({ taskId: task.task_id, control: 'no-action', ...grade }); save();
            assert.equal(grade.score, 0, `Task ${task.task_id} passed without any agent action`);
        }
        const gold = await browserSession(join(runDir, 'positive'), 'harness-fe', tasks[0]);
        try {
            // Confirmed in the actual site's recorded HTML on 2026-10-21:
            // Magento's parent menu uses an <a> without href, so it is not role=link.
            await gold.page.locator('#menu-magento-customer-customer > a').click();
            await gold.page.locator('.item-customer-manage > a').click();
            await gold.page.waitForURL(/customer\/index/);
            await gold.page.waitForLoadState('networkidle');
        } finally { await gold.mcp.close(); await gold.context.close(); }
        writeFileSync(join(runDir, 'positive/agent_response.json'), JSON.stringify({ task_type: 'NAVIGATE', status: 'SUCCESS', retrieved_data: null, error_details: null }));
        report.positiveControl = lastJson(await exec(python, [join(here, 'evaluate.py'), 'score', '157', join(runDir, 'positive')]));
        assert.equal(report.positiveControl.score, 1, 'Known-good UI navigation did not pass the official evaluator');
        const baseline = await browserSession(join(runDir, 'devtools-check'), 'chrome-devtools-mcp', tasks[0]);
        try {
            const pages = await baseline.mcp.callTool({ name: 'list_pages', arguments: {} });
            writeFileSync(join(runDir, 'devtools-check/pages.json'), JSON.stringify(pages, null, 2), { mode: 0o600 });
            assert(JSON.stringify(pages.content).includes(manifest.siteUrl), 'DevTools MCP attached to the wrong page');
            const shot = await baseline.mcp.callTool({ name: 'take_screenshot', arguments: { pageId: baseline.pageId, format: 'png' } });
            writeFileSync(join(runDir, 'devtools-check/screenshot-result.json'), JSON.stringify(shot, null, 2), { mode: 0o600 });
            assert(shot.content.some((c) => c.type === 'image'), 'DevTools MCP did not deliver an image');
            report.devtoolsPreflight = { correctPage: true, nativeImage: true };
        } finally { await baseline.mcp.close(); await baseline.context.close(); }
    } else {
        for (const task of tasks) for (const condition of manifest.conditions) {
            const trialDir = join(runDir, `${task.task_id}-${condition}`);
            await resetSite(); log({ event: 'trial-start', task: task.task_id, condition });
            const session = await browserSession(trialDir, condition, task);
            let trial;
            try { trial = await callAgent(session, task, trialDir, condition); }
            finally { await session.mcp.close(); await session.context.close(); }
            assert(trial.models.length > 0 && trial.models.every((m) => m === manifest.model),
                'Missing model response or observed model drift; matrix stopped');
            const grade = lastJson(await exec(python, [join(here, 'evaluate.py'), 'score', String(task.task_id), trialDir]));
            trial = { ...trial, ...grade }; report.trials.push(trial); save(); log({ event: 'trial-done', ...trial, tools: undefined, visibleTools: undefined });
        }
    }
    report.completed = true;
} catch (error) {
    report.completed = false; report.failure = error.stack; process.exitCode = 1;
    log({ event: 'run-failed', reason: error.message });
} finally {
    await Promise.all(activeClients.map((c) => c.close().catch(() => {})));
    await Promise.all(activeContexts.map((c) => c.close().catch(() => {})));
    if (siteCreated) await exec('docker', ['rm', '-fv', container]).catch(() => {});
    if (gatewayProcess && gatewayProcess.exitCode === null) await new Promise((done) => {
        const timer = setTimeout(() => gatewayProcess.kill('SIGKILL'), 5000);
        gatewayProcess.once('exit', () => { clearTimeout(timer); done(); });
        gatewayProcess.kill('SIGTERM');
    });
    report.finishedAt = new Date().toISOString(); save();
    log({ event: 'run-finished', completed: report.completed, trials: report.trials.length, report: join(runDir, 'report.json') });
}
