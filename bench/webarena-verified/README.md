# WebArena-Verified UI pilot

This is an experimental **browser-operation** comparison, separate from the
React bug-repair fixtures. It uses the official WebArena-Verified dataset,
Docker site and offline evaluator. It does not replace the evaluator with an
agent's success claim.

The first run is pinned by [manifest.json](./manifest.json): upstream commit
`6473f72db5dcefc97b5725b59e734504edc28a21`, Shopping Admin, Kimi `k3`, six tasks,
two MCP conditions, one attempt each (12 model runs). Task IDs were selected
before model execution: 157/374 navigation, 11/41 retrieval, 453/461 mutation.
This pilot establishes compatibility and gives per-task observations; it is
not a statistically powered ranking or a score on the full 812-task benchmark.

## Execution and boundaries

- Shopping Admin runs in an isolated Docker container. Each attempt recreates
  the container and initializes it with the official env-ctrl API. Only this
  runner's generated container and anonymous volumes are removed.
- Browser and Claude Code run on the host to use the locally fixed gateway;
  this initial integration is a standalone pilot, **not a Harbor job**. Keeping
  the site lifecycle, browser controller and official verifier separate permits
  later Harbor orchestration without changing the dataset or scoring.
- Both conditions use the same browser executable, viewport, fixture account,
  initial URL, CSP bypass and site reset. Browser requests are restricted to the
  benchmark site origin. The official fixture account is read by trusted setup
  from the upstream example configuration, not embedded in our source or prompts.
- Harness-FE injects its browser runtime on every document load using
  Playwright `addInitScript`. This is runtime-only integration on a third-party
  PHP app: source-location tools are not evaluated. The bundled runtime and
  local gateway hashes are recorded in the run report. A dedicated gateway is
  launched from the workspace on an ephemeral port with its own data directory.
- Chrome DevTools MCP attaches to the same kind of prelaunched Chromium context
  via CDP. Preflight checks the selected page and native screenshot delivery.
- Both agents get a UI-oriented tool subset. JavaScript execution, file/source
  access, direct API mutation, benchmark internals and database access are
  excluded. The native tool sets differ; each run records the visible catalog.
- Each agent has a 480-second wall-clock limit and at most 40 tool requests.
  Built-in Claude Code tools are disabled, and the model is explicitly `k3`.
- Playwright records the full HAR independently of the MCP being tested. The
  official Python evaluator scores that HAR and the agent's final JSON. Prompts
  include the official intent/start URLs and output type, never reference answers
  or expected request parameters.
- All model processes run through `mx-env run`; no user credential files or
  `.env` contents are inspected. Local HARs, browser profiles, model transcripts,
  fixture auth material and reports are kept out of Git.

## Setup

From the harness-fe repository root:

```bash
git clone https://github.com/ServiceNow/webarena-verified.git bench/webarena-verified/vendor/webarena-verified
git -C bench/webarena-verified/vendor/webarena-verified checkout 6473f72db5dcefc97b5725b59e734504edc28a21
uv venv --python 3.12 bench/webarena-verified/.venv
uv pip install --python bench/webarena-verified/.venv/bin/python pip
bench/webarena-verified/.venv/bin/python -m pip --isolated install --index-url https://pypi.org/simple -e bench/webarena-verified/vendor/webarena-verified
WEBARENA_IMAGE=$(node -p 'JSON.parse(require("node:fs").readFileSync("bench/webarena-verified/manifest.json")).image')
docker pull --platform linux/amd64 "$WEBARENA_IMAGE"
pnpm --filter @harness-fe/cli... --filter @harness-fe/runtime... build
```

The local gateway/CLI build must contain the native-image fix; the runner starts
its own instance. Chrome DevTools MCP must be installed. The initial run uses
version 1.10.1; each run records its executable's version and the Docker image
digest instead of assuming that `latest` stayed unchanged. Do not reuse an old
gateway or silently combine results from different versions.

The backend URL placeholder includes **`/admin`**, while Magento's public store
base URL passed to env-ctrl is only the site origin. Confusing the two sends an
agent to the storefront instead of the backend; preflight catches this before
paid execution.

## Run

