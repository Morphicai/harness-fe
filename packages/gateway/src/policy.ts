/**
 * Policy — the single switch that distinguishes solo from team.
 *
 *   - **Open** (solo): loopback, no tokens. Every caller is the unrestricted
 *     local principal; no audit. Zero-config dev.
 *   - **Governed** (team): a verified gateway token → a scoped principal
 *     (read/control[/write] + project grants); every call audited. A request
 *     with no/invalid token is rejected.
 *
 * The runtime (`/ws`) and the agent (`/mcp`) resolve through the same Policy so
 * solo and team differ only by which mode the gateway boots in.
 */

import type { IncomingMessage } from 'node:http';
import type { Principal } from '@harness-fe/core';
import type { GatewayStore, VerifiedCaller } from './store.js';
import { OPEN_PRINCIPAL, extractToken, hasWriteScope, principalFromCaller } from './principal.js';

export type PolicyMode = 'open' | 'governed';

export interface Resolved {
    principal: Principal;
    /** The verified token, when governed. Absent under Open. */
    caller?: VerifiedCaller;
}

export class Policy {
    readonly mode: PolicyMode;
    /** Whether calls are audited (governed only). */
    readonly audit: boolean;
    private readonly store?: GatewayStore;

    constructor(opts: { mode: PolicyMode; store?: GatewayStore }) {
        this.mode = opts.mode;
        this.audit = opts.mode === 'governed';
        this.store = opts.store;
        if (opts.mode === 'governed' && !opts.store) {
            throw new Error('Policy: governed mode requires a GatewayStore');
        }
    }

    /**
     * Resolve an agent (MCP / console) caller. Open → unrestricted local.
     * Governed → the token's scoped principal, or null when the token is
     * missing / invalid / revoked / expired.
     */
    resolveAgent(req: IncomingMessage): Resolved | null {
        if (this.mode === 'open') return { principal: OPEN_PRINCIPAL };
        const raw = extractToken(req);
        const caller = raw ? this.store!.verifyToken(raw) : null;
        if (!caller) return null;
        return { principal: principalFromCaller(caller), caller };
    }

    /**
     * Resolve a runtime (`/ws`) connection. Open → unrestricted local.
     * Governed → a write-scope token's principal, or null otherwise — a runtime
     * client MUST carry a `write` token so a leaked browser token can never read
     * or drive (core denies read/control to a write-only principal).
     */
    resolveRuntime(req: IncomingMessage): Resolved | null {
        if (this.mode === 'open') return { principal: OPEN_PRINCIPAL };
        const raw = extractToken(req);
        const caller = raw ? this.store!.verifyToken(raw) : null;
        if (!caller || !hasWriteScope(caller)) return null;
        return { principal: principalFromCaller(caller), caller };
    }
}
