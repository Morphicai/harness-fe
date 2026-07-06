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

This runs `claude -p` once per (bug × condition) — 3 fixtures × 3 conditions
= 9 real calls today, scaling to 45–60 once the full 15–20-bug dataset from
`fixtures/BUG_WORKLIST.md` is authored.

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
- `chrome-devtools-mcp.mcp.json.tmpl`'s CLI flags were checked against the
  package at the time of the tech-design research pass — verify them against
  whatever version `npx` resolves to before a real run; MCP server CLIs are
  young and their flags move.
- Only 3 of the target 15–20 bugs are authored, all in `react-demo`, all
  `category: logic` — see `fixtures/BUG_WORKLIST.md` for the gap (notably:
  zero `category: ui` bugs yet, which the tech design explicitly warns
  against shipping with).
- `extract_metrics()`'s step-counting and first-location-precision heuristics
  parse `stream-json` events with a fairly permissive shape match — worth
  validating against a handful of *real* (paid) transcripts once budget is
  approved, before trusting the numbers at scale.
