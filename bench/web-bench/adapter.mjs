import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { settings, hash } from './prepare.mjs';
import { prepared, image, runnerHash, startSession, stopSession, grading, removeContainer } from './runner.mjs';
import { openBroker, workspace, processResult } from './broker.mjs';
import { atomic } from '../lab/batch.mjs';

const job = JSON.parse(readFileSync(process.argv[2]));
assert.equal(job.kind, 'benchmark'); assert.equal(job.suite, 'web-bench'); assert.equal(job.model, settings.model);
assert.equal(job.sample.runnerHash, runnerHash(), 'Runner changed: create a new plan/run');
assert.equal(job.agentVersion, execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim());
const receipt = prepared().receipt;
assert.equal(receipt.sourceHash, job.sample.sourceHash);
assert.equal(image(job.image).Config.Labels['harness-fe.dataset-source'], job.sample.sourceHash);
assert.equal(image(job.sample.verifierImage).Config.Labels['harness-fe.dataset-source'], job.sample.sourceHash);
const project = job.sample.id, output = job.output;
assert(settings.projects.includes(project)); assert.equal(job.sample.tasks.length, 20);
const state = { kind: 'webbench-project-chain', project, condition: job.condition, model: job.model, steps: [], startedAt: new Date().toISOString() };
const save = () => atomic(join(output, 'chain.json'), state);
const note = item => { appendFileSync(join(output, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...item }) + '\n'); console.log(JSON.stringify(item)); };
let session, broker, cancelled = false;
const cancel = () => { cancelled = true; if (session) removeContainer(session.name); };
process.once('SIGTERM', cancel); process.once('SIGINT', cancel);

async function snapshot(dir) {
    const r = await workspace(session.name, { action: 'export' }); assert(!r.isError, 'Source export failed');
    const files = r.value.files; assert(Array.isArray(files) && files.length > 0);
    const root = join(dir, 'source'); mkdirSync(root, { recursive: true });
    for (const file of files) {
        const p = resolve(root, file.path), rel = relative(root, p);
        assert(rel && !rel.startsWith('..') && !rel.startsWith('/'), 'Invalid candidate file path');
        mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, Buffer.from(file.data, 'base64'));
    }
    const sourceHash = hash(JSON.stringify(files.map(f => [f.path, hash(Buffer.from(f.data, 'base64'))])));
    atomic(join(dir, 'source-receipt.json'), { sourceHash, fileCount: files.length, gradedScope: 'src excluding generated public/database files' });
    return { root, sourceHash };
}
async function modelStep(index, dir, config) {
    const requirements = job.sample.tasks.slice(0, index + 1).map((t, i) => `Task ${i + 1}${i === index ? ' (CURRENT)' : ' (preserve)'}:\n${t.description}`).join('\n\n');
    const prompt = `Continue the ${project} application in the isolated task workspace /workspace/task. ` +
        `Implement the CURRENT task while preserving previous requirements. All implementation files belong under src/. ` +
        `Dependencies are already installed; internet and host files are unavailable. ` +
        `Use the available workspace tools to read/edit code and the browser MCP tools to inspect and validate the running app when useful. ` +
        `The frontend is http://127.0.0.1:3211 in the browser. ` +
        (project === 'fastify-react' ? 'Its Vite client proxies /api to Fastify on 3212. After backend/schema changes use workspace_restart_dev; its default resets the development SQLite database from your setup.sql. ' : '') +
        `Do not search for benchmark tests or reference implementations. No hidden grading output is available. ` +
        `Finish by briefly describing the implementation and any checks you performed.\n\n${requirements}`;
    writeFileSync(join(dir, 'prompt.txt'), prompt, { mode: 0o600 });
    const cwd = mkdtempSync(join(tmpdir(), 'hfe-webbench-model-'));
    const args = ['-p', prompt, '--model', job.model, '--tools', '', '--output-format', 'json', '--no-session-persistence',
        '--disable-slash-commands', '--mcp-config', config, '--strict-mcp-config', '--permission-mode', 'acceptEdits',
        '--allowedTools', 'mcp__lab', '--max-turns', String(settings.maxTurns),
        '--system-prompt', 'You are a software development agent. Complete the user requirement using the provided isolated workspace and browser tools. Preserve working features and inspect actual behavior before claiming checks passed.'];
    const started = Date.now(), r = await processResult('claude', args, { cwd, timeout: settings.stepTimeoutMs });
    writeFileSync(join(dir, 'model.json'), r.stdout, { mode: 0o600 }); writeFileSync(join(dir, 'model-stderr.log'), r.stderr, { mode: 0o600 });
    let response; try { response = JSON.parse(r.stdout); } catch {}
    const models = Object.keys(response?.modelUsage ?? {});
    const modelReceipt = { requestedModel: job.model, actualModels: models, agentVersion: job.agentVersion,
        verifiedModel: models.length > 0 && models.every(m => m === job.model), seconds: (Date.now() - started) / 1000,
        exit: r.code, timedOut: r.timedOut, subtype: response?.subtype, isError: response?.is_error,
        costUsd: response?.total_cost_usd, costSource: 'Claude CLI estimate; not a provider invoice', numTurns: response?.num_turns };
    atomic(join(dir, 'model-receipt.json'), modelReceipt);
    return modelReceipt;
}

