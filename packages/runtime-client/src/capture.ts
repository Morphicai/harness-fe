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
} from '@harness-fe/protocol';
import {
    installSandbox,
    type SandboxEvent,
    type SandboxHandle,
    type FetchReqObservation,
    type FetchResObservation,
    type WsObservation,
    type StorageObservation,
    type ConsoleObservation,
    type ErrorObservation,
} from '@harness-fe/sandbox';
import { RingBuffer } from './buffer.js';

const CONSOLE_CAP = 500;
const NETWORK_CAP = 200;
const ERROR_CAP = 200;
const WS_CAP = 200;
const STORAGE_CAP = 200;

export class CaptureStore {
    readonly console = new RingBuffer<ConsoleEntry>(CONSOLE_CAP);
    readonly network = new RingBuffer<NetworkEntry>(NETWORK_CAP);
    readonly errors = new RingBuffer<ErrorEntry>(ERROR_CAP);
    readonly ws = new RingBuffer<WsEntry>(WS_CAP);
    readonly storage = new RingBuffer<StorageEntry>(STORAGE_CAP);

    private handle?: SandboxHandle;

    install(
        onEvent: (name: string, payload: unknown) => void,
        opts: { daemonUrl?: string } = {},
    ): void {
        if (this.handle) return;
        const selfUrls = opts.daemonUrl ? [opts.daemonUrl] : undefined;
        this.handle = installSandbox({
            selfUrls,
            onEvent: (e) => this.adapt(e, onEvent),
        });
    }

    dispose(): void {
        this.handle?.dispose();
        this.handle = undefined;
    }

    private adapt(e: SandboxEvent, onEvent: (name: string, payload: unknown) => void): void {
        switch (e.source) {
            case 'fetch':
            case 'xhr': {
                const entry = adaptFetchLike(e);
                this.network.push(entry);
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
                // No dedicated ring buffer yet — forward raw shape so the
                // daemon records it under t='navigation' for `session.tail`.
                onEvent('navigation', e.data);
                return;
            }
            case 'globals':
            case 'indexeddb': {
                // Pass-through. The daemon stores under t=source for
                // session.tail; no runtime-side ring buffer (no tail tool).
                onEvent(e.source, e.data);
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
    const d = e.data as FetchReqObservation | FetchResObservation;
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
