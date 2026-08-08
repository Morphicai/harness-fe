/**
 * CaptureStore — thin adapter on top of `@harness-fe/sandbox`.
 *
 * Sandbox does the actual browser-API patching (fetch / xhr / ws / storage /
 * navigation / console / errors / globals / indexeddb) and exposes a unified
 * observer + interceptor surface. This module only:
 *   1. Installs sandbox with the runtime's `onEvent` callback wired in.
 *   2. Adapts each `SandboxEvent` into the harness-fe protocol shape
 *      (`NetworkEntry` / `WsEntry` / `StorageEntry` / `ConsoleEntry` /
 *      `ErrorEntry`) so the daemon's existing ingestion + tail tools keep
 *      working unchanged.
 *   3. Mirrors events into bounded `RingBuffer`s so the runtime's
 *      `console.tail` / `network.tail` / `ws.tail` / `storage.tail` MCP tool
 *      handlers have something to read.
 *
 * Identity / interceptor / reentry safety all live in sandbox.
 */

import type {
    ConsoleEntry,
    ErrorEntry,
    NetworkEntry,
    WsEntry,
    StorageEntry,
    NavigationEntry,
    GlobalsEntry,
    IndexedDbEntry,
} from '@harness-fe/protocol';
import {
    installSandbox,
    type SandboxEvent,
    type SandboxHandle,
    type FetchReqObservation,
    type FetchResObservation,
    type FetchSseFrameObservation,
    type WsObservation,
    type StorageObservation,
    type ConsoleObservation,
    type ErrorObservation,
    type NavigationObservation,
    type GlobalsObservation,
    type IndexedDbObservation,
} from '@harness-fe/sandbox';
import { RingBuffer } from './buffer.js';

const CONSOLE_CAP = 500;
const NETWORK_CAP = 200;
/**
 * SSE frames get their own, much deeper ring. A single streaming response can
 * emit hundreds of frames (one per token), which would evict every req/res
 * entry — and each other — out of the shared 200-slot network buffer long
 * before an agent could read the sparse lifecycle frames it actually needs
 * (harness-fe#204 follow-up).
 */
const NETWORK_FRAME_CAP = 2000;
const ERROR_CAP = 200;
const WS_CAP = 200;
const STORAGE_CAP = 200;
const NAVIGATION_CAP = 100;
const GLOBALS_CAP = 200;
const INDEXEDDB_CAP = 200;

export class CaptureStore {
    readonly console = new RingBuffer<ConsoleEntry>(CONSOLE_CAP);
    readonly network = new RingBuffer<NetworkEntry>(NETWORK_CAP);
    /** `phase: 'frame'` entries only — see {@link NETWORK_FRAME_CAP}. */
    readonly networkFrames = new RingBuffer<NetworkEntry>(NETWORK_FRAME_CAP);
    readonly errors = new RingBuffer<ErrorEntry>(ERROR_CAP);
    readonly ws = new RingBuffer<WsEntry>(WS_CAP);
    readonly storage = new RingBuffer<StorageEntry>(STORAGE_CAP);
    readonly navigation = new RingBuffer<NavigationEntry>(NAVIGATION_CAP);
    readonly globals = new RingBuffer<GlobalsEntry>(GLOBALS_CAP);
    readonly indexeddb = new RingBuffer<IndexedDbEntry>(INDEXEDDB_CAP);

    /**
     * Number of fetch/xhr requests that have a 'req' NetworkEntry in the
     * buffer with no matching 'res' yet — i.e. genuinely still in flight.
     * Derived from the buffer itself (not a separately-maintained counter)
     * so it stays correct regardless of how entries were pushed.
     */
    inFlightCount(): number {
        const pending = new Set<string>();
        for (const e of this.network.tail(NETWORK_CAP)) {
            if (!e.id) continue;
            if (e.phase === 'req') pending.add(e.id);
            else pending.delete(e.id);
        }
        return pending.size;
    }

