import { afterEach, describe, expect, it } from 'vitest';
import {
    encryptSessionPayload,
    decryptSessionPayload,
    fingerprintSessionPayload,
    redactSensitiveText
} from '../session-security.js';

const originalKey = process.env.KC_SESSION_ENCRYPTION_KEY;
const originalAlias = process.env.SESSION_ENCRYPTION_KEY;

afterEach(() => {
    if (originalKey === undefined) delete process.env.KC_SESSION_ENCRYPTION_KEY;
    else process.env.KC_SESSION_ENCRYPTION_KEY = originalKey;
    if (originalAlias === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = originalAlias;
});

describe('Session encryption and redaction', () => {
    it('encrypts at rest and decrypts with the configured key', () => {
        process.env.KC_SESSION_ENCRYPTION_KEY = 'test-key-material-0123456789abcdef';
        const raw = '{"accessToken":"secret-token-value"}';
        const encrypted = encryptSessionPayload(raw);
        expect(encrypted).not.toContain('secret-token-value');
        expect(decryptSessionPayload(encrypted)).toBe(raw);
        expect(fingerprintSessionPayload(raw)).toHaveLength(64);
    });

    it('fails closed for absent, weak, or mismatched keys', () => {
        delete process.env.KC_SESSION_ENCRYPTION_KEY;
        delete process.env.SESSION_ENCRYPTION_KEY;
        expect(() => encryptSessionPayload('sensitive')).toThrow(/KC_SESSION_ENCRYPTION_KEY/);
        process.env.KC_SESSION_ENCRYPTION_KEY = 'test-key-material-0123456789abcdef';
        const encrypted = encryptSessionPayload('sensitive');
        process.env.KC_SESSION_ENCRYPTION_KEY = 'different-key-material-0123456789';
        expect(() => decryptSessionPayload(encrypted)).toThrow(/解密失败/);
    });

    it('redacts token, cookie, bearer, JWT and full card number patterns', () => {
        const input = 'Authorization: Bearer abc.defghi\nCookie: session=private; other=x access_token="secret token" eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.qwertyuiop 4242 4242 4242 4242';
        const output = redactSensitiveText(input);
        expect(output).not.toContain('abc.defghi');
        expect(output).not.toContain('session=private');
        expect(output).not.toContain('secret token');
        expect(output).not.toContain('eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.qwertyuiop');
        expect(output).not.toContain('4242 4242 4242 4242');
        expect(output).toContain('[REDACTED]');
        expect(output).not.toContain('eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.qwertyuiop');
        expect(output).not.toContain('4242 4242 4242 4242');
    });
});
