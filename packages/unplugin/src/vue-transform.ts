/**
 * Vue SFC transform: parse a .vue file and inject:
 *   - `data-morphix-loc="<relPath>:<line>:<col>"` on every template element
 *   - `data-morphix-comp="<ComponentName>"` on every template element
 *
 * Uses @vue/compiler-sfc to parse the SFC and @vue/compiler-dom to walk the
 * template AST. MagicString splices attributes into the original source to
 * preserve source maps.
 *
 * Side effect: every successfully scanned file contributes entries to the
 * supplied `componentMap`: name → list of locations (file:line:col).
 */

import { parse as parseSFC } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
import MagicString from 'magic-string';
import type { ComponentMap } from './transform.js';

export interface VueTransformResult {
    code: string;
    map?: object;
    taggedCount: number;
    componentName: string | undefined;
}

/**
 * Counters maintained across calls — populated even in dry-run mode. The
 * unplugin core attaches a single instance per dev-server lifetime and
 * dumps it on process exit so users can see how many Vue 2-era files were
 * skipped (filter syntax, functional templates, malformed offsets, …).
 */
export interface VueTransformStats {
    filesAttempted: number;
    filesInjected: number;
    elementsTagged: number;
    skippedSfcError: number;
    skippedTemplateError: number;
    skippedWalkError: number;
    skippedSelfCheck: number;
    /** Sample of skipped file paths (capped at 50 to bound memory). */
    skippedPaths: string[];
}

export function createVueTransformStats(): VueTransformStats {
    return {
        filesAttempted: 0,
        filesInjected: 0,
        elementsTagged: 0,
        skippedSfcError: 0,
        skippedTemplateError: 0,
        skippedWalkError: 0,
        skippedSelfCheck: 0,
        skippedPaths: [],
    };
}

export interface VueTransformOptions {
    /**
     * When true (default), the transform re-parses its own output before
     * returning it. Catches MagicString offset bugs against malformed Vue
     * 2-era syntax before vue-loader ever sees them.
     */
    safeMode?: boolean;
    /**
     * When true, walk the AST and populate the componentMap as usual, but
     * always return null (no source injection). Used by the dry-run
     * coverage report.
     */
    dryRun?: boolean;
    /** Counters to update; ignored if omitted. */
    stats?: VueTransformStats;
}

const SKIP_PATH_CAP = 50;

type SkipKind = 'skippedSfcError' | 'skippedTemplateError' | 'skippedWalkError' | 'skippedSelfCheck';

function recordSkip(stats: VueTransformStats | undefined, kind: SkipKind, relPath: string): void {
    if (!stats) return;
    stats[kind] += 1;
    if (stats.skippedPaths.length < SKIP_PATH_CAP) {
        stats.skippedPaths.push(relPath);
    }
}

const ATTR_COMP = 'data-morphix-comp';
const ATTR_LOC = 'data-morphix-loc';

/** Node types from @vue/compiler-dom */
const NODE_ELEMENT = 1;

/**
 * Convert a filename (without extension) to PascalCase.
 * e.g. "my-component" → "MyComponent", "hello_world" → "HelloWorld"
 */
function toPascalCase(str: string): string {
    return str
        .replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}

/**
 * Resolve the component name from a Vue SFC.
 *
 * Priority:
 *   1. defineOptions({ name: '...' }) in <script setup>
 *   2. export default { name: '...' } in <script>
 *   3. PascalCase of filename (without .vue)
 *   4. If filename is index.vue, PascalCase of parent directory
 */
function resolveComponentName(
    descriptor: { script?: { content: string } | null; scriptSetup?: { content: string } | null },
    relPath: string,
): string | undefined {
    // 1. Check <script setup> for defineOptions({ name: '...' })
    if (descriptor.scriptSetup?.content) {
        const match = descriptor.scriptSetup.content.match(
            /defineOptions\s*\(\s*\{[^}]*name\s*:\s*['"]([^'"]+)['"]/,
        );
        if (match) return match[1];
    }

    // 2. Check <script> for export default { name: '...' }
    if (descriptor.script?.content) {
        const match = descriptor.script.content.match(
            /export\s+default\s*\{[^}]*name\s*:\s*['"]([^'"]+)['"]/,
        );
        if (match) return match[1];
    }

    // 3. Fallback to filename
    const parts = relPath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1];
    const basename = filename.replace(/\.vue$/, '');

    // 4. If index.vue, use parent directory name
    if (basename.toLowerCase() === 'index') {
        const parentDir = parts.length >= 2 ? parts[parts.length - 2] : undefined;
        if (parentDir) return toPascalCase(parentDir);
        return undefined;
    }

    return toPascalCase(basename);
}

