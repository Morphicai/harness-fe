// AI-generated
/**
 * Shared logger factory used by the browser, node, and default entry points.
 *
 * Why is this in its own file?
 *   The `@harness-fe/log` package exposes three entry points (browser / node /
 *   default) via package.json `exports` conditions. All three need the same
 *   `buildLogger` implementation. Keeping it in `core.ts` (and importing
 *   from each entry) lets bundlers tree-shake to the SINGLE emit module that
 *   matches the current condition — never pulling Node-only `node:async_hooks`
 *   into a browser bundle (Turbopack's "external module not supported" error).
 */

import type { LogEvent, LogLevel, Logger } from './types.js';

export type EmitFn = (evt: LogEvent) => void;

let cachedEmit: EmitFn | null = null;
let emitProvider: (() => Promise<EmitFn | null>) | null = null;

/**
 * Wire up the emit function this entry point uses. Called once per entry
 * at module load; idempotent (last call wins). All log calls block on this
 * resolving — once resolved, identity is cached and subsequent calls are sync.
 */
export function setEmitProvider(provider: () => Promise<EmitFn | null>): void {
    emitProvider = provider;
    cachedEmit = null;
}

async function getEmit(): Promise<EmitFn | null> {
    if (cachedEmit !== null) return cachedEmit;
    if (emitProvider === null) return null;
    try {
        cachedEmit = (await emitProvider()) ?? (() => { /* noop */ });
    } catch {
        cachedEmit = () => { /* noop */ };
    }
    return cachedEmit;
}

/**
 * Build a Logger instance with an optional scope prefix.
 */
export function buildLogger(prefixScope?: string): Logger {
    const emitOne = (level: LogLevel, args: unknown[]): void => {
        const ts = Date.now();
        void getEmit().then((e) => {
            if (!e) return;
            try {
                e({ level, args, scope: prefixScope, ts });
            } catch {
                // Silently drop — logging must never throw into user code
            }
        });
    };

    return {
        debug: (...args: unknown[]) => emitOne('debug', args),
        info: (...args: unknown[]) => emitOne('info', args),
        log: (...args: unknown[]) => emitOne('info', args),
        warn: (...args: unknown[]) => emitOne('warn', args),
        error: (...args: unknown[]) => emitOne('error', args),
        scope: (name: string) =>
            buildLogger(prefixScope ? `${prefixScope}.${name}` : name),
    };
}

/** @internal — test helper */
export function _resetEmitCache(): void {
    cachedEmit = null;
}

/** @internal — test helper */
export function _setEmitForTest(fn: EmitFn): void {
    cachedEmit = fn;
}
