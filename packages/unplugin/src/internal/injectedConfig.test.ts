import { describe, expect, it } from 'vitest';
import { buildInjectedConfig } from './injectedConfig.js';

const resolved = {
    projectId: 'proj',
    mcpUrl: 'ws://127.0.0.1:47729/ws?token=t',
    buildId: 'build-1',
    displayName: 'My App',
};

describe('buildInjectedConfig (harness-fe#162 — single injection shape)', () => {
    it('carries identity + every option through to the injected config', () => {
        const config = buildInjectedConfig(resolved, {
            parentProjectId: 'parent',
            overlay: false,
            consent: 'session',
            rrwebCheckoutEveryNms: 60_000,
            deferStart: true,
            rrwebBlockSelector: 'wujie-app',
            idbThrottleMs: 250,
        });
        expect(config).toEqual({
            projectId: 'proj',
            mcpUrl: 'ws://127.0.0.1:47729/ws?token=t',
            buildId: 'build-1',
            parentProjectId: 'parent',
            displayName: 'My App',
            overlay: false,
            consent: 'session',
            rrwebCheckoutEveryNms: 60_000,
            deferStart: true,
            rrwebBlockSelector: 'wujie-app',
            idbThrottleMs: 250,
        });
    });

    it('defaults overlay to true and leaves unset knobs undefined', () => {
        const config = buildInjectedConfig(resolved, {});
        expect(config.overlay).toBe(true);
        expect(config.consent).toBeUndefined();
        expect(config.deferStart).toBeUndefined();
        expect(config.rrwebBlockSelector).toBeUndefined();
        expect(config.idbThrottleMs).toBeUndefined();
    });

    it('exposes the same key set regardless of options (vite/webpack cannot drift)', () => {
        const full = buildInjectedConfig(resolved, {
            parentProjectId: 'p',
            overlay: true,
            consent: 'off',
            rrwebCheckoutEveryNms: 1,
            deferStart: false,
            rrwebBlockSelector: 'x',
            idbThrottleMs: 1,
        });
        const empty = buildInjectedConfig(resolved, {});
        expect(Object.keys(full).sort()).toEqual(Object.keys(empty).sort());
    });
});
