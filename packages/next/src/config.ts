/**
 * @harnessa-fe/next/config — withHarnessa Next.js config wrapper.
 *
 * Wraps your next.config.mjs to:
 *   1. Inject `import '@harnessa-fe/node-runtime/auto'` into the Node.js
 *      server bundle entry point (so the daemon receives server-side events
 *      without any changes to application code).
 *   2. Expose project metadata to the auto entry via environment variables
 *      set at webpack resolve time.
 *
 * Usage:
 *   // next.config.mjs
 *   import { withHarnessa } from '@harnessa-fe/next/config';
 *   export default withHarnessa({
 *     // your normal next config
 *   }, {
 *     projectId: 'my-app',
 *     buildId: process.env.VERCEL_GIT_COMMIT_SHA,
 *   });
 *
 * Only active when NODE_ENV === 'development'. In production the wrapper
 * returns nextConfig unchanged.
 */

export interface WithHarnessaOptions {
    /** Stable project id. Used by the node-runtime SDK to tag events. */
    projectId: string;
    /** Human-readable display name. Defaults to projectId. */
    displayName?: string;
    /**
     * Build artifact id (e.g. git SHA). Injected via HARNESSA_FE_BUILD_ID env.
     * Defaults to NEXT_PUBLIC_GIT_SHA if not provided.
     */
    buildId?: string;
    /** Override the daemon WebSocket URL. Defaults to ws://127.0.0.1:47729. */
    mcpUrl?: string;
}

/**
 * A minimal webpack plugin that prepends a side-effect import to the
 * server-side bundle entry. We use an EntryPlugin approach compatible with
 * webpack 5 (which Next.js uses).
 */
class HarnessaNodeRuntimePlugin {
    private readonly projectId: string;
    private readonly displayName: string;
    private readonly buildId?: string;
    private readonly mcpUrl?: string;

    constructor(opts: WithHarnessaOptions) {
        this.projectId = opts.projectId;
        this.displayName = opts.displayName ?? opts.projectId;
        this.buildId = opts.buildId;
        this.mcpUrl = opts.mcpUrl;
    }

    apply(compiler: {
        hooks: {
            environment: { tap: (id: string, fn: () => void) => void };
        };
        options: {
            entry?: unknown;
            plugins?: unknown[];
            resolve?: { alias?: Record<string, unknown> };
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
    }): void {
        const autoEntry = '@harnessa-fe/node-runtime/auto';

        // Inject HARNESSA_FE_* env vars so the auto entry can read them.
        compiler.hooks.environment.tap('HarnessaNodeRuntimePlugin', () => {
            process.env.HARNESSA_FE_PROJECT_ID = this.projectId;
            process.env.HARNESSA_FE_DISPLAY_NAME = this.displayName;
            if (this.buildId) process.env.HARNESSA_FE_BUILD_ID = this.buildId;
            if (this.mcpUrl) process.env.HARNESSA_FE_MCP_URL = this.mcpUrl;
        });

        // Add the auto-import as an additional entry for the server bundle.
        // We use `webpack.EntryPlugin` to prepend it to the server entry.
        const webpack = require('webpack') as {
            EntryPlugin: new (
                context: string,
                entry: string,
                opts?: { name?: string },
            ) => { apply: (compiler: unknown) => void };
        };
        new webpack.EntryPlugin(
            compiler.context as string || process.cwd(),
            autoEntry,
            { name: undefined }, // add to default entry
        ).apply(compiler);
    }
}

/**
 * Wraps a Next.js config to inject the Harnessa node-runtime SDK into the
 * server bundle. Only active in development mode.
 */
export function withHarnessa(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nextConfig: Record<string, any> = {},
    opts: WithHarnessaOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
    if (process.env.NODE_ENV !== 'development') {
        return nextConfig;
    }

    return {
        ...nextConfig,
        webpack(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config: Record<string, any>,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            webpackContext: Record<string, any>,
        ) {
            // Next.js calls webpack() for both client and server builds.
            // We only inject into the server (Node.js) build.
            const isServer: boolean = webpackContext.isServer ?? webpackContext.nextRuntime === 'nodejs';
            if (isServer) {
                config.plugins = config.plugins ?? [];
                config.plugins.push(new HarnessaNodeRuntimePlugin(opts));
            }

            // Preserve user's existing webpack config.
            if (typeof nextConfig.webpack === 'function') {
                return nextConfig.webpack(config, webpackContext) as unknown;
            }
            return config;
        },
    };
}
