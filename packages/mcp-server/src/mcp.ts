/**
 * MCP stdio server — what Claude Code / Cursor connect to.
 *
 * Tools are registered with the underlying `@modelcontextprotocol/sdk`
 * server. Each tool resolves args via Zod, then forwards a CommandFrame
 * to the active runtime-client via the bridge.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    COMMAND,
    PROTOCOL_VERSION,
    clickArgsSchema,
    evaluateArgsSchema,
    navigateArgsSchema,
    reloadArgsSchema,
    screenshotArgsSchema,
    scrollArgsSchema,
    setHtmlArgsSchema,
    setStyleArgsSchema,
    selectorSchema,
    typeArgsSchema,
    waitForArgsSchema,
} from '@morphixai/harnessa-fe.protocol';
import type { IBridge } from './bridge.js';
import type { Bridge } from './bridge.js';
import { RemoteBridge } from './remoteBridge.js';
import type { IStore, IMemoryStore } from './store/index.js';

const SERVER_NAME = 'harnessa-fe';
const tabIdParam = z
    .string()
    .optional()
    .describe('Optional tab id (from tab.list). Default = most-recent active tab.');

export async function startMcpStdioServer(bridge: IBridge): Promise<McpServer> {
    const server = new McpServer({
        name: SERVER_NAME,
        version: PROTOCOL_VERSION,
    });

    registerTools(server, bridge);

    // Register store tools for both leader (direct store access) and follower
    // (proxied via RemoteBridge → mcp.call channel to the leader).
    const leaderStore = (bridge as Bridge).store;
    if (leaderStore != null) {
        // Leader: direct in-process access
        const memoryStore = bridge.getMemoryStore();
        registerStoreTools(server, leaderStore, memoryStore);
    } else if (bridge instanceof RemoteBridge) {
        // Follower: proxy store/memory operations to the leader
        registerRemoteStoreTools(server, bridge);
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
}

function ok<T>(value: T): { content: Array<{ type: 'text'; text: string }> } {
    return {
        content: [
            {
                type: 'text',
                text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
            },
        ],
    };
}

function registerTools(server: McpServer, bridge: IBridge): void {
    server.registerTool(
        COMMAND.PAGE_CLICK,
        {
            description: 'Click on a DOM element resolved by the selector.',
            inputSchema: {
                selector: selectorSchema,
                button: z.enum(['left', 'middle', 'right']).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ selector, button, tabId }) => {
            const args = clickArgsSchema.parse({ selector, button });
            const out = await bridge.sendCommand(COMMAND.PAGE_CLICK, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_TYPE,
        {
            description: 'Type a value into an input/textarea resolved by the selector.',
            inputSchema: {
                selector: selectorSchema,
                value: z.string(),
                clear: z.boolean().optional(),
                tabId: tabIdParam,
            },
        },
        async ({ selector, value, clear, tabId }) => {
            const args = typeArgsSchema.parse({ selector, value, clear });
            const out = await bridge.sendCommand(COMMAND.PAGE_TYPE, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_EVALUATE,
        {
            description:
                'Evaluate a JS expression in page context. The expression must return a JSON-serializable value.',
            inputSchema: {
                expr: z.string(),
                tabId: tabIdParam,
            },
        },
        async ({ expr, tabId }) => {
            const args = evaluateArgsSchema.parse({ expr });
            const out = await bridge.sendCommand(COMMAND.PAGE_EVALUATE, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_WAIT_FOR,
        {
            description:
                'Wait until a predicate becomes truthy. Built-ins: "network.idle", "dom.ready". Otherwise treated as a JS expression.',
            inputSchema: {
                predicate: z.string(),
                timeoutMs: z.number().int().positive().optional(),
                tabId: tabIdParam,
            },
        },
        async ({ predicate, timeoutMs, tabId }) => {
            const args = waitForArgsSchema.parse({ predicate, timeoutMs });
            const out = await bridge.sendCommand(COMMAND.PAGE_WAIT_FOR, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_SCREENSHOT,
        {
            description:
                'Take a screenshot. Without `selector`, the full viewport is captured.',
            inputSchema: {
                selector: selectorSchema.optional(),
                format: z.enum(['png', 'webp', 'jpeg']).optional(),
                maxWidth: z.number().int().positive().optional(),
                tabId: tabIdParam,
            },
        },
        async ({ selector, format, maxWidth, tabId }) => {
            const args = screenshotArgsSchema.parse({ selector, format, maxWidth });
            const out = await bridge.sendCommand(COMMAND.PAGE_SCREENSHOT, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_DOM_QUERY,
        {
            description:
                'Return outerHTML of the matched element(s). Text-first inspection tool.',
            inputSchema: {
                selector: selectorSchema,
                limit: z.number().int().positive().optional(),
                tabId: tabIdParam,
            },
        },
        async ({ selector, limit, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.PAGE_DOM_QUERY,
                { selector, limit },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_SCROLL,
        {
            description:
                'Scroll the page or a specific element. Omit selector to scroll the whole page.',
            inputSchema: {
                selector: selectorSchema.optional(),
                x: z.number().optional().describe('Pixels to scroll on the x-axis. Default 0.'),
                y: z.number().optional().describe('Pixels to scroll on the y-axis. Default 0.'),
                behavior: z.enum(['smooth', 'instant']).optional().describe('Default smooth.'),
                tabId: tabIdParam,
            },
        },
        async ({ selector, x, y, behavior, tabId }) => {
            const args = scrollArgsSchema.parse({ selector, x, y, behavior });
            const out = await bridge.sendCommand(COMMAND.PAGE_SCROLL, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_NAVIGATE,
        {
            description:
                "Navigate to a URL or path. Use method='href' for a full page load (default), 'push' or 'replace' for SPA soft navigation without a full reload.",
            inputSchema: {
                url: z.string().describe("Target URL or path, e.g. '/dashboard' or 'https://example.com'."),
                method: z
                    .enum(['href', 'push', 'replace'])
                    .optional()
                    .describe("'href' = full load (default). 'push'/'replace' = history API + popstate, no reload."),
                tabId: tabIdParam,
            },
        },
        async ({ url, method, tabId }) => {
            const args = navigateArgsSchema.parse({ url, method });
            const out = await bridge.sendCommand(COMMAND.PAGE_NAVIGATE, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_RELOAD,
        {
            description: 'Reload the current page. Use hard=true to bypass the browser cache.',
            inputSchema: {
                hard: z.boolean().optional().describe('Bypass browser cache. Default false.'),
                tabId: tabIdParam,
            },
        },
        async ({ hard, tabId }) => {
            const args = reloadArgsSchema.parse({ hard });
            const out = await bridge.sendCommand(COMMAND.PAGE_RELOAD, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_SET_HTML,
        {
            description:
                'Replace the innerHTML or outerHTML of a DOM element. Use this to patch structure or content in the live page for visual debugging — changes are in-memory only and reset on reload.',
            inputSchema: {
                selector: selectorSchema,
                html: z.string().describe('HTML string to inject.'),
                target: z.enum(['innerHTML', 'outerHTML']).optional().describe(
                    '"innerHTML" (default) replaces inner content; "outerHTML" replaces the element itself.',
                ),
                tabId: tabIdParam,
            },
        },
        async ({ selector, html, target, tabId }) => {
            const args = setHtmlArgsSchema.parse({ selector, html, target });
            const out = await bridge.sendCommand(COMMAND.PAGE_SET_HTML, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PAGE_SET_STYLE,
        {
            description:
                'Apply CSS styles to a DOM element (inline style) or inject a global <style> rule into the page. ' +
                'Use for live visual debugging — changes are in-memory only and reset on reload.',
            inputSchema: {
                selector: selectorSchema.optional().describe(
                    'Target element for inline styles. Omit to inject a global CSS rule.',
                ),
                styles: z.record(z.string(), z.string()).describe(
                    'For element mode: CSS property→value map, e.g. { "background": "red", "fontSize": "14px" }. ' +
                    'For global mode (no selector): { "rule": ".btn { color: red; }" }.',
                ),
                merge: z.boolean().optional().describe(
                    'Merge with existing inline styles (default true). Set false to replace all inline styles.',
                ),
                tabId: tabIdParam,
            },
        },
        async ({ selector, styles, merge, tabId }) => {
            const args = setStyleArgsSchema.parse({ selector, styles, merge });
            const out = await bridge.sendCommand(COMMAND.PAGE_SET_STYLE, args, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.CONSOLE_TAIL,
        {
            description: 'Return the last N console entries from the page.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ n, tabId }) => {
            const out = await bridge.sendCommand(COMMAND.CONSOLE_TAIL, { n: n ?? 20 }, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.NETWORK_TAIL,
        {
            description: 'Return the last N network requests captured by the runtime client.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                includeBody: z.boolean().optional(),
                tabId: tabIdParam,
            },
        },
        async ({ n, includeBody, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.NETWORK_TAIL,
                { n: n ?? 20, includeBody: includeBody ?? false },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.ERRORS_TAIL,
        {
            description: 'Return the last N JavaScript errors captured by the runtime client.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ n, tabId }) => {
            const out = await bridge.sendCommand(COMMAND.ERRORS_TAIL, { n: n ?? 20 }, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.TAB_LIST,
        {
            description: 'List all currently connected browser tabs.',
            inputSchema: {},
        },
        async () => {
            const tabs = await bridge.listTabs();
            return ok(tabs);
        },
    );

    // ─── project.* tools (target vite-plugin) ─────────────────────────────

    server.registerTool(
        COMMAND.PROJECT_SOURCE,
        {
            description:
                "Read source code for a file or for a component. Specify exactly one of `file` (project-relative path) or `component` (PascalCase name discovered by the AST scan).",
            inputSchema: {
                file: z.string().optional(),
                component: z.string().optional(),
                projectId: z.string().optional(),
            },
        },
        async ({ file, component, projectId }) => {
            const out = await bridge.sendCommand(
                COMMAND.PROJECT_SOURCE,
                { file, component },
                { target: 'vite-plugin', projectId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PROJECT_WHERE_IS,
        {
            description: 'Return file:line:col for a given component name.',
            inputSchema: {
                component: z.string(),
                projectId: z.string().optional(),
            },
        },
        async ({ component, projectId }) => {
            const out = await bridge.sendCommand(
                COMMAND.PROJECT_WHERE_IS,
                { component },
                { target: 'vite-plugin', projectId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.PROJECT_MODULE_GRAPH,
        {
            description: 'Return the component map discovered by the AST scan.',
            inputSchema: {
                projectId: z.string().optional(),
            },
        },
        async ({ projectId }) => {
            const out = await bridge.sendCommand(
                COMMAND.PROJECT_MODULE_GRAPH,
                {},
                { target: 'vite-plugin', projectId },
            );
            return ok(out);
        },
    );

    // ─── tasks.* tools (user annotations submitted from page) ─────────────

    const taskStatusEnum = z.enum(['pending', 'claimed', 'resolved', 'all']);

    server.registerTool(
        COMMAND.TASKS_PENDING,
        {
            description:
                'List user-submitted annotation tasks. Default `status="pending"`. Returns id/question/selector/url — call tasks.claim to fetch full element payload.',
            inputSchema: {
                status: taskStatusEnum.optional(),
                limit: z.number().int().positive().optional(),
            },
        },
        async ({ status, limit }) => {
            const tasks = await bridge.listTasks({ status: status ?? 'pending', limit });
            const summary = tasks.map((t) => ({
                id: t.id,
                status: t.status,
                question: t.question,
                selector: t.selector,
                url: t.url,
                tabId: t.tabId,
                createdAt: t.createdAt,
                claimedAt: t.claimedAt,
                resolvedAt: t.resolvedAt,
                note: t.note,
            }));
            return ok({ count: summary.length, tasks: summary });
        },
    );

    server.registerTool(
        COMMAND.TASKS_CLAIM,
        {
            description:
                'Claim a task by id. Marks it claimed, returns full payload (selector + element outerHTML + rect).',
            inputSchema: {
                taskId: z.string(),
            },
        },
        async ({ taskId }) => {
            const task = await bridge.claimTask(taskId);
            if (!task) {
                throw new Error(`tasks.claim: no task with id "${taskId}"`);
            }
            return ok(task);
        },
    );

    server.registerTool(
        COMMAND.TASKS_RESOLVE,
        {
            description:
                'Mark a task as resolved with an optional note. Use after addressing the user request.',
            inputSchema: {
                taskId: z.string(),
                note: z.string().optional(),
            },
        },
        async ({ taskId, note }) => {
            const task = await bridge.resolveTask(taskId, note);
            if (!task) {
                throw new Error(`tasks.resolve: no task with id "${taskId}"`);
            }
            return ok({ ok: true, task });
        },
    );
}

// ─── Store tools (session history, timeline, memory) ──────────────────────────

function registerStoreTools(server: McpServer, store: IStore, memoryStore: IMemoryStore): void {
    server.registerTool(
        'session.list',
        {
            description: 'List recent sessions for a project. Returns session IDs, start times, and status.',
            inputSchema: {
                projectId: z.string().describe('Project ID (package.json name)'),
                limit: z.number().int().positive().default(10).optional(),
            },
        },
        async ({ projectId, limit }) => {
            const sessions = store.listSessions(projectId, limit ?? 10);
            return ok(sessions);
        },
    );

    server.registerTool(
        'session.summary',
        {
            description: 'Get a summary of a session: event counts, last error, active tabs.',
            inputSchema: {
                sessionId: z.string().describe('Session ID from session.list'),
            },
        },
        async ({ sessionId }) => {
            const summary = store.summary(sessionId);
            return ok(summary);
        },
    );

    server.registerTool(
        'session.tail',
        {
            description: 'Read the last N events from a session timeline. Optionally filter by event type.',
            inputSchema: {
                sessionId: z.string(),
                n: z.number().int().positive().default(50).optional(),
                type: z.union([z.string(), z.array(z.string())]).optional()
                    .describe('Filter by event type(s): log, err, req, res, cmd, resp, hmr, task, node:log, node:err'),
                tabId: z.string().optional().describe('If provided, reads from the tab timeline instead of session timeline'),
                since: z.number().optional().describe('Only events after this Unix timestamp (ms)'),
                until: z.number().optional().describe('Only events before this Unix timestamp (ms)'),
            },
        },
        async ({ sessionId, n, type, tabId, since, until }) => {
            try {
                const session = store.getSession(sessionId);
                if (!session) {
                    return ok({ error: 'session not found', sessionId });
                }
                const events = store.tail(
                    sessionId,
                    { n: n ?? 50, type: type as string | string[] | undefined, since, until },
                    tabId,
                );
                return ok(events);
            } catch {
                return ok({ error: 'session not found', sessionId });
            }
        },
    );

    server.registerTool(
        'session.search',
        {
            description: 'Search events in a session timeline by substring match.',
            inputSchema: {
                sessionId: z.string(),
                query: z.string().describe('Substring to search for in event payloads'),
                type: z.union([z.string(), z.array(z.string())]).optional(),
                limit: z.number().int().positive().default(50).optional(),
                tabId: z.string().optional(),
            },
        },
        async ({ sessionId, query, type, limit, tabId }) => {
            try {
                const session = store.getSession(sessionId);
                if (!session) {
                    return ok({ error: 'session not found', sessionId });
                }
                const events = store.search(
                    sessionId,
                    query,
                    { type: type as string | string[] | undefined, limit: limit ?? 50 },
                    tabId,
                );
                return ok(events);
            } catch {
                return ok({ error: 'session not found', sessionId });
            }
        },
    );

    server.registerTool(
        'project.sessions',
        {
            description: 'List all projects with their most recent session info.',
            inputSchema: {},
        },
        async () => {
            const projects = store.listProjects();
            const result = projects.map((p) => ({
                ...p,
                recentSessions: store.listSessions(p.id, 3),
            }));
            return ok(result);
        },
    );

    server.registerTool(
        'project.memory.set',
        {
            description: 'Write or update a persistent memory entry for a project (cross-session knowledge for the agent).',
            inputSchema: {
                projectId: z.string(),
                key: z.string().min(1).describe('Memory key, e.g. "known_issues", "architecture", "agent_context"'),
                value: z.string().describe('Memory value (plain text or JSON string)'),
            },
        },
        async ({ projectId, key, value }) => {
            const entry = memoryStore.set(projectId, key, value);
            return ok({ ok: true, key: entry.key, updatedAt: entry.updatedAt });
        },
    );

    server.registerTool(
        'project.memory.get',
        {
            description: 'Read a persistent memory entry for a project by key.',
            inputSchema: {
                projectId: z.string(),
                key: z.string().describe('Memory key to retrieve'),
            },
        },
        async ({ projectId, key }) => {
            const entry = memoryStore.get(projectId, key);
            if (!entry) {
                return ok({ found: false, key });
            }
            return ok({ found: true, key: entry.key, value: entry.value, updatedAt: entry.updatedAt });
        },
    );

    server.registerTool(
        'project.memory.list',
        {
            description: 'List all persistent memory entries for a project, sorted by most recently updated.',
            inputSchema: {
                projectId: z.string(),
            },
        },
        async ({ projectId }) => {
            const entries = memoryStore.list(projectId);
            return ok(entries);
        },
    );

    server.registerTool(
        'project.memory.delete',
        {
            description: 'Delete a persistent memory entry for a project by key.',
            inputSchema: {
                projectId: z.string(),
                key: z.string().describe('Memory key to delete'),
            },
        },
        async ({ projectId, key }) => {
            const deleted = memoryStore.delete(projectId, key);
            return ok({ deleted, key });
        },
    );

    server.registerTool(
        'session.purge',
        {
            description: 'Delete old sessions and recordings to free disk space.',
            inputSchema: {
                maxAgeDays: z.number().int().positive().default(7).optional(),
                maxSessionsPerProject: z.number().int().positive().default(20).optional(),
                recordingRetentionDays: z.number().int().positive().default(3).optional(),
            },
        },
        async ({ maxAgeDays, maxSessionsPerProject, recordingRetentionDays }) => {
            const result = store.purge({ maxAgeDays, maxSessionsPerProject, recordingRetentionDays });
            return ok({
                sessionsDeleted: result.sessionsDeleted,
                recordingsDeleted: result.recordingsDeleted,
                bytesFreed: result.bytesFreed,
            });
        },
    );
}

// ─── Remote store tools (follower mode) ───────────────────────────────────────
//
// When running as a follower, store/memory operations are proxied to the leader
// via the mcp.call channel. The async variants on RemoteStore / RemoteMemoryStore
// are used directly inside the tool handlers.

function registerRemoteStoreTools(server: McpServer, bridge: RemoteBridge): void {
    const remoteStore = bridge.getStore() as ReturnType<RemoteBridge['getStore']> & {
        listProjectsAsync(): Promise<unknown>;
        listSessionsAsync(projectId: string, limit?: number): Promise<unknown>;
        summaryAsync(sessionId: string): Promise<unknown>;
        tailAsync(sessionId: string, opts?: unknown, tabId?: string): Promise<unknown>;
        searchAsync(sessionId: string, query: string, opts?: unknown, tabId?: string): Promise<unknown>;
        purgeAsync(policy?: unknown): Promise<unknown>;
    };
    const remoteMem = bridge.getMemoryStore() as ReturnType<RemoteBridge['getMemoryStore']> & {
        setAsync(projectId: string, key: string, value: string): Promise<unknown>;
        getAsync(projectId: string, key: string): Promise<unknown>;
        listAsync(projectId: string): Promise<unknown>;
        deleteAsync(projectId: string, key: string): Promise<unknown>;
    };

    server.registerTool(
        'session.list',
        {
            description: 'List recent sessions for a project. Returns session IDs, start times, and status.',
            inputSchema: {
                projectId: z.string().describe('Project ID (package.json name)'),
                limit: z.number().int().positive().default(10).optional(),
            },
        },
        async ({ projectId, limit }) => {
            const sessions = await remoteStore.listSessionsAsync(projectId, limit ?? 10);
            return ok(sessions);
        },
    );

    server.registerTool(
        'session.summary',
        {
            description: 'Get a summary of a session: event counts, last error, active tabs.',
            inputSchema: {
                sessionId: z.string().describe('Session ID from session.list'),
            },
        },
        async ({ sessionId }) => {
            const summary = await remoteStore.summaryAsync(sessionId);
            return ok(summary);
        },
    );

    server.registerTool(
        'session.tail',
        {
            description: 'Read the last N events from a session timeline. Optionally filter by event type.',
            inputSchema: {
                sessionId: z.string(),
                n: z.number().int().positive().default(50).optional(),
                type: z.union([z.string(), z.array(z.string())]).optional()
                    .describe('Filter by event type(s): log, err, req, res, cmd, resp, hmr, task, node:log, node:err'),
                tabId: z.string().optional().describe('If provided, reads from the tab timeline instead of session timeline'),
                since: z.number().optional().describe('Only events after this Unix timestamp (ms)'),
                until: z.number().optional().describe('Only events before this Unix timestamp (ms)'),
            },
        },
        async ({ sessionId, n, type, tabId, since, until }) => {
            const events = await remoteStore.tailAsync(
                sessionId,
                { n: n ?? 50, type: type as string | string[] | undefined, since, until },
                tabId,
            );
            return ok(events);
        },
    );

    server.registerTool(
        'session.search',
        {
            description: 'Search events in a session timeline by substring match.',
            inputSchema: {
                sessionId: z.string(),
                query: z.string().describe('Substring to search for in event payloads'),
                type: z.union([z.string(), z.array(z.string())]).optional(),
                limit: z.number().int().positive().default(50).optional(),
                tabId: z.string().optional(),
            },
        },
        async ({ sessionId, query, type, limit, tabId }) => {
            const events = await remoteStore.searchAsync(
                sessionId,
                query,
                { type: type as string | string[] | undefined, limit: limit ?? 50 },
                tabId,
            );
            return ok(events);
        },
    );

    server.registerTool(
        'project.sessions',
        {
            description: 'List all projects with their most recent session info.',
            inputSchema: {},
        },
        async () => {
            const projects = await remoteStore.listProjectsAsync() as Array<{ id: string }>;
            const result = await Promise.all(
                projects.map(async (p) => ({
                    ...p,
                    recentSessions: await remoteStore.listSessionsAsync(p.id, 3),
                })),
            );
            return ok(result);
        },
    );

    server.registerTool(
        'project.memory.set',
        {
            description: 'Write or update a persistent memory entry for a project (cross-session knowledge for the agent).',
            inputSchema: {
                projectId: z.string(),
                key: z.string().min(1).describe('Memory key, e.g. "known_issues", "architecture", "agent_context"'),
                value: z.string().describe('Memory value (plain text or JSON string)'),
            },
        },
        async ({ projectId, key, value }) => {
            const entry = await remoteMem.setAsync(projectId, key, value);
            return ok(entry);
        },
    );

    server.registerTool(
        'project.memory.get',
        {
            description: 'Read a persistent memory entry for a project by key.',
            inputSchema: {
                projectId: z.string(),
                key: z.string().describe('Memory key to retrieve'),
            },
        },
        async ({ projectId, key }) => {
            const entry = await remoteMem.getAsync(projectId, key);
            if (!entry) {
                return ok({ found: false, key });
            }
            return ok({ found: true, ...(entry as object) });
        },
    );

    server.registerTool(
        'project.memory.list',
        {
            description: 'List all persistent memory entries for a project, sorted by most recently updated.',
            inputSchema: {
                projectId: z.string(),
            },
        },
        async ({ projectId }) => {
            const entries = await remoteMem.listAsync(projectId);
            return ok(entries);
        },
    );

    server.registerTool(
        'project.memory.delete',
        {
            description: 'Delete a persistent memory entry for a project by key.',
            inputSchema: {
                projectId: z.string(),
                key: z.string().describe('Memory key to delete'),
            },
        },
        async ({ projectId, key }) => {
            const deleted = await remoteMem.deleteAsync(projectId, key);
            return ok({ deleted, key });
        },
    );

    server.registerTool(
        'session.purge',
        {
            description: 'Delete old sessions and recordings to free disk space.',
            inputSchema: {
                maxAgeDays: z.number().int().positive().default(7).optional(),
                maxSessionsPerProject: z.number().int().positive().default(20).optional(),
                recordingRetentionDays: z.number().int().positive().default(3).optional(),
            },
        },
        async ({ maxAgeDays, maxSessionsPerProject, recordingRetentionDays }) => {
            const result = await remoteStore.purgeAsync({ maxAgeDays, maxSessionsPerProject, recordingRetentionDays });
            return ok(result);
        },
    );
}
