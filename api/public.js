const admin = require('./_lib/admin');
const requestSecurity = require('./_lib/request-security');
const { buildSupabaseRuntimeScript } = require('./_lib/public-runtime-config');

const ROUTE_HANDLER_CACHE = new Map();
let walletCheckinHandler = null;
let walletCheckinHandlerLoadError = null;

try {
    walletCheckinHandler = require('./wallet/checkin');
} catch (error) {
    walletCheckinHandlerLoadError = error;
}

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

function createRouteHandlersForScope(scope) {
    switch (scope) {
    case 'auth': {
        const {
            createLoginSecurityHandler
        } = require('../server/api-handlers/public/auth-login-security');

        return {
            'login-security': createLoginSecurityHandler({
                admin,
                requestSecurity,
                env: process.env
            })
        };
    }
    case 'config': {
        const {
            createPublicConfigHandlers
        } = require('../server/api-handlers/public/config');

        return {
            ...createPublicConfigHandlers({
                admin
            })
        };
    }
    case 'payments': {
        const paymentProviders = require('./_lib/payments/providers');
        const paymentOrders = require('./_lib/payments/orders');
        const {
            createPaymentsHandlers
        } = require('../server/api-handlers/public/payments');

        return {
            ...createPaymentsHandlers({
                admin,
                requestSecurity,
                paymentProviders,
                paymentOrders,
                env: process.env
            })
        };
    }
    case 'runtime': {
        const {
            createRuntimeSupabaseConfigHandler
        } = require('../server/api-handlers/public/runtime-supabase-config');

        return {
            'supabase-config': createRuntimeSupabaseConfigHandler({
                buildSupabaseRuntimeScript,
                env: process.env
            })
        };
    }
    case 'shop': {
        const site = require('./_lib/site');
        const discountAssets = require('./_lib/discount-assets');
        const discountPricing = require('./_lib/discount-pricing');
        const {
            createShopHandlers
        } = require('../server/api-handlers/public/shop');

        return {
            ...createShopHandlers({
                admin,
                requestSecurity,
                site,
                discountAssets,
                discountPricing,
                env: process.env
            })
        };
    }
    case 'verify': {
        const {
            createPublicVerifyHandlers
        } = require('../server/api-handlers/public/verify');

        return {
            ...createPublicVerifyHandlers({
                admin
            })
        };
    }
    case 'wallet': {
        const site = require('./_lib/site');
        const {
            createWalletHandlers
        } = require('../server/api-handlers/public/wallet');
        const walletHandlers = createWalletHandlers({
            admin,
            site
        });

        return {
            ...walletHandlers,
            'order-detail': walletHandlers.orderDetail,
            'prompt-titles': walletHandlers.promptTitles,
            'verify-log': walletHandlers.verifyLog,
            async checkin(req, res) {
                if (!walletCheckinHandler) {
                    return sendScopeInitializationFailure(res, 'wallet', walletCheckinHandlerLoadError);
                }

                return walletCheckinHandler(req, res);
            }
        };
    }
    default:
        return null;
    }
}

function getRouteHandlersForScope(scope) {
    const normalizedScope = normalizeRouteValue(scope);
    if (!normalizedScope) {
        return null;
    }

    if (ROUTE_HANDLER_CACHE.has(normalizedScope)) {
        return ROUTE_HANDLER_CACHE.get(normalizedScope);
    }

    const handlers = createRouteHandlersForScope(normalizedScope);
    if (handlers) {
        ROUTE_HANDLER_CACHE.set(normalizedScope, handlers);
    }

    return handlers;
}

function sendScopeInitializationFailure(res, scope, error) {
    console.error(`[public-api] Failed to initialize "${scope}" scope:`, error);

    if (scope === 'runtime') {
        const serializedMessage = JSON.stringify(error?.message || `Failed to initialize ${scope} scope`);
        res.status(500);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
            [
                '(function (global) {',
                `  console.error('Failed to initialize public runtime scope:', ${serializedMessage});`,
                '  global.__ZAOYOE_SUPABASE_CONFIG__ = null;',
                '}(typeof window !== "undefined" ? window : globalThis));'
            ].join('\n')
        );
        return;
    }

    return admin.sendJson(res, 500, {
        success: false,
        message: 'Public route handler unavailable'
    });
}

module.exports = async function handler(req, res) {
    const url = new URL(req.url || '', 'http://localhost');
    const scope = resolveScope(url);
    const route = resolveRoute(url, scope);

    let routeHandlers;
    try {
        routeHandlers = getRouteHandlersForScope(scope);
    } catch (error) {
        return sendScopeInitializationFailure(res, scope, error);
    }

    const resolvedHandler = routeHandlers?.[route];

    if (!resolvedHandler) {
        return admin.sendJson(res, 404, {
            success: false,
            message: 'Public route not found'
        });
    }

    return resolvedHandler(req, res);
};
