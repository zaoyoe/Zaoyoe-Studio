import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const { extractGrokCredential, isValidGrokCredential, parseCookieString, grokSessionCookieHeader } = require('../grok-auth');
const { extractSessionPreview, extractEmailFromSession } = require('../session-auth');

describe('Grok Auth & Session Recognition', () => {
    const PROFILE_ONLY_SESSION = JSON.stringify({
        status: 'authenticated',
        session: {
            userId: '11111111-1111-4111-8111-111111111111',
            sessionId: '22222222-2222-4222-8222-222222222222',
            email: 'offline@example.test'
        }
    });

    it('correctly extracts credential from grok.com/api/auth/session JSON string', () => {
        const cred = extractGrokCredential(PROFILE_ONLY_SESSION);
        expect(cred.type).toBe('grok_session');
        expect(cred.sessionId).toBe('22222222-2222-4222-8222-222222222222');
        expect(cred.userId).toBe('11111111-1111-4111-8111-111111111111');
        expect(cred.email).toBe('offline@example.test');
        expect(cred.value).toBe('22222222-2222-4222-8222-222222222222');
        expect(isValidGrokCredential(PROFILE_ONLY_SESSION)).toBe(false);
    });

    it('correctly extracts credential from parsed object', () => {
        const obj = JSON.parse(PROFILE_ONLY_SESSION);
        const cred = extractGrokCredential(obj);
        expect(cred.type).toBe('grok_session');
        expect(cred.email).toBe('offline@example.test');
        expect(isValidGrokCredential(obj)).toBe(false);
    });

    it('recognizes 40-character X auth_token', () => {
        const token = '1234567890abcdef1234567890abcdef12345678';
        const cred = extractGrokCredential(token);
        expect(cred.type).toBe('x_auth_token');
        expect(cred.value).toBe(token);
        expect(isValidGrokCredential(token)).toBe(true);
    });

    it('recognizes Cookie string containing auth_token', () => {
        const cookie = 'guest_id=v1%3A123; auth_token=1234567890abcdef1234567890abcdef12345678; ct0=xyz';
        const cred = extractGrokCredential(cookie);
        expect(cred.type).toBe('x_auth_token');
        expect(cred.value).toBe('1234567890abcdef1234567890abcdef12345678');
        expect(isValidGrokCredential(cookie)).toBe(true);
    });

    it('recognizes Cookie string containing __Secure-next-auth.session-token', () => {
        const cookie = '__Secure-next-auth.session-token=de41bafc-d44f-4bcb-8017-c25828474491; Path=/; Secure';
        const cred = extractGrokCredential(cookie);
        expect(cred.type).toBe('grok_session');
        expect(cred.value).toBe('de41bafc-d44f-4bcb-8017-c25828474491');
        expect(isValidGrokCredential(cookie)).toBe(true);
    });

    it('recognizes multi-cookie string from DevTools Network header', () => {
        const raw = 'sso=mock_sso_token_12345; grok_device_id=device_999; __Secure-next-auth.session-token=mock_session_456; cf_clearance=cf123';
        const cred = extractGrokCredential(raw);
        expect(cred.type).toBe('grok_cookie');
        expect(cred.cookies.length).toBe(4);
        expect(isValidGrokCredential(raw)).toBe(true);
    });

    it('recognizes Cookie-Editor exported JSON array', () => {
        const cookies = [
            { name: 'sso', value: 'sso_val_123', domain: '.grok.com' },
            { name: 'session-token', value: 'token_val_456', domain: '.grok.com' }
        ];
        const cred = extractGrokCredential(cookies);
        expect(cred.type).toBe('grok_cookie');
        expect(cred.cookies.length).toBe(2);
        expect(isValidGrokCredential(cookies)).toBe(true);
    });

    it('recognizes Grok SSO JWT token and decodes sessionId', () => {
        const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ session_id: '22222222-2222-4222-8222-222222222222' })).toString('base64url')}.offline_signature`;
        const cred = extractGrokCredential(jwt);
        expect(cred.type).toBe('grok_session');
        expect(cred.value).toBe(jwt);
        expect(cred.sessionId).toBe('22222222-2222-4222-8222-222222222222');
        expect(isValidGrokCredential(jwt)).toBe(true);
    });

    it('extractSessionPreview and extractEmailFromSession return user email', () => {
        expect(extractEmailFromSession(PROFILE_ONLY_SESSION)).toBe('offline@example.test');
        expect(extractSessionPreview(PROFILE_ONLY_SESSION)).toBe('offline@example.test');
    });

    it('rejects invalid or blank credentials', () => {
        expect(isValidGrokCredential('')).toBe(false);
        expect(isValidGrokCredential(null)).toBe(false);
        expect(isValidGrokCredential('abc')).toBe(false);
        expect(isValidGrokCredential('{"foo":"bar"}')).toBe(false);
        expect(isValidGrokCredential('{"some_long_profile_field":"offline-profile"}')).toBe(false);
    });

    it('recognizes an explicit login cookie even when accompanied by profile metadata', () => {
        const raw = { ...JSON.parse(PROFILE_ONLY_SESSION), sso: 'offline-token' };
        expect(extractGrokCredential(raw)).toMatchObject({ value: 'offline-token', email: 'offline@example.test' });
        expect(isValidGrokCredential(raw)).toBe(true);
    });
    it('recognizes a complete X header and removes Set-Cookie attributes', () => {
        const token = 'a'.repeat(40);
        expect(extractGrokCredential(`Cookie: auth_token=${token}; ct0=offline-csrf`).cookies)
            .toContainEqual({ name: 'ct0', value: 'offline-csrf', domain: '.x.com', path: '/' });
        expect(parseCookieString('sso=offline-token; Domain=.grok.com; Path=/; Secure; SameSite=Lax')).toEqual([
            { name: 'sso', value: 'offline-token', domain: '.grok.com', path: '/' }
        ]);
        expect(isValidGrokCredential([{ name: 'grok_device_id', value: 'offline-device' }])).toBe(false);
        expect(isValidGrokCredential({ sso: 'x' })).toBe(false);
    });

    it('sends only cookies applicable to the official session endpoint', () => {
        const cookies = [
            { name: 'sso', value: 'offline-token', domain: '.grok.com', path: '/' },
            { name: 'session', value: 'endpoint-token', domain: 'grok.com', path: '/api/auth' },
            { name: 'foreign', value: 'foreign-token', domain: '.example.test' },
            { name: 'sso', value: 'xai-only-token', domain: '.x.ai' },
            { name: 'subdomain', value: 'subdomain-token', domain: 'accounts.grok.com' },
            { name: 'other_path', value: 'path-token', domain: 'grok.com', path: '/plans' },
            { name: 'path_prefix', value: 'path-token', domain: 'grok.com', path: '/api/aut' },
            { name: 'expired', value: 'old-token', domain: 'grok.com', expirationDate: 1 },
            { name: 'url_foreign', value: 'foreign-token', url: 'https://example.test' },
            { name: 'injection', value: 'value; injected=token', domain: 'grok.com' },
            { name: 'bad\r\nname', value: 'token', domain: 'grok.com' },
            null
        ];
        expect(grokSessionCookieHeader(cookies)).toBe('session=endpoint-token; sso=offline-token');
        expect(grokSessionCookieHeader([{ name: 'sso', value: 'offline-token', domain: '.x.ai' }])).toBe('');
    });

    it('rejects foreign-site X tokens and short exported login cookies', () => {
        expect(isValidGrokCredential([{ name: 'auth_token', value: 'a'.repeat(40), domain: '.example.test' }])).toBe(false);
        expect(isValidGrokCredential([{ name: 'auth_token', value: 'a'.repeat(40), url: 'https://example.test' }])).toBe(false);
        expect(isValidGrokCredential([{ name: 'sso', value: 'x', domain: '.grok.com' }])).toBe(false);
        expect(isValidGrokCredential('device=offline_device_12345')).toBe(false);
        expect(isValidGrokCredential('curl https://grok.com -H "Accept: application/json"')).toBe(false);
    });

    it('keeps explicit cookie names paired with their own token values', () => {
        expect(extractGrokCredential({ sessionToken: 'offline-sso-token', '__Secure-next-auth.session-token': 'offline-nextauth-token' }).cookies)
            .toEqual([{ name: 'sso', value: 'offline-sso-token', domain: '.grok.com', path: '/' }]);
        expect(isValidGrokCredential('sso-rw=offline-sso-token')).toBe(true);
        expect(isValidGrokCredential('__Secure-next-auth.session-token.0=offline-chunk-token')).toBe(true);
    });

    it('applies the same credential acceptance rules in the frontend and backend', () => {
        const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
        const start = html.indexOf('        function validateSessionInput(');
        const source = html.slice(start, html.indexOf('\n        let probeDebounceTimer', start));
        const validate = vm.runInNewContext(`${source}\nvalidateSessionInput`, {
            currentPlatform: 'grok', URL, decodeJwtPart: value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
        });
        const values = [
            '', 'abc', PROFILE_ONLY_SESSION, '{"some_long_profile_field":"offline-profile"}',
            'a'.repeat(40), 'offline-opaque-token-123', 'sso=offline-token', 'sso=x', 'sso-rw=offline-token',
            '__Secure-next-auth.session-token.0=offline-chunk-token', 'device=offline_device_12345',
            'curl https://grok.com -H "Accept: application/json"',
            'curl https://grok.com -H "Cookie: sso=offline-token; device=offline-device"',
            `Cookie: auth_token=${'a'.repeat(40)}; ct0=offline-csrf`,
            JSON.stringify([{ name: 'sso', value: 'offline-token', domain: '.grok.com' }]),
            JSON.stringify([{ name: 'sso', value: 'x', domain: '.grok.com' }]),
            JSON.stringify([{ name: 'device', value: 'offline-device' }]),
            JSON.stringify([{ name: 'auth_token', value: 'a'.repeat(40), domain: '.example.test' }]),
            JSON.stringify([{ name: 'sso', value: 'offline-token', url: 'https://example.test' }]),
            JSON.stringify([null]), JSON.stringify({ cookies: [], sso: 'offline-token' }),
            JSON.stringify({ authToken: 'x' }), JSON.stringify({ sso: 'x' }),
            JSON.stringify({ sso: 'offline-token', email: 'offline@example.test' })
        ];
        for (const raw of values) {
            expect(validate(raw, { silent: true }).valid, raw).toBe(isValidGrokCredential(raw));
        }
    });
});
