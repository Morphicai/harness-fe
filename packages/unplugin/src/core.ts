/**
 * Core unplugin definition for Harnessa-FE.
 *
 * This is the single source of truth for the plugin logic. It handles:
 *   1. Source-aware JSX transform (data-morphix-loc / data-morphix-comp)
 *   2. WebSocket connection to MCP server (hello handshake, command handling)
 *   3. HTML injection of runtime client + config
 *   4. HMR/error event forwarding
 *
 * The unplugin framework adapts this to Vite, Webpack, Rspack, esbuild, etc.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { createUnplugin, type UnpluginFactory } from 'unplugin';

const require = createRequire(import.meta.url);

/**
 * Virtual module ID used to inject the runtime client into the dev page.
 * Using a virtual module avoids bare-import resolution failures when the
 * runtime package is not listed as a direct dependency of the host app.
 */
const VIRTUAL_RUNTIME_ID = 'virtual:harnessa-fe/runtime';
const RESOLVED_VIRTUAL_RUNTIME_ID = '\0' + VIRTUAL_RUNTIME_ID;

import { WebSocket } from 'ws';
import {
    COMMAND,
    DEFAULT_WS_PORT,
    type CommandFrame,
    type EventFrame,
    type Frame,
    type HelloFrame,
    type ResponseFrame,
    frameSchema,
} from '@harnessa-fe/protocol';
import { transformJsx, type ComponentMap } from './transform.js';
import { transformVueSFC } from './vue-transform.js';
import { resolveProjectId } from './resolveProjectId.js';

export interface HarnessaFEOptions {
    /** Override projectId (defaults to package.json `name`). */
    projectId?: string;
    /** MCP server WebSocket URL (default: ws://127.0.0.1:47729). */
    mcpUrl?: string;
    /** Disable injection entirely. */
    disabled?: boolean;
}

function newId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID ? g.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * Intercepts `process.stdout.write` and `process.stderr.write` to emit
 * `'node:log'` / `'node:err'` events to the MCP server.
 *
 * Returns a cleanup function that restores the original write methods.
 */
function installNodeLogCapture(emitEvent: (name: string, payload: unknown) => void): () => void {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);

    (process.stdout as any).write = (chunk: any, ...args: any[]) => {
        emitEvent('node:log', { text: String(chunk) });
        return origOut(chunk, ...args);
    };
    (process.stderr as any).write = (chunk: any, ...args: any[]) => {
        emitEvent('node:err', { text: String(chunk) });
        return origErr(chunk, ...args);
    };

    return () => {
        (process.stdout as any).write = origOut;
        (process.stderr as any).write = origErr;
    };
}

