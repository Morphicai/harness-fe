import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';
import { resolve } from 'node:path';

/**
 * Parent micro-frontend host.
 *
 * - Serves the parent app on http://localhost:5180/
 * - Reverse-proxies /child/* to the child vite dev server on :5181,
 *   so the iframe loads under the parent's origin (same-origin).
 * - The harness-fe plugin reports projectId="iframe-parent".
 */
export default defineConfig({
    root: resolve(__dirname),
    plugins: [
        react(),
        harnessFE({
            projectId: 'iframe-parent',
            displayName: 'Parent Shell',
        }),
    ],
    server: {
        port: 5180,
        strictPort: true,
        // Same-origin trick: serve the child app under /child/ via proxy.
        // The browser sees window.location.origin === parent's origin, so the
        // child iframe's runtime can read window.parent.* without SecurityError.
        proxy: {
            '/child': {
                target: 'http://localhost:5181',
                changeOrigin: false,
                rewrite: (path) => path.replace(/^\/child/, ''),
                ws: true,
            },
        },
    },
});
