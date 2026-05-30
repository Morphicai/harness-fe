/**
 * Gateway token primitives (5.0 · P6 · C2). Zero native deps — uses node:crypto
 * scrypt (memory-hard) instead of argon2id, per the repo's no-native-postinstall
 * security policy.
 *
 * A raw token is `hfe_<tokenId>.<secret>`: `tokenId` is a public lookup key
 * (stored in clear), `secret` is never stored — only its scrypt hash + salt.
 * Verification looks the row up by `tokenId`, then compares the secret in
 * constant time, so there's no need to scan every token.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TOKEN_PREFIX = 'hfe';
const KEYLEN = 32;
// scrypt cost params (memory-hard). N must be a power of 2.
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

export interface SecretHash {
    hash: string;
    salt: string;
}

export function hashSecret(secret: string): SecretHash {
    const salt = randomBytes(16);
    const derived = scryptSync(secret, salt, KEYLEN, SCRYPT);
    return { hash: derived.toString('hex'), salt: salt.toString('hex') };
}

export function verifySecret(secret: string, stored: SecretHash): boolean {
    let derived: Buffer;
    try {
        derived = scryptSync(secret, Buffer.from(stored.salt, 'hex'), KEYLEN, SCRYPT);
    } catch {
        return false;
    }
    const expected = Buffer.from(stored.hash, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Generate a fresh token: public `tokenId`, the `raw` string to hand out, and the hash to store. */
export function generateToken(): { tokenId: string; raw: string; secretHash: SecretHash } {
    const tokenId = randomBytes(9).toString('base64url');
    const secret = randomBytes(24).toString('base64url');
    const raw = `${TOKEN_PREFIX}_${tokenId}.${secret}`;
    return { tokenId, raw, secretHash: hashSecret(secret) };
}

/** Parse a raw token into its public id + secret, or null if malformed. */
export function parseToken(raw: string): { tokenId: string; secret: string } | null {
    if (typeof raw !== 'string' || !raw.startsWith(`${TOKEN_PREFIX}_`)) return null;
    const body = raw.slice(TOKEN_PREFIX.length + 1);
    const dot = body.indexOf('.');
    if (dot <= 0 || dot >= body.length - 1) return null;
    return { tokenId: body.slice(0, dot), secret: body.slice(dot + 1) };
}
