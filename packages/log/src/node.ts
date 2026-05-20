// AI-generated
/**
 * Node-only entry. Selected by bundlers via the `node` export condition
 * (Next.js Server Components, Route Handlers, Server Actions, plain Node
 * Express apps). Imports ONLY `node-emit.ts` — the browser emit code never
 * enters server bundles.
 */
export type { LogLevel, LogEvent, Logger } from './types.js';
export { buildLogger, _resetEmitCache, _setEmitForTest } from './core.js';

import { setEmitProvider, buildLogger } from './core.js';
import type { Logger } from './types.js';

setEmitProvider(async () => {
    const mod = await import('./node-emit.js');
    return mod.emit;
});

export const log: Logger = buildLogger();
