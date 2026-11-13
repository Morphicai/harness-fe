import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, lstatSync, realpathSync, existsSync, unlinkSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '../..');
export const hash = (v) => createHash('sha256').update(v).digest('hex');
export const environment = JSON.parse(readFileSync(join(here, 'environment.json')));
function normalizeDeployment(root) {
    const source = realpathSync(join(repo, 'packages/cli'));
    function walk(dir) {
        for (const name of readdirSync(dir)) {
            const file = join(dir, name), stat = lstatSync(file);
            if (stat.isSymbolicLink()) {
                // pnpm 9 deploy can retain the root package's workspace self-link.
                // Repoint that identity to its deployed copy; reject other escapes below.
                if (existsSync(file) && realpathSync(file) === source) {
                    unlinkSync(file); symlinkSync(relative(dirname(file), root), file);
                } else if (!existsSync(file) && file.includes('/node_modules/.bin/')) unlinkSync(file);
            } else if (stat.isDirectory()) walk(file);
        }
    }
    walk(root);
}
export function checkTree(root) {
    const base = realpathSync(root), files = [];
    function walk(dir) {
        for (const entry of readdirSync(dir)) {
            assert(!/^(?:\.env(?:\..*)?|\.npmrc|credentials.*|auth\.json|\.ssh|\.claude|\.codex)$/i.test(entry), `Private file in context: ${entry}`);
            const p = join(dir, entry), stat = lstatSync(p);
            if (stat.isSymbolicLink()) {
                const dest = realpathSync(p);
                assert(dest === base || dest.startsWith(base + '/'), `Escaping context link: ${p}`);
            } else if (stat.isDirectory()) walk(p);
            else {
                assert(!/\.(?:node|dylib|dll)$/i.test(entry), `Native dependency is not portable: ${p}`);
                files.push([relative(base, p), hash(readFileSync(p))]);
            }
        }
    }
    walk(base); return files.sort(([a], [b]) => a.localeCompare(b));
}
export function refreshPreparedTooling() {
    const latestFile = join(here, '.cache/latest-context.json');
    const latest = JSON.parse(readFileSync(latestFile)), context = resolve(here, latest.context);
    const receipt = JSON.parse(readFileSync(join(context, 'receipt.json')));
    assert.deepEqual(receipt.environment, environment, 'Environment changed: run prepare first');
    const preparedPackage = JSON.parse(readFileSync(join(context, 'lab/package.json')));
    const currentPackage = JSON.parse(readFileSync(join(here, 'package.json')));
    assert.deepEqual(preparedPackage.dependencies, currentPackage.dependencies, 'Tool dependencies changed: run prepare first');
    assert.equal(hash(readFileSync(join(context, 'lab/package-lock.json'))), hash(readFileSync(join(here, 'package-lock.json'))), 'Tool lock changed: run prepare first');
    // Refresh only the trusted smoke driver/Dockerfile, keeping compiled product
    // artifacts and dependency layers intact during the environment's own debug loop.
    copyFileSync(join(here, 'container.mjs'), join(context, 'lab/container.mjs'));
    copyFileSync(join(here, 'Dockerfile'), join(context, 'Dockerfile'));
    copyFileSync(join(here, 'Dockerfile.overlay'), join(context, 'Dockerfile.overlay'));
    const files = checkTree(context).filter(([name]) => name !== 'receipt.json');
    const contentHash = hash(JSON.stringify(receipt.baseImage ? { files, baseImage: receipt.baseImage } : files));
    if (contentHash !== receipt.contentHash) {
        writeFileSync(join(context, 'receipt.json'), JSON.stringify({ ...receipt, files, contentHash }, null, 2));
        writeFileSync(latestFile, JSON.stringify({ context, contentHash }));
    }
    return { context, contentHash };
}
export async function prepare() {
    const context = join(here, '.cache', 'context-' + Date.now());
    mkdirSync(join(context, 'lab'), { recursive: true, mode: 0o700 });
    const generated = join(repo, 'packages/runtime-client/src/version.ts'), before = readFileSync(generated);
    try {
        execFileSync('pnpm', ['--filter', '@harness-fe/cli...', '--filter', '@harness-fe/runtime...', 'build'], { cwd: repo, stdio: 'inherit' });
    } finally { writeFileSync(generated, before); }
    execFileSync('pnpm', ['--filter', '@harness-fe/cli', 'deploy', '--prod', '--offline', join(context, 'harness')], { cwd: repo, stdio: 'inherit' });
    normalizeDeployment(join(context, 'harness'));
    assert.equal(JSON.parse(readFileSync(join(context, 'harness/package.json'))).version, environment.harnessCliVersion,
        'Prepare from the requested released product checkout');
    const from = createRequire(join(repo, 'examples/react-demo/package.json'));
    const vite = createRequire(from.resolve('vite'));
    const esbuild = await import(pathToFileURL(vite.resolve('esbuild')).href);
    const bundled = await esbuild.build({ entryPoints: [from.resolve('@harness-fe/runtime')], bundle: true,
        write: false, format: 'iife', platform: 'browser', target: 'es2020', minify: true,
        define: { 'process.env.NODE_ENV': '"development"' } });
    writeFileSync(join(context, 'runtime.js'), bundled.outputFiles[0].text);
    for (const file of ['package.json', 'package-lock.json', 'container.mjs']) copyFileSync(join(here, file), join(context, 'lab', file));
    copyFileSync(join(here, 'Dockerfile'), join(context, 'Dockerfile'));
    copyFileSync(join(here, 'Dockerfile.overlay'), join(context, 'Dockerfile.overlay'));
    const files = checkTree(context);
    const receipt = { createdAt: new Date().toISOString(), environment,
        gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
        files, contentHash: hash(JSON.stringify(files)), runtimeHash: hash(bundled.outputFiles[0].text),
        gatewayHash: hash(readFileSync(join(context, 'harness/node_modules/@harness-fe/gateway/dist/mcp.js'))) };
    writeFileSync(join(context, 'receipt.json'), JSON.stringify(receipt, null, 2));
    writeFileSync(join(here, '.cache/latest-context.json'), JSON.stringify({ context, contentHash: receipt.contentHash }));
    return { context, receipt };
}
