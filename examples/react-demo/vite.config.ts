import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';

// Toggle the harness-fe runtime injection via env. Useful for isolating whether
// the runtime-client's WS reconnect loop is freezing the page when no daemon
// is listening.
const enableHarness = process.env.HARNESS_FE_RUNTIME !== '0';

// Optionally override the daemon URL so the runtime connects to the daemon
// this Claude Code instance can see (instead of the project default 47729).
const daemonUrl = process.env.HARNESS_FE_URL;

export default defineConfig({
    plugins: [
        ...(enableHarness
            ? [harnessFE({ projectId: 'react-demo', ...(daemonUrl ? { mcpUrl: daemonUrl } : {}) })]
            : []),
        react(),
    ],
    server: {
        port: 5173,
    },
});
