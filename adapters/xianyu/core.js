const DEFAULT_CHANNEL = 'xianyu';
const DEFAULT_ACCOUNT = 'main';
const DEFAULT_SITE = 'cn';
const DEFAULT_INGEST_TOKEN_ENV = 'XIANYU_MARKETPLACE_INGEST_TOKEN';

const PAID_STATUS_TOKENS = Object.freeze([
    'paid',
    'success',
    'done',
    'trade_buyer_paid',
    'wait_seller_send_goods',
    'seller_wait_send_goods',
    '买家已付款',
    '已付款',
    '已支付',
    '待发货',
    '待卖家发货',
    '交易成功'
]);

const BLOCKED_STATUS_TOKENS = Object.freeze([
    'unpaid',
    'pending_pay',
    'wait_buyer_pay',
    'cancel',
    'closed',
    'refund',
    'refunding',
    '未付款',
    '待付款',
    '已取消',
    '已关闭',
    '退款'
]);

function sanitizeText(value, maxLength = 500) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeUuid(value) {
    const normalized = sanitizeText(value, 120);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : '';
}

function normalizeKey(value, fallback = DEFAULT_ACCOUNT) {
    const raw = sanitizeText(value || fallback, 80).toLowerCase();
    return raw
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/_+/g, '_')
        .replace(/^[-_]+|[-_]+$/g, '')
        || fallback;
}

function getByPath(source, path) {
    if (!source || typeof source !== 'object' || !path) return undefined;
    const segments = String(path).split('.').map((segment) => segment.trim()).filter(Boolean);
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

function pickFirst(source, paths = []) {
    for (const path of paths) {
        const value = getByPath(source, path);
        if (value !== undefined && value !== null && sanitizeText(value, 1000)) {
            return value;
        }
    }
    return '';
}

function normalizeQuantity(value, fallback = 1) {
    const parsed = Number.parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(99, Math.max(1, parsed));
}

function normalizeAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = sanitizeText(value, 80);
    if (!raw) return null;

    const isFen = /分$/.test(raw);
    const cleaned = raw
        .replace(/[,，]/g, '')
        .replace(/[￥¥元分\s]/g, '');
    const parsed = Number(cleaned);

    if (!Number.isFinite(parsed) || parsed < 0) return null;
    const amount = isFen ? parsed / 100 : parsed;
    return Math.round(amount * 100) / 100;
}

function normalizeXianyuOrder(raw = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { raw };
    const itemId = sanitizeText(pickFirst(source, [
        'xianyu_item_id',
        'xianyuItemId',
        'item_id',
        'itemId',
        'goods_id',
        'goodsId',
        'auction_id',
        'auctionId',
        'item.itemId',
        'item.id',
        'itemInfo.itemId',
        'itemInfo.id',
        'goods.itemId',
        'goods.id',
        'product.itemId',
        'product.id'
    ]), 180);
    const skuId = sanitizeText(pickFirst(source, [
        'sku_id',
        'skuId',
        'item.skuId',
        'itemInfo.skuId',
        'sku.id'
    ]), 180);
    const skuText = sanitizeText(pickFirst(source, [
        'sku_text',
        'skuText',
        'propertiesName',
        'item.skuText',
        'item.sku',
        'itemInfo.skuText',
        'itemInfo.sku',
        'sku.name',
        'sku.text'
    ]), 500);
    const title = sanitizeText(pickFirst(source, [
        'item_title',
        'itemTitle',
        'title',
        'item.title',
        'itemInfo.title',
        'goods.title',
        'product.title'
    ]), 500);
    const quantity = normalizeQuantity(pickFirst(source, [
        'quantity',
        'qty',
        'count',
        'amount',
        'buyAmount',
        'item.quantity',
        'item.count',
        'itemInfo.quantity'
    ]), 1);
    const payStatus = sanitizeText(pickFirst(source, [
        'pay_status',
        'payStatus',
        'status',
        'statusText',
        'tradeStatus',
        'tradeStatusText',
        'orderStatus',
        'orderStatusText'
    ]), 180);

    return {
        external_order_id: sanitizeText(pickFirst(source, [
            'external_order_id',
            'externalOrderId',
            'order_id',
            'orderId',
            'trade_id',
            'tradeId',
            'bizOrderId',
            'biz_order_id',
            'id'
        ]), 180),
        xianyu_item_id: itemId,
        sku_id: skuId,
        sku_text: skuText,
        item_title: title,
        quantity,
        price_paid: normalizeAmount(pickFirst(source, [
            'price_paid',
            'pricePaid',
            'payAmount',
            'paidAmount',
            'actualPay',
            'actualPaid',
            'item.payAmount'
        ])),
        total_price: normalizeAmount(pickFirst(source, [
            'total_price',
            'totalPrice',
            'totalAmount',
            'totalFee',
            'orderAmount',
            'item.price'
        ])),
        external_buyer_id: sanitizeText(pickFirst(source, [
            'external_buyer_id',
            'externalBuyerId',
            'buyer_id',
            'buyerId',
            'buyer.id',
            'buyer.userId',
            'buyerInfo.id'
        ]), 180),
        external_buyer_name: sanitizeText(pickFirst(source, [
            'external_buyer_name',
            'externalBuyerName',
            'buyer_name',
            'buyerName',
            'buyerNick',
            'buyer.nick',
            'buyer.name',
            'buyerInfo.nick',
            'buyerInfo.name'
        ]), 180),
        pay_status: payStatus,
        created_at: sanitizeText(pickFirst(source, [
            'created_at',
            'createdAt',
            'createTime',
            'orderCreateTime',
            'paidAt',
            'payTime'
        ]), 120),
        raw: source
    };
}

