import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function atomic(path, value) { const tmp = path + '.tmp'; writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(tmp, path); }
export function plan(samples, { repeats = 3, batchSize = 2, kind = 'benchmark', model = 'k3', image, environmentHash, agentVersion } = {}) {
    assert(Number.isInteger(repeats) && repeats > 0 && Number.isInteger(batchSize) && batchSize > 0);
    assert(['benchmark', 'environment-smoke'].includes(kind));
    const jobs = [];
    for (const suite of samples.suites) suite.samples.forEach((sample, index) => {
        for (let repeat = 1; repeat <= repeats; repeat++) {
            const conditions = (index + repeat) % 2 ? ['harness-fe', 'chrome-devtools-mcp'] : ['chrome-devtools-mcp', 'harness-fe'];
            for (const condition of conditions) jobs.push({ id: digest([suite.id, sample.id, repeat, condition]).slice(0, 24),
                suite: suite.id, unit: suite.unit, sample, repeat, condition, batch: Math.floor(index / batchSize) + 1 });
        }
    });
    return { schemaVersion: 1, kind, model, agentVersion, image, environmentHash, samplesHash: digest(samples), repeats, batchSize, jobs };
}
export function openRun(dir, declared) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'state.json'), identity = digest(declared);
    if (existsSync(file)) {
        const value = JSON.parse(readFileSync(file));
        assert.equal(value.planHash, identity, 'Plan/environment/sample drift: use a new run directory');
        return value;
    }
    const state = { planHash: identity, createdAt: new Date().toISOString(), kind: declared.kind, jobs: {} };
    atomic(file, state); atomic(join(dir, 'plan.json'), declared); return state;
}
export function validateResult(value, declared, job, dir) {
    assert.equal(value.kind, declared.kind, 'Environment smoke cannot be graded as a benchmark');
    assert.equal(value.condition, job.condition);
    if (declared.kind === 'benchmark') {
        assert.equal(value.model, declared.model, 'Model drift');
        if (declared.agentVersion) assert.equal(value.agentVersion, declared.agentVersion, 'Agent version drift');
        assert(Number.isFinite(value.score) && value.score >= 0 && value.score <= 1, 'Invalid verifier score');
        assert(value.verifier?.name && /^[a-f0-9]{64}$/.test(value.verifier?.sourceHash ?? ''), 'Missing verifier identity');
        assert(typeof value.evidence === 'string', 'Missing verifier evidence');
        const evidence = resolve(dir, value.evidence), rel = relative(resolve(dir), evidence);
        assert(rel && !rel.startsWith('..') && !rel.startsWith('/'), 'Verifier evidence outside attempt');
        assert(existsSync(evidence), 'Verifier evidence absent');
    } else assert.equal(value.passed, true, 'Environment smoke failed');
    return value;
}
export async function execute(declared, dir, adapter, options = {}) {
    dir = resolve(dir); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock = join(dir, 'run.lock');
    if (existsSync(lock) && options.retryInterrupted) {
        const owner = JSON.parse(readFileSync(lock));
        assert.equal(owner.host, hostname(), 'Inspect the original host before recovering its run lock');
        let live = true;
        try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') live = false; }
        assert(!live, 'Run still has a live owner'); unlinkSync(lock);
    }
    const fd = openSync(lock, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname() }));
    try { return await executeLocked(declared, dir, adapter, options); }
    finally { closeSync(fd); unlinkSync(lock); }
}
async function executeLocked(declared, dir, adapter, { batch = 1, retryInterrupted = false, timeoutMs = 900000 } = {}) {
    assert(Array.isArray(adapter) && adapter.length && adapter.every(x => typeof x === 'string'));
    dir = resolve(dir); const state = openRun(dir, declared), file = join(dir, 'state.json');
    const adapterHash = digest({ argv: adapter, files: adapter.filter(p => existsSync(p)).map(p => [p, digest(readFileSync(p, 'utf8'))]) });
    if (state.adapterHash) assert.equal(state.adapterHash, adapterHash, 'Adapter drift: use a new run directory');
    state.adapterHash = adapterHash; atomic(file, state);
    for (const job of declared.jobs.filter(j => j.batch === batch)) {
        const previous = state.jobs[job.id];
        if (previous?.state === 'completed') continue;
        if (previous && !retryInterrupted) throw Error(`Attempt ${job.id} is ${previous.state}; inspect it before explicit --retry-interrupted`);
        const attempt = (previous?.attempt ?? 0) + 1, output = join(dir, job.id, String(attempt));
        mkdirSync(output, { recursive: true, mode: 0o700 });
        atomic(join(output, 'job.json'), { ...job, kind: declared.kind, model: declared.model, agentVersion: declared.agentVersion, image: declared.image, output });
        const started = Date.now();
        state.jobs[job.id] = { state: 'running', attempt, output, startedAt: new Date().toISOString() }; atomic(file, state);
        const child = spawn(adapter[0], [...adapter.slice(1), join(output, 'job.json')], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '', interrupted = false, timedOut = false;
        child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
        let killTimer;
        const terminate = () => {
            try { process.kill(-child.pid, 'SIGTERM'); } catch {}
            killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
        };
        const interrupt = () => { interrupted = true; terminate(); };
        process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
        const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
        try {
            const code = await new Promise((r, reject) => { child.once('exit', r); child.once('error', reject); });
            writeFileSync(join(output, 'stdout.log'), stdout, { mode: 0o600 }); writeFileSync(join(output, 'stderr.log'), stderr, { mode: 0o600 });
            assert(!interrupted && !timedOut && code === 0, `Adapter failed: exit=${code}, interrupted=${interrupted}, timedOut=${timedOut}`);
            const value = validateResult(JSON.parse(readFileSync(join(output, 'result.json'))), declared, job, output);
            state.jobs[job.id] = { ...state.jobs[job.id], state: 'completed', seconds: (Date.now() - started) / 1000, result: value };
        } catch (error) {
            state.jobs[job.id] = { ...state.jobs[job.id], state: interrupted || timedOut ? 'interrupted' : 'failed', failure: error.message };
            atomic(file, state); throw error;
        } finally {
            clearTimeout(timer); clearTimeout(killTimer);
            // An adapter is responsible for synchronous child/container cleanup.
            try { process.kill(-child.pid, 'SIGKILL'); } catch {}
            process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
        }
        atomic(file, state);
    }
    const summary = summarize(declared, state); atomic(join(dir, 'summary.json'), summary); return summary;
}
export function summarize(declared, state) {
    const suites = {};
    for (const job of declared.jobs) {
        const suite = suites[job.suite] ??= { unit: job.unit, planned: 0, completed: 0, unresolved: 0, conditions: {} };
        suite.planned++;
        const row = state.jobs[job.id];
        if (!row || row.state !== 'completed') { suite.unresolved++; continue; }
        suite.completed++;
        const c = suite.conditions[job.condition] ??= { completed: 0, seconds: 0,
            ...(declared.kind === 'benchmark' ? { scoreSum: 0, costUsd: 0, costKnown: 0 } : {}) };
        c.completed++; c.seconds += row.seconds;
        if (declared.kind === 'benchmark') {
            c.scoreSum += row.result.score;
            if (Number.isFinite(row.result.costUsd)) { c.costUsd += row.result.costUsd; c.costKnown++; }
        }
    }
    if (declared.kind === 'benchmark') {
        const pairs = new Map();
        for (const job of declared.jobs) {
            const key = JSON.stringify([job.suite, job.sample.id, job.repeat]);
            const pair = pairs.get(key) ?? { suite: job.suite }; pair[job.condition] = state.jobs[job.id]; pairs.set(key, pair);
        }
        for (const pair of pairs.values()) {
            const count = suites[pair.suite].pairs ??= { complete: 0, wins: 0, ties: 0, losses: 0, unresolved: 0 };
            const a = pair['harness-fe'], b = pair['chrome-devtools-mcp'];
            if (a?.state !== 'completed' || b?.state !== 'completed') { count.unresolved++; continue; }
            count.complete++; count[a.result.score > b.result.score ? 'wins' : a.result.score < b.result.score ? 'losses' : 'ties']++;
        }
    }
    return { kind: declared.kind, benchmarkScoresAvailable: declared.kind === 'benchmark', suites };
}
