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
const {
    buildMarketplaceOrderPayload
} = require('../../../adapters/xianyu/core');

const MARKETPLACE_INGEST_SECRET_NAME = 'ingest_token';

function normalizeUuid(value) {
    const normalized = sanitizeText(value, 120);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : '';
}

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

function getByPath(source, path) {
    if (!source || typeof source !== 'object' || !path) return undefined;
    const segments = String(path || '').split('.').map((segment) => segment.trim()).filter(Boolean);
    let current = source;

    for (const segment of segments) {
        if (current === null || current === undefined) return undefined;
        if (Array.isArray(current) && /^\d+$/.test(segment)) {
            current = current[Number(segment)];
            continue;
        }
        current = current[segment];
    }

    return current;
}

function pickOptionalBodyValue(body = {}, keys = []) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return '';

    for (const key of keys) {
        const value = String(key || '').includes('.')
            ? getByPath(body, key)
            : body[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            return value;
        }
    }

    return '';
}

function normalizeXianyuDeliverPayload(body = {}) {
    const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const order = source.order && typeof source.order === 'object' && !Array.isArray(source.order)
        ? source.order
        : {};

    return {
        external_order_id: sanitizeText(pickOptionalBodyValue(source, [
            'external_order_id',
            'externalOrderId',
            'order_id',
            'orderId',
            'trade_id',
            'tradeId',
            'bizOrderId',
            'biz_order_id',
            'id',
            'order.external_order_id',
            'order.order_id',
            'order.orderId',
            'order.id'
        ]), 180),
        xianyu_item_id: sanitizeText(pickOptionalBodyValue(source, [
            'xianyu_item_id',
            'xianyuItemId',
            'item_id',
            'itemId',
            'goods_id',
            'goodsId',
            'auction_id',
            'auctionId',
            'order.xianyu_item_id',
            'order.item_id',
            'order.itemId',
            'order.item.id',
            'order.item.itemId'
        ]), 180),
        sku_id: sanitizeText(pickOptionalBodyValue(source, [
            'sku_id',
            'skuId',
            'order.sku_id',
            'order.skuId',
            'order.item.skuId'
        ]), 180),
        sku_text: sanitizeText(pickOptionalBodyValue(source, [
            'sku_text',
            'skuText',
            'spec_text',
            'specText',
            'propertiesName',
            'order.sku_text',
            'order.skuText',
            'order.spec_text',
            'order.item.skuText'
        ]), 500),
        item_title: sanitizeText(pickOptionalBodyValue(source, [
            'item_title',
            'itemTitle',
            'title',
            'order.item_title',
            'order.itemTitle',
            'order.title',
            'order.item.title'
        ]), 500),
        quantity: pickOptionalBodyValue(source, [
            'quantity',
            'qty',
            'count',
            'order_quantity',
            'orderQuantity',
            'order.quantity',
            'order.qty',
            'order.count'
        ]),
        price_paid: pickOptionalBodyValue(source, [
            'price_paid',
            'pricePaid',
            'payAmount',
            'order.price_paid',
            'order.payAmount'
        ]),
        total_price: pickOptionalBodyValue(source, [
            'total_price',
            'totalPrice',
            'totalAmount',
            'order.total_price',
            'order.totalAmount'
        ]),
        external_buyer_id: sanitizeText(pickOptionalBodyValue(source, [
            'external_buyer_id',
            'externalBuyerId',
            'buyer_id',
            'buyerId',
            'order.buyer_id',
            'order.buyerId',
            'order.buyer.id'
        ]), 180),
        external_buyer_name: sanitizeText(pickOptionalBodyValue(source, [
            'external_buyer_name',
            'externalBuyerName',
            'buyer_name',
            'buyerName',
            'buyerNick',
            'buyer_nick',
            'order.buyer_name',
            'order.buyerName',
            'order.buyerNick',
            'order.buyer.nick'
        ]), 180),
        spec_name: sanitizeText(pickOptionalBodyValue(source, ['spec_name', 'specName', 'order.spec_name', 'order.specName']), 180),
        spec_value: sanitizeText(pickOptionalBodyValue(source, ['spec_value', 'specValue', 'order.spec_value', 'order.specValue']), 180),
        spec_name_2: sanitizeText(pickOptionalBodyValue(source, ['spec_name_2', 'specName2', 'order.spec_name_2', 'order.specName2']), 180),
        spec_value_2: sanitizeText(pickOptionalBodyValue(source, ['spec_value_2', 'specValue2', 'order.spec_value_2', 'order.specValue2']), 180),
        cookie_id: sanitizeText(pickOptionalBodyValue(source, [
            'cookie_id',
            'cookieId',
            'seller_id',
            'sellerId',
            'order.cookie_id',
            'order.cookieId'
        ]), 180),
        pay_status: sanitizeText(pickOptionalBodyValue(source, [
            'pay_status',
            'payStatus',
            'status',
            'order.pay_status',
            'order.payStatus',
            'order.status'
        ]), 180),
        raw: {
            ...source,
            order
        }
    };
}

