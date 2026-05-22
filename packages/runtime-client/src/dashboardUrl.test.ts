import { describe, expect, it } from 'vitest';
import { deriveDashboardUrl } from './dashboardUrl.js';

describe('deriveDashboardUrl', () => {
    it('swaps ws:// to http:// and points at /dashboard/', () => {
        expect(deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729' })).toBe(
            'http://127.0.0.1:47729/dashboard/',
        );
    });

    it('swaps wss:// to https:// (production / LAN with TLS)', () => {
        expect(deriveDashboardUrl({ mcpUrl: 'wss://harness.lan:47729' })).toBe(
            'https://harness.lan:47729/dashboard/',
        );
    });

    it('carries the token query through verbatim', () => {
        expect(
            deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729?token=abc' }),
        ).toBe('http://127.0.0.1:47729/dashboard/?token=abc');
    });

    it('URL-encodes the token (defensive against weird HARNESS_FE_TOKEN values)', () => {
        expect(
            deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729?token=a%20b%26c' }),
        ).toBe('http://127.0.0.1:47729/dashboard/?token=a%20b%26c');
    });

    it('deep-links to /dashboard/sessions/:id when sessionId is provided', () => {
        expect(
            deriveDashboardUrl({
                mcpUrl: 'ws://127.0.0.1:47729?token=abc',
                sessionId: 'sess-1',
            }),
        ).toBe('http://127.0.0.1:47729/dashboard/sessions/sess-1?token=abc');
    });

    it('URL-encodes the session id', () => {
        expect(
            deriveDashboardUrl({
                mcpUrl: 'ws://127.0.0.1:47729',
                sessionId: 'a/b c',
            }),
        ).toBe('http://127.0.0.1:47729/dashboard/sessions/a%2Fb%20c');
    });

    it('strips other query/hash from the WS URL — only token is forwarded', () => {
        expect(
            deriveDashboardUrl({
                mcpUrl: 'ws://127.0.0.1:47729/?token=abc&other=secret#hash',
            }),
        ).toBe('http://127.0.0.1:47729/dashboard/?token=abc');
    });

    it('returns undefined for empty or invalid input', () => {
        expect(deriveDashboardUrl({ mcpUrl: '' })).toBeUndefined();
        expect(deriveDashboardUrl({ mcpUrl: 'not-a-url' })).toBeUndefined();
    });
});
