const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
    createGuestShopPreviewRelay,
    resolveGuestShopPreviewConfig,
    resolveGuestShopPreviewOrigin,
    resolveGuestShopPreviewRequest
} = require('../scripts/local-preview-guest-shop');

async function listen(t, app) {
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, fetchImpl, options = {}) {
    const calls = [];
    const upstream = express();
    upstream.use(express.json());
    upstream.all('*', (req, res) => {
        calls.push({ method: req.method, url: req.url, headers: req.headers, body: req.body });
        if (options.upstreamHandler) return options.upstreamHandler(req, res);
        if (req.path.endsWith('/orders') && req.body.checkoutAction === 'inspect') {
            return res.json({ success: true, intent: { pending: false } });
        } else if (req.path.endsWith('/login')) {
            res.setHeader('Set-Cookie', [
                '__Host-gs-acc=fake-test-session; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Strict',
                'unrelated=discard-me; Path=/'
            ]);
        } else if (req.path.endsWith('/logout')) {
            res.setHeader('Set-Cookie', '__Host-gs-acc=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict');
        } else if (req.path.endsWith('/delivery')) {
            res.type('text/plain').attachment('test-order.txt').send('mock delivery');
            return;
        } else if (req.path.endsWith('/order')) {
            return res.status(403).setHeader('Retry-After', '30').json({ success: false, code: 'guest_order_credentials_invalid' });
        }
        res.json({ success: true, enabled: true, buyer_credential_required: true });
    });
    const origin = await listen(t, upstream);
    const preview = express();
    preview.use(express.json());
    preview.use(createGuestShopPreviewRelay({ origin, fetchImpl, orderWritesEnabled: options.orderWritesEnabled, cancellationMode: options.cancellationMode, cancelOrder: options.cancelOrder }));
    preview.all('*', (_req, res) => res.status(418).json({ fallback: true }));
    return { url: await listen(t, preview), calls, origin };
}

