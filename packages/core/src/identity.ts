/**
 * Identity model + visibility rules — the part of caller-identity that core
 * *consumes*.
 *
 * In the rebuilt architecture the **gateway produces** a `Principal` (token →
 * id + scopes + projects, or `local` on loopback) and injects it into core via
 * `bridge.acceptPeer(socket, principal)` and the capability calls. core never
 * parses an HTTP request or a token — it only reasons about an
 * already-resolved `Principal`. So this module is pure: no `node:http`, no
 * token verification, no login form. Those live in the gateway.
 *
 * What stays here:
 *   - the `Principal` shape (+ `scopes` for write-only runtime clients),
 *   - `canSee` / `canSeeProject` / `projectGrant` tenant-visibility rules,
 *   - `principalCan` scope gate (write-only callers are denied read/control),
 *   - the header-name constants that form the gateway→core forwarding contract.
 */

import { createHash } from 'node:crypto';

export type PrincipalKind = 'local' | 'token' | 'host' | 'forwarded';

/**
 * Capability scopes a caller holds. Mirrors the gateway's three-scope RBAC:
 *   - `write`   — may report events and be driven (the browser runtime client).
 *   - `read`    — may read telemetry (sessions / tail / replay / tasks).
 *   - `control` — may drive the browser (`page.*` and other control commands).
 *
 * `undefined` means **unrestricted** — the trusted local principal (loopback /
 * stdio solo dev) and host-embedded callers hold every scope implicitly, so
 * solo behaviour is unchanged. A write-only runtime client carries
 * `{ write: true }` and is therefore denied every read/control capability.
 */
export interface PrincipalScopes {
    write?: boolean;
    read?: boolean;
    control?: boolean;
}

/**
 * Header a trusted upstream (the gateway) sets to forward the real caller's
 * identity when proxying to a remote core. core trusts it only because the
 * gateway is the only thing that ever connects to a remote core — an
 * in-process core is driven by direct calls and never sees a header.
 */
export const FORWARDED_CALLER_HEADER = 'x-harness-caller';

/**
 * Companion to {@link FORWARDED_CALLER_HEADER}: the set of projects this
 * caller's token is authorized for (project→agent binding). Comma-separated
 * project ids, or `*` for all.
 */
export const FORWARDED_PROJECTS_HEADER = 'x-harness-projects';

export interface Principal {
    /** Stable id for this caller. Loopback / stdio solo dev → `local`. */
    id: string;
    /** How the identity was established. */
    kind: PrincipalKind;
    /** Optional human-readable label (for dashboards / audit). */
    displayName?: string;
    /**
     * Capability scopes (see {@link PrincipalScopes}). `undefined` = unrestricted
     * (local / host). A browser runtime client is `{ write: true }`.
     */
    scopes?: PrincipalScopes;
    /**
     * Projects this caller is explicitly authorized for (project→agent
     * binding), injected by the gateway. `['*']` = all. `undefined` = no
     * explicit grant — visibility falls back to creator-based ownership (solo /
     * single-token, where creator === consumer).
     */
    projects?: readonly string[];
}

/**
 * The implicit single principal for loopback and stdio solo dev. The gateway
 * trusts everything reaching the loopback socket, so there is one caller and it
 * owns everything (no `scopes` = unrestricted) — exactly solo's behaviour, now
 * named.
 */
export const LOCAL_PRINCIPAL: Principal = Object.freeze({
    id: 'local',
    kind: 'local',
    displayName: 'local',
});

/**
 * Principal for the custom-`authorize` path. Hosts that embed the gateway own
 * their own user model; until `authorize` can return a richer identity, an
 * authorized host caller maps to this single unrestricted principal.
 */
export const HOST_PRINCIPAL: Principal = Object.freeze({
    id: 'host',
    kind: 'host',
    displayName: 'host',
});

/**
 * Derive a stable principal id from a bearer token. One token = one principal
 * in the trusted-team model. We hash so the raw secret never becomes an id that
 * could leak into stored `createdBy` tags or audit logs.
 */
export function tokenPrincipalId(token: string): string {
    return `token:${createHash('sha256').update(token).digest('hex').slice(0, 12)}`;
}

/**
 * Scope gate. `true` when the principal may exercise a capability of the given
 * scope.
 *
 * - unrestricted principal (`scopes` undefined: local / host) → always allowed.
 * - otherwise → only the scopes explicitly granted are allowed. A write-only
 *   runtime client (`{ write: true }`) is therefore denied every `read` and
 *   `control` capability — this is the write-only-token fix that stops a leaked
 *   browser token from reading or driving anyone else's data.
 */
export function principalCan(principal: Principal, scope: keyof PrincipalScopes): boolean {
    if (!principal.scopes) return true;
    return principal.scopes[scope] === true;
}

/**
 * Tenant-isolation visibility check. Decides whether `principal` may see a
 * record tagged with `createdBy`.
 *
 * - `local` (loopback / stdio solo / no-auth) → sees everything. Keeps solo
 *   dev's behaviour completely unchanged.
 * - unowned data (`createdBy` null/undefined — legacy rows, or records never
 *   tagged) → visible to everyone (backward compat).
 * - otherwise → visible only to the principal that created it.
 *
 * In the single-token / loopback reality the data creator (plugin / runtime
 * client) and the querying agent share one principal, so this is exact. The
 * project→agent binding (creator ≠ consumer) is handled by
 * {@link canSeeProject} via {@link projectGrant}.
 */
export function canSee(principal: Principal, createdBy: string | null | undefined): boolean {
    if (principal.kind === 'local') return true;
    if (createdBy == null) return true;
    return createdBy === principal.id;
}

/**
 * Project-ownership visibility with host→sub-app routing. `ownerChain` is the
 * project's own `createdBy` followed by its ancestors' (walked via
 * `parentProjectId`, self → root).
 *
 * Visible when the caller owns the project itself **or any ancestor** — so a
 * host agent sees its sub-apps' data, but a sub-app's owner does not see up the
 * tree. `local` sees all; an unowned link (no `createdBy`) is visible (backward
 * compat). Owning a project grants its whole data set (sessions / tasks),
 * regardless of which runtime client created each row.
 */
export function canSeeProject(
    principal: Principal,
    projectId: string,
    ownerChain: ReadonlyArray<string | null | undefined>,
): boolean {
    // Explicit project→agent binding (gateway-injected grants) takes precedence:
    // a bound agent sees the project's whole data set regardless of who created
    // each row (creator ≠ consumer). Only when there is NO grant info do we fall
    // back to creator-based ownership (solo / single-token, where they coincide).
    const grant = projectGrant(principal, projectId);
    if (grant !== null) return grant;
    return ownerChain.some((createdBy) => canSee(principal, createdBy));
}

/**
 * Project-level authorization for a principal (project→agent binding).
 * - `local` → always (loopback/solo trusts everything)
 * - explicit grants present → membership test (`*` = all)
 * - no grants (`undefined`) → `null`, meaning "no binding info; decide by
 *   creator-based ownership instead" (backward compatible).
 */
export function projectGrant(principal: Principal, projectId: string): boolean | null {
    if (principal.kind === 'local') return true;
    if (!principal.projects) return null;
    return principal.projects.includes('*') || principal.projects.includes(projectId);
}
