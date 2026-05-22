import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
    extractToken,
    isAuthEnabled,
    isAuthorized,
    verifyToken,
} from './auth.js';

function fakeReq(init: { headers?: Record<string, string>; url?: string }): IncomingMessage {
    return {
        headers: init.headers ?? {},
        url: init.url ?? '/',
    } as unknown as IncomingMessage;
}

describe('auth: isAuthEnabled', () => {
    it('disabled when no token', () => {
        expect(isAuthEnabled({})).toBe(false);
        expect(isAuthEnabled({ token: '' })).toBe(false);
    });
    it('enabled with token', () => {
        expect(isAuthEnabled({ token: 'x' })).toBe(true);
    });
});

describe('auth: extractToken', () => {
    it('reads Authorization: Bearer …', () => {
        const req = fakeReq({ headers: { authorization: 'Bearer my-token' } });
        expect(extractToken(req)).toBe('my-token');
    });
    it('reads cookie harnessa_fe_token=…', () => {
        const req = fakeReq({ headers: { cookie: 'other=1; harnessa_fe_token=cookie-tok; bar=2' } });
        expect(extractToken(req)).toBe('cookie-tok');
    });
    it('reads ?token=… query string', () => {
        const req = fakeReq({ url: '/dashboard?foo=1&token=qs-tok&bar=2' });
        expect(extractToken(req)).toBe('qs-tok');
    });
    it('reads WS subprotocol harnessa-fe.token.…', () => {
        const req = fakeReq({
            headers: { 'sec-websocket-protocol': 'json, harnessa-fe.token.ws-tok' },
        });
        expect(extractToken(req)).toBe('ws-tok');
    });
    it('header beats cookie beats query', () => {
        const req = fakeReq({
            headers: { authorization: 'Bearer hdr', cookie: 'harnessa_fe_token=ck' },
            url: '/?token=qs',
        });
        expect(extractToken(req)).toBe('hdr');
    });
    it('returns undefined when none provided', () => {
        expect(extractToken(fakeReq({}))).toBeUndefined();
    });
});

describe('auth: verifyToken (timing-safe)', () => {
    it('matches identical tokens', () => {
        expect(verifyToken('abc', 'abc')).toBe(true);
    });
    it('rejects mismatched tokens', () => {
        expect(verifyToken('abc', 'abd')).toBe(false);
    });
    it('rejects empty/undefined', () => {
        expect(verifyToken(undefined, 'abc')).toBe(false);
        expect(verifyToken('', 'abc')).toBe(false);
        expect(verifyToken('abc', '')).toBe(false);
    });
    it('handles different length safely (no throw)', () => {
        expect(verifyToken('a', 'abcdefg')).toBe(false);
    });
});

describe('auth: isAuthorized', () => {
    it('passes everything when auth disabled', () => {
        expect(isAuthorized(fakeReq({}), {})).toBe(true);
    });
    it('passes valid token via header', () => {
        const req = fakeReq({ headers: { authorization: 'Bearer s3cret' } });
        expect(isAuthorized(req, { token: 's3cret' })).toBe(true);
    });
    it('rejects missing token when auth enabled', () => {
        expect(isAuthorized(fakeReq({}), { token: 's3cret' })).toBe(false);
    });
    it('rejects wrong token', () => {
        const req = fakeReq({ headers: { authorization: 'Bearer nope' } });
        expect(isAuthorized(req, { token: 's3cret' })).toBe(false);
    });
});
