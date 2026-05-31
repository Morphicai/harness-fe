import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';

interface SessionMeta {
    id: string;
    url?: string;
    title?: string;
    startedAt: number;
    endedAt?: number;
}
interface ProjectEntry {
    id: string;
    displayName?: string;
    recentSessions: SessionMeta[];
}

function ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
}

export function ProjectList() {
    const { data, error, loading, refetch } = useApi<ProjectEntry[]>('/console/api/projects');

    return (
        <div className="animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
                <h1 className="text-lg font-semibold">Projects</h1>
                <button onClick={refetch} className="rounded-md border border-surface-border px-2.5 py-1 text-xs text-ink-secondary hover:text-ink-primary">
                    Refresh
                </button>
            </div>
            {loading && <p className="text-sm text-ink-muted">Loading…</p>}
            {error && <p className="text-sm text-accent-rose">Error: {error}</p>}
            {data && data.length === 0 && <p className="text-sm text-ink-muted">No projects yet. Connect a runtime to a project.</p>}
            <div className="space-y-4">
                {data?.map((p) => (
                    <section key={p.id} className="rounded-lg border border-surface-border bg-surface-raised p-3">
                        <h2 className="mb-2 font-mono text-sm">
                            {p.displayName ?? p.id}
                            <span className="ml-2 text-xs text-ink-muted">{p.id}</span>
                        </h2>
                        {p.recentSessions.length === 0 ? (
                            <p className="text-xs text-ink-muted">no recent sessions</p>
                        ) : (
                            <ul className="space-y-1">
                                {p.recentSessions.map((s) => (
                                    <li key={s.id}>
                                        <Link to={`/session/${encodeURIComponent(s.id)}`} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-sunken">
                                            <span className={`h-1.5 w-1.5 rounded-full ${s.endedAt ? 'bg-ink-muted' : 'bg-accent-emerald'}`} />
                                            <span className="truncate text-ink-secondary">{s.title || s.url || s.id}</span>
                                            <span className="ml-auto text-xs text-ink-muted">{ago(s.startedAt)}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                ))}
            </div>
        </div>
    );
}
