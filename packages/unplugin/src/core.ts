/**
 * Core unplugin definition for Harness-FE.
 *
 * Handles:
 *   1. Source-aware JSX / Vue transform (data-morphix-loc / data-morphix-comp)
 *   2. WebSocket connection to MCP server (hello handshake, command handling)
 *   3. HTML injection of runtime client + config (Vite)
 *   4. HMR event forwarding (Vite)
 *
 * Webpack users should use `@harness-fe/webpack` (a native webpack plugin)
 * instead — the unplugin webpack adapter is incompatible with thread-loader
 * because it serializes the plugin instance (and its compiler reference) via
 * loader options.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { createUnplugin, type UnpluginFactory } from 'unplugin';

import { DEFAULT_WS_PORT } from '@harness-fe/protocol';
import { transformJsx, type ComponentMap } from './transform.js';
import {
    transformVueSFC,
    transformVueTemplate,
    resolveVueComponentName,
    getTemplateLineOffset,
    createVueTransformStats,
    formatVueTransformReport,
    type VueTransformOptions,
} from './vue-transform.js';
import { resolveProjectId } from './resolveProjectId.js';
import { createMcpClient } from './internal/mcp-client.js';
import { installNodeLogCapture } from './internal/log-capture.js';
import { appendTokenQuery, createBuildIdentity } from './internal/buildIdentity.js';
import type { HarnessFEOptions, McpClient, McpClientContext, PeerRole } from './internal/types.js';

const require = createRequire(import.meta.url);

/**
 * Virtual module ID used to inject the runtime client into the dev page.
 */
const VIRTUAL_RUNTIME_ID = 'virtual:harness-fe/runtime';
const RESOLVED_VIRTUAL_RUNTIME_ID = '\0' + VIRTUAL_RUNTIME_ID;

export type { HarnessFEOptions };

