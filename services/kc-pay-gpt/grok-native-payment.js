'use strict';
const { grokError } = require('./grok-checkout-state');
const { checkoutDialog, uniqueVisible, visibleMatches, waitNativeCheckoutReady, assertNativeCheckoutReady } = require('./grok-native-checkout');
const { fillNativeBilling, assertNativeBilling } = require('./grok-native-billing');
const { waitNativeTaxReady } = require('./grok-native-tax');
const { normalizeNativeBillingAddress } = require('./grok-billing-address');
const { hasAnyCheckoutCaptchaSignal, clearHumanVerification } = require('./human-verification');

async function nativeCardFields(page, { timeoutMs = 12000, select = false } = {}) {
    const deadline = Date.now() + timeoutMs;
    const selectedFrames = new Set();
    do {
        if (page.isClosed()) throw grokError('GROK_FORM_UNCONFIRMED', '银行卡表单页面已关闭');
        const candidates = [];
        for (const frame of page.frames()) {
            if (frame === page.mainFrame() || frame.isDetached()) continue;
            let url; try { url = new URL(frame.url()); } catch (_) { continue; }
            const params = new URLSearchParams(url.hash.slice(1));
            const paymentFrame = /^\/v3\/elements-inner-payment-[\w-]+\.html$/.test(url.pathname)
                || /^\/v3\/elements-inner-accessory-target-[\w-]+\.html$/.test(url.pathname)
                    && params.get('componentName') === 'payment' && params.get('elementId')?.startsWith('payment-');
            if (url.protocol !== 'https:' || url.hostname !== 'js.stripe.com' || url.port || url.username || url.password || !paymentFrame) continue;
            const element = await frame.frameElement().catch(() => null);
            if (!element || !await element.isVisible()) continue;
            const dialog = await checkoutDialog(page);
            if (!await dialog.evaluate((el, iframe) => el.contains(iframe), element)) continue;
            if (select && !selectedFrames.has(frame)) {
                const cards = await visibleMatches(frame.getByRole('button', { name: /^(银行卡|卡|Card|Credit or debit card)$/i })
                    .or(frame.getByRole('tab', { name: /^(银行卡|卡|Card|Credit or debit card)$/i })));
                if (cards.length > 1) throw grokError('GROK_FORM_UNCONFIRMED', '银行卡支付方式存在多个匹配');
                if (cards[0] && await cards[0].getAttribute('aria-expanded') !== 'true'
                    && await cards[0].getAttribute('aria-selected') !== 'true') {
                    const alreadyExpanded = await frame.locator('input[autocomplete="cc-number"],#payment-numberInput').isVisible();
                    if (!alreadyExpanded) await cards[0].click({ timeout: 3000 });
                }
                if (cards[0]) selectedFrames.add(frame);
            }
            const selectors = ['input[autocomplete="cc-number"],#payment-numberInput',
                'input[autocomplete="cc-exp"],#payment-expiryInput', 'input[autocomplete="cc-csc"],#payment-cvcInput'];
            const inputs = [];
            for (const selector of selectors) {
                const matches = await visibleMatches(frame.locator(selector));
                if (matches.length !== 1 || !await matches[0].isEnabled()) break;
                inputs.push(matches[0]);
            }
            if (inputs.length === 3) candidates.push(inputs);
        }
        if (candidates.length > 1) throw grokError('GROK_FORM_UNCONFIRMED', '存在多个可见 Stripe 银行卡表单');
        if (candidates[0]) return candidates[0];
        if (Date.now() < deadline) await page.waitForTimeout(Math.min(120, deadline - Date.now()));
    } while (Date.now() < deadline);
    throw grokError('GROK_FORM_UNCONFIRMED', '官方 Stripe 银行卡字段未就绪，尚未提交支付');
}
function cardValues(card, helpers) {
    return [helpers.normalizeCardNumber(card.number), helpers.normalizeCardExpiry(card.expiry), String(card.cvc).trim()];
}
async function fillNativeCard(page, card, helpers) {
    const fields = await nativeCardFields(page, { select: true });
    const values = cardValues(card, helpers);
    for (let i = 0; i < fields.length; i++) { await fields[i].fill(values[i], { timeout: 4000 }); await fields[i].press('Tab', { timeout: 4000 }); }
    await assertNativeCard(page, card, helpers);
}
async function assertNativeCard(page, card, helpers) {
    const fields = await nativeCardFields(page, { timeoutMs: 0 }), values = cardValues(card, helpers);
    for (let i = 0; i < fields.length; i++) {
        if ((await fields[i].inputValue()).replace(/\D/g, '') !== values[i].replace(/\D/g, '')
            || await fields[i].getAttribute('aria-invalid') === 'true') throw grokError('GROK_FORM_UNCONFIRMED', '银行卡字段未通过提交前校验');
    }
}
async function isTermsConfirmed(checkbox) {
    const aria = await checkbox.getAttribute('aria-checked').catch(() => null);
    if (aria === 'true') return true;
    if (aria === 'false' || aria === 'mixed') return false;
    return await checkbox.isChecked().catch(() => false);
}

