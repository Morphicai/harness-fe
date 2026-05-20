// AI-generated
/**
 * Default (fallback) entry. Most consumers will be selected into either
 * `./browser` or `./node` via package.json `exports` conditions — those
 * paths import only the matching emit module and never pull the other
 * one in. This file exists as a safety net for environments / bundlers
 * that don't honour the `browser`/`node` conditions, or for callers who
 * deliberately want runtime detection (e.g. workers, plain Node scripts).
 *
 * Implementation: detects `typeof window` at call time, then dynamic-
 * imports the matching emit module. Bundlers like Turbopack DO chase
 * dynamic imports, so when bundling this file for a browser context
 * they'll still try to include `node-emit.js`. Prefer importing one of
 * the explicit subpath entries for that reason; this default is best for
 * SSR / pure-Node consumers.
 */
export type { LogLevel, LogEvent, Logger } from './types.js';
export { buildLogger, _resetEmitCache, _setEmitForTest } from './core.js';

import { setEmitProvider, buildLogger } from './core.js';
import type { Logger } from './types.js';

setEmitProvider(async () => {
    if (typeof window !== 'undefined') {
        const mod = await import('./browser-emit.js');
        return mod.emit;
    }
    const mod = await import('./node-emit.js');
    return mod.emit;
});

export const log: Logger = buildLogger();
