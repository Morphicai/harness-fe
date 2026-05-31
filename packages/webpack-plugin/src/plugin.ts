/**
 * @harness-fe/webpack — native webpack plugin.
 *
 * Why native (vs the unplugin adapter):
 *   unplugin's webpack adapter passes the plugin instance through a loader's
 *   `options` field. The plugin instance closes over `compiler` (via the
 *   `webpack(compiler)` hook), and `compiler.root` self-references the
 *   compiler — JSON.stringify chokes on the cycle. thread-loader serializes
 *   downstream loader options when dispatching to its worker pool, so any
 *   project that puts thread-loader anywhere ahead of harness in the
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
 *     `module.buildMeta.harnessCollected`.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
    createMcpClient,
    createBuildIdentity,
    installNodeLogCapture,
    appendTokenQuery,
    resolveSoloTarget,
    type ComponentLocation,
    type HarnessFEOptions,
    type McpClient,
    type McpClientContext,
} from '@harness-fe/unplugin';
import { DEFAULT_WS_PORT } from '@harness-fe/protocol';
import { getOrCreateComponentMap } from './shared-state.js';
import type { HarnessLoaderOptions } from './loader.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function newPluginId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
    return `harness-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface CollectedLocation {
    name: string;
    location: ComponentLocation;
}

export class HarnessFEWebpackPlugin {
    private readonly pluginId = newPluginId();
    private readonly options: HarnessFEOptions;
    private projectRoot: string = process.cwd();
    private projectId: string;
    private readonly mcpUrl: string;
    private readonly baseMcpUrl: string;
    private readonly token: string | undefined;
    private mcpClient?: McpClient;
    private logCleanup?: () => void;
    private identity = createBuildIdentity({
        userBuildId: undefined,
        userDisplayName: undefined,
    });

    constructor(options: HarnessFEOptions = {}) {
        this.options = options;
        this.projectId = options.projectId ?? 'unknown-project';
        const baseUrl =
            options.mcpUrl ??
            process.env.HARNESS_FE_URL ??
            `ws://127.0.0.1:${DEFAULT_WS_PORT}`;
        this.baseMcpUrl = baseUrl;
        this.token = options.token ?? process.env.HARNESS_FE_TOKEN;
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

        const loaderOptions: HarnessLoaderOptions = {
            pluginId: this.pluginId,
            projectRoot: this.projectRoot,
            vueOptions: {
                safeMode: this.options.safeMode !== false,
                dryRun: process.env.HARNESS_FE_DRY_RUN === '1',
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
                    ident: `harness-fe-${this.pluginId}`,
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
            const runtimeEntry = require.resolve('@harness-fe/runtime');
            new EntryPlugin(compiler.context ?? this.projectRoot, runtimeEntry, {
                name: undefined,
            }).apply(compiler);
        } catch (err) {
            console.warn(
                '[harness-fe] failed to register runtime entry via webpack.EntryPlugin:',
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

        compiler.hooks.afterEnvironment.tap('harness-fe', () => {
            const client = createMcpClient(ctx);
            this.mcpClient = client;
            this.logCleanup = installNodeLogCapture((name, payload) => client.emitEvent(name, payload));
            // Solo (loopback + no token): ensure a shared local gateway is up, then
            // connect. afterEnvironment is sync, so fire-and-forget and connect once
            // the gateway answers (best-effort — if @harness-fe/cli isn't installed
            // we just connect and let the client retry). Team never auto-spawns.
            const solo = resolveSoloTarget(this.baseMcpUrl, Boolean(this.token));
            if (solo) {
                void this.ensureSharedGateway(solo).finally(() => client.connect());
            } else {
                client.connect();
            }
        });

        compiler.hooks.shutdown?.tap('harness-fe', () => {
            this.logCleanup?.();
            this.logCleanup = undefined;
            this.mcpClient?.disconnect();
            this.mcpClient = undefined;
        });
    }

    private async ensureSharedGateway(target: { host: string; port: number }): Promise<void> {
        try {
            const { ensureSharedGateway } = await import('@harness-fe/cli/sharedGateway');
            await ensureSharedGateway({ host: target.host, port: target.port });
        } catch {
            /* @harness-fe/cli not installed, or gateway slow — client.connect() retries */
        }
    }

    private installComponentMapAggregator(compiler: any): void {
        const pluginId = this.pluginId;
        compiler.hooks.compilation.tap('harness-fe', (compilation: any) => {
            compilation.hooks.succeedModule.tap('harness-fe', (module: any) => {
                const collected = module.buildMeta?.harnessCollected as
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
        compiler.hooks.compilation.tap('harness-fe', (compilation: any) => {
            // Prefer html-webpack-plugin hooks when available.
            try {
                const HtmlPlugin = require('html-webpack-plugin');
                const hooks = HtmlPlugin.getHooks(compilation);
                hooks.beforeEmit.tapAsync('harness-fe', (data: any, cb: any) => {
                    data.html = this.injectConfigScript(data.html);
                    cb(null, data);
                });
            } catch {
                // Fallback: rewrite html assets directly.
                const { Compilation, sources } = require('webpack');
                compilation.hooks.processAssets.tap(
                    {
                        name: 'harness-fe',
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
        compiler.hooks.done.tap('harness-fe', (stats: any) => {
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
        const injection = `<!-- @harness-fe injected (dev only) -->
<script>
window.__HARNESS_FE__ = ${JSON.stringify({
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
export function harnessFE(options: HarnessFEOptions = {}): HarnessFEWebpackPlugin {
    return new HarnessFEWebpackPlugin(options);
}
