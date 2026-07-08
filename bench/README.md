# harness-bench

Evaluates whether Claude Code fixes frontend bugs faster/more accurately with
**harness-fe** vs **Chrome DevTools MCP** vs **no MCP tools at all** — the
comparison design is in
[`../docs/design/harness-bench-analysis.md`](../docs/design/harness-bench-analysis.md)
and the technical plan this code implements is in
[`../docs/design/harness-bench-tech-design.md`](../docs/design/harness-bench-tech-design.md).
Read those first — this README only covers how to run what's here.

## ⚠️ Money gate — read before running anything without `HARNESS_BENCH_STUB=1`

Any invocation that doesn't set `HARNESS_BENCH_STUB=1` calls the real
`claude -p` CLI, which spends real Anthropic API usage on whatever account is
configured. **Do not run a real (non-stub) eval without first confirming
budget and account with the project owner** — this is a hard rule from the
project's CLAUDE.md financial guardrail, not a suggestion. Every command
below defaults to stub mode for exactly this reason.

## Layout

```
bench/
  bench/            Python package: dataset.py, runner.py, task.py
  fixtures/         one dir per bug: bug.patch + metadata.json + oracle.mjs
  fixtures/_lib/     shared Playwright oracle helper (browserOracle.mjs)
  fixtures/BUG_WORKLIST.md   what's authored vs. still needed
  mcp_configs/      one .mcp.json template per condition (A/B/C)
  prewarm/          Condition-A-only browser prewarm (harness_prewarm.mjs)
  docker/Dockerfile shared image, one per condition just swaps .mcp.json
  stub_fixtures/    canned stream-json transcripts for HARNESS_BENCH_STUB=1
```

`bench/runner.py` holds all the real orchestration logic (checkout → patch →
mcp config → dev server → prewarm → claude invocation → oracle → metrics) as
plain, framework-independent Python. `bench/task.py` is a thin adapter that
wires that logic into Inspect AI's `Task`/`Sample`/`solver`/`scorer` shapes —
if a future `inspect-ai` version changes those decorators' signatures, only
`task.py` should need to change.

## Setup

```bash
cd packages/harness-fe/bench
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

cd prewarm && npm install && npx playwright install --with-deps chromium && cd ..
```

Each bug's target demo app (`examples/react-demo` today) also needs its own
`pnpm install` once, since `runner.py` copies it into an isolated checkout
per sample rather than reusing a shared `node_modules`:

```bash
cd ../examples/react-demo && pnpm install
```

## Run the free self-check (no real Claude Code calls)

```bash
cd packages/harness-fe/bench
HARNESS_BENCH_STUB=1 inspect eval bench/task.py
inspect view   # opens the eval log — inspect each sample's metadata/score
```

What this validates, without spending anything:
- the dataset loads (`bench/fixtures/*/*/metadata.json`) and expands into
  3 samples per bug (harness-fe / chrome-devtools-mcp / none)
- each sample gets an isolated checkout with `bug.patch` applied correctly
- the dev server boots and (for the `harness-fe` condition) the browser
  prewarm script connects the runtime SDK before the "agent" step
- the oracle script runs against the checkout and reports a verdict
- metrics extraction (steps, cost, first-location precision) runs against a
  canned transcript without errors

**Expected stub result: every sample reports `fixed=False`.** Stub mode
skips the real model call entirely, so no code ever actually gets edited —
the checkout stays in its "bug injected" state and the oracle correctly
reports failure. That's the self-check passing, not a bug in the harness:
stub mode proves the *plumbing* works, not that any fix happened.

## Run for real (after explicit budget confirmation only)

```bash
cd packages/harness-fe/bench
inspect eval bench/task.py
```

This runs `claude -p` once per (bug × condition) — 5 fixtures × 3 conditions
= 15 real calls today, scaling to 45–60 once the full 15–20-bug dataset from
`fixtures/BUG_WORKLIST.md` is authored.

**Status: validated for real on 2026-07-08** with a 3-condition smoke test on
`easy-counter-increment-crash` (budget approved by project owner). All three
conditions fixed the bug (expected — this tier is designed to be a wash).
That first real run also caught two bugs stub mode couldn't have caught,
both now fixed:
- `invoke_claude()` was missing `--verbose`, which the CLI requires whenever
  `--print` is combined with `--output-format stream-json` — every real call
  was exiting immediately with a CLI validation error before ever reaching
  the model. `run_sample()` also wasn't checking `claude -p`'s exit code, so
  the failure was silently recorded as "agent didn't fix it" instead of
  surfacing as an infra error. Both are fixed: the flag is now passed, and a
  non-zero exit (or an empty event stream) now raises `SampleError` instead
  of being swallowed.
- `extract_metrics()`'s tool-call detection didn't match the real
  `stream-json` shape — tool calls are `type: "tool_use"` items inside
  `assistant` events' `message.content[]` array, not a top-level `tool_use`
  key. This made `steps_to_first_fix` and `precise_first_location` silently
  read as `0`/`None` on every real sample. Fixed and re-verified directly
  against a real transcript (`steps_to_first_fix=4`,
  `precise_first_location=True` on the same bug).

