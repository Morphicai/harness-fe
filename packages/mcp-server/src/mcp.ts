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
} from '@harness-fe/protocol';
import type { IBridge } from './bridge.js';
import type { Bridge } from './bridge.js';
import type { AuthOptions } from './auth.js';
import { identifyPrincipal } from './identity.js';
import { RemoteBridge } from './remoteBridge.js';
import type { IStore, IMemoryStore } from './store/index.js';
import { buildVisitorTimeline } from './visitorTimeline.js';
import { createReplayExport } from './replayCreate.js';
import { openBrowser } from './openBrowser.js';
import { buildDashboardUrl } from './dashboardUrl.js';

const SERVER_NAME = 'harness-fe';

export interface McpServerOptions {
    /**
     * Name of the environment variable that gates experimental tools.
     *
     * **Omit it (the default) and experimental tools are fully on** — no env
     * var needed, lowest mental burden. Only supply a name when you *don't*
     * want them unconditionally on: the tools then show up only if that env
     * var is set to a non-empty value at server-construction time.
     */
    experimentalEnvVar?: string;
    /**
     * Daemon auth options, used to identify the per-call principal from MCP
     * request headers (4.0 · P4). Omit for stdio / no-auth — calls resolve to
     * the local principal.
     */
    auth?: AuthOptions;
}

/**
 * Experimental-feature gate.
 *
 * Default (no `envVar`): **fully enabled**. Experimental tools are registered
 * unconditionally, so a plain dev setup gets them with zero config.
 *
 * Gated (an `envVar` name supplied): enabled only when that env var is set on
 * the machine running the daemon. *Presence* enables — any non-empty value
 * (after trimming) counts as "on"; unset or empty means off. There's
 * deliberately no required magic value, so `=1`, `=true`, `=yes` all work.
 */
export function experimentalEnabled(envVar?: string): boolean {
    // No gate configured → fully on.
    if (envVar == null || envVar.trim() === '') return true;
    // Gated → on only when the named env var carries a non-empty value.
    const raw = process.env[envVar];
    return typeof raw === 'string' && raw.trim() !== '';
}

const tabIdParam = z
    .string()
    .optional()
    .describe('Optional tab id (from tab.list). Default = most-recent active tab.');

/**
 * Build an McpServer with every harness-fe tool registered for the given
 * bridge. Transport (stdio / HTTP) is attached separately.
 */
export function createMcpServer(bridge: IBridge, options: McpServerOptions = {}): McpServer {
    const server = new McpServer({
        name: SERVER_NAME,
        version: PROTOCOL_VERSION,
    });

    registerTools(server, bridge, options.auth);

    // Experimental tools are on by default. They only get gated when the host
    // supplies an env-var name to key off; see experimentalEnabled().
    if (experimentalEnabled(options.experimentalEnvVar)) {
        registerExperimentalTools(server, bridge);
    }

    // Register store tools for both leader (direct store access) and follower
    // (proxied via RemoteBridge → mcp.call channel to the leader).
    const leaderStore = (bridge as Bridge).store;
    if (leaderStore != null) {
        const memoryStore = bridge.getMemoryStore();
        registerStoreTools(server, leaderStore, memoryStore, bridge);
    } else if (bridge instanceof RemoteBridge) {
        registerRemoteStoreTools(server, bridge);
    }

    return server;
}

