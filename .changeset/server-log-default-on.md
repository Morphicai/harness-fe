---
"@harnessa-fe/node-runtime": minor
---

`captureConsole` is now **default on** — server-side `console.*` output is forwarded to the daemon as `server-log` events automatically once `register()` runs.

Why: requiring users to know about and set `HARNESSA_FE_NODE_CONSOLE=1` for the basic case ("see my server logs in the daemon") was friction with little benefit. Most apps want server console visibility from day one; the off-by-default was a defensive default that turned out to be wrong for the common case.

**Opt out**:
- Pass `register({ captureConsole: false })` programmatically, OR
- Set `HARNESSA_FE_NODE_CONSOLE=0` env var (note: now `=0` to disable, not `=1` to enable).

Existing users who never set the env var get a free upgrade — their console output starts flowing without code changes. Existing users who set `HARNESSA_FE_NODE_CONSOLE=1` to opt in: that's now a no-op (still enables, but redundant); set to `0` if you specifically want it off.
