# Runtime diagnostics pilot

This suite measures whether an agent can combine **past process evidence** with
the current rendered state to diagnose an incident. It is a self-authored,
three-case compatibility pilot, separate from WebArena-Verified, code repair
fixtures, and Harbor jobs. Success does not mean a bug was fixed or establish
general superiority over another tool suite.

The scope and conditions are frozen in [manifest.json](./manifest.json): Kimi
`k3`, Harness-FE versus Chrome DevTools MCP, one attempt per case/condition,
30 tool calls and 360 seconds maximum. There are six real model attempts.

## Cases and private ground truth

| Case | Actual incident | Evidence needed |
| --- | --- | --- |
| `export-stale-error` | First export request gets 503, retry gets 200 and an artifact, but the old error callback leaves the page showing failure | Recovery request ID/status plus screenshot of the retained error |
| `stream-cross-talk` | Reply A is still streaming when the UI switches to B; A's delayed delta is written into B's content | Stream request/thread/active-view sequence plus screenshot of mixed content |
| `cross-tab-session` | Preferences refresh succeeds, then its cache cleanup removes a shared localStorage key; Overview reacts by displaying a sign-out state | Initiating tab, operation ID, storage key and receiver event plus Overview screenshot |

Each paired condition gets identical generated scenario identifiers and an
incident code. Those values are written to the trusted runner's oracle file
before model execution. The model sees the user's symptom, target tab IDs and
output schema, never the oracle or application source.

The strict scorer checks the root-cause category, decisive random request or
operation ID, current incident code/status and (for the cross-tab case) sender
tab/storage key. It additionally verifies that a log tool actually returned
the decisive ID and a native image was returned during the investigation.
Correct, wrong-ID and no-evidence controls are checked without a model.

The incident code is also present in the rendered DOM. Requiring an image
return is an evidence-consumption check, **not an isolated test of vision**.
Free-text causal explanations are retained for review, not graded by an LLM.
No source edits or repair-success claims are part of these tasks.

## Fair observation lifecycle

1. Run the site locally; create fresh browser state for each condition.
2. Inject Harness-FE into the instrumented condition, or attach DevTools to the
   baseline browser. Enable baseline console/network collection on **all** tabs.
3. Trigger the fault with trusted Playwright UI actions only after the observer
   is connected. The model starts after the fault settles. Current symptoms
   remain visible, but the request/event sequence is historical.
4. Keep the same underlying observer MCP client alive. A protocol-only local
   broker forwards the original tool schemas, calls and result blocks. The
   model's stdio MCP connects to that broker. This avoids restarting the
   baseline and accidentally erasing its earlier collection history.
5. Both models get only read/inspection tools; no JS evaluation, navigation,
   replay of the workflow, source/file reads or benchmark-internal access.
   Tool catalogs differ naturally; Harness-FE can use storage/session/visitor
   tools and DevTools can inspect each page's console/network records.
6. Record independent HAR, a trusted screenshot, tool requests/results and native
   images. Grade the model's structured response against the private oracle.

The app console emits generic phase/request/thread/active-view and storage
operation records. These make the relevant event sequence observable in both
conditions; they do not contain a `root_cause` answer field. This suite therefore
does not require the model to discover an unlogged event. It cannot by itself
prove that Harness-FE's automatic storage capture is uniquely necessary.

The browser runtime is bundled from the local workspace and deferred until
load/idle (`deferStart: true`). An initial eager-injection preflight stalled
before connecting a runtime; the successful configuration is recorded as part
of the experiment, without claiming a diagnosed product root cause.

## Run

Prerequisites: built local CLI/runtime, installed Chrome DevTools MCP, and an
installed compatible Playwright Chromium. This runner creates its own gateway
and temporary browser profiles; it does not restart the user's shared gateway.

```bash
# From the harness-fe repository root
pnpm --filter @harness-fe/cli... --filter @harness-fe/runtime... build

# No API calls: check all six environments, evidence, image delivery and scorer
mx-env run -- node bench/runtime-diagnostics/run.mjs --preflight

# Six real model diagnoses; uses managed Claude Code credentials
mx-env run -- node bench/runtime-diagnostics/run.mjs --run
```

