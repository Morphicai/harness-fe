"""Uniformly normalize/rescore saved outputs, then summarize without rerunning agents."""
import contextlib
import io
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

from evaluate import score

run = Path(sys.argv[1]).resolve()
path = run / "report.json"
report = json.loads(path.read_text())
assert report.get("completed"), "Do not summarize an incomplete matrix as a completed pilot"
manifest = report["manifest"]
assert len(report["trials"]) == len(manifest["taskIds"]) * len(manifest["conditions"]) * manifest["attempts"]
original = run / "report-before-final-scoring.json"
if not original.exists():
    original.write_text(path.read_text())
corrections = report.get("scoringNormalization", {}).get("initialReceiverCorrections", [])
for trial in report["trials"]:
    folder = run / f'{trial["taskId"]}-{trial["condition"]}'
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        score(trial["taskId"], folder)
    grade = json.loads(out.getvalue().splitlines()[-1])
    if trial.get("score") != grade["score"]:
        corrections.append({"taskId": trial["taskId"], "condition": trial["condition"],
                            "initialRecordedScore": trial.get("score"), "finalOfficialScore": grade["score"]})
    trial.update(grade)
    events = []
    for line in (folder / "transcript.stream.json").read_text().splitlines():
        try:
            event = json.loads(line)
            if isinstance(event, dict):
                events.append(event)
        except json.JSONDecodeError:
            continue
    end = next((e for e in reversed(events) if e.get("type") == "result"), {})
    init = next((e for e in events if e.get("type") == "system" and e.get("subtype") == "init"), {})
    trial["tokenUsage"] = end.get("usage")
    trial["cliVersion"] = init.get("claude_code_version")
    trial["advertisedToolCount"] = len(init.get("tools", []))
    tool_results = [b for e in events if isinstance(e.get("message"), dict)
                    for b in (e["message"].get("content") or [])
                    if isinstance(b, dict) and b.get("type") == "tool_result"]
    trial["toolErrors"] = sum(bool(b.get("is_error")) for b in tool_results)
    trial["nativeImageBlocks"] = sum(1 for b in tool_results if isinstance(b.get("content"), list)
                                      for c in b["content"] if c.get("type") == "image")
    trial["imageMimeTypes"] = dict(Counter(c.get("mimeType") for b in tool_results
        if isinstance(b.get("content"), list) for c in b["content"] if c.get("type") == "image"))
    trial["toolCounts"] = dict(Counter(trial["tools"]))
    trial["permissionDenials"] = end.get("permission_denials", [])

summary = {}
for condition in manifest["conditions"]:
    rows = [t for t in report["trials"] if t["condition"] == condition]
    summary[condition] = {"passed": sum(t["score"] == 1 for t in rows), "total": len(rows),
        "meanToolCalls": statistics.mean(t["toolCalls"] for t in rows),
        "meanSeconds": statistics.mean(t["seconds"] for t in rows),
        "meanRecordedCostUsd": statistics.mean(t["costUsd"] for t in rows),
        "totalRecordedCostUsd": sum(t["costUsd"] for t in rows),
        "nativeImageBlocks": sum(t["nativeImageBlocks"] for t in rows),
        "toolErrors": sum(t["toolErrors"] for t in rows),
        "models": sorted({m for t in rows for m in t["models"]})}
report["summary"] = summary
report["scoringNormalization"] = {
    "transform": "upstream examples/evaluation/extract_agent_response.py:extract_json_from_text",
    "scope": "All trials, unchanged model outputs and HARs, no model reruns",
    "initialReceiverCorrections": corrections,
}
path.write_text(json.dumps(report, indent=2))
(run / "summary.json").write_text(json.dumps(summary, indent=2))
lines = ["# WebArena-Verified pilot results", "", f'Upstream: `{report["upstreamCommit"]}`.',
    f'Image: `{report["imageDigest"]}`.', f'Browser: `{report.get("browserVersion")}`.',
    f'Model: `{manifest["model"]}`; one attempt per task/condition. Standalone host browser/controller + Docker site, not a Harbor job.',
    "", "| Condition | Passed | Mean tool calls | Mean model-run seconds | Mean CLI-recorded USD | Images | Tool errors |",
    "| --- | --- | --- | --- | --- | --- | --- |"]
for condition, row in summary.items():
    lines.append(f'| {condition} | {row["passed"]}/{row["total"]} | {row["meanToolCalls"]:.1f} | {row["meanSeconds"]:.1f} | {row["meanRecordedCostUsd"]:.3f} | {row["nativeImageBlocks"]} | {row["toolErrors"]} |')
lines.extend(["", "| Task | Condition | Official score | Tool calls | Model-run seconds | CLI-recorded USD |",
              "| --- | --- | --- | --- | --- | --- |"])
for trial in report["trials"]:
    lines.append(f'| {trial["taskId"]} | {trial["condition"]} | {trial["score"]} | {trial["toolCalls"]} | {trial["seconds"]:.1f} | {trial["costUsd"]:.3f} |')
lines.extend(["", "Success is official score=1. Cost is the CLI estimate, not a provider invoice. Model-run time excludes site reset and browser setup.",
    "All final responses use the same upstream JSON extraction transform before official evaluation. The initial receiver's pure-JSON-only bookkeeping was corrected from the saved outputs; original bookkeeping is retained separately.",
    "One attempt per cell, six tasks from one site: these results do not establish overall superiority or a full WebArena-Verified score."])
diagnostic = run / "price-format-diagnostic.json"
if diagnostic.exists():
    lines.extend(["", "## Task 461: price-format-sensitive scoring", "",
        "The official evaluator expects POST product[price] to be the string `29.50`. Harness-FE submitted `29.5`; Chrome DevTools submitted `29.50`. Both followed the same product-save route and received HTTP 302.",
        "The unchanged HARs show the post-save page returning `29.50` for the same SKU in both conditions, with a product-saved success message. This is an amount-equivalence diagnostic; official scores remain 0 and 1 respectively.",
        "See [the diagnostic evidence](price-format-diagnostic.json), including source HAR hashes. No dataset, reference answer, HAR or official result was modified to turn this into an official pass."])
(run / "results.md").write_text("\n".join(lines) + "\n")
print(json.dumps({"summary": summary, "corrections": corrections, "results": str(run / "results.md")}, ensure_ascii=False))
