'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function createMockResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        status(code) { state.statusCode = code; return this; },
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
        end(value = '') { state.body = String(value); return this; },
        get statusCode() { return state.statusCode; },
        get body() { return state.body; }
    };
}

async function withPublicHandler(callback) {
    const handlerPath = path.resolve(repoRoot, 'api/public.js');
    const originalLoad = Module._load;
    delete require.cache[handlerPath];

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === './_lib/admin') {
            return {
                sendJson(res, status, payload) {
                    res.statusCode = status;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                getOptionalSupabaseAdmin() { return null; }
            };
        }
        if (request === './_lib/request-security') return {};
        if (request === './_lib/site') return { requireSupportedSite(value) { return value || 'cn'; } };
        if (request === './_lib/discount-assets') return {};
        if (request === './_lib/discount-pricing') return {};
        if (request === './_lib/payments/guest-shop-adapter') {
            return { createGuestShopPaymentAdapter() { return {}; } };
        }
        if (request === '../server/api-handlers/public/shop') {
            return { createShopHandlers() { return {}; } };
        }
        if (request === '../server/api-handlers/public/guest-shop') {
            return {
                createGuestShopHandlers() {
                    return {
                        preview: async (_req, res) => res.end('preview'),
                        orders: async (_req, res) => res.end('orders'),
                        status: async (_req, res) => res.end('status'),
                        recover: async (_req, res) => res.end('recover'),
                        claim: async (_req, res) => res.end('claim'),
                        order: async (_req, res) => res.end('order'),
                        delivery: async (_req, res) => res.end('delivery'),
                        accessLogin: async (_req, res) => res.end('access-login'),
                        accessLogout: async (_req, res) => res.end('access-logout'),
                        webhook: async (_req, res, provider) => {
                            res.status(200);
                            res.end(`webhook:${provider}`);
                        }
                    };
                }
            };
        }
        if (request === '../server/guest-shop-worker') {
            return {
                createGuestShopWorkerHandler() {
                    return async (_req, res) => {
                        res.status(200);
                        res.end('worker');
                    };
                }
            };
        }
        return originalLoad.call(Module, request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        return await callback(handler);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('shared public dispatcher binds provider-specific guest webhook routes', async () => {
    await withPublicHandler(async (handler) => {
        for (const [route, provider] of [
            ['guest/webhooks/zpay', 'zpay'],
            ['guest/webhooks/nowpayments', 'nowpayments']
        ]) {
            const res = createMockResponse();
            await handler({ method: 'POST', url: `/api/public?scope=shop&route=${route}` }, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body, `webhook:${provider}`);
        }
    });
});

test('shared public dispatcher exposes the secret-gated guest worker route', async () => {
    await withPublicHandler(async (handler) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/public?scope=shop&route=guest/worker' }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'worker');
    });
});

test('shared public dispatcher exposes the cross-device guest recovery route', async () => {
    await withPublicHandler(async (handler) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/public?scope=shop&route=guest/recover' }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'recover');
    });
});

/**
 * Order Access 2.0 (A2). docs/guest-shop-order-access-2.0.md §12 sketched REST
 * path params (/guest/orders/:orderNo), but the shared dispatcher's
 * resolveRoute() lowercases the path and joins segments with '/', so it has no
 * parameter slots. The routes are therefore flat keys and carry order_no in the
 * query string. Registering them is behaviour-neutral: every one answers
 * 404 guest_feature_disabled while GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is off
 * (covered by tests/guest-shop-order-access-endpoints.test.js).
 */
test('shared public dispatcher exposes the flat-key guest order access routes', async () => {
    await withPublicHandler(async (handler) => {
        for (const [route, body] of [
            ['guest/order', 'order'],
            ['guest/delivery', 'delivery'],
            ['guest/access/login', 'access-login'],
            ['guest/access/logout', 'access-logout']
        ]) {
            const res = createMockResponse();
            await handler({ method: 'GET', url: `/api/public?scope=shop&route=${route}&order_no=GS20260921-000001` }, res);
            assert.equal(res.statusCode, 200, `${route} must be bound`);
            assert.equal(res.body, body);
        }
    });
});

test('the guest order list route keeps its existing binding so the cookie session can reuse it', async () => {
    await withPublicHandler(async (handler) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/public?scope=shop&route=guest/orders' }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'orders');
    });
});

test('guest order access Vercel entrypoints bind the shared handlers and stay out of the deploy', () => {
    const ignored = fs.readFileSync(path.join(repoRoot, '.vercelignore'), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim());
    for (const [relativePath, handlerName] of [
        ['api/shop/guest/order.js', 'order'],
        ['api/shop/guest/delivery.js', 'delivery'],
        ['api/shop/guest/access/login.js', 'accessLogin'],
        ['api/shop/guest/access/logout.js', 'accessLogout']
    ]) {
        const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
        assert.match(
            source,
            /createGuestShopHandlers\(\{[\s\S]*?\}\)\.\w+/,
            `${relativePath} must build its handler through createGuestShopHandlers`
        );
        assert.ok(
            source.endsWith(`.${handlerName};\n`) || source.includes(`).${handlerName};`),
            `${relativePath} must export the ${handlerName} handler`
        );
        assert.equal(
            ignored.includes(relativePath),
            true,
            `.vercelignore should exclude the standalone guest-shop entrypoint ${relativePath}`
        );
    }
});

test('provider-specific Vercel guest webhook entrypoints retain explicit provider binding', () => {
    const zpay = fs.readFileSync(path.join(repoRoot, 'api/shop/guest/webhooks/zpay.js'), 'utf8');
    const nowpayments = fs.readFileSync(path.join(repoRoot, 'api/shop/guest/webhooks/nowpayments.js'), 'utf8');
    assert.match(zpay, /\.webhook\(req, res, ['"]zpay['"]\)/);
    assert.match(nowpayments, /\.webhook\(req, res, ['"]nowpayments['"]\)/);
});

test('claim endpoint contract rejects secrets in the JSON body', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'server/api-handlers/public/guest-shop.js'), 'utf8');
    assert.match(source, /if \(!\['orderNo', 'order_no'\]\.includes\(key\)\)/);
    assert.doesNotMatch(source, /body\.claimSecret\s*\|\|\s*body\.claim_secret/);
});

test('recover.js Vercel entrypoint binds the shared recover handler', () => {
    const recover = fs.readFileSync(path.join(repoRoot, 'api/shop/guest/recover.js'), 'utf8');
    const ignored = fs.readFileSync(path.join(repoRoot, '.vercelignore'), 'utf8');
    assert.match(recover, /createGuestShopHandlers\([\s\S]*\)\.recover/);
    assert.match(ignored, /api\/shop\/guest\/recover\.js/);
});