    /**
     * req/res entries merged with SSE frames in chronological order — the view
     * `network.tail` / `network.get` present, now that frames are retained in a
     * separate, deeper ring. Both rings are already sorted by `ts`, so this is
     * a linear merge.
     */
    networkAll(includeFrames = true): NetworkEntry[] {
        const base = this.network.all();
        if (!includeFrames || this.networkFrames.size() === 0) return base;
        const frames = this.networkFrames.all();
        const out: NetworkEntry[] = [];
        let i = 0;
        let j = 0;
        while (i < base.length && j < frames.length) {
            if (base[i]!.ts <= frames[j]!.ts) out.push(base[i++]!);
            else out.push(frames[j++]!);
        }
        while (i < base.length) out.push(base[i++]!);
        while (j < frames.length) out.push(frames[j++]!);
        return out;
    }

    private handle?: SandboxHandle;

    /**
     * IndexedDB forward sampling. 0 = off (forward every op). When > 0, the
     * adapter forwards at most one idb event per `idbThrottleMs` (leading edge +
     * trailing flush, latest within a window wins). The local `indexeddb`
     * RingBuffer is always written, so `indexeddb.tail` keeps full fidelity.
     */
    private idbThrottleMs = 0;
    private idbPending: IndexedDbEntry | null = null;
    private idbTimer?: ReturnType<typeof setTimeout>;

    install(
        onEvent: (name: string, payload: unknown) => void,
        opts: { daemonUrl?: string; idbThrottleMs?: number } = {},
    ): void {
        if (this.handle) return;
        this.idbThrottleMs = Math.max(0, opts.idbThrottleMs ?? 0);
        const selfUrls = opts.daemonUrl ? [opts.daemonUrl] : undefined;
        this.handle = installSandbox({
            selfUrls,
            onEvent: (e) => this.adapt(e, onEvent),
        });
    }

    dispose(): void {
        if (this.idbTimer !== undefined) {
            clearTimeout(this.idbTimer);
            this.idbTimer = undefined;
        }
        this.idbPending = null;
        this.handle?.dispose();
        this.handle = undefined;
    }

    /**
     * Forward an idb entry honoring {@link idbThrottleMs}. Leading-edge: the
     * first entry emits immediately and opens a window; further entries within
     * the window only update the pending "latest", which is flushed when the
     * window closes (and reopens the window if more arrived).
     */
    private forwardIdb(
        entry: IndexedDbEntry,
        onEvent: (name: string, payload: unknown) => void,
    ): void {
        if (this.idbThrottleMs <= 0) {
            onEvent('indexeddb', entry);
            return;
        }
        this.idbPending = entry;
        if (this.idbTimer !== undefined) return; // window open — latest kept
        this.flushIdb(onEvent);
    }

    private flushIdb(onEvent: (name: string, payload: unknown) => void): void {
        if (this.idbPending) {
            const entry = this.idbPending;
            this.idbPending = null;
            onEvent('indexeddb', entry);
        }
        this.idbTimer = setTimeout(() => {
            this.idbTimer = undefined;
            if (this.idbPending) this.flushIdb(onEvent); // trailing flush
        }, this.idbThrottleMs);
    }

    private adapt(e: SandboxEvent, onEvent: (name: string, payload: unknown) => void): void {
        switch (e.source) {
            case 'fetch':
            case 'xhr': {
                const entry = adaptFetchLike(e);
                // Frames live in their own deep ring so a chatty SSE stream
                // can't evict the req/res entries (and vice versa).
                if (entry.phase === 'frame') this.networkFrames.push(entry);
                else this.network.push(entry);
                onEvent('network', entry);
                return;
            }
            case 'ws': {
                const entry = adaptWs(e);
                this.ws.push(entry);
                onEvent('ws', entry);
                return;
            }
            case 'storage': {
                const entry = adaptStorage(e);
                if (entry) {
                    this.storage.push(entry);
                    onEvent('storage', entry);
                }
                return;
            }
            case 'console': {
                const entry = adaptConsole(e);
                this.console.push(entry);
                onEvent('console', entry);
                return;
            }
            case 'errors': {
                const entry = adaptError(e);
                this.errors.push(entry);
                onEvent('error', entry);
                return;
            }
            case 'navigation': {
                const entry = adaptNavigation(e);
                this.navigation.push(entry);
                onEvent('navigation', entry);
                return;
            }
            case 'globals': {
                const entry = adaptGlobals(e);
                this.globals.push(entry);
                onEvent('globals', entry);
                return;
            }
            case 'indexeddb': {
                const entry = adaptIndexedDb(e);
                this.indexeddb.push(entry); // local tail keeps every op
                this.forwardIdb(entry, onEvent);
                return;
            }
        }
    }
}

