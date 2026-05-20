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

# Pass A — OIDC (no token).
echo ""
echo "── pass A: OIDC publish ───────────────────────────────────"
for tgz in "$TARBALL_DIR"/*.tgz; do
    name=$(basename "$tgz")
    echo "::group::pass-A $name (OIDC)"
    set +e
    env -u NODE_AUTH_TOKEN -u npm_config__authToken \
        npm publish "$tgz" --access public --provenance
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
            NODE_AUTH_TOKEN="$NPM_TOKEN" \
                npm publish "$tgz" --access public --provenance
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
