/**
 * Real-browser e2e for the SSE frame window (harness-fe#204 + follow-up).
 *
 * A local endpoint streams 300 `token` frames wrapped in the sparse lifecycle
 * frames an agent actually cares about (`stream_start` … `stream_end`) — the
 * exact shape that used to be unreadable: frames shared the 200-slot network
 * ring, so by the time the run finished both ends had been evicted, and they
 * had evicted the req/res entries with them.
 *
 * Asserts, through the real MCP bridge against a real Chromium page:
 *   - both lifecycle frames survive a 300-frame stream
 *   - the req/res entries survive it too
 *   - `phase: 'frame'` + `filter` finds a needle regardless of how much came
 *     after it, and `matched` reports the true total
 *   - `network.get` returns the whole stream for one request id
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer as createHttpServer, type Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { InProcessCoreClient } from '@harness-fe/core';
import { createGateway, Policy, type GatewayHandle } from '@harness-fe/gateway';
import { harnessFE } from '@harness-fe/vite';
import { COMMAND } from '@harness-fe/protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const TOKEN_FRAMES = 300;

interface NetEntry {
    id?: string;
    phase?: string;
    url: string;
    status?: number;
    sseEvent?: string;
    sseData?: string;
}

function assert(cond: unknown, label: string): asserts cond {
    if (!cond) throw new Error(`ASSERT FAIL: ${label}`);
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 8000, label = 'condition'): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const v = probe();
        if (v) return v;
        await sleep(50);
    }
    throw new Error(`waitFor: "${label}" timed out after ${timeoutMs}ms`);
}

let browser: Browser | undefined;
let page: Page | undefined;
let core: InProcessCoreClient | undefined;
let gw: GatewayHandle | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let sseServer: Server | undefined;

async function cleanup() {
    try { await page?.close(); } catch { /* ignore */ }
    try { await browser?.close(); } catch { /* ignore */ }
    try { await vite?.close(); } catch { /* ignore */ }
    try { sseServer?.close(); } catch { /* ignore */ }
    try {
        await gw?.close();
        await core?.stop();
    } catch { /* ignore */ }
}

/** Minimal SSE endpoint: stream_start → N token frames → stream_end. */
async function startSseServer(): Promise<string> {
    sseServer = createHttpServer((req, res) => {
        res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'access-control-allow-origin': '*',
        });
        res.write('event: stream_start\ndata: {"runId":"r-1"}\n\n');
        for (let i = 0; i < TOKEN_FRAMES; i++) {
            res.write(`event: token\ndata: {"i":${i}}\n\n`);
        }
        res.write('event: stream_end\ndata: {"runId":"r-1","ok":true}\n\n');
        res.end();
    });
    await new Promise<void>((r) => sseServer!.listen(0, '127.0.0.1', r));
    const addr = sseServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return `http://127.0.0.1:${port}/stream`;
}

