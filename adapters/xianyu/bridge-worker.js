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
        responseBody?.data?.content
        || responseBody?.data?.delivery_content
        || responseBody?.data?.deliveryContent
        || responseBody?.data?.delivery?.content,
        8000
    );
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
        || 'https://www.zaoyoe.com'
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
    const submitted = await fetchJson(ordersUrl, {
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

async function sendDeliveryToXianyuChat({
    order,
    content,
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
    sendChat = sendDeliveryToXianyuChat
} = {}) {
    const baseUrl = env.XIANYU_BRIDGE_BASE_URL || env.MARKETPLACE_WEBSITE_BASE_URL || 'https://www.zaoyoe.com';
    const accountKey = env.XIANYU_BRIDGE_ACCOUNT || 'main';
    const marketplaceConfig = await loadBridgeMarketplaceConfig(env, {
        baseUrl,
        accountKey
    });
    const ingestToken = marketplaceConfig.ingest_token || env.XIANYU_BRIDGE_INGEST_TOKEN || env.XIANYU_MARKETPLACE_INGEST_TOKEN || '';
    const processedFile = sanitizeText(env.XIANYU_BRIDGE_PROCESSED_FILE, 1000);
    const processedOrderIds = await loadProcessedOrderIds(processedFile);
    const orders = await loadOrders(env, { fetchImpl });
    const results = [];

    for (const order of orders) {
        const orderId = resolveOrderId(order);
        if (orderId && processedOrderIds.has(orderId)) {
            results.push({
                status: 'skipped',
                reason: 'already_processed',
                external_order_id: orderId
            });
            continue;
        }

        try {
            const submitted = await postXianyuOrder({
                baseUrl,
                accountKey,
                ingestToken,
                marketplaceConfig,
                order,
                fetchImpl
            });
            const body = submitted.body || {};
            const normalizedOrderId = body.normalized_order?.external_order_id || body.request?.external_order_id || orderId;
            const content = resolveDeliveryContent(body);

            if (body.skipped) {
                results.push({
                    status: 'skipped',
                    reason: body.reason || 'remote_skipped',
                    external_order_id: normalizedOrderId
                });
                continue;
            }

            if (body.duplicate === true && !content) {
                if (normalizedOrderId) processedOrderIds.add(normalizedOrderId);
                results.push({
                    status: 'skipped',
                    reason: 'duplicate_order',
                    external_order_id: normalizedOrderId
                });
                continue;
            }

            if (!content) {
                throw Object.assign(new Error('Website did not return delivery content'), {
                    code: 'xianyu_bridge_delivery_content_missing'
                });
            }

            const chatResult = await sendChat({
                order,
                content,
                response: body,
                env,
                fetchImpl
            });
            if (normalizedOrderId) processedOrderIds.add(normalizedOrderId);
            results.push({
                status: 'delivered',
                external_order_id: normalizedOrderId,
                chat_status: chatResult?.status || 'sent'
            });
        } catch (error) {
            results.push({
                status: 'failed',
                external_order_id: orderId,
                code: error?.code || 'xianyu_bridge_failed',
                message: error?.message || 'Xianyu bridge failed',
                status_code: error?.statusCode,
                response: error?.response
            });
        }
    }

    await saveProcessedOrderIds(processedFile, processedOrderIds);

    return {
        total: orders.length,
        delivered: results.filter((entry) => entry.status === 'delivered').length,
        skipped: results.filter((entry) => entry.status === 'skipped').length,
        failed: results.filter((entry) => entry.status === 'failed').length,
        results
    };
}

async function runBridgeLoop({
    env = process.env,
    intervalMs = 30_000,
    onSummary = (summary) => process.stdout.write(`${JSON.stringify(summary)}\n`),
    stopAfterRuns = 0,
    fetchImpl = globalThis.fetch
} = {}) {
    let runs = 0;

    while (true) {
        runs += 1;
        const summary = await runBridgeWorker({ env, fetchImpl });
        onSummary(summary);

        if (stopAfterRuns > 0 && runs >= stopAfterRuns) {
            return summary;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
    resolveBuyerId,
    resolveBuyerName,
    resolveChatId,
    resolveCookieId,
    resolveDeliveryContent,
    resolveItemId,
    resolveOrderId,
    runBridgeLoop,
    runBridgeWorker,
    saveProcessedOrderIds,
    sendDeliveryToXianyuChat
};
