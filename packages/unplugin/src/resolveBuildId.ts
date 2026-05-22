import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves the buildId for one harness-fe build (vite dev server start /
 * webpack build / prod build). One buildId = one source-code snapshot.
 *
 * Stability rules:
 *   - HMR / file edits within a dev server run → same buildId
 *   - dev server restart → new buildId
 *   - prod build → buildId matches git sha (or dirty-marked)
 *
 * Priority:
 *   1. `userConfig` — caller-supplied via `harnessFE({ buildId })`
 *   2. CI env vars (GITHUB_SHA / GIT_COMMIT) when present
 *   3. `git rev-parse HEAD` + dirty marker when in a git repo
 *   4. Fallback: `dev-<short-source-hash>-<startTs>` derived from package.json,
 *      lockfile, and bundler config — stable for the lifetime of this process.
 */
export interface ResolveBuildIdOptions {
    /** Caller override; wins over all auto-detection. */
    userConfig?: string;
    /** Project root (where package.json lives). */
    root: string;
    /** Stable timestamp to embed in the dev fallback id. Pass `Date.now()`
     *  once at plugin init so this id doesn't change across resolve() calls. */
    startTs?: number;
}

export interface ResolvedBuildId {
    buildId: string;
    gitSha?: string;
    gitDirty?: boolean;
    sourceDigest?: string;
}

export function resolveBuildId(opts: ResolveBuildIdOptions): ResolvedBuildId {
    if (opts.userConfig && opts.userConfig.length > 0) {
        return { buildId: opts.userConfig };
    }

    // CI env vars take precedence over git so docker/CI builds with shallow
    // checkouts still get a meaningful id even when git isn't available.
    const ciSha =
        process.env.GITHUB_SHA ||
        process.env.GIT_COMMIT ||
        process.env.CI_COMMIT_SHA ||
        process.env.BUILDKITE_COMMIT ||
        undefined;
    if (ciSha) {
        return {
            buildId: `${ciSha.slice(0, 12)}-ci`,
            gitSha: ciSha,
            gitDirty: false,
        };
    }

    // Try git locally.
    const gitSha = runGit(['rev-parse', 'HEAD'], opts.root);
    if (gitSha) {
        const dirty = runGit(['status', '--porcelain'], opts.root);
        const gitDirty = dirty !== undefined && dirty.length > 0;
        return {
            buildId: `${gitSha.slice(0, 12)}${gitDirty ? '-dirty' : ''}`,
            gitSha,
            gitDirty,
        };
    }

    // No git, no CI: derive a stable digest from the project's config files
    // and stamp it with the dev-server start timestamp.
    const startTs = opts.startTs ?? Date.now();
    const sourceDigest = hashConfigFiles(opts.root);
    return {
        buildId: `dev-${sourceDigest.slice(0, 8)}-${startTs.toString(36)}`,
        sourceDigest,
    };
}

function runGit(args: string[], cwd: string): string | undefined {
    try {
        const out = spawnSync('git', args, {
            cwd,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1500,
        });
        if (out.status !== 0) return undefined;
        return out.stdout.trim();
    } catch {
        return undefined;
    }
}

/**
 * Hash the contents of the few config files that, when changed, mean a fresh
 * build artifact. Avoids reading every source file — that work belongs to the
 * bundler's own incremental cache.
 */
function hashConfigFiles(root: string): string {
    const candidates = [
        'package.json',
        'pnpm-lock.yaml',
        'package-lock.json',
        'yarn.lock',
        'vite.config.ts',
        'vite.config.js',
        'webpack.config.ts',
        'webpack.config.js',
        'webpack.config.cjs',
        'tsconfig.json',
    ];
    const h = createHash('sha256');
    for (const name of candidates) {
        try {
            h.update(name);
            h.update(readFileSync(join(root, name)));
        } catch {
            // missing file → contribute the name only (still affects hash)
        }
    }
    return h.digest('hex');
}