let captureStoreSingleton: CaptureStore | undefined;
export function getCaptureStore(): CaptureStore {
    captureStoreSingleton ??= new CaptureStore();
    return captureStoreSingleton;
}

// ────────────────────────────────────────────────────────────────────
// SandboxEvent → harness-fe protocol entry adapters
// ────────────────────────────────────────────────────────────────────

function adaptFetchLike(e: SandboxEvent & { source: 'fetch' | 'xhr' }): NetworkEntry {
    const d = e.data as FetchReqObservation | FetchResObservation | FetchSseFrameObservation;
    if (e.kind === 'req') {
        const r = d as FetchReqObservation;
        return {
            ts: e.ts,
            id: r.id,
            phase: 'req',
            method: r.method,
            url: r.url,
            requestHeaders: r.headers,
            requestBody: r.body,
            requestBodyTruncated: r.bodyTruncated || undefined,
            initiator: e.initiator,
        };
    }
    if (e.kind === 'sse-frame') {
        const r = d as FetchSseFrameObservation;
        return {
            ts: e.ts,
            id: r.id,
            phase: 'frame',
            method: r.method,
            url: r.url,
            sseEvent: r.event,
            sseData: r.data,
            sseId: r.sseId,
            initiator: e.initiator,
        };
    }
    const r = d as FetchResObservation;
    return {
        ts: e.ts,
        id: r.id,
        phase: 'res',
        method: r.method,
        url: r.url,
        status: r.status,
        durationMs: r.durationMs,
        responseHeaders: r.headers,
        responseBody: r.body,
        responseBodyTruncated: r.bodyTruncated || undefined,
        error: r.error,
        initiator: e.initiator,
    };
}

function adaptWs(e: SandboxEvent & { source: 'ws' }): WsEntry {
    const d = e.data as WsObservation;
    return {
        ts: e.ts,
        id: d.id,
        phase: d.phase,
        url: d.url,
        protocols: d.protocols,
        payload: d.payload,
        payloadTruncated: d.payloadTruncated,
        code: d.code,
        reason: d.reason,
        wasClean: d.wasClean,
        initiator: e.initiator,
    };
}

function adaptStorage(e: SandboxEvent & { source: 'storage' }): StorageEntry | null {
    const d = e.data as StorageObservation;
    // Sandbox emits a 'get' op; harness-fe protocol storage only models set/remove/clear.
    if (d.op === 'get') return null;
    return {
        ts: e.ts,
        op: d.op,
        which: d.which,
        key: d.key,
        value: d.value,
        crossTab: d.crossTab,
        initiator: e.initiator,
    };
}

function adaptConsole(e: SandboxEvent & { source: 'console' }): ConsoleEntry {
    const d = e.data as ConsoleObservation;
    return {
        ts: e.ts,
        level: d.level,
        args: d.args,
    };
}

function adaptError(e: SandboxEvent & { source: 'errors' }): ErrorEntry {
    const d = e.data as ErrorObservation;
    return {
        ts: e.ts,
        message: d.message,
        stack: d.stack,
        source: d.source,
    };
}

function adaptNavigation(e: SandboxEvent & { source: 'navigation' }): NavigationEntry {
    const d = e.data as NavigationObservation;
    return {
        ts: e.ts,
        kind: d.kind,
        url: d.url,
        state: d.state,
        replace: d.replace,
        initiator: e.initiator,
    };
}

function adaptGlobals(e: SandboxEvent & { source: 'globals' }): GlobalsEntry {
    const d = e.data as GlobalsObservation;
    return {
        ts: e.ts,
        op: d.op,
        key: d.key,
        value: d.value,
        previousValue: d.previousValue,
        initiator: e.initiator,
    };
}

function adaptIndexedDb(e: SandboxEvent & { source: 'indexeddb' }): IndexedDbEntry {
    const d = e.data as IndexedDbObservation;
    return {
        ts: e.ts,
        op: d.op,
        db: d.db,
        version: d.version,
        store: d.store,
        key: d.key,
        value: d.value,
        success: d.success,
        error: d.error,
        initiator: e.initiator,
    };
}