function normalizeStatusForMatch(value) {
    return sanitizeText(value, 180).toLowerCase().replace(/\s+/g, '_');
}

function tokenMatchesStatus(status, tokens) {
    const normalizedStatus = normalizeStatusForMatch(status);
    if (!normalizedStatus) return false;
    return tokens.some((token) => normalizedStatus.includes(normalizeStatusForMatch(token)));
}

function isPaidXianyuOrder(order = {}, config = {}) {
    const normalized = order.external_order_id ? order : normalizeXianyuOrder(order);
    const status = normalized.pay_status;

    if (tokenMatchesStatus(status, config.blocked_statuses || BLOCKED_STATUS_TOKENS)) {
        return false;
    }
    if (tokenMatchesStatus(status, config.paid_statuses || PAID_STATUS_TOKENS)) {
        return true;
    }

    return config.allow_unknown_pay_status === true;
}

function normalizeProductMappings(input) {
    if (!input) return [];

    if (Array.isArray(input)) {
        return input.filter((entry) => entry && typeof entry === 'object');
    }

    if (typeof input === 'object') {
        return Object.entries(input).map(([xianyuItemId, productId]) => ({
            xianyu_item_id: xianyuItemId,
            product_id: productId
        }));
    }

    return [];
}

function getMappingProductId(mapping = {}) {
    return normalizeUuid(mapping.product_id || mapping.productId || mapping.website_product_id || mapping.websiteProductId);
}

function containsText(source, needle) {
    const sourceText = sanitizeText(source, 1000).toLowerCase();
    const needleText = sanitizeText(needle, 1000).toLowerCase();
    return Boolean(sourceText && needleText && sourceText.includes(needleText));
}

function scoreProductMapping(mapping = {}, normalizedOrder = {}) {
    if (mapping.enabled === false) return -1;
    if (!getMappingProductId(mapping)) return -1;

    let hasCondition = false;
    let score = 0;

    const itemId = sanitizeText(mapping.xianyu_item_id || mapping.xianyuItemId || mapping.item_id || mapping.itemId, 180);
    if (itemId) {
        hasCondition = true;
        if (itemId !== normalizedOrder.xianyu_item_id) return -1;
        score += 100;
    }

    const skuId = sanitizeText(mapping.sku_id || mapping.skuId, 180);
    if (skuId) {
        hasCondition = true;
        if (skuId !== normalizedOrder.sku_id) return -1;
        score += 60;
    }

    const titleContains = sanitizeText(mapping.title_contains || mapping.titleContains, 500);
    if (titleContains) {
        hasCondition = true;
        if (!containsText(normalizedOrder.item_title, titleContains)) return -1;
        score += 20;
    }

    const skuTextContains = sanitizeText(mapping.sku_text_contains || mapping.skuTextContains, 500);
    if (skuTextContains) {
        hasCondition = true;
        if (!containsText(normalizedOrder.sku_text, skuTextContains)) return -1;
        score += 20;
    }

    const rawPath = sanitizeText(mapping.raw_path || mapping.rawPath, 200);
    if (rawPath) {
        hasCondition = true;
        const actual = sanitizeText(getByPath(normalizedOrder.raw, rawPath), 500);
        const expected = sanitizeText(mapping.equals ?? mapping.value, 500);
        if (!expected || actual !== expected) return -1;
        score += 40;
    }

    return hasCondition ? score : -1;
}

