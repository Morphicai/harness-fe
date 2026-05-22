/**
 * Minimal embedding example: a host Express app runs alongside an
 * in-process harness-fe daemon. They share a process, signal handlers,
 * and (in a real app) a logger / store / auth layer.
 *
 * The example assumes you ran `pnpm build` in the package root so
 * `dist/` is populated. In a real consuming app you'd import from
 * `@harness-fe/mcp-server`.
 */

import http from 'node:http';
import { createDaemon } from '../../dist/daemon.js';

// ───────── Host Express-ish app (no Express dependency for the example) ───
const hostServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, host: 'embed-express' }));
        return;
    }
    res.statusCode = 404;
    res.end('host route not found');
});

await new Promise((resolve) => hostServer.listen(3000, '127.0.0.1', resolve));
console.log('[host] listening on http://127.0.0.1:3000');

// ───────── Embedded harness-fe daemon ───────────────────────────────────
const HOST_TOKEN = 'let-me-in';

const daemon = createDaemon({
    port: 47729,
    host: '127.0.0.1',
    label: 'embed-express',
    // Replace the built-in token check with whatever the host already
    // uses. Sync because the WS upgrade is sync; for async needs, cache
    // your auth decision in a cookie set by host middleware.
    authorize: (req) => {
        const auth = req.headers.authorization ?? '';
        return auth === `Bearer ${HOST_TOKEN}`;
    },
});

await daemon.start();
console.log(`[daemon] listening on :${daemon.getBoundPort()}${daemon.mcpPath}`);
console.log(`[daemon] dashboard: ${daemon.getViewerBaseUrl()}`);
console.log(`[daemon] mcp bearer token: ${HOST_TOKEN}`);

// ───────── Shared lifecycle ───────────────────────────────────────────────
async function shutdown() {
    console.log('\n[shutdown] stopping both servers');
    await daemon.stop();
    await new Promise((resolve) => hostServer.close(() => resolve()));
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
