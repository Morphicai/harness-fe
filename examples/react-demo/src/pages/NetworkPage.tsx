import { useState } from 'react';

interface FetchResult {
    url: string;
    status: number | null;
    body: string;
    error?: string;
    loading?: boolean;
}

const btnStyle = (color: string): React.CSSProperties => ({
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 18px',
    fontSize: 14,
    cursor: 'pointer',
    marginRight: 8,
    marginBottom: 8,
});

export function NetworkPage() {
    const [result, setResult] = useState<FetchResult | null>(null);

    const doFetch = async (url: string, label: string) => {
        setResult({ url, status: null, body: '', loading: true });
        try {
            const res = await fetch(url);
            let body = '';
            try {
                const text = await res.text();
                body = text.slice(0, 300);
            } catch {
                body = '(could not read body)';
            }
            setResult({ url, status: res.status, body });
            console.log(`[demo] fetch ${label} → ${res.status}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setResult({ url, status: null, body: '', error: msg });
            console.error(`[demo] fetch ${label} failed:`, msg);
        }
    };

    return (
        <div>
            <h1 style={{ color: '#1a1a2e' }}>Network</h1>
            <p style={{ color: '#555' }}>
                Tests: <code>network.tail</code>, <code>page.wait_for</code>, <code>console.tail</code>
            </p>

            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 32,
                    marginTop: 24,
                }}
            >
                <h2 style={{ margin: '0 0 16px', color: '#1a1a2e', fontSize: 18 }}>Fetch Triggers</h2>

                <button
                    type="button"
                    aria-label="Fetch JSON"
                    data-morphix-comp="FetchJsonBtn"
                    style={btnStyle('#2563eb')}
                    onClick={() => doFetch('https://jsonplaceholder.typicode.com/todos/1', 'JSON')}
                >
                    Fetch JSON
                </button>

                <button
                    type="button"
                    aria-label="Fetch 404"
                    data-morphix-comp="Fetch404Btn"
                    style={btnStyle('#dc2626')}
                    onClick={() => doFetch('https://jsonplaceholder.typicode.com/nonexistent', '404')}
                >
                    Fetch 404
                </button>

                <button
                    type="button"
                    aria-label="Fetch slow"
                    data-morphix-comp="FetchSlowBtn"
                    style={btnStyle('#d97706')}
                    onClick={() => doFetch('https://httpbin.org/delay/2', 'slow')}
                >
                    Fetch slow (2s)
                </button>
            </div>

            {result && (
                <div
                    style={{
                        background: '#fff',
                        border: '1px solid #e0e0e0',
                        borderRadius: 8,
                        padding: '16px 20px',
                        marginTop: 16,
                    }}
                    data-morphix-comp="FetchResult"
                >
                    {result.loading ? (
                        <div style={{ color: '#d97706', fontWeight: 600 }} data-morphix-comp="FetchLoading">
                            ⏳ Loading… fetching {result.url}
                        </div>
                    ) : (
                        <>
                            <div style={{ marginBottom: 8 }}>
                                <span style={{ fontWeight: 600, color: '#374151' }}>URL: </span>
                                <span style={{ color: '#555', fontSize: 13 }} data-morphix-comp="FetchUrl">
                                    {result.url}
                                </span>
                            </div>
                            <div style={{ marginBottom: 8 }}>
                                <span style={{ fontWeight: 600, color: '#374151' }}>Status: </span>
                                <span
                                    style={{
                                        color: result.error
                                            ? '#dc2626'
                                            : result.status && result.status < 400
                                            ? '#16a34a'
                                            : '#dc2626',
                                        fontWeight: 700,
                                    }}
                                    data-morphix-comp="FetchStatus"
                                >
                                    {result.error ? `Error: ${result.error}` : result.status}
                                </span>
                            </div>
                            {result.body && (
                                <div>
                                    <span style={{ fontWeight: 600, color: '#374151' }}>Body preview: </span>
                                    <pre
                                        style={{
                                            background: '#f3f4f6',
                                            borderRadius: 4,
                                            padding: '8px 12px',
                                            fontSize: 12,
                                            overflow: 'auto',
                                            marginTop: 4,
                                        }}
                                        data-morphix-comp="FetchBody"
                                    >
                                        {result.body}
                                    </pre>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: '16px 20px',
                    marginTop: 16,
                }}
            >
                <h3 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>How to test</h3>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#555', fontSize: 14, lineHeight: 1.8 }}>
                    <li>Click "Fetch JSON" then use <code>network.tail</code> to see the request</li>
                    <li>Click "Fetch slow" then use <code>page.wait_for</code> with text "Loading" to wait for the indicator</li>
                    <li>Use <code>page.dom_query</code> with <code>component: "FetchStatus"</code> to read the response status</li>
                </ul>
            </div>
        </div>
    );
}
