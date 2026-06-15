/**
 * Shared types used by both the unplugin core and the native webpack plugin.
 */

import type { ComponentMap } from '../transform.js';

export type PeerRole = 'vite-plugin' | 'webpack-plugin';

export interface HarnessFEOptions {
    /** Override projectId (defaults to package.json `name`). */
    projectId?: string;
    /** MCP server WebSocket URL (default: ws://127.0.0.1:47729). */
    mcpUrl?: string;
    /** Disable injection entirely. */
    disabled?: boolean;
    /**
     * Parent project's id, used to build the project tree on the daemon.
     * Set this on the iframe child app's plugin config when you can declare
     * the relationship at build time. Otherwise the runtime client will
     * auto-detect it via same-origin parent inspection.
     */
    parentProjectId?: string;
    /** Human-readable name; defaults to package.json `name`. */
    displayName?: string;
    /**
     * Override buildId. When omitted, the plugin resolves it from git sha
     * (or CI env vars) and falls back to a dev-stable hash of config files.
     */
    buildId?: string;
    /**
     * Token to authenticate against the daemon when it's bound to a non-
     * loopback host. Appended as `?token=…` to the WS URL and propagated
     * to the runtime client via `__HARNESS_FE__`. Read from
     * `HARNESS_FE_TOKEN` when omitted.
     */
    token?: string;
    /**
     * Vue SFC transform safety: when true (default), the plugin re-parses
     * its own output to catch any mis-aligned attribute injection.
     */
    safeMode?: boolean;
    /**
     * Show the in-page "H" overlay (default: true). Set to false to hide the
     * overlay in production dogfood scenarios — data capture is unaffected.
     */
    overlay?: boolean;
    /**
     * Browser consent policy. When set, takes priority over the gateway
     * hello.ack consent mode.
     *   'off'     — no user prompt, control commands run freely (default)
     *   'session' — user grants once per page-load
     *   'always'  — prompt before every control command
     *   'deny'    — all control commands rejected immediately, no prompt shown
     */
    consent?: 'off' | 'session' | 'always' | 'deny';
    /**
     * How often (ms) rrweb emits a fresh FullSnapshot baseline. Default 30 min.
     * Set below the daemon's recording retention window so a retained replay
     * window always contains a baseline (see harness-fe#160). 0 disables periodic
     * baselines (start() + reconnect baselines only).
     */
    rrwebCheckoutEveryNms?: number;
    /**
     * Defer runtime start until the host app has painted: waits for `load`,
     * then `requestIdleCallback`, before installing capture + starting the
     * rrweb recorder. Avoids competing with the app's first-paint work on
     * heavy pages (e.g. Electron). Default false (start eagerly at import).
     */
    deferStart?: boolean;
    /**
     * CSS selector for DOM subtrees rrweb must NOT record into (passed through
     * as rrweb `blockSelector`). Use for micro-frontend containers whose inner
     * document rrweb cannot safely serialize — notably wujie's `wujie-app`
     * shadow host / sandbox iframe, which throws on traversal. The sub-app
     * should run its own harness instance instead. Example: `'wujie-app'`.
     */
    rrwebBlockSelector?: string;
    /**
     * Sample IndexedDB observations: forward at most one idb event per this many
     * ms (trailing — the most recent within each window wins), dropping the rest.
     * Apps that hammer idb (hundreds of ops/sec) otherwise flood the transport.
     * 0 (default) forwards every op. Local `indexeddb.tail` is unaffected.
     */
    idbThrottleMs?: number;
}

/**
 * Context handed to the MCP client. Getters keep the values fresh as the
 * host (vite/webpack) resolves them lazily (e.g. projectRoot is only known
 * after configResolved / afterEnvironment).
 */
export interface McpClientContext {
    readonly projectId: string;
    readonly mcpUrl: string;
    readonly token: string | undefined;
    readonly peerRole: PeerRole;
    readonly parentProjectId: string | undefined;
    readonly projectRoot: string;
    readonly componentMap: ComponentMap;
    getBuildId(): string;
    getDisplayName(): string | undefined;
}

export interface McpClient {
    connect(): void;
    disconnect(): void;
    emitEvent(name: string, payload: unknown): void;
    readonly isActive: boolean;
}
