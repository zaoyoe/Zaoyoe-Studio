(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KcTaskMessages = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const GENERIC_FAILURE = '充值失败，请联系客服处理';
    const AUTH_FAILURE = '账号凭证已失效或过期，请重新登录并获取最新 Session 后重试';
    const PAYMENT_UNCONFIRMED = '支付结果待确认，请联系客服核实，请勿重复充值';
    const CARD_DECLINED = '支付卡被官方系统拒付，请联系客服处理，卡密未使用';
    const ALREADY_SUBSCRIBED = '该账号已有有效 Plus 订阅，无需重复充值，请更换其他未订阅账号';

    function formatTaskErrorMessage(status, rawMessage, options = {}) {
        const msg = String(rawMessage || '');
        // Payment uncertainty takes priority over every other reason, including authentication.
        if (options.recoveryRequired || ['started', 'unknown', 'succeeded'].includes(options.paymentState)
            || /支付结果(?:未确认|未知|待确认)|已保留.*(?:CDK|卡密|银行卡)|需人工复核/.test(msg)) return PAYMENT_UNCONFIRMED;
        if (status === 'maintenance') return '系统例行维护升级，请稍后提交';
        if (/ACCOUNT_ALREADY_SUBSCRIBED|已有有效.*(?:Plus|订阅)|already_subscribed/i.test(msg)) return ALREADY_SUBSCRIBED;
        if (/CHATGPT_SESSION_EXPIRED|CHECKOUT_AUTH_ERROR|\b(?:token_expired|invalid_token|expired_token|session_expired)\b|authentication token has expired|your session has expired|(?:Session|Token|账号凭证|登录状态|sessionToken)[^\n]*(?:已失效|已过期|无效|未生效|未在.*生效)|Session 登录失败/i.test(msg)) return AUTH_FAILURE;
        if (options.paymentState === 'declined'
            || /card_declined|card was declined|拒付|支付卡被官方系统拒付|卡均被拒|insufficient_funds|do_not_honor/i.test(msg)) return CARD_DECLINED;
        // Only reviewed product copy is returned. Raw browser, database and upstream errors stay in admin logs.
        return GENERIC_FAILURE;
    }

    function publicTaskUpdate(data) {
        if (!data || !['status', 'progress', 'snapshot'].includes(data.type)) return data;
        return {
            ...data,
            message: ['failed', 'manual', 'maintenance'].includes(data.status)
                ? formatTaskErrorMessage(data.status, data.message, data)
                : (data.status === 'success' ? '充值成功' : '正在为您办理充值，请稍候')
        };
    }

    return { formatTaskErrorMessage, publicTaskUpdate, GENERIC_FAILURE, AUTH_FAILURE, PAYMENT_UNCONFIRMED, CARD_DECLINED, ALREADY_SUBSCRIBED };
});
