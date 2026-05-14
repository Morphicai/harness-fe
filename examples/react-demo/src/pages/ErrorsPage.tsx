import { useState } from 'react';

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

export function ErrorsPage() {
    const [log, setLog] = useState<string[]>([]);

    const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

    const throwSync = () => {
        addLog('Throwing sync error…');
        throw new Error('sync error from demo');
    };

    const throwAsync = () => {
        addLog('Rejecting promise…');
        Promise.reject(new Error('async error from demo'));
    };

    const consoleError = () => {
        console.error('console.error from demo');
        addLog('console.error emitted');
    };

    const consoleWarn = () => {
        console.warn('console.warn from demo');
        addLog('console.warn emitted');
    };

    return (
        <div>
            <h1 style={{ color: '#1a1a2e' }}>Errors</h1>
            <p style={{ color: '#555' }}>
                Tests: <code>errors.tail</code>, <code>console.tail</code>
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
                <h2 style={{ margin: '0 0 16px', color: '#1a1a2e', fontSize: 18 }}>Error Triggers</h2>

                <button
                    type="button"
                    aria-label="Throw sync error"
                    data-morphix-comp="ThrowSyncBtn"
                    style={btnStyle('#dc2626')}
                    onClick={throwSync}
                >
                    Throw sync error
                </button>

                <button
                    type="button"
                    aria-label="Throw async error"
                    data-morphix-comp="ThrowAsyncBtn"
                    style={btnStyle('#b91c1c')}
                    onClick={throwAsync}
                >
                    Throw async error
                </button>

                <button
                    type="button"
                    aria-label="Console error"
                    data-morphix-comp="ConsoleErrorBtn"
                    style={btnStyle('#d97706')}
                    onClick={consoleError}
                >
                    console.error
                </button>

                <button
                    type="button"
                    aria-label="Console warn"
                    data-morphix-comp="ConsoleWarnBtn"
                    style={btnStyle('#ca8a04')}
                    onClick={consoleWarn}
                >
                    console.warn
                </button>
            </div>

            {log.length > 0 && (
                <div
                    style={{
                        background: '#fef2f2',
                        border: '1px solid #fca5a5',
                        borderRadius: 8,
                        padding: '12px 16px',
                        marginTop: 16,
                    }}
                    data-morphix-comp="ErrorLog"
                >
                    <strong style={{ color: '#991b1b', fontSize: 14 }}>Action log:</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13, color: '#7f1d1d' }}>
                        {log.map((entry, i) => (
                            <li key={i}>{entry}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Intentionally broken layout for page.set_style testing */}
            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 24,
                    marginTop: 16,
                }}
            >
                <h3 style={{ margin: '0 0 12px', color: '#1a1a2e' }}>Broken Layout Section</h3>
                <p style={{ color: '#555', fontSize: 14, marginBottom: 12 }}>
                    This section has intentionally wrong styles — use <code>page.set_style</code> to fix it.
                </p>
                <div
                    id="broken-layout"
                    style={{
                        display: 'flex',
                        flexDirection: 'row',
                        gap: 8,
                        overflow: 'hidden',
                        height: 60,
                    }}
                >
                    <div
                        style={{
                            background: '#fee2e2',
                            padding: 8,
                            width: 400,
                            fontSize: 11,
                            color: '#991b1b',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        This box is too wide and clips its content — fix with set_style
                    </div>
                    <div
                        style={{
                            background: '#fef9c3',
                            padding: 8,
                            fontSize: 11,
                            color: '#713f12',
                            opacity: 0.3,
                        }}
                    >
                        This box is nearly invisible — fix opacity with set_style
                    </div>
                </div>
            </div>

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
                    <li>Click "Throw async error" then use <code>errors.tail</code> to see the unhandled rejection</li>
                    <li>Click "console.error" then use <code>console.tail</code> to see the error entry</li>
                    <li>Note: "Throw sync error" will crash the component — React error boundary will catch it</li>
                </ul>
            </div>
        </div>
    );
}
