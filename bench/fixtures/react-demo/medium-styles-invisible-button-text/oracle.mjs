/**
 * FAIL_TO_PASS: the "Colored Button" on the Styles page has a text color
 * that differs from its own background color (i.e. the label is actually
 * readable, not painted the same color as the button itself).
 * PASS_TO_PASS: the button's background is untouched, and sibling text
 * elements in the same card keep their original colors — catches a
 * degenerate "fix" that recolors the whole card instead of just the label.
 * See metadata.json's pass_to_pass and harness-bench-tech-design.md §1.1 for
 * why this half exists.
 */
import { withApp, assert } from '../../_lib/browserOracle.mjs';

const appRoot = process.argv[2];
if (!appRoot) {
    console.error('usage: node oracle.mjs <checkout-root>');
    process.exit(1);
}

async function computedColors(page, selector) {
    return page.locator(selector).evaluate((el) => {
        const s = getComputedStyle(el);
        return { color: s.color, backgroundColor: s.backgroundColor };
    });
}

// --- FAIL_TO_PASS ---
const { pageErrors } = await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}styles`, { waitUntil: 'networkidle' });
    const { color, backgroundColor } = await computedColors(page, '[data-morphix-comp="StyleTargetBtn"]');
    assert(
        color !== backgroundColor,
        `FAIL_TO_PASS: expected button text color to differ from its background, both were "${color}"`,
    );
});
assert(pageErrors.length === 0, `FAIL_TO_PASS: expected no uncaught page errors, got: ${pageErrors.map((e) => e.message).join(' | ')}`);
console.log('[oracle] fail_to_pass: button label text is visible again ✓');

// --- PASS_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}styles`, { waitUntil: 'networkidle' });

    const { backgroundColor } = await computedColors(page, '[data-morphix-comp="StyleTargetBtn"]');
    assert(
        backgroundColor === 'rgb(233, 69, 96)',
        `PASS_TO_PASS: button background should stay #e94560 / rgb(233, 69, 96), got "${backgroundColor}"`,
    );

    const titleColor = await page.locator('[data-morphix-comp="StyleTargetTitle"]').evaluate((el) => getComputedStyle(el).color);
    assert(titleColor === 'rgb(255, 255, 255)', `PASS_TO_PASS: card title should stay white, got "${titleColor}"`);

    const descColor = await page.locator('[data-morphix-comp="StyleTargetDesc"]').evaluate((el) => getComputedStyle(el).color);
    assert(descColor === 'rgb(204, 204, 204)', `PASS_TO_PASS: card description should stay #ccc, got "${descColor}"`);
});
console.log('[oracle] pass_to_pass: card background/title/description unaffected ✓');

console.log('[oracle] medium-styles-invisible-button-text: PASS');
