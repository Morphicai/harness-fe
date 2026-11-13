import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan, openRun, execute, atomic, validateResult } from './batch.mjs';
import { checkTree } from './prepare.mjs';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'hfe-lab-batch-')), adapter = join(root, 'adapter with space.mjs');
    writeFileSync(adapter, `import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const job=JSON.parse(readFileSync(process.argv[2]));
appendFileSync(${JSON.stringify(join(root, 'calls'))},job.id+'\\n');
writeFileSync(job.output+'/verifier.json','{}');
writeFileSync(job.output+'/result.json',JSON.stringify({kind:job.kind,condition:job.condition,model:job.model,score:0.5,evidence:'verifier.json',verifier:{name:'test-only-verifier',sourceHash:'a'.repeat(64)}}));`);
    const samples = { suites: [{ id: 'test-suite', unit: 'issue', samples: [{ id: 'one' }, { id: 'two' }] }] };
    return { root, adapter: ['node', adapter], declared: plan(samples, { repeats: 1, batchSize: 1, image: 'test-image', environmentHash: 'test-hash' }) };
}
test('each selected sample gets both conditions; continuation skips completed work', async () => {
    const f = fixture(), run = join(f.root, 'run');
    let result = await execute(f.declared, run, f.adapter);
    assert.equal(result.suites['test-suite'].completed, 2);
    assert.equal(result.suites['test-suite'].pairs.ties, 1);
    assert.equal(result.suites['test-suite'].unresolved, 2);
    await execute(f.declared, run, f.adapter);
    assert.equal(readFileSync(join(f.root, 'calls'), 'utf8').trim().split('\n').length, 2);
    result = await execute(f.declared, run, f.adapter, { batch: 2 });
    assert.equal(result.suites['test-suite'].completed, 4);
});
test('unknown/running attempt requires explicit recovery and preserves original attempt', async () => {
    const f = fixture(), run = join(f.root, 'run'), state = openRun(run, f.declared), id = f.declared.jobs[0].id;
    state.jobs[id] = { state: 'running', attempt: 1, output: 'old-evidence' }; atomic(join(run, 'state.json'), state);
    await assert.rejects(execute(f.declared, run, f.adapter), /inspect.*retry-interrupted/);
    assert(!existsSync(join(f.root, 'calls')));
    await execute(f.declared, run, f.adapter, { retryInterrupted: true });
    const recovered = JSON.parse(readFileSync(join(run, 'state.json')));
    assert.equal(recovered.jobs[id].attempt, 2);
});
test('environment changes cannot silently share prior scores', () => {
    const f = fixture(), run = join(f.root, 'run'); openRun(run, f.declared);
    assert.throws(() => openRun(run, { ...f.declared, environmentHash: 'different-image-source' }), /drift/);
});
test('smoke results and missing verifier evidence cannot become public scores', () => {
    const f = fixture(), job = f.declared.jobs[0];
    assert.throws(() => validateResult({ kind: 'environment-smoke', condition: job.condition, passed: true }, f.declared, job, f.root), /cannot be graded/);
    assert.throws(() => validateResult({ kind: 'benchmark', condition: job.condition, model: 'other', score: 1 }, f.declared, job, f.root), /Model drift/);
    assert.throws(() => validateResult({ kind: 'benchmark', condition: job.condition, model: 'k3', agentVersion: 'other', score: 1 }, { ...f.declared, agentVersion: 'pinned' }, job, f.root), /Agent version drift/);
    assert.throws(() => validateResult({ kind: 'benchmark', condition: job.condition, model: 'k3', score: 1,
        verifier: { name: 'test', sourceHash: 'a'.repeat(64) }, evidence: '../outside' }, f.declared, job, f.root), /outside/);
});
test('an existing live run lock prevents a second executor', async () => {
    const f = fixture(), run = join(f.root, 'run'); openRun(run, f.declared);
    writeFileSync(join(run, 'run.lock'), '{}');
    await assert.rejects(execute(f.declared, run, f.adapter), /EEXIST/);
    assert(!existsSync(join(f.root, 'calls')));
});
test('packaging refuses credential filenames and links to user files', () => {
    const root = mkdtempSync(join(tmpdir(), 'hfe-lab-private-'));
    writeFileSync(join(root, '.env'), ''); assert.throws(() => checkTree(root), /Private file/);
    const other = mkdtempSync(join(tmpdir(), 'hfe-lab-link-'));
    symlinkSync(root, join(other, 'external')); assert.throws(() => checkTree(other), /Escaping/);
});
