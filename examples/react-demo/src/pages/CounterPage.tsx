import { useState } from 'react';

export function CounterPage() {
    const [count, setCount] = useState(0);

    const btnStyle = (color: string): React.CSSProperties => ({
        background: color,
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        padding: '10px 20px',
        fontSize: 15,
        cursor: 'pointer',
        marginRight: 8,
    });

    return (
        <div>
            <h1 style={{ color: '#1a1a2e' }}>Counter</h1>
            <p style={{ color: '#555' }}>
                Tests: <code>page.click</code>, <code>page.evaluate</code>, <code>console.tail</code>
            </p>

            <div
                style={{
                    background: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    padding: 32,
                    marginTop: 24,
                    textAlign: 'center',
                }}
            >
                <div style={{ fontSize: 64, fontWeight: 700, color: '#1a1a2e', marginBottom: 24 }}>
                    <span data-morphix-comp="CounterValue">{count}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        aria-label="increment counter"
                        data-morphix-comp="IncrementBtn"
                        style={btnStyle('#16a34a')}
                        onClick={() => {
                            const next = count + 1;
                            setCount(next);
                            console.log('[demo] incremented to', next);
                        }}
                    >
                        + Increment
                    </button>

                    <button
                        type="button"
                        aria-label="decrement counter"
                        data-morphix-comp="DecrementBtn"
                        style={btnStyle('#dc2626')}
                        onClick={() => {
                            const next = count - 1;
                            setCount(next);
                            console.log('[demo] decremented to', next);
                        }}
                    >
                        − Decrement
                    </button>

                    <button
                        type="button"
                        aria-label="reset counter"
                        data-morphix-comp="ResetBtn"
                        style={btnStyle('#6b7280')}
                        onClick={() => {
                            setCount(0);
                            console.log('[demo] counter reset to 0');
                        }}
                    >
                        ↺ Reset
                    </button>

                    <button
                        type="button"
                        aria-label="log to console"
                        data-morphix-comp="LogBtn"
                        style={btnStyle('#7c3aed')}
                        onClick={() => {
                            console.log('[demo] current counter value:', count);
                            console.info('[demo] info message from counter page');
                        }}
                    >
                        📋 Log to console
                    </button>
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
                    <li>Use <code>page.click</code> with <code>ariaLabel: "increment counter"</code> to increment</li>
                    <li>Use <code>page.evaluate</code> to read <code>document.querySelector('[data-morphix-comp="CounterValue"]').textContent</code></li>
                    <li>Click "Log to console" then use <code>console.tail</code> to see the log entries</li>
                </ul>
            </div>
        </div>
    );
}
