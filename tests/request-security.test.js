const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ipMatchesCidr,
    isIpAllowed,
    normalizeIp,
    resolveClientIp,
    takeRateLimitToken,
    _private
} = require('../api/_lib/request-security');

test('normalizeIp trims ports, forwarded wrappers, and IPv4-mapped IPv6 prefixes', () => {
    assert.equal(normalizeIp(' ::ffff:203.0.113.8 '), '203.0.113.8');
    assert.equal(normalizeIp('[2001:db8::1]:443'), '2001:db8::1');
    assert.equal(normalizeIp('for="[2001:db8::5]"'), '2001:db8::5');
    assert.equal(normalizeIp('198.51.100.2:8443'), '198.51.100.2');
});

test('ip allowlist matching supports exact IPv4, IPv6, and CIDR rules', () => {
    assert.equal(isIpAllowed('203.0.113.12', '203.0.113.12'), true);
    assert.equal(isIpAllowed('203.0.113.12', '203.0.113.0/24'), true);
    assert.equal(ipMatchesCidr('2001:db8::4', '2001:db8::/64'), true);
    assert.equal(isIpAllowed('2001:db8::4', ['2001:db8::/64']), true);
    assert.equal(isIpAllowed('198.51.100.8', '203.0.113.0/24'), false);
});

test('resolveClientIp trusts forwarded headers when the direct peer is trusted', () => {
    const req = {
        headers: {
            'x-forwarded-for': '198.51.100.23, 10.0.0.2'
        },
        socket: {
            remoteAddress: '10.0.0.2'
        }
    };

    assert.equal(resolveClientIp(req, { env: {} }), '198.51.100.23');
    assert.equal(resolveClientIp(req, { env: { TRUST_ALL_PROXIES: 'false' }, trustedProxies: '192.0.2.0/24' }), '198.51.100.23');
});

test('resolveClientIp falls back to the direct peer when forwarded headers are untrusted', () => {
    const req = {
        headers: {
            'x-forwarded-for': '198.51.100.23'
        },
        socket: {
            remoteAddress: '203.0.113.9'
        }
    };

    assert.equal(resolveClientIp(req, { env: { TRUST_ALL_PROXIES: 'false' }, trustedProxies: '192.0.2.0/24' }), '203.0.113.9');
});

test('takeRateLimitToken blocks after the configured threshold and resets after the window', () => {
    _private.resetSharedRateLimitStore();

    const store = new Map();
    const first = takeRateLimitToken({
        store,
        key: 'bucket-1',
        limit: 2,
        windowMs: 1_000,
        now: 1_000
    });
    const second = takeRateLimitToken({
        store,
        key: 'bucket-1',
        limit: 2,
        windowMs: 1_000,
        now: 1_100
    });
    const third = takeRateLimitToken({
        store,
        key: 'bucket-1',
        limit: 2,
        windowMs: 1_000,
        now: 1_200
    });
    const reset = takeRateLimitToken({
        store,
        key: 'bucket-1',
        limit: 2,
        windowMs: 1_000,
        now: 2_100
    });

    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 1);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);
    assert.equal(third.allowed, false);
    assert.equal(third.retryAfterSeconds, 1);
    assert.equal(reset.allowed, true);
    assert.equal(reset.remaining, 1);
});