async function acceptNativeTerms(page) {
    const dialog = await checkoutDialog(page);
    const labels = dialog.locator('label').filter({ has: page.locator('a[href="https://x.ai/legal/bundled-subscription-terms?us=unified"]') });
    const label = await uniqueVisible(labels, '新版订阅条款');
    const text = await label.innerText();
    if (/迁移|合并|统一账号|取消.*旧|migrat|merge|unif|cancel.*existing/i.test(text)) throw grokError('GROK_MIGRATION_REQUIRED', '条款涉及账号合并或订阅迁移，已停止');
    const customBoxes = await visibleMatches(label.locator('[role="checkbox"]'));
    let checkbox;
    if (customBoxes.length === 1) {
        checkbox = customBoxes[0];
    } else if (customBoxes.length === 0) {
        const inputBoxes = await visibleMatches(label.locator('input[type="checkbox"]'));
        if (inputBoxes.length === 1) checkbox = inputBoxes[0];
    }
    if (!checkbox) {
        checkbox = await uniqueVisible(label.getByRole('checkbox'), '订阅条款复选框');
    }
    if (!await isTermsConfirmed(checkbox)) await checkbox.click({ timeout: 3000 });
    if (!await isTermsConfirmed(checkbox)) throw grokError('GROK_FORM_UNCONFIRMED', '订阅条款未被确认');
    return checkbox;
}
const NATIVE_DECLINE_PATTERNS = /your payment method was declined|your card (?:was|has been) declined|card (?:was|has been) declined|payment (?:method )?(?:was )?declined|insufficient funds|do not honor|银行卡被拒绝|支付方式被拒绝|付款方式已被拒绝/i;

async function checkNativePaymentDecline(page) {
    try {
        const dialog = await checkoutDialog(page).catch(() => null);
        if (!dialog) return null;
        const candidates = dialog.locator('[role="alert"], [data-slot*="alert"], [class*="alert"], [class*="Error"], [class*="error"], p, div');
        const count = await candidates.count().catch(() => 0);
        for (let i = 0; i < Math.min(count, 30); i++) {
            const el = candidates.nth(i);
            if (!await el.isVisible().catch(() => false)) continue;
            const text = (await el.innerText().catch(() => '')).trim();
            if (!text || text.length > 200) continue;
            if (/success|succeeded|成功/i.test(text)) continue;
            if (NATIVE_DECLINE_PATTERNS.test(text)) {
                return text;
            }
        }
    } catch (_) {}
    return null;
}

