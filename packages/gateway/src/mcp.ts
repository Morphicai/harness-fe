/**
 * MCP server hosted *by the gateway*, in front of an in-process core.
 *
 * Each tool handler calls `CoreCapabilities` (never a bridge / remote daemon).
 * The session's {@link Principal} is baked in at creation: a tool is only
 * registered when the principal holds the scope it needs, so an agent's
 * `tools/list` is the scoped manifest (a read-only token never even sees
 * `page.*`). The capability layer re-checks scope on every call (defense in
 * depth) and enforces tenant visibility + command-target scoping.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    COMMAND,
    PROTOCOL_VERSION,
    checkArgsSchema,
    clickArgsSchema,
    dialogHandlerSchema,
    evaluateArgsSchema,
    navigateArgsSchema,
    pasteArgsSchema,
    reloadArgsSchema,
    screenshotArgsSchema,
    scrollArgsSchema,
    selectArgsSchema,
    setHtmlArgsSchema,
    setStyleArgsSchema,
    selectorSchema,
    snapshotArgsSchema,
    typeArgsSchema,
    uploadArgsSchema,
    waitForArgsSchema,
} from '@harness-fe/protocol';
import {
    type CoreCapabilities,
    type CapabilityScope,
    type Principal,
    principalCan,
    requiredScopeForCommand,
} from '@harness-fe/core';

const SERVER_NAME = 'harness-fe';

export interface McpServerOptions {
    /** Name of the env var that gates experimental tools. Omit → fully on. */
    experimentalEnvVar?: string;
    /** Build the /console URL for `dashboard.open` (optionally deep-linked to a session). */
    consoleUrl?: (sessionId?: string) => string | undefined;
    /** Open a URL in the user's browser (host machine only). Omit → never launches. */
    openBrowser?: (url: string) => { opened: boolean; reason?: string };
}

/**
 * Boot an MCP server over **stdio** against the in-process core — the solo
 * (zero-config) path. The agent that spawns the CLI talks MCP over stdin/stdout;
 * it is the trusted local operator, so the principal is unrestricted.
 */
export async function startMcpStdioServer(
    caps: CoreCapabilities,
    options: McpServerOptions = {},
): Promise<McpServer> {
    const server = createMcpServer(caps, { id: 'local', kind: 'local', displayName: 'local' }, options);
    await server.connect(new StdioServerTransport());
    return server;
}

export function experimentalEnabled(envVar?: string): boolean {
    if (envVar == null || envVar.trim() === '') return true;
    const raw = process.env[envVar];
    return typeof raw === 'string' && raw.trim() !== '';
}

const tabIdParam = z
    .string()
    .optional()
    .describe('Optional tab id (from tab.list). Default = most-recent active tab.');

// The MCP SDK's registerTool is heavily generic (infers the Zod shape); capturing
// its parameter types via Parameters<> collapses to `never`. We pass a loose
// config shape and cast at the single call site — runtime validation is still
// done by the SDK from the Zod inputSchema.
type ToolConfig = { description: string; inputSchema?: Record<string, z.ZodTypeAny> };
type ToolHandler = (args: any, extra: any) => unknown;
type RegisterTool = (name: string, config: ToolConfig, handler: ToolHandler) => void;
type Gate = (scope: CapabilityScope, name: string, config: ToolConfig, handler: ToolHandler) => void;
type CommandReg = (
    name: string,
    config: ToolConfig,
    build: (a: Record<string, unknown>) => { args: unknown; opts?: { tabId?: string; target?: 'runtime-client' | 'vite-plugin'; projectId?: string } },
) => void;

function ok<T>(value: T): { content: Array<{ type: 'text'; text: string }> } {
    return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    };
}

