"""Loads bug fixtures from bench/fixtures/**/metadata.json and expands each
bug into one row per condition (A/B/C). Pure Python, no Inspect AI
dependency — this stays testable and readable on its own. See
harness-bench-tech-design.md §2 for why the dataset itself is deliberately
just data, not framework-specific objects.

Field names (problem_statement / fail_to_pass / pass_to_pass) deliberately
mirror SWE-bench's instance schema — see harness-bench-analysis.md
"harness-bench 相对 SWE-bench 的定位" and harness-bench-tech-design.md §1.1
for why: we adopt SWE-bench's instance format and PASS_TO_PASS
anti-regression convention, but not its execution harness (it has no
concept of a live browser or mid-task tool access, which is the whole point
of this benchmark).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"

CONDITIONS = ("harness-fe", "chrome-devtools-mcp", "none")


@dataclass(frozen=True)
class BugFixture:
    id: str
    app: str
    app_dev_route: str
    tier: str
    category: str
    problem_statement: str
    ground_truth_location: dict
    oracle_script: str
    oracle_kind: str
    fixture_dir: Path
    fail_to_pass: str = ""
    pass_to_pass: list = None  # type: ignore[assignment]

    @property
    def patch_path(self) -> Path:
        return self.fixture_dir / "bug.patch"


@dataclass(frozen=True)
class BugSample:
    """One (bug, condition) pair — this is what actually gets run once."""

    bug: BugFixture
    condition: str

    @property
    def sample_id(self) -> str:
        return f"{self.bug.id}::{self.condition}"


def load_fixtures() -> list[BugFixture]:
    fixtures = []
    for metadata_path in sorted(FIXTURES_DIR.glob("*/*/metadata.json")):
        raw = json.loads(metadata_path.read_text())
        fixtures.append(
            BugFixture(
                id=raw["id"],
                app=raw["app"],
                app_dev_route=raw["app_dev_route"],
                tier=raw["tier"],
                category=raw["category"],
                problem_statement=raw["problem_statement"],
                ground_truth_location=raw["ground_truth_location"],
                oracle_script=raw["oracle"],
                oracle_kind=raw["oracle_kind"],
                fixture_dir=metadata_path.parent,
                fail_to_pass=raw.get("fail_to_pass", ""),
                pass_to_pass=raw.get("pass_to_pass", []),
            )
        )
    if not fixtures:
        raise RuntimeError(
            f"no fixtures found under {FIXTURES_DIR} — see BUG_WORKLIST.md, "
            "the dataset is only partially authored"
        )
    return fixtures


def load_samples() -> list[BugSample]:
    """Every bug × every condition — this is the full eval matrix."""
    return [
        BugSample(bug=bug, condition=condition)
        for bug in load_fixtures()
        for condition in CONDITIONS
    ]
