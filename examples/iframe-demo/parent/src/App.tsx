import { useEffect, useState } from 'react';

/**
 * Parent shell — embeds the child app as a same-origin iframe and emits a
 * unique console message so the e2e can assert the parent's events land in
 * the same MCP session as the child's.
 */
export function App() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        // Tagged log so e2e can grep for it after both apps boot.
        console.log('[iframe-parent] booted', { ts: Date.now() });
    }, []);

    return (
        <main>
            <h1>iframe-demo · parent shell</h1>
            <p>
                The frame below is loaded from <code>/child/</code>, which is reverse-proxied to
                the child Vite dev server (same-origin). The child runtime should inherit this
                parent's <code>tabId</code> + <code>sessionId</code>.
            </p>
            <button
                type="button"
                onClick={() => {
                    setCount((n) => n + 1);
                    console.log('[iframe-parent] button click', { count: count + 1 });
                }}
            >
                parent count: {count}
            </button>
            <iframe className="child-frame" title="child app" src="/child/" />
        </main>
    );
}
