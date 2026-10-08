'use strict';

const KNOWN_PAYMENT_STATES = new Set(['not_started', 'started', 'succeeded', 'declined', 'unknown']);

function normalizePaymentState(value) {
    const state = String(value || '').trim().toLowerCase();
    return KNOWN_PAYMENT_STATES.has(state) ? state : 'unknown';
}


const PAYMENT_STATE_RANK = Object.freeze({
    not_started: 0,
    declined: 1,
    started: 2,
    unknown: 3,
    succeeded: 4
});

function mergePaymentState(previousState, nextState) {
    const previous = normalizePaymentState(previousState);
    const next = normalizePaymentState(nextState);
    // 终态不可被低优先级状态覆盖；started/unknown 也不能回退到未提交或拒付。
    return PAYMENT_STATE_RANK[next] >= PAYMENT_STATE_RANK[previous] ? next : previous;
}

function classifyPaymentResult({ success = false, declined = false, submitted = null, submissionAttempted = null, previousState = 'not_started' } = {}) {
    if (success) return 'succeeded';
    if (declined) return 'declined';
    if (submitted === false || submissionAttempted === false) {
        const previous = normalizePaymentState(previousState);
        return previous === 'declined' ? 'declined' : 'not_started';
    }
    if (submitted === true || submissionAttempted === true) return 'unknown';
    // 未提供支付提交证据时按保守规则处理：若已有 started/unknown，保持人工复核；
    // 首次且没有任何提交迹象的前置失败不应升级为“支付结果未知”。
    const previous = normalizePaymentState(previousState);
    return ['started', 'unknown', 'succeeded'].includes(previous) ? previous : 'not_started';
}

function shouldRetainCdk({ executionMode, paymentState, recovery = false } = {}) {
    const mode = String(executionMode || 'legacy_unknown').trim().toLowerCase();
    const state = normalizePaymentState(paymentState);
    if (recovery && mode !== 'local_card_pool') return true;
    return state === 'started' || state === 'unknown' || state === 'succeeded';
}

function classifyAutoRenewCancellation(result = {}) {
    const data = result.data || result;
    if (data.alreadyCancelled === true || data.autoRenewRaw === false) {
        return 'already_disabled';
    }
    if (data.verificationUnknown === true || result.ok === false) {
        return 'verification_unknown';
    }
    if (data.requestSubmitted === true || data.cancelled === true) {
        return 'verification_unknown';
    }
    return 'disable_failed';
}

function classifyInterruptedTask(task = {}) {
    const executionMode = task.execution_mode || 'legacy_unknown';
    const paymentState = task.payment_state || 'unknown';
    const retainCdk = shouldRetainCdk({ executionMode, paymentState, recovery: true });
    return {
        status: retainCdk ? 'manual' : 'failed',
        retainCdk,
        retainCardLocks: retainCdk && String(executionMode).toLowerCase() === 'local_card_pool',
        paymentState: normalizePaymentState(paymentState)
    };
}

module.exports = {
    KNOWN_PAYMENT_STATES,
    normalizePaymentState,
    mergePaymentState,
    PAYMENT_STATE_RANK,
    classifyPaymentResult,
    shouldRetainCdk,
    classifyAutoRenewCancellation,
    classifyInterruptedTask
};
