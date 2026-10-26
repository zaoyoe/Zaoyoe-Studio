'use strict';

const crypto = require('crypto');
const querystring = require('querystring');
const axios = require('axios');
const { mintSentinelToken } = require('./sentinel/sentinel-client');

const RUNTIME_HASH = '5412f474d5';
const V_HOSTED = '2020-08-27;custom_checkout_beta=v1';
const DEFAULT_OPENAI_PK = 'pk_live_51HOrSwC6h1nxGoI3lTAgRjYVrz4dU3fVOabyCcKR3pbEJguCVAlqCxdxCUvoRh1XWwRacViovU3kLKvpkjh7IqkW00iXQsjo3n';

/**
 * 创建带可选代理支持的 Axios HTTP 客户端
 */
function createHttpClient(proxy) {
    const config = {
        timeout: 25000,
        validateStatus: () => true
    };
    if (proxy && String(proxy).trim()) {
        try {
            const { ProxyAgent } = require('proxy-agent');
            const agent = new ProxyAgent({ getProxyForUrl: () => String(proxy).trim() });
            config.httpAgent = agent;
            config.httpsAgent = agent;
            config.proxy = false; // 禁用 axios 自带代理处理，由 proxy-agent 完整接管 CONNECT 隧道
        } catch (e) {
            console.warn('⚠️ [协议支付] 初始化 ProxyAgent 警告:', e.message);
        }
    }
    return axios.create(config);
}

/**
 * 格式化卡片有效期为两位月份与四位年份
 */
function normalizeExpiry(card) {
    let month = String(card.exp_month || card.expMonth || '').trim();
    let year = String(card.exp_year || card.expYear || '').trim();
    if (!month || !year) {
        const parts = String(card.expiry || '').split(/[\/\-]/);
        month = month || String(parts[0] || '').trim();
        year = year || String(parts[1] || '').trim();
    }
    if (month.length === 1) month = '0' + month;
    if (year.length === 2) year = '20' + year;
    return { month, year };
}

/**
 * Step 1: 直接向 Stripe API 提交卡号并换取 PaymentMethod (pm_)
 * 采用 Elements 集成标识，规避 Publishable Key 限制
 */
async function createStripePaymentMethod(card, billing, options = {}) {
    const pk = options.publishableKey || DEFAULT_OPENAI_PK;
    const { month, year } = normalizeExpiry(card);
    const client = createHttpClient(options.proxy);

    const body = {
        'type': 'card',
        'card[number]': String(card.number || card.cardNumber || '').replace(/\s+/g, ''),
        'card[exp_month]': month,
        'card[exp_year]': year,
        'card[cvc]': String(card.cvc || '').trim(),
        'allow_redisplay': 'always',
        'billing_details[name]': billing.name || 'Sarah Smith',
        'billing_details[email]': billing.email || '',
        'billing_details[address][country]': billing.country || 'US',
        'billing_details[address][line1]': billing.line1 || '150 E Main St',
        'billing_details[address][city]': billing.city || 'Hillsboro',
        'billing_details[address][state]': billing.state || 'Oregon',
        'billing_details[address][postal_code]': billing.postal_code || billing.zip || '97123',
        'payment_user_agent': `stripe.js/${RUNTIME_HASH}; stripe-js-v3/${RUNTIME_HASH}; payment-element`,
        'client_attribution_metadata[client_session_id]': crypto.randomUUID(),
        'client_attribution_metadata[merchant_integration_source]': 'elements',
        'client_attribution_metadata[merchant_integration_version]': '2021',
        'client_attribution_metadata[payment_method_selection_flow]': 'automatic',
        'guid': crypto.randomUUID(),
        'muid': crypto.randomUUID(),
        'sid': crypto.randomUUID(),
        'key': pk,
        '_stripe_version': V_HOSTED
    };

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
        'Accept': 'application/json'
    };

    const res = await client.post('https://api.stripe.com/v1/payment_methods', querystring.stringify(body), { headers });
    const data = res.data || {};
    return { status: res.status, ok: res.status === 200, data, pmId: data.id || '' };
}

/**
 * Step 2: 将 PaymentMethod (pm_) 换取 ConfirmationToken (ctoken_)
 */
async function createStripeConfirmationToken(pmId, options = {}) {
    const pk = options.publishableKey || DEFAULT_OPENAI_PK;
    const client = createHttpClient(options.proxy);

    const body = {
        'key': pk,
        'payment_method': pmId,
        'setup_future_usage': 'off_session',
        '_stripe_version': V_HOSTED
    };

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
        'Accept': 'application/json'
    };

    const res = await client.post('https://api.stripe.com/v1/confirmation_tokens', querystring.stringify(body), { headers });
    const data = res.data || {};
    return { status: res.status, ok: res.status === 200, data, ctoken: data.id || '' };
}

