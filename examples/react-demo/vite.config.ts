import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';

// ── TEAM / REMOTE mode ──────────────────────────────────────────────────────
// react-demo simulates a *multi-user* deployment. Its in-page runtime connects
// over WebSocket to a single shared "central" daemon (port 47900) secured with
// a token. Open the page in several browser windows (each a distinct visitor)
// to simulate multiple users reporting into one server.
//
// Agents never touch this daemon directly — they go through the governance
// gateway (port 47950), which enforces token scope (RBAC), tenant isolation,
// and audit. See README.md + scripts/demo-multiuser.sh for the full topology.
//
// Override the target with HARNESS_FE_URL / HARNESS_FE_TOKEN; disable injection
// entirely with HARNESS_FE_RUNTIME=0.
const CENTRAL_DAEMON_URL = process.env.HARNESS_FE_URL ?? 'ws://127.0.0.1:47900';
const CENTRAL_DAEMON_TOKEN = process.env.HARNESS_FE_TOKEN ?? 'team-secret-demo';
const enableHarness = process.env.HARNESS_FE_RUNTIME !== '0';

export default defineConfig({
    plugins: [
        ...(enableHarness
            ? [
                  harnessFE({
                      projectId: 'react-demo',
                      mcpUrl: CENTRAL_DAEMON_URL,
                      token: CENTRAL_DAEMON_TOKEN,
                  }),
              ]
            : []),
        react(),
    ],
    server: {
        // react-demo (team mode) owns 5173; solo vue-demo uses 5174. Distinct
        // ports so both demos can run side by side without collision.
        port: 5173,
    },
});
