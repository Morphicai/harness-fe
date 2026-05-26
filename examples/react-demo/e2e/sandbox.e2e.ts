/**
 * Real-browser e2e for @harness-fe/sandbox.
 *
 * Boots vite + Chromium (Playwright), navigates to /sandbox, lets the page
 * run every identity / interceptor / channel check, then asserts the summary.
 *
 * This is what makes us trust the lib in a REAL browser — Chromium /
 * V8 / blink, not happy-dom. The Phase 0 skipped cases (Symbol.toStringTag,
 * detached-this throws, etc.) are exercised here for the first time.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function assert(cond: unknown, label: string): asserts cond {
    if (!cond) throw new Error(`ASSERT FAIL: ${label}`);
}

async function waitFor<T>(probe: () => Promise<T | undefined> | T | undefined, timeoutMs = 8000, label = 'condition'): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const v = await probe();
        if (v) return v;
        await sleep(100);
    }
    throw new Error(`waitFor: "${label}" timed out after ${timeoutMs}ms`);
}

let browser: Browser | undefined;
let page: Page | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;

async function cleanup(): Promise<void> {
    try { await page?.close(); } catch { /* ignore */ }
    try { await browser?.close(); } catch { /* ignore */ }
    try { await vite?.close(); } catch { /* ignore */ }
}

async function run(): Promise<void> {
    vite = await createServer({
        root: projectRoot,
        configFile: false,
        plugins: [(await import('@vitejs/plugin-react')).default()],
        server: { port: 0, host: '127.0.0.1' },
        appType: 'spa',
        logLevel: 'warn',
    });
    await vite.listen();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vitePort = (vite.config as any).server.port as number;
    const url = `http://127.0.0.1:${vitePort}/`;
    console.log(`[sandbox-e2e] vite serving ${url}`);

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${url}sandbox`, { waitUntil: 'domcontentloaded' });

    // Surface page errors early so we can diagnose mount failures.
    await sleep(500);
    if (consoleErrors.length || pageErrors.length) {
        console.log('[sandbox-e2e] page console errors:');
        for (const e of consoleErrors) console.log('  ', e);
        console.log('[sandbox-e2e] pageerror events:');
        for (const e of pageErrors) console.log('  ', e);
    }

    // Probe whether the SPA mounted at all.
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log(`[sandbox-e2e] body preview: ${bodyText.replace(/\s+/g, ' ').slice(0, 200)}`);

    // Wait for the summary to finish populating (at least one case rendered).
    await waitFor(async () => {
        const total = await page!.getAttribute('[data-testid="summary"]', 'data-total');
        return total && Number(total) > 10 ? total : undefined;
    }, 15000, 'summary populated');

    // Pull final counts.
    const pass = Number(await page.getAttribute('[data-testid="summary"]', 'data-pass'));
    const fail = Number(await page.getAttribute('[data-testid="summary"]', 'data-fail'));
    const skip = Number(await page.getAttribute('[data-testid="summary"]', 'data-skip'));
    const total = Number(await page.getAttribute('[data-testid="summary"]', 'data-total'));

    console.log(`[sandbox-e2e] ${pass}/${total} pass, ${fail} fail, ${skip} skip`);

    // Print failed cases in detail.
    if (fail > 0) {
        const failRows = await page.$$('[data-status="fail"]');
        for (const row of failRows) {
            const id = await row.getAttribute('data-testid');
            const text = await row.innerText();
            console.error(`  ✗ ${id}: ${text.replace(/\s+/g, ' ').trim()}`);
        }
    }

    // Print skipped (informational).
    if (skip > 0) {
        const skipRows = await page.$$('[data-status="skip"]');
        for (const row of skipRows) {
            const id = await row.getAttribute('data-testid');
            const text = await row.innerText();
            console.log(`  ⏭ ${id}: ${text.replace(/\s+/g, ' ').trim()}`);
        }
    }

    // Page errors should be zero — sandbox must NEVER break the page.
    if (consoleErrors.length > 0) {
        console.warn(`[sandbox-e2e] console errors:\n${consoleErrors.join('\n')}`);
    }
    assert(pageErrors.length === 0, `pageerror events: ${pageErrors.join(' | ')}`);
    assert(fail === 0, `${fail} test(s) failed`);
    assert(pass > 15, `expected >15 passing cases, got ${pass}`);

    console.log('[sandbox-e2e] ✓ all green');
}

run().then(
    async () => {
        await cleanup();
        process.exit(0);
    },
    async (err) => {
        console.error('[sandbox-e2e] FAIL:', err);
        await cleanup();
        process.exit(1);
    },
);
