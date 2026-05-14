import { Link } from 'react-router-dom';

const routes = [
    { path: '/counter', label: 'Counter', desc: 'Increment/decrement/reset buttons, console logging — tests page.click, page.evaluate, console.tail' },
    { path: '/forms', label: 'Forms', desc: 'Text, email, select, checkbox inputs — tests page.type, page.click, page.dom_query' },
    { path: '/network', label: 'Network', desc: 'Fetch calls with status display — tests network.tail' },
    { path: '/errors', label: 'Errors', desc: 'Sync/async errors, console.error/warn — tests errors.tail, console.tail' },
    { path: '/styles', label: 'Styles', desc: 'Style and HTML targets — tests page.set_style, page.set_html' },
];

export function HomePage() {
    return (
        <div>
            <h1 style={{ color: '#1a1a2e', marginBottom: 8 }}>Harnessa-FE MCP Demo</h1>
            <p style={{ color: '#555', fontSize: 16, marginBottom: 32 }}>
                A multi-page React app designed to exercise every MCP tool available in Harnessa-FE.
                Navigate to each page to test the corresponding tools.
            </p>

            <h2 style={{ color: '#1a1a2e', marginBottom: 16 }}>Available Pages</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {routes.map(({ path, label, desc }) => (
                    <Link
                        key={path}
                        to={path}
                        style={{ textDecoration: 'none' }}
                    >
                        <div
                            style={{
                                background: '#fff',
                                border: '1px solid #e0e0e0',
                                borderRadius: 8,
                                padding: '16px 20px',
                                transition: 'box-shadow 0.2s',
                                cursor: 'pointer',
                            }}
                            data-morphix-comp={`HomeCard-${label}`}
                        >
                            <div style={{ color: '#e94560', fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                                {label} <span style={{ color: '#999', fontWeight: 400, fontSize: 13 }}>{path}</span>
                            </div>
                            <div style={{ color: '#555', fontSize: 14 }}>{desc}</div>
                        </div>
                    </Link>
                ))}
            </div>

            <div
                style={{
                    marginTop: 32,
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: '16px 20px',
                }}
            >
                <h3 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>MCP Tools Covered</h3>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#555', fontSize: 14, lineHeight: 1.8 }}>
                    <li><code>page.click</code> — buttons on every page</li>
                    <li><code>page.type</code> — inputs on Forms page</li>
                    <li><code>page.evaluate</code> — JS evaluation via Counter page</li>
                    <li><code>page.dom_query</code> — elements on Forms page</li>
                    <li><code>page.screenshot</code> — any page</li>
                    <li><code>page.wait_for</code> — Network page loading state</li>
                    <li><code>page.set_style</code> — Styles page #style-target</li>
                    <li><code>page.set_html</code> — Styles page #html-target</li>
                    <li><code>console.tail</code> — Counter page log button</li>
                    <li><code>network.tail</code> — Network page fetch buttons</li>
                    <li><code>errors.tail</code> — Errors page throw buttons</li>
                    <li><code>tab.list</code> — any page</li>
                    <li><code>project.source</code> — any component</li>
                    <li><code>project.where_is</code> — any component</li>
                    <li><code>project.module_graph</code> — project structure</li>
                    <li><code>tasks.pending / tasks.claim / tasks.resolve</code> — task workflow</li>
                </ul>
            </div>
        </div>
    );
}
