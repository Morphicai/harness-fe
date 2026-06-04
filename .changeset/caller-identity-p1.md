---
'@harness-fe/protocol': minor
'@harness-fe/gateway': minor
---

Caller identity (4.0 · P1) — the auth boundary now carries *who*, not just
allow/deny.

- New `identity` module: `Principal` type + `resolvePrincipal(req, auth)`
  (loopback → `local`, token → hashed `token:…` id, custom-authorize → `host`),
  layered on the existing auth primitives so the two never disagree on who is
  allowed in.
- WS connections resolve a `Principal` at upgrade and carry it on
  `PeerSession.principal`.
- Project / session metadata and `Task` gain optional `createdBy` (write-once)
  and `Task.agentId`; the bridge tags project/session creation with the
  connection's principal and stamps `agentId` on task claim/resolve.

Phase 1 only **establishes and tags** identity — reads are not yet filtered by
owner (that is P3 tenant isolation). Behaviour is unchanged: loopback solo dev
stays a single implicit `local` principal, tokens are still never
auto-generated, and all new fields are optional.
