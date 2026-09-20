#!/usr/bin/env node
'use strict';

/*
 * Local-only browser fixture for guest checkout acceptance.
 *
 * It proxies the ordinary storefront to a local preview server, but intercepts
 * every guest-shop endpoint and returns deterministic, non-payment fixtures.
 * This lets a real browser exercise the shipped DOM and client code without
 * creating an order, contacting a provider, or writing to the database.
 */

const http = require('node:http');

const FIXTURE_PORT = Math.max(1, Number(process.env.GUEST_BROWSER_FIXTURE_PORT || 8012));
const UPSTREAM_PORT = Math.max(1, Number(process.env.GUEST_BROWSER_FIXTURE_UPSTREAM_PORT || 8011));
const FIXTURE_ORDER_NO = 'GS-BROWSER-FIXTURE-0001';
const FIXTURE_ORDER_NO_B = 'GS-BROWSER-FIXTURE-B-0001';
const FIXTURE_EXPIRY = '2099-01-01T00:00:00.000Z';
const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
const FIXTURE_AUDIT_LIMIT = 200;
const fixtureAudit = [];

// Keep the original A selection stable for the baseline checkout evidence.
// B is deliberately distinct in both copy and price so a delayed A status
// response visibly exposes any regression that paints over a newly selected B.
const FIXTURE_PRODUCTS = Object.freeze([
    Object.freeze({
        id: 'browser-fixture-product',
        name: '浏览器验收夹具商品 A',
        name_en: 'Browser fixture product A',
        description: '只用于本地受控浏览器验收，不会创建真实订单。',
        category: '浏览器验收',
        price_points: 0.01,
        price_points_intl: 0.01,
        stock_count: 9,
        sales_count: 0,
        display_order: 1,
        is_active: true,
        manual_delivery: false,
        fixture_pricing: Object.freeze({
            subtotal: '0.01',
            surcharge_amount: '0.01',
            payable_amount: '0.02',
            currency: 'CNY'
        }),
        skus: Object.freeze([Object.freeze({
            id: 'browser-fixture-sku',
            sku_name: '浏览器验收规格 A',
            price_points: 0.01,
            price_points_intl: 0.01,
            stock_count: 9,
            is_active: true,
            is_default: true,
            manual_delivery: false,
            delivery_type: 'KEY'
        })])
    }),
    Object.freeze({
        id: 'browser-fixture-product-b',
        name: '浏览器验收夹具商品 B',
        name_en: 'Browser fixture product B',
        description: '仅用于验证切换商品或规格时旧异步响应不会污染新页面。',
        category: '浏览器验收',
        price_points: 0.03,
        price_points_intl: 0.03,
        stock_count: 7,
        sales_count: 0,
        display_order: 2,
        is_active: true,
        manual_delivery: false,
        fixture_pricing: Object.freeze({
            subtotal: '0.03',
            surcharge_amount: '0.01',
            payable_amount: '0.04',
            currency: 'CNY'
        }),
        skus: Object.freeze([Object.freeze({
            id: 'browser-fixture-sku-b',
            sku_name: '浏览器验收规格 B',
            price_points: 0.03,
            price_points_intl: 0.03,
            stock_count: 7,
            is_active: true,
            is_default: true,
            manual_delivery: false,
            delivery_type: 'KEY'
        })])
    })
]);

const TERMINAL_SCENARIOS = new Set([
    'failed', 'expired', 'refunded', 'chargeback', 'amount_mismatch', 'overpaid', 'partial'
]);

function readJsonBody(req, maxBytes = 64 * 1024) {
    return new Promise((resolve) => {
        const chunks = [];
        let total = 0;
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        req.on('data', (chunk) => {
            if (settled) return;
            total += chunk.length;
            if (total > maxBytes) {
                finish(null);
                req.resume();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled) return;
            if (total === 0) {
                finish({});
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                finish(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
            } catch (_) {
                finish({});
            }
        });
        req.on('error', () => finish({}));
    });
}

function sendJson(res, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
        ...headers
    });
    res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
    const text = String(body || '');
    res.writeHead(status, {
        'content-type': contentType,
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(text),
        ...headers
    });
    res.end(text);
}

