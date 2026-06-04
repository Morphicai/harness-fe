/**
 * ensureSharedGateway — idempotently make sure ONE shared Open gateway is
 * listening on (host, port), then return its base URL.
 *
 * Both ends call this with the same (host, port):
 *   - the build plugin, on `vite serve` (solo apps connect their runtime here)
 *   - the mcp launcher, before proxying the agent's stdio MCP to /mcp
 *
 * Whoever runs first spawns a DETACHED `harness serve`; everyone else reuses
 * the same process. The port doubles as a singleton lock (only one process can
 * `listen`), so the shared coreDataDir always has exactly one writer. Because
 * the child is detached + unref'd, the gateway OUTLIVES the dev server / agent
 * that spawned it — quitting a project does not kill the shared gateway.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WS_PORT } from '@harness-fe/protocol';

export interface EnsureSharedGatewayOptions {
    host?: string;
    port?: number;
    /** Shared core store (sessions/events). Defaults to the gateway's own default. */
    coreDataDir?: string;
    /** Shared gateway store. Defaults to the gateway's own default. */
    gatewayDataDir?: string;
    /** Max time to wait for a freshly-spawned gateway to answer. Default 10s. */
    readyTimeoutMs?: number;
    /** Gate experimental tools behind this env var name. Forwarded to the spawned gateway. */
    experimentalEnvVar?: string;
}

export interface SharedGatewayHandle {
    baseUrl: string;
    /** true = an existing gateway was reused; false = we spawned a new one. */
    reused: boolean;
}

// dist/sharedGateway.js sits next to dist/cli.js — resolve the bin without a
// package self-reference (works regardless of how the consumer installed us).
const CLI_ENTRY = fileURLToPath(new URL('./cli.js', import.meta.url));

/**
 * Probe /console/api/meta. Resolves to the meta object when a *harness* gateway
 * answers (used both to detect "already running" and to distinguish our gateway
 * from some unrelated process squatting the port), else null.
 */
async function probe(baseUrl: string, timeoutMs = 600): Promise<{ mode: string } | null> {
    try {
        const res = await fetch(`${baseUrl}/console/api/meta`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const meta = (await res.json()) as { daemonVersion?: unknown; mode?: unknown };
        if (typeof meta.daemonVersion !== 'string' || typeof meta.mode !== 'string') return null;
        return { mode: meta.mode };
    } catch {
        return null;
    }
}

export async function ensureSharedGateway(
    opts: EnsureSharedGatewayOptions = {},
): Promise<SharedGatewayHandle> {
    const host = opts.host ?? '127.0.0.1';
    const port = opts.port ?? DEFAULT_WS_PORT;
    const baseUrl = `http://${host}:${port}`;

    // 1. Already up? Reuse it — no new process.
    if (await probe(baseUrl)) return { baseUrl, reused: true };

    // 2. Spawn a detached, headless `harness serve`. Whoever wins the port binds it.
    const args = [CLI_ENTRY, 'serve', '--port', String(port), '--host', host];
    if (opts.coreDataDir) args.push('--core-data-dir', opts.coreDataDir);
    if (opts.gatewayDataDir) args.push('--data-dir', opts.gatewayDataDir);
    if (opts.experimentalEnvVar) args.push('--experimental-env-var', opts.experimentalEnvVar);
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();

    // 3. Poll until a gateway answers. This covers our own spawn AND a racing
    //    peer's: if two callers spawn at once, the loser hits EADDRINUSE and
    //    exits, but the winner answers and everyone reuses it. So we report
    //    `reused: false` here only optimistically — the survivor may be theirs.
    const deadline = Date.now() + (opts.readyTimeoutMs ?? 10_000);
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        if (await probe(baseUrl)) return { baseUrl, reused: false };
    }
    throw new Error(`harness: shared gateway on ${baseUrl} did not become ready in time`);
}
