/**
 * @harness-fe/next/config — withHarness Next.js config wrapper.
 *
 * Wraps your next.config.mjs to:
 *   1. Inject `import '@harness-fe/node-runtime/auto'` into the Node.js
 *      server bundle entry point (so the daemon receives server-side events
 *      without any changes to application code).
 *   2. Expose project metadata to the auto entry via environment variables
 *      set at webpack resolve time.
 *
 * Usage:
 *   // next.config.mjs
 *   import { withHarness } from '@harness-fe/next/config';
 *   export default withHarness({
 *     // your normal next config
 *   }, {
 *     projectId: 'my-app',
 *     buildId: process.env.VERCEL_GIT_COMMIT_SHA,
 *   });
 *
 * Whether to activate is the caller's responsibility — this wrapper does not
 * check NODE_ENV. Wrap the call in a condition in your next.config.mjs if you
 * only want it in development.
 */

import { createRequire } from 'node:module';

// webpack is a transitive dep via Next.js — not listed directly. Use createRequire
// so this ESM file can load it as CJS without adding webpack as a peer dependency.
const _require = createRequire(import.meta.url);

export interface WithHarnessOptions {
    /** Stable project id. Used by the node-runtime SDK to tag events. */
    projectId: string;
    /** Human-readable display name. Defaults to projectId. */
    displayName?: string;
    /**
     * Build artifact id (e.g. git SHA). Injected via HARNESS_FE_BUILD_ID env.
     * Defaults to NEXT_PUBLIC_GIT_SHA if not provided.
     */
    buildId?: string;
    /** Override the daemon WebSocket URL. Defaults to ws://127.0.0.1:47729. */
    mcpUrl?: string;
    /**
     * Write-scope token for a governed (team) gateway. Sets HARNESS_FE_TOKEN so
     * the server node-runtime's auto entry appends it to mcpUrl as `?token=`.
     */
    token?: string;
}

/**
 * A minimal webpack plugin that prepends a side-effect import to the
 * server-side bundle entry. We use an EntryPlugin approach compatible with
 * webpack 5 (which Next.js uses).
 */
class HarnessNodeRuntimePlugin {
    private readonly projectId: string;
    private readonly displayName: string;
    private readonly buildId?: string;
    private readonly mcpUrl?: string;
    private readonly token?: string;

    constructor(opts: WithHarnessOptions) {
        this.projectId = opts.projectId;
        this.displayName = opts.displayName ?? opts.projectId;
        this.buildId = opts.buildId;
        this.mcpUrl = opts.mcpUrl;
        this.token = opts.token;
    }

    apply(compiler: {
        hooks: {
            environment: { tap: (id: string, fn: () => void) => void };
        };
        options: {
            entry?: unknown;
            plugins?: unknown[];
            resolve?: { alias?: Record<string, unknown> };
            name?: string;
            target?: string | string[];
        };
        context?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
    }): void {
        // Detect edge runtime bundle — webpack target is 'webworker' for edge,
        // or the compilation name contains 'edge' (Next.js heuristic).
        const target = compiler.options?.target;
        const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
        const compName = compiler.options?.name ?? '';
        const isEdge =
            targetStr.includes('webworker') ||
            compName.toLowerCase().includes('edge');

        const autoEntry = isEdge
            ? '@harness-fe/node-runtime/auto-edge'
            : '@harness-fe/node-runtime/auto';

        // Inject HARNESS_FE_* env vars so the auto entry can read them.
        compiler.hooks.environment.tap('HarnessNodeRuntimePlugin', () => {
            process.env.HARNESS_FE_PROJECT_ID = this.projectId;
            process.env.HARNESS_FE_DISPLAY_NAME = this.displayName;
            if (this.buildId) process.env.HARNESS_FE_BUILD_ID = this.buildId;
            if (this.mcpUrl) process.env.HARNESS_FE_MCP_URL = this.mcpUrl;
            if (this.token) process.env.HARNESS_FE_TOKEN = this.token;
        });

        // Add the auto-import as an additional entry for the server bundle.
        // We use `webpack.EntryPlugin` to prepend it to the server entry.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { EntryPlugin } = _require('webpack') as {
            EntryPlugin: new (
                context: string,
                entry: string,
                opts?: { name?: string },
            ) => { apply: (compiler: unknown) => void };
        };
        new EntryPlugin(
            (compiler.context as string) || process.cwd(),
            autoEntry,
            { name: undefined }, // add to default entry
        ).apply(compiler);
    }
}

/**
 * Wraps a Next.js config to inject the Harness node-runtime SDK into the
 * server bundle. Only active in development mode.
 */
export function withHarness(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nextConfig: Record<string, any> = {},
    opts: WithHarnessOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
    return {
        ...nextConfig,
        webpack(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config: Record<string, any>,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            webpackContext: Record<string, any>,
        ) {
            // Next.js calls webpack() for both client and server builds.
            // Inject into both Node.js server builds AND edge runtime builds.
            // The plugin itself detects which autoEntry to use based on compiler.options.target.
            const nextRuntime: string = webpackContext.nextRuntime ?? '';
            const isServer: boolean =
                (webpackContext.isServer ?? false) ||
                nextRuntime === 'nodejs' ||
                nextRuntime === 'edge';
            if (isServer) {
                config.plugins = config.plugins ?? [];
                config.plugins.push(new HarnessNodeRuntimePlugin(opts));
            }

            // Preserve user's existing webpack config.
            if (typeof nextConfig.webpack === 'function') {
                return nextConfig.webpack(config, webpackContext) as unknown;
            }
            return config;
        },
    };
}
