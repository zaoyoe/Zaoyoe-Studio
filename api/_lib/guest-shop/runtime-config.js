'use strict';

/**
 * Canonical runtime configuration for the guest-shop cash channel.
 *
 * Environment variables are operator input, not customer input.  A malformed
 * value must therefore never be silently coerced into a permissive limit (for
 * example, `NaN`, `Infinity`, scientific notation, or a negative number).
 * Unset values use the documented conservative defaults.  Callers running in
 * a production-like environment can pass `strict: true` to reject any
 * explicitly supplied value that is malformed, outside its safe range, or
 * inconsistent with another setting.
 */

const GUEST_SHOP_RUNTIME_SETTINGS = Object.freeze({
    GUEST_SHOP_ORDER_TTL_SECONDS: Object.freeze({
        key: 'orderTtlSeconds',
        type: 'integer',
        defaultValue: 1800,
        min: 300,
        max: 7200,
        label: '游客订单 TTL'
    }),
    GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: Object.freeze({
        key: 'paymentCreationLeaseMs',
        type: 'integer',
        defaultValue: 120000,
        min: 30000,
        max: 900000,
        label: '支付创建租约'
    }),
    GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT: Object.freeze({
        key: 'webhookGlobalLimit',
        type: 'integer',
        defaultValue: 1200,
        min: 10,
        max: 100000,
        label: '游客 webhook 全局每分钟上限'
    }),
    GUEST_SHOP_WEBHOOK_IP_LIMIT: Object.freeze({
        key: 'webhookIpLimit',
        type: 'integer',
        defaultValue: 120,
        min: 5,
        max: 10000,
        label: '游客 webhook 单 IP 每分钟上限'
    }),
    GUEST_SHOP_WORKER_BATCH_SIZE: Object.freeze({
        key: 'workerBatchSize',
        type: 'integer',
        defaultValue: 20,
        min: 1,
        max: 100,
        label: '游客履约 Worker 批量大小'
    }),
    GUEST_SHOP_WORKER_MAX_ATTEMPTS: Object.freeze({
        key: 'workerMaxAttempts',
        type: 'integer',
        defaultValue: 8,
        min: 1,
        max: 50,
        label: '游客履约最大重试次数'
    }),
    GUEST_SHOP_WORKER_REFUND_MAX_ATTEMPTS: Object.freeze({
        key: 'workerRefundMaxAttempts',
        type: 'integer',
        defaultValue: 5,
        min: 1,
        max: 50,
        label: '游客退款最大重试次数'
    }),
    GUEST_SHOP_WORKER_BASE_BACKOFF_MS: Object.freeze({
        key: 'workerBaseBackoffMs',
        type: 'integer',
        defaultValue: 15000,
        min: 1000,
        max: 24 * 60 * 60 * 1000,
        label: '游客履约基础退避时间'
    }),
    GUEST_SHOP_WORKER_MAX_BACKOFF_MS: Object.freeze({
        key: 'workerMaxBackoffMs',
        type: 'integer',
        defaultValue: 30 * 60 * 1000,
        min: 1000,
        max: 7 * 24 * 60 * 60 * 1000,
        label: '游客履约最大退避时间'
    }),
    GUEST_SHOP_WORKER_LEASE_MS: Object.freeze({
        key: 'workerLeaseMs',
        type: 'integer',
        defaultValue: 2 * 60 * 1000,
        min: 10000,
        max: 30 * 60 * 1000,
        label: '游客履约租约时间'
    }),
    GUEST_SHOP_WORKER_RETRY_JITTER_RATIO: Object.freeze({
        key: 'workerRetryJitterRatio',
        type: 'number',
        defaultValue: 0.2,
        min: 0,
        max: 0.5,
        label: '游客履约重试抖动比例'
    }),
    // ---------------------------------------------------------------------
    // Order Access 2.0 (docs/guest-shop-order-access-2.0.md §17 K26-K38).
    //
    // scrypt cost parameters are deliberately NOT in this table. An operator
    // typo that lowers N from 32768 to 1024 would silently turn the query
    // password into an offline-crackable hash, and nothing at runtime would
    // notice. Cost parameters therefore live as frozen constants in
    // api/_lib/guest-shop/security.js together with a policy floor, and the
    // readiness gate asserts both. Only the knobs that legitimately need
    // operational tuning are exposed here.
    // ---------------------------------------------------------------------
    GUEST_SHOP_BUYER_PASSWORD_MIN_LENGTH: Object.freeze({
        key: 'buyerPasswordMinLength',
        type: 'integer',
        defaultValue: 8,
        min: 6,
        max: 20,
        label: '游客查询密码最小长度'
    }),
    GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP: Object.freeze({
        key: 'buyerCredentialGroupCap',
        type: 'integer',
        defaultValue: 3,
        min: 1,
        // Must stay <= the guest_shop_buyers_group_range CHECK upper bound in
        // supabase/migrations/20260920_guest_shop_buyer_credentials.sql.
        max: 5,
        label: '单邮箱凭证分组上限'
    }),
    GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES: Object.freeze({
        key: 'buyerLoginMaxFailures',
        type: 'integer',
        defaultValue: 5,
        min: 3,
        max: 20,
        label: '游客查询密码失败上限（单买家）'
    }),
    GUEST_SHOP_BUYER_LOGIN_WINDOW_SECONDS: Object.freeze({
        key: 'buyerLoginWindowSeconds',
        type: 'integer',
        defaultValue: 600,
        min: 60,
        max: 3600,
        label: '游客登录失败统计窗口'
    }),
    GUEST_SHOP_BUYER_IP_MAX_FAILURES: Object.freeze({
        key: 'buyerIpMaxFailures',
        type: 'integer',
        defaultValue: 20,
        min: 5,
        max: 100,
        label: '游客登录失败上限（单 IP）'
    }),
    GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD: Object.freeze({
        key: 'buyerCaptchaBuyerThreshold',
        type: 'integer',
        defaultValue: 3,
        min: 1,
        max: 20,
        label: '游客登录验证码触发阈值（单买家）'
    }),
    GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD: Object.freeze({
        key: 'buyerCaptchaIpThreshold',
        type: 'integer',
        defaultValue: 8,
        min: 1,
        max: 100,
        label: '游客登录验证码触发阈值（单 IP）'
    }),
    GUEST_SHOP_BUYER_ACCESS_SESSION_TTL_SECONDS: Object.freeze({
        key: 'buyerAccessSessionTtlSeconds',
        type: 'integer',
        defaultValue: 1800,
        min: 300,
        max: 86400,
        label: '游客订单访问会话有效期'
    }),
    GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS: Object.freeze({
        key: 'buyerAccessAuditRetentionDays',
        type: 'integer',
        defaultValue: 30,
        min: 7,
        max: 180,
        label: '游客登录审计保留天数'
    })
});

