/**
 * Module-level componentMap registry keyed by plugin instance id.
 *
 * Used by the main webpack process to accumulate component locations forwarded
 * from worker processes via `module.buildMeta.harnessaCollected`. The MCP
 * client (also main-process only) reads from this map to answer
 * `project.where_is` / `project.module_graph` queries.
 *
 * thread-loader workers fork separate Node processes, so they get their own
 * empty `maps` instance — but the loader in workers doesn't persist anything
 * here. It writes collected locations to `module.buildMeta` and the main
 * process aggregates them via the `succeedModule` hook.
 */

import type { ComponentMap } from '@harnessa-fe/unplugin';

const maps = new Map<string, ComponentMap>();

export function getOrCreateComponentMap(pluginId: string): ComponentMap {
    let m = maps.get(pluginId);
    if (!m) {
        m = new Map();
        maps.set(pluginId, m);
    }
    return m;
}

export function clearComponentMap(pluginId: string): void {
    maps.delete(pluginId);
}
