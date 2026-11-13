#!/usr/bin/env node
/** Read-only view of completed and active chains; never turns partial work into scores. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2]);
const plan = JSON.parse(readFileSync(join(root, 'plan.json')));
const state = JSON.parse(readFileSync(join(root, 'state.json')));
const attempts = plan.jobs.map(job => {
    const current = state.jobs[job.id];
    const chainFile = current && join(current.output, 'chain.json');
    const chain = chainFile && existsSync(chainFile) ? JSON.parse(readFileSync(chainFile)) : undefined;
    const steps = chain?.steps ?? [];
    const knownCosts = steps.filter(s => Number.isFinite(s.model.costUsd));
    const auditFile = current && join(current.output, 'tools.jsonl');
    const audit = auditFile && existsSync(auditFile) ? readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const activeStage = current?.state === 'running' && !chain?.complete ? steps.length + 1 : undefined;
    const activeModelReceipt = activeStage && join(current.output, `step-${String(activeStage).padStart(2, '0')}/model-receipt.json`);
    const phase = current?.state !== 'running' ? current?.state ?? 'pending'
        : chain?.complete ? 'cleanup' : chain?.setupSeconds === undefined ? 'setup'
            : activeModelReceipt && existsSync(activeModelReceipt) ? 'grading' : 'model-execution';
    return { id: job.id, project: job.sample.id, condition: job.condition, state: current?.state ?? 'pending',
        phase, activeStage,
        completedSteps: steps.length, plannedSteps: job.sample.tasks?.length,
        cumulativePassedStages: steps.filter(s => s.cumulativePassed).length,
        currentTaskPassedStages: steps.filter(s => s.currentTaskPassed).length,
        flakyCasesAcrossStages: steps.reduce((n, s) => n + (s.stats?.flaky ?? 0), 0),
        score: current?.state === 'completed' ? current.result.score : null,
        modelSeconds: Math.round(steps.reduce((n, s) => n + s.model.seconds, 0) * 10) / 10,
        knownCliCostUsd: knownCosts.reduce((n, s) => n + s.model.costUsd, 0), costKnownSteps: knownCosts.length,
        costUnknownSteps: steps.length - knownCosts.length,
        toolCallsIncludingActiveStep: audit.length, imageResults: audit.reduce((n, c) => n + c.images, 0),
        logReads: audit.filter(c => /console|network|errors|session|visitor|storage/.test(c.name)).length,
        failure: current?.failure };
});
const pairs = [...new Set(attempts.map(a => a.project))].map(project => {
    const rows = attempts.filter(a => a.project === project), a = rows.find(r => r.condition === 'harness-fe'), b = rows.find(r => r.condition === 'chrome-devtools-mcp');
    return { project, complete: rows.every(r => r.state === 'completed'),
        outcome: rows.every(r => r.state === 'completed') ? a.score > b.score ? 'harness-fe-win' : a.score < b.score ? 'chrome-devtools-win' : 'tie' : 'unresolved' };
});
console.log(JSON.stringify({ kind: plan.kind, model: plan.model, agentVersion: plan.agentVersion,
    completedSteps: attempts.reduce((n, a) => n + a.completedSteps, 0), plannedSteps: attempts.reduce((n, a) => n + (a.plannedSteps ?? 0), 0),
    attempts, pairs, costSource: 'CLI estimate for completed model steps only; active/unknown usage is not assumed free' }, null, 2));
