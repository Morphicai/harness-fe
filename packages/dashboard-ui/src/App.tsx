import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ProjectList } from './routes/ProjectList';
import { SessionDetail } from './routes/SessionDetail';

/**
 * SPA shell. Routes mount under the `/dashboard/` base path declared in
 * vite.config.ts — react-router-dom handles client-side navigation.
 *
 * The token is captured from the initial URL once and reused for every
 * fetch + WS open (see hooks/useApi.ts and hooks/useLiveBridge.ts).
 */
export function App() {
    return (
        <BrowserRouter basename="/dashboard">
            <Routes>
                <Route path="/" element={<ProjectList />} />
                <Route path="/sessions/:id" element={<SessionDetail />} />
            </Routes>
        </BrowserRouter>
    );
}
