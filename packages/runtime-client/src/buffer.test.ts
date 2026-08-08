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

describe('RingBuffer — eviction accounting (harness-fe#204 follow-up)', () => {
    it('counts evicted items so a tail can say it is showing a window', () => {
        const buf = new RingBuffer<number>(3);
        for (let i = 1; i <= 10; i++) buf.push(i);
        expect(buf.dropped()).toBe(7);
        expect(buf.cap()).toBe(3);
        expect(buf.all()).toEqual([8, 9, 10]);
    });

    it('reports zero dropped while under capacity, and resets on clear', () => {
        const buf = new RingBuffer<number>(3);
        buf.push(1);
        expect(buf.dropped()).toBe(0);
        buf.push(2); buf.push(3); buf.push(4);
        expect(buf.dropped()).toBe(1);
        buf.clear();
        expect(buf.dropped()).toBe(0);
        expect(buf.all()).toEqual([]);
    });

    it('all() returns a copy — mutating it cannot corrupt the buffer', () => {
        const buf = new RingBuffer<number>(3);
        buf.push(1);
        buf.all().push(999);
        expect(buf.all()).toEqual([1]);
    });
});