test('guest query relay is opt-in and validates operator-supplied origins', () => {
    assert.equal(resolveGuestShopPreviewOrigin(''), '');
    assert.equal(resolveGuestShopPreviewOrigin('https://verify-api.fatherkey.com/'), 'https://verify-api.fatherkey.com');
    for (const invalid of ['http://remote.example', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?key=secret']) {
        assert.throws(() => resolveGuestShopPreviewOrigin(invalid));
    }
    let nextCalled = false;
    createGuestShopPreviewRelay()({}, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('guest query relay recognizes legacy and shared public aliases', () => {
    for (const url of [
        '/api/shop/guest/orders?site=cn',
        '/api/public?scope=shop&route=guest/orders&site=cn',
        '/api/public/shop/guest/orders?site=cn',
        '/api/public?scope=%2FSHOP%2F&route=%2FGUEST%2Forders%2F&site=cn',
        '/api/shop/GUEST/ORDERS?site=cn'
    ]) {
        assert.deepEqual(resolveGuestShopPreviewRequest(url), { route: 'guest/orders', search: '?site=cn' });
    }
    assert.equal(resolveGuestShopPreviewRequest('/api/tg/catalog'), null);
});

test('guest quote and availability use upstream configuration with no caching', async (t) => {
    const { url, calls } = await fixture(t);
    const response = await fetch(`${url}/api/shop/guest/preview?site=cn&quantity=1`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).buyer_credential_required, true);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls[0].url, '/api/shop/guest/preview?site=cn&quantity=1');
    const availability = await fetch(`${url}/api/shop/guest/access/availability`);
    assert.equal((await availability.json()).enabled, true);
});

test('guest login and reads forward only guest credentials and remap the HttpOnly loopback cookie', async (t) => {
    const { url, calls } = await fixture(t);
    const response = await fetch(`${url}/api/shop/guest/access/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: url, Authorization: 'Bearer never-forward' },
        body: JSON.stringify({ email: 'mock@example.test', password: 'Only-a-test-123!', site: 'cn' })
    });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();
    assert.deepEqual(cookies, ['gs-preview-access=fake-test-session; Max-Age=1800; Path=/; HttpOnly; SameSite=Strict']);
    assert.equal(calls[0].headers.authorization, undefined);
    assert.equal(calls[0].body.email, 'mock@example.test');
    await fetch(`${url}/api/shop/guest/orders?site=cn&page=1`, {
        headers: {
            Cookie: 'other=secret; __Host-gs-acc=wrong; gs-preview-access=fake-test-session',
            'X-Guest-Order-Credential': 'fake-test-header',
            'X-Forwarded-For': '198.51.100.5'
        }
    });
    assert.equal(calls[1].headers.cookie, '__Host-gs-acc=fake-test-session');
    assert.equal(calls[1].headers['x-guest-order-credential'], 'fake-test-header');
    assert.equal(calls[1].headers['x-forwarded-for'], undefined);
});

test('guest logout clears only the local preview access cookie', async (t) => {
    const { url } = await fixture(t);
    const response = await fetch(`${url}/api/shop/guest/access/logout`, { method: 'POST' });
    assert.deepEqual(response.headers.getSetCookie(), ['gs-preview-access=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict']);
});

test('guest relay preserves upstream authentication errors, lock budgets and downloads', async (t) => {
    const { url } = await fixture(t);
    const invalid = await fetch(`${url}/api/shop/guest/order?order_no=mock`);
    assert.equal(invalid.status, 403);
    assert.equal(invalid.headers.get('retry-after'), '30');
    assert.equal((await invalid.json()).code, 'guest_order_credentials_invalid');
    const download = await fetch(`${url}/api/shop/guest/delivery?download=1`);
    assert.match(download.headers.get('content-disposition'), /attachment.*test-order\.txt/u);
    assert.equal(await download.text(), 'mock delivery');
});

test('guest relay blocks live order mutations on every alias without upstream calls or local fallback', async (t) => {
    const { url, calls } = await fixture(t);
    for (const endpoint of [
        '/api/shop/guest/orders', '/api/shop/guest/checkout-batches',
        '/api/shop/guest/cancel', '/api/shop/guest/worker', '/api/shop/guest/access/reset',
        '/api/public?scope=shop&route=guest/orders', '/api/public/shop/guest/checkout-batches'
    ]) {
        const response = await fetch(url + endpoint, { method: 'POST' });
        assert.equal(response.status, 409, endpoint);
        assert.equal((await response.json()).code, 'local_preview_guest_write_disabled');
    }
    assert.equal(calls.length, 0);
    const tg = await fetch(`${url}/api/tg/catalog`);
    assert.equal(tg.status, 418);
});

test('opening checkout can inspect intent, but cannot prepare or commit an order through the read relay', async (t) => {
    const { url, calls } = await fixture(t);
    const post = (body) => fetch(`${url}/api/shop/guest/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(body)
    });
    const inspection = await post({ checkoutAction: 'inspect' });
    assert.deepEqual(await inspection.json(), { success: true, intent: { pending: false } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { checkoutAction: 'inspect' });
    for (const body of [
        { checkoutAction: 'prepare' }, { checkoutAction: 'commit' },
        { checkoutAction: 'ack' }, { checkoutAction: 'discard' },
        { checkoutAction: 'inspect', productId: 'not-allowed' }
    ]) {
        assert.equal((await post(body)).status, 409);
    }
    assert.equal(calls.length, 1);
});

test('guest relay rejects cross-site credential requests before forwarding', async (t) => {
    const { url, calls } = await fixture(t);
    const response = await fetch(`${url}/api/shop/guest/access/login`, {
        method: 'POST', headers: { Origin: 'https://untrusted.example' }
    });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
});

test('guest relay never falls back to stale local configuration on upstream failure', async (t) => {
    const { url } = await fixture(t, async () => { throw new Error('private diagnostic'); });
    const response = await fetch(`${url}/api/shop/guest/access/availability`);
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /local_preview_guest_upstream_unavailable/u);
    assert.doesNotMatch(body, /private diagnostic|fallback/u);
});

test('real preview checkout requires an explicit opt-in and a declared upstream', () => {
    assert.deepEqual(resolveGuestShopPreviewConfig(), { mode: 'local', origin: null, orderWritesEnabled: false, cancellationMode: 'upstream' });
    const env = { LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN: 'https://verify-api.fatherkey.com' };
    assert.equal(resolveGuestShopPreviewConfig(env).orderWritesEnabled, false);
    assert.deepEqual(resolveGuestShopPreviewConfig({ ...env, LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES: 'true' }), {
        mode: 'upstream-checkout', origin: env.LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN, orderWritesEnabled: true, cancellationMode: 'upstream'
    });
    assert.throws(() => resolveGuestShopPreviewConfig({ LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES: 'true' }), /require/u);
    assert.throws(() => resolveGuestShopPreviewConfig({ ...env, LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES: 'yes' }), /true or false/u);
});

function browserRequests(url) {
    const jar = new Map();
    return async (endpoint, body, headers = {}) => {
        const response = await fetch(url + endpoint, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }),
                Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
                ...headers
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        for (const cookie of response.headers.getSetCookie()) {
            assert.match(cookie, /; HttpOnly; SameSite=Strict/u);
            assert.doesNotMatch(cookie, /__Host-|; Secure/u);
            const [pair] = cookie.split(';');
            const index = pair.indexOf('=');
            if (/Max-Age=0;/u.test(cookie)) jar.delete(pair.slice(0, index));
            else jar.set(pair.slice(0, index), pair.slice(index + 1));
        }
        return response;
    };
}

