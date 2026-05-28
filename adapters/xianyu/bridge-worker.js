#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('dotenv');
const {
    buildMarketplaceOrderPayload,
    resolveMarketplaceOrdersUrl
} = require('./core');
const {
    loadXianyuAdminAdapterConfig
} = require('./admin-runtime');

function sanitizeText(value, maxLength = 500) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, Math.max(0, maxLength));
}

function normalizeBaseUrl(value) {
    const raw = sanitizeText(value, 800);
    if (!raw) return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return withProtocol.replace(/\/+$/, '');
}

function normalizeOrdersJson(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.orders)) return value.orders;
    if (Array.isArray(value?.data?.orders)) return value.data.orders;
    if (Array.isArray(value?.data?.list)) return value.data.list;
    if (Array.isArray(value?.list)) return value.list;
    if (value && typeof value === 'object') return [value];
    return [];
}

function resolveOrderId(order = {}) {
    return sanitizeText(
        order.external_order_id
        || order.externalOrderId
        || order.order_id
        || order.orderId
        || order.trade_id
        || order.tradeId
        || order.bizOrderId
        || order.biz_order_id
        || order.id,
        180
    );
}

function resolveBuyerId(order = {}) {
    return sanitizeText(
        order.external_buyer_id
        || order.externalBuyerId
        || order.buyer_id
        || order.buyerId
        || order.buyer?.id
        || order.buyer?.userId
        || order.buyerInfo?.id,
        180
    );
}

function resolveBuyerName(order = {}) {
    return sanitizeText(
        order.external_buyer_name
        || order.externalBuyerName
        || order.buyer_name
        || order.buyerName
        || order.buyerNick
        || order.buyer?.nick
        || order.buyer?.name
        || order.buyerInfo?.nick
        || order.buyerInfo?.name,
        180
    );
}

function resolveChatId(order = {}) {
    const value = sanitizeText(
        order.chat_id
        || order.chatId
        || order.cid
        || order.sid
        || order.session_id
        || order.sessionId
        || order.conversation_id
        || order.conversationId
        || order.raw?.chat_id
        || order.raw?.chatId
        || order.raw?.sid
        || order.raw?.session_id
        || order.raw?.sessionId,
        180
    );

    return value.includes('@') ? value.split('@')[0].trim() : value;
}

function resolveCookieId(order = {}) {
    return sanitizeText(
        order.cookie_id
        || order.cookieId
        || order.account_id
        || order.accountId
        || order.seller_id
        || order.sellerId
        || order.raw?.cookie_id
        || order.raw?.cookieId
        || order.raw?.account_id
        || order.raw?.accountId,
        180
    );
}

function resolveItemId(order = {}) {
    return sanitizeText(
        order.item_id
        || order.itemId
        || order.item?.itemId
        || order.item?.id
        || order.goods_id
        || order.goodsId
        || order.raw?.item_id
        || order.raw?.itemId,
        180
    );
}

function resolveDeliveryContent(responseBody = {}) {
    return sanitizeText(
        responseBody?.content
        || responseBody?.card
        || responseBody?.delivery_content
        || responseBody?.deliveryContent
        || responseBody?.delivery?.content
        || responseBody?.data?.content
        || responseBody?.data?.delivery_content
        || responseBody?.data?.deliveryContent
        || responseBody?.data?.delivery?.content,
        8000
    );
}

function hasExplicitFalseUsageInstructionsFlag(source = {}) {
    return source?.show_usage_instructions === false
        || source?.showUsageInstructions === false
        || source?.data?.show_usage_instructions === false
        || source?.data?.showUsageInstructions === false
        || source?.data?.delivery?.show_usage_instructions === false
        || source?.data?.delivery?.showUsageInstructions === false
        || source?.delivery?.show_usage_instructions === false
        || source?.delivery?.showUsageInstructions === false;
}

function resolveUsageInstructions(responseBody = {}) {
    if (hasExplicitFalseUsageInstructionsFlag(responseBody)) return '';

    return sanitizeText(
        responseBody?.usage_instructions
        || responseBody?.usageInstructions
        || responseBody?.delivery?.usage_instructions
        || responseBody?.delivery?.usageInstructions
        || responseBody?.data?.usage_instructions
        || responseBody?.data?.usageInstructions
        || responseBody?.data?.delivery?.usage_instructions
        || responseBody?.data?.delivery?.usageInstructions,
        4000
    );
}

