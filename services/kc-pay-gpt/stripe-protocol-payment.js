'use strict';

const crypto = require('crypto');
const querystring = require('querystring');
const axios = require('axios');
const { mintSentinelToken } = require('./sentinel/sentinel-client');
const { substituteProxySession, resetActiveProxyTunnels } = require('./playwright-proxy');
const { registerStripeDeviceFingerprint } = require('./stripe-device-fingerprint');

const RUNTIME_HASH = '5412f474d5';
const V_HOSTED = '2020-08-27;custom_checkout_beta=v1';
const DEFAULT_OPENAI_PK = 'pk_live_51HOrSwC6h1nxGoI3lTAgRjYVrz4dU3fVOabyCcKR3pbEJguCVAlqCxdxCUvoRh1XWwRacViovU3kLKvpkjh7IqkW00iXQsjo3n';
const DEFAULT_STRIPE_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const DEFAULT_STRIPE_SEC_CH_UA = '"Not.A/Brand";v="99", "Chromium";v="136", "Google Chrome";v="136"';

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

    // 获取真实 Stripe 设备指纹（优先复用预热产物，否则通过 m.stripe.com/6 注册获取，网络异常自动降级本地 ID）
    let fp = options.fingerprint;
    if (!fp || !fp.guid || !fp.muid || !fp.sid) {
        fp = await registerStripeDeviceFingerprint({ proxy: options.proxy });
    }
    if (!fp.clientSessionId) {
        fp.clientSessionId = crypto.randomUUID();
    }
    if (fp?.source === 'stripe_registered') {
        console.log(`⚡ [协议支付] ✅ 已挂载 Stripe 真实设备指纹 (Radar 防风控增强: muid=${fp.muid.slice(0, 8)}..., sid=${fp.sid.slice(0, 8)}...)`);
    }

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
    page = null
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

    // 优先通过已有 Chromium 浏览器页面同源 fetch 提交扣款确认
    // 兼具 Chrome 原生 TLS 指纹 (JA3/JA4)、HTTP/2 帧特性、真实 User-Agent 与全套 Radar 探针
    if (page && typeof page.evaluate === 'function' && !page.isClosed()) {
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

/**
 * 根据套餐类型/名称、币种与免税州标志，推算默认展示/兜底金额（避免 Pro/Team 等套餐在未返回 minorUnitsAmount 时被错误兜底为 Plus 982.14 / $20）
 */
function getDefaultPlanDisplayAmount(planHint, currency = 'PHP', isOregon = true) {
    const plan = String(planHint || 'plus').trim().toLowerCase();
    const curr = String(currency || 'PHP').trim().toUpperCase();
    const teamMatch = plan.match(/^team_?(\d+)$/i);
    const seats = teamMatch ? Math.max(2, parseInt(teamMatch[1], 10) || 2) : 2;

    if (curr === 'PHP') {
        if (/pro_?500|pro_?max|chatgptpromax/i.test(plan)) return isOregon ? 29008.93 : 32490;
        if (/pro_?100|pro_?5x|chatgptprolite|^pro$/i.test(plan)) return isOregon ? 5794.64 : 6490;
        if (/pro_?200|pro_?20x|pro_?more|chatgptpro/i.test(plan)) return isOregon ? 8919.64 : 9990;
        if (/\bgo\b|chatgptgoplan/i.test(plan)) return isOregon ? 267.86 : 300;
        if (/team|chatgptteamplan/i.test(plan)) return seats * 1450;
        return isOregon ? 982.14 : 1100;
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

    // 优先通过 page.evaluate 发送同源 /taxes 与配套的 /update_tax_id
    if (page && typeof page.evaluate === 'function' && !page.isClosed()) {
        try {
            const pageRes = await page.evaluate(async ({ taxUrl, updateTaxIdUrl, headers, bodyObj, updateHeaders, updateBodyObj }) => {
                const res = await fetch(taxUrl, {
                    method: 'POST',
                    headers,
                    credentials: 'include',
                    body: JSON.stringify(bodyObj)
                });
                const bodyText = await res.text();
                let json = {};
                try { json = JSON.parse(bodyText); } catch (_) {}

                // 配套清空 tax_id，确保免税州地址与税号完全解耦，不产生税务冲突
                try {
                    await fetch(updateTaxIdUrl, {
                        method: 'POST',
                        headers: updateHeaders,
                        credentials: 'include',
                        body: JSON.stringify(updateBodyObj)
                    });
                } catch (_) {}

                return { status: res.status, ok: res.ok, data: json, rawText: bodyText };
            }, {
                taxUrl: 'https://chatgpt.com/backend-api/payments/checkout/taxes',
                updateTaxIdUrl: 'https://chatgpt.com/backend-api/payments/checkout/update_tax_id',
                headers: taxHeaders,
                bodyObj: taxBody,
                updateHeaders: updateTaxIdHeaders,
                updateBodyObj: updateTaxIdBody
            });
            if (pageRes && pageRes.ok) {
                const sess = pageRes.data?.checkout_session || pageRes.data || {};
                const checkoutStateTotal = sess.checkout_state?.total;
                const rawTotal = checkoutStateTotal?.total?.minorUnitsAmount
                    ?? sess.checkout_state?.lineItems?.[0]?.total?.minorUnitsAmount
                    ?? sess.amount_total
                    ?? pageRes.data?.snapshot?.amount_total
                    ?? pageRes.data?.amount_total
                    ?? pageRes.data?.total;
                const taxAmount = checkoutStateTotal?.taxExclusive?.minorUnitsAmount
                    ?? checkoutStateTotal?.taxInclusive?.minorUnitsAmount
                    ?? sess.total_details?.amount_tax
                    ?? pageRes.data?.amount_tax
                    ?? 0;
                const isOregon = (billing?.country === 'US' && /oregon|or\b/i.test(billing?.state || ''));
                const fallbackAmount = getDefaultPlanDisplayAmount(planType || sess.plan_name, taxBody.currency, isOregon);
                const displayTotal = (rawTotal != null && !isNaN(rawTotal)) ? (rawTotal / 100) : fallbackAmount;
                console.log(`⚡ [协议支付] ✅ 免税地址同步成功！总金额: ${taxBody.currency} ${displayTotal} (税额: ${taxAmount})`);
                return { ok: true, data: pageRes.data, amountTotal: rawTotal, taxAmount, planName: sess.plan_name || '' };
            }
        } catch (evalErr) {
            console.warn(`⚠️ [协议支付] 页面同源 /taxes 调用异常: ${evalErr.message}，尝试切入 Node 客户端...`);
        }
    }

    // 0 浏览器模式或页面同源异常：优先使用 Chrome BoringSSL TLS 指纹 (impit) 直连，完美绕过 Cloudflare JA3/JA4 403 盾
    try {
        const nodeRes = await postChatGptChromeTls('https://chatgpt.com/backend-api/payments/checkout/taxes', taxBody, taxHeaders, proxy, 2);

        const data = typeof nodeRes.data === 'object' && nodeRes.data !== null ? nodeRes.data : {};
        if (nodeRes.status === 200) {
            const sess = data.checkout_session || data || {};
            // 仅当上游会话仍残留非空 taxIdInfo 时才补发 /update_tax_id 清空，避免无意义阻塞
            if (sess.checkout_state?.taxIdInfo) {
                await postChatGptChromeTls('https://chatgpt.com/backend-api/payments/checkout/update_tax_id', updateTaxIdBody, updateTaxIdHeaders, proxy, 1).catch(() => {});
            }
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
            console.log(`⚡ [协议支付] ✅ 免税地址同步成功！总金额: ${taxBody.currency} ${displayTotal} (税额: ${taxAmount})`);
            return { ok: true, data, amountTotal: rawTotal, taxAmount, planName: sess.plan_name || '' };
        } else {
            console.warn(`⚠️ [协议支付] /taxes 上游返回 HTTP ${nodeRes.status}，继续推进确认`);
        }
    } catch (nodeErr) {
        console.warn(`⚠️ [协议支付] /taxes 网络请求异常: ${nodeErr.message}，继续推进确认`);
    }

    return { ok: false };
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
            holder: card.holder || card.card_holder
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
        console.log(`⚡ [协议预热] ✅ 后台预热就绪: pm=${pmResult.pmId.slice(0, 14)}..., ctoken=${ctokenResult.ctoken.slice(0, 14)}...`);
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
    prewarmedTokens = null
}) {
    const cardLast4 = String(card.number || card.cardNumber || card.card_number || '').slice(-4);
    console.log(`⚡ [协议支付/Hosted] 开始 Stripe Hosted Checkout 纯协议支付 (会话: ${sessionId.slice(0, 16)}..., 卡号: ...${cardLast4})...`);

    if (typeof onPaymentAttemptStarted === 'function') {
        try {
            await onPaymentAttemptStarted();
        } catch (_) {}
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
        console.log(`⚡ [协议支付/Hosted] ✅ Init 成功: currency=${hostedCurrency}, due=${dueAmount}, configId=${configId.slice(0, 12)}...`);
    } catch (initErr) {
        console.warn(`[-] [协议支付/Hosted] Init 异常: ${initErr.message}`);
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `Hosted Init 失败: ${initErr.message}`,
            protocolDirect: true
        };
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

            const taxData = taxRes.data || {};
            if (taxData.config_id) {
                configId = String(taxData.config_id);
            }
            const updatedDue = (taxData.total_summary || {}).due ?? (taxData.total_summary || {}).total;
            if (updatedDue != null && !isNaN(updatedDue)) {
                dueAmount = Number(updatedDue);
            }
            console.log(`⚡ [协议支付/Hosted] ✅ 税区与地址同步完成 (due=${dueAmount}, configId=${configId.slice(0, 12)}...)`);
        } catch (taxErr) {
            console.warn(`⚠️ [协议支付/Hosted] 提交税区非阻塞告警: ${taxErr.message}`);
        }
    }

    // 3. 注册指纹与创建 PaymentMethod (pm_)
    console.log(`⚡ [协议支付/Hosted] 3/4 正在生成 PaymentMethod (带 hosted_checkout 来源属性)...`);
    let fp = null;
    if (prewarmedTokens) {
        try {
            const pre = await prewarmedTokens;
            if (pre?.fingerprint?.guid && pre?.fingerprint?.muid && pre?.fingerprint?.sid) {
                fp = pre.fingerprint;
            }
        } catch (_) {}
    }
    if (!fp) {
        fp = await registerStripeDeviceFingerprint({ proxy });
    }
    const { month, year } = normalizeExpiry(card);

    const clientSessionId = fp.clientSessionId || crypto.randomUUID();
    const pmBody = {
        'type': 'card',
        'card[number]': String(card.number || card.cardNumber || card.card_number || '').replace(/\s+/g, ''),
        'card[exp_month]': month,
        'card[exp_year]': year,
        'card[cvc]': String(card.cvc || '').trim(),
        'billing_details[name]': billing.name || 'Cardholder',
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
            return {
                success: false,
                declined: true,
                canRetryCard: true,
                error: errMsg,
                code: err.code || 'card_declined',
                decline_code: err.decline_code || '',
                submitted: true,
                submissionAttempted: true,
                protocolDirect: true
            };
        }
        pmId = pmRes.data.id;
        console.log(`⚡ [协议支付/Hosted] ✅ PaymentMethod 创建成功: ${pmId}`);
    } catch (pmErr) {
        console.warn(`[-] [协议支付/Hosted] 卡片创建网络异常: ${pmErr.message}`);
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `卡片网络提交异常: ${pmErr.message}`,
            protocolDirect: true
        };
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
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `Hosted Confirm 请求中断: ${confirmNetErr.message}`,
            protocolDirect: true
        };
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
            amount: dueAmount / 100,
            currency: hostedCurrency
        };
    }

    // 检查是否触发 3DS 或 hCaptcha challenge
    const pi = confirmData.payment_intent || {};
    const nextAction = confirmData.next_action || pi.next_action || {};
    if (pi.status === 'requires_action' || nextAction.type) {
        console.log(`⚡ [协议支付/Hosted] 触发了 3DS 或安全验证挑战 (${nextAction.type || 'requires_action'})，平滑转入收银台 UI...`);
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
            amount: dueAmount / 100,
            currency: hostedCurrency
        };
    }

    // 轮询 poll (最多 5 次)
    for (let i = 1; i <= 5; i++) {
        await new Promise(r => setTimeout(r, 1200));
        try {
            const pollRes = await executeWithProxyRetry(async (client) => {
                return await client.get(`https://api.stripe.com/v1/payment_pages/${sessionId}/poll`, {
                    params: { key: publishableKey },
                    headers: stripeHeaders
                });
            }, { proxy, maxRetries: 2 });

            const pollData = pollRes.data || {};
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
                    amount: dueAmount / 100,
                    currency: hostedCurrency
                };
            }
            if (['failed', 'expired', 'canceled'].includes(finalState)) {
                return {
                    success: false,
                    declined: true,
                    canRetryCard: true,
                    error: `Stripe Hosted 会话终态失败: ${finalState}`,
                    submitted: true,
                    submissionAttempted: true,
                    protocolDirect: true
                };
            }
        } catch (_) {}
    }

    return {
        success: false,
        declined: false,
        fallbackToUi: true,
        error: `Stripe Hosted 状态暂未确认为 succeeded (当前: ${finalState})，平滑转入收银台 UI`,
        protocolDirect: true
    };
}

