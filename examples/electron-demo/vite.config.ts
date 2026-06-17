import { defineConfig } from 'vite';
import { harnessFE } from '@harness-fe/vite';

// electron-demo is a SOLO example (like vue-demo): the renderer's runtime
// connects to a loopback `harness` gateway with NO token, so the vite plugin
// auto-spawns/reuses a shared local gateway (Open policy) — zero config. We give
// it its own port (47952) so it never clashes with vue-demo's solo gateway.
//
// The whole point of this demo: an Electron BrowserWindow renderer IS a Chromium
// browser context, so the build plugin's HTML injection + the rrweb recorder in
// `@harness-fe/runtime` should work unchanged. This demo lets us prove that
// empirically (harness-fe#158 perf / #159 replay were reported against Electron).
//
// Electron's BrowserWindow loads the vite dev server over HTTP in dev
// (`http://127.0.0.1:47816`) — NOT file:// — which is what lets the plugin's
// transformIndexHtml inject `window.__HARNESS_FE__` + the runtime entry. A
// file:// renderer would bypass vite and get no injection.
export default defineConfig({
    plugins: [
        harnessFE({
            projectId: 'electron-demo',
            // Solo gateway (Open, loopback, no token) → plugin auto-spawns it.
            mcpUrl: 'ws://127.0.0.1:47952/ws',
            overlay: true,
        }),
    ],
    // Relative base so a production `vite build` can also be loaded via file://
    // by a packaged Electron app (injection only happens in dev, by design).
    base: './',
    server: {
        // Harness-FE demo port band (478xx). 47816 = electron-demo renderer.
        // Bind IPv4 127.0.0.1 (not the default localhost→::1) so it matches the
        // loopback gateway URL and the address Electron's loadURL uses — and so a
        // `tcp:127.0.0.1:47816` readiness probe actually sees the port.
        host: '127.0.0.1',
        port: 47816,
        strictPort: true,
    },
});
