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

经 [Issue #99](https://github.com/Morphicai/harness-fe/issues/99)(MorphixAI 整合)讨论收敛:4.0 采用**身份感知的 daemon 核心层**形态——鉴权不止 allow/deny,而是把*调用者身份*带到 tool 层,daemon 据此做 tenant 过滤。这是 5.0 gateway 治理层得以路由 / 审计 / 隔离的前提(见 [§5.0](#50--production-grade-high-availability-cloud-service))。

Anchored to the gaps surfaced in the multi-tenant readiness review(标注实施阶段 P1/P2/…,**P1 是唯一硬前置**):

- [ ] **Caller identity** ⭐ **(P1 — 先做,唯一硬前置)** — auth doesn't stop at allow/deny; it carries *who* (agent / user id) through to the tool layer. 本阶段只「带身份 + 打标 `createdBy`/`agentId`」,**不启用过滤、零行为变更**(loopback solo 仍零鉴权、看到全部;token 仍不自动生成);过滤留给 P3
- [ ] **Browser Consent (P2 — 新增安全原语,可与 P1 并行)** — control 类工具(`page.*`)执行前需浏览器端人工确认。新增 `consent-request` / `consent-response` 帧,默认 session 级一次确认,`evaluate` 强制每次。任何离开 loopback 的暴露都需要它,也是反馈闭环 L4 全自动的门禁(见 [§反馈闭环](#agent-反馈闭环-l1l4--direction-1))
- [ ] **Tenant isolation (P3 — 依赖 P1)** — `project.list` / `session.list` / `tasks_pending` filter by what the caller owns; an agent only sees its own projects' data (today any caller sees every project on the machine)
- [ ] **Command-target scoping (P3)** — `sendCommand`'s default "most-recent active tab" is scoped to the caller's own tabs, not globally (today it can drive another person's browser)
- [ ] **MCP session isolation (P4)** — HTTP transport becomes per-session instead of one shared transport;使身份在 HTTP 多 agent 下成立,是 5.0 gateway 远程接入的前置
- [ ] **`project → agent` binding index (P3)** — the daemon records "who generated this project" and routes `tasks_pending` accordingly
- [ ] **Host vs sub-app tagging (P3)** on the project tree so routing can express "host agent sees the sub-app's reports, but not vice-versa"

---

## 5.0 — Production-grade: high-availability cloud service

**Goal:** run Harness as a **hosted, highly-available cloud service** — not just self-hosted on one box. Builds directly on 4.0's identity/isolation.

> ⚠️ This is a **deliberate reversal** of the previous "no cloud SaaS" stance below. Running a hosted service is now an explicit 5.0 goal. The dev tool stays open and self-hostable; the cloud service is an *additional* offering, not a replacement.

按 [Issue #99](https://github.com/Morphicai/harness-fe/issues/99) 收敛的**分层架构**:身份感知的 `daemon` 核心层(必选)+ 可选的 `gateway` 治理层。**划界规则:凡需「数据 / 浏览器连接」的(隔离 / Consent / 存储 / 执行)归 daemon,凡「入口治理」的(token / RBAC / 路由 / 审计 / manifest)归 gateway。**

- [ ] **包解耦 (P5 — gateway 前置)** — 拆 `@harness-fe/daemon`(能力 + 存储 + browser 控制)/ `@harness-fe/mcp-server`(stdio 接入)/ `@harness-fe/gateway`(治理)/ `@harness-fe/dev-cli`(solo 零配置 glue)。daemon 是共享核心,已能 `createDaemon()` embed——主要是**边界清理而非重写**
- [ ] **MCP Gateway 治理层 (P6 — 体量最大,建立在 P1 + P4 + P5 之上)** — 独立 `@harness-fe/gateway` 进程:argon2id token 生命周期(SQLite)、Casbin RBAC(`control` / `read` / `write` scope)、append-only 审计、`token.server_id → daemon` 路由、按 scope 合成动态 tool manifest、纯 HTML 管理面板。token 管理集中此层,daemon 保持「永不生成 token」。scope 三分:`write` 只给浏览器 runtime client(绝不给 Agent),`read + control` 才是完整 Agent token
- [ ] **High availability** — multi-instance, no single point of failure; horizontal scale behind a load balancer
- [ ] **Pluggable persistence backend** — `IStore` → SQLite / Postgres / S3; required once instances share state
- [ ] **Remote MCP mode** — daemon hosted; browser tabs and agents report over authenticated WS / HTTP
- [ ] **Daemon-as-service** — managed deploy story, JWT / session auth integration, tenancy onboarding
- [ ] **Strict multi-tenant security** — untrusted-tenant isolation guarantees + a security review
- [ ] **Observability + limits** — metrics / tracing, rate limits, quotas, and an SLA target
- [ ] Stable, versioned public API contract

---

## Agent 反馈闭环 L1–L4 · Direction 1

**(P7)** 用户报告问题 → task 进队列 → Agent 排查(read 类工具)→ 生成 / 验证修复 → 反馈用户。基建已就绪(overlay 上报、tasks、session replay、`data-morphix-loc` 源码定位),缺的是**自动化编排 + 写回权限分级 + 修复验证标准**。

- [ ] **自动化分级 L1→L4** — L1 排查报告 / L2 生成 diff 待人审 / L3 写 staging 分支过 CI / L4 全自动。**L4 以 P2 Browser Consent 为门禁**
- [ ] **Writeback** — staging 分支 + PR workflow;git 写权限按 token / project 分级
- [ ] **task ↔ session ↔ project 关联** — task 绑定原始 sessionId,修复后产生新 sessionId,建立「原始问题 → 修复验证」关联
- [ ] **修复验证标准** — session replay 自动重放 + console 无 error + screenshot diff / 人工确认

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