function recordFixtureRequest(req, pathname, scenario = '', action = '') {
    fixtureAudit.push({
        at: new Date().toISOString(),
        method: String(req.method || 'GET').toUpperCase(),
        pathname,
        scenario,
        ...(action ? { action } : {})
    });
    if (fixtureAudit.length > FIXTURE_AUDIT_LIMIT) fixtureAudit.splice(0, fixtureAudit.length - FIXTURE_AUDIT_LIMIT);
}

function fixtureCatalogPayload() {
    return {
        success: true,
        source: 'local-browser-fixture',
        categories: [{
            id: 'browser-fixture-category',
            name: '浏览器验收',
            sort_order: 1,
            is_public: true
        }],
        products: FIXTURE_PRODUCTS
    };
}

function defaultFixtureSelection() {
    const product = FIXTURE_PRODUCTS[0];
    return { product, sku: product.skus[0] };
}

function fixtureSelection(productId, skuId) {
    const product = FIXTURE_PRODUCTS.find((candidate) => candidate.id === productId);
    const sku = product?.skus.find((candidate) => candidate.id === skuId);
    return product && sku ? { product, sku } : null;
}

function orderNoForSelection(selection = defaultFixtureSelection()) {
    return selection.product.id === FIXTURE_PRODUCTS[1].id
        ? FIXTURE_ORDER_NO_B
        : FIXTURE_ORDER_NO;
}

function selectionForOrderNo(orderNo) {
    const normalized = String(orderNo || '').trim();
    if (normalized === FIXTURE_ORDER_NO_B) {
        const product = FIXTURE_PRODUCTS[1];
        return { product, sku: product.skus[0] };
    }
    return defaultFixtureSelection();
}

const FIXTURE_INTENT_COOKIE = 'fixture-gs-intent';
let fixtureIntentSequence = 0;
const fixtureIntents = new Map();

function requestCookie(req, name) {
    const wanted = String(name || '').trim();
    return String(req.headers.cookie || '').split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${wanted}=`))?.slice(wanted.length + 1) || '';
}

function fixtureIntentFor(req) {
    return fixtureIntents.get(requestCookie(req, FIXTURE_INTENT_COOKIE)) || null;
}

function fixtureIntentHeaders(intent = null, clear = false) {
    return {
        'set-cookie': clear
            ? `${FIXTURE_INTENT_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`
            : `${FIXTURE_INTENT_COOKIE}=${intent?.cookieId || ''}; Max-Age=7200; Path=/; HttpOnly; SameSite=Strict`
    };
}

function fixtureIntentPayload(intent) {
    if (!intent) return { pending: false };
    return {
        pending: true,
        intent_id: intent.intentId,
        state: 'ready',
        site: 'cn',
        product_id: intent.selection.product.id,
        sku_id: intent.selection.sku.id,
        quantity: 1,
        provider: 'zpay',
        channel: 'alipay',
        buyer_credential_required: false,
        contact_required: false,
        create_deadline_at: FIXTURE_EXPIRY,
        expires_at: FIXTURE_EXPIRY
    };
}

function issueFixtureIntent(selection) {
    fixtureIntentSequence += 1;
    const token = String(fixtureIntentSequence).padStart(24, '0');
    const intent = {
        cookieId: `fixture-${token}`,
        intentId: `ci.fixturebrowserintent${token}`,
        selection
    };
    fixtureIntents.set(intent.cookieId, intent);
    return intent;
}

function requestUrlFor(req) {
    try {
        return new URL(req.url || '/', `http://127.0.0.1:${FIXTURE_PORT}`);
    } catch (_) {
        return new URL('/', `http://127.0.0.1:${FIXTURE_PORT}`);
    }
}

