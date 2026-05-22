/**
 * Same-origin iframe identity inheritance — real-browser end-to-end.
 *
 * Spawns two vite dev servers (parent on :5180, child on :5181, with parent
 * reverse-proxying /child/ → :5181 for same-origin) and a Bridge in-process,
 * loads the parent page in headless Chromium, and asserts:
 *
 *   1. Both runtimes registered themselves (parent + iframe child)
 *   2. Their tabId / sessionId are EQUAL (inheritance worked)
 *   3. Parent's runtime sees parentProjectId === undefined
 *      Child's runtime sees parentProjectId === "iframe-parent"
 *   4. MCP `project.tree()` returns iframe-parent ▸ iframe-child
 *   5. The bridge received HelloFrames for both projects under the same
 *      tabId, and recorded both buildIds (parent + child build artifacts).
 *
 * This is the canonical proof that micro-frontend correlation works.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium, type Frame } from 'playwright';
import { Bridge } from '@harness-fe/mcp-server';
import { JsonlStore } from '@harness-fe/mcp-server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let parentVite: ChildProcessWithoutNullStreams | undefined;
let childVite: ChildProcessWithoutNullStreams | undefined;
let bridge: Bridge | undefined;
let dataDir: string | undefined;

async function shutdown(code: number): Promise<never> {
    try {
        await bridge?.stop();
    } catch {
        /* ignore */
    }
    for (const proc of [parentVite, childVite]) {
        if (!proc) continue;
        proc.kill('SIGTERM');
        await sleep(200);
        if (!proc.killed) proc.kill('SIGKILL');
    }
    if (dataDir) {
        try {
            rmSync(dataDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
    process.exit(code);
}

function spawnVite(configRel: string): ChildProcessWithoutNullStreams {
    const proc = spawn('pnpm', ['exec', 'vite', '--config', configRel], {
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: '0', HARNESS_FE_URL: bridgeUrl() },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    return proc;
}

let _bridgePort = 0;
function bridgeUrl(): string {
    return `ws://127.0.0.1:${_bridgePort}`;
}

async function waitForLog(
    proc: ChildProcessWithoutNullStreams,
    match: RegExp,
    timeoutMs = 30_000,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`timeout waiting for ${match}`)),
            timeoutMs,
        );
        const onData = (d: Buffer): void => {
            if (match.test(String(d))) {
                clearTimeout(timer);
                resolve();
            }
        };
        // Vite logs "ready in …" to stdout but the URL line sometimes lands on
        // stderr depending on TTY detection. Watch both.
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
    });
}

async function waitForHttp(url: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(url);
            if (r.ok || r.status === 404) return;
        } catch {
            /* server not up yet */
        }
        await sleep(200);
    }
    throw new Error(`timeout waiting for ${url}`);
}

async function readClientGlobals(frame: Frame): Promise<{
    tabId?: string;
    sessionId?: string;
    parentProjectId?: string;
    projectId?: string;
}> {
    return frame.evaluate(() => {
        const w = window as unknown as {
            __harness_fe_client__?: { tabId?: string; sessionId?: string; parentProjectId?: string };
            __HARNESS_FE__?: { projectId?: string };
        };
        return {
            tabId: w.__harness_fe_client__?.tabId,
            sessionId: w.__harness_fe_client__?.sessionId,
            parentProjectId: w.__harness_fe_client__?.parentProjectId,
            projectId: w.__HARNESS_FE__?.projectId,
        };
    });
}

