/**
 * MemoryEventStore — in-memory bounded buffer of MCP HTTP-streaming events,
 * implements the SDK `EventStore` interface so that
 * `StreamableHTTPServerTransport` can resume a dropped SSE connection from
 * a client-supplied `Last-Event-ID`.
 *
 * Eviction is applied on every store, in this order:
 *   1. drop per-stream events older than `maxAgeMs`
 *   2. drop oldest per-stream events while the stream length exceeds `maxEventsPerStream`
 *   3. drop globally-oldest events across all streams while `totalBytes` exceeds `maxBytesTotal`
 *
 * Event ids are `{streamId}::{padded counter}`. The counter is never reused
 * for a given stream so a reconnect with a stale `Last-Event-ID` can be
 * detected (the id is just absent from the buffer).
 */

import type {
    EventId,
    EventStore,
    StreamId,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface MemoryEventStoreOptions {
    /** Max events retained per stream. Default 1000. */
    maxEventsPerStream?: number;
    /** Max age of a retained event, in ms. Default 5 minutes. */
    maxAgeMs?: number;
    /** Soft cap on total buffered bytes across all streams. Default 50 MiB. */
    maxBytesTotal?: number;
    /** Time source — override for tests. Default `Date.now`. */
    now?: () => number;
}

interface StoredEvent {
    eventId: EventId;
    message: JSONRPCMessage;
    ts: number;
    bytes: number;
}

const SEPARATOR = '::';
const COUNTER_PAD = 12;

export class MemoryEventStore implements EventStore {
    private readonly maxEventsPerStream: number;
    private readonly maxAgeMs: number;
    private readonly maxBytesTotal: number;
    private readonly now: () => number;

    private readonly streams = new Map<StreamId, StoredEvent[]>();
    private readonly counters = new Map<StreamId, number>();
    private totalBytes = 0;

    constructor(opts: MemoryEventStoreOptions = {}) {
        this.maxEventsPerStream = opts.maxEventsPerStream ?? 1000;
        this.maxAgeMs = opts.maxAgeMs ?? 5 * 60_000;
        this.maxBytesTotal = opts.maxBytesTotal ?? 50 * 1024 * 1024;
        this.now = opts.now ?? Date.now;
    }

    async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
        const counter = (this.counters.get(streamId) ?? 0) + 1;
        this.counters.set(streamId, counter);
        const eventId = `${streamId}${SEPARATOR}${counter.toString().padStart(COUNTER_PAD, '0')}`;

        const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
        const stored: StoredEvent = { eventId, message, ts: this.now(), bytes };

        let stream = this.streams.get(streamId);
        if (!stream) {
            stream = [];
            this.streams.set(streamId, stream);
        }
        stream.push(stored);
        this.totalBytes += bytes;

        this.evict();
        return eventId;
    }

    async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
        const idx = eventId.lastIndexOf(SEPARATOR);
        return idx < 0 ? undefined : eventId.slice(0, idx);
    }

    async replayEventsAfter(
        lastEventId: EventId,
        { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
    ): Promise<StreamId> {
        const streamId = await this.getStreamIdForEventId(lastEventId);
        if (!streamId) return '';
        const stream = this.streams.get(streamId);
        if (!stream) return streamId;
        for (const ev of stream) {
            if (ev.eventId > lastEventId) {
                await send(ev.eventId, ev.message);
            }
        }
        return streamId;
    }

    /** Test helper — total events currently buffered. */
    size(): number {
        let n = 0;
        for (const stream of this.streams.values()) n += stream.length;
        return n;
    }

    /** Test helper — current buffered bytes. */
    bytes(): number {
        return this.totalBytes;
    }

    private evict(): void {
        const now = this.now();

        for (const [sid, stream] of this.streams) {
            while (
                stream.length > 0 &&
                (stream.length > this.maxEventsPerStream || now - stream[0].ts > this.maxAgeMs)
            ) {
                const dropped = stream.shift()!;
                this.totalBytes -= dropped.bytes;
            }
            if (stream.length === 0) {
                this.streams.delete(sid);
                // Keep the counter — eventIds must never be reused for a stream
                // even if its buffer is currently empty.
            }
        }

        if (this.totalBytes <= this.maxBytesTotal) return;

        while (this.totalBytes > this.maxBytesTotal) {
            let oldestSid: StreamId | undefined;
            let oldestTs = Infinity;
            for (const [sid, stream] of this.streams) {
                if (stream.length > 0 && stream[0].ts < oldestTs) {
                    oldestTs = stream[0].ts;
                    oldestSid = sid;
                }
            }
            if (!oldestSid) break;
            const stream = this.streams.get(oldestSid)!;
            const dropped = stream.shift()!;
            this.totalBytes -= dropped.bytes;
            if (stream.length === 0) this.streams.delete(oldestSid);
        }
    }
}
