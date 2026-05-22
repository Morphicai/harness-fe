# @harness-fe/skill

> Agent skill / playbook for using the [Harness-FE](https://github.com/Morphicai/harness-fe) MCP toolset. Distribute the same instructions to Claude Code, Cursor, Kiro, or any other MCP-aware AI agent.

This package is just data — a curated `SKILL.md` plus a tiny installer. It tells the agent **when** to invoke harness-fe tools, **how** to chain them for common debugging flows, and **what** the safety boundaries are.

## Install

```bash
# Drop into Claude Code's project skills dir
npx @harness-fe/skill install

# Or pick a target:
npx @harness-fe/skill install cursor   # → .cursor/rules/harness-fe.mdc
npx @harness-fe/skill install kiro     # → .kiro/agents/harness-fe.md
npx @harness-fe/skill install plain    # → HARNESS_FE_SKILL.md
```

Refuses to overwrite. Delete the existing file first if you want to upgrade.

## Inspect without installing

```bash
npx @harness-fe/skill print     # dump SKILL.md to stdout
npx @harness-fe/skill where     # print absolute path of the bundled SKILL.md
```

## Programmatic use

```js
import { SKILL_PATH, readSkill } from '@harness-fe/skill';

console.log(readSkill());          // markdown body as string
console.log(SKILL_PATH);            // absolute path
```

## What the skill covers

- Mental model: project / build / tab / session — and how same-origin iframe identity inheritance works for micro-frontends.
- MCP tool catalog: page interaction, telemetry tails, rrweb replay, source intelligence, annotation tasks.
- Source-aware selectors: how to target elements by `comp` (component) / `loc` (file:line) instead of CSS classes.
- Debugging decision flows: visual bugs, network bugs, micro-frontend bugs, post-crash forensics.
- Safety constraints: `page_evaluate` is arbitrary JS; `project_source` is sandboxed; rrweb captures may contain secrets.

See the file itself for the full content: `npx @harness-fe/skill print`.

## Prerequisite

The agent's host project must have the harness-fe MCP daemon configured. Minimal setup:

```bash
npm i -D @harness-fe/vite @harness-fe/runtime
```

```ts
// vite.config.ts
import { harnessFE } from '@harness-fe/vite';
export default defineConfig({ plugins: [react(), harnessFE()] });
```

Then in `.mcp.json` (or your agent's MCP config):

```json
{
    "mcpServers": {
        "harness-fe": { "command": "npx", "args": ["-y", "@harness-fe/mcp-server"] }
    }
}
```

## License

MIT
