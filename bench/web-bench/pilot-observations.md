# Paired pilot observations — 2026-10-22

Owner: harness-fe. Status: model execution paused by the user after Kimi quota
exhaustion; React pair completed, fullstack pair incomplete. Model switching is
deferred until the user's later instruction.
This document records the actual pilot, including evaluator limitations. It is not
a ranking across the frozen five datasets.

## Coverage and conclusion

The frozen plan has four project attempts and 80 development stages. Two React
chains completed; corrected fullstack DevTools has 19 graded stages and a provider
failure during stage 20; corrected fullstack Harness-FE has not started. Thus
**59 stages are graded and only one of two project pairs is complete**. The
interrupted step's source, model identity, usage and tool evidence are retained.

The completed React pair favors Harness-FE on the declared raw measures, but
the one-case final difference is affected by evaluator assumptions. Fullstack
has no paired outcome. This pilot does not establish an overall solving advantage
or a historical-log debugging advantage for Harness-FE.

## Completed React pair

Both conditions completed the same 20-task chain with Claude Code 2.1.301 and
Kimi `k3`, Harness-FE CLI/plugin 4.5.3, runtime 4.5.2, Playwright 1.57.0 and
Chromium 143.0.7499.4. Each task used a fresh invocation and persistent project
source; neither condition received hidden grading feedback.

| Measure | Harness-FE | Chrome DevTools MCP |
| --- | ---: | ---: |
| Stages with all cumulative tests passing | 8/20 | 3/20 |
| Stages passing the current task's tests | 18/20 | 17/20 |
| Final upstream test cases passing | 57/59 | 56/59 |
| Flaky case occurrences across graded stages | 0 | 0 |
| Recorded tool responses | 595 | 560 |
| Workspace / browser tool calls | 259 / 336 | 267 / 293 |
| Browser tools advertised / with recorded responses | 63 / 12 | 30 / 13 |
| Screenshot calls / native image results | 23 / 23 | 20 / 13 |
| Explicit console/error log reads | 25 | 16 |
| MCP error responses | 4 | 4 |
| Model execution seconds | 4539.804 | 4252.258 |
| Grading seconds | 545.477 | 529.799 |
| Service setup seconds | 6.648 | 3.183 |
| Whole attempt seconds, including cleanup | 5102.685 | 4789.542 |
| CLI-estimated USD | 10.7387355 | 10.911231 |

The cumulative score favors Harness-FE on this observed pair. A persistent earlier
failure causes later cumulative stages to fail: these are not twelve or seventeen
independent feature failures. The final-case difference is one case, and the
failure audit below limits its interpretation as a functional advantage.

Harness-FE reached `error_max_turns` at stage 11; DevTools did so at stage 14.
Both saved sources passed their corresponding current-task checks. Budget
exhaustion and functional grading remain separate observations. Successful CLI
responses can report more than 40 `num_turns`; the actual subtype identifies
exhaustion. Costs are CLI estimates, not provider invoices. Timing comes from a
shared development laptop; extra reference controls overlapped early React work,
so this is not an isolated latency comparison.

## What the React failures actually establish

| Case | Observed cause | Interpretation |
| --- | --- | --- |
| Task 9, both conditions: `Check Edit Form Title Change` | The prompt requests `Edit Form`; both implementations use it, while the unchanged upstream test requires `Edit Blog`. | A prompt/test contradiction, not evidence that either Agent failed the stated title requirement. It persists in all later cumulative grades. |
| Task 4, DevTools: `Check Add Blog Modal, Open And Close` | Both the heading and submit button contain `Create Blog`; unscoped `getByText` fails strict uniqueness. | The official test fails, but this is selector coupling to implementation text; opening/closing failure is not established by this error. |
| Task 11, DevTools: `Check Random Blogs will not stuck pages` | The same duplicate `Create Blog` text fails the post-click visibility assertion. | This error does not establish a performance hang. The list implementation uses virtual rendering, and the separate large-list search check passes. |
| Task 19, Harness-FE: `Turn Switched` | The test clicks an occupied square twice to verify a no-op. The implementation disables occupied button cells, so Playwright waits for an enabled element and times out. | The no-overwrite requirement is implemented, but the evaluator assumes an enabled click target. Other game/win checks pass. |

Original test bodies, grades and source snapshots are retained. No cases are
removed, rescored or explained to the model during this run. These findings support
using Web-Bench as a development integration test, while requiring task/test
consistency checks before relying on it for a broad product-quality ranking.

## Images and logs

Harness-FE returned a native MCP image for all 23 screenshot calls. DevTools
returned 13 native images from 20 calls: four requests saved to `/tmp` and returned
only a path, while three requests to the task directory were rejected by the
DevTools server's configured workspace policy. The model had no native host image
reader. Preserve this tool-delivery limitation; it is not a measured visual
reasoning failure, nor evidence that the model correctly understood every image.

