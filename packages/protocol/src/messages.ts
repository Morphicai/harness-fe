/**
 * WebSocket message protocol between mcp-server ↔ vite-plugin / runtime-client.
 *
 * One frame = JSON envelope with `type` discriminator + payload. All frames
 * share `id` for request/response correlation.
 */

import { z } from 'zod';
import { returnSizeSchema, selectorSchema } from './selectors.js';

// ─── Identity ───────────────────────────────────────────────────────────────

export const peerRoleSchema = z.enum(['vite-plugin', 'webpack-plugin', 'runtime-client']);
export type PeerRole = z.infer<typeof peerRoleSchema>;

export const helloFrameSchema = z.object({
    type: z.literal('hello'),
    id: z.string(),
    role: peerRoleSchema,
    projectId: z.string(),
    /** Only present for runtime-client. */
    tabId: z.string().optional(),
    /** Optional page metadata for runtime-client. */
    page: z
        .object({
            url: z.string().optional(),
            title: z.string().optional(),
            userAgent: z.string().optional(),
        })
        .optional(),
});
export type HelloFrame = z.infer<typeof helloFrameSchema>;

export const helloAckFrameSchema = z.object({
    type: z.literal('hello.ack'),
    id: z.string(),
    /** Server-assigned tabId (echoed if client supplied one). */
    tabId: z.string().optional(),
    serverVersion: z.string(),
    /** Present when the server rejects the connection (e.g. no active session for runtime-client). */
    error: z.string().optional(),
});
export type HelloAckFrame = z.infer<typeof helloAckFrameSchema>;

// ─── Command (server → client) ──────────────────────────────────────────────

export const commandFrameSchema = z.object({
    type: z.literal('command'),
    id: z.string(),
    /** Routing target. If omitted, server fills in based on active tab. */
    tabId: z.string().optional(),
    command: z.string(),
    args: z.unknown().optional(),
    /** Default return size for tools that produce HTML/screenshot output. */
    size: returnSizeSchema.optional(),
});
export type CommandFrame = z.infer<typeof commandFrameSchema>;

// ─── Response (client → server) ─────────────────────────────────────────────

export const responseFrameSchema = z.object({
    type: z.literal('response'),
    /** Matches the originating command frame id. */
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
        .object({
            code: z.string().optional(),
            message: z.string(),
        })
        .optional(),
});
export type ResponseFrame = z.infer<typeof responseFrameSchema>;

// ─── Event (client → server, server fans out) ───────────────────────────────

export const eventFrameSchema = z.object({
    type: z.literal('event'),
    id: z.string(),
    tabId: z.string().optional(),
    projectId: z.string().optional(),
    /** e.g. 'console', 'network', 'error', 'route', 'hmr', 'user-action', 'rrweb' */
    name: z.string(),
    ts: z.number(),
    payload: z.unknown().optional(),
});
export type EventFrame = z.infer<typeof eventFrameSchema>;

export const rrwebChunkPayloadSchema = z.object({
    chunkId: z.string(),
    startTs: z.number(),
    endTs: z.number(),
    eventCount: z.number().int().nonnegative(),
    events: z.array(z.unknown()),
});
export type RrwebChunkPayload = z.infer<typeof rrwebChunkPayloadSchema>;

// ─── MCP follower channel ──────────────────────────────────────────────────
//
// Allows a second `morphix-dev-bridge` process to attach to an already-running
// daemon as an MCP-only follower. The follower owns its own stdio MCP server
// (one per Claude Code window), and proxies every tool invocation through this
// channel instead of opening its own WS listener.

export const mcpMethodSchema = z.enum([
    'sendCommand',
    'listTabs',
    'listTasks',
    'claimTask',
    'resolveTask',
    // Store / memory methods — proxied from follower to leader via mcp.call channel.
    'storeListProjects',
    'storeListSessions',
    'storeSummary',
    'storeTail',
    'storeSearch',
    'storeRecordingsList',
    'storeRecordingsSlice',
    'storeReplayCreate',
    'storePurge',
    'memorySet',
    'memoryGet',
    'memoryList',
    'memoryDelete',
]);
export type McpMethod = z.infer<typeof mcpMethodSchema>;