function summarizeChatDeliveryResult(chatResult = {}) {
    const response = chatResult?.response && typeof chatResult.response === 'object'
        ? chatResult.response
        : {};
    const responseMessages = Array.isArray(response.messages) ? response.messages : [];
    const payload = chatResult?.payload && typeof chatResult.payload === 'object'
        ? chatResult.payload
        : {};
    const roles = responseMessages
        .map((entry) => sanitizeText(entry?.message_role || entry?.role, 80))
        .filter(Boolean);

    if (!roles.length) {
        if (sanitizeText(payload.usage_instructions, 4000)) roles.push('usage_instructions');
        if (sanitizeText(payload.content, 20_000)) roles.push('delivery_content');
    }

    const responseMessageCount = Number(response.message_count);
    return {
        message_count: Number.isFinite(responseMessageCount) && responseMessageCount > 0
            ? responseMessageCount
            : roles.length,
        message_roles: roles,
        bridge_finalization_status: sanitizeText(response.bridge_finalization?.status, 120),
        bridge_finalization_success: typeof response.bridge_finalization?.success === 'boolean'
            ? response.bridge_finalization.success
            : undefined
    };
}

function parseTimestampMs(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return numeric < 10_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
    }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveOrderPaidAtMs(order = {}) {
    return parseTimestampMs(
        order.paid_at
        || order.paidAt
        || order.pay_time
        || order.payTime
        || order.payment_time
        || order.paymentTime
        || order.pay_success_at
        || order.paySuccessAt
        || order.gmt_pay
        || order.gmtPay
        || order.raw?.paid_at
        || order.raw?.paidAt
        || order.raw?.pay_time
        || order.raw?.payTime
        || order.raw?.payment_time
        || order.raw?.paymentTime
        || order.raw?.pay_success_at
        || order.raw?.paySuccessAt
        || order.raw?.gmt_pay
        || order.raw?.gmtPay
    );
}

function callNow(now = () => Date.now()) {
    const value = Number(now());
    return Number.isFinite(value) ? Math.round(value) : Date.now();
}

function elapsedMs(startedAt, endedAt) {
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return undefined;
    return Math.max(0, Math.round(endedAt - startedAt));
}

function compactTimingMs(timing = {}) {
    return Object.fromEntries(Object.entries(timing).filter(([, value]) => Number.isFinite(value)));
}

function createBridgeDiagnosticEmitter(env = process.env, diagnosticLogger = null) {
    const enabled = normalizeBoolean(
        env.XIANYU_BRIDGE_DIAGNOSTICS
        || env.XIANYU_BRIDGE_TIMING_LOGS
        || env.XIANYU_BRIDGE_DEBUG_TIMING,
        false
    ) || typeof diagnosticLogger === 'function';

    return function emitBridgeDiagnostic(event, payload = {}) {
        if (!enabled) return;

        const record = {
            event,
            at: new Date().toISOString(),
            ...payload
        };

        try {
            if (typeof diagnosticLogger === 'function') {
                diagnosticLogger(record);
                return;
            }
            process.stderr.write(`[xianyu-bridge] ${JSON.stringify(record)}\n`);
        } catch (_) {
            // Diagnostics should never block delivery.
        }
    };
}

function resolveHeaderToken(env = {}, prefix = 'XIANYU_BOT') {
    return sanitizeText(
        env[`${prefix}_TOKEN`]
        || env[`${prefix}_ACCESS_TOKEN`]
        || env[`${prefix}_API_TOKEN`],
        4000
    );
}

function buildBotHeaders(env = {}, prefix = 'XIANYU_BOT') {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8'
    };
    const token = resolveHeaderToken(env, prefix);

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

function normalizeBoolean(value, fallback = false) {
    if (value === true || value === false) return value;
    const normalized = sanitizeText(value, 20).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
}

function normalizeInteger(value, fallback, {
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER
} = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function resolveSmartPollingOptions(env = process.env, fallbackIntervalMs = 30_000) {
    const idleMs = normalizeInteger(
        env.XIANYU_BRIDGE_IDLE_INTERVAL_MS
        || env.XIANYU_BRIDGE_POLL_IDLE_MS
        || env.XIANYU_BRIDGE_POLL_INTERVAL_MS,
        fallbackIntervalMs,
        { min: 1000, max: 300_000 }
    );
    const activeMs = normalizeInteger(
        env.XIANYU_BRIDGE_ACTIVE_INTERVAL_MS
        || env.XIANYU_BRIDGE_POLL_ACTIVE_MS,
        Math.min(idleMs, 2000),
        { min: 1000, max: idleMs }
    );
    const activeWindowMs = normalizeInteger(
        env.XIANYU_BRIDGE_ACTIVE_WINDOW_MS
        || env.XIANYU_BRIDGE_POLL_ACTIVE_WINDOW_MS,
        5 * 60 * 1000,
        { min: 0, max: 60 * 60 * 1000 }
    );

    return {
        idleMs,
        activeMs,
        activeWindowMs
    };
}

function bridgeSummaryHasActivity(summary = {}) {
    if (!summary || typeof summary !== 'object') return false;
    if (Number(summary.delivered || 0) > 0) return true;
    if (Number(summary.failed || 0) > 0 && Number(summary.total || 0) > 0) return true;
    return Array.isArray(summary.results) && summary.results.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return entry.status === 'delivered'
            || (entry.status === 'failed' && entry.external_order_id)
            || (entry.status === 'skipped' && !['already_processed', 'duplicate_order'].includes(entry.reason));
    });
}

