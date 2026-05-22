#!/usr/bin/env node
/**
 * CLI entry — boots WS bridge + MCP server (stdio or HTTP).
 *
 * Usage:
 *   npx @harnessa-fe/mcp-server                # 127.0.0.1, stdio MCP
 *   npx @harnessa-fe/mcp-server --host 0.0.0.0 --token auto
 *   npx @harnessa-fe/mcp-server --host 0.0.0.0 --token auto --mcp-transport http
 *
 * Leader / follower:
 *   - first process bound to the WS port = leader (in-process Bridge)
 *   - subsequent processes (EADDRINUSE) become followers that attach to
 *     the leader via the `mcp.call` control channel using `RemoteBridge`.
 *
 * This lets multiple Claude Code windows share a single dev-bridge daemon
 * (and thus the same browser / vite-plugin connections).
 */

import { randomBytes } from 'node:crypto';
import {
    DEFAULT_HOST,
    DEFAULT_WS_PORT,
    buildHttpUrl,
    isLoopbackHost,
    parseWsUrl,
} from '@harnessa-fe/protocol';
import { Bridge, type IBridge } from './bridge.js';
import { RemoteBridge } from './remoteBridge.js';
import { startMcpStdioServer } from './mcp.js';
import { startMcpHttpServer } from './mcpHttp.js';

type McpTransport = 'stdio' | 'http';

interface CliConfig {
    host: string;
    port: number;
    token: string | undefined;
    mcpTransport: McpTransport;
    mcpPath: string;
    publicHost: string | undefined;
}

function printHelpAndExit(): never {
    const help = `harnessa-fe — frontend harness MCP daemon

Usage:
  harnessa-fe [options]

Options:
  --host <addr>          Bind address. Default 127.0.0.1.
                         Use 0.0.0.0 to accept LAN connections (requires --token).
  --port <number>        TCP port. Default ${DEFAULT_WS_PORT}.
  --token <value|auto>   Token required for HTTP/WS auth. Pass "auto" to generate one.
                         Required when --host is not loopback.
  --mcp-transport <kind> stdio (default) or http. http mounts /mcp on the bridge.
  --mcp-path <path>      URL path for the MCP HTTP endpoint. Default /mcp.
  --public-host <addr>   Override the host printed in outbound URLs. Useful when
                         binding 0.0.0.0 and the auto-detected LAN IP is wrong.
  -h, --help             Show this help.

Environment:
  HARNESSA_FE_HOST           Same as --host
  HARNESSA_FE_TOKEN          Same as --token (use "auto" to generate)
  HARNESSA_FE_MCP_TRANSPORT  Same as --mcp-transport
  HARNESSA_FE_MCP_PATH       Same as --mcp-path
  HARNESSA_FE_URL            Full ws:// URL (legacy; --host/--port override it)
`;
    process.stderr.write(help);
    process.exit(0);
}

function parseArgs(argv: string[]): CliConfig {
    const args = argv.slice(2);

    let host: string | undefined;
    let port: number | undefined;
    let token: string | undefined;
    let mcpTransport: McpTransport | undefined;
    let mcpPath: string | undefined;
    let publicHost: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => {
            const v = args[++i];
            if (v == null) {
                process.stderr.write(`harnessa-fe: missing value for ${a}\n`);
                process.exit(2);
            }
            return v;
        };
        switch (a) {
            case '-h':
            case '--help':
                printHelpAndExit();
                break;
            case '--host':
                host = next();
                break;
            case '--port':
                port = Number(next());
                if (!Number.isFinite(port) || port <= 0) {
                    process.stderr.write(`harnessa-fe: invalid --port\n`);
                    process.exit(2);
                }
                break;
            case '--token':
                token = next();
                break;
            case '--mcp-transport': {
                const v = next();
                if (v !== 'stdio' && v !== 'http') {
                    process.stderr.write(`harnessa-fe: invalid --mcp-transport (stdio|http)\n`);
                    process.exit(2);
                }
                mcpTransport = v;
                break;
            }
            case '--mcp-path':
                mcpPath = next();
                break;
            case '--public-host':
                publicHost = next();
                break;
            default:
                process.stderr.write(`harnessa-fe: unknown argument ${a}\n`);
                process.exit(2);
        }
    }

    // Apply env fallbacks, then URL fallback for host/port.
    const envUrl = process.env.HARNESSA_FE_URL;
    let envHost: string | undefined;
    let envPort: number | undefined;
    if (envUrl) {
        try {
            const parsed = parseWsUrl(envUrl);
            envHost = parsed.host;
            envPort = parsed.port;
        } catch {
            // ignore — fall back to defaults below
        }
    }

    const finalHost = host ?? process.env.HARNESSA_FE_HOST ?? envHost ?? DEFAULT_HOST;
    const finalPort = port ?? envPort ?? DEFAULT_WS_PORT;

    let finalToken = token ?? process.env.HARNESSA_FE_TOKEN;
    if (finalToken === 'auto') {
        finalToken = randomBytes(24).toString('base64url');
    }
    if (finalToken === '') finalToken = undefined;

    const finalTransport: McpTransport =
        (mcpTransport ?? (process.env.HARNESSA_FE_MCP_TRANSPORT as McpTransport | undefined)) ??
        'stdio';
    if (finalTransport !== 'stdio' && finalTransport !== 'http') {
        process.stderr.write(`harnessa-fe: invalid mcp transport "${finalTransport}"\n`);
        process.exit(2);
    }
    const finalMcpPath = mcpPath ?? process.env.HARNESSA_FE_MCP_PATH ?? '/mcp';

    return {
        host: finalHost,
        port: finalPort,
        token: finalToken,
        mcpTransport: finalTransport,
        mcpPath: finalMcpPath,
        publicHost,
    };
}