async function main(): Promise<void> {
    // ── 1. Spin up an in-process bridge with a temp dataDir ─────────────
    dataDir = mkdtempSync(resolve(tmpdir(), 'iframe-demo-'));
    const store = new JsonlStore(dataDir);
    bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
    await bridge.start();
    _bridgePort = bridge.getBoundPort()!;
    console.log(`--- bridge on ws://127.0.0.1:${_bridgePort} ---`);

    // ── 2. Spin up child vite first (parent proxies to it) ──────────────
    console.log('--- starting child vite on :5181 ---');
    childVite = spawnVite('child/vite.config.ts');
    await waitForHttp('http://localhost:5181/');
    console.log('--- starting parent vite on :5180 ---');
    parentVite = spawnVite('parent/vite.config.ts');
    await waitForHttp('http://localhost:5180/');

    // ── 3. Load the parent in headless Chromium ─────────────────────────
    console.log('--- launching headless chromium ---');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleMsgs: string[] = [];
    page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleMsgs.push(`[page-error] ${e.message}`));

    await page.goto('http://localhost:5180/', { waitUntil: 'networkidle' });
    await sleep(1500); // let both runtimes finish their hello handshakes

    // ── 4. Inspect parent + iframe globals ──────────────────────────────
    const parentGlobals = await readClientGlobals(page.mainFrame());
    const childFrame = page.mainFrame().childFrames().find((f) => f.url().includes('/child/'));
    if (!childFrame) {
        console.error('FAIL: child iframe not found');
        await browser.close();
        await shutdown(1);
    }
    const childGlobals = await readClientGlobals(childFrame!);

    console.log('parent:', parentGlobals);
    console.log('child :', childGlobals);

    // ── 5. Assert identity inheritance ──────────────────────────────────
    if (!parentGlobals.tabId || !parentGlobals.sessionId) {
        console.error('FAIL: parent runtime did not register on window');
        console.error(consoleMsgs.join('\n'));
        await browser.close();
        await shutdown(1);
    }
    if (childGlobals.tabId !== parentGlobals.tabId) {
        console.error(
            `FAIL: child tabId !== parent tabId (parent=${parentGlobals.tabId}, child=${childGlobals.tabId})`,
        );
        await browser.close();
        await shutdown(1);
    }
    if (childGlobals.sessionId !== parentGlobals.sessionId) {
        console.error(
            `FAIL: child sessionId !== parent sessionId (parent=${parentGlobals.sessionId}, child=${childGlobals.sessionId})`,
        );
        await browser.close();
        await shutdown(1);
    }
    if (childGlobals.projectId !== 'iframe-child' || parentGlobals.projectId !== 'iframe-parent') {
        console.error(
            `FAIL: projectId mismatch (parent=${parentGlobals.projectId}, child=${childGlobals.projectId})`,
        );
        await browser.close();
        await shutdown(1);
    }
    if (childGlobals.parentProjectId !== 'iframe-parent') {
        console.error(
            `FAIL: child runtime did not record parentProjectId="iframe-parent" (got ${childGlobals.parentProjectId})`,
        );
        await browser.close();
        await shutdown(1);
    }
    console.log('✓ tabId / sessionId / projectId / parentProjectId all consistent');

    // ── 6. Assert project tree was built on the daemon side ─────────────
    const projects = store.listProjects();
    const projectIds = new Set(projects.map((p) => p.id));
    if (!projectIds.has('iframe-parent') || !projectIds.has('iframe-child')) {
        console.error(
            `FAIL: bridge didn't persist both projects (got ${[...projectIds].join(',')})`,
        );
        await browser.close();
        await shutdown(1);
    }
    const childMeta = store.getProject('iframe-child');
    if (childMeta?.parentProjectId !== 'iframe-parent') {
        console.error(
            `FAIL: store.getProject('iframe-child').parentProjectId !== 'iframe-parent' (got ${childMeta?.parentProjectId})`,
        );
        await browser.close();
        await shutdown(1);
    }
    console.log('✓ store sees both projects with correct parent link');

    const tree = store.getProjectTree('iframe-parent');
    if (tree.length !== 1 || tree[0]?.id !== 'iframe-parent') {
        console.error(`FAIL: tree root mismatch: ${JSON.stringify(tree)}`);
        await browser.close();
        await shutdown(1);
    }
    const childInTree = tree[0]?.children.find((c) => c.id === 'iframe-child');
    if (!childInTree) {
        console.error(
            `FAIL: iframe-child not in tree under iframe-parent: ${JSON.stringify(tree)}`,
        );
        await browser.close();
        await shutdown(1);
    }
    console.log('✓ project.tree returns iframe-parent → iframe-child');

    // ── 7. Assert build metadata recorded for both projects ─────────────
    const parentBuilds = store.listBuilds('iframe-parent');
    const childBuilds = store.listBuilds('iframe-child');
    if (parentBuilds.length === 0 || childBuilds.length === 0) {
        console.error(
            `FAIL: missing build metadata (parent=${parentBuilds.length}, child=${childBuilds.length})`,
        );
        await browser.close();
        await shutdown(1);
    }
    console.log(
        `✓ build metadata recorded — parent buildId=${parentBuilds[0]?.id}, child buildId=${childBuilds[0]?.id}`,
    );

    console.log('iframe.e2e ALL PASS ✓');
    await browser.close();
    await shutdown(0);
}

main().catch(async (err) => {
    console.error('iframe.e2e FAILED with exception:', err);
    await shutdown(1);
});
