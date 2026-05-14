import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonTaskStore } from './JsonTaskStore.js';
import type { Task } from '@morphixai/harnessa-fe.protocol';

function makeTempDir() {
    return mkdtempSync(join(tmpdir(), 'json-task-store-test-'));
}

function cleanup(dir: string) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        tabId: 'tab-abc',
        projectId: 'proj',
        url: 'http://localhost:5173',
        status: 'pending',
        question: 'What does this button do?',
        selector: { css: '#submit-btn' },
        element: { outerHTML: '<button id="submit-btn">Submit</button>', rect: { x: 0, y: 0, width: 100, height: 40 } },
        createdAt: Date.now(),
        ...overrides,
    };
}

describe('JsonTaskStore', () => {
    let dir: string;
    let store: JsonTaskStore;

    beforeEach(() => {
        dir = makeTempDir();
        store = new JsonTaskStore(dir);
    });

    afterEach(() => {
        cleanup(dir);
    });

    // ── Load from missing file → empty array ─────────────────────────────

    it('returns empty array when tasks.json does not exist', () => {
        const tasks = store.loadTasks('proj');
        expect(tasks).toEqual([]);
    });

    it('returns empty array for a project that has never been saved', () => {
        const tasks = store.loadTasks('brand-new-project');
        expect(tasks).toEqual([]);
    });

    // ── Load from corrupt JSON → empty array ─────────────────────────────

    it('returns empty array when tasks.json contains invalid JSON', () => {
        // Manually create the project directory and write corrupt JSON
        const { mkdirSync } = require('node:fs');
        const projDir = join(dir, 'proj');
        mkdirSync(projDir, { recursive: true });
        writeFileSync(join(projDir, 'tasks.json'), '{ this is not valid json !!!', 'utf-8');

        const tasks = store.loadTasks('proj');
        expect(tasks).toEqual([]);
    });

    it('returns empty array when tasks.json has valid JSON but wrong shape (no tasks array)', () => {
        const { mkdirSync } = require('node:fs');
        const projDir = join(dir, 'proj');
        mkdirSync(projDir, { recursive: true });
        writeFileSync(join(projDir, 'tasks.json'), JSON.stringify({ version: 1, data: [] }), 'utf-8');

        const tasks = store.loadTasks('proj');
        expect(tasks).toEqual([]);
    });

    it('returns empty array when tasks.json is empty', () => {
        const { mkdirSync } = require('node:fs');
        const projDir = join(dir, 'proj');
        mkdirSync(projDir, { recursive: true });
        writeFileSync(join(projDir, 'tasks.json'), '', 'utf-8');

        const tasks = store.loadTasks('proj');
        expect(tasks).toEqual([]);
    });

    // ── Save tasks → atomic write (tmp + rename) ─────────────────────────

    it('saves tasks and the file exists afterwards', () => {
        const tasks = [makeTask()];
        store.saveTasks('proj', tasks);

        const tasksPath = join(dir, 'proj', 'tasks.json');
        expect(existsSync(tasksPath)).toBe(true);
    });

    it('saves tasks and no .tmp file remains after save', () => {
        const tasks = [makeTask()];
        store.saveTasks('proj', tasks);

        const tmpPath = join(dir, 'proj', 'tasks.json.tmp');
        expect(existsSync(tmpPath)).toBe(false);
    });

    it('saved file contains the correct JSON structure', () => {
        const { readFileSync } = require('node:fs');
        const tasks = [makeTask({ id: 'task-abc' })];
        store.saveTasks('proj', tasks);

        const raw = readFileSync(join(dir, 'proj', 'tasks.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        expect(parsed.version).toBe(1);
        expect(Array.isArray(parsed.tasks)).toBe(true);
        expect(parsed.tasks).toHaveLength(1);
        expect(parsed.tasks[0].id).toBe('task-abc');
    });

    it('creates the project directory if it does not exist', () => {
        const tasks = [makeTask()];
        store.saveTasks('new-project', tasks);

        const projDir = join(dir, 'new-project');
        expect(existsSync(projDir)).toBe(true);
    });

    // ── Round-trip: save then load ────────────────────────────────────────

    it('round-trip: saved tasks can be loaded back and match the original', () => {
        const tasks: Task[] = [
            makeTask({ id: 'task-1', status: 'pending' }),
            makeTask({ id: 'task-2', status: 'claimed', claimedAt: Date.now() }),
            makeTask({ id: 'task-3', status: 'resolved', resolvedAt: Date.now(), note: 'Done!' }),
        ];

        store.saveTasks('proj', tasks);
        const loaded = store.loadTasks('proj');

        expect(loaded).toHaveLength(3);
        expect(loaded[0].id).toBe('task-1');
        expect(loaded[1].id).toBe('task-2');
        expect(loaded[2].id).toBe('task-3');
        expect(loaded[2].note).toBe('Done!');
    });

    it('round-trip: saving an empty array and loading returns empty array', () => {
        store.saveTasks('proj', []);
        const loaded = store.loadTasks('proj');
        expect(loaded).toEqual([]);
    });

    it('round-trip: overwriting tasks replaces the previous data', () => {
        const initial = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })];
        store.saveTasks('proj', initial);

        const updated = [makeTask({ id: 'task-3' })];
        store.saveTasks('proj', updated);

        const loaded = store.loadTasks('proj');
        expect(loaded).toHaveLength(1);
        expect(loaded[0].id).toBe('task-3');
    });

    it('round-trip: multiple saves preserve the last written state', () => {
        for (let i = 0; i < 5; i++) {
            store.saveTasks('proj', [makeTask({ id: `task-${i}` })]);
        }

        const loaded = store.loadTasks('proj');
        expect(loaded).toHaveLength(1);
        expect(loaded[0].id).toBe('task-4');
    });

    // ── Purge does not delete tasks.json ─────────────────────────────────
    // JsonTaskStore has no purge method — verify that saveTasks/loadTasks
    // continue to work correctly after multiple saves (simulating what purge
    // would need to preserve).

    it('tasks.json is preserved across multiple save operations', () => {
        const tasks = [makeTask({ id: 'task-keep' })];
        store.saveTasks('proj', tasks);

        // Simulate additional saves (as would happen during normal operation)
        store.saveTasks('proj', [...tasks, makeTask({ id: 'task-new' })]);

        const tasksPath = join(dir, 'proj', 'tasks.json');
        expect(existsSync(tasksPath)).toBe(true);

        const loaded = store.loadTasks('proj');
        expect(loaded).toHaveLength(2);
        expect(loaded.map((t) => t.id)).toContain('task-keep');
        expect(loaded.map((t) => t.id)).toContain('task-new');
    });

    it('tasks.json is not affected by operations on other projects', () => {
        const projATasks = [makeTask({ id: 'task-a', projectId: 'proj-a' })];
        const projBTasks = [makeTask({ id: 'task-b', projectId: 'proj-b' })];

        store.saveTasks('proj-a', projATasks);
        store.saveTasks('proj-b', projBTasks);

        // Loading proj-a should not be affected by proj-b
        const loadedA = store.loadTasks('proj-a');
        expect(loadedA).toHaveLength(1);
        expect(loadedA[0].id).toBe('task-a');

        const loadedB = store.loadTasks('proj-b');
        expect(loadedB).toHaveLength(1);
        expect(loadedB[0].id).toBe('task-b');
    });
});
