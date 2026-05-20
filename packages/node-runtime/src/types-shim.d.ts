// Ambient declaration for the optional @harnessa-fe/next sub-export we
// dynamically import inside getRequestSessionId(). We don't declare
// @harnessa-fe/next as a workspace devDep because that creates a real
// (not just type-level) cycle in turbo's task graph — see `pnpm graph`.
// At runtime the import is wrapped in try/catch, so the module being
// absent is fine; this shim only exists to satisfy tsc.
declare module '@harnessa-fe/next/sessionId' {
    export function getSessionId(): string;
}
