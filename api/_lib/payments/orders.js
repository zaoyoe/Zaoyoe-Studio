const crypto = require('crypto');
const {
    getPaymentProviderAdapter,
    normalizePointValue
} = require('./provider-adapters');
const {
    loadStoredPaymentConfigs
} = require('./providers');
const {
    rechargePointsForPayment
} = require('./rpc');

const mockProvider = getPaymentProviderAdapter('mock');
const CHECKOUT_SESSION_EXPIRY_HOURS = 24;
const ACTIVE_CHECKOUT_SESSION_STATUSES = ['created', 'redirect_ready', 'failed'];
const TERMINAL_CHECKOUT_SESSION_STATUSES = ['completed', 'cancelled', 'expired'];
const PENDING_PROVIDER_ORDER_PREFIX = 'PENDING';
const CUSTOM_RECHARGE_QUOTE_PREFIX = 'crq';
const DEFAULT_CUSTOM_RECHARGE_MIN_POINTS = 1;
const DEFAULT_CUSTOM_RECHARGE_MAX_POINTS = 50000;
const DEFAULT_CUSTOM_RECHARGE_STEP = 1;
const DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY = 50;
const DEFAULT_CUSTOM_RECHARGE_QUOTE_TTL_SECONDS = 1800;
const REMOTE_MOCK_PAYMENT_UNTIL_ENV_NAMES = Object.freeze([
    'ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL',
    'PAYMENT_ALLOW_REMOTE_MOCK_UNTIL',
    'PAYMENT_MOCK_ALLOW_REMOTE_UNTIL'
]);

function sanitizeSite(value) {
    const site = String(value || '').trim().toLowerCase();
    return site || 'cn';
}

function sanitizeText(value, fallback = '', maxLength = 240) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
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

