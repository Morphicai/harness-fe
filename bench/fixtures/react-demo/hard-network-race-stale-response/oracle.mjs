/**
 * FAIL_TO_PASS: firing "Fetch slow" then immediately "Fetch JSON" ends up
 * displaying the JSON result (the most recently *clicked* request), even
 * though the slow request's response arrives later in wall-clock time.
 * PASS_TO_PASS: a single "Fetch JSON" or "Fetch 404" click on its own still
 * displays correctly — catches a degenerate "fix" that breaks the normal
 * single-request path while chasing the race (e.g. permanently locking the
 * panel to the first request ever made). See metadata.json's pass_to_pass
 * and harness-bench-tech-design.md §1.1 for why this half exists.
 *
 * All endpoints are intercepted with deterministic, short delays (rather
 * than hitting the real jsonplaceholder.typicode.com/httpbin.org) so the
 * oracle is fast and doesn't depend on external network access.
 */
import { withApp, assert } from '../../_lib/browserOracle.mjs';

const appRoot = process.argv[2];
if (!appRoot) {
    console.error('usage: node oracle.mjs <checkout-root>');
    process.exit(1);
}

function mockRoutes(page) {
    return Promise.all([
        page.route('https://httpbin.org/delay/2', async (route) => {
            await new Promise((r) => setTimeout(r, 800)); // "slow" — resolves LAST
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slow: true }) });
        }),
        page.route('https://jsonplaceholder.typicode.com/todos/1', async (route) => {
            await new Promise((r) => setTimeout(r, 50)); // "json" — resolves FIRST, but was clicked SECOND
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, title: 'json' }) });
        }),
        page.route('https://jsonplaceholder.typicode.com/nonexistent', async (route) => {
            await new Promise((r) => setTimeout(r, 50));
            await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
        }),
    ]);
}

// --- FAIL_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await mockRoutes(page);
    await page.goto(`${url}network`, { waitUntil: 'networkidle' });

    await page.click('[aria-label="Fetch slow"]');
    await page.click('[aria-label="Fetch JSON"]');

    // Wait past both the fast (50ms) and slow (800ms) responses.
    await page.waitForTimeout(1200);

    const displayedUrl = await page.locator('[data-morphix-comp="FetchUrl"]').textContent();
    assert(
        displayedUrl?.includes('jsonplaceholder.typicode.com/todos'),
        `FAIL_TO_PASS: expected the panel to still show the JSON fetch (last clicked) after the slow fetch resolves, got URL: "${displayedUrl}"`,
    );
});
console.log('[oracle] fail_to_pass: last-clicked request wins the race ✓');

// --- PASS_TO_PASS ---
await withApp(appRoot, async (page, url) => {
    await mockRoutes(page);
    await page.goto(`${url}network`, { waitUntil: 'networkidle' });

    await page.click('[aria-label="Fetch JSON"]');
    await page.waitForTimeout(300);
    const jsonStatus = await page.locator('[data-morphix-comp="FetchStatus"]').textContent();
    assert(jsonStatus?.trim() === '200', `PASS_TO_PASS: a lone JSON fetch should still show status 200, got "${jsonStatus}"`);
});

await withApp(appRoot, async (page, url) => {
    await mockRoutes(page);
    await page.goto(`${url}network`, { waitUntil: 'networkidle' });

    await page.click('[aria-label="Fetch 404"]');
    await page.waitForTimeout(300);
    const status404 = await page.locator('[data-morphix-comp="FetchStatus"]').textContent();
    assert(status404?.trim() === '404', `PASS_TO_PASS: a lone 404 fetch should still show status 404, got "${status404}"`);
});
console.log('[oracle] pass_to_pass: single-request fetches unaffected ✓');

console.log('[oracle] hard-network-race-stale-response: PASS');
