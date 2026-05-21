#!/usr/bin/env node

function sanitizeText(value, maxLength = 500) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, Math.max(0, maxLength));
}

function normalizeBaseUrl(value) {
    const raw = sanitizeText(value, 800);
    if (!raw) return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return withProtocol.replace(/\/+$/, '');
}

function parseArgs(argv = []) {
    const options = {
        baseUrl: process.env.XIANYU_BOT_BRIDGE_BASE_URL || 'http://127.0.0.1:8090',
        token: process.env.XIANYU_BOT_TOKEN || process.env.ZAOYOE_BRIDGE_TOKEN || '',
        sendTestMessage: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--token') {
            options.token = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--send-test-message') {
            options.sendTestMessage = true;
        }
    }

    return options;
}

async function requestJson(pathname, {
    baseUrl,
    token = '',
    method = 'GET',
    body,
    fetchImpl = globalThis.fetch
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw Object.assign(new Error('fetch is unavailable'), {
            code: 'xianyu_bot_bridge_fetch_unavailable'
        });
    }

    const url = new URL(pathname, normalizeBaseUrl(baseUrl));
    const headers = {
        'Content-Type': 'application/json; charset=utf-8'
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = typeof response.text === 'function' ? await response.text() : '';
    let payload = {};

    try {
        payload = text ? JSON.parse(text) : {};
    } catch (_) {
        payload = { raw: text };
    }

    return {
        ok: response.ok,
        status: response.status,
        url: url.toString(),
        payload
    };
}

function summarizeStep(name, result) {
    return {
        name,
        ok: result.ok && result.payload?.success !== false,
        status: result.status,
        url: result.url,
        message: result.payload?.detail || result.payload?.message || '',
        payload: result.payload
    };
}

async function runSmoke({
    baseUrl = 'http://127.0.0.1:8090',
    token = '',
    sendTestMessage = false,
    fetchImpl = globalThis.fetch
} = {}) {
    const steps = [];

    const health = await requestJson('/zaoyoe/health', {
        baseUrl,
        token,
        fetchImpl
    });
    steps.push(summarizeStep('health', health));

    const orders = await requestJson('/zaoyoe/orders/paid?limit=5', {
        baseUrl,
        token,
        fetchImpl
    });
    steps.push({
        ...summarizeStep('orders_paid', orders),
        order_count: Array.isArray(orders.payload?.orders) ? orders.payload.orders.length : 0
    });

    if (sendTestMessage) {
        const chat = await requestJson('/zaoyoe/chat/send', {
            baseUrl,
            token,
            method: 'POST',
            body: {
                external_order_id: 'ZAOYOE-SMOKE-ORDER',
                buyer_id: 'ZAOYOE-SMOKE-BUYER',
                buyer_name: 'Bridge Smoke Test',
                content: 'ZAOYOE_BRIDGE_SMOKE_TEST_DO_NOT_SEND_TO_REAL_BUYER',
                order: {
                    orderId: 'ZAOYOE-SMOKE-ORDER',
                    buyerId: 'ZAOYOE-SMOKE-BUYER',
                    buyerNick: 'Bridge Smoke Test'
                }
            },
            fetchImpl
        });
        steps.push(summarizeStep('chat_send', chat));
    }

    return {
        success: steps.every((step) => step.ok),
        base_url: normalizeBaseUrl(baseUrl),
        send_test_message: sendTestMessage,
        steps
    };
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const summary = await runSmoke(options);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.success) process.exitCode = 1;
    return summary;
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    main,
    normalizeBaseUrl,
    parseArgs,
    requestJson,
    runSmoke
};