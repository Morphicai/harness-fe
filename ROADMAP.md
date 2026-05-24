# Harness-FE Roadmap

Public, rough, and subject to change. File a GitHub issue if you want to push something up the list.

The roadmap is organised around the three mission directions in [VISION.md](./VISION.md):

1. **Product feedback loop** — end users → agent
2. **Multi-tenant routing** — hosted apps → their generating agents
3. **Foundation default** — every agent-coded app ships with Harness

Each milestone below is anchored to one of those directions.

---

## Shipped (0.1.x – 1.0.x)

The foundation that the mission rests on. All directions need this.

- [x] Source-aware JSX transform (`data-morphix-loc` / `data-morphix-comp`)
- [x] `@harness-fe/react-jsx` — `jsxImportSource` runtime, no bundler plugin needed
- [x] MCP daemon — WebSocket bridge + HTTP-batch (Edge) + JSONL persistence
- [x] Runtime client — console / network / errors / rrweb + in-page "H" overlay + annotated tasks
- [x] Vite / Webpack — React + Vue 3, all stable
- [x] First-class Next.js (App + Pages Router, webpack + Turbopack, Node + Edge)
- [x] `@harness-fe/node-runtime` — ALS + DI sessionId, dual transport
- [x] `@harness-fe/next` — `<HarnessScript>` Server Component; unified sessionId across SSR + client
- [x] `@harness-fe/log` — isomorphic structured logger
- [x] Same-origin iframe identity inheritance (foundation for direction 2)
- [x] Stable wire protocol `PROTOCOL_VERSION` (locked at 1.0)
- [x] OIDC-trusted-publisher npm releases + `--provenance`
- [x] Disk auto-purge + size limits
- [x] `@harness-fe/skill` — agent playbook as standalone npm

---

## 1.1.x — Direction 1: make the feedback loop deployable

Today the daemon assumes a developer running it on `localhost`. To put Harness inside a real product, it must be embeddable, addressable, and authenticatable.

> **Current phase (deliberate):** the items below describe the *long-term* productionising path. The work actually in flight is a tighter target: make harness-fe rock-solid in the **development environment** of host products (currently morphicai-web), with zero footprint in production builds. Productionising (embed in a host product, daemon-as-service) is queued behind that and is **not** the focus right now. The architectural prerequisites — embeddable daemon factory, resumable SSE — are still being completed because they're worth landing regardless of when they're consumed in production.

- [x] **HTTP Streamable MCP transport** — drop the one-stdio-subprocess-per-agent model; one daemon serves all agents; remote-friendly; standard MCP transport. (`mcpHttp.ts` + `StreamableHTTPServerTransport`; opt-in via `--mcp-transport http`, stdio remains the default.)
- [x] **Embeddable daemon** — `createDaemon({ port, store, authorize, token, eventStore, mcpHttp, … })` factory for in-process embedding. CLI is now a thin wrapper around it (one boot path). README's "Embedding into a host app" section covers the contract. Mounting onto a host-owned `http.Server` (middleware mode) is out of scope here and tracked separately.
- [x] **`Last-Event-ID` SSE reconnection** — survives transient disconnects during long agent runs (in-memory `MemoryEventStore` default; pluggable via `eventStore` option on `startMcpHttpServer`)
- [ ] **Auth on the daemon boundary** — token-based; the in-process API doesn't need it, the network boundary does
- [ ] **Streaming phase 4** — child-agent `spawn` → stream mode (execution visible in real time)
- [ ] **Multi-bundler reach** — Rspack + esbuild + Rollup adapters via unplugin
- [ ] **Documentation site** (VitePress) — public docs with a clear problem statement, architecture, quickstarts, agent setup, framework guides, and roadmap pages
- [ ] **Overlay plugin API** — turn the built-in "H" overlay into an extensible surface so developers can add custom actions and panels without forking `@harness-fe/runtime`
- [ ] **Official issue-tracker plugin example** — Jira first: create a linked external issue from a selected element, screenshot, source location, logs, network tail, and session metadata

---

## 1.2.x — Direction 2: route feedback to the right agent

When morphicai-web hosts AI-generated mini-apps, each app has its own agent author. Feedback from inside a mini-app must reach the agent that built it — not the host's agent, not other tenants' agents.

- [ ] **`project → agent` binding index** — the daemon records "who generated this project" and routes `tasks_pending` queries accordingly
- [ ] **Multi-tenant isolation** — strict `projectId` scoping in MCP tool results; an agent only sees sessions for projects it owns
- [ ] **Pluggable persistence backend** — `IStore` → SQLite / Postgres / S3; needed when multiple tenants share storage
- [ ] **Remote MCP mode** — daemon hosted, browser tabs report via authenticated WS
- [ ] **Project tree on the daemon** is already cycle-protected, but extend with explicit "host vs sub-app" tagging so the routing rules can express "the host agent sees the sub-app's reports too, but the sub-app's agent doesn't see the host's"

---

## 2.0.x — Direction 3: Harness as default for agent-built apps

The endgame: every Harness-aware code-gen pipeline (`@morphixai/code` mini-apps; future scaffolds for whole web / native apps) emits projects that ship with the runtime by default. The developer never has to think about adding it.

- [ ] **`@morphixai/code` template integration** — mini-app templates include `@harness-fe/log` + `<HarnessScript>` by default; the agent doesn't need to remember
- [ ] **Scaffold CLI** — `npx @harness-fe/create-app` produces a project pre-wired with everything
- [ ] **Harness-first Skill v2** — `@harness-fe/skill` evolves from "how to use the tools" into "the contract every Harness-aware agent follows"
- [ ] **React Native runtime client** — dev-only `@harness-fe/react-native` runtime for console / errors / network / screenshots / basic interaction; same `sessionId` and MCP semantics as web
- [ ] **Expo support** — first-class Expo development workflow support, including Expo dev clients where native modules are present
- [ ] **React Native Harness integration** — expose React Native Harness as a real-device test backend that agents can initialize, run, inspect, and use for regression verification
- [ ] **React Native source-aware mapping** — Metro / Babel transform that maps RN elements, `testID`, accessibility metadata, component names, and source locations back to files
- [ ] **Flutter runtime client** — dev-only Dart package / VM-service bridge for logs, errors, screenshots, widget or semantics tree queries, and basic interaction
- [ ] **Multi-user collaborative sessions** — pair-debugging where two humans + the agent share one session timeline

---

## Architectural follow-ups (no schedule, cross-cutting)

- [ ] Extract `@harness-fe/react-session` micro-package — the textbook layering version of today's `setSessionIdProvider` side-effect DI
- [ ] Solid / Svelte / Qwik transforms

---

## Not on the roadmap

- **Production analytics / RUM** — Harness is a **dev/agent-feedback** tool, not Sentry / Datadog. We will not add prod runtime hooks for ops monitoring.
- **Cloud-hosted dashboard for end users** — out of scope. The daemon being embeddable (1.1.x) covers the "host app integrates it" case without us running a SaaS.
- **Telemetry phoning home from a user's machine** — the dev tool stays silent unless the user explicitly opts in.
- **Closed protocol** — the wire format, the SDKs, and the daemon stay open. Third-party agents that aren't ours must be able to consume the data.
- **WeChat Mini Program support for now** — valuable, but intentionally deferred until Web, React Native / Expo, and Flutter have solid runtime-adapter foundations.
