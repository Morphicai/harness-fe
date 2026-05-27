/**
 * Auto-start entry. Importing this module (as the Vite plugin does)
 * boots a RuntimeClient using the config planted on `window.__HARNESS_FE__`.
 *
 * Idempotent: importing twice is a no-op.
 */

import { installOverlay } from './overlay.js';
import { RuntimeClient, readInjectedConfig } from './client.js';
import {
    registerOverlayPlugin,
    drainPluginQueue,
    type OverlayPlugin,
} from './pluginRegistry.js';

// Informational; keep in sync with package.json on release.
const VERSION = '3.3.0';

const w = window as unknown as {
    __harness_fe_started__?: boolean;
    __harness_fe_client__?: RuntimeClient;
    __hfe_session_id__?: string;
    __HARNESS_FE_PLUGINS__?: OverlayPlugin[];
    HarnessFE?: { registerOverlayPlugin: typeof registerOverlayPlugin; version: string };
};

if (typeof window !== 'undefined' && !w.__harness_fe_started__) {
    w.__harness_fe_started__ = true;
    // Public global for runtime plugin registration. Works before or after the
    // overlay mounts — the registry buffers and the overlay subscribes.
    w.HarnessFE = { registerOverlayPlugin, version: VERSION };
    // Drain any plugins queued before the runtime loaded.
    drainPluginQueue(w.__HARNESS_FE_PLUGINS__);

    const cfg = readInjectedConfig();
    const client = new RuntimeClient(cfg);
    client.start();
    installOverlay(client);
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
