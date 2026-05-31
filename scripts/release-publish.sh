#!/usr/bin/env bash
# Publish workspace packages with the hybrid OIDC + token strategy.
#
# Runs after `changeset version` has updated package.json versions. We pack
# every non-private workspace package and try to publish each tarball:
#
#   Pass A — OIDC (no NODE_AUTH_TOKEN env). Trusted-publisher packages
#            succeed here via the GitHub Actions OIDC token.
#   Pass B — NPM_TOKEN. Picks up anything pass A failed on (no trusted
#            publisher configured, brand-new packages, etc).
#
# Run from repo root. NPM_TOKEN must be exported in env.
set -euo pipefail

# npm dist-tag to publish under. Dual-line releases:
#   main → "latest" (3.x stable)   ·   next → "next" (4.0 prerelease).
# Defaults to "latest" for local/manual runs. CRITICAL: when this is NOT
# "latest", we publish with `--tag <tag>` and NEVER move the `latest` tag — a
# prerelease (e.g. 4.0.0-next.0) must never hijack what `npm install` resolves.
DIST_TAG="${NPM_DIST_TAG:-latest}"
echo "── publishing under dist-tag: ${DIST_TAG} ─────────────────"

ROOT=$(pwd)
TARBALL_DIR=$ROOT/tarballs
rm -rf "$TARBALL_DIR"
mkdir -p "$TARBALL_DIR"

echo "── packing all non-private workspace packages ─────────────"
PUBLISHED=()
REMAINING=()
SKIPPED=()
ALREADY=()

