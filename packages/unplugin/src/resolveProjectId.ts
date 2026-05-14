import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const HARNESSA_ID_FILE = '.harnessa-id';

/**
 * Resolves the project ID for a given project root directory.
 *
 * Priority:
 * 1. `userConfig` — if provided, return immediately without touching `.harnessa-id`
 * 2. Read `{root}/.harnessa-id` — if readable, return trimmed content
 * 3. Generate UUID v4, write to `{root}/.harnessa-id` (UTF-8, no BOM, no trailing whitespace), return it
 */
export async function resolveProjectId(root: string, userConfig?: string): Promise<string> {
  // Priority 1: explicit user config value
  if (userConfig !== undefined && userConfig !== '') {
    return userConfig;
  }

  const idFilePath = join(root, HARNESSA_ID_FILE);

  // Priority 2: read existing .harnessa-id file
  try {
    const content = await readFile(idFilePath, 'utf-8');
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch (err) {
    // ENOENT or other read error — fall through to generate a new UUID
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // Log unexpected errors but still proceed to generate a new ID
      console.warn(`[harnessa] Could not read ${idFilePath}: ${(err as Error).message}`);
    }
  }

  // Priority 3: generate UUID v4, write to .harnessa-id, return it
  const newId = randomUUID();
  try {
    await writeFile(idFilePath, newId, { encoding: 'utf-8' });
  } catch (err) {
    console.warn(`[harnessa] Could not write ${idFilePath}: ${(err as Error).message}`);
  }

  return newId;
}
