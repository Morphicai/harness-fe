/**
 * Top-level entry point. `installSandbox(opts)` returns a handle.
 *
 * Channels are registered with the chain manager at module import time. We
 * import them all here so a single `import { installSandbox }` activates
 * every channel's lazy patch installer.
 */

import './channels/console.js';
import './channels/errors.js';
import './channels/fetch.js';
import './channels/xhr.js';
import './channels/ws.js';
import './channels/storage.js';
import './channels/navigation.js';
import './channels/globals.js';
import './channels/indexeddb.js';
import './channels/dialogs.js';
import './channels/forms.js';

import { addEntry, removeEntry, isChannelEnabled, ALL_CHANNELS, type ChainEntry } from './chain.js';
import type { SandboxChannel, SandboxHandle, SandboxOptions } from './types.js';

function enabledChannelsFromOpts(opts: SandboxOptions): SandboxChannel[] {
    // `only` is an explicit allowlist — when set, ONLY those channels engage.
    // Everything else stays fully uninstalled (patches never run).
    if (opts.only && opts.only.length > 0) {
        const set = new Set(opts.only);
        return ALL_CHANNELS.filter((c) => set.has(c));
    }
    // Otherwise: default-all-enabled, with `observe[c] === false` opting out.
    const observe = opts.observe ?? {};
    return ALL_CHANNELS.filter((c) => observe[c] !== false);
}

export function installSandbox(opts: SandboxOptions = {}): SandboxHandle {
    const channels = enabledChannelsFromOpts(opts);

    // Per-channel chain entries we own. Mutable `paused` flag is shared with
    // every chain it sits in (Chain reads it on each emit).
    const entries: Array<{ channel: SandboxChannel; entry: ChainEntry }> = [];
    const sharedState: { paused: boolean } = { paused: false };

    for (const ch of channels) {
        const entry = addEntry(ch, { opts, paused: false });
        // Bind paused getter via Proxy-like sharing: we mutate entry.paused
        // through sharedState so all our entries flip in lockstep.
        Object.defineProperty(entry, 'paused', {
            configurable: true,
            enumerable: true,
            get: () => sharedState.paused,
            set: (v: boolean) => { sharedState.paused = v; },
        });
        entries.push({ channel: ch, entry });
    }

    const enabledSnapshot = (): Readonly<Record<SandboxChannel, boolean>> => {
        const out = {} as Record<SandboxChannel, boolean>;
        for (const c of ALL_CHANNELS) {
            out[c] = channels.includes(c) && isChannelEnabled(c);
        }
        return Object.freeze(out);
    };

    let disposed = false;

    const handle: SandboxHandle = {
        dispose() {
            if (disposed) return;
            disposed = true;
            // Remove in reverse install order — LIFO for symmetry.
            for (let i = entries.length - 1; i >= 0; i--) {
                const { channel, entry } = entries[i];
                removeEntry(channel, entry.id);
            }
        },
        pause() {
            sharedState.paused = true;
        },
        resume() {
            sharedState.paused = false;
        },
        get enabled() {
            return enabledSnapshot();
        },
    };

    return handle;
}
