/**
 * Cross-platform "open this URL in the user's default browser" — a tiny
 * wrapper around the OS-native command.
 *
 * Detection rules:
 *   - darwin → `open <url>`
 *   - linux  → `xdg-open <url>`
 *   - win32  → `cmd /c start "" <url>` (the empty title is required, otherwise `start` treats the URL as a title)
 *
 * Escape hatches:
 *   - `HARNESS_FE_HEADLESS=1` short-circuits and returns `false` without
 *     spawning anything — useful when the daemon runs in Docker / CI /
 *     remote host where there's no GUI to open
 *   - any other platform returns `false`
 *
 * The spawned process is detached and stdio'd to ignore so we don't
 * accidentally tie its lifetime to ours.
 */

import { spawn } from 'node:child_process';

export interface OpenBrowserOptions {
    /** Inject an alternate `process.platform` value, for tests. */
    platformOverride?: NodeJS.Platform;
    /** Inject the env lookup, for tests. */
    envOverride?: Record<string, string | undefined>;
    /** Inject the spawn function, for tests. */
    spawnOverride?: typeof spawn;
}

export interface OpenBrowserResult {
    opened: boolean;
    /** Set when `opened` is false to explain why. */
    reason?: string;
}

export function openBrowser(url: string, opts: OpenBrowserOptions = {}): OpenBrowserResult {
    const env = opts.envOverride ?? process.env;
    if (env.HARNESS_FE_HEADLESS === '1') {
        return { opened: false, reason: 'HARNESS_FE_HEADLESS=1' };
    }
    const platform = opts.platformOverride ?? process.platform;
    const spawnFn = opts.spawnOverride ?? spawn;

    let cmd: string;
    let args: string[];
    switch (platform) {
        case 'darwin':
            cmd = 'open';
            args = [url];
            break;
        case 'linux':
            cmd = 'xdg-open';
            args = [url];
            break;
        case 'win32':
            // `start` is a cmd builtin, not a standalone exe. The first
            // empty-string arg is the window title — required, because
            // otherwise `start "https://…"` treats the URL as the title
            // and never opens anything.
            cmd = 'cmd';
            args = ['/c', 'start', '', url];
            break;
        default:
            return { opened: false, reason: `unsupported platform: ${platform}` };
    }

    try {
        const child = spawnFn(cmd, args, {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
        return { opened: true };
    } catch (err) {
        return {
            opened: false,
            reason: err instanceof Error ? err.message : String(err),
        };
    }
}