function escapeAttr(value: string): string {
    return value.replace(/"/g, '&quot;');
}

interface TemplateNode {
    type: number;
    tag?: string;
    props?: Array<{ name: string }>;
    children?: TemplateNode[];
    loc: {
        start: { line: number; column: number; offset: number };
        end: { line: number; column: number; offset: number };
    };
}

/**
 * Inject `data-morphix-*` attributes into a raw Vue template HTML fragment.
 *
 * Used by the webpack pipeline to handle the `*.vue?vue&type=template` virtual
 * sub-module emitted by vue-loader. vue-loader's `templateLoader` will then
 * compile the (now-tagged) template into a render function, preserving the
 * attributes on every element vnode.
 *
 * `lineOffset` is added to every element's reported line number — pass the
 * 1-based line index where this template appears in the original `.vue` file
 * (so locations remain file-relative, not template-relative).
 */
export function transformVueTemplate(
    templateSource: string,
    relPath: string,
    componentName: string | undefined,
    componentMap: ComponentMap,
    lineOffset: number = 0,
    options: VueTransformOptions = {},
): { code: string; map?: object; taggedCount: number } | null {
    const safeMode = options.safeMode !== false;
    const stats = options.stats;
    if (stats) stats.filesAttempted++;

    let ast;
    try {
        ast = parseTemplate(templateSource);
    } catch (err) {
        console.warn(`[harnessa-fe] Failed to parse Vue template fragment: ${relPath}`, err);
        recordSkip(stats, 'skippedTemplateError', relPath);
        return null;
    }

    const magic = new MagicString(templateSource);
    let taggedCount = 0;

    function walkNode(node: TemplateNode): void {
        if (node.type === NODE_ELEMENT && node.tag) {
            const line = node.loc.start.line + lineOffset;
            const col = node.loc.start.column;
            const locValue = `${relPath}:${line}:${col}`;

            const hasLoc = node.props?.some((p) => p.name === ATTR_LOC) ?? false;
            const hasComp = node.props?.some((p) => p.name === ATTR_COMP) ?? false;

            const attrs: string[] = [];
            if (!hasLoc) attrs.push(`${ATTR_LOC}="${escapeAttr(locValue)}"`);
            if (!hasComp && componentName)
                attrs.push(`${ATTR_COMP}="${escapeAttr(componentName)}"`);

            if (attrs.length > 0) {
                // Position after the tag name in the original template fragment.
                const tagNameEnd = node.loc.start.offset + 1 + node.tag.length;
                magic.appendLeft(tagNameEnd, ' ' + attrs.join(' '));
                taggedCount++;
            }

            if (componentName) {
                const entries = componentMap.get(componentName) ?? [];
                entries.push({ file: relPath, line, col });
                componentMap.set(componentName, entries);
            }
        }
        if (node.children) for (const child of node.children) walkNode(child);
    }

    try {
        for (const child of ast.children) walkNode(child as TemplateNode);
    } catch (err) {
        console.warn(`[harnessa-fe] template walk failed in ${relPath}`, err);
        recordSkip(stats, 'skippedWalkError', relPath);
        return null;
    }

    if (taggedCount === 0) return null;

    const code = magic.toString();

    // SafeMode self-check: re-parse our output to make sure we didn't
    // produce something vue-loader will choke on. Cheap insurance — Vue 2
    // legacy syntax is the typical reason this fires.
    if (safeMode) {
        try {
            parseTemplate(code);
        } catch (err) {
            console.warn(
                `[harnessa-fe] safeMode dropped template injection in ${relPath} (self-check failed)`,
                err,
            );
            recordSkip(stats, 'skippedSelfCheck', relPath);
            return null;
        }
    }

    if (options.dryRun) {
        if (stats) stats.elementsTagged += taggedCount;
        return null;
    }

    if (stats) {
        stats.filesInjected++;
        stats.elementsTagged += taggedCount;
    }

    return {
        code,
        map: magic.generateMap({ hires: true, source: relPath, includeContent: true }),
        taggedCount,
    };
}

/**
 * Resolve the component name from a raw .vue source (used by webpack pipeline
 * where we only see the template sub-module and need to look up the parent's
 * component name from disk).
 */
export function resolveVueComponentName(source: string, relPath: string): string | undefined {
    try {
        const { descriptor } = parseSFC(source, { filename: relPath });
        return resolveComponentName(descriptor, relPath);
    } catch {
        return undefined;
    }
}

/**
 * Compute the 0-based line offset where the `<template>` *content* begins in
 * the original .vue file. Adding this to template-relative line numbers gives
 * file-relative numbers suitable for `data-morphix-loc`.
 *
 * Returns 0 if the SFC cannot be parsed or has no template block.
 */
export function getTemplateLineOffset(source: string, relPath: string): number {
    try {
        const { descriptor } = parseSFC(source, { filename: relPath });
        if (!descriptor.template) return 0;
        // descriptor.template.loc.start is 1-based and points at the FIRST char
        // INSIDE <template> (i.e., the character after the closing `>`).
        // We subtract 1 so that template-relative line 1 maps to that source line.
        return descriptor.template.loc.start.line - 1;
    } catch {
        return 0;
    }
}

export function transformVueSFC(
    source: string,
    relPath: string,
    componentMap: ComponentMap,
    options: VueTransformOptions = {},
): VueTransformResult | null {
    const safeMode = options.safeMode !== false;
    const stats = options.stats;
    if (stats) stats.filesAttempted++;

    let descriptor;
    try {
        const result = parseSFC(source, { filename: relPath });
        // Strict downgrade: if @vue/compiler-sfc surfaces any errors we don't
        // trust the offsets it reports either. Skip the file entirely so
        // vue-loader sees pristine source.
        if (result.errors.length > 0) {
            console.warn(`[harnessa-fe] Vue SFC parse errors in ${relPath}:`, result.errors);
            recordSkip(stats, 'skippedSfcError', relPath);
            return null;
        }
        descriptor = result.descriptor;
    } catch (err) {
        console.warn(`[harnessa-fe] Failed to parse Vue SFC: ${relPath}`, err);
        recordSkip(stats, 'skippedSfcError', relPath);
        return null;
    }

    if (!descriptor.template) return null;

    const componentName = resolveComponentName(descriptor, relPath);

    const templateContent = descriptor.template.content;
    let templateAst;
    try {
        templateAst = parseTemplate(templateContent);
    } catch (err) {
        console.warn(`[harnessa-fe] Failed to parse template in ${relPath}`, err);
        recordSkip(stats, 'skippedTemplateError', relPath);
        return null;
    }

    const magic = new MagicString(source);
    const templateOffset = descriptor.template.loc.start.offset;
    let taggedCount = 0;

    function walkNode(node: TemplateNode): void {
        if (node.type === NODE_ELEMENT && node.tag) {
            const line = node.loc.start.line;
            const col = node.loc.start.column;
            const locValue = `${relPath}:${line}:${col}`;

            const hasLoc = node.props?.some((p) => p.name === ATTR_LOC) ?? false;
            const hasComp = node.props?.some((p) => p.name === ATTR_COMP) ?? false;

            const attrs: string[] = [];
            if (!hasLoc) attrs.push(`${ATTR_LOC}="${escapeAttr(locValue)}"`);
            if (!hasComp && componentName)
                attrs.push(`${ATTR_COMP}="${escapeAttr(componentName)}"`);

            if (attrs.length > 0) {
                const tagNameEnd = templateOffset + node.loc.start.offset + 1 + node.tag.length;
                magic.appendLeft(tagNameEnd, ' ' + attrs.join(' '));
                taggedCount++;
            }

            if (componentName) {
                const entries = componentMap.get(componentName) ?? [];
                entries.push({ file: relPath, line, col });
                componentMap.set(componentName, entries);
            }
        }

        if (node.children) {
            for (const child of node.children) walkNode(child);
        }
    }

    try {
        for (const child of templateAst.children) walkNode(child as TemplateNode);
    } catch (err) {
        console.warn(`[harnessa-fe] SFC walk failed in ${relPath}`, err);
        recordSkip(stats, 'skippedWalkError', relPath);
        return null;
    }

    if (taggedCount === 0) return null;

    const code = magic.toString();

    if (safeMode) {
        try {
            const recheck = parseSFC(code, { filename: relPath });
            if (recheck.errors.length > 0) {
                console.warn(
                    `[harnessa-fe] safeMode dropped SFC injection in ${relPath} (self-check found errors)`,
                    recheck.errors,
                );
                recordSkip(stats, 'skippedSelfCheck', relPath);
                return null;
            }
        } catch (err) {
            console.warn(
                `[harnessa-fe] safeMode dropped SFC injection in ${relPath} (self-check threw)`,
                err,
            );
            recordSkip(stats, 'skippedSelfCheck', relPath);
            return null;
        }
    }

    if (options.dryRun) {
        if (stats) stats.elementsTagged += taggedCount;
        return null;
    }

    if (stats) {
        stats.filesInjected++;
        stats.elementsTagged += taggedCount;
    }

    return {
        code,
        map: magic.generateMap({ hires: true, source: relPath, includeContent: true }),
        taggedCount,
        componentName,
    };
}

/**
 * Format the stats counter for a human-readable shutdown report. Used by
 * the unplugin core's process-exit handler.
 */
export function formatVueTransformReport(stats: VueTransformStats): string {
    const lines = [
        '[harnessa-fe] Vue transform coverage report',
        `  files attempted:        ${stats.filesAttempted}`,
        `  files injected:         ${stats.filesInjected}`,
        `  elements tagged:        ${stats.elementsTagged}`,
        `  skipped (SFC error):    ${stats.skippedSfcError}`,
        `  skipped (template):     ${stats.skippedTemplateError}`,
        `  skipped (walk error):   ${stats.skippedWalkError}`,
        `  skipped (self-check):   ${stats.skippedSelfCheck}`,
    ];
    if (stats.skippedPaths.length > 0) {
        lines.push(`  first ${Math.min(stats.skippedPaths.length, 20)} skipped paths:`);
        for (const p of stats.skippedPaths.slice(0, 20)) lines.push(`    ${p}`);
    }
    return lines.join('\n');
}
