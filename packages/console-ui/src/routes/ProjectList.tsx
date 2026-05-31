import { Link, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useLiveBridge } from '../hooks/useLiveBridge';
import { Header } from '../components/Header';
import { fmtRelative, fmtTs } from '../lib/fmt';
import type { ProjectListEntry } from '../lib/types';

export function ProjectList() {
    const navigate = useNavigate();
    const { data, error, loading, refetch } = useApi<{ projects: ProjectListEntry[] }>(
        '/console/api/projects',
    );
    useLiveBridge(
        useCallback(
            (frame) => {
                // Any of these affect the list view (session counts, ordering).
                if (
                    frame.kind === 'session.new' ||
                    frame.kind === 'session.closed' ||
                    frame.kind === 'project.update'
                ) {
                    refetch();
                }
            },
            [refetch],
        ),
    );

    return (
        <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 px-6 py-8 max-w-6xl mx-auto w-full">
                <PageTitle data={data} loading={loading} />

                {error ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-rose-200 text-sm animate-fade-in">
                        {error}
                    </div>
                ) : null}

                {loading && !data ? (
                    <SkeletonList />
                ) : (
                    <div className="space-y-3">
                        {data?.projects.length === 0 ? (
                            <EmptyState />
                        ) : (
                            data?.projects.map((entry) => (
                                <ProjectCard
                                    key={entry.project.id}
                                    entry={entry}
                                    onSessionClick={(id) => navigate(`/sessions/${encodeURIComponent(id)}`)}
                                />
                            ))
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

function PageTitle({
    data,
    loading,
}: {
    data: { projects: ProjectListEntry[] } | undefined;
    loading: boolean;
}) {
    const count = data?.projects.length ?? 0;
    return (
        <div className="mb-6 flex items-end justify-between animate-fade-in">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
                <p className="text-ink-secondary text-sm mt-1">
                    {loading
                        ? 'Loading…'
                        : count === 0
                            ? 'No projects have connected yet.'
                            : `${count} project${count === 1 ? '' : 's'} tracked.`}
                </p>
            </div>
        </div>
    );
}

function ProjectCard({
    entry,
    onSessionClick,
}: {
    entry: ProjectListEntry;
    onSessionClick: (sessionId: string) => void;
}) {
    const { project, recentSessions } = entry;
    const liveCount = recentSessions.filter((s) => !s.endedAt).length;
    return (
        <section className="rounded-xl border border-surface-border bg-surface-raised overflow-hidden animate-fade-in shadow-soft">
            <header className="flex items-center gap-3 px-5 py-3.5 border-b border-surface-border bg-surface-sunken">
                <div className="font-mono text-sm text-ink-primary">{project.id}</div>
                {project.displayName && project.displayName !== project.id ? (
                    <div className="text-xs text-ink-muted">· {project.displayName}</div>
                ) : null}
                {liveCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent-emerald/10 border border-accent-emerald/30 text-[10px] text-accent-emerald font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald animate-pulse-live" />
                        {liveCount} live
                    </span>
                ) : null}
                <div className="flex-1" />
                <div className="text-xs text-ink-muted">
                    last seen {fmtRelative(project.lastActiveAt)}
                </div>
            </header>
            <ul className="divide-y divide-surface-border">
                {recentSessions.length === 0 ? (
                    <li className="px-5 py-4 text-sm text-ink-muted">No sessions yet.</li>
                ) : (
                    recentSessions.slice(0, 6).map((session) => (
                        <li
                            key={session.id}
                            className="px-5 py-3 flex items-center gap-3 transition-colors hover:bg-surface-sunken cursor-pointer"
                            onClick={() => onSessionClick(session.id)}
                            role="link"
                        >
                            <span className="font-mono text-xs text-ink-secondary truncate flex-1">
                                {session.id}
                            </span>
                            {session.title ? (
                                <span className="text-xs text-ink-muted truncate max-w-xs">
                                    {session.title}
                                </span>
                            ) : null}
                            <span className="text-xs text-ink-muted whitespace-nowrap">
                                {fmtTs(session.startedAt)}
                            </span>
                            {session.endedAt ? (
                                <span className="text-[10px] uppercase tracking-wide text-ink-muted">closed</span>
                            ) : (
                                <span className="text-[10px] uppercase tracking-wide text-accent-emerald">live</span>
                            )}
                        </li>
                    ))
                )}
            </ul>
            {recentSessions.length > 6 ? (
                <footer className="px-5 py-2.5 text-xs text-ink-muted bg-surface-sunken border-t border-surface-border">
                    + {recentSessions.length - 6} more
                </footer>
            ) : null}
        </section>
    );
}

function SkeletonList() {
    return (
        <div className="space-y-3 animate-pulse">
            {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-surface-border bg-surface-raised h-32" />
            ))}
        </div>
    );
}

function EmptyState() {
    return (
        <div className="rounded-xl border border-dashed border-surface-border bg-surface-raised/40 p-12 text-center animate-fade-in">
            <div className="mx-auto h-12 w-12 rounded-xl gradient-accent opacity-60" />
            <h2 className="mt-4 text-lg font-medium">Waiting for a project to connect</h2>
            <p className="mt-2 text-sm text-ink-secondary max-w-md mx-auto">
                Start your dev server and open a page — it should appear here within
                seconds. Team setups also configure the runtime{' '}
                <code className="font-mono px-1.5 py-0.5 rounded bg-surface-base border border-surface-border text-ink-primary">
                    token
                </code>
                .
            </p>
            <Link
                to="https://github.com/Morphicai/harness-fe#readme"
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-xs text-accent-indigo hover:underline"
            >
                Setup guide ↗
            </Link>
        </div>
    );
}
