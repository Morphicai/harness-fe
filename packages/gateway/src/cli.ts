#!/usr/bin/env node
/**
 * CLI entry for the governance gateway — the production launcher that turns
 * `@harness-fe/gateway` from a library into a runnable service.
 *
 * Usage:
 *   harness-gateway --port 47950 \
 *     --admin-user admin --admin-pass secret \
 *     --add-server name=team,endpoint=http://127.0.0.1:47900,token=DAEMON_SECRET \
 *     --issue-token name=agentA,server=team,scopes=read+control
 *
 * The gateway sits in front of one or more daemons: it verifies the caller's
 * gateway token, gates by scope (RBAC), routes to the target daemon by the
 * token's serverId, injects the real caller via x-harness-caller, and audits
 * every call. Admins / tokens / servers can also be managed from the HTML
 * admin panel at /admin — the CLI flags just make first-boot + scripting easy.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { GatewayStore, type Scope } from './store.js';
import { createGateway } from './server.js';

interface ServerSpec {
    name: string;
    endpoint: string;
    token?: string;
}

interface TokenSpec {
    name: string;
    server: string;
    scopes: Scope[];
    /** Authorized projects (5.0 · project→agent binding). undefined = all. */
    projects?: string[];
}

interface CliConfig {
    host: string;
    port: number;
    dataDir: string;
    mcpPath: string;
    adminUser: string | undefined;
    adminPass: string | undefined;
    addServers: ServerSpec[];
    issueTokens: TokenSpec[];
}

const DEFAULT_PORT = 47950;
const VALID_SCOPES: Scope[] = ['control', 'read', 'write'];

function defaultGatewayDataDir(): string {
    return join(homedir(), '.harness-fe', 'gateway');
}

function printHelpAndExit(): never {
    process.stderr.write(`harness-gateway — MCP governance gateway

Usage:
  harness-gateway [options]

Options:
  --port <number>        HTTP port. Default ${DEFAULT_PORT}.
  --host <addr>          Bind address. Default 127.0.0.1.
  --data-dir <dir>       Gateway store dir. Default ~/.harness-fe/gateway.
  --mcp-path <path>      MCP endpoint path. Default /mcp.
  --admin-user <u>       Bootstrap admin username (only created if no admin exists yet).
  --admin-pass <p>       Bootstrap admin password.
  --add-server <spec>    Register an upstream daemon. Idempotent by name. Repeatable.
                         spec: name=team,endpoint=http://127.0.0.1:47900,token=DAEMON_SECRET
  --issue-token <spec>   Issue a gateway token and print it once. Repeatable.
                         spec: name=agentA,server=team,scopes=read+control[,projects=react-demo+vue-demo]
                         projects omitted (or '*') = all projects on the server.
  -h, --help             Show this help.

Environment:
  HARNESS_GATEWAY_PORT / _HOST / _DATA_DIR   Same as the flags above.
`);
    process.exit(0);
}

function parseServerSpec(raw: string): ServerSpec {
    const fields = parseSpec(raw);
    const name = fields.name;
    const endpoint = fields.endpoint;
    if (!name || !endpoint) {
        fail(`--add-server needs at least name= and endpoint= (got "${raw}")`);
    }
    return { name, endpoint, token: fields.token };
}

function parseTokenSpec(raw: string): TokenSpec {
    const fields = parseSpec(raw);
    const name = fields.name;
    const server = fields.server;
    if (!name || !server) {
        fail(`--issue-token needs at least name= and server= (got "${raw}")`);
    }
    const scopes = (fields.scopes ?? 'read+control')
        .split('+')
        .map((s) => s.trim())
        .filter(Boolean) as Scope[];
    for (const s of scopes) {
        if (!VALID_SCOPES.includes(s)) fail(`--issue-token: invalid scope "${s}" (control|read|write)`);
    }
    // projects=a+b limits the token to those projects; omit (or '*') = all.
    const projects = fields.projects
        ? fields.projects
              .split('+')
              .map((s) => s.trim())
              .filter(Boolean)
        : undefined;
    return { name, server, scopes, projects };
}

