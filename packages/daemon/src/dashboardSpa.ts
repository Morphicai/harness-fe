/**
 * HTTP handler that serves the React SPA built by `@harness-fe/dashboard-ui`.
 *
 * Routing rules (after the `isAuthorized` middleware in bridge.ts):
 *   - GET /                          → 302 to /dashboard/?token=<preserved> (legacy root)
 *   - GET /sessions/:id              → 302 to /dashboard/sessions/:id?token=… (legacy bookmarks)
 *   - GET /dashboard                 → 302 to /dashboard/?token=<preserved>
 *   - GET /dashboard/                → serve index.html (SPA shell)
 *   - GET /dashboard/<asset.ext>     → serve that file from dist/ (if it exists)
 *   - GET /dashboard/<other-path>    → serve index.html (SPA client-side routing)
 *
 * The dist directory is resolved at module load via `require.resolve()` on
 * the dashboard-ui package — same trick `replayViewer.ts` uses for
 * rrweb-player. No copy step needed; pnpm workspace symlinks just work in
 * dev, and `pnpm deploy` bundles the dist into the published tarball.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_COOKIE_NAME } from './auth.js';

const require = createRequire(import.meta.url);

/**
 * If a request arrived with `?token=` AND no harness_fe_token cookie yet,
 * stamp the cookie and 302 back to the same path without the query.
 *
 * Why this matters: the SPA bundle is loaded by the browser as
 * `<script src="/dashboard/assets/index-XXX.js">` — relative paths without
 * the token query — which would 401 against the upstream auth middleware.
 * Setting the cookie on the first HTML request means every subsequent
 * same-origin fetch (assets, /api/*, WebSocket upgrade) is automatically
 * authenticated, and the visible URL stays clean.
 */
function maybeHandleTokenHandoff(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
    const tokenInQuery = url.searchParams.get('token');
    if (!tokenInQuery) return false;
    // If the cookie's already set with the same value, nothing to do —
    // pass through (the browser will follow links without ?token=).
    const cookies = req.headers.cookie ?? '';
    if (cookies.includes(`${DEFAULT_COOKIE_NAME}=`)) return false;
    // Strip token from the URL and 302 back to the canonical path so the
    // browser bookmarks / shares clean URLs. The cookie carries auth from
    // here on. Also normalize `/dashboard` → `/dashboard/` in the same hop
    // so we don't waste a second redirect chasing the trailing slash.
    url.searchParams.delete('token');
    const canonicalPath = url.pathname === '/dashboard' ? '/dashboard/' : url.pathname;
    const remaining = url.searchParams.toString();
    const clean = `${canonicalPath}${remaining ? '?' + remaining : ''}`;
    const cookie =
        `${DEFAULT_COOKIE_NAME}=${encodeURIComponent(tokenInQuery)}; ` +
        // Path=/ so /api/*, /replay/*, /dashboard/* all see it.
        // SameSite=Lax keeps the cookie on cross-tab nav.
        // No HttpOnly: the SPA's WS code may want to surface the token in
        //   a Bearer header for tools that don't share cookies (rare —
        //   browsers attach cookies to WS, so this is just defense in depth).
        // 30-day Max-Age matches the /__auth login flow.
        `Path=/; SameSite=Lax; Max-Age=2592000`;
    res.statusCode = 302;
    res.setHeader('set-cookie', cookie);
    res.setHeader('location', clean);
    res.setHeader('cache-control', 'no-store');
    res.end();
    return true;
}

function resolveDashboardDist(): string | undefined {
    try {
        const pkgPath = require.resolve('@harness-fe/dashboard-ui/package.json');
        const dist = join(dirname(pkgPath), 'dist');
        return existsSync(join(dist, 'index.html')) ? dist : undefined;
    } catch {
        return undefined;
    }
}

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
    return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function createDashboardSpaHandler(): (
    req: IncomingMessage,
    res: ServerResponse,
) => boolean {
    const dist = resolveDashboardDist();
    return (req, res) => {
        if (!req.url) return false;
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') return false;

        // Legacy paths from the old server-rendered dashboard — redirect into
        // the SPA preserving the token query so the user stays authenticated.
        if (path === '/' || path === '/index.html') {
            res.statusCode = 302;
            res.setHeader('location', `/dashboard/${url.search ?? ''}`);
            res.end();
            return true;
        }
        const legacySession = path.match(/^\/sessions\/([^/]+)$/);
        if (legacySession) {
            const sid = legacySession[1];
            res.statusCode = 302;
            res.setHeader('location', `/dashboard/sessions/${sid}${url.search ?? ''}`);
            res.end();
            return true;
        }

        if (!path.startsWith('/dashboard')) return false;

        // First-load token handoff: ?token=… → cookie + redirect.
        // Skip for static asset paths; setting the cookie there would still
        // work but the redirect would break the script tag's request chain.
        if (!path.startsWith('/dashboard/assets/') && !path.startsWith('/dashboard/static/')) {
            if (maybeHandleTokenHandoff(req, res, url)) return true;
        }

        // If dashboard-ui isn't installed (someone using an older deploy
        // or running tests in isolation), fall through with a friendly
        // 503 rather than 404 — clearer signal than silent miss.
        if (!dist) {
            res.statusCode = 503;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end('Dashboard UI is not bundled with this build.');
            return true;
        }

        // /dashboard with no trailing slash → redirect, preserving token.
        if (path === '/dashboard') {
            const search = url.search ?? '';
            res.statusCode = 302;
            res.setHeader('location', `/dashboard/${search}`);
            res.end();
            return true;
        }

        // Strip the `/dashboard/` prefix to get the relative path inside dist.
        const rel = path.slice('/dashboard/'.length) || 'index.html';

        // Path traversal defense: resolve against dist and require the
        // result is still inside dist. Without this, a crafted URL like
        // `/dashboard/../../etc/passwd` would escape.
        const candidate = resolvePath(dist, rel);
        if (!candidate.startsWith(dist + (dist.endsWith('/') ? '' : '/')) && candidate !== dist) {
            res.statusCode = 403;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end('Forbidden');
            return true;
        }

        // Serve the file if it exists; otherwise fall back to index.html
        // so the SPA's client-side router can take over (this is how /sessions/:id
        // works without server config).
        const target = existsSync(candidate) ? candidate : join(dist, 'index.html');
        try {
            const body = readFileSync(target);
            res.statusCode = 200;
            res.setHeader('content-type', contentTypeFor(target));
            // Hashed assets are immutable; HTML shells should never cache.
            const isHashed = /\/assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(target);
            res.setHeader(
                'cache-control',
                isHashed ? 'public, max-age=31536000, immutable' : 'no-store',
            );
            res.end(body);
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end(`dashboard read error: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
    };
}
