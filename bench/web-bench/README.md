# Web-Bench paired development pilot

Owner: harness-fe. Status: React pair completed; fullstack comparison paused after
Kimi's quota failure in DevTools stage 20, with Harness-FE unstarted.
Actual results and evaluator limitations are in [pilot observations](pilot-observations.md).
This is the first adapter for the
[frozen five-dataset comparison](../lab/README.md).

## Experiment

The first batch uses the already selected `react` and `fastify-react` projects at
Web-Bench `7b31ca2b786eef120dd49ce63dd03d0c0006046d`. Each is its complete 20-task
chain, starting from upstream `src-init`. Two tools conditions and one initial
repeat mean **four project attempts and 80 sequential development steps**.
React runs Harness-FE first; fastify-react runs DevTools first. Results across
steps within a project are correlated and are not independent samples.

Claude Code is the Agent with model `k3`; the exact observed CLI identity is
frozen in the plan. Native host tools and skills are disabled. Both conditions
receive the same container-scoped file/list/command/restart tools and neutral
development instructions, plus the respective normal browser MCP catalog.
Every step receives its current and previous requirements and the previous
model-written source. There is no hidden-test feedback or reference-code repair
between steps. The maximum is 40 model turns and 480 seconds per step; these are
not a claim that tool requests equal turns. Returned tool results are independently
audited; the frozen broker does not separately enumerate transport exceptions that
occur before a result is recorded.

Harness-FE uses CLI/plugin 4.5.3 and runtime 4.5.2 (unchanged in that release).
Its Vite plugin provides source attributes and runtime capture. DevTools has
the same app, dependencies, browser and viewport without instrumentation.
Fastify development uses the Vite client and an API proxy; official grading
uses the original upstream build/start commands. Backend service logs remain
available through the common workspace command tool in both conditions.

## Isolation and grading

Runtime containers have no external network, Docker socket, credentials or host
checkout. Only their browser/service logs are mounted for evidence. Claude runs
on the controller through `mx-env run` with managed model authentication and an
explicit MCP configuration. The workspace tools execute inside the task container.

Reference implementations and upstream tests exist only in a separate verifier
image. Model source is exported as regular files, rejecting symlinks and path
escapes. After task N, a fresh verifier checks the official init/task-1..task-N
files unchanged. Its SQLite database and browser state are independent of the
development session. Positive reference and negative initial-template controls
must pass before a scored run can start.

The primary score is the fraction of sequential stages whose cumulative tests
all pass. Current-task-only passes, raw case counts and full Playwright reports
are retained separately. This is a custom Agent adapter using upstream tests,
not a submission to the published Web-Bench leaderboard. CLI cost is an estimate,
not a provider invoice; missing cost is unknown.

Grading uses the original upstream CI retry setting (two retries of a failed
test against the same submitted code). Every flaky result and retry is retained;
Agent calls and their source changes are not replayed. Differences affected by
flaky cases must be reported separately from stable functional wins.
The verifier is fresh for each stage, but its backend database persists across
test retries within that stage. Inspect retry zero and subsequent results when
explaining a failure; retry errors can mask the original cause after a user or
order has already been created.

## Commands

From the harness-fe checkout, install its pinned pnpm dependencies first. Clone
the upstream repository into the ignored `vendor/web-bench` directory, check out
the pinned revision, and include `projects/react`, `projects/fastify-react` and
`libraries/test-util`, `libraries/shop-test-util` (a full checkout also works).

```bash
# Released-source lab; create a new image/context rather than editing old runs
node bench/lab/lab.mjs prepare
node bench/lab/lab.mjs build
node bench/lab/lab.mjs doctor
node bench/lab/lab.mjs smoke
mx-env run -- node bench/lab/lab.mjs agent-smoke

# Build isolated dataset images and verify upstream controls
node bench/web-bench/run.mjs prepare
node bench/web-bench/run.mjs build
node bench/web-bench/run.mjs preflight
node bench/web-bench/run.mjs browser-preflight
mx-env run -- node bench/web-bench/run.mjs agent-preflight

# Freeze once; run and resume using that same plan/adapter/images
node bench/web-bench/run.mjs plan
mx-env run -- node bench/web-bench/run.mjs run --run /path/to/new-run
node bench/web-bench/run.mjs report --run /path/to/new-run
```

When an already accepted lab image is available locally, `lab.mjs build
--reuse-image IMAGE` preserves its installed browser/evaluators and replaces only
the packaged product/driver. The exact prior image ID and architecture are recorded
in the new source receipt; this is not an amd64 Air build. A clean machine can use
the normal Dockerfile with its pinned multiarchitecture base images.

Dataset dependencies have a committed npm lock. `--legacy-peer-deps` matches the
upstream's non-strict peer resolution: its unused React Router dev package declares
Vite 5/6 while the project requests Vite 7. Installation scripts stay disabled;
only SQLite is compiled explicitly with the pinned Node headers and the existing
setuptools-compatible Python environment. The dataset installs the Chromium matching
its upstream Playwright 1.57.0, for both the Agent and verifier.

## Evidence and continuation

`jobs/` stores per-attempt `chain.json`, per-step prompts/model receipts/source
snapshots/Playwright output, MCP catalogs, tool logs, native images and independent
browser HARs. The plan freezes image IDs, source/adapter hashes, initial templates,
upstream tasks and verifier controls. Changed code or dependencies require a new
plan/run. Completed attempts are skipped; failures and interruptions are retained
and require inspection plus explicit recovery. A repeated run is not an invisible
second attempt at a failed model call.

## Preflight findings

- The standalone 4.5.3 lab passed both real browser conditions: click/UI change,
  unique console and network evidence, and native PNG delivery. Kimi k3 connectivity
  and the new Agent CLI option combination also passed actual calls.
- The first reference run mixed Playwright 1.57 with the lab's newer Chromium.
  React passed 58/59, with `MorningNight` observed after a fill expected to replace
  `Morning`. Matching the browser to upstream Playwright produced 59/59, but
  a subsequent run reproduced the same edit failure. Thus browser alignment alone
  did not eliminate this prefill/fill timing race. Fastify-react passed 91/91.
  Original runs are retained; final grading restores the upstream CI retry policy
  and records flaky cases rather than claiming a stable reference fix.
- Browser preflight caught a missing explicitly installed runtime dependency.
  Startup now also requires the runtime's connection to be open. Matching final
  image controls must be rerun before paid scoring.

Air deployment, the other eight Web-Bench projects, additional repeats and the
remaining four dataset adapters have separate acceptance; this pilot does not
claim that those evaluations already ran.

The user deferred model switching after this quota failure. Resuming with another
model requires new model acceptance and a new paired plan/run; keep the Kimi
results and incomplete coverage separate. Do not resume a Kimi-frozen run with a
different model or declare its missing Harness-FE condition a loss.
