'use strict';

const crypto = require('node:crypto');
const {
    SupplierAdapterError
} = require('../contract');

const PROVIDER_ID = '16688';
const DEFAULT_GATEWAY = 'https://www.16688.com.cn/openApi';
const DEFAULT_TIMEOUT_MS = 10_000;

function sortRecursively(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sortRecursively(item));
    }
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
        return value;
    }

    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = sortRecursively(value[key]);
        return result;
    }, {});
}

function phpStringValue(value) {
    if (value === true) return '1';
    if (value === false || value === undefined) return '';
    if (value === null) return '';
    if (typeof value === 'object') return JSON.stringify(sortRecursively(value));
    return String(value);
}

function buildSigningString(params = {}) {
    return Object.keys(params)
        .filter((key) => key !== 'sign' && key !== 'sign_type')
        .sort()
        .flatMap((key) => {
            const value = params[key];
            if (value === '' || value === null || value === undefined) return [];

            if (Array.isArray(value) || (value && typeof value === 'object')) {
                const jsonValue = JSON.stringify(sortRecursively(value));
                if (jsonValue === '[]' || jsonValue === '{}') return [];
                return [`${key}=${jsonValue}`];
            }

            return [`${key}=${phpStringValue(value)}`];
        })
        .join('&');
}

function sign16688Params(params, secret) {
    const key = String(secret || '');
    if (!key) throw new TypeError('16688 API secret is required');
    return crypto.createHash('md5')
        .update(`${buildSigningString(params)}${key}`, 'utf8')
        .digest('hex');
}

function normalizeInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    const integer = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
    return Math.max(minimum, Math.min(maximum, integer));
}

function normalizePurchaseStatus(status) {
    const code = Number(status);
    const statuses = {
        0: 'awaiting_payment',
        1: 'pending_fulfillment',
        2: 'closed',
        3: 'refunded',
        4: 'delivered',
        5: 'completed'
    };
    return statuses[code] || 'unknown';
}

function normalizeMoney(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).trim();
    return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}


function normalizeCatalogItem(data = {}) {
    const source = data && typeof data === 'object' && !Array.isArray(data)
        ? (data.goods && typeof data.goods === 'object' ? data.goods : data)
        : {};
    const providerGoodsId = String(
        source.providerGoodsId || source.goods_no || source.goodsNo || source.id || ''
    ).trim();
    const name = String(
        source.name || source.goods_name || source.goods_title || source.title || source.goodsName || ''
    ).trim().slice(0, 255);
    if (!providerGoodsId || !name) return null;

    const rawImageUrl = String(
        source.imageUrl || source.image_url || source.image || source.goods_image || source.goods_img || source.pic || ''
    ).trim();
    let imageUrl = '';
    try {
        const parsed = new URL(rawImageUrl);
        if (parsed.protocol === 'https:') imageUrl = parsed.toString();
    } catch (_) {
        // Ignore non-absolute or non-HTTPS supplier image URLs.
    }

    const rawMinimum = source.minimumQuantity ?? source.min_quantity ?? source.limit_quantity ?? source.min_num ?? source.buy_min;
    const minimumQuantity = Number.parseInt(String(rawMinimum ?? ''), 10);
    const rawAvailableQuantity = source.availableQuantity ?? source.available_quantity;
    const availableQuantity = Number.parseInt(String(rawAvailableQuantity ?? ''), 10);
    const rawSalesCount = source.salesCount ?? source.sales_count;
    const salesCount = Number.parseInt(String(rawSalesCount ?? ''), 10);
    const rawDeliveryMethod = source.deliveryMethod ?? source.delivery_method;
    const deliveryMethod = Number.parseInt(String(rawDeliveryMethod ?? ''), 10);
    const rawDescription = source.description || source.goods_desc || source.desc || '';
    const rawCurrency = String(source.currency || 'CNY').trim().toUpperCase();
    const normalizedCurrency = /^[A-Z0-9]{3,12}$/.test(rawCurrency) ? rawCurrency : 'CNY';
    const rawUnitPrice = normalizeMoney(
        source.supplierUnitPrice ?? source.unit_price ?? source.goods_price ?? source.price
    );

    return {
        providerGoodsId,
        source: String(source.source || '').trim().toLowerCase() || null,
        name,
        description: String(rawDescription).trim().slice(0, 4000),
        imageUrl,
        supplierUnitPrice: rawUnitPrice && !rawUnitPrice.startsWith('-') ? rawUnitPrice : null,
        currency: normalizedCurrency,
        availableQuantity: Number.isFinite(availableQuantity) && availableQuantity >= 0 ? availableQuantity : null,
        salesCount: Number.isFinite(salesCount) && salesCount >= 0 ? salesCount : null,
        minimumQuantity: Number.isFinite(minimumQuantity) && minimumQuantity > 0 ? minimumQuantity : null,
        deliveryMethod: [1, 2, 3].includes(deliveryMethod) ? deliveryMethod : null
    };
}

