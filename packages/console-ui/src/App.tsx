import { Navigate, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { ProjectList } from './routes/ProjectList';
import { SessionDetail } from './routes/SessionDetail';
import { Governance } from './routes/Governance';

/**
 * Console SPA shell (mounted at the `/console` basename, see main.tsx).
 *
 * Two faces, switched from the Header nav:
 *  - **Data** — projects → session detail (logs / timeline / rrweb replay).
 *    These routes render their own <Header/> (recovered from the dashboard).
 *  - **Governance** — tokens / servers / audit (the new gateway capability),
 *    wrapped here in the shared Header for a consistent shell.
 */
export function App() {
    return (
        <Routes>
            <Route path="/" element={<ProjectList />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/admin" element={<GovernancePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
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
