# Portable benchmark lab

Owner: harness-fe. This is the shared execution environment and batch bookkeeping
for the [five-dataset comparison](../../docs/research/agent-tool-benchmark-shortlist-2026-10-21.md).
Dataset business environments and official model/evaluation adapters need their
own preflight before a public comparison. Environment smoke is never a public score.

The first development adapter is the [Web-Bench paired pilot](../web-bench/README.md).
Its released-source worktree pins CLI/plugin 4.5.3; completed earlier acceptance
below remains a historical record of the prior image.

## Environment

`environment.json` pins Node/Python base-image digests, MCP/browser dependencies,
the Kimi `k3` model and official Harbor/SWE-bench/WebArena evaluator versions.
Evaluator Python environments are isolated to avoid dependency conflicts.
Harbor/SWE-bench Docker execution additionally needs Docker access in the trusted
controller. Installing their CLIs here does not grant the browser container a Docker
socket or prove that their dataset grading environments have passed preflight.
The browser image contains the current local built Harness-FE CLI and a bundled
runtime, with file hashes and a source receipt. It does not require a package release.

The model CLI runs on the execution host with its managed authentication, through
`mx-env run`. The image and export bundle contain no account directories or user
credentials. There is no Docker socket or HOME mount. Dataset-specific images,
API/database services and provider entitlements remain separate prerequisites.

From the repository root:

```bash
node bench/lab/lab.mjs prepare
node bench/lab/lab.mjs build
node bench/lab/lab.mjs doctor
node bench/lab/lab.mjs smoke

# Optional real paid model connectivity check, using host-managed authentication
mx-env run -- node bench/lab/lab.mjs agent-smoke
```

`build --reuse-image IMAGE` can derive a new product image from an accepted local
browser/evaluator image. The immutable prior image ID and architecture enter its
receipt/hash. This preserves installed dependencies when registry downloads fail;
normal clean builds remain available and Air must use its native architecture.

The smoke creates an isolated page and fresh browser state for each condition.
It clicks through MCP, verifies the visible change, reads the unique console and
network records and verifies a native PNG image block. HAR, images, tool records
and per-attempt results are saved under `jobs/`. The user's shared gateway is unused.

`prepare` builds and deploys from this checkout, restores the generated runtime
version source and rejects credential filenames, native module files and symlinks
escaping the build context. pnpm 9's root-package self-link is rebound to the deployed
root. Use a new preparation after changing the runtime/gateway source or tool lock.
Direct versions and npm transitive dependencies are pinned; installed Python
transitive dependencies are captured by the built image. Record the immutable image
ID for each experiment; rebuilding later is a new environment, not assumed identical.

## Frozen public samples

```bash
# Requires the built image for reading the fixed SWE-bench Parquet source
node bench/lab/freeze-samples.mjs
node bench/lab/lab.mjs plan --repeats 3 --batch-size 2

# Freeze a separate plan/run for just one dataset when its adapter is ready
node bench/lab/lab.mjs plan --suite web-bench --repeats 1 --out /path/to/web-bench-plan.json
```

`samples.json` records ten units for each of the five datasets, source revisions,
download hashes and deterministic selection rules. It contains public instructions
and references, not golden patches or evaluator answers. Trusted raw sources stay
in ignored `.cache/sources`. Regeneration refuses to overwrite a frozen manifest
without `--refresh`; review and version any deliberate replacement.

**Web-Bench's ten units are complete project chains**, five frontend and five
integration-oriented projects, with twenty dependent tasks each. Thus the selection
has 50 top-level units but 200 Web-Bench development steps. It is not 50 equal-length
tasks. SWE issues, full applications and browser operations retain their different
units. Report each capability/dataset separately and account for project correlation.

The new WebArena selection excludes all six earlier pilot task IDs. The SWE selection
excludes Lighthouse auditing, ESLint and Prettier CLI repositories from
this frontend runtime comparison. An initial metadata-only selection included CLI
tasks; it was revised before any dataset model evaluation and retained in ignored
sample history. The current eight browser-library pool still needs live repro checks.
All selections
are frozen before model outcomes; a selected task may still fail environmental
preflight. Keep exclusions and new manifest versions explicit.

## Batches, continuation and reports

By default the plan has 300 attempts: 50 units × two conditions × three repeats.
Each batch selects two units per suite and includes both conditions, with alternating
condition order. Execution is single-concurrency. A Web-Bench unit runs its entire
chain; don't drop prerequisite steps to shorten an attempt.

```bash
# Adapter must implement and verify the selected datasets, as described below
mx-env run -- node bench/lab/lab.mjs run --adapter /path/to/reviewed-adapter.mjs --batch 1 --run /path/to/run
node bench/lab/lab.mjs report --run /path/to/run

# Later batches use the SAME plan/run/adapter/image
mx-env run -- node bench/lab/lab.mjs run --adapter /path/to/reviewed-adapter.mjs --batch 2 --run /path/to/run
```

Repeating a completed batch skips existing results. Failed, running or interrupted
attempts are never silently replayed. Inspect the remote task/container and original
artifacts first; use `--retry-interrupted` to create a new numbered attempt. A live
run lock prevents concurrent writers. Stale lock recovery requires a dead owner on
the same host; a different host requires inspecting the original execution.
Image, plan, sample, model or adapter changes require a new run directory. The
observed host Claude CLI version is frozen in the plan and checked on execution
and in each benchmark result; changing it also requires a new plan/run. The
report retains incomplete coverage and computes paired wins/ties/losses only for
complete pairs. Missing cost is tracked as unknown, not treated as a free model call.

