'use strict';

const { performance } = require('node:perf_hooks');
const { getClaudePlanRule, readClaudeCheckoutSnapshot, ensureClaudePlanSelection } = require('./claude-checkout-state');
const { observeClaudeNavigation, assertClaudeNavigationHealthy, buildClaudeNavigationError } = require('./claude-navigation');

function recoveryNotAllowed() {
    return Object.assign(new Error('Claude 已进入填卡或支付阶段，已停止收银台自动恢复'), { code: 'CLAUDE_CHECKOUT_RECOVERY_NOT_ALLOWED' });
}

async function assertRecoveryAllowed(page, options) {
    if (options.phase !== 'before_card_entry' || (options.paymentState || 'not_started') !== 'not_started') throw recoveryNotAllowed();
    await assertClaudeNavigationHealthy(page);
    for (const frame of page.frames()) {
        const isPaymentFrame = /^https:\/\/js\.stripe\.com\//.test(frame.url())
            && /elements-inner-(?:payment|card)|embedded-checkout/i.test(frame.url());
        if (frame !== page.mainFrame() && !isPaymentFrame) continue;
        // Return booleans only. Do not transfer card, address or account values
        // into Node, diagnostics, or exception messages.
        const unsafe = await frame.evaluate(paymentFrame => {
            const selector = paymentFrame
                ? 'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]), textarea'
                : 'input[autocomplete^="cc-"], input[name="cardnumber"], input[name="cardNumber"], input[name="cvc"]';
            const entered = Array.from(document.querySelectorAll(selector)).some(el => Boolean(el.value?.trim()));
            const processing = /payment (?:succeeded|processing)|processing (?:payment|purchase)|thank you for subscribing|your card (?:was|has been) declined|支付成功|订阅成功|正在支付|支付处理中|无法完成此次购买/i.test(document.body?.innerText || '');
            return entered || processing;
        }, isPaymentFrame);
        if (unsafe) throw recoveryNotAllowed();
    }
}

function createWaitPolicy(rule, deadline, observer, options) {
    const graceMs = options.progressGraceMs ?? 15000;
    const log = options.log || console.log;
    const milestones = snapshot => [
        snapshot.target && 'target',
        snapshot.target && snapshot.receivesPointer && 'actionable',
        snapshot.selected.length === 1 && snapshot.selected[0] === rule.key && 'selected',
        snapshot.summaryPlan === rule.key && !snapshot.summaryConflict && 'summary',
        snapshot.due && !snapshot.dueConflict && snapshot.due.currency === rule.currency
            && Math.abs(snapshot.due.amount - rule.amount) < 0.005 && 'total',
        snapshot.stripePaymentFrameCount > 0 && 'stripe_frame',
        !snapshot.loadingSkeleton && 'skeleton_gone'
    ].filter(Boolean);
    let seen = new Set();
    let lastProgress = performance.now();
    let progressed = false;
    const extendedStages = new Set();
    return {
        remaining: () => Math.max(0, deadline - performance.now()),
        reset(snapshot) {
            seen = new Set(milestones(snapshot));
            lastProgress = performance.now(); progressed = false; extendedStages.clear();
        },
        noteProgress(snapshot) {
            const fresh = milestones(snapshot).filter(key => !seen.has(key));
            if (fresh.length) {
                fresh.forEach(key => seen.add(key));
                lastProgress = performance.now(); progressed = true;
            }
        },
        assertNetwork() {
            if (observer.networkFailure()) throw buildClaudeNavigationError('network');
        },
        canContinue(snapshot, stageDeadline, stage) {
            this.noteProgress(snapshot);
            this.assertNetwork();
            const now = performance.now();
            if (now >= deadline || (snapshot.formLoadError && stage !== 'recovered_controls')) return false;
            if (now < stageDeadline) return true;
            if (!progressed || now - lastProgress >= graceMs) return false;
            if (!extendedStages.has(stage)) {
                extendedStages.add(stage);
                log(`[Claude/checkout] ${stage} 仍有实际加载进展，在剩余总预算内继续等待`);
            }
            return true;
        }
    };
}

// Only the initial checkout opening calls this function. Filling/replacing a
// card and post-submit result observation use strict checks without this policy.
async function prepareClaudeCheckout(page, planType = 'claude_pro', options = {}) {
    if (options.phase !== 'before_card_entry' || (options.paymentState || 'not_started') !== 'not_started') throw recoveryNotAllowed();
    const rule = getClaudePlanRule(planType);
    const totalMs = options.totalTimeoutMs ?? 60000;
    const deadline = performance.now() + totalMs;
    const log = options.log || console.log;
    const observer = observeClaudeNavigation(page);
    const policy = createWaitPolicy(rule, deadline, observer, options);
    let recovered = false;
    try {
        policy.reset(await readClaudeCheckoutSnapshot(page, planType));
        while (true) {
            try {
                return await ensureClaudePlanSelection(page, planType, {
                    timeoutMs: Math.min(options.readinessTimeoutMs ?? 30000, Math.max(1, policy.remaining())),
                    confirmationTimeoutMs: Math.min(options.confirmationTimeoutMs ?? 15000, Math.max(1, policy.remaining())),
                    networkObserver: observer, waitPolicy: policy, afterRecovery: recovered
                });
            } catch (error) {
                if (recovered || page.isClosed() || policy.remaining() <= 0
                    || !['CLAUDE_CHECKOUT_LOADING_TIMEOUT', 'CLAUDE_CHECKOUT_CONTROLS_TIMEOUT'].includes(error.code)) throw error;
                policy.assertNetwork();
                await assertRecoveryAllowed(page, options);
                if (policy.remaining() <= 0) throw error;
                // One shared recovery allowance, not one Retry plus one reload.
                recovered = true;
                log(`[Claude/checkout] 加载停滞，执行一次支付前恢复；剩余总预算 ${Math.ceil(policy.remaining() / 1000)}s`);
                log(`[Claude/checkout] 官方请求诊断: ${observer.summary()}; ${observer.details()}`);
                const retry = page.getByRole('button', { name: /^重试$|^Retry$/i }).first();
                if (await retry.isVisible()) {
                    log('[Claude/checkout] 使用官方支付表单“重试”入口（1/1）');
                    try {
                        await retry.click({ timeout: Math.max(1, Math.min(3000, policy.remaining())) });
                    } catch (retryError) {
                        if (retryError.name !== 'TimeoutError' || page.isClosed()) throw retryError;
                        policy.assertNetwork();
                        await assertClaudeNavigationHealthy(page);
                        // Keep the classified prepayment loading error; an
                        // unclickable Retry does not grant a second recovery.
                        throw error;
                    }
                } else {
                    log('[Claude/checkout] 同一浏览器、同一代理刷新当前收银台（1/1）');
                    try {
                        const response = await page.reload({ waitUntil: 'commit', timeout: Math.max(1, Math.min(8000, policy.remaining())) });
                        if (response?.status() >= 400) throw buildClaudeNavigationError('http');
                    } catch (reloadError) {
                        if (String(reloadError.code || '').startsWith('CLAUDE_NAV_') || page.isClosed()) throw reloadError;
                        throw buildClaudeNavigationError(reloadError.name === 'TimeoutError' ? 'timeout' : 'network');
                    }
                }
                await assertClaudeNavigationHealthy(page);
                policy.reset(await readClaudeCheckoutSnapshot(page, planType));
            }
        }
    } catch (error) {
        log(`[Claude/checkout] 官方请求诊断: ${observer.summary()}; ${observer.details()}`);
        throw error;
    } finally { observer.dispose(); }
}

module.exports = { prepareClaudeCheckout };
