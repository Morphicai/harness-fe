---
'@harness-fe/daemon': minor
---

Trusted-upstream caller identity (5.0 · P6 · C1) — the daemon can now honour a
caller identity forwarded by a trusted upstream (the gateway).

`identifyPrincipal` checks the `x-harness-caller` header (exported as
`FORWARDED_CALLER_HEADER`) and, when present on an **auth-enabled** request,
resolves to a `forwarded` principal with that id. Only the gateway holds a
valid credential to clear auth, so only it can forward an identity; on loopback
(no auth) the header is ignored, so an unauthenticated client cannot spoof a
caller. This lets the upcoming gateway map `token → identity` and proxy MCP to
the daemon while preserving per-call tenant isolation.

Zero behaviour change without a gateway: no `x-harness-caller` header → the
existing token/local resolution is unchanged.
