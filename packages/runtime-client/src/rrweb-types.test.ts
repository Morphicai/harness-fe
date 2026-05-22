import { describe, it, expect } from 'vitest';
import { chunkHasFullSnapshot, RRWEB_FULL_SNAPSHOT_TYPE } from './rrweb-types.js';

describe('chunkHasFullSnapshot', () => {
    it('returns true when any event has type 2 (FullSnapshot)', () => {
        const chunk = {
            events: [
                { type: 4, timestamp: 1, data: {} }, // Meta
                { type: 2, timestamp: 2, data: {} }, // FullSnapshot
                { type: 3, timestamp: 3, data: {} }, // Incremental
            ],
        };
        expect(chunkHasFullSnapshot(chunk)).toBe(true);
    });

    it('returns false when only incremental events present', () => {
        const chunk = {
            events: [
                { type: 3, timestamp: 1, data: {} },
                { type: 3, timestamp: 2, data: {} },
            ],
        };
        expect(chunkHasFullSnapshot(chunk)).toBe(false);
    });

    it('returns false for empty events array', () => {
        expect(chunkHasFullSnapshot({ events: [] })).toBe(false);
    });

    it('tolerates malformed events without throwing', () => {
        const chunk = {
            events: [null, undefined, 42, 'string', { noType: true }],
        };
        expect(chunkHasFullSnapshot(chunk)).toBe(false);
    });

    it('exports the canonical FullSnapshot type constant', () => {
        expect(RRWEB_FULL_SNAPSHOT_TYPE).toBe(2);
    });
});
