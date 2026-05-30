import { describe, expect, it } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MemoryEventStore } from './MemoryEventStore.js';

function msg(id: number): JSONRPCMessage {
    return { jsonrpc: '2.0', id, result: { ok: id } } as JSONRPCMessage;
}

describe('MemoryEventStore', () => {
    it('assigns monotonically ordered event ids per stream', async () => {
        const s = new MemoryEventStore();
        const a1 = await s.storeEvent('A', msg(1));
        const a2 = await s.storeEvent('A', msg(2));
        const b1 = await s.storeEvent('B', msg(1));
        const a3 = await s.storeEvent('A', msg(3));

        expect(a1 < a2).toBe(true);
        expect(a2 < a3).toBe(true);
        expect(b1.startsWith('B::')).toBe(true);
        expect(a1.startsWith('A::')).toBe(true);
    });

    it('replays only events strictly after lastEventId, in order', async () => {
        const s = new MemoryEventStore();
        const ids: string[] = [];
        for (let i = 1; i <= 5; i++) ids.push(await s.storeEvent('A', msg(i)));

        const sent: Array<{ eventId: string; message: JSONRPCMessage }> = [];
        const sid = await s.replayEventsAfter(ids[1]!, {
            send: async (eventId, message) => {
                sent.push({ eventId, message });
            },
        });

        expect(sid).toBe('A');
        expect(sent.map((s) => s.eventId)).toEqual([ids[2], ids[3], ids[4]]);
    });

    it('getStreamIdForEventId recovers stream from event id', async () => {
        const s = new MemoryEventStore();
        const id = await s.storeEvent('stream-xyz', msg(1));
        expect(await s.getStreamIdForEventId(id)).toBe('stream-xyz');
        expect(await s.getStreamIdForEventId('no-separator')).toBeUndefined();
    });

    it('replay across unknown stream returns empty without throwing', async () => {
        const s = new MemoryEventStore();
        const sent: string[] = [];
        const sid = await s.replayEventsAfter('ghost::000000000001', {
            send: async (eventId) => {
                sent.push(eventId);
            },
        });
        expect(sid).toBe('ghost');
        expect(sent).toEqual([]);
    });

    it('evicts oldest per-stream events when maxEventsPerStream is exceeded', async () => {
        const s = new MemoryEventStore({ maxEventsPerStream: 3 });
        const ids: string[] = [];
        for (let i = 1; i <= 5; i++) ids.push(await s.storeEvent('A', msg(i)));

        // After eviction only the last 3 remain. Replaying after the
        // evicted first id returns just whatever is still buffered.
        const sent: string[] = [];
        await s.replayEventsAfter(ids[0]!, {
            send: async (eventId) => {
                sent.push(eventId);
            },
        });
        expect(sent).toEqual([ids[2], ids[3], ids[4]]);
        expect(s.size()).toBe(3);
    });

    it('evicts events older than maxAgeMs', async () => {
        let now = 1_000_000;
        const s = new MemoryEventStore({ maxAgeMs: 1000, now: () => now });
        const id1 = await s.storeEvent('A', msg(1));
        now += 500;
        const id2 = await s.storeEvent('A', msg(2));
        now += 2000; // both old now from id1's perspective, id2 still within window
        const id3 = await s.storeEvent('A', msg(3));

        // id1 + id2 are older than 1000ms relative to `now`, so they are evicted.
        const sent: string[] = [];
        await s.replayEventsAfter(id1, {
            send: async (eventId) => {
                sent.push(eventId);
            },
        });
        expect(sent).toEqual([id3]);
        expect(id2 < id3).toBe(true); // counters still monotonic
    });

    it('never reuses an event id after the stream buffer empties', async () => {
        let now = 1_000;
        const s = new MemoryEventStore({ maxAgeMs: 100, now: () => now });
        const id1 = await s.storeEvent('A', msg(1));
        now += 1000; // evict id1
        const id2 = await s.storeEvent('A', msg(2));

        expect(id1).not.toBe(id2);
        // counter monotonic — id2 must compare greater
        expect(id1 < id2).toBe(true);
    });

    it('evicts across streams when global byte cap is exceeded', async () => {
        // Each msg is ~30 bytes JSON; cap so only ~2 events fit globally.
        const s = new MemoryEventStore({ maxBytesTotal: 60 });
        await s.storeEvent('A', msg(1));
        await s.storeEvent('B', msg(2));
        await s.storeEvent('A', msg(3));
        await s.storeEvent('B', msg(4));

        // Should have shed oldest until under cap.
        expect(s.bytes()).toBeLessThanOrEqual(60);
        expect(s.size()).toBeLessThanOrEqual(3);
    });
});
