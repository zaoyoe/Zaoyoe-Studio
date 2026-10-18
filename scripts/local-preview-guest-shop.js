'use strict';

// Use the deployed buyer-facing API without copying production peppers. Real
// checkout is an explicit local opt-in; internal workers/webhooks stay blocked.
const COOKIE_NAMES = new Map([
    ['__Host-gs-acc', 'gs-preview-access'],
    ['__Host-gs-checkout-intent', 'gs-preview-checkout-intent'],
    ['guest_claim_proof', 'gs-preview-claim-proof']
]);
const ALLOWED_ROUTES = new Map([
    ['guest/preview', 'GET'],
    ['guest/access/availability', 'GET'],
    ['guest/access/login', 'POST'],
    ['guest/access/logout', 'POST'],
    ['guest/orders', 'GET'],
    ['guest/order', 'GET'],
    ['guest/delivery', 'GET']
]);
const CHECKOUT_ROUTES = new Map([
    ['guest/status', 'GET'],
    ['guest/cancel', 'POST'],
    ['guest/claim', 'POST'],
    ['guest/checkout-batches', 'POST'],
    ['guest/checkout-batches/status', 'GET'],
    ['guest/checkout-batches/cancel', 'POST'],
    ['guest/checkout-batches/claim', 'POST']
]);
const CHECKOUT_ACTIONS = new Set(['inspect', 'prepare', 'commit', 'ack', 'discard']);

function resolveGuestShopPreviewOrigin(value = '') {
    if (!String(value).trim()) return '';
    const url = new URL(String(value).trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN must be an HTTPS origin (or HTTP loopback)');
    }
    return url.origin;
}

function resolveGuestShopPreviewConfig(env = {}) {
    const origin = resolveGuestShopPreviewOrigin(env.LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN || '');
    const rawWrites = String(env.LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES || 'false').trim().toLowerCase();
    if (!['true', 'false'].includes(rawWrites)) {
        throw new Error('LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES must be true or false');
    }
    const orderWritesEnabled = rawWrites === 'true';
    const cancellationMode = String(env.LOCAL_PREVIEW_GUEST_SHOP_CANCEL_MODE || 'upstream').trim();
    if (!['upstream', 'local-rpc'].includes(cancellationMode)) {
        throw new Error('LOCAL_PREVIEW_GUEST_SHOP_CANCEL_MODE must be upstream or local-rpc');
    }
    if (cancellationMode === 'local-rpc' && (!origin || !orderWritesEnabled)) {
        throw new Error('Local cancellation requires an upstream and real preview order writes');
    }
    if (orderWritesEnabled && !origin) {
        throw new Error('Real preview orders require LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN');
    }
    return {
        mode: !origin ? 'local' : (orderWritesEnabled ? 'upstream-checkout' : 'upstream-query-and-preview'),
        origin: origin || null,
        orderWritesEnabled,
        cancellationMode
    };
}

