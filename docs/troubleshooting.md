# Troubleshooting

If something isn't appearing in the timeline, work through these checks in order.

## 1. Is the daemon running?

```bash
lsof -iTCP:47729 -sTCP:LISTEN
# Should print one row owned by node (the MCP server)
```

Start it manually if not:
```bash
pnpm exec @harnessa-fe/mcp-server
# OR if you've cloned the repo:
pnpm start:mcp
```

You should see `WebSocket listening on ws://127.0.0.1:47729` in the log.

## 2. Are peers connecting?

Watch the daemon stdout while you refresh your app. You should see:

```
peer connected role=runtime-client      projectId=my-app  sessionId=<uuid-A>
peer connected role=node-runtime        projectId=my-app  sessionId=<uuid-A>
```

**Both lines must have the same `sessionId`.** If `node-runtime` is missing, see §4. If they have different sessionIds, see §5.

## 3. Where are events stored?

```
~/.harnessa/data/
├── sessions/
│   ├── {sessionId}/
│   │   ├── meta.json              ← who participated in this page-load
│   │   ├── timeline.jsonl         ← all events, one per line
│   │   └── recording.jsonl        ← rrweb chunks
│   └── server-orphans/            ← server logs with no request scope
└── projects/
    └── {projectId}/meta.json
```

Read a session timeline directly:
```bash
ls -lt ~/.harnessa/data/sessions/ | head -5      # newest first
cat ~/.harnessa/data/sessions/<sid>/timeline.jsonl | jq -r '"\(.t)\t\(.payload // {})"'
```

If a `console.log` from your code isn't in any timeline, it's either in `server-orphans/` (see §5) or never reached the daemon (see §1, §4).

## 4. Server-side events missing entirely

Common reasons the Node SDK never connected:

| Symptom | Cause | Fix |
|---|---|---|
| `peer connected role=node-runtime` never appears | `<HarnessaScript>` not in your layout, `withHarnessa()` not in `next.config.mjs`, AND no manual `register()` call | Add one. The easiest is dropping `<HarnessaScript projectId="…" />` into `app/layout.tsx`. |
| It appears once but no events follow | `NODE_ENV !== 'development'` | Auto-boot is dev-only by design. To force it on, call `register()` yourself unconditionally. |
| Connects but events still missing | `captureConsole: false` and you're not using `@harnessa-fe/log` | Either remove the flag or migrate to `log.*`. |
| Edge route not appearing | Edge runtime uses HTTP-batch, not WS — confirm daemon stdout shows `POST /events` hits | Check that `mcpUrl` is reachable from the edge env (`localhost` works in dev only) |

## 5. `sessionId` mismatch between server and client

The point of Harnessa is **same session-id everywhere for one page-load**. If you see different ids:

1. **Confirm `<HarnessaScript>` is in the rendered HTML**. View source on a refresh — look for `<script id="__hfe_seed__">window.__HARNESSA_FE_SEED__=…</script>` near the top of `<body>`. Missing = HarnessaScript didn't render (wrong file? prod build?).
2. **Confirm the runtime adopts the seed**. In DevTools console: `window.__harnessa_fe_client__.sessionId` should equal `JSON.parse(document.getElementById('__hfe_seed__').textContent.split('=')[1].slice(0,-1)).sessionId`.
3. **Confirm the provider is registered**. Run a Server Component that does `console.log('test', getRequestSessionId())` from `@harnessa-fe/node-runtime`. If it logs `test undefined`, the Next adapter didn't push its getter — usually means `@harnessa-fe/next` isn't being loaded server-side (check that you import from `@harnessa-fe/next`, not a typo).

## 6. Server logs ending up in `server-orphans/`

This is **correct behavior** when there's no request scope:
- A top-level module side-effect (`console.log('boot');` at the top of a file)
- A background timer (`setInterval(...)`)
- An `unhandledRejection` from a promise that escaped the request

To attribute a log to a request explicitly, use `withHarnessaTracing()`:
```ts
export const POST = withHarnessaTracing(async (req: Request) => {
    console.log('this gets sid bound via ALS');
    // ...
});
```

For App Router Server Components, `<HarnessaScript>` does this for you via the Next provider.

## 7. Two tabs show events mixed in one session

They shouldn't. Each tab refresh = a new `sessionId`. If you see this:
- Check that you didn't override `tabId` or `sessionId` manually
- Check `~/.harnessa/data/sessions/<sid>/meta.json` — `participants` should be a single tab. If multiple, you have an iframe inheriting parent identity (see ARCHITECTURE.md → "Same-origin iframe identity inheritance"), which is intentional.

## 8. Daemon disk filling up

Two safeguards run automatically:

- **Retention**: sessions older than `HARNESSA_FE_RETENTION_DAYS` (default 14) are purged on each daemon start
- **Size cap**: each `timeline.jsonl` is capped at `HARNESSA_FE_MAX_TIMELINE_KB` (default 4096); older lines are dropped at write time

To nuke everything:
```bash
rm -rf ~/.harnessa/data
# daemon recreates the tree on next start
```

## 9. Agent doesn't see new events

The MCP `console_tail` / `events_recent` tools page from the disk. If the agent's session cached an old cursor, ask it to re-list. The daemon is the source of truth — if `cat timeline.jsonl` shows it, the agent can see it.

## 10. Still stuck

- Run the daemon with `DEBUG=harnessa-fe:* pnpm start:mcp` for verbose logging
- File an issue with: the relevant timeline.jsonl excerpt (redact what you must), the daemon stdout, your Next / Vite / Webpack version, and what you expected
