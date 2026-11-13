'use strict';
const { isChatGptAuthFailure } = require('./chatgpt-auth-state');

function classifyChatGptAuthFailure(message, paymentState) {
    if (!isChatGptAuthFailure(message)) return null;
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    return { status: 'failed', message, reachedPayment: false, shouldRetry: false,
        deletePhone: false, deleteCard: false, paymentState: 'not_started' };
}

function classifyAccountAlreadySubscribed(message, paymentState) {
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    const text = String(message || '');
    if (!text.includes('ACCOUNT_ALREADY_SUBSCRIBED') && !text.includes('已有有效') && !text.includes('already_subscribed')) {
        return null;
    }
    return {
        status: 'failed',
        message: '该账号已有有效 Plus 订阅，无需重复充值，请更换其他未订阅账号',
        reachedPayment: false,
        shouldRetry: false,
        deletePhone: false,
        deleteCard: false,
        paymentState: 'not_started'
    };
}

function classifyChatGptNavigationFailure(message, paymentState, fullOutput = '') {
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    const text = `${String(message || '')} ${String(fullOutput || '')}`;
    const hasNavTimeout = text.includes('[CHATGPT_NAV_TIMEOUT]')
        || text.includes('[CHECKOUT_RENDER_TIMEOUT]')
        || /page\.goto:\s*Timeout\s*\d*ms\s*exceeded/i.test(text)
        || (/Timeout\s*\d*ms\s*exceeded/i.test(text) && /chatgpt\.com/i.test(text));
    if (!hasNavTimeout) return null;
    return {
        status: 'retry',
        message: text.includes('[CHECKOUT_RENDER_TIMEOUT]')
            ? '收银台页面加载/渲染超时，准备切换代理重试'
            : '连接 ChatGPT 官方页面超时，准备重试',
        exhaustedMessage: text.includes('[CHECKOUT_RENDER_TIMEOUT]')
            ? '多次尝试加载收银台页面均超时，请稍后重试或检查代理网络质量'
            : '多次尝试连接 ChatGPT 官方页面均超时，请稍后重试或检查代理网络质量',
        reachedPayment: false,
        shouldRetry: true,
        deletePhone: false,
        deleteCard: false,
        paymentState: 'not_started'
    };
}

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

