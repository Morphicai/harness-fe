#!/usr/bin/env tsx
/**
 * CLI entry — boots WS bridge + stdio MCP server.
 *
 * Run with:  pnpm --filter @morphixai/harnessa-fe.mcp-server start
 *
 * Or configure as a Claude Code / Cursor MCP server (stdio mode).
 *
 * Leader / follower:
 *   - first process bound to the WS port = leader (in-process Bridge)
 *   - subsequent processes (EADDRINUSE) become followers that attach to
 *     the leader via the `mcp.call` control channel using `RemoteBridge`.
 *
 * This lets multiple Claude Code windows share a single dev-bridge daemon
 * (and thus the same browser / vite-plugin connections).
 */

import { DEFAULT_WS_PORT } from '@morphixai/harnessa-fe.protocol';
import { Bridge, type IBridge } from './bridge.js';
import { RemoteBridge } from './remoteBridge.js';
import { startMcpStdioServer } from './mcp.js';

async function main() {
    const port = Number(process.env.HARNESSA_FE_PORT ?? DEFAULT_WS_PORT);
    const host = process.env.HARNESSA_FE_HOST ?? '127.0.0.1';

    const { active, shutdown } = await startBridgeOrAttach(port, host);

    await startMcpStdioServer(active);
    process.stderr.write('[harnessa-fe] MCP stdio server connected\n');

    const onSignal = async () => {
        process.stderr.write('[harnessa-fe] shutting down\n');
        await shutdown();
        process.exit(0);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
}

async function startBridgeOrAttach(
    port: number,
    host: string,
): Promise<{ active: IBridge; shutdown: () => Promise<void> }> {
    const bridge = new Bridge({ port, host });
    try {
        await bridge.start();
        process.stderr.write(
            `[harnessa-fe] leader: WS bridge listening on ws://${host}:${port}\n`,
        );
        return {
            active: bridge,
            shutdown: () => bridge.stop(),
        };
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw err;
    }

    // Port already taken — attach as follower.
    const remote = new RemoteBridge({ port, host });
    await remote.connect();
    process.stderr.write(
        `[harnessa-fe] follower: attached to existing daemon at ws://${host}:${port}\n`,
    );
    return {
        active: remote,
        shutdown: () => remote.stop(),
    };
}

main().catch((err) => {
    process.stderr.write(`[harnessa-fe] fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
});
