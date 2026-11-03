'use strict';

/**
 * 官方支付拒绝原因与错误码枚举映射字典
 * 覆盖平台：
 * 1. Stripe 官方全量 Decline Codes 与 Error Codes (OpenAI ChatGPT、Claude 官方底层网关)
 * 2. OpenAI / ChatGPT 收银台专属业务拒绝码与风控枚举
 * 3. Claude / Anthropic 官方收银台拒付文案与 API 拒绝原因 (rejection_reason)
 * 4. xAI Grok Commerce 官方 RPC 拒付枚举 (DECLINE_REASON_*)
 */

// 1. Stripe 官方拒卡枚举字典 (包含发卡行拒卡码 decline_code 与顶层 error.code)
const STRIPE_DECLINE_CODE_MAP = Object.freeze({
    // --- 资金与额度问题 ---
    insufficient_funds: '卡内余额不足 (insufficient funds)',
    withdrawal_count_limit_exceeded: '交易/提款次数超限 (withdrawal count limit exceeded)',
    card_velocity_exceeded: '交易频率超限 (card velocity exceeded)',
    invalid_amount: '交易金额无效 (invalid amount)',

    // --- 发卡行拒绝/状态限制 ---
    card_declined: '发卡行拒绝交易 (card declined)',
    generic_decline: '发卡行通用拒绝 (generic decline)',
    do_not_honor: '发卡行拒绝承兑 (do not honor)',
    do_not_try_again: '发卡行拒绝且禁止重试 (do not try again)',
    not_permitted: '发卡行禁止该笔交易 (not permitted)',
    transaction_not_allowed: '发卡行禁止此类交易/商户类型 (transaction not allowed)',
    service_not_allowed: '发卡行不支持该项服务 (service not allowed)',
    call_issuer: '发卡行要求电话联系核实 (call issuer)',
    approve_with_id: '发卡行要求核验证件 (approve with ID)',
    restricted_card: '受限制的卡片 (restricted card)',

    // --- 卡号、有效期、CVC等卡片要素错误 ---
    incorrect_number: '卡号不正确 (incorrect card number)',
    invalid_number: '卡号无效 (invalid number)',
    incorrect_cvc: '安全码(CVC)错误 (incorrect cvc)',
    invalid_cvc: '安全码(CVC)无效 (invalid cvc)',
    expired_card: '卡片已过期 (expired card)',
    invalid_expiry_month: '有效期月份无效 (invalid expiry month)',
    invalid_expiry_year: '有效期年份无效 (invalid expiry year)',
    incorrect_zip: '账单邮编不匹配 (incorrect postal code / AVS failed)',
    incorrect_pin: 'PIN码不正确 (incorrect pin)',
    invalid_pin: 'PIN码无效 (invalid pin)',
    pin_try_exceeded: 'PIN码重试超限 (pin try exceeded)',

    // --- 卡状态异常/风险扣留 ---
    lost_card: '发卡行标记为挂失/遗失卡 (lost card)',
    stolen_card: '发卡行标记为盗刷卡 (stolen card)',
    pickup_card: '发卡行要求扣留卡片 (pickup card)',
    security_violation: '违反发卡行安全规则 (security violation)',
    stop_payment_order: '持卡人已设置止付令 (stop payment order)',
    revocation_of_all_authorizations: '持卡人已撤销所有授权 (revocation of all authorizations)',
    revocation_of_authorization: '持卡人已撤销授权 (revocation of authorization)',

    // --- 支持与兼容性 ---
    card_not_supported: '不支持该卡片类型 (card not supported)',
    currency_not_supported: '不支持该交易币种 (currency not supported)',

    // --- 风控与欺诈拦截 ---
    fraudulent: '高风险欺诈拦截 (fraudulent / Stripe Radar风控)',
    merchant_blacklist: '商户黑名单拦截 (merchant blacklist)',

    // --- 认证与流程 ---
    authentication_required: '需要3DS安全验证 (authentication required)',
    setup_intent_authentication_failure: '3DS安全认证失败 (authentication failed)',
    payment_intent_authentication_failure: '3DS安全认证失败 (authentication failed)',

    // --- 系统异常与重试 ---
    processing_error: '发卡行系统处理异常 (processing error)',
    try_again_later: '发卡行临时繁忙，请稍后重试 (try again later)',
    issuer_not_available: '发卡行系统暂时不可用 (issuer not available)',
    reenter_transaction: '发卡行要求重新发起交易 (re-enter transaction)',
    duplicate_transaction: '发卡行检测到重复交易 (duplicate transaction)',
    testmode_decline: '测试模式拒卡 (testmode decline)',
    new_account_information_available: '卡片信息已更新需重新绑定 (new account info available)',
    no_action_taken: '发卡行未处理 (no action taken)'
});

