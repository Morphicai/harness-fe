/**
 * Webpack 5 + Vue 3 build-pipeline smoke test.
 *
 * Goal: assert that the harness-fe webpack plugin tags every <template>
 * element across the SFCs in this demo, and that the resulting compiled
 * render functions in `bundle.js` carry the data-morphix-loc /
 * data-morphix-comp attributes with file-relative line numbers.
 *
 * No browser needed — we inspect the bundle artifact. This catches:
 *   - vue-loader sub-module integration regressions
 *   - line-offset / file-path regressions
 *   - missing component-name resolution
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const bundlePath = resolve(root, 'dist', 'bundle.js');

if (existsSync(resolve(root, 'dist'))) {
    rmSync(resolve(root, 'dist'), { recursive: true, force: true });
}

console.log('--- webpack5-vue3-demo build ---');
execFileSync('pnpm', ['exec', 'webpack'], { cwd: root, stdio: 'inherit' });

if (!existsSync(bundlePath)) {
    console.error('FAIL: bundle.js not produced');
    process.exit(1);
}

const bundle = readFileSync(bundlePath, 'utf-8');

function countMatches(needle: RegExp): number {
    return (bundle.match(needle) ?? []).length;
}

const locCount = countMatches(/data-morphix-loc/g);
const compCount = countMatches(/data-morphix-comp/g);

console.log(`bundle: data-morphix-loc=${locCount}, data-morphix-comp=${compCount}`);

// App.vue has 7 elements (main, h1, p, code, code, Counter, Counter),
// Counter.vue has 5 (div, span, span, button, button).
// Each attr is referenced both in the compiled render fn and in props arrays,
// so the bundle string-count is doubled. Empirical lower bound: 12.
if (locCount < 12 || compCount < 12) {
    console.error(`FAIL: expected at least 12 occurrences of each attr, got loc=${locCount} comp=${compCount}`);
    process.exit(1);
}

// App component should be tagged on the file's <main>, <h1>, <p>, <code>s
const appLocs = bundle.match(/data-morphix-loc.{0,5}"src\/App\.vue:(\d+):/g) ?? [];
const counterLocs = bundle.match(/data-morphix-loc.{0,5}"src\/Counter\.vue:(\d+):/g) ?? [];

if (appLocs.length === 0) {
    console.error('FAIL: no App.vue locations in bundle');
    process.exit(1);
}
if (counterLocs.length === 0) {
    console.error('FAIL: no Counter.vue locations in bundle');
    process.exit(1);
}

// File-relative line numbers: App.vue's <main> is on line 12 (after <script setup>).
// Sanity check: at least one App.vue location has line >= 10 (i.e., not template-relative).
const appLines = appLocs.map((m) => {
    const match = m.match(/:(\d+):/);
    return match ? parseInt(match[1], 10) : 0;
});
const maxAppLine = Math.max(...appLines);
if (maxAppLine < 10) {
    console.error(
        `FAIL: App.vue line numbers look template-relative (max=${maxAppLine}, expected >= 10)`,
    );
    process.exit(1);
}

console.log(`App.vue tags: ${appLocs.length}, line range covers up to ${maxAppLine}`);
console.log(`Counter.vue tags: ${counterLocs.length}`);

// Component-name attribute should be present
// Bundle JSON-encodes attribute values, so `"data-morphix-comp": "App"` appears
// as `\"data-morphix-comp\": \"App\"`. Match either form.
if (!/data-morphix-comp\\?":\s*\\?"App\\?"/.test(bundle)) {
    console.error('FAIL: data-morphix-comp="App" not found in bundle');
    process.exit(1);
}
if (!/data-morphix-comp\\?":\s*\\?"Counter\\?"/.test(bundle)) {
    console.error('FAIL: data-morphix-comp="Counter" not found in bundle');
    process.exit(1);
}

console.log('build.e2e ALL PASS ✓');
