/**
 * Single source of truth for the `window.__HARNESS_FE__` config object that
 * build plugins plant on the page and the runtime client reads back via
 * `readInjectedConfig()`.
 *
 * Both the Vite/unplugin core and the native webpack plugin build this object;
 * keeping the shape here stops the two injection sites from drifting (they
 * previously diverged — webpack omitted `overlay`/`consent`, and neither
 * plumbed the rrweb / perf knobs). See harness-fe#162.
 *
 * `userId` is intentionally absent: there is no build-time source for it. It
 * arrives only via the SSR `<HarnessScript>` seed and is merged by the client.
 */

import type { HarnessFEOptions } from './types.js';

/** The serialized config planted on `window.__HARNESS_FE__`. */
export interface InjectedHarnessConfig {
    projectId: string;
    mcpUrl: string;
    buildId?: string;
    parentProjectId?: string;
    displayName?: string;
    overlay?: boolean;
    consent?: HarnessFEOptions['consent'];
    rrwebCheckoutEveryNms?: number;
    deferStart?: boolean;
    rrwebBlockSelector?: string;
    idbThrottleMs?: number;
}

/** Values the plugin resolves lazily (project root / git / package.json). */
export interface ResolvedInjectedInputs {
    projectId: string;
    mcpUrl: string;
    buildId?: string;
    displayName?: string;
}

/**
 * Merge plugin-resolved identity with user options into the injected config.
 * Used by both build plugins so the field set never drifts.
 */
export function buildInjectedConfig(
    resolved: ResolvedInjectedInputs,
    options: HarnessFEOptions,
): InjectedHarnessConfig {
    return {
        projectId: resolved.projectId,
        mcpUrl: resolved.mcpUrl,
        buildId: resolved.buildId,
        parentProjectId: options.parentProjectId,
        displayName: resolved.displayName,
        overlay: options.overlay ?? true,
        consent: options.consent,
        rrwebCheckoutEveryNms: options.rrwebCheckoutEveryNms,
        deferStart: options.deferStart,
        rrwebBlockSelector: options.rrwebBlockSelector,
        idbThrottleMs: options.idbThrottleMs,
    };
}
