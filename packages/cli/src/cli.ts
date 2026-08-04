#!/usr/bin/env node
/**
 * `harness` — the one CLI. Launches the gateway with an in-process core.
 *
 * Solo (default, zero-config):
 *   harness
 *   → Open policy. Core + a loopback gateway (serving /ws for the browser
 *     runtime and /console for the back office), plus an MCP server over
 *     **stdio** for the agent that spawned this process (Claude Code / Cursor).
 *     No tokens, no audit. This is what an `mcp.json` points `command` at.
 *
 * Serve (shared, headless):
 *   harness serve
 *   → Open policy, same as solo BUT no stdio — a long-lived HTTP gateway
 *     (/ws + /console + /mcp) meant to be auto-spawned (detached) and SHARED by
 *     many projects + the human's console + agents. This is what the build
 *     plugin and the mcp launcher start when no gateway is already running.
 *
 * Team (--governed):
 *   harness --governed --admin-user admin --admin-pass secret \
 *     --issue-token name=runtime,scopes=write \
 *     --issue-token name=agentA,scopes=read+control,projects=app
 *   → Governed policy over HTTP: /mcp (agents, RBAC + audit), /ws (write tokens),
 *     /console + /admin. No stdio — agents connect to /mcp.
 *
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_WS_PORT } from '@harness-fe/protocol';
import { createCoreClient } from '@harness-fe/core';
import { startMcpStdioServer, startMcpStdioProxy } from '@harness-fe/gateway';
import { createGateway, GatewayStore, Policy, type Scope } from '@harness-fe/gateway';
import { ensureSharedGateway } from './sharedGateway.js';

interface TokenSpec {
    name: string;
    scopes: Scope[];
    projects?: string[];
}

interface CliConfig {
    governed: boolean;
    serve: boolean;
    mcpProxy: boolean;
    host: string;
    port: number;
    coreDataDir: string;
    gatewayDataDir: string;
    consoleDir: string | undefined;
    experimentalEnvVar: string | undefined;
    adminUser: string | undefined;
    adminPass: string | undefined;
    issueTokens: TokenSpec[];
    maxStorageBytes: number | undefined;
    maxAgeDays: number | undefined;
    maxSessions: number | undefined;
    recordingRetentionDays: number | undefined;
    maxRecordingBytesPerSession: number | undefined;
    purgeIntervalMs: number | undefined;
}

const VALID_SCOPES: Scope[] = ['control', 'read', 'write'];

function defaultCoreDataDir(): string {
    return join(homedir(), '.harness-fe', 'core');
}
function defaultGatewayDataDir(): string {
    return join(homedir(), '.harness-fe', 'gateway');
}
/**
 * Locate the bundled console-ui dist so a zero-config `harness` / `harness serve`
 * serves the REAL console (not the placeholder). Mirrors how the gateway finds
 * rrweb-player (gateway/replayViewer.ts). Returns undefined if console-ui isn't
 * installed (e.g. trimmed install) — gateway then falls back to the placeholder.
 */
function defaultConsoleDir(): string | undefined {
    try {
        const require = createRequire(import.meta.url);
        return join(dirname(require.resolve('@harness-fe/console-ui/package.json')), 'dist');
    } catch {
        return undefined;
    }
}

function printHelpAndExit(): never {
    process.stderr.write(`harness — gateway + in-process core

Usage:
  harness                       Solo: stdio MCP + loopback /ws + /console (zero config).
  harness serve                 Shared headless gateway: /ws + /console + /mcp, no stdio.
  harness mcp                   stdio MCP that reuses (or spawns) the shared gateway and
                                proxies to its /mcp. Point an mcp.json "command" here.
  harness --governed [opts]     Team: tokens + RBAC + audit over HTTP.

Options:
  --governed             Governed policy (team). Default is Open (solo).
  --port <n>             HTTP port. Default ${DEFAULT_WS_PORT}.
  --host <addr>          Bind address. Default 127.0.0.1.
  --core-data-dir <dir>  Core store (sessions/events). Default ~/.harness-fe/core.
  --data-dir <dir>       Gateway store (tokens/admins/audit). Default ~/.harness-fe/gateway.
  --console-dir <dir>    Built console-ui dist to serve at /console.
  --experimental-env-var <name>  Gate experimental tools behind this env var.
  --admin-user <u> --admin-pass <p>   Bootstrap admin (governed).
  --issue-token <spec>   Issue a token, printed once (governed). Repeatable.
                         spec: name=agentA,scopes=read+control[,projects=app+other]
  -h, --help
`);
    process.exit(0);
}