// Stateful upstream double: requests must carry the exact opaque intent/claim
// cookies across different local aliases, just as the real handler requires.
function checkoutUpstream() {
    let intent = null;
    const orders = new Map();
    return (req, res) => {
        const cookie = req.headers.cookie || '';
        const action = req.body.checkoutAction;
        if (req.path.endsWith('/orders') && req.method === 'POST') {
            if (action === 'inspect') return res.json({ success: true, intent: intent || { pending: false } });
            if (action === 'prepare') {
                intent = { pending: true, intentId: `ci.${'a'.repeat(24)}${orders.size}`, product_id: req.body.productId };
                res.setHeader('Set-Cookie', '__Host-gs-checkout-intent=sealed-intent; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Strict');
                return res.json({ success: true, intent });
            }
            if (!intent || !cookie.includes('__Host-gs-checkout-intent=sealed-intent') || req.body.intentId !== intent.intentId) {
                return res.status(403).json({ success: false, code: 'guest_checkout_intent_invalid' });
            }
            if (action === 'commit') {
                const orderNo = intent.orderNo ||= `GUEST-FIXTURE-${orders.size + 1}`;
                if (!orders.has(orderNo)) orders.set(orderNo, { order_no: orderNo, payment_status: 'pending', fulfillment_status: 'pending' });
                res.setHeader('Set-Cookie', [
                    'guest_claim_proof=sealed-claim; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Lax',
                    'unrelated=never-forward; Path=/'
                ]);
                return res.status(201).json({ success: true, order: orders.get(orderNo), checkout: { qrcode_url: 'https://payment.example.test/fixture' } });
            }
            if (action === 'ack' || action === 'discard') {
                if (action === 'ack' && !cookie.includes('guest_claim_proof=sealed-claim')) {
                    return res.status(403).json({ success: false, code: 'guest_claim_invalid' });
                }
                intent = null;
                res.setHeader('Set-Cookie', '__Host-gs-checkout-intent=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict');
                return res.json({ success: true, acknowledged: action === 'ack', discarded: action === 'discard' });
            }
        }
        const order = orders.get(req.body.orderNo || req.query.orderNo);
        if (!cookie.includes('guest_claim_proof=sealed-claim') || !order) {
            return res.status(403).json({ success: false, code: 'guest_claim_invalid' });
        }
        if (req.path.endsWith('/cancel')) {
            order.payment_status = 'cancelled';
            return res.json({ success: true, cancelled: true });
        }
        if (req.path.endsWith('/claim')) {
            return res.status(409).json({ success: false, code: 'guest_payment_not_confirmed' });
        }
        return res.json({ success: true, order });
    };
}

