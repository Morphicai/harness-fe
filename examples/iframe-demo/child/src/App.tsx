import { useEffect, useState } from 'react';

export function App() {
    const [n, setN] = useState(0);
    useEffect(() => {
        console.log('[iframe-child] booted', { ts: Date.now() });
    }, []);
    return (
        <div>
            <strong>I am the child widget</strong>
            <p style={{ color: '#666', fontSize: 13 }}>
                projectId=<code>iframe-child</code> · parentProjectId=
                <code>iframe-parent</code>
            </p>
            <button
                type="button"
                onClick={() => {
                    setN((x) => x + 1);
                    console.log('[iframe-child] button click', { n: n + 1 });
                }}
            >
                child count: {n}
            </button>
        </div>
    );
}