export const unpluginFactory: UnpluginFactory<HarnessaFEOptions | undefined> = (options = {}) => {
    let projectId = options.projectId ?? 'unknown-project';
    // Resolve mcpUrl: explicit option > env vars (HARNESSA_FE_PORT / HARNESSA_FE_HOST) > default port.
    // The env vars are the same ones read by cli.ts, so the plugin and the MCP server always
    // agree on which port to use even when mcp.json overrides the default.
    const mcpUrl =
        options.mcpUrl ??
        (process.env.HARNESSA_FE_PORT
            ? `ws://${process.env.HARNESSA_FE_HOST ?? '127.0.0.1'}:${process.env.HARNESSA_FE_PORT}`
            : `ws://127.0.0.1:${DEFAULT_WS_PORT}`);
    let ws: WebSocket | undefined;
    let isActive = false;
    let projectRoot = process.cwd();
    let peerRole: 'vite-plugin' | 'webpack-plugin' = 'vite-plugin';
    const componentMap: ComponentMap = new Map();
    let logCaptureCleanup: (() => void) | undefined;

    function send(frame: EventFrame | HelloFrame | ResponseFrame): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify(frame));
        } catch {
            /* swallow */
        }
    }

    async function handleCommand(frame: CommandFrame): Promise<void> {
        let response: ResponseFrame;
        try {
            const result = await runCommand(frame.command, frame.args);
            response = { type: 'response', id: frame.id, ok: true, result };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            response = { type: 'response', id: frame.id, ok: false, error: { message } };
        }
        send(response);
    }

    async function runCommand(command: string, args: unknown): Promise<unknown> {
        switch (command) {
            case COMMAND.PROJECT_SOURCE: {
                const a = args as { file?: string; component?: string };
                let file = a.file;
                if (!file && a.component) {
                    const locs = componentMap.get(a.component);
                    if (!locs?.length) {
                        throw new Error(`project.source: component "${a.component}" not found in the scan`);
                    }
                    file = locs[0].file;
                }
                if (!file) {
                    throw new Error('project.source: pass either `file` or `component`');
                }
                const abs = resolve(projectRoot, file);
                if (!abs.startsWith(projectRoot)) {
                    throw new Error(`project.source: refusing to read outside project root: ${file}`);
                }
                const content = readFileSync(abs, 'utf-8');
                return { file, content };
            }
            case COMMAND.PROJECT_WHERE_IS: {
                const a = args as { component: string };
                const locs = componentMap.get(a.component);
                if (!locs?.length) {
                    throw new Error(`project.where_is: component "${a.component}" not found`);
                }
                return { component: a.component, locations: locs };
            }
            case COMMAND.PROJECT_MODULE_GRAPH: {
                const components: Record<string, Array<{ file: string; line: number; col: number }>> = {};
                for (const [name, locs] of componentMap.entries()) {
                    components[name] = locs;
                }
                return { components, totalFiles: new Set([...componentMap.values()].flat().map((l) => l.file)).size };
            }
            default:
                throw new Error(`harnessa-fe: unhandled command "${command}"`);
        }
    }

    function connectMcp(): void {
        try {
            ws = new WebSocket(mcpUrl);
            ws.on('open', () => {
                const hello: HelloFrame = {
                    type: 'hello',
                    id: newId(),
                    role: peerRole,
                    projectId,
                };
                send(hello);
            });
            ws.on('message', (raw) => {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(raw.toString());
                } catch {
                    return;
                }
                const result = frameSchema.safeParse(parsed);
                if (!result.success) return;
                const frame = result.data as Frame;
                if (frame.type === 'command') void handleCommand(frame);
            });
            ws.on('error', () => {
                // Server may not be running — that's fine, runtime client also
                // tries to connect; the plugin just provides best-effort metadata.
            });
            ws.on('close', () => {
                // Backoff reconnect once after 2s; don't spam.
                setTimeout(() => {
                    if (isActive) connectMcp();
                }, 2000);
            });
        } catch {
            /* swallow */
        }
    }

    function disconnectMcp(): void {
        isActive = false;
        logCaptureCleanup?.();
        logCaptureCleanup = undefined;
        ws?.close();
        ws = undefined;
    }

    /** Emit an event frame to the MCP server. */
    function emitEvent(name: string, payload: unknown): void {
        const event: EventFrame = {
            type: 'event',
            id: newId(),
            projectId,
            name,
            ts: Date.now(),
            payload,
        };
        send(event);
    }

    // Expose internals for bundler-specific hooks
    const ctx = {
        get projectId() { return projectId; },
        get mcpUrl() { return mcpUrl; },
        get componentMap() { return componentMap; },
        get isActive() { return isActive; },
        connectMcp,
        disconnectMcp,
        emitEvent,
        send,
    };

    return {
        name: 'harnessa-fe',
        enforce: 'pre',

        async buildStart() {
            if (options.disabled) return;
            // Resolve projectId from .harnessa-id if not explicitly set
            projectId = await resolveProjectId(projectRoot, options.projectId);
        },

        transformInclude(id: string) {
            if (options.disabled) return false;
            if (!/\.([jt]sx|vue)$/.test(id)) return false;
            if (id.includes('/node_modules/') || id.includes('\\node_modules\\')) return false;
            return true;
        },

        transform(code: string, id: string) {
            if (options.disabled) return null;
            const rel = relative(projectRoot, id);
            if (id.endsWith('.vue')) {
                const out = transformVueSFC(code, rel, componentMap);
                if (!out) return null;
                return { code: out.code, map: out.map as any };
            }
            const out = transformJsx(code, rel, componentMap);
            if (!out) return null;
            return { code: out.code, map: out.map as any };
        },

        // Vite-specific hooks
        vite: {
            async configResolved(config: any) {
                if (options.disabled) return;
                projectRoot = config.root ?? process.cwd();
                projectId = await resolveProjectId(projectRoot, options.projectId);
            },

            configureServer(server: any) {
                if (options.disabled) return;
                isActive = true;
                connectMcp();
                logCaptureCleanup = installNodeLogCapture(emitEvent);
                server.httpServer?.once('close', () => {
                    disconnectMcp();
                });
            },

            resolveId(id: string) {
                if (id === VIRTUAL_RUNTIME_ID) return RESOLVED_VIRTUAL_RUNTIME_ID;
                return undefined;
            },

            load(id: string) {
                if (id !== RESOLVED_VIRTUAL_RUNTIME_ID) return undefined;
                // Resolve the runtime package entry point relative to this plugin
                const runtimeEntry = require.resolve('@harnessa-fe/runtime');
                return `export * from ${JSON.stringify(runtimeEntry)};\nimport ${JSON.stringify(runtimeEntry)};`;
            },

            transformIndexHtml: {
                order: 'pre' as const,
                handler(html: string) {
                    if (options.disabled) return html;
                    const injection = `<!-- @harnessa-fe injected (dev only) -->
<script>
window.__HARNESSA_FE__ = ${JSON.stringify({ projectId, mcpUrl })};
</script>
<script type="module">import '${VIRTUAL_RUNTIME_ID}';</script>`;
                    return html.replace(/<\/head>/i, `${injection}\n</head>`);
                },
            },

            handleHotUpdate(hmrCtx: any) {
                emitEvent('hmr', {
                    file: hmrCtx.file,
                    type: hmrCtx.modules?.length ? 'update' : 'reload',
                    moduleCount: hmrCtx.modules?.length ?? 0,
                });
                return hmrCtx.modules;
            },
        },

        // Webpack-specific hooks
        webpack(compiler: any) {
            if (options.disabled) return;

            // Set role for webpack
            peerRole = 'webpack-plugin';

            // Resolve project root from webpack context
            projectRoot = compiler.options?.context ?? process.cwd();
            void resolveProjectId(projectRoot, options.projectId).then((id) => {
                projectId = id;
            });

            // Skip entirely in production
            if (compiler.options?.mode === 'production') return;

            // Connect to MCP server when compilation starts
            compiler.hooks.afterEnvironment.tap('harnessa-fe', () => {
                isActive = true;
                connectMcp();
                logCaptureCleanup = installNodeLogCapture(emitEvent);
            });

            // Disconnect on shutdown
            compiler.hooks.shutdown?.tap('harnessa-fe', () => {
                disconnectMcp();
            });

            // Forward compilation errors
            compiler.hooks.done.tap('harnessa-fe', (stats: any) => {
                if (stats.hasErrors()) {
                    const errors = stats.compilation?.errors ?? [];
                    for (const err of errors) {
                        emitEvent('error', {
                            message: err.message ?? String(err),
                            file: err.module?.resource ?? undefined,
                        });
                    }
                }
            });

            // HTML injection via html-webpack-plugin if available
            compiler.hooks.compilation.tap('harnessa-fe', (compilation: any) => {
                // Try html-webpack-plugin hooks
                try {
                    const HtmlPlugin = require('html-webpack-plugin');
                    const hooks = HtmlPlugin.getHooks(compilation);
                    hooks.beforeEmit.tapAsync('harnessa-fe', (data: any, cb: any) => {
                        const injection = `<!-- @harnessa-fe injected (dev only) -->
<script>
window.__HARNESSA_FE__ = ${JSON.stringify({ projectId, mcpUrl })};
</script>
<script type="module" src="@harnessa-fe/runtime"></script>`;
                        data.html = data.html.replace(/<\/head>/i, `${injection}\n</head>`);
                        cb(null, data);
                    });
                } catch {
                    // html-webpack-plugin not installed — use processAssets fallback
                    const { Compilation } = require('webpack');
                    compilation.hooks.processAssets.tap(
                        {
                            name: 'harnessa-fe',
                            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
                        },
                        (assets: any) => {
                            for (const [name, source] of Object.entries(assets)) {
                                if (!name.endsWith('.html')) continue;
                                const html = (source as any).source();
                                if (typeof html !== 'string') continue;
                                const injection = `<!-- @harnessa-fe injected (dev only) -->
<script>
window.__HARNESSA_FE__ = ${JSON.stringify({ projectId, mcpUrl })};
</script>
<script type="module" src="@harnessa-fe/runtime"></script>`;
                                const newHtml = html.replace(/<\/head>/i, `${injection}\n</head>`);
                                compilation.updateAsset(name, new (require('webpack').sources.RawSource)(newHtml));
                            }
                        },
                    );
                }
            });
        },

        // Expose context for advanced usage
        _ctx: ctx,
    };
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);
