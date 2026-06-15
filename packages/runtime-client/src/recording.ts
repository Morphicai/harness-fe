import { record } from 'rrweb';
import type { RrwebChunkPayload } from '@harness-fe/protocol';

export { RRWEB_FULL_SNAPSHOT_TYPE, chunkHasFullSnapshot } from './rrweb-types.js';

const FLUSH_MS = 5_000;
const MAX_EVENTS = 200;
// Default periodic-baseline cadence. Long-running sessions otherwise rely on
// a single FullSnapshot at start() + one per ws reconnect, which makes
// mid-session window replays expensive (rrweb has to roll forward all
// incremental events back to the original baseline) and leaves a window of
// vulnerability if the original baseline is ever evicted from the outbox.
// 30 min is a deliberate middle ground: ~16 baselines per 8h session at
// ~500KB each ≈ 8MB extra storage, which is acceptable for a dev tool.
const DEFAULT_CHECKOUT_EVERY_MS = 30 * 60 * 1000;

export interface RrwebRecorderOptions {
    /**
     * Force rrweb to emit a fresh FullSnapshot every N milliseconds. Caps how
     * stale the most recent baseline can be, so window replays mid-session
     * don't have to roll forward from a baseline that's potentially hours old.
     *
     * Set to `0` (or a negative number) to disable periodic baselines and
     * rely solely on the start() baseline + reconnect baselines. Useful for
     * extremely bandwidth-constrained deployments.
     *
     * @default 30 * 60 * 1000  (30 minutes)
     */
    checkoutEveryNms?: number;
    /**
     * CSS selector passed to rrweb as `blockSelector`: matching subtrees are
     * recorded as an inert placeholder and never descended into. Used to keep
     * rrweb out of micro-frontend containers it cannot safely serialize —
     * notably wujie's `wujie-app` shadow host / sandbox iframe, where full-tree
     * traversal throws. The embedded sub-app should run its own harness.
     */
    blockSelector?: string;
}

export class RrwebRecorder {
    private stopRecording?: () => void;
    private flushTimer?: number;
    private chunkSeq = 0;
    private buffer: unknown[] = [];

    constructor(
        private readonly onChunk: (chunk: RrwebChunkPayload) => void,
        private readonly opts: RrwebRecorderOptions = {},
    ) {}

    start(): void {
        if (this.stopRecording) return;
        const checkoutEveryNms = this.opts.checkoutEveryNms ?? DEFAULT_CHECKOUT_EVERY_MS;
        // rrweb interprets `checkoutEveryNms` falsy / undefined as "off".
        // Pass undefined when disabled so we get the native off-path.
        this.stopRecording = record({
            emit: (event: unknown) => this.push(event),
            inlineImages: false,
            recordCanvas: false,
            collectFonts: false,
            maskAllInputs: false,
            checkoutEveryNms: checkoutEveryNms > 0 ? checkoutEveryNms : undefined,
            // Keep rrweb out of subtrees it can't serialize (e.g. wujie's
            // shadow/iframe container) — traversal there throws and corrupts
            // the FullSnapshot baseline. undefined when unset = rrweb default.
            blockSelector: this.opts.blockSelector || undefined,
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