All 25 Harness-FE `errors.tail`/`console.tail` reads succeeded and returned empty
entries. DevTools console reads also succeeded; most were empty, with one
accessibility warning response and one Vite/React development-message response.
Neither React condition requested network logs. Thus React shows image delivery
and log retrieval, but does **not** demonstrate a debugging win from historical
logs. The separate controlled smoke verifies retrieval of deliberately generated
nonempty console/network records and native PNGs.

Harness-FE's four MCP error responses are `page.evaluate` syntax errors involving
a semicolon. DevTools has the three screenshot path rejections above and one
missing-page navigation error. These are different tool-use friction points;
they do not all indicate application defects. Tool catalogs and full responses
are saved, rather than inferring successful inspection from call counts.

The first and last retained Harness-FE React images (`image-10-0.webp` and
`image-594-0.webp`) were visually inspected: both contain readable rendered UI,
including the final posted game record. This is a sample check of image integrity,
not a claim about how the evaluated model interpreted every image.
All 23 Harness-FE and 13 DevTools saved image files match the recorded native-image
counts and have valid PNG, JPEG or WebP signatures; this is a file-integrity check,
not full visual review of every image.

Tool totals count the frozen broker's completed-response records. Its exception
path can return HTTP 500 before appending a tool record; transport exceptions are
not independently enumerated by this broker. Error counts mean recorded MCP
`isError` responses. Do not describe these counters as a complete transport-attempt
trace or infer model understanding from a successful return.

Harness-FE's browser-call surplus is numerically the same as its evaluate-call
surplus: `page.evaluate` runs 90 times versus 47 `evaluate_script` calls in the
baseline. Sampled expressions inspect DOM content, layout and computed styles;
both APIs support collecting several checks in one call. Call counts alone do
not establish that the additional checks were necessary or effective.

No Harness-FE project source lookup, session history, visitor timeline, recording
or task-management invocations appear in the recorded React responses.
Fifty-one advertised browser tools have no recorded use, versus seventeen in DevTools.
This supports investigating task-specific catalogs and concise usage guidance;
it does not justify deleting capabilities needed by other tasks. Skills were
disabled in **both** conditions, so this is the neutral-Agent MCP comparison,
not an acceptance of an additional Harness-FE-specific skill workflow. Any new
guidance/catalog condition must receive a new frozen experiment.

## Evidence identity and pending scope

React evidence is in ignored `jobs/paired-release-4.5.3-1`, with completed attempts
`cfe99097d309333508f4027f` (Harness-FE) and `3be07216cc604cfb90d33b1e`
(DevTools). Its plan hash is
`7f8c31370833b8d6b0e08cc1885d472d9373470db3c632f0983e47f1cce60987`;
the pre-model [pilot manifest](pilot-manifest.json) freezes the image/source IDs.

Fullstack uses a separately frozen corrected run, `paired-fullstack-policy-1`,
plan hash `5fc212c6ea06deec791c086f0ad2e3d4baba26dafc4bfb62019a00ccfd0ce4c5`.
Reference controls found that Vite bypassed a backend authorization redirect on
HTML navigation; the original fullstack setup was stopped before any model
development step completed. It remains interrupted/pending in the original plan,
not an Agent-solving failure. The corrected pair preserves Chrome-first order and
the same task/test bodies.

### Corrected fullstack status at pause

| Measure | Chrome DevTools MCP | Harness-FE |
| --- | ---: | --- |
| Graded development stages | 19/20 | Not started |
| Cumulative stages passed among those graded | 5/19 | No score |
| Current-task stages passed among those graded | 16/19 | No score |
| Latest graded cases, stage 19 | 82/85 | No score |
| Recorded tool responses, including interrupted stage 20 | 648 | None |
| Workspace / browser responses | 370 / 278 | None |
| Screenshot calls / native image results | 16 / 12 | None |
| Explicit console/network/error reads | 2 | None |
| Recorded MCP error responses | 4 | None |
| Model seconds for graded stages | 4742.826 | Not started |
| Model seconds for interrupted stage 20 | 478.658 | Not started |
| Grading seconds for completed stages | 1335.055 | Not started |
| CLI-estimated USD, including interrupted stage 20 | 12.5521775 | Not started |

Stage 20 returns **HTTP 429: Kimi's five-hour usage quota is exhausted**. The model
receipt verifies `k3`, records exit 1 and `isError=true`, and explicitly records
`timedOut=false`; this is a provider entitlement failure, not an observed 480-second
controller timeout or a completed functional failure. Its $0.762776 CLI estimate
is included in the fullstack total above despite having no committed stage grade.
All three started chains together have **$34.202144** of known CLI-estimated cost,
excluding model acceptance/smoke calls and not substituting for provider billing.