test('opted-in checkout keeps intent, retry, refresh, cancellation and replacement on one upstream', async (t) => {
    const { url, calls } = await fixture(t, undefined, { orderWritesEnabled: true, upstreamHandler: checkoutUpstream() });
    const request = browserRequests(url);
    const intent = (await (await request('/api/shop/guest/orders', { checkoutAction: 'prepare', productId: 'fixture-product', site: 'cn' })).json()).intent;
    const commitBody = { checkoutAction: 'commit', intentId: intent.intentId, email: 'fixture@example.test', orderPassword: 'Fixture-Only-123!' };
    const created = await request('/api/public?scope=shop&route=guest/orders', commitBody, { Authorization: 'Bearer never-forward' });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('x-local-preview-guest-api'), 'upstream-checkout');
    const first = await created.json();
    const replay = await request('/api/public/shop/guest/orders', commitBody);
    assert.equal((await replay.json()).order.order_no, first.order.order_no, 'a retry must retain the upstream intent');
    assert.equal(calls[1].headers.authorization, undefined);
    assert.equal(calls[1].headers.origin, 'https://www.fatherkey.com');
    assert.equal(calls[1].headers['sec-fetch-site'], 'same-origin');
    assert.deepEqual(calls[1].body, commitBody, 'buyer input and amounts must not be rewritten by the relay');
    await request('/api/shop/guest/orders', { checkoutAction: 'ack', intentId: intent.intentId });
    const refreshed = await request(`/api/shop/guest/status?orderNo=${first.order.order_no}&refresh=1`);
    assert.equal((await refreshed.json()).order.payment_status, 'pending');
    assert.equal(calls.at(-1).headers.cookie, 'guest_claim_proof=sealed-claim', 'ack clears only the checkout intent');
    assert.equal((await request('/api/shop/guest/cancel', { orderNo: first.order.order_no })).status, 200);
    assert.equal((await (await request(`/api/public/shop/guest/status?orderNo=${first.order.order_no}`)).json()).order.payment_status, 'cancelled');
    const nextIntent = (await (await request('/api/shop/guest/orders', { checkoutAction: 'prepare', productId: 'fixture-product', site: 'cn' })).json()).intent;
    const replacement = await request('/api/shop/guest/orders', { ...commitBody, intentId: nextIntent.intentId });
    assert.notEqual((await replacement.json()).order.order_no, first.order.order_no, 'same purchase after cancellation gets a fresh order');
    const claim = await request('/api/shop/guest/claim', { orderNo: first.order.order_no });
    assert.equal(claim.status, 409);
    assert.equal((await claim.json()).code, 'guest_payment_not_confirmed', 'the upstream remains the payment authority');
    for (const call of calls) assert.doesNotMatch(call.url, /webhooks|worker/u);
});

test('opted-in checkout forwards batch buyer operations and discard, retaining upstream errors and cookies', async (t) => {
    const { url, calls } = await fixture(t, undefined, { orderWritesEnabled: true, upstreamHandler(req, res) {
        res.status(409).json({ success: false, code: 'fixture_upstream_rejection' });
    } });
    const request = browserRequests(url);
    for (const [endpoint, body] of [
        ['/api/shop/guest/orders', { checkoutAction: 'discard', intentId: 'fixture-intent' }],
        ['/api/shop/guest/checkout-batches', { site: 'cn', items: [{ productId: 'fixture', skuId: 'fixture', quantity: 1 }] }],
        ['/api/public/shop/guest/checkout-batches/status?orderNo=GCB-FIXTURE', undefined],
        ['/api/public?scope=shop&route=guest/checkout-batches/cancel', { orderNo: 'GCB-FIXTURE' }],
        ['/api/shop/guest/checkout-batches/claim', { orderNo: 'GCB-FIXTURE' }]
    ]) {
        const response = await request(endpoint, body);
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'fixture_upstream_rejection');
        assert.deepEqual(calls.at(-1).body, body || {});
    }
    assert.equal(calls.length, 5);
});

test('opted-in checkout forwards only mapped buyer cookies and never local main-site sessions or proxy headers', async (t) => {
    const { url, calls } = await fixture(t, undefined, { orderWritesEnabled: true });
    await fetch(`${url}/api/shop/guest/orders`, {
        method: 'POST', headers: {
            Origin: url, 'Content-Type': 'application/json', Authorization: 'Bearer forbidden',
            'X-Forwarded-For': '198.51.100.8', 'X-Forwarded-Host': 'untrusted.example',
            Cookie: 'gs-preview-access=access; gs-preview-checkout-intent=intent; gs-preview-claim-proof=claim; guest_claim_proof=forged; __Host-gs-checkout-intent=forged; admin_session=forbidden'
        }, body: JSON.stringify({ checkoutAction: 'commit', intentId: 'fixture' })
    });
    assert.equal(calls[0].headers.cookie, '__Host-gs-acc=access; __Host-gs-checkout-intent=intent; guest_claim_proof=claim');
    for (const key of ['authorization', 'x-forwarded-for', 'x-forwarded-host']) assert.equal(calls[0].headers[key], undefined);
});

