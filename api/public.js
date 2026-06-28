const admin = require('./_lib/admin');
const requestSecurity = require('./_lib/request-security');
const { buildSupabaseRuntimeScript } = require('./_lib/public-runtime-config');

const ROUTE_HANDLER_CACHE = new Map();

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

    const pathParts = normalizeRouteValue(url.pathname).split('/').filter(Boolean);
    const [firstPart, secondPart] = pathParts;
    if (firstPart === 'api' && secondPart && secondPart !== 'public') {
        return secondPart;
    }

    const [scope] = pathParts;
    return scope || '';
}

function resolveRoute(url, scope) {
    const queryRoute = normalizeRouteValue(url.searchParams.get('route'));
    if (queryRoute) {
        return queryRoute;
    }

    const normalizedPath = normalizeRouteValue(url.pathname);
    const pathParts = normalizedPath.split('/').filter(Boolean);
    if (pathParts[0] === 'api') {
        if (pathParts[1] === 'public') {
            if (pathParts[2] === scope) {
                return pathParts.slice(3).join('/');
            }
            return pathParts.slice(2).join('/');
        }
        if (pathParts[1] === scope) {
            return pathParts.slice(2).join('/');
        }
    }

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
        const {
            createRuntimeSectionVisibilityPreloadHandler
        } = require('../server/api-handlers/public/runtime-section-visibility-preload');

        return {
            'supabase-config': createRuntimeSupabaseConfigHandler({
                buildSupabaseRuntimeScript,
                env: process.env
            }),
            'section-visibility-preload': createRuntimeSectionVisibilityPreloadHandler({
                admin
            })
        };
    }
    case 'monitoring': {
        const {
            clientMonitoringEventHandler
        } = require('../server/api-handlers/public/monitoring-client-event');

        return {
            'client-event': clientMonitoringEventHandler
        };
    }
    case 'marketplace': {
        const {
            createMarketplaceHandlers
        } = require('../server/api-handlers/public/marketplace');

        return {
            ...createMarketplaceHandlers({
                admin,
                requestSecurity,
                env: process.env
            })
        };
    }
    case 'ops': {
        const {
            createOpsHandlers
        } = require('../server/api-handlers/public/ops');

        return {
            ...createOpsHandlers({
                admin,
                env: process.env
            })
        };
    }
    case 'engagement': {
        const {
            createPublicEngagementHandlers
        } = require('../server/api-handlers/public/engagement');

        return {
            ...createPublicEngagementHandlers({
                admin
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
    case 'ai-image': {
        const {
            createAiImageHandlers
        } = require('../server/api-handlers/public/ai-image');

        return {
            ...createAiImageHandlers({
                admin,
                env: process.env,
                requestSecurity
            })
        };
    }
    case 'wallet': {
        const site = require('./_lib/site');
        const {
            createWalletHandlers
        } = require('../server/api-handlers/public/wallet');
        const {
            createWalletCheckinHandler
        } = require('../server/api-handlers/public/wallet-checkin');
        const walletHandlers = createWalletHandlers({
            admin,
            site
        });

        return {
            ...walletHandlers,
            'order-detail': walletHandlers.orderDetail,
            'prompt-titles': walletHandlers.promptTitles,
            'verify-log': walletHandlers.verifyLog,
            checkin: createWalletCheckinHandler({
                admin,
                site
            })
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
