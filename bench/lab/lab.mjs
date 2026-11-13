#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, copyFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { here, repo, environment, prepare, checkTree, refreshPreparedTooling } from './prepare.mjs';
import { plan, execute, summarize, atomic, digest } from './batch.mjs';

const [command] = process.argv.slice(2), args = process.argv.slice(3);
function option(name, fallback) { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; }
function latest() { const r = JSON.parse(readFileSync(join(here, '.cache/latest-context.json'))); return { ...r, context: resolve(here, r.context) }; }
function output(value) { console.log(JSON.stringify(value, null, 2)); }
if (command === 'prepare') { const r = await prepare(); output({ context: r.context, contentHash: r.receipt.contentHash, gatewayHash: r.receipt.gatewayHash }); }
else if (command === 'build') {
    const reused = option('reuse-image');
    if (reused) {
        const prepared = latest();
        const base = JSON.parse(execFileSync('docker', ['image', 'inspect', reused, '--format', '{{json .}}'], { encoding: 'utf8' }));
        const file = join(prepared.context, 'receipt.json'), receipt = JSON.parse(readFileSync(file));
        receipt.baseImage = { id: base.Id, reference: reused, architecture: base.Architecture };
        atomic(file, receipt);
    }
    const { context, contentHash } = refreshPreparedTooling(); checkTree(context);
    const cmd = ['build', '--build-arg', `NODE_IMAGE=${environment.nodeImage}`, '--build-arg', `PYTHON_IMAGE=${environment.pythonImage}`,
        ...(reused ? ['--build-arg', `LAB_BASE=${reused}`, '--file', join(context, 'Dockerfile.overlay')] : []),
        '--label', `harness-fe.source-hash=${contentHash}`, '-t', environment.image, ...(option('platform') ? ['--platform', option('platform')] : []), context];
    execFileSync('docker', cmd, { stdio: 'inherit' });
} else if (command === 'doctor') {
    if (option('ssh')) {
        const alias = option('ssh'); assert(/^[a-zA-Z0-9_.@-]+$/.test(alias) && !alias.startsWith('-'));
        const remote = 'python3 -c ' + "'import json,shutil,platform; print(json.dumps({\"platform\":platform.platform(),\"executables\":{x:shutil.which(x) for x in [\"node\",\"docker\",\"claude\",\"mx-env\"]}}))'";
        const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=40', alias, remote], { encoding: 'utf8', timeout: 55000 });
        output({ kind: 'remote-host-readiness', installedNothing: true, status: r.status, output: r.stdout?.trim(), error: r.error?.message || r.stderr?.trim() });
        if (r.status !== 0) process.exitCode = 1;
    } else {
        const result = JSON.parse(execFileSync('docker', ['run', '--rm', '--init', '--shm-size', '512m', environment.image, 'doctor'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
        for (const [name, version] of Object.entries(environment.evaluators)) assert.equal(result.evaluators[name], version, `Evaluator version drift: ${name}`);
        assert.equal(result.node, 'v' + environment.nodeImage.match(/node:([\d.]+)/)[1]);
        const code = 'import subprocess,json; cmds=["/opt/evaluators/harbor/bin/harbor","/opt/evaluators/swebench/bin/swebench","/opt/evaluators/webarena/bin/webarena-verified"]; out=[]\nfor cmd in cmds:\n r=subprocess.run([cmd,"--help"],capture_output=True,text=True,timeout=25); out.append({"command":cmd,"returncode":r.returncode,"helpReturned":bool(r.stdout.strip())})\nprint(json.dumps(out))';
        result.cliChecks = JSON.parse(execFileSync('docker', ['run', '--rm', '--init', '--entrypoint', 'python', environment.image, '-c', code], { encoding: 'utf8' }));
        assert(result.cliChecks.every(r => r.returncode === 0 && r.helpReturned), 'Evaluator CLI failed to launch');
        mkdirSync(join(here, '.cache'), { recursive: true }); atomic(join(here, '.cache/doctor.json'), result);
        output({ ...result, source: { contentHash: result.source.contentHash, gatewayHash: result.source.gatewayHash, runtimeHash: result.source.runtimeHash } });
    }
} else if (command === 'plan' || command === 'smoke') {
    const smoke = command === 'smoke' || args.includes('--smoke');
    let samples = smoke ? { suites: [{ id: 'browser-environment', unit: 'controlled-fixture', samples: [{ id: 'click-logs-native-image' }] }] }
        : JSON.parse(readFileSync(join(here, 'samples.json')));
    if (!smoke && option('suite')) {
        const selected = option('suite').split(',');
        for (const id of selected) assert(samples.suites.some(s => s.id === id), `Unknown suite: ${id}`);
        samples = { ...samples, suites: samples.suites.filter(s => selected.includes(s.id)) };
    }
    const { contentHash } = latest();
    const built = JSON.parse(execFileSync('docker', ['image', 'inspect', environment.image, '--format', '{{json .}}'], { encoding: 'utf8' }));
    assert.equal(built.Config.Labels?.['harness-fe.source-hash'], contentHash, 'Image/source context drift: rebuild first');
    const declared = plan(samples, { repeats: Number(option('repeats', smoke ? 1 : 3)), batchSize: Number(option('batch-size', 2)),
        kind: smoke ? 'environment-smoke' : 'benchmark', image: built.Id, environmentHash: contentHash,
        agentVersion: smoke ? undefined : execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim() });
    const file = resolve(option('out', join(here, '.cache', smoke ? 'smoke-plan.json' : 'plan.json')));
    mkdirSync(resolve(file, '..'), { recursive: true }); atomic(file, declared);
    if (command === 'plan') output({ plan: file, kind: declared.kind, jobs: declared.jobs.length, hash: digest(declared) });
    else {
        const run = resolve(option('run', join(here, 'jobs', 'smoke-' + Date.now())));
        output(await execute(declared, run, ['node', join(here, 'smoke-adapter.mjs')], { retryInterrupted: args.includes('--retry-interrupted') }));
        output({ artifacts: run });
    }
} else if (command === 'run') {
    const declared = JSON.parse(readFileSync(resolve(option('plan', join(here, '.cache/plan.json')))));
    assert.equal(execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), declared.agentVersion, 'Agent CLI changed: create a new plan/run');
    const dir = resolve(option('run', join(here, 'jobs/public-comparison'))), adapter = option('adapter');
    assert(adapter, 'Supply a reviewed dataset adapter with --adapter; environment smoke cannot grade public tasks');
    const inspection = JSON.parse(execFileSync('docker', ['image', 'inspect', declared.image, '--format', '{{json .}}'], { encoding: 'utf8' }));
    // Bind continuation to an exact image, not a mutable Docker tag.
    declared.image = inspection.Id;
    output(await execute(declared, dir, ['node', resolve(adapter)], { batch: Number(option('batch', 1)), retryInterrupted: args.includes('--retry-interrupted') }));
} else if (command === 'report') {
    const dir = resolve(option('run', join(here, 'jobs/public-comparison')));
    const summary = summarize(JSON.parse(readFileSync(join(dir, 'plan.json'))), JSON.parse(readFileSync(join(dir, 'state.json'))));
    atomic(join(dir, 'summary.json'), summary); output(summary);
} else if (command === 'agent-smoke') {
    const folder = join(here, 'jobs', 'agent-smoke-' + Date.now()), cwd = mkdtempSync(join(tmpdir(), 'hfe-lab-model-'));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const config = join(cwd, 'mcp.json'); atomic(config, { mcpServers: {} });
    const marker = 'lab-model-' + randomUUID();
    const result = spawnSync('claude', ['-p', `Reply exactly with: ${marker}`, '--model', environment.model,
        '--tools', '', '--strict-mcp-config', '--mcp-config', config, '--no-session-persistence', '--output-format', 'json'],
        { cwd, encoding: 'utf8', timeout: 120000 });
    let response; try { response = JSON.parse(result.stdout); } catch {}
    const models = Object.keys(response?.modelUsage ?? {});
    const receipt = { kind: 'model-connectivity-smoke', agentVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), passed: result.status === 0 && !response?.is_error && response?.result?.trim() === marker
        && models.length > 0 && models.every(m => m === environment.model),
        expectedModel: environment.model, models, markerMatched: response?.result?.trim() === marker,
        cliEstimatedUsd: response?.total_cost_usd, status: result.status, error: result.error?.message };
    atomic(join(folder, 'result.json'), receipt); output({ ...receipt, artifacts: folder });
    if (!receipt.passed) { writeFileSync(join(folder, 'diagnostic.log'), result.stderr || result.stdout || '', { mode: 0o600 }); process.exitCode = 1; }
} else if (command === 'bundle') {
    const { context, contentHash } = latest(); checkTree(context);
    const root = mkdtempSync(join(here, '.cache', 'bundle-')), toolkit = join(root, 'benchmark-lab');
    mkdirSync(join(toolkit, '.cache'), { recursive: true });
    cpSync(context, join(toolkit, '.cache/context'), { recursive: true, verbatimSymlinks: true });
    for (const file of ['lab.mjs', 'prepare.mjs', 'batch.mjs', 'batch.test.mjs', 'samples.test.mjs', 'smoke-adapter.mjs', 'freeze-samples.mjs', 'environment.json', 'package.json', 'package-lock.json', 'samples.json', 'Dockerfile', 'Dockerfile.overlay', 'container.mjs', 'README.md'])
        copyFileSync(join(here, file), join(toolkit, file));
    const exportedReadme = join(toolkit, 'README.md');
    writeFileSync(exportedReadme, readFileSync(exportedReadme, 'utf8').replace(/\[([^\]]+)\]\((\.\.[^)]+)\)/g, '$1 (reference in the full harness-fe checkout)'));
    atomic(join(toolkit, '.cache/latest-context.json'), { context: '.cache/context', contentHash });
    checkTree(toolkit);
    const out = resolve(option('out', join(here, '.cache', 'benchmark-lab-context.tar.gz')));
    execFileSync('tar', ['-czf', out, '-C', root, 'benchmark-lab']);
    output({ bundle: out, toolkitAndBuildContext: true, credentialsIncluded: false, note: 'Build natively on target; this does not install or run anything on Air' });
} else throw Error('Use prepare | build | doctor [--ssh ALIAS] | plan | smoke | agent-smoke | run | report | bundle');
