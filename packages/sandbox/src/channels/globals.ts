/**
 * Globals channel — observe + intercept reads/writes to specific window-level keys.
 *
 * Strategy: per-key `Object.defineProperty(window, key, { get, set, configurable })`.
 * Cannot wrap ALL of `window` (Proxy on window is performance-hostile and rejected
 * by some engines), so consumers must opt-in by listing keys in `globals.watch`.
 *
 * Each install brings its own watch list — implemented via per-entry hooks so
 * the channel patch is dynamic across multiple installs. Overlapping keys:
 * later install nests over earlier (calls previous getter/setter inside its own).
 *
 * Graceful: keys whose descriptor is non-configurable (e.g. `location`,
 * `document`) silently skip with no error.
 */

import type { GlobalsObservation, SandboxCtx } from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, getChain, registerEntryHook, registerPatch, type ChainEntry } from '../chain.js';

function emitGlobals(op: GlobalsObservation['op'], key: string, value: unknown, previousValue: unknown, initiator?: SandboxCtx['initiator']): void {
    const data: GlobalsObservation = { op, key, value, previousValue };
    emit('globals', { ts: Date.now(), source: 'globals', kind: op, data, initiator });
}

/** Per-key tracked state — chain of accessor descriptors. */
interface KeyState {
    /** Original descriptor (data or accessor) to restore after all installs gone. */
    original: PropertyDescriptor;
    /** Current value (used when original was a data property). */
    currentValue: unknown;
    /** Reference count of installs watching this key. */
    refs: number;
}
const watchedKeys = new Map<string, KeyState>();

function isConfigurable(desc: PropertyDescriptor | undefined): boolean {
    return !!desc?.configurable;
}

function startWatching(key: string): KeyState | null {
    if (typeof window === 'undefined') return null;
    let state = watchedKeys.get(key);
    if (state) {
        state.refs++;
        return state;
    }

    // First-time install for this key — defineProperty.
    const original = Object.getOwnPropertyDescriptor(window, key);
    if (original && !isConfigurable(original)) {
        // Locked native — degrade silently.
        return null;
    }

    const initialValue: unknown = original?.get
        ? (() => { try { return original.get!.call(window); } catch { return undefined; } })()
        : original?.value;

    state = {
        original: original ?? { value: undefined, writable: true, enumerable: true, configurable: true },
        currentValue: initialValue,
        refs: 1,
    };
    watchedKeys.set(key, state);

    try {
        Object.defineProperty(window, key, {
            configurable: true,
            enumerable: original?.enumerable ?? true,
            get(): unknown {
                // Walk the chain to allow onGet override.
                const initiator = captureInitiator();
                let value: unknown = state!.currentValue;

                // Iterate installed entries (deferred import to avoid circular).
                const chain = getCurrentChainSnapshot();
                for (const entry of chain) {
                    const interceptor = entry.opts.globals;
                    if (!interceptor?.onGet) continue;
                    if (!interceptor.watch?.includes(key)) continue;
                    try {
                        const r = interceptor.onGet(key, value, makeCtx('get', initiator));
                        if (r !== undefined) value = r;
                    } catch { /* skip */ }
                }
                emitGlobals('get', key, value, undefined, initiator);
                return value;
            },
            set(next: unknown): void {
                const initiator = captureInitiator();
                const previous = state!.currentValue;
                let finalValue: unknown = next;
                let blocked = false;

                const chain = getCurrentChainSnapshot();
                for (const entry of chain) {
                    const interceptor = entry.opts.globals;
                    if (!interceptor?.onSet) continue;
                    if (!interceptor.watch?.includes(key)) continue;
                    try {
                        const r = interceptor.onSet(key, finalValue, makeCtx('set', initiator));
                        if (r === false) { blocked = true; break; }
                        if (r !== undefined) finalValue = r;
                    } catch { /* skip */ }
                }

                emitGlobals('set', key, finalValue, previous, initiator);
                if (!blocked) state!.currentValue = finalValue;
            },
        });
    } catch {
        // defineProperty rejected (e.g. non-configurable in strict embedded env).
        watchedKeys.delete(key);
        return null;
    }

    return state;
}

function stopWatching(key: string): void {
    const state = watchedKeys.get(key);
    if (!state) return;
    state.refs--;
    if (state.refs > 0) return;

    // Last consumer gone — restore original descriptor.
    try {
        Object.defineProperty(window, key, state.original);
    } catch { /* ignore */ }
    watchedKeys.delete(key);
}

function getCurrentChainSnapshot(): readonly ChainEntry[] {
    return getChain('globals');
}

function makeCtx(kind: GlobalsObservation['op'], initiator: SandboxCtx['initiator']): SandboxCtx {
    return { channel: 'globals', kind, initiator, ts: Date.now() };
}

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

// Per-entry: each install brings its own watch list.
registerEntryHook('globals', {
    onEntryAdded(entry) {
        const watch = entry.opts.globals?.watch ?? [];
        const startedKeys: string[] = [];
        for (const key of watch) {
            if (startWatching(key)) startedKeys.push(key);
        }
        return () => {
            for (const key of startedKeys) stopWatching(key);
        };
    },
});

// No global patch needed — channel is fully per-entry.
registerPatch('globals', () => () => { /* noop global install */ });
