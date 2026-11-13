'use strict';

const crypto = require('crypto');
const querystring = require('querystring');
const axios = require('axios');
const { mintSentinelToken } = require('./sentinel/sentinel-client');
const { getChatGptProtocolProfile, buildChatGptBrowserHeaders } = require('./region-config');
const { substituteProxySession, resetActiveProxyTunnels } = require('./playwright-proxy');
const { registerStripeDeviceFingerprint } = require('./stripe-device-fingerprint');

const RUNTIME_HASH = '5412f474d5';
const {
    ALL_EXPLICIT_STRIPE_DECLINE_CODES,
    formatStripeDeclineReason
} = require('./payment-decline-dictionary');

const V_HOSTED = '2020-08-27;custom_checkout_beta=v1';
const DEFAULT_OPENAI_PK = 'pk_live_51HOrSwC6h1nxGoI3lTAgRjYVrz4dU3fVOabyCcKR3pbEJguCVAlqCxdxCUvoRh1XWwRacViovU3kLKvpkjh7IqkW00iXQsjo3n';
const DEFAULT_STRIPE_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const DEFAULT_STRIPE_SEC_CH_UA = '"Not.A/Brand";v="99", "Chromium";v="136", "Google Chrome";v="136"';
const EXPLICIT_STRIPE_DECLINE_CODES = ALL_EXPLICIT_STRIPE_DECLINE_CODES;

function isSuccessfulHttp(response) {
    return Boolean(
        response
        && Number(response.status) >= 200
        && Number(response.status) < 300
    );
}

function createProtocolAttemptId() {
    return crypto.randomUUID();
}

function hashProtocolValue(value) {
    const normalized = String(value || '');
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function getProtocolTokenLabel(value) {
    const hash = hashProtocolValue(value);
    return hash ? `sha256:${hash.slice(0, 16)}` : 'absent';
}

function getClientSecretIntentId(clientSecret) {
    const secret = String(clientSecret || '').trim();
    const marker = '_secret_';
    const markerIndex = secret.indexOf(marker);
    return markerIndex > 0 ? secret.slice(0, markerIndex) : '';
}

function protocolCorrelationMismatch({
    attemptId,
    sessionId,
    pmId,
    ctoken,
    intentId,
    reason,
    submitted = true
}) {
    console.warn(
        `⚠️ [协议支付] attempt 关联校验失败: attempt=${attemptId} session=${sessionId || 'absent'} `
        + `pm=${pmId || 'absent'} pi=${intentId || 'absent'} ctoken=${getProtocolTokenLabel(ctoken)} reason=${reason}`
    );
    return {
        success: false,
        code: 'PAYMENT_ATTEMPT_CORRELATION_MISMATCH',
        error: `支付 attempt 关联校验失败: ${reason}`,
        manualIntervention: true,
        submitted,
        submissionAttempted: true,
        protocolDirect: true,
        attemptId,
        sessionId: sessionId || null,
        paymentMethodId: pmId || null,
        paymentIntentId: intentId || null,
        confirmationTokenHash: hashProtocolValue(ctoken)
    };
}

function paymentResultUnknown({
    attemptId,
    sessionId,
    error,
    submitted = true,
    paymentIntentId = '',
    paymentMethodId = '',
    confirmationTokenHash = '',
    code = 'PAYMENT_RESULT_UNKNOWN'
}) {
    return {
        success: false,
        declined: false,
        code,
        error,
        manualIntervention: true,
        submitted,
        submissionAttempted: submitted,
        protocolDirect: true,
        attemptId,
        sessionId: sessionId || null,
        paymentIntentId: paymentIntentId || null,
        paymentMethodId: paymentMethodId || null,
        confirmationTokenHash: confirmationTokenHash || null
    };
}

function isExplicitStripeDecline(data = {}, status = 0) {
    const error = data?.error
        || data?.last_payment_error
        || data?.payment_intent?.last_payment_error
        || {};
    const code = String(error.code || data?.code || '').trim().toLowerCase();
    const declineCode = String(error.decline_code || data?.decline_code || '').trim().toLowerCase();
    return Boolean(
        EXPLICIT_STRIPE_DECLINE_CODES.has(code)
        || EXPLICIT_STRIPE_DECLINE_CODES.has(declineCode)
    );
}

function buildStripeBrowserHeaders(origin = 'https://js.stripe.com', userAgent = DEFAULT_STRIPE_CHROME_UA) {
    const cleanOrigin = String(origin || 'https://js.stripe.com').replace(/\/+$/, '');
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': cleanOrigin,
        'Referer': `${cleanOrigin}/`,
        'User-Agent': userAgent || DEFAULT_STRIPE_CHROME_UA,
        'sec-ch-ua': DEFAULT_STRIPE_SEC_CH_UA,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site'
    };
}

/**
 * 使用 Chrome BoringSSL TLS (impit) 向 api.stripe.com 发送表单 POST 请求，
 * 彻底消除 axios 默认 User-Agent 泄露与 Node OpenSSL TLS JA3/JA4 指纹特征
 */
async function postStripeFormChromeTls(url, bodyObj, headers, proxy = '', maxRetries = 3) {
    const bodyStr = typeof bodyObj === 'string' ? bodyObj : querystring.stringify(bodyObj);
    let ImpitClass = null;
    try {
        ({ Impit: ImpitClass } = require('impit'));
    } catch (_) {}

    if (ImpitClass) {
        let currentProxy = String(proxy || '').trim();
        let lastErr = null;
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                const client = new ImpitClass({
                    browser: 'chrome',
                    proxyUrl: currentProxy || undefined,
                    ignoreTlsErrors: true,
                    timeout: 25000
                });
                const res = await client.fetch(url, {
                    method: 'POST',
                    headers,
                    body: bodyStr
                });
                const rawText = await res.text();
                let data = {};
                try { data = JSON.parse(rawText); } catch (_) {}
                return { status: res.status, ok: res.status === 200, data, rawText };
            } catch (err) {
                lastErr = err;
                if (attempt >= maxRetries || !currentProxy) break;
                const nextProxy = substituteProxySession(currentProxy);
                if (nextProxy && nextProxy !== currentProxy) {
                    currentProxy = nextProxy;
                    try { resetActiveProxyTunnels(); } catch (_) {}
                }
                await new Promise((r) => setTimeout(r, 400));
            }
        }
        if (lastErr && !proxy) {
            // Fall through to executeWithProxyRetry fallback if impit failed locally
        }
    }

    const res = await executeWithProxyRetry(async (client) => {
        return await client.post(url, bodyStr, {
            headers,
            validateStatus: () => true
        });
    }, { proxy, maxRetries });
    const data = typeof res.data === 'object' && res.data !== null ? res.data : {};
    return {
        status: res.status,
        ok: res.status === 200,
        data,
        rawText: typeof res.data === 'string' ? res.data : JSON.stringify(data)
    };
}

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
 * 带有代理瞬态故障自动轮换 SID 重试的 HTTP 请求执行器
 * 针对代理出口 SSL 断开、EOF、TLS 握手失败、ECONNRESET 等瞬态故障，
 * 原地更换代理 SID 获取全新可用住宅出口节点重试，避免整单挂掉。
 */
