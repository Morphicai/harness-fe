/**
 * Real-browser regression test for harness-fe#203: page.click on a trigger
 * that opens a portal-rendered Radix DropdownMenu.
 *
 * This is deliberately NOT a unit test against a hand-rolled listener — it
 * exercises the actual @radix-ui/react-dropdown-menu library in a real
 * Chromium tab, through the real Vite plugin injection + gateway + WebSocket
 * + runtime-client stack, to confirm page.click's event sequence genuinely
 * satisfies Radix's pointerdown-gated open logic (not just our own
 * assumption about it).
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { InProcessCoreClient } from '@harness-fe/core';
import { createGateway, Policy, type GatewayHandle } from '@harness-fe/gateway';
import { harnessFE } from '@harness-fe/vite';
import { COMMAND } from '@harness-fe/protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 8000, label = 'condition'): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const v = probe();
        if (v) return v;
        await sleep(50);
    }
    throw new Error(`waitFor: "${label}" timed out after ${timeoutMs}ms`);
}

function assert(cond: unknown, label: string): asserts cond {
    if (!cond) throw new Error(`ASSERT FAIL: ${label}`);
}

let browser: Browser | undefined;
let page: Page | undefined;
let core: InProcessCoreClient | undefined;
let gw: GatewayHandle | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;

async function cleanup() {
    try {
        await page?.close();
    } catch {
        /* ignore */
    }
    try {
        await browser?.close();
    } catch {
        /* ignore */
    }
    try {
        await vite?.close();
    } catch {
        /* ignore */
    }
    try {
        await gw?.close();
        await core?.stop();
    } catch {
        /* ignore */
    }
}

async function run() {
    core = new InProcessCoreClient({ autoPurge: { enabled: false }, consent: { mode: 'off' } });
    await core.start();
    gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'open' }) });
    const wsPort = await gw.listen(0, '127.0.0.1');
    const bridge = core.bridge;
    console.log(`[radix-dropdown] gateway on ws://127.0.0.1:${wsPort}/ws`);

    vite = await createServer({
        root: projectRoot,
        configFile: false,
        plugins: [
            harnessFE({
                projectId: 'react-demo',
                mcpUrl: `ws://127.0.0.1:${wsPort}/ws`,
            }),
            (await import('@vitejs/plugin-react')).default(),
        ],
        server: { port: 0, host: '127.0.0.1' },
        appType: 'spa',
        logLevel: 'warn',
    });
    await vite.listen();
    const vitePort = vite.config.server.port;
    const url = `http://127.0.0.1:${vitePort}/radix`;
    console.log(`[radix-dropdown] vite serving ${url}`);

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    await sleep(300);
    const tabSession = await waitFor(
        () => bridge!.router.listTabs().find((t) => t.projectId === 'react-demo'),
        8000,
        'runtime-client to register',
    );
    const tabId = tabSession.tabId;
    console.log(`[radix-dropdown] runtime-client connected, tabId=${tabId} ✓`);

    // Sanity: the menu content must NOT be in the DOM before we click —
    // otherwise this test would trivially "pass" without proving anything.
    const beforeClick = await page.locator('[data-morphix-comp="MoreActionsMenu"]').count();
    assert(beforeClick === 0, `menu should be closed before click, found ${beforeClick} element(s)`);
    console.log('[radix-dropdown] menu is closed before click ✓');

    // The actual production code path: gateway → WebSocket → runtime-client
    // → commandHandlers[PAGE_CLICK] → dispatchClickSequence.
    await bridge.sendCommand(
        COMMAND.PAGE_CLICK,
        { selector: { component: 'MoreActionsBtn' } },
        { tabId },
    );

    // Radix mounts the portal content asynchronously (state update + effect),
    // so poll via Playwright's own locator (real DOM, real browser) rather
    // than a single immediate check.
    await page.locator('[data-morphix-comp="MoreActionsMenu"]').waitFor({ state: 'visible', timeout: 3000 });
    console.log('[radix-dropdown] Radix portal menu opened after page.click ✓');

    const menuText = await page.locator('[data-morphix-comp="MoreActionsMenu"]').innerText();
    assert(menuText.includes('Rename') && menuText.includes('Delete'), `menu content unexpected: ${menuText}`);
    console.log('[radix-dropdown] menu content correct (Rename, Delete) ✓');

    // Confirm via the MCP-facing tool too (page.dom_query), not just Playwright's
    // own view of the DOM — this is what an agent driving harness-fe would see.
    const domQuery = (await bridge.sendCommand(
        COMMAND.PAGE_DOM_QUERY,
        { selector: { component: 'RenameItem' }, limit: 1 },
        { tabId },
    )) as { matches: Array<{ html: string }> };
    assert(domQuery.matches.length === 1, `page.dom_query should find RenameItem, got ${JSON.stringify(domQuery)}`);
    console.log('[radix-dropdown] page.dom_query confirms RenameItem is present ✓');

    console.log('\n[radix-dropdown] REAL RADIX DROPDOWN · ALL PASS ✓\n');
}

run()
    .then(async () => {
        await cleanup();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error('[radix-dropdown] FAIL', err);
        await cleanup();
        process.exit(1);
    });
