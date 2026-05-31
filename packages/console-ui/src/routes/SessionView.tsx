import { Link, useParams } from 'react-router-dom';
import { useApi } from '../lib/api';

interface StoreEvent {
    ts: number;
    t: string;
    d?: unknown;
}

export function SessionView() {
    const { id = '' } = useParams();
    const sid = encodeURIComponent(id);
    const summary = useApi<Record<string, unknown>>(id ? `/console/api/session/${sid}/summary` : null);
    const tail = useApi<StoreEvent[] | { error: string }>(id ? `/console/api/session/${sid}/tail?n=100` : null);

    const events = Array.isArray(tail.data) ? tail.data : [];

    return (
        <div className="animate-fade-in">
            <div className="mb-4 flex items-center gap-3">
                <Link to="/" className="text-sm text-accent-indigo hover:underline">← projects</Link>
                <h1 className="font-mono text-sm text-ink-secondary">{id}</h1>
                <button onClick={() => { summary.refetch(); tail.refetch(); }} className="ml-auto rounded-md border border-surface-border px-2.5 py-1 text-xs text-ink-secondary hover:text-ink-primary">
                    Refresh
                </button>
            </div>

            <section className="mb-4 rounded-lg border border-surface-border bg-surface-raised p-3">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Summary</h2>
                {summary.error && <p className="text-sm text-accent-rose">{summary.error}</p>}
                <pre className="overflow-x-auto text-xs text-ink-secondary">{summary.data ? JSON.stringify(summary.data, null, 2) : '…'}</pre>
            </section>

            <section className="rounded-lg border border-surface-border bg-surface-raised p-3">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">Timeline ({events.length})</h2>
                {tail.error && <p className="text-sm text-accent-rose">{tail.error}</p>}
                <ul className="space-y-0.5 font-mono text-xs">
                    {events.map((e, i) => (
                        <li key={i} className="flex gap-2 border-b border-surface-border/40 py-0.5">
                            <span className="w-20 shrink-0 text-ink-muted">{new Date(e.ts).toLocaleTimeString()}</span>
                            <span className="w-24 shrink-0 text-accent-indigo">{e.t}</span>
                            <span className="truncate text-ink-secondary">{typeof e.d === 'object' ? JSON.stringify(e.d) : String(e.d ?? '')}</span>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}
