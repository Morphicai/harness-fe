import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const run = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(join(run, 'report.json')));
assert(report.mode === 'pilot' && report.completed, 'Need a completed real pilot');
assert.equal(report.trials.length, report.manifest.cases.length * report.manifest.conditions.length);
const average = (rows, key) => rows.reduce((n, r) => n + r[key], 0) / rows.length;
report.summary = Object.fromEntries(report.manifest.conditions.map((condition) => {
    const rows = report.trials.filter((t) => t.condition === condition);
    return [condition, {
        passed: rows.filter((r) => r.passed).length, total: rows.length,
        rootCausesCorrect: rows.filter((r) => r.checks.rootCause).length,
        evidenceIdsCorrect: rows.filter((r) => r.checks.evidenceId).length,
        screenshotCodesCorrect: rows.filter((r) => r.checks.screenshotCode).length,
        meanToolCalls: average(rows, 'toolCalls'), meanSeconds: average(rows, 'seconds'),
        meanRecordedCostUsd: average(rows, 'costUsd'),
        totalRecordedCostUsd: rows.reduce((n, r) => n + r.costUsd, 0),
        images: rows.reduce((n, r) => n + r.images, 0),
        toolErrors: rows.reduce((n, r) => n + r.toolErrors, 0),
        failedChecks: rows.reduce((counts, row) => {
            for (const [check, passed] of Object.entries(row.checks)) {
                if (!passed) counts[check] = (counts[check] ?? 0) + 1;
            }
            return counts;
        }, {}),
    }];
}));
writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(run, 'summary.json'), JSON.stringify(report.summary, null, 2));
const lines = ['# Runtime diagnostics pilot', '',
    'Self-authored; one attempt per case and condition. Not a WebArena score, not a repair-success rate.', '',
    '| Condition | Strict passes | Correct root cause | Correct evidence ID | Screenshot code | Mean tool calls | Mean seconds | Mean CLI-recorded USD |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const [condition, r] of Object.entries(report.summary)) lines.push(
    `| ${condition} | ${r.passed}/${r.total} | ${r.rootCausesCorrect}/${r.total} | ${r.evidenceIdsCorrect}/${r.total} | ${r.screenshotCodesCorrect}/${r.total} | ${r.meanToolCalls.toFixed(1)} | ${r.meanSeconds.toFixed(1)} | ${r.meanRecordedCostUsd.toFixed(3)} |`);
lines.push('', '| Case | Condition | Strict pass | Failed checks | Tool calls | Seconds | CLI-recorded USD | Images |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const t of report.trials) {
    const failed = Object.entries(t.checks).filter(([, passed]) => !passed).map(([name]) => name);
    lines.push(`| ${t.case} | ${t.condition} | ${t.passed} | ${failed.join(', ') || 'none'} | ${t.toolCalls} | ${t.seconds.toFixed(1)} | ${t.costUsd.toFixed(3)} | ${t.images} |`);
}
const failedCheckNames = new Set(Object.values(report.summary).flatMap((r) => Object.keys(r.failedChecks)));
if (failedCheckNames.size === 1 && failedCheckNames.has('visibleState')) {
    lines.push('', 'Every failed attempt missed only the exact visible_state field. Root causes, decisive IDs, incident codes, log reads and native image returns all passed. The original strict scores are retained; component accuracy is reported separately. The prompt did not name a specific status element, so heading/body and heading/full-warning differences need an explicit rubric in a future version.');
}
lines.push('', '## Structured diagnoses', '');
for (const t of report.trials) {
    lines.push(`### ${t.case} / ${t.condition}`, '',
        `Checks: ${JSON.stringify(t.checks)}`, '',
        `Reported visible_state: ${JSON.stringify(t.answer?.visible_state ?? null)}`, '',
        t.answer?.explanation ?? 'No explanation returned.', '');
}
lines.push('Both collectors were connected before the incident and retained their MCP sessions. Log access and native image return are checked, but this is not a causal ablation proving that images or any single logging tool were necessary.',
    'The incident code is also accessible in the DOM; this is an evidence-consumption pilot, not an isolated vision benchmark.',
    'CLI cost estimates are not provider invoices. Single attempts on self-authored cases do not establish a general ranking.');
writeFileSync(join(run, 'results.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ summary: report.summary, results: join(run, 'results.md') }));
