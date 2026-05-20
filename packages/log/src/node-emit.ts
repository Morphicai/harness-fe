// AI-generated
import type { LogEvent } from './types.js';

/**
 * Node.js / server-side emit path.
 *
 * Delegates sessionId resolution entirely to `@harnessa-fe/node-runtime` —
 * which itself walks ALS → adapter-supplied provider (e.g. the Next
 * `cache()` getter pushed in via `setSessionIdProvider`) → undefined.
 *
 * Result: log calls automatically inherit the per-request sessionId from
 * the same source as auto-captured `console.*`, with no special-casing
 * here. Orphan calls (cold-start init, background timers) emit with
 * `sessionId: undefined` → daemon files them under server-orphans/...
 *
 * Dynamic import keeps node-runtime out of any browser bundle when log
 * is consumed by isomorphic code. If node-runtime isn't installed at all,
 * we drop silently rather than throw.
 */

type NodeRuntimeModule = {
    getRequestSessionId: () => string | undefined;
    reportAppLog: (
        level: string,
        args: unknown[],
        ctx: { sessionId?: string; scope?: string; ts: number },
    ) => void;
};

export function emit(evt: LogEvent): void {
    void (async () => {
        let rt: NodeRuntimeModule;
        try {
            rt = (await import('@harnessa-fe/node-runtime')) as unknown as NodeRuntimeModule;
        } catch {
            // @harnessa-fe/node-runtime not installed — drop silently
            return;
        }
        rt.reportAppLog(evt.level, evt.args, {
            sessionId: rt.getRequestSessionId(),
            scope: evt.scope,
            ts: evt.ts,
        });
    })();
}
