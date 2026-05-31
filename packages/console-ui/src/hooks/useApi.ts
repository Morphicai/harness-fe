import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../lib/token';

export interface ApiState<T> {
    data: T | undefined;
    error: string | undefined;
    loading: boolean;
    refetch: () => void;
}

/**
 * Thin GET wrapper. Adds Bearer auth, treats non-2xx as an error, and
 * exposes a `refetch()` so components subscribing to live updates can
 * pull fresh data without remounting.
 */
export function useApi<T>(path: string | null): ApiState<T> {
    const [data, setData] = useState<T | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState<boolean>(path != null);
    const tick = useRef(0);

    const refetch = useCallback(() => {
        tick.current += 1;
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
        fetch(path, { headers: authHeaders() })
            .then(async (resp) => {
                if (aborted || tick.current !== myTick) return;
                if (!resp.ok) {
                    const body = await resp.text();
                    let msg = `${resp.status} ${resp.statusText}`;
                    try {
                        const parsed = JSON.parse(body) as { error?: string };
                        if (parsed.error) msg = parsed.error;
                    } catch { /* leave the default */ }
                    setError(msg);
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
    }, [path, tick.current]);

    return { data, error, loading, refetch };
}

export async function apiPost<TBody, TResult>(path: string, body: TBody): Promise<TResult> {
    const resp = await fetch(path, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
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
        const msg = (parsed as { error?: string } | undefined)?.error ?? `${resp.status} ${resp.statusText}`;
        throw new Error(msg);
    }
    return parsed as TResult;
}

function authHeaders(): Record<string, string> {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
}
