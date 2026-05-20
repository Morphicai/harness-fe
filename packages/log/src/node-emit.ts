// AI-generated
import type { LogEvent } from './types.js';

/**
 * Node.js / server-side emit path.
 *
 * Resolves the current request's sessionId via two channels, in priority order:
 *
 *   1. **React `cache()`** (via `@harnessa-fe/next/sessionId.getSessionId`) —
 *      automatically request-scoped inside any Server Component, Route
 *      Handler, or Server Action render. Same value that `<HarnessaScript>`
 *      seeded into the client. Works WITHOUT any user-side wrapping.
 *
 *   2. **AsyncLocalStorage** (via `@harnessa-fe/node-runtime.getRequestSessionId`) —
 *      populated only when user wraps a handler with `withHarnessaTracing`.
 *      Fallback for non-React contexts and non-Next setups.
 *
 * If neither yields an id (e.g. `log.info` called from cold-start init or a
 * background timer that escaped any request scope), the event is emitted
 * with `sessionId: undefined` → daemon files it under `sessions/server-
 * orphans/...`. That's correct: better an orphan than misattributing to
 * whatever the most recent request was.
 *
 * The `@harnessa-fe/next` import is conditional — if the host project
 * doesn't have Next installed, that branch is skipped silently.
 */

let cachedNextGetter: (() => string | undefined) | null | undefined = undefined;

async function loadNextSessionGetter(): Promise<(() => string | undefined) | null> {
    if (cachedNextGetter !== undefined) return cachedNextGetter;
    try {
        const mod = (await import('@harnessa-fe/next/sessionId')) as {
            getSessionId?: () => string;
        };
        cachedNextGetter = mod.getSessionId ?? null;
    } catch {
        cachedNextGetter = null;
    }
    return cachedNextGetter;
}

export function emit(evt: LogEvent): void {
    void (async () => {
        let sessionId: string | undefined;
        const nextGetter = await loadNextSessionGetter();
        if (nextGetter) {
            try {
                sessionId = nextGetter();
            } catch {
                // `cache()` may behave oddly outside a React render scope —
                // expected for some handlers / timers; fall through to ALS.
            }
        }
        try {
            const rt = await import('@harnessa-fe/node-runtime');
            if (sessionId === undefined) sessionId = rt.getRequestSessionId();
            rt.reportAppLog(evt.level, evt.args, {
                sessionId,
                scope: evt.scope,
                ts: evt.ts,
            });
        } catch {
            // @harnessa-fe/node-runtime not installed — drop silently
        }
    })();
}
