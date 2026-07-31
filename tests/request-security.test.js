const test = require('node:test');
const assert = require('node:assert/strict');

const {
    explainClientIpResolution,
    ipMatchesCidr,
    isIpAllowed,
    normalizeIp,
    resolveClientIp,
    takeRateLimitToken,
    takeRateLimitTokens,
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

    assert.equal(resolveClientIp(req, { env: { TRUST_ALL_PROXIES: 'false' }, trustedProxies: '10.0.0.0/8' }), '198.51.100.23');
    assert.equal(resolveClientIp(req, { env: { TRUST_ALL_PROXIES: 'true' } }), '198.51.100.23');
    assert.equal(resolveClientIp(req, { env: { TRUST_ALL_PROXIES: 'false' }, trustedProxies: '192.0.2.0/24' }), '10.0.0.2');
});

test('resolveClientIp ignores TRUST_ALL_PROXIES in production-like runtimes', () => {
    const req = {
        headers: {
            'x-forwarded-for': '198.51.100.23'
        },
        socket: {
            remoteAddress: '10.0.0.2'
        }
    };

    assert.equal(resolveClientIp(req, {
        env: {
            VERCEL_ENV: 'production',
            TRUST_ALL_PROXIES: 'true'
        }
    }), '10.0.0.2');
});

