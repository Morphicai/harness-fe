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
    screenshotArgsSchema,
    selectorSchema,
    typeArgsSchema,
    waitForArgsSchema,
} from '@morphixai/harnessa-fe.protocol';
import type { IBridge } from './bridge.js';

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
