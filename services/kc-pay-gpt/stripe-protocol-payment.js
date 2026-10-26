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
        '_stripe_version': V_HOSTED
    };
    if (options.setupFutureUsage) {
        body['setup_future_usage'] = options.setupFutureUsage;
    }

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
 * 向 Stripe 提交 PaymentIntent 真实扣款确认
 */
async function confirmStripePaymentIntent({
    intentId,
    clientSecret,
    pmId,
    ctoken,
    sessionId,
    publishableKey = DEFAULT_OPENAI_PK,
    proxy = ''
}) {
    const client = createHttpClient(proxy);
    const returnUrl = `https://chatgpt.com/checkout/verify?stripe_session_id=${sessionId}`;

    // Stripe 订阅扣款通常要求 setup_future_usage: 'off_session' 的 confirmation_token
    let intentCtoken = ctoken;
    if (pmId) {
        try {
            const setupTokenRes = await createStripeConfirmationToken(pmId, {
                publishableKey,
                proxy,
                setupFutureUsage: 'off_session'
            });
            if (setupTokenRes.ok && setupTokenRes.ctoken) {
                intentCtoken = setupTokenRes.ctoken;
            }
        } catch (_) {}
    }

    const kind = intentId.startsWith('seti_') ? 'setup_intents' : 'payment_intents';
    const body = {
        'key': publishableKey,
        'client_secret': clientSecret,
        '_stripe_version': V_HOSTED,
        'client_attribution_metadata[merchant_integration_source]': 'l1'
    };
    if (intentCtoken) {
        body['confirmation_token'] = intentCtoken;
    }
    if (returnUrl) {
        body['return_url'] = returnUrl;
    }

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
        'Accept': 'application/json'
    };

    console.log(`⚡ [协议支付] 5/5 正在向 Stripe 提交最终扣款确认 (${intentId.slice(0, 14)}...)...`);
    const res = await client.post(
        `https://api.stripe.com/v1/${kind}/${intentId}/confirm`,
        querystring.stringify(body),
        { headers, validateStatus: () => true }
    );
    const data = typeof res.data === 'object' && res.data !== null ? res.data : {};
    return {
        status: res.status,
        ok: res.status === 200,
        data,
        rawText: typeof res.data === 'string' ? res.data : JSON.stringify(data)
    };
}

/**
 * 向 ChatGPT 同步免税账单地址与计税状态 (/backend-api/payments/checkout/taxes)
 */
async function syncCheckoutBillingTax({
    page,
    sessionId,
    billing,
    currency = 'PHP',
    targetHeaders,
    proxy = ''
}) {
    const billingCountry = (billing?.country || 'US').toUpperCase();
    const taxBody = {
        checkout_session_id: sessionId,
        tax_id: null,
        processor_entity: 'openai_llc',
        currency: String(currency || 'PHP').toUpperCase(),
        billing_country: billingCountry,
        billing_name: billing?.name || '',
        billing_address: {
            line1: billing?.line1 || '',
            city: billing?.city || '',
            state: billing?.state || '',
            postal_code: billing?.postal_code || '',
            country: billingCountry
        }
    };

    const taxHeaders = {
        ...targetHeaders,
        'x-openai-target-path': '/backend-api/payments/checkout/taxes',
        'x-openai-target-route': '/backend-api/payments/checkout/taxes'
    };

    console.log(`⚡ [协议支付] 正在向 ChatGPT 同步免税账单地址 (国家=${billingCountry}, 州=${taxBody.billing_address.state || 'Oregon'}, 币种=${taxBody.currency})...`);

    // 优先通过 page.evaluate 发送同源 /taxes
    if (page && typeof page.evaluate === 'function' && !page.isClosed()) {
        try {
            const pageRes = await page.evaluate(async ({ url, headers, bodyObj }) => {
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                    body: JSON.stringify(bodyObj)
                });
                const bodyText = await res.text();
                let json = {};
                try { json = JSON.parse(bodyText); } catch (_) {}
                return { status: res.status, ok: res.ok, data: json, rawText: bodyText };
            }, {
                url: 'https://chatgpt.com/backend-api/payments/checkout/taxes',
                headers: taxHeaders,
                bodyObj: taxBody
            });
            if (pageRes && pageRes.ok) {
                const sess = pageRes.data?.checkout_session || {};
                const amountTotal = sess.amount_total || pageRes.data?.snapshot?.amount_total;
                const taxAmount = sess.total_details?.amount_tax ?? 0;
                console.log(`⚡ [协议支付] ✅ 免税地址同步成功！总金额: ${taxBody.currency} ${amountTotal ? (amountTotal / 100) : ''} (税额: ${taxAmount})`);
                return { ok: true, data: pageRes.data, amountTotal, taxAmount };
            }
        } catch (evalErr) {
            console.warn(`⚠️ [协议支付] 页面同源 /taxes 调用异常: ${evalErr.message}，尝试切入 Node 客户端...`);
        }
    }

    // Node axios 客户端兜底
    try {
        const client = createHttpClient(proxy);
        const nodeRes = await client.post('https://chatgpt.com/backend-api/payments/checkout/taxes', taxBody, {
            headers: taxHeaders,
            validateStatus: () => true
        });
        const data = typeof nodeRes.data === 'object' && nodeRes.data !== null ? nodeRes.data : {};
        if (nodeRes.status === 200) {
            const sess = data.checkout_session || {};
            const amountTotal = sess.amount_total || data.snapshot?.amount_total;
            const taxAmount = sess.total_details?.amount_tax ?? 0;
            console.log(`⚡ [协议支付] ✅ 免税地址同步成功！总金额: ${taxBody.currency} ${amountTotal ? (amountTotal / 100) : ''} (税额: ${taxAmount})`);
            return { ok: true, data, amountTotal, taxAmount };
        } else {
            console.warn(`⚠️ [协议支付] /taxes 上游返回 HTTP ${nodeRes.status}，继续推进确认`);
        }
    } catch (nodeErr) {
        console.warn(`⚠️ [协议支付] /taxes 网络请求异常: ${nodeErr.message}，继续推进确认`);
    }

    return { ok: false };
}

