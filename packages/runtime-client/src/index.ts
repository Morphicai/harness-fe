/**
 * Auto-start entry. Importing this module (as the Vite plugin does)
 * boots a RuntimeClient using the config planted on `window.__HARNESS_FE__`.
 *
 * Idempotent: importing twice is a no-op.
 */

import { installOverlay } from './overlay.js';
import { RuntimeClient, readInjectedConfig } from './client.js';
import type { RuntimeControlPolicy, RuntimeControlChoice } from './client.js';
import {
    registerOverlayPlugin,
    drainPluginQueue,
    type OverlayPlugin,
} from './pluginRegistry.js';
import { VERSION } from './version.js';
import { dialogPresets } from './commands.js';

/**
 * Run `fn` after the host app has had a chance to paint: wait for `load` (if
 * the document is still loading), then `requestIdleCallback` (falling back to a
 * short timeout). Keeps the rrweb recorder + sandbox install — and the initial
 * full-DOM FullSnapshot — off the critical first-paint path on heavy pages.
 * See harness-fe#158.
 */
function deferUntilIdle(fn: () => void): void {
    const win = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    const idle = () => {
        if (typeof win.requestIdleCallback === 'function') {
            win.requestIdleCallback(fn, { timeout: 2000 });
        } else {
            setTimeout(fn, 1);
        }
    };
    if (document.readyState === 'complete') {
        idle();
    } else {
        window.addEventListener('load', idle, { once: true });
    }
}

const w = window as unknown as {
    __harness_fe_started__?: boolean;
    __harness_fe_client__?: RuntimeClient;
    __hfe_session_id__?: string;
    __HARNESS_FE_PLUGINS__?: OverlayPlugin[];
    HarnessFE?: {
        registerOverlayPlugin: typeof registerOverlayPlugin;
        version: string;
        /** The user's current effective control state for this app (4.0 runtime opt-in). */
        getRuntimeControl?: () => RuntimeControlPolicy;
        /** Set the user's explicit allow/deny for agent control; persists + re-gates. */
        setRuntimeControl?: (choice: RuntimeControlChoice) => void;
    };
};

if (typeof window !== 'undefined' && !w.__harness_fe_started__) {
    w.__harness_fe_started__ = true;
    // Expose dialogPresets for the sandbox dialogs channel. The channel reads
    // this synchronously to decide the return value for confirm/prompt when an
    // agent triggers those dialogs.
    (window as unknown as Record<string, unknown>).__hfe_dialog_presets__ = dialogPresets;
    // Public global for runtime plugin registration. Works before or after the
    // overlay mounts — the registry buffers and the overlay subscribes.
    w.HarnessFE = { registerOverlayPlugin, version: VERSION };
    // Drain any plugins queued before the runtime loaded.
    drainPluginQueue(w.__HARNESS_FE_PLUGINS__);

    const cfg = readInjectedConfig();
    const client = new RuntimeClient(cfg);
    if (cfg.deferStart) {
        deferUntilIdle(() => client.start());
    } else {
        client.start();
    }
    // Let apps / the overlay read and set the user's agent-control choice.
    w.HarnessFE.getRuntimeControl = () => client.getRuntimeControl();
    w.HarnessFE.setRuntimeControl = (choice) => client.setRuntimeControl(choice);
    if (cfg.overlay !== false) installOverlay(client);
    // Expose for debugging + same-origin iframe inheritance.
    // Same-origin children read `window.parent.__hfe_session_id__` and
    // `window.parent.__harness_fe_client__.tabId` in tryInheritFromParent()
    // so all iframes within one pageload share identity.
    w.__harness_fe_client__ = client;
    w.__hfe_session_id__ = client.sessionId;
}

export { RuntimeClient, tryInheritFromParent } from './client.js';
export type { ClientOptions, ParentInheritance } from './client.js';
export {
    registerOverlayPlugin,
    getOverlayPlugins,
    subscribeOverlayPlugins,
} from './pluginRegistry.js';
export type {
    OverlayPlugin,
    OverlayPluginContext,
    OverlayPluginSelectedElement,
    OverlayPluginSelector,
    OverlayPluginLogs,
    OverlayPluginGetLogsOptions,
} from './pluginRegistry.js';