try {
    save(); const setupAt = Date.now();
    session = await startSession(project, job.condition, join(output, 'browser'), job.image);
    broker = await openBroker(session.name, job.condition, output);
    // Both collectors attach before the common initial reload and model actions.
    if (job.condition === 'chrome-devtools-mcp') {
        const pages = await broker.upstream.callTool({ name: 'list_pages', arguments: {} });
        const line = pages.content.filter(c => c.type === 'text').map(c => c.text).join('\n').split('\n').find(s => s.includes('127.0.0.1:3211'));
        const id = line?.match(/^(\d+):/)?.[1]; assert(id, 'Target page missing');
        await broker.upstream.callTool({ name: 'list_network_requests', arguments: { pageId: Number(id) } });
        await broker.upstream.callTool({ name: 'list_console_messages', arguments: { pageId: Number(id) } });
    }
    const reloaded = await processResult('docker', ['exec', session.name, 'node', '--input-type=module', '-e',
        'await fetch("http://127.0.0.1:41099/reload",{method:"POST"})']);
    assert.equal(reloaded.code, 0);
    const config = join(output, 'model-mcp.json'); atomic(config, { mcpServers: { lab: { type: 'http', url: broker.url } } });
    state.setupSeconds = (Date.now() - setupAt) / 1000; state.browser = session.ready; save();
    note({ event: 'chain-started', project, condition: job.condition, steps: job.sample.tasks.length });
    for (let index = 0; index < job.sample.tasks.length; index++) {
        assert(!cancelled, 'Attempt cancelled');
        const stage = index + 1, dir = join(output, `step-${String(stage).padStart(2, '0')}`);
        mkdirSync(dir, { recursive: true, mode: 0o700 }); const auditStart = broker.audit.length;
        note({ event: 'step-started', project, condition: job.condition, stage });
        const model = await modelStep(index, dir, config);
        const code = await snapshot(dir);
        assert(model.verifiedModel, 'No verified model identity; inspect model receipt before retry');
        assert(!model.timedOut && (model.exit === 0 || model.subtype === 'error_max_turns'), 'Model process failed; original source and output retained');
        const gradeAt = Date.now(), verified = await grading(project, 'candidate', stage, join(dir, 'grading'), code.root, job.sample.verifierImage);
        const calls = broker.audit.slice(auditStart);
        const step = { stage, id: job.sample.tasks[index].id, sourceHash: code.sourceHash, model,
            cumulativePassed: verified.passed, currentTaskPassed: verified.currentTaskPassed,
            totalCases: verified.totalCases, stats: verified.stats, verifierSeconds: (Date.now() - gradeAt) / 1000,
            toolCalls: calls.length, imageResults: calls.reduce((n, c) => n + c.images, 0), toolErrors: calls.filter(c => c.isError).length,
            logReads: calls.filter(c => /console|network|errors|session|visitor|storage/.test(c.name)).length };
        state.steps.push(step); atomic(join(dir, 'step.json'), step); save();
        note({ event: 'step-completed', project, condition: job.condition, stage, passed: verified.passed, currentTaskPassed: verified.currentTaskPassed,
            toolCalls: step.toolCalls, imageResults: step.imageResults, seconds: model.seconds });
    }
    const costsKnown = state.steps.every(s => Number.isFinite(s.model.costUsd));
    const result = { kind: 'benchmark', condition: job.condition, model: job.model, agentVersion: job.agentVersion,
        score: state.steps.filter(s => s.cumulativePassed).length / state.steps.length,
        verifier: { name: 'Web-Bench pinned upstream cumulative Playwright tests; custom Agent adapter', sourceHash: job.sample.testHash },
        evidence: 'chain.json', ...(costsKnown ? { costUsd: state.steps.reduce((n, s) => n + s.model.costUsd, 0) } : {}),
        metrics: { unit: 'project-chain', completedSteps: state.steps.length, cumulativePassedSteps: state.steps.filter(s => s.cumulativePassed).length,
            currentTaskPassedSteps: state.steps.filter(s => s.currentTaskPassed).length, toolCalls: broker.audit.length,
            flakyCasesAcrossStages: state.steps.reduce((n, s) => n + (s.stats?.flaky ?? 0), 0),
            imageResults: broker.audit.reduce((n, c) => n + c.images, 0), instrumentation: state.browser.instrumentation },
        scoreDefinition: 'Fraction of sequential stages whose official init+task-1..task-N tests all pass; not a published leaderboard submission' };
    state.finishedAt = new Date().toISOString(); state.complete = true; save(); atomic(join(output, 'result.json'), result);
} finally {
    await broker?.close().catch(() => {});
    if (session) await stopSession(session.name);
    process.off('SIGTERM', cancel); process.off('SIGINT', cancel);
}