const PUBLIC_RUNTIME_SETTING_NAMES = Object.freeze([
    'GUEST_SHOP_ORDER_TTL_SECONDS',
    'GUEST_SHOP_PAYMENT_CREATE_LEASE_MS',
    'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT',
    'GUEST_SHOP_WEBHOOK_IP_LIMIT'
]);

const WORKER_RUNTIME_SETTING_NAMES = Object.freeze([
    'GUEST_SHOP_WORKER_BATCH_SIZE',
    'GUEST_SHOP_WORKER_MAX_ATTEMPTS',
    'GUEST_SHOP_WORKER_REFUND_MAX_ATTEMPTS',
    'GUEST_SHOP_WORKER_BASE_BACKOFF_MS',
    'GUEST_SHOP_WORKER_MAX_BACKOFF_MS',
    'GUEST_SHOP_WORKER_LEASE_MS',
    'GUEST_SHOP_WORKER_RETRY_JITTER_RATIO'
]);

const BUYER_CREDENTIAL_RUNTIME_SETTING_NAMES = Object.freeze([
    'GUEST_SHOP_BUYER_PASSWORD_MIN_LENGTH',
    'GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP',
    'GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES',
    'GUEST_SHOP_BUYER_LOGIN_WINDOW_SECONDS',
    'GUEST_SHOP_BUYER_IP_MAX_FAILURES',
    'GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD',
    'GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD',
    'GUEST_SHOP_BUYER_ACCESS_SESSION_TTL_SECONDS',
    'GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS'
]);

