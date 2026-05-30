import { describe, expect, it } from 'vitest';
import { generateToken, hashSecret, parseToken, verifySecret } from './tokens.js';

describe('gateway tokens (scrypt, zero native deps)', () => {
    it('hashSecret + verifySecret round-trips', () => {
        const h = hashSecret('s3cr3t');
        expect(verifySecret('s3cr3t', h)).toBe(true);
        expect(verifySecret('wrong', h)).toBe(false);
    });

    it('hash never equals the secret + has salt', () => {
        const h = hashSecret('s3cr3t');
        expect(h.hash).not.toContain('s3cr3t');
        expect(h.salt).toMatch(/^[0-9a-f]+$/);
    });

    it('different secrets / same secret-different-salt → different hashes', () => {
        expect(hashSecret('a').hash).not.toBe(hashSecret('b').hash);
        expect(hashSecret('a').hash).not.toBe(hashSecret('a').hash); // random salt
    });

    it('verifySecret rejects tampered hash/salt without throwing', () => {
        expect(verifySecret('s', { hash: 'zzzz', salt: 'zzzz' })).toBe(false);
        expect(verifySecret('s', { hash: '', salt: '' })).toBe(false);
    });

    it('generateToken → parseToken round-trip', () => {
        const { tokenId, raw, secretHash } = generateToken();
        expect(raw).toMatch(/^hfe_[^.]+\.[^.]+$/);
        const parsed = parseToken(raw);
        expect(parsed?.tokenId).toBe(tokenId);
        expect(verifySecret(parsed!.secret, secretHash)).toBe(true);
    });

    it('parseToken rejects malformed tokens', () => {
        expect(parseToken('nope')).toBeNull();
        expect(parseToken('hfe_')).toBeNull();
        expect(parseToken('hfe_id-no-secret')).toBeNull();
        expect(parseToken('hfe_.secret')).toBeNull();
    });
});
