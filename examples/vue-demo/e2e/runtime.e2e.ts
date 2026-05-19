/**
 * Vite + Vue 3 runtime smoke test.
 *
 * Spawns `vite` dev server, loads the page in headless Chromium, and asserts:
 *   1. Vue templates render with data-morphix-* attrs in real DOM.
 *   2. The browser runtime client registers itself on window.
 *   3. Runtime opens a WebSocket to the local MCP daemon (port 47729).
 *
 * Requires MCP daemon to be running on the default port.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const PORT = 13900 + Math.floor(Math.random() * 100);
const URL = `http://localhost:${PORT}/`;

console.log(`--- spinning up vite dev server on :${PORT} ---`);
const dev = spawn('pnpm', ['exec', 'vite', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
dev.stdout?.on('data', (b) => {
    const s = b.toString();
    if (s.includes('ready in') || s.includes('Local:')) ready = true;
});
dev.stderr?.on('data', (b) => process.stderr.write(b));

async function waitUntilReady(): Promise<void> {
    for (let i = 0; i < 60; i++) {
        if (ready) return;
        await sleep(500);
    }
    throw new Error('vite dev server did not become ready in 30s');
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
    await sleep(800);

    const taggedCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-morphix-loc][data-morphix-comp]').length;
    });
    console.log(`tagged DOM elements: ${taggedCount}`);
    if (taggedCount < 8) {
        console.error('FAIL: expected at least 8 tagged DOM elements, got', taggedCount);
        console.error('--- console ---\n' + consoleMsgs.join('\n'));
        await browser.close();
        await shutdown(1);
    }

    // defineOptions({ name: 'App' }) — verify component name flows through
    const appNameCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-morphix-comp="App"]').length;
    });
    console.log(`elements tagged with data-morphix-comp="App": ${appNameCount}`);
    if (appNameCount === 0) {
        console.error('FAIL: defineOptions({ name: "App" }) did not propagate to DOM');
        await browser.close();
        await shutdown(1);
    }

    const hasClient = await page.evaluate(() => Boolean((window as any).__harnessa_fe_client__));
    console.log(`window.__harnessa_fe_client__ present: ${hasClient}`);
    if (!hasClient) {
        console.error('FAIL: runtime client did not register on window');
        console.error('--- console ---\n' + consoleMsgs.join('\n'));
        await browser.close();
        await shutdown(1);
    }

    const wsOpen = await page.evaluate(async () => {
        const client = (window as any).__harnessa_fe_client__;
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