test('real checkout blocks missing/cross-site origins, DNS rebinding and non-buyer routes without upstream calls', async (t) => {
    const { url, calls } = await fixture(t, undefined, { orderWritesEnabled: true });
    for (const headers of [{}, { Origin: 'https://untrusted.example' }, { Origin: url, 'Sec-Fetch-Site': 'cross-site' }, { Host: 'untrusted.example', Origin: 'http://untrusted.example' }]) {
        const response = await fetch(`${url}/api/shop/guest/orders`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ checkoutAction: 'prepare' })
        });
        assert.equal(response.status, 403);
    }
    for (const endpoint of ['/api/shop/guest/worker', '/api/shop/guest/webhooks/zpay', '/api/public/shop/guest/access/reset', '/api/public?scope=SHOP&route=GUEST/WORKER', '/api/shop/GUEST/WORKER']) {
        assert.equal((await fetch(url + endpoint, { method: 'POST', headers: { Origin: url } })).status, 409);
    }
    for (const body of [{}, { checkoutAction: 'unknown' }, { checkoutAction: 'cancel' }]) {
        assert.equal((await fetch(`${url}/api/shop/guest/orders`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(body)
        })).status, 409);
    }
    assert.equal(calls.length, 0);
});

test('real checkout rejects non-loopback connections even with spoofed local headers', async () => {
    let forwarded = false;
    const relay = createGuestShopPreviewRelay({ origin: 'https://verify-api.fatherkey.com', orderWritesEnabled: true, fetchImpl: async () => { forwarded = true; } });
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await relay({
        originalUrl: '/api/shop/guest/orders', method: 'POST', protocol: 'http',
        headers: { origin: 'http://127.0.0.1:8000' }, get: () => '127.0.0.1:8000',
        body: { checkoutAction: 'prepare' }, socket: { remoteAddress: '198.51.100.10' }
    }, res, () => assert.fail('must not fall through'));
    assert.equal(res.statusCode, 403);
    assert.equal(forwarded, false);
});

test('route query overrides cannot escape the allowlist through a harmless quote URL', async (t) => {
    const { url, calls } = await fixture(t, undefined, { orderWritesEnabled: true });
    const response = await fetch(`${url}/api/shop/guest/preview?scope=shop&route=guest/worker&path=guest/worker&site=cn`);
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, '/api/shop/guest/preview?site=cn');
});

test('failed real checkout never retries a write or falls through to a second local order backend', async (t) => {
    let attempts = 0;
    const { url } = await fixture(t, async () => { attempts++; throw new Error('do not expose upstream details'); }, { orderWritesEnabled: true });
    const response = await fetch(`${url}/api/shop/guest/orders`, {
        method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutAction: 'commit', intentId: 'fixture' })
    });
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /确认原订单结果/u);
    assert.doesNotMatch(body, /do not expose|fallback/u);
    assert.equal(attempts, 1);
});

test('preview health and actual routing both reflect the explicit real-order setting', async (t) => {
    const { createLocalPreviewApp } = require('../scripts/local-preview-server');
    const upstream = express();
    upstream.use(express.json());
    upstream.post('/api/shop/guest/orders', (req, res) => res.status(400).json({ success: false, code: 'fixture_invalid_prepare' }));
    const origin = await listen(t, upstream);
    const beforeEnv = { ...process.env };
    t.after(() => {
        for (const key of Object.keys(process.env)) if (!(key in beforeEnv)) delete process.env[key];
        Object.assign(process.env, beforeEnv);
    });
    const { app } = createLocalPreviewApp({ envFiles: [], baseEnv: {
        LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN: origin, LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES: 'true'
    } });
    const url = await listen(t, app);
    const health = await (await fetch(`${url}/healthz`)).json();
    assert.deepEqual(health.guestShopApi, { mode: 'upstream-checkout', origin, orderWritesEnabled: true, cancellationMode: 'upstream' });
    assert.match(health.sourceCommit, /^[0-9a-f]{40}$/u);
    const response = await fetch(`${url}/api/shop/guest/orders`, {
        method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify({ checkoutAction: 'prepare' })
    });
    assert.equal((await response.json()).code, 'fixture_invalid_prepare', 'the configured app must reach upstream rather than the read-only rejection');
});
