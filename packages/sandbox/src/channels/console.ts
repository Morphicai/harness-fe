/**
 * Console channel — observe-only. Wraps `console.{log,info,warn,error,debug}`
 * to emit a sandbox event for each call without altering the call's behavior.
 *
 * Graceful degradation: if the global console or any method is missing/locked,
 * we skip silently. The original behavior is always preserved.
 */

import type { ConsoleObservation, SandboxCtx, SandboxEvent } from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, registerPatch } from '../chain.js';

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

function safeClone(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return String(value); }
}

function installConsolePatch(): () => void {
    if (typeof console === 'undefined') return () => {};
    const restores: Array<() => void> = [];

    for (const level of METHODS) {
        try {
            const original = console[level];
            if (typeof original !== 'function') continue;
            const bound = original.bind(console);

            const wrapper = (...args: unknown[]): void => {
                try {
                    const ts = Date.now();
                    const data: ConsoleObservation = {
                        level,
                        args: args.map(safeClone),
                    };
                    const ctx: SandboxCtx = {
                        channel: 'console',
                        kind: level,
                        initiator: captureInitiator(),
                        ts,
                    };
                    const event: SandboxEvent = {
                        ts,
                        source: 'console',
                        kind: level,
                        data,
                        initiator: ctx.initiator,
                    };
                    emit('console', event);
                } catch { /* never let observer crash console */ }
                return bound(...args);
            };

            console[level] = wrapper;
            restores.push(() => { console[level] = original; });
        } catch { /* skip this level, keep going */ }
    }

    return () => {
        for (const r of restores) {
            try { r(); } catch { /* ignore */ }
        }
    };
}

registerPatch('console', installConsolePatch);