export const mcpCallFrameSchema = z.object({
    type: z.literal('mcp.call'),
    id: z.string(),
    method: mcpMethodSchema,
    args: z.unknown().optional(),
});
export type McpCallFrame = z.infer<typeof mcpCallFrameSchema>;

export const mcpReturnFrameSchema = z.object({
    type: z.literal('mcp.return'),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
        .object({
            code: z.string().optional(),
            message: z.string(),
        })
        .optional(),
});
export type McpReturnFrame = z.infer<typeof mcpReturnFrameSchema>;

export const frameSchema = z.discriminatedUnion('type', [
    helloFrameSchema,
    helloAckFrameSchema,
    commandFrameSchema,
    responseFrameSchema,
    eventFrameSchema,
    mcpCallFrameSchema,
    mcpReturnFrameSchema,
]);
export type Frame = z.infer<typeof frameSchema>;

// ─── Built-in command names (string consts for cross-package use) ───────────

export const COMMAND = {
    PAGE_CLICK: 'page.click',
    PAGE_TYPE: 'page.type',
    PAGE_SCROLL: 'page.scroll',
    PAGE_NAVIGATE: 'page.navigate',
    PAGE_RELOAD: 'page.reload',
    PAGE_SET_HTML: 'page.set_html',
    PAGE_SET_STYLE: 'page.set_style',
    PAGE_EVALUATE: 'page.evaluate',
    PAGE_WAIT_FOR: 'page.wait_for',
    PAGE_SCREENSHOT: 'page.screenshot',
    PAGE_DOM_QUERY: 'page.dom_query',
    PAGE_PICK_ELEMENT: 'page.pick_element',
    PAGE_SELECT_REGION: 'page.select_region',
    CONSOLE_TAIL: 'console.tail',
    NETWORK_TAIL: 'network.tail',
    ERRORS_TAIL: 'errors.tail',
    TAB_LIST: 'tab.list',
    PROJECT_SOURCE: 'project.source',
    PROJECT_MODULE_GRAPH: 'project.module_graph',
    PROJECT_WHERE_IS: 'project.where_is',
    PROJECT_SNAPSHOT: 'project.snapshot',
    TASKS_PENDING: 'tasks.pending',
    TASKS_CLAIM: 'tasks.claim',
    TASKS_RESOLVE: 'tasks.resolve',
} as const;

export type CommandName = typeof COMMAND[keyof typeof COMMAND];

// ─── Event names ────────────────────────────────────────────────────────────

export const EVENT_NAME = {
    TASK_SUBMIT: 'task.submit',
    RRWEB: 'rrweb',
} as const;

// ─── User-submitted annotation tasks ────────────────────────────────────────

export const taskSelectorSchema = z.object({
    css: z.string().optional(),
    comp: z.string().optional(),
    loc: z.string().optional(),
});
export type TaskSelector = z.infer<typeof taskSelectorSchema>;

export const taskElementSchema = z.object({
    tag: z.string(),
    outerHTML: z.string(),
    rect: z
        .object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
        })
        .optional(),
});
export type TaskElement = z.infer<typeof taskElementSchema>;

/** Wire payload for `event { name: "task.submit" }` from runtime → daemon. */
export const taskSubmitPayloadSchema = z.object({
    question: z.string(),
    url: z.string(),
    selector: taskSelectorSchema,
    element: taskElementSchema,
});
export type TaskSubmitPayload = z.infer<typeof taskSubmitPayloadSchema>;

export type TaskStatus = 'pending' | 'claimed' | 'resolved';

export interface Task {
    id: string;
    tabId: string;
    projectId: string;
    url: string;
    status: TaskStatus;
    question: string;
    selector: TaskSelector;
    element: TaskElement;
    createdAt: number;
    claimedAt?: number;
    resolvedAt?: number;
    note?: string;
}

// ─── Common command arg shapes ──────────────────────────────────────────────

