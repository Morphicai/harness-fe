/**
 * FAIL_TO_PASS: Increment then Decrement nets back to "0" (decrement
 * genuinely decreases the count instead of also increasing it).
 * PASS_TO_PASS: Increment and Reset still work — catches a degenerate "fix"
 * that makes both buttons no-ops instead of actually correcting Decrement's
 * sign. See metadata.json's pass_to_pass and harness-bench-tech-design.md
 * §1.1 for why this half exists.
 */
import { withApp, assert } from '../../_lib/browserOracle.mjs';

const appRoot = process.argv[2];
if (!appRoot) {
    console.error('usage: node oracle.mjs <checkout-root>');
    process.exit(1);
}

// --- FAIL_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}counter`, { waitUntil: 'networkidle' });
    await page.click('[aria-label="increment counter"]');
    await page.click('[aria-label="decrement counter"]');
    await page.waitForTimeout(200);
    const text = await page.locator('[data-morphix-comp="CounterValue"]').textContent();
    assert(text?.trim() === '0', `FAIL_TO_PASS: expected counter to read "0" after increment+decrement, got: "${text}"`);
});
console.log('[oracle] fail_to_pass: decrement genuinely decreases ✓');

// --- PASS_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}counter`, { waitUntil: 'networkidle' });
    await page.click('[aria-label="increment counter"]');
    await page.click('[aria-label="increment counter"]');
    await page.waitForTimeout(200);
    const afterIncrement = await page.locator('[data-morphix-comp="CounterValue"]').textContent();
    assert(afterIncrement?.trim() === '2', `PASS_TO_PASS: increment should still increase, got "${afterIncrement}" after two increments`);

    await page.click('[aria-label="reset counter"]');
    await page.waitForTimeout(200);
    const afterReset = await page.locator('[data-morphix-comp="CounterValue"]').textContent();
    assert(afterReset?.trim() === '0', `PASS_TO_PASS: reset should still work, got "${afterReset}"`);
});
console.log('[oracle] pass_to_pass: increment/reset unaffected ✓');

console.log('[oracle] medium-counter-decrement-silent: PASS');
