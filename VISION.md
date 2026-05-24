# Vision

Harness-FE is **the runtime for software developed by agents**. Every AI-coded app should ship with it from day one — so the agent that built the app can keep watching, listening, and fixing the app after it ships.

## Three nested directions

```
                                  ┌─────────────────────────────────────┐
                                  │  3. Foundation for any agent-built  │
                                  │     app — ships with the runtime    │
                                  │     by default                      │
                                  │                                     │
                                  │   ┌────────────────────────────┐    │
                                  │   │  2. Hosted apps inside a   │    │
                                  │   │     product (e.g. AI-      │    │
                                  │   │     generated apps in      │    │
                                  │   │     morphicai-web) report  │    │
                                  │   │     to the agent that      │    │
                                  │   │     built them             │    │
                                  │   │                            │    │
                                  │   │   ┌─────────────────────┐  │    │
                                  │   │   │  1. End users of a  │  │    │
                                  │   │   │     web product     │  │    │
                                  │   │   │     report bugs;    │  │    │
                                  │   │   │     the agent that  │  │    │
                                  │   │   │     owns the        │  │    │
                                  │   │   │     product picks   │  │    │
                                  │   │   │     them up and     │  │    │
                                  │   │   │     fixes           │  │    │
                                  │   │   └─────────────────────┘  │    │
                                  │   └────────────────────────────┘    │
                                  └─────────────────────────────────────┘
```

Each ring is a **superset** of the inner one. Building the inner well is a prerequisite for the outer.

### Direction 1 — Product feedback loop

Users of a shipped product (e.g. **morphicai-web**) hit "Report a problem" in the in-page overlay; the annotated screenshot + session timeline reach the agent that owns the product; the agent uses `data-morphix-loc` to jump straight to the failing component and ships a patch.

**Status (May 2026):** functionally complete locally — overlay, tasks, MCP tools, source-aware navigation all work. Gap is **deployment**: today's daemon assumes a developer running it on `localhost`. Productionising means daemon-in-product (embedded in the host web app) or daemon-as-service (hosted, authenticated, multi-tenant).

**Current phase (deliberate):** Harness-FE is used **only in the development environment** of host products (currently morphicai-web). End users never see the harness — `process.env.NODE_ENV === 'development'` guards every instrumentation path. The productionising work above remains the long-term direction; it is not the work in flight today. Today's focus is making the dev-time loop unbreakable, with one clean reference integration in morphicai-web.

### Direction 2 — Multi-tenant: AI-generated apps reporting to their generating agent

A host product (e.g. morphicai-web) renders AI-generated mini-apps inside iframes / module-federation slots. Each mini-app has its own agent author. When a user reports a problem inside a mini-app, the report must route to **the agent that generated that mini-app**, not the host product's agent.

**What we have:** `parentProjectId` + same-origin iframe identity inheritance — one `sessionId` spans parent + child frames, child events tagged with their own `projectId`. The timeline already preserves "which app produced this event".

**What's missing:** an explicit **`project → agent` binding index** + a routing mechanism, and isolation guarantees so agents only see feedback from their own apps. This sits on top of morphix-api's workspace model.

### Direction 3 — Foundation for the agent-development stack

Every app produced by a Harness-aware code-gen pipeline (e.g. `@morphixai/code` mini-apps; future scaffolds for whole web/native apps) ships with `@harness-fe/runtime` + `@harness-fe/log` + `<HarnessScript>` **by default**. The agent doesn't have to remember to add instrumentation — the harness is the runtime.

**What this means:**
- `@harness-fe/skill` becomes more than docs — it becomes the contract: "every Harness-aware agent knows how to use these tools"
- Mini-app templates, app scaffolds, and code-gen prompts all assume the runtime is present
- Bug reports, telemetry, source navigation are first-class — not bolted on later

This is the **endgame**: Harness is not a tool the developer integrates, it's the substrate every agent-built app runs on.

### Platform horizon

The first runtime target is Web because it gives us the cleanest source-aware loop: DOM element → source location → runtime event → MCP tool → agent action. The next targets keep that same loop but swap the runtime adapter:

| Platform | Goal | Notes |
|---|---|---|
| Web | Current foundation | Vite / Webpack / Next / Vue / React runtime, overlay, rrweb, MCP tools |
| React Native | Next native app target | Dev-only runtime client, Metro / Babel source mapping, device interaction, and React Native Harness as the real-device test backend |
| Expo | First-class React Native workflow | Support Expo projects and Expo dev clients rather than treating Expo as an afterthought |
| Flutter | Second native app target | Dart runtime adapter / VM-service bridge for logs, screenshots, widget or semantics queries, and agent interaction |
| WeChat Mini Program | Deferred | Not a near-term target; revisit after the runtime-adapter model is proven on Web, React Native / Expo, and Flutter |

The product line does not become "web observability plus some mobile integrations." The stable abstraction is **source-aware runtime access for agents**. Each platform adapter should answer the same questions:

- What is on screen?
- What happened in this session?
- Which source file produced the broken UI or behavior?
- What can the agent safely do next?
- How can the fix be verified in the real runtime?

## Why we're building this

LLMs can already write code. The hard part is **closing the loop** — getting them feedback from the running app fast enough that they can iterate the way a human developer iterates. Today that loop is mediated by humans: a user reports a bug in some chat channel, a human files a ticket, a human runs the agent, the agent has no context. Each hop loses fidelity.

Harness collapses that loop. The user's report goes directly to the agent's hands as a structured event, with the exact session timeline, the exact code location, and the exact pixel annotations attached. The agent reads what happened the same way a developer reading their own dev server logs would.

When that loop works end-to-end, AI-coded software stops being a one-shot deliverable and starts being a **living artifact** that improves with use.

## How this rewrites the roadmap

The previous roadmap was a tech-debt list (more bundler adapters, more transport modes, more tests). That's plumbing.

The work that actually moves us forward toward the mission falls into three buckets:

1. **Make direction 1 deployable** (1.1.x focus) — daemon embeddable in a product; HTTP MCP for clean integration; auth and persistence boundaries for multi-user dev environments.
2. **Make direction 2 routable** (1.2.x focus) — project-to-agent binding; per-tenant isolation; feedback fan-in across many mini-apps.
3. **Make direction 3 the default** (2.0.x focus) — Harness-baked code-gen templates; scaffold tooling; "every new agent-built app starts with Harness" becomes the path of least resistance.
4. **Generalize the runtime adapter model** — Web first, then React Native / Expo, then Flutter. WeChat Mini Program support is explicitly deferred.
5. **Make the overlay extensible** — the built-in overlay is the default experience, but developers must be able to add their own panels and actions, such as creating a Jira issue linked to a Harness task.

See [ROADMAP.md](./ROADMAP.md) for the milestone-level breakdown.

## Non-goals

- **Replacing production observability** — Sentry / Datadog / DataDog RUM stay relevant. Harness is for the dev-feedback loop, not 95th-percentile latency dashboards.
- **Becoming a closed platform** — the protocol, the SDK, and the daemon are open. Other agents besides ours must be able to consume the data.
- **General-purpose error tracking** — every event is tied to a session and a source location. Harness is not the right tool for headless cron / no-UI services.
