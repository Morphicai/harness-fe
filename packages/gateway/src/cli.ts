#!/usr/bin/env node
/**
 * `harness-gateway` — launch the embedded gateway (front door + in-process core).
 *
 * Open (solo) — zero config, loopback, no tokens:
 *   harness-gateway --open
 *
 * Governed (team) — tokens + RBAC + audit + admin panel:
 *   harness-gateway --port 47950 \
 *     --admin-user admin --admin-pass secret \
 *     --issue-token name=runtime,scopes=write \
 *     --issue-token name=agentA,scopes=read+control,projects=react-demo
 *
 * The gateway hosts MCP at /mcp, the runtime WebSocket at /ws, the console at
 * /console, and the governance panel at /admin. Core runs in-process — there is
 * no separate daemon to point at.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCoreClient } from '@harness-fe/core';
import { GatewayStore, type ServerRecord, type Scope } from './store.js';
import { createGateway } from './server.js';
import { Policy } from './policy.js';

interface TokenSpec {
    name: string;
    scopes: Scope[];
    projects?: string[];
}

interface CliConfig {
    host: string;
    port: number;
    open: boolean;
    dataDir: string;
    coreDataDir: string;
    mcpPath: string;
    consoleDir: string | undefined;
    adminUser: string | undefined;
    adminPass: string | undefined;
    issueTokens: TokenSpec[];
}

const DEFAULT_PORT = 47950;
const VALID_SCOPES: Scope[] = ['control', 'read', 'write'];

function defaultGatewayDataDir(): string {
    return join(homedir(), '.harness-fe', 'gateway');
}
function defaultCoreDataDir(): string {
    return join(homedir(), '.harness-fe', 'core');
}

function printHelpAndExit(): never {
    process.stderr.write(`harness-gateway — embedded MCP gateway (front door + in-process core)

Usage:
  harness-gateway [options]

Options:
  --open                 Open policy: loopback solo, no tokens, no audit.
  --port <number>        HTTP port. Default ${DEFAULT_PORT}.
  --host <addr>          Bind address. Default 127.0.0.1.
  --data-dir <dir>       Gateway store dir (tokens/admins/audit). Default ~/.harness-fe/gateway.
  --core-data-dir <dir>  Core store dir (sessions/events). Default ~/.harness-fe/core.
  --console-dir <dir>    Built console-ui dist to serve at /console.
  --mcp-path <path>      MCP endpoint path. Default /mcp.
  --admin-user <u>       Bootstrap admin username (governed; only if none exists).
  --admin-pass <p>       Bootstrap admin password.
  --issue-token <spec>   Issue a gateway token, printed once. Repeatable.
                         spec: name=agentA,scopes=read+control[,projects=react-demo+vue-demo]
                         scopes=write → a runtime (browser) token.
  -h, --help             Show this help.
`);
    process.exit(0);
}

function parseTokenSpec(raw: string): TokenSpec {
    const fields = parseSpec(raw);
    if (!fields.name) fail(`--issue-token needs at least name= (got "${raw}")`);
    const scopes = (fields.scopes ?? 'read+control')
        .split('+')
        .map((s) => s.trim())
        .filter(Boolean) as Scope[];
    for (const s of scopes) {
        if (!VALID_SCOPES.includes(s)) fail(`--issue-token: invalid scope "${s}" (control|read|write)`);
    }
    const projects = fields.projects
        ? fields.projects.split('+').map((s) => s.trim()).filter(Boolean)
        : undefined;
    return { name: fields.name, scopes, projects };
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

function fail(msg: string): never {
    process.stderr.write(`harness-gateway: ${msg}\n`);
    process.exit(2);
}

function parseArgs(argv: string[]): CliConfig {
    const args = argv.slice(2);
    let host: string | undefined;
    let port: number | undefined;
    let open = false;
    let dataDir: string | undefined;
    let coreDataDir: string | undefined;
    let mcpPath: string | undefined;
    let consoleDir: string | undefined;
    let adminUser: string | undefined;
    let adminPass: string | undefined;
    const issueTokens: TokenSpec[] = [];

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => {
            const v = args[++i];
            if (v == null) fail(`missing value for ${a}`);
            return v;
        };
        switch (a) {
            case '-h':
            case '--help': printHelpAndExit(); break;
            case '--open': open = true; break;
            case '--host': host = next(); break;
            case '--port':
                port = Number(next());
                if (!Number.isFinite(port) || port <= 0) fail('invalid --port');
                break;
            case '--data-dir': dataDir = next(); break;
            case '--core-data-dir': coreDataDir = next(); break;
            case '--console-dir': consoleDir = next(); break;
            case '--mcp-path': mcpPath = next(); break;
            case '--admin-user': adminUser = next(); break;
            case '--admin-pass': adminPass = next(); break;
            case '--issue-token': issueTokens.push(parseTokenSpec(next())); break;
            default: fail(`unknown argument ${a}`);
        }
    }

    return {
        host: host ?? process.env.HARNESS_GATEWAY_HOST ?? '127.0.0.1',
        port: port ?? (Number(process.env.HARNESS_GATEWAY_PORT) || DEFAULT_PORT),
        open,
        dataDir: dataDir ?? process.env.HARNESS_GATEWAY_DATA_DIR ?? defaultGatewayDataDir(),
        coreDataDir: coreDataDir ?? process.env.HARNESS_GATEWAY_CORE_DATA_DIR ?? defaultCoreDataDir(),
        mcpPath: mcpPath ?? '/mcp',
        consoleDir,
        adminUser,
        adminPass,
        issueTokens,
    };
}

/** Ensure a single implicit "local" server record so tokens have something to bind to. */
function ensureLocalServer(store: GatewayStore): ServerRecord {
    const existing = store.listServers().find((s) => s.name === 'local');
    if (existing) return existing;
    return store.addServer({ name: 'local', endpoint: 'in-process', env: 'local' });
}

