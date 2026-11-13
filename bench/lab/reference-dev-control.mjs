#!/usr/bin/env node
/** Additional unpaid equivalence control; separate from all model workspaces. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { vendor, settings } from '../web-bench/prepare.mjs';
import { startSession, stopSession } from '../web-bench/runner.mjs';
import { processResult, workspace } from '../web-bench/broker.mjs';

const dir = resolve(process.argv[2] ?? join('bench/lab/jobs', 'reference-dev-' + Date.now()));
mkdirSync(dir, { recursive: true, mode: 0o700 });
const report = { kind: 'upstream-reference-development-startup-control', cases: [], complete: false };
for (const project of settings.projects) for (const condition of ['harness-fe', 'chrome-devtools-mcp']) {
    const output = join(dir, project, condition); mkdirSync(output, { recursive: true });
    let session;
    try {
        session = await startSession(project, condition, join(output, 'browser'));
        for (const [from, to] of [[join(vendor, 'projects', project, 'src') + '/.', '/workspace/task/src'],
            [join(vendor, 'projects', project, 'test'), '/tmp/reference-tests'],
            [join(vendor, 'projects', project, 'playwright.config.js'), '/tmp/upstream.config.cjs']]) {
            const r = await processResult('docker', ['cp', from, `${session.name}:${to}`]); assert.equal(r.code, 0);
        }
        const restarted = await workspace(session.name, { action: 'restart' }); assert(!restarted.isError);
        const config = `const base=require('/tmp/upstream.config.cjs');module.exports={...base,
webServer:undefined,testDir:'/tmp/reference-tests',workers:1,reporter:[['json',{outputFile:'/artifacts/dev-playwright.json'}]],
outputDir:'/artifacts/dev-test-results',use:{...base.use,baseURL:'http://127.0.0.1:3211',
launchOptions:{executablePath:require('/opt/deps/node_modules/playwright').chromium.executablePath(),args:['--no-sandbox']}}};`;
        const file = '/tmp/control-' + randomUUID() + '.cjs';
        const r = await processResult('docker', ['exec', '-i', session.name, 'node', '-e',
            `let s='';process.stdin.on('data',b=>s+=b).on('end',()=>require('fs').writeFileSync(${JSON.stringify(file)},s))`], { input: config });
        assert.equal(r.code, 0);
        const grade = await processResult('docker', ['exec', '-e', 'CI=true', '-e', 'IS_EVAL_PRODUCTION=true',
            '-e', 'EVAL_PROJECT_ROOT=/workspace/task/src', '-e', 'EVAL_PROJECT_PORT=3211', '-e', 'NODE_PATH=/opt/deps/node_modules',
            session.name, '/opt/deps/node_modules/.bin/playwright', 'test', '--config', file], { timeout: 1200000 });
        writeFileSync(join(output, 'test.log'), grade.stdout + grade.stderr);
        const raw = JSON.parse(readFileSync(join(output, 'browser/dev-playwright.json')));
        const result = { project, condition, passed: grade.code === 0 && raw.stats.unexpected === 0,
            stats: raw.stats, source: 'unmodified upstream reference', testBodies: 'unmodified upstream',
            startup: project === 'react' ? 'Vite development' : 'Vite development with Fastify API proxy' };
        report.cases.push(result); writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(result)); assert(result.passed, 'Development/reference equivalence failed; inspect ' + output);
    } finally { if (session) await stopSession(session.name); }
}
report.complete = true; writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
