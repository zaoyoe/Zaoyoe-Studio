const {
    PAYMENT_CHANNEL_SECRET_KEYS,
    resolveStoredPaymentSecret,
    normalizePaymentSecretSite
} = require('../secrets');
const {
    normalizeHupijiaoConfig
} = require('./hupijiao');
const {
    normalizeZpayConfig
} = require('./zpay');
const {
    normalizeNowpaymentsConfig
} = require('./nowpayments');
const {
    resolveSiteRequestOrigin,
    classifyManagedSite
} = require('./site-origins');
const {
    normalizeSiteScopedSystemConfigSite,
    resolveSiteScopedSystemConfigForRead
} = require('../../../server/api-handlers/_site-scoped-system-config');

const PROVIDER_KEYS = Object.freeze(['mock', 'afdian', 'hupijiao', 'zpay', 'nowpayments']);
const NON_MOCK_PROVIDER_PRIORITY = Object.freeze(['nowpayments', 'zpay', 'hupijiao', 'afdian']);
const DEFAULT_SITE_ORIGIN = 'https://www.fatherkey.com';
const DEFAULT_AFDIAN_CHECKOUT_URL = 'https://afdian.com/a/zaoyoe';
const DEFAULT_CUSTOM_RECHARGE_MIN_POINTS = 0.01;
const DEFAULT_CUSTOM_RECHARGE_MAX_POINTS = 50000;
const DEFAULT_CUSTOM_RECHARGE_STEP = 0.01;
const DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY = 1;
const DEFAULT_CUSTOM_RECHARGE_QUOTE_TTL_SECONDS = 1800;

const PROVIDER_SECRET_NAMES = Object.freeze({
    mock: [],
    afdian: ['afdian_token'],
    hupijiao: ['hupijiao_api_key', 'hupijiao_secret_key'],
    zpay: ['zpay_pkey'],
    nowpayments: ['nowpayments_api_key', 'nowpayments_ipn_secret']
});

const SECRET_ENV_FALLBACKS = Object.freeze({
    afdian_token: ['AFDIAN_TOKEN'],
    hupijiao_api_key: ['HUPIJIAO_API_KEY'],
    hupijiao_secret_key: ['HUPIJIAO_SECRET_KEY'],
    zpay_pkey: ['ZPAY_PKEY', 'ZPAY_KEY'],
    nowpayments_api_key: ['NOWPAYMENTS_API_KEY'],
    nowpayments_ipn_secret: ['NOWPAYMENTS_IPN_SECRET']
});
const PUBLIC_PROVIDER_FIELDS = Object.freeze({
    mock: ['enabled', 'display_name', 'description'],
    afdian: ['enabled', 'display_name', 'checkout_url', 'package_hint', 'custom_amount_hint', 'order_query_enabled', 'order_query_title', 'order_query_hint', 'order_query_placeholder', 'surcharge_rate', 'surcharge_label'],
    hupijiao: ['enabled', 'display_name', 'checkout_url', 'package_hint', 'custom_amount_hint', 'order_query_enabled', 'order_query_title', 'order_query_hint', 'order_query_placeholder', 'surcharge_rate', 'surcharge_label'],
    zpay: ['enabled', 'display_name', 'checkout_url', 'package_hint', 'custom_amount_hint', 'order_query_enabled', 'order_query_title', 'order_query_hint', 'order_query_placeholder', 'surcharge_rate', 'surcharge_label'],
    nowpayments: ['enabled', 'display_name', 'pay_currency', 'network_name', 'cny_to_usd_rate', 'pay_amount_precision', 'package_hint', 'custom_amount_hint', 'order_query_enabled', 'order_query_title', 'order_query_hint', 'order_query_placeholder', 'surcharge_rate', 'surcharge_label', 'is_fee_paid_by_user']
});
const PUBLIC_MOCK_RUNTIME_MESSAGES = Object.freeze({
    local_request_host: '当前环境允许使用模拟支付。',
    local_app_base_url: '当前环境允许使用模拟支付。',
    remote_whitelist_until_enabled: '当前环境临时允许使用模拟支付。',
    remote_whitelist_enabled: '当前环境允许使用模拟支付。',
    remote_whitelist_until_invalid: '当前环境暂未开放模拟支付。',
    remote_whitelist_until_expired: '当前环境暂未开放模拟支付。',
    production_like_runtime: '当前环境暂未开放模拟支付。',
    remote_whitelist_required: '当前环境暂未开放模拟支付。'
});
const PROVIDER_DISPLAY_NAMES = Object.freeze({
    mock: '模拟支付',
    afdian: '爱发电',
    hupijiao: '虎皮椒',
    zpay: '易支付',
    nowpayments: 'USDT-BEP20'
});

function sanitizeOrigin(value, fallback = DEFAULT_SITE_ORIGIN) {
    const normalized = String(value || '').trim();
    if (!normalized) return fallback;
    return normalized.replace(/\/+$/, '') || fallback;
}

function sanitizeText(value, fallback = '', maxLength = 500) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

