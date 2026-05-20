// AI-generated
import type { LogEvent } from './types.js';

/**
 * Node.js / server-side emit path.
 *
 * Lazy-loads `@harnessa-fe/node-runtime` on first call so this module never
 * forces that dependency into Edge Runtime bundles that don't need it.
 *
 * KEY ISOLATION GUARANTEE:
 *   `rt.getRequestSessionId()` is called INSIDE the then() callback — i.e.
 *   after awaiting the import but still within the current microtask chain
 *   that started synchronously in the caller's async context. This ensures
 *   React's cache()-backed getter is called on the correct request scope
 *   and never captures a stale sessionId from a different request.
 *
 * If @harnessa-fe/node-runtime is not installed (peer dep is optional),
 * the dynamic import rejects; we catch silently — caller code never throws.
 */
export function emit(evt: LogEvent): void {
    void import('@harnessa-fe/node-runtime').then((rt) => {
        // Read sessionId FRESH every call. React cache() guarantees per-request
        // scoping — two concurrent requests each get their own memoised value.
        const sessionId = rt.getRequestSessionId();
        rt.reportAppLog(evt.level, evt.args, {
            sessionId,
            scope: evt.scope,
            ts: evt.ts,
        });
    }).catch(() => {
        // @harnessa-fe/node-runtime not installed — drop silently
    });
}
