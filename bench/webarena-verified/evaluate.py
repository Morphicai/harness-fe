"""Trusted dataset/export/scoring boundary; never give this module to the agent."""
import json
import runpy
import sys
from pathlib import Path

from webarena_verified.api import WebArenaVerified
from webarena_verified.types.config import WebArenaVerifiedConfig
from webarena_verified.types.agent_response import FinalAgentResponse

HERE = Path(__file__).resolve().parent
VENDOR = HERE / "vendor/webarena-verified"
MANIFEST = json.loads((HERE / "manifest.json").read_text())


def evaluator():
    return WebArenaVerified(config=WebArenaVerifiedConfig(
        test_data_file=VENDOR / "assets/dataset/webarena-verified.json",
        environments={"__SHOPPING_ADMIN__": {"urls": [MANIFEST["siteUrl"]]}}
    ))


def prepare(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    dataset_path = VENDOR / "assets/dataset/webarena-verified.json"
    dataset = json.loads(dataset_path.read_text())
    by_id = {task["task_id"]: task for task in dataset}
    tasks = []
    for task_id in MANIFEST["taskIds"]:
        task = by_id[task_id]
        assert task["sites"] == [MANIFEST["site"]]
        response = next(e for e in task["eval"] if e["evaluator"] == "AgentResponseEvaluator")
        tasks.append({
            "task_id": task_id, "intent": task["intent"],
            "start_urls": [url.replace("__SHOPPING_ADMIN__", MANIFEST["siteUrl"]) for url in task["start_urls"]],
            "task_type": response["expected"]["task_type"].upper(),
            "template_id": task["intent_template_id"], "revision": task.get("revision"),
        })
    (output / "tasks.json").write_text(json.dumps(tasks, indent=2))
    # Public fixture account from the official benchmark, never a user/provider key.
    # Keep it out of prompts, repository source and console output.
    example = json.loads((VENDOR / "examples/configs/config.example.json").read_text())
    site = next(value for key, value in example["environments"].items()
                if key.strip("_").lower() == MANIFEST["site"])
    credentials = site["credentials"]
    header = evaluator().get_custom_auth_header_name(MANIFEST["site"])
    auth = output / "fixture-auth.json"
    auth.write_text(json.dumps({header: f'{credentials["username"]}:{credentials["password"]}'}))
    auth.chmod(0o600)
    print(json.dumps({"tasks": len(tasks), "ids": MANIFEST["taskIds"]}))


def score(task_id: int, trial: Path):
    transcript = trial / "transcript.stream.json"
    if transcript.exists():
        events = []
        for line in transcript.read_text().splitlines():
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    events.append(value)
            except json.JSONDecodeError:
                continue
        end = next((event for event in reversed(events) if event.get("type") == "result"), {})
        raw = end.get("result")
        if isinstance(raw, str):
            (trial / "agent-final.txt").write_text(raw)
            extract = runpy.run_path(str(VENDOR / "examples/evaluation/extract_agent_response.py"))["extract_json_from_text"]
            try:
                normalized = FinalAgentResponse.model_validate(extract(raw)).model_dump(mode="json")
            except ValueError:
                # Preserve explicit UNKNOWN_ERROR fallback; never synthesize SUCCESS.
                normalized = None
            if normalized is not None:
                (trial / "agent_response.json").write_text(json.dumps(normalized, indent=2))
    wa = evaluator()
    result = wa.evaluate_task(task_id=task_id,
                             agent_response=trial / "agent_response.json",
                             network_trace=trial / "network.har")
    result_json = result.model_dump(mode="json")
    (trial / "eval_result.json").write_text(json.dumps(result_json, indent=2))
    response_status = json.loads((trial / "agent_response.json").read_text()).get("status")
    print(json.dumps({"score": result.score, "status": str(result.status), "responseStatus": response_status,
                      "error": getattr(result, "error_msg", None)}))


if __name__ == "__main__":
    if sys.argv[1] == "prepare":
        prepare(Path(sys.argv[2]))
    elif sys.argv[1] == "score":
        score(int(sys.argv[2]), Path(sys.argv[3]))
    else:
        raise SystemExit("Use prepare <run-dir> or score <task-id> <trial-dir>")