function selectionFromRequest(req, body = {}) {
    const requestUrl = requestUrlFor(req);
    const fallback = defaultFixtureSelection();
    const productId = String(
        body.productId || body.product_id || requestUrl.searchParams.get('productId') || fallback.product.id
    ).trim().slice(0, 100) || fallback.product.id;
    const skuId = String(
        body.skuId || body.sku_id || requestUrl.searchParams.get('skuId') || fallback.sku.id
    ).trim().slice(0, 100) || fallback.sku.id;
    return fixtureSelection(productId, skuId) || fallback;
}

function scenarioFor(req) {
    let requestUrl;
    try {
        requestUrl = new URL(req.url || '/', `http://127.0.0.1:${FIXTURE_PORT}`);
    } catch (_) {
        requestUrl = null;
    }

    let referer;
    try {
        referer = new URL(req.headers.referer || '', `http://127.0.0.1:${FIXTURE_PORT}`);
    } catch (_) {
        referer = null;
    }

    // Direct endpoint probes can name the scenario explicitly. Browser-initiated
    // guest requests normally omit it, so retain the page URL as a fallback.
    const scenario = String(
        requestUrl?.searchParams.get('guestScenario')
        || referer?.searchParams.get('guestScenario')
        || 'configure'
    ).trim().toLowerCase();
    return /^[a-z_]+$/u.test(scenario) ? scenario : 'configure';
}

function checkout() {
    return {
        provider: 'zpay',
        channel: 'alipay',
        qrcode_url: `${FIXTURE_ORIGIN}/fixture/payment`,
        qrcode_image_url: `${FIXTURE_ORIGIN}/fixture/payment.svg`,
        expires_at: FIXTURE_EXPIRY
    };
}

function orderFor(scenario, selection = defaultFixtureSelection()) {
    let paymentStatus = 'pending';
    let fulfillmentStatus = 'pending';
    let refundStatus = '';

    if (['review', 'payment_creation_unknown', 'manual_review'].includes(scenario)) paymentStatus = 'review';
    if (scenario === 'confirmed') paymentStatus = 'confirmed';
    if (['confirmed_fulfilling', 'fulfilling'].includes(scenario)) {
        paymentStatus = 'confirmed';
        fulfillmentStatus = 'fulfilling';
    }
    if (['confirmed_failed', 'fulfillment_failed'].includes(scenario)) {
        paymentStatus = 'confirmed';
        fulfillmentStatus = 'failed';
    }
    if (scenario === 'paid_unfulfillable') {
        paymentStatus = 'confirmed';
        fulfillmentStatus = 'paid_unfulfillable';
    }
    if (scenario === 'dead_letter') {
        paymentStatus = 'confirmed';
        fulfillmentStatus = 'dead_letter';
    }
    if (scenario === 'delivered') {
        paymentStatus = 'confirmed';
        fulfillmentStatus = 'delivered';
    }
    if (scenario === 'refunded') {
        paymentStatus = 'refunded';
        fulfillmentStatus = 'refunded';
        refundStatus = 'succeeded';
    }
    if (TERMINAL_SCENARIOS.has(scenario) && scenario !== 'refunded') paymentStatus = scenario;

    return {
        order_no: orderNoForSelection(selection),
        site: 'cn',
        product_id: selection.product.id,
        sku_id: selection.sku.id,
        product_name: selection.product.name,
        sku_name: selection.sku.sku_name,
        provider: 'zpay',
        channel: 'alipay',
        expires_at: FIXTURE_EXPIRY,
        payment_status: paymentStatus,
        fulfillment_status: fulfillmentStatus,
        refund_status: refundStatus,
        pricing: selection.product.fixture_pricing
    };
}

