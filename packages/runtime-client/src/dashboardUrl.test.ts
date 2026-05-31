import { describe, expect, it } from 'vitest';
import { deriveDashboardUrl } from './dashboardUrl.js';

describe('deriveDashboardUrl', () => {
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

    it('carries the token query through verbatim', () => {
        expect(
            deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729/ws?token=abc' }),
        ).toBe('http://127.0.0.1:47729/console?token=abc');
    });

    it('URL-encodes the token (defensive against weird tokens)', () => {
        expect(
            deriveDashboardUrl({ mcpUrl: 'ws://127.0.0.1:47729/ws?token=a%20b%26c' }),
        ).toBe('http://127.0.0.1:47729/console?token=a%20b%26c');
    });

    it('deep-links to /console/sessions/:id when sessionId is provided', () => {
        expect(
            deriveDashboardUrl({
                mcpUrl: 'ws://127.0.0.1:47729/ws?token=abc',
                sessionId: 'sess-1',
            }),
        ).toBe('http://127.0.0.1:47729/console/sessions/sess-1?token=abc');
    });

    it('URL-encodes the session id', () => {
        expect(
            deriveDashboardUrl({
                mcpUrl: 'ws://127.0.0.1:47729/ws',
                sessionId: 'a/b c',
            }),
        ).toBe('http://127.0.0.1:47729/console/sessions/a%2Fb%20c');
    });

    it('strips other query/hash from the WS URL — only token is forwarded', () => {
        expect(
            deriveDashboardUrl({
                mcpUrl: 'ws://127.0.0.1:47729/ws?token=abc&other=secret#hash',
            }),
        ).toBe('http://127.0.0.1:47729/console?token=abc');
    });

    it('returns undefined for empty or invalid input', () => {
        expect(deriveDashboardUrl({ mcpUrl: '' })).toBeUndefined();
        expect(deriveDashboardUrl({ mcpUrl: 'not-a-url' })).toBeUndefined();
    });
});
