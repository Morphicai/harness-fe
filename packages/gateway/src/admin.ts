/**
 * Gateway governance HTTP API (cookie-session auth; admin password via scrypt).
 *
 * The UI lives entirely in the console SPA (@harness-fe/console-ui at /console)
 * — there is NO server-rendered admin page or /admin/login form anymore. Sign-in
 * is unified at /console (the SPA's SignIn posts to /admin/login). Legacy GET
 * URLs redirect to /console so old bookmarks still land somewhere sensible.
 *
 * Routes (all under /admin):
 *   GET  /admin, /admin/login → 303 /console   (legacy → unified SPA)
 *   POST /admin/login         verify → session cookie → 303 /console (401 JSON on bad creds)
 *   POST /admin/logout        drop session → 303 /console
 *   GET  /admin/api/servers   | POST (add) | POST /admin/api/servers/remove
 *   GET  /admin/api/tokens    | POST (create → raw shown once) | POST /admin/api/tokens/revoke
 *   GET  /admin/api/audit
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GatewayStore, Scope } from './store.js';

const COOKIE = 'hfe_gw_admin';

function parseCookies(req: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = req.headers.cookie;
    if (!raw) return out;
    for (const part of raw.split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return out;
}

async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of req) {
        total += (c as Buffer).length;
        if (total > 64 * 1024) break;
        chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
    res.statusCode = 303;
    if (cookie) res.setHeader('set-cookie', cookie);
    res.setHeader('location', location);
    res.end();
}

export interface AdminHandler {
    /** Process `/admin/*`; resolves true when it handled the request. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
    /** True when the request carries a valid admin session cookie. */
    isAuthed(req: IncomingMessage): boolean;
}

/**
 * Returns the `/admin/*` governance handler + an `isAuthed` predicate. The admin
 * session cookie is `Path=/` so it also authenticates the operator on the
 * `/console` data API (the console data face treats an admin session as
 * "see everything").
 */
export function createAdminHandler(store: GatewayStore): AdminHandler {
    const sessions = new Set<string>();

    function authed(req: IncomingMessage): boolean {
        const sid = parseCookies(req)[COOKIE];
        return !!sid && sessions.has(sid);
    }

    const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== '/admin' && !path.startsWith('/admin/')) return false;

        // Legacy server-rendered pages are gone — sign-in + governance UI live in
        // the console SPA. Send old GET URLs there.
        if ((path === '/admin' || path === '/admin/login') && req.method === 'GET') {
            redirect(res, '/console');
            return true;
        }
        if (path === '/admin/login' && req.method === 'POST') {
            const form = new URLSearchParams(await readBody(req));
            const username = form.get('username') ?? '';
            const password = form.get('password') ?? '';
            if (!store.verifyAdmin(username, password)) {
                json(res, 401, { error: 'invalid credentials' });
                return true;
            }
            const sid = randomBytes(24).toString('base64url');
            sessions.add(sid);
            redirect(res, '/console', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
            return true;
        }
        if (path === '/admin/logout' && req.method === 'POST') {
            const sid = parseCookies(req)[COOKIE];
            if (sid) sessions.delete(sid);
            redirect(res, '/console', `${COOKIE}=; Path=/; Max-Age=0`);
            return true;
        }

        // Everything else under /admin is the governance JSON API — admin only.
        if (!authed(req)) {
            json(res, 401, { error: 'unauthorized' });
            return true;
        }

        if (path === '/admin/api/servers' && req.method === 'GET') {
            json(res, 200, store.listServers());
            return true;
        }
        if (path === '/admin/api/servers' && req.method === 'POST') {
            const b = JSON.parse(await readBody(req)) as { name: string; endpoint: string; env: string; token?: string };
            json(res, 200, store.addServer(b));
            return true;
        }
        if (path === '/admin/api/servers/remove' && req.method === 'POST') {
            const b = JSON.parse(await readBody(req)) as { id: string };
            json(res, 200, { removed: store.removeServer(b.id) });
            return true;
        }
        if (path === '/admin/api/tokens' && req.method === 'GET') {
            json(res, 200, store.listTokens());
            return true;
        }
        if (path === '/admin/api/tokens' && req.method === 'POST') {
            const b = JSON.parse(await readBody(req)) as { name: string; serverId: string; scopes: Scope[]; expiresAt?: number };
            const { token, raw } = store.createToken(b);
            json(res, 200, { id: token.id, raw });
            return true;
        }
        if (path === '/admin/api/tokens/revoke' && req.method === 'POST') {
            const b = JSON.parse(await readBody(req)) as { id: string };
            json(res, 200, { revoked: store.revokeToken(b.id) });
            return true;
        }
        if (path === '/admin/api/audit' && req.method === 'GET') {
            json(res, 200, store.listAudit());
            return true;
        }

        json(res, 404, { error: 'not_found' });
        return true;
    };

    return { handle, isAuthed: authed };
}