function resolveProductMapping(normalizedOrder = {}, config = {}) {
    const mappings = normalizeProductMappings(config.product_mappings || config.productMappings || config.products);
    let best = null;

    mappings.forEach((mapping, index) => {
        const score = scoreProductMapping(mapping, normalizedOrder);
        if (score < 0) return;
        if (!best || score > best.score) {
            best = {
                index,
                score,
                mapping,
                product_id: getMappingProductId(mapping)
            };
        }
    });

    if (!best) {
        const label = normalizedOrder.xianyu_item_id || normalizedOrder.item_title || normalizedOrder.external_order_id || 'unknown';
        throw Object.assign(new Error(`未找到商品映射: ${label}`), {
            code: 'xianyu_product_mapping_not_found'
        });
    }

    return best;
}

function normalizeBaseUrl(value) {
    const raw = sanitizeText(value, 500);
    if (!raw) return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return withProtocol.replace(/\/+$/, '');
}

function resolveMarketplaceOrdersUrl(config = {}) {
    const explicitEndpoint = sanitizeText(config.marketplace_orders_url || config.marketplaceOrdersUrl || config.endpoint, 800);
    if (explicitEndpoint) {
        return /^https?:\/\//i.test(explicitEndpoint)
            ? explicitEndpoint
            : `${normalizeBaseUrl(config.website_base_url || config.base_url || config.baseUrl)}${explicitEndpoint.startsWith('/') ? '' : '/'}${explicitEndpoint}`;
    }

    const baseUrl = normalizeBaseUrl(config.website_base_url || config.base_url || config.baseUrl);
    if (!baseUrl) {
        throw Object.assign(new Error('website_base_url is required'), {
            code: 'xianyu_website_base_url_required'
        });
    }

    return `${baseUrl}/api/marketplace/orders`;
}

function resolveIngestToken(config = {}, env = process.env) {
    const tokenEnvName = sanitizeText(config.ingest_token_env || config.ingestTokenEnv || DEFAULT_INGEST_TOKEN_ENV, 120);
    const token = sanitizeText(
        config.ingest_token
        || config.ingestToken
        || env[tokenEnvName]
        || env.MARKETPLACE_INGEST_TOKEN,
        4000
    );

    if (!token) {
        throw Object.assign(new Error(`发货接口 Token 未配置，请设置环境变量 ${tokenEnvName}`), {
            code: 'xianyu_ingest_token_required'
        });
    }

    return token;
}

function buildMarketplaceOrderPayload(rawOrder = {}, config = {}) {
    const normalizedOrder = rawOrder.external_order_id && rawOrder.raw
        ? rawOrder
        : normalizeXianyuOrder(rawOrder);

    if (!normalizedOrder.external_order_id) {
        throw Object.assign(new Error('闲鱼订单号缺失'), {
            code: 'xianyu_external_order_id_required'
        });
    }

    const mapping = resolveProductMapping(normalizedOrder, config);
    const channel = normalizeKey(config.channel_key || config.channel || DEFAULT_CHANNEL, DEFAULT_CHANNEL);
    const account = normalizeKey(config.account_key || config.account || DEFAULT_ACCOUNT, DEFAULT_ACCOUNT);

    return {
        product_id: mapping.product_id,
        channel,
        account,
        site: sanitizeText(config.site || DEFAULT_SITE, 20).toLowerCase() === 'intl' ? 'intl' : 'cn',
        external_order_id: normalizedOrder.external_order_id,
        quantity: normalizedOrder.quantity,
        price_paid: normalizedOrder.price_paid,
        total_price: normalizedOrder.total_price,
        external_buyer_id: normalizedOrder.external_buyer_id,
        external_buyer_name: normalizedOrder.external_buyer_name,
        snapshot: {
            adapter: 'xianyu-mvp',
            pay_status: normalizedOrder.pay_status,
            xianyu_item_id: normalizedOrder.xianyu_item_id,
            sku_id: normalizedOrder.sku_id,
            sku_text: normalizedOrder.sku_text,
            item_title: normalizedOrder.item_title,
            created_at: normalizedOrder.created_at,
            mapping: {
                index: mapping.index,
                label: sanitizeText(mapping.mapping.label || mapping.mapping.name, 120)
            },
            raw: normalizedOrder.raw
        }
    };
}

