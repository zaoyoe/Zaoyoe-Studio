const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { verifyDeploymentRoutes, ROUTES } = require('../scripts/verify-deployment-routes');

const json = (value, init = {}) => new Response(JSON.stringify(value), {
    ...init, headers: { 'content-type': 'application/json', ...init.headers }
});
const options = (fetchImpl, extra = {}) => ({ fetchImpl, attempts: 1, log: () => {}, ...extra });

test('verify checks both public proxy and direct API routes independently', async () => {
    const seen = [];
    const result = await verifyDeploymentRoutes('verify', options(async (url, init) => {
        seen.push(url);
        assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.authorization, undefined);
        return json(url.endsWith('/healthz') ? { status: 'ok' } : { success: true });
    }));
    assert.equal(result.ok, true);
    assert.deepEqual(seen, ROUTES.verify.map((route) => route.url));
    assert.equal(result.results.length, 5);
});

test('a challenged public catalog remains failed when the API catalog passes', async () => {
    const result = await verifyDeploymentRoutes('verify', options(async (url) => {
        if (url.includes('www.fatherkey.com/api/shop/')) {
            return new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
        }
        return json(url.endsWith('/healthz') ? { status: 'ok' } : { success: true });
    }));
    assert.equal(result.ok, false);
    assert.equal(result.results.find((r) => r.route === 'public_catalog').ok, false);
    assert.equal(result.results.find((r) => r.route === 'api_catalog').ok, true);
});

test('NewAPI checks the canonical hostname and exact healthy status', async () => {
    let seen;
    assert.equal((await verifyDeploymentRoutes('newapi', options(async (url) => {
        seen = url;
        return json({ status: 'ok' });
    }))).ok, true);
    assert.equal(seen, 'https://new.fatherkey.com/health');
    for (const payload of [{ status: true }, { success: true }, [], null]) {
        assert.equal((await verifyDeploymentRoutes('newapi', options(async () => json(payload)))).ok, false);
    }
});

test('redirects, including Access login, are rejected without following or logging Location', async () => {
    const logs = [];
    const result = await verifyDeploymentRoutes('newapi', options(async () => new Response(null, {
        status: 302, headers: { location: 'https://access.invalid/?token=SECRET', 'set-cookie': 'SECRET' }
    }), { log: (line) => logs.push(line) }));
    assert.equal(result.results[0].reason, 'unexpected_redirect');
    assert.doesNotMatch(logs.join('\n'), /SECRET|location|set-cookie/);
});

test('HTML, malformed JSON, oversized payloads and challenge HTTP 200 fail safely', async () => {
    const cases = [
        [() => new Response('SECRET HTML'), 'non_json_response'],
        [() => new Response('SECRET bad JSON', { headers: { 'content-type': 'application/json' } }), 'invalid_json'],
        [() => json({ status: 'ok' }, { headers: { 'content-length': '99999999' } }), 'body_too_large'],
        [() => json({ status: 'ok' }, { headers: { 'cf-mitigated': 'challenge' } }), 'cloudflare_challenge'],
        [() => json({ status: 'ok', text: 'x'.repeat(2 * 1024 * 1024) }), 'body_too_large']
    ];
    for (const [makeResponse, reason] of cases) {
        const logs = [];
        const result = await verifyDeploymentRoutes('newapi', options(async () => makeResponse(), { log: (line) => logs.push(line) }));
        assert.equal(result.ok, false);
        assert.equal(result.results[0].reason, reason);
        assert.doesNotMatch(logs.join('\n'), /SECRET/);
    }
});

test('payments/catalog require boolean success, not truthy strings', async () => {
    const result = await verifyDeploymentRoutes('verify', options(async (url) => json(
        url.endsWith('/healthz') ? { status: 'ok' } : { success: 'true' }
    )));
    assert.equal(result.ok, false);
    assert.equal(result.results.filter((r) => r.ok).length, 1);
});

test('bounded retry can recover a transient failure without changing the route', async () => {
    const seen = [];
    const delays = [];
    const result = await verifyDeploymentRoutes('newapi', options(async (url) => {
        seen.push(url);
        return seen.length === 1 ? new Response(null, { status: 503 }) : json({ status: 'ok' });
    }, { attempts: 3, delay: async (ms) => delays.push(ms) }));
    assert.equal(result.ok, true);
    assert.equal(seen.length, 2);
    assert.equal(new Set(seen).size, 1);
    assert.deepEqual(delays, [2000]);
});

test('exhausted retries preserve failure and redact network error messages', async () => {
    const logs = [];
    const result = await verifyDeploymentRoutes('newapi', options(async () => {
        throw new Error('SECRET token and network details');
    }, { attempts: 2, delay: async () => {}, log: (line) => logs.push(line) }));
    assert.equal(result.ok, false);
    assert.equal(result.results[0].attempt, 2);
    assert.equal(result.results[0].reason, 'network_error');
    assert.doesNotMatch(logs.join('\n'), /SECRET|token/);
});

test('deadline bounds stalled fetches and aborts them', async () => {
    let signal;
    const result = await verifyDeploymentRoutes('newapi', options(async (url, init) => {
        signal = init.signal;
        return new Promise(() => {});
    }, { timeoutMs: 10 }));
    assert.equal(result.results[0].reason, 'timeout');
    assert.equal(signal.aborted, true);
});

test('deadline includes reading a stalled body', async () => {
    const result = await verifyDeploymentRoutes('newapi', options(async () => new Response(
        new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }
    ), { timeoutMs: 10 }));
    assert.equal(result.results[0].reason, 'timeout');
});

test('only selected diagnostic headers are logged, never response contents', async () => {
    const logs = [];
    await verifyDeploymentRoutes('newapi', options(async () => json({ status: 'bad', secret: 'SECRET' }, {
        headers: { server: 'cloudflare', 'cf-ray': 'abc-SJC', 'set-cookie': 'SECRET', authorization: 'SECRET' }
    }), { log: (line) => logs.push(line) }));
    assert.match(logs[0], /cloudflare|abc-SJC/);
    assert.doesNotMatch(logs[0], /SECRET|set-cookie|authorization/);
});

test('invalid chain or unbounded retry settings are rejected before network access', async () => {
    let called = false;
    const config = options(async () => { called = true; });
    await assert.rejects(verifyDeploymentRoutes('https://evil.invalid', config));
    await assert.rejects(verifyDeploymentRoutes('__proto__', config));
    await assert.rejects(verifyDeploymentRoutes('newapi', { ...config, attempts: 100 }));
    await assert.rejects(verifyDeploymentRoutes('newapi', { ...config, timeoutMs: Infinity }));
    assert.equal(called, false);
});

test('both workflows pin the triggering SHA, retain queued chains, and use strict public checks', () => {
    for (const [file, chain] of [['deploy-kvm4-verify-server.yml', 'verify'], ['deploy-kvm4-sub2api.yml', 'newapi']]) {
        const source = fs.readFileSync(path.join(__dirname, '../.github/workflows', file), 'utf8');
        assert.match(source, /ref: \$\{\{ github\.sha \}\}/);
        assert.match(source, /test "\$\(git rev-parse origin\/main\)" = "\$GITHUB_SHA"/);
        assert.match(source, /cancel-in-progress: false\n  queue: max/);
        assert.match(source, new RegExp(`node scripts/verify-deployment-routes\\.js ${chain}`));
        assert.doesNotMatch(source, /falling back|fetch_route\(\)/);
    }
});
