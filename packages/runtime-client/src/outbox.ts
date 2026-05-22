/**
 * Pre-handshake / reconnect outbox.
 *
 * Buffers frames produced while the WebSocket isn't OPEN and replays them
 * in FIFO order on `flush(send)`. Capped to defend against OOM if the
 * bridge is unreachable for an extended period.
 *
 * `sticky` marks frames that must survive eviction even when the outbox
 * is full — currently used for rrweb chunks containing a FullSnapshot
 * (type:2) baseline. Without this protection, the FullSnapshot — being
 * the oldest frame in the outbox — was always the first to be FIFO-
 * evicted under load, leaving the session permanently unreplayable.
 * Eviction only touches sticky frames as a last resort (all remaining
 * frames are sticky and we still exceed cap).
 */
export class Outbox {
    private entries: Array<{ payload: string; sticky: boolean }> = [];
    private bytes = 0;

    constructor(
        private readonly maxFrames: number,
        private readonly maxBytes: number,
    ) {}

    /** Current buffered frame count. */
    get size(): number {
        return this.entries.length;
    }

    /** Current buffered byte size. */
    get byteSize(): number {
        return this.bytes;
    }

    /** Inspect entries without exposing the underlying mutable array. */
    snapshot(): ReadonlyArray<{ payload: string; sticky: boolean }> {
        return this.entries.slice();
    }

    enqueue(payload: string, sticky: boolean): void {
        this.entries.push({ payload, sticky });
        this.bytes += payload.length;

        // Pass 1: evict only non-sticky frames, oldest first.
        let i = 0;
        while ((this.entries.length > this.maxFrames || this.bytes > this.maxBytes) && i < this.entries.length) {
            const entry = this.entries[i]!;
            if (entry.sticky) {
                i++;
                continue;
            }
            this.entries.splice(i, 1);
            this.bytes -= entry.payload.length;
        }

        // Pass 2 (last resort): drop oldest sticky frames if we still bust
        // the cap. Replay only needs the *most recent* baseline, so dropping
        // older sticky frames is acceptable.
        while ((this.entries.length > this.maxFrames || this.bytes > this.maxBytes) && this.entries.length > 0) {
            const dropped = this.entries.shift()!;
            this.bytes -= dropped.payload.length;
        }
    }

    /**
     * Drain FIFO into `send`. If `send` throws (or returns false), keep the
     * frame in the queue and bail — caller will retry on next flush.
     */
    flush(send: (payload: string) => boolean | void): void {
        while (this.entries.length > 0) {
            const entry = this.entries[0]!;
            let ok = false;
            try {
                const result = send(entry.payload);
                ok = result !== false;
            } catch {
                ok = false;
            }
            if (!ok) return;
            this.entries.shift();
            this.bytes -= entry.payload.length;
        }
    }
}
