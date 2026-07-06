"""Core "run one (bug, condition) sample" logic — deliberately plain Python
with no Inspect AI import, so it can be unit-tested and reasoned about on its
own. bench/task.py is a thin Inspect adapter around this module. See
harness-bench-tech-design.md §3 for the design this implements.

HARNESS_BENCH_STUB=1 short-circuits the real `claude -p` call so the rest of
the pipeline (checkout, patch apply, mcp config, dev server, oracle, scoring)
can be exercised for free — see harness-bench-tech-design.md §6 / the plan's
"stub 自检" step. Real runs cost real Anthropic API usage and must not be
triggered without the user's explicit go-ahead (see the "需要拍板的点"
section of harness-bench-tech-design.md).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from .dataset import BugSample

REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # packages/harness-fe
EXAMPLES_ROOT = REPO_ROOT / "examples"
BENCH_ROOT = Path(__file__).resolve().parent.parent  # packages/harness-fe/bench
MCP_CONFIG_TEMPLATES = BENCH_ROOT / "mcp_configs"
PREWARM_SCRIPT = BENCH_ROOT / "prewarm" / "harness_prewarm.mjs"
SOLO_GATEWAY_WS_URL = "ws://127.0.0.1:47729/ws"  # must match harness_prewarm.mjs's GATEWAY_PORT
STUB_FIXTURES = BENCH_ROOT / "stub_fixtures"

DEV_SERVER_READY_RE = re.compile(r"Local:\s+(http://[^\s]+)")
CLAUDE_ALLOWED_TOOLS = "Read,Edit,Bash(pnpm test*)"  # scope kept narrow — no unrelated shell access


class SampleError(RuntimeError):
    pass


@dataclass
class SampleResult:
    sample_id: str
    fixed: bool
    steps_to_first_fix: int | None
    precise_first_location: bool | None
    total_cost_usd: float | None
    wall_clock_seconds: float
    raw_transcript_path: Path | None
    error: str | None = None
    extra: dict = field(default_factory=dict)


def _fresh_checkout(app: str, dest: Path) -> Path:
    """Copy examples/<app> into an isolated working dir and apply the bug
    patch. Uses a plain file copy rather than `git worktree` so it works
    identically whether or not the sandbox has the full monorepo git
    history (a Docker sandbox built from bench/docker/Dockerfile won't)."""
    src = EXAMPLES_ROOT / app
    if not src.is_dir():
        raise SampleError(f"unknown demo app {app!r} — no such dir {src}")
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("node_modules", "dist", ".turbo"))
    _make_installable(dest)
    _install_deps(dest)
    return dest


