/**
 * Console + network + error capture. Monkey-patches in place once on init.
 *
 * Network capture covers fetch + XMLHttpRequest. Body capture is opt-in
 * per-request to keep memory bounded.
 */

import type {
    ConsoleEntry,
    ErrorEntry,
    NetworkEntry,
    WsEntry,
    StorageEntry,
} from '@harness-fe/protocol';
import { RingBuffer } from './buffer.js';
import { installFetchPatch } from './fetchPatch.js';
import { installXhrPatch } from './xhrPatch.js';
import { installWsPatch } from './wsPatch.js';
import { installStoragePatch } from './storagePatch.js';

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

    private installed = false;
    private fetchDispose?: () => void;
    private xhrDispose?: () => void;
    private wsDispose?: () => void;
    private storageDispose?: () => void;

    install(
        onEvent: (name: string, payload: unknown) => void,
        opts: { daemonUrl?: string } = {},
    ): void {
        if (this.installed) return;
        this.installed = true;
        this.installConsole(onEvent);
        this.installFetch(onEvent);
        this.installXhr(onEvent);
        this.installWs(onEvent, opts.daemonUrl);
        this.installStorage(onEvent);
        this.installErrors(onEvent);
    }

    dispose(): void {
        this.fetchDispose?.();
        this.fetchDispose = undefined;
        this.xhrDispose?.();
        this.xhrDispose = undefined;
        this.wsDispose?.();
        this.wsDispose = undefined;
        this.storageDispose?.();
        this.storageDispose = undefined;
        this.installed = false;
    }

    private installConsole(onEvent: (name: string, payload: unknown) => void): void {
        const methods: Array<ConsoleEntry['level']> = ['log', 'info', 'warn', 'error', 'debug'];
        for (const level of methods) {
            const original = console[level].bind(console);
            console[level] = (...args: unknown[]) => {
                const entry: ConsoleEntry = {
                    ts: Date.now(),
                    level,
                    args: args.map(safeClone),
                };
                this.console.push(entry);
                onEvent('console', entry);
                original(...args);
            };
        }
    }

    private installFetch(onEvent: (name: string, payload: unknown) => void): void {
        this.fetchDispose = installFetchPatch({
            onEntry: (entry) => {
                this.network.push(entry);
                onEvent('network', entry);
            },
        });
    }

    private installXhr(onEvent: (name: string, payload: unknown) => void): void {
        this.xhrDispose = installXhrPatch({
            onEntry: (entry) => {
                this.network.push(entry);
                onEvent('network', entry);
            },
        });
    }

    private installWs(onEvent: (name: string, payload: unknown) => void, daemonUrl?: string): void {
        // Add the daemon URL itself to the denylist so our own bridge
        // connection isn't intercepted (otherwise every event we send
        // would emit a `ws send` that loops back into the outbox).
        const extra: RegExp[] = [];
        if (daemonUrl) {
            const escaped = daemonUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            extra.push(new RegExp(`^${escaped}`));
        }
        this.wsDispose = installWsPatch({
            denylist: extra.length > 0 ? [/\/__hfe\//, /sockjs-node/, ...extra] : undefined,
            onEntry: (entry) => {
                this.ws.push(entry);
                onEvent('ws', entry);
            },
        });
    }

    private installStorage(onEvent: (name: string, payload: unknown) => void): void {
        this.storageDispose = installStoragePatch({
            onEntry: (entry) => {
                this.storage.push(entry);
                onEvent('storage', entry);
            },
        });
    }

    private installErrors(onEvent: (name: string, payload: unknown) => void): void {
        if (typeof window === 'undefined') return;
        window.addEventListener('error', (e: ErrorEvent) => {
            const entry: ErrorEntry = {
                ts: Date.now(),
                message: e.message,
                stack: e.error?.stack,
                source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
            };
            this.errors.push(entry);
            onEvent('error', entry);
        });
        window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
            const reason: unknown = e.reason;
            const message =
                reason instanceof Error ? reason.message : String(reason ?? 'unhandled rejection');
            const stack = reason instanceof Error ? reason.stack : undefined;
            const entry: ErrorEntry = {
                ts: Date.now(),
                message: `Unhandled: ${message}`,
                stack,
            };
            this.errors.push(entry);
            onEvent('error', entry);
        });
    }
}

let captureStoreSingleton: CaptureStore | undefined;
export function getCaptureStore(): CaptureStore {
    captureStoreSingleton ??= new CaptureStore();
    return captureStoreSingleton;
}

function safeClone(value: unknown): unknown {
    if (value === null) return null;
    if (typeof value === 'object') {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return String(value);
        }
    }
    return value;
}