function resolveGuestShopPreviewRequest(rawUrl) {
    const url = new URL(rawUrl, 'http://preview.local');
    const pathname = url.pathname.toLowerCase().replace(/\/+$/u, '');
    const normalizeRoute = (value) => String(value || '').trim()
        .replace(/[?#][\s\S]*$/u, '').replace(/^\/+|\/+$/gu, '').toLowerCase();
    let route = '';
    if (pathname === '/api/shop/guest' || pathname.startsWith('/api/shop/guest/')) {
        route = pathname.slice('/api/shop/'.length);
    } else if (pathname === '/api/public' || pathname.startsWith('/api/public/')) {
        const segments = pathname.slice('/api/public'.length).split('/').filter(Boolean);
        const scope = normalizeRoute(url.searchParams.get('scope') || segments[0]);
        if (scope !== 'shop') return null;
        route = url.searchParams.get('route') || segments.slice(1).join('/');
    }
    // Route only to the selected allowlisted path. Never pass query overrides
    // that could make the upstream dispatcher select a different handler.
    for (const key of ['scope', 'route', 'path']) url.searchParams.delete(key);
    route = normalizeRoute(route);
    if (route !== 'guest' && !route.startsWith('guest/')) return null;
    return { route, search: url.search };
}

function isLoopbackAddress(value) {
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(value || '').toLowerCase());
}

function createGuestShopPreviewRelay({ origin = '', orderWritesEnabled = false, cancellationMode = 'upstream', cancelOrder = null, fetchImpl = globalThis.fetch } = {}) {
    const upstreamOrigin = resolveGuestShopPreviewOrigin(origin);
    const checkoutEnabled = orderWritesEnabled === true;
    return async (req, res, next) => {
        if (!upstreamOrigin) return next();
        const target = resolveGuestShopPreviewRequest(req.originalUrl || req.url);
        if (!target) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Local-Preview-Guest-API', checkoutEnabled ? 'upstream-checkout' : 'upstream-query-and-preview');
        const fail = (status, code, message) => res.status(status).json({ success: false, code, message });
        const isIntentInspection = target.route === 'guest/orders' && req.method === 'POST'
            && req.body?.checkoutAction === 'inspect' && Object.keys(req.body).length === 1;
        const isCheckoutRequest = checkoutEnabled && (
            CHECKOUT_ROUTES.get(target.route) === req.method
            || (target.route === 'guest/orders' && req.method === 'POST'
                && CHECKOUT_ACTIONS.has(req.body?.checkoutAction))
        );
        if (!isIntentInspection && !isCheckoutRequest && ALLOWED_ROUTES.get(target.route) !== req.method) {
            return fail(409, 'local_preview_guest_write_disabled', checkoutEnabled
                ? '本地预览只开放买家下单、查询、取消和领取接口。'
                : '本地预览支持线上订单查询和报价；真实下单需启用 LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES。');
        }
        // Never turn a public localhost listener into a cross-site credential
        // relay. The browser must originate on this same preview origin.
        const requestOrigin = req.headers.origin;
        if (req.headers['sec-fetch-site'] === 'cross-site'
            || (requestOrigin && requestOrigin !== `${req.protocol}://${req.get('host')}`)) {
            return fail(403, 'local_preview_origin_invalid', '请从当前本地预览页面发起请求。');
        }
        if (checkoutEnabled) {
            // Restrict the listener as well as the browser origin: a spoofed
            // Origin or Host must not expose checkout through a public tunnel
            // or LAN listener. Host validation also prevents DNS rebinding.
            let hostname = '';
            try { hostname = new URL(`${req.protocol}://${req.get('host')}`).hostname; } catch (_) { /* reject malformed Host */ }
            if (!isLoopbackAddress(req.socket?.remoteAddress)
                || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
                || (req.method === 'POST' && !requestOrigin)) {
                return fail(403, 'local_preview_origin_invalid', '真实订单请从本机预览页面发起请求。');
            }
        }
        const headers = { accept: 'application/json' };
        if (isIntentInspection || isCheckoutRequest) {
            // The local browser origin has been verified above. The upstream
            // owns prices, idempotency, cookies and public payment callbacks.
            headers.origin = 'https://www.fatherkey.com';
            headers['sec-fetch-site'] = 'same-origin';
        }
        for (const name of ['content-type', 'user-agent', 'x-guest-order-credential']) {
            if (req.headers[name]) headers[name] = req.headers[name];
        }
        // Keep opaque credentials HttpOnly and separate from production cookies.
        // Only the three buyer cookies are relayed, never main-site auth or
        // administrative/worker credentials. Read-only mode uses access only.
        const cookieNames = [...COOKIE_NAMES].filter(([name]) => checkoutEnabled || name === '__Host-gs-acc');
        const incomingCookies = String(req.headers.cookie || '').split(';').map((part) => part.trim());
        const cookies = cookieNames.flatMap(([name, previewName]) => {
            const cookie = incomingCookies.find((part) => part.startsWith(`${previewName}=`));
            return cookie ? [`${name}=${cookie.slice(previewName.length + 1)}`] : [];
        });
        if (cookies.length) headers.cookie = cookies.join('; ');
        const body = req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined;
        if (body && Buffer.byteLength(body) > 8192) {
            return fail(413, 'local_preview_body_too_large', '请求过大。');
        }
        try {
            if (cancellationMode === 'local-rpc' && checkoutEnabled && target.route === 'guest/cancel') {
                res.setHeader('X-Local-Preview-Guest-Cancellation', 'local-rpc-after-upstream-auth');
                if (typeof cancelOrder !== 'function') {
                    return fail(503, 'local_preview_guest_cancel_unavailable', '本地取消服务未配置，原订单已保留。');
                }
                return await cancelOrder({ req, res, headers, origin: upstreamOrigin, fetchImpl });
            }
            const upstream = await fetchImpl(`${upstreamOrigin}/api/shop/${target.route}${target.search}`, {
                method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(isCheckoutRequest ? 60000 : 15000)
            });
            const buffer = Buffer.from(await upstream.arrayBuffer());
            for (const name of ['content-type', 'content-disposition', 'retry-after']) {
                const value = upstream.headers.get(name);
                if (value) res.setHeader(name, value);
            }
            for (const cookie of upstream.headers.getSetCookie()) {
                const mapping = cookieNames.find(([name]) => cookie.startsWith(`${name}=`));
                if (!mapping) continue;
                const [name, previewName] = mapping;
                const value = cookie.slice(name.length + 1).split(';')[0];
                const maxAge = cookie.match(/;\s*Max-Age=(-?\d+)/iu)?.[1] || '0';
                res.append('Set-Cookie', `${previewName}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`);
            }
            return res.status(upstream.status).send(buffer);
        } catch (_) {
            // No fallback to mismatched local configuration, and no logging of
            // credential headers, cookies, request bodies or upstream errors.
            return fail(502, 'local_preview_guest_upstream_unavailable', isCheckoutRequest
                ? '线上订单服务暂时无法连接，请重试确认原订单结果；请勿重复付款。'
                : '线上订单查询服务暂时无法连接，请稍后重试。');
        }
    };
}

module.exports = { createGuestShopPreviewRelay, resolveGuestShopPreviewConfig, resolveGuestShopPreviewOrigin, resolveGuestShopPreviewRequest };
