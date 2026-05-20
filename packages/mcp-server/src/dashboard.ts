/**
 * Dashboard — minimal HTML inspector for collected data.
 *
 * Routes (served on the same port as the WS bridge and the replay viewer):
 *   GET  /                          project list
 *   GET  /sessions/:id              session detail (tabs, recordings, timeline, exports)
 *   POST /sessions/:id/replay       body { since, until, tabId? } → 302 to /replay/:exportId
 *
 * Pure server-rendered HTML, no client-side framework.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IStore, RecordingChunkSummary, ReplayExportMeta, SessionMeta, StoreEvent } from './store/index.js';
import { createReplayExport } from './replayCreate.js';

function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (ch) => {
        switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
        }
    });
}

function fmtTs(ts: number | undefined): string {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.toLocaleString()}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function fmtDur(ms: number): string {
    if (!isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtBytes(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

const CSS = `
  *,*::before,*::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #0f1115; color: #e7e9ee; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  a { color: #6cf; text-decoration: none; }
  a:hover { text-decoration: underline; }
  header { padding: 16px 24px; border-bottom: 1px solid #2a2d35; display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .breadcrumb { color: #8b8f99; font-size: 13px; }
  main { padding: 20px 24px; max-width: 1200px; }
  section { margin-bottom: 28px; }
  section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #8b8f99; margin: 0 0 10px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; background: #161922; border: 1px solid #242832; border-radius: 6px; overflow: hidden; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #242832; font-size: 13px; vertical-align: top; }
  th { background: #1c2028; color: #aab0bd; font-weight: 600; font-size: 12px; }
  tr:last-child td { border-bottom: none; }
  code { background: #1c2028; padding: 1px 6px; border-radius: 3px; font-family: "SF Mono", Consolas, monospace; font-size: 12px; color: #cdd1da; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .tag-err { background: #4a1a1a; color: #ff8b8b; }
  .tag-log { background: #1a2c3d; color: #8bd1ff; }
  .tag-net { background: #1f3320; color: #8be08b; }
  .tag-cmd { background: #2b1f3d; color: #c9a3ff; }
  .tag-applog { background: #2a1f3d; color: #d4aaff; }
  .tag-other { background: #2a2d35; color: #aab0bd; }
  button, .btn { background: #2a5cf7; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; font: inherit; cursor: pointer; font-size: 12px; font-weight: 600; }
  button:hover, .btn:hover { background: #4172ff; }
  .muted { color: #6b6f7a; }
  .empty { padding: 16px; color: #6b6f7a; font-style: italic; }
  pre { margin: 0; padding: 8px; background: #0c0e13; border-radius: 4px; overflow-x: auto; font-size: 12px; max-width: 480px; }
`;

function page(title: string, breadcrumb: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1><a href="/" style="color:inherit">Harnessa dev console</a></h1>
  <span class="breadcrumb">${breadcrumb}</span>
</header>
<main>${body}</main>
</body>
</html>`;
}

function timelineRowTag(t: string): string {
    if (t === 'err') return '<span class="tag tag-err">err</span>';
    if (t === 'log' || t === 'node:log') return `<span class="tag tag-log">${escapeHtml(t)}</span>`;
    if (t === 'req' || t === 'res') return `<span class="tag tag-net">${escapeHtml(t)}</span>`;
    if (t === 'cmd' || t === 'resp') return `<span class="tag tag-cmd">${escapeHtml(t)}</span>`;
    if (t === 'app-log') return '<span class="tag tag-applog">app-log</span>';
    return `<span class="tag tag-other">${escapeHtml(t)}</span>`;
}

function eventDigest(ev: StoreEvent): string {
    try {
        const d = (ev as unknown as { d?: unknown }).d;
        const raw = JSON.stringify(d ?? ev);
        if (!raw) return '';
        return raw.length > 240 ? raw.slice(0, 240) + '…' : raw;
    } catch { return ''; }
}

function renderProjectList(store: IStore): string {
    const projects = store.listProjects();
    if (projects.length === 0) {
        return page('Harnessa', '', '<section><h2>Projects</h2><div class="empty">No projects yet. Start a dev server with the harnessa-fe plugin.</div></section>');
    }
    const rows = projects.map((p) => {
        const sessions = store.listSessions({ projectId: p.id, limit: 5 });
        const sessionList = sessions.length === 0
            ? '<span class="muted">no sessions yet</span>'
            : sessions.map((s) => {
                const closed = s.endedAt ? ` <span class="muted">· closed ${fmtTs(s.endedAt)}</span>` : ' <span class="tag tag-net">live</span>';
                return `<div><a href="/sessions/${encodeURIComponent(s.id)}"><code>${escapeHtml(s.id)}</code></a> <span class="muted">started ${fmtTs(s.startedAt)}</span>${closed}</div>`;
            }).join('');
        return `<tr>
            <td><code>${escapeHtml(p.id)}</code></td>
            <td>${sessionList}</td>
            <td class="muted">${fmtTs(p.lastActiveAt)}</td>
        </tr>`;
    }).join('');
    return page('Harnessa — projects', `${projects.length} project${projects.length === 1 ? '' : 's'}`, `
<section>
  <h2>Projects</h2>
  <table>
    <thead><tr><th>Project</th><th>Recent sessions</th><th>Last active</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`);
}

function renderSessionDetail(store: IStore, session: SessionMeta): string {
    const sessionId = session.id;
    // Tabs
    const summary = store.summary(sessionId);
    const tabIds = summary.tabs;
    // Recordings (all tabs)
    const allChunks = store.listRecordings(sessionId);
    const byTab = new Map<string, RecordingChunkSummary[]>();
    for (const c of allChunks) {
        if (!byTab.has(c.tabId)) byTab.set(c.tabId, []);
        byTab.get(c.tabId)!.push(c);
    }
    // Timeline (last 50 of any type)
    const timeline = store.tail(sessionId, { n: 50 });
    // Exports for this project (derive projectId from first participant)
    const sessionProjectId = session.participants[0]?.projectId ?? 'unknown';
    const exports = store.listExports(sessionProjectId, 25).filter((m) => m.sessionId === sessionId);

    const tabsRows = tabIds.length === 0
        ? '<tr><td colspan="3" class="empty">No tabs registered.</td></tr>'
        : tabIds.map((tabId) => {
            const chunks = byTab.get(tabId) ?? [];
            const span = chunks.length === 0
                ? '<span class="muted">no recording</span>'
                : `${chunks.length} chunks · ${fmtTs(chunks[0].startTs)} → ${fmtTs(chunks[chunks.length - 1].endTs)} (${fmtDur(chunks[chunks.length - 1].endTs - chunks[0].startTs)})`;
            const action = chunks.length >= 1 ? `
<form method="POST" action="/sessions/${encodeURIComponent(sessionId)}/replay" style="display:inline">
  <input type="hidden" name="tabId" value="${escapeHtml(tabId)}" />
  <input type="hidden" name="since" value="${chunks[0].startTs}" />
  <input type="hidden" name="until" value="${chunks[chunks.length - 1].endTs}" />
  <button type="submit">▶ Create replay</button>
</form>` : '';
            return `<tr><td><code>${escapeHtml(tabId)}</code></td><td>${span}</td><td>${action}</td></tr>`;
        }).join('');

    const chunksRows = allChunks.length === 0
        ? '<tr><td colspan="5" class="empty">No rrweb chunks captured yet.</td></tr>'
        : allChunks.map((c) => `<tr>
            <td><code>${escapeHtml(c.chunkId)}</code></td>
            <td><code>${escapeHtml(c.tabId)}</code></td>
            <td>${fmtTs(c.startTs)}</td>
            <td>${fmtDur(c.endTs - c.startTs)}</td>
            <td>${c.eventCount}</td>
        </tr>`).join('');

    const timelineRows = timeline.length === 0
        ? '<tr><td colspan="3" class="empty">Timeline is empty.</td></tr>'
        : timeline.map((ev) => `<tr>
            <td>${timelineRowTag(ev.t)}</td>
            <td class="muted">${fmtTs(ev.ts)}</td>
            <td><pre>${escapeHtml(eventDigest(ev))}</pre></td>
        </tr>`).join('');

    const exportsRows = exports.length === 0
        ? '<tr><td colspan="5" class="empty">No replay exports yet for this session.</td></tr>'
        : exports.map((e) => `<tr>
            <td><a href="/replay/${encodeURIComponent(e.exportId)}"><code>${escapeHtml(e.exportId)}</code></a></td>
            <td><code>${escapeHtml(e.tabId ?? '—')}</code></td>
            <td>${fmtTs(e.startTs)} → ${fmtTs(e.endTs)}</td>
            <td>${e.eventCount} events · ${fmtBytes(e.bytes)}</td>
            <td>${escapeHtml(e.label ?? '')}</td>
        </tr>`).join('');

    return page(
        `Session ${sessionId}`,
        `<a href="/">projects</a> · <code>${escapeHtml(sessionProjectId)}</code> · session <code>${escapeHtml(sessionId)}</code>`,
        `
<section>
  <h2>Session</h2>
  <table>
    <tbody>
      <tr><th>Project</th><td><code>${escapeHtml(sessionProjectId)}</code></td></tr>
      <tr><th>Tab</th><td><code>${escapeHtml(session.tabId)}</code></td></tr>
      <tr><th>Started</th><td>${fmtTs(session.startedAt)}</td></tr>
      <tr><th>Ended</th><td>${session.endedAt ? fmtTs(session.endedAt) : '<span class="tag tag-net">live</span>'}</td></tr>
      <tr><th>Counts</th><td>${Object.entries(summary.counts ?? {}).map(([k, v]) => `<code>${escapeHtml(k)}</code>=${v}`).join(' ') || '<span class="muted">—</span>'}</td></tr>
    </tbody>
  </table>
</section>

<section>
  <h2>Tabs &amp; recordings</h2>
  <table>
    <thead><tr><th>Tab</th><th>Coverage</th><th>Quick replay</th></tr></thead>
    <tbody>${tabsRows}</tbody>
  </table>
</section>

<section>
  <h2>Recording chunks (${allChunks.length})</h2>
  <table>
    <thead><tr><th>Chunk</th><th>Tab</th><th>Start</th><th>Span</th><th>Events</th></tr></thead>
    <tbody>${chunksRows}</tbody>
  </table>
</section>

<section>
  <h2>Replay exports (${exports.length})</h2>
  <table>
    <thead><tr><th>Export</th><th>Tab</th><th>Window</th><th>Size</th><th>Label</th></tr></thead>
    <tbody>${exportsRows}</tbody>
  </table>
</section>

<section>
  <h2>Recent timeline (last ${timeline.length})</h2>
  <table>
    <thead><tr><th>Type</th><th>When</th><th>Payload</th></tr></thead>
    <tbody>${timelineRows}</tbody>
  </table>
</section>
`);
}

async function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c as Buffer));
        req.on('end', () => {
            const ct = (req.headers['content-type'] ?? '').toLowerCase();
            const raw = Buffer.concat(chunks).toString('utf-8');
            try {
                if (ct.includes('application/json')) {
                    resolve(JSON.parse(raw || '{}'));
                    return;
                }
                // application/x-www-form-urlencoded (default for <form>)
                const out: Record<string, string> = {};
                for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
                resolve(out);
            } catch (err) { reject(err); }
        });
        req.on('error', reject);
    });
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
    res.statusCode = status;
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'no-store');
    res.end(body);
}

export function createDashboardHandler(store: IStore, getBaseUrl: () => string | undefined): (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean> {
    return async (req, res) => {
        if (!req.url) return false;
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;
        const method = req.method ?? 'GET';

        if (method === 'GET' && (path === '/' || path === '/index.html')) {
            send(res, 200, 'text/html; charset=utf-8', renderProjectList(store));
            return true;
        }

        const sessionMatch = path.match(/^\/sessions\/([^/]+)(\/replay)?$/);
        if (sessionMatch) {
            const sessionId = decodeURIComponent(sessionMatch[1]);
            const isReplay = !!sessionMatch[2];

            if (isReplay && method === 'POST') {
                const body = await readFormBody(req);
                const sinceRaw = body.since;
                const untilRaw = body.until;
                const tsRaw = body.ts;
                const since = sinceRaw ? Number(sinceRaw) : undefined;
                const until = untilRaw ? Number(untilRaw) : undefined;
                const ts = tsRaw ? Number(tsRaw) : undefined;
                const tabId = body.tabId || undefined;
                const label = body.label || undefined;
                const result = createReplayExport(store, getBaseUrl(), { sessionId, tabId, since, until, ts, label });
                if (result.error || !result.exportId) {
                    send(res, 400, 'text/html; charset=utf-8',
                        page('Replay failed', '', `<section><h2>Replay failed</h2><div class="empty">${escapeHtml(result.error ?? 'unknown')}</div><div style="margin-top:12px"><a href="/sessions/${encodeURIComponent(sessionId)}">← back</a></div></section>`));
                    return true;
                }
                res.statusCode = 302;
                res.setHeader('location', `/replay/${result.exportId}`);
                res.end();
                return true;
            }

            if (method === 'GET') {
                const session = store.getSession(sessionId);
                if (!session) {
                    send(res, 404, 'text/html; charset=utf-8', page('Not found', '', `<section><div class="empty">No such session: <code>${escapeHtml(sessionId)}</code></div></section>`));
                    return true;
                }
                send(res, 200, 'text/html; charset=utf-8', renderSessionDetail(store, session));
                return true;
            }
        }

        return false;
    };
}

// Helper for tests / unused-export removal.
export { renderProjectList as __renderProjectList, renderSessionDetail as __renderSessionDetail };