/**
 * 发送 ChatGPT 支付确认请求（支持页面同源和 Node 网络客户端两种通道）
 */
async function postConfirmRequest({
    page,
    sessionId,
    ctoken,
    targetHeaders,
    proxy,
    saveChoice = null
}) {
    const confirmBody = {
        checkout_session_id: sessionId,
        confirmation_token: ctoken,
        confirm_token: ctoken,
        selected_payment_method_type: 'card'
    };
    if (saveChoice !== null && saveChoice !== undefined) {
        confirmBody.save_payment_method_for_reuse = saveChoice ? 'true' : 'false';
    }

    // 优先通过 page.evaluate 发送同源 confirm，兼具原生浏览器 Cookie、TLS 指纹和最高信任度
    if (page && typeof page.evaluate === 'function' && !page.isClosed()) {
        try {
            return await page.evaluate(async ({ url, headers, bodyObj }) => {
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                    body: JSON.stringify(bodyObj)
                });
                const bodyText = await res.text();
                let json = {};
                try { json = JSON.parse(bodyText); } catch (_) {}
                return { status: res.status, ok: res.ok, data: json, rawText: bodyText };
            }, {
                url: 'https://chatgpt.com/backend-api/payments/checkout/confirm',
                headers: targetHeaders,
                bodyObj: confirmBody
            });
        } catch (evalErr) {
            console.warn(`⚠️ [协议支付] 页面同源 confirm 调用异常: ${evalErr.message}，切入 Node 网络客户端重试...`);
        }
    }

    // 若页面内调用未果，采用 Node axios 兜底
    try {
        const client = createHttpClient(proxy);
        const nodeRes = await client.post('https://chatgpt.com/backend-api/payments/checkout/confirm', confirmBody, {
            headers: targetHeaders,
            validateStatus: () => true
        });
        const rawText = typeof nodeRes.data === 'string' ? nodeRes.data : JSON.stringify(nodeRes.data || {});
        return {
            status: nodeRes.status,
            ok: nodeRes.status === 200,
            data: typeof nodeRes.data === 'object' && nodeRes.data !== null ? nodeRes.data : {},
            rawText
        };
    } catch (nodeErr) {
        console.warn(`[-] [协议支付] Node 网络发送 confirm 失败: ${nodeErr.message}`);
        return {
            status: 500,
            ok: false,
            data: {},
            rawText: nodeErr.message,
            networkError: nodeErr.message
        };
    }
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
    console.log(`⚡ [协议支付] 1/5 正在协议向 Stripe 提交卡片 (pm_)...`);
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
    console.log(`⚡ [协议支付] 2/5 正在生成 ConfirmationToken (ctoken_)...`);
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
    console.log(`⚡ [协议支付] 3/5 正在签发结算确认风控令牌 (Sentinel PoW)...`);
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

    // --- 4. 同步免税账单地址与计税 (/backend-api/payments/checkout/taxes) ---
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

    let taxSyncResult = null;
    try {
        taxSyncResult = await syncCheckoutBillingTax({
            page,
            sessionId,
            billing,
            currency,
            targetHeaders,
            proxy
        });
    } catch (taxErr) {
        console.warn(`⚠️ [协议支付] 免税地址同步非阻塞跳过: ${taxErr.message}`);
    }

    // --- 5. 提交支付确认 (默认不带 save_payment_method_for_reuse，遵循 OpenAI 上游规范) ---
    console.log(`⚡ [协议支付] 5/5 正在向 ChatGPT 提交支付确认...`);

    let confirmResult = await postConfirmRequest({
        page,
        sessionId,
        ctoken,
        targetHeaders,
        proxy,
        saveChoice: null // 默认不传，防止被上游报错 Save choice is not available
    });

    if (confirmResult.networkError) {
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `协议确认网络错误: ${confirmResult.networkError}，平滑转入收银台 UI`,
            protocolDirect: true
        };
    }

    // 参考项目经验：如果上游返回 400 且要求保存选项 (new_card_save_choice_required / save choice)，才补发
    const needsSaveChoice = (res) => {
        if (!res || res.status !== 400) return false;
        const text = String(res.rawText || JSON.stringify(res.data || '')).toLowerCase();
        return text.includes('save_choice') || text.includes('save choice');
    };

    if (needsSaveChoice(confirmResult)) {
        for (const choice of [true, false]) {
            console.log(`⚡ [协议支付] 上游要求明确保存卡片选项，尝试 save_payment_method_for_reuse=${choice}...`);
            confirmResult = await postConfirmRequest({
                page,
                sessionId,
                ctoken,
                targetHeaders,
                proxy,
                saveChoice: choice
            });
            if (!needsSaveChoice(confirmResult)) break;
        }
    }

    const payload = confirmResult.data || {};
    const statusStr = String(payload.status || payload.result || '').toLowerCase();
    const pi = payload.payment_intent || {};
    const piStatus = String(pi.status || '').toLowerCase();

    // 检查是否在 ChatGPT 侧直接判定为拒卡 / 支付未通过终态
    const isTerminalDecline = confirmResult.status >= 400
        || ['failed', 'expired', 'canceled', 'cancelled', 'blocked', 'rejected', 'declined', 'not_approved'].includes(statusStr)
        || ['requires_payment_method', 'canceled', 'cancelled'].includes(piStatus)
        || Boolean(pi.last_payment_error);

    if (isTerminalDecline) {
        let errorDetail = payload.error?.message || payload.message || payload.detail;
        if (!errorDetail && statusStr === 'expired') {
            errorDetail = '上游处理支付异常或会话已失效 (There was an error processing your payment / expired)';
        }
        if (!errorDetail) {
            errorDetail = confirmResult.rawText || '上游银行拒绝交易';
        }
        console.warn(`[-] [协议支付] 上游返回支付未完成或拒卡: ${String(errorDetail).slice(0, 160)} (status=${statusStr || confirmResult.status})`);
        return {
            success: false,
            declined: true,
            canRetryCard: true,
            error: String(errorDetail),
            submitted: true,
            submissionAttempted: true,
            protocolDirect: true
        };
    }

    // 提取 PaymentIntent id 和 client_secret
    let clientSecret = String(payload.client_secret || pi.client_secret || '').trim();
    let intentId = String(pi.id || '').trim();
    if (!intentId && clientSecret.includes('_secret_')) {
        intentId = clientSecret.split('_secret_')[0];
    }

    // 若 ChatGPT 确认通过并返回了 client_secret / PaymentIntent，
    // 注意：ChatGPT 侧的 status=success 仅代表「结账意图已受理」，
    // 必须向 Stripe 官方提交实际扣款确认 (payment_intents/:id/confirm) 才能真正执行扣款并出票！
    if (intentId && clientSecret && piStatus !== 'succeeded') {
        const stripeConfirm = await confirmStripePaymentIntent({
            intentId,
            clientSecret,
            pmId,
            ctoken,
            sessionId,
            publishableKey,
            proxy
        });

        if (!stripeConfirm.ok || stripeConfirm.status >= 400) {
            const err = stripeConfirm.data?.error || {};
            const code = err.code || 'card_declined';
            const declineCode = err.decline_code || '';
            const msg = err.message || `Stripe 扣款拒绝 (HTTP ${stripeConfirm.status})`;
            console.warn(`[-] [协议支付] Stripe 真实扣款未通过: ${msg} (code=${code}, decline=${declineCode})`);
            return {
                success: false,
                declined: true,
                canRetryCard: true,
                error: msg,
                code,
                decline_code: declineCode,
                submitted: true,
                submissionAttempted: true,
                protocolDirect: true
            };
        }

        const stripeData = stripeConfirm.data || {};
        const finalStatus = String(stripeData.status || '').toLowerCase();
        if (finalStatus === 'succeeded') {
            console.log(`⚡ [协议支付] 🏆 恭喜！Stripe 真实扣款成功，订阅已正式生效！(pi=${intentId})`);
            return {
                success: true,
                status: 'succeeded',
                paymentState: 'paid',
                submitted: true,
                submissionAttempted: true,
                protocolDirect: true
            };
        }

        if (finalStatus === 'requires_action') {
            console.log(`⚡ [协议支付] Stripe 扣款要求银行 3DS 强安全验证，平滑切入收银台 UI...`);
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

        if (['requires_payment_method', 'canceled', 'cancelled', 'failed'].includes(finalStatus)) {
            const lastErr = stripeData.last_payment_error?.message || '银行拒绝扣款交易';
            console.warn(`[-] [协议支付] Stripe 扣款状态拒付: ${lastErr} (status=${finalStatus})`);
            return {
                success: false,
                declined: true,
                canRetryCard: true,
                error: lastErr,
                submitted: true,
                submissionAttempted: true,
                protocolDirect: true
            };
        }
    }

    // 检查是否已经无需二次确认即成功
    if (confirmResult.ok && (statusStr === 'success' || piStatus === 'succeeded') && !clientSecret) {
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
    if (piStatus === 'requires_action' || payload.type === 'challenge') {
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
