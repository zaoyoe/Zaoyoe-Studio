'use strict';

/**
 * Payment Retry with Card Rotation Module
 *
 * 支付逻辑：
 * 1. 获取当前地区和账单配置
 * 2. 选取免税地址
 * 3. 从卡池预留卡片，拒付时自动换卡（最多 PAYMENT_MAX_CARD_ATTEMPTS 次）
 * 4. 成功 → 绑定地址/姓名到卡片、标记地址已绑定
 */

const store = require('./mysql-store');
const { completeStripeCardPayment, readCheckoutDueAmount, waitForCheckoutDueAmount, estimateTaxFreeAmount } = require('./stripe-payment');
const { ensureChatGptProUsageTier } = require('./pricing-checkout');
const { pickBillingAddressForCheckout, markAddressBound } = require('./tax-free-address');
const { getRegionConfig } = require('./region-config');
const { classifyPaymentResult, classifyOpenAiCardMethodFailure } = require('./task-safety');
const { validateCardNumber } = require('./card-validator');
const { isBundle: isGrokBundlePlan } = require('./public/grok-plan-catalog');
const { grokError } = require('./grok-checkout-state');
const { assertNativeBillingRegion, normalizeNativeBillingAddress } = require('./grok-billing-address');

const MAX_CARD_ATTEMPTS = Number(process.env.PAYMENT_MAX_CARD_ATTEMPTS) || 3;
const MAX_AUTOMATION_ATTEMPTS = MAX_CARD_ATTEMPTS;
const PAYMENT_GUARD_ERROR_CODES = new Set([
    'PAYMENT_REGION_NETWORK_MISMATCH',
    'NETWORK_REGION_UNCONFIRMED',
    'PAYMENT_REGION_UNCONFIRMED',
    'CDK_PAYMENT_REGION_MISMATCH',
    'PAYMENT_CURRENCY_MISMATCH',
    'CHECKOUT_CURRENCY_UNCONFIRMED',
    'CHECKOUT_AMOUNT_UNCONFIRMED',
    'CHECKOUT_AMOUNT_MISMATCH',
    'BILLING_TAX_NOT_REMOVED',
    'PRICING_REGION_UNCONFIRMED'
]);

function getExpectedPlanPriceRule(platform, planType, currency) {
    const plat = String(platform || 'chatgpt').toLowerCase();
    const plan = String(planType || 'plus').toLowerCase();
    const curr = String(currency || 'USD').toUpperCase();

    if (plat === 'chatgpt') {
        const teamMatch = plan.match(/^team_?(\d+)$/i);
        const isTeam = Boolean(teamMatch || plan === 'team' || plan === 'chatgpt_team' || plan === 'team_monthly' || plan === 'team_yearly');
        const seats = teamMatch ? Math.max(2, parseInt(teamMatch[1], 10) || 2) : 2;

        if (curr === 'USD') {
            if (plan === 'plus') return { amount: 20, grossAmount: 20, netAmount: 20, label: 'Plus $20' };
            if (plan === 'go') return { amount: 8, grossAmount: 8, netAmount: 8, label: 'Go $8' };
            if (/pro_?200|pro_?20x|pro_?more/i.test(plan)) return { amount: 200, grossAmount: 200, netAmount: 200, label: 'Pro More usage $200' };
            if (/pro_?500|pro_?max/i.test(plan)) return { amount: 500, grossAmount: 500, netAmount: 500, label: 'Pro Max usage $500' };
            if (/pro_?100|pro_?5x|^pro$/i.test(plan)) return { amount: 100, grossAmount: 100, netAmount: 100, label: 'Pro Standard $100' };
            if (isTeam) return { min: 0, max: seats * 30, grossAmount: seats * 30, netAmount: seats * 30, label: `Team (${seats}席) $${seats * 30}` };
        }
        if (curr === 'PHP') {
            if (plan === 'plus') return { min: 980, max: 1105, grossAmount: 1100, netAmount: 982.14, label: 'Plus ₱1,100' };
            if (plan === 'go') return { min: 260, max: 350, grossAmount: 300, netAmount: 267.86, label: 'Go ₱300' };
            if (/pro_?200|pro_?20x|pro_?more/i.test(plan)) return { min: 8900, max: 10000, grossAmount: 9990, netAmount: 8919.64, label: 'Pro More usage ₱9,990' };
            if (/pro_?500|pro_?max/i.test(plan)) return { min: 28000, max: 33000, grossAmount: 32490, netAmount: 29008.93, label: 'Pro Max usage ₱32,490' };
            if (/pro_?100|pro_?5x|^pro$/i.test(plan)) return { min: 5700, max: 6550, grossAmount: 6490, netAmount: 5794.64, label: 'Pro Standard ₱6,490' };
            if (isTeam) return { min: 0, max: seats * 1450, grossAmount: seats * 1450, netAmount: seats * 1450, label: `Team (${seats}席) ₱${seats * 1450}` };
        }
    }
    return null;
}

