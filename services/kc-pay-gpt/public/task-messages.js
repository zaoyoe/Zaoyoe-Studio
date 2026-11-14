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

    const DECLINE_CODE_LABELS = {
        insufficient_funds: '卡内余额不足',
        withdrawal_count_limit_exceeded: '交易或提款次数超限',
        card_velocity_exceeded: '交易频率超限',
        invalid_amount: '交易金额无效',
        do_not_honor: '发卡行拒绝承兑',
        do_not_try_again: '发卡行拒绝且禁止重试',
        not_permitted: '发卡行禁止该笔交易',
        transaction_not_allowed: '发卡行禁止此类交易',
        service_not_allowed: '发卡行不支持该项服务',
        call_issuer: '发卡行要求联系核实',
        approve_with_id: '发卡行要求核验证件',
        restricted_card: '受限制的卡片',
        incorrect_number: '卡号无效或不正确',
        invalid_number: '卡号无效或不正确',
        incorrect_cvc: '安全码(CVC)错误',
        invalid_cvc: '安全码(CVC)无效',
        expired_card: '卡片已过期',
        invalid_expiry_month: '有效期月份无效',
        invalid_expiry_year: '有效期年份无效',
        incorrect_zip: '账单邮编不匹配',
        incorrect_pin: '支付密码错误',
        invalid_pin: '支付密码无效',
        pin_try_exceeded: '密码重试次数超限',
        lost_card: '发卡行标记为挂失卡',
        stolen_card: '发卡行标记为盗刷卡',
        pickup_card: '发卡行要求扣留卡片',
        security_violation: '违反发卡行安全规则',
        stop_payment_order: '持卡人已设置止付',
        revocation_of_all_authorizations: '持卡人已撤销授权',
        revocation_of_authorization: '持卡人已撤销授权',
        card_not_supported: '不支持该卡片类型',
        currency_not_supported: '不支持该交易币种',
        fraudulent: '高风险欺诈拦截',
        merchant_blacklist: '商户风控拦截',
        authentication_required: '需要 3DS 安全验证',
        authentication_failed: '3DS 安全验证未通过',
        setup_intent_authentication_failure: '3DS 安全验证未通过',
        payment_intent_authentication_failure: '3DS 安全验证未通过',
        processing_error: '发卡行系统处理异常',
        try_again_later: '发卡行临时繁忙，请稍后重试',
        issuer_not_available: '发卡行系统暂时不可用',
        reenter_transaction: '发卡行要求重新发起交易',
        duplicate_transaction: '发卡行检测到重复交易',
        testmode_decline: '测试模式拒卡',
        new_account_information_available: '卡片信息已更新需重新绑定',
        purchase_not_allowed: '商户风控拦截无法完成购买',
        payment_method_declined: '支付方式被官方拒绝',
        country_not_supported: '不支持当前国家或地区',
        unsupported_country: '不支持当前国家或地区',
        country_mismatch: '账单国家与卡片发行地区不符',
        account_deactivated: '官方账号状态异常无法购买',
        rate_limit_exceeded: '请求过于频繁，触发风控限制',
        checkout_session_failed: '收银台会话失效或处理异常',
        try_another_method: '请更换其他支付卡片',
        kyc_required: '需要进行身份核验',
        phone_verification_required: '需要手机号验证',
        card_check_required: '需要卡片持有人验证',
        decline_reason_insufficient_funds: '余额不足',
        decline_reason_limit_exceeded: '交易限额超限',
        decline_reason_expired_card: '卡片已过期',
        decline_reason_incorrect_number: '卡号无效或不正确',
        decline_reason_incorrect_cvc: '安全码错误',
        decline_reason_card_not_supported: '不支持该卡片类型',
        decline_reason_authentication_failed: '3DS 验证失败',
        decline_reason_do_not_honor: '发卡行拒绝承兑',
        decline_reason_fraudulent: '高风险欺诈拦截',
        decline_reason_restricted_card: '受限制的卡片'
    };

    const ENGLISH_DECLINE_PHRASES = [
        { test: /(?:your |the )?card number is (?:incorrect|invalid)|incorrect card number/i, label: '卡号无效或不正确' },
        { test: /insufficient funds/i, label: '卡内余额不足' },
        { test: /expired card|expiration date is in the past/i, label: '卡片已过期' },
        { test: /incorrect.*(?:cvc|security code)|invalid.*(?:cvc|security code)/i, label: '安全码(CVC)错误' },
        { test: /do not honor/i, label: '发卡行拒绝承兑' },
        { test: /card (?:does not support|not supported)/i, label: '不支持该卡片类型' },
        { test: /this purchase cannot be completed|unable to complete this purchase|purchase not allowed/i, label: '商户风控拦截无法完成购买' },
        { test: /country mismatch/i, label: '账单国家与卡片发行地区不符' },
        { test: /authentication (?:required|failed)|unable to authenticate/i, label: '需要 3DS 安全验证' },
        { test: /processing error|try again later|issuer not available/i, label: '发卡行系统处理异常' },
        { test: /fraudulent/i, label: '高风险欺诈拦截' },
        { test: /restricted card/i, label: '受限制的卡片' }
    ];

    function mapDeclineCodeToChinese(codeList) {
        for (const code of codeList) {
            const label = DECLINE_CODE_LABELS[String(code || '').trim().toLowerCase()];
            if (label) return label;
        }
        return '';
    }

    function sanitizeDeclineReason(rawMessage) {
        let text = String(rawMessage || '').trim();
        if (!text) return '';
        const bracketCodes = [];
        text.replace(/\[([a-z0-9_.:-]{2,64})\]/gi, (_, code) => {
            bracketCodes.push(code);
            return '';
        });
        text = text.replace(/\(\s*尾号\s*\.\.\.\d{4}\s*\)/g, '');
        text = text.replace(/\(\s*\.\.\.\d{4}(?:\s*,\s*\.\.\.\d{4})*\s*\)/g, '');
        text = text.replace(/\s*\[[a-z0-9_.:-]{2,64}\]/gi, '');
        text = text.replace(/\(manual_intervention\)|\(stripe_card_declined\)|\(Card Declined\)/gi, '');
        text = text.replace(/（卡密未使用(?:，已回滚)?）/g, '');
        text = text.replace(/(?:^|\s+)\([A-Za-z0-9\s/_.,:;'-]+(?:\s*\/\s*[\u4e00-\u9fffA-Za-z0-9\s]+)?\)/g, '');
        text = text.replace(/\b\d{12,19}\b/g, '').replace(/\.\.\.\d{4}/g, '');
        for (let i = 0; i < 3; i += 1) {
            text = text
                .replace(/^\s*(?:支付失败\s*(?:\([^)]+\)\s*)?[:：]?\s*)?(?:\d+\s*张卡均被拒|银行卡被拒绝|发卡行拒付|支付失败)\s*[:：]?\s*/i, '')
                .replace(/^支付卡被官方系统拒付(?:（[^）]*）|[:：]\s*|\s*,\s*请联系客服处理，卡密未使用)?/g, '')
                .replace(/^[:：,\s]+|[:：,\s]+$/g, '')
                .trim();
        }
        if (/https?:\/\/|\bBearer\b|\bSELECT\s|\bINSERT\s|\bUPDATE\s|locator\.|page\.|Call log:/i.test(text)) return '';
        if (!/[\u4e00-\u9fff]/.test(text)) {
            const fromCode = mapDeclineCodeToChinese(bracketCodes);
            if (fromCode) return fromCode;
            for (const entry of ENGLISH_DECLINE_PHRASES) {
                if (entry.test.test(text)) return entry.label;
            }
            return '';
        }
        text = text.replace(/\s+/g, ' ').replace(/^[:：,\s]+|[:：,\s]+$/g, '').trim();
        if (!text || /^(?:发卡行拒绝交易|官方拒付|银行卡被发卡行拒绝)$/.test(text) || text.length > 180) {
            return mapDeclineCodeToChinese(bracketCodes);
        }
        return text;
    }

    function formatTaskErrorMessage(status, rawMessage, options = {}) {
        const msg = String(rawMessage || '');
        // Payment uncertainty takes priority over every other reason, including authentication.
        if (options.recoveryRequired || ['started', 'unknown', 'succeeded'].includes(options.paymentState)
            || /支付结果(?:未确认|未知|待确认)|已保留.*(?:CDK|卡密|银行卡)|需人工复核/.test(msg)) return PAYMENT_UNCONFIRMED;
        if (status === 'maintenance') return '系统例行维护升级，请稍后提交';
        if (/ACCOUNT_ALREADY_SUBSCRIBED|已有有效.*(?:Plus|订阅)|already_subscribed/i.test(msg)) return ALREADY_SUBSCRIBED;
        if (/CHATGPT_SESSION_EXPIRED|CHECKOUT_AUTH_ERROR|\b(?:token_expired|invalid_token|expired_token|session_expired)\b|authentication token has expired|your session has expired|(?:Session|Token|账号凭证|登录状态|sessionToken)[^\n]*(?:已失效|已过期|无效|未生效|未在.*生效)|Session 登录失败/i.test(msg)) return AUTH_FAILURE;
        if (options.paymentState === 'declined'
            || /card_declined|card was declined|incorrect_number|incorrect_cvc|expired_card|card_not_supported|do_not_honor|insufficient_funds|generic_decline|stripe_card_declined|拒付|支付卡被官方系统拒付|卡均被拒|银行卡被拒绝/i.test(msg)) {
            const safeReason = sanitizeDeclineReason(msg);
            if (safeReason && !/支付卡被官方系统拒付/.test(safeReason)) {
                return `支付卡被官方系统拒付：${safeReason}（卡密未使用）`;
            }
            return CARD_DECLINED;
        }
        // Only reviewed product copy is returned. Raw browser, database and upstream errors stay in admin logs.
        return GENERIC_FAILURE;
    }

    function publicTaskUpdate(data) {
        if (!data || !['status', 'progress', 'snapshot'].includes(data.type)) return data;
        return {
            type: data.type,
            jobKey: data.jobKey,
            status: data.status,
            progress: data.progress,
            completed: data.completed,
            paymentState: data.paymentState,
            recoveryRequired: data.recoveryRequired,
            message: ['failed', 'manual', 'maintenance'].includes(data.status)
                ? formatTaskErrorMessage(data.status, data.message, data)
                : (data.status === 'success' ? '充值成功' : '正在为您办理充值，请稍候')
        };
    }

    return { formatTaskErrorMessage, publicTaskUpdate, GENERIC_FAILURE, AUTH_FAILURE, PAYMENT_UNCONFIRMED, CARD_DECLINED, ALREADY_SUBSCRIBED };
});
