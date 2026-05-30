/**
 * `createDaemon` — programmatic entry point for embedding the harness-fe
 * daemon inside another Node.js process. Wraps `Bridge` construction +
 * `startMcpHttpServer` so a host application can boot the daemon with
 * `import { createDaemon } from '@harness-fe/mcp-server'` instead of
 * spawning the CLI as a sidecar.
 *
 * Scope (v1):
 *   - Factory mode only — the daemon owns its own HTTP listener on a
 *     caller-chosen port. Attaching to a host's existing `http.Server`
 *     (middleware / handle modes) is a follow-up that requires Bridge
 *     surgery; tracked separately.
 *   - Resumable SSE — pass through `eventStore` (defaults to
 *     `MemoryEventStore`; `null` disables resumability).
 *   - Custom auth — pass `authorize: (req) => boolean` to replace the
 *     built-in token check. The CLI translates `--token` into one of
 *     these so the daemon itself has exactly one auth pipeline.
 *
 * Standalone CLI use is unchanged: `cli.ts` is a thin caller of this
 * factory. Anything the CLI does that's specific to a developer's
 * machine (port-keyed `defaultDataDir`, `HARNESS_FE_*` env, leader /
 * follower attachment, banner, signal handlers) stays in `cli.ts` —
 * not pushed into the factory.
 */

import type { IncomingMessage } from 'node:http';

import type { ConsentPolicy } from '@harness-fe/protocol';

import { Bridge } from './bridge.js';
import { startMcpHttpServer } from './mcpHttp.js';
import type { EventStore, IStore } from './store/types.js';
import type { ITaskStore, IMemoryStore } from './store/types.js';

export interface DaemonOptions {
    /** TCP port to listen on. Default `DEFAULT_WS_PORT` (see protocol). */
    port?: number;
    /** Bind address. Default `127.0.0.1` (loopback only). */
    host?: string;
    /**
     * Override the host used when building outbound URLs (dashboard, replay
     * viewer). Useful when binding `0.0.0.0` and the auto-detected LAN IP is
     * wrong, or when the host application sits behind a reverse proxy.
     */
    publicHost?: string;
    /**
     * Custom request authorizer applied to every HTTP request and WS upgrade.
     * Return `false` to reject. When supplied, the built-in token check is
     * skipped — there is exactly one auth pipeline. Synchronous because the
     * WS upgrade handshake completes inline; async auth should be cached in
     * a cookie by the host's own middleware and read back here.
     *
     * Mutually exclusive with `token`. If both are provided, `authorize`
     * wins and `token` is ignored.
     */
    authorize?: (req: IncomingMessage) => boolean;
    /**
     * Static token; auth requires `Authorization: Bearer <token>`, the
     * `harness_fe_token` cookie, `?token=<token>`, or the matching WS
     * subprotocol. Use this when you want the daemon's built-in auth and
     * have no reason to plug in custom logic — the CLI's `--token` flag
     * flows through here. Mutually exclusive with `authorize`.
     */
    token?: string;
    /**
     * Browser-consent policy for control commands (4.0 · P2). Omit to track the
     * auth boundary automatically: `session` when auth is on (exposed daemon),
     * `off` on loopback solo dev. Pass `{ mode }` to force a policy.
     */
    consent?: ConsentPolicy;
    /**
     * IStore implementation. Omit for the default JSONL store at `dataDir`.
     * Pass `null` to disable session/event persistence entirely.
     */
    store?: IStore | null;
    /** Task store. Omit for default JsonTaskStore. `null` disables. */
    taskStore?: ITaskStore | null;
    /** Memory store. Omit for default JsonMemoryStore. `null` disables. */
    memoryStore?: IMemoryStore | null;
    /**
     * EventStore backing resumable SSE streams. Omit for the in-memory
     * default (1000 events / 5 minutes / 50 MiB). `null` disables
     * resumability — reconnects after a drop start at the live tail.
     */
    eventStore?: EventStore | null;
    /**
     * Root data directory for the default stores. Omit to let `Bridge`
     * compute a port-keyed default; pass explicitly when the host wants
     * everything at a known location.
     */
    dataDir?: string;
    /** Cosmetic friendly name; surfaces in the dashboard banner. */
    label?: string;
    /** URL path the MCP HTTP transport mounts on. Default `/mcp`. */
    mcpPath?: string;
    /**
     * Whether to use stateful MCP sessions (sessionId in headers) or
     * stateless one-shot requests. Default `true` (stateful — matches what
     * Claude Code, Cursor, and the MCP spec default expect).
     */
    mcpStateful?: boolean;
    /**
     * Whether to mount the MCP HTTP Streamable transport at `mcpPath`.
     * Default `true`. Set to `false` if the host only needs the WS bridge
     * (and wires up MCP over stdio externally — that's how the CLI's
     * stdio mode boots the daemon through this factory without also
     * exposing an HTTP MCP endpoint).
     */
    mcpHttp?: boolean;
    /**
     * Name of the environment variable that gates experimental (in-testing)
     * tools. Omit (the default) for fully-on, zero-config. Supply a name only
     * when the host wants the tools restricted to machines where that var is
     * set to a non-empty value.
     */
    experimentalEnvVar?: string;
}

