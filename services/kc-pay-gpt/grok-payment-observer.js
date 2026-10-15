'use strict';

const { checkoutSessionId, getGrokPlan, grokError, isGrokCheckoutUrl } = require('./grok-checkout-state');
const DECLINE = /your card (?:was|has been) declined|card (?:was|has been) declined|insufficient funds|do not honor|银行卡被拒绝|拒付/i;
const VERIFIED_FAILURE = /安全验证未完成|无法验证.*浏览器|unable to verify (?:your )?browser|verification.*not completed/i;
const SUCCESS = /^(?:Payment successful|Payment complete|Thank you for subscribing[.!]?|支付成功|已成功订阅)$/i;
const declineCodes = new Set(['card_declined', 'insufficient_funds', 'expired_card', 'incorrect_cvc', 'lost_card', 'stolen_card']);

async function readGrokPaymentSnapshot(page) {
    const snapshot = await page.evaluate(() => {
        const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        return { text: [...document.querySelectorAll('h1,h2,[role="alert"],[role="status"],.Error,.FieldError')]
            .filter(visible).map(el => el.innerText.trim()).join('\n'), body: document.body?.innerText || '' };
    });
    return { ...snapshot, url: page.url() };
}

function classifyGrokPaymentSnapshot(snapshot, before, sessionId) {
    let url;
    try { url = new URL(snapshot.url); } catch (_) { return { state: 'unknown' }; }
    if (VERIFIED_FAILURE.test(snapshot.body || '')) return { state: 'unknown', captchaRequired: true };
    // A new explicit Stripe failure is safe for card rotation. Generic purchase
    // errors and form errors remain unknown after the payment click.
    if (isGrokCheckoutUrl(url.href) && checkoutSessionId(url.href) === sessionId) {
        const decline = snapshot.text.match(DECLINE)?.[0];
        if (decline && !before.text.includes(decline)) return { state: 'declined', message: decline };
        const lines = snapshot.text.split('\n').map(line => line.trim());
        if (lines.some(line => SUCCESS.test(line) && !before.text.split('\n').includes(line))) return { state: 'succeeded' };
    }
    const returnSession = url.searchParams.get('checkout_session_id') || url.searchParams.get('session_id');
    if (url.protocol === 'https:' && ['grok.com', 'x.com', 'checkout.stripe.com'].includes(url.hostname)
        && returnSession === sessionId && url.searchParams.get('redirect_status') === 'succeeded' && url.href !== before.url) {
        return { state: 'succeeded' };
    }
    if (['grok.com', 'x.com', 'accounts.x.ai'].includes(url.hostname) && /login|sign-in/.test(url.pathname)) return { state: 'unknown' };
    return { state: 'pending' };
}

function observeGrokPayment(page, planType) {
    const sessionId = checkoutSessionId(page.url());
    const plan = getGrokPlan(planType);
    let armed = false, disposed = false, pending = false, terminal = null;
    const requests = new Set(), waiters = new Set();
    const wake = () => { pending = true; for (const done of [...waiters]) done(); };
    const onRequest = request => { if (armed) requests.add(request); };
    const onResponse = async response => {
        if (disposed || !armed || !requests.has(response.request())) return;
        let url;
        try { url = new URL(response.url()); } catch (_) { return; }
        // Correlate the response to this checkout session, rather than accepting
        // an unrelated PaymentIntent or a session left over from another attempt.
        if (url.protocol !== 'https:' || url.hostname !== 'api.stripe.com'
            || !url.pathname.startsWith(`/v1/payment_pages/${sessionId}/`)) return;
        try {
            const data = await response.json();
            if (disposed) return;
            if (response.ok() && data.payment_status === 'paid' && data.status === 'complete') {
                const currencyOk = !data.currency || data.currency.toUpperCase() === plan.currency;
                const amount = data.amount_total ?? data.total;
                terminal = currencyOk && (amount == null || Number(amount) === Math.round(plan.amount * 100))
                    ? { state: 'succeeded' } : { state: 'unknown' };
            } else if (/\/confirm$/.test(url.pathname) && declineCodes.has(data.error?.code)) {
                terminal = { state: 'declined', message: '官方确认银行卡被拒绝' };
            }
        } catch (_) { /* Unrecognized or incomplete responses cannot prove success. */ }
        wake();
    };
    const handlers = { request: onRequest, response: onResponse, framenavigated: wake, requestfailed: wake, close: wake };
    for (const [event, handler] of Object.entries(handlers)) page.on(event, handler);
    return {
        sessionId,
        arm() { armed = true; terminal = null; requests.clear(); },
        terminal() { return terminal; },
        async wait(timeoutMs = 250) {
            if (disposed || pending) { pending = false; return; }
            await new Promise(resolve => {
                const done = () => { clearTimeout(timer); waiters.delete(done); pending = false; resolve(); };
                const timer = setTimeout(done, timeoutMs); waiters.add(done);
            });
        },
        dispose() {
            disposed = true;
            for (const [event, handler] of Object.entries(handlers)) page.off(event, handler);
            for (const done of [...waiters]) done();
            requests.clear();
        }
    };
}

