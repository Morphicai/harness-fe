/**
 * Caller identity (4.0 · P1) — turns the auth boundary from a plain
 * allow/deny into "allow/deny + *who*".
 *
 * Phase 1 scope: this module only *establishes* and *carries* a Principal,
 * and the bridge *tags* writes with it (createdBy). It deliberately does NOT
 * filter reads by owner — that's P3 (tenant isolation). Keeping the two apart
 * means identity plumbing lands with zero behaviour change: loopback solo dev
 * stays a single implicit `local` principal, and an authorized caller sees
 * everything exactly as before.
 *
 * Why a separate module from auth.ts: `isAuthorized` answers a boolean and is
 * consumed on the hot path of every HTTP route / WS upgrade. `resolvePrincipal`
 * is the richer, additive view layered on top — it reuses the same primitives
 * (isAuthEnabled / extractToken / verifyToken) so the two can never disagree on
 * who is allowed in.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { extractToken, isAuthEnabled, verifyToken, type AuthOptions } from './auth.js';

export type PrincipalKind = 'local' | 'token' | 'host' | 'forwarded';

/**
 * Header a trusted upstream (the gateway) sets to forward the real caller's
 * identity when proxying an MCP request to this daemon (5.0 · P6 · C1). The
 * daemon trusts it only on auth-enabled requests — ones that already cleared
 * the token/authorize gate, which only the gateway holds the credential for.
 * On loopback (no auth) it is ignored, so an unauthenticated client can never
 * spoof an identity.
 */
export const FORWARDED_CALLER_HEADER = 'x-harness-caller';

export interface Principal {
    /** Stable id for this caller. Loopback / stdio solo dev → `local`. */
    id: string;
    /** How the identity was established. */
    kind: PrincipalKind;
    /** Optional human-readable label (for dashboards / audit). */
    displayName?: string;
}

/**
 * The implicit single principal for loopback and stdio solo dev. The daemon
 * trusts everything that can reach the loopback socket, so there is one
 * caller and it owns everything — exactly today's behaviour, now named.
 */
export const LOCAL_PRINCIPAL: Principal = Object.freeze({
    id: 'local',
    kind: 'local',
    displayName: 'local',
});

/**
 * Principal for the custom-`authorize` path. Hosts that embed the daemon own
 * their own user model; until `authorize` can return a richer identity
 * (future work), an authorized host caller maps to this single principal.
 */
export const HOST_PRINCIPAL: Principal = Object.freeze({
    id: 'host',
    kind: 'host',
    displayName: 'host',
});

/**
 * Derive a stable principal id from a bearer token. One token = one principal
 * in 4.0's trusted-team model. We hash so the raw secret never becomes an id
 * that could leak into stored `createdBy` tags or audit logs.
 */
export function tokenPrincipalId(token: string): string {
    return `token:${createHash('sha256').update(token).digest('hex').slice(0, 12)}`;
}

/**
 * Resolve the caller behind a request.
 *
 * Returns `null` when auth is enabled and the request is NOT authorized — this
 * mirrors `isAuthorized(req) === false` exactly, so callers can treat a null
 * principal as "reject" without a second auth check.
 *
 * - auth disabled (loopback): {@link LOCAL_PRINCIPAL}
 * - custom `authorize`: {@link HOST_PRINCIPAL} when it accepts, else `null`
 * - token: a {@link tokenPrincipalId}-derived principal when it matches, else `null`
 */
export function resolvePrincipal(req: IncomingMessage, opts: AuthOptions): Principal | null {
    if (!isAuthEnabled(opts)) return LOCAL_PRINCIPAL;
    if (opts.authorize) return opts.authorize(req) ? HOST_PRINCIPAL : null;
    const token = extractToken(req, opts);
    if (!verifyToken(token, opts.token!)) return null;
    return { id: tokenPrincipalId(token!), kind: 'token' };
}