async function main(): Promise<void> {
    const cfg = parseArgs(process.argv);
    const lines: string[] = [];

    const coreClient = createCoreClient({ dataDir: cfg.coreDataDir });
    await coreClient.start();

    let policy: Policy;
    let store: GatewayStore | undefined;

    if (cfg.open) {
        policy = new Policy({ mode: 'open' });
        lines.push('[gateway] policy: OPEN (loopback solo — no tokens, no audit)');
    } else {
        store = new GatewayStore(cfg.dataDir);
        policy = new Policy({ mode: 'governed', store });
        const local = ensureLocalServer(store);

        if (cfg.adminUser && cfg.adminPass) {
            if (store.hasAdmins()) {
                lines.push('[gateway] admin already configured — ignoring --admin-user.');
            } else {
                store.addAdmin(cfg.adminUser, cfg.adminPass);
                lines.push(`[gateway] admin created: ${cfg.adminUser}`);
            }
        }
        for (const spec of cfg.issueTokens) {
            const { raw } = store.createToken({ name: spec.name, serverId: local.id, scopes: spec.scopes, projects: spec.projects });
            const proj = spec.projects?.length ? spec.projects.join('+') : '*';
            lines.push(`[gateway] token "${spec.name}" [${spec.scopes.join(',')}] projects=${proj}:  ${raw}`);
        }
    }

    const gw = createGateway({ coreClient, policy, store, mcpPath: cfg.mcpPath, consoleDir: cfg.consoleDir });
    const boundPort = await gw.listen(cfg.port, cfg.host);

    const base = `http://${cfg.host}:${boundPort}`;
    lines.push(`[gateway] listening on ${base}`);
    lines.push(`[gateway] mcp:     ${base}${cfg.mcpPath}`);
    lines.push(`[gateway] ws:      ${base.replace('http', 'ws')}/ws`);
    lines.push(`[gateway] console: ${base}/console`);
    if (store) lines.push(`[gateway] admin:   ${base}/admin`);
    process.stderr.write(lines.join('\n') + '\n');

    const onSignal = async () => {
        process.stderr.write('\n[gateway] shutting down\n');
        await gw.close();
        await coreClient.stop();
        process.exit(0);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
}

main().catch((err) => {
    process.stderr.write(`[gateway] fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
});