test('resolveClientIp does not trust forwarded headers only because the peer is private', () => {
    const req = {
        headers: {
            'x-forwarded-for': '198.51.100.23'
        },
        socket: {
            remoteAddress: '10.0.0.2'
        }
    };

    assert.equal(resolveClientIp(req, { env: { TRUST_ALL_PROXIES: 'false' } }), '10.0.0.2');
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

test('explainClientIpResolution returns proxy trust metadata for diagnostics', () => {
    const req = {
        headers: {
            'x-forwarded-for': '198.51.100.23, 10.0.0.2',
            forwarded: 'for=198.51.100.23;proto=https'
        },
        socket: {
            remoteAddress: '10.0.0.2'
        }
    };

    const diagnostic = explainClientIpResolution(req, {
        env: { TRUST_ALL_PROXIES: 'false' },
        trustedProxies: '10.0.0.0/8'
    });

    assert.equal(diagnostic.socketIp, '10.0.0.2');
    assert.deepEqual(diagnostic.forwardedIps, ['198.51.100.23', '10.0.0.2']);
    assert.equal(diagnostic.resolvedClientIp, '198.51.100.23');
    assert.equal(diagnostic.directPeerTrusted, true);
    assert.equal(diagnostic.usedForwardedChain, true);
    assert.equal(diagnostic.directPeerTrustReason, 'configured_trusted_proxy');
    assert.deepEqual(diagnostic.trustedProxies, ['10.0.0.0/8']);
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

test('takeRateLimitToken can use a persistent Supabase-backed limiter when provided', async () => {
    const buckets = new Map();
    const supabase = {
        rpc(name, args) {
            assert.equal(name, 'take_rate_limit_token');

            return {
                async single() {
                    const key = String(args.p_key || '').trim();
                    const limit = Math.max(1, Number(args.p_limit) || 1);
                    const windowMs = Math.max(1000, Number(args.p_window_ms) || 60_000);
                    const now = Date.parse(args.p_now);

                    let entry = buckets.get(key);
                    if (!entry || entry.resetAt <= now) {
                        entry = {
                            count: 0,
                            resetAt: now + windowMs
                        };
                    }

                    let allowed = true;
                    if (entry.count >= limit) {
                        allowed = false;
                    } else {
                        entry.count += 1;
                    }

                    buckets.set(key, entry);

                    return {
                        data: {
                            allowed,
                            limit_value: limit,
                            remaining: allowed ? Math.max(0, limit - entry.count) : 0,
                            reset_at: new Date(entry.resetAt).toISOString(),
                            retry_after_seconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
                        },
                        error: null
                    };
                }
            };
        }
    };

    const first = await takeRateLimitToken({
        supabase,
        key: 'persistent-bucket',
        limit: 2,
        windowMs: 1_000,
        now: 1_000
    });
    const second = await takeRateLimitToken({
        supabase,
        key: 'persistent-bucket',
        limit: 2,
        windowMs: 1_000,
        now: 1_100
    });
    const third = await takeRateLimitToken({
        supabase,
        key: 'persistent-bucket',
        limit: 2,
        windowMs: 1_000,
        now: 1_200
    });

    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 1);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 0);
    assert.equal(third.allowed, false);
    assert.equal(third.retryAfterSeconds, 1);
});

test('takeRateLimitTokens batches persistent checks into one database request', async () => {
    const calls = [];
    const supabase = {
        async rpc(name, args) {
            calls.push({ name, args });
            return {
                data: args.p_checks.map((check, index) => ({
                    scope: check.scope,
                    allowed: index === 0,
                    limit: check.limit,
                    remaining: index === 0 ? check.limit - 1 : 0,
                    reset_at: '2026-07-31T12:01:00.000Z',
                    retry_after_seconds: index === 0 ? 1 : 30
                })),
                error: null
            };
        }
    };

    const results = await takeRateLimitTokens({
        supabase,
        now: Date.parse('2026-07-31T12:00:00.000Z'),
        checks: [
            { scope: 'submit:global', key: 'global', limit: 20, windowMs: 60_000 },
            { scope: 'submit:user', key: 'user:1', limit: 3, windowMs: 60_000 }
        ]
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'take_rate_limit_tokens');
    assert.equal(calls[0].args.p_checks.length, 2);
    assert.equal(results[0].scope, 'submit:global');
    assert.equal(results[0].allowed, true);
    assert.equal(results[1].scope, 'submit:user');
    assert.equal(results[1].allowed, false);
    assert.equal(results[1].retryAfterSeconds, 30);
});

test('takeRateLimitTokens falls back to parallel single checks before the batch migration exists', async () => {
    const calls = [];
    const supabase = {
        rpc(name, args) {
            calls.push({ name, args });
            if (name === 'take_rate_limit_tokens') {
                return Promise.resolve({
                    data: null,
                    error: { code: 'PGRST202', message: 'function take_rate_limit_tokens does not exist' }
                });
            }
            return Promise.resolve({
                data: {
                    allowed: true,
                    limit_value: args.p_limit,
                    remaining: args.p_limit - 1,
                    reset_at: '2026-07-31T12:01:00.000Z',
                    retry_after_seconds: 1
                },
                error: null
            });
        }
    };

    const results = await takeRateLimitTokens({
        supabase,
        now: Date.parse('2026-07-31T12:00:00.000Z'),
        checks: [
            { scope: 'submit:global', key: 'global', limit: 20, windowMs: 60_000 },
            { scope: 'submit:user', key: 'user:1', limit: 3, windowMs: 60_000 }
        ]
    });

    assert.deepEqual(calls.map((call) => call.name), [
        'take_rate_limit_tokens',
        'take_rate_limit_token',
        'take_rate_limit_token'
    ]);
    assert.equal(results.length, 2);
    assert.equal(results.every((result) => result.allowed), true);
});

test('takeRateLimitTokens does not treat an invalid empty batch response as unlimited access', async () => {
    const store = new Map();
    const supabase = {
        async rpc() {
            return { data: [], error: null };
        }
    };

    const first = await takeRateLimitTokens({
        supabase,
        store,
        now: 1_000,
        checks: [{ scope: 'submit:user', key: 'user:1', limit: 1, windowMs: 60_000 }]
    });
    const second = await takeRateLimitTokens({
        supabase,
        store,
        now: 1_100,
        checks: [{ scope: 'submit:user', key: 'user:1', limit: 1, windowMs: 60_000 }]
    });

    assert.equal(first[0].allowed, true);
    assert.equal(second[0].allowed, false);
});
