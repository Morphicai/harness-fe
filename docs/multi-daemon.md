# Multiple daemons on one machine

## The rule

> **Daemon identity = listening port.**
> Same port = same daemon = same data.
> Different port = independent daemons with independent data.

Identity is the URL you put in your `mcp.json`. No project root
detection, no `.git` walking, no `cwd` magic — if two MCP configs
both point at `ws://127.0.0.1:47729`, they're talking to the same
service. That's it.

## On-disk layout

```
~/.harnessa/
└── daemons/
    ├── 47729/
    │   └── data/
    │       ├── projects/…
    │       ├── sessions/…
    │       ├── visitors/…
    │       └── exports/…
    ├── 47730/
    │   └── data/
    └── …
```

Each port owns its own subtree. Wiping daemon 47730's history means
deleting `~/.harnessa/daemons/47730/` — nothing else affected.

## How to pick the right setup

### "I just want it to work" — default shared daemon
Don't configure `--port` anywhere. Every IDE (Cursor, Claude Desktop,
Claude Code, Kiro) hits port `47729`. First one to start becomes
leader; the rest auto-attach as followers and see the same browser
state.

```jsonc
// claude_desktop_config.json / .cursor/mcp.json / etc.
{
  "mcpServers": {
    "harnessa-fe": {
      "command": "npx",
      "args": ["-y", "@harnessa-fe/mcp-server"]
    }
  }
}
```

### "I want project-A separate from project-B"
Pick different ports per project.

```jsonc
// project-a/.cursor/mcp.json
{
  "mcpServers": {
    "harnessa-fe": {
      "command": "npx",
      "args": ["-y", "@harnessa-fe/mcp-server", "--port", "47729"]
    }
  }
}

// project-b/.cursor/mcp.json
{
  "mcpServers": {
    "harnessa-fe": {
      "command": "npx",
      "args": ["-y", "@harnessa-fe/mcp-server", "--port", "47730"]
    }
  }
}
```

Each port gets its own data dir. Project A's recordings won't show
up in project B's dashboard.

### "Monorepo: one dashboard for `apps/web` + `apps/admin` + `apps/marketing`"
Use the default — they pool to 47729 automatically. The dashboard's
project list shows each sub-app under its `projectId` (which the
host's vite/webpack plugin sets), all under the one daemon.

### "Friendly name in the banner / dashboard"
`HARNESSA_FE_LABEL` is a cosmetic tag — it surfaces in the startup
banner and (future) the dashboard title. It does **not** affect
isolation; that's still the port.

```jsonc
{
  "command": "npx", "args": ["-y", "@harnessa-fe/mcp-server"],
  "env": { "HARNESSA_FE_LABEL": "my-mono" }
}
```

Banner becomes:
```
[harnessa-fe] leader: WS bridge listening on ws://127.0.0.1:47729  (my-mono)
[harnessa-fe] data:   ~/.harnessa/daemons/47729/data
```

Two daemons can share a label or have different labels — the daemon
that controls isolation is always the port.

## What about cross-IDE setups?

Some IDEs (Cursor, Kiro, Claude Code CLI) launch MCP child processes
with `cwd` set to the workspace folder. Others (Claude Desktop)
launch from a global app dir, project-blind.

**Neither matters in this model.** Because identity is the port, all
IDEs targeting `47729` land on the same daemon regardless of where
they're launched from. The cwd-blind problem disappears.

## Cleanup

To remove a daemon's data: just delete its port subdir.

```bash
rm -rf ~/.harnessa/daemons/47730
```

The kernel reclaims the port when the daemon dies; nothing extra
needed.

## Why not "project root" / cwd / `.git` detection?

Earlier drafts of this design tried to auto-discover project roots
and key data dirs to filesystem paths. On review the model was
fighting itself: the daemon's identity is already the URL it serves.
Adding filesystem heuristics duplicated information the URL already
carried, while introducing failure modes (Claude Desktop doesn't pass
workspace cwd; `.git` matches inside monorepo submodules; etc.).

The port-keyed model is simpler and more honest. Picking a port is
the same gesture as picking a database — the user chooses the unit of
isolation, and we respect their choice.