// 2. OpenAI / ChatGPT 收银台专属业务拒绝码与风控枚举
const OPENAI_DECLINE_CODE_MAP = Object.freeze({
    purchase_not_allowed: '商户风控拦截无法完成购买 (purchase not allowed / OpenAI风控)',
    card_declined: '银行卡被发卡行拒绝 (card declined)',
    insufficient_funds: '卡内余额不足 (insufficient funds)',
    payment_method_declined: '支付方式被拒绝 (payment method declined)',
    country_not_supported: '不支持当前国家或地区 (unsupported country)',
    unsupported_country: '不支持当前国家或地区 (unsupported country)',
    account_deactivated: 'OpenAI 账号已被封禁或停用 (account deactivated)',
    rate_limit_exceeded: '请求过于频繁，触发频率限制 (rate limit exceeded)',
    checkout_session_failed: '收银台会话失效或处理异常 (checkout session failed)'
});

// 3. Claude / Anthropic 官方收银台拒付文案与 API 拒绝原因 (rejection_reason)
const CLAUDE_DECLINE_PATTERNS = Object.freeze([
    {
        test: /this purchase cannot be completed|unable to complete this purchase|无法完成此(?:次)?购买|未能完成购买/i,
        code: 'purchase_not_allowed',
        detail: '商户风控拦截无法完成购买 (purchase not allowed / Anthropic风控)'
    },
    {
        test: /insufficient funds|余额不足/i,
        code: 'insufficient_funds',
        detail: '卡内余额不足 (insufficient funds)'
    },
    {
        test: /(?:your |the )?card number is (?:incorrect|invalid)|enter your card again|卡号不正确|卡号无效|请重新输入卡号/i,
        code: 'incorrect_number',
        detail: '卡号无效或不正确 (incorrect card number)'
    },
    {
        test: /expired card|expiration date is in the past|卡片已过期/i,
        code: 'expired_card',
        detail: '卡片已过期 (expired card)'
    },
    {
        test: /incorrect.*cvc|security code is incorrect|安全码.*错误/i,
        code: 'incorrect_cvc',
        detail: '安全码(CVC)错误 (incorrect cvc)'
    },
    {
        test: /card (?:does not support|not supported)|不支持该卡片/i,
        code: 'card_not_supported',
        detail: '卡片不支持此类购买 (card not supported)'
    },
    {
        test: /unable to authenticate your payment method|authentication failed|3ds验证失败/i,
        code: 'authentication_failed',
        detail: '3DS安全验证未通过 (authentication failed)'
    },
    {
        test: /country mismatch|账单国家不匹配/i,
        code: 'country_mismatch',
        detail: '账单国家与卡片注册国不符 (country mismatch)'
    },
    {
        test: /try (?:another|a different) (?:card|payment|method)|请更换其他支付/i,
        code: 'try_another_method',
        detail: '请更换其他支付卡片 (try another payment method)'
    },
    {
        test: /your bank may have declined|bank declined|发卡行拒绝/i,
        code: 'bank_declined',
        detail: '发卡行拒绝交易 (bank declined)'
    },
    {
        test: /your card (?:was|has been) declined|card (?:was|has been) declined|payment (?:was )?(?:declined|not approved)|payment (?:failed|could not be processed)|银行卡被拒绝|拒付|被拒绝|未获批准|支付未(?:通过|成功|获批)/i,
        code: 'card_declined',
        detail: '银行卡被发卡行拒绝 (card declined)'
    }
]);

const CLAUDE_REJECTION_REASONS = Object.freeze({
    purchase_not_allowed: '商户风控拦截无法完成购买 (purchase not allowed / Anthropic风控)',
    country_mismatch: '账单国家与卡片注册国不符 (country mismatch)',
    kyc_required: '需要进行KYC身份核验 (kyc required)',
    phone_verification_required: '需要手机号验证 (phone verification required)',
    card_check_required: '需要卡片持有人验证 (card check required)'
});

// 4. Grok Commerce 官方拒卡枚举字典 (DECLINE_REASON_*)
const GROK_DECLINE_CODE_MAP = Object.freeze({
    DECLINE_REASON_INSUFFICIENT_FUNDS: '余额不足 (insufficient funds)',
    DECLINE_REASON_LIMIT_EXCEEDED: '交易限额超限 (limit exceeded)',
    DECLINE_REASON_EXPIRED_CARD: '卡片已过期 (expired card)',
    DECLINE_REASON_INCORRECT_NUMBER: '卡号不正确 (incorrect card number)',
    DECLINE_REASON_INCORRECT_CVC: '安全码不正确 (incorrect cvc)',
    DECLINE_REASON_CARD_NOT_SUPPORTED: '不支持该卡片类型 (card not supported)',
    DECLINE_REASON_AUTHENTICATION_FAILED: '3DS验证失败 (authentication failed)',
    DECLINE_REASON_GENERIC_DECLINE: '发卡行拒绝交易 (generic decline)',
    DECLINE_REASON_DO_NOT_HONOR: '发卡行拒绝承兑 (do not honor)',
    DECLINE_REASON_FRAUDULENT: '风控欺诈拦截 (fraudulent)',
    DECLINE_REASON_RESTRICTED_CARD: '受限制的卡片 (restricted card)'
});