function classifyPaymentResult({
    success = false,
    declined = false,
    submitted = null,
    submissionAttempted = null,
    previousState = 'not_started',
    captchaRequired = false,
    error = ''
} = {}) {
    if (success) return 'succeeded';
    if (declined) return 'declined';

    // Captcha/timeout copy cannot erase a dispatched payment attempt. Only a
    // confirmed terminal result permits releasing payment resources afterwards.
    const previous = normalizePaymentState(previousState);
    if (previous === 'succeeded') return previous;
    if (submitted === true || submissionAttempted === true || ['started', 'unknown'].includes(previous)) return 'unknown';
    return previous === 'declined' ? previous : 'not_started';
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

function classifyCheckoutFailure(message, paymentState) {
    // Checkout readiness and billing guards run before submission. Preserve any pending payment.
    if (paymentState != null && !['not_started', 'declined'].includes(normalizePaymentState(paymentState))) return null;
    const code = String(message || '').match(/\[(CHECKOUT_(?:HTTP_ERROR|UNUSUAL_ACTIVITY|NETWORK_ERROR|NO_REQUEST|REQUEST_PENDING|NAVIGATION_TIMEOUT|NAVIGATION_FAILED|AUTH_REQUIRED|PAGE_ERROR|PAGE_CLOSED|PAGE_UNAVAILABLE|RENDER_TIMEOUT|RESOURCE_TIMEOUT|SESSION_FAILED|CURRENCY_UNCONFIRMED|AMOUNT_UNCONFIRMED|AMOUNT_MISMATCH)|PAYMENT_(?:REGION_NETWORK_MISMATCH|REGION_UNCONFIRMED|CURRENCY_MISMATCH)|NETWORK_REGION_UNCONFIRMED|CDK_PAYMENT_REGION_MISMATCH|BILLING_TAX_NOT_REMOVED|PRICING_REGION_UNCONFIRMED)\]\s*$/)?.[1];
    if (!code) return null;
    const normalizedState = paymentState == null ? 'not_started' : normalizePaymentState(paymentState);
    if (code === 'CHECKOUT_UNUSUAL_ACTIVITY' && normalizedState === 'not_started') {
        return {
            status: 'retry',
            message: 'OpenAI 接口风控拦截 (unusual activity)，正在切换代理重试',
            exhaustedMessage: message,
            reachedPayment: false,
            shouldRetry: true,
            deletePhone: false,
            deleteCard: false,
            paymentState: 'not_started'
        };
    }
    return {
        status: 'failed',
        message,
        reachedPayment: false,
        shouldRetry: false,
        deletePhone: false,
        deleteCard: false,
        paymentState: 'not_started'
    };
}

function classifyProxyPreflightFailure(message, paymentState) {
    // Explicit preflight marker only: never retry a TLS error during payment.
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    const msg = String(message || '');
    const code = msg.match(/\[(PROXY_PREFLIGHT_(?:NETWORK|AUTH|CERTIFICATE)|PROTOCOL_PREREQUISITE_FAILED)\]\s*$/)?.[1];
    if (!code) return null;
    const isProxyNetworkFailure = code === 'PROXY_PREFLIGHT_NETWORK'
        || msg.includes('纯协议代理探针未确认目标地区')
        || msg.includes('纯协议代理探针请求异常');
    const retry = isProxyNetworkFailure;
    return {
        status: retry ? 'retry' : 'failed', message,
        reachedPayment: false, shouldRetry: retry,
        deletePhone: false, deleteCard: false, paymentState: 'not_started'
    };
}

function classifyClaudeNavigationFailure(message, paymentState) {
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    const code = String(message || '').match(/\[(CLAUDE_NAV_(?:NETWORK_ERROR|NAVIGATION_TIMEOUT|HTTP_ERROR|AUTH_REQUIRED|REGION_UNAVAILABLE|SITE_MISMATCH))\]\s*$/)?.[1];
    if (!code) return null;
    const retry = ['CLAUDE_NAV_NETWORK_ERROR', 'CLAUDE_NAV_NAVIGATION_TIMEOUT'].includes(code);
    return {
        status: retry ? 'retry' : 'failed',
        message: retry ? '当前代理连接 Claude 官方服务失败，准备重试' : message,
        exhaustedMessage: retry ? '自动重试后仍无法连接 Claude 官方服务，请稍后重试或联系管理员检查代理' : null,
        reachedPayment: false, shouldRetry: retry,
        deletePhone: false, deleteCard: false, paymentState: 'not_started'
    };
}

function finalizeRetryAnalysis(analysis) {
    if (analysis?.status !== 'retry') return analysis;
    return {
        ...analysis, status: 'failed', shouldRetry: false,
        message: analysis.exhaustedMessage || String(analysis.message || '激活失败')
            .replace('，准备重试', '')
            .replace('已自动切换代理重试', '自动重试已耗尽，请稍后重试')
    };
}

function classifyClaudeCheckoutReadinessFailure(message, paymentState) {
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    const code = String(message || '').match(/\[(CLAUDE_CHECKOUT_(?:LOADING_TIMEOUT|INTERACTION_TIMEOUT))\]\s*$/)?.[1];
    if (!code) return null;
    const loading = code === 'CLAUDE_CHECKOUT_LOADING_TIMEOUT';
    return {
        status: 'retry', message: loading ? 'Claude 收银台加载未完成，准备重试' : 'Claude 收银台暂时无法操作，准备重试',
        exhaustedMessage: loading ? '多次尝试后 Claude 收银台仍未加载完成，请稍后重试或联系管理员检查代理'
            : '多次尝试后 Claude 收银台仍无法操作，请稍后重试或联系管理员检查页面',
        reachedPayment: false, shouldRetry: true,
        deletePhone: false, deleteCard: false, paymentState: 'not_started'
    };
}

function classifyGrokFailure(message, paymentState) {
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    const code = String(message || '').match(/\[(GROK_[A-Z_]+)\]\s*$/)?.[1];
    if (!code) return null;
    const retry = ['GROK_NAVIGATION_TIMEOUT', 'GROK_CHECKOUT_NETWORK_ERROR', 'GROK_CHECKOUT_NAVIGATION_TIMEOUT',
        'GROK_AUTH_UNAVAILABLE'].includes(code);
    return { status: retry ? 'retry' : 'failed', message,
        exhaustedMessage: retry ? 'Grok 官方页面多次加载失败，请稍后重试或检查代理连接官方服务的质量' : message,
        reachedPayment: false, shouldRetry: retry, deletePhone: false, deleteCard: false, paymentState: 'not_started' };
}

function classifyOpenAiCardMethodFailure(message, paymentState) {
    if (paymentState != null && normalizePaymentState(paymentState) !== 'not_started') return null;
    if (!/\[OPENAI_CARD_(?:METHOD_(?:AMBIGUOUS|NOT_SELECTED|NOT_FOUND|CHANGED)|FIELDS_(?:CHANGED|NOT_READY|INCOMPLETE))\]\s*$/.test(String(message || ''))) return null;
    return { status: 'manual', message, reachedPayment: false, shouldRetry: false,
        deletePhone: false, deleteCard: false, paymentState: 'not_started' };
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
    classifyChatGptAuthFailure,
    classifyAccountAlreadySubscribed,
    classifyChatGptNavigationFailure,
    KNOWN_PAYMENT_STATES,
    normalizePaymentState,
    mergePaymentState,
    PAYMENT_STATE_RANK,
    classifyPaymentResult,
    shouldRetainCdk,
    classifyAutoRenewCancellation,
    classifyInterruptedTask,
    classifyCheckoutFailure,
    classifyProxyPreflightFailure,
    classifyClaudeNavigationFailure,
    finalizeRetryAnalysis,
    classifyClaudeCheckoutReadinessFailure,
    classifyOpenAiCardMethodFailure,
    classifyGrokFailure
};
