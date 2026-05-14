/**
 * JsonMemoryStore — JSON-based persistence for agent memory (key-value store per project).
 *
 * File layout:
 *   {dataDir}/{projectId}/memory.json
 *
 * File format:
 *   {
 *     "key1": { "key": "key1", "value": "...", "updatedAt": 1700000000000 },
 *     "key2": { "key": "key2", "value": "...", "updatedAt": 1700000001000 }
 *   }
 *
 * All mutations use atomic write-then-rename for durability.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IMemoryStore, MemoryEntry } from './types.js';
import { sanitizeId } from './JsonlStore.js';

export class JsonMemoryStore implements IMemoryStore {
    constructor(private readonly dataDir: string) {}

    // ── Path helpers ──────────────────────────────────────────────────────

    private memoryPath(projectId: string): string {
        return join(this.dataDir, sanitizeId(projectId), 'memory.json');
    }

    // ── Private I/O ───────────────────────────────────────────────────────

    /**
     * Read and parse memory.json for a project.
     * Returns a null-prototype object on missing or corrupt file (never throws).
     * Using Object.create(null) prevents prototype pollution from keys like __proto__.
     */
    private load(projectId: string): Record<string, MemoryEntry> {
        const path = this.memoryPath(projectId);
        try {
            const raw = readFileSync(path, 'utf-8');
            const parsed = JSON.parse(raw) as Record<string, MemoryEntry>;
            // Copy into a null-prototype object to prevent prototype pollution
            const safe: Record<string, MemoryEntry> = Object.create(null);
            for (const key of Object.keys(parsed)) {
                safe[key] = parsed[key];
            }
            return safe;
        } catch {
            return Object.create(null);
        }
    }

    /**
     * Atomically write memory data to disk using tmp + rename strategy.
     * Logs error on failure without throwing.
     */
    private save(projectId: string, data: Record<string, MemoryEntry>): void {
        const path = this.memoryPath(projectId);
        const tmpPath = `${path}.tmp`;

        // Ensure the project directory exists
        const dir = join(this.dataDir, sanitizeId(projectId));
        try {
            mkdirSync(dir, { recursive: true });
        } catch (err) {
            console.error(`[JsonMemoryStore] failed to create directory ${dir}:`, err);
            return;
        }

        try {
            writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
            renameSync(tmpPath, path);
        } catch (err) {
            console.error(`[JsonMemoryStore] failed to write ${path}:`, err);
        }
    }

    // ── IMemoryStore implementation ───────────────────────────────────────

    /**
     * Get a memory entry by key.
     * Returns undefined if the key does not exist or memory.json is missing.
     */
    get(projectId: string, key: string): MemoryEntry | undefined {
        const data = this.load(projectId);
        return data[key];
    }

    /**
     * Write or update a memory entry.
     * Sets updatedAt to the current Unix ms timestamp.
     * Returns the new/updated MemoryEntry.
     */
    set(projectId: string, key: string, value: string): MemoryEntry {
        const data = this.load(projectId);
        const entry: MemoryEntry = {
            key,
            value,
            updatedAt: Date.now(),
        };
        data[key] = entry;
        this.save(projectId, data);
        return entry;
    }

    /**
     * Delete a memory entry by key.
     * Returns true if the key existed and was removed, false otherwise.
     */
    delete(projectId: string, key: string): boolean {
        const data = this.load(projectId);
        if (!(key in data)) {
            return false;
        }
        delete data[key];
        this.save(projectId, data);
        return true;
    }

    /**
     * List all memory entries for a project, sorted by updatedAt descending.
     * Returns an empty array if memory.json does not exist.
     */
    list(projectId: string): MemoryEntry[] {
        const data = this.load(projectId);
        return Object.values(data).sort((a, b) => b.updatedAt - a.updatedAt);
    }
}
