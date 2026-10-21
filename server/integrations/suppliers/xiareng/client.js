'use strict';

const crypto = require('node:crypto');
const { SupplierAdapterError } = require('../contract');

const PROVIDER_ID = 'xiareng';
const GATEWAY = 'https://xiareng.cc';
// Deliberately no trade/query/draft endpoint in this read-only implementation.
const READ_ENDPOINTS = Object.freeze({
    list: '/shared/commodity/items',
    detail: '/shared/commodity/item',
    stock: '/shared/commodity/stock',
    quote: '/shared/commodity/valuation'
});
// The read-only list endpoint returns the complete directory without paging.
// Keep the response bounded while leaving headroom for the current catalog.
const WRITE_ENDPOINTS = Object.freeze({
    trade: '/shared/commodity/trade',
    query: '/shared/commodity/query'
});
const ENDPOINTS = Object.freeze({ ...READ_ENDPOINTS, ...WRITE_ENDPOINTS });
// 2026-10-21 real purchase probe (goods 2E4ED4E08F9B9210): the quoted `price`
// is the CNY total for the requested quantity (1 -> 0.16, 2 -> 0.32, 3 -> 0.48)
// and the trade `amount` matched the quote exactly. The operator also confirmed
// the supplier quotes in CNY, so the default is stated instead of left unknown.
const QUOTE_CURRENCY = 'CNY';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const UPSTREAM_ORDER_NO = /^[\p{L}\p{N}._:-]{6,160}$/u;
const normalizedItems = new WeakSet();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function phpEncode(value) {
    return encodeURIComponent(value).replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');
}

// PHP http_build_query sorts neither nested arrays nor their keys. Only the top
// level is sorted in the supplier's published generateSignature implementation.
function buildXiarengForm(params = {}) {
    const pairs = [];
    function visit(key, value, depth = 0) {
        if (depth > 4) throw new TypeError('Supplier form nesting is too deep');
        if (value === null || value === undefined) return;
        if (typeof value === 'object') {
            for (const [childKey, child] of Object.entries(value)) visit(`${key}[${childKey}]`, child, depth + 1);
            return;
        }
        if (!['string', 'number', 'boolean'].includes(typeof value)) throw new TypeError('Unsupported supplier form value');
        const scalar = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
        pairs.push(`${phpEncode(key)}=${phpEncode(scalar)}`);
    }
    for (const key of Object.keys(params).sort()) {
        if (key === 'sign' || params[key] === '') continue;
        visit(key, params[key]);
    }
    return pairs.join('&');
}

// PHP urldecode also applies to the raw &key= suffix. Decode bytes, not Unicode
// code points, so a key containing '+', '%' or non-ASCII bytes signs identically.
function phpUrlDecodeBytes(value) {
    const source = Buffer.from(value, 'utf8');
    const output = [];
    for (let i = 0; i < source.length; i += 1) {
        const hex = source.subarray(i + 1, i + 3).toString('ascii');
        if (source[i] === 37 && hex.length === 2 && /^[0-9a-f]{2}$/i.test(hex)) {
            output.push(Number.parseInt(hex, 16));
            i += 2;
        } else output.push(source[i] === 43 ? 32 : source[i]);
    }
    return Buffer.from(output);
}

function signXiarengParams(params, appKey) {
    if (!appKey) throw new TypeError('Xiareng app key is required');
    return crypto.createHash('md5').update(phpUrlDecodeBytes(`${buildXiarengForm(params)}&key=${appKey}`)).digest('hex');
}

