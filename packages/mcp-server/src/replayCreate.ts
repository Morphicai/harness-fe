/**
 * Shared replay-export logic used by both the leader's MCP tool handler and
 * the leader's mcp.call dispatcher (for follower proxy calls).
 *
 * Takes a time window (or a center timestamp), pulls the overlapping rrweb
 * chunks for a single tab, concatenates the events, persists them as an
 * export, and returns the metadata + viewerUrl.
 */

import type { IStore } from './store/index.js';

export interface ReplayCreateArgs {
    sessionId: string;
    tabId?: string;
    ts?: number;
    windowMs?: number;
    since?: number;
    until?: number;
    label?: string;
}

export interface ReplayCreateResult {
    exportId?: string;
    viewerUrl?: string;
    sessionId: string;
    tabId?: string;
    since: number;
    until: number;
    startTs?: number;
    endTs?: number;
    durationMs?: number;
    eventCount?: number;
    chunkCount?: number;
    bytes?: number;
    createdAt?: number;
    label?: string;
    error?: string;
}

export function createReplayExport(
    store: IStore,
    baseUrl: string | undefined,
    input: ReplayCreateArgs,
): ReplayCreateResult {
    const { sessionId, tabId, ts, windowMs, since, until, label } = input;

    const session = store.getSession(sessionId);
    if (!session) {
        return { error: 'session not found', sessionId, since: since ?? 0, until: until ?? 0 };
    }

    let resolvedSince: number;
    let resolvedUntil: number;
    if (typeof since === 'number' && typeof until === 'number') {
        if (until <= since) {
            return { error: 'until must be greater than since', sessionId, since, until };
        }
        resolvedSince = since;
        resolvedUntil = until;
    } else if (typeof ts === 'number') {
        const radius = windowMs ?? 15_000;
        resolvedSince = ts - radius;
        resolvedUntil = ts + radius;
    } else {
        return {
            error: 'must provide either ts (with optional windowMs) or both since and until',
            sessionId,
            since: 0,
            until: 0,
        };
    }

    const chunks = store.sliceRecordings(sessionId, resolvedSince, resolvedUntil, tabId);
    if (chunks.length === 0) {
        return {
            error: 'no rrweb chunks found in window',
            sessionId,
            tabId,
            since: resolvedSince,
            until: resolvedUntil,
        };
    }

    let scopedTabId = tabId;
    if (!scopedTabId) {
        const byTab = new Map<string, number>();
        for (const c of chunks) byTab.set(c.tabId, (byTab.get(c.tabId) ?? 0) + c.eventCount);
        let best = '';
        let bestEvents = -1;
        for (const [t, count] of byTab) {
            if (count > bestEvents) { best = t; bestEvents = count; }
        }
        scopedTabId = best;
    }

    const tabChunks = chunks.filter((c) => c.tabId === scopedTabId);
    const events: unknown[] = [];
    let startTs = Infinity;
    let endTs = -Infinity;
    for (const c of tabChunks) {
        for (const ev of c.events) events.push(ev);
        if (c.startTs < startTs) startTs = c.startTs;
        if (c.endTs > endTs) endTs = c.endTs;
    }
    if (events.length < 2) {
        return {
            error: 'window contains fewer than 2 rrweb events — not enough to replay',
            sessionId,
            tabId: scopedTabId,
            since: resolvedSince,
            until: resolvedUntil,
            eventCount: events.length,
        };
    }

    const meta = store.writeExport({
        sessionId,
        tabId: scopedTabId,
        since: resolvedSince,
        until: resolvedUntil,
        label,
        events,
        startTs,
        endTs,
        chunkCount: tabChunks.length,
    });

    const viewerUrl = baseUrl ? `${baseUrl}/replay/${meta.exportId}` : undefined;

    return {
        exportId: meta.exportId,
        viewerUrl,
        sessionId,
        tabId: scopedTabId,
        since: resolvedSince,
        until: resolvedUntil,
        startTs,
        endTs,
        durationMs: endTs - startTs,
        eventCount: meta.eventCount,
        chunkCount: meta.chunkCount,
        bytes: meta.bytes,
        createdAt: meta.createdAt,
        label,
    };
}
