/**
 * Minimal Server-Sent Events frame parser (harness-fe#204).
 *
 * Frames are separated by a blank line. Within a frame, `data:` lines are
 * concatenated with `\n` (per the WHATWG spec), and the last `event:`/`id:`
 * line wins if repeated. Comment lines (starting with `:`) and unknown
 * fields are ignored. `retry:` is intentionally not surfaced — it configures
 * client reconnect behavior, not application data.
 */

export interface ParsedSseFrame {
    event?: string;
    data: string;
    id?: string;
}

/** Splits a raw SSE chunk (one "event:...\ndata:...\n\n" block) into a frame. Returns undefined for a frame with no `data:` line (e.g. a bare comment/keepalive). */
function parseFrame(raw: string): ParsedSseFrame | undefined {
    let event: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
        if (line === '' || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'id') id = value;
        else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0) return undefined;
    return { event, data: dataLines.join('\n'), id };
}

/**
 * Incremental SSE stream parser. Feed it decoded text chunks as they arrive
 * (`push`); it buffers a partial trailing frame across calls and returns
 * every complete frame found so far.
 */
export class SseStreamParser {
    private buffer = '';

    push(chunk: string): ParsedSseFrame[] {
        this.buffer += chunk;
        // Frames are separated by a blank line; tolerate both \n\n and \r\n\r\n.
        const parts = this.buffer.split(/\r?\n\r?\n/);
        this.buffer = parts.pop() ?? '';
        const frames: ParsedSseFrame[] = [];
        for (const part of parts) {
            const frame = parseFrame(part);
            if (frame) frames.push(frame);
        }
        return frames;
    }
}
