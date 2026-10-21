#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { here, settings, prepareDataset, hash } from './prepare.mjs';
import { prepared, buildImages, image, grading, runnerHash, startSession, stopSession } from './runner.mjs';
import { openBroker, workspace, processResult } from './broker.mjs';
import { plan, execute, atomic, summarize } from '../lab/batch.mjs';

const [command] = process.argv.slice(2), args = process.argv.slice(3);
const option = (name, fallback) => { const n = args.indexOf('--' + name); return n < 0 ? fallback : args[n + 1]; };
const output = value => console.log(JSON.stringify(value, null, 2));
if (command === 'prepare') {
    const { context, receipt } = await prepareDataset(); output({ context, sourceHash: receipt.sourceHash });
} else if (command === 'build') await buildImages();
else if (command === 'preflight') {
    const folder = resolve(option('run', join(here, 'jobs/preflight-' + Date.now())));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const { receipt } = prepared(), verifier = image(settings.verifierImage), agent = image(settings.agentImage);
    const report = { kind: 'webbench-preflight', startedAt: new Date().toISOString(), sourceHash: receipt.sourceHash,
        images: { verifier: verifier.Id, agent: agent.Id }, controls: [], complete: false };
    const save = () => atomic(join(folder, 'report.json'), report); save();
    for (const p of receipt.projects) {
        for (const [mode, stage] of [['reference', 20], ['initial', 1]]) {
            const dir = join(folder, p.id, mode), result = await grading(p.id, mode, stage, dir, undefined, verifier.Id);
            report.controls.push({ project: p.id, mode, stage, passed: result.passed, totalCases: result.totalCases,
                stats: result.stats, accepted: mode === 'reference' ? result.passed : !result.passed && result.totalCases > 0 });
            save(); output(report.controls.at(-1));
            assert(report.controls.at(-1).accepted, 'Reference/initial control failed: inspect ' + dir);
        }
    }
    report.complete = true; report.finishedAt = new Date().toISOString(); save();
    atomic(join(here, '.cache/preflight.json'), { folder, reportHash: hash(JSON.stringify(report)), report });
    output({ artifacts: folder, passed: true });
} else if (command === 'browser-preflight') {
    const folder = resolve(option('run', join(here, 'jobs/browser-preflight-' + Date.now())));
    const report = { kind: 'webbench-browser-preflight', cases: [], complete: false };
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    for (const project of settings.projects) for (const condition of ['harness-fe', 'chrome-devtools-mcp']) {
        const dir = join(folder, project, condition); mkdirSync(dir, { recursive: true });
        let session, broker;
        try {
            session = await startSession(project, condition, join(dir, 'browser'));
            broker = await openBroker(session.name, condition, dir);
            const list = await workspace(session.name, { action: 'list' }); assert(!list.isError);
            const forbidden = await workspace(session.name, { action: 'read', path: '/opt/verifier/react/src/App.tsx' }); assert(forbidden.isError);
            const noOracle = await workspace(session.name, { action: 'exec', command: 'test ! -e /opt/verifier && test ! -e /workspace/task/test && echo isolated' });
            assert.equal(noOracle.value.status, 0);
            const text = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            let target;
            if (condition === 'harness-fe') {
                const tabs = JSON.parse(text(await broker.upstream.callTool({ name: 'tab.list', arguments: {} })));
                const tab = tabs.find(t => t.projectId === 'webbench-' + project); assert(tab);
                target = { tabId: tab.tabId };
                const dom = await broker.upstream.callTool({ name: 'page.dom_query', arguments: { ...target, selector: { css: '[data-morphix-loc]' }, limit: 1 } });
                assert(text(dom).includes('data-morphix-loc'));
            } else {
                const pages = text(await broker.upstream.callTool({ name: 'list_pages', arguments: {} }));
                const id = pages.split('\n').find(s => s.includes('127.0.0.1:3211'))?.match(/^(\d+):/)?.[1]; assert(id);
                target = { pageId: Number(id) };
                await broker.upstream.callTool({ name: 'list_network_requests', arguments: target });
                await broker.upstream.callTool({ name: 'list_console_messages', arguments: target });
            }
            const marker = 'webbench-acceptance-' + randomUUID();
            const script = `async()=>{console.log(${JSON.stringify(marker)});return (await fetch('/__webbench_acceptance?marker=${marker}')).status}`;
            const evaluated = await broker.upstream.callTool(condition === 'harness-fe'
                ? { name: 'page.evaluate', arguments: { ...target, expr: `(${script})()` } }
                : { name: 'evaluate_script', arguments: { ...target, function: script } });
            assert(!evaluated.isError);
            const logs = await broker.upstream.callTool({ name: condition === 'harness-fe' ? 'console.tail' : 'list_console_messages', arguments: target });
            const network = await broker.upstream.callTool({ name: condition === 'harness-fe' ? 'network.tail' : 'list_network_requests', arguments: target });
            assert(text(logs).includes(marker)); assert(text(network).includes(marker));
            const shot = await broker.upstream.callTool({ name: condition === 'harness-fe' ? 'page.screenshot' : 'take_screenshot', arguments: { ...target, format: 'png' } });
            const png = shot.content.find(c => c.type === 'image'); assert(png && png.mimeType === 'image/png');
            writeFileSync(join(dir, 'native-image.png'), Buffer.from(png.data, 'base64'));
            report.cases.push({ project, condition, passed: true, browser: session.ready.browserVersion,
                sourceAttributes: condition === 'harness-fe', nativeImage: true, console: true, network: true, isolatedWorkspace: true });
            atomic(join(folder, 'report.json'), report); output(report.cases.at(-1));
        } finally { await broker?.close().catch(() => {}); if (session) await stopSession(session.name); }
    }
    report.complete = true; atomic(join(folder, 'report.json'), report);
    atomic(join(here, '.cache/browser-preflight.json'), { folder, report, agentImage: image(settings.agentImage).Id });
} else if (command === 'agent-preflight') {
    const folder = resolve(option('run', join(here, 'jobs/agent-preflight-' + Date.now())));
    const report = { kind: 'webbench-model-tool-preflight', cases: [], complete: false };
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    for (const condition of ['harness-fe', 'chrome-devtools-mcp']) {
        const dir = join(folder, condition); mkdirSync(dir, { recursive: true });
        let session, broker;
        try {
            session = await startSession('react', condition, join(dir, 'browser'));
            broker = await openBroker(session.name, condition, dir);
            const config = join(dir, 'mcp.json'); atomic(config, { mcpServers: { lab: { type: 'http', url: broker.url } } });
            const marker = 'agent-tools-' + randomUUID();
            const prompt = `This is an environment acceptance, not a public benchmark task. Use workspace_write_file to create acceptance.txt containing exactly ${marker}. Use the browser tools to take a screenshot of http://127.0.0.1:3211 and read its console messages. Do not modify application source. Then reply exactly ${marker}.`;
            const cwd = mkdtempSync(join(tmpdir(), 'hfe-webbench-agent-acceptance-'));
            const r = await processResult('claude', ['-p', prompt, '--model', settings.model, '--tools', '', '--output-format', 'json',
                '--no-session-persistence', '--disable-slash-commands', '--mcp-config', config, '--strict-mcp-config',
                '--permission-mode', 'acceptEdits', '--allowedTools', 'mcp__lab', '--max-turns', '15'], { cwd, timeout: 240000 });
            writeFileSync(join(dir, 'model.json'), r.stdout, { mode: 0o600 }); writeFileSync(join(dir, 'stderr.log'), r.stderr, { mode: 0o600 });
            let model; try { model = JSON.parse(r.stdout); } catch {}
            const actualModels = Object.keys(model?.modelUsage ?? {});
            const file = await workspace(session.name, { action: 'read', path: 'acceptance.txt' });
            const result = { condition, passed: r.code === 0 && !model?.is_error && actualModels.length > 0 && actualModels.every(m => m === settings.model)
                && file.value.text?.trim() === marker && model?.result?.trim() === marker
                && broker.audit.some(c => c.images > 0) && broker.audit.some(c => /console/.test(c.name)),
                actualModels, toolCalls: broker.audit.length, images: broker.audit.reduce((n, c) => n + c.images, 0),
                costUsd: model?.total_cost_usd, exit: r.code, subtype: model?.subtype, permissionDenials: model?.permission_denials?.length ?? 0 };
            report.cases.push(result); atomic(join(folder, 'report.json'), report); output(result);
            assert(result.passed, 'Actual model/workspace/image acceptance failed: inspect ' + dir);
        } finally { await broker?.close().catch(() => {}); if (session) await stopSession(session.name); }
    }
    report.complete = true; atomic(join(folder, 'report.json'), report);
    atomic(join(here, '.cache/agent-preflight.json'), { folder, report, agentImage: image(settings.agentImage).Id });
} else if (command === 'plan') {
    const { receipt } = prepared(), accepted = JSON.parse(readFileSync(join(here, '.cache/preflight.json')));
    assert(accepted.report.complete && accepted.report.sourceHash === receipt.sourceHash, 'Run matching preflight first');
    const agent = image(settings.agentImage), verifier = image(settings.verifierImage);
    assert.equal(agent.Id, accepted.report.images.agent); assert.equal(verifier.Id, accepted.report.images.verifier);
    const browser = JSON.parse(readFileSync(join(here, '.cache/browser-preflight.json')));
    assert(browser.report.complete && browser.agentImage === agent.Id, 'Run matching browser preflight first');
    const model = JSON.parse(readFileSync(join(here, '.cache/agent-preflight.json')));
    assert(model.report.complete && model.agentImage === agent.Id, 'Run matching model-tool preflight first');
    const sampleManifest = { suites: [{ id: 'web-bench', unit: 'project-chain', revision: settings.revision,
        samples: receipt.projects.map(p => ({ ...p, runnerHash: runnerHash(), verifierImage: verifier.Id,
            sourceHash: receipt.sourceHash, preflightHash: accepted.reportHash })) }] };
    const declared = plan(sampleManifest, { repeats: Number(option('repeats', 1)), batchSize: 2, model: settings.model,
        image: agent.Id, environmentHash: receipt.sourceHash, agentVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim() });
    declared.attemptTimeoutMs = settings.attemptTimeoutMs;
    const file = resolve(option('out', join(here, '.cache/plan.json'))); atomic(file, declared);
    output({ file, jobs: declared.jobs.length, developmentSteps: declared.jobs.reduce((n, j) => n + j.sample.tasks.length, 0) });
} else if (command === 'run') {
    const declared = JSON.parse(readFileSync(resolve(option('plan', join(here, '.cache/plan.json')))));
    assert.equal(execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), declared.agentVersion);
    const run = resolve(option('run', join(here, 'jobs/paired-' + Date.now())));
    output({ run, result: await execute(declared, run, ['node', join(here, 'adapter.mjs')],
        { batch: 1, timeoutMs: declared.attemptTimeoutMs, retryInterrupted: args.includes('--retry-interrupted') }) });
} else if (command === 'report') {
    const dir = resolve(option('run')); const declared = JSON.parse(readFileSync(join(dir, 'plan.json')));
    output(summarize(declared, JSON.parse(readFileSync(join(dir, 'state.json')))));
} else throw Error('Use prepare | build | preflight | plan | run | report');
