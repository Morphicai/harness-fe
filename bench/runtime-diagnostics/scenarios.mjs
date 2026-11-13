import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

export async function startScenario(kind, values) {
    const script = `
const byId = (id) => document.getElementById(id);
const cfg = ${JSON.stringify({ kind, code: values.code, key: values.key })};
function event(phase, data) { console.info(JSON.stringify({phase, tab: document.title, ...data})); }
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function exportReport() {
    const first = await fetch('/api/export?attempt=1', {method:'POST'});
    const firstBody = await first.json();
    event('export-response', {requestId:firstBody.requestId, status:first.status});
    byId('status').textContent = 'Retrying export';
    const next = await fetch('/api/export?attempt=2', {method:'POST'});
    const body = await next.json();
    event('export-response', {requestId:body.requestId, status:next.status, artifact:body.artifact});
    // The final response is successful; a delayed callback from attempt 1 wins the UI.
    await pause(120);
    byId('status').textContent = 'Export unavailable';
    byId('status').className = 'error';
    byId('detail').textContent = 'The export could not be completed. Please try again.';
    event('export-render', {requestId:firstBody.requestId, status:first.status});
    document.body.dataset.ready = 'yes';
}
let active = 'Conversation A';
async function consume(thread) {
    const res = await fetch('/api/reply?thread=' + thread);
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    for (;;) {
        const item = await reader.read(); if (item.done) break;
        pending += decoder.decode(item.value, {stream:true});
        let at;
        while ((at = pending.indexOf('\\n\\n')) >= 0) {
            const frame = pending.slice(0, at); pending = pending.slice(at + 2);
            const raw = frame.split('\\n').find(line => line.startsWith('data: '));
            if (!raw) continue;
            const chunk = JSON.parse(raw.slice(6));
            event('reply-frame', {requestId:chunk.requestId, thread:chunk.thread, frame:chunk.phase, active});
            if (chunk.phase === 'delta') {
                byId('detail').textContent += chunk.text;
                event('reply-render', {requestId:chunk.requestId, thread:chunk.thread, active});
            }
        }
    }
}
async function streamReply() {
    const first = consume('A');
    await pause(90); active = 'Conversation B';
    byId('status').textContent = active;
    byId('detail').textContent = '';
    event('conversation-switch', {active});
    const second = consume('B'); await Promise.all([first, second]);
    document.body.dataset.ready = 'yes';
}
async function cleanupPreferencesCache(operationId) {
    event('preferences-cache', {operationId, operation:'remove', storageKey:cfg.key});
    localStorage.removeItem(cfg.key);
}
async function refreshPreferences() {
    const res = await fetch('/api/preferences'); const body = await res.json();
    event('preferences-response', {requestId:body.requestId, operationId:body.operationId, status:res.status});
    await cleanupPreferencesCache(body.operationId);
    byId('status').textContent = 'Preferences refreshed';
    document.body.dataset.ready = 'yes';
}
if (cfg.kind === 'cross-tab-session') {
    if (location.pathname === '/preferences') {
        document.title = 'Preferences'; byId('heading').textContent = 'Preferences';
        byId('start').textContent = 'Refresh preferences';
        byId('start').onclick = refreshPreferences;
    } else {
        document.title = 'Overview'; byId('heading').textContent = 'Overview';
        byId('status').textContent = 'Signed in'; byId('start').hidden = true;
        if (!localStorage.getItem(cfg.key)) localStorage.setItem(cfg.key, 'fixture-active');
        window.addEventListener('storage', (e) => {
            if (e.key === cfg.key && e.newValue === null) {
                event('session-change', {storageKey:e.key, newValue:e.newValue, source:'storage-event'});
                byId('status').textContent = 'Session ended'; byId('status').className = 'error';
                byId('detail').textContent = 'Please sign in again.';
                document.body.dataset.ready = 'yes';
            }
        });
    }
} else {
    document.title = cfg.kind === 'export-stale-error' ? 'Exports' : 'Conversations';
    byId('heading').textContent = document.title;
    byId('start').onclick = cfg.kind === 'export-stale-error' ? exportReport : streamReply;
}
`;
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/api/export') {
            const retry = url.searchParams.get('attempt') === '2';
            res.writeHead(retry ? 200 : 503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ requestId: retry ? values.evidenceId : values.firstId,
                ...(retry ? { artifact: 'report.csv', completed: true } : { retryable: true }) }));
        } else if (url.pathname === '/api/reply') {
            const thread = url.searchParams.get('thread');
            const requestId = thread === 'A' ? values.evidenceId : values.firstId;
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            const send = (phase, text = '') => res.write(`event: ${phase}\ndata: ${JSON.stringify({ requestId, thread, phase, text })}\n\n`);
            send('start'); await sleep(thread === 'A' ? 500 : 80);
            send('delta', thread === 'A' ? ' [Earlier conversation fragment]' : 'Your current conversation reply.');
            send('end'); res.end();
        } else if (url.pathname === '/api/preferences') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ requestId: values.firstId, operationId: values.evidenceId, preferences: { theme: 'light' } }));
        } else if (url.pathname === '/app.js') {
            res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(script);
        } else if (url.pathname === '/' || url.pathname === '/preferences') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Diagnostic workbench</title>
<style>body{background:#eef2f7;color:#142b42;font:18px Arial;padding:36px}main{width:720px;background:white;padding:28px;border:1px solid #9caec0;border-radius:10px}h1{font-size:24px}.error{color:#ac2535}#status{font-size:22px;font-weight:bold}#detail{min-height:80px;white-space:pre-wrap}#incident{border-top:1px solid #ddd;padding-top:14px;font:20px monospace}button{padding:10px 18px}</style>
</head><body><main><h1 id="heading">Diagnostic workbench</h1><p id="status">Ready</p><p id="detail"></p>
<button id="start">Run workflow</button><p id="incident">Incident: ${values.code}</p></main>
<script src="/app.js"></script></body></html>`);
        } else { res.writeHead(404); res.end('Not found'); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
