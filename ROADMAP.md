# Harness-FE Roadmap

Public, rough, and subject to change. File a GitHub issue if you want to push something up the list.

There are **two axes** to this roadmap:

- **Direction (who reports to whom)** — the three nested rings in [VISION.md](./VISION.md): (1) product feedback loop, (2) multi-tenant routing, (3) foundation-default for agent-built apps.
- **Maturity (how far it's deployed)** — the release lines below. This is the primary planning frame today.

## Release lines (maturity trajectory)

| Line | Branch / npm tag | What it is | Bar |
|---|---|---|---|
| **3.x** | `main` / `latest` | **Personal dev tool** — today's product | Rock-solid in the host app's *dev environment*, zero prod footprint. Bug fixes + dev-experience polish. |
| **4.0** | `next` / `@next` (prerelease) | **Team-usable (experimental — shipped `4.0.0-next.4`)** | One shared daemon a team self-hosts; members don't collide and each only sees their own. Identity + isolation + routing + gateway. |
| **5.0** | (after 4.0) | **Production-grade** | High availability + hosted **cloud service**: multi-instance/no-SPOF, shared persistence, remote MCP, observability, SLA. |

3.x and 4.0 develop **in parallel** (see [docs/operations/release-flow.md](./docs/operations/release-flow.md) for the dual-line release setup). 4.0's identity/isolation work is the foundation 5.0's cloud service builds on.

---

## Shipped (0.1.x – 3.x foundation)

The foundation that the mission rests on. All directions need this.

- [x] Source-aware JSX transform (`data-morphix-loc` / `data-morphix-comp`)
- [x] `@harness-fe/react-jsx` — `jsxImportSource` runtime, no bundler plugin needed
- [x] MCP daemon — WebSocket bridge + HTTP-batch (Edge) + JSONL persistence
- [x] HTTP Streamable MCP transport — one daemon serves all agents; remote-friendly (`--mcp-transport http`, stdio remains default)
- [x] Embeddable daemon — `createDaemon({ … })` factory; CLI is a thin wrapper (one boot path)
- [x] `Last-Event-ID` SSE reconnection — survives transient disconnects (pluggable `eventStore`)
- [x] Auth on the daemon boundary — single check across HTTP MCP / WS / dashboard; `token` or host-supplied `authorize(req)`
- [x] Runtime client — console / network / errors / rrweb + in-page "H" overlay + annotated tasks
- [x] Overlay plugin API — `registerOverlayPlugin` custom action buttons + typed, redaction-aware context. See [docs/overlay-plugins.md](./docs/overlay-plugins.md)
- [x] Vite / Webpack — React + Vue 3, all stable
- [x] First-class Next.js (App + Pages Router, webpack + Turbopack, Node + Edge)
- [x] `@harness-fe/node-runtime` — ALS + DI sessionId, dual transport
- [x] `@harness-fe/next` — `<HarnessScript>` Server Component; unified sessionId across SSR + client
- [x] `@harness-fe/log` — isomorphic structured logger
- [x] Same-origin iframe identity inheritance (foundation for the team / multi-tenant line)
- [x] Stable wire protocol `PROTOCOL_VERSION` (locked at 1.0)
- [x] OIDC-trusted-publisher npm releases + `--provenance`; dual-line (3.x `latest` / 4.0 `@next`) release flow
- [x] Disk auto-purge + size limits
- [x] `@harness-fe/skill` — agent playbook as standalone npm
- [x] Experimental-tool gate — opt-in env-var gating for in-testing MCP tools

---

## 3.x — Personal dev tool (`main`, ongoing)

Keep the single-developer experience unbreakable; ship dev-experience polish and bug fixes. Mostly **Direction 1**.

- [ ] **Streaming phase 4** — child-agent `spawn` → stream mode (execution visible in real time)
- [ ] **Multi-bundler reach** — Rspack + esbuild + Rollup adapters via unplugin
- [ ] **Documentation site** (VitePress) — public docs: problem statement, architecture, quickstarts, agent setup, framework guides, roadmap
- [ ] **Official issue-tracker plugin example** — Jira first, building on the overlay plugin API. _A documented Jira example + proxy contract already ships in [docs/overlay-plugins.md](./docs/overlay-plugins.md); a published, batteries-included package is still pending._
- [ ] Ongoing bug fixes + small enhancements

---

## 4.0 — Team-usable (`next`, experimental — shipped as `4.0.0-next.4`) · Direction 2

**Goal:** a team self-hosts **one** shared daemon and multiple members use it without colliding — no cross-driving the wrong tab, no seeing each other's projects/sessions. This is the **identity + isolation + routing** layer. Scope is a *trusted* team; hardening against untrusted multi-tenancy is part of 5.0.

Anchored to the gaps surfaced in the multi-tenant readiness review — **all shipped in `4.0.0-next.4`:**

- [x] **Caller identity** — auth carries *who* (a `Principal`) through to the tool layer
- [x] **Tenant isolation** — `project.list` / `session.list` / `tasks_pending` filter by `canSee`; an agent only sees data it's authorized for (was: every caller saw every project)
- [x] **Command-target scoping** — `sendCommand` / `findTab` scoped to the caller's own tabs, not globally
- [x] **MCP session isolation** — HTTP transport is now **per-session** (one transport + server per `mcp-session-id`; multiple agents concurrent)
- [x] **`project → agent` binding** — tokens carry project grants; a bound agent sees the project's whole data set regardless of *who created each row* (creator ≠ consumer solved) — the piece that makes team mode actually usable
- [x] **Host vs sub-app tagging** — `parentProjectId` owner chain; a host agent sees its sub-apps' data, not vice-versa
- [x] **Browser Consent (P2)** — control commands (`page.*`) require in-page user approval once the daemon is exposed
- [x] **Package split (P5)** — `@harness-fe/daemon` (core) / `mcp-server` (MCP protocol) / `dev-cli` (solo launcher)
- [x] **Governance gateway (P6)** — `@harness-fe/gateway`: token lifecycle + scope RBAC + dynamic manifest + project→agent binding + append-only audit + admin panel; `harness-gateway` CLI
- [x] **Agent feedback loop (P7)** — structured `tasks.resolve` resolution (`type` / `commit` / `prUrl` / `verificationSessionId`) back-linking a report → its fix → the re-test that proved it

- [ ] **Runtime opt-in + default policy** — users actively enable in-page agent control via an overlay prompt; build plugin declares `runtimeControl: { defaultPolicy: 'ask' | 'allow' | 'deny', scopes }` as the app-level default; runtime client persists the user's choice to localStorage and gates all control commands behind it. Extends the existing Browser Consent (P2) mechanism rather than replacing it. See design analysis: plugin owns policy declaration, runtime client owns user UX + persistence.

Remaining toward **stable 4.0**: graduate `@next` → `latest` (`changeset pre exit`) once the team path settles in real use.

---

## 5.0 — Production-grade: high-availability cloud service

**Goal:** run Harness as a **hosted, highly-available cloud service** — not just self-hosted on one box. Builds directly on 4.0's identity/isolation.

> ⚠️ This is a **deliberate reversal** of the previous "no cloud SaaS" stance below. Running a hosted service is now an explicit 5.0 goal. The dev tool stays open and self-hostable; the cloud service is an *additional* offering, not a replacement.

- [ ] **High availability** — multi-instance, no single point of failure; horizontal scale behind a load balancer
- [ ] **Pluggable persistence backend (IStore split + adapters)** — `IStore` split into three capability sub-interfaces by data characteristic: `IMetaStore` (structured metadata → Postgres/SQLite/Supabase), `IEventStore` (append-only time-series → ClickHouse/TimescaleDB/Kafka), `IBlobStore` (large objects/recordings → S3/MinIO/GCS). A `createCompositeStore({ meta, events, blobs })` factory lets users mix-and-match per sub-interface. The existing `FileStore` becomes the default implementation of all three. Official adapter packages: `@harness-fe/store-postgres`, `@harness-fe/store-clickhouse`, `@harness-fe/store-s3`, `@harness-fe/store-sqlite`; third parties can implement any single sub-interface.
- [ ] **Remote MCP mode** — daemon hosted; browser tabs and agents report over authenticated WS / HTTP
- [ ] **Daemon-as-service** — managed deploy story, JWT / session auth integration, tenancy onboarding
- [ ] **Strict multi-tenant security** — untrusted-tenant isolation guarantees + a security review
- [ ] **Real user identity binding** — runtime sessions bound to the host app's authenticated user; only users who pass the host app's own auth (JWT/OIDC validation via a developer-supplied `verifyUser` hook) can contribute session data; prevents anonymous or bot-originated uploads from polluting the session store.
- [ ] **Request signing (HMAC-SHA256)** — every runtime upload and agent API call carries a per-request signature (`X-Harness-Signature: t=<timestamp>,v=<hmac>`) computed from `timestamp + method + path + body-hash`; gateway rejects replays outside a 5-minute window; token secret is the signing key so the token itself never travels in the signature header. Closes the replay-attack surface even if a token is leaked. Client SDK generates the signature transparently.
- [ ] **Gateway plugin system** — `GatewayPlugin` interface + `plugins: GatewayPlugin[]` in `GatewayOptions`; plugins implement only what they need: `verifyUser` (real-user auth), `verifySignature` (HMAC), `onSession/onError/onNetworkRequest/onRecording` (forward to external systems), `onAudit` (stream audit log). Security mechanisms (HMAC signing, user binding) ship as built-in plugins; external system adapters (Sentry, Datadog, Slack) as `@harness-fe/plugin-*` packages. Third parties can publish their own.
- [ ] **Observability + limits** — metrics / tracing, rate limits, quotas, and an SLA target
- [ ] Stable, versioned public API contract

---

## Ecosystem reach (parallel track, version-agnostic) · Direction 3

Coverage work that lands as it matures, independent of the 3/4/5 maturity line. The endgame: every agent-coded app ships with the runtime by default.

- [ ] **`@morphixai/code` template integration** — mini-app templates include `@harness-fe/log` + `<HarnessScript>` by default
- [ ] **Scaffold CLI** — `npx @harness-fe/create-app` produces a pre-wired project
- [ ] **Harness-first Skill v2** — `@harness-fe/skill` evolves from "how to use the tools" into "the contract every Harness-aware agent follows"
- [ ] **React Native runtime client** — dev-only `@harness-fe/react-native` for console / errors / network / screenshots / interaction; same `sessionId` + MCP semantics
- [ ] **Expo support** — first-class Expo dev workflow, incl. dev clients with native modules
- [ ] **React Native Harness integration** — real-device test backend agents can init / run / inspect for regression
- [ ] **React Native source-aware mapping** — Metro / Babel transform mapping RN elements / `testID` / a11y / component names back to files
- [ ] **Flutter runtime client** — dev-only Dart / VM-service bridge for logs, errors, screenshots, widget tree, interaction
- [ ] **Multi-user collaborative sessions** — pair-debugging: two humans + the agent share one session timeline

---

## Security hardening (cross-cutting, 4.0+)

Items that apply across the 4.0 team and 5.0 cloud lines; can land incrementally.

- [ ] **Token TTL + IP binding** — expose `ttl` and `allowedIps` on `--issue-token` CLI and admin panel; `expiresAt` and `ip` fields already exist in the store schema, wiring is all that's needed.
- [ ] **Request signing (HMAC-SHA256)** — see 5.0 entry; can be back-ported to 4.0 gateway once the spec is stable.
- [ ] **Rate limiting per token** — sliding-window counter in the gateway store; configurable `rateLimit: { requests, windowMs }` per token; returns `429` with `Retry-After`.
- [ ] **Audit log exposure** — surface the append-only audit log (already written) via `/admin/audit` panel and a streaming MCP tool so operators can detect abuse in real time.

---

## Architectural review — open questions before 5.0

> These are unresolved design questions surfaced during 4.0 development. They must be answered before committing to the 5.0 production architecture. Some may require breaking changes to the wire protocol or store interface.

### Runtime entry & build plugin coupling

- **Is the build plugin (Vite/Webpack) the right entry point?** Currently the plugin is the only ergonomic way to inject the runtime. Without it users must manually inject `window.__HARNESS_FE__` and import the runtime — losing source-location awareness entirely. Should there be a zero-config script-tag path that works without a bundler plugin (at the cost of source mapping)?
- **Token exposure in HTML bundle** — the runtime token is baked into `window.__HARNESS_FE__` at build time and is visible to anyone with DevTools. This is acceptable in dev; it is not acceptable in production. The architecture does not yet have a clear answer for production token delivery. Candidate: runtime fetches a short-lived token from the host app's auth endpoint at startup. Requires the `verifyUser` hook and Token TTL work to land first.
- **Build plugin is required for source awareness** — `data-morphix-loc` / `data-morphix-comp` attributes are injected at transform time. Any runtime-only path loses file:line element mapping. Is there a viable runtime-only fallback (e.g. reading React DevTools fiber, stack-trace parsing)?

### Extensibility gaps

- **No public Runtime Data API** — `window.HarnessFE` only exposes `{ registerOverlayPlugin, version }`. Users cannot: identify the current user dynamically after login, send custom events (`HarnessFE.track`), attach metadata to a session, or enrich events with per-request context (A/B variant, feature flags, deploy SHA). The store's `StoreEvent.d` and `SessionMeta.metadata` fields are open (`unknown` / `Record<string, unknown>`), but there is no API path from the browser to write them. **This must be solved before production use is viable.**
- **IStore is monolithic** — 35 methods as a single interface means users cannot partially implement a custom backend. Connecting to Postgres (metadata) + ClickHouse (events) + S3 (recordings) requires implementing all 35. The `IMetaStore / IEventStore / IBlobStore` split is designed but not implemented.
- **GatewayPlugin system missing** — there is no hook for forwarding events to external systems (Sentry, Datadog, custom analytics). Every integration today requires forking the gateway. This blocks production adoption where teams already have observability infrastructure.
- **No event enrichment pipeline** — no middleware to intercept events before storage and attach global context (app version, git SHA, deployment environment). Plugin config `enrichEvent` hook is designed but not implemented.

### Protocol & wire format

- **Protocol versioning strategy** — `PROTOCOL_VERSION` is locked at `1.0`. The 5.0 changes (user identity, signing, richer metadata) will require breaking changes. There is no negotiation mechanism in `hello` / `hello.ack` beyond a version string. How do we handle mixed-version deployments (old runtime talking to new gateway, or vice versa)?
- **HTTP batch transport completeness** — the `/events` HTTP batch path (for Node/Edge runtimes without persistent WS) is stateless by design. It does not support command delivery back to the runtime. Is this acceptable long-term, or does every production environment need a persistent WebSocket?

### Production security posture

- **HMAC request signing** — designed (see Security hardening section) but not implemented. Until it lands, any leaked token grants unlimited API access for its lifetime.
- **No real-user binding** — session data is accepted from any client that holds a valid write-scope token. There is no mechanism to verify that the browser submitting data is an actual authenticated user of the host application. This means a leaked token can be used to inject arbitrary session data.
- **Runtime opt-in not implemented** — users have no way to actively enable or disable agent control of their browser. The consent gate (P2) requires the user to approve individual commands, but the runtime connects and begins recording automatically on page load with no user-visible indication.

### Scalability & storage

- **FileStore is the only production-tested backend** — the JSONL file layout has not been stress-tested beyond single-developer use. Unknown behavior under concurrent writes from multiple runtime clients or high event throughput (e.g. rrweb at 60fps).
- **No backpressure on event ingestion** — `appendEvent` is synchronous and unbounded. A misbehaving or high-frequency client can saturate disk I/O with no rate limiting at the store layer.
- **Recording retention is best-effort** — the purge policy runs on a timer and is not transactional. A crash mid-purge can leave orphaned files. Not a problem in dev; needs hardening before production.

---

## Architectural follow-ups (no schedule, cross-cutting)

- [ ] Extract `@harness-fe/react-session` micro-package — the textbook layering version of today's `setSessionIdProvider` side-effect DI
- [ ] Solid / Svelte / Qwik transforms

---

## Not on the roadmap

- **Production analytics / RUM** — Harness is a **dev/agent-feedback** tool, not Sentry / Datadog. We will not add prod runtime hooks for ops monitoring. (The 5.0 cloud service hosts the *agent-feedback* daemon — it is not an end-user analytics product.)
- **Telemetry phoning home from a user's machine** — the dev tool stays silent unless the user explicitly opts in.
- **Closed protocol** — the wire format, the SDKs, and the daemon stay open. Third-party agents that aren't ours must be able to consume the data.
- **WeChat Mini Program support for now** — valuable, but intentionally deferred until Web, React Native / Expo, and Flutter have solid runtime-adapter foundations.
