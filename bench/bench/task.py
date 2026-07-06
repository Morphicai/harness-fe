"""Inspect AI adapter — thin on purpose. All the actual orchestration logic
(checkout, patch, mcp config, dev server, claude invocation, oracle) lives in
bench/runner.py as plain Python so it doesn't depend on inspect-ai's exact
API surface. This module only wires that logic into Inspect's Task/Sample/
Solver/Scorer shapes so `inspect eval bench/task.py` and `inspect view` work.

NOTE: written against the documented inspect-ai solver/scorer pattern
(inspect.aisi.org.uk) as of the tech-design research pass — verify decorator
names/signatures against the installed `inspect-ai` version before relying
on this; the framework's public API has moved between minor versions.

Run for free (no real Claude Code calls, no API cost):
    HARNESS_BENCH_STUB=1 inspect eval bench/task.py

Run for real — DO NOT run this without the user's explicit go-ahead on
budget/account (see harness-bench-tech-design.md §6):
    inspect eval bench/task.py
"""
from __future__ import annotations

from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.scorer import Score, Target, accuracy, scorer
from inspect_ai.solver import Generate, TaskState, solver


# Inspect AI loads this file directly (exec_module on the file path), not as
# part of the `bench` package, so a relative import (`from .dataset import`)
# fails with "no module named ...task" even though `pip install -e .` makes
# `bench` importable absolutely. Use the absolute form.
from bench.dataset import load_samples
from bench.runner import run_sample

WORK_DIR = Path(__file__).resolve().parent.parent / "_checkouts"

_SAMPLES_BY_ID = {s.sample_id: s for s in load_samples()}


@solver
def run_condition():
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        bug_sample = _SAMPLES_BY_ID[state.sample_id]
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        result = run_sample(bug_sample, WORK_DIR)
        state.metadata["result"] = result
        state.output.completion = (
            f"fixed={result.fixed} steps={result.steps_to_first_fix} "
            f"cost_usd={result.total_cost_usd} wall_clock_s={result.wall_clock_seconds:.1f}"
        )
        return state

    return solve


@scorer(metrics=[accuracy()])
def oracle_scorer():
    async def score(state: TaskState, target: Target) -> Score:
        result = state.metadata["result"]
        return Score(
            value=1 if result.fixed else 0,
            answer=str(result.fixed),
            explanation=result.error or "",
            metadata={
                "sample_id": result.sample_id,
                "steps_to_first_fix": result.steps_to_first_fix,
                "precise_first_location": result.precise_first_location,
                "total_cost_usd": result.total_cost_usd,
                "wall_clock_seconds": result.wall_clock_seconds,
                **result.extra,
            },
        )

    return score


@task
def harness_bench() -> Task:
    samples = [
        Sample(
            id=s.sample_id,
            input=s.bug.problem_statement,
            target="bug fixed",
            metadata={
                "app": s.bug.app,
                "tier": s.bug.tier,
                "category": s.bug.category,
                "condition": s.condition,
            },
        )
        for s in _SAMPLES_BY_ID.values()
    ]
    return Task(
        dataset=MemoryDataset(samples=samples),
        solver=run_condition(),
        scorer=oracle_scorer(),
    )