function fail(msg: string): never {
    process.stderr.write(`harness: ${msg}\n`);
    process.exit(2);
}

function parseSpec(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of raw.split(',')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return out;
}

function parseTokenSpec(raw: string): TokenSpec {
    const f = parseSpec(raw);
    if (!f.name) fail(`--issue-token needs name= (got "${raw}")`);
    const scopes = (f.scopes ?? 'read+control').split('+').map((s) => s.trim()).filter(Boolean) as Scope[];
    for (const s of scopes) if (!VALID_SCOPES.includes(s)) fail(`invalid scope "${s}"`);
    const projects = f.projects ? f.projects.split('+').map((s) => s.trim()).filter(Boolean) : undefined;
    return { name: f.name, scopes, projects };
}

function parseArgs(argv: string[]): CliConfig {
    let args = argv.slice(2);
    const cfg: CliConfig = {
        governed: false,
        serve: false,
        mcpProxy: false,
        host: process.env.HARNESS_HOST ?? '127.0.0.1',
        port: Number(process.env.HARNESS_PORT) || DEFAULT_WS_PORT,
        coreDataDir: process.env.HARNESS_CORE_DATA_DIR ?? defaultCoreDataDir(),
        gatewayDataDir: process.env.HARNESS_GATEWAY_DATA_DIR ?? defaultGatewayDataDir(),
        consoleDir: process.env.HARNESS_CONSOLE_DIR ?? defaultConsoleDir(),
        experimentalEnvVar: undefined,
        adminUser: undefined,
        adminPass: undefined,
        issueTokens: [],
        maxStorageBytes: process.env.HARNESS_MAX_STORAGE_BYTES
            ? Number(process.env.HARNESS_MAX_STORAGE_BYTES)
            : undefined,
        maxAgeDays: process.env.HARNESS_MAX_AGE_DAYS
            ? Number(process.env.HARNESS_MAX_AGE_DAYS)
            : undefined,
        maxSessions: process.env.HARNESS_MAX_SESSIONS
            ? Number(process.env.HARNESS_MAX_SESSIONS)
            : undefined,
        recordingRetentionDays: process.env.HARNESS_RECORDING_RETENTION_DAYS
            ? Number(process.env.HARNESS_RECORDING_RETENTION_DAYS)
            : undefined,
        maxRecordingBytesPerSession: process.env.HARNESS_MAX_RECORDING_BYTES_PER_SESSION
            ? Number(process.env.HARNESS_MAX_RECORDING_BYTES_PER_SESSION)
            : undefined,
        purgeIntervalMs: process.env.HARNESS_PURGE_INTERVAL_MS
            ? Number(process.env.HARNESS_PURGE_INTERVAL_MS)
            : undefined,
    };
    // Leading subcommand. `serve` = headless shared gateway; `mcp` = stdio proxy
    // to the shared gateway. Neither combines with the other or with --governed.
    if (args[0] === 'serve') {
        cfg.serve = true;
        args = args.slice(1);
    } else if (args[0] === 'mcp') {
        cfg.mcpProxy = true;
        args = args.slice(1);
    }
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => {
            const v = args[++i];
            if (v == null) fail(`missing value for ${a}`);
            return v;
        };
        switch (a) {
            case '-h': case '--help': printHelpAndExit(); break;
            case '--governed': cfg.governed = true; break;
            case '--host': cfg.host = next(); break;
            case '--port':
                cfg.port = Number(next());
                if (!Number.isFinite(cfg.port) || cfg.port < 0) fail('invalid --port');
                break;
            case '--core-data-dir': cfg.coreDataDir = next(); break;
            case '--data-dir': cfg.gatewayDataDir = next(); break;
            case '--console-dir': cfg.consoleDir = next(); break;
            case '--experimental-env-var': cfg.experimentalEnvVar = next(); break;
            case '--admin-user': cfg.adminUser = next(); break;
            case '--admin-pass': cfg.adminPass = next(); break;
            case '--issue-token': cfg.issueTokens.push(parseTokenSpec(next())); break;
            default: fail(`unknown argument ${a}`);
        }
    }
    if (cfg.serve && cfg.governed) fail('`serve` is Open-only; drop --governed');
    if (cfg.mcpProxy && (cfg.governed || cfg.serve)) fail('`mcp` cannot combine with serve / --governed');
    return cfg;
}

