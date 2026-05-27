# Harness-FE Roadmap

Public, rough, and subject to change. File a GitHub issue if you want to push something up the list.

There are **two axes** to this roadmap:

- **Direction (who reports to whom)** — the three nested rings in [VISION.md](./VISION.md): (1) product feedback loop, (2) multi-tenant routing, (3) foundation-default for agent-built apps.
- **Maturity (how far it's deployed)** — the release lines below. This is the primary planning frame today.

## Release lines (maturity trajectory)

| Line | Branch / npm tag | What it is | Bar |
|---|---|---|---|
| **3.x** | `main` / `latest` | **Personal dev tool** — today's product | Rock-solid in the host app's *dev environment*, zero prod footprint. Bug fixes + dev-experience polish. |
| **4.0** | `next` / `@next` (prerelease) | **Team-usable (experimental)** | One shared daemon a team self-hosts; members don't collide and each only sees their own. Identity + isolation + routing. |
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

## 4.0 — Team-usable (`next`, experimental) · Direction 2

**Goal:** a team self-hosts **one** shared daemon and multiple members use it without colliding — no cross-driving the wrong tab, no seeing each other's projects/sessions. This is the **identity + isolation + routing** layer. Scope is a *trusted* team; hardening against untrusted multi-tenancy is part of 5.0.

Anchored to the gaps surfaced in the multi-tenant readiness review:

- [ ] **Caller identity** — auth doesn't stop at allow/deny; it carries *who* (agent / user id) through to the tool layer
- [ ] **Tenant isolation** — `project.list` / `session.list` / `tasks_pending` filter by what the caller owns; an agent only sees its own projects' data (today any caller sees every project on the machine)
- [ ] **Command-target scoping** — `sendCommand`'s default "most-recent active tab" is scoped to the caller's own tabs, not globally (today it can drive another person's browser)
- [ ] **MCP session isolation** — HTTP transport becomes per-session instead of one shared transport
- [ ] **`project → agent` binding index** — the daemon records "who generated this project" and routes `tasks_pending` accordingly
- [ ] **Host vs sub-app tagging** on the project tree so routing can express "host agent sees the sub-app's reports, but not vice-versa"

---

## 5.0 — Production-grade: high-availability cloud service

**Goal:** run Harness as a **hosted, highly-available cloud service** — not just self-hosted on one box. Builds directly on 4.0's identity/isolation.

> ⚠️ This is a **deliberate reversal** of the previous "no cloud SaaS" stance below. Running a hosted service is now an explicit 5.0 goal. The dev tool stays open and self-hostable; the cloud service is an *additional* offering, not a replacement.

- [ ] **High availability** — multi-instance, no single point of failure; horizontal scale behind a load balancer
- [ ] **Pluggable persistence backend** — `IStore` → SQLite / Postgres / S3; required once instances share state
- [ ] **Remote MCP mode** — daemon hosted; browser tabs and agents report over authenticated WS / HTTP
- [ ] **Daemon-as-service** — managed deploy story, JWT / session auth integration, tenancy onboarding
- [ ] **Strict multi-tenant security** — untrusted-tenant isolation guarantees + a security review
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

## Architectural follow-ups (no schedule, cross-cutting)

- [ ] Extract `@harness-fe/react-session` micro-package — the textbook layering version of today's `setSessionIdProvider` side-effect DI
- [ ] Solid / Svelte / Qwik transforms

---

## Not on the roadmap

- **Production analytics / RUM** — Harness is a **dev/agent-feedback** tool, not Sentry / Datadog. We will not add prod runtime hooks for ops monitoring. (The 5.0 cloud service hosts the *agent-feedback* daemon — it is not an end-user analytics product.)
- **Telemetry phoning home from a user's machine** — the dev tool stays silent unless the user explicitly opts in.
- **Closed protocol** — the wire format, the SDKs, and the daemon stay open. Third-party agents that aren't ours must be able to consume the data.
- **WeChat Mini Program support for now** — valuable, but intentionally deferred until Web, React Native / Expo, and Flutter have solid runtime-adapter foundations.
