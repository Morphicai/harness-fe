# Weekly blog routine

> Canonical routine for the weekly harness-fe evangelism post. Run it via the
> local `/weekly-blog` slash command (`.claude/commands/weekly-blog.md`, which
> points here), or just follow these steps manually. Cadence: **one per week**,
> manual trigger.

You are producing the **weekly harness-fe evangelism blog post**. The mission is
to get harness-fe *seen* — every post is concrete, opinionated, honest, and
shareable. No fluff, no overclaiming, no fake metrics.

Follow these steps in order. Do not skip the quality bar or the compliance check.

## 1. Pick the topic

- Read `docs/blog-backlog.md`. Pick the **top row with `status: todo`** (lowest
  `#`), unless the user named a specific topic in the command arguments — then use that.
- If the queue is empty, tell the user and stop (propose 3–5 fresh topics for them to approve).

## 2. Research for substance — DEPTH IS THE BAR (not generic marketing)

The user's standing feedback: posts must **not be hollow**. They must (a) be
grounded in the **real current state of agent development** and (b) use a **real,
verified dev scenario**, and (c) demonstrate genuine technical depth. Hollow
"imagine a bug" framing fails the bar.

- **Landscape grounding (cite real sources).** Anchor claims about how agents
  work / where they fail in citable evidence — vendor docs, GitHub issues, papers,
  practitioner blogs, HN threads. For a big/authoritative post, run the
  `deep-research` skill first. Reusable, already-verified anchors:
  - Chrome's own framing that agents are "programming with a blindfold on" — [developer.chrome.com/blog/chrome-devtools-mcp](https://developer.chrome.com/blog/chrome-devtools-mcp)
  - Chrome DevTools MCP console traces point at *bundled*, not source-mapped, lines — [chrome-devtools-mcp #695](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/695)
  - the "describe-check-fix loop" + what tools can't see — [dev.to/bluehotdog](https://dev.to/bluehotdog/ai-coding-tools-that-actually-see-your-browser-2026-2hoc)
  - agents falsely report success on broken UIs — [huuhka.net](https://www.huuhka.net/browser-verification-for-coding-agents-chrome-devtools-mcp-vs-agent-browser/)
  - MCP trajectory (Anthropic Nov 2024 → OpenAI/Google 2025 → production 2026) — [Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol) / [2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
  - Be fair to competitors (it reads as credible, not defensive). Two claims were
    *refuted* in research — do NOT write them: that browser-driving is
    "architecturally inferior" to backend integration, and that DevTools-MCP-vs-Playwright
    is cleanly "observe vs act".
- **Real scenario (verified).** Mine **Morphix** (personal, nameable) frontend
  code under `/Users/admin/www/morphix/apps/morphicai-web`, or anonymize a
  **Tanka** scenario (`/Users/admin/www/tanka-2b-web_memo/` etc. — genericize, no
  names/packages). **Every code detail you cite must be verified real** (open the
  file, confirm the symbol/line). Never invent code, and don't trust a research
  agent's *causal* claim about a bug without re-reading the code yourself.
- Verify harness-fe tool names against the installed skill
  (`~/.claude/skills/harness-fe/SKILL.md`) and `packages/agent-skill/skill/SKILL.md` —
  tool names use underscores (`network_tail`, `storage_tail`, `session_replay_create`,
  `project_where_is`, `page_click`, etc.). Never cite a tool that doesn't exist.

## 3. COMPLIANCE — hard red lines (must pass before writing)

- **Tanka is a COMPANY project.** NEVER put real Tanka bugs/code/architecture/
  package names (`@tanka/*`) or internal GitLab details into the public blog.
  If a Tanka-derived scenario is useful, **anonymize it into a generic case**
  (e.g. "an Electron multi-window SSO app") — unidentifiable, no name, no code.
  Violating this is RED-01/RED-10.
- **Morphix** (Morphicai org, user's personal project) **may be named** and its
  real scenarios used — but keep cited code truthful and at scenario level, don't
  over-expose private line-by-line implementation.
- No customer/user/employee/financial data. No secrets. When unsure, anonymize.

## 4. Write the post (bilingual)

- Create `packages/docs/blog/YYYY-MM-DD-<slug>.md` (EN) and
  `packages/docs/zh/blog/YYYY-MM-DD-<slug>.md` (ZH). Use today's date.
- Frontmatter (match the seed posts):
  ```yaml
  ---
  title: "<hook-y title>"
  description: "<one or two sentences, shareable>"
  date: YYYY-MM-DD
  author: harness-fe team
  ---
  ```
- Length: substantial (~700–1100 words), structured with `##` sections. Lead with
  the hook/problem, show the concrete contrast, end with a `## Try it`
  (`npx @harness-fe/skill install`) + links to quickstart + GitHub.
- ZH is a faithful, idiomatic translation — not machine-literal. Technical terms
  stay in English. Follow the user's global style (concise, no emoji).

## 5. Register + bookkeeping

- Add the new post (newest first) to **both** `packages/docs/blog/index.md` and
  `packages/docs/zh/blog/index.md`, with the one-line description blockquote.
- In `docs/blog-backlog.md`: flip the chosen topic's `Status` to `done` and add a
  row under `## Done` with date + link.

## 6. Verify + ship

- `cd packages/docs && pnpm build` — must pass (catches dead links). Fix any.
- Commit on `main` with a `docs(blog): …` message (Co-Authored-By trailer), then
  **open a PR** (do not merge — the human merges). Use `gh pr create`.
  If the user prefers a direct push for a tiny change, ask first.
- Report: the title, the two file paths, the backlog topic consumed, and the PR URL.

## Notes

- Cadence is **one per week**. If run more often, that's fine — just consume the
  next backlog topic.
- The north star and persona live in the global CLAUDE.md "使命与人设" section and
  the `project_evangelism_mission` memory — re-read if you need the voice.
