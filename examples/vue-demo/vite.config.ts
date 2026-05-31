import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { harnessFE } from '@harness-fe/vite';

// In the bundled `pnpm demo`, every app (vue-demo included) reports into the one
// governed gateway as a distinct project: the runtime connects to the gateway's
// /ws with the write-scope token (HARNESS_TEAM_TOKEN, injected by scripts/demo.sh).
// The zero-config SOLO path — `harness` over stdio with its own loopback /ws — is
// shown separately by the `harness-solo` entry in .mcp.json; for that mode you'd
// drop the mcpUrl/token below and let the runtime default to the loopback gateway.
export default defineConfig({
    plugins: [
        harnessFE({
            projectId: 'vue-demo',
            mcpUrl: 'ws://127.0.0.1:47950/ws',
            token: process.env.HARNESS_TEAM_TOKEN,
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
