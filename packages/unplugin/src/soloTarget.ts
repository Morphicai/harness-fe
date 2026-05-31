import { DEFAULT_WS_PORT } from '@harness-fe/protocol';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Decide whether this build is "solo" (a loopback target, no token) and, if so,
 * the (host, port) on which the dev server should auto-spawn / reuse a shared
 * gateway. Returns null for "team" (an explicit token, or a non-loopback /
 * unparseable target) — in which case the plugin must NOT spawn anything; that
 * gateway is deployed and owned elsewhere.
 */
export function resolveSoloTarget(
    mcpUrl: string,
    hasToken: boolean,
): { host: string; port: number } | null {
    if (hasToken) return null;
    try {
        const u = new URL(mcpUrl);
        if (LOOPBACK_HOSTS.has(u.hostname)) {
            return { host: u.hostname, port: u.port ? Number(u.port) : DEFAULT_WS_PORT };
        }
    } catch {
        /* unparseable URL → treat as team (don't spawn) */
    }
    return null;
}
