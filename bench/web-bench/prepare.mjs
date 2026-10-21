import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const settings = JSON.parse(readFileSync(join(here, 'environment.json')));
export const vendor = join(here, 'vendor/web-bench');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function treeHash(root) {
    const files = [];
    function walk(dir, path = '') {
        for (const name of readdirSync(dir).sort()) {
            const p = join(dir, name), rel = path ? `${path}/${name}` : name;
            if (statSync(p).isDirectory()) walk(p, rel); else files.push([rel, hash(readFileSync(p))]);
        }
    }
    walk(root); return hash(JSON.stringify(files));
}
export function parseTasks(raw, file) {
    if (file.endsWith('.jsonl')) return raw.trim().split('\n').map(line => JSON.parse(line));
    // These pinned YAML records contain scalar metadata and literal descriptions.
    // Refuse unsupported syntax instead of guessing a task boundary.
    const blocks = raw.split(/(?=^- id: )/m).filter(s => s.trim());
    return blocks.map(block => {
        const id = block.match(/^- id: (task-\d+)\s*$/m)?.[1];
        const description = block.match(/^  description: \|\n([\s\S]*)$/m)?.[1]
            ?.split('\n').map(line => line.replace(/^    /, '')).join('\n').trim();
        assert(id && description, 'Unsupported upstream task YAML');
        return { id, description };
    });
}
export async function prepareDataset() {
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vendor, encoding: 'utf8' }).trim(), settings.revision);
    const context = join(here, '.cache/context-' + Date.now()); mkdirSync(context, { recursive: true, mode: 0o700 });
    const deps = join(context, 'deps'); mkdirSync(join(deps, 'libraries'), { recursive: true });
    const dependencies = {};
    for (const name of ['test-util', 'shop-test-util']) {
        cpSync(join(vendor, 'libraries', name), join(deps, 'libraries', name), { recursive: true });
        const file = join(deps, 'libraries', name, 'package.json'), pkg = JSON.parse(readFileSync(file));
        for (const [key, value] of Object.entries(pkg.dependencies ?? {})) if (value.startsWith('workspace:')) pkg.dependencies[key] = '0.0.1';
        writeFileSync(file, JSON.stringify(pkg, null, 2));
        dependencies[`@web-bench/${name}`] = '0.0.1';
    }
    const manifest = JSON.parse(readFileSync(join(here, '../lab/samples.json')));
    const selected = manifest.suites.find(s => s.id === 'web-bench');
    assert.equal(selected.revision, settings.revision);
    const projects = [];
    for (const name of settings.projects) {
        const project = join(vendor, 'projects', name), pkg = JSON.parse(readFileSync(join(project, 'package.json')));
        for (const [key, value] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
            if (!value.startsWith('workspace:')) dependencies[key] = value;
        }
        const seed = join(context, 'seeds', name), verifier = join(context, 'verifier', name);
        mkdirSync(seed, { recursive: true }); mkdirSync(verifier, { recursive: true });
        for (const file of ['package.json', 'vite.config.ts', 'tsconfig.json', 'scripts']) {
            if (existsSync(join(project, file))) cpSync(join(project, file), join(seed, file), { recursive: true });
        }
        cpSync(join(project, 'src-init'), join(seed, 'src'), { recursive: true });
        for (const file of ['package.json', 'vite.config.ts', 'tsconfig.json', 'playwright.config.js', 'scripts', 'test', 'src']) {
            if (existsSync(join(project, file))) cpSync(join(project, file), join(verifier, file), { recursive: true });
        }
        const sample = selected.samples.find(s => s.id === name); assert(sample);
        const raw = readFileSync(join(vendor, sample.taskFile), 'utf8'); assert.equal(hash(raw), sample.recordHash);
        const tasks = parseTasks(raw, sample.taskFile);
        assert.deepEqual(tasks.map(t => t.id), sample.taskIds);
        projects.push({ ...sample, tasks, seedHash: treeHash(seed), referenceHash: treeHash(join(verifier, 'src')),
            testHash: treeHash(join(verifier, 'test')) });
    }
    dependencies['@harness-fe/vite'] = settings.harnessVersion;
    dependencies['@harness-fe/runtime'] = settings.runtimeVersion;
    writeFileSync(join(deps, 'package.json'), JSON.stringify({ name: 'webbench-paired-dependencies', private: true,
        workspaces: ['libraries/*'], dependencies }, null, 2));
    const lock = join(here, 'package-lock.json');
    if (existsSync(lock)) cpSync(lock, join(deps, 'package-lock.json'));
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'],
        { cwd: deps, stdio: 'inherit', timeout: 180000 });
    cpSync(join(deps, 'package-lock.json'), lock);
    for (const file of ['Dockerfile', 'session.mjs', 'command.mjs', 'dev.mjs', 'verify.mjs']) cpSync(join(here, file), join(context, file));
    const base = JSON.parse(execFileSync('docker', ['image', 'inspect', JSON.parse(readFileSync(join(here, '../lab/environment.json'))).image,
        '--format', '{{json .}}'], { encoding: 'utf8' }));
    const receipt = { settings, baseImage: base.Id, dependencyLockHash: hash(readFileSync(lock)), projects,
        installer: { ignoreScripts: true, legacyPeerDeps: true, nativeRebuild: 'sqlite3 only, against pinned Node headers',
            buildPython: '/opt/evaluators/webarena/bin/python (existing setuptools/distutils compatibility)' },
        sourceHash: treeHash(context), instrumentation: 'Vite build plugin in development; official grading is independent' };
    writeFileSync(join(context, 'dataset.json'), JSON.stringify(receipt, null, 2));
    mkdirSync(join(here, '.cache'), { recursive: true });
    writeFileSync(join(here, '.cache/latest.json'), JSON.stringify({ context, receipt }, null, 2));
    return { context, receipt };
}
