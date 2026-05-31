import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { harnessFE } from '@harness-fe/vite';

// In the bundled `pnpm demo`, vue-demo is the SOLO example: its runtime connects to
// a standalone `harness` (Open policy — no token, no RBAC, no audit; a single
// trusted `local` principal) that scripts/demo.sh runs on :47951. The other four
// apps report into the governed gateway (:47950) with a scoped write token. This is
// the zero-config end of the spectrum; the governed end is the react/webpack/iframe apps.
export default defineConfig({
    plugins: [
        harnessFE({
            projectId: 'vue-demo',
            // Solo gateway (Open) — no token needed. scripts/demo.sh runs it on 47951.
            mcpUrl: 'ws://127.0.0.1:47951/ws',
        }),
        vue(),
    ],
    server: {
        // Harness-FE demo port band (478xx, deliberately off the beaten path so
        // it never clashes with the usual 5173/3000/8080 dev servers). 47810 =
        // vue-demo (solo). strictPort so the advertised URL never drifts.
        port: 47810,
        strictPort: true,
    },
});