async function submitMarketplaceOrder(payload = {}, config = {}, {
    env = process.env,
    fetchImpl = globalThis.fetch
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw Object.assign(new Error('fetch is unavailable'), {
            code: 'xianyu_fetch_unavailable'
        });
    }

    const url = resolveMarketplaceOrdersUrl(config);
    const token = resolveIngestToken(config, env);
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });
    const text = typeof response.text === 'function' ? await response.text() : '';
    let body = {};

    try {
        body = text ? JSON.parse(text) : {};
    } catch (_) {
        body = { raw: text };
    }

    if (!response.ok || body.success === false) {
        throw Object.assign(new Error(body.message || `Marketplace ingest failed with HTTP ${response.status}`), {
            code: body.code || 'xianyu_marketplace_ingest_failed',
            statusCode: response.status,
            response: body
        });
    }

    return {
        statusCode: response.status,
        body
    };
}

async function runXianyuAdapter({
    config = {},
    orders = [],
    env = process.env,
    fetchImpl = globalThis.fetch,
    dryRun
} = {}) {
    if (!Array.isArray(orders)) {
        throw Object.assign(new Error('orders must be an array'), {
            code: 'xianyu_orders_must_be_array'
        });
    }

    const resolvedConfig = {
        ...config,
        dry_run: dryRun === undefined ? config.dry_run !== false : dryRun !== false
    };
    const results = [];

    for (const rawOrder of orders) {
        try {
            const normalized = normalizeXianyuOrder(rawOrder);
            if (!isPaidXianyuOrder(normalized, resolvedConfig)) {
                results.push({
                    status: 'skipped',
                    reason: 'order_not_paid',
                    external_order_id: normalized.external_order_id,
                    pay_status: normalized.pay_status
                });
                continue;
            }

            const payload = buildMarketplaceOrderPayload(normalized, resolvedConfig);
            if (resolvedConfig.dry_run) {
                results.push({
                    status: 'dry_run',
                    external_order_id: normalized.external_order_id,
                    payload
                });
                continue;
            }

            const submitted = await submitMarketplaceOrder(payload, resolvedConfig, { env, fetchImpl });
            results.push({
                status: 'submitted',
                external_order_id: normalized.external_order_id,
                response: submitted.body
            });
        } catch (error) {
            results.push({
                status: 'failed',
                code: error?.code || 'xianyu_adapter_failed',
                message: error?.message || 'Xianyu adapter failed'
            });
        }
    }

    return {
        dry_run: resolvedConfig.dry_run,
        total: orders.length,
        submitted: results.filter((entry) => entry.status === 'submitted').length,
        dry_run_count: results.filter((entry) => entry.status === 'dry_run').length,
        skipped: results.filter((entry) => entry.status === 'skipped').length,
        failed: results.filter((entry) => entry.status === 'failed').length,
        results
    };
}

module.exports = {
    BLOCKED_STATUS_TOKENS,
    DEFAULT_INGEST_TOKEN_ENV,
    PAID_STATUS_TOKENS,
    buildMarketplaceOrderPayload,
    getByPath,
    isPaidXianyuOrder,
    normalizeAmount,
    normalizeBaseUrl,
    normalizeProductMappings,
    normalizeQuantity,
    normalizeXianyuOrder,
    resolveIngestToken,
    resolveMarketplaceOrdersUrl,
    resolveProductMapping,
    runXianyuAdapter,
    submitMarketplaceOrder
};
