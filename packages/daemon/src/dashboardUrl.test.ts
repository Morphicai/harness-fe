import { describe, expect, it } from 'vitest';
import { buildDashboardUrl } from './dashboardUrl.js';
import type { IBridge } from './bridge.js';

function makeBridge(opts: { base?: string; token?: string }): IBridge {
    return {
        getViewerBaseUrl: () => opts.base,
        getAuthToken: () => opts.token,
    } as unknown as IBridge;
}

describe('buildDashboardUrl', () => {
    it('returns the project-list URL with token when both are set', () => {
        const bridge = makeBridge({ base: 'http://127.0.0.1:47729', token: 'abc' });
        expect(buildDashboardUrl(bridge)).toBe('http://127.0.0.1:47729/dashboard/?token=abc');
    });

    it('deep-links into a session detail when sessionId is provided', () => {
        const bridge = makeBridge({ base: 'http://127.0.0.1:47729', token: 'abc' });
        expect(buildDashboardUrl(bridge, { sessionId: 'sess-1' })).toBe(
            'http://127.0.0.1:47729/dashboard/sessions/sess-1?token=abc',
        );
    });

    it('URL-encodes the session id', () => {
        const bridge = makeBridge({ base: 'http://127.0.0.1:47729', token: 'tok' });
        expect(buildDashboardUrl(bridge, { sessionId: 'a/b c' })).toBe(
            'http://127.0.0.1:47729/dashboard/sessions/a%2Fb%20c?token=tok',
        );
    });

    it('omits the token query when no token is configured', () => {
        const bridge = makeBridge({ base: 'http://127.0.0.1:47729' });
        expect(buildDashboardUrl(bridge)).toBe('http://127.0.0.1:47729/dashboard/');
    });

    it('returns undefined when the bridge has no base URL (no bound port yet)', () => {
        const bridge = makeBridge({});
        expect(buildDashboardUrl(bridge)).toBeUndefined();
    });

    it('URL-encodes the token (defensive against weird characters in HARNESS_FE_TOKEN)', () => {
        const bridge = makeBridge({ base: 'http://127.0.0.1:47729', token: 'a b&c' });
        expect(buildDashboardUrl(bridge)).toBe('http://127.0.0.1:47729/dashboard/?token=a%20b%26c');
    });
});
