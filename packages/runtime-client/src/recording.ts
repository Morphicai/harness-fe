import { record } from 'rrweb';
import type { RrwebChunkPayload } from '@harnessa-fe/protocol';

export { RRWEB_FULL_SNAPSHOT_TYPE, chunkHasFullSnapshot } from './rrweb-types.js';

const FLUSH_MS = 5_000;
const MAX_EVENTS = 200;

export class RrwebRecorder {
    private stopRecording?: () => void;
    private flushTimer?: number;
    private chunkSeq = 0;
    private buffer: unknown[] = [];

    constructor(private readonly onChunk: (chunk: RrwebChunkPayload) => void) {}

    start(): void {
        if (this.stopRecording) return;
        this.stopRecording = record({
            emit: (event: unknown) => this.push(event),
            inlineImages: false,
            recordCanvas: false,
            collectFonts: false,
            maskAllInputs: false,
        });
        this.flushTimer = window.setInterval(() => this.flush(), FLUSH_MS);
    }

    stop(): void {
        if (this.flushTimer !== undefined) {
            window.clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
        this.stopRecording?.();
        this.stopRecording = undefined;
        this.flush();
    }

    /**
     * Force rrweb to emit a fresh Meta + FullSnapshot pair right now.
     *
     * Used by the client on every ws hello-ack so each new connection has its
     * own baseline. Without this, the only FullSnapshot for the session is
     * the one rrweb emits at `start()`; if that chunk gets evicted from the
     * outbox (FIFO overflow) or lost because the daemon was down at the
     * critical moment, the session is unreplayable for the rest of its life.
     *
     * Safe to call repeatedly — rrweb just emits another type:2 each time.
     * No-op if the recorder hasn't been started.
     */
    takeFullSnapshot(): void {
        if (!this.stopRecording) return;
        try {
            record.takeFullSnapshot(true);
        } catch {
            // rrweb may throw if DOM is in an unexpected state — never let
            // that bubble up and break the host page.
        }
    }

    private push(event: unknown): void {
        this.buffer.push(event);
        if (this.buffer.length >= MAX_EVENTS) this.flush();
    }

    private flush(): void {
        if (this.buffer.length === 0) return;
        const events = this.buffer.splice(0, this.buffer.length);
        const startTs = getEventTimestamp(events[0]) ?? Date.now();
        const endTs = getEventTimestamp(events[events.length - 1]) ?? startTs;
        this.chunkSeq += 1;
        this.onChunk({
            chunkId: `rrc_${this.chunkSeq.toString().padStart(6, '0')}`,
            startTs,
            endTs,
            eventCount: events.length,
            events,
        });
    }
}

function getEventTimestamp(event: unknown): number | undefined {
    if (event && typeof event === 'object' && 'timestamp' in event) {
        const ts = (event as { timestamp?: unknown }).timestamp;
        if (typeof ts === 'number') return ts;
    }
    return undefined;
}
