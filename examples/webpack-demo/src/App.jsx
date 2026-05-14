import React, { useState } from 'react';

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
            <h1>harnessa-fe · webpack demo</h1>
            <p>Verifies the Webpack plugin works end-to-end.</p>

            <section style={{ marginTop: 24 }}>
                <h2>Counter</h2>
                <p>
                    Current value:{' '}
                    <span data-morphix-comp="CounterValue">{count}</span>
                </p>
                <button
                    type="button"
                    data-morphix-comp="IncrementBtn"
                    onClick={() => setCount((c) => c + 1)}
                >
                    Increment
                </button>
                <button
                    type="button"
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
        </main>
    );
}
