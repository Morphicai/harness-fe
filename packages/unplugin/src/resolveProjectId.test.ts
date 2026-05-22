import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveProjectId } from './resolveProjectId.js';

// Cleanup temp dirs after each test
const tempDirs: string[] = [];

afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
        await rm(dir, { recursive: true, force: true });
    }
});

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'harness-test-'));
    tempDirs.push(dir);
    return dir;
}

// Feature: persistence, Property 1: Project ID resolution priority
describe('Property 1: Project ID resolution priority', () => {
    it('resolveProjectId respects priority: userConfig > file > generated UUID', async () => {
        // Validates: Requirements 1.1, 1.2, 1.3
        await fc.assert(
            fc.asyncProperty(
                fc.tuple(fc.option(fc.uuidV(4)), fc.boolean()),
                async ([userConfig, filePresent]) => {
                    const root = await makeTempDir();
                    const idFilePath = join(root, '.harness-id');
                    const fileUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

                    if (filePresent) {
                        await writeFile(idFilePath, fileUuid, 'utf-8');
                    }

                    const result = await resolveProjectId(root, userConfig ?? undefined);

                    if (userConfig !== null) {
                        // Priority 1: userConfig wins regardless of file presence
                        expect(result).toBe(userConfig);
                    } else if (filePresent) {
                        // Priority 2: file content used when userConfig absent
                        expect(result).toBe(fileUuid);
                    } else {
                        // Priority 3: freshly generated UUID — must be a valid UUID v4
                        expect(result).toMatch(
                            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
                        );
                        // And it must have been written to the file
                        const written = await readFile(idFilePath, 'utf-8');
                        expect(written.trim()).toBe(result);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: persistence, Property 2: .harness-id file format round-trip
describe('Property 2: .harness-id file format round-trip', () => {
    it('UUID written to .harness-id round-trips exactly with no extra characters', async () => {
        // Validates: Requirements 1.5
        await fc.assert(
            fc.asyncProperty(
                fc.uuidV(4),
                async (_uuid) => {
                    // We call resolveProjectId with no userConfig and no existing file,
                    // so it generates a fresh UUID and writes it to .harness-id.
                    // We then verify the file content matches the returned UUID exactly.
                    const root = await makeTempDir();
                    const idFilePath = join(root, '.harness-id');

                    const returned = await resolveProjectId(root, undefined);

                    const fileContent = await readFile(idFilePath, 'utf-8');

                    // Trimming whitespace must produce the exact same UUID
                    expect(fileContent.trim()).toBe(returned);

                    // No BOM (UTF-8 BOM is \uFEFF)
                    expect(fileContent.charCodeAt(0)).not.toBe(0xfeff);

                    // No trailing newline or extra whitespace — file contains only the UUID
                    expect(fileContent).toBe(returned);

                    // Must be a valid UUID v4
                    expect(returned).toMatch(
                        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
                    );
                }
            ),
            { numRuns: 100 }
        );
    });
});
