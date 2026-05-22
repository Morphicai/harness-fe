import { describe, it, expect } from 'vitest';
import { Outbox } from './outbox.js';

describe('Outbox', () => {
    describe('FIFO eviction', () => {
        it('evicts oldest non-sticky frame when frame cap is exceeded', () => {
            const outbox = new Outbox(3, 1024);
            outbox.enqueue('a', false);
            outbox.enqueue('b', false);
            outbox.enqueue('c', false);
            outbox.enqueue('d', false); // triggers eviction
            const payloads = outbox.snapshot().map((e) => e.payload);
            expect(payloads).toEqual(['b', 'c', 'd']);
        });

        it('evicts oldest non-sticky frame when byte cap is exceeded', () => {
            const outbox = new Outbox(100, 6); // 6 bytes total
            outbox.enqueue('aa', false); // 2
            outbox.enqueue('bb', false); // 4
            outbox.enqueue('cc', false); // 6
            outbox.enqueue('dd', false); // 8 → evict 'aa'
            const payloads = outbox.snapshot().map((e) => e.payload);
            expect(payloads).toEqual(['bb', 'cc', 'dd']);
            expect(outbox.byteSize).toBe(6);
        });
    });

    describe('sticky protection (the core fix)', () => {
        it('keeps a sticky frame even when older non-sticky frames must yield', () => {
            const outbox = new Outbox(3, 1024);
            outbox.enqueue('fullsnap', true);   // sticky — must survive
            outbox.enqueue('inc-1', false);
            outbox.enqueue('inc-2', false);
            outbox.enqueue('inc-3', false);     // triggers eviction
            const payloads = outbox.snapshot().map((e) => e.payload);
            expect(payloads).toContain('fullsnap');
            // The sticky frame stays; the oldest non-sticky goes.
            expect(payloads).toEqual(['fullsnap', 'inc-2', 'inc-3']);
        });

        it('evicts non-sticky from the middle to preserve a sticky older frame', () => {
            const outbox = new Outbox(2, 1024);
            outbox.enqueue('fullsnap', true);
            outbox.enqueue('inc-1', false);
            outbox.enqueue('inc-2', false); // cap=2 → evict inc-1, keep [fullsnap, inc-2]
            const payloads = outbox.snapshot().map((e) => e.payload);
            expect(payloads).toEqual(['fullsnap', 'inc-2']);
        });

        it('falls back to dropping oldest sticky when ALL frames are sticky and cap busted', () => {
            // Pathological: many ws reconnects, each adding a sticky frame,
            // daemon never staying up to drain.
            const outbox = new Outbox(2, 1024);
            outbox.enqueue('fs-1', true);
            outbox.enqueue('fs-2', true);
            outbox.enqueue('fs-3', true); // cap=2 → must drop oldest sticky
            const payloads = outbox.snapshot().map((e) => e.payload);
            expect(payloads).toEqual(['fs-2', 'fs-3']);
        });

        it('regression: the original FIFO bug — without sticky protection, FullSnapshot would be dropped', () => {
            // Reproduce the original bug shape, but with sticky=true to prove the fix.
            const outbox = new Outbox(500, 8 * 1024 * 1024);
            const BIG_PAYLOAD = 'x'.repeat(20 * 1024); // 20 KB "FullSnapshot"
            outbox.enqueue(BIG_PAYLOAD, true);
            // Flood with 600 incrementals, 20 KB each — bytes cap ~8 MB, frame
            // cap = 500. Without sticky protection the FullSnapshot would be
            // the first evicted (oldest by FIFO).
            for (let i = 0; i < 600; i++) {
                outbox.enqueue('x'.repeat(20 * 1024), false);
            }
            const snap = outbox.snapshot();
            expect(snap[0]!.payload).toBe(BIG_PAYLOAD); // FullSnapshot retained
            expect(snap[0]!.sticky).toBe(true);
            // Outbox stays within frame cap.
            expect(snap.length).toBeLessThanOrEqual(500);
        });
    });

    describe('flush', () => {
        it('sends FIFO in order and clears the queue', () => {
            const outbox = new Outbox(10, 1024);
            outbox.enqueue('a', false);
            outbox.enqueue('b', true);
            outbox.enqueue('c', false);
            const sent: string[] = [];
            outbox.flush((p) => { sent.push(p); });
            expect(sent).toEqual(['a', 'b', 'c']);
            expect(outbox.size).toBe(0);
            expect(outbox.byteSize).toBe(0);
        });

        it('halts on send throw and retains remaining frames for next flush', () => {
            const outbox = new Outbox(10, 1024);
            outbox.enqueue('a', false);
            outbox.enqueue('b', false);
            outbox.enqueue('c', false);
            let calls = 0;
            outbox.flush(() => {
                calls++;
                if (calls === 2) throw new Error('socket died');
            });
            // 'a' sent, 'b' failed → keep 'b' and 'c'
            expect(outbox.snapshot().map((e) => e.payload)).toEqual(['b', 'c']);
        });

        it('treats explicit `false` return as send-failed', () => {
            const outbox = new Outbox(10, 1024);
            outbox.enqueue('a', false);
            outbox.enqueue('b', false);
            outbox.flush((p) => (p === 'b' ? false : true));
            expect(outbox.snapshot().map((e) => e.payload)).toEqual(['b']);
        });
    });
});
