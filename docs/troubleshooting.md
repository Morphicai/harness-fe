# Troubleshooting

If something isn't appearing in the timeline, work through these checks in order.

## 1. Is the daemon running?

```bash
lsof -iTCP:47729 -sTCP:LISTEN
# Should print one row owned by node (the MCP server)
```

Start it manually if not:
```bash
pnpm exec @harness-fe/mcp-server
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
~/.harness/data/
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
ls -lt ~/.harness/data/sessions/ | head -5      # newest first
cat ~/.harness/data/sessions/<sid>/timeline.jsonl | jq -r '"\(.t)\t\(.payload // {})"'
```

If a `console.log` from your code isn't in any timeline, it's either in `server-orphans/` (see §5) or never reached the daemon (see §1, §4).

## 4. Server-side events missing entirely

Common reasons the Node SDK never connected:

| Symptom | Cause | Fix |
|---|---|---|
| `peer connected role=node-runtime` never appears | `<HarnessScript>` not in your layout, `withHarness()` not in `next.config.mjs`, AND no manual `register()` call | Add one. The easiest is dropping `<HarnessScript projectId="…" />` into `app/layout.tsx`. |
| It appears once but no events follow | `NODE_ENV !== 'development'` | Auto-boot is dev-only by design. To force it on, call `register()` yourself unconditionally. |
| Connects but events still missing | `captureConsole: false` and you're not using `@harness-fe/log` | Either remove the flag or migrate to `log.*`. |
| Edge route not appearing | Edge runtime uses HTTP-batch, not WS — confirm daemon stdout shows `POST /events` hits | Check that `mcpUrl` is reachable from the edge env (`localhost` works in dev only) |

## 5. `sessionId` mismatch between server and client

The point of Harness is **same session-id everywhere for one page-load**. If you see different ids:

1. **Confirm `<HarnessScript>` is in the rendered HTML**. View source on a refresh — look for `<script id="__hfe_seed__">window.__HARNESS_FE_SEED__=…</script>` near the top of `<body>`. Missing = HarnessScript didn't render (wrong file? prod build?).
2. **Confirm the runtime adopts the seed**. In DevTools console: `window.__harness_fe_client__.sessionId` should equal `JSON.parse(document.getElementById('__hfe_seed__').textContent.split('=')[1].slice(0,-1)).sessionId`.
3. **Confirm the provider is registered**. Run a Server Component that does `console.log('test', getRequestSessionId())` from `@harness-fe/node-runtime`. If it logs `test undefined`, the Next adapter didn't push its getter — usually means `@harness-fe/next` isn't being loaded server-side (check that you import from `@harness-fe/next`, not a typo).

## 6. Server logs ending up in `server-orphans/`

This is **correct behavior** when there's no request scope:
- A top-level module side-effect (`console.log('boot');` at the top of a file)
- A background timer (`setInterval(...)`)
- An `unhandledRejection` from a promise that escaped the request

To attribute a log to a request explicitly, use `withHarnessTracing()`:
```ts
export const POST = withHarnessTracing(async (req: Request) => {
    console.log('this gets sid bound via ALS');
    // ...
});
```

For App Router Server Components, `<HarnessScript>` does this for you via the Next provider.

## 7. Two tabs show events mixed in one session

They shouldn't. Each tab refresh = a new `sessionId`. If you see this:
- Check that you didn't override `tabId` or `sessionId` manually
- Check `~/.harness/data/sessions/<sid>/meta.json` — `participants` should be a single tab. If multiple, you have an iframe inheriting parent identity (see ARCHITECTURE.md → "Same-origin iframe identity inheritance"), which is intentional.

## 8. Daemon disk filling up

Two safeguards run automatically:

- **Retention**: sessions older than `HARNESS_FE_RETENTION_DAYS` (default 14) are purged on each daemon start
- **Size cap**: each `timeline.jsonl` is capped at `HARNESS_FE_MAX_TIMELINE_KB` (default 4096); older lines are dropped at write time

