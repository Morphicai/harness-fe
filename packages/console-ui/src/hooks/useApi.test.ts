import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApi } from './useApi';

describe('useApi', () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.unstubAllGlobals());

    it('refetch() re-runs the request', async () => {
        // Regression: refetch used to bump a ref (no re-render → the effect never
        // re-ran → no second fetch). That's why whoami only updated on a hard
        // reload after sign-in. With state-driven refetch this must fetch again.
        let n = 0;
        const fetchMock = vi.fn(
            async () => ({ ok: true, json: async () => ({ n: ++n }) }) as unknown as Response,
        );
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useApi<{ n: number }>('/x'));

        await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
        expect(fetchMock).toHaveBeenCalledTimes(1);

        act(() => result.current.refetch());

        await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('null path makes no request and is not loading', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useApi<unknown>(null));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.current.data).toBeUndefined();
    });
});
