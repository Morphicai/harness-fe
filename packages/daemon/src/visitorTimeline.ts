/**
 * visitor.timeline — merge event timelines across all sessions belonging to
 * one visitor. Pulled out of mcp.ts so the merge / filter logic is unit
 * testable without spinning up an McpServer.
 */

import type { IStore, StoreEvent } from './store/index.js';

export interface VisitorTimelineOptions {
    since?: number;
    until?: number;
    types?: string | string[];
    tabIds?: string[];
    sessionIds?: string[];
    limit?: number;
}

export interface VisitorTimelineResult {
    visitorId: string;
    sessionCount: number;
    eventCount: number;
    truncated: boolean;
    events: StoreEvent[];
}

const DEFAULT_LIMIT = 200;
const SESSION_DISCOVERY_PAGE = 200;

export function buildVisitorTimeline(
    store: IStore,
    visitorId: string,
    opts: VisitorTimelineOptions = {},
): VisitorTimelineResult | { error: string } {
    const visitor = store.getVisitor(visitorId);
    if (!visitor) return { error: `visitor not found: ${visitorId}` };

    const cap = opts.limit ?? DEFAULT_LIMIT;
    const tabFilter = opts.tabIds && opts.tabIds.length > 0 ? new Set(opts.tabIds) : undefined;

    // 1. Discover candidate sessions (or honor the explicit list).
    const candidateIds = new Set<string>();
    if (opts.sessionIds && opts.sessionIds.length > 0) {
        for (const id of opts.sessionIds) candidateIds.add(id);
    } else {
        const visitorTabs = new Set(visitor.tabIds);
        for (const pid of visitor.projectIds) {
            for (const sess of store.listSessions({ projectId: pid, limit: SESSION_DISCOVERY_PAGE })) {
                if (candidateIds.has(sess.id)) continue;
                if (sess.tabId && !visitorTabs.has(sess.tabId)) continue;
                if (tabFilter && sess.tabId && !tabFilter.has(sess.tabId)) continue;
                candidateIds.add(sess.id);
            }
        }
    }

    // 2. Pull tail() from each session and merge. Over-fetch by 1 per session
    //    so we can detect single-session truncation (tail returns exactly `cap`
    //    when there are more, indistinguishable from "the session had exactly
    //    `cap` events" otherwise).
    const merged: StoreEvent[] = [];
    let perSessionTruncated = false;
    for (const sid of candidateIds) {
        const events = store.tail(sid, {
            n: cap + 1,
            type: opts.types,
            since: opts.since,
            until: opts.until,
        });
        if (events.length > cap) perSessionTruncated = true;
        for (const ev of events) {
            if (ev.visitorId && ev.visitorId !== visitorId) continue;
            if (tabFilter && ev.tab && !tabFilter.has(ev.tab)) continue;
            merged.push(ev);
        }
    }

    // 3. Ascending sort, then trim to the newest `cap` events.
    merged.sort((a, b) => a.ts - b.ts);
    const truncated = perSessionTruncated || merged.length > cap;
    const slice = merged.length > cap ? merged.slice(merged.length - cap) : merged;

    return {
        visitorId,
        sessionCount: candidateIds.size,
        eventCount: slice.length,
        truncated,
        events: slice,
    };
}
