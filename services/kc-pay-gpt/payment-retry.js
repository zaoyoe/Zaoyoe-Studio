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
        if (curr === 'USD') {
            if (plan === 'plus') return { amount: 20, label: 'Plus $20' };
            if (plan === 'go') return { amount: 8, label: 'Go $8' };
            if (/pro_?200|pro_?20x|pro_?more/i.test(plan)) return { amount: 200, label: 'Pro More usage $200' };
            if (/pro_?500|pro_?max/i.test(plan)) return { amount: 500, label: 'Pro Max usage $500' };
            if (/pro_?100|pro_?5x|^pro$/i.test(plan)) return { amount: 100, label: 'Pro Standard $100' };
        }
        if (curr === 'PHP') {
            if (/pro_?200|pro_?20x|pro_?more/i.test(plan)) return { min: 8900, max: 10000, label: 'Pro More usage ₱9,990' };
            if (/pro_?500|pro_?max/i.test(plan)) return { min: 28000, max: 33000, label: 'Pro Max usage ₱32,490' };
            if (/pro_?100|pro_?5x|^pro$/i.test(plan)) return { min: 5700, max: 6550, label: 'Pro Standard ₱6,490' };
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
    const { platform = 'chatgpt', planType, cdkCode, email, onProgress, stripeSessionId, onPaymentState } = options || {};
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
        if (grokBundle) assertNativeBillingRegion(region, currency);
        const lastUsedIdRaw = await store.getAppConfigValue('last_used_address_id', null);
        const lastUsedId = lastUsedIdRaw ? Number(lastUsedIdRaw) : null;
        address = grokBundle
            ? normalizeNativeBillingAddress(await pickBillingAddressForCheckout(region, lastUsedId, { strategy: 'oregon' }))
            : await pickBillingAddressForCheckout(region, lastUsedId);
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
    const requiresCurrencyPreflight = platform === 'chatgpt' || !options?.platform;
    try {
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

    for (let cardAttempt = 1; cardAttempt <= MAX_CARD_ATTEMPTS; cardAttempt += 1) {
        const card = await store.reserveCard(ownerKey);
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
