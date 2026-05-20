// AI-generated
/**
 * Browser-only entry. Selected by bundlers via the `browser` export
 * condition (Next.js Client Components, Webpack/Vite/Turbopack browser
 * builds). Imports ONLY `browser-emit.ts` — never references the node
 * SDK, so `node:async_hooks` never enters the client bundle.
 */
export type { LogLevel, LogEvent, Logger } from './types.js';
export { buildLogger, _resetEmitCache, _setEmitForTest } from './core.js';

import { setEmitProvider, buildLogger } from './core.js';
import type { Logger } from './types.js';

setEmitProvider(async () => {
    const mod = await import('./browser-emit.js');
    return mod.emit;
});

export const log: Logger = buildLogger();