If necessary, append `--chromium /path/to/compatible/chromium` to either command.
Processes receive credentials through `mx-env`; no user credential files are
read by this runner. Artifacts are stored in the ignored `jobs/<run>/` directory.
Preflight exercises the same stdio -> HTTP broker -> upstream MCP session path
used by model execution. The manifest, runtime/gateway hashes, browser version
and per-trial results are saved in `report.json`.

Generate the per-condition summary after a completed real run:

```bash
node bench/runtime-diagnostics/summarize.mjs bench/runtime-diagnostics/jobs/<run>
```

## Completed pilot — 2026-10-21

All six real Kimi `k3` diagnoses finished in
`jobs/pilot-1792568243994/`; the matching six-environment preflight passed in
`jobs/preflight-1792568190539/`. Each real attempt returned one native image and
read logs containing the decisive ID. There were no tool errors, timeouts or
call-limit terminations. Each case has one attempt per condition.

| Condition | Correct root cause | Correct decisive ID / incident code | Strict passes | Mean calls | Mean seconds | Mean CLI-estimated USD |
| --- | --- | --- | --- | --- | --- | --- |
| Harness-FE | 3/3 | 3/3 / 3/3 | 1/3 | 5.3 | 37.5 | 0.078 |
| Chrome DevTools MCP | 3/3 | 3/3 / 3/3 | 1/3 | 4.0 | 37.3 | 0.060 |

The six attempts cost **$0.4154 total according to the CLI**, not a provider
invoice. Both conditions found all three causes. Harness-FE used more tool
calls and had a higher estimated cost; this run establishes no comparative
diagnostic-accuracy advantage.

| Case | Diagnosis in both conditions | Harness-FE calls | DevTools calls |
| --- | --- | --- | --- |
| Export retry | Recovery succeeded; an obsolete failure callback overwrote the displayed result | 5 | 3 |
| Streaming conversation | A's late stream delta was written into active conversation B | 5 | 4 |
| Cross-tab session | Preferences cache cleanup removed a shared storage key; Overview reacted by signing out | 6 | 5 |

The strongest concrete Harness-FE evidence was the cross-tab case. The agent
used `storage.tail`, `network.tail`, each tab's `console.tail` and an Overview
screenshot. Its diagnosis linked a successful Preferences HTTP 200 to the
automatically captured `cleanupPreferencesCache (app.js:54)` initiator stack,
the localStorage removal, Overview's receiving event and the visible
`Session ended` state. This demonstrates useful automatic storage attribution
combined with a screenshot. DevTools also diagnosed the cause from the app's
console records, so automatic attribution was not necessary for success here.

All four strict failures were confined to `visible_state`. The scorer required
an exact heading while the prompt asked for the "exact main page status text"
without identifying its element:

| Attempt | Expected exact text | Reported text |
| --- | --- | --- |
| Export / Harness-FE | `Export unavailable` | `Export unavailable` plus the explanatory error sentence |
| Stream / both conditions | `Conversation B` | `Your current conversation reply. [Earlier conversation fragment]` |
| Cross-tab / DevTools | `Session ended` | `Session ended` plus `Please sign in again.` |

Root categories, decisive IDs, incident codes and evidence-access checks all
passed in these attempts. The original strict grades remain unchanged; the
table separates diagnostic correctness from this status-region ambiguity.
A future version should specify the status element or an enumerated state
before execution, rather than changing acceptance rules after seeing answers.

The completed artifacts include `report.json`, `summary.json`, `results.md`
and per-attempt tool audits, model streams, HAR and trusted screenshots under
the run directory. Generated evidence is local and ignored by Git; this README
preserves the results for repository readers.

For a stronger comparison, use incidents spanning navigation/reconnection,
reduce custom app console diagnostics, and include a condition without process
history. This run exposed session/visitor tools but did not establish their
persistence advantage. The current cases confirm that logs and native images
reach the agent; they do not establish that either is independently necessary.

## Interpretation

Report diagnostic accuracy, evidence checks, native images, tool errors,
tool calls, model-run duration and CLI-estimated cost separately. Neither more
logs nor more screenshots automatically count as better work. One sample per
case cannot distinguish systematic tool benefits from model variability.

The scope intentionally includes extra instrumentation and historical evidence
that ordinary code-reading tasks lack. An advantage here would be an advantage
for this instrumented diagnostic workflow, not a universal coding-agent score.

Related evidence: [native-image delivery release](https://github.com/Morphicai/harness-fe/releases/tag/v4.5.3),
[public UI operation pilot](../webarena-verified/README.md).
