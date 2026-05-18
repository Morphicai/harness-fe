/**
 * Webpack 5 + Vue 3 runtime smoke test.
 *
 * Goal: assert that after the webpack plugin compiles the user's app, the
 * browser-side runtime client is:
 *   1. bundled into the user's main chunk (no bare-specifier 404),
 *   2. boots itself on page load (idempotent start),
 *   3. registers `window.__harnessa_fe_client__`,
 *   4. opens a WebSocket to the local MCP daemon (port 47729).
 *
 * Requires the MCP daemon to be running locally on the default port.
 * Spawns webpack-dev-server on a random free port; tears down afterwards.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const PORT = 13800 + Math.floor(Math.random() * 100);
const URL = `http://localhost:${PORT}/`;

console.log(`--- spinning up webpack-dev-server on :${PORT} ---`);
const dev = spawn('pnpm', ['exec', 'webpack', 'serve', '--port', String(PORT)], {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
dev.stdout?.on('data', (b) => {
    const s = b.toString();
    if (s.includes('compiled successfully')) ready = true;
});
dev.stderr?.on('data', (b) => process.stderr.write(b));

async function waitUntilReady(): Promise<void> {
    for (let i = 0; i < 60; i++) {
        if (ready) return;
        await sleep(500);
    }
    throw new Error('webpack-dev-server did not become ready in 30s');
}

async function shutdown(code: number): Promise<never> {
    dev.kill('SIGTERM');
    await sleep(300);
    if (!dev.killed) dev.kill('SIGKILL');
    process.exit(code);
}

try {
    await waitUntilReady();
    console.log('--- launching headless chromium ---');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleMsgs: string[] = [];
    page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleMsgs.push(`[error] ${e.message}`));

    await page.goto(URL, { waitUntil: 'networkidle' });

    // Give the runtime a moment to start the WebSocket handshake.
    await sleep(800);

    // 1. data-morphix-* attrs are present on rendered DOM
    const taggedCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-morphix-loc][data-morphix-comp]').length;
    });
    console.log(`tagged DOM elements: ${taggedCount}`);
    if (taggedCount < 5) {
        console.error('FAIL: expected at least 5 tagged DOM elements, got', taggedCount);
        console.error('--- console ---\n' + consoleMsgs.join('\n'));
        await browser.close();
        await shutdown(1);
    }

    // 2. Runtime client booted and registered itself
    const hasClient = await page.evaluate(() => {
        return Boolean((window as any).__harnessa_fe_client__);
    });
    console.log(`window.__harnessa_fe_client__ present: ${hasClient}`);
    if (!hasClient) {
        console.error('FAIL: runtime client did not register on window');
        console.error('--- console ---\n' + consoleMsgs.join('\n'));
        await browser.close();
        await shutdown(1);
    }

    // 3. Runtime opened a WebSocket
    const wsOpen = await page.evaluate(async () => {
        const client = (window as any).__harnessa_fe_client__;
        // Internal: client exposes a `ws` field that holds the active socket.
        for (let i = 0; i < 20; i++) {
            const ws = client?.ws;
            if (ws && ws.readyState === WebSocket.OPEN) return true;
            await new Promise((r) => setTimeout(r, 100));
        }
        return false;
    });
    console.log(`runtime WebSocket open: ${wsOpen}`);
    if (!wsOpen) {
        console.error('FAIL: runtime did not open a WebSocket to MCP daemon');
        console.error('Hint: is the MCP daemon running on port 47729?');
        console.error('--- console ---\n' + consoleMsgs.join('\n'));
        await browser.close();
        await shutdown(1);
    }

    console.log('runtime.e2e ALL PASS ✓');
    await browser.close();
    await shutdown(0);
} catch (err) {
    console.error('runtime.e2e FAILED with exception:', err);
    await shutdown(1);
}