function isPaymentDeclined(errorMsg) {
    if (!errorMsg) return false;
    const declinedKeywords = [
        'declined', 'card_declined', 'insufficient_funds',
        'expired_card', 'incorrect_cvc', 'processing_error',
        'lost_card', 'stolen_card', 'do_not_honor',
        '拒绝', '被拒', 'your card was declined',
        'payment was not successful', 'payment was not approved',
        'not approved',
        'invalid', 'card number is invalid', 'card_invalid', 'invalid_card',
        '卡号无效', '卡片格式', '不被支持', 'incomplete', '不完整', '未通过 luhn',
        '账单地址未显示', '账单地址未展示',
        '无法完成此次购买', '无法完成此购买', 'unable to complete this purchase', '未能完成购买'
    ];
    const lower = errorMsg.toLowerCase();
    return declinedKeywords.some((kw) => lower.includes(kw));
}

/**
 * 解析应写入账单的实际扣款金额（优先免税后应付）
 */
async function resolveBilledAmountForRecord(page, paymentResult, preTaxAmount, currency) {
    if (paymentResult?.dueAmount > 0) {
        return {
            amount: paymentResult.dueAmount,
            currency: paymentResult.dueCurrency || currency,
        };
    }
    try {
        const due = await readCheckoutDueAmount(page);
        if (due?.amount > 0) {
            return { amount: due.amount, currency: due.currency || currency };
        }
    } catch (_) { /* ignore */ }
    if (preTaxAmount > 0) {
        const estimated = estimateTaxFreeAmount(preTaxAmount, currency);
        if (estimated && estimated < preTaxAmount * 0.98) {
            return { amount: estimated, currency };
        }
    }
    return { amount: preTaxAmount, currency };
}

/**
 * 执行支付；拒付时在同一会话内换卡重试
 * @param {import('playwright').Page} page - Playwright Page 实例
 * @param {object} options - 支付选项
 * @returns {Promise<{ success: boolean, error?: string, cardLast4?: string, manualIntervention?: boolean, screenshots?: string[] }>}
 */
