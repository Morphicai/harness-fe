---
'@harness-fe/gateway': minor
---

Gateway CLI launcher — `@harness-fe/gateway` ships a `harness-gateway` bin, so
the governance gateway can run as a standalone process (it was library-only
before, which meant it couldn't actually be deployed).

```
harness-gateway --port 47950 \
  --admin-user admin --admin-pass secret \
  --add-server name=team,endpoint=http://127.0.0.1:47900,token=DAEMON_SECRET \
  --issue-token name=agentA,server=team,scopes=read+control
```

- `--add-server` registers an upstream daemon (idempotent by name).
- `--issue-token` mints a scoped gateway token and prints it once.
- `--admin-user/--admin-pass` bootstraps the first admin (never clobbers an
  existing one); tokens/servers/audit are also manageable from the `/admin` panel.

Verified end to end against a real daemon: scope-gated RBAC (a `read` token is
denied `page.click`; a `read+control` token is forwarded), token→server routing,
caller injection, audit logging, and a multi-user topology (multiple browsers →
one central daemon → agents via the gateway). See examples/DEMO.md.
