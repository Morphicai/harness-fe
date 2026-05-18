/**
 * Initial-state snapshot for a single page load. Collected once after
 * `hello.ack` and emitted as the first event of the load.
 *
 * Caps:
 *  - Single value: 32 KB → truncated with a placeholder
 *  - Entire snapshot: 256 KB → marked truncated, late keys dropped
 *
 * No business code is modified by this helper.
 */

import type { PageLoadPayload } from '@morphixai/harnessa-fe.protocol';

const VALUE_CAP = 32 * 1024;
const TOTAL_CAP = 256 * 1024;

function readStorage(storage: Storage | null | undefined): {
    data: Record<string, string>;
    truncated: boolean;
} {
    if (!storage) return { data: {}, truncated: false };
    const out: Record<string, string> = {};
    let total = 0;
    let truncated = false;
    let i = 0;
    try {
        for (i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key === null) continue;
            let value: string | null = null;
            try {
                value = storage.getItem(key);
            } catch {
                continue;
            }
            if (value === null) continue;
            let trimmed = value;
            if (trimmed.length > VALUE_CAP) {
                trimmed = trimmed.slice(0, VALUE_CAP);
                truncated = true;
            }
            if (total + trimmed.length > TOTAL_CAP) {
                truncated = true;
                break;
            }
            out[key] = trimmed;
            total += trimmed.length;
        }
    } catch {
        // Storage access can throw (e.g. blocked third-party cookies).
        truncated = true;
    }
    return { data: out, truncated };
}

function readViewport(): { w: number; h: number; dpr: number } | undefined {
    if (typeof window === 'undefined') return undefined;
    try {
        return {
            w: Math.floor(window.innerWidth ?? 0),
            h: Math.floor(window.innerHeight ?? 0),
            dpr: window.devicePixelRatio ?? 1,
        };
    } catch {
        return undefined;
    }
}

function readPerformance(): PageLoadPayload['performance'] {
    if (typeof performance === 'undefined') return undefined;
    try {
        const nav = performance.getEntriesByType?.('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined;
        if (!nav) return undefined;
        return {
            navigationStart: nav.startTime,
            domContentLoaded: nav.domContentLoadedEventEnd,
            loadEventEnd: nav.loadEventEnd,
        };
    } catch {
        return undefined;
    }
}

export function collectPageLoadSnapshot(loadId: string): PageLoadPayload {
    const local = readStorage(typeof localStorage !== 'undefined' ? localStorage : null);
    const session = readStorage(typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    let cookie = '';
    try {
        cookie = typeof document !== 'undefined' ? document.cookie : '';
    } catch {
        cookie = '';
    }
    return {
        loadId,
        page: {
            url: typeof location !== 'undefined' ? location.href : undefined,
            title: typeof document !== 'undefined' ? document.title : undefined,
            referrer: typeof document !== 'undefined' ? document.referrer : undefined,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        },
        viewport: readViewport(),
        storage: {
            local: local.data,
            session: session.data,
            cookie,
            truncated: local.truncated || session.truncated,
        },
        performance: readPerformance(),
    };
}