### Trusted adapter contract

The adapter is an executable Node module supplied explicitly with `--adapter`.
It receives the absolute `job.json` path as its last argument and owns the task
checkout/browser lifecycle, model invocation, official verifier and resource cleanup.
It must use the requested condition/model, isolate hidden grading data from the
Agent, save evidence under `job.output`, and write `result.json` there:

```json
{
  "kind": "benchmark",
  "condition": "harness-fe",
  "model": "k3",
  "agentVersion": "the exact version frozen in the plan",
  "score": 0,
  "verifier": { "name": "official-verifier-name", "sourceHash": "64 lowercase hex characters" },
  "evidence": "official-evaluation.json"
}
```

`costUsd` is optional; if present, state its source in the evidence. The adapter
must trap termination and clean up resources it owns before exiting. Process-group
termination cannot alone prove that a detached container or remote task stopped.
These typed receipts enforce bookkeeping boundaries; they do not independently
prove that an arbitrary supplied adapter honestly executed its verifier. Review the
adapter and audit its saved evidence. There are no fake adapters claiming to grade
the five datasets; the existing [WebArena pilot](../webarena-verified/README.md)
remains a separate already-verified runner pending integration.
Frontend adapters must also declare their instrumentation mode. This base image
contains the browser runtime; build-plugin/source-attribute integration belongs
to the target application's setup and must be recorded before claiming its benefits.

## Air handoff

```bash
# Read-only host check; no restart, supplier switch or software installation
node bench/lab/lab.mjs doctor --ssh YOUR_SSH_ALIAS

# Toolkit + sanitized build context, not account data or a large multiarch image
node bench/lab/lab.mjs bundle
```

On the target, extract the generated archive, enter `benchmark-lab`, and run
`node lab.mjs build --platform linux/amd64`, `node lab.mjs doctor`, then
`node lab.mjs smoke`. Build against its native architecture. A model smoke additionally
requires an authenticated local CLI and morphix-env on that same execution host.

Air currently separates macOS Docker from the Linux Agent worker. Docker access,
workspace paths and MCP connectivity must be wired into the chosen executor before
the model drives this browser environment. Its Dagu templates are read-only; a
dedicated benchmark template must support edits, services, evidence and verification.
This change does not deploy that template or change the active supplier. Start Air
acceptance at concurrency one with explicit memory measurements and persistent task
IDs, then verify disconnection/continuation. A successful local build is not an Air
or 50-unit model evaluation result.

## Verification

`node --test bench/lab/*.test.mjs` checks frozen sample counts, paired batches, skip-on-resume,
interruption recovery, live locks, configuration drift and grading/credential boundaries.
Runtime acceptance results are recorded below after the real container checks.

### Acceptance — 2026-10-21

The following receipt is the earlier 4.5.2 environment; it is not reused as the
4.5.3 model-comparison image. The Web-Bench README records the new acceptance.

- Local Linux **arm64** image built successfully, immutable ID
  `sha256:75ea11a2aec219b3ea3add396f87a633b2aa30574c4d7c10d498df09b2abdce1`.
- Doctor passed: Node 22.23.3, Python 3.12.12, Chromium 151.0.7922.34,
  DevTools MCP 1.10.1; Harbor 0.24.0, SWE-bench 5.0.2 and WebArena-Verified 1.2.3
  installed and their CLI help commands all launched successfully.
- Real MCP/browser acceptance **2/2**: both conditions clicked, changed the visible
  count, returned the unique console/network evidence and a native PNG. The Harness-FE
  image was visually checked. Local run: `jobs/smoke-1792572866086/`.
- Reusing that run skipped both completed attempts; seven bookkeeping/sample tests
  passed. The first smoke failure was an incorrect selector argument in the lab
  driver, corrected to the documented object schema; original failure evidence
  remains in `jobs/smoke-1792572727063/`.
- Host-managed Kimi `k3` real connectivity smoke passed, with exact marker/model
  match; CLI estimate $0.016831. Receipt: `jobs/agent-smoke-1792572099460/result.json`.
- Source context hash:
  `1195ee11feb8d0bb0183c68136d08e4c4159e3fc19f3e5f60e352528cc39c18a`.
  The complete versions/file receipt is in ignored `.cache/doctor.json` and the
  build context; generated PNG/HAR/model artifacts are also ignored.
- The 9.74 MiB toolkit/build-context archive was extracted into a different
  directory; its seven tests and standalone one-suite plan generation passed
  without the source checkout. Receipt: `.cache/export-verification.json`.

The public 50-unit comparison has **not** run. Its selected records are frozen in
`samples.json`, with task-specific adapters and live-repro/official-verifier
acceptance still pending. Air's read-only SSH probe timed out during this build;
its amd64 build, browser/Agent wiring and durable editing template are not accepted.
No software was installed remotely and no supplier was switched.

### Readiness recheck — 2026-10-22

The private SSH host probe now succeeds: Intel macOS 12.7.6 has Node, Docker and
Claude on PATH, but no `mx-env`. A direct `air-task.py health` request also succeeds
with Dagu 2.18.2, the six existing templates and concurrency one. A separate worker
probe returns x86_64, Node 22.23.3 and Claude Code 2.1.291, with no Docker, `mx-env`,
Chromium, DevTools MCP or Harness CLI found on its PATH.

Trellis's cached upstream status still reports an Air connection timeout, so that
status alone does not establish that the queue is down. These are read-only
readiness checks, not a durable benchmark submission, a model/provider acceptance
or a deployed editing template. No remote software or provider settings changed.
