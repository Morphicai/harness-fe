import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';
import { resolve } from 'node:path';

/**
 * Parent micro-frontend host.
 *
 * - Serves the parent app on http://localhost:47814/
 * - Reverse-proxies /child/* to the child vite dev server on :47815,
 *   so the iframe loads under the parent's origin (same-origin).
 * - The harness-fe plugin reports projectId="iframe-parent" into the ONE shared
 *   central daemon (TEAM mode). Connection is in-config so `turbo run dev`
 *   launches every demo uniformly.
 */
export default defineConfig({
    root: resolve(__dirname),
    plugins: [
        react(),
        harnessFE({
            projectId: 'iframe-parent',
            displayName: 'Parent Shell',
            mcpUrl: 'ws://127.0.0.1:47950/ws',
            token: process.env.HARNESS_TEAM_TOKEN,
        }),
    ],
    server: {
        // Harness-FE demo port band (478xx). 47814 = iframe parent (team).
        port: 47814,
        strictPort: true,
        // Same-origin trick: serve the child app under /child/ via proxy.
        // The browser sees window.location.origin === parent's origin, so the
        // child iframe's runtime can read window.parent.* without SecurityError.
        proxy: {
            '/child': {
                target: 'http://localhost:47815',
                changeOrigin: false,
                rewrite: (path) => path.replace(/^\/child/, ''),
                ws: true,
            },
        },
    },
});
