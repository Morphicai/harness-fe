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
    method: z.string(),
    url: z.string(),
    status: z.number().int().optional(),
    durationMs: z.number().optional(),
    requestBody: z.unknown().optional(),
    responseBody: z.unknown().optional(),
});
export type NetworkEntry = z.infer<typeof networkEntrySchema>;

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
