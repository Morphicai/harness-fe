# @harness-fe/skill

> Agent skill / playbook for using the [Harness-FE](https://github.com/Morphicai/harness-fe) MCP toolset. Distribute the same instructions to Claude Code, Cursor, Kiro, or any other MCP-aware AI agent.

This package is just data — a curated `SKILL.md` plus a tiny installer. It tells the agent **when** to invoke harness-fe tools, **how** to chain them for common debugging flows, and **what** the safety boundaries are.

## Why install it

Without the skill, your agent sees a flat list of MCP tools and has to *guess* the workflow. With it, a plain-English report — *"the submit button does nothing"* — maps to a known flow: read console/network → find the component source (`file:line`) → fix → re-drive → verify.

**You describe the problem; the agent drives.** Lower cognitive load for you, fewer wrong turns for it. Install this *before* wiring the MCP server — it's the recommended first step ([docs/agent-setup.md](https://github.com/Morphicai/harness-fe/blob/main/docs/agent-setup.md)).

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

Then wire the MCP server in `.mcp.json`. Solo / local (stdio, no token — the agent spawns the daemon itself):

```jsonc
{
    "mcpServers": {
        "harness-fe": { "type": "stdio", "command": "npx", "args": ["-y", "@harness-fe/dev-cli"] }
    }
}
```

Sharing one daemon across a team? Point at the HTTP **gateway** instead — see [gateway-team-mode.md](https://github.com/Morphicai/harness-fe/blob/main/docs/gateway-team-mode.md). (`@harness-fe/mcp-server` still works as the stdio command for back-compat, but `@harness-fe/dev-cli` is the current launcher.)

## License

MIT
