/**
 * Tiny fetch helpers for the console.
 *
 * Data API lives under `/console/api/*` (capability-backed, read-only operator
 * view). Governance API lives under `/admin/api/*` (cookie-session auth — the
 * operator signs in via POST /admin/login). Both are same-origin, so cookies
 * flow automatically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiState<T> {
    data: T | undefined;
    error: string | undefined;
    loading: boolean;
    refetch: () => void;
}

async function parseError(resp: Response): Promise<string> {
    const body = await resp.text();
    try {
        const j = JSON.parse(body) as { error?: string };
        if (j.error) return j.error;
    } catch {
        /* fall through */
    }
    return `${resp.status} ${resp.statusText}`;
}

export function useApi<T>(path: string | null): ApiState<T> {
    const [data, setData] = useState<T | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState<boolean>(path != null);
    const tick = useRef(0);
    const [, force] = useState(0);

    const refetch = useCallback(() => {
        tick.current += 1;
        force((n) => n + 1);
    }, []);

    useEffect(() => {
        if (path == null) {
            setData(undefined);
            setError(undefined);
            setLoading(false);
            return;
        }
        const myTick = ++tick.current;
        let aborted = false;
        setLoading(true);
        setError(undefined);
        fetch(path, { credentials: 'same-origin' })
            .then(async (resp) => {
                if (aborted || tick.current !== myTick) return;
                if (!resp.ok) {
                    setError(await parseError(resp));
                    setLoading(false);
                    return;
                }
                const json = (await resp.json()) as T;
                if (aborted || tick.current !== myTick) return;
                setData(json);
                setLoading(false);
            })
            .catch((err: Error) => {
                if (aborted || tick.current !== myTick) return;
                setError(err.message);
                setLoading(false);
            });
        return () => {
            aborted = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, tick.current]);

    return { data, error, loading, refetch };
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const raw = await resp.text();
    let parsed: unknown;
    try {
        parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
        parsed = undefined;
    }
    if (!resp.ok) {
        throw new Error((parsed as { error?: string } | undefined)?.error ?? `${resp.status} ${resp.statusText}`);
    }
    return parsed as T;
}

/** Submit the admin login form (sets the cookie). Throws on bad credentials. */
export async function adminLogin(username: string, password: string): Promise<void> {
    const body = new URLSearchParams({ username, password });
    const resp = await fetch('/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'manual',
    });
    // 303 redirect on success; 401 (with the login HTML) on failure.
    if (resp.status === 401) throw new Error('invalid credentials');
}
