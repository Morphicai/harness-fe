import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = '/workspace/task';
const require = createRequire(join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const plugins = [react()];
if (process.env.CONDITION === 'harness-fe') {
    const { harnessFE } = await import(pathToFileURL(require.resolve('@harness-fe/vite')).href);
    plugins.push(harnessFE({ projectId: 'webbench-' + process.env.PROJECT, mcpUrl: 'ws://127.0.0.1:47729/ws',
        overlay: false, consent: 'off' }));
}
const fullstack = process.env.PROJECT === 'fastify-react';
const server = await createServer({ configFile: false, root: join(root, 'src', ...(fullstack ? ['client'] : [])),
    plugins, server: { host: '127.0.0.1', port: 3211, strictPort: true,
        ...(fullstack ? { proxy: { '/api': 'http://127.0.0.1:3212' } } : {}) } });
await server.listen();
process.on('SIGTERM', async () => { await server.close(); process.exit(0); });
