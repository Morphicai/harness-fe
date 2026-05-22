---
'@harness-fe/mcp-server': patch
---

Token is now fully optional — the daemon never refuses to start over
auth policy. Whether to require a token, and at what bind address, is
entirely the operator's call.

Concretely:

- **Previous behavior**: `--host 0.0.0.0` without `--token` was
  refused at startup with a hard error.
- **New behavior**: the CLI starts. When binding to a non-loopback
  host without a token, a stderr warning prints — "no token set —
  anyone on this network can read console / network / recordings"
  — and that's it.

The startup banner now **always** prints the dashboard URL, regardless
of token state:

- No token: `http://<host>:<port>` — bare URL, auth disabled
- With token: `http://<host>:<port>?token=<token>` — first browser
  hit hands the token off to a 30-day cookie via mcp-server's
  existing handoff redirect

Same applies to the `--mcp-transport http` agent-config hint: when
no token is set, the printed JSON snippet omits the `Authorization`
header line. `HARNESS_FE_TOKEN` env var continues to be honored as
an equivalent to `--token`.

README updated with a behavior table so the four common scenarios
(local open / local + auth / LAN open / LAN + auth) are spelled out
in one place.