async function executeWithProxyRetry(requestFn, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    let currentProxy = options.proxy;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const client = createHttpClient(currentProxy);
            return await requestFn(client, currentProxy);
        } catch (err) {
            lastError = err;
            const errMsg = String(err.message || '');
            const errCode = String(err.code || '');

            const isTransientProxyError = (
                errCode === 'ECONNRESET' ||
                errCode === 'ETIMEDOUT' ||
                errCode === 'ECONNREFUSED' ||
                errCode === 'EPIPE' ||
                errMsg.includes('socket hang up') ||
                errMsg.includes('UNEXPECTED_EOF') ||
                errMsg.includes('Client network socket disconnected') ||
                errMsg.includes('TLS') ||
                errMsg.includes('handshake')
            );

            if (!isTransientProxyError || attempt >= maxRetries || !currentProxy) {
                throw err;
            }

            const nextProxy = substituteProxySession(currentProxy);
            if (nextProxy && nextProxy !== currentProxy) {
                console.warn(`🔄 [协议网络] 代理出现瞬态握手故障 (${errMsg || errCode})，正在就地轮换出口 SID 重试 (尝试 ${attempt + 1}/${maxRetries})...`);
                currentProxy = nextProxy;
                try { resetActiveProxyTunnels(); } catch (_) {}
            } else {
                console.warn(`🔄 [协议网络] 代理出现瞬态网络异常 (${errMsg || errCode})，准备重试 (尝试 ${attempt + 1}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, 600));
            }
        }
    }
    throw lastError;
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

    // 只能使用官方端点确认过的设备上下文；网络失败时禁止用随机值替代。
    let fp = options.fingerprint;
    if (!fp || !fp.guid || !fp.muid || !fp.sid) {
        fp = await registerStripeDeviceFingerprint({ proxy: options.proxy });
    }
    if (
        fp?.source !== 'stripe_registered'
        || !String(fp.guid || '').trim()
        || !String(fp.muid || '').trim()
        || !String(fp.sid || '').trim()
    ) {
        throw Object.assign(
            new Error('Stripe 设备指纹未由官方端点确认，已停止创建 PaymentMethod'),
            { code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE' }
        );
    }
    if (!fp.clientSessionId) {
        fp.clientSessionId = crypto.randomUUID();
    }
    if (fp?.source === 'stripe_registered') {
        console.log(`⚡ [协议支付] ✅ 已挂载 Stripe 真实设备指纹 (Radar 防风控增强: muid=${fp.muid.slice(0, 8)}..., sid=${fp.sid.slice(0, 8)}...)`);
    }

    const billingName = billing.name || 'Sarah Smith';

    const body = {
        'type': 'card',
        'card[number]': String(card.number || card.cardNumber || '').replace(/\s+/g, ''),
        'card[exp_month]': month,
        'card[exp_year]': year,
        'card[cvc]': String(card.cvc || '').trim(),
        'allow_redisplay': 'always',
        'billing_details[name]': billingName,
        'billing_details[email]': billing.email || '',
        'billing_details[address][country]': billing.country || 'US',
        'billing_details[address][line1]': billing.line1 || '150 E Main St',
        'billing_details[address][city]': billing.city || 'Hillsboro',
        'billing_details[address][state]': billing.state || 'Oregon',
        'billing_details[address][postal_code]': billing.postal_code || billing.zip || '97123',
        'payment_user_agent': `stripe.js/${RUNTIME_HASH}; stripe-js-v3/${RUNTIME_HASH}; payment-element`,
        'time_on_page': String(Math.floor(18000 + Math.random() * 24000)),
        'pasted_fields': 'number',
        'client_attribution_metadata[client_session_id]': fp.clientSessionId,
        'client_attribution_metadata[merchant_integration_source]': 'elements',
        'client_attribution_metadata[merchant_integration_version]': '2021',
        'client_attribution_metadata[payment_method_selection_flow]': 'automatic',
        'guid': fp.guid,
        'muid': fp.muid,
        'sid': fp.sid,
        'key': pk,
        '_stripe_version': V_HOSTED
    };

    const headers = buildStripeBrowserHeaders('https://js.stripe.com', fp?.userAgent);
    const res = await postStripeFormChromeTls(
        'https://api.stripe.com/v1/payment_methods',
        body,
        headers,
        options.proxy,
        3
    );
    const data = res.data || {};
    return { status: res.status, ok: res.status === 200, data, pmId: data.id || '', fingerprint: fp };
}

/**
 * Step 2: 将 PaymentMethod (pm_) 换取 ConfirmationToken (ctoken_)
 */
async function createStripeConfirmationToken(pmId, options = {}) {
    const pk = options.publishableKey || DEFAULT_OPENAI_PK;
    const clientSessionId = options.fingerprint?.clientSessionId || options.clientSessionId || crypto.randomUUID();

    // 注意：guid/muid/sid 与 payment_user_agent 已在 Step 1 createStripePaymentMethod 绑定至 pm_ 内部，
    // /v1/confirmation_tokens 在接收 payment_method=pm_ 时仅接受 client_attribution_metadata，传入顶层 guid/muid/sid 会报 parameter_unknown
    const body = {
        'key': pk,
        'payment_method': pmId,
        '_stripe_version': V_HOSTED,
        'client_attribution_metadata[client_session_id]': clientSessionId,
        'client_attribution_metadata[merchant_integration_source]': 'elements',
        'client_attribution_metadata[merchant_integration_version]': '2021',
        'client_attribution_metadata[payment_method_selection_flow]': 'automatic'
    };
    const setupFutureUsage = options.setupFutureUsage !== undefined ? options.setupFutureUsage : 'off_session';
    if (setupFutureUsage) {
        body['setup_future_usage'] = setupFutureUsage;
    }

    const headers = buildStripeBrowserHeaders('https://js.stripe.com', options.fingerprint?.userAgent);
    const res = await postStripeFormChromeTls(
        'https://api.stripe.com/v1/confirmation_tokens',
        body,
        headers,
        options.proxy,
        3
    );
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
    proxy = '',
    amount = null,
    currency = '',
    fingerprint = null,
    page = null,
    protocolOnly = true
}) {
    const returnUrl = `https://chatgpt.com/checkout/verify?stripe_session_id=${sessionId}`;
    const kind = intentId.startsWith('seti_') ? 'setup_intents' : 'payment_intents';
    const isHosted = Boolean(sessionId && (sessionId.startsWith('cs_live_') || sessionId.startsWith('cs_test_')));
    const source = isHosted ? 'l1' : 'elements';
    const clientSessionId = fingerprint?.clientSessionId || crypto.randomUUID();

    // 严禁在此处重复请求生成新的 ConfirmationToken（会在毫秒内对同一卡号产生多重申领，被 Stripe Radar 判定为高危欺诈）
    // 直接使用前置绑定生成的 ctoken（已内嵌 Step 1 绑定的 Radar 设备指纹 muid/sid/guid）
    const body = {
        'key': publishableKey,
        'client_secret': clientSecret,
        '_stripe_version': V_HOSTED,
        'client_attribution_metadata[client_session_id]': clientSessionId,
        'client_attribution_metadata[merchant_integration_source]': source,
        'client_attribution_metadata[merchant_integration_version]': '2021',
        'client_attribution_metadata[payment_method_selection_flow]': 'automatic',
        'use_stripe_sdk': 'true'
    };

    if (ctoken) {
        body['confirmation_token'] = ctoken;
    } else if (pmId) {
        body['payment_method'] = pmId;
    }
    if (returnUrl) {
        body['return_url'] = returnUrl;
    }

    const headers = buildStripeBrowserHeaders('https://js.stripe.com', fingerprint?.userAgent);

    const amountSuffix = amount != null ? `, 扣款金额: ${currency || ''} ${amount}` : '';
    console.log(`⚡ [协议支付] 5/5 正在向 Stripe 提交最终扣款确认 (${intentId.slice(0, 14)}...${amountSuffix})...`);

    // 纯协议 attempt 不允许借用页面状态；保留页面通道仅供旧的显式非协议调用。
    if (!protocolOnly && page && typeof page.evaluate === 'function' && !page.isClosed()) {
        try {
            const pageRes = await page.evaluate(async ({ url, bodyStr }) => {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    body: bodyStr
                });
                const text = await res.text();
                let json = {};
                try { json = JSON.parse(text); } catch (_) {}
                return { status: res.status, ok: res.ok, data: json, rawText: text };
            }, {
                url: `https://api.stripe.com/v1/${kind}/${intentId}/confirm`,
                bodyStr: querystring.stringify(body)
            });
            if (pageRes && (pageRes.status === 200 || pageRes.data?.error)) {
                return pageRes;
            }
        } catch (evalErr) {
            console.warn(`⚠️ [协议支付] 页面同源确认尝试未果 (${evalErr.message})，转入 Chrome TLS 客户端直接发包...`);
        }
    }

    return await postStripeFormChromeTls(
        `https://api.stripe.com/v1/${kind}/${intentId}/confirm`,
        body,
        headers,
        proxy,
        3
    );
}

async function retrieveStripePaymentIntent({
    intentId,
    clientSecret = '',
    publishableKey = DEFAULT_OPENAI_PK,
    proxy = '',
    fingerprint = null
}) {
    const normalizedIntentId = String(intentId || '').trim();
    if (!normalizedIntentId) {
        throw new Error('缺少 PaymentIntent id，无法查询最终支付状态');
    }
    const kind = normalizedIntentId.startsWith('seti_') ? 'setup_intents' : 'payment_intents';
    const params = { key: publishableKey };
    if (clientSecret) params.client_secret = clientSecret;
    const headers = buildStripeBrowserHeaders('https://js.stripe.com', fingerprint?.userAgent);
    const res = await executeWithProxyRetry(async (client) => client.get(
        `https://api.stripe.com/v1/${kind}/${normalizedIntentId}`,
        { params, headers, validateStatus: () => true }
    ), { proxy, maxRetries: 2 });
    const data = typeof res.data === 'object' && res.data !== null ? res.data : {};
    return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        data,
        rawText: typeof res.data === 'string' ? res.data : JSON.stringify(data)
    };
}

/**
 * 根据套餐类型/名称、币种与免税州标志，推算默认展示/兜底金额（避免 Pro/Team 等套餐在未返回 minorUnitsAmount 时被错误兜底为 Plus 982.14 / $20）
 */
function getDefaultPlanDisplayAmount(planHint, currency = 'PHP', isTaxFree = true) {
    const plan = String(planHint || 'plus').trim().toLowerCase();
    const curr = String(currency || 'PHP').trim().toUpperCase();
    const teamMatch = plan.match(/^team_?(\d+)$/i);
    const seats = teamMatch ? Math.max(2, parseInt(teamMatch[1], 10) || 2) : 2;

    if (curr === 'PHP') {
        if (/pro_?500|pro_?max|chatgptpromax/i.test(plan)) return isTaxFree ? 29008.93 : 32490;
        if (/pro_?100|pro_?5x|chatgptprolite|^pro$/i.test(plan)) return isTaxFree ? 5794.64 : 6490;
        if (/pro_?200|pro_?20x|pro_?more|chatgptpro/i.test(plan)) return isTaxFree ? 8919.64 : 9990;
        if (/\bgo\b|chatgptgoplan/i.test(plan)) return isTaxFree ? 267.86 : 300;
        if (/team|chatgptteamplan/i.test(plan)) return seats * 1450;
        return isTaxFree ? 982.14 : 1100;
    }

    if (curr === 'USD') {
        if (/pro_?500|pro_?max|chatgptpromax/i.test(plan)) return 500;
        if (/pro_?100|pro_?5x|chatgptprolite|^pro$/i.test(plan)) return 100;
        if (/pro_?200|pro_?20x|pro_?more|chatgptpro/i.test(plan)) return 200;
        if (/\bgo\b|chatgptgoplan/i.test(plan)) return 8;
        if (/team|chatgptteamplan/i.test(plan)) return seats * 30;
        return 20;
    }

    return null;
}