function err(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
    return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Build an McpServer with every tool the `principal` is allowed to see,
 * each wired to `caps` and carrying the baked principal.
 */
export function createMcpServer(
    caps: CoreCapabilities,
    principal: Principal,
    options: McpServerOptions = {},
): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: PROTOCOL_VERSION });

    const reg: RegisterTool = (name, config, handler) => {
        (server.registerTool as any)(name, config, handler);
    };

    /** Register a tool only when the principal holds `scope` (scoped manifest). */
    const gated: Gate = (scope, name, config, handler) => {
        if (!principalCan(principal, scope)) return;
        reg(name, config, handler);
    };

    /** A browser/plugin command tool — scope derived from CONTROL_COMMANDS. */
    const command: CommandReg = (name, config, build) => {
        gated(requiredScopeForCommand(name), name, config, async (a: Record<string, unknown>) => {
            const { args, opts } = build(a);
            return ok(await caps.command(name, args, principal, opts));
        });
    };

    registerCommandTools(command);
    registerReadTools(caps, principal, gated);
    if (experimentalEnabled(options.experimentalEnvVar)) {
        gated('read', 'experimental.ping', { description: 'Experimental-mode probe.', inputSchema: {} }, async () =>
            ok({ ok: true, experimental: true, protocolVersion: PROTOCOL_VERSION }));
    }
    registerDashboardTool(gated, options);

    return server;
}

// ─── command tools (sendCommand) ──────────────────────────────────────────────

