/**
 * Per-channel install registry. Threads multiple `installSandbox(opts)` calls
 * into ordered "onion" chains and gates each channel's patch lifecycle.
 *
 * Design:
 *   - Each channel has a Set<ChainEntry>. Entries are added on install, removed
 *     on dispose. When the set is empty, the channel's global patch is unwound.
 *   - The patch itself is installed lazily on the FIRST install for that channel
 *     and unwound when the LAST install for that channel disposes. This avoids
 *     repeatedly re-patching globals on each install/dispose cycle.
 *   - Failures during patch install do NOT throw — channel just stays unpatched
 *     and handle.enabled[channel] reports false. (Project rule: silent
 *     degradation; never disturb business code with sandbox errors.)
 */

import type { SandboxChannel, SandboxOptions, SandboxEvent } from './types.js';

/**
 * One install's contribution to a channel's chain.
 * Carries the relevant section of SandboxOptions + the parent's paused flag.
 */
export interface ChainEntry {
    /** Stable id for ordering / removal. */
    id: number;
    /** The options object this entry came from. */
    opts: SandboxOptions;
    /** Set to true while parent handle is paused — events should be skipped. */
    paused: boolean;
}

/** Per-channel registry slot. */
interface ChannelSlot {
    chain: ChainEntry[];
    /** Returned by the channel's `installPatch` on first install. Called on last dispose. */
    uninstall: (() => void) | null;
    /** False until installPatch has been attempted (success or fail). */
    installAttempted: boolean;
    /** True if the patch is live. False on graceful-fail or after uninstall. */
    enabled: boolean;
}

const CHANNELS: SandboxChannel[] = [
    'fetch', 'xhr', 'ws', 'storage', 'navigation', 'console', 'errors',
    'globals', 'indexeddb', 'dialogs',
];

function makeSlot(): ChannelSlot {
    return { chain: [], uninstall: null, installAttempted: false, enabled: false };
}

let entrySeq = 0;

// ───────────────────────────────────────────────────────────────────
// Reentry guard
//
// When a patched API runs an interceptor or emits an event, the consumer
// callback may itself touch another (or the same) patched API:
//   onSet: (k, v) => { localStorage.setItem('echo:' + k, v); }
//
// Without protection that becomes an infinite loop. The guard:
//   - any patched method first checks `isInSandbox()`. If true, it bypasses
//     interceptors + emits and goes straight to native — the recursive call
//     STILL functions (legit writes aren't dropped), it just isn't observed.
//   - on entry it bumps the depth counter; on exit it decrements.
//
// One counter per JS thread is enough — single-threaded JS guarantees no
// concurrent install / dispose / patch invocation.
// ───────────────────────────────────────────────────────────────────

// Use a globalThis-mounted counter so cross-module-instance sandbox installs
// (e.g. HMR re-import, accidental dup) share the same depth and don't
// double-observe each other recursively.
const GLOBAL_DEPTH_KEY = '__hfeSandboxReentryDepth__';
interface DepthHolder { [GLOBAL_DEPTH_KEY]?: number }
function getHolder(): DepthHolder {
    return (typeof globalThis !== 'undefined' ? globalThis : {}) as DepthHolder;
}

export function isInSandbox(): boolean {
    return (getHolder()[GLOBAL_DEPTH_KEY] ?? 0) > 0;
}
export function enterSandbox(): void {
    const h = getHolder();
    h[GLOBAL_DEPTH_KEY] = (h[GLOBAL_DEPTH_KEY] ?? 0) + 1;
}
export function exitSandbox(): void {
    const h = getHolder();
    const d = h[GLOBAL_DEPTH_KEY] ?? 0;
    if (d > 0) h[GLOBAL_DEPTH_KEY] = d - 1;
}

/**
 * Run a guarded patched-method body. `fn` is the full "interceptor + emit + native"
 * sequence; `fallback` runs only the native side-effect (skipping observation).
 *
 * Returns whatever `fn` or `fallback` returns. Always restores the depth, even
 * if either fn or fallback throws.
 */
