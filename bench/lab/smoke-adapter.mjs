import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const job = JSON.parse(readFileSync(process.argv[2]));
assert.equal(job.kind, 'environment-smoke', 'This adapter does not grade public benchmark tasks');
const name = 'hfe-lab-' + job.id.slice(0, 16);
const cleanup = () => { try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 2500 }); } catch {} };
process.once('SIGTERM', cleanup); process.once('SIGINT', cleanup);
try {
    const child = spawn('docker', ['run', '--rm', '--init', '--name', name, '--label', 'harness-fe.benchmark=lab',
        '--cpus', '2', '--memory', '3g', '--shm-size', '512m', '-v', `${job.output}:/artifacts`,
        job.image, 'smoke', job.condition, '/artifacts'], { stdio: 'inherit' });
    const code = await new Promise((r, reject) => { child.once('exit', r); child.once('error', reject); });
    assert.equal(code, 0, 'Browser container failed');
} finally { cleanup(); process.off('SIGTERM', cleanup); process.off('SIGINT', cleanup); }