function validate(_cfg: CliConfig): void {
    // Token requirement is left entirely to the operator. We don't refuse
    // a non-loopback bind without a token — that's their call, not ours.
    // Warnings are emitted from the banner so the operator sees them; CI /
    // automation that pipes stderr can suppress as needed.
}

function printBanner(cfg: CliConfig, role: 'leader' | 'follower', viewerUrl: string | undefined): void {
    const lines: string[] = [];
    lines.push(`[harnessa-fe] ${role}: WS bridge listening on ws://${cfg.host}:${cfg.port}`);
    const isLan = !isLoopbackHost(cfg.host);
    if (isLan) {
        lines.push(`[harnessa-fe] WARNING: bound to non-loopback host ${cfg.host}.`);
        if (cfg.token) {
            lines.push(`[harnessa-fe]   anyone reaching this host:port with the token can read console / network / recordings.`);
        } else {
            lines.push(`[harnessa-fe]   no token set — anyone on this network can read console / network / recordings.`);
            lines.push(`[harnessa-fe]   add --token auto (or HARNESSA_FE_TOKEN=…) to enable auth.`);
        }
    }
    // Always print the dashboard URL. The token (when present) is folded
    // into the query so the first hit hands it off to a cookie; without a
    // token, auth is disabled and the URL works on its own.
    const host = cfg.publicHost ?? viewerHost(viewerUrl) ?? cfg.host;
    const dashboard = buildHttpUrl({ host, port: cfg.port, token: cfg.token });
    lines.push(`[harnessa-fe] dashboard: ${dashboard}`);
    if (cfg.mcpTransport === 'http') {
        const mcp = buildHttpUrl({ host, port: cfg.port, token: cfg.token, path: cfg.mcpPath });
        lines.push(`[harnessa-fe] mcp http:  ${mcp}`);
        if (cfg.token) {
            const mcpNoTok = buildHttpUrl({ host, port: cfg.port, path: cfg.mcpPath });
            lines.push(
                `[harnessa-fe]   agent config: { "url": "${mcpNoTok}", "headers": { "Authorization": "Bearer ${cfg.token}" } }`,
            );
        } else {
            lines.push(`[harnessa-fe]   agent config: { "url": "${mcp}" }   (no auth — token unset)`);
        }
    }
    if (cfg.token) {
        lines.push(`[harnessa-fe] token:     ${cfg.token}`);
    }
    process.stderr.write(lines.join('\n') + '\n');
}

function viewerHost(viewerUrl: string | undefined): string | undefined {
    if (!viewerUrl) return undefined;
    try {
        return new URL(viewerUrl).hostname;
    } catch {
        return undefined;
    }
}

async function main() {
    const cfg = parseArgs(process.argv);
    validate(cfg);

    const { active, shutdown, role } = await startBridgeOrAttach(cfg);
    printBanner(cfg, role, active.getViewerBaseUrl());

    let mcpShutdown: (() => Promise<void>) | undefined;
    if (cfg.mcpTransport === 'stdio') {
        await startMcpStdioServer(active);
        process.stderr.write('[harnessa-fe] MCP stdio server connected\n');
    } else {
        if (role === 'follower') {
            process.stderr.write(
                '[harnessa-fe] --mcp-transport=http is only supported on the leader. ' +
                    'Another daemon already holds the port; stop it first.\n',
            );
            await shutdown();
            process.exit(2);
        }
        const handle = await startMcpHttpServer(active, { path: cfg.mcpPath });
        process.stderr.write(`[harnessa-fe] MCP http server mounted at ${handle.path}\n`);
        mcpShutdown = () => handle.close();
    }

    const onSignal = async () => {
        process.stderr.write('[harnessa-fe] shutting down\n');
        if (mcpShutdown) {
            try { await mcpShutdown(); } catch { /* swallow */ }
        }
        await shutdown();
        process.exit(0);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
}

async function startBridgeOrAttach(
    cfg: CliConfig,
): Promise<{ active: IBridge; shutdown: () => Promise<void>; role: 'leader' | 'follower' }> {
    const bridge = new Bridge({
        port: cfg.port,
        host: cfg.host,
        auth: cfg.token ? { token: cfg.token } : undefined,
        publicHost: cfg.publicHost,
    });
    try {
        await bridge.start();
        return {
            active: bridge,
            shutdown: () => bridge.stop(),
            role: 'leader',
        };
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw err;
    }

    // Port already taken — attach as follower.
    const remote = new RemoteBridge({ port: cfg.port, host: cfg.host, token: cfg.token });
    await remote.connect();
    return {
        active: remote,
        shutdown: () => remote.stop(),
        role: 'follower',
    };
}

main().catch((err) => {
    process.stderr.write(`[harnessa-fe] fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
});
