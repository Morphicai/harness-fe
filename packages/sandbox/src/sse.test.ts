import { describe, expect, it } from 'vitest';
import { SseStreamParser } from './sse.js';

describe('SseStreamParser', () => {
    it('parses a single complete frame', () => {
        const p = new SseStreamParser();
        const frames = p.push('event: message\ndata: hello\nid: 1\n\n');
        expect(frames).toEqual([{ event: 'message', data: 'hello', id: '1' }]);
    });

    it('parses a bare data-only frame (no event/id)', () => {
        const p = new SseStreamParser();
        const frames = p.push('data: hi\n\n');
        expect(frames).toEqual([{ event: undefined, data: 'hi', id: undefined }]);
    });

    it('joins multiple data: lines with \\n per spec', () => {
        const p = new SseStreamParser();
        const frames = p.push('data: line1\ndata: line2\n\n');
        expect(frames[0].data).toBe('line1\nline2');
    });

    it('buffers a partial frame split across two chunks', () => {
        const p = new SseStreamParser();
        expect(p.push('data: par')).toEqual([]);
        const frames = p.push('tial\n\n');
        expect(frames).toEqual([{ event: undefined, data: 'partial', id: undefined }]);
    });

    it('parses multiple frames delivered in one chunk', () => {
        const p = new SseStreamParser();
        const frames = p.push('data: a\n\ndata: b\n\ndata: c\n\n');
        expect(frames.map((f) => f.data)).toEqual(['a', 'b', 'c']);
    });

    it('ignores comment lines and keepalives with no data', () => {
        const p = new SseStreamParser();
        const frames = p.push(': keepalive\n\ndata: real\n\n');
        expect(frames).toEqual([{ event: undefined, data: 'real', id: undefined }]);
    });

    it('supports \\r\\n\\r\\n frame separators', () => {
        const p = new SseStreamParser();
        const frames = p.push('data: crlf\r\n\r\n');
        expect(frames).toEqual([{ event: undefined, data: 'crlf', id: undefined }]);
    });
});