type HeaderBag = Record<string, string | string[] | undefined>;

function bearerFromHeaders(headers: HeaderBag): string | undefined {
    const raw = headers['authorization'] ?? headers['Authorization'];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v === 'string' && v.startsWith('Bearer ')) {
        const t = v.slice(7).trim();
        if (t) return t;
    }
    return undefined;
}

/**
 * Identify (not authorize) the caller behind an MCP tool call (4.0 · P4).
 *
 * The HTTP MCP request has already cleared the bridge's auth wrapper by the
 * time a tool runs, so this only needs to *name* the caller — never to
 * re-check them. Pass the per-request headers from the MCP SDK's
 * `extra.requestInfo`; stdio calls have no requestInfo and resolve to `local`
 * (the daemon trusts its local stdio agent).
 *
 * - auth disabled, or no headers (stdio) → {@link LOCAL_PRINCIPAL}
 * - custom authorize → {@link HOST_PRINCIPAL}
 * - token mode → token principal from the Authorization header (LOCAL if absent)
 */
export function identifyPrincipal(headers: HeaderBag | undefined, opts: AuthOptions): Principal {
    if (!isAuthEnabled(opts)) return LOCAL_PRINCIPAL;
    // Trusted upstream: a request that cleared auth (only the gateway holds a
    // valid credential) may forward the real caller's identity. Honour it
    // before falling back to the token/host identity of the connection itself.
    if (headers) {
        const forwarded = forwardedCaller(headers);
        if (forwarded) return forwarded;
    }
    if (opts.authorize) return HOST_PRINCIPAL;
    if (!headers) return LOCAL_PRINCIPAL;
    const token = bearerFromHeaders(headers);
    return token ? { id: tokenPrincipalId(token), kind: 'token' } : LOCAL_PRINCIPAL;
}

function forwardedCaller(headers: HeaderBag): Principal | undefined {
    const raw = headers[FORWARDED_CALLER_HEADER] ?? headers['X-Harness-Caller'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (typeof id === 'string' && id.trim()) {
        return { id: id.trim(), kind: 'forwarded' };
    }
    return undefined;
}

/**
 * Tenant-isolation visibility check (4.0 · P3). Decides whether `principal`
 * may see a record tagged with `createdBy`.
 *
 * - `local` (loopback / stdio solo / no-auth) → sees everything. This keeps
 *   solo dev's behaviour completely unchanged.
 * - unowned data (`createdBy` null/undefined — legacy rows from before P1, or
 *   records the daemon never tagged) → visible to everyone (backward compat).
 * - otherwise → visible only to the principal that created it.
 *
 * Note: in the current single-token / loopback reality the data creator
 * (plugin / runtime client) and the querying agent share one principal, so
 * this is exact. A full `project → agent` binding (creator ≠ consumer, once
 * P6 splits write/read scopes) is deferred to P6.
 */
export function canSee(principal: Principal, createdBy: string | null | undefined): boolean {
    if (principal.kind === 'local') return true;
    if (createdBy == null) return true;
    return createdBy === principal.id;
}

/**
 * Project-ownership visibility with host→sub-app routing (4.0 · A — binding +
 * tagging). `ownerChain` is the project's own `createdBy` followed by its
 * ancestors' (walked via `parentProjectId`, self → root).
 *
 * Visible when the caller owns the project itself **or any ancestor** — so a
 * host agent sees its sub-apps' data, but a sub-app's owner does not see up
 * the tree. `local` sees all; an unowned link (no `createdBy`) is visible
 * (backward compat). This is the unit of tenant isolation: owning a project
 * grants its whole data set (sessions/tasks), regardless of which runtime
 * client created each row.
 */
export function canSeeProject(
    principal: Principal,
    ownerChain: ReadonlyArray<string | null | undefined>,
): boolean {
    if (principal.kind === 'local') return true;
    return ownerChain.some((createdBy) => canSee(principal, createdBy));
}
