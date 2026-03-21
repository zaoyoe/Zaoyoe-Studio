const {
    PAYMENT_CHANNEL_SECRET_KEYS,
    getStoredAdminSecret
} = require('../secrets');

const PROVIDER_KEYS = Object.freeze(['mock', 'afdian', 'hupijiao']);
const DEFAULT_SITE_ORIGIN = 'https://www.zaoyoe.com';
const DEFAULT_AFDIAN_CHECKOUT_URL = 'https://afdian.com/a/zaoyoe';

const PROVIDER_SECRET_NAMES = Object.freeze({
    mock: [],
    afdian: ['afdian_token'],
    hupijiao: ['hupijiao_api_key', 'hupijiao_secret_key']
});

const SECRET_ENV_FALLBACKS = Object.freeze({
    afdian_token: ['AFDIAN_TOKEN'],
    hupijiao_api_key: ['HUPIJIAO_API_KEY'],
    hupijiao_secret_key: ['HUPIJIAO_SECRET_KEY']
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

function coerceBoolean(value, fallback = false) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return fallback;
}

function normalizeRechargeOptionsConfig(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        custom_amount_enabled: source.custom_amount_enabled === true
            || String(source.custom_amount_enabled) === 'true',
        mock_payment_enabled: source.mock_payment_enabled === true
            || String(source.mock_payment_enabled) === 'true'
    };
}

function getDefaultPaymentChannelsConfig(options = {}) {
    const origin = sanitizeOrigin(options.origin || process.env.APP_BASE_URL || DEFAULT_SITE_ORIGIN);
    const afdianCheckoutUrl = sanitizeText(
        options.afdianCheckoutUrl || process.env.PAYMENT_AFDIAN_URL || DEFAULT_AFDIAN_CHECKOUT_URL,
        DEFAULT_AFDIAN_CHECKOUT_URL,
        500
    );

    return {
        active_provider: 'afdian',
        providers: {
            mock: {
                enabled: true,
                display_name: '模拟支付',
                description: '仅建议在正式支付接入前短期使用，开启后将直接到账积分。'
            },
            afdian: {
                enabled: true,
                display_name: '爱发电',
                checkout_url: afdianCheckoutUrl,
                package_hint: '请在爱发电完成支付后，返回钱包输入订单号领取兑换码。',
                custom_amount_hint: '建议在支付备注里填写要充值的积分数量，支付后返回钱包输入订单号领取兑换码。'
            },
            hupijiao: {
                enabled: false,
                display_name: '虎皮椒',
                checkout_url: '',
                gateway_url: '',
                merchant_id: '',
                return_url: origin,
                notify_url: '',
                package_hint: '虎皮椒通道已启用，正式回调与自动发货接入后即可完整使用。',
                custom_amount_hint: '虎皮椒通道已启用。自定义金额下单能力接入后，这里会直接拉起真实支付。'
            }
        }
    };
}

function normalizePaymentChannelsConfig(raw, legacyRechargeOptions = null, options = {}) {
    const defaults = getDefaultPaymentChannelsConfig(options);
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceProviders = source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)
        ? source.providers
        : {};
    const normalizedRechargeOptions = normalizeRechargeOptionsConfig(legacyRechargeOptions);
    const fallbackActiveProvider = normalizedRechargeOptions.mock_payment_enabled ? 'mock' : defaults.active_provider;

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
                custom_amount_hint: sanitizeText(sourceProviders.afdian?.custom_amount_hint, defaults.providers.afdian.custom_amount_hint, 240)
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
                custom_amount_hint: sanitizeText(sourceProviders.hupijiao?.custom_amount_hint, defaults.providers.hupijiao.custom_amount_hint, 240)
            }
        }
    };

    if (!config.providers[config.active_provider]?.enabled) {
        config.providers[config.active_provider].enabled = true;
    }

    return config;
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

    return {
        rawPaymentChannels: configMap.payment_channels || null,
        rawRechargeOptions: configMap.recharge_options || null,
        paymentChannels: normalizePaymentChannelsConfig(
            configMap.payment_channels,
            configMap.recharge_options,
            options
        ),
        rechargeOptions: normalizeRechargeOptionsConfig(configMap.recharge_options)
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

async function resolvePaymentProviderSecrets(supabase, providerKey, env = process.env) {
    const secretNames = getProviderSecretNames(providerKey);
    const result = {};

    for (const secretName of secretNames) {
        const secretKey = PAYMENT_CHANNEL_SECRET_KEYS[secretName];
        const storedSecret = secretKey ? await getStoredAdminSecret(supabase, secretKey).catch(() => null) : null;
        const envValue = getEnvSecretValue(secretName, env);
        const storedValue = String(storedSecret?.value || '').trim();
        const value = storedValue || envValue;

        result[secretName] = {
            value,
            source: storedValue ? 'stored' : (envValue ? 'environment' : 'missing'),
            updatedAt: storedSecret?.updated_at || null
        };
    }

    return result;
}

async function buildPaymentSecretStatus(supabase, env = process.env) {
    const entries = await Promise.all(
        Object.keys(PAYMENT_CHANNEL_SECRET_KEYS).map(async (secretName) => {
            const secretKey = PAYMENT_CHANNEL_SECRET_KEYS[secretName];
            const storedSecret = await getStoredAdminSecret(supabase, secretKey).catch(() => null);
            const envValue = getEnvSecretValue(secretName, env);
            const storedValue = String(storedSecret?.value || '').trim();

            return [
                secretName,
                {
                    configured: Boolean(storedValue || envValue),
                    source: storedValue ? 'stored' : (envValue ? 'environment' : 'missing'),
                    updatedAt: storedSecret?.updated_at || null
                }
            ];
        })
    );

    return Object.fromEntries(entries);
}

module.exports = {
    DEFAULT_AFDIAN_CHECKOUT_URL,
    DEFAULT_SITE_ORIGIN,
    PROVIDER_KEYS,
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
