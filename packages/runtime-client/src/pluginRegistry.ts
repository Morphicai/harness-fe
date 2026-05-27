/**
 * Overlay plugin registry.
 *
 * Lets developers extend the in-page "H" overlay with their own action buttons
 * — e.g. "send this scene to Slack" / "create a Jira issue" — without forking
 * `@harness-fe/runtime`. A plugin is just a button label + an `onClick(ctx)`
 * handler; the handler receives an {@link OverlayPluginContext} with on-demand,
 * redaction-aware access to the current scene, logs, screenshot, and selected
 * element.
 *
 * Registration order doesn't matter: plugins registered before the overlay
 * mounts are buffered here, and the overlay subscribes so anything registered
 * later renders immediately. See `index.ts` for the `window.HarnessFE` global
 * and the `window.__HARNESS_FE_PLUGINS__` pre-boot queue.
 */

import type {
    PageLoadPayload,
    ConsoleEntry,
    NetworkEntry,
    ErrorEntry,
    TaskAttachment,
} from '@harness-fe/protocol';

/** Selector descriptor for a picked element (mirrors TaskSubmitPayload.selector). */
export interface OverlayPluginSelector {
    /** Source location `file:line:col` from the build transform, if present. */
    loc?: string;
    /** Component display name from the build transform, if present. */
    comp?: string;
    /** Best-effort CSS path. */
    css: string;
}

/** The element the user picked (only present for `requiresElement` plugins). */
export interface OverlayPluginSelectedElement {
    /** Live DOM node. */
    el: Element;
    selector: OverlayPluginSelector;
    /** outerHTML with internal instrumentation attrs stripped + truncated. */
    outerHTML: string;
    rect: { x: number; y: number; width: number; height: number };
}

export interface OverlayPluginLogs {
    console: ConsoleEntry[];
    network: NetworkEntry[];
    errors: ErrorEntry[];
}

export interface OverlayPluginGetLogsOptions {
    /** Max console entries (newest last). Default 0 — pass a count to include. */
    console?: number;
    /** Max network entries. Default 0. */
    network?: number;
    /** Max error entries. Default 0. */
    errors?: number;
    /**
     * When `true` (the default), network entries are reduced to metadata:
     * request/response bodies are dropped and `authorization` / `cookie`
     * headers are stripped. Set `false` to receive raw entries — only do this
     * when you control the destination, as bodies may contain secrets.
     */
    redact?: boolean;
}

/**
 * Per-invocation context handed to a plugin's `onClick`. Getters are lazy: the
 * snapshot / logs / screenshot are only computed when you call them, so a
 * plugin pays for exactly what it uses.
 */
export interface OverlayPluginContext {
    readonly projectId: string;
    readonly displayName?: string;
    readonly buildId?: string;
    readonly parentProjectId?: string;
    readonly sessionId: string;
    readonly tabId: string;
    readonly visitorId?: string;
    readonly userId?: string;
    /** `location.href` at click time. */
    readonly url: string;
    readonly connectionState: 'connecting' | 'open' | 'closed';
    /** Deep link to this session in the daemon dashboard, if the address is known. */
    readonly dashboardUrl?: string;
    /** Present only for plugins declared with `requiresElement: true`. */
    readonly selectedElement?: OverlayPluginSelectedElement;

    /** Shareable markdown summary (project / build / session / tab / url / time / conn). */
    snapshotMarkdown(): string;
    /** Structured page-load snapshot: page / viewport / storage / performance. */
    snapshot(): PageLoadPayload;
    /** Recent buffered logs. Redacted by default — see {@link OverlayPluginGetLogsOptions}. */
    getLogs(opts?: OverlayPluginGetLogsOptions): OverlayPluginLogs;
    /** Rasterize an element (default: the picked element, else `document.body`) to a PNG attachment. */
    captureScreenshot(el?: Element): Promise<TaskAttachment | null>;
    /** Daemon RPC over the whitelisted channel (e.g. `tasks.mine`). Undefined if unavailable. */
    query?: <TResult = unknown>(method: string, args?: unknown) => Promise<TResult>;

    /** Copy text to the clipboard (best-effort). */
    copyToClipboard(text: string): Promise<void>;
    /** Show a brief feedback toast on the overlay. */
    toast(message: string, kind?: 'ok' | 'error'): void;
}

export interface OverlayPlugin {
    /** Unique id. Re-registering the same id replaces the previous plugin. */
    id: string;
    /** Button label shown in the info card. */
    label: string;
    /** Optional leading icon (emoji or single char). */
    icon?: string;
    /**
     * When `true`, clicking the button first enters element-picker mode; the
     * picked element is then available as `ctx.selectedElement` in `onClick`.
     */
    requiresElement?: boolean;
    /** Invoked when the button is clicked. May be async; rejections are toasted. */
    onClick(ctx: OverlayPluginContext): void | Promise<void>;
}

const plugins = new Map<string, OverlayPlugin>();
const listeners = new Set<() => void>();

function notify(): void {
    for (const fn of listeners) {
        try {
            fn();
        } catch {
            /* a bad listener must not break registration */
        }
    }
}

/**
 * Register an overlay plugin. Returns an unregister function (handy for HMR
 * cleanup). Registering an id that already exists replaces it.
 */
export function registerOverlayPlugin(plugin: OverlayPlugin): () => void {
    if (!plugin || typeof plugin.id !== 'string' || plugin.id === '') {
        throw new Error('registerOverlayPlugin: plugin.id is required');
    }
    if (typeof plugin.onClick !== 'function') {
        throw new Error(`registerOverlayPlugin: plugin "${plugin.id}" needs an onClick handler`);
    }
    plugins.set(plugin.id, plugin);
    notify();
    return () => {
        if (plugins.get(plugin.id) === plugin) {
            plugins.delete(plugin.id);
            notify();
        }
    };
}

/** Current plugins, in registration order. */
export function getOverlayPlugins(): OverlayPlugin[] {
    return [...plugins.values()];
}

/** Subscribe to registry changes (add / replace / remove). Returns an unsubscribe fn. */
export function subscribeOverlayPlugins(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

/**
 * Drain a pre-boot queue of plugins. Developers whose script may run before the
 * runtime loads can push plain plugin objects onto
 * `window.__HARNESS_FE_PLUGINS__`; `index.ts` calls this once on boot.
 */
export function drainPluginQueue(queue: unknown): void {
    if (!Array.isArray(queue)) return;
    for (const p of queue) {
        try {
            registerOverlayPlugin(p as OverlayPlugin);
        } catch {
            /* skip malformed queued entries */
        }
    }
}

/** Test-only: clear all plugins and listeners. */
export function __resetOverlayPlugins(): void {
    plugins.clear();
    listeners.clear();
}
