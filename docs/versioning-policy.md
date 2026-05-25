# Versioning policy

This repo is a monorepo with **linked** versions across the core packages
(see `.changeset/config.json` — `linked: [...]`). One package's bump
drags all 10 to the same version number. That makes for clean
"all-3.1.0" install stories, but it also means **a careless `minor`
changeset turns into a major-looking jump across the whole ecosystem**.

The packages currently in the linked group:

```
@harness-fe/protocol      @harness-fe/vite
@harness-fe/mcp-server    @harness-fe/webpack
@harness-fe/runtime       @harness-fe/unplugin
@harness-fe/node-runtime  @harness-fe/next
@harness-fe/log           @harness-fe/react-jsx
```

Unlinked (independent version numbers):

```
@harness-fe/dashboard-ui   (shipped inside mcp-server's tarball)
@harness-fe/agent-skill    (separate concern)
```

**Linked-group invariant:** every member must be at the same version
after each release. Changesets enforces this by unifying versions on
every release; if members drift to different majors, the next bump is
forced to `major` so everyone can be re-aligned to the same number.
We deliberately catch up `@harness-fe/log` and `@harness-fe/react-jsx`
to 3.x in their package.json directly when they fall behind — this is
a manual release-engineering step, not a changeset-driven jump. After
catchup, normal `patch` / `minor` bumps work cleanly across all 10.

## Pre-1.0 / pre-launch posture

We've shipped 3.x to npm but **the product hasn't had a public launch
yet**. Users / partners aren't yet treating our semver promises as
load-bearing. Until that changes:

**Default for every changeset is `patch`.**

Use `minor` only when there's a deliberate, documented reason:
- A new top-level MCP tool name (visible in agents' tool list)
- A new package export that downstream code is expected to import
- A new opt-in feature flag with documented user-visible behavior

Use `major` only when:
- Breaking a documented public API (function signature, MCP tool name,
  exported type)
- Removing a feature users have been told to rely on

**Everything else — internal refactors, UX polish, bug fixes, new
internal helpers, doc-only changes, perf, security hardening, additive
schema fields that downstream code doesn't have to opt into — is a
`patch`.** Even if it's a big patch in lines-of-code, the *contract*
hasn't changed.

## The linked group multiplier

Because all linked packages bump to the same version, a single changeset
on `@harness-fe/mcp-server` marked `minor` becomes a minor bump on
**every** linked package — even ones with zero changes that release.
Users see "10 packages went 3.0 → 3.1" and infer there's a flagship
feature, when really there's a button.

So: **default `patch`. If you genuinely need `minor`, write the changeset
description as if it were a release note, because that's what users
will read.**

## Decision checklist before opening a changeset

Ask yourself in this order:

1. **Did I rename, remove, or change the call shape of an exported API,
   MCP tool, or stable public type?** → `major`
2. **Did I add a new export that the docs now tell users to call?** →
   `minor`
3. **Otherwise (the vast majority of changes)** → `patch`

Don't reach for `minor` because the PR feels significant. Significance
is communicated in the PR body and the changelog. The version number is
just a contract about compatibility.

## How to actually downgrade a pending changeset

If you opened a PR with `minor` and on reflection it should be `patch`,
edit the changeset frontmatter on the branch — that's all:

```diff
--- a/.changeset/my-thing.md
+++ b/.changeset/my-thing.md
@@ -1,3 +1,3 @@
 ---
-'@harness-fe/runtime': minor
+'@harness-fe/runtime': patch
 ---
```

Push, and the eventual Version Packages PR will reflect the new level.

## Coordinating cross-package work

When a single PR genuinely touches multiple linked packages (e.g.
`protocol` + `mcp-server` together for a new frame schema), put a
**single changeset that names both**:

```markdown
---
'@harness-fe/protocol': patch
'@harness-fe/mcp-server': patch
---
```

Don't split into multiple changeset files for the same logical change —
changesets are merged at release time, but the changelog reads cleaner
when one paragraph describes one user-facing thing.

## When we hit 1.0 / public launch

This document gets stricter:
- Move to **strict semver**: any added export is `minor`, any removed
  one is `major`
- Consider unlinking packages so independent ones can release at their
  own cadence
- Tag releases with release notes on GitHub Releases (already enabled
  in `.github/workflows/release.yml`)

For now (pre-launch), prefer slow version movement. We can always
release more often once users are watching.

## Node version: docs vs `engines` (intentional gap)

Public-facing docs (README badge, README prereq, CONTRIBUTING,
`docs/quickstart.md`) state **Node ≥ 20**. The `engines` field in
`packages/mcp-server/package.json` stays at **`>=18`**.

This is deliberate, not drift:

- **Code reality**: no Node 20-only API is used anywhere. Node 18 runs
  the daemon and every adapter just fine. (Verify: `grep -rn
  "import.meta.resolve\|node:test" packages/*/src` → 0 hits.)
- **Docs recommendation 20**: Node 18 reached EOL in 2025-04 — running
  it in 2026 means no security patches. We recommend the current LTS.
- **`engines: ">=18"` enforcement**: keeping it loose avoids slamming
  the door on users who are still on 18. They get a warning from
  package managers about EOL, not a hard install failure from us.

**Don't "fix" the gap by aligning them.** Bumping `engines` to `>=20`
adds zero technical correctness and only frustrates users who'd
otherwise be successfully running the daemon. Re-evaluate when a real
Node 20-only feature is needed.
