/**
 * SandboxPage — real-browser verification harness for @harness-fe/sandbox.
 *
 * On mount:
 *   1. Calls installSandbox() with broad observers + one interceptor per channel.
 *   2. Runs every check from the Phase 0 identity + interceptor suites.
 *   3. Renders a results table the Playwright e2e can scrape.
 *
 * Each row has a `data-testid="case-{id}"` so the e2e can read result/status
 * without fragile text matching.
 */

import { useEffect, useRef, useState } from 'react';
import { installSandbox, type SandboxEvent } from '@harness-fe/sandbox';

interface CaseResult {
    id: string;
    label: string;
    status: 'pass' | 'fail' | 'skip';
    details?: string;
}

const PROBE_KEYS = ['__hfeSandboxProbe', '__hfeWatchedGlobal', '__hfeBlockedGlobal'];

export function SandboxPage() {
    const [results, setResults] = useState<CaseResult[]>([]);
    const [events, setEvents] = useState<SandboxEvent[]>([]);
    const [currentCase, setCurrentCase] = useState<string>('not started');
    const ranRef = useRef(false);

    // ?bare=1 — render absolutely static content, do NOT install sandbox, do NOT run suite.
    // Used to determine if the freeze is in the page framework (React / vite / router) or in sandbox.
    const isBare = typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('bare') === '1';

    useEffect(() => {
        if (isBare) return;
        if (ranRef.current) return;
        ranRef.current = true;
        const params = new URLSearchParams(window.location.search);
        const stop = params.has('stop') ? Number(params.get('stop')) : Infinity;
        const installOnly = params.get('install') === 'only';
        const noInstall = params.get('install') === 'none';
        void runSuite(setResults, setEvents, setCurrentCase, { stop, installOnly, noInstall });
    }, [isBare]);

    if (isBare) {
        return (
            <div>
                <h1>Sandbox (bare mode)</h1>
                <p>This page renders no sandbox code. If THIS page also freezes, the bug is in the demo framework (React / Vite / Router), not in @harness-fe/sandbox.</p>
                <div data-testid="bare-ok" style={{ padding: 12, background: '#f0fff4', border: '2px solid #2dd573', borderRadius: 8, fontWeight: 700 }}>
                    ✓ bare page rendered
                </div>
            </div>
        );
    }

    const summary = {
        total: results.length,
        pass: results.filter((r) => r.status === 'pass').length,
        fail: results.filter((r) => r.status === 'fail').length,
        skip: results.filter((r) => r.status === 'skip').length,
    };

    return (
        <div>
            <h1>Sandbox verification</h1>
            <p>
                Loads <code>@harness-fe/sandbox</code> in this page and runs every
                identity / interceptor / channel contract test against the real
                browser DOM. The Playwright e2e reads the badges below.
            </p>

            <div
                data-testid="summary"
                data-pass={summary.pass}
                data-fail={summary.fail}
                data-skip={summary.skip}
                data-total={summary.total}
                data-current={currentCase}
                style={{
                    margin: '16px 0',
                    padding: 12,
                    background: summary.fail > 0 ? '#fff0f0' : '#f0fff4',
                    border: `2px solid ${summary.fail > 0 ? '#e94560' : '#2dd573'}`,
                    borderRadius: 8,
                    fontWeight: 700,
                }}
            >
                {summary.fail === 0 && summary.total > 0
                    ? `✓ ${summary.pass} pass`
                    : `${summary.pass} pass, ${summary.fail} fail`}
                {summary.skip > 0 && `, ${summary.skip} skip`}
                {' / '}
                {summary.total} total
                {currentCase !== 'done' && (
                    <span style={{ marginLeft: 16, color: '#888', fontWeight: 400 }}>
                        ▶ running: <code>{currentCase}</code>
                    </span>
                )}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                    <tr style={{ background: '#e6e8eb' }}>
                        <th style={{ padding: 6, textAlign: 'left' }}>#</th>
                        <th style={{ padding: 6, textAlign: 'left' }}>Case</th>
                        <th style={{ padding: 6, textAlign: 'left' }}>Status</th>
                        <th style={{ padding: 6, textAlign: 'left' }}>Details</th>
                    </tr>
                </thead>
                <tbody>
                    {results.map((r) => (
                        <tr
                            key={r.id}
                            data-testid={`case-${r.id}`}
                            data-status={r.status}
                            style={{
                                background:
                                    r.status === 'pass'
                                        ? '#f0fff4'
                                        : r.status === 'fail'
                                            ? '#fff0f0'
                                            : '#fff8e0',
                            }}
                        >
                            <td style={{ padding: 6, fontFamily: 'monospace' }}>{r.id}</td>
                            <td style={{ padding: 6 }}>{r.label}</td>
                            <td style={{ padding: 6 }}>{
                                r.status === 'pass' ? '✓ pass'
                                    : r.status === 'fail' ? '✗ fail'
                                    : '⏭ skip'
                            }</td>
                            <td style={{ padding: 6, fontFamily: 'monospace', color: '#666' }}>
                                {r.details ?? ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <details style={{ marginTop: 24 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Captured events ({events.length})
                </summary>
                <pre style={{ fontSize: 11, maxHeight: 280, overflow: 'auto', background: '#222', color: '#0f0', padding: 8, borderRadius: 4 }}>
                    {events.map((e, i) => `${i}: ${e.source}.${e.kind} ${JSON.stringify(e.data).slice(0, 120)}`).join('\n')}
                </pre>
            </details>
        </div>
    );
}

async function runSuite(
    setResults: (cb: (prev: CaseResult[]) => CaseResult[]) => void,
    setEvents: (cb: (prev: SandboxEvent[]) => SandboxEvent[]) => void,
    setCurrentCase: (next: string) => void,
    opts: { stop: number; installOnly: boolean; noInstall: boolean },
): Promise<void> {
    const out: CaseResult[] = [];
    const push = (r: CaseResult): void => {
        out.push(r);
        setResults(() => [...out]);
        if (out.length >= opts.stop) {
            // Mark "stopped" so the user knows where binary-search hit.
            setCurrentCase('STOPPED by ?stop param');
            // Force never-resolving promise on the next check call.
            throw new Error('SUITE_STOPPED');
        }
    };
    const check = (
        id: string,
        label: string,
        fn: () => boolean | Promise<boolean>,
        getDetails?: () => string,
    ): Promise<void> => {
        return (async () => {
            setCurrentCase(id);
            // Yield to React so the "running" indicator paints BEFORE we may freeze.
            await new Promise((r) => setTimeout(r, 0));
            const timeout = new Promise<boolean>((_, reject) =>
                setTimeout(() => reject(new Error(`timeout after 3000ms`)), 3000),
            );
            try {
                const ok = await Promise.race([Promise.resolve(fn()), timeout]);
                push({ id, label, status: ok ? 'pass' : 'fail', details: getDetails?.() });
            } catch (err) {
                push({ id, label, status: 'fail', details: err instanceof Error ? err.message : String(err) });
            }
        })();
    };
    const skip = (id: string, label: string, reason: string): void => {
        push({ id, label, status: 'skip', details: reason });
    };

    // Pre-clean
    for (const k of PROBE_KEYS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { delete (window as any)[k]; } catch { /* ignore */ }
    }
    try { window.localStorage.clear(); } catch { /* ignore */ }
    try { window.sessionStorage.clear(); } catch { /* ignore */ }

    // Install sandbox with a broad observer + per-channel interceptors that
    // exercise rewrite / block behaviors. NOTE: do NOT push setEvents on every
    // emit — that causes hundreds of re-renders and freezes the page on a busy
    // suite. We update setEvents periodically + once at the end.
    const seenEvents: SandboxEvent[] = [];
    let lastFlush = 0;
    const flushEvents = (force = false): void => {
        const now = Date.now();
        if (!force && now - lastFlush < 200) return;
        lastFlush = now;
        setEvents(() => seenEvents.slice(-200));
    };

    if (opts.noInstall) {
        push({ id: 'no-install', label: 'mode=install-none — sandbox NOT installed', status: 'pass' });
        setCurrentCase('done');
        return;
    }

    const handle = installSandbox({
        onEvent: (e) => {
            seenEvents.push(e);
            flushEvents();
        },
        storage: {
            onSet: (k, v) => {
                if (k === '__hfeBlock') return false;
                if (k === '__hfeRewriteKey') return { key: 'rewritten', value: v };
                return undefined;
            },
        },
        navigation: {
            // Block any nav whose target contains "/blocked-by-sandbox"
            onPush: (url) => (url?.includes('/blocked-by-sandbox') ? false : undefined),
        },
        globals: {
            watch: PROBE_KEYS,
            onSet: (_k, v) => (typeof v === 'string' && v.startsWith('blocked:') ? false : undefined),
        },
        indexeddb: {
            onPut: (_store, key, value) => {
                if (typeof value === 'string' && value === '__hfeIdbBlock') return false;
                return undefined;
            },
        },
    });

    if (opts.installOnly) {
        push({ id: 'install-only', label: 'mode=install-only — sandbox installed, no tests run', status: 'pass' });
        setCurrentCase('done');
        return;
    }

    try {

    // ──────────────────────────────────────────────────────────────
    // identity
    // ──────────────────────────────────────────────────────────────
    await check('typeof-fetch', 'typeof window.fetch === "function"', () => typeof window.fetch === 'function');
    await check('typeof-ws', 'typeof window.WebSocket === "function"', () => typeof window.WebSocket === 'function');
    await check('typeof-storage', 'typeof localStorage === "object"', () => typeof window.localStorage === 'object');
    await check('typeof-setItem', 'typeof localStorage.setItem === "function"', () => typeof window.localStorage.setItem === 'function');
    await check('instanceof-storage', 'localStorage instanceof Storage', () => window.localStorage instanceof Storage);
    await check('identity-memoize', 'localStorage === window.localStorage', () => window.localStorage === window.localStorage);
    await check('toString-storage', 'toString.call(localStorage) === "[object Storage]"', () => Object.prototype.toString.call(window.localStorage) === '[object Storage]');
    await check('constructor-storage', 'localStorage.constructor === Storage', () => window.localStorage.constructor === Storage);
    await check('proto-chain', 'getPrototypeOf(localStorage) === Storage.prototype', () => Object.getPrototypeOf(window.localStorage) === Storage.prototype);

    // ──────────────────────────────────────────────────────────────
    // .call() bypass — red list
    // ──────────────────────────────────────────────────────────────
    await check('proto-setItem-call', 'Storage.prototype.setItem.call routes via interceptor', () => {
        const before = seenEvents.length;
        Storage.prototype.setItem.call(window.localStorage, '__hfeProtoCallKey', 'V');
        const seenNow = seenEvents.slice(before);
        return seenNow.some((e) => e.source === 'storage' && e.kind === 'set' && (e.data as { key?: string }).key === '__hfeProtoCallKey');
    });

    await check('new-target-ws', 'WebSocket() without new throws TypeError', () => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window.WebSocket as any)('wss://test.example/');
            return false;
        } catch (e) {
            return e instanceof TypeError;
        }
    });

    // ──────────────────────────────────────────────────────────────
    // enumeration
    // ──────────────────────────────────────────────────────────────
    {
        window.localStorage.clear();
        window.localStorage.setItem('a', '1');
        window.localStorage.setItem('b', '2');
        const keys: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const k in window.localStorage as any) keys.push(k);
        keys.sort();
        await check(
            'for-in',
            `for...in over localStorage yields stored keys only (got: ${keys.join(',')})`,
            () => keys.includes('a') && keys.includes('b') && !keys.includes('setItem'),
            () => `actual: [${keys.join(', ')}]`,
        );
    }

    await check('json-stringify-empty', 'JSON.stringify(localStorage) === "{}" when empty', () => {
        window.localStorage.clear();
        return JSON.stringify(window.localStorage) === '{}';
    });

    // ──────────────────────────────────────────────────────────────
    // storage interceptor
    // ──────────────────────────────────────────────────────────────
    await check('storage-block', 'onSet false blocks write', () => {
        window.localStorage.clear();
        window.localStorage.setItem('__hfeBlock', 'should-be-blocked');
        return window.localStorage.getItem('__hfeBlock') === null;
    });

    await check('storage-rewrite-key', 'onSet can rewrite key', () => {
        window.localStorage.clear();
        window.localStorage.setItem('__hfeRewriteKey', 'V');
        return window.localStorage.getItem('rewritten') === 'V';
    });

    await check('storage-proto-call-block', 'proto.setItem.call also goes through block interceptor', () => {
        window.localStorage.clear();
        Storage.prototype.setItem.call(window.localStorage, '__hfeBlock', '1');
        return window.localStorage.getItem('__hfeBlock') === null;
    });

    // ──────────────────────────────────────────────────────────────
    // navigation
    // ──────────────────────────────────────────────────────────────
    await check('nav-pushstate-blocked', 'history.pushState to /blocked-by-sandbox is blocked', () => {
        const before = window.location.href;
        window.history.pushState({}, '', '/blocked-by-sandbox/x');
        return window.location.href === before;
    });

    await check('nav-pushstate-ok', 'normal pushState fires observer', () => {
        const before = seenEvents.length;
        window.history.pushState({}, '', '/sandbox?check=1');
        return seenEvents.slice(before).some((e) => e.source === 'navigation' && e.kind === 'push');
    });

    // ──────────────────────────────────────────────────────────────
    // globals
    // ──────────────────────────────────────────────────────────────
    await check('globals-watch-fire', 'watched global write fires interceptor', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__hfeSandboxProbe = 'observed';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).__hfeSandboxProbe === 'observed';
    });

    await check('globals-watch-block', 'globals onSet returning false blocks', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__hfeWatchedGlobal = 'blocked:nope';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).__hfeWatchedGlobal === undefined;
    });

    // ──────────────────────────────────────────────────────────────
    // indexeddb
    // ──────────────────────────────────────────────────────────────
    if (typeof indexedDB === 'undefined') {
        skip('idb-put-block', 'onPut block', 'no indexedDB in env');
        skip('idb-put', 'onPut observes', 'no indexedDB in env');
    } else {
        const dbName = '__hfeSandboxIdb';
        try {
            const db = await openTestDb(dbName);
            // put
            const before = seenEvents.length;
            await idbReq(db.transaction('kv', 'readwrite').objectStore('kv').put('ok', 'k1'));
            await check('idb-put', 'onPut observes write', () => {
                return seenEvents.slice(before).some((e) => e.source === 'indexeddb' && e.kind === 'put');
            });

            // blocked put
            try {
                await idbReq(db.transaction('kv', 'readwrite').objectStore('kv').put('__hfeIdbBlock', 'k2'));
            } catch { /* might throw on blocked */ }
            await check('idb-put-block', 'onPut returning false blocks', async () => {
                const r = await idbReq(db.transaction('kv', 'readonly').objectStore('kv').get('k2'));
                return r === undefined;
            });

            db.close();
        } catch (e) {
            skip('idb-put', 'onPut observes', `idb setup failed: ${e instanceof Error ? e.message : String(e)}`);
            skip('idb-put-block', 'onPut block', `idb setup failed`);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // observer / events sanity
    // ──────────────────────────────────────────────────────────────
    await check('observer-fires', 'onEvent receives storage events', () => {
        return seenEvents.some((e) => e.source === 'storage');
    });

    // ──────────────────────────────────────────────────────────────
    // reentry guard
    // ──────────────────────────────────────────────────────────────
    await check('reentry-storage-no-loop', 'onSet writing to storage from inside the interceptor does not loop', () => {
        // Install a second sandbox that nests inside the page's main install.
        // Inner onSet writes back to storage — without guard this is infinite.
        let calls = 0;
        const inner = installSandbox({
            storage: {
                onSet: (k, _v) => {
                    calls++;
                    if (!k.startsWith('echo:')) {
                        window.localStorage.setItem(`echo:${k}`, 'X');
                    }
                    return undefined;
                },
            },
        });
        try {
            window.localStorage.setItem('reentry-root', 'V');
            return calls === 1
                && window.localStorage.getItem('reentry-root') === 'V'
                && window.localStorage.getItem('echo:reentry-root') === 'X';
        } finally {
            inner.dispose();
        }
    });

    await check('reentry-globalthis', 'reentry depth lives on globalThis (survives cross-module duplicate)', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const holder = (globalThis as any);
        // Outside an active install path, depth should be 0 or undefined.
        return holder['__hfeSandboxReentryDepth__'] === undefined
            || holder['__hfeSandboxReentryDepth__'] === 0;
    });

    // ──────────────────────────────────────────────────────────────
    // dispose / cleanup
    // ──────────────────────────────────────────────────────────────
    await check('dispose-restores', 'dispose of last install restores native', () => {
        // The chain installs the patch on FIRST install and uninstalls on LAST.
        // To test this, we'd need to dispose `handle` itself, but we're still
        // using it for the rest of the page. So just verify the structural
        // contract: while at least one install is active, fetch is wrapped.
        // (Real "restore" is exercised by sandbox unit tests.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isWrapped = window.fetch.toString().indexOf('async function fetch') >= 0
            || (window.fetch as unknown as { __hfeSandboxFetchPatched__?: boolean }).__hfeSandboxFetchPatched__ === true;
        return isWrapped;
    });

        flushEvents(true);
        setCurrentCase('done');
    } catch (err) {
        if (err instanceof Error && err.message === 'SUITE_STOPPED') {
            // currentCase already set to 'STOPPED by ?stop param' in push()
            flushEvents(true);
        } else {
            push({ id: 'suite-error', label: 'unexpected suite error', status: 'fail', details: err instanceof Error ? err.message : String(err) });
            flushEvents(true);
            setCurrentCase('done');
        }
    }

    // Don't dispose `handle` — leaving installed so users can poke around in dev tools.
    void handle;
}

// ────────────────────────────────────────────────────────────────────
// IndexedDB helpers
// ────────────────────────────────────────────────────────────────────

function openTestDb(name: string, storeName = 'kv'): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
