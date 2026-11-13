import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from '/opt/deps/node_modules/playwright/index.mjs';

const [project, mode = 'candidate', stage = '20'] = process.argv.slice(2);
assert(['react', 'fastify-react'].includes(project));
assert(['candidate', 'reference', 'initial'].includes(mode));
const root = '/opt/verifier/' + project;
const source = join(root, 'src');
if (mode !== 'reference') {
    rmSync(source, { recursive: true, force: true });
    cpSync(mode === 'initial' ? `/opt/seeds/${project}/src` : '/candidate', source, { recursive: true });
}
for (const dir of ['plugins', 'public', 'libs']) if (project === 'fastify-react') mkdirSync(join(source, dir), { recursive: true });
symlinkSync('/opt/deps/node_modules', root + '/node_modules');
mkdirSync('/artifacts', { recursive: true });
const config = join(root, 'control.config.cjs');
writeFileSync(config, `const config=require('./playwright.config.js'); module.exports={...config,workers:1,
reporter:[['json',{outputFile:'/artifacts/playwright.json'}]],outputDir:'/artifacts/test-results',
use:{...config.use,launchOptions:{executablePath:${JSON.stringify(chromium.executablePath())},args:['--no-sandbox']}}};`);
const n = Number(stage); assert(Number.isInteger(n) && n >= 1 && n <= 20);
const files = Array.from({ length: n }, (_, i) => `test/task-${i + 1}.spec.js`);
if (existsSync(join(root, 'test/init.spec.js'))) files.unshift('test/init.spec.js');
const regex = `(?:${files.map(f => f.replaceAll('.', '\\.')).join('|')})$`;
const child = spawnSync('/opt/deps/node_modules/.bin/playwright', ['test', '--config', config, regex], {
    cwd: root, env: { ...process.env, EVAL_PROJECT_ROOT: source, EVAL_PROJECT_PORT: '3211', IS_EVAL_PRODUCTION: 'true',
        MAX_TEST_WORKERS: '1', DB_HOST: source + '/test.sqlite', CI: 'true' },
    encoding: 'utf8', timeout: 1200000, maxBuffer: 16 * 1024 * 1024,
});
writeFileSync('/artifacts/stdout.log', child.stdout ?? ''); writeFileSync('/artifacts/stderr.log', child.stderr ?? '');
assert(existsSync('/artifacts/playwright.json'), 'Official verifier did not produce its JSON report');
const report = JSON.parse(readFileSync('/artifacts/playwright.json'));
const cases = [];
function walk(suite, file) {
    file = suite.file ?? file;
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) cases.push({ file, title: spec.title, status: t.status,
        expectedStatus: t.expectedStatus, results: t.results?.map(r => r.status) });
    for (const s of suite.suites ?? []) walk(s, file);
}
for (const suite of report.suites ?? []) walk(suite);
const current = cases.filter(c => c.file?.endsWith(`task-${n}.spec.js`));
const value = { kind: 'upstream-webbench-verification', project, mode, stage: n, exit: child.status,
    passed: child.status === 0 && cases.length > 0 && cases.every(c => ['expected', 'flaky'].includes(c.status)),
    currentTaskPassed: current.length > 0 && current.every(c => ['expected', 'flaky'].includes(c.status)),
    retryPolicy: 'Unmodified upstream CI policy (2 test retries); Agent calls are never retried',
    stats: report.stats, totalCases: cases.length, currentCases: current.length, cases, errors: report.errors };
writeFileSync('/artifacts/verification.json', JSON.stringify(value, null, 2));
console.log(JSON.stringify({ project, mode, stage: n, passed: value.passed, totalCases: cases.length, stats: report.stats }));