/**
 * 向 ChatGPT 同步免税账单地址与计税状态 (/backend-api/payments/checkout/taxes 及 /update_tax_id)
 */
async function syncCheckoutBillingTax({
    page,
    sessionId,
    billing,
    currency = 'PHP',
    planType = '',
    targetHeaders,
    proxy = '',
    protocolOnly = true
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

    const updateTaxIdBody = {
        checkout_session_id: sessionId,
        tax_id_info: null
    };

    const updateTaxIdHeaders = {
        ...targetHeaders,
        'x-openai-target-path': '/backend-api/payments/checkout/update_tax_id',
        'x-openai-target-route': '/backend-api/payments/checkout/update_tax_id'
    };

    console.log(`⚡ [协议支付] 正在向 ChatGPT 同步免税账单地址 (国家=${billingCountry}, 州=${taxBody.billing_address.state || 'Oregon'}, 币种=${taxBody.currency})...`);

    const buildSyncResult = (taxResponse, updateResponse) => {
        if (!isSuccessfulHttp(taxResponse) || !taxResponse.ok) {
            return {
                ok: false,
                stage: 'taxes',
                code: 'CHECKOUT_TAX_SYNC_FAILED',
                status: taxResponse?.status || 0,
                error: `Checkout taxes 请求失败 (HTTP ${taxResponse?.status || 'unknown'})`
            };
        }
        if (!isSuccessfulHttp(updateResponse) || !updateResponse.ok) {
            return {
                ok: false,
                stage: 'update_tax_id',
                code: 'CHECKOUT_TAX_ID_SYNC_FAILED',
                status: updateResponse?.status || 0,
                error: `Checkout update_tax_id 请求失败 (HTTP ${updateResponse?.status || 'unknown'})`
            };
        }

        const data = taxResponse.data || {};
        const sess = data.checkout_session || data || {};
        const checkoutStateTotal = sess.checkout_state?.total;
        const rawTotal = checkoutStateTotal?.total?.minorUnitsAmount
            ?? sess.checkout_state?.lineItems?.[0]?.total?.minorUnitsAmount
            ?? sess.amount_total
            ?? data.snapshot?.amount_total
            ?? data.amount_total
            ?? data.total;
        const taxAmount = checkoutStateTotal?.taxExclusive?.minorUnitsAmount
            ?? checkoutStateTotal?.taxInclusive?.minorUnitsAmount
            ?? sess.total_details?.amount_tax
            ?? data.amount_tax
            ?? 0;
        const isOregon = (billing?.country === 'US' && /oregon|or\b/i.test(billing?.state || ''));
        const fallbackAmount = getDefaultPlanDisplayAmount(planType || sess.plan_name, taxBody.currency, isOregon);
        const displayTotal = (rawTotal != null && !isNaN(rawTotal)) ? (rawTotal / 100) : fallbackAmount;
        console.log(`⚡ [协议支付] ✅ 免税地址与税务状态同步成功！总金额: ${taxBody.currency} ${displayTotal} (税额: ${taxAmount})`);
        return {
            ok: true,
            data,
            updateData: updateResponse.data || {},
            amountTotal: rawTotal,
            taxAmount,
            planName: sess.plan_name || ''
        };
    };

    // 纯协议也允许复用已存在的同源请求上下文，但两个请求必须严格串行：
    // /taxes 成功后才允许 /update_tax_id；任一步失败都不得创建银行卡令牌。
    if (!protocolOnly && page && typeof page.evaluate === 'function' && !page.isClosed()) {
        try {
            const pageRes = await page.evaluate(async ({ taxUrl, updateTaxIdUrl, headers, bodyObj, updateHeaders, updateBodyObj }) => {
                const taxRes = await fetch(taxUrl, {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                    body: JSON.stringify(bodyObj)
                });
                const taxText = await taxRes.text();
                let taxJson = {};
                try { taxJson = JSON.parse(taxText); } catch (_) {}
                if (!taxRes.ok) {
                    return {
                        tax: { status: taxRes.status, ok: false, data: taxJson, rawText: taxText },
                        update: null
                    };
                }

                const updateRes = await fetch(updateTaxIdUrl, {
                    method: 'POST',
                    headers: updateHeaders,
                    credentials: 'include',
                    body: JSON.stringify(updateBodyObj)
                });
                const updateText = await updateRes.text();
                let updateJson = {};
                try { updateJson = JSON.parse(updateText); } catch (_) {}
                return {
                    tax: { status: taxRes.status, ok: taxRes.ok, data: taxJson, rawText: taxText },
                    update: { status: updateRes.status, ok: updateRes.ok, data: updateJson, rawText: updateText }
                };
            }, {
                taxUrl: 'https://chatgpt.com/backend-api/payments/checkout/taxes',
                updateTaxIdUrl: 'https://chatgpt.com/backend-api/payments/checkout/update_tax_id',
                headers: taxHeaders,
                bodyObj: taxBody,
                updateHeaders: updateTaxIdHeaders,
                updateBodyObj: updateTaxIdBody
            });
            if (pageRes && pageRes.tax) {
                return buildSyncResult(pageRes.tax, pageRes.update);
            }
        } catch (evalErr) {
            console.warn(`⚠️ [协议支付] 同源税区请求异常: ${evalErr.message}，尝试协议客户端...`);
        }
    }

    // 页面上下文不可用或请求本身抛出网络异常时，使用协议客户端重试。
    try {
        const taxRes = await postChatGptChromeTls(
            'https://chatgpt.com/backend-api/payments/checkout/taxes',
            taxBody,
            taxHeaders,
            proxy,
            2
        );
        if (!isSuccessfulHttp(taxRes) || !taxRes.ok) {
            return buildSyncResult(taxRes, null);
        }
        const updateRes = await postChatGptChromeTls(
            'https://chatgpt.com/backend-api/payments/checkout/update_tax_id',
            updateTaxIdBody,
            updateTaxIdHeaders,
            proxy,
            1
        );
        return buildSyncResult(taxRes, updateRes);
    } catch (nodeErr) {
        return {
            ok: false,
            stage: 'taxes',
            code: 'CHECKOUT_TAX_SYNC_NETWORK_ERROR',
            error: `Checkout 税区同步网络异常: ${nodeErr.message}`,
            networkError: true
        };
    }
}

/**
 * 使用 Chrome BoringSSL TLS 指纹 (impit) 向 chatgpt.com 发送 JSON POST，规避 Node OpenSSL JA3/JA4 触发 Cloudflare 403
 */
async function postChatGptChromeTls(url, bodyObj, headers, proxy = '', maxRetries = 2) {
    let ImpitClass = null;
    try {
        ({ Impit: ImpitClass } = require('impit'));
    } catch (_) {}

    if (ImpitClass) {
        let currentProxy = String(proxy || '').trim();
        let lastErr = null;
        const bodyStr = JSON.stringify(bodyObj);
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                const client = new ImpitClass({
                    browser: 'chrome',
                    proxyUrl: currentProxy || undefined,
                    ignoreTlsErrors: true,
                    timeout: 25000
                });
                const res = await client.fetch(url, {
                    method: 'POST',
                    headers,
                    body: bodyStr
                });
                const rawText = await res.text();
                let data = {};
                try { data = JSON.parse(rawText); } catch (_) {}
                return { status: res.status, ok: res.status === 200, data, rawText };
            } catch (err) {
                lastErr = err;
                if (attempt >= maxRetries) break;
                const nextProxy = currentProxy ? substituteProxySession(currentProxy) : '';
                if (nextProxy && nextProxy !== currentProxy) {
                    currentProxy = nextProxy;
                }
                try { resetActiveProxyTunnels(); } catch (_) {}
                await new Promise((r) => setTimeout(r, 350));
            }
        }
        if (lastErr) throw lastErr;
    }

    const nodeRes = await executeWithProxyRetry(async (client) => {
        return await client.post(url, bodyObj, {
            headers,
            validateStatus: () => true
        });
    }, { proxy, maxRetries });
    const rawText = typeof nodeRes.data === 'string' ? nodeRes.data : JSON.stringify(nodeRes.data || {});
    return {
        status: nodeRes.status,
        ok: nodeRes.status === 200,
        data: typeof nodeRes.data === 'object' && nodeRes.data !== null ? nodeRes.data : {},
        rawText
    };
}

/**
 * 发送 ChatGPT 支付确认请求（支持页面同源和 Chrome TLS 指纹直连两种通道）
 */
