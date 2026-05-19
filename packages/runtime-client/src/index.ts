/**
 * Auto-start entry. Importing this module (as the Vite plugin does)
 * boots a RuntimeClient using the config planted on `window.__HARNESSA_FE__`.
 *
 * Idempotent: importing twice is a no-op.
 */

import { installAnnotationOverlay } from './annotation.js';
import { RuntimeClient, readInjectedConfig } from './client.js';

const w = window as unknown as {
    __harnessa_fe_started__?: boolean;
    __harnessa_fe_client__?: RuntimeClient;
    __hfe_session_id__?: string;
};

if (typeof window !== 'undefined' && !w.__harnessa_fe_started__) {
    w.__harnessa_fe_started__ = true;
    const cfg = readInjectedConfig();
    const client = new RuntimeClient(cfg);
    client.start();
    installAnnotationOverlay(client);
    // Expose for debugging + same-origin iframe inheritance.
    // Same-origin children read `window.parent.__hfe_session_id__` and
    // `window.parent.__harnessa_fe_client__.tabId` in tryInheritFromParent()
    // so all iframes within one pageload share identity.
    w.__harnessa_fe_client__ = client;
    w.__hfe_session_id__ = client.sessionId;
}

export { RuntimeClient, tryInheritFromParent } from './client.js';
export type { ClientOptions, ParentInheritance } from './client.js';
