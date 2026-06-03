# Release flow

> **注：** 文档中个别包名（`@harness-fe/mcp-server`）为旧 3.x 名称，流程本身（changesets dual-line、Version PR BLOCKED gotcha、`--tag next` footgun）仍然准确。

How packages get from a merged PR to npm, and the one gotcha that can wedge the
pipeline. For **what semver bump to choose**, see
[versioning-policy.md](../versioning-policy.md); this doc is the operational
mechanics.

## TL;DR

Releases are [Changesets](https://github.com/changesets/changesets)-driven and
run entirely in `.github/workflows/release.yml`, triggered only on `push: main`.
It's one workflow with **two modes**:

```
feature PR (contains .changeset/*.md)
        │  merge to main
        ▼
Release workflow run ①  ── pending changesets exist?  → YES = "version" mode
        │
        ▼
opens / updates the "chore(release): version packages" PR
   (bot branch `changeset-release/main`: bumps package.json,
    writes CHANGELOG, deletes the consumed .changeset/*.md)
        │  you review the version diff, then merge this Version PR to main
        ▼
Release workflow run ②  ── pending changesets exist?  → NO = "publish" mode
        │
        ▼
`pnpm release` publishes changed packages to npm
   (OIDC trusted publishing, NPM_TOKEN fallback) + creates a GitHub Release
```

The **human gate is the Version PR** (read the diff, merge to ship) — not a tag.

## Shipping a change, step by step

1. In your feature PR: `pnpm changeset`, pick the packages + bump level, commit
   the generated `.changeset/<name>.md`. (Bump level → see
   [versioning-policy.md](../versioning-policy.md).)
2. Merge the feature PR into `main`.
3. The Release workflow opens/updates the **Version Packages PR** with all
   pending bumps.
4. Review the resulting versions in that PR's diff — confirm the
   `## X.Y.Z` headings, *especially* that a linked-group unification didn't turn
   a `minor` into a `major`. Merge it.
5. On that merge, the workflow flips to **publish** mode and ships to npm.

## Linked versions

Core packages are **linked** (`.changeset/config.json`), so they all bump to the
same version number on every release — one package's `minor` pulls the whole
group to that version. This is why e.g. `@harness-fe/mcp-server` can jump
`3.2.0 → 3.4.0` (skipping 3.3.0) to stay aligned with `@harness-fe/runtime`.
Details + the major-risk it creates: [versioning-policy.md](../versioning-policy.md).

## Parallel lines: 3.x stable + 4.0 experimental

Two release lines develop **in parallel** off two branches, each with its own
npm dist-tag. The same `release.yml` drives both (it triggers on `push: main`
**and** `push: next`).

| Branch | npm dist-tag | Versions | What |
|---|---|---|---|
| `main` | `latest` | `3.x.y` | Stable personal dev tool. `npm i @harness-fe/runtime` resolves here. |
| `next` | `next` | `4.0.0-next.N` | 4.0 experimental, Changesets **prerelease** mode. `npm i @harness-fe/runtime@next`. |

**dist-tag selection.** `release.yml` sets `NPM_DIST_TAG` from the branch
(`next` → `next`, anything else → `latest`) and `scripts/release-publish.sh`
publishes with it. **Critical invariant:** for any tag other than `latest`, the
publish script publishes with `--tag <tag>` and **never** runs
`npm dist-tag add … latest` — a `4.0.0-next.x` build can never hijack what plain
`npm install` resolves. (For `latest` the script keeps its historical implicit
behavior, including the "version lower than latest → staging tag" recovery.)

**Entering prerelease mode (on `next`, once):**
```bash
git switch next
pnpm changeset pre enter next   # writes .changeset/pre.json
git commit -am "chore: enter 4.0 prerelease mode"
```
From then on, `pnpm version-packages` on `next` produces `4.0.0-next.N`. To cut
the stable `4.0.0`, `pnpm changeset pre exit` on `next` and merge.

**Hard rules:**
- `.changeset/pre.json` lives **only on `next`**. If it lands on `main`, main's
  releases silently become prereleases. CI guards this (`ci.yml` fails when
  `pre.json` is present on a `main` push / PR into `main`).
- **Never merge `next` → `main`** — it would drag `pre.json` + breaking 4.0
  changes into the stable line. Forward-port the other way: land shared fixes on
  `main`, then periodically merge `main` → `next` (or cherry-pick) so 4.0 keeps
  the 3.x fixes.
- Each line has its own Version PR branch: `changeset-release/main` vs
  `changeset-release/next` — they don't collide.

## The gotcha: a permanently `BLOCKED` Version PR

### Symptom

The "chore(release): version packages" PR sits at `mergeStateStatus = BLOCKED`
and can't be merged by anyone but an admin. Inspecting it shows **zero status
checks** ever ran on the `changeset-release/main` branch.

### Root cause (a structural deadlock)

Two mechanisms collide:

1. The **"Protect main" ruleset** requires the status check
   `Lint / Typecheck / Test / Build` (produced by `ci.yml` on `pull_request`).
2. The Version PR is opened by **`GITHUB_TOKEN`**, and GitHub's anti-recursion
   rule means **events triggered by `GITHUB_TOKEN` (push / pull_request) do not
   trigger new workflow runs**.

So CI never runs on the Version PR → the required check never appears → the PR
can never satisfy the ruleset. The only escape was an **admin bypass merge**
(the ruleset grants `RepositoryRole: admin → bypass: always`). Earlier releases
likely shipped via that bypass; the deadlock was never fixed at the source.

### The fix (in `release.yml`, no secret required)

The Release job **already runs the identical Typecheck / Build / Test** before
the changesets step (a failure aborts the job first), and the bot branch only
layers mechanical version/CHANGELOG bumps onto that verified `main` commit.

So, **in version-PR mode only**, the workflow posts that result onto the bot
branch's HEAD (`changeset-release/<current-branch>`, so it works for both the
`main` and `next` lines) under the exact required context via the **statuses
API**:

```yaml
- name: Mark Version PR required check
  if: steps.changesets.outputs.published != 'true' && steps.changesets.outputs.hasChangesets == 'true'
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    BOT_BRANCH="changeset-release/${{ github.ref_name }}"
    git fetch origin "$BOT_BRANCH"
    SHA=$(git rev-parse "origin/${BOT_BRANCH}")
    gh api -X POST "repos/${{ github.repository }}/statuses/${SHA}" \
      -f state=success \
      -f context="Lint / Typecheck / Test / Build" \
      -f description="Verified in Release workflow (version bumps only)" \
      -f target_url="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

Why this works and is honest, not a bypass:

- Posting a **commit status** with `GITHUB_TOKEN` is allowed — the anti-recursion
  rule restricts *triggering workflows*, not writing statuses.
- The ruleset matches `required_status_checks` purely by **context string** (no
  `integration_id` pin), so a posted status satisfies it.
- The status is only posted **after** the real Typecheck/Build/Test pass in the
  same run, and the bot branch differs from the verified commit only by version
  numbers + CHANGELOG — nothing that can affect the build.
- It runs **only in version mode**, never on a publish run.
- Needs the workflow permission `statuses: write`.

### Rejected alternatives

- **Add `changeset-release/main` to `ci.yml`'s push triggers** — useless: the
  bot's push is also `GITHUB_TOKEN`, so it doesn't trigger CI either.
- **Give changesets a PAT / GitHub App token** — the textbook fix; makes the
  Version PR trigger *real* CI. Rejected here only to avoid maintaining a secret
  (PATs expire and widen the permission surface). Layer it on later if we ever
  want true CI on the Version PR rather than a mirrored status.

## If a Version PR is already wedged

1. The fix above auto-applies on the **next** Release run (any push to `main`,
   or a manual re-run of the latest Release run) — it posts the check onto the
   existing bot branch HEAD, unblocking the open Version PR. No need to close it.
2. As a one-off, an admin can still bypass-merge it.
