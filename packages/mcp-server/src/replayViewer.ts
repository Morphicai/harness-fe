/**
 * Replay viewer — HTTP routes for serving exported rrweb recordings.
 *
 * Routes (all served on the same port as the WS bridge):
 *   GET /replay/:id           HTML viewer page (rrweb-player UI)
 *   GET /replay/:id.json      Raw events array for the player to fetch
 *   GET /replay/static/player.js   Bundled rrweb-player (UMD)
 *   GET /replay/static/player.css  Bundled rrweb-player styles
 *
 * The HTML page loads the static assets relatively and then calls
 * /replay/:id.json to hydrate the player. This keeps the viewer self-contained
 * and offline-capable — no CDN dependencies.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IStore } from './store/index.js';

const require = createRequire(import.meta.url);

/** Locate the bundled rrweb-player dist directory. */
function resolvePlayerDist(): string {
    // rrweb-player exposes package.json; use it to find the dist folder.
    const pkgPath = require.resolve('rrweb-player/package.json');
    return join(dirname(pkgPath), 'dist');
}

const PLAYER_DIST = (() => {
    try { return resolvePlayerDist(); } catch { return ''; }
})();

const VIEWER_HTML = (exportId: string, meta: { sessionId: string; tabId?: string; durationMs: number; eventCount: number }): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Harnessa replay · ${escapeHtml(exportId)}</title>
<link rel="stylesheet" href="/replay/static/player.css" />
<style>
  html, body { margin: 0; padding: 0; background: #1a1a1a; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .meta { padding: 12px 16px; font-size: 13px; color: #aaa; border-bottom: 1px solid #333; }
  .meta code { color: #6cf; }
  .stage { padding: 16px; display: flex; justify-content: center; }
  .error { padding: 24px; color: #f66; }
</style>
</head>
<body>
<div class="meta">
  Replay <code>${escapeHtml(exportId)}</code> · session <code>${escapeHtml(meta.sessionId)}</code>${meta.tabId ? ` · tab <code>${escapeHtml(meta.tabId)}</code>` : ''} · ${meta.eventCount} events · ${Math.round(meta.durationMs / 100) / 10}s
</div>
<div class="stage" id="stage"></div>
<script src="/replay/static/player.js"></script>
<script>
  (async function() {
    const stage = document.getElementById('stage');
    try {
      const resp = await fetch(${JSON.stringify(`/replay/${exportId}.json`)});
      if (!resp.ok) throw new Error('failed to fetch events: ' + resp.status);
      const events = await resp.json();
      if (!Array.isArray(events) || events.length < 2) {
        throw new Error('export has fewer than 2 events — cannot play back');
      }
      // rrwebPlayer is the UMD global.
      new rrwebPlayer({
        target: stage,
        props: {
          events,
          autoPlay: true,
          showController: true,
          width: Math.min(1280, window.innerWidth - 64),
          height: Math.min(720, window.innerHeight - 120),
        },
      });
    } catch (err) {
      stage.innerHTML = '<div class="error">Replay failed: ' + (err && err.message ? String(err.message).replace(/[<>&]/g, '') : 'unknown error') + '</div>';
      console.error('[harnessa replay]', err);
    }
  })();
</script>
</body>
</html>`;

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => {
        switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
        }
    });
}

function send(res: ServerResponse, status: number, contentType: string, body: string | Buffer): void {
    res.statusCode = status;
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'no-store');
    res.end(body);
}

/**
 * Build a handler that dispatches /replay/* requests. Returns undefined for
 * non-replay paths so the caller can chain or 404.
 */
export function createReplayHandler(store: IStore): (req: IncomingMessage, res: ServerResponse) => boolean {
    return (req, res) => {
        if (!req.url) return false;
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;
        if (!path.startsWith('/replay/')) return false;

        // Static assets
        if (path === '/replay/static/player.js') {
            if (!PLAYER_DIST) return reply500(res, 'rrweb-player not installed');
            const file = join(PLAYER_DIST, 'index.js');
            if (!existsSync(file)) return reply500(res, 'rrweb-player bundle missing');
            send(res, 200, 'application/javascript; charset=utf-8', readFileSync(file));
            return true;
        }
        if (path === '/replay/static/player.css') {
            if (!PLAYER_DIST) return reply500(res, 'rrweb-player not installed');
            const file = join(PLAYER_DIST, 'style.css');
            if (!existsSync(file)) return reply500(res, 'rrweb-player styles missing');
            send(res, 200, 'text/css; charset=utf-8', readFileSync(file));
            return true;
        }

        // /replay/:id or /replay/:id.json
        const tail = path.slice('/replay/'.length);
        if (!tail || tail.includes('/')) {
            send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
            return true;
        }
        const isJson = tail.endsWith('.json');
        const exportId = isJson ? tail.slice(0, -'.json'.length) : tail;
        if (!/^[A-Za-z0-9_-]+$/.test(exportId)) {
            send(res, 400, 'text/plain; charset=utf-8', 'Invalid export id');
            return true;
        }

        const meta = store.getExport(exportId);
        if (!meta) {
            send(res, 404, 'text/plain; charset=utf-8', `Unknown export: ${exportId}`);
            return true;
        }

        if (isJson) {
            const events = store.readExportEvents(exportId);
            if (!events) {
                send(res, 404, 'application/json; charset=utf-8', '{"error":"export events missing"}');
                return true;
            }
            send(res, 200, 'application/json; charset=utf-8', JSON.stringify(events));
            return true;
        }

        const html = VIEWER_HTML(exportId, {
            sessionId: meta.sessionId,
            tabId: meta.tabId,
            durationMs: Math.max(0, meta.endTs - meta.startTs),
            eventCount: meta.eventCount,
        });
        send(res, 200, 'text/html; charset=utf-8', html);
        return true;
    };

    function reply500(res: ServerResponse, msg: string): true {
        send(res, 500, 'text/plain; charset=utf-8', msg);
        return true;
    }
}
