import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';

// ── TEAM / REMOTE mode ──────────────────────────────────────────────────────
// react-demo is one of several apps that share a single "central" daemon (port
// 47900, token-secured). Its in-page runtime connects over WebSocket and reports
// as projectId="react-demo". Open the page in several browser windows (each a
// distinct visitor) to simulate multiple users reporting into one server.
//
// Agents never touch this daemon directly — they go through the governance
// gateway (port 47950), which enforces token scope (RBAC), tenant isolation,
// and audit. `pnpm demo` (scripts/demo.sh) boots the whole spectrum: this app
// plus the other team apps share the ONE daemon as distinct projects, while
// vue-demo stays solo on loopback. See README.md + examples/DEMO.md.
//
// Connection is baked into the config (not env) so `turbo run dev` can launch
// every demo uniformly without an env var leaking the team target into the solo
// app. The central daemon port (47900) is fixed; its token is the fixed demo
// token, overridable via HARNESS_TEAM_TOKEN. Disable injection with
// HARNESS_FE_RUNTIME=0.
const CENTRAL_DAEMON_URL = 'ws://127.0.0.1:47950/ws';
const CENTRAL_DAEMON_TOKEN = process.env.HARNESS_TEAM_TOKEN ?? 'team-secret-demo';
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
        // Harness-FE demo port band (478xx). 47811 = react-demo (team).
        // strictPort so the injected runtime URL + the URL `pnpm demo` prints
        // never drift to a fallback.
        port: 47811,
        strictPort: true,
    },
});
