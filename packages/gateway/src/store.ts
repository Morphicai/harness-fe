/**
 * Gateway data layer (5.0 · P6 · C2) — JSON-file store (zero native deps,
 * mirrors the daemon's Json*Store pattern). Holds servers, tokens, and an
 * append-only audit log. Admins land in C5.
 *
 *   {dataDir}/servers.json   { [id]: ServerRecord }
 *   {dataDir}/tokens.json    { [id]: TokenRecord }   (secret never stored — only scrypt hash+salt)
 *   {dataDir}/audit.jsonl    append-only AuditEntry lines
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateToken, parseToken, verifySecret } from './tokens.js';

export type Scope = 'control' | 'read' | 'write';

export interface ServerRecord {
    id: string;
    name: string;
    /** Daemon HTTP base, e.g. http://host:port (the gateway proxies its /mcp). */
    endpoint: string;
    env: string;
    /**
     * The daemon's own auth token. The gateway authenticates to the daemon with
     * this and forwards the real caller via the `x-harness-caller` header — the
     * daemon trusts a forwarded identity only on auth-enabled requests (P6·C1),
     * so daemons behind a gateway MUST run with a token.
     */
    token?: string;
    createdAt: number;
}

export interface TokenRecord {
    id: string;
    hash: string;
    salt: string;
    name: string;
    /** Which server (env) this token is bound to. */
    serverId: string;
    scopes: Scope[];
    createdAt: number;
    expiresAt?: number;
    revokedAt?: number;
}

export interface AuditEntry {
    ts: number;
    tokenId?: string;
    tool: string;
    serverId?: string;
    detail?: string;
    ip?: string;
}

/** Result of a successful token verification — the caller's identity + grants. */
export interface VerifiedCaller {
    tokenId: string;
    name: string;
    serverId: string;
    scopes: Scope[];
}

function readMap<T>(path: string): Record<string, T> {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as Record<string, T>;
    } catch {
        return {};
    }
}

function writeMap(path: string, data: unknown): void {
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

export class GatewayStore {
    private readonly serversPath: string;
    private readonly tokensPath: string;
    private readonly auditPath: string;

    constructor(dataDir: string) {
        mkdirSync(dataDir, { recursive: true });
        this.serversPath = join(dataDir, 'servers.json');
        this.tokensPath = join(dataDir, 'tokens.json');
        this.auditPath = join(dataDir, 'audit.jsonl');
    }

    // ── Servers ──────────────────────────────────────────────────────────
    listServers(): ServerRecord[] {
        return Object.values(readMap<ServerRecord>(this.serversPath)).sort((a, b) => a.createdAt - b.createdAt);
    }
    getServer(id: string): ServerRecord | undefined {
        return readMap<ServerRecord>(this.serversPath)[id];
    }
    addServer(input: { name: string; endpoint: string; env: string; token?: string }): ServerRecord {
        const all = readMap<ServerRecord>(this.serversPath);
        const rec: ServerRecord = { id: randomUUID(), createdAt: Date.now(), ...input };
        all[rec.id] = rec;
        writeMap(this.serversPath, all);
        return rec;
    }
    removeServer(id: string): boolean {
        const all = readMap<ServerRecord>(this.serversPath);
        if (!all[id]) return false;
        delete all[id];
        writeMap(this.serversPath, all);
        return true;
    }

    // ── Tokens ───────────────────────────────────────────────────────────
    /** Create a token. Returns the record + the raw token string (shown once). */
    createToken(input: { name: string; serverId: string; scopes: Scope[]; expiresAt?: number }): {
        token: TokenRecord;
        raw: string;
    } {
        const { tokenId, raw, secretHash } = generateToken();
        const token: TokenRecord = {
            id: tokenId,
            hash: secretHash.hash,
            salt: secretHash.salt,
            name: input.name,
            serverId: input.serverId,
            scopes: input.scopes,
            createdAt: Date.now(),
            expiresAt: input.expiresAt,
        };
        const all = readMap<TokenRecord>(this.tokensPath);
        all[tokenId] = token;
        writeMap(this.tokensPath, all);
        return { token, raw };
    }
    /** Tokens without secret material (for the admin list view). */
    listTokens(): Omit<TokenRecord, 'hash' | 'salt'>[] {
        return Object.values(readMap<TokenRecord>(this.tokensPath))
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(({ hash: _h, salt: _s, ...rest }) => rest);
    }
    revokeToken(id: string): boolean {
        const all = readMap<TokenRecord>(this.tokensPath);
        const rec = all[id];
        if (!rec || rec.revokedAt) return false;
        rec.revokedAt = Date.now();
        writeMap(this.tokensPath, all);
        return true;
    }
    /** Verify a raw token → caller identity + grants, or null (unknown/revoked/expired/bad secret). */
    verifyToken(raw: string): VerifiedCaller | null {
        const parsed = parseToken(raw);
        if (!parsed) return null;
        const rec = readMap<TokenRecord>(this.tokensPath)[parsed.tokenId];
        if (!rec || rec.revokedAt) return null;
        if (rec.expiresAt && Date.now() > rec.expiresAt) return null;
        if (!verifySecret(parsed.secret, { hash: rec.hash, salt: rec.salt })) return null;
        return { tokenId: rec.id, name: rec.name, serverId: rec.serverId, scopes: rec.scopes };
    }

    // ── Audit (append-only) ──────────────────────────────────────────────
    appendAudit(entry: AuditEntry): void {
        appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
    }
    listAudit(limit = 100): AuditEntry[] {
        let raw: string;
        try {
            raw = readFileSync(this.auditPath, 'utf8');
        } catch {
            return [];
        }
        const lines = raw.split('\n').filter((l) => l.trim());
        return lines
            .slice(-limit)
            .map((l) => {
                try {
                    return JSON.parse(l) as AuditEntry;
                } catch {
                    return null;
                }
            })
            .filter((e): e is AuditEntry => e !== null);
    }
}
