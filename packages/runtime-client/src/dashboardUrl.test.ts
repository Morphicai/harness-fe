import { describe, expect, it } from 'vitest';
import { deriveDashboardUrl } from './dashboardUrl.js';

describe('deriveDashboardUrl (pure shortcut — no token)', () => {
    it('swaps ws:// to http:// and points at /console', () => {
        expect(deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729/ws' })).toBe(
            'http://127.0.0.1:47729/console',
        );
    });

    it('swaps wss:// to https:// (production / LAN with TLS)', () => {
        expect(deriveDashboardUrl({ mcpUrl: 'wss://harness.lan:47729/ws' })).toBe(
            'https://harness.lan:47729/console',
        );
    });

    it('deep-links to /console/sessions/:id when sessionId is provided', () => {
        expect(
            deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729/ws?token=abc', sessionId: 'sess-1' }),
        ).toBe('http://127.0.0.1:47729/console/sessions/sess-1');
    });

    it('URL-encodes the session id', () => {
        expect(
            deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729/ws', sessionId: 'a/b c' }),
        ).toBe('http://127.0.0.1:47729/console/sessions/a%2Fb%20c');
    });

    it('never carries the runtime token — it is a navigation shortcut, not an auth grant', () => {
        const url = deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729/ws?token=secret&other=x#h', sessionId: 'sess-1' });
        expect(url).toBe('http://127.0.0.1:47729/console/sessions/sess-1');
        expect(url).not.toContain('token');
        expect(url).not.toContain('secret');
    });

    it('returns undefined for empty or invalid input', () => {
        expect(deriveDashboardUrl({ mcpUrl: '' })).toBeUndefined();
        expect(deriveDashboardUrl({ mcpUrl: 'not-a-url' })).toBeUndefined();
    });
});
