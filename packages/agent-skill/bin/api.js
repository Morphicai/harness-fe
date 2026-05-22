/**
 * Programmatic access to the bundled SKILL.md.
 *
 * Consumers can do:
 *   import { SKILL_PATH, readSkill } from '@harness-fe/skill';
 *   const text = readSkill();
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the canonical SKILL.md inside this package. */
export const SKILL_PATH = resolve(__dirname, '..', 'skill', 'SKILL.md');

/** Read the SKILL.md content as a UTF-8 string. */
export function readSkill() {
    return readFileSync(SKILL_PATH, 'utf-8');
}

/** Targets we know how to install into. */
export const INSTALL_TARGETS = {
    /** Claude Code project-level skills directory. */
    'claude-code': '.claude/skills/harness-fe/SKILL.md',
    /** Cursor project rules. Mirrors the markdown body without frontmatter. */
    cursor: '.cursor/rules/harness-fe.mdc',
    /** Kiro project agents. */
    kiro: '.kiro/agents/harness-fe.md',
    /** Plain copy at the repo root. */
    plain: 'HARNESS_FE_SKILL.md',
};

/**
 * Where the file should land for a given target, relative to the project
 * root. Returns null for unknown targets.
 */
export function targetPath(target) {
    return INSTALL_TARGETS[target] ?? null;
}
