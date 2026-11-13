import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, symlinkSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '/opt/deps/node_modules/playwright/index.mjs';

const project = process.env.PROJECT, condition = process.env.CONDITION;
assert(['react', 'fastify-react'].includes(project));
assert(['harness-fe', 'chrome-devtools-mcp'].includes(condition));
const root = '/workspace/task'; mkdirSync(root, { recursive: true });
cpSync('/opt/seeds/' + project, root, { recursive: true });
symlinkSync('/opt/deps/node_modules', root + '/node_modules');
mkdirSync('/artifacts', { recursive: true });
for (const name of ['plugins', 'public', 'libs']) if (project === 'fastify-react') mkdirSync(join(root, 'src', name), { recursive: true });
const require = createRequire('/opt/deps/package.json');
const children = new Set(); let backend, frontend, gateway, context, stopping = false;
function start(command, args, log, env = {}) {
    const child = spawn(command, args, { cwd: root, detached: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => appendFileSync('/artifacts/' + log, data));
    child.on('exit', () => children.delete(child)); return child;
}
async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}
async function wait(fn, label, ms = 30000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); }
    throw Error('Timeout: ' + label);
}
async function restart(resetDatabase = true) {
    await stop(frontend); await stop(backend);
    if (project === 'fastify-react') {
        if (resetDatabase) execFileSync('node', ['scripts/init-db.js', 'src'], { cwd: root,
            env: { ...process.env, DB_HOST: root + '/src/test.sqlite' }, timeout: 15000, stdio: 'ignore' });
        backend = start('node', [require.resolve('tsx/cli'), root + '/src/index.ts'], 'backend.log',
            { PORT: '3212', DB_HOST: root + '/src/test.sqlite' });
    }
    frontend = start('node', ['/opt/webbench/dev.mjs'], 'frontend.log');
    await wait(async () => (await fetch('http://127.0.0.1:3211')).ok, 'frontend');
    return { url: 'http://127.0.0.1:3211', backendRunning: !!backend && backend.exitCode === null };
}
const controller = createServer(async (req, res) => {
    try {
        const chunks = []; for await (const b of req) chunks.push(b);
        const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const value = req.url === '/reload' ? await context.pages()[0].reload().then(() => ({ reloaded: true }))
            : req.url === '/restart' ? await restart(input.resetDatabase !== false)
            : { project, condition, ready: !!context, url: 'http://127.0.0.1:3211', browserVersion: context?.browser().version() };
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));
    } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
});
async function close() {
    if (stopping) return; stopping = true;
    await context?.close().catch(() => {});
    for (const child of [...children]) await stop(child);
    controller.closeAllConnections(); await new Promise(r => controller.close(r)); process.exit(0);
}
process.on('SIGTERM', close); process.on('SIGINT', close);
try {
    if (condition === 'harness-fe') {
        gateway = start('node', ['/opt/harness/dist/cli.js', 'serve', '--port', '47729', '--core-data-dir', '/tmp/core', '--data-dir', '/tmp/gateway'], 'gateway.log');
        const meta = await wait(async () => (await fetch('http://127.0.0.1:47729/console/api/meta')).json(), 'gateway');
        assert.equal(meta.gatewayVersion, '4.5.3');
    }
    await restart();
    context = await chromium.launchPersistentContext('/tmp/webbench-profile', { headless: true,
        viewport: { width: 1280, height: 720 }, args: ['--remote-debugging-port=9222'],
        recordHar: { path: '/artifacts/network.har', content: 'embed' } });
    const page = context.pages()[0]; await page.goto('http://127.0.0.1:3211');
    if (condition === 'harness-fe') {
        await page.waitForFunction(() => document.querySelector('[data-morphix-loc]'), null, { timeout: 30000 });
        await wait(async () => page.evaluate(() => !!window.__HARNESS_FE__), 'injected runtime configuration');
        await page.waitForFunction(() => window.__harness_fe_client__?.getConnectionState() === 'open', null, { timeout: 30000 });
    }
    await new Promise(r => controller.listen(41099, '127.0.0.1', r));
    writeFileSync('/artifacts/ready.json', JSON.stringify({ project, condition, browserVersion: context.browser().version(),
        nativeWorkspaceIsolation: true, instrumentation: condition === 'harness-fe' ? 'vite-plugin' : 'none' }));
} catch (error) { writeFileSync('/artifacts/startup-error.txt', error.stack); await close(); }
