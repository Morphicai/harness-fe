/**
 * @harnessa-fe/webpack — native webpack plugin.
 *
 * Why native (vs the unplugin adapter):
 *   unplugin's webpack adapter passes the plugin instance through a loader's
 *   `options` field. The plugin instance closes over `compiler` (via the
 *   `webpack(compiler)` hook), and `compiler.root` self-references the
 *   compiler — JSON.stringify chokes on the cycle. thread-loader serializes
 *   downstream loader options when dispatching to its worker pool, so any
 *   project that puts thread-loader anywhere ahead of harnessa in the
 *   resolved loader chain (e.g. a `.ts` rule that vue-loader inlines for
 *   `<script lang="ts">` SFC blocks) breaks the entire build.
 *
 * This native plugin:
 *   - Registers a separate `enforce: 'pre'` rule pointing at an independent
 *     loader file (loader.ts) whose options are pure JSON-serializable data.
 *   - Keeps all stateful work (WebSocket to MCP, log capture, runtime
 *     injection, error forwarding, HTML injection) in the main process via
 *     compiler hooks.
 *   - Aggregates componentMap entries from worker processes via
 *     `module.buildMeta.harnessaCollected`.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
    createMcpClient,
    createBuildIdentity,
    installNodeLogCapture,
    appendTokenQuery,
    type ComponentLocation,
    type HarnessaFEOptions,
    type McpClient,
    type McpClientContext,
} from '@harnessa-fe/unplugin';
import { DEFAULT_WS_PORT } from '@harnessa-fe/protocol';
import { getOrCreateComponentMap } from './shared-state.js';
import type { HarnessaLoaderOptions } from './loader.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function newPluginId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
    return `harnessa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface CollectedLocation {
    name: string;
    location: ComponentLocation;
}

export class HarnessaFEWebpackPlugin {
    private readonly pluginId = newPluginId();
    private readonly options: HarnessaFEOptions;
    private projectRoot: string = process.cwd();
    private projectId: string;
    private readonly mcpUrl: string;
    private readonly token: string | undefined;
    private mcpClient?: McpClient;
    private logCleanup?: () => void;
    private identity = createBuildIdentity({
        userBuildId: undefined,
        userDisplayName: undefined,
    });

    constructor(options: HarnessaFEOptions = {}) {
        this.options = options;
        this.projectId = options.projectId ?? 'unknown-project';
        const baseUrl =
            options.mcpUrl ??
            process.env.HARNESSA_FE_URL ??
            `ws://127.0.0.1:${DEFAULT_WS_PORT}`;
        this.token = options.token ?? process.env.HARNESSA_FE_TOKEN;
        this.mcpUrl = appendTokenQuery(baseUrl, this.token);
        this.identity = createBuildIdentity({
            userBuildId: options.buildId,
            userDisplayName: options.displayName,
        });
    }

    apply(compiler: any): void {
        if (this.options.disabled) return;

        this.projectRoot = compiler.options?.context ?? process.cwd();

        // Resolve loader path. require.resolve gives an absolute path that
        // webpack can hand to loader-runner regardless of host project's
        // module resolution config.
        const loaderPath = resolvePath(__dirname, 'loader.js');

        const loaderOptions: HarnessaLoaderOptions = {
            pluginId: this.pluginId,
            projectRoot: this.projectRoot,
            vueOptions: {
                safeMode: this.options.safeMode !== false,
                dryRun: process.env.HARNESSA_FE_DRY_RUN === '1',
            },
            disabled: false,
        };

        // Register the transform loader as a pre-rule.
        compiler.options.module ??= { rules: [] };
        compiler.options.module.rules ??= [];
        compiler.options.module.rules.unshift({
            test: /\.([jt]sx|vue)($|\?)/,
            exclude: /[\\/]node_modules[\\/]/,
            enforce: 'pre',
            use: [
                {
                    loader: loaderPath,
                    options: loaderOptions,
                    ident: `harnessa-fe-${this.pluginId}`,
                },
            ],
        });

        // Skip the rest in production builds — runtime injection and MCP
        // connection are dev-only conveniences.
        if (compiler.options?.mode === 'production') return;

        this.installRuntimeEntry(compiler);
        this.installMcpHooks(compiler);
        this.installComponentMapAggregator(compiler);
        this.installHtmlInjection(compiler);
        this.installErrorForwarding(compiler);
    }

    private installRuntimeEntry(compiler: any): void {
        try {
            const webpackPkg = require('webpack');
            const { EntryPlugin } = webpackPkg;
            const runtimeEntry = require.resolve('@harnessa-fe/runtime');
            new EntryPlugin(compiler.context ?? this.projectRoot, runtimeEntry, {
                name: undefined,
            }).apply(compiler);
        } catch (err) {
            console.warn(
                '[harnessa-fe] failed to register runtime entry via webpack.EntryPlugin:',
                err,
            );
        }
    }

    private installMcpHooks(compiler: any): void {
        const ctx: McpClientContext = {
            get projectId() {
                return self.projectId;
            },
            get mcpUrl() {
                return self.mcpUrl;
            },
            get token() {
                return self.token;
            },
            peerRole: 'webpack-plugin',
            get parentProjectId() {
                return self.options.parentProjectId;
            },
            get projectRoot() {
                return self.projectRoot;
            },
            get componentMap() {
                return getOrCreateComponentMap(self.pluginId);
            },
            getBuildId: () => this.identity.getBuildId(this.projectRoot),
            getDisplayName: () => this.identity.getDisplayName(this.projectRoot),
        };
        const self = this;

        compiler.hooks.afterEnvironment.tap('harnessa-fe', () => {
            const client = createMcpClient(ctx);
            this.mcpClient = client;
            client.connect();
            this.logCleanup = installNodeLogCapture((name, payload) => client.emitEvent(name, payload));
        });

        compiler.hooks.shutdown?.tap('harnessa-fe', () => {
            this.logCleanup?.();
            this.logCleanup = undefined;
            this.mcpClient?.disconnect();
            this.mcpClient = undefined;
        });
    }

    private installComponentMapAggregator(compiler: any): void {
        const pluginId = this.pluginId;
        compiler.hooks.compilation.tap('harnessa-fe', (compilation: any) => {
            compilation.hooks.succeedModule.tap('harnessa-fe', (module: any) => {
                const collected = module.buildMeta?.harnessaCollected as
                    | CollectedLocation[]
                    | undefined;
                if (!collected?.length) return;
                const map = getOrCreateComponentMap(pluginId);
                for (const { name, location } of collected) {
                    const existing = map.get(name) ?? [];
                    existing.push(location);
                    map.set(name, existing);
                }
            });
        });
    }

    private installHtmlInjection(compiler: any): void {
        compiler.hooks.compilation.tap('harnessa-fe', (compilation: any) => {
            // Prefer html-webpack-plugin hooks when available.
            try {
                const HtmlPlugin = require('html-webpack-plugin');
                const hooks = HtmlPlugin.getHooks(compilation);
                hooks.beforeEmit.tapAsync('harnessa-fe', (data: any, cb: any) => {
                    data.html = this.injectConfigScript(data.html);
                    cb(null, data);
                });
            } catch {
                // Fallback: rewrite html assets directly.
                const { Compilation, sources } = require('webpack');
                compilation.hooks.processAssets.tap(
                    {
                        name: 'harnessa-fe',
                        stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
                    },
                    (assets: Record<string, any>) => {
                        for (const [name, source] of Object.entries(assets)) {
                            if (!name.endsWith('.html')) continue;
                            const html = source.source();
                            if (typeof html !== 'string') continue;
                            compilation.updateAsset(
                                name,
                                new sources.RawSource(this.injectConfigScript(html)),
                            );
                        }
                    },
                );
            }
        });
    }

    private installErrorForwarding(compiler: any): void {
        compiler.hooks.done.tap('harnessa-fe', (stats: any) => {
            if (!this.mcpClient || !stats.hasErrors()) return;
            const errors = stats.compilation?.errors ?? [];
            for (const err of errors) {
                this.mcpClient.emitEvent('error', {
                    message: err.message ?? String(err),
                    file: err.module?.resource ?? undefined,
                });
            }
        });
    }

    private injectConfigScript(html: string): string {
        const injection = `<!-- @harnessa-fe injected (dev only) -->
<script>
window.__HARNESSA_FE__ = ${JSON.stringify({
            projectId: this.projectId,
            mcpUrl: this.mcpUrl,
            buildId: this.identity.getBuildId(this.projectRoot),
            parentProjectId: this.options.parentProjectId,
            displayName: this.identity.getDisplayName(this.projectRoot),
        })};
</script>`;
        return html.replace(/<\/head>/i, `${injection}\n</head>`);
    }
}

/** Factory matching the previous unplugin-based call shape. */
export function harnessaFE(options: HarnessaFEOptions = {}): HarnessaFEWebpackPlugin {
    return new HarnessaFEWebpackPlugin(options);
}
