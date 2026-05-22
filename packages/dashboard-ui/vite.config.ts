import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dashboard is served by @harness-fe/mcp-server at `/dashboard/`.
 * All asset URLs need to resolve under that prefix; `base` handles that.
 *
 * Dev server picks a different port from examples/react-demo (5173) and
 * examples/webpack-demo (3000-ish) so we can run them side-by-side.
 *
 * Self-debug mode: when `HARNESS_FE_SELF_DEBUG=1` is set during `vite dev`,
 * we inject our own runtime + source-aware transform plugin so an agent can
 * drive the dashboard itself for development work (the in-page FAB will
 * appear, sessions get recorded). To keep recursion / data sane, we point
 * the runtime at a **separate dev port** (47730) so the self-debug daemon
 * never collides with whatever user-project daemon is on the default 47729.
 *
 * Self-debug is **never** enabled for production builds — the published
 * dashboard tarball that mcp-server ships is plain React with no harness
 * dependency. The branch below short-circuits on `command === 'build'`.
 */
export default defineConfig(({ command }) => {
    const selfDebug = command === 'serve' && process.env.HARNESS_FE_SELF_DEBUG === '1';

    return {
        base: '/dashboard/',
        plugins: [
            react(),
            ...(selfDebug ? [loadSelfDebugPlugin()] : []),
        ],
        server: {
            port: 5174,
            strictPort: false,
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            rollupOptions: {
                output: {
                    manualChunks: {
                        react: ['react', 'react-dom'],
                        router: ['react-router-dom'],
                    },
                },
            },
        },
    };
});

function loadSelfDebugPlugin(): PluginOption {
    // Lazy-require so the import doesn't run when self-debug is off — keeps
    // production install of dashboard-ui from pulling the harness into the
    // build graph at all.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { harnessFE } = require('@harness-fe/vite') as {
        harnessFE: (opts: Record<string, unknown>) => PluginOption;
    };
    const mcpUrl = process.env.HARNESS_FE_SELF_DEBUG_URL ?? 'ws://127.0.0.1:47730';
    return harnessFE({
        projectId: '@harness-fe/dashboard',
        displayName: 'Harness Dashboard (self-debug)',
        mcpUrl,
    });
}