function previewPayload(req) {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${FIXTURE_PORT}`);
    const fallback = defaultFixtureSelection();
    const productId = String(requestUrl.searchParams.get('productId') || fallback.product.id)
        .trim()
        .slice(0, 100) || fallback.product.id;
    const skuId = String(requestUrl.searchParams.get('skuId') || fallback.sku.id)
        .trim()
        .slice(0, 100) || fallback.sku.id;
    // The storefront should only probe pairs from this local catalog. Falling
    // back to A keeps the fixture fail-safe for malformed manual probes while
    // known B requests retain their distinct identity and amount in the DOM.
    const selection = fixtureSelection(productId, skuId) || fallback;
    return {
        success: true,
        product: {
            id: selection.product.id,
            sku_id: selection.sku.id,
            name: selection.product.name,
            sku_name: selection.sku.sku_name
        },
        price: selection.product.fixture_pricing,
        payment_channels: ['zpay:alipay', 'nowpayments:usdtbsc'],
        buyer_credential_required: false,
        quantity_cap: 1,
        discount_enabled: false
    };
}

function fixtureDelayMs(pathname, scenario, action = '') {
    if (scenario === 'creating' && pathname === '/api/shop/guest/orders'
        && (!action || action === 'commit')) return 1400;
    if (scenario === 'checking' && pathname === '/api/shop/guest/status') return 1400;
    if (scenario === 'recovering' && pathname === '/api/shop/guest/recover') return 1400;
    return 0;
}

function sendGuestFixtureJson(req, res, pathname, scenario, status, payload, headers = {}, action = '') {
    const delayMs = fixtureDelayMs(pathname, scenario, action);
    if (delayMs > 0) {
        setTimeout(() => sendJson(res, status, payload, headers), delayMs);
        return;
    }
    sendJson(res, status, payload, headers);
}

async function handleGuestFixture(req, res, pathname) {
    const scenario = scenarioFor(req);
    const body = pathname === '/api/shop/guest/orders' && req.method === 'POST'
        ? await readJsonBody(req)
        : null;
    const action = String(body?.checkoutAction || '').trim().toLowerCase();
    recordFixtureRequest(req, pathname, scenario, action);
    if (pathname === '/api/shop/guest/preview' && req.method === 'GET') {
        sendGuestFixtureJson(req, res, pathname, scenario, 200, previewPayload(req));
        return true;
    }
    if (pathname === '/api/shop/guest/orders' && req.method === 'POST') {
        if (action === 'inspect') {
            sendJson(res, 200, {
                success: true,
                intent: fixtureIntentPayload(fixtureIntentFor(req))
            });
            return true;
        }
        if (action === 'prepare') {
            const existing = fixtureIntentFor(req);
            const selection = selectionFromRequest(req, body);
            const intent = existing || issueFixtureIntent(selection);
            sendJson(res, 200, {
                success: true,
                prepared: true,
                reused: Boolean(existing),
                intent: fixtureIntentPayload(intent)
            }, fixtureIntentHeaders(intent));
            return true;
        }
        if (action === 'ack') {
            const intent = fixtureIntentFor(req);
            if (intent) fixtureIntents.delete(intent.cookieId);
            sendJson(res, 200, { success: true, acknowledged: true }, fixtureIntentHeaders(null, true));
            return true;
        }
        if (action === 'commit') {
            const intent = fixtureIntentFor(req);
            const selection = intent?.selection || defaultFixtureSelection();
            const order = orderFor(
                scenario === 'configure' || scenario === 'creating' ? 'awaiting_payment' : scenario,
                selection
            );
            sendGuestFixtureJson(req, res, pathname, scenario, 201, {
                success: true,
                order,
                checkout: order.payment_status === 'pending' ? checkout() : null
            }, {}, action);
            return true;
        }
        const selection = selectionFromRequest(req, body);
        const order = orderFor(
            scenario === 'configure' || scenario === 'creating' ? 'awaiting_payment' : scenario,
            selection
        );
        sendGuestFixtureJson(req, res, pathname, scenario, 201, {
            success: true,
            order,
            checkout: order.payment_status === 'pending' ? checkout() : null
        }, {}, action);
        return true;
    }
    if (pathname === '/api/shop/guest/status' && req.method === 'GET') {
        const orderNo = requestUrlFor(req).searchParams.get('orderNo');
        const order = orderFor(
            scenario === 'configure' ? 'awaiting_payment' : scenario,
            selectionForOrderNo(orderNo)
        );
        sendGuestFixtureJson(req, res, pathname, scenario, 200, {
            success: true,
            order,
            checkout: order.payment_status === 'pending' ? checkout() : null
        });
        return true;
    }
    if (pathname === '/api/shop/guest/recover' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const selection = selectionForOrderNo(body.orderNo || body.order_no);
        const order = orderFor(
            scenario === 'configure' ? 'awaiting_payment' : scenario,
            selection
        );
        sendGuestFixtureJson(req, res, pathname, scenario, 200, {
            success: true,
            order,
            checkout: order.payment_status === 'pending' ? checkout() : null
        });
        return true;
    }
    if (pathname === '/api/shop/guest/claim' && req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, {
            success: true,
            order_no: orderNoForSelection(selectionForOrderNo(body.orderNo || body.order_no)),
            content: 'BROWSER-FIXTURE-DELIVERY-NOT-A-REAL-SECRET'
        });
        return true;
    }
    sendJson(res, 404, {
        success: false,
        code: 'fixture_route_not_found',
        message: 'Local browser fixture intentionally has no real guest API route.'
    });
    return true;
}

function handleFixtureInfrastructure(req, res, pathname) {
    if (pathname === '/api/runtime/supabase-config' && req.method === 'GET') {
        recordFixtureRequest(req, pathname, 'infrastructure');
        // This endpoint is loaded by a <script> tag. The matching local
        // supabase-client stub below never connects to this origin.
        sendText(
            res,
            200,
            `window.__ZAOYOE_SUPABASE_CONFIG__={url:${JSON.stringify(FIXTURE_ORIGIN)},publishableKey:'fixture-local-publishable-key',site:'cn',auth:{google:{clientIds:{cn:'',intl:''}}}};window.ZAOYOE_PUBLIC_API_BASE_URL=${JSON.stringify(FIXTURE_ORIGIN)};window.VERIFY_SERVER_URL=${JSON.stringify(FIXTURE_ORIGIN)};`,
            'application/javascript; charset=utf-8'
        );
        return true;
    }
    if (pathname === '/supabase-client.js' && req.method === 'GET') {
        recordFixtureRequest(req, pathname, 'anonymous-auth-stub');
        const clientStub = [
            '(() => {',
            'const subscription={unsubscribe(){}};',
            'const channel={on(){return channel;},subscribe(callback){queueMicrotask(()=>callback?.(\'CLOSED\'));return channel;},unsubscribe(){return Promise.resolve();}};',
            'window.supabaseClient={',
            'auth:{getSession:async()=>({data:{session:null},error:null}),getUser:async()=>({data:{user:null},error:null}),onAuthStateChange:()=>({data:{subscription}})},',
            'channel:()=>channel,removeChannel:()=>Promise.resolve(),from:()=>({select:()=>({order:async()=>({data:[],error:null})})})',
            '};',
            'window.__ZAOYOE_SUPABASE_CLIENT_STATE__={status:\'ready\',fixture:true,updatedAt:Date.now()};',
            'window.dispatchEvent?.(new CustomEvent(\'zaoyoe:supabase-client-state\',{detail:window.__ZAOYOE_SUPABASE_CLIENT_STATE__}));',
            '})();'
        ].join('');
        sendText(res, 200, clientStub, 'application/javascript; charset=utf-8');
        return true;
    }
    if (pathname === '/api/shop/catalog' && req.method === 'GET') {
        recordFixtureRequest(req, pathname, 'catalog');
        sendJson(res, 200, fixtureCatalogPayload());
        return true;
    }
    if (pathname === '/fixture/payment.svg' && req.method === 'GET') {
        recordFixtureRequest(req, pathname, 'payment-placeholder');
        sendText(res, 200, '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260"><rect width="260" height="260" fill="#fff"/><path d="M18 18h72v12H30v60H18zm152 0h72v72h-12V30h-60zm72 152v72h-72v-12h60v-60zM18 170h12v60h60v12H18z" fill="#111827"/><text x="130" y="133" text-anchor="middle" fill="#111827" font-family="sans-serif" font-size="14">LOCAL FIXTURE</text></svg>', 'image/svg+xml; charset=utf-8');
        return true;
    }
    if (pathname === '/fixture/audit' && req.method === 'GET') {
        sendJson(res, 200, { success: true, requests: fixtureAudit.slice() });
        return true;
    }
    if (pathname === '/fixture/audit/reset' && req.method === 'POST') {
        fixtureAudit.splice(0, fixtureAudit.length);
        sendJson(res, 200, { success: true });
        return true;
    }
    if (pathname === '/fixture/payment' && req.method === 'GET') {
        recordFixtureRequest(req, pathname, 'payment-placeholder');
        sendText(res, 200, 'Local browser fixture payment placeholder. No payment is possible.', 'text/plain; charset=utf-8');
        return true;
    }
    return false;
}

function proxyToLocalPreview(req, res) {
    const upstream = http.request({
        host: '127.0.0.1',
        port: UPSTREAM_PORT,
        method: req.method,
        path: req.url,
        headers: {
            ...req.headers,
            host: `127.0.0.1:${UPSTREAM_PORT}`
        }
    }, (upstreamRes) => {
        const chunks = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
            let body = Buffer.concat(chunks);
            const contentType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
            if (contentType.includes('text/html')) {
                const html = body.toString('utf8');
                // This runs before the deferred storefront scripts. Some pages read
                // the runtime config before their external /api/runtime script has
                // completed, so the fixture must provide the same safe anonymous
                // shape up front rather than accidentally testing a broken boot.
                const bootstrap = `<script>window.__ZAOYOE_SUPABASE_CONFIG__={url:${JSON.stringify(FIXTURE_ORIGIN)},publishableKey:'fixture-local-publishable-key',site:'cn',auth:{google:{clientIds:{cn:'',intl:''}}}};window.ZAOYOE_PUBLIC_API_BASE_URL=${JSON.stringify(FIXTURE_ORIGIN)};window.VERIFY_SERVER_URL=${JSON.stringify(FIXTURE_ORIGIN)};</script>`;
                body = Buffer.from(html.replace(/<head\b[^>]*>/i, (match) => `${match}${bootstrap}`), 'utf8');
            }
            const headers = { ...upstreamRes.headers, 'content-length': String(body.length), 'cache-control': 'no-store' };
            delete headers['content-encoding'];
            if (contentType.includes('text/html')) {
                headers['content-security-policy'] = "default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'";
            }
            res.writeHead(upstreamRes.statusCode || 502, headers);
            res.end(body);
        });
    });
    upstream.on('error', () => {
        if (!res.headersSent) {
            sendJson(res, 502, {
                success: false,
                code: 'fixture_upstream_unavailable',
                message: `Local preview http://127.0.0.1:${UPSTREAM_PORT} is unavailable.`
            });
        }
    });
    req.pipe(upstream);
}

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${FIXTURE_PORT}`);
    if (handleFixtureInfrastructure(req, res, requestUrl.pathname)) return;
    if (requestUrl.pathname.startsWith('/api/shop/guest/')) {
        void handleGuestFixture(req, res, requestUrl.pathname).catch(() => {
            if (res.headersSent) return;
            sendJson(res, 500, {
                success: false,
                code: 'fixture_request_failed',
                message: 'Local browser fixture could not build a deterministic response.'
            });
        });
        return;
    }
    if (requestUrl.pathname.startsWith('/api/')) {
        recordFixtureRequest(req, requestUrl.pathname, 'blocked-api');
        sendJson(res, 404, {
            success: false,
            code: 'fixture_api_blocked',
            message: 'Local browser fixture blocks non-fixture API calls.'
        });
        return;
    }
    proxyToLocalPreview(req, res);
});

server.listen(FIXTURE_PORT, '127.0.0.1', () => {
    console.log(`Guest browser fixture: http://127.0.0.1:${FIXTURE_PORT}/shop.html?guestScenario=configure`);
});
