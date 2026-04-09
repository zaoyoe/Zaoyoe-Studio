const admin = require('./_lib/admin');
const requestSecurity = require('./_lib/request-security');
const { buildSupabaseRuntimeScript } = require('./_lib/public-runtime-config');
const paymentProviders = require('./_lib/payments/providers');
const paymentOrders = require('./_lib/payments/orders');
const site = require('./_lib/site');
const discountAssets = require('./_lib/discount-assets');
const discountPricing = require('./_lib/discount-pricing');
const {
    createRuntimeSupabaseConfigHandler
} = require('../server/api-handlers/public/runtime-supabase-config');
const {
    createLoginSecurityHandler
} = require('../server/api-handlers/public/auth-login-security');
const {
    createPaymentsHandlers
} = require('../server/api-handlers/public/payments');
const {
    createShopHandlers
} = require('../server/api-handlers/public/shop');

const runtimeSupabaseConfigHandler = createRuntimeSupabaseConfigHandler({
    buildSupabaseRuntimeScript,
    env: process.env
});
const loginSecurityHandler = createLoginSecurityHandler({
    admin,
    requestSecurity,
    env: process.env
});
const paymentHandlers = createPaymentsHandlers({
    admin,
    requestSecurity,
    paymentProviders,
    paymentOrders,
    env: process.env
});
const shopHandlers = createShopHandlers({
    admin,
    requestSecurity,
    site,
    discountAssets,
    discountPricing,
    env: process.env
});

const ROUTE_HANDLERS = {
    auth: {
        'login-security': loginSecurityHandler
    },
    payments: {
        ...paymentHandlers
    },
    runtime: {
        'supabase-config': runtimeSupabaseConfigHandler
    },
    shop: {
        ...shopHandlers
    }
};

function normalizeRouteValue(value = '') {
    return String(value || '')
        .trim()
        .replace(/[?#][\s\S]*$/, '')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase();
}

function resolveScope(url) {
    const queryScope = normalizeRouteValue(url.searchParams.get('scope'));
    if (queryScope) {
        return queryScope;
    }

    const [scope] = normalizeRouteValue(url.pathname).split('/');
    return scope || '';
}

function resolveRoute(url, scope) {
    const queryRoute = normalizeRouteValue(url.searchParams.get('route'));
    if (queryRoute) {
        return queryRoute;
    }

    const normalizedPath = normalizeRouteValue(url.pathname);
    if (!scope || !normalizedPath.startsWith(`${scope}/`)) {
        return normalizedPath;
    }

    return normalizedPath.slice(scope.length + 1);
}

module.exports = async function handler(req, res) {
    const url = new URL(req.url || '', 'http://localhost');
    const scope = resolveScope(url);
    const route = resolveRoute(url, scope);
    const resolvedHandler = ROUTE_HANDLERS[scope]?.[route];

    if (!resolvedHandler) {
        return admin.sendJson(res, 404, {
            success: false,
            message: 'Public route not found'
        });
    }

    return resolvedHandler(req, res);
};
