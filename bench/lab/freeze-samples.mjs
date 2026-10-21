/** Trusted selection only. Golden patches/evaluator answers stay in ignored cache. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { here, environment, hash } from './prepare.mjs';

const cache = join(here, '.cache/sources'); mkdirSync(cache, { recursive: true, mode: 0o700 });
const seed = 'harness-fe-public-samples-2026-10-21';
const pins = {
    web: '7b31ca2b786eef120dd49ce63dd03d0c0006046d',
    swe: '4e6662d51c48e475f7f346e4fa09a6f8b31fcaa5',
    full: 'd3fe0e7828d121f78d85c5763b3166c1e09ba929',
    wa: '6473f72db5dcefc97b5725b59e734504edc28a21',
    vwa: '89f5af29305c3d1e9f97ce4421462060a70c9a03',
};
const sources = [];
async function source(name, url) {
    const file = join(cache, name);
    if (!existsSync(file)) {
        const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
        assert(response.ok, `Source unavailable: ${url} (${response.status})`);
        writeFileSync(file, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    }
    const bytes = readFileSync(file); sources.push({ name, url, sha256: hash(bytes) }); return bytes;
}
function ordered(rows, key = r => r.id) { return [...rows].sort((a, b) => hash(seed + key(a)).localeCompare(hash(seed + key(b)))); }
function diverse(rows, group, count) {
    const groups = new Map();
    for (const row of ordered(rows)) { const name = group(row); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(row); }
    const chosen = [];
    while (chosen.length < count) {
        let added = false;
        for (const bucket of groups.values()) if (bucket.length && chosen.length < count) { chosen.push(bucket.shift()); added = true; }
        assert(added, 'Not enough candidates');
    }
    return chosen;
}

async function webBench() {
    const projects = ['react', 'vue', 'form', 'canvas', 'chart', 'fastify-react', 'nextjs', 'prisma', 'expressjs', 'nosql'];
    const tree = JSON.parse(await source('web-tree.json', `https://api.github.com/repos/bytedance/web-bench/git/trees/${pins.web}?recursive=1`));
    const paths = new Set(tree.tree.map(r => r.path));
    const samples = [];
    for (const project of projects) {
        const path = ['tasks.yml', 'tasks.jsonl'].map(f => `projects/${project}/${f}`).find(p => paths.has(p));
        assert(path, `No upstream task chain: ${project}`);
        const raw = await source(`web-${project}.txt`, `https://raw.githubusercontent.com/bytedance/web-bench/${pins.web}/${path}`);
        const ids = [...raw.toString().matchAll(/(?:"id"\s*:\s*"|^- id:\s*)(task-\d+)/gm)].map(m => m[1]);
        assert.equal(new Set(ids).size, 20, `${project} is not a complete 20-task chain`);
        samples.push({ id: project, project: `@web-bench/${project}`, taskIds: ids, taskFile: path, recordHash: hash(raw) });
    }
    return { id: 'web-bench', revision: pins.web, unit: 'project-chain', selection: 'Five frontend and five integration-oriented projects; all 20 dependent tasks per project, no outcome-based selection', samples };
}
async function fullStack() {
    const raw = await source('fullstack.jsonl', `https://huggingface.co/datasets/luzimu/FullStack-Bench/resolve/${pins.full}/FullStack-Bench.jsonl`);
    const rows = raw.toString().trim().split('\n').map(l => JSON.parse(l)); assert.equal(rows.length, 101);
    const chosen = diverse(rows.filter(r => r.backend_test_cases.length && r.data_structures.length), r => r.application_type, 10);
    return { id: 'fullstack-bench', revision: pins.full, unit: 'application',
        selection: 'Seeded application-type diversity among tasks with backend and database requirements',
        samples: chosen.map(r => ({ id: r.id, instruction: r.instruction, applicationType: r.application_type,
            uiCases: r.ui_instruct.length, backendCases: r.backend_test_cases.length, databaseCases: r.data_structures.length, recordHash: hash(JSON.stringify(r)) })) };
}
async function webArena() {
    const rows = JSON.parse(await source('webarena.json', `https://raw.githubusercontent.com/ServiceNow/webarena-verified/${pins.wa}/assets/dataset/webarena-verified.json`));
    const excluded = new Set([157, 374, 11, 41, 453, 461]), samples = [];
    for (const [site, count] of [['shopping_admin', 3], ['shopping', 3], ['reddit', 2], ['gitlab', 2]]) {
        const candidates = rows.filter(r => r.sites.length === 1 && r.sites[0] === site && !excluded.has(r.task_id)).map(r => ({ ...r, id: String(r.task_id) }));
        const chosen = diverse(candidates, r => r.eval.find(e => e.evaluator === 'AgentResponseEvaluator').expected.task_type, count);
        samples.push(...chosen.map(r => ({ id: String(r.task_id), taskId: r.task_id, site, instruction: r.intent,
            startUrls: r.start_urls, templateId: r.intent_template_id, recordHash: hash(JSON.stringify(r)) })));
    }
    return { id: 'webarena-verified', revision: pins.wa, unit: 'browser-task', selection: '3 admin, 3 shopping, 2 Reddit, 2 GitLab; seeded task-type diversity; exclude previous six pilot tasks', samples };
}
async function visualArena() {
    const samples = [];
    for (const [site, count] of [['classifieds', 3], ['shopping', 4], ['reddit', 3]]) {
        const rows = JSON.parse(await source(`vwa-${site}.json`, `https://raw.githubusercontent.com/web-arena-x/visualwebarena/${pins.vwa}/config_files/vwa/test_${site}.raw.json`));
        const candidates = rows.map(r => ({ ...r, id: `${site}/${r.task_id}` }));
        const chosen = diverse(candidates, r => r.image ? 'reference-image' : 'visual-instruction', count);
        samples.push(...chosen.map(r => ({ id: r.id, site, taskId: r.task_id, instruction: r.intent,
            inputImage: r.image, evalTypes: r.eval.eval_types, recordHash: hash(JSON.stringify(r)) })));
    }
    return { id: 'visualwebarena', revision: pins.vwa, unit: 'browser-task', selection: '3 classifieds, 4 shopping, 3 Reddit; seeded balance of reference-image and visual-instruction tasks', samples };
}
async function swe() {
    await source('swe-test.parquet', `https://huggingface.co/datasets/SWE-bench/SWE-bench_Multimodal/resolve/${pins.swe}/data/test-00000-of-00001.parquet`);
    const code = 'import pyarrow.parquet as p,json; print(json.dumps(p.read_table("/data/swe-test.parquet",columns=["instance_id","repo","base_commit","problem_statement","image_assets"]).to_pylist()))';
    const rows = JSON.parse(execFileSync('docker', ['run', '--rm', '--entrypoint', '/opt/evaluators/swebench/bin/python',
        '-v', `${cache}:/data:ro`, environment.image, '-c', code], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
    assert.equal(rows.length, 480);
    const browserLibraries = new Set(['PrismJS/prism', 'alibaba-fusion/next', 'bpmn-io/bpmn-js', 'carbon-design-system/carbon',
        'grommet/grommet', 'highlightjs/highlight.js', 'openlayers/openlayers', 'scratchfoundation/scratch-gui']);
    const candidates = rows.filter(r => browserLibraries.has(r.repo)).map(r => ({ ...r, id: r.instance_id }));
    const chosen = diverse(candidates, r => r.repo, 10);
    return { id: 'swe-bench-multimodal-v2', revision: pins.swe, split: 'test', unit: 'issue',
        selection: 'Seeded diversity across the eight browser UI/rendering libraries in the pinned v2 test split; exclude Lighthouse auditing, ESLint and Prettier CLI tasks before any model outcomes; live-repro preflight remains required',
        excludedRepositories: ['GoogleChrome/lighthouse', 'eslint/eslint', 'prettier/prettier'],
        samples: chosen.map(r => ({ id: r.instance_id, repo: r.repo, baseCommit: r.base_commit, instruction: r.problem_statement,
            issueImages: r.image_assets?.problem_statement ?? [], recordHash: hash(JSON.stringify(r)) })) };
}

const file = join(here, 'samples.json');
assert(!existsSync(file) || process.argv.includes('--refresh'), 'Samples are frozen; use --refresh only for an explicitly reviewed new selection');
if (existsSync(file)) {
    const previous = readFileSync(file), history = join(here, '.cache/sample-history'); mkdirSync(history, { recursive: true });
    copyFileSync(file, join(history, hash(previous) + '.json'));
}
const first = await Promise.all([webBench(), fullStack(), webArena(), visualArena()]);
if (process.argv.includes('--download-only')) {
    await source('swe-test.parquet', `https://huggingface.co/datasets/SWE-bench/SWE-bench_Multimodal/resolve/${pins.swe}/data/test-00000-of-00001.parquet`);
    console.log(JSON.stringify({ cachedSuites: first.map(s => ({ id: s.id, count: s.samples.length })), parquetDownloaded: true }));
    process.exit(0);
}
const suites = [first[0], await swe(), first[1], first[2], first[3]];
for (const suite of suites) { assert.equal(suite.samples.length, 10); assert.equal(new Set(suite.samples.map(s => s.id)).size, 10); }
writeFileSync(file, JSON.stringify({ schemaVersion: 1, selectionRevision: 'frontend-eligible-v2', seed, createdAt: new Date().toISOString(),
    acceptance: 'Frozen selection only; per-dataset browser, model and official verifier preflight remains required',
    sources: sources.sort((a, b) => a.name.localeCompare(b.name)), suites }, null, 2) + '\n');
console.log(JSON.stringify({ manifest: file, suites: suites.map(s => ({ id: s.id, count: s.samples.length, unit: s.unit })), total: 50 }));
