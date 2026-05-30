import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonlStore } from './store/index.js';
import { buildVisitorTimeline } from './visitorTimeline.js';

function openSession(
    store: JsonlStore,
    projectId: string,
    tabId: string,
    sessionId = randomUUID(),
    startedAt = Date.now(),
): string {
    store.upsertTab(tabId, { connectedAt: startedAt });
    store.upsertSession(sessionId, {
        tabId,
        startedAt,
        participants: [{ projectId, joinedAt: startedAt }],
    });
    return sessionId;
}

describe('buildVisitorTimeline', () => {
    let dir: string;
    let store: JsonlStore;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'visitor-timeline-'));
        store = new JsonlStore(dir);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('returns error when visitor not found', async () => {
        await store.flush();
        const result = buildVisitorTimeline(store, 'no-such-visitor');
        expect(result).toEqual({ error: 'visitor not found: no-such-visitor' });
    });

    it('merges events from multiple sessions ascending by ts', async () => {
        const visitorId = 'visitor-1';
        const projectId = 'proj-a';
        const tabA = 'tab-a';
        const tabB = 'tab-b';

        const sessA = openSession(store, projectId, tabA);
        const sessB = openSession(store, projectId, tabB);
        store.upsertVisitor(visitorId, { seenAt: Date.now(), addTabId: tabA, addProjectId: projectId });
        store.upsertVisitor(visitorId, { addTabId: tabB });

        // Interleave events across the two tabs.
        store.appendEvent(sessA, { ts: 1000, t: 'req', tab: tabA, visitorId, d: { url: '/a1' } });
        store.appendEvent(sessB, { ts: 1500, t: 'req', tab: tabB, visitorId, d: { url: '/b1' } });
        store.appendEvent(sessA, { ts: 2000, t: 'res', tab: tabA, visitorId, d: { status: 200 } });
        store.appendEvent(sessB, { ts: 2500, t: 'storage', tab: tabB, visitorId, d: { op: 'remove', key: 'token' } });

        await store.flush();
        const result = buildVisitorTimeline(store, visitorId);
        if ('error' in result) throw new Error(result.error);

        expect(result.eventCount).toBe(4);
        expect(result.sessionCount).toBe(2);
        expect(result.events.map((e) => e.ts)).toEqual([1000, 1500, 2000, 2500]);
        // tabId distribution proves both tabs contributed.
        const tabs = new Set(result.events.map((e) => e.tab));
        expect(tabs).toEqual(new Set([tabA, tabB]));
    });

    it('drops events from other visitors that landed in the same session', async () => {
        const visitorId = 'visitor-mine';
        const otherVisitor = 'visitor-stranger';
        const projectId = 'proj';
        const tabId = 'tab-shared';

        const sess = openSession(store, projectId, tabId);
        store.upsertVisitor(visitorId, { addTabId: tabId, addProjectId: projectId });

        store.appendEvent(sess, { ts: 1000, t: 'req', tab: tabId, visitorId, d: { url: '/mine' } });
        store.appendEvent(sess, { ts: 1500, t: 'req', tab: tabId, visitorId: otherVisitor, d: { url: '/other' } });
        store.appendEvent(sess, { ts: 2000, t: 'req', tab: tabId, visitorId, d: { url: '/mine2' } });

        await store.flush();
        const result = buildVisitorTimeline(store, visitorId);
        if ('error' in result) throw new Error(result.error);

        expect(result.eventCount).toBe(2);
        expect(result.events.every((e) => e.visitorId === visitorId)).toBe(true);
    });

    it('honors tabIds filter at both session-discovery and row level', async () => {
        const visitorId = 'visitor-1';
        const projectId = 'proj';
        const tabA = 'tab-a';
        const tabB = 'tab-b';

        const sessA = openSession(store, projectId, tabA);
        const sessB = openSession(store, projectId, tabB);
        store.upsertVisitor(visitorId, { addTabId: tabA, addProjectId: projectId });
        store.upsertVisitor(visitorId, { addTabId: tabB });

        store.appendEvent(sessA, { ts: 1000, t: 'req', tab: tabA, visitorId, d: {} });
        store.appendEvent(sessB, { ts: 2000, t: 'req', tab: tabB, visitorId, d: {} });

        await store.flush();
        const result = buildVisitorTimeline(store, visitorId, { tabIds: [tabA] });
        if ('error' in result) throw new Error(result.error);

        expect(result.eventCount).toBe(1);
        expect(result.events[0].tab).toBe(tabA);
    });

    it('honors types filter via store.tail', async () => {
        const visitorId = 'visitor-1';
        const projectId = 'proj';
        const tabId = 'tab-1';

        const sess = openSession(store, projectId, tabId);
        store.upsertVisitor(visitorId, { addTabId: tabId, addProjectId: projectId });

        store.appendEvent(sess, { ts: 1000, t: 'log', tab: tabId, visitorId, d: {} });
        store.appendEvent(sess, { ts: 2000, t: 'req', tab: tabId, visitorId, d: {} });
        store.appendEvent(sess, { ts: 3000, t: 'storage', tab: tabId, visitorId, d: {} });

        await store.flush();
        const result = buildVisitorTimeline(store, visitorId, { types: ['req', 'storage'] });
        if ('error' in result) throw new Error(result.error);

        expect(result.events.map((e) => e.t)).toEqual(['req', 'storage']);
    });

    it('limit takes the newest N events and reports truncated=true', async () => {
        const visitorId = 'visitor-1';
        const projectId = 'proj';
        const tabId = 'tab-1';

        const sess = openSession(store, projectId, tabId);
        store.upsertVisitor(visitorId, { addTabId: tabId, addProjectId: projectId });

        for (let i = 0; i < 10; i++) {
            store.appendEvent(sess, { ts: 1000 + i, t: 'log', tab: tabId, visitorId, d: { i } });
        }

        await store.flush();
        const result = buildVisitorTimeline(store, visitorId, { limit: 3 });
        if ('error' in result) throw new Error(result.error);

        expect(result.eventCount).toBe(3);
        expect(result.truncated).toBe(true);
        expect(result.events.map((e) => e.ts)).toEqual([1007, 1008, 1009]);
    });

    it('honors explicit sessionIds (skips visitor → session discovery)', async () => {
        const visitorId = 'visitor-1';
        const projectId = 'proj';
        const tabA = 'tab-a';
        const tabB = 'tab-b';

        const sessA = openSession(store, projectId, tabA);
        const sessB = openSession(store, projectId, tabB);
        store.upsertVisitor(visitorId, { addTabId: tabA, addProjectId: projectId });
        store.upsertVisitor(visitorId, { addTabId: tabB });

        store.appendEvent(sessA, { ts: 1000, t: 'log', tab: tabA, visitorId, d: {} });
        store.appendEvent(sessB, { ts: 2000, t: 'log', tab: tabB, visitorId, d: {} });

        await store.flush();
        const result = buildVisitorTimeline(store, visitorId, { sessionIds: [sessA] });
        if ('error' in result) throw new Error(result.error);

        expect(result.sessionCount).toBe(1);
        expect(result.eventCount).toBe(1);
        expect(result.events[0].tab).toBe(tabA);
    });

    it('honors since/until window', async () => {
        const visitorId = 'visitor-1';
        const projectId = 'proj';
        const tabId = 'tab-1';

        const sess = openSession(store, projectId, tabId);
        store.upsertVisitor(visitorId, { addTabId: tabId, addProjectId: projectId });

        store.appendEvent(sess, { ts: 1000, t: 'log', tab: tabId, visitorId, d: {} });
        store.appendEvent(sess, { ts: 2000, t: 'log', tab: tabId, visitorId, d: {} });
        store.appendEvent(sess, { ts: 3000, t: 'log', tab: tabId, visitorId, d: {} });

        await store.flush();
        const result = buildVisitorTimeline(store, visitorId, { since: 1500, until: 2500 });
        if ('error' in result) throw new Error(result.error);

        expect(result.events.map((e) => e.ts)).toEqual([2000]);
    });
});