function buildDefaultPaymentWebhookUrl(origin = DEFAULT_SITE_ORIGIN, providerKey = '') {
    const normalizedOrigin = sanitizeOrigin(origin, DEFAULT_SITE_ORIGIN);
    const normalizedProviderKey = sanitizeText(String(providerKey || '').toLowerCase(), '', 32);
    if (!normalizedProviderKey) {
        return normalizedOrigin;
    }
    return `${normalizedOrigin}/api/payments/${normalizedProviderKey}/webhook`;
}

function coerceBoolean(value, fallback = false) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return fallback;
}

function coerceFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function coercePositiveNumber(value, fallback) {
    const parsed = coerceFiniteNumber(value, fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function coercePositivePointNumber(value, fallback) {
    const parsed = coercePositiveNumber(value, fallback);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.round(parsed * 100) / 100
        : fallback;
}

function coercePositiveInteger(value, fallback) {
    const parsed = Math.round(coerceFiniteNumber(value, fallback));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function coercePrecisionInteger(value, fallback) {
    const parsed = Math.round(coerceFiniteNumber(value, fallback));
    return Number.isFinite(parsed) ? Math.min(8, Math.max(0, parsed)) : fallback;
}

function coerceSurchargeRate(value, fallback = 0) {
    const parsed = coerceFiniteNumber(value, fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(0.1, Math.round(parsed * 10000) / 10000);
}

function hasCheckoutUrl(provider = {}) {
    return Boolean(String(provider?.checkout_url || '').trim());
}

function isHttpsUrl(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return false;

    try {
        const candidate = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
        return new URL(candidate).protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function isProductionLikeRuntime(env = process.env) {
    const vercelEnv = String(env?.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(env?.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(env?.DEPLOYMENT_TIER || env?.APP_ENV || '').trim().toLowerCase();

    return vercelEnv === 'production'
        || railwayEnv === 'production'
        || deploymentTier === 'production';
}

function isSecretConfigured(entry) {
    if (entry === true) return true;
    if (typeof entry === 'string') return Boolean(entry.trim());
    if (entry && typeof entry === 'object') {
        return entry.configured === true || Boolean(String(entry.value || '').trim());
    }
    return false;
}

function mapProviderMissingFieldLabel(providerKey = '', fieldName = '') {
    const normalizedProvider = String(providerKey || '').trim().toLowerCase();
    const normalizedField = String(fieldName || '').trim().toLowerCase();
    const fieldMap = {
        zpay: {
            pid: '缺少 PID',
            pkey: '缺少 PKEY',
            notify_url: '缺少 notify_url'
        },
        nowpayments: {
            api_key: '缺少 API Key',
            ipn_secret: '缺少 IPN Secret',
            ipn_callback_url: '缺少 Webhook URL',
            cny_to_usd_rate: '缺少 CNY 到 USD 汇率'
        },
        hupijiao: {
            appid: '缺少商户号',
            appsecret: '缺少密钥',
            notify_url: '缺少 notify_url'
        }
    };

    return fieldMap[normalizedProvider]?.[normalizedField]
        || `缺少 ${normalizedField || '必要配置'}`;
}

function buildPaymentProviderActivationCheck(
    providerKey,
    paymentChannels = {},
    secretStatus = {},
    env = process.env
) {
    const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();
    const normalizedChannels = normalizePaymentChannelsConfig(paymentChannels);
    const provider = normalizedChannels.providers?.[normalizedProviderKey] || {};
    const label = PROVIDER_DISPLAY_NAMES[normalizedProviderKey]
        || String(provider.display_name || '').trim()
        || '支付通道';
    const issues = [];
    const warnings = [];

    if (!normalizedProviderKey || !PROVIDER_KEYS.includes(normalizedProviderKey)) {
        return {
            providerKey: normalizedProviderKey,
            label,
            ready: false,
            issues: ['未知支付通道'],
            warnings
        };
    }

    if (normalizedProviderKey === 'mock') {
        return {
            providerKey: normalizedProviderKey,
            label,
            ready: true,
            issues: [],
            warnings
        };
    }

    if (provider.enabled !== true) {
        issues.push(`${label}通道未启用`);
    }

    if (normalizedProviderKey === 'afdian') {
        if (!hasCheckoutUrl(provider)) {
            issues.push('缺少 checkout_url');
        }
        return {
            providerKey: normalizedProviderKey,
            label,
            ready: issues.length === 0,
            issues,
            warnings
        };
    }

    if (normalizedProviderKey === 'nowpayments') {
        const normalizedConfig = normalizeNowpaymentsConfig({
            channelConfig: provider,
            secretValues: {
                nowpayments_api_key: isSecretConfigured(secretStatus.nowpayments_api_key)
                    ? '__configured__'
                    : '',
                nowpayments_ipn_secret: isSecretConfigured(secretStatus.nowpayments_ipn_secret)
                    ? '__configured__'
                    : ''
            },
            requestOrigin: provider.return_url || DEFAULT_SITE_ORIGIN,
            env
        });

        normalizedConfig.missingFields.forEach((fieldName) => {
            issues.push(mapProviderMissingFieldLabel(normalizedProviderKey, fieldName));
        });

        if (String(normalizedConfig.payCurrency || '').trim().toLowerCase() !== 'usdtbsc') {
            warnings.push('当前 NOWPayments pay_currency 不是 usdtbsc，请确认是否仍要使用 BSC/BEP20。');
        }
        if (isProductionLikeRuntime(env) && normalizedConfig.ipnCallbackUrl && !isHttpsUrl(normalizedConfig.ipnCallbackUrl)) {
            issues.push('Webhook URL 必须使用 HTTPS');
        }

        return {
            providerKey: normalizedProviderKey,
            label,
            ready: issues.length === 0,
            issues,
            warnings
        };
    }

    if (normalizedProviderKey === 'hupijiao') {
        const normalizedConfig = normalizeHupijiaoConfig({
            channelConfig: provider,
            secretValues: {
                hupijiao_secret_key: isSecretConfigured(secretStatus.hupijiao_secret_key)
                    ? '__configured__'
                    : ''
            },
            requestOrigin: provider.return_url || DEFAULT_SITE_ORIGIN
        });

        normalizedConfig.missingFields.forEach((fieldName) => {
            issues.push(mapProviderMissingFieldLabel(normalizedProviderKey, fieldName));
        });

        if (isProductionLikeRuntime(env)) {
            if (!String(env?.HUPIJIAO_WEBHOOK_ALLOWED_IPS || '').trim()) {
                issues.push('生产环境缺少 HUPIJIAO_WEBHOOK_ALLOWED_IPS');
            }
            if (normalizedConfig.notifyUrl && !isHttpsUrl(normalizedConfig.notifyUrl)) {
                issues.push('notify_url 必须使用 HTTPS');
            }
            if (normalizedConfig.returnUrl && !isHttpsUrl(normalizedConfig.returnUrl)) {
                issues.push('return_url 必须使用 HTTPS');
            }
        }

        return {
            providerKey: normalizedProviderKey,
            label,
            ready: issues.length === 0,
            issues,
            warnings
        };
    }

    if (normalizedProviderKey === 'zpay') {
        const normalizedConfig = normalizeZpayConfig({
            channelConfig: provider,
            secretValues: {
                zpay_pkey: isSecretConfigured(secretStatus.zpay_pkey)
                    ? '__configured__'
                    : ''
            },
            requestOrigin: provider.return_url || DEFAULT_SITE_ORIGIN
        });

        normalizedConfig.missingFields.forEach((fieldName) => {
            issues.push(mapProviderMissingFieldLabel(normalizedProviderKey, fieldName));
        });

        if (isProductionLikeRuntime(env)) {
            if (!String(env?.ZPAY_WEBHOOK_ALLOWED_IPS || '').trim()) {
                warnings.push('生产环境未配置 ZPAY_WEBHOOK_ALLOWED_IPS，将启用严格查单模式');
            }
            if (normalizedConfig.notifyUrl && !isHttpsUrl(normalizedConfig.notifyUrl)) {
                issues.push('notify_url 必须使用 HTTPS');
            }
            if (normalizedConfig.returnUrl && !isHttpsUrl(normalizedConfig.returnUrl)) {
                issues.push('return_url 必须使用 HTTPS');
            }
        }

        return {
            providerKey: normalizedProviderKey,
            label,
            ready: issues.length === 0,
            issues,
            warnings
        };
    }

    return {
        providerKey: normalizedProviderKey,
        label,
        ready: issues.length === 0,
        issues,
        warnings
    };
}

function resolvePreferredEnabledProviderKey(providers = {}, fallback = 'afdian') {
    const sourceProviders = providers && typeof providers === 'object' ? providers : {};
    const candidateKeys = [...NON_MOCK_PROVIDER_PRIORITY, ...Object.keys(sourceProviders)];
    const seen = new Set();

    for (const providerKey of candidateKeys) {
        const normalizedKey = String(providerKey || '').trim().toLowerCase();
        if (!normalizedKey || normalizedKey === 'mock' || seen.has(normalizedKey)) {
            continue;
        }
        seen.add(normalizedKey);
        const provider = sourceProviders[normalizedKey];
        if (provider?.enabled === true && hasCheckoutUrl(provider)) {
            return normalizedKey;
        }
    }

    for (const providerKey of candidateKeys) {
        const normalizedKey = String(providerKey || '').trim().toLowerCase();
        if (!normalizedKey || normalizedKey === 'mock' || seen.has(`enabled:${normalizedKey}`)) {
            continue;
        }
        seen.add(`enabled:${normalizedKey}`);
        const provider = sourceProviders[normalizedKey];
        if (provider?.enabled === true) {
            return normalizedKey;
        }
    }

    return PROVIDER_KEYS.includes(fallback) ? fallback : 'afdian';
}

function normalizeRechargeOptionsConfig(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        custom_amount_enabled: source.custom_amount_enabled === true
            || String(source.custom_amount_enabled) === 'true',
        mock_payment_enabled: source.mock_payment_enabled === true
            || String(source.mock_payment_enabled) === 'true',
        custom_amount_min_points: DEFAULT_CUSTOM_RECHARGE_MIN_POINTS,
        custom_amount_max_points: Math.max(
            DEFAULT_CUSTOM_RECHARGE_MIN_POINTS,
            coercePositivePointNumber(
                source.custom_amount_max_points,
                DEFAULT_CUSTOM_RECHARGE_MAX_POINTS
            )
        ),
        custom_amount_step: DEFAULT_CUSTOM_RECHARGE_STEP,
        custom_amount_points_per_cny: DEFAULT_CUSTOM_RECHARGE_POINTS_PER_CNY,
        custom_amount_quote_ttl_seconds: coercePositiveInteger(
            source.custom_amount_quote_ttl_seconds,
            DEFAULT_CUSTOM_RECHARGE_QUOTE_TTL_SECONDS
        )
    };
}

function getDefaultPaymentChannelsConfig(options = {}) {
    const origin = sanitizeOrigin(options.origin || process.env.APP_BASE_URL || DEFAULT_SITE_ORIGIN);
    const afdianCheckoutUrl = sanitizeText(
        options.afdianCheckoutUrl || process.env.PAYMENT_AFDIAN_URL || DEFAULT_AFDIAN_CHECKOUT_URL,
        DEFAULT_AFDIAN_CHECKOUT_URL,
        500
    );

    const providers = {
        mock: {
            enabled: true,
            display_name: '模拟支付',
            description: '仅允许本地开发或显式白名单环境使用，开启后会直接到账积分。'
        },
        afdian: {
            enabled: true,
            display_name: '爱发电',
            checkout_url: afdianCheckoutUrl,
            package_hint: '请在爱发电完成支付后，返回钱包输入订单号领取兑换码。',
            custom_amount_hint: '钱包会先生成本次应付金额，请按报价完成支付后返回输入订单号领取兑换码。',
            surcharge_rate: 0,
            surcharge_label: '通道手续费',
            order_query_enabled: true,
            order_query_title: '订单号认领',
            order_query_hint: '完成支付后，可在这里输入订单号查询兑换结果。',
            order_query_placeholder: '输入支付平台订单号'
        },
        hupijiao: {
            enabled: false,
            display_name: '虎皮椒',
            checkout_url: '',
            gateway_url: '',
            merchant_id: '',
            return_url: origin,
            notify_url: buildDefaultPaymentWebhookUrl(origin, 'hupijiao'),
            package_hint: '虎皮椒通道已启用，正式回调与自动发货接入后即可完整使用。',
            custom_amount_hint: '虎皮椒通道已启用。自定义金额下单能力接入后，这里会直接拉起真实支付。',
            surcharge_rate: 0,
            surcharge_label: '通道手续费',
            order_query_enabled: false,
            order_query_title: '',
            order_query_hint: '',
            order_query_placeholder: ''
        },
        zpay: {
            enabled: false,
            display_name: '易支付',
            checkout_url: 'https://zpayz.cn',
            pid: '',
            payment_type: 'alipay',
            channel_ids: '',
            return_url: origin,
            notify_url: buildDefaultPaymentWebhookUrl(origin, 'zpay'),
            package_hint: '易支付通道已启用，创建订单后会直接拉起收银台完成支付。',
            custom_amount_hint: '易支付通道已启用。自定义金额订单会按当前报价直接拉起收银台。',
            surcharge_rate: coerceSurchargeRate(process.env.PAYMENT_ZPAY_SURCHARGE_RATE, 0.01),
            surcharge_label: '通道手续费',
            order_query_enabled: false,
            order_query_title: '',
            order_query_hint: '',
            order_query_placeholder: ''
        },
        nowpayments: {
            enabled: false,
            display_name: 'USDT-BEP20',
            api_base_url: 'https://api.nowpayments.io',
            pay_currency: 'usdtbsc',
            price_currency: 'usd',
            network_name: 'BNB Smart Chain',
            cny_to_usd_rate: Number(process.env.NOWPAYMENTS_CNY_TO_USD_RATE || '') || 0.14,
            pay_amount_precision: Number.isFinite(Number(process.env.NOWPAYMENTS_PAY_AMOUNT_PRECISION))
                ? coercePrecisionInteger(process.env.NOWPAYMENTS_PAY_AMOUNT_PRECISION, 2)
                : 2,
            is_fixed_rate: true,
            is_fee_paid_by_user: true,
            return_url: origin,
            ipn_callback_url: buildDefaultPaymentWebhookUrl(origin, 'nowpayments'),
            success_url: origin,
            cancel_url: origin,
            package_hint: '请使用 USDT-BEP20 / BNB Smart Chain 完成付款，勿使用 ERC20、TRC20 或其他网络。',
            custom_amount_hint: '请按页面显示的 USDT-BEP20 金额付款，网络请选择 BNB Smart Chain。',
            surcharge_rate: coerceSurchargeRate(process.env.PAYMENT_NOWPAYMENTS_SURCHARGE_RATE, 0.01),
            surcharge_label: '通道手续费',
            order_query_enabled: false,
            order_query_title: '',
            order_query_hint: '',
            order_query_placeholder: ''
        }
    };

    return {
        active_provider: resolvePreferredEnabledProviderKey(providers, 'afdian'),
        providers
    };
}

function normalizePaymentChannelsConfig(raw, legacyRechargeOptions = null, options = {}) {
    const defaults = getDefaultPaymentChannelsConfig(options);
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceProviders = source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)
        ? source.providers
        : {};
    const normalizedRechargeOptions = normalizeRechargeOptionsConfig(legacyRechargeOptions);
    const fallbackActiveProvider = normalizedRechargeOptions.mock_payment_enabled
        ? 'mock'
        : resolvePreferredEnabledProviderKey(sourceProviders, defaults.active_provider);

    const config = {
        active_provider: PROVIDER_KEYS.includes(source.active_provider) ? source.active_provider : fallbackActiveProvider,
        providers: {
            mock: {
                enabled: coerceBoolean(sourceProviders.mock?.enabled, defaults.providers.mock.enabled),
                display_name: sanitizeText(sourceProviders.mock?.display_name, defaults.providers.mock.display_name, 40),
                description: sanitizeText(sourceProviders.mock?.description, defaults.providers.mock.description, 240)
            },
            afdian: {
                enabled: coerceBoolean(sourceProviders.afdian?.enabled, defaults.providers.afdian.enabled),
                display_name: sanitizeText(sourceProviders.afdian?.display_name, defaults.providers.afdian.display_name, 40),
                checkout_url: sanitizeText(sourceProviders.afdian?.checkout_url, defaults.providers.afdian.checkout_url, 500),
                package_hint: sanitizeText(sourceProviders.afdian?.package_hint, defaults.providers.afdian.package_hint, 240),
                custom_amount_hint: sanitizeText(sourceProviders.afdian?.custom_amount_hint, defaults.providers.afdian.custom_amount_hint, 240),
                surcharge_rate: coerceSurchargeRate(sourceProviders.afdian?.surcharge_rate, defaults.providers.afdian.surcharge_rate),
                surcharge_label: sanitizeText(sourceProviders.afdian?.surcharge_label, defaults.providers.afdian.surcharge_label, 40),
                order_query_enabled: coerceBoolean(sourceProviders.afdian?.order_query_enabled, defaults.providers.afdian.order_query_enabled),
                order_query_title: sanitizeText(sourceProviders.afdian?.order_query_title, defaults.providers.afdian.order_query_title, 80),
                order_query_hint: sanitizeText(sourceProviders.afdian?.order_query_hint, defaults.providers.afdian.order_query_hint, 240),
                order_query_placeholder: sanitizeText(sourceProviders.afdian?.order_query_placeholder, defaults.providers.afdian.order_query_placeholder, 80)
            },
            hupijiao: {
                enabled: coerceBoolean(sourceProviders.hupijiao?.enabled, defaults.providers.hupijiao.enabled),
                display_name: sanitizeText(sourceProviders.hupijiao?.display_name, defaults.providers.hupijiao.display_name, 40),
                checkout_url: sanitizeText(sourceProviders.hupijiao?.checkout_url, defaults.providers.hupijiao.checkout_url, 500),
                gateway_url: sanitizeText(sourceProviders.hupijiao?.gateway_url, defaults.providers.hupijiao.gateway_url, 500),
                merchant_id: sanitizeText(sourceProviders.hupijiao?.merchant_id, defaults.providers.hupijiao.merchant_id, 120),
                return_url: sanitizeText(sourceProviders.hupijiao?.return_url, defaults.providers.hupijiao.return_url, 500),
                notify_url: sanitizeText(sourceProviders.hupijiao?.notify_url, defaults.providers.hupijiao.notify_url, 500),
                package_hint: sanitizeText(sourceProviders.hupijiao?.package_hint, defaults.providers.hupijiao.package_hint, 240),
                custom_amount_hint: sanitizeText(sourceProviders.hupijiao?.custom_amount_hint, defaults.providers.hupijiao.custom_amount_hint, 240),
                surcharge_rate: coerceSurchargeRate(sourceProviders.hupijiao?.surcharge_rate, defaults.providers.hupijiao.surcharge_rate),
                surcharge_label: sanitizeText(sourceProviders.hupijiao?.surcharge_label, defaults.providers.hupijiao.surcharge_label, 40),
                order_query_enabled: coerceBoolean(sourceProviders.hupijiao?.order_query_enabled, defaults.providers.hupijiao.order_query_enabled),
                order_query_title: sanitizeText(sourceProviders.hupijiao?.order_query_title, defaults.providers.hupijiao.order_query_title, 80),
                order_query_hint: sanitizeText(sourceProviders.hupijiao?.order_query_hint, defaults.providers.hupijiao.order_query_hint, 240),
                order_query_placeholder: sanitizeText(sourceProviders.hupijiao?.order_query_placeholder, defaults.providers.hupijiao.order_query_placeholder, 80)
            },
            zpay: {
                enabled: coerceBoolean(sourceProviders.zpay?.enabled, defaults.providers.zpay.enabled),
                display_name: sanitizeText(sourceProviders.zpay?.display_name, defaults.providers.zpay.display_name, 40),
                checkout_url: sanitizeText(sourceProviders.zpay?.checkout_url, defaults.providers.zpay.checkout_url, 500),
                pid: sanitizeText(sourceProviders.zpay?.pid, defaults.providers.zpay.pid, 120),
                payment_type: sanitizeText(sourceProviders.zpay?.payment_type, defaults.providers.zpay.payment_type, 20).toLowerCase() || defaults.providers.zpay.payment_type,
                channel_ids: sanitizeText(sourceProviders.zpay?.channel_ids, defaults.providers.zpay.channel_ids, 255),
                return_url: sanitizeText(sourceProviders.zpay?.return_url, defaults.providers.zpay.return_url, 500),
                notify_url: sanitizeText(sourceProviders.zpay?.notify_url, defaults.providers.zpay.notify_url, 500),
                package_hint: sanitizeText(sourceProviders.zpay?.package_hint, defaults.providers.zpay.package_hint, 240),
                custom_amount_hint: sanitizeText(sourceProviders.zpay?.custom_amount_hint, defaults.providers.zpay.custom_amount_hint, 240),
                surcharge_rate: coerceSurchargeRate(sourceProviders.zpay?.surcharge_rate, defaults.providers.zpay.surcharge_rate),
                surcharge_label: sanitizeText(sourceProviders.zpay?.surcharge_label, defaults.providers.zpay.surcharge_label, 40),
                order_query_enabled: coerceBoolean(sourceProviders.zpay?.order_query_enabled, defaults.providers.zpay.order_query_enabled),
                order_query_title: sanitizeText(sourceProviders.zpay?.order_query_title, defaults.providers.zpay.order_query_title, 80),
                order_query_hint: sanitizeText(sourceProviders.zpay?.order_query_hint, defaults.providers.zpay.order_query_hint, 240),
                order_query_placeholder: sanitizeText(sourceProviders.zpay?.order_query_placeholder, defaults.providers.zpay.order_query_placeholder, 80)
            },
            nowpayments: {
                enabled: coerceBoolean(sourceProviders.nowpayments?.enabled, defaults.providers.nowpayments.enabled),
                display_name: sanitizeText(sourceProviders.nowpayments?.display_name, defaults.providers.nowpayments.display_name, 40),
                api_base_url: sanitizeText(sourceProviders.nowpayments?.api_base_url, defaults.providers.nowpayments.api_base_url, 500),
                pay_currency: sanitizeText(sourceProviders.nowpayments?.pay_currency, defaults.providers.nowpayments.pay_currency, 40).toLowerCase() || defaults.providers.nowpayments.pay_currency,
                price_currency: sanitizeText(sourceProviders.nowpayments?.price_currency, defaults.providers.nowpayments.price_currency, 20).toLowerCase() || defaults.providers.nowpayments.price_currency,
                network_name: sanitizeText(sourceProviders.nowpayments?.network_name, defaults.providers.nowpayments.network_name, 80),
                cny_to_usd_rate: coercePositiveNumber(sourceProviders.nowpayments?.cny_to_usd_rate, defaults.providers.nowpayments.cny_to_usd_rate),
                pay_amount_precision: 2,
                is_fixed_rate: coerceBoolean(sourceProviders.nowpayments?.is_fixed_rate, defaults.providers.nowpayments.is_fixed_rate),
                is_fee_paid_by_user: coerceBoolean(sourceProviders.nowpayments?.is_fee_paid_by_user, defaults.providers.nowpayments.is_fee_paid_by_user),
                return_url: sanitizeText(sourceProviders.nowpayments?.return_url, defaults.providers.nowpayments.return_url, 500),
                ipn_callback_url: sanitizeText(sourceProviders.nowpayments?.ipn_callback_url, defaults.providers.nowpayments.ipn_callback_url, 500),
                success_url: sanitizeText(sourceProviders.nowpayments?.success_url, defaults.providers.nowpayments.success_url, 500),
                cancel_url: sanitizeText(sourceProviders.nowpayments?.cancel_url, defaults.providers.nowpayments.cancel_url, 500),
                package_hint: sanitizeText(sourceProviders.nowpayments?.package_hint, defaults.providers.nowpayments.package_hint, 240),
                custom_amount_hint: sanitizeText(sourceProviders.nowpayments?.custom_amount_hint, defaults.providers.nowpayments.custom_amount_hint, 240),
                surcharge_rate: coerceSurchargeRate(sourceProviders.nowpayments?.surcharge_rate, defaults.providers.nowpayments.surcharge_rate),
                surcharge_label: sanitizeText(sourceProviders.nowpayments?.surcharge_label, defaults.providers.nowpayments.surcharge_label, 40),
                order_query_enabled: coerceBoolean(sourceProviders.nowpayments?.order_query_enabled, defaults.providers.nowpayments.order_query_enabled),
                order_query_title: sanitizeText(sourceProviders.nowpayments?.order_query_title, defaults.providers.nowpayments.order_query_title, 80),
                order_query_hint: sanitizeText(sourceProviders.nowpayments?.order_query_hint, defaults.providers.nowpayments.order_query_hint, 240),
                order_query_placeholder: sanitizeText(sourceProviders.nowpayments?.order_query_placeholder, defaults.providers.nowpayments.order_query_placeholder, 80)
            }
        }
    };

    if (!config.providers[config.active_provider]?.enabled) {
        config.providers[config.active_provider].enabled = true;
    }

    return config;
}

function getMockRuntimeState(runtime = {}) {
    if (runtime && typeof runtime === 'object' && runtime.mock_payment && typeof runtime.mock_payment === 'object') {
        return runtime.mock_payment;
    }
    return runtime && typeof runtime === 'object' ? runtime : {};
}

function pickPublicProviderConfig(providerKey, provider = {}) {
    const allowedFields = PUBLIC_PROVIDER_FIELDS[providerKey] || [];
    const publicProvider = {};

    allowedFields.forEach((fieldName) => {
        if (Object.prototype.hasOwnProperty.call(provider, fieldName)) {
            publicProvider[fieldName] = provider[fieldName];
        }
    });

    return publicProvider;
}

function sanitizePublicPaymentChannels(paymentChannels = {}) {
    const providers = paymentChannels?.providers || {};
    return {
        active_provider: paymentChannels?.active_provider || 'afdian',
        providers: {
            mock: pickPublicProviderConfig('mock', providers.mock),
            afdian: pickPublicProviderConfig('afdian', providers.afdian),
            hupijiao: pickPublicProviderConfig('hupijiao', providers.hupijiao),
            zpay: pickPublicProviderConfig('zpay', providers.zpay),
            nowpayments: pickPublicProviderConfig('nowpayments', providers.nowpayments)
        }
    };
}

function buildPublicPaymentRuntime(runtime = null) {
    const mockRuntime = getMockRuntimeState(runtime);
    const allowed = mockRuntime.allowed === true;
    const reason = String(mockRuntime.reason || '').trim();

    return {
        mock_payment: {
            allowed,
            reason: reason || (allowed ? 'enabled' : 'disabled'),
            message: PUBLIC_MOCK_RUNTIME_MESSAGES[reason] || (allowed
                ? '当前环境允许使用模拟支付。'
                : '当前环境暂未开放模拟支付。')
        }
    };
}

function resolvePublicActiveProvider(paymentChannels = {}) {
    const providers = paymentChannels?.providers || {};
    return resolvePreferredEnabledProviderKey(providers, 'afdian');
}

function clonePlainObject(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function normalizeSecretStatusOption(options = {}) {
    if (!Object.prototype.hasOwnProperty.call(options, 'secretStatus')) {
        return null;
    }

    return options.secretStatus && typeof options.secretStatus === 'object'
        ? options.secretStatus
        : {};
}

function applyPublicProviderReadiness(paymentChannels = {}, secretStatus = {}, env = process.env) {
    const nextPaymentChannels = clonePlainObject(paymentChannels);
    const providers = nextPaymentChannels.providers || {};

    ['hupijiao', 'zpay', 'nowpayments'].forEach((providerKey) => {
        if (providers?.[providerKey]?.enabled !== true) {
            return;
        }

        const activationCheck = buildPaymentProviderActivationCheck(
            providerKey,
            nextPaymentChannels,
            secretStatus,
            env
        );

        if (activationCheck.ready !== true) {
            providers[providerKey].enabled = false;
        }
    });

    const activeProviderKey = String(nextPaymentChannels.active_provider || '').trim().toLowerCase();
    if (!providers?.[activeProviderKey]?.enabled) {
        nextPaymentChannels.active_provider = resolvePreferredEnabledProviderKey(providers, 'afdian');
    }

    if (!providers?.[nextPaymentChannels.active_provider]?.enabled && providers.afdian && hasCheckoutUrl(providers.afdian)) {
        providers.afdian.enabled = true;
        nextPaymentChannels.active_provider = 'afdian';
    }

    return nextPaymentChannels;
}

function buildPublicPaymentConfig(paymentChannels, rechargeOptions, runtime = null, options = {}) {
    let normalizedPaymentChannels = normalizePaymentChannelsConfig(
        paymentChannels,
        rechargeOptions,
        options
    );
    const normalizedRechargeOptions = normalizeRechargeOptionsConfig(rechargeOptions);
    const mockRuntime = getMockRuntimeState(runtime);
    const secretStatus = normalizeSecretStatusOption(options);

    if (secretStatus) {
        normalizedPaymentChannels = applyPublicProviderReadiness(
            normalizedPaymentChannels,
            secretStatus,
            options.env || process.env
        );
    }

    if (mockRuntime.allowed === true) {
        return {
            paymentChannels: sanitizePublicPaymentChannels(normalizedPaymentChannels),
            rechargeOptions: normalizedRechargeOptions
        };
    }

    const publicPaymentChannels = sanitizePublicPaymentChannels(normalizedPaymentChannels);
    const publicRechargeOptions = {
        ...normalizedRechargeOptions,
        mock_payment_enabled: false
    };

    if (publicPaymentChannels.providers?.mock) {
        publicPaymentChannels.providers.mock.enabled = false;
    }

    if (publicPaymentChannels.active_provider === 'mock') {
        publicPaymentChannels.active_provider = resolvePublicActiveProvider(publicPaymentChannels);
    }

    if (publicPaymentChannels.providers?.[publicPaymentChannels.active_provider]) {
        publicPaymentChannels.providers[publicPaymentChannels.active_provider].enabled = true;
    }

    return {
        paymentChannels: publicPaymentChannels,
        rechargeOptions: publicRechargeOptions
    };
}

async function loadStoredPaymentConfigs(supabase, options = {}) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .in('config_key', ['payment_channels', 'recharge_options']);

    if (error) {
        throw new Error(error.message || 'Failed to load payment configuration');
    }

    const configMap = {};
    (data || []).forEach((item) => {
        configMap[item.config_key] = item.config_value;
    });

    const fallbackRuntimeSite = normalizeSiteScopedSystemConfigSite(
        classifyManagedSite(options.requestHost || '')
        || classifyManagedSite(options.origin || '')
        || classifyManagedSite(options.appBaseUrl || ''),
        {
            fallback: 'cn'
        }
    );
    const inferredSite = normalizeSiteScopedSystemConfigSite(options.site || fallbackRuntimeSite, {
        allowAll: true,
        fallback: fallbackRuntimeSite
    });
    const effectiveSite = inferredSite === 'all' ? fallbackRuntimeSite : inferredSite;
    const requestOrigin = resolveSiteRequestOrigin({
        site: effectiveSite,
        requestHost: options.requestHost || '',
        appBaseUrl: options.origin || options.appBaseUrl || process.env.APP_BASE_URL
    });
    const resolvedPaymentChannels = resolveSiteScopedSystemConfigForRead(
        'payment_channels',
        configMap.payment_channels || null,
        inferredSite
    );
    const resolvedRechargeOptions = resolveSiteScopedSystemConfigForRead(
        'recharge_options',
        configMap.recharge_options || null,
        inferredSite
    );

    return {
        rawPaymentChannels: configMap.payment_channels || null,
        rawRechargeOptions: configMap.recharge_options || null,
        paymentChannels: normalizePaymentChannelsConfig(
            resolvedPaymentChannels,
            resolvedRechargeOptions,
            {
                ...options,
                origin: requestOrigin
            }
        ),
        rechargeOptions: normalizeRechargeOptionsConfig(resolvedRechargeOptions)
    };
}

function getProviderSecretNames(providerKey) {
    return PROVIDER_SECRET_NAMES[providerKey] || [];
}

function getEnvSecretValue(secretName, env = process.env) {
    const envNames = SECRET_ENV_FALLBACKS[secretName] || [];
    for (const envName of envNames) {
        const value = String(env?.[envName] || '').trim();
        if (value) return value;
    }
    return '';
}

async function resolvePaymentProviderSecrets(supabase, providerKey, env = process.env, options = {}) {
    const secretNames = getProviderSecretNames(providerKey);
    const result = {};
    const requestedSite = normalizePaymentSecretSite(options.site, { allowEmpty: true });

    for (const secretName of secretNames) {
        const storedSecret = await resolveStoredPaymentSecret(supabase, secretName, {
            site: requestedSite
        }).catch(() => null);
        const envValue = getEnvSecretValue(secretName, env);
        const storedValue = String(storedSecret?.value || '').trim();
        const value = storedValue || envValue;

        result[secretName] = {
            value,
            source: storedValue
                ? (storedSecret?.scope === 'site' ? 'stored_site' : 'stored')
                : (envValue ? 'environment' : 'missing'),
            updatedAt: storedSecret?.updated_at || null,
            site: storedSecret?.site || null,
            scope: storedSecret?.scope || null,
            secretKey: storedSecret?.secret_key || null
        };
    }

    return result;
}

async function buildPaymentSecretStatus(supabase, env = process.env, options = {}) {
    const requestedSite = normalizePaymentSecretSite(options.site, { allowEmpty: true });
    const entries = await Promise.all(
        Object.keys(PAYMENT_CHANNEL_SECRET_KEYS).map(async (secretName) => {
            const storedSecret = await resolveStoredPaymentSecret(supabase, secretName, {
                site: requestedSite
            }).catch(() => null);
            const envValue = getEnvSecretValue(secretName, env);
            const storedValue = String(storedSecret?.value || '').trim();

            return [
                secretName,
                {
                    configured: Boolean(storedValue || envValue),
                    source: storedValue
                        ? (storedSecret?.scope === 'site' ? 'stored_site' : 'stored')
                        : (envValue ? 'environment' : 'missing'),
                    updatedAt: storedSecret?.updated_at || null,
                    site: storedSecret?.site || null,
                    scope: storedSecret?.scope || null,
                    secretKey: storedSecret?.secret_key || PAYMENT_CHANNEL_SECRET_KEYS[secretName]
                }
            ];
        })
    );

    return Object.fromEntries(entries);
}

module.exports = {
    buildPaymentProviderActivationCheck,
    buildPublicPaymentConfig,
    buildPublicPaymentRuntime,
    DEFAULT_AFDIAN_CHECKOUT_URL,
    DEFAULT_SITE_ORIGIN,
    PROVIDER_KEYS,
    applyPublicProviderReadiness,
    buildPaymentSecretStatus,
    getDefaultPaymentChannelsConfig,
    getProviderSecretNames,
    getEnvSecretValue,
    loadStoredPaymentConfigs,
    normalizePaymentChannelsConfig,
    normalizeRechargeOptionsConfig,
    resolvePaymentProviderSecrets,
    sanitizeText,
    sanitizeOrigin
};