async function main(): Promise<void> {
    const cfg = parseArgs(process.argv);
    const lines: string[] = [];

    // `harness mcp` — don't host a core; reuse (or spawn) the shared gateway and
    // proxy the agent's stdio MCP to its /mcp. This is what `.mcp.json` points at.
    if (cfg.mcpProxy) {
        const { baseUrl, reused } = await ensureSharedGateway({
            host: cfg.host,
            port: cfg.port,
            coreDataDir: cfg.coreDataDir,
            gatewayDataDir: cfg.gatewayDataDir,
            experimentalEnvVar: cfg.experimentalEnvVar,
        });
        process.stderr.write(`[harness] mcp: ${reused ? 'reusing' : 'spawned'} shared gateway → ${baseUrl}/mcp\n`);
        await startMcpStdioProxy(`${baseUrl}/mcp`);
        return;
    }

    const coreClient = createCoreClient({
        dataDir: cfg.coreDataDir,
        consent: cfg.governed ? { mode: 'session' } : { mode: 'off' },
        autoPurge: {
            intervalMs: cfg.purgeIntervalMs,
            policy: {
                ...(cfg.maxStorageBytes !== undefined && { maxTotalBytes: cfg.maxStorageBytes }),
                ...(cfg.maxAgeDays !== undefined && { maxAgeDays: cfg.maxAgeDays }),
                ...(cfg.maxSessions !== undefined && { maxSessions: cfg.maxSessions }),
                ...(cfg.recordingRetentionDays !== undefined && { recordingRetentionDays: cfg.recordingRetentionDays }),
                ...(cfg.maxRecordingBytesPerSession !== undefined && { maxRecordingBytesPerSession: cfg.maxRecordingBytesPerSession }),
            },
        },
    });
    await coreClient.start();

    let policy: Policy;
    let store: GatewayStore | undefined;

    if (cfg.governed) {
        store = new GatewayStore(cfg.gatewayDataDir);
        policy = new Policy({ mode: 'governed', store });
        const local = store.listServers().find((s) => s.name === 'local') ?? store.addServer({ name: 'local', endpoint: 'in-process', env: 'local' });
        if (cfg.adminUser && cfg.adminPass && !store.hasAdmins()) {
            store.addAdmin(cfg.adminUser, cfg.adminPass);
            lines.push(`[harness] admin created: ${cfg.adminUser}`);
        }
        for (const spec of cfg.issueTokens) {
            const { raw } = store.createToken({ name: spec.name, serverId: local.id, scopes: spec.scopes, projects: spec.projects });
            lines.push(`[harness] token "${spec.name}" [${spec.scopes.join(',')}] projects=${spec.projects?.join('+') ?? '*'}:  ${raw}`);
        }
    } else {
        policy = new Policy({ mode: 'open' });
    }

    const gw = createGateway({
        coreClient,
        policy,
        store,
        consoleDir: cfg.consoleDir,
        experimentalEnvVar: cfg.experimentalEnvVar,
    });
    const boundPort = await gw.listen(cfg.port, cfg.host);
    const base = `http://${cfg.host}:${boundPort}`;

    const label = cfg.governed ? 'GOVERNED (team)' : cfg.serve ? 'OPEN (serve)' : 'OPEN (solo)';
    lines.push(`[harness] ${label} — ${base}`);
    lines.push(`[harness] ws:      ${base.replace('http', 'ws')}/ws`);
    lines.push(`[harness] console: ${base}/console`);
    if (store) lines.push(`[harness] admin:   ${base}/admin`);

    // stdio MCP is only for the zero-config solo path (the agent spawns us and
    // talks over our stdin/stdout). `serve` and `--governed` are headless HTTP
    // gateways — the process stays alive because the listener holds the loop.
    const useStdio = !cfg.governed && !cfg.serve;
    if (useStdio) {
        // Print the banner to stderr (stdout is the MCP transport) BEFORE connecting.
        process.stderr.write(lines.join('\n') + '\n[harness] MCP: stdio\n');
        await startMcpStdioServer(coreClient.capabilities, {
            experimentalEnvVar: cfg.experimentalEnvVar,
            consoleUrl: (sessionId) => `${base}/console${sessionId ? `/sessions/${encodeURIComponent(sessionId)}` : ''}`,
        });
    } else {
        lines.push(`[harness] mcp:     ${base}/mcp`);
        process.stderr.write(lines.join('\n') + '\n');
    }

    const onSignal = async () => {
        process.stderr.write('\n[harness] shutting down\n');
        await gw.close();
        await coreClient.stop();
        process.exit(0);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
}

main().catch((err) => {
    process.stderr.write(`[harness] fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
});