function parseProductMappings(value) {
    const raw = sanitizeText(value, 100_000);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed?.product_mappings) ? parsed.product_mappings : []);
    } catch (_) {
        return [];
    }
}

function buildBridgeMarketplaceConfigFromEnv(env = process.env, {
    baseUrl = '',
    accountKey = ''
} = {}) {
    const resolvedBaseUrl = normalizeBaseUrl(
        baseUrl
        || env.XIANYU_BRIDGE_BASE_URL
        || env.MARKETPLACE_WEBSITE_BASE_URL
        || env.XIANYU_WEBSITE_BASE_URL
        || 'https://www.fatherkey.com'
    );
    const resolvedAccountKey = sanitizeText(accountKey || env.XIANYU_BRIDGE_ACCOUNT || 'main', 80) || 'main';

    return {
        website_base_url: resolvedBaseUrl,
        channel: sanitizeText(env.XIANYU_BRIDGE_CHANNEL || 'xianyu', 80) || 'xianyu',
        account: resolvedAccountKey,
        site: sanitizeText(env.XIANYU_BRIDGE_SITE || 'cn', 20).toLowerCase() === 'intl' ? 'intl' : 'cn',
        dry_run: false,
        ingest_token: sanitizeText(
            env.XIANYU_BRIDGE_INGEST_TOKEN
            || env.XIANYU_MARKETPLACE_INGEST_TOKEN
            || env.MARKETPLACE_INGEST_TOKEN,
            4000
        ),
        product_mappings: parseProductMappings(env.XIANYU_BRIDGE_PRODUCT_MAPPINGS)
    };
}

async function loadBridgeMarketplaceConfig(env = process.env, {
    baseUrl = '',
    accountKey = ''
} = {}) {
    if (normalizeBoolean(env.XIANYU_BRIDGE_FROM_ADMIN, false)) {
        return loadXianyuAdminAdapterConfig({
            accountKey: accountKey || env.XIANYU_BRIDGE_ACCOUNT || 'main',
            websiteBaseUrl: baseUrl || env.XIANYU_BRIDGE_BASE_URL || env.MARKETPLACE_WEBSITE_BASE_URL || '',
            site: env.XIANYU_BRIDGE_SITE || 'cn',
            dryRun: false,
            includeSecret: true,
            env
        });
    }

    return buildBridgeMarketplaceConfigFromEnv(env, {
        baseUrl,
        accountKey
    });
}

async function readJsonFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

async function loadProcessedOrderIds(filePath = '') {
    if (!filePath) return new Set();

    try {
        const value = await readJsonFile(filePath);
        const ids = Array.isArray(value) ? value : value?.processed_order_ids;
        return new Set((Array.isArray(ids) ? ids : []).map((id) => sanitizeText(id, 180)).filter(Boolean));
    } catch (error) {
        if (error?.code === 'ENOENT') return new Set();
        throw error;
    }
}

