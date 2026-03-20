const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../_lib/admin');
const {
    PAYMENT_CHANNEL_SECRET_KEYS,
    deleteStoredAdminSecret,
    getStoredAdminSecret,
    upsertStoredAdminSecret
} = require('../../_lib/secrets');

const PROVIDER_KEYS = ['mock', 'afdian', 'hupijiao'];

function getDefaultPaymentChannelsConfig() {
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
                checkout_url: 'https://afdian.com/a/zaoyoe',
                package_hint: '请在爱发电完成支付后，返回钱包输入订单号领取兑换码。',
                custom_amount_hint: '建议在支付备注里填写要充值的积分数量，支付后返回钱包输入订单号领取兑换码。'
            },
            hupijiao: {
                enabled: false,
                display_name: '虎皮椒',
                checkout_url: '',
                gateway_url: '',
                merchant_id: '',
                return_url: 'https://www.zaoyoe.com',
                notify_url: '',
                package_hint: '虎皮椒通道已启用，正式回调与自动发货接入后即可完整使用。',
                custom_amount_hint: '虎皮椒通道已启用。自定义金额下单能力接入后，这里会直接拉起真实支付。'
            }
        }
    };
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

function normalizePaymentChannelsConfig(raw, legacyRechargeOptions = null) {
    const defaults = getDefaultPaymentChannelsConfig();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sourceProviders = source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)
        ? source.providers
        : {};
    const legacyMockEnabled = legacyRechargeOptions?.mock_payment_enabled === true
        || String(legacyRechargeOptions?.mock_payment_enabled) === 'true';
    const fallbackActiveProvider = legacyMockEnabled ? 'mock' : defaults.active_provider;

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

async function loadStoredConfigs(supabase) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_key, config_value')
        .in('config_key', ['payment_channels', 'recharge_options']);

    if (error) {
        throw new Error(error.message || 'Failed to load payment channel config');
    }

    const configMap = {};
    (data || []).forEach((item) => {
        configMap[item.config_key] = item.config_value;
    });

    return {
        rawPaymentChannels: configMap.payment_channels || null,
        rawRechargeOptions: configMap.recharge_options || null,
        paymentChannels: normalizePaymentChannelsConfig(configMap.payment_channels, configMap.recharge_options),
        rechargeOptions: configMap.recharge_options && typeof configMap.recharge_options === 'object'
            ? {
                custom_amount_enabled: configMap.recharge_options.custom_amount_enabled === true
                    || String(configMap.recharge_options.custom_amount_enabled) === 'true',
                mock_payment_enabled: configMap.recharge_options.mock_payment_enabled === true
                    || String(configMap.recharge_options.mock_payment_enabled) === 'true'
            }
            : {
                custom_amount_enabled: false,
                mock_payment_enabled: false
            }
    };
}

async function upsertSystemConfig(supabase, configKey, configValue, userId, description) {
    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: configKey,
            config_value: configValue,
            description,
            updated_by: userId,
            updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });

    if (error) {
        throw new Error(error.message || `Failed to save ${configKey}`);
    }
}

async function buildSecretStatus(supabase) {
    const statusEntries = await Promise.all(
        Object.entries(PAYMENT_CHANNEL_SECRET_KEYS).map(async ([secretName, secretKey]) => {
            const storedSecret = await getStoredAdminSecret(supabase, secretKey);
            return [
                secretName,
                {
                    configured: Boolean(storedSecret?.value),
                    source: storedSecret?.value ? 'stored' : 'missing',
                    updatedAt: storedSecret?.updated_at || null
                }
            ];
        })
    );

    return Object.fromEntries(statusEntries);
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req);

        if (req.method === 'GET') {
            const { paymentChannels } = await loadStoredConfigs(supabase);
            const secrets = await buildSecretStatus(supabase);

            return sendJson(res, 200, {
                success: true,
                config: paymentChannels,
                secrets
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { rechargeOptions } = await loadStoredConfigs(supabase);
            const nextConfig = normalizePaymentChannelsConfig(body.config, rechargeOptions);
            const incomingSecrets = body.secrets && typeof body.secrets === 'object' ? body.secrets : {};
            const updatedSecrets = [];

            await upsertSystemConfig(
                supabase,
                'payment_channels',
                nextConfig,
                user.id,
                '支付通道配置'
            );

            await upsertSystemConfig(
                supabase,
                'recharge_options',
                {
                    ...rechargeOptions,
                    mock_payment_enabled: nextConfig.active_provider === 'mock'
                },
                user.id,
                '充值入口配置'
            );

            for (const [secretName, secretKey] of Object.entries(PAYMENT_CHANNEL_SECRET_KEYS)) {
                const secretValue = sanitizeText(incomingSecrets[secretName], '', 1000);
                if (!secretValue) continue;

                await upsertStoredAdminSecret({
                    supabase,
                    secretKey,
                    secretValue,
                    adminId: user.id,
                    description: `Payment provider secret: ${secretName}`,
                    metadata: {
                        provider: secretName.startsWith('afdian') ? 'afdian' : 'hupijiao',
                        key_name: secretName,
                        saved_via: 'admin_payment_channels'
                    }
                });

                updatedSecrets.push(secretName);
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.payment_channels.upsert',
                details: {
                    active_provider: nextConfig.active_provider,
                    updated_providers: Object.keys(nextConfig.providers).filter((providerKey) => nextConfig.providers[providerKey]?.enabled),
                    updated_secrets: updatedSecrets
                }
            });

            const secrets = await buildSecretStatus(supabase);
            return sendJson(res, 200, {
                success: true,
                message: '支付通道配置已保存。',
                config: nextConfig,
                secrets
            });
        }

        if (req.method === 'DELETE') {
            const body = await parseJsonBody(req);
            const secretName = typeof body.secretName === 'string' ? body.secretName.trim() : '';
            const secretKey = PAYMENT_CHANNEL_SECRET_KEYS[secretName];

            if (!secretKey) {
                return sendJson(res, 400, {
                    success: false,
                    message: '无效的支付密钥标识'
                });
            }

            await deleteStoredAdminSecret(supabase, secretKey);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.payment_channels.secret.delete',
                details: {
                    secret_name: secretName
                }
            });

            const secrets = await buildSecretStatus(supabase);
            return sendJson(res, 200, {
                success: true,
                message: '支付密钥已删除。',
                secrets
            });
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Payment channel settings failed'
        });
    }
};
