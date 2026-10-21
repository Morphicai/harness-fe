import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';

let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const root = '/workspace/task';
function path(value = '.') {
    assert(typeof value === 'string');
    const p = resolve(root, value), rel = relative(root, p);
    assert(!rel.startsWith('..') && !rel.startsWith('/'), 'Path must stay in the task workspace');
    let check = p;
    while (!existsSync(check) && check !== root) check = dirname(check);
    const actual = realpathSync(check);
    assert(actual === root || actual.startsWith(root + '/'), 'Symlink leaves task workspace');
    return p;
}
try {
    let result;
    if (input.action === 'read') {
        const text = readFileSync(path(input.path), 'utf8'), start = input.startLine ?? 1, count = input.lines ?? 240;
        const lines = text.split('\n'); result = { path: input.path, totalLines: lines.length, startLine: start, text: lines.slice(start - 1, start - 1 + count).join('\n') };
    } else if (input.action === 'write') {
        const p = path(input.path); assert(typeof input.content === 'string');
        mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, input.content); result = { path: input.path, bytes: Buffer.byteLength(input.content) };
    } else if (input.action === 'list') {
        const files = [];
        function walk(dir, depth = 0) {
            if (depth > 6 || files.length > 600) return;
            for (const name of readdirSync(dir).sort()) {
                if (['node_modules', '.git', 'test.sqlite', 'public'].includes(name)) continue;
                const p = resolve(dir, name), stat = lstatSync(p);
                files.push(relative(root, p) + (stat.isDirectory() ? '/' : ''));
                if (stat.isDirectory()) walk(p, depth + 1);
            }
        }
        walk(path(input.path)); result = { files };
    } else if (input.action === 'export') {
        const files = [];
        function walk(dir) {
            for (const name of readdirSync(dir).sort()) {
                if (['node_modules', '.git', 'public'].includes(name) || /^test\.sqlite(?:-.*)?$/.test(name)) continue;
                const p = resolve(dir, name), stat = lstatSync(p);
                assert(!stat.isSymbolicLink(), 'Candidate source must not contain symlinks');
                if (stat.isDirectory()) walk(p);
                else { assert(stat.isFile(), 'Candidate source must contain regular files'); files.push({ path: relative(root + '/src', p), data: readFileSync(p).toString('base64') }); }
            }
        }
        walk(root + '/src'); result = { files };
    } else if (input.action === 'exec') {
        const r = spawnSync('/bin/sh', ['-lc', input.command], { cwd: path(input.cwd),
            timeout: Math.min(input.timeoutMs ?? 60000, 120000), maxBuffer: 1024 * 1024, encoding: 'utf8' });
        result = { status: r.status, stdout: r.stdout?.slice(-18000), stderr: r.stderr?.slice(-18000), error: r.error?.message };
    } else if (input.action === 'restart') {
        const r = await fetch('http://127.0.0.1:41099/restart', { method: 'POST', body: JSON.stringify(input), signal: AbortSignal.timeout(45000) });
        result = await r.json(); assert(r.ok, result.error);
    } else throw Error('Unknown workspace action');
    console.log(JSON.stringify(result));
} catch (e) { console.log(JSON.stringify({ error: e.message })); process.exitCode = 1; }
