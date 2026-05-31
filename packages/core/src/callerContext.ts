/**
 * Caller context (4.0 · A) — carries the per-call {@link Principal} across the
 * async boundary from the MCP transport entry point down to `bridge.sendCommand`,
 * so command-target scoping applies without threading `principal` through every
 * one of the ~20 tool handlers.
 *
 * Identity is the cross-cutting main line of the 4.0 design; an
 * AsyncLocalStorage is the idiomatic way to make a cross-cutting value
 * ambient. The MCP HTTP transport wraps each request in `runWithCaller`;
 * `sendCommand` reads `currentCaller()` (an explicit `opts.principal` still
 * wins). stdio has no per-request identity → no wrap → `currentCaller()` is
 * undefined → no scoping (the daemon trusts its local stdio agent).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal } from './identity.js';

const callerAls = new AsyncLocalStorage<Principal>();

/** Run `fn` with `principal` as the ambient caller for the duration of the async chain. */
export function runWithCaller<T>(principal: Principal, fn: () => T): T {
    return callerAls.run(principal, fn);
}

/** The ambient caller, if one was established upstream (HTTP MCP). Undefined for stdio. */
export function currentCaller(): Principal | undefined {
    return callerAls.getStore();
}
