import { useState } from 'react';

export function App() {
    const [count, setCount] = useState(0);
    const [text, setText] = useState('');

    return (
        <main
            style={{
                fontFamily: 'system-ui, sans-serif',
                padding: 32,
                maxWidth: 640,
                margin: '0 auto',
            }}
        >
            <h1>morphix-dev-bridge · react demo</h1>
            <p>Open Claude Code / Cursor and call MCP tools to drive this page.</p>

            <section style={{ marginTop: 24 }}>
                <h2>Counter</h2>
                <p>
                    Current value: <strong data-morphix-comp="CounterValue">{count}</strong>
                </p>
                <button
                    type="button"
                    aria-label="increment counter"
                    data-morphix-comp="IncrementBtn"
                    onClick={() => {
                        setCount((c) => c + 1);
                        console.log('[demo] incremented to', count + 1);
                    }}
                >
                    Increment
                </button>
                <button
                    type="button"
                    aria-label="reset counter"
                    data-morphix-comp="ResetBtn"
                    onClick={() => setCount(0)}
                    style={{ marginLeft: 8 }}
                >
                    Reset
                </button>
            </section>

            <section style={{ marginTop: 24 }}>
                <h2>Input echo</h2>
                <input
                    data-morphix-comp="EchoInput"
                    placeholder="type something"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    style={{ padding: 8, width: 240 }}
                />
                <p data-morphix-comp="EchoDisplay">Echo: {text || '(empty)'}</p>
            </section>

            <section style={{ marginTop: 24 }}>
                <h2>Debug helpers</h2>
                <button
                    type="button"
                    aria-label="throw error"
                    onClick={() => {
                        throw new Error('demo: button threw on purpose');
                    }}
                >
                    Throw an error
                </button>
                <button
                    type="button"
                    aria-label="fetch api"
                    onClick={async () => {
                        await fetch('https://httpbin.org/get?demo=1').catch(() => {
                            /* no network in offline runs */
                        });
                    }}
                    style={{ marginLeft: 8 }}
                >
                    Fetch httpbin
                </button>
            </section>
        </main>
    );
}