/** Parse "k=v,k2=v2" into an object. Values may contain '=' (e.g. token). */
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
    let dataDir: string | undefined;
    let mcpPath: string | undefined;
    let adminUser: string | undefined;
    let adminPass: string | undefined;
    const addServers: ServerSpec[] = [];
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
            case '--help':
                printHelpAndExit();
                break;
            case '--host':
                host = next();
                break;
            case '--port':
                port = Number(next());
                if (!Number.isFinite(port) || port <= 0) fail('invalid --port');
                break;
            case '--data-dir':
                dataDir = next();
                break;
            case '--mcp-path':
                mcpPath = next();
                break;
            case '--admin-user':
                adminUser = next();
                break;
            case '--admin-pass':
                adminPass = next();
                break;
            case '--add-server':
                addServers.push(parseServerSpec(next()));
                break;
            case '--issue-token':
                issueTokens.push(parseTokenSpec(next()));
                break;
            default:
                fail(`unknown argument ${a}`);
        }
    }

    return {
        host: host ?? process.env.HARNESS_GATEWAY_HOST ?? '127.0.0.1',
        port: port ?? (Number(process.env.HARNESS_GATEWAY_PORT) || DEFAULT_PORT),
        dataDir: dataDir ?? process.env.HARNESS_GATEWAY_DATA_DIR ?? defaultGatewayDataDir(),
        mcpPath: mcpPath ?? '/mcp',
        adminUser,
        adminPass,
        addServers,
        issueTokens,
    };
}

async function main(): Promise<void> {
    const cfg = parseArgs(process.argv);
    const store = new GatewayStore(cfg.dataDir);
    const lines: string[] = [];

    // Bootstrap the first admin (never clobbers an existing one).
    if (cfg.adminUser && cfg.adminPass) {
        if (store.hasAdmins()) {
            lines.push(`[gateway] admin already configured — ignoring --admin-user (use the panel to manage admins).`);
        } else {
            store.addAdmin(cfg.adminUser, cfg.adminPass);
            lines.push(`[gateway] admin created: ${cfg.adminUser}`);
        }
    }

    // Register upstream daemons (idempotent by name).
    for (const spec of cfg.addServers) {
        const existing = store.listServers().find((s) => s.name === spec.name);
        if (existing) {
            lines.push(`[gateway] server "${spec.name}" already registered (${existing.endpoint}) — skipped.`);
            continue;
        }
        const rec = store.addServer({ name: spec.name, endpoint: spec.endpoint, env: spec.name, token: spec.token });
        lines.push(`[gateway] server "${rec.name}" → ${rec.endpoint}${rec.token ? ' (token set)' : ' (no token)'}`);
    }

    // Issue tokens — printed once, here, since the secret is unrecoverable.
    for (const spec of cfg.issueTokens) {
        const server = store.listServers().find((s) => s.name === spec.server);
        if (!server) fail(`--issue-token: no server named "${spec.server}" (add it with --add-server first)`);
        const { raw } = store.createToken({
            name: spec.name,
            serverId: server.id,
            scopes: spec.scopes,
            projects: spec.projects,
        });
        const proj = spec.projects?.length ? spec.projects.join('+') : '*';
        lines.push(`[gateway] token "${spec.name}" [${spec.scopes.join(',')}] projects=${proj} → ${server.name}:  ${raw}`);
    }

    const gw = createGateway({ store, mcpPath: cfg.mcpPath });
    const boundPort = await gw.listen(cfg.port, cfg.host);

    const base = `http://${cfg.host}:${boundPort}`;
    lines.push(`[gateway] listening on ${base}`);
    lines.push(`[gateway] data:    ${cfg.dataDir}`);
    lines.push(`[gateway] mcp:     ${base}${cfg.mcpPath}   (agents: Authorization: Bearer <gateway-token>)`);
    lines.push(`[gateway] admin:   ${base}/admin`);
    if (!store.hasAdmins()) {
        lines.push(`[gateway] WARNING: no admin configured — pass --admin-user/--admin-pass or the panel is locked out.`);
    }
    process.stderr.write(lines.join('\n') + '\n');

    const onSignal = async () => {
        process.stderr.write('\n[gateway] shutting down\n');
        await gw.close();
        process.exit(0);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
}

main().catch((err) => {
    process.stderr.write(`[gateway] fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
});
