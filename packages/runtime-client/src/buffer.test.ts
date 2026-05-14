import { describe, expect, it } from 'vitest';
import { RingBuffer } from './buffer.js';

describe('RingBuffer', () => {
    it('respects capacity', () => {
        const buf = new RingBuffer<number>(3);
        for (let i = 1; i <= 5; i++) buf.push(i);
        expect(buf.size()).toBe(3);
        expect(buf.tail(3)).toEqual([3, 4, 5]);
    });

    it('tail(n) returns last n items', () => {
        const buf = new RingBuffer<string>(10);
        ['a', 'b', 'c', 'd'].forEach((v) => buf.push(v));
        expect(buf.tail(2)).toEqual(['c', 'd']);
        expect(buf.tail(99)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('clear empties the buffer', () => {
        const buf = new RingBuffer<number>(3);
        buf.push(1);
        buf.clear();
        expect(buf.size()).toBe(0);
        expect(buf.tail(5)).toEqual([]);
    });
});