Real per-call cost observed so far: ~$0.19–$0.31, dominated by fixed
session-init overhead rather than task complexity — factor that into budget
estimates for the full 45–60-call run, not just "cost scales with bug
difficulty".

**Full 12-sample real run completed 2026-07-08 — result: 12/12 fixed, ~$3.27
total, but zero differentiation between conditions.** Every bug (including
the `hard` race-condition tier that was designed to favor harness-fe's
cross-reload `session.tail`) was fixed by all three conditions —
`harness-fe`, `chrome-devtools-mcp`, and `none` — in a similar number of
steps (3–5) with `precise_first_location=True` across the board, including
the **`none` condition, which has no browser access at all**.

This is a real, useful negative result, not a broken run: it confirms the
risk `harness-bench-tech-design.md`'s own "Risks and known limitations"
section already flagged — the three example demo apps are small,
single-purpose, and their bugs are locatable by a strong model reading
source code alone (e.g. the race-condition bug is a well-known "missing
request-id guard" pattern; the `problem_statement`'s plain-English
description plus a small file tree is enough to find it without ever
running the app). **The current fixture set cannot show harness-fe's value
proposition, because none of the bugs actually require runtime signals to
diagnose.** Scaling to more bugs on the same three demo apps will not fix
this — the fixtures themselves need to force a real repro step (state that
provably cannot be inferred from a static read: e.g. a value that's only
wrong after a specific interaction sequence and reads correctly in the
source, or a DOM/CSS state that depends on runtime-computed values).
Redesigning the fixture strategy is next before authoring more bugs on
`vue-demo`/`iframe-demo` in the same style.

**New design principle (applied starting 2026-07-09):** a bug fixture is only
useful for this benchmark if it's *not* decidable with confidence from a
static read — not "sounds more complex," but "a static reader has no way to
be sure a proposed fix is correct without rendering/measuring." The first
fixture built on this principle is `medium-styles-badge-vertical-misalign`:
two individually-valid CSS values (`alignItems: 'flex-end'` + an enlarged
`padding`) that only combine into a visible ~13px misalignment when actually
rendered (verified empirically — HEAD measures ~0px, the bug measures
~13px, via `boundingBox()`, not eyeballed). Not yet run for real — see
`fixtures/BUG_WORKLIST.md` for the rationale and what still needs the same
treatment (especially the `hard`-tier race condition, which was the biggest
"should have differentiated but didn't" surprise from the first real run).

This benchmark holds concurrency at 1 (one `claude -p` call at a time, no
parallel sub-agents) — it isolates MCP tool configuration as the only
variable. It does not measure multi-agent parallelism, which is a different
axis some other browser-MCP comparisons report on; don't read speed numbers
here as a parallelism claim.

## Adding a new bug

See the process at the bottom of
[`fixtures/BUG_WORKLIST.md`](./fixtures/BUG_WORKLIST.md) — in short: read the
target file in full before writing a patch, verify the patch applies cleanly
with `patch -p1 --dry-run` against a fresh copy before committing it, write
the oracle using `fixtures/_lib/browserOracle.mjs`'s `withApp()` helper, and
keep `problem_statement` in plain user language — never spell out which route/
button to use, or the bench stops measuring what it's supposed to measure
(see tech-design §3.3).

## Known simplifications (not hidden, see also the design docs' own risk sections)

- `runner._make_installable()` rewrites `workspace:*` deps to `latest` before
  install, since a standalone sandbox checkout has no pnpm workspace to
  resolve against — this means the bench always tests against the latest
  *published* harness-fe packages, not necessarily whatever the monorepo's
  HEAD has locally. Fine for now; would need pinning before trusting
  run-to-run comparisons over time.
- `chrome-devtools-mcp.mcp.json.tmpl`'s `--headless --isolated` flags were
  re-checked against `npx chrome-devtools-mcp@latest --help` on 2026-07-08
  (current published version at that point) and still exist as documented —
  re-check again before a large real run if much time has passed, since MCP
  server CLIs are young and their flags move.
- Only 5 of the target 15–20 bugs are authored, all in `react-demo` (3
  `category: logic`, 2 `category: ui`) — see `fixtures/BUG_WORKLIST.md` for
  the gap (notably: no `vue-demo`/`iframe-demo` coverage yet, and the `ui`
  category so far only has `medium`-tier entries).
- `extract_metrics()`'s step-counting and first-location-precision heuristics
  were validated against a real transcript on 2026-07-08 and fixed (see
  "Run for real" above) — no longer an open risk for the `easy` tier bug it
  was checked against, but worth spot-checking again once `medium`/`hard`
  tier real transcripts exist, since those prompts may produce different
  tool-call shapes (e.g. multi-file edits, browser tool calls interleaved).