async function saveProcessedOrderIds(filePath = '', processedOrderIds = new Set()) {
    if (!filePath) return;

    const payload = {
        processed_order_ids: Array.from(processedOrderIds).sort()
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function parseJsonResponse(response) {
    const text = typeof response.text === 'function' ? await response.text() : '';
    try {
        return text ? JSON.parse(text) : {};
    } catch (_) {
        return { raw: text };
    }
}

async function fetchJson(url, {
    method = 'GET',
    headers = {},
    body,
    fetchImpl = globalThis.fetch
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw Object.assign(new Error('fetch is unavailable'), {
            code: 'xianyu_bridge_fetch_unavailable'
        });
    }

    const response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const parsedBody = await parseJsonResponse(response);

    if (!response.ok || parsedBody.success === false) {
        const responseMessage = sanitizeText(
            parsedBody.message
            || parsedBody.detail
            || parsedBody.error
            || parsedBody.raw,
            2000
        );
        throw Object.assign(new Error(responseMessage || `HTTP ${response.status}`), {
            code: parsedBody.code || 'xianyu_bridge_http_failed',
            statusCode: response.status,
            response: parsedBody
        });
    }

    return {
        statusCode: response.status,
        body: parsedBody
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function isRetryableChatSendError(error = {}) {
    const message = sanitizeText(
        error?.response?.detail || error?.response?.message || error?.message,
        1000
    ).toLowerCase();
    return error?.statusCode >= 500
        || message.includes('websocket')
        || message.includes('not connected')
        || message.includes('not ready')
        || message.includes('reconnect')
        || message.includes('未连接')
        || message.includes('未就绪')
        || message.includes('重连')
        || message.includes('timed out')
        || message.includes('timeout');
}

function isLocalProductMappingMiss(error = {}) {
    return error?.code === 'xianyu_product_mapping_not_found'
        && !error?.statusCode
        && !error?.response;
}

function resolveMappingMissRetryOptions(env = process.env) {
    const fromAdmin = normalizeBoolean(env.XIANYU_BRIDGE_FROM_ADMIN, false);
    return {
        retries: normalizeInteger(
            env.XIANYU_BRIDGE_MAPPING_MISS_RETRIES,
            fromAdmin ? 2 : 0,
            { min: 0, max: 5 }
        ),
        delayMs: normalizeInteger(
            env.XIANYU_BRIDGE_MAPPING_MISS_RETRY_DELAY_MS,
            750,
            { min: 0, max: 5000 }
        )
    };
}

async function loadPaidOrdersFromXianyuBot(env = process.env, {
    fetchImpl = globalThis.fetch
} = {}) {
    const ordersFile = sanitizeText(env.XIANYU_BRIDGE_ORDER_FILE, 1000);
    if (ordersFile) {
        return normalizeOrdersJson(await readJsonFile(ordersFile));
    }

    const ordersUrl = sanitizeText(env.XIANYU_BOT_ORDERS_URL || env.XIANYU_BRIDGE_BOT_ORDERS_URL, 1000);
    if (!ordersUrl) {
        return [];
    }

    const method = sanitizeText(env.XIANYU_BOT_ORDERS_METHOD || 'GET', 20).toUpperCase() === 'POST' ? 'POST' : 'GET';
    let requestUrl = ordersUrl;
    const pollMode = sanitizeText(env.XIANYU_BRIDGE_POLL_MODE, 20).toLowerCase();
    if (['active', 'idle'].includes(pollMode)) {
        try {
            const parsedUrl = new URL(ordersUrl);
            parsedUrl.searchParams.set('bridge_poll_mode', pollMode);
            requestUrl = parsedUrl.toString();
        } catch (_) {
            requestUrl = ordersUrl;
        }
    }
    const submitted = await fetchJson(requestUrl, {
        method,
        headers: buildBotHeaders(env, 'XIANYU_BOT'),
        body: method === 'POST'
            ? {
                account: env.XIANYU_BRIDGE_ACCOUNT || 'main',
                status: 'paid'
            }
            : undefined,
        fetchImpl
    });

    return normalizeOrdersJson(submitted.body);
}

async function postXianyuOrder({
    baseUrl,
    accountKey = 'main',
    ingestToken,
    marketplaceConfig = {},
    order,
    fetchImpl = globalThis.fetch
} = {}) {
    const resolvedConfig = {
        ...marketplaceConfig,
        website_base_url: normalizeBaseUrl(marketplaceConfig.website_base_url || baseUrl),
        account: sanitizeText(marketplaceConfig.account || accountKey, 80) || 'main',
        ingest_token: sanitizeText(marketplaceConfig.ingest_token || ingestToken, 4000)
    };
    const resolvedBaseUrl = normalizeBaseUrl(resolvedConfig.website_base_url);
    if (!resolvedBaseUrl) {
        throw Object.assign(new Error('XIANYU_BRIDGE_BASE_URL is required'), {
            code: 'xianyu_bridge_base_url_required'
        });
    }
    if (!sanitizeText(resolvedConfig.ingest_token, 4000)) {
        throw Object.assign(new Error('XIANYU_BRIDGE_INGEST_TOKEN is required'), {
            code: 'xianyu_bridge_ingest_token_required'
        });
    }

    const url = resolveMarketplaceOrdersUrl(resolvedConfig);
    const payload = buildMarketplaceOrderPayload(order, resolvedConfig);

    return fetchJson(url.toString(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${resolvedConfig.ingest_token}`
        },
        body: payload,
        fetchImpl
    }).catch((error) => {
        error.code = error.code === 'xianyu_bridge_http_failed'
            ? error.response?.code || 'xianyu_bridge_request_failed'
            : error.code;
        error.message = error.response?.message || error.message;
        throw error;
    });
}

async function postXianyuOrderWithMappingRecovery({
    baseUrl,
    accountKey = 'main',
    ingestToken,
    marketplaceConfig = {},
    order,
    env = process.env,
    fetchImpl = globalThis.fetch,
    loadMarketplaceConfig = loadBridgeMarketplaceConfig,
    emitDiagnostic = () => {}
} = {}) {
    const options = resolveMappingMissRetryOptions(env);
    let activeConfig = marketplaceConfig;
    let activeIngestToken = ingestToken;
    let retryCount = 0;

    while (true) {
        try {
            const submitted = await postXianyuOrder({
                baseUrl,
                accountKey,
                ingestToken: activeIngestToken,
                marketplaceConfig: activeConfig,
                order,
                fetchImpl
            });
            return {
                submitted,
                marketplaceConfig: activeConfig,
                ingestToken: activeIngestToken,
                mapping_retry_count: retryCount
            };
        } catch (error) {
            if (!isLocalProductMappingMiss(error) || retryCount >= options.retries) {
                if (retryCount > 0) {
                    error.mapping_retry_count = retryCount;
                }
                throw error;
            }

            retryCount += 1;
            emitDiagnostic('mapping_retry', {
                external_order_id: resolveOrderId(order),
                code: error?.code || 'xianyu_product_mapping_not_found',
                message: error?.message || 'Xianyu product mapping not found',
                retry: retryCount,
                retry_delay_ms: options.delayMs
            });

            if (options.delayMs > 0) {
                await sleep(options.delayMs);
            }

            activeConfig = await loadMarketplaceConfig(env, {
                baseUrl,
                accountKey
            });
            activeIngestToken = activeConfig.ingest_token || activeIngestToken;
        }
    }
}

async function sendDeliveryToXianyuChat({
    order,
    content,
    usageInstructions = '',
    response,
    env = process.env,
    fetchImpl = globalThis.fetch
} = {}) {
    const sendUrl = sanitizeText(env.XIANYU_BOT_SEND_MESSAGE_URL || env.XIANYU_BRIDGE_BOT_SEND_MESSAGE_URL, 1000);
    const orderId = resolveOrderId(order) || response?.normalized_order?.external_order_id || 'unknown-order';
    const payload = {
        external_order_id: orderId,
        buyer_id: resolveBuyerId(order),
        buyer_name: resolveBuyerName(order),
        chat_id: resolveChatId(order),
        sid: sanitizeText(order.sid || order.raw?.sid, 180),
        cookie_id: resolveCookieId(order),
        item_id: resolveItemId(order),
        content,
        usage_instructions: sanitizeText(usageInstructions, 4000),
        order,
        marketplace_response: response
    };

    if (!sendUrl) {
        process.stdout.write(`[dry-chat-send] ${orderId}: ${content}\n`);
        return {
            status: 'dry_run',
            payload
        };
    }

    const maxAttempts = Math.max(1, Number(env.XIANYU_BRIDGE_CHAT_SEND_ATTEMPTS || 4));
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const submitted = await fetchJson(sendUrl, {
                method: 'POST',
                headers: buildBotHeaders(env, 'XIANYU_BOT'),
                body: payload,
                fetchImpl
            });

            return {
                status: 'sent',
                response: submitted.body,
                payload,
                attempts: attempt
            };
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts || !isRetryableChatSendError(error)) {
                break;
            }
            await sleep(Math.min(12_000, 1500 * attempt));
        }
    }

    throw lastError;
}

async function runBridgeWorker({
    env = process.env,
    fetchImpl = globalThis.fetch,
    loadOrders = loadPaidOrdersFromXianyuBot,
    loadMarketplaceConfig = loadBridgeMarketplaceConfig,
    sendChat = sendDeliveryToXianyuChat,
    diagnosticLogger = null,
    now = () => Date.now()
} = {}) {
    const workerStartedAt = callNow(now);
    const emitDiagnostic = createBridgeDiagnosticEmitter(env, diagnosticLogger);
    const baseUrl = env.XIANYU_BRIDGE_BASE_URL || env.MARKETPLACE_WEBSITE_BASE_URL || 'https://www.fatherkey.com';
    const accountKey = env.XIANYU_BRIDGE_ACCOUNT || 'main';
    let marketplaceConfig = await loadMarketplaceConfig(env, {
        baseUrl,
        accountKey
    });
    let ingestToken = marketplaceConfig.ingest_token || env.XIANYU_BRIDGE_INGEST_TOKEN || env.XIANYU_MARKETPLACE_INGEST_TOKEN || '';
    const processedFile = sanitizeText(env.XIANYU_BRIDGE_PROCESSED_FILE, 1000);
    const processedOrderIds = await loadProcessedOrderIds(processedFile);
    const loadOrdersStartedAt = callNow(now);
    const orders = await loadOrders(env, { fetchImpl });
    const loadOrdersEndedAt = callNow(now);
    const results = [];

    for (const order of orders) {
        const orderStartedAt = callNow(now);
        const orderId = resolveOrderId(order);
        const paidAtMs = resolveOrderPaidAtMs(order);
        const initialTiming = compactTimingMs({
            order_paid_age_ms: paidAtMs ? elapsedMs(paidAtMs, orderStartedAt) : undefined,
            load_orders_ms: elapsedMs(loadOrdersStartedAt, loadOrdersEndedAt),
            queue_wait_ms: elapsedMs(loadOrdersEndedAt, orderStartedAt)
        });

        if (orderId && processedOrderIds.has(orderId)) {
            const finishedAt = callNow(now);
            const timing_ms = compactTimingMs({
                ...initialTiming,
                total_ms: elapsedMs(orderStartedAt, finishedAt)
            });
            results.push({
                status: 'skipped',
                reason: 'already_processed',
                external_order_id: orderId,
                timing_ms
            });
            emitDiagnostic('order_skipped', {
                external_order_id: orderId,
                reason: 'already_processed',
                timing_ms
            });
            continue;
        }

        let websiteStartedAt;
        let websiteEndedAt;
        let chatStartedAt;
        let chatEndedAt;
        try {
            websiteStartedAt = callNow(now);
            const submittedResult = await postXianyuOrderWithMappingRecovery({
                baseUrl,
                accountKey,
                ingestToken,
                marketplaceConfig,
                order,
                env,
                fetchImpl,
                loadMarketplaceConfig,
                emitDiagnostic
            });
            const submitted = submittedResult.submitted;
            marketplaceConfig = submittedResult.marketplaceConfig;
            ingestToken = submittedResult.ingestToken || ingestToken;
            const mappingRetryCount = Number(submittedResult.mapping_retry_count);
            websiteEndedAt = callNow(now);
            const body = submitted.body || {};
            const normalizedOrderId = body.normalized_order?.external_order_id || body.request?.external_order_id || orderId;
            const content = resolveDeliveryContent(body);
            const usageInstructions = resolveUsageInstructions(body);

            if (body.skipped) {
                const finishedAt = callNow(now);
                const timing_ms = compactTimingMs({
                    ...initialTiming,
                    website_ms: elapsedMs(websiteStartedAt, websiteEndedAt),
                    total_ms: elapsedMs(orderStartedAt, finishedAt)
                });
                results.push({
                    status: 'skipped',
                    reason: body.reason || 'remote_skipped',
                    external_order_id: normalizedOrderId,
                    timing_ms,
                    ...(Number.isFinite(mappingRetryCount) && mappingRetryCount > 0
                        ? { mapping_retry_count: mappingRetryCount }
                        : {})
                });
                emitDiagnostic('order_skipped', {
                    external_order_id: normalizedOrderId,
                    reason: body.reason || 'remote_skipped',
                    timing_ms,
                    ...(Number.isFinite(mappingRetryCount) && mappingRetryCount > 0
                        ? { mapping_retry_count: mappingRetryCount }
                        : {})
                });
                continue;
            }

            if (body.duplicate === true && !content) {
                if (normalizedOrderId) processedOrderIds.add(normalizedOrderId);
                const finishedAt = callNow(now);
                const timing_ms = compactTimingMs({
                    ...initialTiming,
                    website_ms: elapsedMs(websiteStartedAt, websiteEndedAt),
                    total_ms: elapsedMs(orderStartedAt, finishedAt)
                });
                results.push({
                    status: 'skipped',
                    reason: 'duplicate_order',
                    external_order_id: normalizedOrderId,
                    timing_ms,
                    ...(Number.isFinite(mappingRetryCount) && mappingRetryCount > 0
                        ? { mapping_retry_count: mappingRetryCount }
                        : {})
                });
                emitDiagnostic('order_skipped', {
                    external_order_id: normalizedOrderId,
                    reason: 'duplicate_order',
                    timing_ms,
                    ...(Number.isFinite(mappingRetryCount) && mappingRetryCount > 0
                        ? { mapping_retry_count: mappingRetryCount }
                        : {})
                });
                continue;
            }

            if (!content) {
                throw Object.assign(new Error('Website did not return delivery content'), {
                    code: 'xianyu_bridge_delivery_content_missing'
                });
            }

            chatStartedAt = callNow(now);
            const chatResult = await sendChat({
                order,
                content,
                usageInstructions,
                response: body,
                env,
                fetchImpl
            });
            chatEndedAt = callNow(now);
            if (normalizedOrderId) processedOrderIds.add(normalizedOrderId);
            const finishedAt = callNow(now);
            const timing_ms = compactTimingMs({
                ...initialTiming,
                website_ms: elapsedMs(websiteStartedAt, websiteEndedAt),
                chat_send_ms: elapsedMs(chatStartedAt, chatEndedAt),
                total_ms: elapsedMs(orderStartedAt, finishedAt)
            });
            const chatAttempts = Number(chatResult?.attempts);
            const chatDelivery = summarizeChatDeliveryResult(chatResult);
            const deliveredEntry = {
                status: 'delivered',
                external_order_id: normalizedOrderId,
                chat_status: chatResult?.status || 'sent',
                timing_ms
            };
            const deliveredDiagnostic = {
                external_order_id: normalizedOrderId,
                chat_status: chatResult?.status || 'sent',
                timing_ms
            };
            if (chatDelivery.message_count > 0) {
                deliveredEntry.message_count = chatDelivery.message_count;
                deliveredDiagnostic.message_count = chatDelivery.message_count;
            }
            if (chatDelivery.message_roles.length) {
                deliveredEntry.message_roles = chatDelivery.message_roles;
                deliveredDiagnostic.message_roles = chatDelivery.message_roles;
            }
            if (chatDelivery.bridge_finalization_status) {
                deliveredEntry.bridge_finalization_status = chatDelivery.bridge_finalization_status;
                deliveredDiagnostic.bridge_finalization_status = chatDelivery.bridge_finalization_status;
            }
            if (typeof chatDelivery.bridge_finalization_success === 'boolean') {
                deliveredEntry.bridge_finalization_success = chatDelivery.bridge_finalization_success;
                deliveredDiagnostic.bridge_finalization_success = chatDelivery.bridge_finalization_success;
            }
            if (Number.isFinite(chatAttempts)) {
                deliveredEntry.chat_attempts = chatAttempts;
                deliveredDiagnostic.chat_attempts = chatAttempts;
            }
            if (Number.isFinite(mappingRetryCount) && mappingRetryCount > 0) {
                deliveredEntry.mapping_retry_count = mappingRetryCount;
                deliveredDiagnostic.mapping_retry_count = mappingRetryCount;
            }
            results.push(deliveredEntry);
            emitDiagnostic('order_delivered', deliveredDiagnostic);
        } catch (error) {
            const mappingRetryCount = Number(error?.mapping_retry_count);
            const failedAt = callNow(now);
            const timing_ms = compactTimingMs({
                ...initialTiming,
                website_ms: elapsedMs(websiteStartedAt, websiteEndedAt || failedAt),
                chat_send_ms: elapsedMs(chatStartedAt, chatEndedAt || failedAt),
                total_ms: elapsedMs(orderStartedAt, failedAt)
            });
            results.push({
                status: 'failed',
                external_order_id: orderId,
                code: error?.code || 'xianyu_bridge_failed',
                message: error?.message || 'Xianyu bridge failed',
                status_code: error?.statusCode,
                response: error?.response,
                timing_ms,
                ...(Number.isFinite(mappingRetryCount) && mappingRetryCount > 0
                    ? { mapping_retry_count: mappingRetryCount }
                    : {})
            });
            emitDiagnostic('order_failed', {
                external_order_id: orderId,
                code: error?.code || 'xianyu_bridge_failed',
                message: error?.message || 'Xianyu bridge failed',
                timing_ms,
                ...(Number.isFinite(mappingRetryCount) && mappingRetryCount > 0
                    ? { mapping_retry_count: mappingRetryCount }
                    : {})
            });
        }
    }

    await saveProcessedOrderIds(processedFile, processedOrderIds);
    const workerFinishedAt = callNow(now);

    return {
        total: orders.length,
        delivered: results.filter((entry) => entry.status === 'delivered').length,
        skipped: results.filter((entry) => entry.status === 'skipped').length,
        failed: results.filter((entry) => entry.status === 'failed').length,
        timing_ms: compactTimingMs({
            load_orders_ms: elapsedMs(loadOrdersStartedAt, loadOrdersEndedAt),
            total_ms: elapsedMs(workerStartedAt, workerFinishedAt)
        }),
        results
    };
}

async function runBridgeLoop({
    env = process.env,
    intervalMs = 30_000,
    onSummary = (summary) => process.stdout.write(`${JSON.stringify(summary)}\n`),
    stopAfterRuns = 0,
    fetchImpl = globalThis.fetch,
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
    let runs = 0;
    let activeUntil = 0;
    const polling = resolveSmartPollingOptions(env, intervalMs);

    while (true) {
        runs += 1;
        const runStartedAt = Date.now();
        const runMode = runStartedAt < activeUntil ? 'active' : 'idle';
        let summary;
        try {
            summary = await runBridgeWorker({
                env: {
                    ...env,
                    XIANYU_BRIDGE_POLL_MODE: runMode
                },
                fetchImpl
            });
        } catch (error) {
            summary = {
                total: 0,
                delivered: 0,
                skipped: 0,
                failed: 1,
                error: {
                    code: error?.code || 'xianyu_bridge_loop_run_failed',
                    message: error?.message || 'Xianyu bridge loop run failed'
                },
                results: []
            };
        }
        if (bridgeSummaryHasActivity(summary)) {
            activeUntil = Math.max(activeUntil, runStartedAt + polling.activeWindowMs);
        }
        summary.polling = {
            mode: Date.now() < activeUntil ? 'active' : 'idle',
            active_until: activeUntil ? new Date(activeUntil).toISOString() : '',
            next_interval_ms: Date.now() < activeUntil ? polling.activeMs : polling.idleMs,
            active_interval_ms: polling.activeMs,
            idle_interval_ms: polling.idleMs,
            active_window_ms: polling.activeWindowMs
        };
        onSummary(summary);

        if (stopAfterRuns > 0 && runs >= stopAfterRuns) {
            return summary;
        }

        const nextIntervalMs = Date.now() < activeUntil ? polling.activeMs : polling.idleMs;
        await sleepFn(nextIntervalMs);
    }
}

function parseArgs(argv = []) {
    const options = {
        envFile: '',
        loop: false,
        intervalMs: 30_000,
        overrides: {}
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }
        if (value === '--base-url') {
            options.overrides.XIANYU_BRIDGE_BASE_URL = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--account') {
            options.overrides.XIANYU_BRIDGE_ACCOUNT = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--token') {
            options.overrides.XIANYU_BRIDGE_INGEST_TOKEN = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--from-admin') {
            options.overrides.XIANYU_BRIDGE_FROM_ADMIN = 'true';
            continue;
        }
        if (value === '--site') {
            options.overrides.XIANYU_BRIDGE_SITE = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--orders-file') {
            options.overrides.XIANYU_BRIDGE_ORDER_FILE = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }
        if (value === '--processed-file') {
            options.overrides.XIANYU_BRIDGE_PROCESSED_FILE = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }
        if (value === '--bot-orders-url') {
            options.overrides.XIANYU_BOT_ORDERS_URL = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--bot-send-message-url') {
            options.overrides.XIANYU_BOT_SEND_MESSAGE_URL = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }
        if (value === '--loop') {
            options.loop = true;
            continue;
        }
        if (value === '--interval-ms') {
            options.intervalMs = Math.max(1000, Number(argv[index + 1] || 30_000));
            index += 1;
        }
    }

    return options;
}

async function applyEnvFile(envFile = '', env = process.env) {
    const normalizedPath = sanitizeText(envFile, 1000);
    if (!normalizedPath) return;

    const parsed = dotenv.parse(await fs.readFile(normalizedPath, 'utf8'));
    Object.entries(parsed).forEach(([key, value]) => {
        if (env[key] === undefined || env[key] === '') {
            env[key] = value;
        }
    });
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const options = parseArgs(argv);
    await applyEnvFile(options.envFile, env);
    Object.assign(env, options.overrides);

    if (options.loop) {
        return runBridgeLoop({
            env,
            intervalMs: options.intervalMs,
            onSummary(summary) {
                process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
            }
        });
    }

    const summary = await runBridgeWorker({ env });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.failed > 0) process.exitCode = 1;
    return summary;
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    applyEnvFile,
    buildBotHeaders,
    buildBridgeMarketplaceConfigFromEnv,
    fetchJson,
    loadBridgeMarketplaceConfig,
    loadPaidOrdersFromXianyuBot,
    loadProcessedOrderIds,
    main,
    normalizeBaseUrl,
    normalizeOrdersJson,
    parseArgs,
    postXianyuOrder,
    postXianyuOrderWithMappingRecovery,
    resolveSmartPollingOptions,
    resolveBuyerId,
    resolveBuyerName,
    resolveChatId,
    resolveCookieId,
    resolveDeliveryContent,
    resolveItemId,
    resolveOrderId,
    resolveUsageInstructions,
    bridgeSummaryHasActivity,
    runBridgeLoop,
    runBridgeWorker,
    saveProcessedOrderIds,
    sendDeliveryToXianyuChat
};
