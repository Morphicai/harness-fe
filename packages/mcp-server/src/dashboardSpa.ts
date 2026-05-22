/**
 * HTTP handler that serves the React SPA built by `@harnessa-fe/dashboard-ui`.
 *
 * Routing rules (after the `isAuthorized` middleware in bridge.ts):
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

const require = createRequire(import.meta.url);

function resolveDashboardDist(): string | undefined {
    try {
        const pkgPath = require.resolve('@harnessa-fe/dashboard-ui/package.json');
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
        if (!path.startsWith('/dashboard')) return false;
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') return false;

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
