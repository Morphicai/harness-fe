/**
 * JsonTaskStore — JSON-based persistence for annotation tasks.
 *
 * File format: {dataDir}/{sanitizeId(projectId)}/tasks.json
 * ```json
 * { "version": 1, "tasks": Task[] }
 * ```
 *
 * Writes are atomic: write to a .tmp file then rename to the final path.
 * On read failure (missing or corrupt file), returns an empty array.
 * On write failure, logs the error without throwing.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '@harnessa-fe/protocol';
import type { ITaskStore } from './types.js';
import { sanitizeId } from './JsonlStore.js';

interface TasksFile {
    version: number;
    tasks: Task[];
}

export class JsonTaskStore implements ITaskStore {
    constructor(private readonly dataDir: string) {}

    private tasksPath(projectId: string): string {
        return join(this.dataDir, sanitizeId(projectId), 'tasks.json');
    }

    loadTasks(projectId: string): Task[] {
        const path = this.tasksPath(projectId);
        if (!existsSync(path)) return [];
        try {
            const raw = readFileSync(path, 'utf-8');
            const parsed = JSON.parse(raw) as TasksFile;
            if (!Array.isArray(parsed?.tasks)) return [];
            return parsed.tasks;
        } catch {
            return [];
        }
    }

    saveTasks(projectId: string, tasks: Task[]): void {
        const path = this.tasksPath(projectId);
        const dir = join(this.dataDir, sanitizeId(projectId));

        try {
            mkdirSync(dir, { recursive: true });
            const tmp = `${path}.tmp`;
            const data: TasksFile = { version: 1, tasks };
            writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
            renameSync(tmp, path);
        } catch (err) {
            console.error(`[JsonTaskStore] saveTasks failed for project "${projectId}":`, err);
        }
    }
}