const ALL_RUNTIME_SETTING_NAMES = Object.freeze(Object.keys(GUEST_SHOP_RUNTIME_SETTINGS));

function isProductionLikeRuntime(env = {}) {
    return ['VERCEL_ENV', 'RAILWAY_ENVIRONMENT_NAME', 'DEPLOYMENT_TIER', 'APP_ENV']
        .map((name) => String(env?.[name] ?? '').trim().toLowerCase())
        .includes('production');
}

function isMissingValue(value) {
    if (value === undefined || value === null) return true;
    return typeof value === 'string' && value.trim() === '';
}

function strictNumericText(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : '';
    }
    if (typeof value !== 'string') return '';
    return value.trim();
}

function parseRuntimeNumericSetting(env, name) {
    const spec = GUEST_SHOP_RUNTIME_SETTINGS[name];
    if (!spec) {
        return Object.freeze({
            name,
            present: false,
            valid: false,
            value: null,
            reason: 'unknown_runtime_setting'
        });
    }

    const raw = env?.[name];
    if (isMissingValue(raw)) {
        return Object.freeze({
            name,
            key: spec.key,
            present: false,
            valid: true,
            value: spec.defaultValue,
            effectiveValue: spec.defaultValue,
            defaulted: true,
            spec
        });
    }

    const text = strictNumericText(raw);
    const pattern = spec.type === 'integer'
        ? /^\d+$/u
        : /^(?:\d+(?:\.\d+)?)$/u;
    if (!text || !pattern.test(text)) {
        return Object.freeze({
            name,
            key: spec.key,
            present: true,
            valid: false,
            value: null,
            effectiveValue: spec.defaultValue,
            defaulted: true,
            reason: `${name} 必须是范围内的十进制${spec.type === 'integer' ? '整数' : '数字'}`,
            code: 'invalid_numeric_format',
            spec
        });
    }

    const parsed = Number(text);
    const typeValid = spec.type === 'integer' ? Number.isSafeInteger(parsed) : Number.isFinite(parsed);
    if (!typeValid || parsed < spec.min || parsed > spec.max) {
        return Object.freeze({
            name,
            key: spec.key,
            present: true,
            valid: false,
            value: Number.isFinite(parsed) ? parsed : null,
            effectiveValue: spec.defaultValue,
            defaulted: true,
            reason: `${name} 必须在 ${spec.min}-${spec.max} 范围内`,
            code: !typeValid ? 'invalid_numeric_value' : 'numeric_out_of_range',
            spec
        });
    }

    return Object.freeze({
        name,
        key: spec.key,
        present: true,
        valid: true,
        value: parsed,
        effectiveValue: parsed,
        defaulted: false,
        spec
    });
}

function normalizeSettingNames(names) {
    if (!Array.isArray(names) || names.length === 0) return ALL_RUNTIME_SETTING_NAMES;
    return [...new Set(names.map((name) => String(name || '').trim()).filter((name) => GUEST_SHOP_RUNTIME_SETTINGS[name]))];
}

function makeConfigError(errors) {
    const error = new Error('游客支付运行时配置无效');
    error.name = 'GuestShopRuntimeConfigError';
    error.code = 'guest_shop_runtime_config_invalid';
    error.statusCode = 503;
    error.status = 503;
    error.expose = false;
    // Keep only variable names/codes in diagnostics.  Never attach raw env
    // values to an error that might be logged or serialized.
    error.configErrors = (errors || []).map((item) => ({
        name: item.name,
        code: item.code || 'invalid_numeric_config'
    }));
    return error;
}

/**
 * Parse one or more guest-shop numeric settings.
 *
 * `strict` is intentionally opt-in so local/test callers can inspect an
 * invalid configuration without crashing the process.  Production handlers
 * and workers pass strict=true and stop before touching payment, inventory,
 * or fulfillment state.
 */