async function clickGrokSubmitOnce(page, beforeSubmit) {
    if (!isGrokCheckoutUrl(page.url())) throw grokError('GROK_CHECKOUT_UNTRUSTED', '无法确认 Grok 提交页面');
    // No generic text search or email-repair resubmission after dispatch.
    const locator = page.locator('button[type="submit"], [data-testid="hosted-payment-submit-button"]')
        .filter({ hasText: /^\s*(Subscribe|Pay|订阅|支付|确认支付)(?:\s+(?:USD\s*)?\$?\d+(?:\.\d+)?)?\s*$/i });
    const visible = [];
    for (let i = 0, count = await locator.count(); i < count; i++) {
        if (await locator.nth(i).isVisible()) visible.push(locator.nth(i));
    }
    if (visible.length !== 1) throw grokError('GROK_SUBMIT_UNCONFIRMED', '未确认唯一 Grok 支付提交按钮，尚未提交');
    const button = visible[0];
    await button.click({ trial: true, timeout: 8000 });
    const invalid = await page.locator('input:invalid, select:invalid').evaluateAll(elements => elements.some(el => el.getClientRects().length));
    if (invalid) throw grokError('GROK_FORM_UNCONFIRMED', 'Grok 支付表单有未通过校验的字段，尚未提交');
    await beforeSubmit();
    await button.click({ timeout: 8000 });
}

async function waitForGrokPaymentOutcome(page, options) {
    const { observer, beforeSubmit, hasCaptcha, clearCaptcha, checkInlineError, screenshot = async () => null,
        timeoutMs = 180000, captchaTimeoutMs = 180000 } = options;
    let deadline = Date.now() + timeoutMs;
    let baseline = beforeSubmit;
    const unknown = async (captchaRequired = false) => ({ success: false, submitted: true, submissionAttempted: true,
        declined: false, canRetryCard: false, code: 'PAYMENT_RESULT_UNKNOWN', captchaRequired,
        error: 'Grok 支付结果未确认，已停止自动重试，请人工复核', screenshot: await screenshot('grok_payment_unknown') });
    while (Date.now() < deadline) {
        let state = observer.terminal();
        if (!state) {
            if (page.isClosed()) return unknown();
            try {
                const snapshot = await readGrokPaymentSnapshot(page);
                state = classifyGrokPaymentSnapshot(snapshot, baseline, observer.sessionId);
                if (!DECLINE.test(snapshot.text)) baseline = { ...baseline, text: baseline.text.replace(DECLINE, '') };
            } catch (_) { await observer.wait(250); continue; }
        }
        if (state.state === 'succeeded') return { success: true, submitted: true, screenshot: await screenshot('grok_payment_success') };
        if (state.state === 'declined') return { success: false, submitted: true, declined: true, canRetryCard: true,
            error: `银行卡被拒绝: ${state.message}`, screenshot: await screenshot('grok_payment_declined') };
        if (state.state === 'unknown') return unknown(state.captchaRequired);
        const [captcha, inline] = await Promise.all([hasCaptcha(), checkInlineError()]);
        if (inline.hasError) return unknown();
        if (captcha) {
            const pauseStarted = Date.now();
            const result = await clearCaptcha(captchaTimeoutMs);
            deadline += Date.now() - pauseStarted;
            // The shared captcha handler's broad "purchase failed" detection is
            // not authoritative for Grok. Re-read this checkout's result instead.
            if (!result.cleared && !result.paymentDeclined) return unknown(true);
        }
        await observer.wait(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    return unknown();
}

module.exports = { observeGrokPayment, readGrokPaymentSnapshot, classifyGrokPaymentSnapshot,
    clickGrokSubmitOnce, waitForGrokPaymentOutcome };