```bash
# No model calls: six no-action controls, known-good UI navigation and both MCPs.
mx-env run -- node bench/webarena-verified/run.mjs --preflight

# Real model comparison (12 attempts).
mx-env run -- node bench/webarena-verified/run.mjs --run
```

If the installed Playwright revision is missing, pass
`--chromium /path/to/compatible/chromium` to either command. The accepted initial
preflight uses installed Google Chrome for Testing in headless mode
(the exact observed version is recorded per run). Chrome DevTools 1.10.1 requires
an explicit `pageId` on page tools, even when list_pages marks a page selected.

Run artifacts are in `jobs/<run>/`: a configuration/identity report, exported
agent inputs, per-trial transcript and final response, independently recorded
`network.har`, and official `eval_result.json`. The runner records results
incrementally, aborts on infrastructure/model drift, and removes only its own
site container at the end.

## Sources

- [Official project](https://github.com/ServiceNow/webarena-verified)
- [Official evaluator usage](https://servicenow.github.io/webarena-verified/getting_started/usage/)
- [Official Shopping Admin setup](https://github.com/ServiceNow/webarena-verified/blob/main/docs/environments/shopping_admin.md)
- [Native-image delivery release](https://github.com/Morphicai/harness-fe/releases/tag/v4.5.3)

## Results — 2026-10-21

All 12 model runs completed. Upstream evaluator version 1.2.3, Claude Code
2.1.301, Chrome DevTools MCP 1.10.1, Chrome for Testing 156.0.8078.4, model `k3`.
The actual agent catalogs contained 16 Harness-FE tools and 17 Chrome DevTools
tools; built-in tools were disabled. This experiment already reduced the broad
Harness-FE catalog, so its extra requests cannot simply be attributed to 63
advertised tools.

| Condition | Official passes | Mean tool calls | Mean model-run seconds | Mean CLI-recorded USD |
| --- | --- | --- | --- | --- |
| harness-fe | 5/6 | 10.5 | 70.9 | 0.217 |
| chrome-devtools-mcp | 6/6 | 7.8 | 66.5 | 0.228 |

Total CLI-recorded cost: **2.673918 USD** (an estimate, not a provider invoice).
Times exclude site reset/browser setup. Each task has only one attempt per
condition. The full pilot ran from 03:40:55 to 04:05:01 UTC.

| Task | Goal | harness-fe calls / official score | Chrome DevTools calls / official score |
| --- | --- | --- | --- |
| 157 | Customer list navigation | 6 / 1 | 4 / 1 |
| 374 | Theme settings navigation | 10 / 1 | 7 / 1 |
| 11 | Review keyword count | 18 / 1 | 5 / 1 |
| 41 | Most popular search term | 7 / 1 | 6 / 1 |
| 453 | Disable a product | 14 / 1 | 21 / 1 |
| 461 | Increase current product price | 8 / 0 | 4 / 1 |

### Task 461: official score versus recorded outcome

The official NetworkEventEvaluator requires POST `product[price]` to equal
the **string** `29.50`. Harness-FE submitted `29.5`; Chrome DevTools submitted
`29.50`. Both used the same product-save route, received HTTP 302, and the
subsequent HTML response for the same SKU contained price **29.50** and the
message “You saved the product.” The initial price was 18.00 in both trials.

Official scores remain **0 and 1**. The amount-equivalence observation is a
separate diagnostic, not an adjusted WebArena-Verified score. This case makes
the official result sensitive to decimal string formatting, beyond the stated
price-increase outcome. It should be reviewed before interpreting the one-task
gap as a browser-control capability difference. The original HARs and reference
dataset remain unchanged.

The task itself says: increase the current product's price by $11.5. It starts
on product 721 (Cassius Sparring Tank-M-Blue, SKU MT12-M-Blue), initially 18.00,
so the intended amount is 29.50. The task text does not explicitly require two
decimal places. Its NetworkEventEvaluator has no `post_data_schema`, and this
price field remains a string during comparison.

Reviewing the actual observation/action sequence explains a separate product
gap:

- Harness-FE's first `page_dom_query` returned the price input's outerHTML and
  generated id, but **no live value**. Its model then requested a 130×31 native
  PNG of that field (confirmed visually to show `18.00`) and called `page_type`
  with `value: "29.5"`. The tool returned that same value. This is a model input
  formatting choice, not the input tool stripping a zero.
- Chrome DevTools' first `take_snapshot` returned a labeled price textbox with
  `value="18.00"`, a stable uid for that snapshot, and the Save button. Its
  model used `fill` with `value: "29.50"`, clicked Save, then waited for the
  success message. It needed 4 tool calls versus Harness-FE's 8.
- Harness-FE's final screenshot still displayed `29.5`, while the saved-page
  HTML's product data contained `29.50` and a save-success message. The latter
  is the server-returned data evidence; it should not be described as proof
  that the agent's final rendered field displayed two decimals.

The directly observed score cause is decimal-string equality. Sparse form
observations are an actionable product limitation affecting efficiency, but
one sample does not establish that this limitation caused the model to choose
`29.5`. Both conditions used the same model; repeated runs are needed to
separate observation effects from model variability. A general fix should
expose live input value/label/type/checked/selected/disabled state and support
post-action inspection, not hardcode Magento or currency rounding inside
`page_type`.

Local evidence is in `jobs/pilot-1792554053003/`: `results.md`, `report.json`,
`price-format-diagnostic.json` (with source HAR hashes), and all twelve trial
directories. Jobs are local ignored evidence, not prerequisites for cloning.
The accepted preflight is `jobs/preflight-1792553920777/report.json`: six no-action
failures, known-good customer-list navigation passing, and native screenshot
delivery verified for both MCPs. The dedicated site and benchmark gateway were
stopped after the run.

### Tool behavior and next improvements

- On task 11, Chrome DevTools performed one snapshot, three clicks with
  `includeSnapshot: true`, and one fill (5 calls). Harness-FE used 3 snapshots,
  4 clicks, 6 DOM queries, one type, 2 idle waits, one screenshot and one network
  read (18 calls). An optional post-action snapshot and richer form-state
  inspection are concrete candidates for reducing extra observation requests.
- Task 453 favored Harness-FE in this attempt: 14 calls / 109 seconds / 0.328
  recorded USD, versus 21 / 188 / 0.642. The baseline encountered two
  non-interactive-element errors before completing. This is evidence of varied
  task behavior, not proof that either tool suite is universally better.
- Harness-FE delivered 4 native image blocks and Chrome DevTools delivered 5.
  Tool-result errors totaled 1 and 2 respectively. All model records were `k3`.
- Preserve UI formatting when entering monetary values and verify the saved
  value. Audit format-sensitive evaluator conditions separately from functional
  outcomes; do not silently loosen official scores.
- Repeat the same fixed tasks with multiple attempts before making a ranking
  claim. Keep browser-operation results separate from code-repair/source-mapping
  evaluation, and keep this host-controller pilot separate from Harbor results.

### Integration findings retained for replay

| Finding | Owner/action |
| --- | --- |
| Backend URL must include `/admin`, store base URL must not | Runner configuration; fixed before model execution |
| Parent menu anchors do not behave as `role=link` | Known-good control uses selectors confirmed in the real site's HTML |
| Chrome DevTools page tools require explicit `pageId` | Runner preflight and task setup; fixed before model execution |
| Valid final JSON may be surrounded by prose | Reuse the upstream extraction transform uniformly for all saved outputs |
| Currency POST strings can differ while saved values match | Upstream evaluator/dataset review candidate; retain the official score and separate diagnostic |

These findings have not been posted as an upstream issue. They do not require
replacing the dataset or creating Magento-specific behavior in the product.

Final response normalization uses the **upstream**
`examples/evaluation/extract_agent_response.py:extract_json_from_text`, then the
official `FinalAgentResponse` schema. This accepts an explanatory paragraph or
Markdown surrounding a valid JSON response. Both conditions are normalized and
rescored uniformly from their original model outputs and HARs; a runner's initial
strict-JSON-only bookkeeping is not treated as an agent navigation failure.
`summarize.py <run-dir>` preserves the original bookkeeping report and records
any correction without rerunning model attempts.
