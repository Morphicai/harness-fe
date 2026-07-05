/**
 * Dependency-free recursive JSON tree viewer.
 *
 * No JSON-tree/syntax-highlighter library exists in this package (or is
 * transitively available) — this is intentionally hand-rolled to match the
 * "no component library beyond Tailwind" convention already established here.
 *
 * Safe by construction: values rendered here always originate from
 * JSON.parse'd JSONL lines, so there is no circular-reference risk — only
 * depth/size guards are needed for pathologically large payloads.
 */
import { useState } from 'react';

const MAX_DEPTH = 12;

interface JsonTreeProps {
    value: unknown;
    depth?: number;
    /** Nodes at a shallower depth than this render expanded by default. */
    maxAutoExpandDepth?: number;
    /** Arrays longer than this show a "+N more" footer instead of every item. */
    maxArrayItems?: number;
}

export function JsonTree({
    value,
    depth = 0,
    maxAutoExpandDepth = 1,
    maxArrayItems = 50,
}: JsonTreeProps) {
    if (depth >= MAX_DEPTH) {
        return <span className="text-ink-muted">…</span>;
    }

    if (value === null) return <Primitive cls="text-accent-indigo">null</Primitive>;
    if (value === undefined) return <Primitive cls="text-ink-muted">undefined</Primitive>;

    switch (typeof value) {
        case 'string':
            return <Primitive cls="text-accent-emerald">{JSON.stringify(value)}</Primitive>;
        case 'number':
        case 'bigint':
            return <Primitive cls="text-accent-amber">{String(value)}</Primitive>;
        case 'boolean':
            return <Primitive cls="text-accent-indigo">{String(value)}</Primitive>;
        case 'function':
            return <Primitive cls="text-ink-muted">ƒ()</Primitive>;
        default:
            break;
    }

    if (Array.isArray(value)) {
        return (
            <Collapsible
                depth={depth}
                maxAutoExpandDepth={maxAutoExpandDepth}
                openBracket="["
                closeBracket="]"
                emptyLabel="[]"
                isEmpty={value.length === 0}
                summary={`Array(${value.length})`}
            >
                {value.slice(0, maxArrayItems).map((item, i) => (
                    <Row key={i} label={String(i)}>
                        <JsonTree
                            value={item}
                            depth={depth + 1}
                            maxAutoExpandDepth={maxAutoExpandDepth}
                            maxArrayItems={maxArrayItems}
                        />
                    </Row>
                ))}
                {value.length > maxArrayItems ? (
                    <div className="text-ink-muted text-[11px] pl-4 py-0.5">
                        +{value.length - maxArrayItems} more
                    </div>
                ) : null}
            </Collapsible>
        );
    }

    // object
    const entries = Object.entries(value as Record<string, unknown>);
    return (
        <Collapsible
            depth={depth}
            maxAutoExpandDepth={maxAutoExpandDepth}
            openBracket="{"
            closeBracket="}"
            emptyLabel="{}"
            isEmpty={entries.length === 0}
            summary={`Object(${entries.length})`}
        >
            {entries.map(([k, v]) => (
                <Row key={k} label={k}>
                    <JsonTree
                        value={v}
                        depth={depth + 1}
                        maxAutoExpandDepth={maxAutoExpandDepth}
                        maxArrayItems={maxArrayItems}
                    />
                </Row>
            ))}
        </Collapsible>
    );
}

function Primitive({ cls, children }: { cls: string; children: React.ReactNode }) {
    return <span className={`font-mono text-[11px] ${cls}`}>{children}</span>;
}

function Collapsible({
    depth,
    maxAutoExpandDepth,
    openBracket,
    closeBracket,
    emptyLabel,
    isEmpty,
    summary,
    children,
}: {
    depth: number;
    maxAutoExpandDepth: number;
    openBracket: string;
    closeBracket: string;
    emptyLabel: string;
    isEmpty: boolean;
    summary: string;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(depth < maxAutoExpandDepth);

    if (isEmpty) {
        return <span className="font-mono text-[11px] text-ink-muted">{emptyLabel}</span>;
    }

    return (
        <span>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={open ? 'Collapse' : 'Expand'}
                className="font-mono text-[11px] text-ink-muted hover:text-ink-primary transition-colors"
            >
                <span className="inline-block w-3">{open ? '▾' : '▸'}</span>
                {open ? openBracket : `${openBracket} ${summary} ${closeBracket}`}
            </button>
            {open ? (
                <>
                    <div className="pl-4 border-l border-surface-border ml-1">{children}</div>
                    <span className="font-mono text-[11px] text-ink-muted">{closeBracket}</span>
                </>
            ) : null}
        </span>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-1.5 py-0.5">
            <span className="font-mono text-[11px] text-ink-secondary shrink-0">{label}:</span>
            {children}
        </div>
    );
}
