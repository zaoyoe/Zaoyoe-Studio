const crypto = require('node:crypto');
const {
    buildMarketplaceSecretKey,
    loadMarketplaceChannelsConfig,
    sanitizeText
} = require('../../../api/_lib/marketplace-channels');
const {
    createMarketplaceShopOrder,
    resolveMarketplaceOrderChannelContext
} = require('../../../api/_lib/marketplace-orders');
const {
    getStoredAdminSecret
} = require('../../../api/_lib/secrets');

const MARKETPLACE_INGEST_SECRET_NAME = 'ingest_token';

function constantTimeTextEquals(left = '', right = '') {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getHeaderValue(req, headerName = '') {
    const headers = req?.headers || {};
    const normalizedHeaderName = String(headerName || '').trim().toLowerCase();
    const direct = headers[headerName] || headers[normalizedHeaderName] || headers[String(headerName || '').trim().toUpperCase()];
    if (Array.isArray(direct)) {
        return String(direct[0] || '').trim();
    }
    if (direct !== undefined && direct !== null) {
        return String(direct || '').trim();
    }

    const matchedKey = Object.keys(headers).find((key) => String(key || '').trim().toLowerCase() === normalizedHeaderName);
    const matchedValue = matchedKey ? headers[matchedKey] : '';
    return Array.isArray(matchedValue)
        ? String(matchedValue[0] || '').trim()
        : String(matchedValue || '').trim();
}

function getBearerToken(req) {
    const authorization = getHeaderValue(req, 'authorization');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function getMarketplaceIngestToken(req) {
    return getBearerToken(req)
        || getHeaderValue(req, 'x-marketplace-ingest-token')
        || getHeaderValue(req, 'x-xianyu-ingest-token');
}

function getRequestUrl(req) {
    return new URL(req?.url || '/api/marketplace/orders', 'http://localhost');
}

function applyPrivateJsonHeaders(res) {
    if (!res?.setHeader) return;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

function getOptionalBodyValue(body = {}, keys = []) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return '';

    for (const key of keys) {
        const value = body[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            return value;
        }
    }

    return '';
}

function buildChannelLookupPayload(req, body = {}) {
    const url = getRequestUrl(req);
    const explicitChannel = getOptionalBodyValue(body, [
        'channel_key',
        'channelKey',
        'channel',
        'marketplace'
    ]);
    const queryChannel = url.searchParams.get('channel') || url.searchParams.get('channel_key') || url.searchParams.get('marketplace');
    const fallbackChannel = getOptionalBodyValue(body, [
        'source_channel',
        'sourceChannel'
    ]);
    const explicitAccount = getOptionalBodyValue(body, [
        'channel_account_key',
        'channelAccountKey',
        'account_key',
        'accountKey',
        'account'
    ]);
    const queryAccount = url.searchParams.get('account') || url.searchParams.get('account_key');
    const resolvedChannel = queryChannel || explicitChannel || fallbackChannel;
    const resolvedAccount = queryAccount || explicitAccount;

    return {
        ...body,
        channel_key: resolvedChannel,
        channel: resolvedChannel,
        marketplace: resolvedChannel,
        source_channel: resolvedChannel,
        sourceChannel: resolvedChannel,
        channel_account_key: resolvedAccount,
        channelAccountKey: resolvedAccount,
        account_key: resolvedAccount,
        accountKey: resolvedAccount,
        account: resolvedAccount
    };
}

async function verifyMarketplaceIngestToken({
    supabase,
    req,
    body,
    config,
    getStoredSecret = getStoredAdminSecret
} = {}) {
    const lookupPayload = buildChannelLookupPayload(req, body);
    const context = resolveMarketplaceOrderChannelContext(lookupPayload, config);
    const secretKey = buildMarketplaceSecretKey(context.channelKey, context.accountKey, MARKETPLACE_INGEST_SECRET_NAME);

    if (!secretKey) {
        throw Object.assign(new Error('Marketplace ingest token key is invalid'), {
            statusCode: 400,
            code: 'marketplace_ingest_token_key_invalid'
        });
    }

    const storedSecret = await getStoredSecret(supabase, secretKey, {
        allowDecryptFailure: true
    });
    if (storedSecret?.decryptErrorMessage) {
        throw Object.assign(new Error(storedSecret.decryptErrorMessage), {
            statusCode: 503,
            code: 'marketplace_ingest_token_unavailable'
        });
    }
    if (!storedSecret?.value) {
        throw Object.assign(new Error(`Marketplace ingest token is not configured for ${context.channelKey}/${context.accountKey}`), {
            statusCode: 503,
            code: 'marketplace_ingest_token_not_configured'
        });
    }

    const receivedToken = sanitizeText(getMarketplaceIngestToken(req), 4000);
    if (!receivedToken || !constantTimeTextEquals(receivedToken, storedSecret.value)) {
        throw Object.assign(new Error('Marketplace ingest token is invalid'), {
            statusCode: 401,
            code: 'marketplace_ingest_token_invalid'
        });
    }

    return {
        ...context,
        secretKey
    };
}

function createMarketplaceHandlers({
    admin,
    requestSecurity,
    marketplaceOrders,
    marketplaceChannels,
    secrets,
    env = process.env
} = {}) {
    const {
        getSupabaseAdmin,
        parseJsonBody,
        sendJson
    } = admin || {};
    const {
        applyRateLimitHeaders,
        resolveClientIp,
        takeRateLimitToken
    } = requestSecurity || {};
    const resolvedOrders = marketplaceOrders || {
        createMarketplaceShopOrder
    };
    const resolvedChannels = marketplaceChannels || {
        loadMarketplaceChannelsConfig
    };
    const resolvedSecrets = secrets || {
        getStoredAdminSecret
    };
    const parseBody = typeof parseJsonBody === 'function'
        ? parseJsonBody
        : async function defaultParseJsonBody() {
            return {};
        };
    const writeJson = typeof sendJson === 'function'
        ? sendJson
        : function defaultSendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        };

    async function ordersHandler(req, res) {
        applyPrivateJsonHeaders(res);

        if (String(req.method || '').toUpperCase() !== 'POST') {
            res.setHeader('Allow', 'POST');
            return writeJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        let supabase;
        try {
            supabase = getSupabaseAdmin?.();
        } catch (error) {
            return writeJson(res, 503, {
                success: false,
                code: 'marketplace_order_service_unavailable',
                message: error?.message || 'Marketplace order service is unavailable'
            });
        }

        if (!supabase) {
            return writeJson(res, 503, {
                success: false,
                code: 'marketplace_order_service_unavailable',
                message: 'Marketplace order service is unavailable'
            });
        }

        const clientIp = typeof resolveClientIp === 'function'
            ? resolveClientIp(req, { env })
            : '';
        if (typeof takeRateLimitToken === 'function') {
            const rateLimit = await takeRateLimitToken({
                supabase,
                key: `marketplace-ingest:${clientIp || 'unknown'}`,
                limit: Math.max(1, Number(env.MARKETPLACE_INGEST_RATE_LIMIT_MAX || 120)),
                windowMs: Math.max(10_000, Number(env.MARKETPLACE_INGEST_RATE_LIMIT_WINDOW_MS || 60_000))
            });
            if (typeof applyRateLimitHeaders === 'function') {
                applyRateLimitHeaders(res, rateLimit);
            }
            if (!rateLimit.allowed) {
                return writeJson(res, 429, {
                    success: false,
                    code: 'rate_limited',
                    message: 'Too many marketplace ingest requests',
                    retry_after_seconds: rateLimit.retryAfterSeconds
                });
            }
        }

        try {
            const body = await parseBody(req);
            const config = await resolvedChannels.loadMarketplaceChannelsConfig(supabase, env);
            const tokenContext = await verifyMarketplaceIngestToken({
                supabase,
                req,
                body,
                config,
                getStoredSecret: resolvedSecrets.getStoredAdminSecret
            });
            const payload = {
                ...body,
                channel_key: tokenContext.channelKey,
                channel: tokenContext.channelKey,
                source_channel: tokenContext.channel?.source_channel || tokenContext.channelKey,
                channel_account_key: tokenContext.accountKey,
                account_key: tokenContext.accountKey,
                account: tokenContext.accountKey
            };
            const { request, result } = await resolvedOrders.createMarketplaceShopOrder({
                supabase,
                payload,
                config,
                env
            });
            const success = result?.success === true;

            return writeJson(res, success ? 200 : 400, {
                success,
                duplicate: result?.duplicate === true,
                message: result?.message || (success ? 'Marketplace order created' : 'Marketplace order failed'),
                request,
                data: result?.data || null
            });
        } catch (error) {
            return writeJson(res, Number(error?.statusCode) || 500, {
                success: false,
                code: error?.code || 'marketplace_order_ingest_failed',
                message: error?.message || 'Marketplace order ingest failed'
            });
        }
    }

    return {
        orders: ordersHandler
    };
}

module.exports = {
    MARKETPLACE_INGEST_SECRET_NAME,
    constantTimeTextEquals,
    createMarketplaceHandlers,
    getMarketplaceIngestToken,
    verifyMarketplaceIngestToken
};
