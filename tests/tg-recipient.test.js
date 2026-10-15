'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramProfileClient, parsePublicProfile, normalizeUsername, safeAvatarUrl } = require('../server/tg/recipient-profile');
const { createTgRecipientHandler } = require('../server/api-handlers/public/tg-recipient');

const AVATAR = 'https://cdn4.telesco.pe/file/Abcd_123-xyz.jpg';
function html({ username = 'telegram_user', title = '昵称 &amp; Name &#128640;', avatar = AVATAR, extra = '@telegram_user', action = 'Send Message' } = {}) {
    return `<html><head><meta content="${title}" property="og:title"><meta property='og:image' content='${avatar}'>
    <meta property="og:site_name" content="Telegram"></head><body><div class="tgme_page_title" dir="auto"><span>ignored</span></div>
    <div class="tgme_page_extra">${extra}</div><a href="tg://resolve?domain=${username}">${action}</a></body></html>`;
}
function reply(body, status = 200, type = 'text/html; charset=utf-8') {
    return new Response(body, { status, headers: { 'content-type': type } });
}
function security(rate = { allowed: true }) {
    const calls = [];
    return { calls, resolveClientIp: () => '192.0.2.10', _private: { isProductionLikeRuntime: () => true },
        applyRateLimitHeaders(res) { res.setHeader('X-Test-Limit', '1'); },
        async takeRateLimitToken(options) { calls.push(options); return rate; } };
}
async function call(handler, overrides = {}) {
    const res = { headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = JSON.parse(value); } };
    await handler({ method: 'GET', url: '/api/tg/recipient?username=%40Telegram_User', headers: { origin: 'https://tg.fatherkey.com' }, ...overrides }, res);
    return res;
}

test('profile preview normalizes official usernames and refuses URLs or path injection', () => {
    assert.equal(normalizeUsername(' @Telegram_User '), 'telegram_user');
    for (const input of [null, {}, ['telegram_user'], 'test', '1username', 'user/name', 'https://t.me/testuser', 'a'.repeat(33), '@@telegram_user', 'abc?x=1', 'abc\nxyz']) {
        assert.throws(() => normalizeUsername(input), (error) => error.code === 'invalid_username');
    }
});

test('public profile parsing returns only Unicode nickname, official avatar and normalized identity', () => {
    assert.deepEqual(parsePublicProfile(html(), 'telegram_user'), {
        username: 'telegram_user', display_name: '昵称 & Name 🚀', avatar_url: AVATAR, source: 'telegram_public', recipient_type: 'user'
    });
    const profile = parsePublicProfile(html({ title: '&lt;img src=x onerror=alert(1)&gt;', avatar: 'https://evil.test/profile.png' }), 'telegram_user');
    assert.equal(profile.display_name, '<img src=x onerror=alert(1)>');
    assert.equal(profile.avatar_url, null);
    assert.equal('html' in profile, false);
});

test('missing/private generic Contact pages do not produce a fabricated nickname', () => {
    for (const source of [
        '<meta property="og:title" content="Telegram: Contact @telegram_user"><a href="tg://resolve?domain=telegram_user">Send Message</a>',
        html({ title: 'Telegram: Contact @telegram_user' }), html({ username: 'other_user' }),
        html().replace('content="Telegram"', 'content="Other"')
    ]) assert.throws(() => parsePublicProfile(source, 'telegram_user'), (error) => error.code === 'recipient_not_found');
});

test('avatar URLs are limited to verified HTTPS Telegram CDN images and no generic logo', () => {
    for (const unsafe of [
        'http://cdn4.telesco.pe/file/Abcd.jpg', 'https://cdn4.telesco.pe.evil.test/file/Abcd.jpg',
        'https://evil.test/@cdn4.telesco.pe/file/Abcd.jpg', 'https://secret@cdn4.telesco.pe/file/Abcd.jpg',
        'https://cdn4.telesco.pe:8443/file/Abcd.jpg', 'https://cdn4.telesco.pe/file/Abcd.jpg?secret=123',
        'https://cdn4.telesco.pe/file/Abcd.jpg#x', 'https://cdn4.telesco.pe/file/profile.svg',
        'https://cdn4.telesco.pe/other/Abcd.jpg', 'https://telegram.org/img/t_logo_2x.png', 'data:image/png;base64,abc'
    ]) assert.equal(safeAvatarUrl(unsafe), null, unsafe);
    assert.equal(parsePublicProfile(html({ avatar: '' }), 'telegram_user').avatar_url, null);
});

test('public channel, group, bot and unknown profiles retain an explicit type', () => {
    for (const [extra, action, type] of [
        ['123 subscribers', 'View in Telegram', 'channel'], ['88 members', 'View in Telegram', 'group'],
        ['1 000 monthly users', 'Start Bot', 'bot'], ['', 'Start Bot', 'bot'], ['', 'View in Telegram', 'unknown']
    ]) assert.equal(parsePublicProfile(html({ extra, action }), 'telegram_user').recipient_type, type);
});

test('lookup uses a fixed public GET without credentials, API key or redirect following', async () => {
    const calls = [];
    const client = createTelegramProfileClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return reply(html()); } });
    await client.lookup('@Telegram_User');
    assert.equal(calls[0].url, 'https://t.me/telegram_user');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.headers['x-api-key'], undefined);
    assert.equal(calls[0].options.headers.Cookie, undefined);
    await assert.rejects(client.lookup('https://private.test/secret'), (error) => error.code === 'invalid_username');
    assert.equal(calls.length, 1);
});

