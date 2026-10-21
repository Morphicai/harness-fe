# Paired pilot observations — 2026-10-22

Owner: harness-fe. Status: React pair completed; corrected fullstack pair running.
This document records the actual pilot, including evaluator limitations. It is not
a ranking across the frozen five datasets.

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
| All tool calls | 595 | 560 |
| Workspace / browser tool calls | 259 / 336 | 267 / 293 |
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
the same task/test bodies. Fullstack outcomes will be added after both chains end.

The first corrected fullstack current-task failure (DevTools stage 6) also has a
prompt/test discrepancy: the task requests `.product_quantity`, the submitted
detail page uses it, and the upstream test checks `.product-quantity`. This is
retained as an original failed grade; it is not fed back to either model chain.

DevTools stage 13 additionally fails `Admin Portal visibility`: the home page
renders management buttons for an anonymous visitor. The backend redirect/access
checks pass. This establishes a conditional-display issue, not a demonstrated
authorization bypass. Its later persistence or recovery will be reported from
the final submitted source rather than assumed from the initial failure.

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

The other eight Web-Bench projects, other four dataset adapters, extra repeats and
Air deployment/model readiness remain unaccepted. This first pilot cannot be
reported as the entire five-dataset × ten-unit comparison.
