/**
 * FAIL_TO_PASS: the "id=style-target" code text next to the TARGET badge is
 * vertically centered within their shared row, not sunk toward the bottom.
 * This is a pure geometry assertion (`boundingBox()`), not something
 * decidable from a source read: both `alignItems: 'flex-end'` and
 * `padding: '14px 20px'` are individually plausible, valid-looking CSS
 * values — the row only visibly misaligns because of how those two values
 * interact (the enlarged badge creates cross-axis slack that flex-end then
 * pushes the code text away from). A model that "fixes" only one of the two
 * (e.g. shrinks the padding back without touching alignItems, or vice
 * versa) may or may not pass depending on whether slack remains — either
 * real fix is acceptable, this oracle only cares about the rendered
 * result. See metadata.json's pass_to_pass and harness-bench-tech-design.md
 * §1.1 for why the anti-regression half exists.
 */
import { withApp, assert } from '../../_lib/browserOracle.mjs';

const appRoot = process.argv[2];
if (!appRoot) {
    console.error('usage: node oracle.mjs <checkout-root>');
    process.exit(1);
}

// Empirically: HEAD (correctly aligned) measures ~0px offset; the injected
// bug measures ~13px. A few px of tolerance for sub-pixel rendering.
const TOLERANCE_PX = 5;

async function verticalOffset(page) {
    const row = page.locator('span', { hasText: 'TARGET' }).first().locator('xpath=..');
    const codeEl = row.locator('code');
    const rowBox = await row.boundingBox();
    const codeBox = await codeEl.boundingBox();
    assert(rowBox && codeBox, 'could not measure bounding boxes for badge row/code text');
    const rowCenterY = rowBox.y + rowBox.height / 2;
    const codeCenterY = codeBox.y + codeBox.height / 2;
    return Math.abs(rowCenterY - codeCenterY);
}

// --- FAIL_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}styles`, { waitUntil: 'networkidle' });
    const offset = await verticalOffset(page);
    assert(
        offset <= TOLERANCE_PX,
        `FAIL_TO_PASS: expected the id="style-target" code text to be vertically centered in its row (offset <= ${TOLERANCE_PX}px), got offset=${offset.toFixed(1)}px`,
    );
});
console.log('[oracle] fail_to_pass: badge row is vertically centered ✓');

// --- PASS_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await page.goto(`${url}styles`, { waitUntil: 'networkidle' });

    // The badge must still render its label — catches a degenerate "fix"
    // that hides/removes the badge instead of correcting alignment.
    const badge = page.locator('span', { hasText: 'TARGET' }).first();
    await badge.waitFor({ state: 'visible' });
    const badgeText = (await badge.textContent())?.trim();
    assert(badgeText === 'TARGET', `PASS_TO_PASS: expected badge to still read "TARGET", got "${badgeText}"`);

    // Second badge row (html-target) is untouched by this bug/fix — catches
    // a degenerate "fix" that changes shared/global styles instead of this
    // one row.
    const secondRow = page.locator('span', { hasText: 'TARGET' }).nth(1).locator('xpath=..');
    const secondCode = secondRow.locator('code');
    const secondRowBox = await secondRow.boundingBox();
    const secondCodeBox = await secondCode.boundingBox();
    const secondOffset = Math.abs((secondRowBox.y + secondRowBox.height / 2) - (secondCodeBox.y + secondCodeBox.height / 2));
    assert(secondOffset <= TOLERANCE_PX, `PASS_TO_PASS: the html-target badge row should stay correctly aligned, got offset=${secondOffset.toFixed(1)}px`);
});
console.log('[oracle] pass_to_pass: badge still renders and the other row is unaffected ✓');

console.log('[oracle] medium-styles-badge-vertical-misalign: PASS');
