/**
 * Caller-identity tagging (4.0 · P1): `createdBy` is write-once on project /
 * session metadata — the first principal to create the record owns it, and
 * later upserts (which never carry an identity in normal flow) must not
 * silently re-attribute ownership.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonlStore } from './JsonlStore.js';

describe('store: createdBy tagging (P1)', () => {
    let dir: string;
    let store: JsonlStore;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'harness-identity-test-'));
        store = new JsonlStore(dir);
    });
    afterEach(() => {
        store.close();
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('project: records createdBy on creation', () => {
        const p = store.upsertProject('proj-a', { createdBy: 'token:abc' });
        expect(p.createdBy).toBe('token:abc');
        expect(store.getProject('proj-a')?.createdBy).toBe('token:abc');
    });

    it('project: createdBy is write-once (later upsert without it is preserved)', () => {
        store.upsertProject('proj-a', { createdBy: 'local' });
        const after = store.upsertProject('proj-a', { displayName: 'renamed' });
        expect(after.createdBy).toBe('local');
        expect(after.displayName).toBe('renamed');
    });

    it('project: a later upsert cannot re-attribute ownership', () => {
        store.upsertProject('proj-a', { createdBy: 'local' });
        const after = store.upsertProject('proj-a', { createdBy: 'token:evil' });
        expect(after.createdBy).toBe('local');
    });

    it('project: createdBy stays undefined when never supplied (back-compat)', () => {
        const p = store.upsertProject('proj-legacy', { displayName: 'x' });
        expect(p.createdBy).toBeUndefined();
    });

    it('session: records and locks createdBy', () => {
        const sid = randomUUID();
        store.upsertSession(sid, {
            tabId: 'tab-1',
            startedAt: Date.now(),
            participants: [{ projectId: 'proj-a', joinedAt: Date.now() }],
            createdBy: 'local',
        });
        store.upsertSession(sid, {
            tabId: 'tab-1',
            startedAt: Date.now(),
            participants: [{ projectId: 'proj-a', joinedAt: Date.now() }],
            createdBy: 'token:other',
        });
        expect(store.getSession(sid)?.createdBy).toBe('local');
    });
});
