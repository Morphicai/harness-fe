/**
 * Vite + Vue 3 build-pipeline smoke test.
 *
 * Runs `vite build` against the demo and inspects the produced JS chunk for:
 *   - At least 8 distinct elements tagged with data-morphix-loc (App.vue has
 *     ~13 template elements after `defineOptions({ name: 'App' })`).
 *   - File-relative line numbers (max > 10 — App.vue's <main> is on line 2,
 *     but children go up to ~38).
 *   - data-morphix-comp values for components declared in the SFC.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');

if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });

console.log('--- vue-demo: vite build ---');
execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: root, stdio: 'inherit' });

const assetsDir = resolve(distDir, 'assets');
const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (jsFiles.length === 0) {
    console.error('FAIL: no JS asset emitted by vite');
    process.exit(1);
}

const bundle = readFileSync(resolve(assetsDir, jsFiles[0]), 'utf-8');

const locEntries = bundle.match(/"data-morphix-loc":"src\/App\.vue:(\d+):(\d+)"/g) ?? [];
const compValues = new Set(
    (bundle.match(/"data-morphix-comp":"([^"]+)"/g) ?? []).map((m) => m.replace(/.*"([^"]+)"$/, '$1')),
);

console.log(`location entries: ${locEntries.length}`);
console.log(`unique component names: ${[...compValues].join(', ')}`);

if (locEntries.length < 8) {
    console.error(`FAIL: expected at least 8 tagged locations, got ${locEntries.length}`);
    process.exit(1);
}

const maxLine = Math.max(
    ...locEntries.map((m) => {
        const match = m.match(/:(\d+):/);
        return match ? parseInt(match[1], 10) : 0;
    }),
);
if (maxLine < 10) {
    console.error(`FAIL: line numbers look template-relative (max=${maxLine}, expected >= 10)`);
    process.exit(1);
}

if (!compValues.has('App')) {
    console.error('FAIL: component name "App" (from defineOptions) not present in bundle');
    process.exit(1);
}

console.log(`max line: ${maxLine}`);
console.log('build.e2e ALL PASS ✓');
