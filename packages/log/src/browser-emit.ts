// AI-generated
import type { LogEvent } from './types.js';

/**
 * Browser-side emit path.
 *
 * Reads `window.__harnessa_fe_client__` (the RuntimeClient instance injected
 * by @harnessa-fe/runtime). If the runtime is not loaded — e.g. in a test
 * environment or a build where the script tag is absent — we drop silently.
 *
 * sessionId / tabId / visitorId / projectId / buildId are stamped by the
 * bridge automatically from the peer's registration data, exactly the same
 * way auto-captured `console` events are stamped. No userId in payload.
 */
export function emit(evt: LogEvent): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (typeof window !== 'undefined') ? (window as any).__harnessa_fe_client__ : undefined;
    if (!client || typeof client.sendEvent !== 'function') return;
    try {
        client.sendEvent('app.log', {
            level: evt.level,
            args: evt.args,
            scope: evt.scope,
            ts: evt.ts,
        });
    } catch {
        // Silently drop — caller code must never throw because of logging
    }
}
