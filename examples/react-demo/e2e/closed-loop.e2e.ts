/**
 * Real-browser closed-loop e2e:
 *
 *   MCP bridge ←──ws──→  Chromium (Playwright) running the dev page
 *        │                       │
 *        │ sendCommand           │ runtime-client executes
 *        ▼                       ▼
 *   page.click({comp})        DOM mutates
 *        │                       │
 *        │ ◄─── ResponseFrame ───┘
 *        ▼
 *   page.dom_query(...)  → returns the new HTML → assert
 *
 * Proves the entire stack: Vite plugin injection, runtime-client connection,
 * MCP-driven command dispatch, source-aware selector, captured console events.
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
    core = new InProcessCoreClient({ autoPurge: { enabled: false } });
    await core.start();
    gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'open' }) });
    const wsPort = await gw.listen(0, '127.0.0.1');
    const bridge = core.bridge;
    console.log(`[closed-loop] gateway on ws://127.0.0.1:${wsPort}/ws`);

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
    const url = `http://127.0.0.1:${vitePort}/`;
    console.log(`[closed-loop] vite serving ${url}`);

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    // 1) The injection actually fired in the real browser. Wait briefly for
    // HMR's hot-reload acquisition to settle so the page context is stable
    // before evaluating.
    await sleep(300);
    const hasMarker = await page.evaluate(
        () => Boolean((window as unknown as { __HARNESS_FE__?: unknown }).__HARNESS_FE__),
    );
    assert(hasMarker, 'window.__HARNESS_FE__ is present');
    console.log('[closed-loop] injection marker present in real browser ✓');

    // 2) The runtime-client connected to the bridge
    const tabSession = await waitFor(
        () => bridge!.router.listTabs().find((t) => t.projectId === 'react-demo'),
        8000,
        'runtime-client to register',
    );
    const tabId = tabSession.tabId;
    console.log(`[closed-loop] runtime-client connected, tabId=${tabId} ✓`);

    // 3) page.click via MCP — component-level selector goes through compile-time data attr
    await bridge.sendCommand(
        COMMAND.PAGE_CLICK,
        { selector: { component: 'IncrementBtn' } },
        { tabId },
    );
    await bridge.sendCommand(
        COMMAND.PAGE_CLICK,
        { selector: { component: 'IncrementBtn' } },
        { tabId },
    );
    await bridge.sendCommand(
        COMMAND.PAGE_CLICK,
        { selector: { component: 'IncrementBtn' } },
        { tabId },
    );

    // 4) page.dom_query to verify counter mutated to 3
    const counterQuery = (await bridge.sendCommand(
        COMMAND.PAGE_DOM_QUERY,
        { selector: { component: 'CounterValue' }, limit: 1 },
        { tabId },
    )) as { matches: Array<{ html: string; via: string }> };
    assert(counterQuery.matches.length === 1, 'counter dom_query returned 1 match');
    const html = counterQuery.matches[0].html;
    assert(html.includes('>3<'), `counter value should be 3, got HTML: ${html}`);
    console.log(`[closed-loop] click×3 → counter=3 (via ${counterQuery.matches[0].via}) ✓`);

    // 5) page.type into echo input
    await bridge.sendCommand(
        COMMAND.PAGE_TYPE,
        { selector: { component: 'EchoInput' }, value: 'hello-morphix' },
        { tabId },
    );
    await sleep(50);
    const echoQuery = (await bridge.sendCommand(
        COMMAND.PAGE_DOM_QUERY,
        { selector: { component: 'EchoDisplay' }, limit: 1 },
        { tabId },
    )) as { matches: Array<{ html: string }> };
    assert(echoQuery.matches[0]?.html.includes('hello-morphix'), `echo display should contain typed value, got: ${echoQuery.matches[0]?.html}`);
    console.log('[closed-loop] page.type → echo display updated ✓');

    // 6) page.evaluate runs in page context
    const evalResult = (await bridge.sendCommand(
        COMMAND.PAGE_EVALUATE,
        { expr: 'document.title' },
        { tabId },
    )) as { value: unknown };
    assert(evalResult.value === 'morphix-dev-bridge · react-demo', `evaluate returned ${JSON.stringify(evalResult)}`);
    console.log(`[closed-loop] page.evaluate("document.title") → "${evalResult.value}" ✓`);

    // 7) console.tail picks up our increment console.log
    const consoleTail = (await bridge.sendCommand(
        COMMAND.CONSOLE_TAIL,
        { n: 20 },
        { tabId },
    )) as { entries: Array<{ level: string; args: unknown[] }> };
    const hasIncrement = consoleTail.entries.some(
        (e) => Array.isArray(e.args) && e.args.some((a) => typeof a === 'string' && a.includes('incremented')),
    );
    assert(hasIncrement, `console.tail should have captured the demo's "incremented" log, got: ${JSON.stringify(consoleTail.entries.map((e) => e.args))}`);
    console.log(`[closed-loop] console.tail captured ${consoleTail.entries.length} entries (incl. demo logs) ✓`);

    // 8) source-aware: project.where_is for the App component (AST-discovered).
    // Note: data-morphix-comp="IncrementBtn" on <button> is a manual attribute
    // for selector matching; the AST scan only registers PascalCase
    // function/class/var names as components.
    const whereIs = (await bridge.sendCommand(
        COMMAND.PROJECT_WHERE_IS,
        { component: 'App' },
        { target: 'vite-plugin', projectId: 'react-demo' },
    )) as { component: string; locations: Array<{ file: string; line: number }> };
    assert(whereIs.locations[0]?.file === 'src/App.tsx', `App should be in src/App.tsx, got ${whereIs.locations[0]?.file}`);
    console.log(`[closed-loop] project.where_is App → ${whereIs.locations[0].file}:${whereIs.locations[0].line} ✓`);

    // 9) page.evaluate again to assert reset works (just to round out the test)
    await bridge.sendCommand(
        COMMAND.PAGE_CLICK,
        { selector: { component: 'ResetBtn' } },
        { tabId },
    );
    const afterReset = (await bridge.sendCommand(
        COMMAND.PAGE_DOM_QUERY,
        { selector: { component: 'CounterValue' }, limit: 1 },
        { tabId },
    )) as { matches: Array<{ html: string }> };
    assert(afterReset.matches[0]?.html.includes('>0<'), `after reset counter should be 0, got ${afterReset.matches[0]?.html}`);
    console.log('[closed-loop] reset button → counter=0 ✓');

    console.log('\n[closed-loop] REAL-BROWSER CLOSED LOOP · ALL PASS ✓\n');
}

run()
    .then(async () => {
        await cleanup();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error('[closed-loop] FAIL', err);
        await cleanup();
        process.exit(1);
    });
