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
     */
    consent?: 'off' | 'session' | 'always';
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
