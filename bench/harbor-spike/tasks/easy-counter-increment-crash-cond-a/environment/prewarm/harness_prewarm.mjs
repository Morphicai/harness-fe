/**
 * bench/prewarm/harness_prewarm.mjs 的条件 A 容器副本。两处偏差：
 * 1. chromium 显式 --no-sandbox（容器内 root 运行）；
 * 2. daemon 直接调全局 `harness` 二进制（镜像内 npm i -g @harness-fe/cli），
 *    不走 npx -y。
 * 语义与原版一致：拉起 daemon → headless tab 打开 app → 确认 runtime SDK
 * 注入 → 打印 PREWARM_READY → 驻留直到 SIGTERM。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import { chromium } from 'playwright';

const GATEWAY_PORT = 47729;

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

    console.error('[prewarm] starting harness-fe gateway (harness mcp)…');
    const gateway = spawn('harness', ['mcp'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    gateway.stdout.on('data', (d) => process.stderr.write(`[gateway] ${d}`));
    gateway.stderr.on('data', (d) => process.stderr.write(`[gateway] ${d}`));

    await waitForPort(GATEWAY_PORT, '127.0.0.1', 15_000, 'harness-fe gateway');
    console.error('[prewarm] gateway reachable ✓');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(appUrl, { waitUntil: 'networkidle' });

    await sleep(500);
    const injected = await page.evaluate(() => Boolean(window.__HARNESS_FE__));
    if (!injected) {
        throw new Error('window.__HARNESS_FE__ marker not present — harness-fe plugin did not inject into this page');
    }
    console.error('[prewarm] runtime SDK injected ✓');

    console.log('PREWARM_READY');

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

    await new Promise(() => {});
}

main().catch((err) => {
    console.error('[prewarm] FAILED', err);
    process.exit(1);
});