export const unpluginFactory: UnpluginFactory<HarnessFEOptions | undefined> = (options = {}) => {
    let projectId = options.projectId ?? 'unknown-project';
    const baseMcpUrl =
        options.mcpUrl ?? process.env.HARNESS_FE_URL ?? `ws://127.0.0.1:${DEFAULT_WS_PORT}/ws`;
    const token = options.token ?? process.env.HARNESS_FE_TOKEN;
    const mcpUrl = appendTokenQuery(baseMcpUrl, token);
    let projectRoot = process.cwd();
    let peerRole: PeerRole = 'vite-plugin';
    const componentMap: ComponentMap = new Map();
    let logCaptureCleanup: (() => void) | undefined;
    let mcpClient: McpClient | undefined;

    // Vue 2 hardening — safeMode on by default, dry-run gated by env so
    // legacy projects can collect a coverage report before flipping on.
    const dryRun = process.env.HARNESS_FE_DRY_RUN === '1';
    const vueStats = createVueTransformStats();
    const vueOptions: VueTransformOptions = {
        safeMode: options.safeMode !== false,
        dryRun,
        stats: vueStats,
    };
    let dumpReportInstalled = false;
    function ensureExitReport(): void {
        if (dumpReportInstalled) return;
        dumpReportInstalled = true;
        const dump = () => {
            if (vueStats.filesAttempted === 0) return;
            process.stderr.write(formatVueTransformReport(vueStats) + '\n');
        };
        process.once('exit', dump);
        process.once('SIGINT', () => { dump(); process.exit(0); });
        process.once('SIGTERM', () => { dump(); process.exit(0); });
    }
    if (dryRun) ensureExitReport();

    const identity = createBuildIdentity({
        userBuildId: options.buildId,
        userDisplayName: options.displayName,
    });

    function buildMcpContext(): McpClientContext {
        return {
            get projectId() { return projectId; },
            get mcpUrl() { return mcpUrl; },
            get token() { return token; },
            get peerRole() { return peerRole; },
            get parentProjectId() { return options.parentProjectId; },
            get projectRoot() { return projectRoot; },
            get componentMap() { return componentMap; },
            getBuildId: () => identity.getBuildId(projectRoot),
            getDisplayName: () => identity.getDisplayName(projectRoot),
        };
    }

    function ensureMcpClient(): McpClient {
        if (!mcpClient) mcpClient = createMcpClient(buildMcpContext());
        return mcpClient;
    }

    // Expose for advanced usage (e.g. tests or downstream plugins inspecting state).
    const ctx = {
        get projectId() { return projectId; },
        get mcpUrl() { return mcpUrl; },
        get componentMap() { return componentMap; },
        get isActive() { return mcpClient?.isActive ?? false; },
    };

    return {
        name: 'harness-fe',
        enforce: 'pre',

        async buildStart() {
            if (options.disabled) return;
            projectId = await resolveProjectId(projectRoot, options.projectId);
        },

        transformInclude(id: string) {
            if (options.disabled) return false;
            // Accept query-string variants so we can intercept vue-loader's
            // virtual sub-modules (`App.vue?vue&type=template…`).
            if (!/\.([jt]sx|vue)($|\?)/.test(id)) return false;
            if (id.includes('/node_modules/') || id.includes('\\node_modules\\')) return false;
            return true;
        },

        transform(code: string, id: string) {
            if (options.disabled) return null;
            const queryIdx = id.indexOf('?');
            const filePath = queryIdx === -1 ? id : id.slice(0, queryIdx);
            const query = queryIdx === -1 ? '' : id.slice(queryIdx);
            const rel = relative(projectRoot, filePath);

            // Vue template virtual sub-module.
            if (filePath.endsWith('.vue') && /[?&]vue\b/.test(query) && /[?&]type=template\b/.test(query)) {
                let componentName: string | undefined;
                let lineOffset = 0;
                try {
                    const sfcSource = readFileSync(filePath, 'utf-8');
                    componentName = resolveVueComponentName(sfcSource, rel);
                    lineOffset = getTemplateLineOffset(sfcSource, rel);
                } catch {
                    /* fall through with no offset / no name */
                }
                const out = transformVueTemplate(code, rel, componentName, componentMap, lineOffset, vueOptions);
                if (!out) return null;
                return { code: out.code, map: out.map as any };
            }

            // Plain .vue request: full SFC transform.
            if (filePath.endsWith('.vue') && !query) {
                const out = transformVueSFC(code, rel, componentMap, vueOptions);
                if (!out) return null;
                return { code: out.code, map: out.map as any };
            }

            // Skip every other .vue sub-module (script / style).
            if (filePath.endsWith('.vue')) return null;

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
                const client = ensureMcpClient();
                client.connect();
                logCaptureCleanup = installNodeLogCapture((name, payload) => client.emitEvent(name, payload));
                server.httpServer?.once('close', () => {
                    logCaptureCleanup?.();
                    logCaptureCleanup = undefined;
                    client.disconnect();
                });
            },

            resolveId(id: string) {
                if (id === VIRTUAL_RUNTIME_ID) return RESOLVED_VIRTUAL_RUNTIME_ID;
                return undefined;
            },

            load(id: string) {
                if (id !== RESOLVED_VIRTUAL_RUNTIME_ID) return undefined;
                const runtimeEntry = require.resolve('@harness-fe/runtime');
                return `export * from ${JSON.stringify(runtimeEntry)};\nimport ${JSON.stringify(runtimeEntry)};`;
            },

            transformIndexHtml: {
                order: 'pre' as const,
                handler(html: string) {
                    if (options.disabled) return html;
                    const injection = `<!-- @harness-fe injected (dev only) -->
<script>
window.__HARNESS_FE__ = ${JSON.stringify({ projectId, mcpUrl, buildId: identity.getBuildId(projectRoot), parentProjectId: options.parentProjectId, displayName: identity.getDisplayName(projectRoot) })};
</script>
<script type="module">import '${VIRTUAL_RUNTIME_ID}';</script>`;
                    return html.replace(/<\/head>/i, `${injection}\n</head>`);
                },
            },

            handleHotUpdate(hmrCtx: any) {
                mcpClient?.emitEvent('hmr', {
                    file: hmrCtx.file,
                    type: hmrCtx.modules?.length ? 'update' : 'reload',
                    moduleCount: hmrCtx.modules?.length ?? 0,
                });
                return hmrCtx.modules;
            },
        },

        // Expose context for advanced usage
        _ctx: ctx,
    };
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);
