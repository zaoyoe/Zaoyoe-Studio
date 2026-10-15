'use strict';

const SUCCESS_COPY = /thank you for subscribing|subscription (?:is )?active|订阅成功|支付成功|已成功订阅/ig;
const DECLINE_COPY = /your card (?:was|has been) declined|card (?:was|has been) declined|payment (?:was )?(?:declined|not approved)|insufficient funds|do not honor|expired card|incorrect.*cvc|无法完成此(?:次)?购买|未能完成购买|unable to complete this purchase|this purchase cannot be completed|银行卡被拒绝|拒付/i;
const VERIFY_FAILED = /无法验证.*浏览器|未能验证.*浏览器|安全验证未完成|安全检查未完成|人机验证未完成|unable to verify (?:your )?browser|failed to verify (?:your )?browser|verification.*not completed/i;

function successEvidence(text = '') {
    const value = String(text);
    return [...new Set([...value.matchAll(SUCCESS_COPY)].filter(match => {
        const before = value.slice(Math.max(0, match.index - 28), match.index);
        const after = value.slice(match.index + match[0].length);
        return !/(?:未|没有|无法|如果|等待|待|not|no|whether|if)\s*$/i.test(before)
            && !/^\s*(?:后|时|[?？])/.test(after);
    }).map(match => match[0].toLowerCase()))];
}

function classifyClaudePaymentSnapshot(snapshot, previousSuccess = [], previousDecline = '', previousUrl = '') {
    let url;
    try { url = new URL(snapshot.url); } catch (_) { return { state: 'pending' }; }
    const text = String(snapshot.text || '');
    if (url.hostname === 'claude.ai' && /^\/(?:login|signup)(?:\/|$)/i.test(url.pathname)) {
        return { state: 'unknown', message: '提交后 Claude 会话跳转至登录页，支付结果需要复核' };
    }
    const verification = text.match(VERIFY_FAILED);
    if (verification) return { state: 'verification_failed', message: '官方安全验证未完成，支付结果需要复核' };
    const decline = text.match(DECLINE_COPY);
    if (decline && decline[0] !== previousDecline) return { state: 'declined', message: decline[0] };
    const trustedHost = ['claude.ai', 'checkout.stripe.com'].includes(url.hostname);
    let oldSuccessQuery = false;
    try { oldSuccessQuery = new URL(previousUrl).searchParams.get('redirect_status') === 'succeeded'; } catch (_) {}
    if (trustedHost && !oldSuccessQuery && url.searchParams.get('redirect_status') === 'succeeded') return { state: 'succeeded' };
    if (trustedHost && successEvidence(text).some(evidence => !previousSuccess.includes(evidence))) return { state: 'succeeded' };
    return { state: 'pending', processing: Boolean(snapshot.processing) };
}

async function readClaudePaymentSnapshot(page) {
    const snapshot = await page.evaluate(() => ({
        text: document.body?.innerText || '',
        processing: Array.from(document.querySelectorAll('[aria-busy="true"], button[disabled]')).some(el => el.getClientRects().length > 0)
    }));
    return { ...snapshot, url: page.url() };
}

