import { Navigate, Route, Routes } from 'react-router-dom';
import { useApi } from './hooks/useApi';
import { Header } from './components/Header';
import { ProjectList } from './routes/ProjectList';
import { SessionDetail } from './routes/SessionDetail';
import { Governance } from './routes/Governance';
import { SignIn } from './routes/SignIn';

interface Whoami {
    mode: 'open' | 'governed';
    authenticated: boolean;
    kind?: string | null;
    projects?: string[] | '*' | null;
}

/**
 * Console SPA shell (mounted at the `/console` basename, see main.tsx).
 *
 * Auth gate: `whoami` decides whether the viewer can see data. Open (solo) and
 * any authenticated viewer (admin session or a pasted read token) get the app;
 * a Governed viewer with no credential gets the sign-in screen — so an empty
 * `/` never shows a raw 401. The overlay's deep-link lands here too and inherits
 * whatever the viewer is signed in as (it carries no token of its own).
 */
export function App() {
    const { data: who, loading, refetch } = useApi<Whoami>('/console/api/whoami');

    if (loading && !who) {
        return <div className="min-h-screen flex items-center justify-center text-sm text-ink-muted">Loading…</div>;
    }
    if (who && !who.authenticated) {
        return <SignIn onDone={refetch} />;
    }

    // Governance is admin-only (cookie-auth /admin/api/*). A token/open viewer
    // who deep-links to /admin is sent back to the data view instead of a second
    // sign-in form.
    const isAdmin = who?.kind === 'admin';
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/admin" element={isAdmin ? <GovernancePage /> : <Navigate to="/projects" replace />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
    );
}

function GovernancePage() {
    return (
        <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 px-6 py-8 max-w-6xl mx-auto w-full">
                <Governance />
            </main>
        </div>
    );
}
