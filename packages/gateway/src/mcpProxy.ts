/**
 * startMcpStdioProxy — a transport-level bridge: the agent talks MCP over our
 * **stdio**, and we forward every JSON-RPC frame, untouched, to a *shared*
 * gateway's HTTP `/mcp`.
 *
 * This is the "mcp end" of the shared-gateway model. The `.mcp.json` launcher
 * (`harness mcp`) first ensures one shared gateway is running, then runs this
 * proxy. It deliberately does NOT host its own core — that would fork the data.
 * Instead it reuses the same gateway the dev servers connect to, so the agent
 * sees every project in one place.
 *
 * It's a pure pipe: both transports expose `onmessage` / `send`, so we wire
 * each side's incoming frame to the other's `send`. Session id, SSE, and the
 * initialize handshake are handled inside StreamableHTTPClientTransport.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * Wire two transports into a transparent bidirectional pipe: every frame `a`
 * receives is sent to `b`, and vice-versa. Send failures are swallowed (the
 * far side may have hung up); lifecycle (close/error/exit) is the caller's job.
 */
export function pipeTransports(a: Transport, b: Transport): void {
    a.onmessage = (msg) => {
        void b.send(msg).catch((e) => {
            process.stderr.write(`[harness mcp] forward failed: ${(e as Error)?.message ?? e}\n`);
        });
    };
    b.onmessage = (msg) => {
        void a.send(msg).catch(() => {});
    };
}

export async function startMcpStdioProxy(gatewayMcpUrl: string): Promise<void> {
    const stdio = new StdioServerTransport();
    const http = new StreamableHTTPClientTransport(new URL(gatewayMcpUrl));

    pipeTransports(stdio, http);

    // If either side drops, tear the other down and exit (the agent will respawn us).
    const shutdown = (code: number) => {
        void http.close().catch(() => {});
        void stdio.close().catch(() => {});
        process.exit(code);
    };
    stdio.onclose = () => shutdown(0);
    http.onclose = () => shutdown(0);
    stdio.onerror = (e) => process.stderr.write(`[harness mcp] stdio: ${(e as Error)?.message ?? e}\n`);
    http.onerror = (e) => process.stderr.write(`[harness mcp] http: ${(e as Error)?.message ?? e}\n`);

    // Start the HTTP client first so it's ready to receive the agent's initialize.
    await http.start();
    await stdio.start();
}