function registerCommandTools(command: CommandReg): void {
    command(COMMAND.PAGE_CLICK, {
        description: 'Click on a DOM element resolved by the selector.',
        inputSchema: { selector: selectorSchema, button: z.enum(['left', 'middle', 'right']).optional(), tabId: tabIdParam },
    }, ({ selector, button, tabId }) => ({ args: clickArgsSchema.parse({ selector, button }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_TYPE, {
        description: 'Type a value into an input/textarea resolved by the selector.',
        inputSchema: { selector: selectorSchema, value: z.string(), clear: z.boolean().optional(), tabId: tabIdParam },
    }, ({ selector, value, clear, tabId }) => ({ args: typeArgsSchema.parse({ selector, value, clear }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_UPLOAD, {
        description: "Set files on a `<input type='file'>` element and fire change/input events. Files are base64-encoded content provided by the agent.",
        inputSchema: {
            selector: selectorSchema,
            files: z.array(z.object({
                name: z.string(),
                content: z.string().describe('Base64-encoded file content, provided by agent.'),
                mimeType: z.string().optional(),
            })).min(1),
            tabId: tabIdParam,
        },
    }, ({ selector, files, tabId }) => ({ args: uploadArgsSchema.parse({ selector, files }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_SELECT, {
        description: 'Set the value of a `<select>` element and fire change/input events.',
        inputSchema: { selector: selectorSchema, value: z.string(), tabId: tabIdParam },
    }, ({ selector, value, tabId }) => ({ args: selectArgsSchema.parse({ selector, value }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_CHECK, {
        description: 'Set checked state on a checkbox or radio input and fire change/input events.',
        inputSchema: { selector: selectorSchema, checked: z.boolean(), tabId: tabIdParam },
    }, ({ selector, checked, tabId }) => ({ args: checkArgsSchema.parse({ selector, checked }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_PASTE, {
        description: 'Dispatch a paste event with synthetic clipboard data to an element.',
        inputSchema: { selector: selectorSchema, content: z.string(), html: z.string().optional(), tabId: tabIdParam },
    }, ({ selector, content, html, tabId }) => ({ args: pasteArgsSchema.parse({ selector, content, html }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_EVALUATE, {
        description: 'Evaluate a JS expression in page context. Must return a JSON-serializable value.',
        inputSchema: { expr: z.string(), tabId: tabIdParam },
    }, ({ expr, tabId }) => ({ args: evaluateArgsSchema.parse({ expr }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_WAIT_FOR, {
        description: 'Wait until a predicate becomes truthy. Built-ins: "network.idle", "dom.ready". Otherwise a JS expression.',
        inputSchema: { predicate: z.string(), timeoutMs: z.number().int().positive().optional(), tabId: tabIdParam },
    }, ({ predicate, timeoutMs, tabId }) => ({ args: waitForArgsSchema.parse({ predicate, timeoutMs }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_SCREENSHOT, {
        description: 'Take a screenshot. Without `selector`, the full viewport is captured.',
        inputSchema: { selector: selectorSchema.optional(), format: z.enum(['png', 'webp', 'jpeg']).optional(), maxWidth: z.number().int().positive().optional(), tabId: tabIdParam },
    }, ({ selector, format, maxWidth, tabId }) => ({ args: screenshotArgsSchema.parse({ selector, format, maxWidth }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_DOM_QUERY, {
        description: 'Return outerHTML of the matched element(s). Text-first inspection tool.',
        inputSchema: { selector: selectorSchema, limit: z.number().int().positive().optional(), tabId: tabIdParam },
    }, ({ selector, limit, tabId }) => ({ args: { selector, limit }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_SNAPSHOT, {
        description: 'Compact index of visible clickable elements (<a>, <button> only) with short-lived refs. Pass {selector: {ref}} to page.click/page.type to act on one without writing a selector — refs invalidate on the next snapshot.',
        inputSchema: { limit: z.number().int().positive().optional(), tabId: tabIdParam },
    }, ({ limit, tabId }) => ({ args: snapshotArgsSchema.parse({ limit }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_SCROLL, {
        description: 'Scroll the page or a specific element. Omit selector to scroll the whole page.',
        inputSchema: { selector: selectorSchema.optional(), x: z.number().optional(), y: z.number().optional(), behavior: z.enum(['smooth', 'instant']).optional(), tabId: tabIdParam },
    }, ({ selector, x, y, behavior, tabId }) => ({ args: scrollArgsSchema.parse({ selector, x, y, behavior }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_NAVIGATE, {
        description: "Navigate to a URL or path. method='href' = full load (default); 'push'/'replace' = SPA soft nav.",
        inputSchema: { url: z.string(), method: z.enum(['href', 'push', 'replace']).optional(), tabId: tabIdParam },
    }, ({ url, method, tabId }) => ({ args: navigateArgsSchema.parse({ url, method }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_RELOAD, {
        description: 'Reload the current page. Use hard=true to bypass the browser cache.',
        inputSchema: { hard: z.boolean().optional(), tabId: tabIdParam },
    }, ({ hard, tabId }) => ({ args: reloadArgsSchema.parse({ hard }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_SET_HTML, {
        description: 'Replace innerHTML/outerHTML of a DOM element (in-memory, resets on reload).',
        inputSchema: { selector: selectorSchema, html: z.string(), target: z.enum(['innerHTML', 'outerHTML']).optional(), tabId: tabIdParam },
    }, ({ selector, html, target, tabId }) => ({ args: setHtmlArgsSchema.parse({ selector, html, target }), opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.PAGE_SET_STYLE, {
        description: 'Apply inline CSS to an element or inject a global <style> rule (in-memory).',
        inputSchema: {
            selector: selectorSchema.optional(),
            styles: z.record(z.string(), z.string()),
            merge: z.boolean().optional(),
            tabId: tabIdParam,
        },
    }, ({ selector, styles, merge, tabId }) => ({ args: setStyleArgsSchema.parse({ selector, styles, merge }), opts: { tabId: tabId as string | undefined } }));

    const filterParam = z.string().optional().describe('Substring or regex (see `match`) against the serialized payload.');
    const matchParam = z.enum(['contains', 'regex']).optional().describe('How to interpret `filter`. Default contains (case-insensitive).');
    const n = z.number().int().positive().default(20).optional();

    command(COMMAND.CONSOLE_TAIL, {
        description: 'Return the last N console entries. `filter`/`match`/`level`. Buffer cleared on navigate.',
        inputSchema: { n, filter: filterParam, match: matchParam, level: z.enum(['log', 'info', 'warn', 'error', 'debug']).optional(), tabId: tabIdParam },
    }, ({ n: nn, filter, match, level, tabId }) => ({ args: { n: (nn as number) ?? 20, filter, match, level }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.NETWORK_TAIL, {
        description: 'Return the last N network requests (phase=req|res). `filter`/`urlContains`/`method`/`statusCode`.',
        inputSchema: { n, includeBody: z.boolean().optional(), filter: filterParam, match: matchParam, urlContains: z.string().optional(), method: z.string().optional(), statusCode: z.number().int().optional(), tabId: tabIdParam },
    }, ({ n: nn, includeBody, filter, match, urlContains, method, statusCode, tabId }) => ({ args: { n: (nn as number) ?? 20, includeBody: includeBody ?? false, filter, match, urlContains, method, statusCode }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.ERRORS_TAIL, {
        description: 'Return the last N JavaScript errors. `filter`/`match` against {message, stack, source}.',
        inputSchema: { n, filter: filterParam, match: matchParam, tabId: tabIdParam },
    }, ({ n: nn, filter, match, tabId }) => ({ args: { n: (nn as number) ?? 20, filter, match }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.WS_TAIL, {
        description: 'Return the last N WebSocket frames (phase=open|send|recv|close). `filter`/`phase`.',
        inputSchema: { n, filter: filterParam, match: matchParam, phase: z.enum(['open', 'send', 'recv', 'close']).optional(), tabId: tabIdParam },
    }, ({ n: nn, filter, match, phase, tabId }) => ({ args: { n: (nn as number) ?? 20, filter, match, phase }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.NETWORK_WAIT_FOR, {
        description: 'Resolve when a matching network request happens (or reject on timeout). Considers requests AFTER this call.',
        inputSchema: { urlContains: z.string().optional(), urlRegex: z.string().optional(), method: z.string().optional(), statusCode: z.number().int().optional(), timeoutMs: z.number().int().positive().default(10000).optional(), tabId: tabIdParam },
    }, ({ urlContains, urlRegex, method, statusCode, timeoutMs, tabId }) => ({ args: { urlContains, urlRegex, method, statusCode, timeoutMs }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.NETWORK_WAIT_FOR_IDLE, {
        description: 'Resolve when no new network entries for `idleMs` (default 500). Like Playwright networkidle.',
        inputSchema: { idleMs: z.number().int().positive().default(500).optional(), timeoutMs: z.number().int().positive().default(10000).optional(), tabId: tabIdParam },
    }, ({ idleMs, timeoutMs, tabId }) => ({ args: { idleMs, timeoutMs }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.NETWORK_GET, {
        description: 'Return all entries (req + res) for a single network request id.',
        inputSchema: { reqId: z.string(), tabId: tabIdParam },
    }, ({ reqId, tabId }) => ({ args: { reqId }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.WS_GET, {
        description: 'Return all frames for a single WebSocket id.',
        inputSchema: { wsId: z.string(), tabId: tabIdParam },
    }, ({ wsId, tabId }) => ({ args: { wsId }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.STORAGE_TAIL, {
        description: 'Return the last N storage mutations (op=set|remove|clear, which=local|session|cookie).',
        inputSchema: { n, filter: filterParam, match: matchParam, which: z.enum(['local', 'session', 'cookie']).optional(), op: z.enum(['set', 'remove', 'clear']).optional(), key: z.string().optional(), tabId: tabIdParam },
    }, ({ n: nn, filter, match, which, op, key, tabId }) => ({ args: { n: (nn as number) ?? 20, filter, match, which, op, key }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.NAVIGATION_TAIL, {
        description: 'Return the last N navigation events (push/replace/pop/hash/assign).',
        inputSchema: { n, filter: filterParam, match: matchParam, kind: z.enum(['push', 'replace', 'pop', 'hash', 'assign']).optional(), tabId: tabIdParam },
    }, ({ n: nn, filter, match, kind, tabId }) => ({ args: { n: (nn as number) ?? 20, filter, match, kind }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.GLOBALS_TAIL, {
        description: 'Return the last N read/writes to watched window globals (op=get|set|delete).',
        inputSchema: { n, filter: filterParam, match: matchParam, op: z.enum(['get', 'set', 'delete']).optional(), key: z.string().optional(), tabId: tabIdParam },
    }, ({ n: nn, filter, match, op, key, tabId }) => ({ args: { n: (nn as number) ?? 20, filter, match, op, key }, opts: { tabId: tabId as string | undefined } }));

    command(COMMAND.INDEXEDDB_TAIL, {
        description: 'Return the last N IndexedDB operations (open/put/add/get/getAll/delete/clear/cursor).',
        inputSchema: { n, filter: filterParam, match: matchParam, op: z.enum(['open', 'put', 'add', 'get', 'getAll', 'delete', 'clear', 'cursor']).optional(), store: z.string().optional(), db: z.string().optional(), tabId: tabIdParam },
    }, ({ n: nn, filter, match, op, store, db, tabId }) => ({ args: { n: (nn as number) ?? 20, filter, match, op, store, db }, opts: { tabId: tabId as string | undefined } }));

    // project.* target the vite-plugin
    command(COMMAND.PROJECT_SOURCE, {
        description: 'Read source for a file or component. Specify exactly one of `file` or `component`.',
        inputSchema: { file: z.string().optional(), component: z.string().optional(), projectId: z.string().optional() },
    }, ({ file, component, projectId }) => ({ args: { file, component }, opts: { target: 'vite-plugin', projectId: projectId as string | undefined } }));

    command(COMMAND.PROJECT_WHERE_IS, {
        description: 'Return file:line:col for a given component name.',
        inputSchema: { component: z.string(), projectId: z.string().optional() },
    }, ({ component, projectId }) => ({ args: { component }, opts: { target: 'vite-plugin', projectId: projectId as string | undefined } }));

    command(COMMAND.PROJECT_MODULE_GRAPH, {
        description: 'Return the component map discovered by the AST scan.',
        inputSchema: { projectId: z.string().optional() },
    }, ({ projectId }) => ({ args: {}, opts: { target: 'vite-plugin', projectId: projectId as string | undefined } }));
}

// ─── read tools (tabs, tasks, store, memory) ──────────────────────────────────

function registerReadTools(caps: CoreCapabilities, principal: Principal, gated: Gate): void {
    const R = (name: string, config: ToolConfig, handler: (a: Record<string, unknown>) => unknown) =>
        gated('read', name, config, async (a: Record<string, unknown>) => ok(await handler(a)));

    R(COMMAND.TAB_LIST, { description: 'List all currently connected browser tabs.', inputSchema: {} },
        () => caps.listTabs(principal));

    gated('read', COMMAND.SET_DIALOG_HANDLER, {
        description: 'Pre-register a return value for the next alert/confirm/prompt call triggered by agent actions.',
        inputSchema: {
            type: z.enum(['alert', 'confirm', 'prompt']),
            value: z.union([z.boolean(), z.string()]).optional(),
            tabId: tabIdParam,
        },
    }, async ({ type, value, tabId }: { type: string; value?: boolean | string; tabId?: string }) => {
        return ok(await caps.command(COMMAND.SET_DIALOG_HANDLER, dialogHandlerSchema.parse({ type, value }), principal, { tabId: tabId as string | undefined }));
    });

    const taskStatusEnum = z.enum(['pending', 'claimed', 'resolved', 'all']);

    R(COMMAND.TASKS_PENDING, {
        description: 'List user-submitted annotation tasks. Default status="pending".',
        inputSchema: { status: taskStatusEnum.optional(), limit: z.number().int().positive().optional() },
    }, async ({ status, limit }) => {
        const tasks = await caps.tasksPending(principal, { status: status as never, limit: limit as number | undefined });
        const summary = tasks.map((t) => ({ id: t.id, status: t.status, question: t.question, selector: t.selector, url: t.url, tabId: t.tabId, createdAt: t.createdAt, claimedAt: t.claimedAt, resolvedAt: t.resolvedAt, note: t.note }));
        return { count: summary.length, tasks: summary };
    });

    gated('read', COMMAND.TASKS_CLAIM, {
        description: 'Claim a task by id. Returns full payload (selector + element outerHTML + rect).',
        inputSchema: { taskId: z.string() },
    }, async ({ taskId }: { taskId: string }) => {
        const task = await caps.tasksClaim(principal, taskId);
        if (!task) throw new Error(`tasks.claim: no task with id "${taskId}"`);
        return ok(task);
    });

    gated('read', COMMAND.TASKS_RESOLVE, {
        description: 'Mark a task resolved with an optional note + structured resolution (feedback loop back-link).',
        inputSchema: {
            taskId: z.string(),
            note: z.string().optional(),
            resolution: z.object({
                type: z.enum(['code-fix', 'config', 'wontfix', 'duplicate', 'cannot-reproduce']).optional(),
                commit: z.string().optional(),
                prUrl: z.string().optional(),
                verificationSessionId: z.string().optional(),
                verifiedAt: z.number().optional(),
            }).optional(),
        },
    }, async ({ taskId, note, resolution }: { taskId: string; note?: string; resolution?: never }) => {
        const task = await caps.tasksResolve(principal, taskId, note, resolution);
        if (!task) throw new Error(`tasks.resolve: no task with id "${taskId}"`);
        return ok({ ok: true, task });
    });

    gated('read', 'tasks.get_attachment', {
        description: 'Return a task screenshot attachment as a vision-ready image block.',
        inputSchema: { taskId: z.string(), attachmentId: z.string() },
    }, async ({ taskId, attachmentId }: { taskId: string; attachmentId: string }) => {
        const base64 = await caps.taskAttachment(principal, taskId, attachmentId);
        if (!base64) throw new Error(`tasks.get_attachment: attachment not found (taskId=${taskId}, attachmentId=${attachmentId})`);
        return { content: [{ type: 'image' as const, mimeType: 'image/png' as const, data: base64 }] };
    });

    R('session.list', {
        description: 'List recent sessions for a project.',
        inputSchema: { projectId: z.string(), limit: z.number().int().positive().default(10).optional() },
    }, ({ projectId, limit }) => caps.sessionList(principal, projectId as string, (limit as number | undefined) ?? 10));

    R('session.summary', { description: 'Summarize a session: event counts, last error, active tabs.', inputSchema: { sessionId: z.string() } },
        ({ sessionId }) => caps.sessionSummary(principal, sessionId as string));

    R('session.tail', {
        description: 'Read the last N events from a session timeline. Filter by type/projectId.',
        inputSchema: { sessionId: z.string(), n: z.number().int().positive().default(50).optional(), type: z.union([z.string(), z.array(z.string())]).optional(), projectId: z.string().optional(), since: z.number().optional(), until: z.number().optional() },
    }, ({ sessionId, n, type, projectId, since, until }) => caps.sessionTail(principal, sessionId as string, { n: n as number | undefined, type: type as string | string[] | undefined, projectId: projectId as string | undefined, since: since as number | undefined, until: until as number | undefined }));

    R('session.search', {
        description: 'Search events in a session timeline by substring match.',
        inputSchema: { sessionId: z.string(), query: z.string(), type: z.union([z.string(), z.array(z.string())]).optional(), limit: z.number().int().positive().default(50).optional() },
    }, ({ sessionId, query, type, limit }) => caps.sessionSearch(principal, sessionId as string, query as string, { type: type as string | string[] | undefined, limit: limit as number | undefined }));

    R('project.sessions', { description: 'List all visible projects with their most recent session info.', inputSchema: {} },
        () => caps.projectSessions(principal));

    R('project.list', { description: 'List every project the daemon has seen (full metadata).', inputSchema: {} },
        () => caps.projectList(principal));

    R('project.get', { description: "Read a single project's metadata.", inputSchema: { projectId: z.string() } },
        ({ projectId }) => caps.projectGet(principal, projectId as string));

    R('project.tree', { description: 'Project forest assembled from parentProjectId relationships.', inputSchema: { rootId: z.string().optional() } },
        ({ rootId }) => caps.projectTree(principal, rootId as string | undefined));

    R('project.set_parent', { description: "Set or clear a project's parentProjectId (rejects cycles).", inputSchema: { projectId: z.string(), parentProjectId: z.string().nullable().optional() } },
        ({ projectId, parentProjectId }) => caps.projectSetParent(principal, projectId as string, (parentProjectId as string | null | undefined) ?? undefined));

    R('build.list', { description: 'List builds for a project, newest first.', inputSchema: { projectId: z.string(), limit: z.number().int().positive().optional() } },
        ({ projectId, limit }) => caps.buildList(principal, projectId as string, limit as number | undefined));

    R('build.get', { description: "Read a single build's metadata.", inputSchema: { projectId: z.string(), buildId: z.string() } },
        ({ projectId, buildId }) => caps.buildGet(principal, projectId as string, buildId as string));

    R('visitor.list', { description: 'List known visitors. Filter by projectId.', inputSchema: { projectId: z.string().optional(), limit: z.number().int().positive().optional() } },
        ({ projectId, limit }) => caps.visitorList(principal, { projectId: projectId as string | undefined, limit: limit as number | undefined }));

    R('visitor.get', { description: "Read a single visitor's metadata.", inputSchema: { visitorId: z.string() } },
        ({ visitorId }) => caps.visitorGet(principal, visitorId as string));

    R('visitor.journey', { description: 'Chronological session list for one visitor.', inputSchema: { visitorId: z.string(), limit: z.number().int().positive().optional() } },
        ({ visitorId, limit }) => caps.visitorJourney(principal, visitorId as string, limit as number | undefined));

    R('visitor.timeline', {
        description: 'Merged cross-session event timeline for one visitor (ascending by ts).',
        inputSchema: { visitorId: z.string(), since: z.number().optional(), until: z.number().optional(), types: z.union([z.string(), z.array(z.string())]).optional(), tabIds: z.array(z.string()).optional(), sessionIds: z.array(z.string()).optional(), limit: z.number().int().positive().optional() },
    }, ({ visitorId, since, until, types, tabIds, sessionIds, limit }) => caps.visitorTimeline(principal, visitorId as string, { since: since as number | undefined, until: until as number | undefined, types: types as string | string[] | undefined, tabIds: tabIds as string[] | undefined, sessionIds: sessionIds as string[] | undefined, limit: limit as number | undefined }));

    R('session.recordings.list', { description: 'List rrweb recording chunks for a session.', inputSchema: { sessionId: z.string() } },
        ({ sessionId }) => caps.recordingsList(principal, sessionId as string));

    R('session.recordings.around', { description: 'Recording chunks overlapping a window around a timestamp.', inputSchema: { sessionId: z.string(), ts: z.number(), windowMs: z.number().int().positive().default(15000).optional() } },
        ({ sessionId, ts, windowMs }) => caps.recordingsAround(principal, sessionId as string, ts as number, windowMs as number | undefined));

    R('session.recordings.slice', { description: 'Recording chunks overlapping an explicit window.', inputSchema: { sessionId: z.string(), since: z.number(), until: z.number() } },
        ({ sessionId, since, until }) => caps.recordingsSlice(principal, sessionId as string, since as number, until as number));

    R('session.replay.create', {
        description: 'Bundle recording chunks in a window into a replay export; returns a viewer URL.',
        inputSchema: { sessionId: z.string(), tabId: z.string().optional(), ts: z.number().optional(), windowMs: z.number().int().positive().default(15000).optional(), since: z.number().optional(), until: z.number().optional(), label: z.string().optional() },
    }, ({ sessionId, tabId, ts, windowMs, since, until, label }) => caps.replayCreate(principal, { sessionId: sessionId as string, tabId: tabId as string | undefined, ts: ts as number | undefined, windowMs: windowMs as number | undefined, since: since as number | undefined, until: until as number | undefined, label: label as string | undefined }));

    R('project.memory.set', { description: 'Write/update a persistent project memory entry.', inputSchema: { projectId: z.string(), key: z.string().min(1), value: z.string() } },
        ({ projectId, key, value }) => caps.memorySet(principal, projectId as string, key as string, value as string));

    R('project.memory.get', { description: 'Read a project memory entry by key.', inputSchema: { projectId: z.string(), key: z.string() } },
        ({ projectId, key }) => caps.memoryGet(principal, projectId as string, key as string));

    R('project.memory.list', { description: 'List all memory entries for a project.', inputSchema: { projectId: z.string() } },
        ({ projectId }) => caps.memoryList(principal, projectId as string));

    R('project.memory.delete', { description: 'Delete a project memory entry by key.', inputSchema: { projectId: z.string(), key: z.string() } },
        ({ projectId, key }) => caps.memoryDelete(principal, projectId as string, key as string));

    R('session.purge', {
        description: 'Delete old sessions/recordings to free disk space.',
        inputSchema: { maxAgeDays: z.number().int().positive().default(7).optional(), maxSessionsPerProject: z.number().int().positive().default(20).optional(), recordingRetentionMs: z.number().int().positive().optional(), recordingRetentionDays: z.number().int().positive().optional(), maxRecordingChunksPerTab: z.number().int().positive().optional(), maxRecordingBytesPerTab: z.number().int().positive().optional(), preserveMarkedChunks: z.boolean().optional(), maxTimelineBytesPerSession: z.number().int().positive().optional(), maxTimelineChunksPerSession: z.number().int().positive().optional(), timelineRetentionMs: z.number().int().positive().optional() },
    }, ({ maxAgeDays, maxSessionsPerProject, recordingRetentionMs, recordingRetentionDays, maxRecordingChunksPerTab, maxRecordingBytesPerTab, preserveMarkedChunks, maxTimelineBytesPerSession, maxTimelineChunksPerSession, timelineRetentionMs }) => caps.sessionPurge(principal, { maxAgeDays: maxAgeDays as number | undefined, maxSessionsPerProject: maxSessionsPerProject as number | undefined, recordingRetentionMs: recordingRetentionMs as number | undefined, recordingRetentionDays: recordingRetentionDays as number | undefined, maxRecordingChunksPerTab: maxRecordingChunksPerTab as number | undefined, maxRecordingBytesPerTab: maxRecordingBytesPerTab as number | undefined, preserveMarkedChunks: preserveMarkedChunks as boolean | undefined, maxTimelineBytesPerSession: maxTimelineBytesPerSession as number | undefined, maxTimelineChunksPerSession: maxTimelineChunksPerSession as number | undefined, timelineRetentionMs: timelineRetentionMs as number | undefined }));
}

function registerDashboardTool(gated: Gate, options: McpServerOptions): void {
    if (!options.consoleUrl) return;
    gated('read', COMMAND.DASHBOARD_OPEN, {
        description: 'Return the console URL for this gateway and optionally launch the browser to it.',
        inputSchema: { launchBrowser: z.boolean().optional(), sessionId: z.string().optional() },
    }, async ({ launchBrowser, sessionId }: { launchBrowser?: boolean; sessionId?: string }) => {
        const url = options.consoleUrl!(sessionId);
        if (!url) return err('console URL unavailable');
        let opened = false;
        let reason: string | undefined;
        if (launchBrowser && options.openBrowser) {
            const r = options.openBrowser(url);
            opened = r.opened;
            reason = r.reason;
        }
        return ok({ url, opened, ...(reason ? { reason } : {}) });
    });
}