function resolveGuestShopRuntimeConfig(env = {}, { strict = false, names = ALL_RUNTIME_SETTING_NAMES } = {}) {
    const selectedNames = normalizeSettingNames(names);
    const entries = selectedNames.map((name) => parseRuntimeNumericSetting(env, name));
    const errors = entries.filter((entry) => entry.present && !entry.valid).map((entry) => ({
        name: entry.name,
        key: entry.key,
        code: entry.code || 'invalid_numeric_config',
        reason: entry.reason
    }));

    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    const values = Object.fromEntries(entries.map((entry) => [
        entry.key,
        entry.valid ? entry.value : entry.spec.defaultValue
    ]));

    // These relationships are security/operability invariants.  A global
    // webhook bucket smaller than one IP bucket can make the configured IP
    // limit misleading; a max backoff below the base is similarly ambiguous.
    if (byName.GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT?.valid
        && byName.GUEST_SHOP_WEBHOOK_IP_LIMIT?.valid
        && byName.GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT.value < byName.GUEST_SHOP_WEBHOOK_IP_LIMIT.value) {
        errors.push({
            name: 'GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT,GUEST_SHOP_WEBHOOK_IP_LIMIT',
            key: 'webhook-limit-order',
            code: 'inconsistent_numeric_config',
            reason: '全局 webhook 上限不能小于单 IP 上限'
        });
    }
    if (byName.GUEST_SHOP_WORKER_BASE_BACKOFF_MS?.valid
        && byName.GUEST_SHOP_WORKER_MAX_BACKOFF_MS?.valid
        && byName.GUEST_SHOP_WORKER_MAX_BACKOFF_MS.value < byName.GUEST_SHOP_WORKER_BASE_BACKOFF_MS.value) {
        errors.push({
            name: 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS,GUEST_SHOP_WORKER_MAX_BACKOFF_MS',
            key: 'worker-backoff-order',
            code: 'inconsistent_numeric_config',
            reason: 'Worker 最大退避不能小于基础退避'
        });
    }

    // Order Access 2.0 invariants. A captcha threshold at or above the lockout
    // threshold is dead configuration: the account locks before the challenge
    // is ever shown, so the operator believes they have step-up protection and
    // do not. Treat it as an inconsistency rather than a silent no-op.
    if (byName.GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD?.valid
        && byName.GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES?.valid
        && byName.GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD.value >= byName.GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES.value) {
        errors.push({
            name: 'GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD,GUEST_SHOP_BUYER_LOGIN_MAX_FAILURES',
            key: 'buyer-captcha-before-lockout',
            code: 'inconsistent_numeric_config',
            reason: '买家验证码阈值必须小于锁定失败次数，否则验证码永远不会触发'
        });
    }
    if (byName.GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD?.valid
        && byName.GUEST_SHOP_BUYER_IP_MAX_FAILURES?.valid
        && byName.GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD.value >= byName.GUEST_SHOP_BUYER_IP_MAX_FAILURES.value) {
        errors.push({
            name: 'GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD,GUEST_SHOP_BUYER_IP_MAX_FAILURES',
            key: 'buyer-captcha-ip-before-lockout',
            code: 'inconsistent_numeric_config',
            reason: 'IP 验证码阈值必须小于 IP 锁定失败次数，否则验证码永远不会触发'
        });
    }

    const result = {
        ...values,
        entries: Object.freeze(entries),
        errors: Object.freeze(errors),
        invalid: errors.length > 0,
        productionLike: isProductionLikeRuntime(env)
    };
    Object.freeze(result);

    if (strict && result.invalid) throw makeConfigError(errors);
    return result;
}

function assertGuestShopRuntimeConfig(env = {}, options = {}) {
    return resolveGuestShopRuntimeConfig(env, { ...options, strict: true });
}

module.exports = {
    ALL_RUNTIME_SETTING_NAMES,
    BUYER_CREDENTIAL_RUNTIME_SETTING_NAMES,
    GUEST_SHOP_RUNTIME_SETTINGS,
    PUBLIC_RUNTIME_SETTING_NAMES,
    WORKER_RUNTIME_SETTING_NAMES,
    assertGuestShopRuntimeConfig,
    isProductionLikeRuntime,
    makeConfigError,
    parseRuntimeNumericSetting,
    resolveGuestShopRuntimeConfig
};

