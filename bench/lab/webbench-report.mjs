#!/usr/bin/env node
/** Join explicitly selected project runs without rewriting plans or partial scores. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './batch.mjs';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
const fraction = (passed, total) => ({ passed, total, fraction: total ? passed / total : null });
const logNames = /^(console\.tail|errors\.tail|network\.(tail|get)|list_console_messages|get_console_message|list_network_requests|get_network_request)$/;
const screenshotNames = new Set(['page.screenshot', 'take_screenshot']);

function auditRows(path, complete) {
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf8').split('\n');
    // A live append can be observed before its final newline; never ignore corruption
    // in a completed attempt or in an earlier line.
    if (!complete && lines.at(-1)) lines.pop();
    return lines.filter(Boolean).map(line => JSON.parse(line));
}

function toolMetrics(rows) {
    const counts = {};
    for (const row of rows) counts[row.name] = (counts[row.name] ?? 0) + 1;
    const workspace = rows.filter(row => row.name.startsWith('workspace_'));
    const screenshots = rows.filter(row => screenshotNames.has(row.name));
    const logs = rows.filter(row => logNames.test(row.name));
    return { calls: rows.length, workspaceCalls: workspace.length, browserCalls: rows.length - workspace.length,
        nativeImages: sum(rows, 'images'), screenshotCalls: screenshots.length,
        screenshotCallsWithoutNativeImage: screenshots.filter(row => row.images === 0).length,
        errors: rows.filter(row => row.isError).length, logReads: logs.length,
        logReadErrors: logs.filter(row => row.isError).length, counts };
}

function attempt(run, plan, state, job) {
    const current = state.jobs[job.id];
    // Resolve from the run rather than saved absolute host paths, so copied evidence works.
    const dir = current && join(run, job.id, String(current.attempt));
    const chainPath = dir && join(dir, 'chain.json');
    const chain = chainPath && existsSync(chainPath) ? json(chainPath) : null;
    const complete = current?.state === 'completed';
    const steps = chain?.steps ?? [];
    if (chain) {
        assert.equal(chain.project, job.sample.id); assert.equal(chain.condition, job.condition);
        assert.equal(chain.model, plan.model);
    }
    const grades = steps.map((step, i) => {
        assert.equal(step.stage, i + 1, 'Non-contiguous stage evidence');
        assert.equal(step.id, job.sample.tasks[i].id);
        assert(step.model.verifiedModel && step.model.actualModels.length > 0);
        assert(step.model.actualModels.every(model => model === plan.model), 'Model drift');
        assert.equal(step.model.agentVersion, plan.agentVersion, 'Agent drift');
        const stepDir = join(dir, `step-${String(step.stage).padStart(2, '0')}`);
        assert.equal(json(join(stepDir, 'source-receipt.json')).sourceHash, step.sourceHash);
        const grade = json(join(stepDir, 'grading/verification.json'));
        assert.equal(grade.project, job.sample.id); assert.equal(grade.mode, 'candidate');
        assert.equal(grade.stage, step.stage); assert.equal(grade.totalCases, step.totalCases);
        assert.equal(grade.passed, step.cumulativePassed); assert.equal(grade.currentTaskPassed, step.currentTaskPassed);
        assert.equal(grade.cases.length, grade.totalCases);
        return grade;
    });
    const cumulative = steps.filter(step => step.cumulativePassed).length;
    const currentTask = steps.filter(step => step.currentTaskPassed).length;
    if (complete) {
        assert(chain?.complete, 'Completed state has incomplete chain');
        assert.equal(steps.length, job.sample.tasks.length, 'Completed chain missing stages');
        assert.equal(current.result.score, cumulative / steps.length, 'Saved score disagrees with evidence');
        assert.equal(current.result.verifier.sourceHash, job.sample.testHash, 'Verifier drift');
    }
    const known = steps.filter(step => Number.isFinite(step.model.costUsd));
    const lastGrade = grades.at(-1);
    const phase = current?.state !== 'running' ? current?.state ?? 'pending'
        : chain?.complete ? 'cleanup' : chain?.setupSeconds === undefined ? 'setup'
            : existsSync(join(dir, `step-${String(steps.length + 1).padStart(2, '0')}`, 'model-receipt.json')) ? 'grading' : 'model-execution';
    return { project: job.sample.id, condition: job.condition, repeat: job.repeat, id: job.id,
        runId: basename(run), planHash: state.planHash, attempt: current?.attempt ?? null,
        state: current?.state ?? 'pending', phase, complete, completedSteps: steps.length, plannedSteps: job.sample.tasks.length,
        identity: { model: plan.model, agentVersion: plan.agentVersion, agentImage: plan.image,
            verifierImage: job.sample.verifierImage, sourceHash: job.sample.sourceHash,
            runnerHash: job.sample.runnerHash, testHash: job.sample.testHash, taskRecordHash: job.sample.recordHash },
        // Partial observations are deliberately distinct from completed comparison scores.
        score: complete ? cumulative / steps.length : null,
        cumulativeStages: fraction(cumulative, steps.length), currentTaskStages: fraction(currentTask, steps.length),
        finalCases: complete && lastGrade ? fraction(lastGrade.cases.filter(c => ['expected', 'flaky'].includes(c.status)).length, lastGrade.totalCases) : null,
        finalFlakyCases: complete ? lastGrade.stats.flaky : null,
        flakyCaseOccurrencesAcrossStages: grades.reduce((n, grade) => n + grade.stats.flaky, 0),
        finalFailures: complete ? lastGrade.cases.filter(c => !['expected', 'flaky'].includes(c.status)) : [],
        timing: { setupSeconds: chain?.setupSeconds ?? null,
            modelSeconds: steps.reduce((n, step) => n + step.model.seconds, 0),
            gradingSeconds: sum(steps, 'verifierSeconds'), wholeAttemptSeconds: complete ? current.seconds : null },
        cost: { cliEstimatedUsdForGradedSteps: known.reduce((n, step) => n + step.model.costUsd, 0),
            knownGradedSteps: known.length, unknownGradedSteps: steps.length - known.length,
            ungradedOrPendingSteps: job.sample.tasks.length - steps.length,
            source: 'Claude CLI estimate, not provider invoice; ungraded/unknown usage is not assumed free' },
        tools: toolMetrics(dir ? auditRows(join(dir, 'tools.jsonl'), complete) : []),
        stages: steps.map((step, i) => ({ stage: step.stage, sourceHash: step.sourceHash,
            cumulativePassed: step.cumulativePassed, currentTaskPassed: step.currentTaskPassed,
            modelSubtype: step.model.subtype, unexpectedCases: grades[i].cases.filter(c => c.status === 'unexpected').map(c => ({ file: c.file, title: c.title })),
            flakyCases: grades[i].cases.filter(c => c.status === 'flaky').map(c => ({ file: c.file, title: c.title })) })),
        failure: current?.failure ?? null };
}

export function createReport(selections) {
    assert(selections.length > 0, 'Select at least one project/run');
    const projects = new Set(), runs = [], attempts = [], excludedCoverage = [];
    for (const { project, run: input } of selections) {
        assert(!projects.has(project), 'Select each project exactly once; never silently replace a run');
        projects.add(project);
        const run = resolve(input), plan = json(join(run, 'plan.json')), state = json(join(run, 'state.json'));
        assert.equal(plan.kind, 'benchmark'); assert.equal(state.planHash, digest(plan), 'Plan/state hash mismatch');
        const selected = plan.jobs.filter(job => job.suite === 'web-bench' && job.sample.id === project);
        assert(selected.length > 0, `Project ${project} absent from selected run`);
        const keys = selected.map(job => `${job.repeat}/${job.condition}`);
        assert.equal(new Set(keys).size, keys.length, 'Duplicate condition/repeat');
        for (const job of selected) attempts.push(attempt(run, plan, state, job));
        runs.push({ project, runId: basename(run), planHash: state.planHash, adapterHash: state.adapterHash });
        for (const job of plan.jobs.filter(job => job.sample.id !== project)) {
            const row = state.jobs[job.id], path = row && join(run, job.id, String(row.attempt), 'chain.json');
            excludedCoverage.push({ project: job.sample.id, condition: job.condition, runId: basename(run),
                state: row?.state ?? 'pending', completedSteps: path && existsSync(path) ? json(path).steps.length : 0,
                reason: 'Not selected from this run; retained original coverage, not silently graded or replaced' });
        }
    }
    const pairKeys = [...new Set(attempts.map(row => `${row.project}/${row.repeat}`))];
    const pairs = pairKeys.map(key => {
        const rows = attempts.filter(row => `${row.project}/${row.repeat}` === key);
        const a = rows.find(row => row.condition === 'harness-fe'), b = rows.find(row => row.condition === 'chrome-devtools-mcp');
        assert(a && b && rows.length === 2, 'Each selected repeat requires both conditions');
        assert.deepEqual(a.identity, b.identity, 'Paired environment/model/task mismatch');
        const complete = a.complete && b.complete;
        return { project: a.project, repeat: a.repeat, complete,
            outcome: complete ? a.score > b.score ? 'harness-fe-win' : a.score < b.score ? 'chrome-devtools-win' : 'tie' : 'unresolved' };
    });
    return { kind: 'webbench-explicitly-joined-report', generatedAt: new Date().toISOString(),
        complete: attempts.every(row => row.complete), runs, attempts, pairs, excludedCoverage,
        scope: { projects: projects.size, attempts: attempts.length, completedAttempts: attempts.filter(row => row.complete).length,
            completedSteps: sum(attempts, 'completedSteps'), plannedSteps: sum(attempts, 'plannedSteps'),
            inference: 'Correlated sequential project chains, not independent development samples or an official leaderboard submission' },
        imageEvidence: 'Native MCP image blocks returned to the model; does not establish correct visual reasoning or a causal quality benefit' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2), selections = []; let output;
    while (args.length) {
        const flag = args.shift();
        if (flag === '--select') { const project = args.shift(), run = args.shift(); assert(project && run); selections.push({ project, run }); }
        else if (flag === '--out') { output = args.shift(); assert(output); }
        else throw Error('Use --select PROJECT RUN [--select PROJECT RUN] [--out FILE]');
    }
    const report = createReport(selections), value = JSON.stringify(report, null, 2) + '\n';
    if (output) writeFileSync(output, value, { mode: 0o600 });
    else process.stdout.write(value);
}
