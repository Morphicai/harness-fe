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

## 2. Research for substance (this is what makes it good, not generic)

- A great post is built on a **real, specific scenario** with real commands and
  an honest DevTools-vs-harness-fe contrast — like the two seed posts
  (`blog/2026-06-12-what-is-a-harness.md`, `blog/2026-06-13-streaming-agent-reconnect-bug.md`).
- You may mine **Morphix** (the user's personal project, nameable) for real
  scenarios — read its frontend code under `/Users/admin/www/morphix/apps/morphicai-web`
  if relevant. **Every code detail you cite must be verified real** (open the file,
  confirm the symbol/line). Never invent code.
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
