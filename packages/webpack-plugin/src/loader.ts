/**
 * Webpack loader entrypoint for @harnessa-fe/webpack.
 *
 * IMPORTANT: This file is loaded by webpack's loader runner (potentially
 * inside a thread-loader worker process). The options object passed to this
 * loader MUST be pure JSON-serializable data — no plugin instance, no
 * compiler reference, no closures. The reason this package exists at all is
 * that unplugin's webpack adapter passes the plugin instance in options,
 * which closes over `compiler.root` and breaks thread-loader's JSON.stringify.
 *
 * The loader collects component locations into a per-call temporary
 * componentMap, then writes them to `module.buildMeta.harnessaCollected`.
 * The main-process plugin reads buildMeta via `compilation.succeedModule`
 * and merges the entries into the real shared componentMap.
 */

import type { ComponentMap, ComponentLocation } from '@harnessa-fe/unplugin';
import { runTransform } from './transform-runner.js';

export interface HarnessaLoaderOptions {
    pluginId: string;
    projectRoot: string;
    vueOptions: {
        safeMode: boolean;
        dryRun: boolean;
    };
    disabled: boolean;
}

interface CollectedLocation {
    name: string;
    location: ComponentLocation;
}

interface LoaderContext {
    async: () => (err: Error | null, content?: string, map?: object) => void;
    getOptions: () => HarnessaLoaderOptions;
    resourcePath: string;
    resourceQuery: string;
    _module?: { buildMeta?: Record<string, unknown> };
}

export default function harnessaLoader(this: LoaderContext, source: string): void {
    const callback = this.async();
    const opts = this.getOptions();

    if (opts.disabled) {
        callback(null, source);
        return;
    }

    // Fresh map per call — caller-side accumulation lives in main-process
    // shared-state, fed via module.buildMeta.
    const localMap: ComponentMap = new Map();

    let out;
    try {
        out = runTransform(
            source,
            this.resourcePath,
            this.resourceQuery,
            opts.projectRoot,
            { safeMode: opts.vueOptions.safeMode, dryRun: opts.vueOptions.dryRun },
            localMap,
        );
    } catch (err) {
        // Never break the host build because of a transform bug.
        callback(null, source);
        return;
    }

    // Forward collected locations to main process via buildMeta.
    if (localMap.size > 0 && this._module) {
        const collected: CollectedLocation[] = [];
        for (const [name, locs] of localMap.entries()) {
            for (const location of locs) {
                collected.push({ name, location });
            }
        }
        const buildMeta = (this._module.buildMeta ??= {});
        const existing = (buildMeta.harnessaCollected as CollectedLocation[] | undefined) ?? [];
        buildMeta.harnessaCollected = existing.concat(collected);
    }

    if (!out) {
        callback(null, source);
        return;
    }

    callback(null, out.code, out.map);
}

export const raw = false;
