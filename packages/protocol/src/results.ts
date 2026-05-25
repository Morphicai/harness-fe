/**
 * Standardized result shapes returned by runtime-client back to mcp-server,
 * then up to MCP clients. Text-first + visual auxiliary (see plan §3.5).
 */

import { z } from 'zod';

export const elementSourceSchema = z.object({
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
    col: z.number().int().nonnegative().optional(),
    snippet: z.string().optional(),
});
export type ElementSource = z.infer<typeof elementSourceSchema>;

export const elementInfoSchema = z.object({
    /** outerHTML truncated to a server-side limit. */
    html: z.string(),
    css: z
        .object({
            cssSelector: z.string().optional(),
            ariaLabel: z.string().optional(),
            role: z.string().optional(),
            text: z.string().optional(),
        })
        .optional(),
    component: z.string().optional(),
    source: elementSourceSchema.optional(),
    /** Computed bounding rect + styles (small subset). */
    computed: z
        .object({
            rect: z
                .object({
                    x: z.number(),
                    y: z.number(),
                    width: z.number(),
                    height: z.number(),
                })
                .optional(),
            styles: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
    /** Framework-specific runtime info (React props/state, Vue data). */
    framework: z
        .object({
            type: z.enum(['react', 'vue', 'unknown']).optional(),
            props: z.unknown().optional(),
            state: z.unknown().optional(),
        })
        .optional(),
    /** Ancestor chain (component name → DOM tag). */
    ancestry: z.array(z.string()).optional(),
    /** Optional data URL screenshot. Present in `compact` and `full` modes. */
    thumbnail: z.string().optional(),
});
export type ElementInfo = z.infer<typeof elementInfoSchema>;

export const consoleEntrySchema = z.object({
    ts: z.number(),
    level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
    args: z.array(z.unknown()),
    /** Source location parsed from the call site (best-effort). */
    source: z.string().optional(),
});
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

export const networkEntrySchema = z.object({
    ts: z.number(),
    /** Correlates a `req` event with its matching `res` event. */
    id: z.string().optional(),
    /** Direction marker; absent records carry both req+resp metadata for back-compat. */
    phase: z.enum(['req', 'res']).optional(),
    method: z.string(),
    url: z.string(),
    status: z.number().int().optional(),
    durationMs: z.number().optional(),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    requestBody: z.unknown().optional(),
    responseBody: z.unknown().optional(),
    requestBodyTruncated: z.boolean().optional(),
    responseBodyTruncated: z.boolean().optional(),
    error: z.string().optional(),
    /**
     * Caller stack at request initiation. Best-effort: captured via
     * `new Error().stack` in the runtime-client fetch/XHR/WebSocket patches,
     * with framework frames trimmed. Helps answer "who sent this request?"
     * without resorting to manual breakpoints.
     */
    initiator: z.object({
        stack: z.string().optional(),
    }).optional(),
});
export type NetworkEntry = z.infer<typeof networkEntrySchema>;

export const wsEntrySchema = z.object({
    ts: z.number(),
    /** Stable per-WebSocket identifier — correlates open/send/recv/close. */
    id: z.string(),
    /** open = constructor call, send = client → server, recv = server → client, close = closed. */
    phase: z.enum(['open', 'send', 'recv', 'close']),
    /** Connection URL. Stamped on every phase for self-contained timeline rows. */
    url: z.string(),
    /** sub-protocol(s) negotiated at open. */
    protocols: z.array(z.string()).optional(),
    /** Frame payload (text/JSON parsed when possible, or binary size marker). Absent on open/close. */
    payload: z.unknown().optional(),
    /** True when payload was clipped at the body cap. */
    payloadTruncated: z.boolean().optional(),
    /** Close code (1xxx range). Present on close. */
    code: z.number().int().optional(),
    /** Close reason string from the close handshake. */
    reason: z.string().optional(),
    /** True when close was server-initiated (vs. client `close()`). */
    wasClean: z.boolean().optional(),
    /** Stack at constructor / send call. Best-effort like NetworkEntry.initiator. */
    initiator: z.object({
        stack: z.string().optional(),
    }).optional(),
});
export type WsEntry = z.infer<typeof wsEntrySchema>;

export const errorEntrySchema = z.object({
    ts: z.number(),
    message: z.string(),
    stack: z.string().optional(),
    source: z.string().optional(),
});
export type ErrorEntry = z.infer<typeof errorEntrySchema>;

export const tabInfoSchema = z.object({
    tabId: z.string(),
    projectId: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
    userAgent: z.string().optional(),
    connectedAt: z.number(),
});
export type TabInfo = z.infer<typeof tabInfoSchema>;