function normalizePurchase(data = {}) {
    return {
        providerId: PROVIDER_ID,
        providerOrderId: String(data.trade_no || '').trim() || null,
        providerGoodsId: String(data.goods_no || '').trim() || null,
        status: normalizePurchaseStatus(data.status),
        rawStatus: data.status ?? null,
        quantity: Number(data.quantity || 0) || null,
        totalAmount: normalizeMoney(data.total_amount),
        currency: 'CNY',
        deliveryMethod: Number(data.delivery_method || 0) || null,
        cards: Array.isArray(data.cards) ? data.cards : [],
        content: typeof data.content === 'string' ? data.content : '',
        instruction: typeof data.instruction === 'string' ? data.instruction : '',
        manualInstruction: typeof data.manual_instruction === 'string' ? data.manual_instruction : '',
        createdAt: data.create_time ?? null,
        deliveredAt: data.deliver_time ?? null,
        raw: data
    };
}

function create16688Adapter({
    appId,
    secret,
    gateway = DEFAULT_GATEWAY,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => Date.now()
} = {}) {
    const normalizedAppId = String(appId || '').trim();
    const normalizedSecret = String(secret || '');
    const normalizedGateway = String(gateway || DEFAULT_GATEWAY).trim().replace(/\/+$/, '');
    const normalizedTimeoutMs = normalizeInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 250, 120_000);

    if (!normalizedAppId) throw new TypeError('16688 app_id is required');
    if (!normalizedSecret) throw new TypeError('16688 secret is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

    let gatewayUrl;
    try {
        gatewayUrl = new URL(normalizedGateway);
    } catch (_error) {
        throw new TypeError('16688 gateway must be a valid URL');
    }
    if (gatewayUrl.protocol !== 'https:') {
        throw new TypeError('16688 gateway must use HTTPS');
    }

    async function request(path, payload = {}, operation = path) {
        const timestamp = String(Math.floor(now() / 1000));
        const unsigned = {
            ...payload,
            app_id: normalizedAppId,
            timestamp
        };
        const signedPayload = {
            ...unsigned,
            sign: sign16688Params(unsigned, normalizedSecret)
        };
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, normalizedTimeoutMs);

        let response;
        let body;
        try {
            response = await fetchImpl(`${normalizedGateway}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(signedPayload),
                signal: controller.signal
            });
            body = await response.json();
        } catch (cause) {
            clearTimeout(timeout);
            const outcomeUnknown = operation === 'create_purchase';
            const timedOutError = timedOut || cause?.name === 'AbortError';
            throw new SupplierAdapterError(
                timedOutError ? '16688 request timed out' : '16688 request failed',
                {
                    providerId: PROVIDER_ID,
                    operation,
                    code: timedOutError ? 'supplier_timeout' : 'supplier_network_error',
                    retryable: !outcomeUnknown,
                    outcomeUnknown,
                    cause
                }
            );
        } finally {
            clearTimeout(timeout);
        }

        if (!response?.ok) {
            const outcomeUnknown = operation === 'create_purchase' && Number(response?.status) >= 500;
            throw new SupplierAdapterError('16688 returned an HTTP error', {
                providerId: PROVIDER_ID,
                operation,
                code: 'supplier_http_error',
                retryable: Number(response?.status) >= 500,
                outcomeUnknown
            });
        }

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new SupplierAdapterError('16688 returned an invalid response', {
                providerId: PROVIDER_ID,
                operation,
                code: 'supplier_protocol_error',
                retryable: operation !== 'create_purchase',
                outcomeUnknown: operation === 'create_purchase'
            });
        }

        if (Number(body.code) !== 1) {
            throw new SupplierAdapterError(
                String(body.msg || '16688 rejected the request'),
                {
                    providerId: PROVIDER_ID,
                    operation,
                    code: 'supplier_rejected',
                    retryable: false,
                    outcomeUnknown: false
                }
            );
        }

        return body.data;
    }

    function requireObjectData(data, operation) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new SupplierAdapterError('16688 returned missing or invalid data', {
                providerId: PROVIDER_ID,
                operation,
                code: 'supplier_protocol_error',
                retryable: operation !== 'create_purchase',
                outcomeUnknown: operation === 'create_purchase'
            });
        }
        return data;
    }

    const adapter = {
        providerId: PROVIDER_ID,
        displayName: '16688',
        capabilities: Object.freeze({
            catalog: true,
            quote: true,
            procurement: true,
            purchaseHistory: true,
            accountBalance: true,
            idempotency: false
        }),

        normalizeCatalogItem,

        async listGoods({ pageNo = 1, pageSize = 20, keywords = '', source = 'supply' } = {}) {
            const data = requireObjectData(await request('/goods/list', {
                page_no: normalizeInteger(pageNo, 1, 1),
                page_size: normalizeInteger(pageSize, 20, 1, 100),
                keywords: String(keywords || ''),
                // The admin supplier catalog must not accidentally mix the
                // merchant's own local products into the upstream catalog.
                source: String(source || 'supply')
            }, 'list_goods'), 'list_goods');
            return {
                total: Math.max(0, Number(data.total || 0) || 0),
                items: Array.isArray(data.list) ? data.list : [],
                raw: data
            };
        },

        async getGoodsDetail(goodsNo) {
            const normalizedGoodsNo = String(goodsNo || '').trim();
            if (!normalizedGoodsNo) throw new TypeError('goodsNo is required');
            return requireObjectData(await request('/goods/detail', {
                goods_no: normalizedGoodsNo
            }, 'get_goods_detail'), 'get_goods_detail');
        },

        async quotePrice({ goodsNo, quantity = 1 } = {}) {
            const normalizedGoodsNo = String(goodsNo || '').trim();
            if (!normalizedGoodsNo) throw new TypeError('goodsNo is required');
            const normalizedQuantity = normalizeInteger(quantity, 1, 1);
            return requireObjectData(await request('/purchase/quotePrice', {
                goods_no: normalizedGoodsNo,
                quantity: normalizedQuantity
            }, 'quote_price'), 'quote_price');
        },

        async createPurchase({ goodsNo, quantity = 1, remark = '' } = {}) {
            const normalizedGoodsNo = String(goodsNo || '').trim();
            if (!normalizedGoodsNo) throw new TypeError('goodsNo is required');
            const normalizedQuantity = normalizeInteger(quantity, 1, 1);
            const data = requireObjectData(await request('/purchase/create', {
                goods_no: normalizedGoodsNo,
                quantity: normalizedQuantity,
                remark: String(remark || '').slice(0, 500)
            }, 'create_purchase'), 'create_purchase');
            return normalizePurchase(data);
        },

        async queryPurchase(tradeNo) {
            const normalizedTradeNo = String(tradeNo || '').trim();
            if (!normalizedTradeNo) throw new TypeError('tradeNo is required');
            const data = requireObjectData(await request('/purchase/query', {
                trade_no: normalizedTradeNo
            }, 'query_purchase'), 'query_purchase');
            return normalizePurchase(data);
        },

        async listPurchases({ pageNo = 1, pageSize = 20, status, keywords = '' } = {}) {
            const payload = {
                page_no: normalizeInteger(pageNo, 1, 1),
                page_size: normalizeInteger(pageSize, 20, 1, 100),
                keywords: String(keywords || '')
            };
            if (status !== undefined && status !== null && status !== '') {
                payload.status = Number(status);
            }
            const data = requireObjectData(await request('/purchase/list', payload, 'list_purchases'), 'list_purchases');
            return {
                total: Math.max(0, Number(data.total || 0) || 0),
                items: Array.isArray(data.list) ? data.list.map(normalizePurchase) : [],
                raw: data
            };
        },

        async getBalance() {
            return requireObjectData(await request('/merchant/balance', {}, 'get_balance'), 'get_balance');
        }
    };

    return Object.freeze(adapter);
}

function create16688AdapterFromEnv(env = process.env, options = {}) {
    return create16688Adapter({
        appId: env.SUPPLIER_16688_APP_ID,
        secret: env.SUPPLIER_16688_SECRET,
        gateway: env.SUPPLIER_16688_GATEWAY || DEFAULT_GATEWAY,
        timeoutMs: env.SUPPLIER_16688_TIMEOUT_MS,
        ...options
    });
}

module.exports = {
    DEFAULT_GATEWAY,
    DEFAULT_TIMEOUT_MS,
    PROVIDER_ID,
    buildSigningString,
    create16688Adapter,
    create16688AdapterFromEnv,
    normalizeCatalogItem,
    normalizeMoney,
    normalizePurchase,
    normalizePurchaseStatus,
    sign16688Params,
    sortRecursively
};
