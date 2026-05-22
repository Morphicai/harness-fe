/**
 * Storage growth benchmark.
 *
 * Spins up a fresh JsonlStore in a temp dir + Bridge + the react-demo dev
 * server, then drives N sequential page-loads in headless Chromium. Samples
 * disk usage every few seconds and reports a growth curve + per-file-type
 * breakdown so we know where the bytes are going.
 *
 *   N_PAGES * PAGE_DURATION_MS roughly equals the wall-clock test time.
 *
 * Defaults (10 pages × 30s ≈ 5 min):
 *   N_PAGES=10 PAGE_DURATION_MS=30000 tsx scripts/storage-bench.ts
 *
 * Override either via env vars.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { Bridge, JsonlStore } from '@harness-fe/mcp-server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

const N_PAGES = Number(process.env.N_PAGES ?? 10);
const PAGE_DURATION_MS = Number(process.env.PAGE_DURATION_MS ?? 30_000);
const SAMPLE_EVERY_MS = Number(process.env.SAMPLE_EVERY_MS ?? 5_000);
const VITE_PORT = 5173;

interface Sample {
    tSec: number;
    totalBytes: number;
    rrwebBytes: number;
    timelineBytes: number;
    metaBytes: number;
    pageIdx: number;
}

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else out.push(p);
    }
    return out;
}

function snapshot(dir: string): Omit<Sample, 'tSec' | 'pageIdx'> {
    let total = 0;
    let rrweb = 0;
    let timeline = 0;
    let meta = 0;
    for (const f of walk(dir)) {
        const sz = statSync(f).size;
        total += sz;
        if (f.endsWith('recording.jsonl')) rrweb += sz;
        else if (f.endsWith('timeline.jsonl') || f.endsWith('loads.jsonl')) timeline += sz;
        else if (f.endsWith('meta.json')) meta += sz;
    }
    return { totalBytes: total, rrwebBytes: rrweb, timelineBytes: timeline, metaBytes: meta };
}

async function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(url);
            if (r.ok || r.status === 404) return;
        } catch {
            /* not up */
        }
        await sleep(200);
    }
    throw new Error(`timeout waiting for ${url}`);
}

function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
    console.log(`=== storage-bench: ${N_PAGES} pages × ${PAGE_DURATION_MS / 1000}s, sample every ${SAMPLE_EVERY_MS / 1000}s ===`);

    const dataDir = mkdtempSync(join(tmpdir(), 'harness-bench-'));
    const store = new JsonlStore(dataDir);
    const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
    await bridge.start();
    const port = bridge.getBoundPort()!;
    console.log(`bridge ws://127.0.0.1:${port}`);
    console.log(`dataDir ${dataDir}`);

    let dev: ChildProcessWithoutNullStreams | undefined;
    try {
        dev = spawn('pnpm', ['--filter', 'harness-fe-react-demo', 'dev'], {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                HARNESS_FE_URL: `ws://127.0.0.1:${port}`,
                FORCE_COLOR: '0',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        dev.stderr.on('data', () => {
            /* eat */
        });
        await waitForHttp(`http://localhost:${VITE_PORT}/`);
        console.log('vite ready');

        const browser = await chromium.launch();
        const startTs = Date.now();
        const samples: Sample[] = [];
        let currentPage = 0;

        const sampler = setInterval(() => {
            const tSec = (Date.now() - startTs) / 1000;
            samples.push({ tSec, pageIdx: currentPage, ...snapshot(dataDir) });
        }, SAMPLE_EVERY_MS);

        for (let i = 0; i < N_PAGES; i++) {
            currentPage = i + 1;
            const page = await browser.newPage();
            await page.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'load' });
            // Drive a click every 3s so rrweb has real activity to record.
            const clickTimer = setInterval(async () => {
                try {
                    const button = page.locator('button').first();
                    if (await button.count()) await button.click({ timeout: 1000 });
                } catch {
                    /* button not found / closed */
                }
            }, 3000);
            await sleep(PAGE_DURATION_MS);
            clearInterval(clickTimer);
            await page.close();
        }

        // Final settled sample after a beat for queue flush.
        await sleep(2000);
        clearInterval(sampler);
        samples.push({ tSec: (Date.now() - startTs) / 1000, pageIdx: N_PAGES, ...snapshot(dataDir) });

        console.log('\n=== growth curve ===');
        console.log('t(s)\tpage\ttotal\trrweb\ttimeline\tmeta');
        for (const s of samples) {
            console.log(
                `${s.tSec.toFixed(0)}\t${s.pageIdx}\t${fmtBytes(s.totalBytes)}\t${fmtBytes(
                    s.rrwebBytes,
                )}\t${fmtBytes(s.timelineBytes)}\t${fmtBytes(s.metaBytes)}`,
            );
        }

        const last = samples[samples.length - 1]!;
        const ratePerMin = (last.totalBytes / last.tSec) * 60;
        console.log('\n=== summary ===');
        console.log(`wall clock        ${last.tSec.toFixed(1)}s`);
        console.log(`total on disk     ${fmtBytes(last.totalBytes)}`);
        console.log(`  rrweb recording ${fmtBytes(last.rrwebBytes)} (${((last.rrwebBytes / last.totalBytes) * 100).toFixed(1)}%)`);
        console.log(`  timeline events ${fmtBytes(last.timelineBytes)} (${((last.timelineBytes / last.totalBytes) * 100).toFixed(1)}%)`);
        console.log(`  metadata files  ${fmtBytes(last.metaBytes)} (${((last.metaBytes / last.totalBytes) * 100).toFixed(1)}%)`);
        console.log(`average growth    ${fmtBytes(ratePerMin)} / min`);
        console.log(`extrapolated 1h   ${fmtBytes(ratePerMin * 60)}`);
        console.log(`extrapolated 8h   ${fmtBytes(ratePerMin * 60 * 8)}`);
        console.log(`extrapolated 24h  ${fmtBytes(ratePerMin * 60 * 24)}`);
        console.log(`extrapolated 7d   ${fmtBytes(ratePerMin * 60 * 24 * 7)}`);

        await browser.close();
    } finally {
        if (dev && !dev.killed) {
            dev.kill('SIGTERM');
            await sleep(500);
            if (!dev.killed) dev.kill('SIGKILL');
        }
        await bridge.stop();
        rmSync(dataDir, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error('bench FAILED:', err);
    process.exit(1);
});