function observeClaudePayment(page) {
    let disposed = false;
    let pending = false;
    const waiters = new Set();
    const wake = () => {
        if (disposed) return;
        pending = true;
        for (const resolve of [...waiters]) resolve();
    };
    const onResponse = response => {
        try {
            const host = new URL(response.url()).hostname;
            if (host === 'claude.ai' || host === 'stripe.com' || host.endsWith('.stripe.com')) wake();
        } catch (_) {}
    };
    const handlers = { response: onResponse, requestfailed: wake, framenavigated: wake,
        frameattached: wake, framedetached: wake, close: wake };
    for (const [event, handler] of Object.entries(handlers)) page.on(event, handler);
    return {
        async wait(timeoutMs = 250) {
            if (disposed || pending) { pending = false; return; }
            await new Promise(resolve => {
                const done = () => { clearTimeout(timer); waiters.delete(done); pending = false; resolve(); };
                const timer = setTimeout(done, timeoutMs);
                waiters.add(done);
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const [event, handler] of Object.entries(handlers)) page.off(event, handler);
            for (const resolve of [...waiters]) resolve();
        }
    };
}

function hasNewClaudeProEntitlement(before, after, planType) {
    if (!/^claude_pro(?:_annual|_yearly)?$/.test(planType || 'claude_pro')) return false;
    if (!before?.accountId || before.accountId !== after?.accountId || !before.orgId || before.orgId !== after.orgId
        || before.organizationCount !== 1 || after.organizationCount !== 1) return false;
    const paid = account => account.capabilities?.some(cap => ['claude_pro', 'pro'].includes(cap));
    return !paid(before) && paid(after);
}

async function waitForClaudePaymentOutcome(page, options) {
    const { observer, beforeSubmit, hasCaptcha, clearCaptcha, checkInlineError, screenshot,
        timeoutMs = 180000, captchaTimeoutMs = 180000, confirmEntitlement = async () => false } = options;
    const previousSuccess = successEvidence(beforeSubmit?.text);
    let previousDecline = beforeSubmit?.text?.match(DECLINE_COPY)?.[0] || '';
    let deadline = Date.now() + timeoutMs;
    let lastProgress = 0;
    let lastEntitlementCheck = 0;
    const unknown = async (message, captchaRequired = false) => ({
        success: false, submitted: true, submissionAttempted: true,
        code: 'PAYMENT_RESULT_UNKNOWN', error: message, captchaRequired,
        screenshot: await screenshot('payment_result_unknown')
    });
    while (Date.now() < deadline) {
        if (page.isClosed()) return unknown('提交后页面已关闭，支付结果需要复核');
        let snapshot;
        try { snapshot = await readClaudePaymentSnapshot(page); }
        catch (_) {
            if (page.isClosed()) return unknown('提交后页面已关闭，支付结果需要复核');
            await observer.wait(Math.min(250, Math.max(1, deadline - Date.now())));
            continue;
        }
        const state = classifyClaudePaymentSnapshot(snapshot, previousSuccess, previousDecline, beforeSubmit?.url);
        if (!snapshot.text.match(DECLINE_COPY)) previousDecline = '';
        if (state.state === 'succeeded') return { success: true, submitted: true, screenshot: await screenshot('payment_success') };
        if (state.state === 'declined') return {
            success: false, submitted: true, declined: true, canRetryCard: true,
            error: `银行卡被拒绝: ${state.message}`, screenshot: await screenshot('payment_declined')
        };
        if (state.state === 'unknown') return unknown(state.message);
        if (state.state === 'verification_failed') return unknown(state.message, true);
        if (new URL(snapshot.url).hostname === 'claude.ai' && !/^\/upgrade(?:\/|$)/.test(new URL(snapshot.url).pathname)
            && Date.now() - lastEntitlementCheck >= 5000) {
            lastEntitlementCheck = Date.now();
            if (await confirmEntitlement()) return { success: true, submitted: true, screenshot: await screenshot('payment_success') };
        }

        const [captcha, inline] = await Promise.all([hasCaptcha(), checkInlineError()]);
        if (inline.hasError) return unknown('提交后出现银行卡字段校验提示，支付结果需要复核');
        if (captcha) {
            const pauseStarted = Date.now();
            console.log('[Stripe] 检测到人机验证，进入原有交互协助流程...');
            const result = await clearCaptcha(captchaTimeoutMs);
            // Human interaction has its own existing deadline and is excluded from
            // the active payment-result wait budget. Never resubmit on verification copy.
            deadline += Date.now() - pauseStarted;
            if (result.paymentDeclined) return {
                success: false, submitted: true, declined: true, canRetryCard: true,
                error: `银行卡被拒绝: ${result.declineMsg || '官方确认购买失败'}`,
                screenshot: await screenshot('payment_declined')
            };
            if (!result.cleared) return unknown(result.message || '人机验证未完成，支付结果需要复核', true);
            console.log('[Stripe] ✅ 提交后人机验证已通过，继续观察支付结果');
            continue;
        }
        if (Date.now() - lastProgress >= 15000) {
            console.log(`[Stripe] 正在观察 Claude 支付结果${snapshot.processing ? '（官方处理中）' : ''}...`);
            lastProgress = Date.now();
        }
        await observer.wait(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    return unknown('等待官方支付结果超时，已暂停自动重试，请人工复核');
}

module.exports = { observeClaudePayment, readClaudePaymentSnapshot, classifyClaudePaymentSnapshot,
    hasNewClaudeProEntitlement, waitForClaudePaymentOutcome };
