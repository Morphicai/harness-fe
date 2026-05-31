/**
 * Principal resolution — the gateway's job (core only *consumes* a Principal).
 *
 * The gateway is the authority that turns a request into an identity:
 *   - a verified gateway token  → a scoped token principal,
 *   - loopback / no token (Open) → the unrestricted local principal.
 *
 * core then enforces scope + visibility from the `Principal` we hand it (via
 * `acceptPeer` for /ws and the capability calls for /mcp + /console).
 */

import type { IncomingMessage } from 'node:http';
import { LOCAL_PRINCIPAL, type Principal } from '@harness-fe/core';
import type { Scope, VerifiedCaller } from './store.js';

const WS_SUBPROTOCOL_PREFIX = 'harness-fe.token.';
const COOKIE_NAME = 'harness_fe_token';

/** Map a verified gateway token to a core {@link Principal} (scopes + project grants). */
export function principalFromCaller(caller: VerifiedCaller): Principal {
    return {
        id: caller.tokenId,
        kind: 'token',
        displayName: caller.name,
        scopes: {
            read: caller.scopes.includes('read'),
            control: caller.scopes.includes('control'),
            write: caller.scopes.includes('write'),
        },
        // undefined / ['*'] → all projects (no list); a list scopes the agent.
        projects: caller.projects && caller.projects.length ? caller.projects : undefined,
    };
}

/** True if the verified caller holds the `write` scope (runtime clients). */
export function hasWriteScope(caller: VerifiedCaller): boolean {
    return caller.scopes.includes('write');
}

/** The unrestricted principal used under the Open policy (loopback solo). */
export const OPEN_PRINCIPAL: Principal = LOCAL_PRINCIPAL;

export type { Scope };

/**
 * Pull a token from a request: `Authorization: Bearer`, the `harness_fe_token`
 * cookie, `?token=`, or the WS subprotocol (`harness-fe.token.<token>`). First
 * match wins. Returns undefined when none present.
 */
export function extractToken(req: IncomingMessage): string | undefined {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        const v = auth.slice(7).trim();
        if (v) return v;
    }
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[COOKIE_NAME]) return decodeURIComponent(cookies[COOKIE_NAME]);

    const url = req.url ?? '';
    const qi = url.indexOf('?');
    if (qi >= 0) {
        const t = new URLSearchParams(url.slice(qi + 1)).get('token');
        if (t) return t;
    }

    const subproto = req.headers['sec-websocket-protocol'];
    if (typeof subproto === 'string') {
        for (const p of subproto.split(',')) {
            const trimmed = p.trim();
            if (trimmed.startsWith(WS_SUBPROTOCOL_PREFIX)) {
                return trimmed.slice(WS_SUBPROTOCOL_PREFIX.length);
            }
        }
    }
    return undefined;
}

function parseCookies(raw: string | undefined): Record<string, string> {
    if (!raw) return {};
    const out: Record<string, string> = {};
    for (const part of raw.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k) out[k] = v;
    }
    return out;
}