async function postConfirmRequest({
    page,
    sessionId,
    ctoken,
    targetHeaders,
    proxy,
    saveChoice = null,
    protocolOnly = true
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
    if (!protocolOnly && page && typeof page.evaluate === 'function' && !page.isClosed()) {
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
            console.warn(`⚠️ [协议支付] 页面同源 confirm 调用异常: ${evalErr.message}，切入 Chrome TLS 客户端重试...`);
        }
    }

    // 0 浏览器模式或页面内调用未果：采用 Chrome TLS 指纹客户端直连（集成代理自动轮换重试）
    try {
        return await postChatGptChromeTls(
            'https://chatgpt.com/backend-api/payments/checkout/confirm',
            confirmBody,
            targetHeaders,
            proxy,
            2
        );
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
 * 前置预热 Stripe ConfirmationToken (pm_ + ctoken_)
 * 可在任务启动或结账创建阶段于后台异步执行，使协议支付耗时再降 4~5 秒
 */
async function prewarmStripeConfirmationToken({ card, billing, proxy = '', publishableKey = DEFAULT_OPENAI_PK, planType = '' }) {
    if (!card || !billing) return null;
    const cardLast4 = String(card.number || card.card_number || '').slice(-4);
    const isTeam = /team/i.test(String(planType || ''));
    try {
        if (isTeam) {
            console.log(`⚡ [协议预热] Team 托管模式：正在后台异步预热 Stripe Radar 设备指纹 (卡号: ...${cardLast4})...`);
            const fp = await registerStripeDeviceFingerprint({ proxy });
            return {
                ok: true,
                hostedOnly: true,
                publishableKey,
                fingerprint: fp
            };
        }
        console.log(`⚡ [协议预热] 正在后台异步预热卡片 Stripe 令牌 (卡号: ...${cardLast4})...`);
        const cardPayload = {
            number: card.number || card.card_number,
            expiry: card.expiry || card.card_expiry,
            cvc: card.cvc || card.card_cvc,
            holder: billing?.name
        };
        const pmResult = await createStripePaymentMethod(cardPayload, billing, { proxy, publishableKey });
        if (!pmResult.ok) {
            const msg = pmResult.data?.error?.message || `HTTP ${pmResult.status}`;
            console.warn(`[-] [协议预热] 卡片预热 pm_ 未通过: ${msg}`);
            return { ok: false, error: msg, data: pmResult.data, status: pmResult.status };
        }
        const ctokenResult = await createStripeConfirmationToken(pmResult.pmId, {
            proxy,
            publishableKey,
            fingerprint: pmResult.fingerprint
        });
        if (!ctokenResult.ok || !ctokenResult.ctoken) {
            const msg = ctokenResult.data?.error?.message || 'ctoken failed';
            console.warn(`[-] [协议预热] 卡片预热 ctoken_ 未通过: ${msg}`);
            return { ok: false, error: msg, data: ctokenResult.data, status: ctokenResult.status };
        }
        console.log(`⚡ [协议预热] ✅ 后台预热就绪: pm=${pmResult.pmId}, ctoken=${getProtocolTokenLabel(ctokenResult.ctoken)}`);
        return {
            ok: true,
            pmId: pmResult.pmId,
            ctoken: ctokenResult.ctoken,
            publishableKey,
            fingerprint: pmResult.fingerprint
        };
    } catch (err) {
        console.warn(`⚠️ [协议预热] 预热执行异常 (非阻塞): ${err.message}`);
        return { ok: false, error: err.message };
    }
}

/**
 * 执行 Stripe Hosted Checkout (如 ChatGPT Team 档位 / cs_live_ 会话) 纯协议直充
 *
 * 架构优势：
 * - 0ms Sentinel PoW 依赖：Hosted Checkout 直接通过 Stripe payment_pages 处理，无需任何 OpenAI 客户端 PoW
 * - 耗时从收银台 UI 渲染的 ~40s 压缩到 ~5-7s
 * - 原生支持 Stripe 设备指纹 (m.stripe.com/6) 与税区 address 同步
 *
 * 链路：
 * 1. payment_pages/{cs}/init -> 获取 config_id, eid, total due, currency
 * 2. payment_pages/{cs} (tax_region) -> 同步免税账单国家与省份，刷新最新 config_id 与应付金额
 * 3. payment_methods -> 生成带 hosted attribution 的 pm_ 标识
 * 4. payment_pages/{cs}/confirm -> 提交托管扣款
 * 5. (可选) payment_pages/{cs}/poll -> 确认最终支付状态
 */
async function executeStripeHostedProtocolPayment({
    page,
    card,
    billing = {},
    sessionId,
    publishableKey = DEFAULT_OPENAI_PK,
    currency = 'USD',
    proxy = '',
    onPaymentAttemptStarted,
    attemptId = createProtocolAttemptId(),
    pollIntervalMs = 1200,
    maxPollAttempts = 5
}) {
    const cardLast4 = String(card.number || card.cardNumber || card.card_number || '').slice(-4);
    console.log(`⚡ [协议支付/Hosted] 开始 Stripe Hosted Checkout 纯协议支付 (attempt=${attemptId}, session=${sessionId}, 卡号: ...${cardLast4})...`);

    if (typeof onPaymentAttemptStarted === 'function') {
        await onPaymentAttemptStarted();
    }

    const stripeHeaders = buildStripeBrowserHeaders('https://pay.openai.com');

    const country = String(billing.country || 'US').toUpperCase();
    const browserLocale = country === 'PH' ? 'en-PH' : (country === 'EG' ? 'ar-EG' : 'en-US');
    const browserTimezone = country === 'PH' ? 'Asia/Manila' : (country === 'EG' ? 'Africa/Cairo' : 'America/New_York');

    // 1. 初始化结账: payment_pages/{cs_id}/init
    console.log(`⚡ [协议支付/Hosted] 1/4 正在初始化 Hosted 收银台 (init)...`);
    let initData = {};
    let configId = '';
    let eid = 'NA';
    let dueAmount = 0;
    let hostedCurrency = currency;
    let customerEmail = billing.email || '';

    try {
        const initBody = {
            key: publishableKey,
            eid: 'NA',
            browser_locale: browserLocale,
            browser_timezone: browserTimezone,
            redirect_type: 'url'
        };
        const initRes = await postStripeFormChromeTls(
            `https://api.stripe.com/v1/payment_pages/${sessionId}/init`,
            initBody,
            stripeHeaders,
            proxy,
            3
        );

        initData = initRes.data || {};
        if (!isExplicitStripeDecline(initData, initRes.status) && (!isSuccessfulHttp(initRes) || !initData || initData.error)) {
            return paymentResultUnknown({
                attemptId,
                sessionId,
                submitted: false,
                error: `Hosted Init 未确认成功 (HTTP ${initRes.status || 'unknown'})`
            });
        }
        configId = String(initData.config_id || '');
        eid = String(initData.eid || 'NA');
        hostedCurrency = String(initData.currency || currency).toUpperCase();
        if (initData.customer_email && !customerEmail) {
            customerEmail = initData.customer_email;
        }

        const rawDue = (initData.total_summary || {}).due ?? (initData.total_summary || {}).total;
        if (rawDue != null && !isNaN(rawDue)) {
            dueAmount = Number(rawDue);
        }
        if (!configId || !eid || !dueAmount || hostedCurrency !== String(currency || hostedCurrency).toUpperCase()) {
            return paymentResultUnknown({
                attemptId,
                sessionId,
                submitted: false,
                error: `Hosted Init 返回字段不完整或币种不一致 (currency=${hostedCurrency}, due=${dueAmount})`
            });
        }
        console.log(`⚡ [协议支付/Hosted] ✅ Init 成功: currency=${hostedCurrency}, due=${dueAmount}, configId=${configId.slice(0, 12)}...`);
    } catch (initErr) {
        console.warn(`[-] [协议支付/Hosted] Init 异常: ${initErr.message}`);
        return paymentResultUnknown({ attemptId, sessionId, submitted: false, error: `Hosted Init 失败: ${initErr.message}` });
    }

    // 2. 提交税区与地址: payment_pages/{cs_id}
    if (billing && (billing.country || billing.line1)) {
        console.log(`⚡ [协议支付/Hosted] 2/4 正在提交账单与免税地址...`);
        try {
            const addressPayload = {
                key: publishableKey,
                eid: eid,
                'tax_region[country]': billing.country || 'US',
                'tax_id_collection[purchasing_as_business]': 'false'
            };
            for (const name of ['state', 'postal_code', 'line1', 'city']) {
                const val = String(billing[name] || (name === 'postal_code' ? billing.zip : '') || '').trim();
                if (val) addressPayload[`tax_region[${name}]`] = val;
            }

            const taxRes = await postStripeFormChromeTls(
                `https://api.stripe.com/v1/payment_pages/${sessionId}`,
                addressPayload,
                stripeHeaders,
                proxy,
                2
            );

            if (!isSuccessfulHttp(taxRes) || taxRes.data?.error) {
                return paymentResultUnknown({
                    attemptId,
                    sessionId,
                    submitted: false,
                    error: `Hosted 税区同步未确认成功 (HTTP ${taxRes.status || 'unknown'})`
                });
            }

            const taxData = taxRes.data || {};
            if (taxData.config_id) {
                configId = String(taxData.config_id);
            }
            const updatedDue = (taxData.total_summary || {}).due ?? (taxData.total_summary || {}).total;
            if (updatedDue != null && !isNaN(updatedDue)) {
                dueAmount = Number(updatedDue);
            }
            if (!dueAmount || !configId) {
                return paymentResultUnknown({
                    attemptId,
                    sessionId,
                    submitted: false,
                    error: 'Hosted 税区同步后未返回有效应付金额或 config_id'
                });
            }
            console.log(`⚡ [协议支付/Hosted] ✅ 税区与地址同步完成 (due=${dueAmount}, configId=${configId.slice(0, 12)}...)`);
        } catch (taxErr) {
            return paymentResultUnknown({ attemptId, sessionId, submitted: false, error: `Hosted 税区同步失败: ${taxErr.message}` });
        }
    }

    // 3. 注册指纹与创建 PaymentMethod (pm_)
    console.log(`⚡ [协议支付/Hosted] 3/4 正在生成 PaymentMethod (带 hosted_checkout 来源属性)...`);
    let fp = null;
    try {
        fp = await registerStripeDeviceFingerprint({ proxy });
    } catch (fingerprintErr) {
        return paymentResultUnknown({
            attemptId,
            sessionId,
            submitted: false,
            error: `Hosted 设备指纹未确认，未创建 PaymentMethod: ${fingerprintErr.message}`,
            code: fingerprintErr.code || 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE'
        });
    }
    if (
        fp?.source !== 'stripe_registered'
        || !String(fp.guid || '').trim()
        || !String(fp.muid || '').trim()
        || !String(fp.sid || '').trim()
    ) {
        return paymentResultUnknown({
            attemptId,
            sessionId,
            submitted: false,
            error: 'Hosted 设备指纹未由官方端点确认，未创建 PaymentMethod',
            code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE'
        });
    }
    const { month, year } = normalizeExpiry(card);

    const clientSessionId = fp.clientSessionId || crypto.randomUUID();
    const billingName = billing.name || 'Cardholder';
    const pmBody = {
        'type': 'card',
        'card[number]': String(card.number || card.cardNumber || card.card_number || '').replace(/\s+/g, ''),
        'card[exp_month]': month,
        'card[exp_year]': year,
        'card[cvc]': String(card.cvc || '').trim(),
        'billing_details[name]': billingName,
        'billing_details[email]': customerEmail || billing.email || 'customer@example.com',
        'billing_details[address][country]': billing.country || 'US',
        'billing_details[address][line1]': billing.line1 || '100 W 10th Ave',
        'billing_details[address][city]': billing.city || 'Eugene',
        'billing_details[address][state]': billing.state || 'Oregon',
        'billing_details[address][postal_code]': billing.postal_code || billing.zip || '97401',
        'payment_user_agent': `stripe.js/${RUNTIME_HASH}; stripe-js-v3/${RUNTIME_HASH}; checkout`,
        'time_on_page': String(Math.floor(18000 + Math.random() * 24000)),
        'pasted_fields': 'number',
        'client_attribution_metadata[client_session_id]': clientSessionId,
        'client_attribution_metadata[checkout_session_id]': sessionId,
        'client_attribution_metadata[merchant_integration_source]': 'checkout',
        'client_attribution_metadata[merchant_integration_version]': 'hosted_checkout',
        'client_attribution_metadata[payment_method_selection_flow]': 'merchant_specified',
        'guid': fp.guid,
        'muid': fp.muid,
        'sid': fp.sid,
        'key': publishableKey,
        '_stripe_version': V_HOSTED
    };
    if (configId) {
        pmBody['client_attribution_metadata[checkout_config_id]'] = configId;
    }

    let pmId = '';
    try {
        const pmRes = await postStripeFormChromeTls(
            'https://api.stripe.com/v1/payment_methods',
            pmBody,
            stripeHeaders,
            proxy,
            3
        );

        if (pmRes.status !== 200 || !pmRes.data?.id) {
            const err = pmRes.data?.error || {};
            const errMsg = err.message || `PaymentMethod 创建失败 (HTTP ${pmRes.status})`;
            console.warn(`[-] [协议支付/Hosted] 卡片令牌化未通过: ${errMsg}`);
            if (isExplicitStripeDecline(pmRes.data, pmRes.status)) {
                return {
                    success: false,
                    declined: true,
                    canRetryCard: true,
                    error: errMsg,
                    code: err.code || 'card_declined',
                    decline_code: err.decline_code || '',
                    submitted: false,
                    submissionAttempted: true,
                    protocolDirect: true,
                    attemptId,
                    sessionId,
                    paymentMethodId: null
                };
            }
            return paymentResultUnknown({ attemptId, sessionId, submitted: false, error: errMsg });
        }
        pmId = pmRes.data.id;
        console.log(`⚡ [协议支付/Hosted] ✅ PaymentMethod 创建成功: ${pmId} (attempt=${attemptId})`);
    } catch (pmErr) {
        console.warn(`[-] [协议支付/Hosted] 卡片创建网络异常: ${pmErr.message}`);
        return paymentResultUnknown({ attemptId, sessionId, submitted: false, error: `卡片网络提交异常: ${pmErr.message}` });
    }

    // 4. 提交 Confirm 确认支付
    console.log(`⚡ [协议支付/Hosted] 4/4 正在提交最终 Confirm 扣款确认 (expected_amount=${dueAmount})...`);
    const confirmBody = {
        'key': publishableKey,
        '_stripe_version': V_HOSTED,
        'eid': eid,
        'payment_method': pmId,
        'expected_amount': String(dueAmount),
        'consent[terms_of_service]': 'accepted',
        'expected_payment_method_type': 'card',
        'guid': fp.guid,
        'muid': fp.muid,
        'sid': fp.sid,
        'client_attribution_metadata[client_session_id]': clientSessionId,
        'client_attribution_metadata[checkout_session_id]': sessionId,
        'client_attribution_metadata[merchant_integration_source]': 'checkout',
        'client_attribution_metadata[merchant_integration_version]': 'hosted_checkout',
        'client_attribution_metadata[payment_method_selection_flow]': 'merchant_specified',
        'link_brand': 'link',
        'passive_captcha_ekey': ''
    };
    if (configId) {
        confirmBody['client_attribution_metadata[checkout_config_id]'] = configId;
    }

    let confirmRes;
    try {
        confirmRes = await postStripeFormChromeTls(
            `https://api.stripe.com/v1/payment_pages/${sessionId}/confirm`,
            confirmBody,
            stripeHeaders,
            proxy,
            2
        );
    } catch (confirmNetErr) {
        console.warn(`[-] [协议支付/Hosted] Confirm 网络异常: ${confirmNetErr.message}`);
        return paymentResultUnknown({
            attemptId,
            sessionId,
            submitted: true,
            paymentMethodId: pmId,
            error: `Hosted Confirm 请求中断: ${confirmNetErr.message}`
        });
    }

    const confirmData = typeof confirmRes.data === 'object' && confirmRes.data !== null ? confirmRes.data : {};
    const confirmStatus = confirmRes.status;

    // 检查拒卡与参数错误
    if (confirmStatus >= 400 || confirmData.error) {
        const err = confirmData.error || {};
        const extra = err.extra_fields || {};
        const declineCode = err.decline_code || extra.confirm_error_reason || '';
        const errMsg = err.message || `Stripe 拒付 (HTTP ${confirmStatus})`;
        console.warn(`[-] [协议支付/Hosted] 上游扣款未通过: ${errMsg} (code=${err.code}, decline=${declineCode})`);
        if (isExplicitStripeDecline(confirmData, confirmStatus)) {
            return {
                success: false,
                declined: true,
                canRetryCard: true,
                error: errMsg,
                code: err.code || 'card_declined',
                decline_code: declineCode,
                submitted: true,
                submissionAttempted: true,
                protocolDirect: true,
                attemptId,
                sessionId,
                paymentMethodId: pmId,
                paymentIntentId: confirmData.payment_intent_id || confirmData.payment_intent?.id || null,
                amount: dueAmount / 100,
                currency: hostedCurrency
            };
        }
        return paymentResultUnknown({
            attemptId,
            sessionId,
            submitted: true,
            paymentMethodId: pmId,
            paymentIntentId: confirmData.payment_intent_id || confirmData.payment_intent?.id || '',
            error: errMsg
        });
    }

    // 检查是否触发 3DS 或 hCaptcha challenge
    const pi = confirmData.payment_intent || {};
    const explicitPmId = String(confirmData.payment_method_id || confirmData.payment_method || pi.payment_method || '').trim();
    if (explicitPmId && explicitPmId !== pmId) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken: '',
            intentId: pi.id || '',
            reason: `Hosted Confirm 返回 payment_method=${explicitPmId}`
        });
    }
    const nextAction = confirmData.next_action || pi.next_action || {};
    if (pi.status === 'requires_action' || nextAction.type) {
        console.log(`⚠️ [协议支付/Hosted] 触发了 3DS 或安全验证挑战 (${nextAction.type || 'requires_action'})，协议模式停止并转人工复核`);
        return {
            success: false,
            declined: false,
            requiresAction: true,
            reason: '3ds_required',
            code: 'PAYMENT_REQUIRES_ACTION',
            error: '银行卡需要 3DS 或安全验证，纯协议模式无法继续',
            manualIntervention: true,
            submitted: true,
            submissionAttempted: true,
            protocolDirect: true,
            attemptId,
            sessionId,
            paymentMethodId: pmId,
            paymentIntentId: pi.id || null
        };
    }

    // 5. Poll 检查支付终态
    console.log(`⚡ [协议支付/Hosted] 5/5 正在确认最终支付状态 (poll)...`);
    let finalState = String(confirmData.state || pi.status || '').toLowerCase();
    if (finalState === 'succeeded' || confirmData.payment_status === 'paid') {
        console.log(`⚡ [协议支付/Hosted] 🏆 恭喜！Stripe Hosted 直充扣款成功，团队订阅正式开通！`);
        return {
            success: true,
            status: 'succeeded',
            paymentState: 'paid',
            submitted: true,
            submissionAttempted: true,
            protocolDirect: true,
            attemptId,
            sessionId,
            paymentMethodId: pmId,
            paymentIntentId: pi.id || null,
            amount: dueAmount / 100,
            currency: hostedCurrency
        };
    }

    // 轮询 poll (最多 5 次)
    let lastPollError = '';
    let latestPollPaymentIntentId = pi.id || '';
    for (let i = 1; i <= maxPollAttempts; i++) {
        if (pollIntervalMs > 0) await new Promise(r => setTimeout(r, pollIntervalMs));
        try {
            const pollRes = await executeWithProxyRetry(async (client) => {
                return await client.get(`https://api.stripe.com/v1/payment_pages/${sessionId}/poll`, {
                    params: { key: publishableKey },
                    headers: stripeHeaders
                });
            }, { proxy, maxRetries: 2 });

            if (!isSuccessfulHttp(pollRes)) {
                lastPollError = `Hosted poll HTTP ${pollRes.status || 'unknown'}`;
                continue;
            }
            const pollData = pollRes.data || {};
            latestPollPaymentIntentId = String(
                pollData.payment_intent_id
                || pollData.payment_intent?.id
                || latestPollPaymentIntentId
                || ''
            ).trim();
            finalState = String(pollData.state || pollData.payment_object_status || '').toLowerCase();
            console.log(`⚡ [协议支付/Hosted] Poll [${i}/5] state=${finalState}`);

            if (finalState === 'succeeded') {
                console.log(`⚡ [协议支付/Hosted] 🏆 恭喜！Stripe Hosted 订阅状态已确认为 succeeded！`);
                return {
                    success: true,
                    status: 'succeeded',
                    paymentState: 'paid',
                    submitted: true,
                    submissionAttempted: true,
                    protocolDirect: true,
                    attemptId,
                    sessionId,
                    paymentMethodId: pmId,
                    paymentIntentId: latestPollPaymentIntentId || null,
                    amount: dueAmount / 100,
                    currency: hostedCurrency
                };
            }
            if (finalState === 'failed' && isExplicitStripeDecline(pollData, pollRes.status)) {
                return {
                    success: false,
                    declined: true,
                    canRetryCard: true,
                    error: `Stripe Hosted 会话终态失败: ${finalState}`,
                    submitted: true,
                    submissionAttempted: true,
                    protocolDirect: true,
                    attemptId,
                    sessionId,
                    paymentMethodId: pmId,
                    paymentIntentId: latestPollPaymentIntentId || null
                };
            }
            if (['expired', 'canceled', 'cancelled'].includes(finalState)) {
                return paymentResultUnknown({
                    attemptId,
                    sessionId,
                    submitted: true,
                    paymentMethodId: pmId,
                    paymentIntentId: latestPollPaymentIntentId,
                    error: `Stripe Hosted 会话终态为 ${finalState}，未确认是明确拒卡`
                });
            }
        } catch (pollErr) {
            lastPollError = pollErr.message;
        }
    }

    return paymentResultUnknown({
        attemptId,
        sessionId,
        submitted: true,
        paymentMethodId: pmId,
        paymentIntentId: latestPollPaymentIntentId,
        error: `Stripe Hosted 状态暂未确认为 succeeded (当前: ${finalState || 'unknown'}${lastPollError ? `, ${lastPollError}` : ''})`
    });
}

