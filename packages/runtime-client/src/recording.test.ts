// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted, so the spy refs need to be hoisted alongside it.
const { recordSpy, takeFullSnapshotSpy } = vi.hoisted(() => {
    const takeFullSnapshotSpy = vi.fn();
    const recordSpy = vi.fn(() => () => { /* stop noop */ });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recordSpy as any).takeFullSnapshot = takeFullSnapshotSpy;
    return { recordSpy, takeFullSnapshotSpy };
});

vi.mock('rrweb', () => ({
    record: recordSpy,
    EventType: { Custom: 5 },
}));

import { RrwebRecorder } from './recording.js';

afterEach(() => {
    recordSpy.mockClear();
    takeFullSnapshotSpy.mockClear();
});

describe('RrwebRecorder periodic baseline (checkoutEveryNms)', () => {
    it('passes the default 30-minute interval to rrweb when no option supplied', () => {
        const r = new RrwebRecorder(() => { /* noop */ });
        r.start();
        const call = recordSpy.mock.calls[0]?.[0] as { checkoutEveryNms?: number };
        expect(call.checkoutEveryNms).toBe(30 * 60 * 1000);
        r.stop();
    });

    it('honors an explicit interval', () => {
        const r = new RrwebRecorder(() => { /* noop */ }, { checkoutEveryNms: 60_000 });
        r.start();
        const call = recordSpy.mock.calls[0]?.[0] as { checkoutEveryNms?: number };
        expect(call.checkoutEveryNms).toBe(60_000);
        r.stop();
    });

    it('disables periodic baselines when interval is 0', () => {
        const r = new RrwebRecorder(() => { /* noop */ }, { checkoutEveryNms: 0 });
        r.start();
        const call = recordSpy.mock.calls[0]?.[0] as { checkoutEveryNms?: number };
        expect(call.checkoutEveryNms).toBeUndefined();
        r.stop();
    });

    it('disables periodic baselines for negative intervals', () => {
        const r = new RrwebRecorder(() => { /* noop */ }, { checkoutEveryNms: -1 });
        r.start();
        const call = recordSpy.mock.calls[0]?.[0] as { checkoutEveryNms?: number };
        expect(call.checkoutEveryNms).toBeUndefined();
        r.stop();
    });
});
