/**
 * Gateway admin panel (5.0 · P6 · C5) — plain HTML + fetch (no SPA framework).
 * Cookie-session auth (admin password via scrypt); pages for tokens / servers /
 * audit. Mounted by createGateway before the /mcp proxy.
 *
 * Routes (all under /admin):
 *   GET  /admin/login        login form
 *   POST /admin/login        verify → session cookie → redirect /admin
 *   POST /admin/logout       drop session
 *   GET  /admin              dashboard (servers + tokens + audit)
 *   GET  /admin/api/servers  | POST (add) | POST /admin/api/servers/remove
 *   GET  /admin/api/tokens   | POST (create → raw shown once) | POST /admin/api/tokens/revoke
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

function html(res: ServerResponse, status: number, body: string): void {
    res.statusCode = status;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(body);
}

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, body: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:880px;margin:32px auto;padding:0 16px;color:#1a1a1a}h1{font-size:18px}h2{font-size:15px;margin-top:28px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}button{cursor:pointer}input,select{padding:6px;border:1px solid #d1d5db;border-radius:6px}code{background:#f6f6f7;padding:2px 5px;border-radius:4px}form.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}</style></head><body>${body}</body></html>`;
}

function loginPage(error?: string): string {
    return page('harness-fe gateway — sign in', `<h1>harness-fe gateway</h1>
${error ? `<p style="color:#c0392b">${esc(error)}</p>` : ''}
<form class="row" method="post" action="/admin/login">
  <input name="username" placeholder="username" autofocus required>
  <input type="password" name="password" placeholder="password" required>
  <button type="submit">Sign in</button>
</form>`);
}

function dashboardPage(): string {
    // Data is loaded client-side via the JSON API so the page stays static.
    return page('harness-fe gateway — admin', `<h1>harness-fe gateway</h1>
<form class="row" method="post" action="/admin/logout"><button>Sign out</button></form>

<h2>Servers (daemons)</h2>
<form class="row" id="srvForm">
  <input name="name" placeholder="name" required><input name="env" placeholder="env (dev/prod)" required>
  <input name="endpoint" placeholder="http://host:port" size="24" required>
  <input name="token" placeholder="daemon token (optional)">
  <button>Add server</button>
</form>
<table id="servers"><thead><tr><th>name</th><th>env</th><th>endpoint</th><th></th></tr></thead><tbody></tbody></table>

<h2>Tokens</h2>
<form class="row" id="tokForm">
  <input name="name" placeholder="name" required>
  <select name="serverId" id="tokServer"></select>
  <label><input type="checkbox" name="read" checked>read</label>
  <label><input type="checkbox" name="control" checked>control</label>
  <button>Create token</button>
</form>
<p id="newtok"></p>
<table id="tokens"><thead><tr><th>name</th><th>server</th><th>scopes</th><th>state</th><th></th></tr></thead><tbody></tbody></table>

<h2>Audit (latest 100)</h2>
<table id="audit"><thead><tr><th>time</th><th>tool</th><th>token</th><th>server</th><th>ip</th></tr></thead><tbody></tbody></table>

<script>
const j=(u,o)=>fetch(u,o).then(r=>r.json());
async function refresh(){
  const servers=await j('/admin/api/servers');
  const tokens=await j('/admin/api/tokens');
  const audit=await j('/admin/api/audit');
  const sIdName={};servers.forEach(s=>sIdName[s.id]=s.name);
  document.querySelector('#servers tbody').innerHTML=servers.map(s=>\`<tr><td>\${s.name}</td><td>\${s.env}</td><td><code>\${s.endpoint}</code></td><td><button onclick="rmSrv('\${s.id}')">remove</button></td></tr>\`).join('');
  document.querySelector('#tokServer').innerHTML=servers.map(s=>\`<option value="\${s.id}">\${s.name}</option>\`).join('');
  document.querySelector('#tokens tbody').innerHTML=tokens.map(t=>\`<tr><td>\${t.name}</td><td>\${sIdName[t.serverId]||t.serverId}</td><td>\${(t.scopes||[]).join('+')}</td><td>\${t.revokedAt?'revoked':(t.expiresAt&&Date.now()>t.expiresAt?'expired':'active')}</td><td>\${t.revokedAt?'':\`<button onclick="revoke('\${t.id}')">revoke</button>\`}</td></tr>\`).join('');
  document.querySelector('#audit tbody').innerHTML=audit.slice().reverse().map(a=>\`<tr><td>\${new Date(a.ts).toLocaleString()}</td><td>\${a.tool||''}</td><td>\${a.tokenId||''}</td><td>\${sIdName[a.serverId]||a.serverId||''}</td><td>\${a.ip||''}</td></tr>\`).join('');
}
document.querySelector('#srvForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));await j('/admin/api/servers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f)});e.target.reset();refresh();};
document.querySelector('#tokForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const scopes=[];if(fd.get('read'))scopes.push('read');if(fd.get('control'))scopes.push('control');const r=await j('/admin/api/tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:fd.get('name'),serverId:fd.get('serverId'),scopes})});document.querySelector('#newtok').innerHTML='New token (copy now, shown once): <code>'+r.raw+'</code>';e.target.reset();refresh();};
window.rmSrv=async id=>{await j('/admin/api/servers/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});refresh();};
window.revoke=async id=>{await j('/admin/api/tokens/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});refresh();};
refresh();
</script>`);
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

        if (path === '/admin/login' && req.method === 'GET') {
            html(res, 200, loginPage());
            return true;
        }
        if (path === '/admin/login' && req.method === 'POST') {
            const form = new URLSearchParams(await readBody(req));
            const username = form.get('username') ?? '';
            const password = form.get('password') ?? '';
            if (!store.verifyAdmin(username, password)) {
                html(res, 401, loginPage('Invalid credentials.'));
                return true;
            }
            const sid = randomBytes(24).toString('base64url');
            sessions.add(sid);
            res.statusCode = 303;
            res.setHeader('set-cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
            res.setHeader('location', '/admin');
            res.end();
            return true;
        }
        if (path === '/admin/logout' && req.method === 'POST') {
            const sid = parseCookies(req)[COOKIE];
            if (sid) sessions.delete(sid);
            res.statusCode = 303;
            res.setHeader('set-cookie', `${COOKIE}=; Path=/; Max-Age=0`);
            res.setHeader('location', '/admin/login');
            res.end();
            return true;
        }

        if (!authed(req)) {
            if (path.startsWith('/admin/api/')) {
                json(res, 401, { error: 'unauthorized' });
            } else {
                res.statusCode = 303;
                res.setHeader('location', '/admin/login');
                res.end();
            }
            return true;
        }

        if (path === '/admin' && req.method === 'GET') {
            html(res, 200, dashboardPage());
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