for pkg in packages/*/; do
    is_private=$(node -p "require('./$pkg/package.json').private === true" 2>/dev/null || echo false)
    if [ "$is_private" = "true" ]; then
        echo "  - skipped (private): $pkg"
        continue
    fi
    # Skip packs whose current version is already on the registry — saves a
    # round-trip and prevents the workflow from reporting "no packages
    # published" failure on docs-only / script-only commits where the
    # changesets/action runs `publish` but no versions actually changed.
    pkg_name=$(node -p "require('./$pkg/package.json').name" 2>/dev/null)
    pkg_version=$(node -p "require('./$pkg/package.json').version" 2>/dev/null)
    if [ -n "$pkg_name" ] && [ -n "$pkg_version" ]; then
        existing=$(npm view "$pkg_name@$pkg_version" version 2>/dev/null || true)
        if [ "$existing" = "$pkg_version" ]; then
            ALREADY+=("$pkg_name@$pkg_version")
            continue
        fi
    fi
    ( cd "$pkg" && pnpm pack --pack-destination "$TARBALL_DIR" >/dev/null )
done
ls -la "$TARBALL_DIR" 2>/dev/null || true

# Parse pkg name + version from a tarball's embedded package.json.
extract_pkg() {
    local tgz="$1"
    tar -xzOf "$tgz" package/package.json 2>/dev/null | node -e "
        let data='';process.stdin.on('data',c=>data+=c).on('end',()=>{
            const j=JSON.parse(data);
            process.stdout.write(j.name+'\n'+j.version+'\n');
        });
    " 2>/dev/null
}

# Publish one tarball. Handles the "version-being-published is lower than
# current `latest`" case (npm refuses to implicitly move the `latest` tag
# backwards) by publishing under a staging tag first, then explicitly
# moving `latest` via `npm dist-tag add`.
#
# Args: $1 = tgz path, $2 = "oidc" | "token"
publish_one() {
    # IMPORTANT: never manipulate `set +e` / `set -e` inside this function.
    # bash functions share shell state with the caller, so toggling set -e
    # here defeats the caller's `set +e` wrapper, causing the for-loop to
    # exit on the FIRST failure instead of continuing through all
    # tarballs. Both callers (pass A + pass B) already wrap the call in
    # `set +e`, so we just rely on that.
    local tgz="$1"
    local mode="$2"
    local name version
    { name=$(extract_pkg "$tgz" | head -1); version=$(extract_pkg "$tgz" | tail -1); } 2>/dev/null
    local env_prefix
    if [ "$mode" = "oidc" ]; then
        env_prefix="env -u NODE_AUTH_TOKEN -u npm_config__authToken"
    else
        env_prefix="env NODE_AUTH_TOKEN=$NPM_TOKEN"
    fi

    local output rc
    # For `latest`, publish WITHOUT an explicit --tag — identical to the
    # historical behavior, so the "lower than latest" recovery below still
    # applies. For any other tag (the 4.0 `next` line), publish with --tag and
    # never touch `latest`.
    if [ "$DIST_TAG" = "latest" ]; then
        output=$($env_prefix npm publish "$tgz" --access public --provenance 2>&1)
    else
        output=$($env_prefix npm publish "$tgz" --access public --provenance --tag="$DIST_TAG" 2>&1)
    fi
    rc=$?
    echo "$output"

    if [ $rc -eq 0 ]; then
        return 0
    fi

    # The recovery below only concerns the `latest` tag. A non-latest publish
    # (e.g. 4.0.0-next.x under `next`) never touches `latest`, so bail with the
    # real error instead of running the latest-moving dance.
    if [ "$DIST_TAG" != "latest" ]; then
        return $rc
    fi

    # Detect "version lower than current latest" — npm 11+ message form.
    if echo "$output" | grep -q "Cannot implicitly apply the \"latest\" tag"; then
        echo "  → 'latest' tag is on a higher version; publishing under staging tag then dist-tag override."
        local staging_tag="staging-$(date +%s)"
        $env_prefix npm publish "$tgz" --access public --provenance --tag="$staging_tag"
        rc=$?
        if [ $rc -ne 0 ]; then
            echo "  → staging publish also failed (exit $rc)"
            return $rc
        fi
        if [ -n "$name" ] && [ -n "$version" ]; then
            echo "  → moving latest tag to $name@$version"
            $env_prefix npm dist-tag add "$name@$version" latest
            rc=$?
            if [ $rc -ne 0 ]; then
                echo "  → dist-tag add failed (exit $rc); package is published under $staging_tag only"
            fi
        fi
        return $rc
    fi

    return $rc
}

# Nothing got packed ⇒ every non-private package is already on the registry
# (a docs-only / script-only commit, or a re-run after a successful publish).
# That's success, not failure — exit before the publish loop expands an empty
# glob into the literal "*.tgz" and dies with ENOENT (exit 254).
shopt -s nullglob
_tgzs=("$TARBALL_DIR"/*.tgz)
shopt -u nullglob
if [ ${#_tgzs[@]} -eq 0 ]; then
    echo ""
    echo "── nothing to publish: ${#ALREADY[@]} package(s) already up to date ──"
    exit 0
fi

# Pass A — OIDC (no token).
echo ""
echo "── pass A: OIDC publish ───────────────────────────────────"
for tgz in "$TARBALL_DIR"/*.tgz; do
    name=$(basename "$tgz")
    echo "::group::pass-A $name (OIDC)"
    set +e
    publish_one "$tgz" oidc
    rc=$?
    set -e
    if [ $rc -eq 0 ]; then
        PUBLISHED+=("$name (oidc)")
    else
        REMAINING+=("$tgz")
        echo "  → pass A failed (exit $rc); deferred to pass B"
    fi
    echo "::endgroup::"
done

# Pass B — NPM_TOKEN.
if [ ${#REMAINING[@]} -gt 0 ]; then
    echo ""
    echo "── pass B: token publish (${#REMAINING[@]} remaining) ──────────"
    if [ -z "${NPM_TOKEN:-}" ]; then
        echo "::warning::NPM_TOKEN not set; pass B cannot run."
        for tgz in "${REMAINING[@]}"; do
            SKIPPED+=("$(basename "$tgz") (no NPM_TOKEN)")
        done
    else
        for tgz in "${REMAINING[@]}"; do
            name=$(basename "$tgz")
            echo "::group::pass-B $name (token)"
            set +e
            publish_one "$tgz" token
            rc=$?
            set -e
            if [ $rc -eq 0 ]; then
                PUBLISHED+=("$name (token)")
            else
                SKIPPED+=("$name (token exit $rc)")
                echo "::warning::failed to publish $name on both passes (exit $rc)"
            fi
            echo "::endgroup::"
        done
    fi
fi

echo ""
echo "── publish summary ─────────────────────────────────────────"
echo "published (${#PUBLISHED[@]}):"
for n in "${PUBLISHED[@]}"; do echo "  ✓ $n"; done
if [ ${#ALREADY[@]} -gt 0 ]; then
    echo "already up to date (${#ALREADY[@]}):"
    for n in "${ALREADY[@]}"; do echo "  · $n"; done
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
    echo "skipped (${#SKIPPED[@]}):"
    for n in "${SKIPPED[@]}"; do echo "  ✗ $n"; done
fi

# Don't fail when nothing got published BUT everything is already at its
# registry version (docs-only / script-only commits where Changesets
# correctly produced no version bumps). Fail only when there are real
# skips AND nothing succeeded.
if [ ${#PUBLISHED[@]} -eq 0 ] && [ ${#SKIPPED[@]} -gt 0 ]; then
    echo "::error::no packages published and ${#SKIPPED[@]} skipped"
    exit 1
fi
