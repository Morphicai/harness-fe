/**
 * Token-based auth for the bridge's HTTP + WS surfaces.
 *
 * Loopback (127.*, localhost, ::1) — auth disabled by default; the daemon
 * trusts everything that can reach the loopback socket. As soon as the
 * daemon is bound to a non-loopback host (e.g. 0.0.0.0 for LAN debugging),
 * the CLI requires a token and this module enforces it on every HTTP route
 * and WS upgrade.
 *
 * Why a single module: dashboard / replay viewer / events handler /
 * MCP HTTP transport all live behind the same bridge HTTP server. Bridge
 * wraps requests with `isAuthorized` once, so individual handlers never
 * see unauthenticated traffic and don't carry auth code.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const DEFAULT_COOKIE_NAME = 'harnessa_fe_token';
export const DEFAULT_LOGIN_PATH = '/__auth';
const WS_SUBPROTOCOL_PREFIX = 'harnessa-fe.token.';

export interface AuthOptions {
    /** Expected token. Empty/undefined disables token auth. */
    token?: string;
    /**
     * Custom authorization predicate. When supplied, runs *instead of* the
     * token check on every HTTP request and WS upgrade. Synchronous: the
     * WS upgrade handshake completes inline. For host-injected auth that
     * needs an async lookup, cache the result in a cookie via the host's
     * own middleware and have `authorize` read the cookie.
     */
    authorize?: (req: IncomingMessage) => boolean;
    /** Cookie name set after a successful login. Default: harnessa_fe_token. */
    cookieName?: string;
    /** POST path that consumes the login form. Default: /__auth. */
    loginPath?: string;
}

export function isAuthEnabled(opts: AuthOptions): boolean {
    return !!(opts.token || opts.authorize);
}

/** Pull token from header / cookie / query / WS subprotocol (first match wins). */
export function extractToken(req: IncomingMessage, opts: AuthOptions = {}): string | undefined {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        const v = auth.slice(7).trim();
        if (v) return v;
    }

    const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
    const cookies = parseCookieHeader(req.headers.cookie);
    if (cookies[cookieName]) return decodeURIComponent(cookies[cookieName]);

    const url = req.url ?? '';
    const qi = url.indexOf('?');
    if (qi >= 0) {
        const params = new URLSearchParams(url.slice(qi + 1));
        const t = params.get('token');
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

/**
 * Constant-time token compare. Hashing both sides first means we always
 * compare equal-length buffers, sidestepping the length-leak that a raw
 * timingSafeEqual on user input would have.
 */
export function verifyToken(provided: string | undefined, expected: string): boolean {
    if (!provided || !expected) return false;
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
}

/** True if request is allowed (auth disabled, custom predicate accepts, or token matches). */
export function isAuthorized(req: IncomingMessage, opts: AuthOptions): boolean {
    if (!isAuthEnabled(opts)) return true;
    // Custom predicate wins when supplied. Hosts that embed the daemon pass
    // their own check here (e.g. JWT verification reading from a cookie).
    if (opts.authorize) return opts.authorize(req);
    return verifyToken(extractToken(req, opts), opts.token!);
}

/**
 * Write a 401 response. Browsers (Accept: text/html) get a minimal login
 * form they can post the token through; everything else gets JSON.
 */
export function sendUnauthorized(
    req: IncomingMessage,
    res: ServerResponse,
    opts: AuthOptions,
): void {
    // Custom-authorize mode is for host apps that own their own login UX —
    // the built-in token form is never the right answer there. Always 401
    // as JSON and let the host redirect.
    const wantsLoginForm = !opts.authorize;
    const accept = (req.headers.accept ?? '').toLowerCase();
    const wantsHtml = accept.includes('text/html') && wantsLoginForm;
    if (wantsHtml) {
        res.statusCode = 401;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(renderLoginPage(opts, req.url ?? '/'));
        return;
    }
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('www-authenticate', 'Bearer realm="harnessa-fe"');
    res.end(
        JSON.stringify({
            error: 'unauthorized',
            message:
                'Missing or invalid token. Provide Authorization: Bearer <token>, ?token=<token>, or the harnessa_fe_token cookie.',
        }),
    );
}

/**
 * Handle POST {loginPath}: read form body, verify token, set cookie, 303 → next.
 */
export async function handleLoginPost(
    req: IncomingMessage,
    res: ServerResponse,
    opts: AuthOptions,
): Promise<void> {
    if (!isAuthEnabled(opts) || opts.authorize) {
        // Auth disabled, or the host owns auth via a custom predicate — the
        // built-in login form isn't meaningful here. Redirect home.
        res.statusCode = 303;
        res.setHeader('location', '/');
        res.end();
        return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 4096;
    for await (const c of req) {
        const buf = c as Buffer;
        total += buf.length;
        if (total > MAX) {
            res.statusCode = 413;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end('payload too large');
            return;
        }
        chunks.push(buf);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const form = new URLSearchParams(body);
    const token = form.get('token') ?? '';
    const next = safeNext(form.get('next') ?? '/');

    if (!verifyToken(token, opts.token!)) {
        res.statusCode = 401;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(renderLoginPage(opts, next, 'Invalid token. Try again.'));
        return;
    }

    const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
    // 30 days. HttpOnly so JS can't read it; SameSite=Lax so cross-tab nav works.
    const cookie = `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
    res.statusCode = 303;
    res.setHeader('set-cookie', cookie);
    res.setHeader('location', next);
    res.end();
}

/**
 * Allow only same-origin relative paths as the post-login redirect. Anything
 * else degrades to "/" so a crafted form can't redirect to an external site.
 */
function safeNext(next: string): string {
    if (typeof next !== 'string') return '/';
    if (!next.startsWith('/')) return '/';
    if (next.startsWith('//')) return '/';
    return next;
}

function parseCookieHeader(raw: string | undefined): Record<string, string> {
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

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => {
        switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
        }
    });
}

function renderLoginPage(opts: AuthOptions, next: string, error?: string): string {
    const loginPath = opts.loginPath ?? DEFAULT_LOGIN_PATH;
    const safeN = escapeHtml(safeNext(next));
    const errBlock = error
        ? `<p style="color:#c0392b;margin:0 0 12px">${escapeHtml(error)}</p>`
        : '';
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>harnessa-fe — sign in</title>
<style>
body{font:14px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#fafafa;color:#222;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
form{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;max-width:360px;width:100%;box-shadow:0 4px 12px rgba(0,0,0,.04)}
h1{font-size:16px;margin:0 0 12px}
input[type=password]{display:block;width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;margin-bottom:12px}
button{display:block;width:100%;padding:10px;background:#111;color:#fff;border:0;border-radius:6px;font-size:14px;cursor:pointer}
.muted{color:#666;font-size:12px;margin-top:12px}
</style></head>
<body>
<form method="post" action="${escapeHtml(loginPath)}" autocomplete="off">
  <h1>harnessa-fe</h1>
  ${errBlock}
  <input type="password" name="token" placeholder="token" autofocus required>
  <input type="hidden" name="next" value="${safeN}">
  <button type="submit">Sign in</button>
  <p class="muted">Paste the token from the daemon startup banner.</p>
</form>
</body></html>`;
}