async function executePaymentWithRetry(page, options) {
    let { platform = 'chatgpt', planType, cdkCode, email, onProgress, stripeSessionId, onPaymentState } = options || {};
    let lastPersistedPaymentState = 'not_started';
    const persistPaymentState = async (state, message = '') => {
        if (typeof onPaymentState === 'function') {
            await onPaymentState(state, message);
        }
        lastPersistedPaymentState = state;
    };

    const progress = (msg) => {
        console.log(`[PaymentRetry] ${msg}`);
        if (typeof onProgress === 'function') {
            try { onProgress(msg); } catch (_) { /* ignore callback errors */ }
        }
    };

    const regionOverride = String(process.env.PAYMENT_REGION_OVERRIDE || '').trim().toUpperCase();
    const region = String(options?.paymentRegion || regionOverride || await store.getPaymentRegion()).trim().toUpperCase();
    const regionConfig = getRegionConfig(region);
    if (!regionConfig) {
        return { success: false, error: '不支持的支付地区配置' };
    }
    const currency = String(options?.paymentCurrency || regionConfig.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency !== String(regionConfig.currency || '').toUpperCase()) {
        await persistPaymentState('not_started');
        return { success: false, error: `卡密支付地区 ${region} 的币种配置无法确认，已停止支付 [CHECKOUT_CURRENCY_UNCONFIRMED]`,
            code: 'CHECKOUT_CURRENCY_UNCONFIRMED', manualIntervention: true, paymentState: 'not_started', screenshots: [] };
    }
    progress(`支付地区: ${region}, 币种: ${currency}`);

    const grokBundle = platform === 'grok' && isGrokBundlePlan(planType);
    let address;
    try {
        if (options?.prewarmedPayment?.address) {
            address = options.prewarmedPayment.address;
        } else {
            if (grokBundle) assertNativeBillingRegion(region, currency);
            const lastUsedIdRaw = await store.getAppConfigValue('last_used_address_id', null);
            const lastUsedId = lastUsedIdRaw ? Number(lastUsedIdRaw) : null;
            address = grokBundle
                ? normalizeNativeBillingAddress(await pickBillingAddressForCheckout(region, lastUsedId, { strategy: 'oregon' }))
                : await pickBillingAddressForCheckout(region, lastUsedId);
        }
    } catch (error) {
        if (!grokBundle) throw error;
        const billingError = error.code === 'GROK_BILLING_UNCONFIRMED' ? error
            : grokError('GROK_BILLING_UNCONFIRMED', '无法取得符合新版组合订阅要求的账单地址，尚未提交支付');
        await persistPaymentState('not_started');
        progress('新版 Grok 账单检查未通过，尚未预留银行卡或提交支付');
        return { success: false, error: billingError.message, code: billingError.code,
            manualIntervention: true, paymentState: 'not_started', screenshots: [] };
    }
    const addressSource = address.generated ? '随机生成' : `地址池 #${address.id}`;
    const addressLabel = (address.country === 'US' && /oregon|or\b/i.test(address.state || ''))
        ? '美国俄勒冈免税'
        : (region === 'US' ? '美国免税' : regionConfig.label || region);
    progress(`已选取${addressLabel}账单地址 (${addressSource}): ${address.line1}, ${address.city}, ${address.state}`);

    const ownerKey = options?.ownerKey
        ? `payment_${String(options.ownerKey).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`
        : (cdkCode ? `payment_${cdkCode}_${Date.now()}` : `payment_debug_${Date.now()}`);

    const screenshots = [];
    const declinedLast4s = [];
    let lastError = '';
    let lastCardLast4 = '';
    let billingHolderName = '';

    let billedAmount = 0;
    let billedCurrency = currency;
    const isHostedSession = Boolean(stripeSessionId && (stripeSessionId.startsWith('cs_live_') || stripeSessionId.startsWith('cs_test_')));
    const canTryProtocol = (platform === 'chatgpt' || !platform) && Boolean(stripeSessionId && (isHostedSession || options?.accessToken));
    const requiresCurrencyPreflight = (platform === 'chatgpt' || !options?.platform) && !canTryProtocol;

    if (canTryProtocol) {
        billedCurrency = currency;
        const isOregon = (address?.country === 'US' && /oregon|or\b/i.test(address?.state || ''));
        const expectedRule = getExpectedPlanPriceRule(platform, planType, billedCurrency);
        if (isOregon && expectedRule?.netAmount !== undefined) {
            billedAmount = expectedRule.netAmount;
        } else if (expectedRule?.grossAmount !== undefined) {
            billedAmount = expectedRule.grossAmount;
        } else if (expectedRule?.amount !== undefined) {
            billedAmount = expectedRule.amount;
        } else if (billedCurrency === 'PHP' && /plus/i.test(planType)) {
            billedAmount = isOregon ? (estimateTaxFreeAmount(1100, 'PHP') || 982.14) : 1100;
        } else if (billedCurrency === 'USD' && /plus/i.test(planType)) {
            billedAmount = 20;
        }
        if (isOregon && billedAmount > 0) {
            const taxFree = estimateTaxFreeAmount(billedAmount, billedCurrency);
            if (taxFree) billedAmount = taxFree;
        }
        progress(`⚡ [极速协议] 预设套餐结算金额: ${billedCurrency} ${billedAmount || '(按上游结算)'}`);
    }

    try {
        if (!canTryProtocol) {
            if (platform === 'chatgpt' || !platform) {
                await ensureChatGptProUsageTier(page, planType).catch((err) => {
                    console.warn('⚠️ [PaymentRetry] Pro 档位选择异常 (非阻塞):', err.message);
                });
            }
            if (requiresCurrencyPreflight) {
                progress('等待 Checkout 应付金额和币种加载确认...');
            }
            const due = requiresCurrencyPreflight
                ? await waitForCheckoutDueAmount(page)
                : await readCheckoutDueAmount(page);
            if (requiresCurrencyPreflight && (!due?.amount || !due.currency)) {
                await persistPaymentState('not_started');
                const error = 'Checkout 应付金额或币种无法确认，已停止支付 [CHECKOUT_CURRENCY_UNCONFIRMED]';
                progress(error);
                return { success: false, error, code: 'CHECKOUT_CURRENCY_UNCONFIRMED',
                    manualIntervention: true, paymentState: 'not_started', screenshots: [] };
            }
            if (requiresCurrencyPreflight && due.currency !== currency) {
                await persistPaymentState('not_started');
                const error = `Checkout 币种 ${due.currency} 与卡密支付币种 ${currency} 不一致，已停止支付 [PAYMENT_CURRENCY_MISMATCH]`;
                progress(error);
                return { success: false, error, code: 'PAYMENT_CURRENCY_MISMATCH',
                    manualIntervention: true, paymentState: 'not_started', screenshots: [] };
            }
            if (due?.amount) {
                billedAmount = due.amount;
                billedCurrency = due.currency || billedCurrency;
                progress(`Checkout 应付金额: ${billedCurrency} ${billedAmount}`);

                const expectedRule = getExpectedPlanPriceRule(platform, planType, billedCurrency);
                if (expectedRule) {
                    const checkMismatch = (amt) => {
                        const num = Number(amt);
                        return expectedRule.amount !== undefined
                            ? Math.abs(num - expectedRule.amount) > 1.0
                            : (num < expectedRule.min || num > expectedRule.max);
                    };

                    if (checkMismatch(billedAmount)) {
                        progress(`Checkout 当前应付金额 (${billedCurrency} ${billedAmount}) 暂未与套餐期望金额 (${expectedRule.label}) 联动，等待金额最终就绪...`);
                        const pollDeadline = Date.now() + 10000;
                        while (Date.now() < pollDeadline) {
                            if (page?.waitForTimeout) {
                                await page.waitForTimeout(600);
                            } else if (typeof setTimeout !== 'undefined') {
                                await new Promise(r => setTimeout(r, 20));
                            }
                            const refreshed = await readCheckoutDueAmount(page).catch(() => null);
                            if (refreshed?.amount) {
                                billedAmount = refreshed.amount;
                                billedCurrency = refreshed.currency || billedCurrency;
                                if (!checkMismatch(billedAmount)) {
                                    progress(`Checkout 应付金额已联动就绪: ${billedCurrency} ${billedAmount}`);
                                    break;
                                }
                            }
                            if (!page?.waitForTimeout) break;
                        }
                    }

                    if (checkMismatch(billedAmount)) {
                        await persistPaymentState('not_started');
                        const error = `Checkout 应付金额 ${billedCurrency} ${billedAmount} 与套餐 ${planType} 期望金额 (${expectedRule.label}) 不一致，已安全拦截支付 [CHECKOUT_AMOUNT_MISMATCH]`;
                        progress(error);
                        return { success: false, error, code: 'CHECKOUT_AMOUNT_MISMATCH',
                            manualIntervention: true, paymentState: 'not_started', screenshots: [] };
                    }
                }
            }
        }
    } catch (error) {
        if (!requiresCurrencyPreflight) {
            // Non-ChatGPT payment integrations retain their provider-specific preflight behavior.
            progress(`无法预读取 Checkout 金额: ${error.message}`);
        } else {
            await persistPaymentState('not_started');
            const message = `Checkout 应付金额或币种无法确认，已停止支付 [CHECKOUT_CURRENCY_UNCONFIRMED]: ${error.message}`;
            progress(message);
            return { success: false, error: message, code: 'CHECKOUT_CURRENCY_UNCONFIRMED',
                manualIntervention: true, paymentState: 'not_started', screenshots: [] };
        }
    }

    progress(`开始支付（最多尝试 ${MAX_CARD_ATTEMPTS} 张卡）...`);
    let uiFallbackActive = false;

    for (let cardAttempt = 1; cardAttempt <= MAX_CARD_ATTEMPTS; cardAttempt += 1) {
        let card = null;
        let prewarmedTokens = null;

        if (cardAttempt === 1 && options?.prewarmedPayment?.card) {
            card = options.prewarmedPayment.card;
            options.prewarmedPayment.consumed = true;
            prewarmedTokens = options.prewarmedPayment.tokenPromise;
        } else {
            card = await store.reserveCard(ownerKey);
        }

        if (!card) {
            progress(cardAttempt === 1 ? '卡池无可用卡，终止支付' : `卡池已无更多可用卡（已拒 ${declinedLast4s.length} 张）`);
            if (cardAttempt === 1) {
                await store.createBillingRecord({
                    card_last4: '----',
                    amount: billedAmount,
                    currency: billedCurrency,
                    plan_type: planType || 'plus',
                    cdk_code: cdkCode,
                    email,
                    stripe_session_id: stripeSessionId || null,
                    status: 'failed',
                    error_code: 'card_pool_exhausted',
                    error_message: '卡池资产枯竭'
                });
                return { success: false, error: '卡池资产枯竭' };
            }
            break;
        }

        const cardLast4 = String(card.card_number || '').slice(-4);
        lastCardLast4 = cardLast4;

        const cardValidation = validateCardNumber(card.card_number);
        if (!cardValidation.valid) {
            progress(`卡片 ...${cardLast4} 本地校验未通过 (${cardValidation.error})，标记已报废并更换下一张`);
            await store.markCardExhausted(card.id);
            declinedLast4s.push(cardLast4);
            cardAttempt -= 1;
            continue;
        }

        const cardInfo = {
            number: card.card_number,
            expiry: card.card_expiry,
            cvc: card.card_cvc,
            holder: card.card_holder
        };
        progress(`已预留卡片 #${cardAttempt}: ...${cardLast4}`);

        let cardHandled = false;
        let attemptStarted = false;
        lastPersistedPaymentState = 'not_started';

        try {
            let paymentResult;
            try {
                const fastProtocolEnv = String(process.env.FAST_PROTOCOL_ENABLED ?? '').trim().toLowerCase();
                const isFastProtocolEnabled = (options.fastProtocol !== false) && (fastProtocolEnv !== 'false' && fastProtocolEnv !== '0');
                // 2.0 极速协议通道：首张卡优先尝试 Stripe 纯协议直接开卡（跳过收银台 DOM 加载与交互延迟）；
                // 若首张卡回退唤醒了浏览器 UI 且仍被拒，后续换卡直接在已打开的收银台 UI 内填卡重试，避免重复创建 oaics_ 会话触发 429 限流
                const canTryProtocol = isFastProtocolEnabled && !uiFallbackActive && (platform === 'chatgpt' || !platform) && stripeSessionId && (isHostedSession || options?.accessToken);
                let protoRes = null;
                if (!isFastProtocolEnabled && cardAttempt === 1 && (platform === 'chatgpt' || !platform)) {
                    progress('⚡ [极速协议] 协议直充已关闭，直接转入收银台 UI 进行支付...');
                }
                if (canTryProtocol) {
                    try {
                        const { executeStripeProtocolPayment } = require('./stripe-protocol-payment');
                        protoRes = await executeStripeProtocolPayment({
                            page,
                            card: cardInfo,
                            billing: { ...address, email: address?.email || email || '' },
                            sessionId: stripeSessionId,
                            accessToken: options.accessToken,
                            currency,
                            planType,
                            proxy: options.proxy || '',
                            prewarmedTokens,
                            cookieHeader: options.cookieHeader || '',
                            deviceId: options.deviceId || '',
                            userAgent: options.userAgent || '',
                            onPaymentAttemptStarted: async () => {
                                attemptStarted = true;
                                await persistPaymentState('started', '正在提交银行卡支付 (Stripe 纯协议直充)');
                            }
                        });

                        if (protoRes.success) {
                            paymentResult = {
                                ...protoRes,
                                dueAmount: protoRes.amount != null ? protoRes.amount : billedAmount,
                                dueCurrency: protoRes.currency || billedCurrency,
                                holderName: address.name || billingHolderName || ''
                            };
                        } else if (protoRes.declined) {
                            // 协议支付已明确收到上游拒卡终态，重置前置 started 状态，防止后续 UI 回退若未能点击提交按钮时被误判为 started->unknown 挂单
                            attemptStarted = false;
                            lastPersistedPaymentState = 'declined';

                            // 只要页面可用（或支持按需懒加载唤醒浏览器）且允许回退，协议提交未果或拒付
                            // 均平滑回退收银台 UI 进行真实环境二次抢救提交
                            const allowFallback = process.env.CHECKOUT_PROTOCOL_DECLINE_FALLBACK !== 'false';
                            const canFallback = Boolean(
                                allowFallback
                                && (
                                    (page && typeof page.goto === 'function' && !page.isClosed())
                                    || typeof options.ensureBrowserPage === 'function'
                                )
                            );

                            if (canFallback) {
                                progress(`⚡ [协议回退] 卡片 ...${cardLast4} 纯协议提交被拒 (${protoRes.error || protoRes.code || 'declined'})，平滑唤醒收银台 UI 进行真实环境提交通道...`);
                                // 不设置 paymentResult，自动顺延进入收银台 UI 兜底流水线
                            } else {
                                paymentResult = {
                                    ...protoRes,
                                    dueAmount: protoRes.amount != null ? protoRes.amount : billedAmount,
                                    dueCurrency: protoRes.currency || billedCurrency,
                                    holderName: address.name || billingHolderName || ''
                                };
                                progress(`[协议支付] 卡片 ...${cardLast4} 协议核验未果或被拒: ${protoRes.error}`);
                                if (page && typeof page.screenshot === 'function' && !page.isClosed()) {
                                    try {
                                        const screenshotDir = path.join(__dirname, 'debug_screenshots', 'stripe');
                                        fs.mkdirSync(screenshotDir, { recursive: true });
                                        const filePath = path.join(screenshotDir, `protocol_declined_${Date.now()}.png`);
                                        await page.screenshot({ path: filePath, timeout: 5000 });
                                        paymentResult.screenshot = filePath;
                                    } catch (_) {}
                                }
                            }
                        } else if (protoRes.fallbackToUi) {
                            attemptStarted = false;
                            progress(`[协议支付] ${protoRes.error || '转入收银台 UI 进行后续处理'}...`);
                        }
                    } catch (protoErr) {
                        attemptStarted = false;
                        console.warn('⚠️ [协议支付] 协议尝试异常，平滑转入收银台 UI:', protoErr.message);
                    }
                }

                if (!paymentResult) {
                    let checkoutUrl = options.checkoutUrl;
                    const needsCleanSession = Boolean(
                        canTryProtocol && !isHostedSession && (protoRes?.declined || protoRes?.fallbackToUi || !protoRes)
                        && typeof options.refreshCheckoutSession === 'function'
                    );
                    const needsLazyBrowser = Boolean(
                        (!page || (typeof page.isClosed === 'function' && page.isClosed()))
                        && typeof options.ensureBrowserPage === 'function'
                    );
                    let cleanSessionObtained = !needsCleanSession;

                    if (needsCleanSession && needsLazyBrowser) {
                        progress('⚡ [协议回退] 正在并发执行：按需懒加载唤醒 Chromium 浏览器 || 换取全新干净 Checkout 会话...');
                        const [lazyPage, refreshed] = await Promise.all([
                            options.ensureBrowserPage('纯协议支付未果/被拒，按需唤醒浏览器收银台'),
                            options.refreshCheckoutSession().catch((e) => {
                                progress(`[协议回退] 刷新会话异常: ${e.message}`);
                                return null;
                            })
                        ]);
                        page = lazyPage;
                        if (refreshed?.checkoutUrl) {
                            checkoutUrl = refreshed.checkoutUrl;
                            stripeSessionId = refreshed.sessionId || stripeSessionId;
                            cleanSessionObtained = true;
                            progress(`⚡ [协议回退] 获取到全新未污染收银台链接: ${stripeSessionId.slice(0, 18)}...`);
                        }
                    } else {
                        if (needsLazyBrowser) {
                            progress('⚡ [按需唤醒] 正在按需懒加载启动 Chromium 浏览器环境以接管收银台 UI...');
                            page = await options.ensureBrowserPage('纯协议支付转入浏览器收银台 UI');
                        }
                        if (needsCleanSession) {
                            // 对于 ChatGPT Plus 的定制收银台 (oaics_...)，底层 PaymentIntent 在纯协议扣款失败后会直接死锁该会话。
                            // 回退到收银台 UI 必须重新签发一个全新的干净 Checkout 会话，否则打开必定提示「Checkout could not be completed」！
                            progress(`⚡ [协议回退] 旧 Checkout 会话已被协议占用，正在为收银台 UI 换取全新干净会话...`);
                            const refreshed = await options.refreshCheckoutSession().catch((e) => {
                                progress(`[协议回退] 刷新会话异常: ${e.message}`);
                                return null;
                            });
                            if (refreshed?.checkoutUrl) {
                                checkoutUrl = refreshed.checkoutUrl;
                                stripeSessionId = refreshed.sessionId || stripeSessionId;
                                cleanSessionObtained = true;
                                progress(`⚡ [协议回退] 获取到全新未污染收银台链接: ${stripeSessionId.slice(0, 18)}...`);
                            }
                        }
                    }

                    // 若协议已明确拒付 (protoRes.declined)，且需要刷新干净 oaics_ 会话却因上游 429 (checkout_creation_rate_limited) 等原因未能拿到新会话，
                    // 严禁继续导航至已被协议锁死的旧 oaics_ 会话（旧会话打开必报 Checkout could not be completed 且按钮禁用），
                    // 同时设置 canRetryCard: false 防止在无可用新会话时继续消耗卡池中的下一张卡！
                    if (needsCleanSession && !cleanSessionObtained && protoRes?.declined) {
                        progress(`⚠️ [协议回退] 无法获取新 Checkout 会话（上游创建限流或异常），跳过已污染旧会话的 UI 复核，直接采纳协议拒卡结果: ${protoRes.error || 'declined'}`);
                        paymentResult = {
                            ...protoRes,
                            canRetryCard: false,
                            dueAmount: protoRes.amount != null ? protoRes.amount : billedAmount,
                            dueCurrency: protoRes.currency || billedCurrency,
                            holderName: address.name || billingHolderName || ''
                        };
                    } else {
                        const defaultCheckoutUrl = isHostedSession
                            ? `https://pay.openai.com/c/pay/${stripeSessionId}`
                            : (stripeSessionId ? `https://chatgpt.com/checkout/openai_llc/${stripeSessionId}` : '');
                        const targetUrl = checkoutUrl || defaultCheckoutUrl;

                        const currentUrl = (page && typeof page.url === 'function' ? page.url() : '') || '';
                        const isAlreadyOnTarget = Boolean(targetUrl && currentUrl.includes(stripeSessionId));

                        if (targetUrl && (!isAlreadyOnTarget || protoRes?.declined || protoRes?.fallbackToUi)) {
                            const navMsg = canTryProtocol ? '⚡ [协议回退] 唤醒浏览器收银台' : '🧭 [收银台] 浏览器加载收银台';
                            progress(`${navMsg}: ${targetUrl}`);
                            if (page && typeof page.goto === 'function') {
                                await page.goto(targetUrl, { waitUntil: 'commit', timeout: 30000 }).catch(() => {});
                            }
                        }
                        const due = await waitForCheckoutDueAmount(page).catch(() => null);
                        if (due?.amount) {
                            billedAmount = due.amount;
                            billedCurrency = due.currency || billedCurrency;
                        }

                        uiFallbackActive = true;
                        paymentResult = await completeStripeCardPayment(page, cardInfo, address, {
                            cardAttempt, holderName: billingHolderName, email, platform, planType, grokAccount: options.grokAccount,
                            paymentRegion: region,
                            paymentCurrency: currency,
                            grokCheckout: options.grokCheckout,
                            onPaymentAttemptStarted: async () => {
                                attemptStarted = true;
                                await persistPaymentState('started', '正在提交银行卡支付');
                            }
                        });
                    }
                }
            } catch (error) {
                paymentResult = { success: false, error: error.message,
                    submitted: attemptStarted, submissionAttempted: attemptStarted };
            }
            if (paymentResult.dueAmount > 0) {
                billedAmount = paymentResult.dueAmount;
                billedCurrency = paymentResult.dueCurrency || billedCurrency;
            }
            // Recognize method/field guard errors before broad decline keywords
            // such as "不完整". Payment activity is still classified separately below.
            const cardMethodFailure = classifyOpenAiCardMethodFailure(paymentResult.error);
            const isCaptchaOrNonCard = Boolean(
                cardMethodFailure
                ||
                paymentResult.captchaRequired
                || /安全验证|人机验证|hcaptcha|cloudflare|turnstile|captcha|verification|购买未成功|表单|超时|timeout/i.test(paymentResult.error || '')
            );

            const paymentResultCode = String(paymentResult.code || '').trim().toUpperCase();
            const isPaymentGuardFailure = PAYMENT_GUARD_ERROR_CODES.has(paymentResultCode);
            const isDeclined = !isPaymentGuardFailure && Boolean(paymentResult.declined || paymentResult.canRetryCard
                || (!options.grokCheckout?.native && !isCaptchaOrNonCard && paymentResult.code !== 'PAYMENT_RESULT_UNKNOWN' && isPaymentDeclined(paymentResult.error || '')));

            const paymentState = classifyPaymentResult({
                success: Boolean(paymentResult.success),
                declined: isDeclined,
                submitted: paymentResult.submitted,
                submissionAttempted: paymentResult.submissionAttempted,
                previousState: lastPersistedPaymentState,
                captchaRequired: paymentResult.captchaRequired,
                error: paymentResult.error
            });
            await persistPaymentState(paymentState, paymentState === 'unknown'
                ? '支付结果未知，暂停自动重试并保留 CDK 与银行卡供人工复核'
                : '');

            if (paymentResult.holderName) {
                billingHolderName = paymentResult.holderName;
            }

            if (paymentResult.success) {
                const resolved = await resolveBilledAmountForRecord(
                    page,
                    paymentResult,
                    billedAmount,
                    billedCurrency
                );
                billedAmount = resolved.amount;
                billedCurrency = resolved.currency;
                progress(`实际扣款金额（免税后）: ${billedCurrency} ${billedAmount}`);

                const holderName = paymentResult.holderName || card.card_holder || billingHolderName || '';
                await store.bindCardPaymentProfile(card.id, { holderName, address });
                if (address.id) {
                    await markAddressBound(address.id, card.id);
                }
                await store.recordCardUsage(card.id);
                await store.releaseCard(card.id);
                cardHandled = true;
                await store.createBillingRecord({
                    card_number: card.card_number,
                    card_last4: cardLast4,
                    amount: billedAmount,
                    currency: billedCurrency,
                    plan_type: planType || 'plus',
                    platform: options.platform,
                    cdk_code: cdkCode,
                    email,
                    stripe_session_id: stripeSessionId || null,
                    status: 'success'
                });
                progress(`支付成功！卡片: ...${cardLast4}，姓名: ${holderName}，地址: ${address.line1}, ${address.city}`);
                if (paymentResult.screenshot) {
                    screenshots.push(paymentResult.screenshot);
                    progress(`SUCCESS_SCREENSHOT: ${paymentResult.screenshot}`);
                }
                return { success: true, cardLast4, holderName, screenshots, subscriptionId: paymentResult.subscriptionId || null };
            }

            lastError = paymentResult.error || '支付失败';
            if (paymentResult.screenshot) {
                screenshots.push(paymentResult.screenshot);
                progress(`FAILURE_SCREENSHOT: ${paymentResult.screenshot}`);
            }

            const declined = paymentState === 'declined' || isDeclined;
            if (paymentState === 'unknown') {
                // Even if bookkeeping fails, an unresolved submitted payment must
                // never reach finally's normal release path.
                cardHandled = true;
                await store.quarantineCardForReview(card.id);
                await store.createBillingRecord({
                    card_number: card.card_number,
                    card_last4: cardLast4,
                    amount: billedAmount,
                    currency: billedCurrency,
                    plan_type: planType || 'plus',
                    platform: options.platform,
                    cdk_code: cdkCode,
                    email,
                    stripe_session_id: stripeSessionId || null,
                    status: 'pending',
                    error_code: 'payment_result_unknown',
                    error_message: '提交后未能确认支付结果；禁止自动重试，需人工核对 Stripe 账单'
                });
                progress('支付结果未知，已暂停自动重试并保留 CDK 和银行卡，需人工核对 Stripe 账单');
                return {
                    success: false,
                    error: '支付结果暂未确认，已暂停自动重试并转人工复核',
                    cardLast4,
                    manualIntervention: true,
                    paymentState,
                    screenshots
                };
            }

            if (declined) {
                // Protect the card before bookkeeping so a database error cannot
                // send an explicitly declined card through finally's release path.
                cardHandled = true;
                progress(`Stripe 拒绝支付，将卡片置入 30 分钟智能冷却避让 (ID: ${card.id}, ...${cardLast4})`);
                try {
                    await store.cooldownCard(card.id, 30, 'Stripe拒付');
                } catch (error) {
                    await store.quarantineCardForReview(card.id, 'decline_cooldown_failed');
                    throw error;
                }
                await store.createBillingRecord({
                    card_number: card.card_number,
                    card_last4: cardLast4,
                    amount: billedAmount,
                    currency: billedCurrency,
                    plan_type: planType || 'plus',
                    platform: options.platform,
                    cdk_code: cdkCode,
                    email,
                    stripe_session_id: stripeSessionId || null,
                    status: 'failed',
                    error_code: 'card_declined',
                    error_message: lastError
                });
                declinedLast4s.push(cardLast4);

                if (cardAttempt < MAX_CARD_ATTEMPTS && paymentResult.canRetryCard !== false) {
                    progress(`卡 ...${cardLast4} 被拒，换上下一张卡 (${cardAttempt}/${MAX_CARD_ATTEMPTS})`);
                    continue;
                }

                const summary = declinedLast4s.length > 1
                    ? `${declinedLast4s.length} 张卡均被拒 (...${declinedLast4s.join(', ...')})`
                    : `银行卡被拒绝: ${lastError}`;
                return {
                    success: false,
                    error: summary,
                    cardLast4: lastCardLast4,
                    manualIntervention: true,
                    screenshots,
                    cardsDeclined: declinedLast4s.length,
                    paymentState
                };
            }

            if (paymentResult.captchaRequired || isCaptchaOrNonCard) {
                progress('非卡片故障（人机验证/页面超时/安全检查未完成），已安全释放银行卡');
            }

            await store.createBillingRecord({
                card_number: card.card_number,
                card_last4: cardLast4,
                amount: billedAmount,
                currency: billedCurrency,
                plan_type: planType || 'plus',
                platform: options.platform,
                cdk_code: cdkCode,
                email,
                stripe_session_id: stripeSessionId || null,
                status: 'failed',
                error_code: isPaymentGuardFailure
                    ? paymentResultCode
                    : (paymentResult.captchaRequired ? 'captcha_required' : 'form_validation_failed'),
                error_message: lastError
            });

            if (paymentResult.code === 'GROK_TAX_ADDRESS_REFUSED' && address?.id) {
                await store.runExecute?.('UPDATE tax_free_addresses SET is_active = 0 WHERE id = ?', [address.id]).catch(() => {});
                progress(`地址模板 #${address.id} 未通过官方税费校验，已自动移出可用地址池`);
            }

            // 非银行拒付：立即将卡片安全释放回卡池，保证处于正常可用状态
            await store.releaseCard(card.id, true);
            cardHandled = true;

            progress(`卡片 ...${cardLast4} 已恢复可用状态（非卡片问题，无需报废或冷却）`);
            return {
                success: false,
                error: `需要人工操作：${lastError}`,
                cardLast4,
                manualIntervention: true,
                paymentState,
                screenshots
            };
        } finally {
            if (card?.id && !cardHandled) {
                await store.releaseCard(card.id, true).catch(() => { });
            }
        }
    }

    const summary = declinedLast4s.length
        ? `${declinedLast4s.length} 张卡均被拒 (...${declinedLast4s.join(', ...')})`
        : (lastError || '支付失败');
    return {
        success: false,
        error: summary,
        cardLast4: lastCardLast4,
        manualIntervention: true,
        screenshots,
        cardsDeclined: declinedLast4s.length
    };
}

module.exports = {
    executePaymentWithRetry,
    isPaymentDeclined,
    MAX_AUTOMATION_ATTEMPTS,
    MAX_CARD_ATTEMPTS
};
