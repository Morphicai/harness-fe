#!/usr/bin/env node
/**
 * Condition-A-only browser prewarm.
 *
 * harness-fe's runtime SDK phones home *from inside the page* — there is no
 * tab for the agent's `page.*` tools to act on until something has actually
 * loaded the dev server URL in a real browser and the SDK has connected to
 * the gateway over WS. Chrome DevTools MCP doesn't need this (it manages its
 * own browser lifecycle via CDP the moment the agent calls `navigate_page`),
 * which is exactly why this script only runs for the harness-fe condition.
 * See harness-bench-tech-design.md §3.4 for the full rationale.
 *
 * This process does NOT reproduce the bug — it only brings the daemon and
 * one tab up so tools have something to act on. Reproducing the bug is the
 * agent's job, via its own page.click/page.navigate calls. Pre-seeding the
 * repro here would erase exactly the signal (does harness-fe's persisted
 * session.tail survive a reload the *agent* triggers) the hard-tier bugs are
 * designed to test.
 *
 * Usage: node harness_prewarm.mjs <appUrl>
 * Prints "PREWARM_READY" to stdout once the tab is confirmed connected, then
 * idles until SIGTERM/SIGINT, at which point it tears down the browser and
 * the gateway child process it spawned.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import { chromium } from 'playwright';

const GATEWAY_PORT = 47729; // harness-fe's documented default loopback gateway port

async function waitForPort(port, host, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ok = await new Promise((resolve) => {
            const socket = net.createConnection({ port, host }, () => {
                socket.end();
                resolve(true);
            });
            socket.on('error', () => resolve(false));
        });
        if (ok) return;
        await sleep(200);
    }
    throw new Error(`waitForPort: "${label}" (${host}:${port}) not reachable after ${timeoutMs}ms`);
}

async function main() {
    const appUrl = process.argv[2];
    if (!appUrl) {
        console.error('usage: node harness_prewarm.mjs <appUrl>');
        process.exit(1);
    }

    // 1) Bring up (or attach to) the shared solo-mode gateway. Claude Code's
    // own harness-fe MCP entry will spawn "npx @harness-fe/cli mcp" too, but
    // per the harness-fe docs multiple callers share one loopback daemon —
    // starting it here just means it's already warm by the time the agent
    // connects, instead of racing the agent's first tool call against daemon
    // boot time.
    console.error('[prewarm] starting harness-fe gateway (npx @harness-fe/cli mcp)…');
    const gateway = spawn('npx', ['-y', '@harness-fe/cli', 'mcp'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stdout.on('data', (d) => process.stderr.write(`[gateway] ${d}`));
    gateway.stderr.on('data', (d) => process.stderr.write(`[gateway] ${d}`));

    await waitForPort(GATEWAY_PORT, '127.0.0.1', 15_000, 'harness-fe gateway');
    console.error('[prewarm] gateway reachable ✓');

    // 2) Launch a headless tab and navigate to the dev server so the
    // runtime-client SDK boots and connects.
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(appUrl, { waitUntil: 'networkidle' });

    // Give HMR/WS a moment to settle, then confirm injection — same marker
    // check as examples/react-demo/e2e/closed-loop.e2e.ts step 1. We don't
    // reach into the gateway's internal tab registry here (that's an
    // implementation detail the bench shouldn't depend on); the marker is
    // the same public signal the runtime itself exposes.
    await sleep(500);
    const injected = await page.evaluate(() => Boolean(window.__HARNESS_FE__));
    if (!injected) {
        throw new Error('window.__HARNESS_FE__ marker not present — harness-fe plugin did not inject into this page');
    }
    console.error('[prewarm] runtime SDK injected ✓');

    console.log('PREWARM_READY');

    // 3) Idle until told to stop. Keep the page and gateway alive for the
    // duration of the agent's run — closing either mid-run would sever the
    // tab the agent has been driving.
    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.error('[prewarm] shutting down…');
        try { await page.close(); } catch { /* ignore */ }
        try { await browser.close(); } catch { /* ignore */ }
        try { gateway.kill('SIGTERM'); } catch { /* ignore */ }
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Keep the event loop alive.
    await new Promise(() => {});
}

main().catch((err) => {
    console.error('[prewarm] FAILED', err);
    process.exit(1);
});