export const clickArgsSchema = z.object({
    selector: selectorSchema,
    button: z.enum(['left', 'middle', 'right']).default('left').optional(),
});
export type ClickArgs = z.infer<typeof clickArgsSchema>;

export const typeArgsSchema = z.object({
    selector: selectorSchema,
    value: z.string(),
    /** Clear existing value before typing. Default true. */
    clear: z.boolean().optional(),
});
export type TypeArgs = z.infer<typeof typeArgsSchema>;

export const evaluateArgsSchema = z.object({
    /** JS expression executed in page context; result must be JSON-serializable. */
    expr: z.string(),
});
export type EvaluateArgs = z.infer<typeof evaluateArgsSchema>;

export const waitForArgsSchema = z.object({
    /** A predicate name (e.g. 'network.idle', 'dom.visible') or arbitrary JS expr returning truthy. */
    predicate: z.string(),
    timeoutMs: z.number().int().positive().optional(),
});
export type WaitForArgs = z.infer<typeof waitForArgsSchema>;

export const screenshotArgsSchema = z.object({
    selector: selectorSchema.optional(),
    /** PNG default; webp/jpeg for smaller payloads. */
    format: z.enum(['png', 'webp', 'jpeg']).optional(),
    /** Max width in CSS px (preserves aspect ratio). Default 1280 for full, 320 for compact. */
    maxWidth: z.number().int().positive().optional(),
});
export type ScreenshotArgs = z.infer<typeof screenshotArgsSchema>;

export const scrollArgsSchema = z.object({
    /** Scroll the whole page when omitted; scroll a specific element when provided. */
    selector: selectorSchema.optional(),
    /** Pixels to scroll on the x-axis. Default 0. */
    x: z.number().optional(),
    /** Pixels to scroll on the y-axis. Default 0. */
    y: z.number().optional(),
    /** Scroll behaviour. Default 'smooth'. */
    behavior: z.enum(['smooth', 'instant']).optional(),
});
export type ScrollArgs = z.infer<typeof scrollArgsSchema>;

export const navigateArgsSchema = z.object({
    /** Target URL or path (e.g. '/dashboard', 'https://example.com'). */
    url: z.string(),
    /**
     * Navigation method:
     * - 'href'    — full page load via location.href (default)
     * - 'push'    — history.pushState + popstate event (SPA soft nav)
     * - 'replace' — history.replaceState + popstate event (SPA soft nav, no history entry)
     */
    method: z.enum(['href', 'push', 'replace']).optional(),
});
export type NavigateArgs = z.infer<typeof navigateArgsSchema>;

export const reloadArgsSchema = z.object({
    /** When true, bypasses the browser cache (equivalent to Ctrl+Shift+R). Default false. */
    hard: z.boolean().optional(),
});
export type ReloadArgs = z.infer<typeof reloadArgsSchema>;

export const setHtmlArgsSchema = z.object({
    selector: selectorSchema,
    html: z.string().describe('HTML string to inject.'),
    /**
     * - 'innerHTML' (default) — replace the element's inner content, keeping the element itself
     * - 'outerHTML' — replace the element and its tag entirely
     */
    target: z.enum(['innerHTML', 'outerHTML']).optional(),
});
export type SetHtmlArgs = z.infer<typeof setHtmlArgsSchema>;

export const setStyleArgsSchema = z.object({
    selector: selectorSchema.optional().describe(
        'Target element. Omit to inject a global <style> rule instead.',
    ),
    /**
     * When selector is provided: CSS property/value pairs applied as inline styles.
     * When selector is omitted: a raw CSS rule string injected into a <style> tag, e.g.
     *   ".btn { background: red; font-size: 14px; }"
     */
    styles: z.record(z.string(), z.string()).describe(
        'Key-value map of CSS properties (camelCase or kebab-case) to values when targeting an element, ' +
        'or a single-entry map { "rule": "<raw css>" } for global injection.',
    ),
    /** When true, merge with existing inline styles instead of replacing them. Default true. */
    merge: z.boolean().optional(),
});
export type SetStyleArgs = z.infer<typeof setStyleArgsSchema>;
