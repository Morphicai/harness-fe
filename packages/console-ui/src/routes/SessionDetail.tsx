import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    ConsoleEntry,
    ErrorEntry,
    NetworkEntry,
} from '@harness-fe/protocol';
import { apiPost, useApi } from '../hooks/useApi';
import { useLiveBridge } from '../hooks/useLiveBridge';
import { Header } from '../components/Header';
import { TagBadge } from '../components/TagBadge';
import { JsonTree } from '../components/JsonTree';
import { fmtBytes, fmtDur, fmtRelative, fmtTs } from '../lib/fmt';
import type { ReplayCreateResult, SessionDetail as SessionDetailShape, StoreEvent } from '../lib/types';

/** Real, wire-verified event types (see lib/types.ts StoreEventType) — the
 * filter chip row and per-type renderers below are keyed on these. */
const ALL_TYPES = [
    'network',
    'console',
    'error',
    'storage',
    'ws',
    'navigation',
    'globals',
    'indexeddb',
    'load',
    'rrweb',
    'cmd',
    'resp',
    'app-log',
    'hmr',
    'node:log',
    'node:err',
] as const;

export function SessionDetail() {
    const { id } = useParams<{ id: string }>();
    const sessionId = id ?? '';
    const [selectedTypes, setSelectedTypes] = useState<Set<string>>(() => new Set(ALL_TYPES));
    const toggleType = useCallback((t: string) => {
        setSelectedTypes((prev) => {
            const next = new Set(prev);
            if (next.has(t)) {
                if (next.size === 1) return prev; // keep at least one type selected
                next.delete(t);
            } else {
                next.add(t);
            }
            return next;
        });
    }, []);
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [query]);
    const typeQuery = useMemo(
        () =>
            selectedTypes.size < ALL_TYPES.length
                ? `type=${[...selectedTypes].join(',')}`
                : '',
        [selectedTypes],
    );
    const searchQuery = useMemo(
        () => (debouncedQuery ? `q=${encodeURIComponent(debouncedQuery)}` : ''),
        [debouncedQuery],
    );
    const queryString = [typeQuery, searchQuery].filter(Boolean).join('&');
    const { data, error, loading, refetch } = useApi<SessionDetailShape>(
        sessionId
            ? `/console/api/sessions/${encodeURIComponent(sessionId)}${queryString ? `?${queryString}` : ''}`
            : null,
    );

    useLiveBridge(
        useCallback(
            (frame) => {
                if (frame.sessionId !== sessionId) return;
                if (
                    frame.kind === 'session.update' ||
                    frame.kind === 'session.closed' ||
                    frame.kind === 'export.new'
                ) {
                    refetch();
                }
            },
            [sessionId, refetch],
        ),
    );

    return (
        <div className="min-h-screen flex flex-col">
            <Header
                crumb={
                    <code className="font-mono text-xs text-ink-primary px-2 py-0.5 rounded bg-surface-raised border border-surface-border">
                        {sessionId.slice(0, 8)}…
                    </code>
                }
            />
            <main className="flex-1 px-6 py-8 max-w-6xl mx-auto w-full space-y-6">
                {error ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-rose-200 text-sm animate-fade-in">
                        {error}{' '}
                        <Link to="/" className="ml-2 text-accent-indigo hover:underline">
                            ← back
                        </Link>
                    </div>
                ) : null}
                {loading && !data ? (
                    <div className="space-y-6 animate-pulse">
                        <div className="h-32 rounded-xl bg-surface-raised border border-surface-border" />
                        <div className="h-48 rounded-xl bg-surface-raised border border-surface-border" />
                    </div>
                ) : data ? (
                    <>
                        <SessionHeaderCard detail={data} />
                        <TabsSection detail={data} onReplayCreated={refetch} />
                        <RecordingsSection detail={data} />
                        <TimelineSection
                            detail={data}
                            selectedTypes={selectedTypes}
                            onToggleType={toggleType}
                            query={query}
                            onQueryChange={setQuery}
                        />
                        <ExportsSection detail={data} />
                    </>
                ) : null}
            </main>
        </div>
    );
}

