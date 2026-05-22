/**
 * Pure transform dispatcher — picks the right transform function for a
 * given file id (.vue / .vue?type=template / .vue?other-sub-module / .tsx /
 * .jsx) and returns the transformed source + map.
 *
 * The componentMap is supplied per-call so the loader can collect new
 * locations in a temporary map and forward them via module.buildMeta to
 * the main process (where thread-loader is not in the picture).
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
    transformJsx,
    transformVueSFC,
    transformVueTemplate,
    resolveVueComponentName,
    getTemplateLineOffset,
    type ComponentMap,
    type VueTransformOptions,
} from '@harnessa-fe/unplugin';

export interface RunTransformResult {
    code: string;
    map?: object;
}

export function runTransform(
    source: string,
    resourcePath: string,
    resourceQuery: string,
    projectRoot: string,
    vueOptions: VueTransformOptions,
    componentMap: ComponentMap,
): RunTransformResult | null {
    const rel = relative(projectRoot, resourcePath);

    // Vue template virtual sub-module.
    if (
        resourcePath.endsWith('.vue') &&
        /[?&]vue\b/.test(resourceQuery) &&
        /[?&]type=template\b/.test(resourceQuery)
    ) {
        let componentName: string | undefined;
        let lineOffset = 0;
        try {
            const sfcSource = readFileSync(resourcePath, 'utf-8');
            componentName = resolveVueComponentName(sfcSource, rel);
            lineOffset = getTemplateLineOffset(sfcSource, rel);
        } catch {
            /* fall through with no offset / no name */
        }
        const out = transformVueTemplate(
            source,
            rel,
            componentName,
            componentMap,
            lineOffset,
            vueOptions,
        );
        if (!out) return null;
        return { code: out.code, map: out.map };
    }

    // Plain .vue request: full SFC transform.
    if (resourcePath.endsWith('.vue') && !resourceQuery) {
        const out = transformVueSFC(source, rel, componentMap, vueOptions);
        if (!out) return null;
        return { code: out.code, map: out.map };
    }

    // Every other .vue sub-module (script / style) is a no-op — the
    // information was already collected from the SFC and template variants.
    if (resourcePath.endsWith('.vue')) return null;

    // .jsx / .tsx
    const out = transformJsx(source, rel, componentMap);
    if (!out) return null;
    return { code: out.code, map: out.map };
}