export function runGuarded<T>(fn: () => T, fallback: () => T): T {
    if (isInSandbox()) return fallback();
    enterSandbox();
    try { return fn(); }
    finally { exitSandbox(); }
}
const slots: Record<SandboxChannel, ChannelSlot> = {
    fetch: makeSlot(),
    xhr: makeSlot(),
    ws: makeSlot(),
    storage: makeSlot(),
    navigation: makeSlot(),
    console: makeSlot(),
    errors: makeSlot(),
    globals: makeSlot(),
    indexeddb: makeSlot(),
    dialogs: makeSlot(),
};

/** Lazy-loaded patch installers. Filled by `registerPatch()` from each channel module. */
const patchInstallers: Partial<Record<SandboxChannel, () => () => void>> = {};

/**
 * Per-entry hooks fired when an entry is added/removed from a channel's chain.
 * Currently used by the `globals` channel where each install's `watch` list
 * is unique and needs per-install bookkeeping.
 */
const entryHooks: Partial<Record<SandboxChannel, {
    onEntryAdded?: (entry: ChainEntry) => () => void;  // returns per-entry uninstall
}>> = {};
const perEntryUninstall = new WeakMap<ChainEntry, () => void>();

/** Each channel module registers its install fn at module-init time. */
export function registerPatch(channel: SandboxChannel, install: () => () => void): void {
    patchInstallers[channel] = install;
}

/** Register a per-entry add hook for a channel (optional). */
export function registerEntryHook(channel: SandboxChannel, hooks: { onEntryAdded?: (entry: ChainEntry) => () => void }): void {
    entryHooks[channel] = hooks;
}

/** Add an entry to the given channel; install the patch on first entry. */
export function addEntry(channel: SandboxChannel, entry: Omit<ChainEntry, 'id'>): ChainEntry {
    const slot = slots[channel];
    const e: ChainEntry = { id: ++entrySeq, ...entry };
    slot.chain.push(e);

    if (!slot.installAttempted) {
        slot.installAttempted = true;
        const installer = patchInstallers[channel];
        if (installer) {
            try {
                slot.uninstall = installer();
                slot.enabled = true;
            } catch {
                // Graceful degradation: channel never engages, but other installs proceed.
                slot.enabled = false;
                slot.uninstall = null;
            }
        }
    }

    // Per-entry hook (for globals etc.)
    const eh = entryHooks[channel];
    if (eh?.onEntryAdded) {
        try {
            const uninstall = eh.onEntryAdded(e);
            if (typeof uninstall === 'function') perEntryUninstall.set(e, uninstall);
        } catch { /* silent degrade */ }
    }

    return e;
}

/** Remove an entry; uninstall the patch when chain becomes empty. */
export function removeEntry(channel: SandboxChannel, entryId: number): void {
    const slot = slots[channel];
    const idx = slot.chain.findIndex((e) => e.id === entryId);
    if (idx < 0) return;
    const removed = slot.chain[idx];
    slot.chain.splice(idx, 1);

    // Per-entry uninstall (globals etc.)
    const perEntry = perEntryUninstall.get(removed);
    if (perEntry) {
        try { perEntry(); } catch { /* ignore */ }
        perEntryUninstall.delete(removed);
    }

    if (slot.chain.length === 0 && slot.uninstall) {
        try { slot.uninstall(); } catch { /* ignore */ }
        slot.uninstall = null;
        slot.enabled = false;
        slot.installAttempted = false;
    }
}

/** Read-only access to the chain for a channel. Returned in install order (outer→inner). */
export function getChain(channel: SandboxChannel): readonly ChainEntry[] {
    return slots[channel].chain;
}

export function isChannelEnabled(channel: SandboxChannel): boolean {
    return slots[channel].enabled;
}

/** Emit an event to every non-paused install's onEvent in install order. */
export function emit(channel: SandboxChannel, event: SandboxEvent): void {
    const chain = slots[channel].chain;
    for (const e of chain) {
        if (e.paused) continue;
        const cb = e.opts.onEvent;
        if (!cb) continue;
        try { cb(event); } catch { /* never let observer break business code */ }
    }
}

/** For tests: reset the entire registry. Tests-only — do NOT export from package. */
export function _resetForTesting(): void {
    for (const ch of CHANNELS) {
        const slot = slots[ch];
        if (slot.uninstall) {
            try { slot.uninstall(); } catch { /* ignore */ }
        }
        slot.chain = [];
        slot.uninstall = null;
        slot.installAttempted = false;
        slot.enabled = false;
    }
    entrySeq = 0;
}

export const ALL_CHANNELS = CHANNELS;
