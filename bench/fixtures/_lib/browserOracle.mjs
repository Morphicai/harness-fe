/**
 * Shared boot/teardown for browser-driven oracle scripts.
 *
 * Oracles run AFTER the agent has finished (see harness-bench-tech-design.md
 * §5) and are deliberately condition-agnostic: they boot their own plain
 * Vite dev server (no harness-fe plugin, no MCP) against the agent's patched
 * checkout and drive it with a fresh Playwright page. This keeps pass/fail
 * judgment independent of whichever condition (A/B/C) produced the patch —
 * an oracle must not care how the fix was produced, only whether the
 * resulting app behaves correctly.
 *
 * Usage in a fixture's oracle.mjs:
 *
 *   import { withApp } from '../../_lib/browserOracle.mjs';
 *   await withApp(process.cwd(), async (page, url) => {
 *       await page.goto(`${url}#/counter`, { waitUntil: 'networkidle' });
 *       ...assertions, throw on failure...
 *   });
 */

import { createServer } from 'vite';
import { chromium } from 'playwright';

export function assert(cond, label) {
    if (!cond) throw new Error(`ORACLE ASSERT FAIL: ${label}`);
}

/**
 * @param {string} appRoot absolute path to the checkout root (package.json's dir)
 * @param {(page: import('playwright').Page, url: string) => Promise<void>} run
 */
export async function withApp(appRoot, run) {
    let vite;
    let browser;
    let page;
    const pageErrors = [];
    try {
        vite = await createServer({
            root: appRoot,
            configFile: false,
            plugins: [(await import('@vitejs/plugin-react')).default()],
            server: { port: 0, host: '127.0.0.1' },
            appType: 'spa',
            logLevel: 'warn',
        });
        await vite.listen();
        const port = vite.config.server.port;
        const url = `http://127.0.0.1:${port}/`;

        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
        page.on('pageerror', (err) => pageErrors.push(err));

        await run(page, url);
    } finally {
        try { await page?.close(); } catch { /* ignore */ }
        try { await browser?.close(); } catch { /* ignore */ }
        try { await vite?.close(); } catch { /* ignore */ }
    }
    return { pageErrors };
}
