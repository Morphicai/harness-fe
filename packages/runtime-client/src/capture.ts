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
} from '@morphixai/harnessa-fe.protocol';
import { RingBuffer } from './buffer.js';
import { installFetchPatch } from './fetchPatch.js';

const CONSOLE_CAP = 500;
const NETWORK_CAP = 200;
const ERROR_CAP = 200;

export class CaptureStore {
    readonly console = new RingBuffer<ConsoleEntry>(CONSOLE_CAP);
    readonly network = new RingBuffer<NetworkEntry>(NETWORK_CAP);
    readonly errors = new RingBuffer<ErrorEntry>(ERROR_CAP);

    private installed = false;
    private fetchDispose?: () => void;

    install(onEvent: (name: string, payload: unknown) => void): void {
        if (this.installed) return;
        this.installed = true;
        this.installConsole(onEvent);
        this.installFetch(onEvent);
        this.installXhr(onEvent);
        this.installErrors(onEvent);
    }

    dispose(): void {
        this.fetchDispose?.();
        this.fetchDispose = undefined;
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
        if (typeof window === 'undefined' || !window.XMLHttpRequest) return;
        const OriginalXHR = window.XMLHttpRequest;
        function PatchedXHR(this: XMLHttpRequest) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const xhr = new (OriginalXHR as any)();
            let method = 'GET';
            let url = '';
            let startedAt = 0;
            const originalOpen = xhr.open.bind(xhr);
            const originalSend = xhr.send.bind(xhr);
            xhr.open = (m: string, u: string, ...rest: unknown[]) => {
                method = m;
                url = u;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (originalOpen as any)(m, u, ...rest);
            };
            xhr.send = (body?: Document | XMLHttpRequestBodyInit | null) => {
                startedAt = performance.now();
                xhr.addEventListener('loadend', () => {
                    const entry: NetworkEntry = {
                        ts: Date.now(),
                        method,
                        url,
                        status: xhr.status,
                        durationMs: performance.now() - startedAt,
                    };
                    onEvent.call(undefined, 'network', entry);
                    captureStoreSingleton?.network.push(entry);
                });
                return originalSend(body ?? null);
            };
            return xhr;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).XMLHttpRequest = PatchedXHR;
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