To nuke everything:
```bash
rm -rf ~/.harness/data
# daemon recreates the tree on next start
```

## 9. Agent doesn't see new events

The MCP `console_tail` / `events_recent` tools page from the disk. If the agent's session cached an old cursor, ask it to re-list. The daemon is the source of truth — if `cat timeline.jsonl` shows it, the agent can see it.

## 10. LAN mode — 401 / phone can't connect

Most LAN-mode connectivity issues fall into one of these buckets.

### "401 Unauthorized" in the browser

Token didn't match. Check, in order:

1. The exact token from the daemon banner. Tokens are case-sensitive, no
   surrounding whitespace.
2. If you set `HARNESS_FE_TOKEN` in your shell rc, did the daemon and
   the browser-paste URL pick up the **same** value? `echo
   $HARNESS_FE_TOKEN` in both terminals.
3. The cookie. After a successful login the daemon sets
   `harness_fe_token`. If you copied a stale URL with a different
   token, clear `harness_fe_token` for that origin (Chrome DevTools →
   Application → Cookies).

### Daemon refuses to start: "refusing to bind 0.0.0.0 without a token"

The safety guard. You bound a non-loopback host but didn't supply
`--token`. Either:
- Add `--token auto` for an ephemeral token, OR
- `export HARNESS_FE_TOKEN=...` first then re-run

### Phone can reach the dashboard but the plugin's WS connection fails

Two common causes:

1. **macOS firewall blocking node**. Settings → Network → Firewall →
   Options → ensure `node` is allowed (or temporarily disable to
   confirm). On Linux check `ufw status` / `iptables -L`.
2. **Wrong IP**. `--host 0.0.0.0` makes the daemon listen on every
   interface, but the dashboard URL only prints **one** auto-detected
   LAN IP. On multi-homed machines (Docker, VPN, multiple NICs) it
   might be the wrong one. Override:
   ```bash
   npx @harness-fe/mcp-server --host 0.0.0.0 --token ... --public-host 192.168.x.y
   ```
   Or look at `ifconfig` / `ip addr` to find the right LAN IP and
   substitute it into the URL manually.

### Browser WebSocket fails but `curl` with `?token=` works

Browsers can't set `Authorization` headers on `new WebSocket(...)`. The
runtime client falls back to the URL query, which is what the plugin
injects via `__HARNESS_FE__.mcpUrl`. Confirm:

```js
// In the page console:
window.__HARNESS_FE__.mcpUrl
// Should be something like: ws://192.168.x.y:47729?token=...
```

If `mcpUrl` is missing the token, your plugin config doesn't have it.
Pass `token: process.env.HARNESS_FE_TOKEN` (or hard-code the value)
when calling `harnessFE(...)`.

### Agent gets 401 from MCP HTTP

Check the `Authorization: Bearer <token>` header in your agent config
matches the daemon's token. Some clients trim trailing whitespace from
multi-line JSON values — easy to introduce by accident when copy-paste.

### "warning: bound to non-loopback host"

Not an error — it's a reminder. The daemon will start, but anyone on
the LAN with the token can read your console / network / recordings.
Don't expose to public WiFi.

## 11. Vue 2 codebase — files aren't getting `data-morphix-loc`

`{{ x | filter }}` and `<template functional>` aren't valid Vue 3
syntax; the plugin skips those files instead of producing broken
output. Run `HARNESS_FE_DRY_RUN=1 pnpm build` to see the coverage
report on stderr — you'll get a list of which files are missing
attributes and why. Full guide:
[docs/vue2-compat.md](./vue2-compat.md).

## 12. Still stuck

- Run the daemon with `DEBUG=harness-fe:* pnpm start:mcp` for verbose logging
- File an issue with: the relevant timeline.jsonl excerpt (redact what you must), the daemon stdout, your Next / Vite / Webpack version, and what you expected
