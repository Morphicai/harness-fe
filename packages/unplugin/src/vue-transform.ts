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
): { code: string; map?: object; taggedCount: number } | null {
    let ast;
    try {
        ast = parseTemplate(templateSource);
    } catch (err) {
        console.warn(`[harnessa-fe] Failed to parse Vue template fragment: ${relPath}`, err);
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

    for (const child of ast.children) walkNode(child as TemplateNode);

    if (taggedCount === 0) return null;

    return {
        code: magic.toString(),
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
): VueTransformResult | null {
    // Parse the SFC
    let descriptor;
    try {
        const result = parseSFC(source, { filename: relPath });
        if (result.errors.length > 0) {
            console.warn(`[harnessa-fe] Vue SFC parse errors in ${relPath}:`, result.errors);
        }
        descriptor = result.descriptor;
    } catch (err) {
        console.warn(`[harnessa-fe] Failed to parse Vue SFC: ${relPath}`, err);
        return null;
    }

    // Must have a template block
    if (!descriptor.template) {
        return null;
    }

    const componentName = resolveComponentName(descriptor, relPath);

    // Parse the template AST using @vue/compiler-dom
    const templateContent = descriptor.template.content;
    let templateAst;
    try {
        templateAst = parseTemplate(templateContent);
    } catch (err) {
        console.warn(`[harnessa-fe] Failed to parse template in ${relPath}`, err);
        return null;
    }

    const magic = new MagicString(source);
    const templateOffset = descriptor.template.loc.start.offset;
    let taggedCount = 0;

    // Walk the AST and inject attributes on element nodes
    function walkNode(node: TemplateNode): void {
        if (node.type === NODE_ELEMENT && node.tag) {
            const line = node.loc.start.line;
            const col = node.loc.start.column;
            const locValue = `${relPath}:${line}:${col}`;

            // Check if attributes already exist
            const hasLoc = node.props?.some((p) => p.name === ATTR_LOC) ?? false;
            const hasComp = node.props?.some((p) => p.name === ATTR_COMP) ?? false;

            const attrs: string[] = [];
            if (!hasLoc) {
                attrs.push(`${ATTR_LOC}="${escapeAttr(locValue)}"`);
            }
            if (!hasComp && componentName) {
                attrs.push(`${ATTR_COMP}="${escapeAttr(componentName)}"`);
            }

            if (attrs.length > 0) {
                // Insert after the tag name in the original source
                // The tag starts at node.loc.start.offset in the template content
                // In the full source, add templateOffset
                const tagNameEnd = templateOffset + node.loc.start.offset + 1 + node.tag.length; // +1 for '<'
                magic.appendLeft(tagNameEnd, ' ' + attrs.join(' '));
                taggedCount++;
            }

            // Register in component map
            if (componentName) {
                const entries = componentMap.get(componentName) ?? [];
                entries.push({ file: relPath, line, col });
                componentMap.set(componentName, entries);
            }
        }

        // Recurse into children
        if (node.children) {
            for (const child of node.children) {
                walkNode(child);
            }
        }
    }

    for (const child of templateAst.children) {
        walkNode(child as TemplateNode);
    }

    if (taggedCount === 0) return null;

    return {
        code: magic.toString(),
        map: magic.generateMap({ hires: true, source: relPath, includeContent: true }),
        taggedCount,
        componentName,
    };
}