export async function startMcpStdioServer(
    bridge: IBridge,
    options: McpServerOptions = {},
): Promise<McpServer> {
    const server = createMcpServer(bridge, options);
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

function err(message: string): {
    content: Array<{ type: 'text'; text: string }>;
    isError: true;
} {
    return {
        content: [{ type: 'text', text: message }],
        isError: true,
    };
}


function registerTools(server: McpServer, bridge: IBridge, auth?: AuthOptions): void {
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

    const filterParam = z.string().optional().describe('Substring or regex (see `match`). Filters entries by their serialized payload before return.');
    const matchParam = z.enum(['contains', 'regex']).optional().describe('How to interpret `filter`. Default: contains (case-insensitive). regex is case-insensitive too.');

    server.registerTool(
        COMMAND.CONSOLE_TAIL,
        {
            description: 'Return the last N console entries from the page. Pass `filter` for substring/regex match against {level, args}; `level` for an exact match. Buffer is in-memory and cleared on navigate — use `session.tail` (type=["log"]) for cross-navigate history.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                filter: filterParam,
                match: matchParam,
                level: z.enum(['log', 'info', 'warn', 'error', 'debug']).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ n, filter, match, level, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.CONSOLE_TAIL,
                { n: n ?? 20, filter, match, level },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.NETWORK_TAIL,
        {
            description: 'Return the last N network requests captured by the runtime client. Each entry has phase=req|res keyed by `id`, and (for requests) an `initiator.stack` so you can see which code issued the call. Pass `filter` (against {url, method, body}), or narrow via `urlContains` / `method` / `statusCode`. Buffer is in-memory and cleared on navigate — use `session.tail` (type=["req","res"]) for cross-navigate history.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                includeBody: z.boolean().optional(),
                filter: filterParam,
                match: matchParam,
                urlContains: z.string().optional().describe('Substring filter on url (case-sensitive).'),
                method: z.string().optional().describe('Exact HTTP method match (e.g. "POST"). Case-insensitive.'),
                statusCode: z.number().int().optional().describe('Exact status code match (response entries only).'),
                tabId: tabIdParam,
            },
        },
        async ({ n, includeBody, filter, match, urlContains, method, statusCode, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.NETWORK_TAIL,
                { n: n ?? 20, includeBody: includeBody ?? false, filter, match, urlContains, method, statusCode },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.ERRORS_TAIL,
        {
            description: 'Return the last N JavaScript errors captured by the runtime client. Pass `filter` for substring/regex match against {message, stack, source}. Buffer is in-memory and cleared on navigate — use `session.tail` (type=["err"]) for cross-navigate history.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                filter: filterParam,
                match: matchParam,
                tabId: tabIdParam,
            },
        },
        async ({ n, filter, match, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.ERRORS_TAIL,
                { n: n ?? 20, filter, match },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.WS_TAIL,
        {
            description:
                'Return the last N WebSocket frames captured by the runtime client. Each entry has phase=open|send|recv|close, a stable id per connection, payload (text/JSON when possible, [binary Nb] for buffers), and initiator.stack on open/send so you can see which code opened the connection or sent the frame. Pass `filter` for substring/regex match against {url, payload, reason}; `phase` for an exact match. Buffer is in-memory and cleared on navigate — use `session.tail` (type=["ws"]) for cross-navigate history.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                filter: filterParam,
                match: matchParam,
                phase: z.enum(['open', 'send', 'recv', 'close']).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ n, filter, match, phase, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.WS_TAIL,
                { n: n ?? 20, filter, match, phase },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.NETWORK_WAIT_FOR,
        {
            description:
                'Resolve when a network request matching the predicate happens (or rejects on timeout). Considers requests issued AFTER this call — pre-existing matches in the buffer do not satisfy the wait.',
            inputSchema: {
                urlContains: z.string().optional(),
                urlRegex: z.string().optional().describe('Case-insensitive regex against url.'),
                method: z.string().optional(),
                statusCode: z.number().int().optional(),
                timeoutMs: z.number().int().positive().default(10000).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ urlContains, urlRegex, method, statusCode, timeoutMs, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.NETWORK_WAIT_FOR,
                { urlContains, urlRegex, method, statusCode, timeoutMs },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.NETWORK_WAIT_FOR_IDLE,
        {
            description:
                'Resolve when no new network entries arrived for `idleMs` (default 500ms) — analogous to Playwright `waitForLoadState("networkidle")`. Useful for sequencing actions after a navigation or interaction.',
            inputSchema: {
                idleMs: z.number().int().positive().default(500).optional(),
                timeoutMs: z.number().int().positive().default(10000).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ idleMs, timeoutMs, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.NETWORK_WAIT_FOR_IDLE,
                { idleMs, timeoutMs },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.NETWORK_GET,
        {
            description:
                'Return all entries (req + res) for a single network request id. Use after `network.tail` when you need the full request/response body without the truncation pressure that comes from a multi-entry response.',
            inputSchema: {
                reqId: z.string().describe('id field from a `network.tail` entry'),
                tabId: tabIdParam,
            },
        },
        async ({ reqId, tabId }) => {
            const out = await bridge.sendCommand(COMMAND.NETWORK_GET, { reqId }, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.WS_GET,
        {
            description:
                'Return all frames (open / send / recv / close) for a single WebSocket id. Use after `ws.tail` when you need the full session of a particular connection.',
            inputSchema: {
                wsId: z.string().describe('id field from a `ws.tail` entry'),
                tabId: tabIdParam,
            },
        },
        async ({ wsId, tabId }) => {
            const out = await bridge.sendCommand(COMMAND.WS_GET, { wsId }, { tabId });
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.STORAGE_TAIL,
        {
            description:
                'Return the last N localStorage / sessionStorage / cookie mutations. Each entry has op=set|remove|clear, which=local|session|cookie, key/value, an `initiator.stack` showing who issued the write, and crossTab=true when the mutation arrived via the native storage event from another tab. Filter via `filter` (against {op, which, key, value}), or narrow with `which` / `op` / `key`. Buffer is in-memory and cleared on navigate — use `session.tail` (type=["storage"]) for cross-navigate history.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                filter: filterParam,
                match: matchParam,
                which: z.enum(['local', 'session', 'cookie']).optional(),
                op: z.enum(['set', 'remove', 'clear']).optional(),
                key: z.string().optional().describe('Exact key match (case-sensitive).'),
                tabId: tabIdParam,
            },
        },
        async ({ n, filter, match, which, op, key, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.STORAGE_TAIL,
                { n: n ?? 20, filter, match, which, op, key },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.NAVIGATION_TAIL,
        {
            description:
                'Return the last N navigation events captured by the runtime: history.pushState / replaceState, popstate, hashchange, and location.href / location.hash / location.assign() / location.replace(). Each entry has `kind`, `url`, `replace`, and an `initiator.stack` for interceptable kinds. Filter via `filter` (against {kind, url, replace}) or narrow with `kind`. Buffer is in-memory and cleared on navigate — use `session.tail` (type=["navigation"]) for cross-navigate history.',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                filter: filterParam,
                match: matchParam,
                kind: z.enum(['push', 'replace', 'pop', 'hash', 'assign']).optional(),
                tabId: tabIdParam,
            },
        },
        async ({ n, filter, match, kind, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.NAVIGATION_TAIL,
                { n: n ?? 20, filter, match, kind },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.GLOBALS_TAIL,
        {
            description:
                'Return the last N read/writes to watched window globals. Only fires for keys registered via the install opts `globals.watch` list — global pollution detection or app-state debugging. Each entry has op=get|set|delete, key, value, previousValue (on set), and initiator.stack. Filter via `filter` or narrow with `op` / `key`. Buffer is in-memory; cross-navigate use `session.tail` (type=["globals"]).',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                filter: filterParam,
                match: matchParam,
                op: z.enum(['get', 'set', 'delete']).optional(),
                key: z.string().optional().describe('Exact window key match.'),
                tabId: tabIdParam,
            },
        },
        async ({ n, filter, match, op, key, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.GLOBALS_TAIL,
                { n: n ?? 20, filter, match, op, key },
                { tabId },
            );
            return ok(out);
        },
    );

    server.registerTool(
        COMMAND.INDEXEDDB_TAIL,
        {
            description:
                'Return the last N IndexedDB operations: open / put / add / get / getAll / delete / clear / cursor. Each entry has `op`, `store`, `key`, `value`, `db`, `version`, `success` and `initiator.stack`. Useful for tracking who reads/writes which IDB store key. Filter via `filter` (against {op, store, key}) or narrow with `op` / `store` / `db`. Buffer is in-memory; cross-navigate use `session.tail` (type=["indexeddb"]).',
            inputSchema: {
                n: z.number().int().positive().default(20).optional(),
                filter: filterParam,
                match: matchParam,
                op: z.enum(['open', 'put', 'add', 'get', 'getAll', 'delete', 'clear', 'cursor']).optional(),
                store: z.string().optional().describe('Exact object-store name.'),
                db: z.string().optional().describe('Exact database name (open events only).'),
                tabId: tabIdParam,
            },
        },
        async ({ n, filter, match, op, store, db, tabId }) => {
            const out = await bridge.sendCommand(
                COMMAND.INDEXEDDB_TAIL,
                { n: n ?? 20, filter, match, op, store, db },
                { tabId },
            );
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

    // ─── dashboard.* tools ─────────────────────────────────────────────────

    server.registerTool(
        COMMAND.DASHBOARD_OPEN,
        {
            description:
                'Return the dev-dashboard URL for this Harness-FE daemon and, optionally, launch the user\'s default browser to it. The dashboard shows live sessions, recordings, exports, and is the primary surface a human uses to inspect what an agent is doing. Useful when the agent wants the human to look at something concrete.',
            inputSchema: {
                launchBrowser: z
                    .boolean()
                    .optional()
                    .describe(
                        'When true, try to open the URL in the user\'s default browser (requires the daemon to run on the user\'s host machine — no effect in remote/Docker contexts; set HARNESS_FE_HEADLESS=1 in those environments to suppress the launch attempt).',
                    ),
                sessionId: z
                    .string()
                    .optional()
                    .describe(
                        'When provided, deep-link to a specific session detail page instead of the project list.',
                    ),
            },
        },
        async ({ launchBrowser, sessionId }) => {
            const url = buildDashboardUrl(bridge, { sessionId });
            if (!url) {
                return err('dashboard URL unavailable: bridge has no bound port yet');
            }
            let opened = false;
            let reason: string | undefined;
            if (launchBrowser) {
                const result = openBrowser(url);
                opened = result.opened;
                reason = result.reason;
            }
            return ok({ url, opened, ...(reason ? { reason } : {}) });
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
        async ({ taskId }, extra) => {
            const principal = identifyPrincipal(extra.requestInfo?.headers, auth ?? {});
            const task = await bridge.claimTask(taskId, principal);
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
        async ({ taskId, note }, extra) => {
            const principal = identifyPrincipal(extra.requestInfo?.headers, auth ?? {});
            const task = await bridge.resolveTask(taskId, note, principal);
            if (!task) {
                throw new Error(`tasks.resolve: no task with id "${taskId}"`);
            }
            return ok({ ok: true, task });
        },
    );

    server.registerTool(
        'tasks.get_attachment',
        {
            description:
                'Return a task screenshot attachment as a vision-ready image block. ' +
                'Call after tasks.claim when the task summary includes an attachment pointer. ' +
                'Compatible with Claude vision and GPT-4V.',
            inputSchema: {
                taskId: z.string().describe('Task id (from tasks.pending or tasks.claim).'),
                attachmentId: z.string().describe('Attachment id (from task.attachments[].id).'),
            },
        },
        async ({ taskId, attachmentId }) => {
            const base64 = await bridge.getTaskAttachmentData(taskId, attachmentId);
            if (!base64) {
                throw new Error(`tasks.get_attachment: attachment not found (taskId=${taskId}, attachmentId=${attachmentId})`);
            }
            return {
                content: [
                    {
                        type: 'image' as const,
                        mimeType: 'image/png' as const,
                        data: base64,
                    },
                ],
            };
        },
    );
}

// ─── Experimental tools (gated by HARNESS_FE_EXPERIMENTAL) ────────────────────

/**
 * Tools that are still in the testing phase. They are only registered when
 * `experimentalEnabled()` is true, so default/production setups never see them
 * in the tool list. When a feature graduates, move its `registerTool` call up
 * into `registerTools` and drop it from here.
 */
function registerExperimentalTools(server: McpServer, bridge: IBridge): void {
    // Probe tool: lets a developer confirm experimental mode is active on the
    // daemon they're connected to. Also serves as the canonical example for how
    // to add a gated tool. Safe to keep around — it touches nothing.
    server.registerTool(
        'experimental.ping',
        {
            description:
                'Experimental-mode probe. Present whenever experimental tools are enabled (the default; ' +
                'suppressed only when a gate env var is configured and unset on the daemon host). ' +
                'Returns ok plus the protocol version — use it to confirm experimental tools are reachable.',
            inputSchema: {},
        },
        async () => ok({ ok: true, experimental: true, protocolVersion: PROTOCOL_VERSION }),
    );
    void bridge;
}

// ─── Store tools (session history, timeline, memory) ──────────────────────────

function registerStoreTools(server: McpServer, store: IStore, memoryStore: IMemoryStore, bridge: IBridge): void {
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
            const sessions = store.listSessions({ projectId, limit: limit ?? 10 });
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
            description: 'Read the last N events from a session timeline. Optionally filter by event type or projectId. For cross-tab debugging within one visitor, use `visitor.timeline` to merge multiple sessions.',
            inputSchema: {
                sessionId: z.string(),
                n: z.number().int().positive().default(50).optional(),
                type: z.union([z.string(), z.array(z.string())]).optional()
                    .describe('Filter by event type(s): log, err, req, res, cmd, resp, hmr, task, node:log, node:err'),
                projectId: z.string().optional().describe('Filter events by projectId (useful for multi-project sessions)'),
                since: z.number().optional().describe('Only events after this Unix timestamp (ms)'),
                until: z.number().optional().describe('Only events before this Unix timestamp (ms)'),
            },
        },
        async ({ sessionId, n, type, projectId, since, until }) => {
            try {
                const session = store.getSession(sessionId);
                if (!session) {
                    return ok({ error: 'session not found', sessionId });
                }
                const events = store.tail(sessionId, {
                    n: n ?? 50,
                    type: type as string | string[] | undefined,
                    since,
                    until,
                    projectId,
                });
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
            },
        },
        async ({ sessionId, query, type, limit }) => {
            try {
                const session = store.getSession(sessionId);
                if (!session) {
                    return ok({ error: 'session not found', sessionId });
                }
                const events = store.search(sessionId, query, {
                    type: type as string | string[] | undefined,
                    limit: limit ?? 50,
                });
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
                recentSessions: store.listSessions({ projectId: p.id, limit: 3 }),
            }));
            return ok(result);
        },
    );

    // ── v0.2: Project tree & build metadata (micro-frontend support) ────

    server.registerTool(
        'project.list',
        {
            description:
                'List every project the daemon has ever seen. Returns full ProjectMeta (id, displayName, parentProjectId, tags, lastActiveAt). Use this instead of project.sessions when you only need project metadata, not session history.',
            inputSchema: {},
        },
        async () => ok(store.listProjects()),
    );

    server.registerTool(
        'project.get',
        {
            description:
                'Read a single project\'s metadata (parentProjectId, displayName, tags, …).',
            inputSchema: { projectId: z.string() },
        },
        async ({ projectId }) => {
            const meta = store.getProject(projectId);
            return meta ? ok(meta) : err(`project not found: ${projectId}`);
        },
    );

    server.registerTool(
        'project.tree',
        {
            description:
                'Get the project forest assembled from parentProjectId relationships. Pass `rootId` to scope to one sub-tree. Useful for micro-frontend setups (parent app + iframe children) where you want to see all related projects at a glance.',
            inputSchema: { rootId: z.string().optional() },
        },
        async ({ rootId }) => ok(store.getProjectTree(rootId)),
    );

    server.registerTool(
        'project.set_parent',
        {
            description:
                'Set or clear a project\'s parentProjectId. Rejects cycles (A→B→A). Pass `parentProjectId: null` to make the project a forest root.',
            inputSchema: {
                projectId: z.string(),
                parentProjectId: z.string().nullable().optional(),
            },
        },
        async ({ projectId, parentProjectId }) => {
            try {
                const meta = store.upsertProject(projectId, {
                    parentProjectId: parentProjectId ?? undefined,
                });
                return ok(meta);
            } catch (e) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    server.registerTool(
        'build.list',
        {
            description:
                'List builds recorded for a project, newest first. A build = one source-code snapshot (stable across HMR; changes on dev-server restart or prod build).',
            inputSchema: { projectId: z.string(), limit: z.number().int().positive().optional() },
        },
        async ({ projectId, limit }) => ok(store.listBuilds(projectId, limit)),
    );

    server.registerTool(
        'build.get',
        {
            description: 'Read a single build\'s metadata (gitSha, dirty, bundler, …).',
            inputSchema: { projectId: z.string(), buildId: z.string() },
        },
        async ({ projectId, buildId }) => {
            const meta = store.getBuild(projectId, buildId);
            return meta ? ok(meta) : err(`build not found: ${projectId}/${buildId}`);
        },
    );

    // ─── visitor.* tools — investigate user identity & journey (0.5+) ────

    server.registerTool(
        'visitor.list',
        {
            description:
                'List known visitors (anonymous browsers + optional app-supplied userId). Newest activity first. Filter by projectId to scope to one app.',
            inputSchema: {
                projectId: z.string().optional(),
                limit: z.number().int().positive().optional(),
            },
        },
        async ({ projectId, limit }) => ok(store.listVisitors({ projectId, limit })),
    );

    server.registerTool(
        'visitor.get',
        {
            description:
                'Read a single visitor\'s metadata: firstSeenAt, lastSeenAt, sessionCount, projectIds, tabIds, and lastEnv (UA / viewport / timezone / colorScheme).',
            inputSchema: { visitorId: z.string() },
        },
        async ({ visitorId }) => {
            const meta = store.getVisitor(visitorId);
            return meta ? ok(meta) : err(`visitor not found: ${visitorId}`);
        },
    );

    server.registerTool(
        'visitor.journey',
        {
            description:
                'Chronological journey for one visitor — list of sessions (pageloads) with their URL, project participants, and start/end timestamps. Newest first. Answers "what did this user actually do?"',
            inputSchema: {
                visitorId: z.string(),
                limit: z.number().int().positive().optional(),
            },
        },
        async ({ visitorId, limit }) => {
            // Walk all sessions whose participants reference any project this
            // visitor has touched, then filter by visitorId-tagged events in
            // the timeline. Simpler initial impl: visitor.projectIds gives us
            // the projects of interest; we list those projects' sessions and
            // intersect with any session that contains an event tagged with
            // this visitorId.
            const visitor = store.getVisitor(visitorId);
            if (!visitor) return err(`visitor not found: ${visitorId}`);
            const seen = new Set<string>();
            const sessionsOut: Array<{
                sessionId: string;
                url?: string;
                title?: string;
                startedAt: number;
                endedAt?: number;
                projects: string[];
                builds: string[];
            }> = [];
            for (const pid of visitor.projectIds) {
                for (const sess of store.listSessions({ projectId: pid, limit: 200 })) {
                    if (seen.has(sess.id)) continue;
                    // Cheap proxy: a session with this visitor's tabIds counts.
                    // Better filter is row-level visitorId tag — but tab match
                    // is usually sufficient since tabIds are visitor-owned.
                    if (sess.tabId && !visitor.tabIds.includes(sess.tabId)) continue;
                    seen.add(sess.id);
                    sessionsOut.push({
                        sessionId: sess.id,
                        url: sess.url,
                        title: sess.title,
                        startedAt: sess.startedAt,
                        endedAt: sess.endedAt,
                        projects: sess.participants.map((p) => p.projectId),
                        builds: sess.participants
                            .map((p) => p.buildId)
                            .filter((b): b is string => !!b),
                    });
                }
            }
            sessionsOut.sort((a, b) => b.startedAt - a.startedAt);
            const slice = limit ? sessionsOut.slice(0, limit) : sessionsOut;
            return ok({ visitor, sessions: slice });
        },
    );

    server.registerTool(
        'visitor.timeline',
        {
            description:
                'Merged event timeline across all sessions for one visitor, ascending by ts. Use this for cross-tab debugging (e.g. a ws frame in tab A causing a storage write in tab B). Each event carries `sessionId` and `tab` so the source tab is visible. Pass `sessionIds` to skip auto-discovery and merge a known set.',
            inputSchema: {
                visitorId: z.string(),
                since: z.number().optional().describe('Only events after this Unix ts (ms)'),
                until: z.number().optional().describe('Only events before this Unix ts (ms)'),
                types: z.union([z.string(), z.array(z.string())]).optional()
                    .describe('Filter by event type(s): log, err, req, res, ws, storage, cmd, resp, ...'),
                tabIds: z.array(z.string()).optional()
                    .describe('Narrow merge to specific tabIds. Default: all tabs known to this visitor.'),
                sessionIds: z.array(z.string()).optional()
                    .describe('Explicit session list to merge. When set, skips visitor → session discovery.'),
                limit: z.number().int().positive().optional()
                    .describe('Max events returned (newest). Default 200.'),
            },
        },
        async ({ visitorId, since, until, types, tabIds, sessionIds, limit }) => {
            const result = buildVisitorTimeline(store, visitorId, {
                since, until, types, tabIds, sessionIds, limit,
            });
            if ('error' in result) return err(result.error);
            return ok(result);
        },
    );

    server.registerTool(
        'session.recordings.list',
        {
            description: 'List rrweb recording chunks available for a session.',
            inputSchema: {
                sessionId: z.string(),
            },
        },
        async ({ sessionId }) => {
            const session = store.getSession(sessionId);
            if (!session) {
                return ok({ error: 'session not found', sessionId });
            }
            const chunks = store.listRecordings(sessionId);
            return ok({ chunks, intervals: meltRecordingIntervals(chunks) });
        },
    );

    server.registerTool(
        'session.recordings.around',
        {
            description: 'Find rrweb recording chunks overlapping a window around a timestamp.',
            inputSchema: {
                sessionId: z.string(),
                ts: z.number().describe('Center timestamp in Unix ms'),
                windowMs: z.number().int().positive().default(15_000).optional(),
            },
        },
        async ({ sessionId, ts, windowMs }) => {
            const session = store.getSession(sessionId);
            if (!session) {
                return ok({ error: 'session not found', sessionId });
            }
            const radius = windowMs ?? 15_000;
            const since = ts - radius;
            const until = ts + radius;
            const chunks = store.listRecordings(sessionId)
                .filter((chunk) => chunk.endTs >= since && chunk.startTs <= until);
            const markers = store.tail(sessionId, { n: 200, type: 'rrweb:marker', since, until })
                .filter((marker) => chunks.some((chunk) => chunk.endTs >= marker.ts && chunk.startTs <= marker.ts));
            return ok({ since, until, chunks, intervals: meltRecordingIntervals(chunks), markers });
        },
    );

    server.registerTool(
        'session.recordings.slice',
        {
            description: 'Return rrweb recording chunks overlapping a requested time window.',
            inputSchema: {
                sessionId: z.string(),
                since: z.number().describe('Start timestamp in Unix ms'),
                until: z.number().describe('End timestamp in Unix ms'),
            },
        },
        async ({ sessionId, since, until }) => {
            const session = store.getSession(sessionId);
            if (!session) {
                return ok({ error: 'session not found', sessionId });
            }
            const chunks = store.sliceRecordings(sessionId, since, until);
            return ok({ since, until, chunks, intervals: meltRecordingIntervals(chunks) });
        },
    );

    server.registerTool(
        'session.replay.create',
        {
            description:
                'Bundle rrweb recording chunks in a time window into a single replay export and return a viewer URL. '
                + 'Provide either {ts, windowMs?} (default ±15s around ts) or {since, until} explicit bounds. '
                + 'The returned viewerUrl opens a self-contained rrweb-player page — paste it to the user to share the replay.',
            inputSchema: {
                sessionId: z.string(),
                tabId: z.string().optional().describe('Restrict to a single tab (recommended for clean replay).'),
                ts: z.number().optional().describe('Center timestamp in Unix ms; ignored if since/until provided.'),
                windowMs: z.number().int().positive().default(15_000).optional().describe('Half-window around ts. Default 15s.'),
                since: z.number().optional().describe('Explicit window start (Unix ms). Overrides ts.'),
                until: z.number().optional().describe('Explicit window end (Unix ms). Overrides ts.'),
                label: z.string().optional().describe('Optional human label saved with the export.'),
            },
        },
        async ({ sessionId, tabId, ts, windowMs, since, until, label }) => {
            const result = createReplayExport(store, bridge.getViewerBaseUrl(), {
                sessionId, tabId, ts, windowMs, since, until, label,
            });
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
                maxRecordingChunksPerTab: z.number().int().positive().optional(),
                maxRecordingBytesPerTab: z.number().int().positive().optional(),
                preserveMarkedChunks: z.boolean().optional(),
            },
        },
        async ({
            maxAgeDays,
            maxSessionsPerProject,
            recordingRetentionDays,
            maxRecordingChunksPerTab,
            maxRecordingBytesPerTab,
            preserveMarkedChunks,
        }) => {
            const result = store.purge({
                maxAgeDays,
                maxSessionsPerProject,
                recordingRetentionDays,
                maxRecordingChunksPerTab,
                maxRecordingBytesPerTab,
                preserveMarkedChunks,
            });
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
        listSessionsAsync(opts?: { projectId?: string; tabId?: string; buildId?: string; limit?: number }): Promise<unknown>;
        summaryAsync(sessionId: string): Promise<unknown>;
        tailAsync(sessionId: string, opts?: unknown): Promise<unknown>;
        searchAsync(sessionId: string, query: string, opts?: unknown): Promise<unknown>;
        listRecordingsAsync(sessionId: string): Promise<unknown>;
        sliceRecordingsAsync(sessionId: string, since: number, until: number): Promise<unknown>;
        replayCreateAsync(args: unknown): Promise<unknown>;
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
            const sessions = await remoteStore.listSessionsAsync({ projectId, limit: limit ?? 10 });
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
            description: 'Read the last N events from a session timeline. Optionally filter by event type or projectId. For cross-tab debugging within one visitor, use `visitor.timeline` to merge multiple sessions.',
            inputSchema: {
                sessionId: z.string(),
                n: z.number().int().positive().default(50).optional(),
                type: z.union([z.string(), z.array(z.string())]).optional()
                    .describe('Filter by event type(s): log, err, req, res, cmd, resp, hmr, task, node:log, node:err'),
                projectId: z.string().optional().describe('Filter events by projectId (useful for multi-project sessions)'),
                since: z.number().optional().describe('Only events after this Unix timestamp (ms)'),
                until: z.number().optional().describe('Only events before this Unix timestamp (ms)'),
            },
        },
        async ({ sessionId, n, type, projectId, since, until }) => {
            const events = await remoteStore.tailAsync(
                sessionId,
                { n: n ?? 50, type: type as string | string[] | undefined, projectId, since, until },
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
            },
        },
        async ({ sessionId, query, type, limit }) => {
            const events = await remoteStore.searchAsync(
                sessionId,
                query,
                { type: type as string | string[] | undefined, limit: limit ?? 50 },
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
                    recentSessions: await remoteStore.listSessionsAsync({ projectId: p.id, limit: 3 }),
                })),
            );
            return ok(result);
        },
    );

    server.registerTool(
        'session.recordings.list',
        {
            description: 'List rrweb recording chunks available for a session.',
            inputSchema: {
                sessionId: z.string(),
            },
        },
        async ({ sessionId }) => {
            const chunks = await remoteStore.listRecordingsAsync(sessionId);
            return ok({ chunks, intervals: meltRecordingIntervals(chunks as Array<{
                startTs: number;
                endTs: number;
                chunkId: string;
                tabId: string;
                eventCount: number;
            }>) });
        },
    );

    server.registerTool(
        'session.recordings.around',
        {
            description: 'Find rrweb recording chunks overlapping a window around a timestamp.',
            inputSchema: {
                sessionId: z.string(),
                ts: z.number().describe('Center timestamp in Unix ms'),
                windowMs: z.number().int().positive().default(15_000).optional(),
            },
        },
        async ({ sessionId, ts, windowMs }) => {
            const radius = windowMs ?? 15_000;
            const since = ts - radius;
            const until = ts + radius;
            const chunks = await remoteStore.listRecordingsAsync(sessionId) as Array<{
                startTs: number;
                endTs: number;
            }>;
            const markers = await remoteStore.tailAsync(
                sessionId,
                { n: 200, type: 'rrweb:marker', since, until },
            ) as Array<{ ts: number }>;
            return ok({
                since,
                until,
                chunks: chunks.filter((chunk) => chunk.endTs >= since && chunk.startTs <= until),
                intervals: meltRecordingIntervals(
                    chunks.filter((chunk) => chunk.endTs >= since && chunk.startTs <= until) as Array<{
                        startTs: number;
                        endTs: number;
                        chunkId: string;
                        tabId: string;
                        eventCount: number;
                    }>,
                ),
                markers: markers.filter((marker) =>
                    chunks.some((chunk) => chunk.endTs >= marker.ts && chunk.startTs <= marker.ts),
                ),
            });
        },
    );

    server.registerTool(
        'session.recordings.slice',
        {
            description: 'Return rrweb recording chunks overlapping a requested time window.',
            inputSchema: {
                sessionId: z.string(),
                since: z.number().describe('Start timestamp in Unix ms'),
                until: z.number().describe('End timestamp in Unix ms'),
            },
        },
        async ({ sessionId, since, until }) => {
            const chunks = await remoteStore.sliceRecordingsAsync(sessionId, since, until);
            return ok({
                since,
                until,
                chunks,
                intervals: meltRecordingIntervals(chunks as Array<{
                    startTs: number;
                    endTs: number;
                    chunkId: string;
                    tabId: string;
                    eventCount: number;
                }>),
            });
        },
    );

    server.registerTool(
        'session.replay.create',
        {
            description:
                'Bundle rrweb recording chunks in a time window into a single replay export and return a viewer URL. '
                + 'Provide either {ts, windowMs?} (default ±15s around ts) or {since, until} explicit bounds. '
                + 'The returned viewerUrl opens a self-contained rrweb-player page — paste it to the user to share the replay.',
            inputSchema: {
                sessionId: z.string(),
                tabId: z.string().optional(),
                ts: z.number().optional(),
                windowMs: z.number().int().positive().default(15_000).optional(),
                since: z.number().optional(),
                until: z.number().optional(),
                label: z.string().optional(),
            },
        },
        async ({ sessionId, tabId, ts, windowMs, since, until, label }) => {
            const result = await remoteStore.replayCreateAsync({
                sessionId, tabId, ts, windowMs, since, until, label,
            });
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
                maxRecordingChunksPerTab: z.number().int().positive().optional(),
                maxRecordingBytesPerTab: z.number().int().positive().optional(),
                preserveMarkedChunks: z.boolean().optional(),
            },
        },
        async ({
            maxAgeDays,
            maxSessionsPerProject,
            recordingRetentionDays,
            maxRecordingChunksPerTab,
            maxRecordingBytesPerTab,
            preserveMarkedChunks,
        }) => {
            const result = await remoteStore.purgeAsync({
                maxAgeDays,
                maxSessionsPerProject,
                recordingRetentionDays,
                maxRecordingChunksPerTab,
                maxRecordingBytesPerTab,
                preserveMarkedChunks,
            });
            return ok(result);
        },
    );
}

function meltRecordingIntervals(chunks: Array<{
    chunkId: string;
    tabId: string;
    startTs: number;
    endTs: number;
    eventCount: number;
}>): Array<{
    startTs: number;
    endTs: number;
    chunkCount: number;
    eventCount: number;
    chunkIds: string[];
    tabIds: string[];
}> {
    if (chunks.length === 0) return [];
    const sorted = [...chunks].sort((a, b) => a.startTs - b.startTs || a.endTs - b.endTs);
    const intervals: Array<{
        startTs: number;
        endTs: number;
        chunkCount: number;
        eventCount: number;
        chunkIds: string[];
        tabIds: string[];
    }> = [];

    for (const chunk of sorted) {
        const last = intervals[intervals.length - 1];
        if (!last || chunk.startTs > last.endTs) {
            intervals.push({
                startTs: chunk.startTs,
                endTs: chunk.endTs,
                chunkCount: 1,
                eventCount: chunk.eventCount,
                chunkIds: [chunk.chunkId],
                tabIds: [chunk.tabId],
            });
            continue;
        }

        last.endTs = Math.max(last.endTs, chunk.endTs);
        last.chunkCount += 1;
        last.eventCount += chunk.eventCount;
        last.chunkIds.push(chunk.chunkId);
        if (!last.tabIds.includes(chunk.tabId)) last.tabIds.push(chunk.tabId);
    }

    return intervals;
}