function roundUpCurrency(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.ceil(parsed * 100) / 100;
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
    const minPoints = Math.max(
        1,
        normalizeInteger(rechargeOptions?.custom_amount_min_points, DEFAULT_CUSTOM_RECHARGE_MIN_POINTS)
    );
    const maxPoints = Math.max(
        minPoints,
        normalizeInteger(rechargeOptions?.custom_amount_max_points, DEFAULT_CUSTOM_RECHARGE_MAX_POINTS)
    );
    const step = Math.max(
        1,
        normalizeInteger(rechargeOptions?.custom_amount_step, DEFAULT_CUSTOM_RECHARGE_STEP)
    );
    const pointsPerCny = Number(rechargeOptions?.custom_amount_points_per_cny);
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
        pointsPerCny: Number.isFinite(pointsPerCny) && pointsPerCny > 0
            ? pointsPerCny
            : DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY,
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
    const rules = getNormalizedCustomRechargeRules(rechargeOptions);
    const normalizedPoints = normalizeInteger(pointsAmount, 0);

    if (!Number.isFinite(normalizedPoints) || normalizedPoints <= 0) {
        throw new Error('请输入大于 0 的整数积分');
    }
    if (normalizedPoints < rules.minPoints) {
        throw new Error(`单次自定义充值最少为 ${rules.minPoints} 积分`);
    }
    if (normalizedPoints > rules.maxPoints) {
        throw new Error(`单次自定义充值最多为 ${rules.maxPoints} 积分`);
    }
    if (normalizedPoints % rules.step !== 0) {
        throw new Error(`自定义充值需按 ${rules.step} 积分整数档位提交`);
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
        site: sanitizeSite(site),
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

    const normalizedSite = sanitizeSite(site);
    if (normalizedSite && sanitizeSite(payload.site) !== normalizedSite) {
        return null;
    }

    const normalizedProvider = String(providerKey || '').trim().toLowerCase();
    if (normalizedProvider && String(payload.provider || '').trim().toLowerCase() !== normalizedProvider) {
        return null;
    }

    const pointsAmount = normalizeInteger(payload.points_amount, 0);
    const paidAmount = normalizeCurrency(payload.paid_amount, null);
    if (pointsAmount <= 0 || paidAmount === null || paidAmount <= 0) {
        return null;
    }

    return {
        quoteId: String(payload.quote_id || '').trim(),
        token: normalizedToken,
        tokenHash: hashCustomRechargeQuoteToken(normalizedToken),
        userId: String(payload.user_id || '').trim(),
        site: sanitizeSite(payload.site),
        provider: String(payload.provider || '').trim().toLowerCase() || 'afdian',
        pointsAmount,
        paidAmount,
        pricingMode: String(payload.pricing_mode || 'fixed_rate').trim().toLowerCase() || 'fixed_rate',
        pointsPerCny: Number(payload.points_per_cny) || DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY,
        issuedAt: String(payload.issued_at || '').trim() || null,
        expiresAt: String(payload.expires_at || '').trim() || null
    };
}

function isTruthyFlag(value) {
    if (value === true) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function extractHostname(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    try {
        const candidate = normalized.includes('://')
            ? normalized
            : `http://${normalized.replace(/^\/*/, '')}`;
        return String(new URL(candidate).hostname || '').trim().toLowerCase();
    } catch (_) {
        return normalized
            .replace(/^[a-z]+:\/\//i, '')
            .replace(/^\/+/, '')
            .split('/')[0]
            .split(':')[0]
            .trim()
            .toLowerCase();
    }
}

function isLocalHostname(value) {
    const hostname = extractHostname(value);
    return hostname === 'localhost' || hostname === '127.0.0.1';
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

function getMockPaymentRuntimeState({ requestHost = '', env = process.env } = {}) {
    if (isLocalHostname(requestHost)) {
        return {
            allowed: true,
            reason: 'local_request_host',
            message: '当前访问的是本地环境，允许使用模拟支付。'
        };
    }

    if (isLocalHostname(env?.APP_BASE_URL)) {
        return {
            allowed: true,
            reason: 'local_app_base_url',
            message: '当前部署被识别为本地环境，允许使用模拟支付。'
        };
    }

    const expiryOverride = getRemoteMockPaymentExpiryOverride(env);
    if (expiryOverride.configured) {
        if (!expiryOverride.valid) {
            return {
                allowed: false,
                reason: 'remote_whitelist_until_invalid',
                message: `${expiryOverride.envName} 配置无效，请填写 ISO 时间，例如 2026-03-22T23:59:59+08:00。`
            };
        }

        if (!expiryOverride.expired) {
            return {
                allowed: true,
                reason: 'remote_whitelist_until_enabled',
                message: `当前环境已通过限时白名单放行模拟支付，有效期至 ${formatIsoTimestamp(expiryOverride.expiresAt)}。`
            };
        }

        return {
            allowed: false,
            reason: 'remote_whitelist_until_expired',
            message: `模拟支付限时白名单已于 ${formatIsoTimestamp(expiryOverride.expiresAt)} 到期，请移除 ${expiryOverride.envName} 或重新设置新的截止时间。`
        };
    }

    if (isRemoteMockPaymentWhitelisted(env)) {
        return {
            allowed: true,
            reason: 'remote_whitelist_enabled',
            message: '当前环境已通过长期白名单放行模拟支付。建议改用 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 设置自动失效时间。'
        };
    }

    if (isProductionLikeRuntime(env)) {
        return {
            allowed: false,
            reason: 'production_like_runtime',
            message: '当前站点运行在生产环境，服务端默认禁用模拟支付；如需临时测试，建议设置 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 后重新部署。'
        };
    }

    return {
        allowed: false,
        reason: 'remote_whitelist_required',
        message: '当前环境不是本地环境，且未配置模拟支付白名单；如需临时测试，建议设置 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 后重新部署。'
    };
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

async function createPendingPaymentOrderForCheckoutSession({
    supabase,
    checkoutSession,
    user,
    providerKey,
    site,
    packageId = '',
    packageName = '',
    paidAmount = null,
    grantedPoints = 0
}) {
    const sessionId = String(checkoutSession?.id || '').trim();
    const sessionKey = String(checkoutSession?.session_key || '').trim();
    const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();
    if (!supabase || !sessionId || !normalizedProviderKey) return null;

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

    const nowIso = new Date().toISOString();
    const pendingOrderNo = buildPendingProviderOrderNo(normalizedProviderKey, sessionKey || sessionId);
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
        site,
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
    customQuote = null
}) {
    const customQuotePayload = customQuote
        ? {
            quote_id: customQuote.quoteId,
            token_hash: customQuote.tokenHash,
            issued_at: customQuote.issuedAt,
            expires_at: customQuote.expiresAt,
            points_amount: normalizeInteger(customQuote.pointsAmount, 0),
            paid_amount: normalizeCurrency(customQuote.paidAmount, null),
            pricing_mode: customQuote.pricingMode || 'fixed_rate',
            points_per_cny: Number(customQuote.pointsPerCny) || null
        }
        : null;
    const payload = {
        session_key: buildCheckoutSessionKey(providerKey),
        provider: String(providerKey || 'unknown').trim().toLowerCase() || 'unknown',
        user_id: user.id,
        site,
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
                paid_amount: paidAmount,
                site,
                is_custom_recharge: isCustomRecharge,
                custom_quote: customQuotePayload
            }
        },
        provider_metadata: {
            charge_type: isCustomRecharge ? 'custom' : 'package',
            custom_quote_id: customQuotePayload?.quote_id || null,
            custom_quote_expires_at: customQuotePayload?.expires_at || null,
            custom_quote: customQuotePayload
        },
        expires_at: getCheckoutSessionExpiryIso()
    };

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

    throw new Error('当前支付通道与前端请求不一致，请刷新页面后重试');
}

async function ensureMockPaymentAvailable({
    supabase,
    paymentChannels = null,
    rechargeOptions = null,
    env = process.env,
    requestHost = ''
}) {
    let effectivePaymentChannels = paymentChannels;
    let effectiveRechargeOptions = rechargeOptions;

    if (!effectivePaymentChannels || !effectiveRechargeOptions) {
        const loadedConfigs = await loadStoredPaymentConfigs(supabase, {
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
    await ensureMockPaymentAvailable({
        supabase,
        paymentChannels,
        rechargeOptions,
        env,
        requestHost
    });

    const site = sanitizeSite(body.site);
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

        throw runtimeError;
    }

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
        message: `已使用模拟支付完成「${packageName}」`
    };
}

async function createPaymentRequest({
    supabase,
    user,
    body = {},
    env = process.env,
    requestHost = ''
}) {
    const site = sanitizeSite(body.site);
    const requestedProviderKey = String(body.provider_key || '').trim().toLowerCase();
    const packageId = body.package_id ? String(body.package_id).trim() : '';
    const isCustomRecharge = !packageId;

    const { paymentChannels, rechargeOptions } = await loadStoredPaymentConfigs(supabase, {
        origin: env.APP_BASE_URL,
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
        const pkg = await loadPointsPackage(supabase, packageId);
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

    const checkoutSession = await createCheckoutSession({
        supabase,
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
        customQuote
    });

    if (providerKey === 'mock') {
        return completeMockPayment({
            supabase,
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
            supabase,
            env,
            config: paymentChannels
        });

        const checkoutContext = adapter.createCheckoutContext({
            runtimeContext,
            paymentChannels,
            site,
            isCustomRecharge,
            packageId,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount,
            customQuote
        });

        if (!checkoutContext?.supported) {
            await updateCheckoutSession(supabase, checkoutSession.id, {
                status: 'failed',
                error_message: checkoutContext?.message || `${adapter.label || '当前支付通道'}暂未完成接入`,
                provider_metadata: {
                    ...checkoutSession.provider_metadata,
                    adapter_supported: false
                }
            });
            throw new Error(checkoutContext?.message || `${adapter.label || '当前支付通道'}暂未完成接入`);
        }

        const updatedSession = await updateCheckoutSession(supabase, checkoutSession.id, {
            status: 'redirect_ready',
            checkout_url: checkoutContext.checkoutUrl || null,
            query_mode: checkoutContext.queryMode || null,
            provider_metadata: {
                ...checkoutSession.provider_metadata,
                display_name: checkoutContext.displayName || adapter.label || '当前支付通道',
                action: checkoutContext.action || 'redirect',
                summary: checkoutContext.summary || {}
            },
            error_message: null
        });
        let pendingPaymentOrder = null;

        if (providerKey !== 'mock') {
            try {
                pendingPaymentOrder = await createPendingPaymentOrderForCheckoutSession({
                    supabase,
                    checkoutSession: updatedSession || checkoutSession,
                    user,
                    providerKey,
                    site,
                    packageId,
                    packageName,
                    paidAmount,
                    grantedPoints
                });
            } catch (pendingOrderError) {
                console.warn('[Payments] Failed to precreate payment order from checkout session:', pendingOrderError.message);
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
            query_mode: checkoutContext.queryMode || '',
            checkout_session_id: updatedSession?.id || checkoutSession.id,
            checkout_session_key: updatedSession?.session_key || checkoutSession.session_key,
            checkout_session_status: updatedSession?.status || 'redirect_ready',
            message: checkoutContext.message || `${checkoutContext.displayName || adapter.label || '当前支付通道'}已准备就绪。`,
            provider_summary: checkoutContext.summary || {},
            custom_quote: customQuote
                ? {
                    quote_id: customQuote.quoteId,
                    token: customQuote.token,
                    issued_at: customQuote.issuedAt,
                    expires_at: customQuote.expiresAt,
                    points_amount: customQuote.pointsAmount,
                    paid_amount: customQuote.paidAmount,
                    pricing_mode: customQuote.pricingMode,
                    points_per_cny: customQuote.pointsPerCny
                }
                : null
        };
    } catch (error) {
        await updateCheckoutSession(supabase, checkoutSession.id, {
            status: 'failed',
            error_message: error.message || 'Failed to create checkout session',
            provider_metadata: {
                ...checkoutSession.provider_metadata,
                failed_at: new Date().toISOString()
            }
        });

        throw error;
    }
}

module.exports = {
    __testUtils: {
        getRemoteMockPaymentExpiryOverride,
        getMockPaymentRuntimeState,
        getCustomRechargeQuoteSecret,
        ensureMockPaymentAvailable,
        isMockPaymentRuntimeAllowed,
        resolveRequestedProviderKey
    },
    completeMockPayment,
    createCheckoutSession,
    createPaymentRequest,
    findCheckoutSessionCandidates,
    getMockPaymentRuntimeState,
    issueCustomRechargeQuote,
    loadCheckoutSessionForUser,
    loadPointsPackage,
    resolvePendingPaymentOrderFromCheckoutContext,
    reconcileCheckoutSessionForPaymentOrder,
    sanitizeSite,
    updateCheckoutSession,
    verifyCustomRechargeQuoteToken
};