/**
 * 执行 Stripe 纯协议支付闭环
 *
 * 流程：
 * 1. 协议提交银行卡信息至 Stripe -> 获取 pm_ (秒级判定无效卡/拒卡)
 * 2. 协议生成 ConfirmationToken -> 获取 ctoken_
 * 3. 动态签发 checkout_session_approval 场景的 Sentinel PoW 令牌
 * 4. 协议调用 ChatGPT /taxes 接口同步免税地址与金额
 * 5. 协议调用 ChatGPT /confirm 接口提交订阅
 * 6. 成功直接出票；若需 3DS 强人机或复杂校验，平滑回退至 UI 收银台
 */
async function executeStripeProtocolPayment({
    page,
    card,
    billing,
    sessionId,
    accessToken,
    currency = 'PHP',
    proxy = '',
    publishableKey = DEFAULT_OPENAI_PK,
    onPaymentAttemptStarted
}) {
    const cardLast4 = String(card.number || '').slice(-4);
    console.log(`⚡ [协议支付] 开始 Stripe 纯协议直充 (免收银台 UI 渲染, 卡号: ...${cardLast4})...`);

    if (typeof onPaymentAttemptStarted === 'function') {
        try {
            await onPaymentAttemptStarted();
        } catch (_) {}
    }

    // --- 1. 创建 Stripe PaymentMethod ---
    console.log(`⚡ [协议支付] 1/4 正在协议向 Stripe 提交卡片 (pm_)...`);
    let pmResult;
    try {
        pmResult = await createStripePaymentMethod(card, billing, { proxy, publishableKey });
    } catch (netErr) {
        console.warn(`[-] [协议支付] Stripe 网络请求异常: ${netErr.message}`);
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `Stripe 协议网络异常: ${netErr.message}`,
            protocolDirect: true
        };
    }

    if (!pmResult.ok) {
        const err = pmResult.data?.error || {};
        const errMsg = err.message || `Stripe HTTP ${pmResult.status}`;
        const errCode = err.code || 'card_error';
        const declineCode = err.decline_code || '';
        console.warn(`[-] [协议支付] Stripe 拒付或卡片校验未通过: ${errMsg} (code=${errCode}, decline=${declineCode})`);

        return {
            success: false,
            declined: true,
            canRetryCard: true,
            error: errMsg,
            code: errCode,
            decline_code: declineCode,
            submitted: true,
            submissionAttempted: true,
            protocolDirect: true
        };
    }

    const pmId = pmResult.pmId;
    console.log(`⚡ [协议支付] ✅ Stripe 卡片预留成功: ${pmId.slice(0, 14)}...`);

    // --- 2. 创建 Stripe ConfirmationToken ---
    console.log(`⚡ [协议支付] 2/4 正在生成 ConfirmationToken (ctoken_)...`);
    let ctokenResult;
    try {
        ctokenResult = await createStripeConfirmationToken(pmId, { proxy, publishableKey });
    } catch (tokenErr) {
        console.warn(`[-] [协议支付] ConfirmationToken 网络异常: ${tokenErr.message}`);
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `ConfirmationToken 异常: ${tokenErr.message}`,
            protocolDirect: true
        };
    }

    if (!ctokenResult.ok || !ctokenResult.ctoken) {
        const err = ctokenResult.data?.error || {};
        console.warn(`[-] [协议支付] ConfirmationToken 生成未通过: ${err.message || '未知错误'}`);
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `ConfirmationToken 生成未果: ${err.message || '转入收银台 UI 兜底'}`,
            protocolDirect: true
        };
    }

    const ctoken = ctokenResult.ctoken;
    console.log(`⚡ [协议支付] ✅ ConfirmationToken 就绪: ${ctoken.slice(0, 14)}...`);

    // --- 3. 签发 Sentinel 令牌 (flow: checkout_session_approval) ---
    console.log(`⚡ [协议支付] 3/4 正在签发结算确认风控令牌 (Sentinel PoW)...`);
    let sentinelTokens = {};
    try {
        const checkoutUrl = `https://chatgpt.com/checkout/openai_llc/${sessionId}`;
        sentinelTokens = await mintSentinelToken({
            flow: 'checkout_session_approval',
            pageUrl: checkoutUrl,
            proxy: proxy || '',
            timeoutMs: 15000
        });
        console.log(`⚡ [协议支付] ✅ 结算确认风控令牌已就绪`);
    } catch (e) {
        console.warn(`⚠️ [协议支付] 确认阶段 Sentinel 签发跳过: ${e.message}`);
    }

    // --- 4. 同步免税地址与税费 ---
    console.log(`⚡ [协议支付] 4/4 正在向 ChatGPT 同步免税地址并提交确认...`);
    const checkoutPageUrl = `https://chatgpt.com/checkout/openai_llc/${sessionId}`;
    const targetHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://chatgpt.com',
        'Referer': checkoutPageUrl,
        'x-openai-target-path': '/backend-api/payments/checkout/confirm',
        'x-openai-target-route': '/backend-api/payments/checkout/confirm',
        ...(sentinelTokens.sentinelToken ? { 'openai-sentinel-token': sentinelTokens.sentinelToken } : {}),
        ...(sentinelTokens.sentinelSoToken ? { 'openai-sentinel-so-token': sentinelTokens.sentinelSoToken } : {})
    };

    // 优先通过 page.evaluate 发送同源 confirm，兼具原生浏览器 Cookie、TLS 指纹和最高信任度
    let confirmResult = null;
    if (page && typeof page.evaluate === 'function' && !page.isClosed()) {
        try {
            confirmResult = await page.evaluate(async ({ url, headers, ctokenVal, sessId }) => {
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                    body: JSON.stringify({
                        checkout_session_id: sessId,
                        confirmation_token: ctokenVal,
                        confirm_token: ctokenVal,
                        selected_payment_method_type: 'card',
                        save_payment_method_for_reuse: 'true'
                    })
                });
                const bodyText = await res.text();
                let json = {};
                try { json = JSON.parse(bodyText); } catch (_) {}
                return { status: res.status, ok: res.ok, data: json, rawText: bodyText };
            }, {
                url: 'https://chatgpt.com/backend-api/payments/checkout/confirm',
                headers: targetHeaders,
                ctokenVal: ctoken,
                sessId: sessionId
            });
        } catch (evalErr) {
            console.warn(`⚠️ [协议支付] 页面同源 confirm 调用异常: ${evalErr.message}，切入 Node 网络客户端重试...`);
        }
    }

    // 若页面内调用未果，采用 Node axios 兜底
    if (!confirmResult) {
        try {
            const client = createHttpClient(proxy);
            const nodeRes = await client.post('https://chatgpt.com/backend-api/payments/checkout/confirm', {
                checkout_session_id: sessionId,
                confirmation_token: ctoken,
                confirm_token: ctoken,
                selected_payment_method_type: 'card',
                save_payment_method_for_reuse: 'true'
            }, { headers: targetHeaders });
            confirmResult = { status: nodeRes.status, ok: nodeRes.status === 200, data: nodeRes.data, rawText: JSON.stringify(nodeRes.data || {}) };
        } catch (nodeErr) {
            console.warn(`[-] [协议支付] Node 网络发送 confirm 失败: ${nodeErr.message}`);
            return {
                success: false,
                declined: false,
                fallbackToUi: true,
                error: `协议确认网络错误: ${nodeErr.message}，平滑转入收银台 UI`,
                protocolDirect: true
            };
        }
    }

    const payload = confirmResult.data || {};
    const statusStr = String(payload.status || payload.result || '').toLowerCase();
    const pi = payload.payment_intent || {};
    const piStatus = String(pi.status || '').toLowerCase();

    // 检查是否成功
    if (confirmResult.ok && (statusStr === 'success' || piStatus === 'succeeded')) {
        console.log(`⚡ [协议支付] 🏆 恭喜！纯协议充值全链路秒级开通成功！(status=${statusStr}, pi=${pi.id || 'none'})`);
        return {
            success: true,
            status: statusStr,
            paymentState: 'paid',
            submitted: true,
            submissionAttempted: true,
            protocolDirect: true
        };
    }

    // 检查是否需要 3DS / 人机交互
    if (piStatus === 'requires_action' || payload.client_secret || payload.type === 'challenge') {
        console.log(`⚡ [协议支付] 检测到该卡触发了银行 3DS 强安全验证或人机核验，正在平滑交由 UI 浏览器打开处理...`);
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            requiresAction: true,
            reason: '3ds_required',
            error: '银行卡需要 3DS 验证，平滑切入收银台 UI',
            protocolDirect: true
        };
    }

    // 检查是否拒卡
    if (confirmResult.status >= 400 || statusStr === 'failed' || piStatus === 'requires_payment_method') {
        const errorDetail = payload.error?.message || payload.message || confirmResult.rawText || '上游银行拒绝交易';
        console.warn(`[-] [协议支付] 上游返回支付未完成或拒卡: ${errorDetail.slice(0, 160)}`);
        return {
            success: false,
            declined: true,
            canRetryCard: true,
            error: errorDetail,
            submitted: true,
            submissionAttempted: true,
            protocolDirect: true
        };
    }

    // 其他情况平滑交由 UI
    console.log(`⚡ [协议支付] 状态未完全确认 (${statusStr || confirmResult.status})，平滑转由 UI 收银台核查`);
    return {
        success: false,
        declined: false,
        fallbackToUi: true,
        error: `协议确认状态=${statusStr || confirmResult.status}`,
        protocolDirect: true
    };
}

module.exports = {
    createStripePaymentMethod,
    createStripeConfirmationToken,
    executeStripeProtocolPayment,
    DEFAULT_OPENAI_PK
};
