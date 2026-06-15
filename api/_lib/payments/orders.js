const crypto = require('crypto');
const {
    isSupportedSite,
    normalizeSiteValue,
    requireSupportedSite
} = require('../site');
const {
    getPaymentProviderAdapter,
    normalizePointValue,
    amountsMatch
} = require('./provider-adapters');
const {
    loadStoredPaymentConfigs
} = require('./providers');
const {
    extractHostname,
    isLocalHostname,
    resolveSiteRequestOrigin
} = require('./site-origins');
const {
    rechargePointsForPayment
} = require('./rpc');
const {
    maybeIssueAffiliateDiscountAssetsForRecharge,
    maybeIssueRechargeDiscountAssets
} = require('../discount-trigger-linkage');
const {
    syncPaymentStatusUserTags
} = require('../user-tags');
const {
    deriveZpayPointBreakdown
} = require('./zpay-points');

const mockProvider = getPaymentProviderAdapter('mock');
const CHECKOUT_SESSION_EXPIRY_HOURS = 24;
const ACTIVE_CHECKOUT_SESSION_STATUSES = ['created', 'redirect_ready', 'failed'];
const TERMINAL_CHECKOUT_SESSION_STATUSES = ['completed', 'cancelled', 'expired'];
const REUSABLE_PAYMENT_CREATE_LOOKBACK_MINUTES = 3;
const PENDING_PROVIDER_ORDER_PREFIX = 'PENDING';
const CUSTOM_RECHARGE_QUOTE_PREFIX = 'crq';
const PAYMENT_INTENT_CLAIM_PREFIX = 'pic';
const DEFAULT_CUSTOM_RECHARGE_MIN_POINTS = 0.01;
const DEFAULT_CUSTOM_RECHARGE_MAX_POINTS = 50000;
const DEFAULT_CUSTOM_RECHARGE_STEP = 0.01;
const DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY = 1;
const DEFAULT_CUSTOM_RECHARGE_QUOTE_TTL_SECONDS = 1800;
const REMOTE_MOCK_PAYMENT_UNTIL_ENV_NAMES = Object.freeze([
    'ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL',
    'PAYMENT_ALLOW_REMOTE_MOCK_UNTIL',
    'PAYMENT_MOCK_ALLOW_REMOTE_UNTIL'
]);

function sanitizeSite(value) {
    return normalizeSiteValue(value);
}

function sanitizeText(value, fallback = '', maxLength = 240) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

function normalizeClientPaymentRequestId(value) {
    return sanitizeText(value, '', 160);
}

function normalizeCurrency(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(parsed * 100) / 100;
}