function buildXianyuMarketplaceOrderPayload(normalizedOrder = {}, tokenContext = {}, body = {}) {
    const explicitProductId = normalizeUuid(
        body.product_id
        || body.productId
        || body.website_product_id
        || body.websiteProductId
    );
    const baseConfig = {
        channel: tokenContext.channelKey || 'xianyu',
        account: tokenContext.accountKey || 'main',
        site: body.site,
        product_mappings: Array.isArray(tokenContext.channel?.product_mappings)
            ? tokenContext.channel.product_mappings
            : []
    };

    if (explicitProductId) {
        return {
            product_id: explicitProductId,
            channel: baseConfig.channel,
            account: baseConfig.account,
            site: sanitizeText(body.site, 20).toLowerCase() === 'intl' ? 'intl' : 'cn',
            external_order_id: normalizedOrder.external_order_id,
            quantity: normalizedOrder.quantity,
            price_paid: normalizedOrder.price_paid,
            total_price: normalizedOrder.total_price,
            external_buyer_id: normalizedOrder.external_buyer_id,
            external_buyer_name: normalizedOrder.external_buyer_name,
            snapshot: {
                adapter: 'xianyu-api-card',
                mapping: { source: 'explicit_product_id' },
                xianyu_item_id: normalizedOrder.xianyu_item_id,
                sku_id: normalizedOrder.sku_id,
                sku_text: normalizedOrder.sku_text,
                item_title: normalizedOrder.item_title,
                spec_name: normalizedOrder.spec_name,
                spec_value: normalizedOrder.spec_value,
                spec_name_2: normalizedOrder.spec_name_2,
                spec_value_2: normalizedOrder.spec_value_2,
                cookie_id: normalizedOrder.cookie_id,
                pay_status: normalizedOrder.pay_status,
                raw: normalizedOrder.raw
            }
        };
    }

    const orderForMapping = {
        external_order_id: normalizedOrder.external_order_id,
        xianyu_item_id: normalizedOrder.xianyu_item_id,
        sku_id: normalizedOrder.sku_id,
        sku_text: normalizedOrder.sku_text || normalizedOrder.spec_value,
        item_title: normalizedOrder.item_title,
        quantity: normalizedOrder.quantity,
        price_paid: normalizedOrder.price_paid,
        total_price: normalizedOrder.total_price,
        external_buyer_id: normalizedOrder.external_buyer_id,
        external_buyer_name: normalizedOrder.external_buyer_name,
        pay_status: normalizedOrder.pay_status || 'paid',
        raw: {
            ...normalizedOrder.raw,
            spec_name: normalizedOrder.spec_name,
            spec_value: normalizedOrder.spec_value,
            spec_name_2: normalizedOrder.spec_name_2,
            spec_value_2: normalizedOrder.spec_value_2,
            cookie_id: normalizedOrder.cookie_id
        }
    };
    const payload = buildMarketplaceOrderPayload(orderForMapping, baseConfig);
    payload.snapshot = {
        ...(payload.snapshot || {}),
        adapter: 'xianyu-api-card',
        spec_name: normalizedOrder.spec_name,
        spec_value: normalizedOrder.spec_value,
        spec_name_2: normalizedOrder.spec_name_2,
        spec_value_2: normalizedOrder.spec_value_2,
        cookie_id: normalizedOrder.cookie_id
    };
    return payload;
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

    async function loadSupabaseForMarketplace(res) {
        let supabase;
        try {
            supabase = getSupabaseAdmin?.();
        } catch (error) {
            writeJson(res, 503, {
                success: false,
                code: 'marketplace_order_service_unavailable',
                message: error?.message || 'Marketplace order service is unavailable'
            });
            return null;
        }

        if (!supabase) {
            writeJson(res, 503, {
                success: false,
                code: 'marketplace_order_service_unavailable',
                message: 'Marketplace order service is unavailable'
            });
            return null;
        }

        return supabase;
    }

    async function applyMarketplaceRateLimit({ req, res, supabase, keyPrefix }) {
        const clientIp = typeof resolveClientIp === 'function'
            ? resolveClientIp(req, { env })
            : '';
        if (typeof takeRateLimitToken !== 'function') {
            return true;
        }

        const rateLimit = await takeRateLimitToken({
            supabase,
            key: `${keyPrefix}:${clientIp || 'unknown'}`,
            limit: Math.max(1, Number(env.MARKETPLACE_INGEST_RATE_LIMIT_MAX || 120)),
            windowMs: Math.max(10_000, Number(env.MARKETPLACE_INGEST_RATE_LIMIT_WINDOW_MS || 60_000))
        });
        if (typeof applyRateLimitHeaders === 'function') {
            applyRateLimitHeaders(res, rateLimit);
        }
        if (!rateLimit.allowed) {
            writeJson(res, 429, {
                success: false,
                code: 'rate_limited',
                message: 'Too many marketplace ingest requests',
                retry_after_seconds: rateLimit.retryAfterSeconds
            });
            return false;
        }

        return true;
    }

    async function ordersHandler(req, res) {
        applyPrivateJsonHeaders(res);

        if (String(req.method || '').toUpperCase() !== 'POST') {
            res.setHeader('Allow', 'POST');
            return writeJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = await loadSupabaseForMarketplace(res);
        if (!supabase) return null;

        const rateLimitAllowed = await applyMarketplaceRateLimit({
            req,
            res,
            supabase,
            keyPrefix: 'marketplace-ingest'
        });
        if (!rateLimitAllowed) return null;

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

    async function xianyuDeliverHandler(req, res) {
        applyPrivateJsonHeaders(res);

        if (String(req.method || '').toUpperCase() !== 'POST') {
            res.setHeader('Allow', 'POST');
            return writeJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const supabase = await loadSupabaseForMarketplace(res);
        if (!supabase) return null;

        const rateLimitAllowed = await applyMarketplaceRateLimit({
            req,
            res,
            supabase,
            keyPrefix: 'marketplace-xianyu-deliver'
        });
        if (!rateLimitAllowed) return null;

        try {
            const body = await parseBody(req);
            const normalizedOrder = normalizeXianyuDeliverPayload(body);

            if (!normalizedOrder.external_order_id) {
                return writeJson(res, 400, {
                    success: false,
                    code: 'xianyu_external_order_id_required',
                    message: 'external_order_id is required'
                });
            }

            const config = await resolvedChannels.loadMarketplaceChannelsConfig(supabase, env);
            const tokenContext = await verifyMarketplaceIngestToken({
                supabase,
                req,
                body: {
                    ...body,
                    channel: 'xianyu'
                },
                config,
                getStoredSecret: resolvedSecrets.getStoredAdminSecret
            });

            if (tokenContext.channelKey !== 'xianyu' && tokenContext.channel?.type !== 'xianyu') {
                return writeJson(res, 409, {
                    success: false,
                    code: 'xianyu_channel_required',
                    message: 'This endpoint only accepts the xianyu marketplace channel'
                });
            }

            const payload = buildXianyuMarketplaceOrderPayload(normalizedOrder, tokenContext, body);
            const { request, result } = await resolvedOrders.createMarketplaceShopOrder({
                supabase,
                payload,
                config,
                env
            });
            const success = result?.success === true;
            const deliveryContent = sanitizeText(result?.data?.content, 20_000);

            if (!success) {
                return writeJson(res, 400, {
                    success: false,
                    duplicate: result?.duplicate === true,
                    code: result?.code || 'xianyu_delivery_order_failed',
                    message: result?.message || 'Xianyu delivery order failed',
                    meta: {
                        request
                    }
                });
            }

            if (!deliveryContent) {
                return writeJson(res, 409, {
                    success: false,
                    duplicate: result?.duplicate === true,
                    code: 'xianyu_delivery_content_empty',
                    message: '网站已创建订单，但没有返回可发送给买家的发货内容',
                    meta: {
                        request,
                        order_id: result?.data?.order_id || null,
                        delivery_status: result?.data?.delivery_status || null
                    }
                });
            }

            return writeJson(res, 200, {
                success: true,
                duplicate: result?.duplicate === true,
                content: deliveryContent,
                card: deliveryContent,
                message: result?.message || 'Xianyu delivery content created',
                meta: {
                    request,
                    order_id: result?.data?.order_id || null,
                    product_id: result?.data?.product_id || request?.product_id || null,
                    product_name: result?.data?.product_name || null,
                    quantity: result?.data?.quantity || request?.quantity || null,
                    delivery_status: result?.data?.delivery_status || null,
                    channel_key: request?.channel_key || tokenContext.channelKey,
                    channel_account_key: request?.channel_account_key || tokenContext.accountKey,
                    external_order_id: request?.external_order_id || normalizedOrder.external_order_id
                }
            });
        } catch (error) {
            const statusCode = error?.code === 'xianyu_product_mapping_not_found'
                ? 404
                : (Number(error?.statusCode) || 500);
            return writeJson(res, statusCode, {
                success: false,
                code: error?.code || 'xianyu_delivery_failed',
                message: error?.message || 'Xianyu delivery failed'
            });
        }
    }

    return {
        orders: ordersHandler,
        'xianyu/deliver': xianyuDeliverHandler
    };
}

module.exports = {
    MARKETPLACE_INGEST_SECRET_NAME,
    constantTimeTextEquals,
    createMarketplaceHandlers,
    getMarketplaceIngestToken,
    normalizeXianyuDeliverPayload,
    verifyMarketplaceIngestToken
};
