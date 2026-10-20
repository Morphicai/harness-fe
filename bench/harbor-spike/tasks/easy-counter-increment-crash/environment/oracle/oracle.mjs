/**
 * Spike oracle：fixtures/react-demo/easy-counter-increment-crash/oracle.mjs 与
 * fixtures/_lib/browserOracle.mjs 的合并单文件版（ESM 需要从脚本所在目录解析
 * node_modules，故打进 /opt/oracle）。断言与原版一致：
 * FAIL_TO_PASS 点 + Increment 不报错且计数为 1；
 * PASS_TO_PASS  decrement / reset 仍正常（防"禁用按钮"式退化解）。
 * 与原版唯一的行为差异：chromium 显式 --no-sandbox（容器内 root 运行）。
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

function assert(cond, label) {
    if (!cond) throw new Error(`ORACLE ASSERT FAIL: ${label}`);
}

async function withApp(appRoot, run) {
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

        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
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

const appRoot = process.argv[2];
if (!appRoot) {
    console.error('usage: node oracle.mjs <checkout-root>');
    process.exit(1);
}

// --- FAIL_TO_PASS ---
const { pageErrors } = await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}counter`, { waitUntil: 'networkidle' });
    await page.click('[aria-label="increment counter"]');
    await page.waitForTimeout(200);
    const text = await page.locator('[data-morphix-comp="CounterValue"]').textContent();
    assert(text?.trim() === '1', `FAIL_TO_PASS: expected counter to read "1" after one increment, got: "${text}"`);
});
assert(pageErrors.length === 0, `FAIL_TO_PASS: expected no uncaught page errors, got: ${pageErrors.map((e) => e.message).join(' | ')}`);
console.log('[oracle] fail_to_pass: increment no longer crashes ✓');

// --- PASS_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}counter`, { waitUntil: 'networkidle' });
    await page.click('[aria-label="increment counter"]');
    await page.click('[aria-label="decrement counter"]');
    await page.waitForTimeout(200);
    const afterDecrement = await page.locator('[data-morphix-comp="CounterValue"]').textContent();
    assert(afterDecrement?.trim() === '0', `PASS_TO_PASS: decrement should still work, got "${afterDecrement}" after +1/-1`);

    await page.click('[aria-label="increment counter"]');
    await page.click('[aria-label="reset counter"]');
    await page.waitForTimeout(200);
    const afterReset = await page.locator('[data-morphix-comp="CounterValue"]').textContent();
    assert(afterReset?.trim() === '0', `PASS_TO_PASS: reset should still work, got "${afterReset}"`);
});
console.log('[oracle] pass_to_pass: decrement/reset unaffected ✓');

console.log('[oracle] easy-counter-increment-crash: PASS');
