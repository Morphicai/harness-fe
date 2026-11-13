# Design

## Context

The existing lab freezes 50 units, images and paired results. Its adapter contract requires official verifier evidence but has only a controlled browser smoke. Web-Bench revision `7b31ca2b786eef120dd49ce63dd03d0c0006046d` provides `src-init` templates, complete reference `src`, and cumulative Playwright tests. The released product source is 4.5.3; model connectivity has passed with Claude Code 2.1.301 and Kimi k3.

## Goals / Non-Goals

Execute two full project chains in both conditions. Preserve all 20 sequential requirements, model-written state and per-step grading. This is an integration pilot, not a ranking over all ten projects or an Air acceptance.

## Decisions

1. **Use an isolated worktree based on the released main source.** Import the validated portable lab with file hashes; retain the old image/context/runs. Freeze a new image and plan. Rebuilding the dirty benchmark branch would retain the old package version and mix product changes into the experiment.
2. **Use separate agent and verifier containers.** Agent containers contain initial templates, development dependencies, browser and tools; verifier containers alone contain upstream tests and reference implementations. Runtime containers have no external network, host checkout, credentials or Docker socket. Host Claude Code receives only container-scoped workspace tools plus the selected browser MCP tools. Native host file/shell tools are disabled. Prompt-only protection of hidden tests in an otherwise accessible host checkout was rejected.
3. **Consume upstream cumulative test bodies unchanged.** Reference implementations validate positive controls; initial templates validate negative controls. After task N, copy model source into a fresh verifier and run init plus tasks 1..N. Save raw results and source hashes. A failing reference control blocks paid scoring; do not weaken expectations or silently exclude cases.
4. **Use identical development services, with the Harness-FE Vite plugin enabled only in its condition.** React uses Vite; fastify-react uses a Vite client proxying its Fastify API so browser debugging remains a development workflow. Official grading uses the upstream startup semantics in a separate environment. Validate the reference with both entrypoints before comparing agents. Runtime-only injection would miss the source-mapping benefit being evaluated.
5. **Run one complete chain at a time, one initial repeat.** Alternate condition order between projects. Each task has the same prompt allowance and timeout in both conditions. No grading feedback or reference code is returned to the model. Additional repeats and the other frozen projects use new explicit batches.

Decision-autonomy review (owner-local record; implementation documentation stays in harness-fe): feasibility is supported by the existing Docker/MCP broker and pinned `src-init`/test controls; impact is limited to benchmark tooling and new run/image identities; isolation and grading remain dataset-owned; container workspace commands and cumulative step records are reusable by later development adapters. New evidence excluded completed `src` as an Agent starting point and identified Fastify's build-only default startup. Browser/service equivalence and native SQLite installation must pass actual preflight, not be assumed.

## Risks / Trade-offs

- Full chains are long and correlated: report per-project and per-step outcomes, cost and incomplete coverage; do not treat 80 steps as 80 independent samples.
- Modern browser/dependency drift: pin actual package locks, browser/image IDs and upstream test hashes; preserve failed controls.
- Fastify development versus grading startup: validate both against the same reference and keep official grading separate.
- API/provider failure: record the original failed/interrupted attempt and require explicit recovery; never silently bill and replay.
- Official reference failure: retain evidence and distinguish evaluator/environment compatibility from Agent failure before proceeding.

## Rollout

Build and accept the new lab, package dataset images, pass controls, freeze the four-attempt plan, then execute and report the paired pilot. Keep old contexts and scores unchanged. Air deployment and the remaining four adapters remain later acceptance scopes.

## Development-policy acceptance correction

An extra reference control observed 90/91 on fullstack development startup because Vite bypassed backend document authorization, while the original verifier passed 91/91. The correction forwards actual backend document policy, not task-specific expected answers. Both corrected development conditions subsequently passed 91/91. The original React worktree/images remain frozen; the corrected fullstack pair uses its own plan/images before its model outcomes, preserving selection and Chrome-first order. See `bench/web-bench/fullstack-policy-note.md` for the replay and operator boundary.
