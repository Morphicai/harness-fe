import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessaFE } from '@harnessa-fe/vite';
import { resolve } from 'node:path';

/**
 * Child micro-frontend.
 *
 * - Listens on :5181 (parent will reverse-proxy it under /child/)
 * - Declares parentProjectId="iframe-parent" explicitly so the project tree
 *   gets built even before runtime inheritance kicks in.
 */
export default defineConfig({
    root: resolve(__dirname),
    plugins: [
        react(),
        harnessaFE({
            projectId: 'iframe-child',
            parentProjectId: 'iframe-parent',
            displayName: 'Child Widget',
        }),
    ],
    server: {
        port: 5181,
        strictPort: true,
        // CORS allow the parent origin since the proxy passes through.
        // (Same-origin in browser; only matters for direct dev-time access.)
        cors: true,
    },
});