def _install_deps(app_dir: Path) -> None:
    """The checkout is copied without node_modules (see _fresh_checkout) —
    copying the source app's real node_modules instead of reinstalling would
    be faster, but those are pnpm-linked back into the monorepo workspace
    (symlinks to packages/*), which breaks the moment the checkout is moved
    or containerized. A plain `npm install` against the now-`latest`-pinned
    package.json is slower per sample but actually portable. The demo's own
    pnpm-lock.yaml is stale the moment _make_installable rewrites versions,
    so it's removed rather than trusted."""
    lockfile = app_dir / "pnpm-lock.yaml"
    if lockfile.exists():
        lockfile.unlink()
    result = subprocess.run(
        ["npm", "install", "--no-audit", "--no-fund"],
        cwd=app_dir,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise SampleError(
            f"npm install failed in {app_dir}: stdout={result.stdout[-2000:]!r} "
            f"stderr={result.stderr[-2000:]!r}"
        )


def _make_installable(app_dir: Path) -> None:
    """KNOWN SIMPLIFICATION (see harness-bench-tech-design.md §3.2): the demo
    apps declare `workspace:*` deps on @harness-fe/* packages, which only
    resolve inside the monorepo's pnpm workspace. A standalone sandbox
    checkout has no workspace, so we rewrite those to `latest` before
    install. This means the bench always tests against the latest published
    harness-fe, not necessarily the exact version the source snapshot was
    authored against — acceptable for now, but worth pinning explicitly
    before trusting cross-run comparisons long-term."""
    pkg_path = app_dir / "package.json"
    pkg = json.loads(pkg_path.read_text())
    changed = False
    for dep_group in ("dependencies", "devDependencies"):
        deps = pkg.get(dep_group, {})
        for name, version in list(deps.items()):
            if version == "workspace:*":
                deps[name] = "latest"
                changed = True
    if changed:
        pkg_path.write_text(json.dumps(pkg, indent=4) + "\n")


_REACT_VITE_CONFIG_WITH_HARNESS = """\
// Overwritten by bench/runner.py::_write_bench_vite_config — see
// harness-bench-tech-design.md §3.4. react-demo's own vite.config.ts is
// hardcoded to the GOVERNED/team gateway (port 47950, token-secured), which
// this bench doesn't stand up. Every sample gets a minimal solo-mode config
// instead, pointed at the loopback daemon harness_prewarm.mjs brings up.
import {{ defineConfig }} from 'vite';
import react from '@vitejs/plugin-react';
import {{ harnessFE }} from '@harness-fe/vite';

export default defineConfig({{
    plugins: [
        harnessFE({{ projectId: {project_id!r}, mcpUrl: {mcp_url!r} }}),
        react(),
    ],
}});
"""

_REACT_VITE_CONFIG_PLAIN = """\
// Overwritten by bench/runner.py::_write_bench_vite_config. No harness-fe
// plugin for this condition — Chrome DevTools MCP drives the page directly
// via CDP and doesn't need (or want) the runtime SDK injected, and the
// "none" condition shouldn't have it either.
import {{ defineConfig }} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({{
    plugins: [react()],
}});
"""

_VITE_CONFIG_BUILDERS = {
    "react-demo": (_REACT_VITE_CONFIG_WITH_HARNESS, _REACT_VITE_CONFIG_PLAIN),
    # vue-demo / iframe-demo not wired yet — see fixtures/BUG_WORKLIST.md.
    # Adding support means writing the @vitejs/plugin-vue (or the parent+child
    # pair, for iframe-demo) equivalent of the two templates above.
}


def _write_bench_vite_config(app_dir: Path, app: str, condition: str) -> None:
    if app not in _VITE_CONFIG_BUILDERS:
        raise SampleError(
            f"no bench vite.config.ts template for app {app!r} — only react-demo "
            "is wired up today, see fixtures/BUG_WORKLIST.md"
        )
    with_harness_tmpl, plain_tmpl = _VITE_CONFIG_BUILDERS[app]
    if condition == "harness-fe":
        content = with_harness_tmpl.format(project_id=app, mcp_url=SOLO_GATEWAY_WS_URL)
    else:
        content = plain_tmpl.format()  # unescape the template's literal {{ }}
    (app_dir / "vite.config.ts").write_text(content)


def apply_bug_patch(app_dir: Path, patch_path: Path) -> None:
    result = subprocess.run(
        ["patch", "-p1", "--input", str(patch_path)],
        cwd=app_dir,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SampleError(
            f"bug.patch failed to apply in {app_dir} — the fixture's diff is "
            f"probably stale against the current demo source. "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )


def write_mcp_config(condition: str, app_dir: Path, app_url: str | None) -> Path:
    template_path = MCP_CONFIG_TEMPLATES / f"{condition}.mcp.json.tmpl"
    if not template_path.is_file():
        raise SampleError(f"no mcp config template for condition {condition!r}")
    text = template_path.read_text()
    if app_url:
        text = text.replace("{{APP_URL}}", app_url)
    out_path = app_dir / ".mcp.json"
    out_path.write_text(text)
    return out_path


def start_dev_server(app_dir: Path) -> tuple[subprocess.Popen, str]:
    proc = subprocess.Popen(
        ["pnpm", "run", "dev"],
        cwd=app_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    deadline = time.monotonic() + 30
    url = None
    assert proc.stdout is not None
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                raise SampleError(f"dev server exited early (code {proc.returncode})")
            continue
        m = DEV_SERVER_READY_RE.search(line)
        if m:
            url = m.group(1)
            break
    if url is None:
        proc.kill()
        raise SampleError("dev server did not print a 'Local:' URL within 30s")
    return proc, url


def start_prewarm(app_url: str) -> subprocess.Popen:
    """Condition-A-only. See bench/prewarm/harness_prewarm.mjs and
    harness-bench-tech-design.md §3.4 — this is the step Chrome DevTools MCP
    does not need because it manages its own browser lifecycle."""
    prewarm_dir = PREWARM_SCRIPT.parent
    proc = subprocess.Popen(
        ["node", str(PREWARM_SCRIPT), app_url],
        cwd=prewarm_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    deadline = time.monotonic() + 20
    assert proc.stdout is not None
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                raise SampleError("prewarm process exited before signaling ready")
            continue
        if line.strip() == "PREWARM_READY":
            return proc
    proc.kill()
    raise SampleError("prewarm did not signal PREWARM_READY within 20s")


def invoke_claude(prompt: str, mcp_config_path: Path, cwd: Path, sample_id: str) -> dict:
    """Runs `claude -p` headless with a strict, per-condition mcp config.
    See harness-bench-tech-design.md §3.1 for why headless mode alone covers
    every control point the bench needs (no custom agent loop required).

    Real Anthropic API cost is incurred here. Gated by HARNESS_BENCH_STUB —
    the caller (task.py) is responsible for never flipping that off without
    the user's explicit go-ahead."""
    if os.environ.get("HARNESS_BENCH_STUB") == "1":
        return _stub_claude_response(sample_id)

    started = time.monotonic()
    result = subprocess.run(
        [
            "claude", "-p", prompt,
            "--output-format", "stream-json",
            "--mcp-config", str(mcp_config_path),
            "--strict-mcp-config",
            "--allowedTools", CLAUDE_ALLOWED_TOOLS,
            "--permission-mode", "acceptEdits",
        ],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=900,
    )
    wall_clock = time.monotonic() - started
    events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    return {"events": events, "wall_clock_seconds": wall_clock, "returncode": result.returncode}


def _stub_claude_response(sample_id: str) -> dict:
    """Reads a canned transcript instead of calling the real model. Two
    fixtures exist — one representing "fixed it" and one "didn't" — chosen
    deterministically by hashing the sample id, purely so stub runs exercise
    both code paths in the scorer without any randomness (Date.now/random
    aren't available in this repo's other tooling for the same reason:
    reproducibility)."""
    fixture_name = "fixed.stream.json" if hash(sample_id) % 2 == 0 else "unfixed.stream.json"
    fixture_path = STUB_FIXTURES / fixture_name
    events = json.loads(fixture_path.read_text())
    return {"events": events, "wall_clock_seconds": 0.0, "returncode": 0, "stub": True}


def run_oracle(bug, app_dir: Path) -> tuple[bool, str]:
    oracle_path = bug.fixture_dir / bug.oracle_script
    result = subprocess.run(
        ["node", str(oracle_path), str(app_dir)],
        cwd=bug.fixture_dir,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return result.returncode == 0, (result.stdout + result.stderr)


def extract_metrics(claude_result: dict, ground_truth_location: dict) -> dict:
    events = claude_result["events"]
    tool_uses = [e for e in events if e.get("type") == "tool_use" or (e.get("type") == "assistant" and e.get("tool_use"))]
    steps = len(tool_uses)

    total_cost_usd = None
    for e in events:
        if isinstance(e, dict) and "total_cost_usd" in e:
            total_cost_usd = e["total_cost_usd"]

    precise_first_location = None
    gt_file = ground_truth_location.get("file")
    for e in tool_uses:
        input_ = e.get("input") or e.get("tool_input") or {}
        candidate = json.dumps(input_)
        if gt_file and gt_file in candidate:
            precise_first_location = True
            break
        if any(k in input_ for k in ("file", "loc", "selector", "path")):
            precise_first_location = False
            break

    return {
        "steps_to_first_fix": steps,
        "total_cost_usd": total_cost_usd,
        "precise_first_location": precise_first_location,
    }


def run_sample(sample: BugSample, work_dir: Path) -> SampleResult:
    bug = sample.bug
    app_dir = work_dir / sample.sample_id.replace("/", "_").replace("::", "__")
    dev_proc = None
    prewarm_proc = None
    try:
        _fresh_checkout(bug.app, app_dir)
        apply_bug_patch(app_dir, bug.patch_path)
        _write_bench_vite_config(app_dir, bug.app, sample.condition)

        needs_server = sample.condition in ("harness-fe", "chrome-devtools-mcp") or bug.oracle_kind == "browser"
        app_url = None
        if needs_server:
            dev_proc, app_url = start_dev_server(app_dir)

        write_mcp_config(sample.condition, app_dir, app_url)

        if sample.condition == "harness-fe":
            assert app_url is not None
            prewarm_proc = start_prewarm(app_url)

        prompt = bug.problem_statement
        claude_result = invoke_claude(prompt, app_dir / ".mcp.json", app_dir, sample.sample_id)

        if dev_proc is not None:
            dev_proc.terminate()
        if prewarm_proc is not None:
            prewarm_proc.terminate()

        fixed, oracle_log = run_oracle(bug, app_dir)
        metrics = extract_metrics(claude_result, bug.ground_truth_location)

        return SampleResult(
            sample_id=sample.sample_id,
            fixed=fixed,
            steps_to_first_fix=metrics["steps_to_first_fix"] if fixed else None,
            precise_first_location=metrics["precise_first_location"],
            total_cost_usd=metrics["total_cost_usd"],
            wall_clock_seconds=claude_result["wall_clock_seconds"],
            raw_transcript_path=None,
            extra={"oracle_log": oracle_log, "stub": claude_result.get("stub", False)},
        )
    except SampleError as e:
        return SampleResult(
            sample_id=sample.sample_id,
            fixed=False,
            steps_to_first_fix=None,
            precise_first_location=None,
            total_cost_usd=None,
            wall_clock_seconds=0.0,
            raw_transcript_path=None,
            error=str(e),
        )
    finally:
        for proc in (dev_proc, prewarm_proc):
            if proc is not None and proc.poll() is None:
                proc.kill()
