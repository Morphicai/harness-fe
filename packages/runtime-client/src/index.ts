/**
 * Auto-start entry. Importing this module (as the Vite plugin does)
 * boots a RuntimeClient using the config planted on `window.__HARNESSA_FE__`.
 *
 * Idempotent: importing twice is a no-op.
 */

import { installAnnotationOverlay } from './annotation.js';
import { RuntimeClient, readInjectedConfig } from './client.js';

const w = window as unknown as { __harnessa_fe_started__?: boolean };

if (typeof window !== 'undefined' && !w.__harnessa_fe_started__) {
    w.__harnessa_fe_started__ = true;
    const cfg = readInjectedConfig();
    const client = new RuntimeClient(cfg);
    client.start();
    installAnnotationOverlay(client);
    // Expose for debugging.
    (window as unknown as { __harnessa_fe_client__?: RuntimeClient }).__harnessa_fe_client__ =
        client;
}

export { RuntimeClient } from './client.js';
export type { ClientOptions } from './client.js';
