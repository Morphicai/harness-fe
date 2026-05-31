import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApi } from './lib/api';
import { ProjectList } from './routes/ProjectList';
import { SessionView } from './routes/SessionView';
import { Governance } from './routes/Governance';

interface Meta {
    protocolVersion: string;
    mode: 'open' | 'governed';
}

function Nav() {
    const { pathname } = useLocation();
    const { data } = useApi<Meta>('/console/api/meta');
    const tab = (to: string, label: string, active: boolean) => (
        <Link
            to={to}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                active ? 'bg-surface-raised text-ink-primary' : 'text-ink-secondary hover:text-ink-primary'
            }`}
        >
            {label}
        </Link>
    );
    return (
        <header className="glass sticky top-0 z-10 flex items-center gap-2 border-b border-surface-border px-4 py-2">
            <span className="mr-2 font-mono text-sm font-semibold text-accent-indigo">harness</span>
            {tab('/', 'Data', pathname === '/' || pathname.startsWith('/session'))}
            {tab('/admin', 'Governance', pathname.startsWith('/admin'))}
            <span className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
                {data && (
                    <>
                        <span className={`rounded px-1.5 py-0.5 ${data.mode === 'open' ? 'bg-accent-emerald/15 text-accent-emerald' : 'bg-accent-amber/15 text-accent-amber'}`}>
                            {data.mode}
                        </span>
                        <span className="font-mono">v{data.protocolVersion}</span>
                    </>
                )}
            </span>
        </header>
    );
}

export function App() {
    return (
        <div className="min-h-screen">
            <Nav />
            <main className="mx-auto max-w-5xl px-4 py-6">
                <Routes>
                    <Route path="/" element={<ProjectList />} />
                    <Route path="/session/:id" element={<SessionView />} />
                    <Route path="/admin" element={<Governance />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
        </div>
    );
}
