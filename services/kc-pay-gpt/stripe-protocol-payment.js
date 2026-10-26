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
    proxy = '',
    amount = null,
    currency = ''
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

    const amountSuffix = amount != null ? `, 扣款金额: ${currency || ''} ${amount}` : '';
    console.log(`⚡ [协议支付] 5/5 正在向 Stripe 提交最终扣款确认 (${intentId.slice(0, 14)}...${amountSuffix})...`);
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
                const sess = pageRes.data?.checkout_session || pageRes.data || {};
                const rawTotal = sess.amount_total ?? pageRes.data?.snapshot?.amount_total ?? pageRes.data?.amount_total ?? pageRes.data?.total;
                const taxAmount = sess.total_details?.amount_tax ?? pageRes.data?.amount_tax ?? 0;
                const isOregon = (billing?.country === 'US' && /oregon|or\b/i.test(billing?.state || ''));
                const defaultPhAmount = isOregon ? 982.14 : 1100;
                const displayTotal = (rawTotal != null && !isNaN(rawTotal)) ? (rawTotal / 100) : (taxBody.currency === 'PHP' ? defaultPhAmount : 20);
                console.log(`⚡ [协议支付] ✅ 免税地址同步成功！总金额: ${taxBody.currency} ${displayTotal} (税额: ${taxAmount})`);
                return { ok: true, data: pageRes.data, amountTotal: rawTotal, taxAmount };
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
            const sess = data.checkout_session || data || {};
            const rawTotal = sess.amount_total ?? data.snapshot?.amount_total ?? data.amount_total ?? data.total;
            const taxAmount = sess.total_details?.amount_tax ?? data.amount_tax ?? 0;
            const isOregon = (billing?.country === 'US' && /oregon|or\b/i.test(billing?.state || ''));
            const defaultPhAmount = isOregon ? 982.14 : 1100;
            const displayTotal = (rawTotal != null && !isNaN(rawTotal)) ? (rawTotal / 100) : (taxBody.currency === 'PHP' ? defaultPhAmount : 20);
            console.log(`⚡ [协议支付] ✅ 免税地址同步成功！总金额: ${taxBody.currency} ${displayTotal} (税额: ${taxAmount})`);
            return { ok: true, data, amountTotal: rawTotal, taxAmount };
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
 * 前置预热 Stripe ConfirmationToken (pm_ + ctoken_)
 * 可在任务启动或结账创建阶段于后台异步执行，使协议支付耗时再降 4~5 秒
 */
async function prewarmStripeConfirmationToken({ card, billing, proxy = '', publishableKey = DEFAULT_OPENAI_PK }) {
    if (!card || !billing) return null;
    const cardLast4 = String(card.number || card.card_number || '').slice(-4);
    try {
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
        const ctokenResult = await createStripeConfirmationToken(pmResult.pmId, { proxy, publishableKey });
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
            publishableKey
        };
    } catch (err) {
        console.warn(`⚠️ [协议预热] 预热执行异常 (非阻塞): ${err.message}`);
        return { ok: false, error: err.message };
    }
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
    proxy = '',
    publishableKey = DEFAULT_OPENAI_PK,
    onPaymentAttemptStarted,
    prewarmedTokens = null
}) {
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
            ctokenResult = await createStripeConfirmationToken(pmResult.pmId, { proxy, publishableKey });
        } catch (tokenErr) {
            return { ok: false, networkError: tokenErr.message };
        }
        return {
            ok: Boolean(ctokenResult.ok && ctokenResult.ctoken),
            pmId: pmResult.pmId,
            ctoken: ctokenResult.ctoken,
            data: ctokenResult.data,
            status: ctokenResult.status
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
            'x-openai-session-id': sessionId
        };

        console.log(`⚡ [协议支付] [ChatGPT轨] 正在并行签发结算风控令牌与同步免税地址...`);
        const [sentinelTokens, taxSyncResult] = await Promise.all([
            (async () => {
                try {
                    const tokens = await mintSentinelToken({
                        flow: 'checkout_session_approval',
                        pageUrl: checkoutUrl,
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
        const defaultPhAmount = isOregon ? 982.14 : 1100;
        const piRawAmount = pi.amount ?? payload.amount;
        const piCurrency = String(pi.currency || payload.currency || currency || 'PHP').toUpperCase();
        const piDisplayAmount = (piRawAmount != null && !isNaN(piRawAmount)) ? (piRawAmount / 100) : (piCurrency === 'PHP' ? defaultPhAmount : 20);

        const stripeConfirm = await confirmStripePaymentIntent({
            intentId,
            clientSecret,
            pmId,
            ctoken,
            sessionId,
            publishableKey,
            proxy,
            amount: piDisplayAmount,
            currency: piCurrency
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
                protocolDirect: true,
                amount: piDisplayAmount,
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
                amount: piDisplayAmount,
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
    DEFAULT_OPENAI_PK
};
