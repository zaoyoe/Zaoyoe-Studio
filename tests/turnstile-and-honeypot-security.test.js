const test = require('node:test');
const assert = require('node:assert/strict');
const {
    verifyTurnstileToken,
    verifyHoneypotAndTiming,
    isTokenReplayed,
    markTokenUsed,
    clearUsedTokensForTest
} = require('../api/_lib/turnstile');

test('verifyHoneypotAndTiming: passes when trap is empty and time is sufficient', () => {
    const result = verifyHoneypotAndTiming({
        trapValue: '',
        renderedAt: Date.now() - 1500,
        minDurationMs: 500
    });
    assert.equal(result.pass, true);
});

test('verifyHoneypotAndTiming: rejects when bot fills honeypot field', () => {
    const result = verifyHoneypotAndTiming({
        trapValue: 'spam_bot_input',
        renderedAt: Date.now() - 2000,
        minDurationMs: 500
    });
    assert.equal(result.pass, false);
    assert.equal(result.reason, 'HONEYPOT_TRAP_TRIGGERED');
});

test('verifyHoneypotAndTiming: rejects when form is submitted instantaneously', () => {
    const result = verifyHoneypotAndTiming({
        trapValue: '',
        renderedAt: Date.now() - 100, // 100ms
        minDurationMs: 500
    });
    assert.equal(result.pass, false);
    assert.equal(result.reason, 'SUBMIT_TOO_FAST');
});

test('verifyTurnstileToken: fails closed in production when secret is missing', async () => {
    const result = await verifyTurnstileToken('valid-token-123', {
        secretKey: '',
        isProduction: true
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'TURNSTILE_SECRET_NOT_CONFIGURED');
});

test('verifyTurnstileToken: simulated pass in development when secret is missing', async () => {
    const result = await verifyTurnstileToken('any-token', {
        secretKey: '',
        isProduction: false
    });
    assert.equal(result.success, true);
    assert.equal(result.simulated, true);
});

test('verifyTurnstileToken: rejects when token is missing', async () => {
    const result = await verifyTurnstileToken('', {
        secretKey: '0x4AAAAAAAbcdefgh',
        isProduction: true
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'MISSING_CAPTCHA_TOKEN');
});

test('verifyTurnstileToken: successful validation against Cloudflare endpoint', async () => {
    clearUsedTokensForTest();

    const mockFetch = async (url, options) => {
        assert.ok(url.includes('challenges.cloudflare.com/turnstile/v0/siteverify'));
        const body = options.body;
        assert.ok(body.includes('secret=0x4AAAAAAAbcdefgh'));
        assert.ok(body.includes('response=valid-token-xyz'));

        return {
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                challenge_ts: '2026-11-07T09:00:00.000Z',
                hostname: 'www.fatherkey.com',
                action: 'login'
            })
        };
    };

    const result = await verifyTurnstileToken('valid-token-xyz', {
        secretKey: '0x4AAAAAAAbcdefgh',
        clientIp: '1.2.3.4',
        fetchImpl: mockFetch,
        isProduction: true
    });

    assert.equal(result.success, true);
    assert.equal(result.hostname, 'www.fatherkey.com');
});

test('verifyTurnstileToken: defends against token replay attacks', async () => {
    clearUsedTokensForTest();

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            success: true,
            challenge_ts: '2026-11-07T09:00:00.000Z',
            hostname: 'www.fatherkey.com'
        })
    });

    // First use: should pass
    const firstResult = await verifyTurnstileToken('replay-token-test', {
        secretKey: '0x4AAAAAAAbcdefgh',
        fetchImpl: mockFetch,
        isProduction: true
    });
    assert.equal(firstResult.success, true);

    // Second use: must be blocked as replayed token!
    const secondResult = await verifyTurnstileToken('replay-token-test', {
        secretKey: '0x4AAAAAAAbcdefgh',
        fetchImpl: mockFetch,
        isProduction: true
    });
    assert.equal(secondResult.success, false);
    assert.equal(secondResult.error, 'CAPTCHA_TOKEN_REPLAYED');
});

test('verifyTurnstileToken: handles Cloudflare upstream validation rejection', async () => {
    clearUsedTokensForTest();

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            success: false,
            'error-codes': ['invalid-input-response']
        })
    });

    const result = await verifyTurnstileToken('invalid-bot-token', {
        secretKey: '0x4AAAAAAAbcdefgh',
        fetchImpl: mockFetch,
        isProduction: true
    });

    assert.equal(result.success, false);
    assert.equal(result.error, 'CAPTCHA_VERIFICATION_FAILED');
    assert.deepEqual(result.errorCodes, ['invalid-input-response']);
});

test('turnstile-client contracts: auto-dismiss on verification success and collapse styling', () => {
    const fs = require('node:fs');
    const path = require('node:path');

    const clientSrc = fs.readFileSync(path.resolve(__dirname, '../js/turnstile-client.js'), 'utf8');
    const cssSrc = fs.readFileSync(path.resolve(__dirname, '../css/auth-sheet.css'), 'utf8');
    const injectAuthSrc = fs.readFileSync(path.resolve(__dirname, '../inject-auth.js'), 'utf8');

    // 1. Client has auto-dismiss timer and class trigger
    assert.match(clientSrc, /scheduleAutoDismiss/);
    assert.match(clientSrc, /is-dismissed/);
    assert.match(clientSrc, /restoreContainerVisibility/);

    // 2. CSS specifies smooth collapse to 0 height
    assert.match(cssSrc, /\.auth-turnstile-slot\.is-dismissed\s*\{[^}]*max-height:\s*0/);
    assert.match(cssSrc, /\.auth-turnstile-slot\.is-dismissed\s*\{[^}]*opacity:\s*0/);

    // 3. Inject-auth mounts Turnstile with autoDismiss enabled
    assert.match(injectAuthSrc, /autoDismiss:\s*true/);
});