export interface DaemonHandle {
    /**
     * Start the bridge and mount the MCP HTTP transport. Throws if the port
     * is already in use — in embedded mode there's no leader/follower
     * fallback; the host decides how to handle the conflict.
     */
    start(): Promise<void>;
    /** Stop the MCP transport and bridge. Safe to call multiple times. */
    stop(): Promise<void>;
    /** Bound TCP port (only meaningful after `start`). */
    getBoundPort(): number | undefined;
    /** Outbound base URL for dashboard / replay viewer links. */
    getViewerBaseUrl(): string | undefined;
    /** Path the MCP HTTP transport is mounted on. */
    readonly mcpPath: string;
    /** Underlying bridge — escape hatch for tests and advanced wiring. */
    readonly bridge: Bridge;
}

export function createDaemon(opts: DaemonOptions = {}): DaemonHandle {
    const mcpPath = opts.mcpPath ?? '/mcp';
    const mountMcpHttp = opts.mcpHttp ?? true;

    // Resolve auth: authorize wins if both are set. `undefined` here means
    // no auth at all (loopback dev default). One pipeline — Bridge sees
    // exactly one of `{ authorize }`, `{ token }`, or nothing.
    const auth = opts.authorize
        ? { authorize: opts.authorize }
        : opts.token
            ? { token: opts.token }
            : undefined;

    const bridge = new Bridge({
        port: opts.port,
        host: opts.host,
        publicHost: opts.publicHost,
        store: opts.store,
        taskStore: opts.taskStore,
        memoryStore: opts.memoryStore,
        dataDir: opts.dataDir,
        label: opts.label,
        auth,
        consent: opts.consent,
    });

    let mcpHandle: Awaited<ReturnType<typeof startMcpHttpServer>> | undefined;
    let started = false;
    let stopped = false;

    return {
        mcpPath,
        bridge,

        async start() {
            if (started) return;
            started = true;
            await bridge.start();
            if (mountMcpHttp) {
                // Forward eventStore as-is so `null` opts out of resumability and
                // `undefined` falls through to the default MemoryEventStore.
                mcpHandle = await startMcpHttpServer(bridge, {
                    path: mcpPath,
                    stateful: opts.mcpStateful,
                    eventStore: opts.eventStore,
                    experimentalEnvVar: opts.experimentalEnvVar,
                });
            }
        },

        async stop() {
            if (stopped) return;
            stopped = true;
            if (mcpHandle) {
                try {
                    await mcpHandle.close();
                } catch {
                    /* swallow — bridge.stop will be called anyway */
                }
            }
            await bridge.stop();
        },

        getBoundPort() {
            return bridge.getBoundPort();
        },

        getViewerBaseUrl() {
            return bridge.getViewerBaseUrl();
        },
    };
}
