/**
 * Phase B end-to-end: spin up an in-process Vite dev server with the plugin,
 * hit a transformed module, and verify:
 *   1. The plugin injected data-morphix-comp + data-morphix-loc into the JSX
 *   2. The component map was populated
 *   3. The bridge can route project.where_is to the vite-plugin peer and get
 *      the correct file:line back
 *
 * No real browser. The vite-plugin connects to the bridge as itself; we then
 * call project.where_is through the bridge and verify the response.
 */

import { createServer } from 'vite';
import { Bridge } from '@harness-fe/mcp-server';
import { harnessFE } from '@harness-fe/vite';
import { COMMAND } from '@harness-fe/protocol';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const v = probe();
        if (v) return v;
        await sleep(50);
    }
    throw new Error('waitFor: timed out');
}

async function run() {
    const bridge = new Bridge({ port: 0, host: '127.0.0.1' });
    await bridge.start();
    // @ts-expect-error access internal wss for port
    const port = bridge.wss.address().port as number;
    console.log(`[e2e] bridge on ws://127.0.0.1:${port}`);

    const vite = await createServer({
        root: projectRoot,
        configFile: false,
        plugins: [
            harnessFE({
                projectId: 'react-demo',
                mcpUrl: `ws://127.0.0.1:${port}`,
            }),
            (await import('@vitejs/plugin-react')).default(),
        ],
        server: { port: 0, middlewareMode: false },
        appType: 'spa',
        logLevel: 'warn',
    });
    await vite.listen();
    const vitePort = vite.config.server.port;
    console.log(`[e2e] vite dev on :${vitePort}`);

    // Wait until the vite-plugin peer registers with the bridge.
    await waitFor(() => bridge.router.findVitePlugin('react-demo'), 5000);
    console.log('[e2e] vite-plugin registered with bridge');

    // Force-resolve the App module so the transform runs.
    const appMod = await vite.transformRequest('/src/App.tsx');
    if (!appMod) throw new Error('transformRequest returned null');
    const code = appMod.code;
    // After plugin-react JSX compile, attributes appear as JSX runtime props,
    // e.g. `"data-morphix-comp": "App"`. Match the attribute name in any form.
    if (!/data-morphix-comp["\s:=]+["']?App/.test(code)) {
        throw new Error(`transform did not inject data-morphix-comp="App". Code excerpt:\n${code.slice(0, 600)}`);
    }
    if (!/data-morphix-loc["\s:=]+["']?src\/App\.tsx:\d+:\d+/.test(code)) {
        throw new Error('transform did not inject data-morphix-loc');
    }
    console.log('[e2e] transform injected attrs into App.tsx');

    // project.where_is via bridge
    const whereIs = (await bridge.sendCommand(
        COMMAND.PROJECT_WHERE_IS,
        { component: 'App' },
        { target: 'vite-plugin', projectId: 'react-demo' },
    )) as { component: string; locations: Array<{ file: string; line: number; col: number }> };
    if (whereIs.component !== 'App' || !whereIs.locations?.length) {
        throw new Error(`where_is returned unexpected: ${JSON.stringify(whereIs)}`);
    }
    console.log('[e2e] project.where_is App →', whereIs.locations[0]);

    // project.source via bridge
    const source = (await bridge.sendCommand(
        COMMAND.PROJECT_SOURCE,
        { component: 'App' },
        { target: 'vite-plugin', projectId: 'react-demo' },
    )) as { file: string; content: string };
    if (!source.content.includes('export function App')) {
        throw new Error('project.source did not return the expected App source');
    }
    console.log(`[e2e] project.source returned ${source.content.length} bytes from ${source.file}`);

    // project.module_graph
    const graph = (await bridge.sendCommand(
        COMMAND.PROJECT_MODULE_GRAPH,
        {},
        { target: 'vite-plugin', projectId: 'react-demo' },
    )) as { components: Record<string, unknown>; totalFiles: number };
    if (!('App' in graph.components)) {
        throw new Error(`module_graph missing App: ${JSON.stringify(graph)}`);
    }
    console.log(`[e2e] project.module_graph: ${Object.keys(graph.components).length} components`);

    console.log('[e2e] Phase B source-aware E2E ALL PASS ✓');
    // Force exit; the vite dev server + plugin's reconnect timer keep the loop
    // alive and esbuild emits a "build was canceled" message during close.
    process.exit(0);
}

run().catch((err) => {
    console.error('[e2e] FAIL', err);
    process.exit(1);
});
