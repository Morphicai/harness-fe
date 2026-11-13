import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { plan } from './batch.mjs';

test('five frozen datasets have ten distinct units with explicit chain dependencies', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('./samples.json', import.meta.url))));
    assert.equal(manifest.suites.length, 5);
    for (const suite of manifest.suites) {
        assert.equal(suite.samples.length, 10);
        assert.equal(new Set(suite.samples.map(s => s.id)).size, 10);
        assert.match(suite.revision, /^[a-f0-9]{40}$/);
        for (const sample of suite.samples) assert.match(sample.recordHash, /^[a-f0-9]{64}$/);
    }
    for (const sample of manifest.suites.find(s => s.id === 'web-bench').samples)
        assert.deepEqual([...sample.taskIds].sort(), Array.from({ length: 20 }, (_, i) => `task-${i + 1}`).sort());
    const old = new Set([157, 374, 11, 41, 453, 461]);
    assert(manifest.suites.find(s => s.id === 'webarena-verified').samples.every(s => !old.has(s.taskId)));
    const declared = plan(manifest, { repeats: 3, batchSize: 2, image: 'verified-in-test', environmentHash: 'test' });
    assert.equal(declared.jobs.length, 300);
    for (let batch = 1; batch <= 5; batch++) assert.equal(declared.jobs.filter(j => j.batch === batch).length, 60);
    function check(value) {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            assert(!['patch', 'test_patch', 'FAIL_TO_PASS', 'PASS_TO_PASS', 'expected'].includes(key), `Hidden grading field: ${key}`);
            check(child);
        }
    }
    check(manifest);
});
