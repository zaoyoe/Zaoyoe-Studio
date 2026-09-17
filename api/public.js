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
        const { createGuestShopPaymentAdapter } = require('./_lib/payments/guest-shop-adapter');
        const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');
        const {
            createGuestShopWorkerHandler,
            createGuestShopFulfillmentKicker,
            isGuestShopImmediateFulfillmentEnabled
        } = require('../server/guest-shop-worker');
        const {
            createShopHandlers
        } = require('../server/api-handlers/public/shop');

        // Guest cash payments have their own adapter and service-role client.
        // Do not fall back to the logged-in wallet/payment adapter when this
        // configuration is unavailable: the guest route must fail closed.
        const guestPaymentAdapter = createGuestShopPaymentAdapter({
            supabase: admin.getOptionalSupabaseAdmin?.() || null,
            env: process.env
        });
        // Only the long-running KVM4 verify-server process receives the
        // in-process fulfillment kick. Vercel and the standalone serverless
        // route modules keep the durable worker timer as their fallback.
        const immediateFulfillment = typeof isGuestShopImmediateFulfillmentEnabled === 'function'
            && typeof createGuestShopFulfillmentKicker === 'function'
            && isGuestShopImmediateFulfillmentEnabled(process.env)
            ? createGuestShopFulfillmentKicker({
                supabase: admin.getOptionalSupabaseAdmin?.() || null,
                paymentAdapter: guestPaymentAdapter,
                env: process.env
            })
            : null;
        const guestHandlers = createGuestShopHandlers({
            admin,
            requestSecurity,
            site,
            paymentAdapter: guestPaymentAdapter,
            kickFulfillment: immediateFulfillment?.kick,
            env: process.env
        });
        const guestWorker = createGuestShopWorkerHandler({
            admin,
            paymentAdapter: guestPaymentAdapter,
            env: process.env
        });

        return {
            ...createShopHandlers({
                admin,
                requestSecurity,
                site,
                discountAssets,
                discountPricing,
                env: process.env
            }),
            'guest/preview': guestHandlers.preview,
            'guest/orders': guestHandlers.orders,
            'guest/status': guestHandlers.status,
            'guest/recover': guestHandlers.recover,
            'guest/claim': guestHandlers.claim,
            // KVM4 routes /api/shop/* through this shared dispatcher.  Keep
            // the worker behind its dedicated secret gate in both Vercel and
            // the shared Express path; never expose it through the regular
            // logged-in shop handler.
            'guest/worker': guestWorker,
            // Keep provider-specific webhook routes explicit.  Payment
            // adapters generate these exact paths, and the shared dispatcher
            // must not collapse them into an unbound generic provider route.
            'guest/webhooks/zpay': (req, res) => guestHandlers.webhook(req, res, 'zpay'),
            'guest/webhooks/nowpayments': (req, res) => guestHandlers.webhook(req, res, 'nowpayments'),
            // Backward-compatible internal route; callers must still provide
            // an explicit provider query value accepted by the handler.
            'guest/webhook': guestHandlers.webhook
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
