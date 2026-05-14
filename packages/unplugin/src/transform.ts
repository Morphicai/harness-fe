/**
 * JSX transform: parse a .tsx / .jsx file and inject:
 *   - `data-morphix-loc="<relPath>:<line>:<col>"` on every JSX opening element
 *   - `data-morphix-comp="<ComponentName>"` on JSX opening elements that are
 *     enclosed (transitively) by a top-level component definition. The
 *     component name comes from the nearest enclosing function/class/variable
 *     declaration whose name starts with an uppercase letter (PascalCase).
 *
 * Output is the original source with the attribute strings spliced in via
 * MagicString — keeps source maps intact and avoids re-generating the file.
 *
 * Side effect: every successfully scanned file contributes entries to the
 * supplied `componentMap`: name → list of locations (file:line:col).
 */

import { parse } from '@babel/parser';
import traverseDefault from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import MagicString from 'magic-string';

// @babel/traverse exposes its default as `default` only when published as ESM
// in older versions; later versions also expose a named export. Pick whichever
// is callable.
const traverse: typeof traverseDefault =
    typeof traverseDefault === 'function'
        ? traverseDefault
        : ((traverseDefault as unknown as { default: typeof traverseDefault }).default ?? traverseDefault);

export interface ComponentLocation {
    file: string;
    line: number;
    col: number;
}

export type ComponentMap = Map<string, ComponentLocation[]>;

export interface TransformResult {
    code: string;
    map?: object;
    /** Number of JSX elements that got attributes. */
    taggedCount: number;
}

const ATTR_COMP = 'data-morphix-comp';
const ATTR_LOC = 'data-morphix-loc';

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

export function transformJsx(
    source: string,
    relPath: string,
    componentMap: ComponentMap,
): TransformResult | null {
    let ast;
    try {
        ast = parse(source, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript'],
            errorRecovery: true,
        });
    } catch {
        return null;
    }

    const magic = new MagicString(source);
    let taggedCount = 0;

    traverse(ast, {
        JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
            const node = path.node;
            const start = node.start;
            if (start == null) return;
            // Position attribute insertion right after the tag name token.
            const name = node.name;
            const nameEnd = name.end;
            if (nameEnd == null) return;

            const loc = node.loc?.start;
            if (!loc) return;
            const locValue = `${relPath}:${loc.line}:${loc.column}`;
            const enclosingName = findEnclosingComponentName(path);
            const explicitName = getStringAttribute(node, ATTR_COMP);

            const attrs: string[] = [];
            if (!hasAttribute(node, ATTR_LOC)) {
                attrs.push(`${ATTR_LOC}="${escapeAttr(locValue)}"`);
            }
            if (!explicitName && enclosingName) {
                attrs.push(`${ATTR_COMP}="${escapeAttr(enclosingName)}"`);
            }

            // Register every name that ends up on this element into the map —
            // both enclosing component (so e.g. App resolves) and any
            // hand-written tag (so IncrementBtn / EchoInput resolve too).
            const names = new Set<string>();
            if (enclosingName) names.add(enclosingName);
            if (explicitName) names.add(explicitName);
            for (const name of names) {
                const entries = componentMap.get(name) ?? [];
                entries.push({ file: relPath, line: loc.line, col: loc.column });
                componentMap.set(name, entries);
            }

            if (!attrs.length) return;
            // Insert: <Foo ATTRS … >
            magic.appendLeft(nameEnd, ' ' + attrs.join(' '));
            taggedCount++;
        },
    });

    if (taggedCount === 0) return null;

    return {
        code: magic.toString(),
        map: magic.generateMap({ hires: true, source: relPath, includeContent: true }),
        taggedCount,
    };
}

function getStringAttribute(node: t.JSXOpeningElement, name: string): string | undefined {
    for (const attr of node.attributes) {
        if (
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === name &&
            attr.value &&
            attr.value.type === 'StringLiteral'
        ) {
            return attr.value.value;
        }
    }
    return undefined;
}

function hasAttribute(node: t.JSXOpeningElement, name: string): boolean {
    for (const attr of node.attributes) {
        if (
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === name
        ) {
            return true;
        }
    }
    return false;
}

function findEnclosingComponentName(path: NodePath<t.JSXOpeningElement>): string | undefined {
    let current: NodePath | null = path.parentPath;
    while (current) {
        const node = current.node;
        // function Foo() { return <jsx/> }
        if (t.isFunctionDeclaration(node) && node.id && PASCAL_CASE.test(node.id.name)) {
            return node.id.name;
        }
        // const Foo = (...) => <jsx/>
        // const Foo = function (...) { return <jsx/> }
        if (
            (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) &&
            current.parentPath &&
            t.isVariableDeclarator(current.parentPath.node) &&
            t.isIdentifier(current.parentPath.node.id) &&
            PASCAL_CASE.test(current.parentPath.node.id.name)
        ) {
            return current.parentPath.node.id.name;
        }
        // class Foo extends Component { render() { return <jsx/> } }
        if (t.isClassDeclaration(node) && node.id && PASCAL_CASE.test(node.id.name)) {
            return node.id.name;
        }
        // export default function Foo() ...
        if (
            t.isExportDefaultDeclaration(node) &&
            t.isFunctionDeclaration(node.declaration) &&
            node.declaration.id &&
            PASCAL_CASE.test(node.declaration.id.name)
        ) {
            return node.declaration.id.name;
        }
        current = current.parentPath;
    }
    return undefined;
}

function escapeAttr(value: string): string {
    return value.replace(/"/g, '&quot;');
}