// 5. 快速集合：用于协议层判定是否为确切拒付（可安全触发换卡轮换）
const ALL_EXPLICIT_STRIPE_DECLINE_CODES = new Set([
    ...Object.keys(STRIPE_DECLINE_CODE_MAP),
    ...Object.keys(OPENAI_DECLINE_CODE_MAP)
]);

/**
 * 标准化格式化 Stripe / ChatGPT 拒卡原因
 * @param {object} param
 * @param {string} [param.code] - 上游 error.code
 * @param {string} [param.declineCode] - 上游 error.decline_code
 * @param {string} [param.rawMessage] - 上游原始 message
 * @returns {{ code: string, declineCode: string, label: string, formatted: string }}
 */
function formatStripeDeclineReason({ code = '', declineCode = '', rawMessage = '' } = {}) {
    const normDeclineCode = String(declineCode || '').trim().toLowerCase();
    const normCode = String(code || '').trim().toLowerCase();
    const raw = String(rawMessage || '').trim();

    // 1. 优先查 decline_code
    if (normDeclineCode && STRIPE_DECLINE_CODE_MAP[normDeclineCode]) {
        const label = STRIPE_DECLINE_CODE_MAP[normDeclineCode];
        return {
            code: normCode || normDeclineCode,
            declineCode: normDeclineCode,
            label,
            formatted: `${label} [${normDeclineCode}]`
        };
    }

    // 2. 次查 OpenAI / Stripe top-level code
    if (normCode && (OPENAI_DECLINE_CODE_MAP[normCode] || STRIPE_DECLINE_CODE_MAP[normCode])) {
        const label = OPENAI_DECLINE_CODE_MAP[normCode] || STRIPE_DECLINE_CODE_MAP[normCode];
        return {
            code: normCode,
            declineCode: normDeclineCode,
            label,
            formatted: `${label} [${normCode}]`
        };
    }

    // 3. 从 rawMessage 中根据规则推断
    if (raw) {
        for (const pattern of CLAUDE_DECLINE_PATTERNS) {
            if (pattern.test.test(raw)) {
                return {
                    code: pattern.code,
                    declineCode: normDeclineCode,
                    label: pattern.detail,
                    formatted: `${pattern.detail} [${pattern.code}]`
                };
            }
        }
    }

    // 4. 回退：保留原始信息或通用发卡行拒绝
    const fallbackLabel = raw || '发卡行拒绝交易 (card declined)';
    const fallbackCode = normDeclineCode || normCode || 'card_declined';
    return {
        code: fallbackCode,
        declineCode: normDeclineCode,
        label: fallbackLabel,
        formatted: fallbackCode ? `${fallbackLabel} [${fallbackCode}]` : fallbackLabel
    };
}

/**
 * 标准化格式化 Claude / Anthropic 拒卡原因
 * @param {string} rawText - 页面或 API 返回的原始文案
 * @param {string} [rejectionReason] - Anthropic approve API 返回的 rejection_reason
 * @returns {string} 格式化后的标准化中文描述与代码
 */
function formatClaudeDeclineReason(rawText = '', rejectionReason = '') {
    const raw = String(rawText || '').trim();
    const normReason = String(rejectionReason || '').trim().toLowerCase();

    if (normReason && CLAUDE_REJECTION_REASONS[normReason]) {
        return `${CLAUDE_REJECTION_REASONS[normReason]} [${normReason}]`;
    }

    for (const pattern of CLAUDE_DECLINE_PATTERNS) {
        if (pattern.test.test(raw)) {
            return `${pattern.detail} [${pattern.code}]`;
        }
    }

    return raw || '发卡行拒绝交易 (card declined) [card_declined]';
}

/**
 * 标准化格式化 Grok Commerce 拒付原因
 * @param {string} declineReason - 如 DECLINE_REASON_INSUFFICIENT_FUNDS
 * @param {string} [rawMessage]
 * @returns {string}
 */
function formatGrokDeclineReason(declineReason = '', rawMessage = '') {
    const norm = String(declineReason || '').trim();
    if (norm && GROK_DECLINE_CODE_MAP[norm]) {
        return `${GROK_DECLINE_CODE_MAP[norm]} [${norm}]`;
    }
    const raw = String(rawMessage || '').trim();
    if (raw) {
        for (const pattern of CLAUDE_DECLINE_PATTERNS) {
            if (pattern.test.test(raw)) {
                return `${pattern.detail} [${pattern.code}]`;
            }
        }
        return `${raw} [${norm || 'declined'}]`;
    }
    if (norm) {
        const cleaned = norm.replace(/^DECLINE_REASON_/, '').toLowerCase();
        return `${cleaned} [${norm}]`;
    }
    return '官方拒付 (generic decline) [card_declined]';
}

module.exports = {
    STRIPE_DECLINE_CODE_MAP,
    OPENAI_DECLINE_CODE_MAP,
    CLAUDE_DECLINE_PATTERNS,
    CLAUDE_REJECTION_REASONS,
    GROK_DECLINE_CODE_MAP,
    ALL_EXPLICIT_STRIPE_DECLINE_CODES,
    formatStripeDeclineReason,
    formatClaudeDeclineReason,
    formatGrokDeclineReason
};
