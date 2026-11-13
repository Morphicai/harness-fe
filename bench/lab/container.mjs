import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cli = '/opt/harness/dist/cli.js';
async function port() {
    const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
    const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
async function wait(fn, label) {
    for (let i = 0; i < 200; i++) { try { const value = await fn(); if (value) return value; } catch {} await sleep(100); }
    throw Error(`Timed out: ${label}`);
}
async function stop(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([new Promise(r => child.once('exit', r)), sleep(4000)]);
    if (child.exitCode === null) { child.kill('SIGKILL'); await new Promise(r => child.once('exit', r)); }
}
const json = r => JSON.parse(r.content.find(c => c.type === 'text').text);

async function doctor() {
    const browser = await chromium.launch({ headless: true });
    try {
        const versions = {};
        for (const [name, venv] of [['harbor', 'harbor'], ['swebench', 'swebench'], ['webarena-verified', 'webarena']]) {
            versions[name] = execFileSync(`/opt/evaluators/${venv}/bin/python`, ['-c', `import importlib.metadata; print(importlib.metadata.version(${JSON.stringify(name)}))`], { encoding: 'utf8' }).trim();
        }
        const harnessVersion = JSON.parse(readFileSync('/opt/harness/package.json')).version;
        assert.equal(harnessVersion, JSON.parse(readFileSync('/opt/lab/receipt.json')).environment.harnessCliVersion);
        return { kind: 'environment-doctor', passed: true, node: process.version, harnessVersion,
            architecture: process.arch, python: execFileSync('python', ['--version'], { encoding: 'utf8' }).trim(),
            chromium: browser.version(), devtools: execFileSync('chrome-devtools-mcp', ['--version'], { encoding: 'utf8' }).trim(),
            evaluators: versions, source: JSON.parse(readFileSync('/opt/lab/receipt.json')) };
    } finally { await browser.close(); }
}

async function smoke(condition, output) {
    assert(['harness-fe', 'chrome-devtools-mcp'].includes(condition));
    mkdirSync(output, { recursive: true });
    const root = mkdtempSync('/tmp/hfe-lab-'), gp = await port(), dp = await port(), code = randomUUID();
    let gateway, context, client, transport;
    const calls = [];
    const server = createServer((req, res) => {
        if (req.url === '/api/increment') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code, count: 1 })); return; }
        res.setHeader('content-type', 'text/html');
        res.end('<title>Lab browser acceptance</title><style>body{font:24px sans-serif;padding:40px}button{padding:16px}</style>' +
            '<h1>Browser acceptance</h1><button id="increment">Increment</button><p id="count">0</p>' +
            '<script>document.querySelector("button").onclick=async()=>{let r=await fetch("/api/increment");let v=await r.json();document.querySelector("#count").textContent=v.count;console.log("lab-accepted",v.code)}</script>');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        if (condition === 'harness-fe') {
            gateway = spawn('node', [cli, 'serve', '--port', String(gp), '--core-data-dir', join(root, 'core'), '--data-dir', join(root, 'gateway')], { stdio: 'ignore' });
            await wait(async () => (await fetch(`http://127.0.0.1:${gp}/console/api/meta`)).ok, 'gateway');
        }
        context = await chromium.launchPersistentContext(join(root, 'profile'), { headless: true,
            viewport: { width: 1100, height: 700 }, args: [`--remote-debugging-port=${dp}`],
            recordHar: { path: join(output, 'network.har'), content: 'embed' } });
        if (condition === 'harness-fe') await context.addInitScript({ content:
            `window.__HARNESS_FE__=${JSON.stringify({ projectId: code, mcpUrl: `ws://127.0.0.1:${gp}/ws`, overlay: false, deferStart: true, consent: 'off' })};\n` + readFileSync('/opt/lab/runtime.js', 'utf8') });
        const page = context.pages()[0]; await page.goto(origin);
        client = new Client({ name: 'benchmark-lab-acceptance', version: '1' });
        transport = new StdioClientTransport(condition === 'harness-fe'
            ? { command: 'node', args: [cli, 'mcp', '--port', String(gp)], stderr: 'pipe' }
            : { command: 'chrome-devtools-mcp', args: ['--browserUrl', `http://127.0.0.1:${dp}`, '--no-usage-statistics', '--no-performance-crux'], stderr: 'pipe' });
        await client.connect(transport);
        const catalog = (await client.listTools()).tools;
        async function call(name, args = {}) {
            const result = await client.callTool({ name, arguments: args });
            calls.push({ name, args, text: result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'), images: result.content.filter(c => c.type === 'image').length });
            assert(!result.isError, `MCP tool failed: ${name}: ${calls.at(-1).text}`);
            return result;
        }
        let target;
        if (condition === 'harness-fe') {
            assert(catalog.find(t => t.name === 'page.screenshot').description.includes('native MCP image'));
            const tab = await wait(async () => json(await call('tab.list')).find(t => t.projectId === code), 'runtime tab');
            target = { tabId: tab.tabId };
            await call('page.click', { ...target, selector: { css: '#increment' } });
        } else {
            const pages = await call('list_pages');
            const text = pages.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            const id = text.split('\n').find(s => s.includes(origin))?.match(/^(\d+):/);
            assert(id, 'Wrong DevTools page'); target = { pageId: Number(id[1]) };
            const snapshot = await call('take_snapshot', target);
            const contents = snapshot.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            const uid = contents.match(/uid=(\S+) button "Increment"/);
            assert(uid, 'Button absent from accessibility snapshot');
            await call('click', { ...target, uid: uid[1] });
        }
        await wait(async () => (await page.locator('#count').textContent()) === '1', 'MCP click UI state');
        const consoleResult = await call(condition === 'harness-fe' ? 'console.tail' : 'list_console_messages', target);
        const networkResult = await call(condition === 'harness-fe' ? 'network.tail' : 'list_network_requests', target);
        assert(JSON.stringify(consoleResult).includes(code), 'Console did not capture the unique incident');
        assert(JSON.stringify(networkResult).includes('/api/increment'), 'Network event absent');
        const shot = await call(condition === 'harness-fe' ? 'page.screenshot' : 'take_screenshot', { ...target, format: 'png' });
        const image = shot.content.find(c => c.type === 'image'); assert(image && image.mimeType === 'image/png');
        const bytes = Buffer.from(image.data, 'base64'); assert(bytes.length > 100);
        writeFileSync(join(output, 'native-image.png'), bytes);
        const result = { kind: 'environment-smoke', condition, passed: true,
            checks: { mcpClick: true, uiState: true, consoleEvidence: true, networkEvidence: true, nativeImage: true },
            toolCalls: calls.length, chromium: context.browser().version() };
        writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2)); return result;
    } finally {
        writeFileSync(join(output, 'tools.json'), JSON.stringify(calls, null, 2));
        await client?.close().catch(() => {}); await transport?.close().catch(() => {});
        await context?.close().catch(() => {}); await stop(gateway);
        server.closeAllConnections(); await new Promise(r => server.close(r));
    }
}

try {
    const [command, condition, output = '/artifacts'] = process.argv.slice(2);
    const result = command === 'doctor' ? await doctor() : command === 'smoke' ? await smoke(condition, output) : null;
    assert(result, 'Use doctor or smoke CONDITION OUTPUT');
    console.log(JSON.stringify(result));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