async function waitNativePaymentOutcome(page, observer, options = {}) {
    const deadline = Date.now() + (options.timeoutMs ?? 180000);
    let nextLog = Date.now() + 10000;
    do {
        const result = observer.result();
        if (result) return result;
        if (page.isClosed()) break;
        if (await (options.hasCaptcha || (() => hasAnyCheckoutCaptchaSignal(page)))()) {
            const clear = options.clearCaptcha || (maxWaitMs => clearHumanVerification(page, {
                phase: 'grok-commerce-post-submit', maxWaitMs, requireCheckoutReady: false,
                useVisualSolver: false, overlayWaitMs: 0
            }));
            await clear(Math.max(1, deadline - Date.now()));
            if (observer.result()) return observer.result();
        }
        if (!observer.isPending?.()) {
            const declineText = await checkNativePaymentDecline(page);
            if (declineText) {
                console.warn(`[Grok/payment] 官方结账界面提示拒付: ${declineText}`);
                observer.recordDecline?.(`支付卡被官方系统拒付: ${declineText}`);
                return observer.result() || {
                    success: false, submitted: true, declined: true, canRetryCard: true,
                    error: `支付卡被官方系统拒付: ${declineText}`
                };
            }
        }
        if (Date.now() >= nextLog) { console.log('[Grok] 等待本次官方购买状态确认，不重复提交...'); nextLog = Date.now() + 10000; }
        await page.waitForTimeout(Math.min(150, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    return { success: false, code: 'PAYMENT_RESULT_UNKNOWN', submitted: true, canRetryCard: false,
        error: '支付结果暂未确认，已暂停自动重试并转人工复核' };
}
async function completeGrokCommercePayment(page, card, address, options, helpers) {
    let submitted = false, due = null, stage = 'session';
    const observer = options.grokCheckout?.commerceObserver;
    try {
        if (!observer || observer.plan.key !== options.planType || !options.grokAccount?.ok
            || options.grokAccount.platformMode !== 'grok_web' || !options.grokAccount.email) throw grokError('GROK_AUTH_UNCONFIRMED', '新版订阅的官方账号和结账会话未完整确认');
        // Also guard direct driver calls before any card data reaches the page.
        stage = 'address';
        address = normalizeNativeBillingAddress(address);
        stage = 'checkout';
        await waitNativeCheckoutReady(page, observer, { timeoutMs: options.checkoutTimeoutMs ?? 12000 });
        stage = 'card';
        await fillNativeCard(page, card, helpers);
        console.log('[Grok] 原生银行卡字段已完整填写，等待动态账单字段和官方税费...');
        stage = 'billing';
        const billing = await fillNativeBilling(page, address, card.holder || options.holderName, options.grokAccount.email);
        stage = 'tax';
        observer.setBillingAddress(address);
        due = await waitNativeTaxReady(page, observer, billing, { timeoutMs: options.checkoutTimeoutMs ?? 15000 });
        stage = 'terms';
        const checkbox = await acceptNativeTerms(page);
        stage = 'submit_ready';
        const dialog = await checkoutDialog(page);
        const button = await uniqueVisible(dialog.getByRole('button', { name: /^(订阅并付款|订阅并支付|Subscribe\s*(?:&|and)\s*Pay)$/i }), '订阅付款按钮');
        await button.click({ trial: true, timeout: 5000 });
        await assertNativeBilling(page, billing); await assertNativeCard(page, card, helpers);
        due = await assertNativeCheckoutReady(page, observer, { final: true });
        stage = 'persist';
        if (typeof options.onPaymentAttemptStarted === 'function') await options.onPaymentAttemptStarted();
        submitted = true;
        stage = 'pre_submit';
        // Recheck after asynchronous persistence, then bind the exact cart before
        // this one UI click. Subsequent uncertainty never authorizes another click.
        await assertNativeBilling(page, billing); await assertNativeCard(page, card, helpers);
        due = await assertNativeCheckoutReady(page, observer, { final: true });
        if (!await isTermsConfirmed(checkbox)) throw grokError('GROK_FORM_UNCONFIRMED', '提交前订阅条款状态发生变化');
        observer.arm(due, options.grokAccount.email);
        console.log(`[Grok] 已核对今日应付 USD ${due.amount}，后续${due.interval === 'year' ? '每年' : '每月'} USD ${due.recurringAmount}，单次提交...`);
        stage = 'submit';
        await button.click({ timeout: 5000 });
        stage = 'result';
        const result = await waitNativePaymentOutcome(page, observer, { timeoutMs: options.resultTimeoutMs ?? 180000 });
        return { ...result, submitted: true, submissionAttempted: true, dueAmount: due.amount, dueCurrency: due.currency,
            holderName: card.holder || options.holderName,
            subscriptionId: result?.subscriptionId || observer.result()?.subscriptionId || null };
    } catch (error) {
        const guarded = /^GROK_[A-Z_]+$/.test(error?.code || '');
        const code = submitted ? 'PAYMENT_RESULT_UNKNOWN' : guarded ? error.code : 'GROK_FORM_UNCONFIRMED';
        const billingStage = ['country','line1','city','zip','state','line2','name','email','suggestions','readback'].includes(error?.billingStage) ? error.billingStage : null;
        const step = stage === 'billing' && billingStage ? `billing.${billingStage}` : stage;
        let location = 'other';
        try {
            if (page.isClosed()) location = 'closed';
            else {
                const url = new URL(page.url());
                if (url.origin === 'https://grok.com') location = url.pathname === '/plans' ? 'plans' : url.pathname === '/' ? 'home' : 'other';
            }
        } catch (_) { /* diagnostics never replace the original failure */ }
        const timeout = error?.name === 'TimeoutError' || error?.billingFailure === 'timeout';
        console.warn(`[Grok/native] 操作未完成: step=${step}, code=${code}, reason=${timeout ? 'timeout' : guarded ? 'guard' : 'operation'}, page=${location}, submitted=${submitted}`);
        if (stage === 'tax' && typeof observer?.taxDiagnostics === 'function') {
            console.warn(`[Grok/tax] 税费核验诊断: ${JSON.stringify(observer.taxDiagnostics())}`);
        }
        // Never infer a bank decline from generic text or an uncorrelated DOM alert.
        return { success: false, submitted, submissionAttempted: submitted, declined: false, canRetryCard: false,
            code, failureStage: step,
            error: submitted ? '支付结果未知，请人工核对，系统不会再次提交' : guarded ? error.message
                : `新版结账 ${step} 操作${timeout ? '超时' : '失败'}，尚未提交支付 [${code}]`,
            ...(due ? { dueAmount: due.amount, dueCurrency: due.currency } : {}) };
    }
}
module.exports = { completeGrokCommercePayment, waitNativePaymentOutcome, nativeCardFields, assertNativeCard, acceptNativeTerms };