/**
 * 执行 Stripe 纯协议支付闭环
 *
 * 提速架构：
 * - 双轨并发：Stripe 令牌轨 与 ChatGPT 风控/免税轨并行执行
 * - 前置预热：若外部传入预热令牌 (prewarmedTokens)，Stripe 令牌化耗时直降为 0ms
 *
 * 流程：
 * 1. [Stripe轨] 协议向 Stripe 获取 pm_ 与 ConfirmationToken (ctoken_)
 * 2. [ChatGPT轨] 并行签发结算 PoW (Sentinel) 并调用 /taxes 接口同步免税地址与金额
 * 3. [ChatGPT确认] 调用 /confirm 接口提交订阅
 * 4. [Stripe扣款] 向 Stripe payment_intents/:id/confirm 提交最终扣款确认
 */
async function executeStripeProtocolPayment({
    page,
    card,
    billing,
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
    userAgent = ''
}) {
    // 若会话为 Stripe 官方托管长链会话 (cs_live_... / cs_test_...，如 ChatGPT Team 档位)，直接切入 Hosted 纯协议直充通道
    if (sessionId && (sessionId.startsWith('cs_live_') || sessionId.startsWith('cs_test_'))) {
        console.log(`⚡ [协议支付] 检测到 Stripe Hosted Checkout 会话 (${sessionId.slice(0, 16)}...)，启用 Hosted 纯协议直充流水线`);
        return await executeStripeHostedProtocolPayment({
            page,
            card,
            billing,
            sessionId,
            publishableKey,
            currency,
            proxy,
            onPaymentAttemptStarted,
            prewarmedTokens
        });
    }

    const cardLast4 = String(card.number || card.card_number || '').slice(-4);
    console.log(`⚡ [协议支付] 开始 Stripe 纯协议直充 (免收银台 UI 渲染, 卡号: ...${cardLast4})...`);

    if (typeof onPaymentAttemptStarted === 'function') {
        try {
            await onPaymentAttemptStarted();
        } catch (_) {}
    }

    // --- 双轨并发执行：Stripe 令牌轨 与 ChatGPT 风控/免税轨 ---
    console.log(`⚡ [协议支付] 启动双轨并发流水线 (Stripe 令牌轨 || ChatGPT 风控/免税轨)...`);

    // 轨道 A: Stripe 卡片令牌化 (优先消费前置预热，否则现场生成)
    const prepareStripeTrack = async () => {
        if (prewarmedTokens) {
            try {
                const pre = await prewarmedTokens;
                if (pre?.ok && pre?.pmId && pre?.ctoken) {
                    console.log(`⚡ [协议支付] ⚡ [Stripe轨] 命中前置预热令牌 (耗时 0ms)! pm=${pre.pmId.slice(0, 14)}..., ctoken=${pre.ctoken.slice(0, 14)}...`);
                    return pre;
                }
                if (pre && !pre.ok) {
                    console.warn(`⚠️ [协议支付] [Stripe轨] 前置预热令牌未成功 (${pre.error})，转为现场重试生成...`);
                }
            } catch (preErr) {
                console.warn(`⚠️ [协议支付] [Stripe轨] 等待前置预热异常: ${preErr.message}，转为现场生成...`);
            }
        }

        console.log(`⚡ [协议支付] [Stripe轨] 正在向 Stripe 提交卡片 (pm_)...`);
        let pmResult;
        try {
            pmResult = await createStripePaymentMethod(card, billing, { proxy, publishableKey });
        } catch (netErr) {
            return { ok: false, networkError: netErr.message };
        }
        if (!pmResult.ok) return pmResult;

        console.log(`⚡ [协议支付] [Stripe轨] ✅ 卡片已预留 (${pmResult.pmId.slice(0, 14)}...)，正在生成 ConfirmationToken (ctoken_)...`);
        let ctokenResult;
        try {
            ctokenResult = await createStripeConfirmationToken(pmResult.pmId, {
                proxy,
                publishableKey,
                fingerprint: pmResult.fingerprint
            });
        } catch (tokenErr) {
            return { ok: false, networkError: tokenErr.message };
        }
        return {
            ok: Boolean(ctokenResult.ok && ctokenResult.ctoken),
            pmId: pmResult.pmId,
            ctoken: ctokenResult.ctoken,
            data: ctokenResult.data,
            status: ctokenResult.status,
            fingerprint: pmResult.fingerprint
        };
    };

    // 轨道 B: ChatGPT 结算风控令牌签发与免税账单同步 (两者并行执行)
    const prepareChatGptTrack = async () => {
        const checkoutUrl = `https://chatgpt.com/checkout/openai_llc/${sessionId}`;
        const baseHeaders = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Origin': 'https://chatgpt.com',
            'Referer': checkoutUrl,
            'x-openai-session-id': sessionId,
            'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="147", "Google Chrome";v="147"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
            ...(deviceId ? { 'oai-device-id': deviceId } : {})
        };

        console.log(`⚡ [协议支付] [ChatGPT轨] 正在并行签发结算风控令牌与同步免税地址...`);
        const [sentinelTokens, taxSyncResult] = await Promise.all([
            (async () => {
                try {
                    const tokens = await mintSentinelToken({
                        flow: 'checkout_session_approval',
                        pageUrl: checkoutUrl,
                        deviceId: deviceId || undefined,
                        userAgent: userAgent || undefined,
                        proxy: proxy || '',
                        timeoutMs: 15000
                    });
                    console.log(`⚡ [协议支付] ✅ [ChatGPT轨] 结算确认风控令牌已就绪`);
                    return tokens || {};
                } catch (e) {
                    console.warn(`⚠️ [协议支付] [ChatGPT轨] 确认阶段 Sentinel 签发跳过: ${e.message}`);
                    return {};
                }
            })(),
            (async () => {
                try {
                    return await syncCheckoutBillingTax({
                        page,
                        sessionId,
                        billing,
                        currency,
                        planType,
                        targetHeaders: baseHeaders,
                        proxy
                    });
                } catch (taxErr) {
                    console.warn(`⚠️ [协议支付] [ChatGPT轨] 免税地址同步非阻塞跳过: ${taxErr.message}`);
                    return null;
                }
            })()
        ]);

        const targetHeaders = {
            ...baseHeaders,
            'x-openai-target-path': '/backend-api/payments/checkout/confirm',
            'x-openai-target-route': '/backend-api/payments/checkout/confirm',
            ...(sentinelTokens.sentinelToken ? { 'openai-sentinel-token': sentinelTokens.sentinelToken } : {}),
            ...(sentinelTokens.sentinelSoToken ? { 'openai-sentinel-so-token': sentinelTokens.sentinelSoToken } : {})
        };

        return { sentinelTokens, taxSyncResult, targetHeaders };
    };

    // 双轨并发等待
    const [stripeRes, chatgptRes] = await Promise.all([
        prepareStripeTrack(),
        prepareChatGptTrack()
    ]);

    if (stripeRes.networkError) {
        console.warn(`[-] [协议支付] Stripe 网络请求异常: ${stripeRes.networkError}`);
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            error: `Stripe 协议网络异常: ${stripeRes.networkError}`,
            protocolDirect: true
        };
    }

    if (!stripeRes.ok || !stripeRes.ctoken) {
        const err = stripeRes.data?.error || {};
        const errMsg = err.message || stripeRes.error || `Stripe HTTP ${stripeRes.status || 400}`;
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

    const { pmId, ctoken } = stripeRes;
    const { targetHeaders } = chatgptRes;

    console.log(`⚡ [协议支付] ✅ 双轨流水线已完全对齐 (pm=${pmId.slice(0, 14)}..., ctoken=${ctoken.slice(0, 14)}...)`);

    // --- 提交支付确认 (默认不带 save_payment_method_for_reuse，遵循 OpenAI 上游规范) ---
    console.log(`⚡ [协议支付] 正在向 ChatGPT 提交支付确认...`);

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

    // 若在 0 浏览器纯协议模式下被 Cloudflare 403 拦截，并非银行拒付，应无损回退唤醒浏览器
    if (confirmResult.status === 403 && /just a moment|cloudflare|cf-mitigated|challenge/i.test(String(confirmResult.rawText || ''))) {
        console.warn('⚠️ [协议支付] /confirm 请求遇到 Cloudflare 403 验证挑战，平滑转入浏览器收银台 UI...');
        return {
            success: false,
            declined: false,
            fallbackToUi: true,
            reason: 'cloudflare_challenge',
            error: '协议确认请求触发 Cloudflare 验证挑战 (HTTP 403)，平滑转入浏览器收银台 UI',
            protocolDirect: true
        };
    }

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
        const isOregon = (billing?.country === 'US' && /oregon|or\b/i.test(billing?.state || ''));
        const taxSyncedAmount = chatgptRes?.taxSyncResult?.amountTotal;
        const confirmStateTotal = payload?.checkout_session?.checkout_state?.total?.total?.minorUnitsAmount;
        const piRawAmount = pi.amount ?? payload.amount ?? confirmStateTotal ?? taxSyncedAmount;
        const piCurrency = String(pi.currency || payload.currency || currency || 'PHP').toUpperCase();
        const planHint = planType || chatgptRes?.taxSyncResult?.planName || payload?.checkout_session?.plan_name || '';
        const fallbackDisplayAmount = getDefaultPlanDisplayAmount(planHint, piCurrency, isOregon);
        const piDisplayAmount = (piRawAmount != null && !isNaN(piRawAmount)) ? (piRawAmount / 100) : fallbackDisplayAmount;

        const stripeConfirm = await confirmStripePaymentIntent({
            intentId,
            clientSecret,
            pmId,
            ctoken,
            sessionId,
            publishableKey,
            proxy,
            amount: piDisplayAmount,
            currency: piCurrency,
            fingerprint: stripeRes.fingerprint,
            page
        });

        const confirmedRawAmount = stripeConfirm.data?.amount ?? stripeConfirm.data?.error?.payment_intent?.amount ?? piRawAmount;
        const resolvedAmount = (confirmedRawAmount != null && !isNaN(confirmedRawAmount))
            ? (confirmedRawAmount / 100)
            : piDisplayAmount;

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
                protocolDirect: true,
                amount: resolvedAmount,
                currency: piCurrency
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
                protocolDirect: true,
                amount: resolvedAmount,
                currency: piCurrency
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
    prewarmStripeConfirmationToken,
    executeStripeProtocolPayment,
    executeStripeHostedProtocolPayment,
    syncCheckoutBillingTax,
    getDefaultPlanDisplayAmount,
    executeWithProxyRetry,
    DEFAULT_OPENAI_PK
};
