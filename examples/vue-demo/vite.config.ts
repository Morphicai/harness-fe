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
        // solo vue-demo owns 5174; team react-demo uses 5173. Distinct ports.
        port: 5174,
    },
});