function SessionHeaderCard({ detail }: { detail: SessionDetailShape }) {
    const { session, summary } = detail;
    const live = !session.endedAt;
    const counts = Object.entries(summary.counts).filter(([, n]) => n && n > 0);
    return (
        <section className="rounded-xl border border-surface-border bg-surface-raised p-5 shadow-soft animate-fade-in">
            <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-lg font-medium tracking-tight">Session</h1>
                <code className="font-mono text-xs text-ink-secondary truncate">{session.id}</code>
                {live ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent-emerald/10 border border-accent-emerald/30 text-[10px] text-accent-emerald font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald animate-pulse-live" />
                        live
                    </span>
                ) : (
                    <span className="text-[10px] uppercase tracking-wide text-ink-muted">closed</span>
                )}
            </div>
            <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <Field label="Project">
                    <code className="font-mono">{session.participants[0]?.projectId ?? '—'}</code>
                </Field>
                <Field label="Tab">
                    <code className="font-mono">{session.tabId}</code>
                </Field>
                <Field label="Started">
                    {fmtTs(session.startedAt)}
                    <div className="text-ink-muted text-[11px]">{fmtRelative(session.startedAt)}</div>
                </Field>
                <Field label="Last activity">
                    {summary.lastActivity ? fmtRelative(summary.lastActivity) : '—'}
                </Field>
                {session.url ? (
                    <Field label="URL" className="col-span-2 sm:col-span-4 break-all">
                        <span className="font-mono text-ink-primary text-[11px]">{session.url}</span>
                    </Field>
                ) : null}
            </dl>
            {counts.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    {counts.map(([tag, n]) => (
                        <div key={tag} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-sunken border border-surface-border">
                            <TagBadge tag={tag} />
                            <span className="font-mono text-xs text-ink-primary">{n}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </section>
    );
}

function Field({
    label,
    children,
    className,
}: {
    label: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={className}>
            <dt className="text-ink-muted uppercase tracking-wide text-[10px]">{label}</dt>
            <dd className="mt-1 text-ink-primary">{children}</dd>
        </div>
    );
}

function TabsSection({
    detail,
    onReplayCreated,
}: {
    detail: SessionDetailShape;
    onReplayCreated: () => void;
}) {
    const { session, chunks } = detail;
    const byTab = new Map<string, typeof chunks>();
    for (const c of chunks) {
        const arr = byTab.get(c.tabId) ?? [];
        arr.push(c);
        byTab.set(c.tabId, arr);
    }
    const rows = Array.from(byTab.entries()).map(([tabId, items]) => ({
        tabId,
        items: [...items].sort((a, b) => a.startTs - b.startTs),
    }));
    if (rows.length === 0) {
        rows.push({ tabId: session.tabId, items: [] });
    }
    return (
        <Section title="Tabs & recordings">
            <table className="w-full text-sm">
                <thead className="text-ink-muted text-[10px] uppercase tracking-wide">
                    <tr className="text-left">
                        <th className="font-medium px-4 py-2">Tab</th>
                        <th className="font-medium px-4 py-2">Coverage</th>
                        <th className="font-medium px-4 py-2 text-right">Replay</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                    {rows.map(({ tabId, items }) => (
                        <TabRow
                            key={tabId}
                            sessionId={session.id}
                            tabId={tabId}
                            items={items}
                            onReplayCreated={onReplayCreated}
                        />
                    ))}
                </tbody>
            </table>
        </Section>
    );
}

function TabRow({
    sessionId,
    tabId,
    items,
    onReplayCreated,
}: {
    sessionId: string;
    tabId: string;
    items: SessionDetailShape['chunks'];
    onReplayCreated: () => void;
}) {
    const [status, setStatus] = useState<'idle' | 'creating' | 'done'>('idle');
    const [error, setError] = useState<string | undefined>(undefined);
    const [url, setUrl] = useState<string | undefined>(undefined);
    if (items.length === 0) {
        return (
            <tr>
                <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{tabId}</td>
                <td className="px-4 py-3 text-ink-muted text-sm">no recording yet</td>
                <td className="px-4 py-3" />
            </tr>
        );
    }
    const first = items[0];
    const last = items[items.length - 1];
    const cover = `${fmtTs(first.startTs)} → ${fmtDur(last.endTs - first.startTs)}`;

    const submit = async () => {
        setStatus('creating');
        setError(undefined);
        try {
            const result = await apiPost<unknown, ReplayCreateResult>(
                `/console/api/sessions/${encodeURIComponent(sessionId)}/replay`,
                {
                    tabId,
                    since: first.startTs,
                    until: last.endTs,
                },
            );
            if (result.error || !result.exportId) {
                setError(result.error ?? 'unknown error');
                setStatus('idle');
                return;
            }
            setUrl(`/replay/${result.exportId}`);
            setStatus('done');
            onReplayCreated();
        } catch (err) {
            setError((err as Error).message);
            setStatus('idle');
        }
    };

    return (
        <tr className="transition-colors hover:bg-surface-sunken">
            <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{tabId}</td>
            <td className="px-4 py-3 text-ink-primary text-sm">
                {cover}
                <div className="text-ink-muted text-xs">{items.length} chunks</div>
            </td>
            <td className="px-4 py-3 text-right">
                {status === 'done' && url ? (
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-indigo/10 border border-accent-indigo/40 text-accent-indigo text-xs font-medium hover:bg-accent-indigo/20 transition-colors"
                    >
                        ▶ Open replay
                    </a>
                ) : (
                    <button
                        onClick={submit}
                        disabled={status === 'creating'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-sunken border border-surface-border text-ink-primary text-xs font-medium hover:border-surface-border-strong hover:bg-surface-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {status === 'creating' ? 'Creating…' : '▶ Create replay'}
                    </button>
                )}
                {error ? <div className="mt-1 text-[10px] text-rose-400">{error}</div> : null}
            </td>
        </tr>
    );
}

function RecordingsSection({ detail }: { detail: SessionDetailShape }) {
    const { chunks } = detail;
    return (
        <Section title={`Recording chunks (${chunks.length})`}>
            {chunks.length === 0 ? (
                <Empty>No rrweb chunks captured yet.</Empty>
            ) : (
                <table className="w-full text-sm">
                    <thead className="text-ink-muted text-[10px] uppercase tracking-wide">
                        <tr className="text-left">
                            <th className="font-medium px-4 py-2">Chunk</th>
                            <th className="font-medium px-4 py-2">Tab</th>
                            <th className="font-medium px-4 py-2">Start</th>
                            <th className="font-medium px-4 py-2">Duration</th>
                            <th className="font-medium px-4 py-2 text-right">Events</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                        {chunks.map((c) => (
                            <tr key={c.chunkId} className="transition-colors hover:bg-surface-sunken">
                                <td className="px-4 py-2 font-mono text-xs text-ink-secondary">{c.chunkId}</td>
                                <td className="px-4 py-2 font-mono text-xs text-ink-muted">{c.tabId}</td>
                                <td className="px-4 py-2 text-ink-primary text-xs">{fmtTs(c.startTs)}</td>
                                <td className="px-4 py-2 text-ink-primary text-xs">{fmtDur(c.endTs - c.startTs)}</td>
                                <td className="px-4 py-2 text-ink-primary text-xs text-right font-mono">{c.eventCount}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Section>
    );
}

function TimelineSection({
    detail,
    selectedTypes,
    onToggleType,
    query,
    onQueryChange,
}: {
    detail: SessionDetailShape;
    selectedTypes: Set<string>;
    onToggleType: (t: string) => void;
    query: string;
    onQueryChange: (q: string) => void;
}) {
    const { timeline } = detail;
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const toggleExpanded = (i: number) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });
    };
    return (
        <Section title={`Timeline (last ${timeline.length})`}>
            <div className="px-4 py-2.5 border-b border-surface-border">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Search this session's events…"
                    className="w-full px-3 py-1.5 rounded-md bg-surface-sunken border border-surface-border text-ink-primary text-xs font-mono placeholder:text-ink-muted focus:outline-none focus:border-accent-indigo/50 transition-colors"
                />
            </div>
            <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b border-surface-border">
                {ALL_TYPES.map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => onToggleType(t)}
                        className={`transition-opacity ${selectedTypes.has(t) ? '' : 'opacity-30'}`}
                    >
                        <TagBadge tag={t} />
                    </button>
                ))}
            </div>
            {timeline.length === 0 ? (
                <Empty>Timeline is empty.</Empty>
            ) : (
                <ul className="divide-y divide-surface-border max-h-[480px] overflow-y-auto scrollbar-thin">
                    {[...timeline].reverse().map((ev, i) => (
                        <li key={i} className="transition-colors hover:bg-surface-sunken">
                            <button
                                type="button"
                                onClick={() => toggleExpanded(i)}
                                className="w-full px-4 py-2 flex items-start gap-3 text-sm text-left"
                            >
                                <TagBadge tag={ev.t} />
                                <span className="text-ink-muted text-xs whitespace-nowrap font-mono">
                                    {fmtTs(ev.ts)}
                                </span>
                                <span className="flex-1 text-ink-secondary text-[11px] font-mono whitespace-pre-wrap break-all overflow-hidden">
                                    {summarize(ev)}
                                </span>
                            </button>
                            {expanded.has(i) ? (
                                <div className="px-4 pb-3 pl-[4.5rem]">
                                    <ExpandedDetail ev={ev} />
                                </div>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}

/** Strip the always-present, never-meaningful "Error" header line that
 * `captureInitiator()` used to prepend (sandbox/src/initiator.ts). Applied
 * on render too — not just fixed at the source — since already-persisted
 * sessions have the bad prefix baked into stored JSONL forever. */
function stripErrorHeader(stack: string): string {
    const lines = stack.split('\n');
    if (lines[0]?.trim() === 'Error') return lines.slice(1).join('\n');
    return stack;
}

function digest(d: unknown): string {
    if (d == null) return '';
    try {
        const s = JSON.stringify(d);
        return s.length > 280 ? s.slice(0, 280) + '…' : s;
    } catch {
        return String(d);
    }
}

function formatConsoleArgs(args: unknown): string {
    if (!Array.isArray(args)) return '';
    return args
        .map((a) => (typeof a === 'string' ? a : digest(a)))
        .join(' ');
}

function summarize(ev: StoreEvent): string {
    const d = ev.d as Record<string, unknown> | undefined;
    switch (ev.t) {
        case 'network': {
            const n = d as unknown as NetworkEntry | undefined;
            if (!n) return '';
            if (n.phase === 'res') {
                const timing = n.durationMs != null ? ` (${n.durationMs}ms)` : '';
                return `${n.method ?? '?'} ${n.url ?? ''} → ${n.status ?? '?'}${timing}`;
            }
            return `${n?.method ?? '?'} ${n?.url ?? ''}`;
        }
        case 'console': {
            const c = d as unknown as ConsoleEntry | undefined;
            return `[${c?.level ?? 'log'}] ${formatConsoleArgs(c?.args)}`;
        }
        case 'error': {
            const e = d as unknown as ErrorEntry | undefined;
            return e?.message ?? 'error';
        }
        case 'storage':
            return `${d?.op ?? '?'} ${d?.which ?? ''}.${d?.key ?? ''}`;
        case 'ws':
            return `${d?.phase ?? '?'} ${d?.url ?? ''}`;
        case 'navigation':
            return `${d?.kind ?? '?'} ${d?.url ?? ''}`;
        case 'globals':
            return `${d?.op ?? '?'} window.${d?.key ?? ''}`;
        case 'indexeddb':
            return `${d?.op ?? '?'} ${d?.db ?? ''}${d?.store ? `.${d.store}` : ''}`;
        default:
            return digest(d);
    }
}

function ExpandedDetail({ ev }: { ev: StoreEvent }) {
    const d = ev.d as Record<string, unknown> | undefined;
    switch (ev.t) {
        case 'network':
            return <NetworkDetail entry={d as unknown as NetworkEntry} />;
        case 'console': {
            const c = d as unknown as ConsoleEntry | undefined;
            return <JsonTree value={c?.args} />;
        }
        case 'error': {
            const e = d as unknown as ErrorEntry | undefined;
            return (
                <div className="space-y-2">
                    {e?.source ? (
                        <div className="text-ink-muted text-[11px] font-mono">{e.source}</div>
                    ) : null}
                    {e?.stack ? (
                        <pre className="text-[11px] font-mono text-ink-secondary whitespace-pre-wrap break-all">
                            {stripErrorHeader(e.stack)}
                        </pre>
                    ) : null}
                </div>
            );
        }
        default:
            return <JsonTree value={ev.d} />;
    }
}

function NetworkDetail({ entry }: { entry: NetworkEntry | undefined }) {
    if (!entry) return null;
    const initiatorStack = entry.initiator?.stack;
    return (
        <div className="space-y-3">
            {initiatorStack ? (
                <pre className="text-[11px] font-mono text-ink-muted whitespace-pre-wrap break-all">
                    {stripErrorHeader(initiatorStack)}
                </pre>
            ) : null}
            {entry.phase === 'req' ? (
                <DetailField label="Request">
                    {entry.requestHeaders ? <JsonTree value={entry.requestHeaders} /> : null}
                    {entry.requestBody !== undefined ? (
                        <JsonTree value={entry.requestBody} />
                    ) : null}
                    {entry.requestBodyTruncated ? (
                        <div className="text-ink-muted text-[10px]">(body truncated)</div>
                    ) : null}
                </DetailField>
            ) : (
                <DetailField
                    label={`Response${entry.status != null ? ` — ${entry.status}` : ''}${
                        entry.durationMs != null ? ` (${entry.durationMs}ms)` : ''
                    }`}
                >
                    {entry.error ? (
                        <div className="text-rose-400 text-[11px] font-mono">{entry.error}</div>
                    ) : null}
                    {entry.responseHeaders ? <JsonTree value={entry.responseHeaders} /> : null}
                    {entry.responseBody !== undefined ? (
                        <JsonTree value={entry.responseBody} />
                    ) : null}
                    {entry.responseBodyTruncated ? (
                        <div className="text-ink-muted text-[10px]">(body truncated)</div>
                    ) : null}
                </DetailField>
            )}
        </div>
    );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-ink-muted uppercase tracking-wide text-[10px] mb-1">{label}</div>
            {children}
        </div>
    );
}

function ExportsSection({ detail }: { detail: SessionDetailShape }) {
    const { exports } = detail;
    return (
        <Section title={`Replay exports (${exports.length})`}>
            {exports.length === 0 ? (
                <Empty>No replay exports yet for this session.</Empty>
            ) : (
                <table className="w-full text-sm">
                    <thead className="text-ink-muted text-[10px] uppercase tracking-wide">
                        <tr className="text-left">
                            <th className="font-medium px-4 py-2">Export</th>
                            <th className="font-medium px-4 py-2">Window</th>
                            <th className="font-medium px-4 py-2">Events</th>
                            <th className="font-medium px-4 py-2 text-right">Size</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                        {exports.map((e) => (
                            <tr key={e.exportId} className="transition-colors hover:bg-surface-sunken">
                                <td className="px-4 py-2 font-mono text-xs">
                                    <a
                                        href={`/replay/${e.exportId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent-indigo hover:underline"
                                    >
                                        {e.exportId}
                                    </a>
                                </td>
                                <td className="px-4 py-2 text-ink-primary text-xs">
                                    {fmtTs(e.startTs)} → {fmtDur(e.endTs - e.startTs)}
                                </td>
                                <td className="px-4 py-2 text-ink-primary text-xs">{e.eventCount}</td>
                                <td className="px-4 py-2 text-ink-primary text-xs text-right font-mono">
                                    {fmtBytes(e.bytes)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Section>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-surface-border bg-surface-raised overflow-hidden shadow-soft animate-fade-in">
            <header className="px-5 py-3 border-b border-surface-border bg-surface-sunken text-[11px] uppercase tracking-wide text-ink-muted">
                {title}
            </header>
            {children}
        </section>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <div className="px-5 py-6 text-sm text-ink-muted text-center">{children}</div>;
}