async function executeStripeProtocolPayment({
    page,
    card,
    billing = {},
    sessionId,
    accessToken,
    currency = 'PHP',
    planType = '',
    proxy = '',
    publishableKey = DEFAULT_OPENAI_PK,
    onPaymentAttemptStarted,
    prewarmedTokens = null,
    cookieHeader = '',
    deviceId = '',
    userAgent = '',
    region = '',
    protocolOnly = true,
    attemptId = createProtocolAttemptId()
}) {
    // Compatibility-only argument. Tokens from another attempt must never be reused.
    void prewarmedTokens;

    if (sessionId && (sessionId.startsWith('cs_live_') || sessionId.startsWith('cs_test_'))) {
        console.log(`⚡ [协议支付] 检测到 Stripe Hosted Checkout 会话 (${sessionId.slice(0, 16)}...)，启用 Hosted 纯协议直充流水线`);
        return await executeStripeHostedProtocolPayment({
            page: protocolOnly ? null : page,
            card,
            billing,
            sessionId,
            publishableKey,
            currency,
            proxy,
            onPaymentAttemptStarted,
            attemptId,
            protocolOnly
        });
    }

    const cardLast4 = String(card.number || card.card_number || '').slice(-4);
    const checkoutUrl = `https://chatgpt.com/checkout/openai_llc/${sessionId}`;
    const resolvedRegion = String(region || ({ PHP: 'PH', EGP: 'EG', CLP: 'CL', SGD: 'SG', MYR: 'MY', USD: 'US' }[String(currency || '').toUpperCase()] || 'PH')).toUpperCase();
    const protocolProfile = getChatGptProtocolProfile(resolvedRegion, { userAgent });
    const baseHeaders = buildChatGptBrowserHeaders(protocolProfile, {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://chatgpt.com',
        'Referer': checkoutUrl,
        'x-openai-session-id': sessionId,
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        ...(deviceId ? { 'oai-device-id': deviceId } : {})
    });
    const protocolPage = protocolOnly ? null : page;
    const confirmationTokenHash = (ctoken) => hashProtocolValue(ctoken);

    const unknown = (error, submitted = true, extra = {}) => ({
        ...paymentResultUnknown({ attemptId, sessionId, error, submitted, ...extra }),
        paymentMethodId: extra.paymentMethodId || null,
        confirmationTokenHash: extra.confirmationTokenHash || null
    });

    const explicitDecline = ({ data = {}, status = 0, error = '', paymentMethodId = '', intentId = '', amount = null, currencyCode = '', confirmationTokenHash = '' }) => {
        const declineError = data?.error || data?.last_payment_error || data?.payment_intent?.last_payment_error || {};
        const code = declineError.code || data?.code || 'card_declined';
        const declineCode = declineError.decline_code || data?.decline_code || '';
        const rawMessage = error || declineError.message || `Stripe 拒卡 (HTTP ${status || 'unknown'})`;
        const formatted = formatStripeDeclineReason({ code, declineCode, rawMessage });
        const message = formatted.formatted;
        console.warn(`⚡ [协议支付] ❌ 银行卡明确被拒: ${message} (attempt=${attemptId}, code=${code}, decline_code=${declineCode})`);
        return {
            success: false,
            declined: true,
            canRetryCard: true,
            error: message,
            code: formatted.code || code,
            decline_code: formatted.declineCode || declineCode,
            submitted: true,
            submissionAttempted: true,
            protocolDirect: true,
            attemptId,
            sessionId,
            paymentMethodId: paymentMethodId || null,
            paymentIntentId: intentId || null,
            confirmationTokenHash: confirmationTokenHash || null,
            amount,
            currency: currencyCode || undefined
        };
    };

    const requiresAction = ({ intentId = '', paymentMethodId = '', reason = '3ds_required', confirmationTokenHash = '' } = {}) => ({
        success: false,
        declined: false,
        requiresAction: true,
        reason,
        code: 'PAYMENT_REQUIRES_ACTION',
        error: '银行卡需要 3DS 或安全验证，纯协议模式停止并转人工复核',
        manualIntervention: true,
        submitted: true,
        submissionAttempted: true,
        protocolDirect: true,
        attemptId,
        sessionId,
        paymentMethodId: paymentMethodId || null,
        paymentIntentId: intentId || null,
        confirmationTokenHash: confirmationTokenHash || null
    });

    const success = ({ status = 'succeeded', intentId = '', paymentMethodId = '', amount = null, currencyCode = '', ctoken = '' } = {}) => ({
        success: true,
        status,
        paymentState: 'paid',
        submitted: true,
        submissionAttempted: true,
        protocolDirect: true,
        attemptId,
        sessionId,
        paymentMethodId: paymentMethodId || null,
        paymentIntentId: intentId || null,
        confirmationTokenHash: ctoken ? confirmationTokenHash(ctoken) : null,
        ...(amount != null ? { amount } : {}),
        ...(currencyCode ? { currency: currencyCode } : {})
    });

    console.log(`⚡ [协议支付] 开始 Stripe 纯协议直充 (attempt=${attemptId}, session=${sessionId}, 卡号: ...${cardLast4})...`);

    if (typeof onPaymentAttemptStarted === 'function') {
        await onPaymentAttemptStarted();
    }

    // 1. 税区必须先成功；失败时不得创建 PM、ctoken 或调用 confirm。
    console.log('⚡ [协议支付] 1/6 正在串行同步 Checkout 税区与账单地址...');
    let taxSyncResult;
    try {
        taxSyncResult = await syncCheckoutBillingTax({
            page: protocolPage,
            sessionId,
            billing,
            currency,
            planType,
            targetHeaders: baseHeaders,
            proxy,
            protocolOnly
        });
    } catch (taxErr) {
        return unknown(`Checkout 税区同步异常: ${taxErr.message}`, false, { code: 'CHECKOUT_TAX_SYNC_NETWORK_ERROR' });
    }
    if (!taxSyncResult?.ok) {
        return unknown(
            taxSyncResult?.error || 'Checkout 税区同步未确认成功',
            false,
            { code: taxSyncResult?.code || 'CHECKOUT_TAX_SYNC_FAILED' }
        );
    }

    // 2. 税区完成后再签发本 attempt 的结算风控令牌。
    let sentinelTokens = {};
    try {
        sentinelTokens = await mintSentinelToken({
            flow: 'checkout_session_approval',
            pageUrl: checkoutUrl,
            deviceId: deviceId || undefined,
            cookieHeader: cookieHeader || '',
            userAgent: protocolProfile.userAgent,
            region: resolvedRegion,
            language: protocolProfile.language,
            acceptLanguage: protocolProfile.acceptLanguage,
            timezone: protocolProfile.timezone,
            platform: protocolProfile.platform,
            platformLabel: protocolProfile.platformLabel,
            secChUa: protocolProfile.secChUa,
            secChUaPlatform: protocolProfile.secChUaPlatform,
            proxy: proxy || '',
            timeoutMs: 15000
        }) || {};
        console.log('⚡ [协议支付] ✅ Checkout 结算风控令牌已就绪');
    } catch (sentinelErr) {
        // Sentinel 是结算安全凭证；不把失败伪装成银行拒卡，也不继续提交银行卡确认。
        return unknown(`Checkout 结算风控令牌未能签发: ${sentinelErr.message}`, false, {
            code: 'CHECKOUT_SENTINEL_UNAVAILABLE'
        });
    }

    const targetHeaders = {
        ...baseHeaders,
        'x-openai-target-path': '/backend-api/payments/checkout/confirm',
        'x-openai-target-route': '/backend-api/payments/checkout/confirm',
        ...(sentinelTokens.sentinelToken ? { 'openai-sentinel-token': sentinelTokens.sentinelToken } : {}),
        ...(sentinelTokens.sentinelSoToken ? { 'openai-sentinel-so-token': sentinelTokens.sentinelSoToken } : {})
    };

    // 3. 当前 attempt 创建 PM，禁止消费前置或其他 attempt 的令牌。
    console.log('⚡ [协议支付] 2/6 正在向 Stripe 创建当前 attempt 的 PaymentMethod...');
    let pmResult;
    try {
        pmResult = await createStripePaymentMethod(card, billing, { proxy, publishableKey });
    } catch (pmErr) {
        return unknown(`PaymentMethod 网络异常: ${pmErr.message}`, false, { code: 'PAYMENT_METHOD_NETWORK_ERROR' });
    }
    const pmData = pmResult?.data || {};
    const pmId = String(pmResult?.pmId || pmData.id || '').trim();
    const echoedPmId = String(pmData.payment_method_id || pmData.payment_method || '').trim();
    if (echoedPmId && pmId && echoedPmId !== pmId) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken: '',
            reason: `PaymentMethod 创建响应自身不一致: id=${pmId}, payment_method=${echoedPmId}`,
            submitted: false
        });
    }
    if (!pmResult?.ok || !pmId) {
        const err = pmData.error || {};
        const msg = err.message || `PaymentMethod 创建失败 (HTTP ${pmResult?.status || 'unknown'})`;
        if (isExplicitStripeDecline(pmData, pmResult?.status)) {
            return explicitDecline({ data: pmData, status: pmResult?.status, error: msg });
        }
        return unknown(msg, false, { code: 'PAYMENT_METHOD_UNCONFIRMED' });
    }
    console.log(`⚡ [协议支付] ✅ PaymentMethod 已创建: ${pmId} (attempt=${attemptId})`);

    // 4. 使用同一个 PM 创建本 attempt 的 ConfirmationToken，并校验回显关联。
    console.log('⚡ [协议支付] 3/6 正在创建当前 attempt 的 ConfirmationToken...');
    let ctokenResult;
    try {
        ctokenResult = await createStripeConfirmationToken(pmId, {
            proxy,
            publishableKey,
            fingerprint: pmResult.fingerprint
        });
    } catch (ctokenErr) {
        return unknown(`ConfirmationToken 网络异常: ${ctokenErr.message}`, false, {
            code: 'CONFIRMATION_TOKEN_NETWORK_ERROR',
            paymentMethodId: pmId
        });
    }
    const ctokenData = ctokenResult?.data || {};
    const ctoken = String(ctokenResult?.ctoken || ctokenData.id || '').trim();
    const ctokenPmId = String(
        ctokenData.payment_method_id
        || (typeof ctokenData.payment_method === 'string' ? ctokenData.payment_method : ctokenData.payment_method?.id)
        || ''
    ).trim();
    if (ctokenPmId && ctokenPmId !== pmId) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken,
            reason: `ConfirmationToken 返回 payment_method=${ctokenPmId}`,
            submitted: false
        });
    }
    if (!ctokenResult?.ok || !ctoken) {
        const err = ctokenData.error || {};
        const msg = err.message || `ConfirmationToken 创建失败 (HTTP ${ctokenResult?.status || 'unknown'})`;
        return unknown(msg, false, {
            code: 'CONFIRMATION_TOKEN_UNCONFIRMED',
            paymentMethodId: pmId,
            confirmationTokenHash: confirmationTokenHash(ctoken)
        });
    }
    console.log(`⚡ [协议支付] ✅ ConfirmationToken 已创建: ${getProtocolTokenLabel(ctoken)} (pm=${pmId})`);

    // 5. ChatGPT confirm 只使用当前 attempt 的 session、PM 与 ctoken。
    console.log('⚡ [协议支付] 4/6 正在向 ChatGPT 提交支付确认...');
    let confirmResult;
    try {
        confirmResult = await postConfirmRequest({
            page: protocolPage,
            sessionId,
            ctoken,
            targetHeaders,
            proxy,
            protocolOnly,
            saveChoice: null
        });
    } catch (confirmErr) {
        return unknown(`ChatGPT confirm 网络异常: ${confirmErr.message}`, true, {
            paymentMethodId: pmId,
            confirmationTokenHash: confirmationTokenHash(ctoken)
        });
    }
    if (confirmResult?.networkError) {
        return unknown(`ChatGPT confirm 网络异常: ${confirmResult.networkError}`, true, {
            paymentMethodId: pmId,
            confirmationTokenHash: confirmationTokenHash(ctoken)
        });
    }

    const needsSaveChoice = (res) => {
        if (!res || res.status !== 400) return false;
        const text = String(res.rawText || JSON.stringify(res.data || '')).toLowerCase();
        return text.includes('save_choice') || text.includes('save choice');
    };
    if (needsSaveChoice(confirmResult)) {
        for (const choice of [true, false]) {
            confirmResult = await postConfirmRequest({
                page: protocolPage,
                sessionId,
                ctoken,
                targetHeaders,
                proxy,
                protocolOnly,
                saveChoice: choice
            });
            if (confirmResult?.networkError || !needsSaveChoice(confirmResult)) break;
        }
    }

    const payload = confirmResult?.data && typeof confirmResult.data === 'object' ? confirmResult.data : {};
    const pi = payload.payment_intent && typeof payload.payment_intent === 'object' ? payload.payment_intent : {};
    const statusStr = String(payload.status || payload.result || '').toLowerCase();
    const piStatus = String(pi.status || '').toLowerCase();
    const responseSessionId = String(
        payload.checkout_session_id
        || payload.checkout_session?.id
        || payload.session_id
        || payload.payment_intent?.checkout_session_id
        || ''
    ).trim();
    const responsePmId = String(
        payload.payment_method_id
        || (typeof payload.payment_method === 'string' ? payload.payment_method : payload.payment_method?.id)
        || pi.payment_method
        || ''
    ).trim();
    const responseCtoken = String(
        payload.confirmation_token
        || payload.confirm_token
        || payload.payment_confirmation_token
        || ''
    ).trim();
    if (responseSessionId && responseSessionId !== sessionId) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken,
            intentId: pi.id || '',
            reason: `ChatGPT confirm 返回 checkout_session_id=${responseSessionId}`
        });
    }
    if (responsePmId && responsePmId !== pmId) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken,
            intentId: pi.id || '',
            reason: `ChatGPT confirm 返回 payment_method=${responsePmId}`
        });
    }
    if (responseCtoken && responseCtoken !== ctoken) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken,
            intentId: pi.id || '',
            reason: `ChatGPT confirm 返回了不同的 confirmation_token (${getProtocolTokenLabel(responseCtoken)})`
        });
    }

    const clientSecret = String(payload.client_secret || pi.client_secret || '').trim();
    const payloadIntentId = String(payload.payment_intent_id || '').trim();
    const piId = String(pi.id || '').trim();
    if (payloadIntentId && piId && payloadIntentId !== piId) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken,
            intentId: piId,
            reason: `ChatGPT confirm 返回两个不同的 payment_intent_id: ${payloadIntentId}/${piId}`
        });
    }
    if (payload.client_secret && pi.client_secret && payload.client_secret !== pi.client_secret) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken,
            intentId: piId,
            reason: 'ChatGPT confirm 返回两个不同的 client_secret'
        });
    }
    const intentFromSecret = getClientSecretIntentId(clientSecret);
    const intentId = piId || payloadIntentId || intentFromSecret;
    if (intentFromSecret && intentId && intentFromSecret !== intentId) {
        return protocolCorrelationMismatch({
            attemptId,
            sessionId,
            pmId,
            ctoken,
            intentId,
            reason: `client_secret 推导的 PaymentIntent=${intentFromSecret} 与响应=${intentId} 不一致`
        });
    }

    const confirmText = String(confirmResult?.rawText || '');
    if (confirmResult?.status === 403 && /just a moment|cloudflare|cf-mitigated|challenge/i.test(confirmText)) {
        return unknown('ChatGPT confirm 触发 Cloudflare 或挑战验证，纯协议停止并转人工复核', true, {
            code: 'PAYMENT_CHALLENGE',
            paymentMethodId: pmId,
            confirmationTokenHash: confirmationTokenHash(ctoken),
            paymentIntentId: intentId
        });
    }
    if (confirmResult?.networkError) {
        return unknown(`ChatGPT confirm 网络异常: ${confirmResult.networkError}`, true, {
            paymentMethodId: pmId,
            confirmationTokenHash: confirmationTokenHash(ctoken),
            paymentIntentId: intentId
        });
    }

    // ChatGPT 侧的错误只有在明确携带 Stripe 拒卡码时才允许换卡；普通 4xx/5xx 一律未知。
    if (confirmResult?.status >= 400 || payload.error) {
        const err = payload.error || payload.payment_intent?.last_payment_error || {};
        const msg = err.message || payload.message || payload.detail || `ChatGPT confirm 未通过 (HTTP ${confirmResult?.status || 'unknown'})`;
        if (isExplicitStripeDecline(payload, confirmResult?.status)) {
            return explicitDecline({
                data: payload,
                status: confirmResult?.status,
                error: msg,
                paymentMethodId: pmId,
                intentId,
                confirmationTokenHash: confirmationTokenHash(ctoken)
            });
        }
        return unknown(msg, true, {
            paymentMethodId: pmId,
            confirmationTokenHash: confirmationTokenHash(ctoken),
            paymentIntentId: intentId
        });
    }
    if (piStatus === 'requires_action' || payload.type === 'challenge' || payload.next_action?.type || pi.next_action?.type) {
        return requiresAction({
            intentId,
            paymentMethodId: pmId,
            reason: payload.type === 'challenge' ? 'challenge_required' : '3ds_required',
            confirmationTokenHash: confirmationTokenHash(ctoken)
        });
    }
    if (isExplicitStripeDecline(payload, confirmResult?.status)) {
        return explicitDecline({
            data: payload,
            status: confirmResult?.status,
            paymentMethodId: pmId,
            intentId,
            confirmationTokenHash: confirmationTokenHash(ctoken)
        });
    }

    const isTaxFree = (billing?.country === 'US' && /oregon|or\b/i.test(billing?.state || ''));
    const taxSyncedAmount = taxSyncResult?.amountTotal;
    const confirmStateTotal = payload?.checkout_session?.checkout_state?.total?.total?.minorUnitsAmount;
    const piRawAmount = pi.amount ?? payload.amount ?? confirmStateTotal ?? taxSyncedAmount;
    const piCurrency = String(pi.currency || payload.currency || currency || 'PHP').toUpperCase();
    const planHint = planType || taxSyncResult?.planName || payload?.checkout_session?.plan_name || '';
    const fallbackDisplayAmount = getDefaultPlanDisplayAmount(planHint, piCurrency, isTaxFree);
    const piDisplayAmount = (piRawAmount != null && !isNaN(piRawAmount)) ? (piRawAmount / 100) : fallbackDisplayAmount;

    const applyStripeState = (stripeData = {}, stripeStatus = 0) => {
        const stripePmId = String(
            stripeData.payment_method_id
            || (typeof stripeData.payment_method === 'string' ? stripeData.payment_method : stripeData.payment_method?.id)
            || ''
        ).trim();
        if (stripePmId && stripePmId !== pmId) {
            return protocolCorrelationMismatch({
                attemptId,
                sessionId,
                pmId,
                ctoken,
                intentId,
                reason: `Stripe PaymentIntent 返回 payment_method=${stripePmId}`
            });
        }
        const stripeState = String(stripeData.status || '').toLowerCase();
        const stripeAmountRaw = stripeData.amount ?? stripeData.error?.payment_intent?.amount ?? piRawAmount;
        const resolvedAmount = (stripeAmountRaw != null && !isNaN(stripeAmountRaw))
            ? (stripeAmountRaw / 100)
            : piDisplayAmount;
        if (stripeState === 'succeeded') {
            return success({
                status: 'succeeded',
                intentId: stripeData.id || intentId,
                paymentMethodId: pmId,
                amount: resolvedAmount,
                currencyCode: piCurrency,
                ctoken
            });
        }
        if (stripeState === 'requires_action' || stripeData.next_action?.type) {
            return requiresAction({
                intentId: stripeData.id || intentId,
                paymentMethodId: pmId,
                confirmationTokenHash: confirmationTokenHash(ctoken)
            });
        }
        if (isExplicitStripeDecline(stripeData, stripeStatus)) {
            const err = stripeData.error || stripeData.last_payment_error || {};
            return explicitDecline({
                data: stripeData,
                status: stripeStatus,
                error: err.message || `Stripe PaymentIntent 状态为 ${stripeState || stripeStatus}`,
                paymentMethodId: pmId,
                intentId: stripeData.id || intentId,
                amount: resolvedAmount,
                currencyCode: piCurrency,
                confirmationTokenHash: confirmationTokenHash(ctoken)
            });
        }
        return null;
    };

    // 6. ChatGPT 仅返回待确认的 PaymentIntent 时，才调用 Stripe 官方 confirm。
    if (intentId && clientSecret && piStatus !== 'succeeded') {
        console.log(`⚡ [协议支付] 5/6 正在向 Stripe 提交 PaymentIntent confirm (pi=${intentId}, attempt=${attemptId})...`);
        let stripeConfirm = null;
        let stripeConfirmError = null;
        try {
            stripeConfirm = await confirmStripePaymentIntent({
                intentId,
                clientSecret,
                pmId,
                ctoken,
                sessionId,
                publishableKey,
                proxy,
                amount: piDisplayAmount,
                currency: piCurrency,
                fingerprint: pmResult.fingerprint,
                page: protocolPage,
                protocolOnly
            });
        } catch (stripeErr) {
            stripeConfirmError = stripeErr;
        }

        if (stripeConfirmError || !stripeConfirm) {
            console.warn(`⚠️ [协议支付] Stripe confirm 结果不确定，先查询 PaymentIntent: ${stripeConfirmError?.message || 'no response'}`);
            try {
                const inspected = await retrieveStripePaymentIntent({
                    intentId,
                    clientSecret,
                    publishableKey,
                    proxy,
                    fingerprint: pmResult.fingerprint
                });
                const inspectedResult = applyStripeState(inspected.data || {}, inspected.status);
                if (inspectedResult) return inspectedResult;
                return unknown('Stripe confirm 网络中断后，PaymentIntent 状态仍未确认', true, {
                    paymentMethodId: pmId,
                    confirmationTokenHash: confirmationTokenHash(ctoken),
                    paymentIntentId: intentId
                });
            } catch (retrieveErr) {
                return unknown(`Stripe confirm 网络中断且 PaymentIntent 查询失败: ${retrieveErr.message}`, true, {
                    paymentMethodId: pmId,
                    confirmationTokenHash: confirmationTokenHash(ctoken),
                    paymentIntentId: intentId
                });
            }
        }

        const stripeResult = applyStripeState(stripeConfirm.data || {}, stripeConfirm.status);
        if (stripeResult) return stripeResult;
        if (!isSuccessfulHttp(stripeConfirm) || stripeConfirm.data?.error) {
            // HTTP 错误但没有明确拒卡码时，尝试查询真实状态，避免把网络/API 错误误判为拒卡。
            try {
                const inspected = await retrieveStripePaymentIntent({
                    intentId,
                    clientSecret,
                    publishableKey,
                    proxy,
                    fingerprint: pmResult.fingerprint
                });
                const inspectedResult = applyStripeState(inspected.data || {}, inspected.status);
                if (inspectedResult) return inspectedResult;
            } catch (_) {}
            return unknown(
                stripeConfirm.data?.error?.message || `Stripe confirm 状态未确认 (HTTP ${stripeConfirm.status || 'unknown'})`,
                true,
                {
                    paymentMethodId: pmId,
                    confirmationTokenHash: confirmationTokenHash(ctoken),
                    paymentIntentId: intentId
                }
            );
        }
        return unknown(`Stripe PaymentIntent 状态未确认 (${stripeConfirm.data?.status || 'unknown'})`, true, {
            paymentMethodId: pmId,
            confirmationTokenHash: confirmationTokenHash(ctoken),
            paymentIntentId: intentId
        });
    }

    if (piStatus === 'succeeded' || (confirmResult?.ok && statusStr === 'success')) {
        return success({
            status: piStatus || statusStr || 'succeeded',
            intentId,
            paymentMethodId: pmId,
            amount: piRawAmount != null && !isNaN(piRawAmount) ? piRawAmount / 100 : undefined,
            currencyCode: piCurrency,
            ctoken
        });
    }

    return unknown(`协议确认状态未完全确认 (${statusStr || piStatus || confirmResult?.status || 'unknown'})`, true, {
        paymentMethodId: pmId,
        confirmationTokenHash: confirmationTokenHash(ctoken),
        paymentIntentId: intentId
    });
}

module.exports = {
    createStripePaymentMethod,
    createStripeConfirmationToken,
    prewarmStripeConfirmationToken,
    executeStripeProtocolPayment,
    executeStripeHostedProtocolPayment,
    syncCheckoutBillingTax,
    getDefaultPlanDisplayAmount,
    executeWithProxyRetry,
    paymentResultUnknown,
    DEFAULT_OPENAI_PK
};
