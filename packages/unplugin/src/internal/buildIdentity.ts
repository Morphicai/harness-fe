/**
 * Lazy resolvers for build-time identity metadata (buildId, displayName).
 *
 * Both are deferred until first read because the host bundler may not have
 * resolved `projectRoot` at plugin instantiation time.
 */

import { createRequire } from 'node:module';
import { resolveBuildId } from '../resolveBuildId.js';

const require = createRequire(import.meta.url);

export interface BuildIdentityOptions {
    userBuildId?: string;
    userDisplayName?: string;
    /** Captured once so dev-mode fallback ids stay stable across re-reads. */
    startTs?: number;
}

export interface BuildIdentity {
    getBuildId(root: string): string;
    getDisplayName(root: string): string | undefined;
}

export function createBuildIdentity(opts: BuildIdentityOptions = {}): BuildIdentity {
    const startTs = opts.startTs ?? Date.now();
    let resolvedBuild: ReturnType<typeof resolveBuildId> | undefined;
    let resolvedDisplayName: string | undefined = opts.userDisplayName;
    let displayNameResolved = opts.userDisplayName !== undefined;

    return {
        getBuildId(root: string): string {
            if (resolvedBuild) return resolvedBuild.buildId;
            resolvedBuild = resolveBuildId({
                userConfig: opts.userBuildId,
                root,
                startTs,
            });
            return resolvedBuild.buildId;
        },
        getDisplayName(root: string): string | undefined {
            if (displayNameResolved) return resolvedDisplayName;
            displayNameResolved = true;
            try {
                const pkg = JSON.parse(
                    require('node:fs').readFileSync(
                        require('node:path').join(root, 'package.json'),
                        'utf-8',
                    ),
                ) as { name?: string };
                resolvedDisplayName = pkg.name;
            } catch {
                resolvedDisplayName = undefined;
            }
            return resolvedDisplayName;
        },
    };
}

/** Append `?token=…` (or `&token=…`) onto a URL, idempotent on empty token. */
export function appendTokenQuery(url: string, token: string | undefined): string {
    if (!token) return url;
    if (/[?&]token=/.test(url)) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
}
