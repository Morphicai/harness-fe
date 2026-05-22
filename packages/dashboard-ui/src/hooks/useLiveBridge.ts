/**
 * Subscribe to live `dashboard.update` frames over the same WebSocket
 * the host runtime uses. Reconnects with backoff (capped at 15s) so a
 * daemon restart or page-sleep recovery brings the live feed back
 * without a manual refresh.
 *
 * Subscribers register a handler; pub/sub is process-local. We only
 * keep one WebSocket connection per page (singleton inside this module)
 * so the React tree can call useLiveBridge from many places without
 * accidentally opening multiple sockets.
 */
import { useEffect, useRef } from 'react';
import { getWsUrl } from '../lib/token';
import type { DashboardUpdateFrame } from '../lib/types';

type Handler = (frame: DashboardUpdateFrame) => void;

const handlers = new Set<Handler>();
let ws: WebSocket | undefined;
let attempts = 0;
let closed = false;

function dispatch(frame: DashboardUpdateFrame): void {
    for (const h of handlers) {
        try {
            h(frame);
        } catch (err) {
            // Never let one handler's bug break the broadcast.
            console.error('[dashboard] handler threw', err);
        }
    }
}

function connect(): void {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
        ws = new WebSocket(getWsUrl());
    } catch (err) {
        console.warn('[dashboard] failed to construct WebSocket', err);
        return;
    }
    ws.addEventListener('open', () => {
        attempts = 0;
        try {
            ws!.send(JSON.stringify({
                type: 'hello',
                id: crypto.randomUUID(),
                role: 'dashboard-client',
                projectId: 'dashboard-ui',
            }));
        } catch {
            /* swallow; reconnect logic will retry */
        }
    });
    ws.addEventListener('message', (ev) => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(String(ev.data));
        } catch {
            return;
        }
        // Only the update frame is interesting on the dashboard side; ignore everything else.
        if (
            parsed != null &&
            typeof parsed === 'object' &&
            (parsed as { type?: unknown }).type === 'dashboard.update'
        ) {
            dispatch(parsed as DashboardUpdateFrame);
        }
    });
    ws.addEventListener('close', () => {
        if (closed) return;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
        attempts++;
        setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => {
        // close will follow
    });
}

function ensureSocket(): void {
    if (typeof window === 'undefined') return;
    closed = false;
    if (!ws) connect();
}

/**
 * Register `handler` for dashboard.update frames for the lifetime of the
 * caller component. The first subscriber opens the singleton WebSocket;
 * later ones piggy-back.
 */
export function useLiveBridge(handler: Handler): void {
    const stable = useRef(handler);
    stable.current = handler;
    useEffect(() => {
        const wrapped: Handler = (frame) => stable.current(frame);
        handlers.add(wrapped);
        ensureSocket();
        return () => {
            handlers.delete(wrapped);
        };
    }, []);
}

/** Force-close the connection — only useful in tests / HMR. */
export function _resetLiveBridge(): void {
    closed = true;
    ws?.close();
    ws = undefined;
    handlers.clear();
    attempts = 0;
}