function text(value, length = 160) {
    return ['string', 'number'].includes(typeof value) ? String(value).trim().slice(0, length) : '';
}
function count(value) {
    if (value === null || value === undefined || value === '' || !/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}
function money(value) {
    const normalized = text(value, 80);
    return /^\d{1,12}(?:\.\d{1,8})?$/.test(normalized) ? normalized : null;
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// Exact decimal comparison; never route supplier money through binary floats.
function moneyUnits(value) {
    const normalized = money(value);
    if (normalized === null) return null;
    const [whole, fraction = ''] = normalized.split('.');
    return BigInt(`${whole}${fraction.padEnd(8, '0').slice(0, 8)}`);
}
function compareMoney(left, right) {
    const a = moneyUnits(left);
    const b = moneyUnits(right);
    if (a === null || b === null) return null;
    return a < b ? -1 : a > b ? 1 : 0;
}
// Only identity, order number and amounts are ever hashed. Secrets, credentials,
// signatures and raw payloads never reach an evidence digest.
function evidenceHash(fields) {
    return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

// The live supplier returns `config: []` and `widget: ''` for goods that have
// no options at all. Treat those empty containers as "no configuration" so a
// plain single-variant good can still be imported. Any non-empty or non-empty
// scalar value keeps the original preview-only behaviour.
function isEmptyContainer(value) {
    return value === '' || (Array.isArray(value) && value.length === 0);
}

function variantRequirements(source) {
    const hasConfig = source.config != null && !isEmptyContainer(source.config);
    const config = hasConfig ? record(source.config) : {};
    const reasons = [];
    if (hasConfig && !config) reasons.push('商品规格结构待核验');
    const category = record(config?.category);
    const races = category ? Object.keys(category).filter((key) => key.trim() && key.trim() === key && key.length <= 160).slice(0, 100) : [];
    if (config?.category != null && !category) reasons.push('商品种类结构待核验');
    if (category && Object.keys(category).length !== races.length) reasons.push('商品种类超出当前预览范围');
    // The public document does not define the structure of config.sku. Do not
    // invent option combinations or silently select the first SKU.
    if (config && Object.keys(config).some((key) => !['category', 'sku', 'wholesale'].includes(key))) reasons.push('含未识别商品配置，暂仅预览');
    if (config?.sku != null && ((!record(config.sku) && !Array.isArray(config.sku)) || Object.keys(config.sku).length)) reasons.push('SKU 组合需核验，暂仅预览');
    if (source.widget != null && !isEmptyContainer(source.widget) && (!Array.isArray(source.widget) || source.widget.length)) reasons.push('含自定义填写项，暂仅预览');
    if (Number(source.draft_status) === 1) reasons.push('含预选卡配置，暂仅预览');
    if (Number(source.seckill_status) === 1) reasons.push('含限时配置，暂仅预览');
    return { races, requiresRace: races.length > 0, importable: reasons.length === 0, reasons };
}

function normalizeCatalogItem(source = {}, { currency = null, detail = false } = {}) {
    if (!record(source)) return null;
    if (normalizedItems.has(source)) return source;
    const providerGoodsId = ['string', 'number'].includes(typeof source.code) ? String(source.code) : '';
    if (!providerGoodsId || providerGoodsId !== providerGoodsId.trim() || providerGoodsId.length > 160) return null;
    const name = text(source.name, 255);
    if (!providerGoodsId || !name) return null;
    // No verified equivalence between delivery_way and the shared 1/2/3 enum.
    const deliveryLabel = source.delivery_way === undefined ? '上游未说明' : `上游类型 ${text(source.delivery_way, 12)}（待核验）`;
    const item = {
        providerGoodsId,
        source: 'supply',
        name,
        description: text(source.description, 4000),
        imageUrl: '',
        supplierUnitPrice: money(source.user_price),
        currency,
        priceKind: 'member_reference',
        currencyStatus: currency ? 'operator_confirmed' : 'unverified',
        availableQuantity: count(source.stock),
        salesCount: null,
        minimumQuantity: count(source.minimum) === 0 ? 1 : count(source.minimum),
        maximumQuantity: count(source.maximum),
        deliveryMethod: null,
        deliveryLabel,
        variantRequirements: detail ? variantRequirements(source) : { importable: false, reasons: ['请先读取详情并核对规格'], races: [], requiresRace: false },
        procurementReady: false
    };
    normalizedItems.add(item);
    return item;
}

function normalizeVariant(item, input = {}) {
    if (!record(input) || Object.keys(input).some((key) => key !== 'race')) throw new TypeError('当前仅支持已核验的商品种类，不支持 SKU 或附加参数');
    const requirements = item.variantRequirements;
    if (!requirements?.importable) throw new TypeError(requirements?.reasons?.join('；') || '商品配置待核验');
    if (input.race !== undefined && (typeof input.race !== 'string' || input.race.length > 160 || input.race !== input.race.trim())) throw new TypeError('商品种类必须与上游标识一致');
    const race = input.race || '';
    if (requirements.requiresRace && !requirements.races.includes(race)) throw new TypeError('请选择详情中列出的商品种类');
    if (!requirements.requiresRace && race) throw new TypeError('该商品未提供商品种类');
    return race ? { race } : {};
}

function createXiarengAdapter({ appId, appKey, currency = '', timeoutMs = 10_000, fetchImpl = globalThis.fetch } = {}) {
    if (!text(appId) || !appKey) throw new TypeError('Xiareng credentials are required');
    const confirmedCurrency = /^[A-Z]{3}$/.test(String(currency)) ? String(currency) : QUOTE_CURRENCY;
    const deadline = Math.min(30_000, Math.max(500, Number(timeoutMs) || 10_000));
    const error = (operation, code, retryable = false) => new SupplierAdapterError('虾仁只读接口暂不可用，请检查账号配置或稍后重试。', { providerId: PROVIDER_ID, operation, code, retryable });
    async function send(operation, business = {}) {
        const endpoint = ENDPOINTS[operation];
        if (!endpoint) throw error(operation, 'supplier_capability_unsupported');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deadline);
        try {
            const params = { ...business, app_id: String(appId) };
            const form = `${buildXiarengForm(params)}&sign=${signXiarengParams(params, appKey)}`;
            const response = await fetchImpl(`${GATEWAY}${endpoint}`, {
                method: 'POST', redirect: 'error', signal: controller.signal,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form
            });
            if (!response.ok) throw error(operation, 'supplier_http_error', response.status >= 500 || response.status === 429);
            if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) throw error(operation, 'supplier_response_too_large');
            let content;
            if (response.body?.getReader) {
                const reader = response.body.getReader();
                const chunks = [];
                let length = 0;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        length += value.byteLength;
                        if (length > MAX_RESPONSE_BYTES) throw error(operation, 'supplier_response_too_large');
                        chunks.push(Buffer.from(value));
                    }
                } finally { await reader.cancel().catch(() => {}); }
                content = Buffer.concat(chunks).toString('utf8');
            } else content = await response.text();
            if (Buffer.byteLength(content) > MAX_RESPONSE_BYTES) throw error(operation, 'supplier_response_too_large');
            let payload;
            try { payload = JSON.parse(content); } catch (_) { throw error(operation, 'supplier_invalid_response'); }
            if (!record(payload)) throw error(operation, 'supplier_invalid_response');
            return payload;
        } catch (caught) {
            if (caught instanceof SupplierAdapterError) throw caught;
            throw error(operation, controller.signal.aborted ? 'supplier_timeout' : 'supplier_network_error', true);
        } finally { clearTimeout(timer); }
    }
    async function request(operation, business = {}) {
        const payload = await send(operation, business);
        if (Number(payload.code) !== 200) throw error(operation, 'supplier_rejected');
        if (payload.data == null) throw error(operation, 'supplier_invalid_response');
        return payload.data;
    }
    return Object.freeze({
        providerId: PROVIDER_ID,
        contractVersion: 2,
        // procurement stays false until a dispatch/delivery profile matching the
        // live supplier API is approved and recorded in the database. The
        // verified facts below are what such a profile has to be built on.
        capabilities: Object.freeze({ catalog: true, quote: true, stock: true, orderLookup: true, procurement: false, purchaseHistory: false, accountBalance: false,
            // request_no is an immutable request key: replaying it is refused
            // with "The request ID already exists" and never debits twice.
            idempotency: true }),
        procurementProfile: Object.freeze({
            create: 'shared_commodity_trade',
            query: 'shared_commodity_query_by_trade_no',
            // Replaying request_no proves an order exists but never returns its
            // tradeNo, and no list-by-request endpoint exists.
            requestLookup: 'none',
            replay: 'immutable_request_key_rejected',
            // trade has no max-amount parameter, so the ceiling can only be a
            // pre-flight quote comparison plus a post-debit verification.
            costCeiling: 'preflight_quote_then_verify',
            costCurrency: QUOTE_CURRENCY,
            deliveryField: 'secret',
            orderStatus: Object.freeze({ 0: 'unpaid', 1: 'paid' })
        }),
        normalizeCatalogItem(source) { return normalizeCatalogItem(source, { currency: confirmedCurrency }); },
        normalizeVariant,
        async listGoods({ pageNo = 1, pageSize = 20, keywords = '' } = {}) {
            const data = await request('list');
            if (!Array.isArray(data) || data.some((category) => !record(category) || !Array.isArray(category.children))) throw error('list', 'supplier_invalid_response');
            const seen = new Set();
            const items = data.flatMap((category) => Array.isArray(category?.children) ? category.children : [])
                .map((source) => normalizeCatalogItem(source, { currency: confirmedCurrency }))
                .filter((item) => {
                    if (!item || seen.has(item.providerGoodsId)) return false;
                    seen.add(item.providerGoodsId);
                    return `${item.name} ${item.providerGoodsId}`.toLowerCase().includes(String(keywords).toLowerCase());
                });
            return { total: items.length, items: items.slice((pageNo - 1) * pageSize, pageNo * pageSize) };
        },
        async getGoodsDetail(goodsNo) {
            const data = await request('detail', { code: text(goodsNo) });
            const item = record(data) && normalizeCatalogItem(data, { currency: confirmedCurrency, detail: true });
            if (!item || item.providerGoodsId !== String(goodsNo)) throw error('detail', 'supplier_invalid_response');
            return item;
        },
        async getStock({ goodsNo, variant = {} } = {}) {
            const item = await this.getGoodsDetail(goodsNo);
            const selected = normalizeVariant(item, variant);
            const data = await request('stock', { code: item.providerGoodsId, ...selected });
            const availableQuantity = count(data?.stock);
            if (availableQuantity === null) throw error('stock', 'supplier_invalid_response');
            return { availableQuantity, checkedAt: new Date().toISOString(), locked: false };
        },
        async quotePrice({ goodsNo, quantity = 1, variant = {} } = {}) {
            if (!Number.isSafeInteger(quantity) || quantity < 1) throw new TypeError('Invalid quote quantity');
            const item = await this.getGoodsDetail(goodsNo);
            const selected = normalizeVariant(item, variant);
            const data = await request('quote', { code: item.providerGoodsId, num: quantity, ...selected });
            const amount = money(data?.price);
            if (amount === null) throw error('quote', 'supplier_invalid_response');
            // Verified by the 2026-10-21 probe: `price` is the CNY total for the
            // requested quantity, so it is never multiplied again here.
            return { amount, currency: confirmedCurrency, amountBasis: 'total_cny', quantity, locked: false, procurementReady: false };
        },
        // One create call per intent. The caller persists a unique request id
        // before this runs and never re-sends it; the supplier refuses replays.
        async createPurchase(input = {}) {
            const requestId = text(input.requestId, 40);
            if (!UUID.test(requestId)) throw new TypeError('Invalid supplier request id');
            if (input.quantity !== 1) throw new TypeError('当前仅支持数量为 1 的受控采购');
            const ceiling = money(input.maxCost?.amount);
            if (input.maxCost?.currency !== QUOTE_CURRENCY || ceiling === null || !/[1-9]/.test(ceiling)) {
                throw new TypeError('Invalid supplier cost ceiling');
            }
            const item = await this.getGoodsDetail(input.goodsNo);
            const selected = normalizeVariant(item, input.variant);
            const quote = await this.quotePrice({ goodsNo: item.providerGoodsId, quantity: 1, variant: input.variant });
            const ceilingCheck = compareMoney(quote.amount, ceiling);
            if (ceilingCheck === null) throw error('quote', 'supplier_invalid_response');
            // Refuse before any debit: the quote alone already exceeds the ceiling.
            if (ceilingCheck > 0) {
                return { outcome: 'rejected', definitivelyNotAccepted: true, requestId,
                    code: 'cost_ceiling_exceeded', evidenceHash: evidenceHash({ requestId, code: 'cost_ceiling_exceeded', quote: quote.amount }) };
            }
            const stock = await this.getStock({ goodsNo: item.providerGoodsId, variant: input.variant });
            if (stock.availableQuantity < 1) {
                return { outcome: 'rejected', definitivelyNotAccepted: true, requestId,
                    code: 'supplier_out_of_stock', evidenceHash: evidenceHash({ requestId, code: 'supplier_out_of_stock' }) };
            }
            const payload = await send('trade', { shared_code: item.providerGoodsId, num: 1, request_no: requestId, device: 0, ...selected });
            if (Number(payload.code) !== 200) {
                // A business rejection is definitive: no order, no debit. An
                // existing request key proves an earlier attempt landed, but the
                // trade number is unrecoverable here, so it stays ambiguous.
                if (/already exists/i.test(text(payload.msg, 200))) {
                    return { outcome: 'unknown', requestId, code: 'request_key_already_exists',
                        evidenceHash: evidenceHash({ requestId, code: 'request_key_already_exists' }) };
                }
                return { outcome: 'rejected', definitivelyNotAccepted: true, requestId,
                    code: 'supplier_rejected', evidenceHash: evidenceHash({ requestId, code: 'supplier_rejected' }) };
            }
            const data = record(payload.data);
            const orderNo = text(data?.tradeNo, 160);
            const amount = money(data?.amount);
            if (!orderNo || !/^[\p{L}\p{N}._:-]{1,160}$/u.test(orderNo) || amount === null) {
                throw error('trade', 'supplier_invalid_response');
            }
            // Money has already moved. An amount above the authorised ceiling is
            // never treated as a clean acceptance; a human reconciles it.
            const actualCheck = compareMoney(amount, ceiling);
            if (actualCheck === null || actualCheck > 0) throw error('trade', 'supplier_cost_ceiling_exceeded');
            // The debited amount travels with the acceptance so the caller can
            // verify the ceiling after the fact. The card secret is deliberately
            // not returned here; it is fetched once by fetchDelivery().
            return { outcome: 'accepted', requestId, orderNo, actualAmountCny: amount,
                evidenceHash: evidenceHash({ requestId, orderNo, amount, status: 'accepted' }) };
        },
        // Reads the delivered card content of an already-paid order. Used only
        // after an acceptance was recorded; never returns anything for an order
        // the supplier does not report as paid.
        async fetchDelivery({ requestId, orderNo } = {}) {
            if (!UUID.test(String(requestId || ''))) throw new TypeError('Invalid supplier request id');
            if (!/^[\p{L}\p{N}._:-]{1,160}$/u.test(String(orderNo || ''))) throw new TypeError('Invalid supplier order number');
            const data = await request('query', { tradeNo: String(orderNo) });
            const status = count(data?.status);
            if (status !== 1) return null;
            const content = typeof data?.secret === 'string' ? data.secret : '';
            if (!content.trim()) throw error('query', 'supplier_delivery_empty');
            return { requestId, orderNo: String(orderNo), content };
        },
        // Read-only operator lookup by a complete supplier order number. The
        // delivery field is inspected only for presence and is never returned.
        async queryPurchaseByOrderNo(orderNo) {
            const normalizedOrderNo = String(orderNo ?? '');
            if (normalizedOrderNo !== normalizedOrderNo.trim() || !UPSTREAM_ORDER_NO.test(normalizedOrderNo)) {
                throw new TypeError('Invalid supplier order number');
            }
            const data = await request('query', { tradeNo: normalizedOrderNo });
            const status = count(data?.status);
            if (status !== 0 && status !== 1) throw error('query', 'supplier_invalid_response');
            if (data?.secret != null && typeof data.secret !== 'string') throw error('query', 'supplier_invalid_response');
            const paymentStatus = status === 1 ? 'paid' : 'unpaid';
            const deliveryContentPresent = typeof data.secret === 'string' && data.secret.trim().length > 0;
            return {
                supplierOrderNo: normalizedOrderNo,
                paymentStatus,
                deliveryContentPresent,
                queriedAt: new Date().toISOString(),
                evidenceHash: evidenceHash({ supplierOrderNo: normalizedOrderNo, paymentStatus, deliveryContentPresent })
            };
        },
        async queryPurchase({ requestId, orderNo } = {}) {
            if (!UUID.test(String(requestId || ''))) throw new TypeError('Invalid supplier request id');
            // The supplier cannot look up by request_no. Without a recorded trade
            // number there is nothing safe to ask, and guessing is forbidden.
            if (!/^[\p{L}\p{N}._:-]{1,160}$/u.test(String(orderNo || ''))) return null;
            const data = await request('query', { tradeNo: String(orderNo) });
            const status = count(data?.status);
            if (status !== 0 && status !== 1) throw error('query', 'supplier_invalid_response');
            if (status !== 1) return { outcome: 'unpaid', requestId, orderNo: String(orderNo) };
            return { outcome: 'accepted', requestId, orderNo: String(orderNo),
                evidenceHash: evidenceHash({ requestId, orderNo: String(orderNo), status: 'paid' }) };
        }
    });
}

module.exports = { PROVIDER_ID, READ_ENDPOINTS, buildXiarengForm, signXiarengParams, normalizeCatalogItem, normalizeVariant, createXiarengAdapter };
