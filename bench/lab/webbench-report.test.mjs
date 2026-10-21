import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from './batch.mjs';
import { createReport } from './webbench-report.mjs';

const save = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'webbench-report-'));
    const sample = { id: 'react', tasks: [{ id: 'task-1' }, { id: 'task-2' }],
        sourceHash: 'source', runnerHash: 'runner', testHash: 'tests', recordHash: 'record', verifierImage: 'verifier' };
    const jobs = ['harness-fe', 'chrome-devtools-mcp'].map((condition, i) => ({ id: `job-${i}`, suite: 'web-bench', condition, repeat: 1, sample }));
    const plan = { kind: 'benchmark', model: 'k3', agentVersion: 'pinned', image: 'agent', jobs };
    const state = { planHash: digest(plan), adapterHash: 'adapter', jobs: {} };
    for (const job of jobs) {
        const dir = join(root, job.id, '1'); mkdirSync(dir, { recursive: true });
        const steps = [1, 2].map(stage => {
            const stepDir = join(dir, `step-0${stage}`); mkdirSync(join(stepDir, 'grading'), { recursive: true });
            const passed = job.condition === 'harness-fe' || stage === 1;
            save(join(stepDir, 'source-receipt.json'), { sourceHash: `source-${stage}` });
            save(join(stepDir, 'grading/verification.json'), { project: 'react', mode: 'candidate', stage,
                totalCases: 1, passed, currentTaskPassed: true, stats: { flaky: 0 },
                cases: [{ file: 'task-1.spec.js', title: 'persistent regression', status: passed ? 'expected' : 'unexpected' }] });
            return { stage, id: `task-${stage}`, sourceHash: `source-${stage}`, totalCases: 1,
                cumulativePassed: passed, currentTaskPassed: true, verifierSeconds: 2,
                model: { verifiedModel: true, actualModels: ['k3'], agentVersion: 'pinned', seconds: 3, costUsd: 0.1, subtype: 'success' } };
        });
        save(join(dir, 'chain.json'), { project: 'react', condition: job.condition, model: 'k3', steps, complete: true, setupSeconds: 1 });
        state.jobs[job.id] = { state: 'completed', attempt: 1, output: '/old/host/path', seconds: 11,
            result: { score: job.condition === 'harness-fe' ? 1 : 0.5, verifier: { sourceHash: 'tests' } } };
        const audit = [
            { name: 'workspace_read_file', images: 0, isError: false },
            { name: 'take_screenshot', images: 1, isError: false },
            { name: 'take_screenshot', images: 0, isError: false },
            { name: 'console.tail', images: 0, isError: false },
            { name: 'sessions.list', images: 0, isError: false },
        ];
        writeFileSync(join(dir, 'tools.jsonl'), audit.map(row => JSON.stringify(row)).join('\n') + '\n');
    }
    save(join(root, 'plan.json'), plan); save(join(root, 'state.json'), state);
    return { root, plan, state, selections: [{ project: 'react', run: root }] };
}

test('reports paired cumulative and current-feature scores separately from native image delivery', () => {
    const f = fixture(), r = createReport(f.selections);
    assert.equal(r.complete, true); assert.equal(r.pairs[0].outcome, 'harness-fe-win');
    assert.equal(r.attempts[1].cumulativeStages.passed, 1);
    assert.equal(r.attempts[1].currentTaskStages.passed, 2);
    assert.equal(r.attempts[1].finalCases.passed, 0);
    assert.equal(r.attempts[0].tools.screenshotCalls, 2);
    assert.equal(r.attempts[0].tools.nativeImages, 1);
    assert.equal(r.attempts[0].tools.screenshotCallsWithoutNativeImage, 1);
    assert.equal(r.attempts[0].tools.logReads, 1); // Discovery is not a log read.
    assert.equal(r.attempts[0].tools.workspaceCalls, 1);
    assert.equal(r.attempts[0].timing.gradingSeconds, 4);
});

test('a running chain cannot acquire a final score or win, even when all stage files exist', () => {
    const f = fixture(); f.state.jobs['job-0'].state = 'running'; save(join(f.root, 'state.json'), f.state);
    // Simulate an append observed before its final newline.
    const audit = join(f.root, 'job-0/1/tools.jsonl'); writeFileSync(audit, readFileSync(audit, 'utf8') + '{"name":');
    const r = createReport(f.selections);
    assert.equal(r.complete, false); assert.equal(r.attempts[0].score, null);
    assert.equal(r.attempts[0].finalCases, null); assert.equal(r.pairs[0].outcome, 'unresolved');
    f.state.jobs['job-0'].state = 'completed'; save(join(f.root, 'state.json'), f.state);
    assert.throws(() => createReport(f.selections), SyntaxError);
});

test('rejects project replacement, saved-score drift, and source evidence drift', () => {
    const f = fixture();
    assert.throws(() => createReport([...f.selections, ...f.selections]), /exactly once/);
    f.state.jobs['job-0'].result.score = 0; save(join(f.root, 'state.json'), f.state);
    assert.throws(() => createReport(f.selections), /Saved score/);
    f.state.jobs['job-0'].result.score = 1; save(join(f.root, 'state.json'), f.state);
    save(join(f.root, 'job-0/1/step-01/source-receipt.json'), { sourceHash: 'different' });
    assert.throws(() => createReport(f.selections), /different/);
});

test('rejects plan tampering and cross-condition environment mismatch', () => {
    const f = fixture(); f.plan.jobs[1].sample = { ...f.plan.jobs[1].sample, runnerHash: 'other' };
    save(join(f.root, 'plan.json'), f.plan);
    assert.throws(() => createReport(f.selections), /Plan\/state hash/);
    f.state.planHash = digest(f.plan); save(join(f.root, 'state.json'), f.state);
    assert.throws(() => createReport(f.selections), /Paired environment/);
});
