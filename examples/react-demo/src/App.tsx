import { Routes, Route, NavLink } from 'react-router-dom';
import { HomePage } from './pages/HomePage.js';
import { CounterPage } from './pages/CounterPage.js';
import { FormsPage } from './pages/FormsPage.js';
import { NetworkPage } from './pages/NetworkPage.js';
import { ErrorsPage } from './pages/ErrorsPage.js';
import { StylesPage } from './pages/StylesPage.js';
import { SandboxPage } from './pages/SandboxPage.js';
import { RadixPage } from './pages/RadixPage.js';

const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/counter', label: 'Counter' },
    { to: '/forms', label: 'Forms' },
    { to: '/network', label: 'Network' },
    { to: '/errors', label: 'Errors' },
    { to: '/styles', label: 'Styles' },
    { to: '/sandbox', label: 'Sandbox' },
    { to: '/radix', label: 'Radix' },
];

export function App() {
    return (
        <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f8f9fa' }}>
            <nav
                style={{
                    background: '#1a1a2e',
                    padding: '0 24px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
            >
                <span style={{ color: '#e94560', fontWeight: 700, fontSize: 18, marginRight: 16, padding: '14px 0' }}>
                    Harness-FE Demo
                </span>
                {navLinks.map(({ to, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={to === '/'}
                        style={({ isActive }) => ({
                            color: isActive ? '#e94560' : '#ccc',
                            textDecoration: 'none',
                            padding: '14px 12px',
                            fontWeight: isActive ? 700 : 400,
                            borderBottom: isActive ? '3px solid #e94560' : '3px solid transparent',
                            transition: 'color 0.2s',
                        })}
                    >
                        {label}
                    </NavLink>
                ))}
            </nav>

            <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/counter" element={<CounterPage />} />
                    <Route path="/forms" element={<FormsPage />} />
                    <Route path="/network" element={<NetworkPage />} />
                    <Route path="/errors" element={<ErrorsPage />} />
                    <Route path="/styles" element={<StylesPage />} />
                    <Route path="/sandbox" element={<SandboxPage />} />
                    <Route path="/radix" element={<RadixPage />} />
                </Routes>
            </main>
        </div>
    );
}
