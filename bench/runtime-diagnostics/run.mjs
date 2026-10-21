import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { startScenario } from './scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json')));
const mode = process.argv.includes('--preflight') ? 'preflight' : process.argv.includes('--run') ? 'pilot' : undefined;
assert(mode, 'Use --preflight (no model) or --run (six real model attempts)');
const at = process.argv.indexOf('--chromium');
const executablePath = at >= 0 ? process.argv[at + 1] : undefined;
const runDir = join(here, 'jobs', `${mode}-${Date.now()}`);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const fromDemo = createRequire(join(repo, 'examples/react-demo/package.json'));
const fromGateway = createRequire(join(repo, 'packages/gateway/package.json'));
async function load(from, name) { const m = await import(pathToFileURL(from.resolve(name)).href); return { ...m.default, ...m }; }
const { chromium } = await load(fromDemo, 'playwright');
const { build } = await load(createRequire(fromDemo.resolve('vite')), 'esbuild');
const { Client } = await load(fromGateway, '@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await load(fromGateway, '@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = await load(fromGateway, '@modelcontextprotocol/sdk/client/streamableHttp.js');
const { StreamableHTTPServerTransport } = await load(fromGateway, '@modelcontextprotocol/sdk/server/streamableHttp.js');
const { Server } = await load(fromGateway, '@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = await load(fromGateway, '@modelcontextprotocol/sdk/types.js');
const report = { manifest, mode, startedAt: new Date().toISOString(), trials: [] };
const save = () => writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
const note = (value) => console.log(JSON.stringify({ time: new Date().toISOString(), ...value }));
const jsonText = (r) => JSON.parse(r.content.find((c) => c.type === 'text').text);
async function waitFor(fn, name, ms = 20000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { const v = await fn(); if (v) return v; await sleep(100); }
    throw new Error(`Timeout: ${name}`);
}
async function port() {
    const s = tcpServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const p = s.address().port; await new Promise((r) => s.close(r)); return p;
}
async function stop(child) {
    if (!child || child.exitCode !== null) return;
    await new Promise((done) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
        child.once('exit', () => { clearTimeout(timer); done(); }); child.kill('SIGTERM');
    });
}
const harnessTools = new Set(['tab.list', 'page.screenshot', 'page.snapshot', 'page.dom_query',
    'console.tail', 'errors.tail', 'network.tail', 'network.get', 'storage.tail',
    'project.sessions', 'project.list', 'session.list', 'session.summary', 'session.tail',
    'session.search', 'visitor.list', 'visitor.get', 'visitor.timeline']);
const devtoolsTools = new Set(['list_pages', 'select_page', 'take_snapshot', 'take_screenshot',
    'list_console_messages', 'get_console_message', 'list_network_requests', 'get_network_request']);

// Both conditions use this same protocol-only bridge. A single upstream client
// stays connected before the incident and throughout the model's investigation.
async function broker(upstream, tools, dir) {
    const sessions = new Map();
    const path = `/mcp/${randomUUID()}`;
    const audit = [];
    const server = httpServer(async (req, res) => {
        if (req.url !== path) { res.writeHead(404); res.end(); return; }
        try {
            const sid = req.headers['mcp-session-id'];
            if (sid && sessions.has(sid)) { await sessions.get(sid).transport.handleRequest(req, res); return; }
            const chunks = []; for await (const b of req) chunks.push(b);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            assert.equal(body.method, 'initialize');
            const mcp = new Server({ name: 'runtime-diagnostics-observer', version: '1' }, { capabilities: { tools: {} } });
            mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
            mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
                const { name, arguments: args = {} } = request.params;
                assert(tools.some((t) => t.name === name), 'Tool not allowed in this diagnostic');
                const result = await upstream.callTool({ name, arguments: args });
                const texts = result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
                const images = result.content.filter((c) => c.type === 'image');
                const item = { tool: name, args, text: texts, isError: Boolean(result.isError), imageCount: images.length, at: Date.now() };
                audit.push(item);
                appendFileSync(join(dir, 'tool-audit.jsonl'), JSON.stringify(item) + '\n', { mode: 0o600 });
                images.forEach((img, i) => writeFileSync(join(dir, `agent-image-${audit.length}-${i}.${img.mimeType.split('/')[1]}`), Buffer.from(img.data, 'base64')));
                return result;
            });
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: randomUUID,
                onsessioninitialized: (id) => sessions.set(id, { transport, mcp }),
            });
            await mcp.connect(transport); await transport.handleRequest(req, res, body);
        } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}${path}`, audit,
        async close() {
            await Promise.all([...sessions.values()].map((s) => s.mcp.close()));
            server.closeAllConnections(); await new Promise((r) => server.close(r));
        } };
}

async function observe(dir, scenario, values, condition) {
    const resources = {};
    try {
        const gp = await port(), dp = await port();
        const name = condition === 'harness-fe' ? 'harness-fe' : 'chrome-devtools';
        if (condition === 'harness-fe') {
            resources.gateway = spawn(process.execPath, [join(repo, 'packages/cli/dist/cli.js'), 'serve',
                '--port', String(gp), '--core-data-dir', join(dir, 'core'), '--data-dir', join(dir, 'gateway')],
                { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
            for (const stream of [resources.gateway.stdout, resources.gateway.stderr]) stream.on('data', (b) =>
                appendFileSync(join(dir, 'gateway.log'), b, { mode: 0o600 }));
            await waitFor(async () => {
                try { return (await fetch(`http://127.0.0.1:${gp}/console/api/meta`)).ok; } catch { return false; }
            }, 'gateway');
        }
        const profile = realpathSync(mkdtempSync(join(tmpdir(), 'hfe-diagnostics-browser-')));
        const context = resources.context = await chromium.launchPersistentContext(profile, {
            headless: true, ...(executablePath ? { executablePath } : {}),
            args: [`--remote-debugging-port=${dp}`], viewport: { width: 1100, height: 700 },
            recordHar: { path: join(dir, 'network.har'), content: 'embed', mode: 'full' },
        });
        report.browserVersion = context.browser().version();
        const projectId = `diagnostic-${randomUUID()}`;
        if (condition === 'harness-fe') await context.addInitScript({ content:
            `window.__HARNESS_FE__=${JSON.stringify({ projectId, mcpUrl: `ws://127.0.0.1:${gp}/ws`, overlay: false, deferStart: true, consent: 'off' })};\n${runtimeBundle}` });
        const page = context.pages()[0] ?? await context.newPage();
        page.on('pageerror', () => {});
        await page.goto(scenario.origin + '/', { waitUntil: 'networkidle' });
        let preferences;
        if (scenario.kind === 'cross-tab-session') {
            preferences = await context.newPage(); await preferences.goto(scenario.origin + '/preferences', { waitUntil: 'networkidle' });
        }
        const client = resources.client = new Client({ name: 'diagnostics-observer', version: '1' });
        const transport = condition === 'harness-fe' ? new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${gp}/mcp`))
            : new StdioClientTransport({ command: 'chrome-devtools-mcp', args: ['--browserUrl', `http://127.0.0.1:${dp}`,
                '--no-usage-statistics', '--no-performance-crux', '--no-javascript-evaluation'], stderr: 'pipe' });
        await client.connect(transport);
        const catalog = (await client.listTools()).tools;
        const tools = catalog.filter((t) => (condition === 'harness-fe' ? harnessTools : devtoolsTools).has(t.name));
        let targets = [];
        if (condition === 'harness-fe') {
            assert(catalog.find((t) => t.name === 'page.screenshot').description.includes('native MCP image'));
            targets = await waitFor(async () => {
                const tabs = jsonText(await client.callTool({ name: 'tab.list', arguments: {} })).filter((t) => t.projectId === projectId);
                return tabs.length === (preferences ? 2 : 1) && tabs;
            }, 'runtime tabs');
            targets = targets.map((t) => ({ title: t.title, tabId: t.tabId, url: t.url }));
        } else {
            const pages = await client.callTool({ name: 'list_pages', arguments: {} });
            const content = pages.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
            targets = content.split('\n').flatMap((line) => {
                const m = line.match(/^(\d+): (.*?) \((http[^)]+)\)/);
                return m ? [{ pageId: Number(m[1]), title: m[2], url: m[3] }] : [];
            });
            assert.equal(targets.length, preferences ? 2 : 1);
            for (const target of targets) {
                await client.callTool({ name: 'list_console_messages', arguments: { pageId: target.pageId } });
                await client.callTool({ name: 'list_network_requests', arguments: { pageId: target.pageId } });
            }
        }
        // Runtime and DevTools collection are both armed BEFORE the incident.
        const action = preferences ?? page;
        await action.getByRole('button', { name: preferences ? 'Refresh preferences' : 'Run workflow', exact: true }).click();
        await page.waitForFunction(() => document.body.dataset.ready === 'yes');
        if (preferences) await preferences.waitForFunction(() => document.body.dataset.ready === 'yes');
        const state = await page.locator('#status').textContent();
        assert.equal(state, values.visibleState);
        await page.screenshot({ path: join(dir, 'trusted-state.png') });
        resources.broker = await broker(client, tools, dir);
        return { ...resources, name, targets, origin: scenario.origin, projectId, dir };
    } catch (e) { await close(resources); throw e; }
}
async function close(r) {
    await r.broker?.close().catch(() => {});
    await r.client?.close().catch(() => {});
    await r.context?.close().catch(() => {});
    await stop(r.gateway);
}
function parseFinal(raw) {
    raw = raw.trim().replace(/```(?:json)?/g, '');
    for (let at = raw.indexOf('{'); at >= 0; at = raw.indexOf('{', at + 1)) {
        for (let end = raw.lastIndexOf('}'); end > at; end = raw.lastIndexOf('}', end - 1)) {
            try { const value = JSON.parse(raw.slice(at, end + 1)); if (value.root_cause) return value; } catch {}
        }
    }
    return null;
}
function grade(answer, values, rootCause, audit) {
    const logReads = audit.filter((x) => /console|network|storage|session|visitor/.test(x.tool));
    const checks = {
        rootCause: answer?.root_cause === rootCause,
        evidenceId: answer?.evidence_id === values.evidenceId,
        screenshotCode: answer?.incident_code === values.code,
        visibleState: answer?.visible_state === values.visibleState,
        originTab: !values.originTab || answer?.origin_tab === values.originTab,
        storageKey: !values.originTab || answer?.storage_key === values.key,
        logsRead: logReads.some((x) => x.text.includes(values.evidenceId)),
        nativeImageRead: audit.some((x) => x.imageCount > 0),
    };
    return { checks, passed: Object.values(checks).every(Boolean) };
}
async function runModel(session, task, values) {
    const prompt = `You are diagnosing a frontend incident that ALREADY happened. ${task.intent}\n` +
        `Site: ${session.origin}. Targets: ${JSON.stringify(session.targets)}. The log collector was connected before the incident. ` +
        `Inspect retained process logs and take at least one current screenshot. Do not repeat the workflow, reload, navigate, execute JS, ` +
        `read source/files, or access evaluation internals. Do not treat a screenshot alone as evidence of a past request or cross-tab action. ` +
        `Stop within ${manifest.maxToolCalls} tool calls. Return JSON with fields: ` +
        `{"root_cause":"backend_failure|stale_client_error|stale_stream_write|shared_storage_cleanup|unknown",` +
        `"evidence_id":"decisive request/operation id from logs","incident_code":"code read from the main affected page screenshot",` +
        `"visible_state":"exact main page status text","origin_tab":null,"storage_key":null,"explanation":"brief causal chain with cited observations"}. ` +
        `For a cross-tab incident set origin_tab to its page title and storage_key to the affected key. No source editing is requested.`;
    writeFileSync(join(session.dir, 'prompt.txt'), prompt);
    const config = join(session.dir, 'mcp.json');
    writeFileSync(config, JSON.stringify({ mcpServers: { [session.name]: { command: process.execPath,
        args: [join(here, 'stdio-relay.mjs'), session.broker.url] } } }), { mode: 0o600 });
    const transcript = join(session.dir, 'transcript.stream.json');
    writeFileSync(transcript, '', { mode: 0o600 });
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'hfe-diagnostic-agent-')));
    const child = spawn('claude', ['-p', prompt, '--model', manifest.model, '--tools', '', '--output-format', 'stream-json',
        '--verbose', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', config,
        '--permission-mode', 'acceptEdits', '--allowedTools', `mcp__${session.name}`], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '', calls = 0, limited = false, timedOut = false;
    child.stdout.on('data', (data) => {
        appendFileSync(transcript, data); buffer += data;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
            try {
                const event = JSON.parse(line);
                if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
                    calls += event.message.content.filter((b) => b.type === 'tool_use').length;
                    if (calls > manifest.maxToolCalls) { limited = true; child.kill('SIGTERM'); }
                }
            } catch {}
        }
    });
    child.stderr.on('data', (data) => appendFileSync(join(session.dir, 'stderr.log'), data, { mode: 0o600 }));
    const started = Date.now();
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, manifest.timeoutSeconds * 1000);
    const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); }); clearTimeout(timer);
    const events = readFileSync(transcript, 'utf8').split('\n').flatMap((s) => { try { return [JSON.parse(s)]; } catch { return []; } });
    const end = events.findLast((e) => e.type === 'result');
    assert(timedOut || limited || (code === 0 && end && !end.is_error), 'Model execution failed; not a diagnostic score');
    const models = [...new Set(events.filter((e) => e.type === 'assistant').map((e) => e.message?.model).filter(Boolean))];
    assert(models.length > 0 && models.every((m) => m === manifest.model), 'Model identity missing or changed');
    const answer = parseFinal(end?.result ?? '');
    writeFileSync(join(session.dir, 'answer.json'), JSON.stringify(answer, null, 2));
    return { answer, ...grade(answer, values, task.rootCause, session.broker.audit), models,
        toolCalls: calls, seconds: (Date.now() - started) / 1000, costUsd: end?.total_cost_usd ?? 0,
        timedOut, limited, toolErrors: session.broker.audit.filter((x) => x.isError).length,
        images: session.broker.audit.reduce((n, x) => n + x.imageCount, 0),
        tools: session.broker.audit.map((x) => x.tool) };
}

let runtimeBundle;
try {
    const bundle = await build({ entryPoints: [fromDemo.resolve('@harness-fe/runtime')], bundle: true, format: 'iife',
        write: false, platform: 'browser', target: 'es2020', minify: true, define: { 'process.env.NODE_ENV': '"development"' } });
    runtimeBundle = bundle.outputFiles[0].text;
    report.runtimeSha256 = createHash('sha256').update(runtimeBundle).digest('hex');
    report.gatewaySha256 = createHash('sha256').update(readFileSync(join(repo, 'packages/gateway/dist/mcp.js'))).digest('hex');
    for (const task of manifest.cases) {
        const nonce = randomUUID().slice(0, 8);
        const values = { code: `INC-${randomUUID().slice(0, 6).toUpperCase()}`, evidenceId: `op-${nonce}`,
            firstId: `req-${randomUUID().slice(0, 8)}`, key: `workbench.session.${nonce}`,
            visibleState: task.id === 'export-stale-error' ? 'Export unavailable' : task.id === 'stream-cross-talk' ? 'Conversation B' : 'Session ended',
            originTab: task.id === 'cross-tab-session' ? 'Preferences' : null };
        writeFileSync(join(runDir, `oracle-${task.id}.json`), JSON.stringify(values), { mode: 0o600 });
        for (const condition of manifest.conditions) {
            const dir = join(runDir, `${task.id}-${condition}`); mkdirSync(dir, { recursive: true });
            const scenario = await startScenario(task.id, values); scenario.kind = task.id;
            note({ event: 'start', case: task.id, condition });
            let session;
            try {
                session = await observe(dir, scenario, values, condition);
                let result;
                if (mode === 'preflight') {
                    let log = '';
                    if (condition === 'harness-fe') {
                        for (const target of session.targets) {
                            for (const name of ['console.tail', 'network.tail', 'storage.tail']) {
                                const r = await session.client.callTool({ name, arguments: { tabId: target.tabId, n: 50, includeBody: true } });
                                log += JSON.stringify(r);
                            }
                        }
                    } else for (const target of session.targets) {
                        const r = await session.client.callTool({ name: 'list_console_messages', arguments: { pageId: target.pageId, pageSize: 100 } });
                        log += JSON.stringify(r);
                    }
                    assert(log.includes(values.evidenceId), 'Expected incident evidence not available to observer');
                    const target = session.targets.find((t) => t.url === scenario.origin + '/'); assert(target);
                    // Exercise the exact stdio -> HTTP broker -> retained upstream
                    // session path that the model will use, without an API call.
                    const relay = new Client({ name: 'preflight-agent', version: '1' });
                    let shot;
                    try {
                        await relay.connect(new StdioClientTransport({ command: process.execPath,
                            args: [join(here, 'stdio-relay.mjs'), session.broker.url], stderr: 'pipe' }));
                        const list = (await relay.listTools()).tools;
                        assert(!list.some((t) => /evaluate|source|set_html|set_style/.test(t.name)));
                        shot = await relay.callTool(condition === 'harness-fe'
                            ? { name: 'page.screenshot', arguments: { tabId: target.tabId } }
                            : { name: 'take_screenshot', arguments: { pageId: target.pageId, format: 'png' } });
                    } finally { await relay.close(); }
                    assert(shot.content.some((c) => c.type === 'image'), 'Image not available to observer');
                    const correct = { root_cause: task.rootCause, evidence_id: values.evidenceId, incident_code: values.code,
                        visible_state: values.visibleState, origin_tab: values.originTab, storage_key: values.key };
                    const audit = [{ tool: 'console.tail', text: log, imageCount: 1 }];
                    assert(grade(correct, values, task.rootCause, audit).passed);
                    assert(!grade({ ...correct, evidence_id: 'guessed' }, values, task.rootCause, audit).passed);
                    assert(!grade(correct, values, task.rootCause, []).passed);
                    writeFileSync(join(dir, 'preflight-evidence.json'), JSON.stringify({ targets: session.targets, logs: log, screenshotTypes: shot.content.map((c) => c.type) }, null, 2));
                    result = { passed: true, evidencePresent: true, screenshotPresent: true, scorerControlsPassed: true };
                } else result = await runModel(session, task, values);
                report.trials.push({ case: task.id, condition, ...result }); save();
                note({ event: 'done', case: task.id, condition, passed: result.passed, calls: result.toolCalls, costUsd: result.costUsd });
            } finally { if (session) await close(session); await new Promise((r) => scenario.server.close(r)); }
        }
    }
    report.completed = true;
} catch (e) { report.completed = false; report.failure = e.stack; process.exitCode = 1; note({ event: 'failed', error: e.message }); }
finally { report.finishedAt = new Date().toISOString(); save(); note({ event: 'finished', completed: report.completed, trials: report.trials.length, report: join(runDir, 'report.json') }); }