test('cached and concurrent lookups reuse the read-only result, then expire', async () => {
    let clock = 1000;
    let calls = 0;
    const client = createTelegramProfileClient({ now: () => clock, fetchImpl: async () => { calls++; return reply(html()); } });
    const [a, b] = await Promise.all([client.lookup('telegram_user'), client.lookup('@Telegram_User')]);
    assert.deepEqual(a, b);
    await client.lookup('telegram_user');
    assert.equal(calls, 1);
    clock += 60_001;
    await client.lookup('telegram_user');
    assert.equal(calls, 2);
});

test('unavailable profiles have short negative cache but transient failures are retried on a later user request', async () => {
    let clock = 1000;
    let calls = 0;
    const client = createTelegramProfileClient({ now: () => clock, fetchImpl: async () => { calls++; return reply('missing', 404); } });
    for (let i = 0; i < 2; i++) await assert.rejects(client.lookup('telegram_user'), (error) => error.code === 'recipient_not_found');
    assert.equal(calls, 1);
    clock += 15_001;
    await assert.rejects(client.lookup('telegram_user'));
    assert.equal(calls, 2);
    const temporary = createTelegramProfileClient({ fetchImpl: async () => { calls++; throw new Error('private-upstream-error'); } });
    for (let i = 0; i < 2; i++) await assert.rejects(temporary.lookup('telegram_user'), (error) => error.code === 'recipient_unavailable' && !error.message.includes('private'));
    assert.equal(calls, 4);
});

test('connection and full body read have a bounded timeout even when custom transport ignores AbortSignal', async () => {
    for (const fetchImpl of [async () => new Promise(() => {}), async () => ({ status: 200, text: async () => new Promise(() => {}) })]) {
        const client = createTelegramProfileClient({ fetchImpl, timeoutMs: 20 });
        await assert.rejects(client.lookup('telegram_user'), (error) => error.code === 'recipient_timeout');
    }
});

test('oversized, wrong-content and redirect/error responses never become public profiles', async () => {
    const responses = [reply('x'.repeat(262145)), reply(html(), 200, 'application/javascript'), reply('', 302), reply('upstream secret', 500)];
    for (const response of responses) {
        const client = createTelegramProfileClient({ fetchImpl: async () => response });
        await assert.rejects(client.lookup('telegram_user'), (error) => error.code === 'recipient_unavailable' && !error.message.includes('secret'));
    }
});

test('recipient endpoint applies persistent per-IP limits and returns no upstream fields or secrets', async () => {
    const guard = security();
    const supabase = {};
    const profile = parsePublicProfile(html(), 'telegram_user');
    const received = [];
    const handler = createTgRecipientHandler({ admin: { getOptionalSupabaseAdmin: () => supabase }, env: { NODE_ENV: 'production' }, requestSecurity: guard,
        profileClient: { async lookup(username) { received.push(username); return profile; } } });
    const result = await call(handler);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { success: true, recipient: profile });
    assert.deepEqual(received, ['telegram_user']);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(guard.calls[0].requirePersistent, true);
    assert.equal(guard.calls[0].supabase, supabase);
    assert.equal(guard.calls[0].limit, 30);
    assert.equal(guard.calls[0].key.includes('192.0.2.10'), false);
});

test('invalid endpoint method, source, duplicate username and malformed input never query Telegram', async () => {
    let calls = 0;
    const guard = security();
    const handler = createTgRecipientHandler({ requestSecurity: guard, profileClient: { async lookup() { calls++; } } });
    for (const [req, expected] of [
        [{ method: 'POST' }, 405], [{ headers: { origin: 'https://evil.test' } }, 403],
        [{ url: '/api/tg/recipient' }, 400], [{ url: '/api/tg/recipient?username=first_user&username=second_user' }, 400],
        [{ url: '/api/tg/recipient?username=%2Fetc%2Fpasswd' }, 400]
    ]) assert.equal((await call(handler, req)).statusCode, expected);
    assert.equal(calls, 0);
    assert.equal(guard.calls.length, 0);
});

test('rate denial and unavailable production limiter fail before upstream access', async () => {
    for (const [rate, status, code] of [[{ allowed: false }, 429, 'rate_limited'], [{ allowed: false, unavailable: true }, 503, 'security_unavailable']]) {
        let calls = 0;
        const result = await call(createTgRecipientHandler({ requestSecurity: security(rate), profileClient: { async lookup() { calls++; } } }));
        assert.equal(result.statusCode, status);
        assert.equal(result.body.code, code);
        assert.equal(calls, 0);
    }
});

test('profile endpoint distinguishes missing, timeout and transient failure without exposing internals', async () => {
    for (const [upstreamCode, expected, publicCode] of [
        ['recipient_not_found', 404, 'recipient_not_found'], ['recipient_timeout', 504, 'recipient_timeout'],
        ['recipient_unavailable', 503, 'recipient_unavailable'], ['secret-internal-error', 503, 'recipient_unavailable']
    ]) {
        const handler = createTgRecipientHandler({ requestSecurity: security(), profileClient: { async lookup() { throw Object.assign(new Error('secret-value'), { code: upstreamCode }); } } });
        const result = await call(handler);
        assert.equal(result.statusCode, expected);
        assert.equal(result.body.code, publicCode);
        assert.equal(JSON.stringify(result.body).includes('secret'), false);
    }
});
