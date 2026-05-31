import { describe, it, expect, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// These exercise the REAL built CLI (subprocess spawn). They only run when the
// package has been built (turbo `test` only guarantees ^build, not self-build),
// so a bare `vitest` without a prior build skips them instead of failing.
const distCli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const distShared = fileURLToPath(new URL('../dist/sharedGateway.js', import.meta.url));
const built = existsSync(distCli) && existsSync(distShared);
const d = built ? describe : describe.skip;

const SERVE_PORT = 47971;
const ENSURE_PORT = 47972;
const MCP_PORT = 47973;

const children: ChildProcess[] = [];
const tmpDirs: string[] = [];
function mkTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harness-cli-e2e-'));
    tmpDirs.push(dir);
    return dir;
}
function killPort(port: number): void {
    try {
        const pid = execSync(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
        if (pid) execSync(`kill ${pid.split('\n').join(' ')}`);
    } catch {
        /* nothing listening */
    }
}

async function waitMeta(port: number, ms = 12_000): Promise<{ mode?: string }> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/console/api/meta`, { signal: AbortSignal.timeout(800) });
            if (r.ok) return (await r.json()) as { mode?: string };
        } catch {
            /* not up yet */
        }
        await new Promise((res) => setTimeout(res, 150));
    }
    throw new Error(`gateway on ${port} not ready in ${ms}ms`);
}

afterAll(() => {
    for (const c of children) {
        try {
            c.kill();
        } catch {
            /* already gone */
        }
    }
    for (const p of [SERVE_PORT, ENSURE_PORT, MCP_PORT]) killPort(p);
    for (const dir of tmpDirs) {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
});

d('cli e2e (built dist)', () => {
    it('`harness serve` is headless + serves the REAL console + probe endpoint', async () => {
        killPort(SERVE_PORT);
        const dir = mkTmp();
        const child = spawn(
            process.execPath,
            [distCli, 'serve', '--port', String(SERVE_PORT), '--core-data-dir', join(dir, 'core'), '--data-dir', join(dir, 'gw')],
            { stdio: 'ignore' },
        );
        children.push(child);

        const meta = await waitMeta(SERVE_PORT);
        expect(meta.mode).toBe('open');

        const html = await (await fetch(`http://127.0.0.1:${SERVE_PORT}/console`)).text();
        expect(html).not.toContain('Build the console UI'); // not the placeholder
        expect(html).toMatch(/\/console\/assets\//); // real built SPA

        child.kill();
    }, 20_000);

    it('ensureSharedGateway spawns when absent, reuses when present (detached)', async () => {
        killPort(ENSURE_PORT);
        const dir = mkTmp();
        const { ensureSharedGateway } = await import(pathToFileURL(distShared).href);
        const opts = { port: ENSURE_PORT, coreDataDir: join(dir, 'core'), gatewayDataDir: join(dir, 'gw') };

        const first = await ensureSharedGateway(opts);
        expect(first).toEqual({ baseUrl: `http://127.0.0.1:${ENSURE_PORT}`, reused: false });

        const second = await ensureSharedGateway(opts);
        expect(second).toEqual({ baseUrl: `http://127.0.0.1:${ENSURE_PORT}`, reused: true });

        // spawned gateway is detached — still answering after our calls returned
        expect((await waitMeta(ENSURE_PORT, 2_000)).mode).toBe('open');
        killPort(ENSURE_PORT);
    }, 20_000);

    it('`harness mcp` proxies a stdio initialize through to the shared gateway', async () => {
        killPort(MCP_PORT);
        const dir = mkTmp();
        const child = spawn(
            process.execPath,
            [distCli, 'mcp', '--port', String(MCP_PORT), '--core-data-dir', join(dir, 'core'), '--data-dir', join(dir, 'gw')],
            { stdio: ['pipe', 'pipe', 'ignore'] },
        );
        children.push(child);

        const result = await new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('mcp initialize timed out')), 15_000);
            let buf = '';
            child.stdout!.on('data', (chunk) => {
                buf += chunk.toString();
                let nl: number;
                while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.id === 1) {
                            clearTimeout(timer);
                            resolve(msg);
                        }
                    } catch {
                        /* partial / non-json */
                    }
                }
            });
            child.on('error', reject);
            child.stdin!.write(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
                }) + '\n',
            );
        });

        expect(result.result?.protocolVersion).toBeTruthy();
        expect(result.result?.serverInfo?.name).toBeTruthy();
        child.kill();
    }, 20_000);
});