async function run() {
    core = new InProcessCoreClient({ autoPurge: { enabled: false } });
    await core.start();
    gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'open' }) });
    const wsPort = await gw.listen(0, '127.0.0.1');
    const bridge = core.bridge;

    const sseUrl = await startSseServer();
    console.log(`[sse-frames] SSE endpoint at ${sseUrl}`);

    vite = await createServer({
        root: projectRoot,
        configFile: false,
        plugins: [
            harnessFE({ projectId: 'react-demo', mcpUrl: `ws://127.0.0.1:${wsPort}/ws` }),
            (await import('@vitejs/plugin-react')).default(),
        ],
        server: { port: 0, host: '127.0.0.1' },
        appType: 'spa',
        logLevel: 'warn',
    });
    await vite.listen();
    const url = `http://127.0.0.1:${vite.config.server.port}/`;

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    const tabSession = await waitFor(
        () => bridge.router.listTabs().find((t) => t.projectId === 'react-demo'),
        8000,
        'runtime-client to register',
    );
    const tabId = tabSession.tabId;
    console.log(`[sse-frames] runtime-client connected, tabId=${tabId} ✓`);

    // Consume the stream from the page, exactly like an app would.
    await page.evaluate(async (streamUrl) => {
        const res = await fetch(streamUrl);
        const reader = res.body!.getReader();
        for (;;) {
            const { done } = await reader.read();
            if (done) break;
        }
    }, sseUrl);
    await sleep(300);

    // 1) Both lifecycle frames survive a 300-frame stream.
    const lifecycle = (await bridge.sendCommand(
        COMMAND.NETWORK_TAIL,
        { n: 50, phase: 'frame', filter: 'stream_' },
        { tabId },
    )) as { entries: NetEntry[]; matched: number };
    const events = lifecycle.entries.map((e) => e.sseEvent);
    assert(events.includes('stream_start'), `stream_start should survive, got ${JSON.stringify(events)}`);
    assert(events.includes('stream_end'), `stream_end should survive, got ${JSON.stringify(events)}`);
    console.log(`[sse-frames] lifecycle frames survive ${TOKEN_FRAMES} token frames ✓`);

    // 2) A needle deep in the stream is findable, and `matched` is the truth.
    const needle = (await bridge.sendCommand(
        COMMAND.NETWORK_TAIL,
        // NB: the haystack is JSON.stringify()'d, so quotes inside sseData are
        // escaped — match on an unquoted fragment.
        { n: 5, phase: 'frame', filter: ':7}' },
        { tabId },
    )) as { entries: NetEntry[]; matched: number };
    assert(needle.matched >= 1, `should find the i=7 frame, matched=${needle.matched}`);
    console.log(`[sse-frames] filter finds a frame buried ${TOKEN_FRAMES - 7} frames deep ✓`);

    const allFrames = (await bridge.sendCommand(
        COMMAND.NETWORK_TAIL,
        { n: 1, phase: 'frame' },
        { tabId },
    )) as { matched: number };
    assert(
        allFrames.matched >= TOKEN_FRAMES + 2,
        `every frame should be retained, matched=${allFrames.matched} (expected >= ${TOKEN_FRAMES + 2})`,
    );
    console.log(`[sse-frames] matched=${allFrames.matched} frames retained ✓`);

    // 3) The stream did not evict the req/res entries.
    const reqres = (await bridge.sendCommand(
        COMMAND.NETWORK_TAIL,
        { n: 50, phase: 'res', urlContains: '/stream' },
        { tabId },
    )) as { entries: NetEntry[] };
    assert(reqres.entries.length >= 1, 'the SSE response entry should still be in the buffer');
    const reqId = reqres.entries[0]!.id!;
    console.log(`[sse-frames] req/res entries survive the stream (id=${reqId}) ✓`);

    // 4) network.get returns the whole stream for that id.
    const full = (await bridge.sendCommand(
        COMMAND.NETWORK_GET,
        { reqId },
        { tabId },
    )) as { entries: NetEntry[]; total: number };
    const frameCount = full.entries.filter((e) => e.phase === 'frame').length;
    assert(
        frameCount >= TOKEN_FRAMES + 2,
        `network.get should return the whole stream, got ${frameCount} frames`,
    );
    console.log(`[sse-frames] network.get returned ${full.total} entries for one request ✓`);

    // 5) …and maxFrames caps it without losing req/res or the true count.
    const capped = (await bridge.sendCommand(
        COMMAND.NETWORK_GET,
        { reqId, maxFrames: 10 },
        { tabId },
    )) as { entries: NetEntry[]; total: number; truncated?: boolean };
    assert(capped.truncated === true, 'maxFrames should flag truncation');
    assert(capped.entries.filter((e) => e.phase === 'frame').length === 10, 'maxFrames should keep exactly 10 frames');
    assert(capped.total === full.total, 'total should report the full count regardless of maxFrames');
    console.log('[sse-frames] maxFrames caps the payload and says so ✓');

    console.log('\n[sse-frames] SSE FRAME WINDOW · ALL PASS ✓\n');
}

run()
    .then(async () => {
        await cleanup();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error('[sse-frames] FAIL', err);
        await cleanup();
        process.exit(1);
    });
