import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { harnessFE } from '@harness-fe/vite';

// ── SOLO mode ───────────────────────────────────────────────────────────────
// vue-demo is the zero-config counterpart to react-demo's team setup. No mcpUrl,
// no token: the runtime connects to a loopback daemon on the default port
// (47729), fully trusted (single principal). The agent talks to it over stdio
// (see .mcp.json.example) — no gateway, no RBAC, no audit. This is the friction-
// free local-dev path; react-demo shows the governed multi-user path.
export default defineConfig({
    plugins: [harnessFE({ projectId: 'vue-demo' }), vue()],
    server: {
        // Harness-FE demo port band (478xx, deliberately off the beaten path so
        // it never clashes with the usual 5173/3000/8080 dev servers). 47810 =
        // vue-demo (solo). strictPort so the advertised URL never drifts.
        port: 47810,
        strictPort: true,
    },
});
