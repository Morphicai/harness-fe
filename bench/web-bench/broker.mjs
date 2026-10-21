import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../packages/gateway/package.json', import.meta.url));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { Client } = await load('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await load('@modelcontextprotocol/sdk/client/stdio.js');
const { Server } = await load('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = await load('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = await load('@modelcontextprotocol/sdk/types.js');

export function processResult(command, args, { input, cwd, timeout = 120000, maxBytes = 24 * 1024 * 1024, onOutput } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', timedOut = false, killTimer;
        const terminate = () => {
            try { process.kill(-child.pid, 'SIGTERM'); } catch {}
            killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
        };
        const abort = () => terminate();
        process.once('SIGTERM', abort); process.once('SIGINT', abort);
        const timer = setTimeout(() => { timedOut = true; terminate(); }, timeout);
        child.stdout.on('data', b => { stdout += b; onOutput?.(b); if (stdout.length > maxBytes) terminate(); });
        child.stderr.on('data', b => { stderr += b; onOutput?.(b); if (stderr.length > maxBytes) terminate(); });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            clearTimeout(timer); clearTimeout(killTimer);
            process.off('SIGTERM', abort); process.off('SIGINT', abort);
            resolve({ code, signal, timedOut, stdout, stderr });
        });
        child.stdin.on('error', () => {}); child.stdin.end(input ?? '');
    });
}
export async function workspace(container, action) {
    const r = await processResult('docker', ['exec', '-i', container, 'node', '/opt/webbench/command.mjs'],
        { input: JSON.stringify(action), timeout: (action.timeoutMs ?? 60000) + 15000 });
    let value; try { value = JSON.parse(r.stdout); } catch { throw Error('Workspace command produced no JSON'); }
    return { value, isError: r.code !== 0 || Boolean(value.error) };
}
const string = { type: 'string' }, integer = { type: 'integer' };
export const workspaceTools = [
    { name: 'workspace_read_file', description: 'Read lines from a file in the isolated task workspace.', inputSchema: { type: 'object', properties: { path: string, startLine: { ...integer, minimum: 1 }, lines: { ...integer, minimum: 1, maximum: 600 } }, required: ['path'] } },
    { name: 'workspace_write_file', description: 'Create or replace a complete file in the task workspace. Source belongs under src/.', inputSchema: { type: 'object', properties: { path: string, content: string }, required: ['path', 'content'] } },
    { name: 'workspace_list_files', description: 'List task files, excluding dependencies and generated output.', inputSchema: { type: 'object', properties: { path: string } } },
    { name: 'workspace_exec', description: 'Run a shell command inside the isolated task container. Dependencies are installed, internet and host files are unavailable. Prefer short commands. Backend code changes require workspace_restart_dev.', inputSchema: { type: 'object', properties: { command: string, cwd: string, timeoutMs: { ...integer, minimum: 1, maximum: 120000 } }, required: ['command'] } },
    { name: 'workspace_restart_dev', description: 'Restart the development services after backend/schema changes. By default reset the development SQLite database from your src/libs/setup.sql; set resetDatabase=false to preserve it.', inputSchema: { type: 'object', properties: { resetDatabase: { type: 'boolean' } } } },
];
const actions = { workspace_read_file: 'read', workspace_write_file: 'write', workspace_list_files: 'list', workspace_exec: 'exec', workspace_restart_dev: 'restart' };

export async function openBroker(container, condition, output) {
    const audit = [], sessions = new Map();
    const transport = new StdioClientTransport({ command: 'docker', args: ['exec', '-i', container,
        ...(condition === 'harness-fe' ? ['node', '/opt/harness/dist/cli.js', 'mcp', '--port', '47729']
            : ['/opt/lab/node_modules/.bin/chrome-devtools-mcp', '--browserUrl', 'http://127.0.0.1:9222', '--no-usage-statistics', '--no-performance-crux'])], stderr: 'pipe' });
    transport.stderr?.on('data', b => appendFileSync(join(output, 'mcp-stderr.log'), b, { mode: 0o600 }));
    const upstream = new Client({ name: 'webbench-paired-controller', version: '1' });
    await upstream.connect(transport);
    if (condition === 'harness-fe') assert.equal(upstream.getServerVersion().version, '4.5.3');
    const catalog = (await upstream.listTools()).tools;
    assert(catalog.some(t => t.name === (condition === 'harness-fe' ? 'page.screenshot' : 'take_screenshot')));
    const tools = [...workspaceTools, ...catalog];
    writeFileSync(join(output, 'tool-catalog.json'), JSON.stringify({ condition, server: upstream.getServerVersion(), tools }, null, 2));
    const route = '/mcp/' + randomUUID();
    const server = createServer(async (req, res) => {
        if (req.url !== route) { res.writeHead(404); res.end(); return; }
        try {
            const sid = req.headers['mcp-session-id'];
            if (sid && sessions.has(sid)) { await sessions.get(sid).transport.handleRequest(req, res); return; }
            const chunks = []; for await (const b of req) chunks.push(b);
            const body = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(body.method, 'initialize');
            const mcp = new Server({ name: 'webbench-lab', version: '1' }, { capabilities: { tools: {} } });
            mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
            mcp.setRequestHandler(CallToolRequestSchema, async request => {
                const { name, arguments: args = {} } = request.params;
                assert(tools.some(t => t.name === name));
                const started = Date.now();
                let result;
                if (actions[name]) {
                    const r = await workspace(container, { ...args, action: actions[name] });
                    result = { content: [{ type: 'text', text: JSON.stringify(r.value, null, 2) }], ...(r.isError ? { isError: true } : {}) };
                } else result = await upstream.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
                const item = { name, args, at: new Date(started).toISOString(), seconds: (Date.now() - started) / 1000,
                    text: result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'),
                    images: result.content.filter(c => c.type === 'image').length, isError: Boolean(result.isError) };
                audit.push(item); appendFileSync(join(output, 'tools.jsonl'), JSON.stringify(item) + '\n', { mode: 0o600 });
                result.content.filter(c => c.type === 'image').forEach((img, i) => writeFileSync(join(output, `image-${audit.length}-${i}.${img.mimeType.split('/')[1]}`), Buffer.from(img.data, 'base64')));
                return result;
            });
            const endpoint = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID,
                onsessioninitialized: id => sessions.set(id, { transport: endpoint, mcp }) });
            await mcp.connect(endpoint); await endpoint.handleRequest(req, res, body);
        } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}${route}`, audit, catalog, upstream,
        async close() {
            await Promise.all([...sessions.values()].map(s => s.mcp.close().catch(() => {})));
            server.closeAllConnections(); await new Promise(r => server.close(r));
            await upstream.close().catch(() => {}); await transport.close().catch(() => {});
        } };
}
