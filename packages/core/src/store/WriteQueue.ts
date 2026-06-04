/**
 * WriteQueue — async batching queue for JSONL timeline writes.
 *
 * Key behaviors:
 * - `seq` is assigned at enqueue time (not flush time) to preserve arrival order
 * - `setTimeout` on first enqueue after a flush — avoids unnecessary timer overhead when idle
 * - `flush` calls `fs.appendFile` once per file path with all buffered lines joined by `\n`
 * - `drain` awaits the current flush and any in-flight writes before returning
 * - On flush failure: log error, discard batch, continue — seq numbers from failed batch are not reused
 *
 * Requirements: 4.1, 4.2, 4.6, 4.7, 4.8
 */

import { appendFile } from 'node:fs/promises';

/** Maximum delay (ms) before a pending flush is executed. */
const FLUSH_DELAY_MS = 16;

export class WriteQueue {
    /** filePath → pending lines to write */
    private buffers = new Map<string, string[]>();

    /** Pending setTimeout handle; null when idle */
    private timer: NodeJS.Timeout | null = null;

    /** sessionId → next seq number (assigned at enqueue time) */
    private seq = new Map<string, number>();

    /** Promise for the currently in-flight flush, if any */
    private flushPromise: Promise<void> | null = null;

    /**
     * Enqueue a StoreEvent line for writing.
     *
     * The `line` parameter should be a JSON object string WITHOUT a `seq` field.
     * WriteQueue assigns the seq for the given sessionId, injects it into the line,
     * and pushes the result to the buffer for `filePath`.
     *
     * @param filePath  Absolute path to the JSONL file to append to
     * @param sessionId Session identifier used to track the per-session seq counter
     * @param line      Pre-serialized JSON object string (without `seq` field)
     */
    enqueue(filePath: string, sessionId: string, line: string): void {
        // Assign seq at enqueue time to preserve arrival order
        const seq = this.seq.get(sessionId) ?? 0;
        this.seq.set(sessionId, seq + 1);

        // Inject seq into the JSON line
        // The line is a JSON object string like '{"ts":1000,"t":"log",...}'
        // We insert seq as the first field for readability
        const lineWithSeq = injectSeq(line, seq);

        // Push to buffer for this file path
        const buf = this.buffers.get(filePath);
        if (buf) {
            buf.push(lineWithSeq);
        } else {
            this.buffers.set(filePath, [lineWithSeq]);
        }

        // Schedule a flush if not already pending
        if (this.timer === null) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.flushPromise = this.flush();
            }, FLUSH_DELAY_MS);
        }
    }

    /**
     * Drain all buffers: one `fs.appendFile` call per file path.
     * On error: log + discard batch (do not retry).
     * Seq numbers from failed batches are not reused.
     */
    async flush(): Promise<void> {
        if (this.buffers.size === 0) return;

        // Snapshot and clear the buffers atomically before any async work.
        // This ensures new enqueues during the flush go into fresh buffers.
        const snapshot = new Map(this.buffers);
        this.buffers.clear();

        const writes: Promise<void>[] = [];

        for (const [filePath, lines] of snapshot) {
            if (lines.length === 0) continue;
            // Join all lines with newline; append a trailing newline
            const content = lines.join('\n') + '\n';
            writes.push(
                appendFile(filePath, content, 'utf-8').catch((err: unknown) => {
                    console.error(
                        `[WriteQueue] flush failed for ${filePath} (${lines.length} events discarded):`,
                        err,
                    );
                    // Discard batch — do not retry, do not reuse seq numbers
                }),
            );
        }

        await Promise.all(writes);
    }

    /**
     * Flush any pending timer-scheduled writes immediately, then await
     * the current in-flight flush (if any). Used on `close()` / SIGINT
     * to ensure all buffered events reach disk before the process exits.
     */
    async drain(): Promise<void> {
        // Cancel the pending timer so we don't double-flush
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        // Capture any already in-flight flush (timer may have fired just before drain)
        const inflight = this.flushPromise;

        // Flush whatever is currently buffered (may be empty if inflight already drained it)
        const newFlush = this.flush();
        this.flushPromise = newFlush;

        // Await both: the previously in-flight flush and the new one
        await Promise.all([inflight, newFlush]);
    }

    /**
     * Get the current seq counter for a session (for testing / inspection).
     * Returns 0 if no events have been enqueued for this session yet.
     */
    getSeq(sessionId: string): number {
        return this.seq.get(sessionId) ?? 0;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inject a `seq` field as the first property of a JSON object string.
 *
 * Input:  '{"ts":1000,"t":"log"}'
 * Output: '{"seq":0,"ts":1000,"t":"log"}'
 *
 * Falls back to appending seq if the line is not a valid JSON object.
 */
function injectSeq(line: string, seq: number): string {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('{')) {
        // Fast path: insert after the opening brace
        const openBrace = line.indexOf('{');
        const rest = line.slice(openBrace + 1).trimStart();
        if (rest.startsWith('}')) {
            // Empty object
            return `{"seq":${seq}}`;
        }
        return `${line.slice(0, openBrace + 1)}"seq":${seq},${line.slice(openBrace + 1)}`;
    }
    // Fallback: parse and re-serialize (handles edge cases)
    try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return JSON.stringify({ seq, ...obj });
    } catch {
        // If the line is not valid JSON, wrap it
        return JSON.stringify({ seq, _raw: line });
    }
}
