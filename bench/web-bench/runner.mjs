import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { here, settings, hash } from './prepare.mjs';
import { processResult } from './broker.mjs';

export function prepared() {
    const value = JSON.parse(readFileSync(join(here, '.cache/latest.json')));
    assert.deepEqual(value.receipt.settings, settings, 'Dataset settings changed: prepare a new context');
    return value;
}
export function image(name) { return JSON.parse(execFileSync('docker', ['image', 'inspect', name, '--format', '{{json .}}'], { encoding: 'utf8' })); }
export function runnerHash() {
    return hash(JSON.stringify(readdirSync(here).filter(n => (n.endsWith('.mjs') && !n.endsWith('.test.mjs')) || ['environment.json', 'Dockerfile', 'package-lock.json'].includes(n)).sort().map(n => [n, hash(readFileSync(join(here, n)))])));
}
export function removeContainer(name) {
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10000 }); } catch {}
}
export async function stopSession(name) {
    await processResult('docker', ['stop', '--time', '15', name], { timeout: 20000 });
    removeContainer(name);
}
export async function grading(project, mode, stage, dir, source, verifierImage = settings.verifierImage) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = 'hfe-wb-grade-' + randomUUID().slice(0, 12);
    const args = ['run', '--rm', '--init', '--network', 'none', '--name', name, '--label', 'harness-fe.benchmark=webbench-verifier',
        '--cpus', '2', '--memory', '3g', '--shm-size', '512m', '-v', `${dir}:/artifacts`,
        ...(source ? ['-v', `${source}:/candidate:ro`] : []), verifierImage, project, mode, String(stage)];
    const cancel = () => removeContainer(name); process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
    try {
        const result = await processResult('docker', args, { timeout: 1250000 });
        writeFileSync(join(dir, 'container.log'), result.stdout + result.stderr, { mode: 0o600 });
        assert.equal(result.code, 0, `Verifier container failed; inspect ${dir}`);
        return JSON.parse(readFileSync(join(dir, 'verification.json')));
    } finally { removeContainer(name); process.off('SIGTERM', cancel); process.off('SIGINT', cancel); }
}
export async function startSession(project, condition, dir, agentImage = settings.agentImage) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = 'hfe-wb-agent-' + randomUUID().slice(0, 12);
    const r = await processResult('docker', ['run', '-d', '--init', '--network', 'none', '--name', name,
        '--label', 'harness-fe.benchmark=webbench-agent', '--cpus', '2', '--memory', '3g', '--shm-size', '512m',
        '-e', `PROJECT=${project}`, '-e', `CONDITION=${condition}`, '-v', `${dir}:/artifacts`, agentImage]);
    assert.equal(r.code, 0, 'Agent container failed to start');
    for (let i = 0; i < 450; i++) {
        if (existsSync(join(dir, 'ready.json'))) return { name, ready: JSON.parse(readFileSync(join(dir, 'ready.json'))) };
        if (existsSync(join(dir, 'startup-error.txt'))) { removeContainer(name); throw Error('Session startup failed; inspect ' + dir); }
        await sleep(200);
    }
    removeContainer(name); throw Error('Session did not become ready; inspect ' + dir);
}
export async function buildImages() {
    const { context, receipt } = prepared();
    const lab = image(JSON.parse(readFileSync(join(here, '../lab/environment.json'))).image);
    assert.equal(lab.Id, receipt.baseImage, 'Dataset/base image drift: prepare again');
    for (const [target, tag] of [['agent', settings.agentImage], ['verifier', settings.verifierImage]]) {
        const log = join(here, `.cache/build-${target}-${Date.now()}.log`);
        writeFileSync(log, ''); console.log(JSON.stringify({ target, log }));
        const r = await processResult('docker', ['build', '--build-arg', `LAB_IMAGE=${lab.RepoTags[0]}`,
            '--build-arg', `NODE_IMAGE=${JSON.parse(readFileSync(join(here, '../lab/environment.json'))).nodeImage}`,
            '--label', `harness-fe.dataset-source=${receipt.sourceHash}`, '--target', target, '-t', tag, context],
            { timeout: 1800000, onOutput: bytes => appendFileSync(log, bytes) });
        assert.equal(r.code, 0, 'Dataset image failed; inspect build log for ' + target);
        console.log(JSON.stringify({ target, image: image(tag).Id }));
    }
}
