#!/usr/bin/env node
/**
 * Tiny CLI for `@harnessa-fe/skill`.
 *
 *   harnessa-fe-skill install [target]   copy SKILL.md to the right place
 *   harnessa-fe-skill print              dump SKILL.md to stdout
 *   harnessa-fe-skill where              print absolute path of SKILL.md
 *   harnessa-fe-skill help               usage
 *
 * Targets:
 *   claude-code (default)  → .claude/skills/harnessa-fe/SKILL.md
 *   cursor                 → .cursor/rules/harnessa-fe.mdc
 *   kiro                   → .kiro/agents/harnessa-fe.md
 *   plain                  → HARNESSA_FE_SKILL.md  (just dump it in the repo root)
 */
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { INSTALL_TARGETS, SKILL_PATH, readSkill, targetPath } from './api.js';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'help';

function help() {
    process.stdout.write(`@harnessa-fe/skill — agent playbook installer

Usage:
  harnessa-fe-skill install [target]   copy SKILL.md to the agent's config dir
  harnessa-fe-skill print              dump SKILL.md to stdout
  harnessa-fe-skill where              print the absolute path of SKILL.md
  harnessa-fe-skill help

Targets (default claude-code):
${Object.entries(INSTALL_TARGETS)
    .map(([k, v]) => `  ${k.padEnd(14)}  → ${v}`)
    .join('\n')}

Examples:
  npx @harnessa-fe/skill install               # installs to .claude/skills/
  npx @harnessa-fe/skill install cursor        # installs to .cursor/rules/
  npx @harnessa-fe/skill print | pbcopy        # copy to clipboard
`);
}

function install(target = 'claude-code') {
    const relPath = targetPath(target);
    if (!relPath) {
        process.stderr.write(`unknown target "${target}". Try: ${Object.keys(INSTALL_TARGETS).join(', ')}\n`);
        process.exit(2);
    }
    const dest = join(process.cwd(), relPath);
    if (existsSync(dest)) {
        process.stderr.write(`refusing to overwrite existing ${relPath}. Remove it first.\n`);
        process.exit(1);
    }
    mkdirSync(dirname(dest), { recursive: true });
    if (target === 'cursor') {
        // Cursor wants a .mdc file; strip the YAML frontmatter since Cursor
        // uses its own format. Keep the body intact.
        const raw = readSkill();
        const stripped = raw.replace(/^---[\s\S]*?\n---\n+/, '');
        writeFileSync(dest, stripped, 'utf-8');
    } else {
        copyFileSync(SKILL_PATH, dest);
    }
    process.stdout.write(`installed → ${relPath}\n`);
    if (target === 'claude-code') {
        process.stdout.write(
            `\nClaude Code: restart your session (or type /reload-skills) so the new skill is picked up.\n`,
        );
    }
}

switch (cmd) {
    case 'install':
        install(argv[1]);
        break;
    case 'print':
        process.stdout.write(readSkill());
        break;
    case 'where':
        process.stdout.write(SKILL_PATH + '\n');
        break;
    case 'help':
    case '--help':
    case '-h':
        help();
        break;
    default:
        process.stderr.write(`unknown command "${cmd}"\n\n`);
        help();
        process.exit(2);
}
