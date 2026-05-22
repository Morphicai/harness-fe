/**
 * Per-request sessionId backed by React's `cache()`.
 *
 * One call to `cache(fn)` wraps `fn` so that within a single React
 * Server Component render tree every call to the wrapper returns the same
 * memoised value. This is exactly what we want: every Server Component,
 * Route Handler, and Server Action executed during ONE request refresh will
 * read the same sessionId — and we can embed that id in the HTML payload
 * so the browser-side RuntimeClient adopts it instead of generating its own.
 *
 * Re-exported from `@harness-fe/node-runtime` so the Node SDK can use the
 * same helper without depending on `@harness-fe/next`.
 */

// React 19 exports `cache()`; React 18 ships it but @types/react ^18 lacks
// the type declaration. We access it via a dynamic require cast so the code
// compiles against @types/react ^18 and works at runtime on React 18/19.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reactModule = require('react') as { cache?: <T>(fn: T) => T };
// If cache is not available (very old React), fall back to identity.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wrapWithCache = reactModule.cache ?? (<T>(fn: T): T => fn);

function generateId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

/**
 * Returns the sessionId for the current request render-pass.
 *
 * Stable within one request (React `cache()` scoping); a new id is
 * allocated for every subsequent request.
 *
 * Safe to call from Server Components, Route Handlers, and Server Actions.
 * Returns `undefined` in non-React contexts (e.g. process-level handlers).
 */
export const getSessionId: () => string = wrapWithCache(generateId);

// Side-effect: push this getter into node-runtime so auto-captured
// `console.*` calls during Server Component renders inherit the same
// per-request sessionId. Dependency direction is L2 → L1 (correct);
// node-runtime stays React-agnostic.
//
// Wrapped in try/catch because node-runtime is an optional peer dep —
// if the host project hasn't installed it, this is a silent no-op.
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nrt = require('@harness-fe/node-runtime') as {
        setSessionIdProvider?: (fn: () => string | undefined) => void;
    };
    nrt.setSessionIdProvider?.(() => {
        try {
            return getSessionId();
        } catch {
            // `cache()` invoked outside a React render scope on some
            // React/Next combinations throws — treat as "no sessionId".
            return undefined;
        }
    });
} catch {
    // @harness-fe/node-runtime not installed — fine, log + Next still work
}
