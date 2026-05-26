/**
 * Errors channel — observe-only. Adds window listeners for uncaught errors
 * and unhandled rejections. Listeners never call preventDefault — original
 * error handling (including dev tools display) is preserved.
 */

import type { ErrorObservation, SandboxCtx, SandboxEvent } from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, registerPatch } from '../chain.js';

function installErrorsPatch(): () => void {
    if (typeof window === 'undefined') return () => {};

    const restores: Array<() => void> = [];

    try {
        const onError = (e: ErrorEvent) => {
            try {
                const ts = Date.now();
                const data: ErrorObservation = {
                    kind: 'error',
                    message: e.message,
                    stack: e.error?.stack,
                    source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
                };
                const ctx: SandboxCtx = {
                    channel: 'errors',
                    kind: 'error',
                    initiator: captureInitiator(),
                    ts,
                };
                emit('errors', {
                    ts, source: 'errors', kind: 'error', data, initiator: ctx.initiator,
                });
            } catch { /* swallow */ }
        };
        window.addEventListener('error', onError);
        restores.push(() => window.removeEventListener('error', onError));
    } catch { /* ignore */ }

    try {
        const onRejection = (e: PromiseRejectionEvent) => {
            try {
                const ts = Date.now();
                const reason: unknown = e.reason;
                const message =
                    reason instanceof Error ? reason.message : String(reason ?? 'unhandled rejection');
                const stack = reason instanceof Error ? reason.stack : undefined;
                const data: ErrorObservation = {
                    kind: 'unhandledrejection',
                    message: `Unhandled: ${message}`,
                    stack,
                };
                const ctx: SandboxCtx = {
                    channel: 'errors',
                    kind: 'unhandledrejection',
                    initiator: captureInitiator(),
                    ts,
                };
                emit('errors', {
                    ts, source: 'errors', kind: 'unhandledrejection', data, initiator: ctx.initiator,
                });
            } catch { /* swallow */ }
        };
        window.addEventListener('unhandledrejection', onRejection);
        restores.push(() => window.removeEventListener('unhandledrejection', onRejection));
    } catch { /* ignore */ }

    return () => {
        for (const r of restores) {
            try { r(); } catch { /* ignore */ }
        }
    };
}

registerPatch('errors', installErrorsPatch);
