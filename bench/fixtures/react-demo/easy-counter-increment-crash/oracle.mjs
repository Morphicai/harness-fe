/**
 * FAIL_TO_PASS: clicking "+ Increment" on the Counter page does NOT throw,
 * and the counter reads "1" afterwards.
 * PASS_TO_PASS: Decrement and Reset still work — catches a degenerate "fix"
 * that just disables Increment (or the whole component) instead of actually
 * fixing the crash. See metadata.json's pass_to_pass and
 * harness-bench-tech-design.md §1.1 for why this half exists.
 */
import { withApp, assert } from '../../_lib/browserOracle.mjs';

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