function normalizeInteger(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function normalizePointAmount(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
}

function toPointCents(value, fallback = 0) {
    const normalized = normalizePointAmount(value, fallback / 100);
    return Number.isFinite(normalized) ? Math.round(normalized * 100) : fallback;
}

async function safeSyncPaymentStatusUserTags(supabase, options = {}) {
    try {
        return await syncPaymentStatusUserTags(supabase, options);
    } catch (error) {
        console.warn('[Payments] Failed to sync engagement user tags:', error?.message || error);
        return {
            ok: false,
            skipped: 'tag_sync_failed'
        };
    }
}

function isPointStepAligned(value, step) {
    const normalizedValue = toPointCents(value, 0);
    const normalizedStep = toPointCents(step, 0);
    if (normalizedValue <= 0 || normalizedStep <= 0) {
        return false;
    }
    return normalizedValue % normalizedStep === 0;
}

function roundUpCurrency(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.ceil(parsed * 100) / 100;
}

function normalizeSurchargeRate(value, fallback = 0) {
    const parsed = Number(value);
    const fallbackParsed = Number(fallback);
    const rate = Number.isFinite(parsed)
        ? parsed
        : (Number.isFinite(fallbackParsed) ? fallbackParsed : 0);
    if (!(rate > 0)) return 0;
    return Math.min(0.1, Math.round(rate * 10000) / 10000);
}

function buildPaymentPricing({ providerConfig = {}, baseAmount = 0 } = {}) {
    const normalizedBaseAmount = normalizeCurrency(baseAmount, null);
    const surchargeRate = normalizeSurchargeRate(providerConfig?.surcharge_rate, 0);
    const surchargeLabel = sanitizeText(providerConfig?.surcharge_label, '通道手续费', 40) || '通道手续费';
    const surchargeAmount = normalizedBaseAmount > 0 && surchargeRate > 0
        ? roundUpCurrency(normalizedBaseAmount * surchargeRate, 0)
        : 0;
    const payableAmount = normalizedBaseAmount > 0
        ? normalizeCurrency(normalizedBaseAmount + surchargeAmount, normalizedBaseAmount)
        : normalizedBaseAmount;

    return {
        baseAmount: normalizedBaseAmount,
        surchargeRate,
        surchargeAmount: surchargeAmount || 0,
        surchargeLabel,
        payableAmount
    };
}

function buildPaymentPricingPayload(pricing = {}) {
    return {
        base_amount: normalizeCurrency(pricing.baseAmount, null),
        payment_fee_amount: normalizeCurrency(pricing.surchargeAmount, 0) || 0,
        payment_fee_rate: normalizeSurchargeRate(pricing.surchargeRate, 0),
        payment_fee_label: sanitizeText(pricing.surchargeLabel, '通道手续费', 40),
        payable_amount: normalizeCurrency(pricing.payableAmount, null)
    };
}

function encodeBase64Url(value) {
    return Buffer.from(String(value || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
    const normalized = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized) return '';
    const padding = normalized.length % 4 === 0
        ? ''
        : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function readIndependentSecret(secretValue, label, env = process.env) {
    const normalizedSecret = String(secretValue || '').trim();
    if (!normalizedSecret) return '';

    const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (serviceRoleKey && normalizedSecret === serviceRoleKey) {
        throw new Error(`${label} 不能复用 SUPABASE_SERVICE_ROLE_KEY，请配置独立密钥`);
    }

    return normalizedSecret;
}

function getCustomRechargeQuoteSecret(env = process.env) {
    return [
        env?.PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET,
        env?.PAYMENT_CUSTOM_QUOTE_SECRET,
        env?.PAYMENT_QUOTE_SECRET
    ]
        .map((value) => readIndependentSecret(value, 'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET', env))
        .find(Boolean) || '';
}

function signCustomRechargeQuotePayload(payload, env = process.env) {
    const secret = getCustomRechargeQuoteSecret(env);
    if (!secret) {
        throw new Error('自定义充值报价签名密钥未配置');
    }

    const body = encodeBase64Url(JSON.stringify(payload || {}));
    const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    return `${CUSTOM_RECHARGE_QUOTE_PREFIX}.${body}.${signature}`;
}

function hashCustomRechargeQuoteToken(token = '') {
    return crypto
        .createHash('sha256')
        .update(String(token || ''))
        .digest('hex');
}

function buildCustomRechargeQuoteId() {
    return `CRQ_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getNormalizedCustomRechargeRules(rechargeOptions = {}) {
    const minPoints = DEFAULT_CUSTOM_RECHARGE_MIN_POINTS;
    const maxPoints = Math.max(
        minPoints,
        normalizePointAmount(rechargeOptions?.custom_amount_max_points, DEFAULT_CUSTOM_RECHARGE_MAX_POINTS)
    );
    const step = DEFAULT_CUSTOM_RECHARGE_STEP;
    const quoteTtlSeconds = Math.max(
        60,
        normalizeInteger(
            rechargeOptions?.custom_amount_quote_ttl_seconds,
            DEFAULT_CUSTOM_RECHARGE_QUOTE_TTL_SECONDS
        )
    );

    return {
        minPoints,
        maxPoints,
        step,
        pointsPerCny: DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY,
        quoteTtlSeconds
    };
}

function issueCustomRechargeQuote({
    userId,
    site,
    providerKey,
    pointsAmount,
    rechargeOptions,
    env = process.env
}) {
    const normalizedSite = requireSupportedSite(site);
    const rules = getNormalizedCustomRechargeRules(rechargeOptions);
    const normalizedPoints = normalizePointAmount(pointsAmount, 0);

    if (!Number.isFinite(normalizedPoints) || normalizedPoints <= 0) {
        throw new Error('请输入大于 0 的充值积分');
    }
    if (normalizedPoints < rules.minPoints) {
        throw new Error(`单次自定义充值最少为 ${rules.minPoints} 积分`);
    }
    if (normalizedPoints > rules.maxPoints) {
        throw new Error(`单次自定义充值最多为 ${rules.maxPoints} 积分`);
    }
    if (!isPointStepAligned(normalizedPoints, rules.step)) {
        throw new Error(`自定义充值需按 ${rules.step} 积分档位提交`);
    }

    const paidAmount = roundUpCurrency(normalizedPoints / rules.pointsPerCny, null);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
        throw new Error('无法为当前自定义充值生成有效报价');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + (rules.quoteTtlSeconds * 1000));
    const payload = {
        version: 1,
        type: 'custom_recharge_quote',
        quote_id: buildCustomRechargeQuoteId(),
        provider: String(providerKey || 'afdian').trim().toLowerCase() || 'afdian',
        user_id: String(userId || '').trim(),
        site: normalizedSite,
        points_amount: normalizedPoints,
        paid_amount: paidAmount,
        pricing_mode: 'fixed_rate',
        points_per_cny: rules.pointsPerCny,
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString()
    };
    const token = signCustomRechargeQuotePayload(payload, env);

    return {
        quoteId: payload.quote_id,
        token,
        tokenHash: hashCustomRechargeQuoteToken(token),
        pointsAmount: normalizedPoints,
        paidAmount,
        pricingMode: payload.pricing_mode,
        pointsPerCny: rules.pointsPerCny,
        issuedAt: payload.issued_at,
        expiresAt: payload.expires_at,
        minPoints: rules.minPoints,
        maxPoints: rules.maxPoints,
        step: rules.step
    };
}

function verifyCustomRechargeQuoteToken(token, {
    env = process.env,
    userId = '',
    site = '',
    providerKey = ''
} = {}) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) return null;

    const [prefix, body, signature] = normalizedToken.split('.');
    if (prefix !== CUSTOM_RECHARGE_QUOTE_PREFIX || !body || !signature) {
        return null;
    }

    let secret = '';
    try {
        secret = getCustomRechargeQuoteSecret(env);
    } catch (_) {
        return null;
    }
    if (!secret) {
        return null;
    }

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    if (signature !== expectedSignature) {
        return null;
    }

    let payload;
    try {
        payload = JSON.parse(decodeBase64Url(body));
    } catch (_) {
        return null;
    }

    if (!payload || payload.type !== 'custom_recharge_quote') {
        return null;
    }

    const expiresAt = Date.parse(String(payload.expires_at || ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return null;
    }

    const normalizedUserId = String(userId || '').trim();
    if (normalizedUserId && String(payload.user_id || '').trim() !== normalizedUserId) {
        return null;
    }

    let normalizedSite = '';
    try {
        normalizedSite = requireSupportedSite(site, { allowEmpty: true });
    } catch (_) {
        return null;
    }

    const payloadSite = normalizeSiteValue(payload.site, { fallback: '' });
    if (!payloadSite) {
        return null;
    }

    if (normalizedSite && payloadSite !== normalizedSite) {
        return null;
    }

    const normalizedProvider = String(providerKey || '').trim().toLowerCase();
    if (normalizedProvider && String(payload.provider || '').trim().toLowerCase() !== normalizedProvider) {
        return null;
    }

    const pointsAmount = normalizePointAmount(payload.points_amount, 0);
    const paidAmount = normalizeCurrency(payload.paid_amount, null);
    if (pointsAmount <= 0 || paidAmount === null || paidAmount <= 0) {
        return null;
    }

    return {
        quoteId: String(payload.quote_id || '').trim(),
        token: normalizedToken,
        tokenHash: hashCustomRechargeQuoteToken(normalizedToken),
        userId: String(payload.user_id || '').trim(),
        site: payloadSite,
        provider: String(payload.provider || '').trim().toLowerCase() || 'afdian',
        pointsAmount,
        paidAmount,
        pricingMode: String(payload.pricing_mode || 'fixed_rate').trim().toLowerCase() || 'fixed_rate',
        pointsPerCny: Number(payload.points_per_cny) || DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY,
        issuedAt: String(payload.issued_at || '').trim() || null,
        expiresAt: String(payload.expires_at || '').trim() || null
    };
}

function getPaymentIntentClaimSecret(env = process.env) {
    return getCustomRechargeQuoteSecret(env);
}

function signPaymentIntentClaimPayload(payload, env = process.env) {
    const secret = getPaymentIntentClaimSecret(env);
    if (!secret) {
        throw new Error('支付认领签名密钥未配置');
    }

    const body = encodeBase64Url(JSON.stringify(payload || {}));
    const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    return `${PAYMENT_INTENT_CLAIM_PREFIX}.${body}.${signature}`;
}

function hashPaymentIntentClaimToken(token = '') {
    return crypto
        .createHash('sha256')
        .update(String(token || ''))
        .digest('hex');
}

function buildPaymentIntentClaimId(checkoutSessionId = '') {
    const sessionSuffix = String(checkoutSessionId || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-8)
        .toUpperCase();

    return `PIC_${sessionSuffix || 'SESSION'}_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function issuePaymentIntentClaimToken({
    userId,
    site,
    providerKey,
    checkoutSessionId,
    packageId = null,
    packageName = '',
    expectedAmount,
    pointsAmount,
    chargeType = '',
    expiresAt = null,
    env = process.env
}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        throw new Error('支付认领缺少 user_id');
    }

    const normalizedCheckoutSessionId = String(checkoutSessionId || '').trim();
    if (!normalizedCheckoutSessionId) {
        throw new Error('支付认领缺少 checkout_session_id');
    }

    const normalizedSite = requireSupportedSite(site);
    const normalizedProvider = String(providerKey || 'afdian').trim().toLowerCase() || 'afdian';
    const normalizedExpectedAmount = normalizeCurrency(expectedAmount, null);
    const normalizedPointsAmount = normalizePointAmount(pointsAmount, 0);
    const normalizedChargeType = sanitizeText(
        chargeType || (packageId ? 'package' : 'custom'),
        packageId ? 'package' : 'custom',
        32
    ).toLowerCase();

    if (!Number.isFinite(normalizedExpectedAmount) || normalizedExpectedAmount <= 0) {
        throw new Error('支付认领缺少有效金额');
    }
    if (!Number.isFinite(normalizedPointsAmount) || normalizedPointsAmount <= 0) {
        throw new Error('支付认领缺少有效积分');
    }

    const issuedAt = new Date();
    const requestedExpiry = Date.parse(String(expiresAt || ''));
    const resolvedExpiry = Number.isFinite(requestedExpiry) && requestedExpiry > issuedAt.getTime()
        ? new Date(requestedExpiry)
        : new Date(issuedAt.getTime() + CHECKOUT_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
    const payload = {
        version: 1,
        type: 'payment_intent_claim',
        intent_id: buildPaymentIntentClaimId(normalizedCheckoutSessionId),
        provider: normalizedProvider,
        user_id: normalizedUserId,
        site: normalizedSite,
        checkout_session_id: normalizedCheckoutSessionId,
        package_id: String(packageId || '').trim() || null,
        package_name: sanitizeText(packageName, packageId ? '充值套餐' : '自定义充值'),
        expected_amount: normalizedExpectedAmount,
        points_amount: normalizedPointsAmount,
        charge_type: normalizedChargeType || (packageId ? 'package' : 'custom'),
        issued_at: issuedAt.toISOString(),
        expires_at: resolvedExpiry.toISOString()
    };
    const token = signPaymentIntentClaimPayload(payload, env);

    return {
        intentId: payload.intent_id,
        token,
        tokenHash: hashPaymentIntentClaimToken(token),
        userId: payload.user_id,
        site: payload.site,
        provider: payload.provider,
        checkoutSessionId: payload.checkout_session_id,
        packageId: payload.package_id,
        packageName: payload.package_name,
        expectedAmount: payload.expected_amount,
        pointsAmount: payload.points_amount,
        chargeType: payload.charge_type,
        issuedAt: payload.issued_at,
        expiresAt: payload.expires_at
    };
}

function verifyPaymentIntentClaimToken(token, {
    env = process.env,
    userId = '',
    site = '',
    providerKey = ''
} = {}) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) return null;

    const [prefix, body, signature] = normalizedToken.split('.');
    if (prefix !== PAYMENT_INTENT_CLAIM_PREFIX || !body || !signature) {
        return null;
    }

    let secret = '';
    try {
        secret = getPaymentIntentClaimSecret(env);
    } catch (_) {
        return null;
    }
    if (!secret) {
        return null;
    }

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    if (signature !== expectedSignature) {
        return null;
    }

    let payload;
    try {
        payload = JSON.parse(decodeBase64Url(body));
    } catch (_) {
        return null;
    }

    if (!payload || payload.type !== 'payment_intent_claim') {
        return null;
    }

    const expiresAt = Date.parse(String(payload.expires_at || ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return null;
    }

    const normalizedUserId = String(userId || '').trim();
    if (normalizedUserId && String(payload.user_id || '').trim() !== normalizedUserId) {
        return null;
    }

    let normalizedSite = '';
    try {
        normalizedSite = requireSupportedSite(site, { allowEmpty: true });
    } catch (_) {
        return null;
    }

    const payloadSite = normalizeSiteValue(payload.site, { fallback: '' });
    if (!payloadSite) {
        return null;
    }
    if (normalizedSite && payloadSite !== normalizedSite) {
        return null;
    }

    const normalizedProvider = String(providerKey || '').trim().toLowerCase();
    if (normalizedProvider && String(payload.provider || '').trim().toLowerCase() !== normalizedProvider) {
        return null;
    }

    const checkoutSessionId = String(payload.checkout_session_id || '').trim();
    const pointsAmount = normalizePointAmount(payload.points_amount, 0);
    const expectedAmount = normalizeCurrency(payload.expected_amount, null);
    if (!checkoutSessionId || pointsAmount <= 0 || expectedAmount === null || expectedAmount <= 0) {
        return null;
    }

    return {
        intentId: String(payload.intent_id || '').trim(),
        token: normalizedToken,
        tokenHash: hashPaymentIntentClaimToken(normalizedToken),
        userId: String(payload.user_id || '').trim(),
        site: payloadSite,
        provider: String(payload.provider || '').trim().toLowerCase() || 'afdian',
        checkoutSessionId,
        packageId: String(payload.package_id || '').trim() || null,
        packageName: String(payload.package_name || '').trim() || null,
        expectedAmount,
        pointsAmount,
        chargeType: String(payload.charge_type || '').trim().toLowerCase() || 'package',
        issuedAt: String(payload.issued_at || '').trim() || null,
        expiresAt: String(payload.expires_at || '').trim() || null
    };
}

function isTruthyFlag(value) {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isProductionLikeRuntime(env = process.env) {
    const vercelEnv = String(env?.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(env?.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(env?.DEPLOYMENT_TIER || env?.APP_ENV || '').trim().toLowerCase();

    return vercelEnv === 'production'
        || railwayEnv === 'production'
        || deploymentTier === 'production';
}

function isRemoteMockPaymentWhitelisted(env = process.env) {
    return isTruthyFlag(env?.ALLOW_REMOTE_MOCK_PAYMENTS)
        || isTruthyFlag(env?.PAYMENT_ALLOW_REMOTE_MOCK)
        || isTruthyFlag(env?.PAYMENT_MOCK_ALLOW_REMOTE);
}

function getRemoteMockPaymentWhitelistEnvName(env = process.env) {
    const envNames = [
        'ALLOW_REMOTE_MOCK_PAYMENTS',
        'PAYMENT_ALLOW_REMOTE_MOCK',
        'PAYMENT_MOCK_ALLOW_REMOTE'
    ];

    return envNames.find((envName) => isTruthyFlag(env?.[envName])) || '';
}

function formatIsoTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().replace('.000Z', 'Z');
}

function getRemoteMockPaymentExpiryOverride(env = process.env) {
    for (const envName of REMOTE_MOCK_PAYMENT_UNTIL_ENV_NAMES) {
        const rawValue = String(env?.[envName] || '').trim();
        if (!rawValue) continue;

        const expiresAt = new Date(rawValue);
        if (Number.isNaN(expiresAt.getTime())) {
            return {
                configured: true,
                valid: false,
                expired: false,
                envName,
                rawValue,
                expiresAt: null
            };
        }

        return {
            configured: true,
            valid: true,
            expired: expiresAt.getTime() <= Date.now(),
            envName,
            rawValue,
            expiresAt
        };
    }

    return {
        configured: false,
        valid: false,
        expired: false,
        envName: '',
        rawValue: '',
        expiresAt: null
    };
}

function getRemoteMockPaymentOverrideState(env = process.env) {
    const expiryOverride = getRemoteMockPaymentExpiryOverride(env);
    if (expiryOverride.configured) {
        return {
            configured: true,
            active: expiryOverride.valid && !expiryOverride.expired,
            envName: expiryOverride.envName,
            mode: 'until',
            valid: expiryOverride.valid,
            expired: expiryOverride.expired,
            rawValue: expiryOverride.rawValue,
            expiresAt: expiryOverride.expiresAt
        };
    }

    const whitelistEnvName = getRemoteMockPaymentWhitelistEnvName(env);
    if (whitelistEnvName) {
        return {
            configured: true,
            active: true,
            envName: whitelistEnvName,
            mode: 'boolean',
            valid: true,
            expired: false,
            rawValue: String(env?.[whitelistEnvName] || '').trim(),
            expiresAt: null
        };
    }

    return {
        configured: false,
        active: false,
        envName: '',
        mode: 'none',
        valid: false,
        expired: false,
        rawValue: '',
        expiresAt: null
    };
}

function buildMockPaymentRuntimeState(state = {}, overrideState = getRemoteMockPaymentOverrideState(process.env)) {
    return {
        override_configured: overrideState.configured === true,
        override_active: overrideState.active === true,
        override_env_name: overrideState.envName || '',
        override_mode: overrideState.mode || 'none',
        cleanup_message: overrideState.configured && overrideState.envName
            ? `环境变量仍存在但当前未启用，需移除 vercel 的环境变量${overrideState.envName}`
            : '',
        ...state
    };
}

function getMockPaymentRuntimeState({ requestHost = '', env = process.env } = {}) {
    const overrideState = getRemoteMockPaymentOverrideState(env);

    if (isProductionLikeRuntime(env)) {
        return buildMockPaymentRuntimeState({
            allowed: false,
            reason: 'production_like_runtime',
            message: '当前站点运行在生产环境，服务端硬性禁用模拟支付。'
        }, overrideState);
    }

    if (isLocalHostname(requestHost)) {
        return buildMockPaymentRuntimeState({
            allowed: true,
            reason: 'local_request_host',
            message: '当前访问的是本地环境，允许使用模拟支付。'
        }, overrideState);
    }

    if (isLocalHostname(env?.APP_BASE_URL)) {
        return buildMockPaymentRuntimeState({
            allowed: true,
            reason: 'local_app_base_url',
            message: '当前部署被识别为本地环境，允许使用模拟支付。'
        }, overrideState);
    }

    const expiryOverride = overrideState.mode === 'until'
        ? {
            configured: true,
            valid: overrideState.valid,
            expired: overrideState.expired,
            envName: overrideState.envName,
            rawValue: overrideState.rawValue,
            expiresAt: overrideState.expiresAt
        }
        : { configured: false };
    if (expiryOverride.configured) {
        if (!expiryOverride.valid) {
            return buildMockPaymentRuntimeState({
                allowed: false,
                reason: 'remote_whitelist_until_invalid',
                message: `${expiryOverride.envName} 配置无效，请填写 ISO 时间，例如 2026-03-22T23:59:59+08:00。`
            }, overrideState);
        }

        if (!expiryOverride.expired) {
            return buildMockPaymentRuntimeState({
                allowed: true,
                reason: 'remote_whitelist_until_enabled',
                message: `当前环境已通过限时白名单放行模拟支付，有效期至 ${formatIsoTimestamp(expiryOverride.expiresAt)}。`
            }, overrideState);
        }

        return buildMockPaymentRuntimeState({
            allowed: false,
            reason: 'remote_whitelist_until_expired',
            message: `模拟支付限时白名单已于 ${formatIsoTimestamp(expiryOverride.expiresAt)} 到期，请移除 ${expiryOverride.envName} 或重新设置新的截止时间。`
        }, overrideState);
    }

    if (overrideState.mode === 'boolean' && overrideState.active) {
        return buildMockPaymentRuntimeState({
            allowed: true,
            reason: 'remote_whitelist_enabled',
            message: '当前环境已通过长期白名单放行模拟支付。建议改用 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 设置自动失效时间。'
        }, overrideState);
    }

    return buildMockPaymentRuntimeState({
        allowed: false,
        reason: 'remote_whitelist_required',
        message: '当前环境不是本地环境，且未配置模拟支付白名单；如需临时测试，建议设置 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 后重新部署。'
    }, overrideState);
}

function isMockPaymentRuntimeAllowed({ requestHost = '', env = process.env } = {}) {
    return getMockPaymentRuntimeState({ requestHost, env }).allowed === true;
}

function isMissingDatabaseStructureError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return code === '42703'
        || code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('relation') && message.includes('does not exist'));
}

function isMissingDatabaseCapabilityError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return isMissingDatabaseStructureError(error)
        || code === '42883'
        || code === 'PGRST202'
        || (message.includes('function') && message.includes('does not exist'))
        || message.includes('could not find the function')
        || message.includes('schema cache');
}

function shouldFallbackToAdminPaymentClient(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    const message = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').trim().toLowerCase();

    return code === '401'
        || code === '403'
        || code === '42501'
        || code === 'PGRST301'
        || message.includes('permission denied')
        || message.includes('row-level security')
        || message.includes('unauthorized')
        || message.includes('auth session')
        || message.includes('jwt')
        || message.includes('invalid claim')
        || message.includes('not allowed');
}

async function runPaymentOperationWithAdminFallback({
    operationLabel = 'payment operation',
    primaryClient = null,
    adminClient = null,
    operation
} = {}) {
    if (typeof operation !== 'function') {
        throw new TypeError(`${operationLabel} requires an operation callback`);
    }

    try {
        return {
            client: primaryClient,
            result: await operation(primaryClient)
        };
    } catch (error) {
        const canFallback = adminClient
            && primaryClient
            && adminClient !== primaryClient
            && shouldFallbackToAdminPaymentClient(error);

        if (!canFallback) {
            throw error;
        }

        console.warn(
            `[Payments] ${operationLabel} failed for request-scoped client, retrying with admin client:`,
            error.message
        );

        return {
            client: adminClient,
            result: await operation(adminClient)
        };
    }
}

function getRpcSingleRow(data) {
    if (Array.isArray(data)) {
        return data[0] || null;
    }
    return data || null;
}

function buildPendingProviderOrderNo(providerKey = '', sessionKey = '') {
    const normalizedProvider = String(providerKey || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .slice(0, 16) || 'PAY';
    const normalizedSession = String(sessionKey || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .slice(0, 88) || crypto.randomBytes(6).toString('hex').toUpperCase();
    return `${PENDING_PROVIDER_ORDER_PREFIX}_${normalizedProvider}_${normalizedSession}`.slice(0, 120);
}

function isPendingProviderOrderNo(value = '') {
    return String(value || '').trim().toUpperCase().startsWith(`${PENDING_PROVIDER_ORDER_PREFIX}_`);
}

function isUnresolvedPendingPaymentOrder(order = {}) {
    const metadata = order?.provider_metadata && typeof order.provider_metadata === 'object'
        ? order.provider_metadata
        : {};
    return metadata.provider_order_resolved === false
        || metadata.provider_order_pending === true
        || isPendingProviderOrderNo(order.provider_order_no);
}

function buildMockOrderNo(explicitOrderNo = '') {
    return mockProvider.buildOrderNo({ explicitOrderNo });
}

function buildCheckoutSessionKey(providerKey = '') {
    const normalizedProvider = String(providerKey || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 12) || 'PAY';

    return `PCS_${normalizedProvider}_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getCheckoutSessionExpiryIso(hours = CHECKOUT_SESSION_EXPIRY_HOURS) {
    const date = new Date();
    date.setUTCHours(date.getUTCHours() + Math.max(1, Number(hours) || CHECKOUT_SESSION_EXPIRY_HOURS));
    return date.toISOString();
}

function buildCheckoutSessionLookbackIso(minutes = 1440) {
    const date = new Date();
    date.setUTCMinutes(date.getUTCMinutes() - Math.max(5, Number(minutes) || 1440));
    return date.toISOString();
}

function mergeObjects(baseValue, patchValue) {
    const base = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
    const patch = patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue) ? patchValue : {};
    return {
        ...base,
        ...patch
    };
}

function deriveCheckoutSessionStatusFromOrderStatus(orderStatus = '') {
    const normalizedStatus = String(orderStatus || '').trim().toLowerCase();
    if (['paid', 'redeemed'].includes(normalizedStatus)) return 'completed';
    if (['rejected', 'amount_mismatch'].includes(normalizedStatus)) return 'failed';
    return 'redirect_ready';
}

function scoreCheckoutSessionCandidate(session, context = {}) {
    let score = 0;
    const providerOrderNo = sanitizeText(context.providerOrderNo, '', 160);
    const sessionMetadata = session?.provider_metadata && typeof session.provider_metadata === 'object'
        ? session.provider_metadata
        : {};

    if (context.userId && session.user_id === context.userId) score += 140;
    if (context.site && session.site === context.site) score += 25;
    if (context.packageId && session.package_id === context.packageId) score += 70;
    if (context.packageName && sanitizeText(session.package_name, '', 120) === context.packageName) score += 18;
    if (providerOrderNo && (
        sanitizeText(sessionMetadata.provider_order_no, '', 160) === providerOrderNo
        || sanitizeText(sessionMetadata.order_no, '', 160) === providerOrderNo
    )) {
        score += 220;
    }

    const expectedAmount = normalizeCurrency(context.expectedAmount, null);
    const paidAmount = normalizeCurrency(context.paidAmount, null);
    const sessionExpectedAmount = normalizeCurrency(session.expected_amount, null);
    if (expectedAmount !== null && sessionExpectedAmount !== null && expectedAmount === sessionExpectedAmount) {
        score += 50;
    } else if (paidAmount !== null && sessionExpectedAmount !== null && paidAmount === sessionExpectedAmount) {
        score += 35;
    }

    const requestedPoints = normalizePointValue(context.pointsAmount, 0);
    const sessionGrantedPoints = normalizePointValue(session.granted_points, 0);
    const sessionRequestedPoints = normalizePointValue(session.requested_points, 0);
    if (requestedPoints > 0) {
        if (sessionGrantedPoints === requestedPoints) {
            score += 35;
        } else if (sessionRequestedPoints === requestedPoints) {
            score += 20;
        }
    }

    if (String(session.status || '') === 'redirect_ready') score += 8;

    const createdAtMs = Number(new Date(session.created_at || 0).getTime());
    if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
        const ageMinutes = Math.max(0, (Date.now() - createdAtMs) / 60000);
        if (ageMinutes <= 30) {
            score += 24;
        } else if (ageMinutes <= 120) {
            score += 12;
        }
    }

    return score;
}

async function findCheckoutSessionCandidates(supabase, context = {}) {
    const providerKey = String(context.providerKey || '').trim().toLowerCase();
    if (!providerKey) return [];

    let query = supabase
        .from('payment_checkout_sessions')
        .select('*')
        .eq('provider', providerKey)
        .in('status', ACTIVE_CHECKOUT_SESSION_STATUSES)
        .is('payment_order_id', null)
        .gte('created_at', buildCheckoutSessionLookbackIso(context.lookbackMinutes || 1440))
        .order('created_at', { ascending: false })
        .limit(12);

    if (context.userId) {
        query = query.eq('user_id', context.userId);
    }

    if (context.site) {
        query = query.eq('site', context.site);
    }

    if (context.packageId) {
        query = query.eq('package_id', context.packageId);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(error.message || 'Failed to query payment checkout sessions');
    }

    return (data || []).map((session) => ({
        session,
        score: scoreCheckoutSessionCandidate(session, context)
    })).sort((left, right) => right.score - left.score);
}

async function loadCheckoutSessionByPaymentOrder(supabase, paymentOrderId) {
    const normalizedPaymentOrderId = String(paymentOrderId || '').trim();
    if (!normalizedPaymentOrderId) return null;

    const { data, error } = await supabase
        .from('payment_checkout_sessions')
        .select('*')
        .eq('payment_order_id', normalizedPaymentOrderId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to inspect linked payment checkout session');
    }

    return data || null;
}

async function loadCheckoutSessionById(supabase, checkoutSessionId) {
    const normalizedCheckoutSessionId = String(checkoutSessionId || '').trim();
    if (!normalizedCheckoutSessionId) return null;

    const { data, error } = await supabase
        .from('payment_checkout_sessions')
        .select('*')
        .eq('id', normalizedCheckoutSessionId)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment checkout session by id');
    }

    return data || null;
}

function getCheckoutSessionSummary(checkoutSession = {}) {
    const providerMetadata = checkoutSession?.provider_metadata && typeof checkoutSession.provider_metadata === 'object'
        ? checkoutSession.provider_metadata
        : {};
    const summary = providerMetadata.summary && typeof providerMetadata.summary === 'object'
        ? providerMetadata.summary
        : {};

    return summary && typeof summary === 'object' ? summary : {};
}

function getReusableCheckoutSessionPaymentUrl(checkoutSession = {}) {
    const summary = getCheckoutSessionSummary(checkoutSession);
    return sanitizeText(
        checkoutSession?.checkout_url
            || summary.checkout_url
            || summary.checkoutUrl
            || summary.qrcode_url
            || summary.qrcode_img_url,
        '',
        1000
    );
}

function getReusableCheckoutSessionProviderOrderNo(checkoutSession = {}) {
    return getCheckoutSessionProviderOrderNo(checkoutSession);
}

function getCheckoutSessionClientPaymentRequestId(checkoutSession = {}) {
    const metadata = checkoutSession?.provider_metadata && typeof checkoutSession.provider_metadata === 'object'
        ? checkoutSession.provider_metadata
        : {};
    const requestPayload = checkoutSession?.request_payload && typeof checkoutSession.request_payload === 'object'
        ? checkoutSession.request_payload
        : {};
    const request = requestPayload.request && typeof requestPayload.request === 'object'
        ? requestPayload.request
        : {};

    return normalizeClientPaymentRequestId(
        metadata.client_payment_request_id
        || metadata.clientPaymentRequestId
        || request.client_payment_request_id
        || request.clientPaymentRequestId
    );
}

function isReusableCheckoutSessionForPaymentRequest(checkoutSession = {}, {
    providerKey = '',
    userId = '',
    site = '',
    packageId = '',
    packageName = '',
    grantedPoints = 0,
    paidAmount = null,
    clientPaymentRequestId = ''
} = {}) {
    const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();
    const normalizedUserId = String(userId || '').trim();
    const normalizedSite = requireSupportedSite(site || checkoutSession?.site || 'cn');
    const normalizedClientPaymentRequestId = normalizeClientPaymentRequestId(clientPaymentRequestId);
    const status = sanitizeText(checkoutSession?.status, '', 40).toLowerCase();

    if (!normalizedProviderKey || !normalizedUserId) return false;
    if (!normalizedClientPaymentRequestId) return false;
    if (getCheckoutSessionClientPaymentRequestId(checkoutSession) !== normalizedClientPaymentRequestId) return false;
    if (checkoutSession?.provider !== normalizedProviderKey) return false;
    if (checkoutSession?.user_id !== normalizedUserId) return false;
    if (checkoutSession?.site !== normalizedSite) return false;
    if (status !== 'redirect_ready') return false;
    if (!getReusableCheckoutSessionPaymentUrl(checkoutSession)) return false;

    const nowMs = Date.now();
    const createdAtMs = Date.parse(String(checkoutSession?.created_at || ''));
    if (!Number.isFinite(createdAtMs) || (nowMs - createdAtMs) > REUSABLE_PAYMENT_CREATE_LOOKBACK_MINUTES * 60_000) {
        return false;
    }

    const expiresMs = Date.parse(String(checkoutSession?.expires_at || ''));
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) return false;

    const expectedAmount = normalizeCurrency(paidAmount, null);
    const sessionExpectedAmount = normalizeCurrency(checkoutSession?.expected_amount, null);
    if (expectedAmount !== null && sessionExpectedAmount !== expectedAmount) return false;

    const expectedPoints = normalizePointAmount(grantedPoints, 0);
    const sessionGrantedPoints = normalizePointAmount(checkoutSession?.granted_points, 0);
    if (expectedPoints > 0 && sessionGrantedPoints !== expectedPoints) return false;

    const normalizedPackageId = String(packageId || '').trim();
    if (normalizedPackageId) {
        if (String(checkoutSession?.package_id || '').trim() !== normalizedPackageId) return false;
    } else if (checkoutSession?.package_id) {
        return false;
    }

    const normalizedPackageName = sanitizeText(packageName, '', 120);
    if (normalizedPackageName && sanitizeText(checkoutSession?.package_name, '', 120) !== normalizedPackageName) {
        return false;
    }

    return true;
}

function isReusablePaymentOrderForCheckoutSession(paymentOrder = null, checkoutSession = {}) {
    if (!paymentOrder?.id) return false;
    if (String(paymentOrder.checkout_session_id || '').trim() !== String(checkoutSession?.id || '').trim()) {
        return false;
    }

    const status = sanitizeText(paymentOrder.status, '', 40).toLowerCase();
    return !['paid', 'redeemed', 'pending_review', 'amount_mismatch', 'rejected', 'refunded'].includes(status);
}

async function findReusableCheckoutSessionForPaymentRequest(supabase, context = {}) {
    const normalizedProviderKey = String(context.providerKey || '').trim().toLowerCase();
    const normalizedUserId = String(context.userId || '').trim();
    const normalizedSite = requireSupportedSite(context.site || 'cn');
    const normalizedClientPaymentRequestId = normalizeClientPaymentRequestId(context.clientPaymentRequestId);
    if (!supabase || !normalizedProviderKey || !normalizedUserId || !normalizedClientPaymentRequestId) return null;

    let query = supabase
        .from('payment_checkout_sessions')
        .select('*')
        .eq('provider', normalizedProviderKey)
        .eq('user_id', normalizedUserId)
        .eq('site', normalizedSite)
        .eq('status', 'redirect_ready')
        .order('created_at', { ascending: false })
        .limit(6);

    if (context.packageId) {
        query = query.eq('package_id', context.packageId);
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingDatabaseStructureError(error)) return null;
        throw new Error(error.message || 'Failed to inspect reusable payment checkout sessions');
    }

    const rows = Array.isArray(data) ? data : [];
    for (const session of rows) {
        if (!isReusableCheckoutSessionForPaymentRequest(session, context)) {
            continue;
        }

        const providerOrderNo = getReusableCheckoutSessionProviderOrderNo(session);
        let linkedPaymentOrder = null;
        if (session.payment_order_id) {
            linkedPaymentOrder = await loadPaymentOrderForLinking(supabase, session.payment_order_id);
        } else if (providerOrderNo) {
            linkedPaymentOrder = await loadPaymentOrderByProviderOrderNo(supabase, normalizedProviderKey, providerOrderNo);
        }

        if (!linkedPaymentOrder?.id || isReusablePaymentOrderForCheckoutSession(linkedPaymentOrder, session)) {
            return session;
        }
    }

    return null;
}

async function buildReusablePaymentRequestResponse({
    checkoutSession,
    providerKey,
    adapter,
    packageName,
    grantedPoints,
    paidAmount,
    paymentPricing,
    customQuote = null
}) {
    const providerMetadata = checkoutSession?.provider_metadata && typeof checkoutSession.provider_metadata === 'object'
        ? checkoutSession.provider_metadata
        : {};
    const summary = getCheckoutSessionSummary(checkoutSession);
    const pricingPayload = buildPaymentPricingPayload(paymentPricing || providerMetadata.payment_pricing || summary);
    const providerSummary = {
        ...summary,
        ...pricingPayload
    };
    const providerOrderNo = getReusableCheckoutSessionProviderOrderNo(checkoutSession);

    return {
        success: true,
        provider: providerKey,
        mode: providerMetadata.action || 'redirect',
        reused_existing_checkout: true,
        display_name: providerMetadata.display_name || adapter?.label || '当前支付通道',
        checkout_url: getReusableCheckoutSessionPaymentUrl(checkoutSession),
        package_name: packageName,
        points_amount: normalizePointValue(grantedPoints, 0),
        paid_amount: normalizeCurrency(paidAmount, null),
        base_amount: pricingPayload.base_amount,
        payment_fee_amount: pricingPayload.payment_fee_amount,
        payment_fee_rate: pricingPayload.payment_fee_rate,
        payment_fee_label: pricingPayload.payment_fee_label,
        query_mode: checkoutSession.query_mode || 'provider_order_no',
        provider_order_no: providerOrderNo || null,
        checkout_session_id: checkoutSession.id,
        checkout_session_key: checkoutSession.session_key,
        checkout_session_status: checkoutSession.status || 'redirect_ready',
        message: providerMetadata.message || `${providerMetadata.display_name || adapter?.label || '当前支付通道'}已准备就绪。`,
        provider_summary: providerSummary,
        custom_quote: customQuote
            ? {
                quote_id: customQuote.quoteId,
                token: customQuote.token,
                issued_at: customQuote.issuedAt,
                expires_at: customQuote.expiresAt,
                points_amount: customQuote.pointsAmount,
                paid_amount: paidAmount,
                base_amount: pricingPayload.base_amount,
                payment_fee_amount: pricingPayload.payment_fee_amount,
                payment_fee_rate: pricingPayload.payment_fee_rate,
                pricing_mode: customQuote.pricingMode,
                points_per_cny: customQuote.pointsPerCny
            }
            : (providerMetadata.custom_quote || null),
        payment_claim: null
    };
}

async function loadPaymentOrderForLinking(supabase, paymentOrderId) {
    const normalizedPaymentOrderId = String(paymentOrderId || '').trim();
    if (!normalizedPaymentOrderId) return null;

    const primarySelect = 'id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, last_error, raw_payload, provider_metadata';
    const fallbackSelect = 'id, user_id, provider, provider_order_no, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, last_error, raw_payload, provider_metadata';
    let data;
    let error;

    ({ data, error } = await supabase
        .from('payment_orders')
        .select(primarySelect)
        .eq('id', normalizedPaymentOrderId)
        .maybeSingle());

    if (error && isMissingDatabaseStructureError(error)) {
        ({ data, error } = await supabase
            .from('payment_orders')
            .select(fallbackSelect)
            .eq('id', normalizedPaymentOrderId)
            .maybeSingle());
    }

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment order');
    }

    return data || null;
}

async function loadPaymentOrderByProviderOrderNo(supabase, providerKey, providerOrderNo) {
    const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();
    const normalizedProviderOrderNo = sanitizeText(providerOrderNo, '', 160);
    if (!normalizedProviderKey || !normalizedProviderOrderNo) {
        return null;
    }

    const primarySelect = 'id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, last_error, created_at, updated_at, paid_at, claimed_at, verified_at, raw_payload, provider_metadata';
    const fallbackSelect = 'id, user_id, provider, provider_order_no, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, last_error, created_at, updated_at, paid_at, claimed_at, verified_at, raw_payload, provider_metadata';
    let data;
    let error;

    ({ data, error } = await supabase
        .from('payment_orders')
        .select(primarySelect)
        .eq('provider', normalizedProviderKey)
        .eq('provider_order_no', normalizedProviderOrderNo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle());

    if (error && isMissingDatabaseStructureError(error)) {
        ({ data, error } = await supabase
            .from('payment_orders')
            .select(fallbackSelect)
            .eq('provider', normalizedProviderKey)
            .eq('provider_order_no', normalizedProviderOrderNo)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle());
    }

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment order by provider order number');
    }

    return data || null;
}

async function createPendingPaymentOrderForCheckoutSession({
    supabase,
    checkoutSession,
    user,
    providerKey,
    providerOrderNo = '',
    site,
    packageId = '',
    packageName = '',
    paidAmount = null,
    grantedPoints = 0
}) {
    const sessionId = String(checkoutSession?.id || '').trim();
    const sessionKey = String(checkoutSession?.session_key || '').trim();
    const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();
    const normalizedSite = requireSupportedSite(site);
    if (!supabase || !sessionId || !normalizedProviderKey) return null;

    const nowIso = new Date().toISOString();
    const pendingOrderNo = sanitizeText(providerOrderNo, '', 160)
        || buildPendingProviderOrderNo(normalizedProviderKey, sessionKey || sessionId);
    const providerMetadata = mergeObjects(checkoutSession?.provider_metadata, {
        checkout_session_id: sessionId,
        checkout_session_key: sessionKey || null,
        order_origin: 'payment_checkout_session',
        provider_order_pending: true,
        provider_order_resolved: false,
        intent_created_at: nowIso
    });
    const rawPayload = mergeObjects(checkoutSession?.request_payload, {
        checkout_session_id: sessionId,
        checkout_session_key: sessionKey || null
    });

    const payload = {
        provider: normalizedProviderKey,
        provider_order_no: pendingOrderNo,
        user_id: user?.id || null,
        checkout_session_id: sessionId,
        site: normalizedSite,
        package_id: packageId || null,
        package_name: packageName || null,
        expected_amount: paidAmount,
        paid_amount: null,
        points_amount: normalizePointValue(grantedPoints, 0),
        status: 'pending',
        sign_verified: false,
        amount_verified: false,
        raw_payload: rawPayload,
        provider_metadata: providerMetadata,
        created_at: nowIso,
        updated_at: nowIso
    };

    if (typeof supabase?.rpc === 'function') {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
            'fn_create_pending_payment_order_for_checkout_session',
            {
                p_payload: payload,
                p_user_id: user?.id || null
            }
        );

        if (!rpcError) {
            return getRpcSingleRow(rpcData);
        }

        if (!isMissingDatabaseCapabilityError(rpcError)) {
            throw new Error(rpcError.message || 'Failed to create pending payment order');
        }
    }

    try {
        const { data: existingOrder, error: existingOrderError } = await supabase
            .from('payment_orders')
            .select('id, provider, provider_order_no, checkout_session_id, status, provider_metadata')
            .eq('provider', normalizedProviderKey)
            .eq('checkout_session_id', sessionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existingOrderError && !isMissingDatabaseStructureError(existingOrderError)) {
            throw new Error(existingOrderError.message || 'Failed to inspect pending payment order');
        }

        if (existingOrder) {
            return existingOrder;
        }
    } catch (error) {
        if (!isMissingDatabaseStructureError(error)) {
            throw error;
        }
        return null;
    }

    const { data, error } = await supabase
        .from('payment_orders')
        .insert(payload)
        .select('id, provider, provider_order_no, checkout_session_id, status, provider_metadata')
        .single();

    if (error) {
        if (isMissingDatabaseStructureError(error)) {
            return null;
        }
        throw new Error(error.message || 'Failed to create pending payment order');
    }

    return data || null;
}

async function resolvePendingPaymentOrderFromCheckoutContext({
    supabase,
    providerKey,
    providerOrderNo = '',
    userId = '',
    site = '',
    packageId = '',
    packageName = '',
    expectedAmount = null,
    paidAmount = null,
    pointsAmount = 0,
    lookbackMinutes = 1440
}) {
    const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();
    const normalizedProviderOrderNo = sanitizeText(providerOrderNo, '', 160);
    if (!supabase || !normalizedProviderKey) return null;

    if (normalizedProviderOrderNo) {
        try {
            const { data: existingOrder, error: existingOrderError } = await supabase
                .from('payment_orders')
                .select('id, checkout_session_id')
                .eq('provider', normalizedProviderKey)
                .eq('provider_order_no', normalizedProviderOrderNo)
                .maybeSingle();

            if (existingOrderError && !isMissingDatabaseStructureError(existingOrderError)) {
                throw new Error(existingOrderError.message || 'Failed to inspect resolved payment order');
            }

            if (existingOrder?.id) {
                return {
                    paymentOrderId: existingOrder.id,
                    checkoutSessionId: existingOrder.checkout_session_id || null,
                    resolvedBy: 'provider_order_no'
                };
            }
        } catch (error) {
            if (!isMissingDatabaseStructureError(error)) {
                throw error;
            }
            return null;
        }
    }

    const candidates = await findCheckoutSessionCandidates(supabase, {
        providerKey: normalizedProviderKey,
        userId,
        site,
        packageId,
        packageName,
        expectedAmount,
        paidAmount,
        pointsAmount,
        lookbackMinutes
    });
    const [bestCandidate, secondCandidate] = candidates;
    const topScore = bestCandidate?.score || 0;
    const secondScore = secondCandidate?.score || 0;
    const shouldUseBestCandidate = userId
        ? topScore >= 80
        : (topScore >= 120 && (topScore - secondScore >= 35 || !secondCandidate));

    if (!shouldUseBestCandidate || !bestCandidate?.session?.id) {
        return null;
    }

    try {
        const { data: pendingOrder, error: pendingOrderError } = await supabase
            .from('payment_orders')
            .select('id, provider_order_no, checkout_session_id, status, provider_metadata')
            .eq('provider', normalizedProviderKey)
            .eq('checkout_session_id', bestCandidate.session.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (pendingOrderError) {
            if (isMissingDatabaseStructureError(pendingOrderError)) {
                return null;
            }
            throw new Error(pendingOrderError.message || 'Failed to inspect pending payment order');
        }

        if (!pendingOrder || !isUnresolvedPendingPaymentOrder(pendingOrder)) {
            return null;
        }

        return {
            paymentOrderId: pendingOrder.id,
            checkoutSessionId: pendingOrder.checkout_session_id || bestCandidate.session.id,
            resolvedBy: 'checkout_session_candidate',
            sessionScore: bestCandidate.score
        };
    } catch (error) {
        if (isMissingDatabaseStructureError(error)) {
            return null;
        }
        throw error;
    }
}

async function detachSupersededPendingOrdersForCheckoutSession({
    supabase,
    checkoutSessionId,
    keepPaymentOrderId,
    linkedBy = 'runtime'
}) {
    const normalizedCheckoutSessionId = String(checkoutSessionId || '').trim();
    const normalizedKeepPaymentOrderId = String(keepPaymentOrderId || '').trim();
    if (!supabase || !normalizedCheckoutSessionId || !normalizedKeepPaymentOrderId) {
        return;
    }

    let data;
    let error;
    ({ data, error } = await supabase
        .from('payment_orders')
        .select('id, status, provider_order_no, checkout_session_id, provider_metadata, last_error')
        .eq('checkout_session_id', normalizedCheckoutSessionId)
        .neq('id', normalizedKeepPaymentOrderId)
        .order('created_at', { ascending: false })
        .limit(8));

    if (error) {
        if (isMissingDatabaseStructureError(error)) {
            return;
        }
        throw new Error(error.message || 'Failed to inspect conflicting checkout session payment orders');
    }

    const conflicts = Array.isArray(data) ? data : [];
    const unexpectedConflict = conflicts.find((item) => !isUnresolvedPendingPaymentOrder(item));
    if (unexpectedConflict) {
        throw new Error('Checkout session already linked to another resolved payment order');
    }

    const nowIso = new Date().toISOString();
    for (const pendingOrder of conflicts) {
        const nextMetadata = mergeObjects(pendingOrder.provider_metadata, {
            checkout_session_id: normalizedCheckoutSessionId,
            provider_order_pending: true,
            provider_order_resolved: false,
            checkout_session_detached_at: nowIso,
            checkout_session_detached_by: linkedBy,
            superseded_by_payment_order_id: normalizedKeepPaymentOrderId
        });
        const patch = {
            checkout_session_id: null,
            provider_metadata: nextMetadata,
            last_error: sanitizeText(pendingOrder.last_error, 'superseded_by_resolved_payment_order', 240)
        };

        let { error: updateError } = await supabase
            .from('payment_orders')
            .update(patch)
            .eq('id', pendingOrder.id);

        if (updateError && isMissingDatabaseStructureError(updateError) && Object.prototype.hasOwnProperty.call(patch, 'checkout_session_id')) {
            const fallbackPatch = { ...patch };
            delete fallbackPatch.checkout_session_id;
            ({ error: updateError } = await supabase
                .from('payment_orders')
                .update(fallbackPatch)
                .eq('id', pendingOrder.id));
        }

        if (updateError) {
            throw new Error(updateError.message || 'Failed to release superseded pending payment order');
        }
    }
}

async function reconcileCheckoutSessionForPaymentOrder({
    supabase,
    providerKey,
    paymentOrderId,
    providerOrderNo = '',
    userId = '',
    site = '',
    packageId = '',
    packageName = '',
    expectedAmount = null,
    paidAmount = null,
    pointsAmount = 0,
    orderStatus = '',
    linkedBy = 'runtime',
    lookbackMinutes = 1440,
    allowHeuristic = true
}) {
    const normalizedPaymentOrderId = String(paymentOrderId || '').trim();
    if (!normalizedPaymentOrderId) return null;

    const paymentOrder = await loadPaymentOrderForLinking(supabase, normalizedPaymentOrderId);
    if (!paymentOrder) return null;

    const existingLinkedSession = await loadCheckoutSessionByPaymentOrder(supabase, normalizedPaymentOrderId);
    const hintedLinkedSession = !existingLinkedSession && paymentOrder.checkout_session_id
        ? await loadCheckoutSessionById(supabase, paymentOrder.checkout_session_id)
        : null;
    const context = {
        providerKey: providerKey || paymentOrder.provider,
        providerOrderNo: providerOrderNo || paymentOrder.provider_order_no,
        userId: userId || paymentOrder.user_id,
        site: site || paymentOrder.site,
        packageId: packageId || paymentOrder.package_id,
        packageName: packageName || paymentOrder.package_name,
        expectedAmount: expectedAmount ?? paymentOrder.expected_amount,
        paidAmount: paidAmount ?? paymentOrder.paid_amount,
        pointsAmount: pointsAmount || paymentOrder.points_amount,
        lookbackMinutes
    };

    let targetSession = existingLinkedSession || hintedLinkedSession;

    if (targetSession?.payment_order_id && targetSession.payment_order_id !== normalizedPaymentOrderId) {
        targetSession = null;
    }

    if (!targetSession) {
        const candidates = await findCheckoutSessionCandidates(supabase, context);
        const [bestCandidate, secondCandidate] = candidates;
        const topScore = bestCandidate?.score || 0;
        const secondScore = secondCandidate?.score || 0;

        if (context.userId) {
            targetSession = topScore >= 80 ? bestCandidate?.session || null : null;
        } else if (allowHeuristic && topScore >= 120 && (topScore - secondScore >= 35 || !secondCandidate)) {
            targetSession = bestCandidate?.session || null;
        }
    }

    if (!targetSession) return null;

    const nowIso = new Date().toISOString();
    const nextSessionStatus = deriveCheckoutSessionStatusFromOrderStatus(orderStatus || paymentOrder.status);
    const nextProviderOrderNo = context.providerOrderNo || paymentOrder.provider_order_no;

    await detachSupersededPendingOrdersForCheckoutSession({
        supabase,
        checkoutSessionId: targetSession.id,
        keepPaymentOrderId: normalizedPaymentOrderId,
        linkedBy
    });

    const nextSessionProviderMetadata = mergeObjects(targetSession.provider_metadata, {
        provider_order_no: nextProviderOrderNo || null,
        payment_order_id: normalizedPaymentOrderId,
        payment_status: String(orderStatus || paymentOrder.status || '').trim().toLowerCase() || null,
        linked_by: linkedBy,
        linked_at: nowIso
    });

    const updatedSession = await updateCheckoutSession(supabase, targetSession.id, {
        payment_order_id: normalizedPaymentOrderId,
        status: nextSessionStatus,
        completed_at: nextSessionStatus === 'completed'
            ? (targetSession.completed_at || nowIso)
            : targetSession.completed_at,
        error_message: nextSessionStatus === 'failed'
            ? (paymentOrder.last_error || targetSession.error_message || null)
            : null,
        provider_metadata: nextSessionProviderMetadata
    });

    const nextOrderProviderMetadata = mergeObjects(paymentOrder.provider_metadata, {
        checkout_session_id: updatedSession?.id || targetSession.id,
        checkout_session_key: updatedSession?.session_key || targetSession.session_key,
        checkout_session_status: updatedSession?.status || nextSessionStatus,
        checkout_session_linked_at: nowIso,
        checkout_session_linked_by: linkedBy,
        provider_order_no: nextProviderOrderNo || null
    });
    const nextOrderRawPayload = mergeObjects(paymentOrder.raw_payload, {
        checkout_session_id: updatedSession?.id || targetSession.id,
        checkout_session_key: updatedSession?.session_key || targetSession.session_key
    });

    const orderPatch = {
        checkout_session_id: updatedSession?.id || targetSession.id,
        provider_metadata: nextOrderProviderMetadata,
        raw_payload: nextOrderRawPayload
    };
    if (!paymentOrder.user_id && context.userId) {
        orderPatch.user_id = context.userId;
    }

    let { error: orderUpdateError } = await supabase
        .from('payment_orders')
        .update(orderPatch)
        .eq('id', normalizedPaymentOrderId);

    if (orderUpdateError && isMissingDatabaseStructureError(orderUpdateError) && Object.prototype.hasOwnProperty.call(orderPatch, 'checkout_session_id')) {
        const fallbackOrderPatch = { ...orderPatch };
        delete fallbackOrderPatch.checkout_session_id;
        ({ error: orderUpdateError } = await supabase
            .from('payment_orders')
            .update(fallbackOrderPatch)
            .eq('id', normalizedPaymentOrderId));
    }

    if (orderUpdateError) {
        throw new Error(orderUpdateError.message || 'Failed to backfill payment order checkout session');
    }

    return {
        sessionId: updatedSession?.id || targetSession.id,
        checkoutSession: updatedSession || targetSession,
        paymentOrderId: normalizedPaymentOrderId
    };
}

async function loadCheckoutSessionForUser(supabase, userId, sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;

    const { data, error } = await supabase
        .from('payment_checkout_sessions')
        .select('*')
        .eq('id', normalizedSessionId)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment checkout session');
    }

    if (!data) return null;

    if (data.user_id && data.user_id !== userId) {
        const forbiddenError = new Error('该支付会话已归属于其他账号');
        forbiddenError.statusCode = 403;
        throw forbiddenError;
    }

    return data;
}

async function loadPaymentOrderForUserByCheckoutSession(supabase, userId, checkoutSessionId, paymentOrderId = '') {
    const normalizedUserId = String(userId || '').trim();
    const normalizedCheckoutSessionId = String(checkoutSessionId || '').trim();
    const normalizedPaymentOrderId = String(paymentOrderId || '').trim();
    if (!supabase || !normalizedUserId || (!normalizedCheckoutSessionId && !normalizedPaymentOrderId)) {
        return null;
    }

    const primarySelect = 'id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, last_error, created_at, updated_at, paid_at, claimed_at, verified_at';
    const fallbackSelect = 'id, provider, provider_order_no, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, last_error, created_at, updated_at, paid_at, claimed_at, verified_at';

    async function runLookup(selectClause, mode = 'checkout_session') {
        let query = supabase
            .from('payment_orders')
            .select(selectClause)
            .eq('user_id', normalizedUserId);

        if (mode === 'payment_order_id') {
            query = query
                .eq('id', normalizedPaymentOrderId)
                .maybeSingle();
        } else {
            query = query
                .eq('checkout_session_id', normalizedCheckoutSessionId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
        }

        return query;
    }

    async function resolveLookup(mode = 'checkout_session') {
        let data;
        let error;

        ({ data, error } = await runLookup(primarySelect, mode));
        if (error && isMissingDatabaseStructureError(error)) {
            ({ data, error } = await runLookup(fallbackSelect, mode));
        }

        if (error) {
            throw new Error(error.message || 'Failed to inspect payment order status');
        }

        return data || null;
    }

    if (normalizedPaymentOrderId) {
        const byPaymentOrderId = await resolveLookup('payment_order_id');
        if (byPaymentOrderId) {
            return byPaymentOrderId;
        }
    }

    if (!normalizedCheckoutSessionId) {
        return null;
    }

    return resolveLookup('checkout_session');
}

function getCheckoutSessionProviderOrderNo(checkoutSession = {}) {
    const metadata = checkoutSession?.provider_metadata && typeof checkoutSession.provider_metadata === 'object'
        ? checkoutSession.provider_metadata
        : {};
    const summary = metadata.summary && typeof metadata.summary === 'object'
        ? metadata.summary
        : {};

    return sanitizeText(
        checkoutSession?.provider_order_no
        || metadata.provider_order_no
        || metadata.order_no
        || summary.out_trade_no,
        '',
        160
    );
}

function resolvePaymentOrderCheckoutSessionId(paymentOrder = {}) {
    const providerMetadata = paymentOrder?.provider_metadata && typeof paymentOrder.provider_metadata === 'object'
        ? paymentOrder.provider_metadata
        : {};
    const rawPayload = paymentOrder?.raw_payload && typeof paymentOrder.raw_payload === 'object'
        ? paymentOrder.raw_payload
        : {};

    return sanitizeText(
        paymentOrder?.checkout_session_id
        || providerMetadata.checkout_session_id
        || rawPayload.checkout_session_id,
        '',
        80
    );
}

function canAccessPaymentOrderFromCheckoutSession({
    paymentOrder = null,
    checkoutSession = null,
    userId = ''
} = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!paymentOrder || !checkoutSession?.id || !normalizedUserId) {
        return false;
    }

    const linkedCheckoutSessionId = resolvePaymentOrderCheckoutSessionId(paymentOrder);
    if (linkedCheckoutSessionId && linkedCheckoutSessionId === String(checkoutSession.id || '').trim()) {
        return true;
    }

    if (paymentOrder.user_id && String(paymentOrder.user_id || '').trim() === normalizedUserId) {
        return true;
    }

    return false;
}

async function recoverZpayPaymentOrderForCheckoutSession({
    supabase,
    userId = '',
    checkoutSession = null,
    providerOrderNo = ''
} = {}) {
    const normalizedUserId = String(userId || '').trim();
    const providerKey = sanitizeText(checkoutSession?.provider, '', 40).toLowerCase();
    if (!supabase || !checkoutSession?.id || !normalizedUserId || providerKey !== 'zpay') {
        return {
            checkoutSession,
            paymentOrder: null,
            recovered: false
        };
    }

    const resolvedProviderOrderNo = sanitizeText(
        providerOrderNo || getCheckoutSessionProviderOrderNo(checkoutSession),
        '',
        160
    );
    if (!resolvedProviderOrderNo) {
        return {
            checkoutSession,
            paymentOrder: null,
            recovered: false
        };
    }

    const resolution = await resolvePendingPaymentOrderFromCheckoutContext({
        supabase,
        providerKey,
        providerOrderNo: resolvedProviderOrderNo,
        userId: normalizedUserId,
        site: checkoutSession.site,
        packageId: checkoutSession.package_id,
        packageName: checkoutSession.package_name,
        expectedAmount: checkoutSession.expected_amount,
        pointsAmount: checkoutSession.granted_points || checkoutSession.requested_points || 0,
        lookbackMinutes: 1440
    });

    if (!resolution?.paymentOrderId) {
        return {
            checkoutSession,
            paymentOrder: null,
            recovered: false
        };
    }

    try {
        await reconcileCheckoutSessionForPaymentOrder({
            supabase,
            providerKey,
            paymentOrderId: resolution.paymentOrderId,
            providerOrderNo: resolvedProviderOrderNo,
            userId: normalizedUserId,
            site: checkoutSession.site || 'cn',
            packageId: checkoutSession.package_id,
            packageName: checkoutSession.package_name,
            expectedAmount: checkoutSession.expected_amount,
            paidAmount: checkoutSession.expected_amount,
            pointsAmount: checkoutSession.granted_points || checkoutSession.requested_points || 0,
            linkedBy: 'zpay_status_recovery',
            allowHeuristic: true,
            lookbackMinutes: 1440
        });
    } catch (recoveryError) {
        console.warn('[Payments] Failed to recover ZPAY payment order linkage:', recoveryError.message);
    }

    const refreshedCheckoutSession = await loadCheckoutSessionForUser(supabase, normalizedUserId, checkoutSession.id)
        || checkoutSession;
    const refreshedPaymentOrder = await loadPaymentOrderForUserByCheckoutSession(
        supabase,
        normalizedUserId,
        refreshedCheckoutSession.id,
        resolution.paymentOrderId
    );

    return {
        checkoutSession: refreshedCheckoutSession,
        paymentOrder: refreshedPaymentOrder,
        recovered: Boolean(refreshedPaymentOrder?.id)
    };
}

async function attemptZpayPaymentStatusRefresh({
    supabase,
    checkoutSession,
    paymentOrder,
    env = process.env,
    forceProviderRefresh = false
} = {}) {
    const normalizedProvider = sanitizeText(
        paymentOrder?.provider || checkoutSession?.provider,
        '',
        40
    ).toLowerCase();
    if (normalizedProvider !== 'zpay') {
        return { refreshed: false, reason: 'unsupported_provider' };
    }

    const normalizedOrderId = String(paymentOrder?.id || '').trim();
    const normalizedOrderNo = sanitizeText(paymentOrder?.provider_order_no, '', 160);
    const normalizedUserId = String(paymentOrder?.user_id || checkoutSession?.user_id || '').trim();
    if (!supabase || !normalizedOrderId || !normalizedOrderNo || !normalizedUserId) {
        return { refreshed: false, reason: 'missing_local_order' };
    }

    const normalizedOrderStatus = sanitizeText(paymentOrder?.status, '', 40).toLowerCase();
    if (['paid', 'redeemed', 'pending_review', 'amount_mismatch', 'rejected'].includes(normalizedOrderStatus)) {
        return { refreshed: false, reason: 'already_resolved' };
    }

    const providerMetadata = paymentOrder?.provider_metadata && typeof paymentOrder.provider_metadata === 'object'
        ? paymentOrder.provider_metadata
        : {};
    const lastQueryAt = Date.parse(String(providerMetadata.query_verified_at || providerMetadata.status_poll_query_at || ''));
    const queryThrottleMs = forceProviderRefresh === true ? 1_200 : 8_000;
    if (Number.isFinite(lastQueryAt) && (Date.now() - lastQueryAt) < queryThrottleMs) {
        return { refreshed: false, reason: 'query_throttled' };
    }

    const adapter = getPaymentProviderAdapter('zpay');
    if (!adapter || typeof adapter.resolveRuntimeContext !== 'function' || typeof adapter.queryOrder !== 'function') {
        return { refreshed: false, reason: 'adapter_unavailable' };
    }

    const runtimeContext = await adapter.resolveRuntimeContext({
        supabase,
        env,
        site: paymentOrder?.site || checkoutSession?.site || providerMetadata.site || ''
    });
    const liveOrder = await adapter.queryOrder({
        runtimeContext,
        providerOrderNo: normalizedOrderNo,
        tradeNo: sanitizeText(providerMetadata.trade_no || providerMetadata.query_trade_no, '', 120)
    });

    const queryStatus = sanitizeText(liveOrder?.status, '', 40).toLowerCase();
    const nowIso = new Date().toISOString();
    const expectedAmount = normalizeCurrency(
        paymentOrder?.expected_amount ?? checkoutSession?.expected_amount,
        null
    );
    const livePaidAmount = normalizeCurrency(liveOrder?.paidAmount, null);
    const nextRawPayloadBase = mergeObjects(paymentOrder?.raw_payload, {
        zpay_status_poll: liveOrder?.responsePayload || null
    });
    const nextProviderMetadataBase = mergeObjects(providerMetadata, {
        provider_order_no: normalizedOrderNo,
        query_trade_no: sanitizeText(liveOrder?.tradeNo, '', 120) || sanitizeText(providerMetadata.query_trade_no, '', 120) || null,
        query_status: queryStatus || null,
        query_status_raw: sanitizeText(liveOrder?.statusRaw, '', 80) || null,
        query_verified_at: nowIso,
        status_poll_query_at: nowIso
    });

    if (liveOrder?.supported === false || liveOrder?.success !== true) {
        return {
            refreshed: false,
            reason: 'query_unavailable',
            liveOrder
        };
    }

    if (queryStatus !== 'paid') {
        return {
            refreshed: false,
            reason: 'not_paid',
            liveOrder
        };
    }

    if (!(expectedAmount > 0) || !(livePaidAmount > 0)) {
        return {
            refreshed: false,
            reason: 'invalid_amount',
            liveOrder
        };
    }

    if (!amountsMatch(expectedAmount, livePaidAmount)) {
        const mismatchPatch = {
            status: 'amount_mismatch',
            amount_verified: false,
            paid_amount: livePaidAmount,
            expected_amount: expectedAmount,
            last_error: `query_amount_mismatch_expected_${expectedAmount}`,
            raw_payload: nextRawPayloadBase,
            provider_metadata: mergeObjects(nextProviderMetadataBase, {
                payment_status: 'paid',
                payment_status_raw: sanitizeText(liveOrder?.statusRaw, '', 80) || 'TRADE_SUCCESS'
            })
        };

        const { error: mismatchUpdateError } = await supabase
            .from('payment_orders')
            .update(mismatchPatch)
            .eq('id', normalizedOrderId);

        if (mismatchUpdateError) {
            throw new Error(mismatchUpdateError.message || 'Failed to mark ZPAY amount mismatch');
        }

        try {
            await reconcileCheckoutSessionForPaymentOrder({
                supabase,
                providerKey: 'zpay',
                paymentOrderId: normalizedOrderId,
                providerOrderNo: normalizedOrderNo,
                userId: normalizedUserId,
                site: paymentOrder?.site || checkoutSession?.site || 'cn',
                packageId: paymentOrder?.package_id || checkoutSession?.package_id,
                packageName: paymentOrder?.package_name || checkoutSession?.package_name,
                expectedAmount,
                paidAmount: livePaidAmount,
                pointsAmount: paymentOrder?.points_amount || checkoutSession?.granted_points || 0,
                orderStatus: 'amount_mismatch',
                linkedBy: 'zpay_status_poll',
                allowHeuristic: true,
                lookbackMinutes: 1440
            });
        } catch (linkError) {
            console.warn('[Payments] Failed to link amount-mismatch ZPAY checkout session from status poll:', linkError.message);
        }

        return {
            refreshed: true,
            settled: 'amount_mismatch',
            liveOrder
        };
    }

    const rechargeBreakdown = deriveZpayPointBreakdown(paymentOrder);
    if (!['paid', 'redeemed'].includes(normalizedOrderStatus)) {
        const { error: rechargeError } = await rechargePointsForPayment({
            supabase,
            userId: normalizedUserId,
            paidPoints: rechargeBreakdown.paidPoints,
            bonusPoints: rechargeBreakdown.bonusPoints,
            reason: paymentOrder?.package_id
                ? `易支付充值: ${String(paymentOrder?.package_name || '充值订单').trim() || '充值订单'}`
                : 'custom_recharge',
            referenceId: `zpay_${normalizedOrderNo}`,
            site: paymentOrder?.site || checkoutSession?.site || 'cn'
        });

        if (rechargeError) {
            throw new Error(rechargeError.message || 'Failed to credit ZPAY payment points');
        }
    }

    const orderPatch = {
        status: 'redeemed',
        amount_verified: true,
        paid_amount: livePaidAmount,
        expected_amount: expectedAmount,
        paid_at: paymentOrder?.paid_at || nowIso,
        verified_at: paymentOrder?.verified_at || nowIso,
        claimed_at: paymentOrder?.claimed_at || nowIso,
        last_error: null,
        raw_payload: nextRawPayloadBase,
        provider_metadata: mergeObjects(nextProviderMetadataBase, {
            payment_status: 'paid',
            payment_status_raw: sanitizeText(liveOrder?.statusRaw, '', 80) || 'TRADE_SUCCESS',
            trade_no: sanitizeText(liveOrder?.tradeNo, '', 120) || sanitizeText(providerMetadata.trade_no, '', 120) || null,
            auto_reconciled_by: 'zpay_status_poll',
            auto_reconciled_at: nowIso
        })
    };

    const { error: orderUpdateError } = await supabase
        .from('payment_orders')
        .update(orderPatch)
        .eq('id', normalizedOrderId);

    if (orderUpdateError) {
        throw new Error(orderUpdateError.message || 'Failed to settle ZPAY payment order from status poll');
    }

    try {
        await reconcileCheckoutSessionForPaymentOrder({
            supabase,
            providerKey: 'zpay',
            paymentOrderId: normalizedOrderId,
            providerOrderNo: normalizedOrderNo,
            userId: normalizedUserId,
            site: paymentOrder?.site || checkoutSession?.site || 'cn',
            packageId: paymentOrder?.package_id || checkoutSession?.package_id,
            packageName: paymentOrder?.package_name || checkoutSession?.package_name,
            expectedAmount,
            paidAmount: livePaidAmount,
            pointsAmount: paymentOrder?.points_amount || checkoutSession?.granted_points || 0,
            orderStatus: 'redeemed',
            linkedBy: 'zpay_status_poll',
            allowHeuristic: true,
            lookbackMinutes: 1440
        });
    } catch (linkError) {
        console.warn('[Payments] Failed to link ZPAY checkout session from status poll:', linkError.message);
    }

    await maybeIssueRechargeDiscountAssets({
        supabase,
        userId: normalizedUserId,
        site: paymentOrder?.site || checkoutSession?.site || 'cn',
        paidPoints: rechargeBreakdown?.paidPoints || 0,
        bonusPoints: rechargeBreakdown?.bonusPoints || 0,
        paidAmount: livePaidAmount,
        paymentOrderId: normalizedOrderId,
        paymentProvider: 'zpay',
        paymentOrderNo: normalizedOrderNo
    });
    await maybeIssueAffiliateDiscountAssetsForRecharge({
        supabase,
        site: paymentOrder?.site || checkoutSession?.site || 'cn',
        rechargeReferenceId: `zpay_${normalizedOrderNo}`
    });

    return {
        refreshed: true,
        settled: 'paid',
        liveOrder
    };
}

async function getPaymentRequestStatus({
    supabase,
    user,
    body = {},
    env = process.env
} = {}) {
    const normalizedUserId = String(user?.id || '').trim();
    if (!supabase || !normalizedUserId) {
        const error = new Error('请先登录');
        error.statusCode = 401;
        throw error;
    }

    const checkoutSessionId = String(body.checkout_session_id || '').trim();
    if (!checkoutSessionId) {
        const error = new Error('缺少支付会话');
        error.statusCode = 400;
        throw error;
    }

    const checkoutSession = await loadCheckoutSessionForUser(supabase, normalizedUserId, checkoutSessionId);
    if (!checkoutSession) {
        const error = new Error('未找到对应的支付会话');
        error.statusCode = 404;
        throw error;
    }

    const paymentOrder = await loadPaymentOrderForUserByCheckoutSession(
        supabase,
        normalizedUserId,
        checkoutSession.id,
        checkoutSession.payment_order_id
    );

    let activeCheckoutSession = checkoutSession;
    let activePaymentOrder = paymentOrder;
    let activeProvider = sanitizeText(
        activeCheckoutSession?.provider || activePaymentOrder?.provider,
        '',
        40
    ).toLowerCase();
    const requestedProviderOrderNo = sanitizeText(body.provider_order_no, '', 160);
    const checkoutSessionProviderOrderNo = getCheckoutSessionProviderOrderNo(activeCheckoutSession);
    const recoveryProviderOrderNo = checkoutSessionProviderOrderNo || requestedProviderOrderNo;

    if (!activePaymentOrder?.id && activeProvider === 'zpay') {
        try {
            const recovered = await recoverZpayPaymentOrderForCheckoutSession({
                supabase,
                userId: normalizedUserId,
                checkoutSession: activeCheckoutSession,
                providerOrderNo: recoveryProviderOrderNo
            });

            if (recovered?.checkoutSession) {
                activeCheckoutSession = recovered.checkoutSession;
            }
            if (recovered?.paymentOrder?.id) {
                activePaymentOrder = recovered.paymentOrder;
                activeProvider = sanitizeText(
                    activeCheckoutSession?.provider || activePaymentOrder?.provider,
                    '',
                    40
                ).toLowerCase();
            }
        } catch (recoveryError) {
            console.warn('[Payments] Failed to recover ZPAY payment order from checkout session:', recoveryError.message);
        }
    }

    if (!activePaymentOrder?.id && activeProvider === 'zpay' && recoveryProviderOrderNo) {
        try {
            const directPaymentOrder = await loadPaymentOrderByProviderOrderNo(
                supabase,
                activeProvider,
                recoveryProviderOrderNo
            );

            if (canAccessPaymentOrderFromCheckoutSession({
                paymentOrder: directPaymentOrder,
                checkoutSession: activeCheckoutSession,
                userId: normalizedUserId
            })) {
                try {
                    await reconcileCheckoutSessionForPaymentOrder({
                        supabase,
                        providerKey: activeProvider,
                        paymentOrderId: directPaymentOrder.id,
                        providerOrderNo: recoveryProviderOrderNo,
                        userId: normalizedUserId,
                        site: activeCheckoutSession.site || 'cn',
                        packageId: activeCheckoutSession.package_id,
                        packageName: activeCheckoutSession.package_name,
                        expectedAmount: activeCheckoutSession.expected_amount,
                        paidAmount: directPaymentOrder.paid_amount ?? activeCheckoutSession.expected_amount,
                        pointsAmount: directPaymentOrder.points_amount || activeCheckoutSession.granted_points || activeCheckoutSession.requested_points || 0,
                        linkedBy: 'zpay_status_provider_order_no',
                        allowHeuristic: true,
                        lookbackMinutes: 1440
                    });
                } catch (linkError) {
                    console.warn('[Payments] Failed to reconcile ZPAY order by provider order number:', linkError.message);
                }

                activeCheckoutSession = await loadCheckoutSessionForUser(supabase, normalizedUserId, activeCheckoutSession.id)
                    || activeCheckoutSession;
                activePaymentOrder = await loadPaymentOrderForUserByCheckoutSession(
                    supabase,
                    normalizedUserId,
                    activeCheckoutSession.id,
                    directPaymentOrder.id
                ) || directPaymentOrder;
                activeProvider = sanitizeText(
                    activeCheckoutSession?.provider || activePaymentOrder?.provider,
                    '',
                    40
                ).toLowerCase();
            }
        } catch (directLookupError) {
            console.warn('[Payments] Failed to load ZPAY payment order by provider order number:', directLookupError.message);
        }
    }

    if (
        activeProvider === 'zpay'
        && activePaymentOrder?.id
        && !['paid', 'redeemed', 'pending_review', 'amount_mismatch', 'rejected'].includes(
            sanitizeText(activePaymentOrder.status, '', 40).toLowerCase()
        )
    ) {
        try {
            const refreshResult = await attemptZpayPaymentStatusRefresh({
                supabase,
                checkoutSession: activeCheckoutSession,
                paymentOrder: activePaymentOrder,
                env,
                forceProviderRefresh: body.force_provider_refresh === true
            });

            if (refreshResult?.refreshed) {
                activeCheckoutSession = await loadCheckoutSessionForUser(supabase, normalizedUserId, checkoutSession.id) || activeCheckoutSession;
                activePaymentOrder = await loadPaymentOrderForUserByCheckoutSession(
                    supabase,
                    normalizedUserId,
                    activeCheckoutSession.id,
                    activeCheckoutSession.payment_order_id || activePaymentOrder.id
                ) || activePaymentOrder;
            }
        } catch (statusRefreshError) {
            console.warn('[Payments] Failed to refresh ZPAY payment status actively:', statusRefreshError.message);
        }
    }

    const checkoutStatus = sanitizeText(activeCheckoutSession.status, 'created', 40).toLowerCase() || 'created';
    const paymentOrderStatus = sanitizeText(activePaymentOrder?.status, '', 40).toLowerCase();
    const terminalSuccessStatuses = new Set(['paid', 'redeemed']);
    const reviewStatuses = new Set(['pending_review', 'amount_mismatch']);
    const terminalFailureStatuses = new Set(['failed', 'cancelled', 'expired', 'rejected']);

    let status = 'pending';
    let message = '等待支付完成，系统会自动刷新到账状态。';

    if (checkoutStatus === 'completed' || terminalSuccessStatuses.has(paymentOrderStatus)) {
        status = 'completed';
        message = '支付成功，积分已到账。';
    } else if (reviewStatuses.has(paymentOrderStatus)) {
        status = 'review';
        message = paymentOrderStatus === 'amount_mismatch'
            ? '支付已到账，但金额仍在复核，请稍后查看结果。'
            : '支付已提交，正在等待平台确认，请稍后。';
    } else if (terminalFailureStatuses.has(checkoutStatus) || terminalFailureStatuses.has(paymentOrderStatus)) {
        status = 'failed';
        message = sanitizeText(
            paymentOrder?.last_error || checkoutSession.error_message,
            checkoutStatus === 'expired' ? '支付会话已过期，请重新发起支付。' : '支付未成功，请重新发起。',
            240
        );
    } else if (checkoutStatus === 'failed') {
        status = 'failed';
        message = sanitizeText(checkoutSession.error_message, '支付请求创建失败，请重新发起。', 240);
    } else if (checkoutStatus === 'redirect_ready') {
        message = '付款后这里会自动刷新到账状态。';
    }

    await safeSyncPaymentStatusUserTags(supabase, {
        userId: normalizedUserId,
        status,
        site: activeCheckoutSession.site || activePaymentOrder?.site || body.site || 'cn',
        sourceEventId: activePaymentOrder?.id || activeCheckoutSession.id || '',
        sourceModule: 'payments'
    });

    return {
        success: true,
        status,
        checkout_session_id: activeCheckoutSession.id,
        checkout_session_status: checkoutStatus,
        payment_order_id: activePaymentOrder?.id || activeCheckoutSession.payment_order_id || null,
        payment_order_status: paymentOrderStatus || null,
        provider: sanitizeText(activeCheckoutSession.provider, activePaymentOrder?.provider || 'unknown', 40).toLowerCase(),
        provider_order_no: sanitizeText(activePaymentOrder?.provider_order_no, '', 160) || null,
        site: requireSupportedSite(activeCheckoutSession.site || activePaymentOrder?.site || body.site || 'cn'),
        package_name: sanitizeText(activeCheckoutSession.package_name, activePaymentOrder?.package_name || '', 120) || null,
        points_amount: normalizePointAmount(
            activePaymentOrder?.points_amount ?? activeCheckoutSession.granted_points ?? activeCheckoutSession.requested_points,
            0
        ),
        paid_amount: normalizeCurrency(
            activePaymentOrder?.paid_amount ?? activeCheckoutSession.expected_amount,
            0
        ),
        expected_amount: normalizeCurrency(
            activePaymentOrder?.expected_amount ?? activeCheckoutSession.expected_amount,
            0
        ),
        message,
        error_message: sanitizeText(activePaymentOrder?.last_error || activeCheckoutSession.error_message, '', 240) || null,
        completed_at: activeCheckoutSession.completed_at || activePaymentOrder?.paid_at || activePaymentOrder?.verified_at || null,
        updated_at: activeCheckoutSession.updated_at || activePaymentOrder?.updated_at || activeCheckoutSession.created_at || null,
        refresh_wallet: status === 'completed',
        should_stop_polling: status === 'completed' || status === 'failed'
    };
}

async function createCheckoutSession({
    supabase,
    user,
    providerKey,
    site,
    packageId = '',
    packageName = '',
    paidPoints = 0,
    bonusPoints = 0,
    grantedPoints = 0,
    paidAmount = null,
    body = {},
    isCustomRecharge = false,
    customQuote = null,
    paymentPricing = null
}) {
    const normalizedSite = requireSupportedSite(site);
    const clientPaymentRequestId = normalizeClientPaymentRequestId(body.client_payment_request_id || body.clientPaymentRequestId);
    const customQuotePayload = customQuote
        ? {
            quote_id: customQuote.quoteId,
            token_hash: customQuote.tokenHash,
            issued_at: customQuote.issuedAt,
            expires_at: customQuote.expiresAt,
            points_amount: normalizePointAmount(customQuote.pointsAmount, 0),
            paid_amount: normalizeCurrency(customQuote.paidAmount, null),
            pricing_mode: customQuote.pricingMode || 'fixed_rate',
            points_per_cny: Number(customQuote.pointsPerCny) || null
        }
        : null;
    const pricingPayload = paymentPricing && typeof paymentPricing === 'object'
        ? buildPaymentPricingPayload(paymentPricing)
        : null;
    const payload = {
        session_key: buildCheckoutSessionKey(providerKey),
        provider: String(providerKey || 'unknown').trim().toLowerCase() || 'unknown',
        user_id: user.id,
        site: normalizedSite,
        package_id: packageId || null,
        package_name: packageName || null,
        requested_points: normalizePointValue(paidPoints, 0),
        bonus_points: normalizePointValue(bonusPoints, 0),
        granted_points: normalizePointValue(grantedPoints, 0),
        expected_amount: paidAmount,
        status: 'created',
        request_payload: {
            source: 'payment_create_api',
            request: {
                provider_key: String(body.provider_key || providerKey || '').trim().toLowerCase() || null,
                package_id: packageId || null,
                points_amount: normalizePointValue(paidPoints, 0),
                bonus_points: normalizePointValue(bonusPoints, 0),
                granted_points: normalizePointValue(grantedPoints, 0),
                base_amount: pricingPayload?.base_amount ?? paidAmount,
                payment_fee_amount: pricingPayload?.payment_fee_amount ?? 0,
                payment_fee_rate: pricingPayload?.payment_fee_rate ?? 0,
                payment_fee_label: pricingPayload?.payment_fee_label || '通道手续费',
                paid_amount: paidAmount,
                site: normalizedSite,
                is_custom_recharge: isCustomRecharge,
                client_payment_request_id: clientPaymentRequestId || null,
                custom_quote: customQuotePayload,
                payment_pricing: pricingPayload
            }
        },
        provider_metadata: {
            client_payment_request_id: clientPaymentRequestId || null,
            charge_type: isCustomRecharge ? 'custom' : 'package',
            custom_quote_id: customQuotePayload?.quote_id || null,
            custom_quote_expires_at: customQuotePayload?.expires_at || null,
            custom_quote: customQuotePayload,
            payment_pricing: pricingPayload
        },
        expires_at: getCheckoutSessionExpiryIso()
    };

    if (typeof supabase?.rpc === 'function') {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
            'fn_create_payment_checkout_session',
            {
                p_payload: payload,
                p_user_id: user?.id || null
            }
        );

        if (!rpcError) {
            return getRpcSingleRow(rpcData);
        }

        if (!isMissingDatabaseCapabilityError(rpcError)) {
            throw new Error(rpcError.message || 'Failed to create payment checkout session');
        }
    }

    const { data, error } = await supabase
        .from('payment_checkout_sessions')
        .insert(payload)
        .select('*')
        .single();

    if (error) {
        throw new Error(error.message || 'Failed to create payment checkout session');
    }

    return data;
}

async function updateCheckoutSession(supabase, sessionId, patch = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;

    if (typeof supabase?.rpc === 'function') {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
            'fn_update_payment_checkout_session',
            {
                p_session_id: normalizedSessionId,
                p_patch: patch
            }
        );

        if (!rpcError) {
            return getRpcSingleRow(rpcData);
        }

        if (!isMissingDatabaseCapabilityError(rpcError)) {
            throw new Error(rpcError.message || 'Failed to update payment checkout session');
        }
    }

    const { data, error } = await supabase
        .from('payment_checkout_sessions')
        .update(patch)
        .eq('id', normalizedSessionId)
        .select('*')
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to update payment checkout session');
    }

    return data || null;
}

async function loadPointsPackage(supabase, packageId) {
    const normalizedPackageId = String(packageId || '').trim();
    if (!normalizedPackageId) {
        return null;
    }

    const { data: pkg, error } = await supabase
        .from('points_packages')
        .select('id, name, points_amount, bonus_points, price_cny, is_active')
        .eq('id', normalizedPackageId)
        .eq('is_active', true)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to load package');
    }

    if (!pkg) {
        throw new Error('套餐不存在或已下架');
    }

    return {
        id: pkg.id,
        name: sanitizeText(pkg.name, '充值套餐', 120),
        paidPoints: normalizePointValue(pkg.points_amount, 0),
        bonusPoints: normalizePointValue(pkg.bonus_points, 0),
        grantedPoints: normalizePointValue((pkg.points_amount || 0) + (pkg.bonus_points || 0), 0),
        paidAmount: normalizeCurrency(pkg.price_cny, null)
    };
}

function resolveRequestedProviderKey({
    requestedProviderKey,
    paymentChannels,
    rechargeOptions,
    requestHost = '',
    env = process.env
}) {
    const normalizedRequested = String(requestedProviderKey || '').trim().toLowerCase();
    const activeProviderKey = String(paymentChannels?.active_provider || 'afdian').trim().toLowerCase() || 'afdian';
    const providers = paymentChannels?.providers || {};
    const mockConfigured = paymentChannels?.providers?.mock?.enabled !== false
        && (
            rechargeOptions?.mock_payment_enabled === true
            || paymentChannels?.active_provider === 'mock'
        );
    const mockRuntime = getMockPaymentRuntimeState({
        requestHost,
        env
    });

    const resolveMockProvider = () => {
        if (!mockConfigured) {
            throw new Error('当前未开启模拟支付，请使用真实支付流程');
        }
        if (!mockRuntime.allowed) {
            throw new Error(mockRuntime.message || '当前环境已禁用模拟支付，请切换到真实支付通道');
        }
        return 'mock';
    };

    if (!normalizedRequested || normalizedRequested === activeProviderKey) {
        if (activeProviderKey === 'mock') {
            return resolveMockProvider();
        }
        return activeProviderKey;
    }

    if (normalizedRequested === 'mock') {
        return resolveMockProvider();
    }

    if (['afdian', 'hupijiao', 'zpay', 'nowpayments'].includes(normalizedRequested)) {
        if (providers?.[normalizedRequested]?.enabled !== true) {
            throw new Error(`${getPaymentProviderAdapter(normalizedRequested)?.label || '当前支付通道'}未启用`);
        }
        return normalizedRequested;
    }

    throw new Error('当前支付通道与前端请求不一致，请刷新页面后重试');
}

async function ensureMockPaymentAvailable({
    supabase,
    paymentChannels = null,
    rechargeOptions = null,
    site = 'cn',
    env = process.env,
    requestHost = ''
}) {
    let effectivePaymentChannels = paymentChannels;
    let effectiveRechargeOptions = rechargeOptions;

    if (!effectivePaymentChannels || !effectiveRechargeOptions) {
        const loadedConfigs = await loadStoredPaymentConfigs(supabase, {
            site,
            origin: env?.APP_BASE_URL,
            afdianCheckoutUrl: env?.PAYMENT_AFDIAN_URL
        });
        effectivePaymentChannels = loadedConfigs.paymentChannels;
        effectiveRechargeOptions = loadedConfigs.rechargeOptions;
    }

    resolveRequestedProviderKey({
        requestedProviderKey: 'mock',
        paymentChannels: effectivePaymentChannels,
        rechargeOptions: effectiveRechargeOptions,
        requestHost,
        env
    });

    return {
        paymentChannels: effectivePaymentChannels,
        rechargeOptions: effectiveRechargeOptions
    };
}

async function completeMockPayment({
    supabase,
    user,
    body = {},
    checkoutSession = null,
    paymentChannels = null,
    rechargeOptions = null,
    env = process.env,
    requestHost = ''
}) {
    if (isProductionLikeRuntime(env)) {
        const error = new Error('mock_payments_disabled_in_production');
        error.statusCode = 410;
        error.code = 'mock_payments_disabled_in_production';
        throw error;
    }

    const site = requireSupportedSite(body.site);

    await ensureMockPaymentAvailable({
        supabase,
        paymentChannels,
        rechargeOptions,
        site,
        env,
        requestHost
    });
    const packageId = body.package_id ? String(body.package_id).trim() : '';
    const orderNo = buildMockOrderNo(body.order_no);
    const isCustomRecharge = !packageId;

    let packageName = '自定义充值';
    let paidPoints = normalizePointValue(body.points_amount, 0);
    let bonusPoints = 0;
    let paidAmount = normalizeCurrency(body.paid_amount, null);

    if (packageId) {
        const pkg = await loadPointsPackage(supabase, packageId);
        packageName = pkg.name;
        paidPoints = pkg.paidPoints;
        bonusPoints = pkg.bonusPoints;
        paidAmount = pkg.paidAmount;
    }

    if (!Number.isFinite(paidPoints) || paidPoints <= 0) {
        throw new Error('充值积分必须大于 0');
    }

    const grantedPoints = normalizePointValue(paidPoints + bonusPoints, 0);
    const reason = isCustomRecharge ? 'custom_recharge' : `模拟充值: ${packageName}`;
    const referenceId = `mock_${orderNo}`;
    const eventKey = mockProvider.buildEventKey({ orderNo, stage: 'completed' });
    const nowIso = new Date().toISOString();
    const providerMetadata = {
        ...mockProvider.buildProviderMetadata({
            site,
            isCustomRecharge,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount
        })
    };

    let activeCheckoutSession = checkoutSession;

    if (!activeCheckoutSession && body.checkout_session_id) {
        activeCheckoutSession = await loadCheckoutSessionForUser(supabase, user.id, body.checkout_session_id);
    }

    if (!activeCheckoutSession) {
        activeCheckoutSession = await createCheckoutSession({
            supabase,
            user,
            providerKey: 'mock',
            site,
            packageId,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount,
            body,
            isCustomRecharge
        });
    }

    providerMetadata.checkout_session_id = activeCheckoutSession.id;
    providerMetadata.checkout_session_key = activeCheckoutSession.session_key;

    const { data: existingOrder, error: existingOrderError } = await supabase
        .from('payment_orders')
        .select('id, user_id, status, provider_order_no, points_amount, paid_amount')
        .eq('provider', 'mock')
        .eq('provider_order_no', orderNo)
        .maybeSingle();

    if (existingOrderError) {
        throw new Error(existingOrderError.message || 'Failed to inspect mock payment order');
    }

    if (existingOrder?.user_id && existingOrder.user_id !== user.id) {
        const forbiddenError = new Error('该模拟订单已归属于其他账号');
        forbiddenError.statusCode = 403;
        throw forbiddenError;
    }

    if (existingOrder && ['paid', 'redeemed'].includes(String(existingOrder.status || '').trim())) {
        await updateCheckoutSession(supabase, activeCheckoutSession.id, {
            status: 'completed',
            payment_order_id: existingOrder.id,
            completed_at: nowIso,
            error_message: null,
            provider_metadata: {
                ...activeCheckoutSession.provider_metadata,
                ...providerMetadata,
                order_no: orderNo,
                completed_at: nowIso
            }
        });

        return {
            success: true,
            provider: 'mock',
            mode: 'completed',
            order_no: orderNo,
            status: existingOrder.status,
            points_amount: normalizePointValue(existingOrder.points_amount, grantedPoints),
            paid_amount: normalizeCurrency(existingOrder.paid_amount, paidAmount),
            checkout_session_id: activeCheckoutSession.id,
            checkout_session_key: activeCheckoutSession.session_key,
            checkout_session_status: 'completed',
            linked_discount_summary: null,
            message: `已使用模拟支付完成「${packageName}」`
        };
    }

    const baseOrderPayload = {
        provider: 'mock',
        provider_order_no: orderNo,
        provider_user_id: user.id,
        user_id: user.id,
        site,
        package_id: packageId || null,
        package_name: packageName,
        expected_amount: paidAmount,
        paid_amount: paidAmount,
        points_amount: grantedPoints,
        status: 'pending',
        sign_verified: true,
        amount_verified: true,
        raw_payload: {
            source: 'payment_create_api',
            request: {
                package_id: packageId || null,
                points_amount: paidPoints,
                bonus_points: bonusPoints,
                site,
                checkout_session_id: activeCheckoutSession.id,
                checkout_session_key: activeCheckoutSession.session_key
            }
        },
        provider_metadata: providerMetadata,
        claimed_at: nowIso
    };

    const { data: pendingOrder, error: pendingOrderError } = await supabase
        .from('payment_orders')
        .upsert(baseOrderPayload, { onConflict: 'provider,provider_order_no' })
        .select('id, provider_order_no')
        .single();

    if (pendingOrderError) {
        throw new Error(pendingOrderError.message || 'Failed to create mock payment order');
    }

    try {
        const { error: rechargeError } = await rechargePointsForPayment({
            supabase,
            userId: user.id,
            paidPoints,
            bonusPoints,
            reason,
            referenceId,
            site
        });

        if (rechargeError) {
            throw new Error(rechargeError.message || 'Failed to credit mock payment points');
        }

        const { error: orderUpdateError } = await supabase
            .from('payment_orders')
            .update({
                status: 'redeemed',
                paid_at: nowIso,
                verified_at: nowIso,
                claimed_at: nowIso,
                last_error: null,
                provider_metadata: {
                    ...providerMetadata,
                    completed_at: nowIso
                }
            })
            .eq('id', pendingOrder.id);

        if (orderUpdateError) {
            throw new Error(orderUpdateError.message || 'Failed to finalize mock payment order');
        }

        const { error: eventError } = await supabase
            .from('payment_events')
            .upsert({
                payment_order_id: pendingOrder.id,
                provider: 'mock',
                provider_order_no: orderNo,
                event_key: eventKey,
                event_type: 'mock_payment',
                signature_valid: true,
                amount_valid: true,
                processing_result: 'processed_paid',
                payload: {
                    mode: 'mock',
                    order_no: orderNo,
                    user_id: user.id,
                    site,
                    points_amount: grantedPoints,
                    paid_amount: paidAmount,
                    checkout_session_id: activeCheckoutSession.id
                },
                error_message: null,
                processed_at: nowIso
            }, { onConflict: 'event_key' });

        if (eventError) {
            throw new Error(eventError.message || 'Failed to record mock payment event');
        }

        await updateCheckoutSession(supabase, activeCheckoutSession.id, {
            status: 'completed',
            payment_order_id: pendingOrder.id,
            completed_at: nowIso,
            error_message: null,
            provider_metadata: {
                ...activeCheckoutSession.provider_metadata,
                ...providerMetadata,
                order_no: orderNo,
                completed_at: nowIso
            }
        });

        await safeSyncPaymentStatusUserTags(supabase, {
            userId: user.id,
            status: 'completed',
            site: activeCheckoutSession.site || pendingOrder.site || 'cn',
            sourceEventId: pendingOrder.id,
            sourceModule: 'payments.mock'
        });
    } catch (runtimeError) {
        await supabase
            .from('payment_orders')
            .update({
                status: 'rejected',
                last_error: runtimeError.message || 'mock payment failed',
                verified_at: nowIso,
                provider_metadata: {
                    ...providerMetadata,
                    failed_at: nowIso
                }
            })
            .eq('id', pendingOrder.id);

        await supabase
            .from('payment_events')
            .upsert({
                payment_order_id: pendingOrder.id,
                provider: 'mock',
                provider_order_no: orderNo,
                event_key,
                event_type: 'mock_payment',
                signature_valid: true,
                amount_valid: false,
                processing_result: 'mock_failed',
                payload: {
                    mode: 'mock',
                    order_no: orderNo,
                    user_id: user.id,
                    site,
                    points_amount: grantedPoints,
                    paid_amount: paidAmount,
                    checkout_session_id: activeCheckoutSession.id
                },
                error_message: runtimeError.message || 'mock payment failed',
                processed_at: nowIso
            }, { onConflict: 'event_key' });

        await updateCheckoutSession(supabase, activeCheckoutSession.id, {
            status: 'failed',
            error_message: runtimeError.message || 'mock payment failed',
            provider_metadata: {
                ...activeCheckoutSession.provider_metadata,
                ...providerMetadata,
                order_no: orderNo,
                failed_at: nowIso
            }
        });

        await safeSyncPaymentStatusUserTags(supabase, {
            userId: user.id,
            status: 'failed',
            site: activeCheckoutSession.site || pendingOrder.site || 'cn',
            sourceEventId: pendingOrder.id,
            sourceModule: 'payments.mock'
        });

        throw runtimeError;
    }

    const linkedDiscountSummary = await maybeIssueRechargeDiscountAssets({
        supabase,
        userId: user.id,
        site,
        paidPoints,
        bonusPoints,
        paidAmount,
        paymentOrderId: pendingOrder.id,
        paymentProvider: 'mock',
        paymentOrderNo: orderNo
    });
    const linkedAffiliateDiscountSummary = await maybeIssueAffiliateDiscountAssetsForRecharge({
        supabase,
        site,
        rechargeReferenceId: referenceId
    });

    return {
        success: true,
        provider: 'mock',
        mode: 'completed',
        order_no: orderNo,
        status: 'redeemed',
        points_amount: grantedPoints,
        paid_amount: paidAmount,
        package_name: packageName,
        checkout_session_id: activeCheckoutSession.id,
        checkout_session_key: activeCheckoutSession.session_key,
        checkout_session_status: 'completed',
        linked_discount_summary: linkedDiscountSummary,
        linked_affiliate_discount_summary: linkedAffiliateDiscountSummary,
        message: `已使用模拟支付完成「${packageName}」`
    };
}

async function createPaymentRequest({
    supabase,
    adminSupabase = null,
    user,
    body = {},
    env = process.env,
    requestHost = '',
    clientIp = '',
    userAgent = ''
}) {
    let paymentWriteSupabase = supabase;
    const paymentRuntimeSupabase = adminSupabase || supabase;
    const paymentWriteAdminFallback = adminSupabase && adminSupabase !== supabase
        ? adminSupabase
        : null;
    const site = requireSupportedSite(body.site);
    const requestedProviderKey = String(body.provider_key || '').trim().toLowerCase();
    const packageId = body.package_id ? String(body.package_id).trim() : '';
    const isCustomRecharge = !packageId;
    const clientPaymentRequestId = normalizeClientPaymentRequestId(body.client_payment_request_id || body.clientPaymentRequestId);
    const requestOrigin = resolveSiteRequestOrigin({
        site,
        requestHost,
        appBaseUrl: env.APP_BASE_URL
    });

    const runPaymentWriteOperation = async (operationLabel, operation) => {
        const { client, result } = await runPaymentOperationWithAdminFallback({
            operationLabel,
            primaryClient: paymentWriteSupabase,
            adminClient: paymentWriteAdminFallback,
            operation
        });

        if (client) {
            paymentWriteSupabase = client;
        }

        return result;
    };

    const { paymentChannels, rechargeOptions } = await loadStoredPaymentConfigs(paymentRuntimeSupabase, {
        origin: requestOrigin || env.APP_BASE_URL,
        afdianCheckoutUrl: env.PAYMENT_AFDIAN_URL
    });

    const providerKey = resolveRequestedProviderKey({
        requestedProviderKey,
        paymentChannels,
        rechargeOptions,
        requestHost,
        env
    });

    const adapter = getPaymentProviderAdapter(providerKey);
    if (!adapter) {
        throw new Error('当前支付通道不可用');
    }

    let packageName = '自定义充值';
    let paidPoints = normalizePointValue(body.points_amount, 0);
    let bonusPoints = 0;
    let grantedPoints = paidPoints;
    let paidAmount = normalizeCurrency(body.paid_amount, null);
    let customQuote = null;

    if (packageId) {
        const pkg = await runPaymentWriteOperation(
            'load payment package',
            (client) => loadPointsPackage(client, packageId)
        );
        packageName = pkg.name;
        paidPoints = pkg.paidPoints;
        bonusPoints = pkg.bonusPoints;
        grantedPoints = pkg.grantedPoints;
        paidAmount = pkg.paidAmount;
    } else if (providerKey !== 'mock') {
        if (rechargeOptions?.custom_amount_enabled !== true) {
            throw new Error('当前未开启自定义充值入口');
        }

        customQuote = issueCustomRechargeQuote({
            userId: user.id,
            site,
            providerKey,
            pointsAmount: body.points_amount,
            rechargeOptions,
            env
        });
        paidPoints = customQuote.pointsAmount;
        grantedPoints = customQuote.pointsAmount;
        paidAmount = customQuote.paidAmount;
    }

    if (!Number.isFinite(grantedPoints) || grantedPoints <= 0) {
        throw new Error('充值积分必须大于 0');
    }

    const basePaidAmount = paidAmount;
    const paymentPricing = buildPaymentPricing({
        providerConfig: paymentChannels?.providers?.[providerKey] || {},
        baseAmount: basePaidAmount
    });
    paidAmount = paymentPricing.payableAmount;

    if (providerKey === 'zpay') {
        const reusableCheckoutSession = await runPaymentWriteOperation(
            'find reusable payment checkout session',
            (client) => findReusableCheckoutSessionForPaymentRequest(client, {
                providerKey,
                userId: user.id,
                site,
                packageId,
                packageName,
                grantedPoints,
                paidAmount,
                clientPaymentRequestId
            })
        );

        if (reusableCheckoutSession) {
            return buildReusablePaymentRequestResponse({
                checkoutSession: reusableCheckoutSession,
                providerKey,
                adapter,
                packageName,
                grantedPoints,
                paidAmount,
                paymentPricing,
                customQuote: null
            });
        }
    }

    const checkoutSession = await runPaymentWriteOperation(
        'create payment checkout session',
        (client) => createCheckoutSession({
            supabase: client,
            user,
            providerKey,
            site,
            packageId,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount,
            body,
            isCustomRecharge,
            customQuote,
            paymentPricing
        })
    );

    if (providerKey === 'mock') {
        return completeMockPayment({
            supabase: adminSupabase || paymentWriteSupabase,
            user,
            checkoutSession,
            paymentChannels,
            rechargeOptions,
            env,
            requestHost,
            body: {
                ...body,
                site,
                package_id: packageId || null,
                points_amount: paidPoints,
                paid_amount: paidAmount,
                package_name: packageName,
                checkout_session_id: checkoutSession.id
            }
        });
    }

    try {
        const runtimeContext = await adapter.resolveRuntimeContext({
            supabase: paymentRuntimeSupabase,
            env,
            config: paymentChannels,
            requestOrigin,
            site
        });

        const checkoutContext = await adapter.createCheckoutContext({
            runtimeContext,
            checkoutSession,
            paymentChannels,
            site,
            isCustomRecharge,
            packageId,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount,
            paymentPricing,
            customQuote,
            clientIp,
            userAgent
        });

        if (!checkoutContext?.supported) {
            await runPaymentWriteOperation(
                'mark unsupported payment checkout session failed',
                (client) => updateCheckoutSession(client, checkoutSession.id, {
                    status: 'failed',
                    error_message: checkoutContext?.message || `${adapter.label || '当前支付通道'}暂未完成接入`,
                    provider_metadata: {
                        ...checkoutSession.provider_metadata,
                        adapter_supported: false
                    }
                })
            );
            throw new Error(checkoutContext?.message || `${adapter.label || '当前支付通道'}暂未完成接入`);
        }

        const pricingPayload = buildPaymentPricingPayload(paymentPricing);
        const checkoutSummary = {
            ...(checkoutContext.summary || {}),
            ...pricingPayload
        };
        const checkoutProviderMetadata = {
            ...(checkoutContext.providerMetadata && typeof checkoutContext.providerMetadata === 'object'
                ? checkoutContext.providerMetadata
                : {}),
            ...pricingPayload,
            payment_pricing: pricingPayload
        };

        const updatedSession = await runPaymentWriteOperation(
            'update payment checkout session',
            (client) => updateCheckoutSession(client, checkoutSession.id, {
                status: 'redirect_ready',
                checkout_url: checkoutContext.checkoutUrl || null,
                query_mode: checkoutContext.queryMode || null,
                provider_metadata: {
                    ...checkoutSession.provider_metadata,
                    display_name: checkoutContext.displayName || adapter.label || '当前支付通道',
                    action: checkoutContext.action || 'redirect',
                    provider_order_no: checkoutContext.providerOrderNo || null,
                    summary: checkoutSummary,
                    ...checkoutProviderMetadata
                },
                error_message: null
            })
        );
        let pendingPaymentOrder = null;

        if (providerKey !== 'mock') {
            try {
                pendingPaymentOrder = await runPaymentWriteOperation(
                    'create pending payment order',
                    (client) => createPendingPaymentOrderForCheckoutSession({
                        supabase: client,
                        checkoutSession: updatedSession || checkoutSession,
                        user,
                        providerKey,
                        providerOrderNo: checkoutContext.providerOrderNo || '',
                        site,
                        packageId,
                        packageName,
                        paidAmount,
                        grantedPoints
                    })
                );
            } catch (pendingOrderError) {
                console.warn('[Payments] Failed to precreate payment order from checkout session:', pendingOrderError.message);
            }
        }

        let paymentClaim = null;
        if (providerKey === 'afdian') {
            try {
                paymentClaim = issuePaymentIntentClaimToken({
                    userId: user.id,
                    site,
                    providerKey,
                    checkoutSessionId: updatedSession?.id || checkoutSession.id,
                    packageId: packageId || null,
                    packageName,
                    expectedAmount: paidAmount,
                    pointsAmount: grantedPoints,
                    chargeType: isCustomRecharge ? 'custom' : 'package',
                    expiresAt: updatedSession?.expires_at || checkoutSession.expires_at,
                    env
                });
            } catch (claimError) {
                console.warn('[Payments] Failed to issue payment intent claim token:', claimError.message);
            }
        }

        return {
            success: true,
            provider: providerKey,
            mode: checkoutContext.action || 'redirect',
            display_name: checkoutContext.displayName || adapter.label || '当前支付通道',
            checkout_url: checkoutContext.checkoutUrl || '',
            package_name: packageName,
            points_amount: grantedPoints,
            paid_amount: paidAmount,
            base_amount: pricingPayload.base_amount,
            payment_fee_amount: pricingPayload.payment_fee_amount,
            payment_fee_rate: pricingPayload.payment_fee_rate,
            payment_fee_label: pricingPayload.payment_fee_label,
            query_mode: checkoutContext.queryMode || '',
            provider_order_no: checkoutContext.providerOrderNo
                || pendingPaymentOrder?.provider_order_no
                || null,
            checkout_session_id: updatedSession?.id || checkoutSession.id,
            checkout_session_key: updatedSession?.session_key || checkoutSession.session_key,
            checkout_session_status: updatedSession?.status || 'redirect_ready',
            message: checkoutContext.message || `${checkoutContext.displayName || adapter.label || '当前支付通道'}已准备就绪。`,
            provider_summary: checkoutSummary,
            custom_quote: customQuote
                ? {
                    quote_id: customQuote.quoteId,
                    token: customQuote.token,
                    issued_at: customQuote.issuedAt,
                    expires_at: customQuote.expiresAt,
                    points_amount: customQuote.pointsAmount,
                    paid_amount: paidAmount,
                    base_amount: pricingPayload.base_amount,
                    payment_fee_amount: pricingPayload.payment_fee_amount,
                    payment_fee_rate: pricingPayload.payment_fee_rate,
                    pricing_mode: customQuote.pricingMode,
                    points_per_cny: customQuote.pointsPerCny
                }
                : null,
            payment_claim: paymentClaim
                ? {
                    intent_id: paymentClaim.intentId,
                    token: paymentClaim.token,
                    provider: paymentClaim.provider,
                    site: paymentClaim.site,
                    checkout_session_id: paymentClaim.checkoutSessionId,
                    package_id: paymentClaim.packageId,
                    package_name: paymentClaim.packageName,
                    expected_amount: paymentClaim.expectedAmount,
                    points_amount: paymentClaim.pointsAmount,
                    charge_type: paymentClaim.chargeType,
                    issued_at: paymentClaim.issuedAt,
                    expires_at: paymentClaim.expiresAt
                }
                : null
        };
    } catch (error) {
        try {
            await runPaymentWriteOperation(
                'mark payment checkout session failed',
                (client) => updateCheckoutSession(client, checkoutSession.id, {
                    status: 'failed',
                    error_message: error.message || 'Failed to create checkout session',
                    provider_metadata: {
                        ...checkoutSession.provider_metadata,
                        failed_at: new Date().toISOString()
                    }
                })
            );
        } catch (checkoutSessionUpdateError) {
            console.warn(
                '[Payments] Failed to mark payment checkout session as failed:',
                checkoutSessionUpdateError.message
            );
        }

        await safeSyncPaymentStatusUserTags(paymentRuntimeSupabase || paymentWriteSupabase, {
            userId: user.id,
            status: 'failed',
            site: checkoutSession.site || 'cn',
            sourceEventId: checkoutSession.id,
            sourceModule: 'payments.create'
        });

        throw error;
    }
}

module.exports = {
    __testUtils: {
        buildPaymentIntentClaimId,
        buildPaymentPricing,
        buildPaymentPricingPayload,
        createPendingPaymentOrderForCheckoutSession,
        getMockPaymentRuntimeState,
        getCustomRechargeQuoteSecret,
        getPaymentIntentClaimSecret,
        isSupportedSite,
        getRemoteMockPaymentExpiryOverride,
        ensureMockPaymentAvailable,
        isMockPaymentRuntimeAllowed,
        resolveRequestedProviderKey
    },
    completeMockPayment,
    createCheckoutSession,
    createPaymentRequest,
    findCheckoutSessionCandidates,
    getPaymentRequestStatus,
    getMockPaymentRuntimeState,
    issueCustomRechargeQuote,
    issuePaymentIntentClaimToken,
    loadCheckoutSessionForUser,
    loadPointsPackage,
    resolvePendingPaymentOrderFromCheckoutContext,
    reconcileCheckoutSessionForPaymentOrder,
    sanitizeSite,
    updateCheckoutSession,
    verifyCustomRechargeQuoteToken,
    verifyPaymentIntentClaimToken
};
