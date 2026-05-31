import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';
import { resolve } from 'node:path';

/**
 * Child micro-frontend.
 *
 * - Listens on :47815 (parent will reverse-proxy it under /child/)
 * - Declares parentProjectId="iframe-parent" explicitly so the project tree
 *   gets built even before runtime inheritance kicks in.
 * - TEAM mode: reports into the ONE shared central daemon (port 47900);
 *   connection is in-config so `turbo run dev` launches every demo uniformly.
 */
export default defineConfig({
    root: resolve(__dirname),
    plugins: [
        react(),
        harnessFE({
            projectId: 'iframe-child',
            parentProjectId: 'iframe-parent',
            displayName: 'Child Widget',
            mcpUrl: 'ws://127.0.0.1:47950/ws',
            token: process.env.HARNESS_TEAM_TOKEN ?? 'team-secret-demo',
        }),
    ],
    server: {
        // Harness-FE demo port band (478xx). 47815 = iframe child (team).
        port: 47815,
        strictPort: true,
        // CORS allow the parent origin since the proxy passes through.
        // (Same-origin in browser; only matters for direct dev-time access.)
        cors: true,
    },
});