The original failed attempt has not been replayed. No new Harness-FE project call
was launched after quota exhaustion. The user requested this summary and deferred
model switching. Owner task checkboxes remain open for the incomplete paired run.
The final saved source was evaluated separately with the same immutable verifier:
**88/91 cases pass, zero flaky, and all current task-20 checks pass**. Its three
failures remain the detail quantity selector, administrator-link visibility and
the payment test's quantity selector. No source repair or further model call was
used. Source hash:
`87caa195c2e412736a285b84712708264bb239796ecaaafc4e5ab9b5af03ea59`.
This offline diagnostic cannot turn the failed attempt into a completed chain or
pair win; it is retained under `step-20/partial-source-diagnostic/`, separate from
the chain's committed 19 grades.

The first corrected fullstack current-task failure (DevTools stage 6) also has a
prompt/test discrepancy: the task requests `.product_quantity`, the submitted
detail page uses it, and the upstream test checks `.product-quantity`. This is
retained as an original failed grade; it is not fed back to either model chain.

DevTools stage 13 additionally fails `Admin Portal visibility`: the home page
renders management buttons for an anonymous visitor. The backend redirect/access
checks pass. This establishes a conditional-display issue, not a demonstrated
authorization bypass. This visibility failure remains in the stage-19 graded source.

DevTools stage 17's `Test Pay Order` first passes the completed-order and balance
assertions, then fails the same missing `.product-quantity` selector. The two
retries instead stop at registration: the first try already created that fixed
username in the stage's verifier database, which persists across test retries.
Those later registration errors must not be reported as the original payment
failure. The insufficient-balance and insufficient-stock cases pass at this stage.
Inspect **all** Playwright `results`, starting with retry zero; the last error can
be a consequence of prior failed execution. No retry policy or source was changed.

Generate a joined, read-only report with explicit project/run selection:

```bash
node bench/lab/webbench-report.mjs \
  --select react /path/to/paired-release-4.5.3-1 \
  --select fastify-react /path/to/paired-fullstack-policy-1 \
  --out /path/to/joined-report.json
```

The reporter checks plan/state hashes, condition identities, contiguous stages,
model identities, saved scores, source receipts and grading evidence. It retains
excluded original coverage, reports partial observations with no final score, and
computes pair outcomes only for completed pairs. Native-image delivery is separate
from screenshot requests and from claims about visual reasoning.

The [sanitized report snapshot](pilot-results-2026-10-22.json) includes identities,
stage source hashes, incomplete coverage, interrupted-step costs and the separate
diagnostic. It excludes prompts, model streams, tool arguments, credentials and
machine paths. Raw artifacts remain in the ignored run directories.

The other eight Web-Bench projects, other four dataset adapters, extra repeats and
Air deployment/model readiness remain unaccepted. This first pilot cannot be
reported as the entire five-dataset × ten-unit comparison.

## Investigation learnings and next experiment

| Symptom | Initial hypothesis and why it looked plausible | Evidence and root cause | Owner action |
| --- | --- | --- | --- |
| Fullstack development reference passes 90/91 | An application authorization defect: one administrator route fails. | Production reference passes 91/91; Vite's HTML fallback bypasses backend document policy. | Fixed in shared `backend-policy.mjs`; real HTTP regression test is included in CI. Frozen original and corrected environments remain distinct. |
| Payment test ends at registration | A new registration/authentication regression: the last retry's URL is `/register`. | Retry zero reaches completed payment/balance assertions, then fails the quantity selector; the created user persists into retries. | Preserve all retry results and start explanations at retry zero; the verifier lifetime is documented in the README. |
| Final model call exits near 480 seconds | Controller timeout: elapsed time is close to its frozen cap. | Receipt says `timedOut=false`; CLI result is HTTP 429 five-hour quota exhaustion. | Reporter classifies provider quota failure and retains the interrupted call's cost/source. No Agent replay or replacement score. |

The native-image delivery path is accepted by this pilot; it still needs a task
where choosing the correct object from pixels determines success. Historical log
retrieval needs a similarly relevant real debugging task: empty error queries in
this React chain cannot show that benefit. The frozen SWE multimodal and visual
web-task samples remain candidates pending their own environment/verifier checks.

For tool efficiency, investigate a scoped development catalog and batched DOM/
layout checks, measuring result quality and calls in a new frozen condition.
Keep this run's catalog, prompt and original scores intact. Future audit work can
record transport starts/exceptions as well as returned responses; the current
counter boundary is documented rather than presented as a complete attempt trace.

The user paused model execution and deferred model selection. Once a model is
chosen, validate its tools/images/provider entitlement, then freeze both browser
conditions with the same model and task budgets in a new run. Keep these Kimi
artifacts and incomplete coverage as historical evidence. A different model must
not fill only the missing Kimi Harness-FE row and be interpreted as a tool effect.
