const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    PAYMENT_CHANNEL_SECRET_KEYS,
    deleteStoredAdminSecret,
    upsertStoredAdminSecret
} = require('../../../../api/_lib/secrets');
const {
    buildPaymentProviderActivationCheck,
    buildPaymentSecretStatus,
    loadStoredPaymentConfigs,
    normalizePaymentChannelsConfig,
    sanitizeText
} = require('../../../../api/_lib/payments/providers');
const {
    getMockPaymentRuntimeState
} = require('../../../../api/_lib/payments/orders');
const PAYMENT_SECRET_PROVIDER_MAP = Object.freeze({
    afdian_token: 'afdian',
    hupijiao_api_key: 'hupijiao',
    hupijiao_secret_key: 'hupijiao',
    zpay_pkey: 'zpay'
});

function buildPaymentChannelActivationChecks(config = {}, secretStatus = {}, env = process.env) {
    return {
        mock: buildPaymentProviderActivationCheck('mock', config, secretStatus, env),
        afdian: buildPaymentProviderActivationCheck('afdian', config, secretStatus, env),
        zpay: buildPaymentProviderActivationCheck('zpay', config, secretStatus, env),
        hupijiao: buildPaymentProviderActivationCheck('hupijiao', config, secretStatus, env)
    };
}

function buildPaymentChannelActivationGuidance(activationCheck = {}) {
    const issues = Array.isArray(activationCheck?.issues) ? activationCheck.issues : [];
    const warnings = Array.isArray(activationCheck?.warnings) ? activationCheck.warnings : [];
    const messages = [...issues, ...warnings];

    if (messages.includes('生产环境未配置 ZPAY_WEBHOOK_ALLOWED_IPS，将启用严格查单模式')) {
        return '当前未配置 ZPAY_WEBHOOK_ALLOWED_IPS，系统会退回严格查单模式：必须命中本地待支付订单并主动查单成功后才会入账；建议向 ZPAY 索取回调 IP 后再补上部署环境变量。';
    }

    if (messages.includes('生产环境缺少 HUPIJIAO_WEBHOOK_ALLOWED_IPS')) {
        return '请到部署平台的环境变量中配置 HUPIJIAO_WEBHOOK_ALLOWED_IPS，这不是后台表单字段；保存后需要重新部署服务端。';
    }

    return '';
}

function mergePaymentSecretStatus(currentStatus = {}, incomingSecrets = {}) {
    const mergedStatus = { ...currentStatus };

    Object.keys(PAYMENT_CHANNEL_SECRET_KEYS).forEach((secretName) => {
        const nextValue = sanitizeText(incomingSecrets[secretName], '', 1000);
        if (!nextValue) return;

        mergedStatus[secretName] = {
            ...(currentStatus[secretName] || {}),
            configured: true,
            source: 'request'
        };
    });

    return mergedStatus;
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

module.exports = async (req, res) => {
    try {
        const runtime = {
            mock_payment: getMockPaymentRuntimeState({
                requestHost: req.headers.host || req.headers.Host || '',
                env: process.env
            })
        };

        const { supabase, user } = await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method === 'GET') {
            const { paymentChannels } = await loadStoredPaymentConfigs(supabase);
            const secrets = await buildPaymentSecretStatus(supabase);
            const activationChecks = buildPaymentChannelActivationChecks(paymentChannels, secrets, process.env);

            return sendJson(res, 200, {
                success: true,
                config: paymentChannels,
                secrets,
                activation_checks: activationChecks,
                runtime
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { rechargeOptions } = await loadStoredPaymentConfigs(supabase);
            const nextConfig = normalizePaymentChannelsConfig(body.config, rechargeOptions);
            const incomingSecrets = body.secrets && typeof body.secrets === 'object' ? body.secrets : {};
            const currentSecretStatus = await buildPaymentSecretStatus(supabase);
            const mergedSecretStatus = mergePaymentSecretStatus(currentSecretStatus, incomingSecrets);
            const updatedSecrets = [];
            const activationCheck = buildPaymentProviderActivationCheck(
                nextConfig.active_provider,
                nextConfig,
                mergedSecretStatus,
                process.env
            );
            const activationChecks = buildPaymentChannelActivationChecks(nextConfig, mergedSecretStatus, process.env);

            if (!activationCheck.ready) {
                return sendJson(res, 400, {
                    success: false,
                    message: `不能将${activationCheck.label}设为主通道：${activationCheck.issues.join('；')}`,
                    issues: activationCheck.issues,
                    guidance: buildPaymentChannelActivationGuidance(activationCheck),
                    activation_checks: activationChecks
                });
            }

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
                        provider: PAYMENT_SECRET_PROVIDER_MAP[secretName] || 'unknown',
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
                    updated_secrets: updatedSecrets,
                    activation_issues: activationCheck.issues,
                    activation_warnings: activationCheck.warnings || []
                }
            });

            const secrets = await buildPaymentSecretStatus(supabase);
            const savedActivationChecks = buildPaymentChannelActivationChecks(nextConfig, secrets, process.env);
            const savedActivationCheck = savedActivationChecks[nextConfig.active_provider] || activationCheck;
            const successGuidance = buildPaymentChannelActivationGuidance(savedActivationCheck);
            return sendJson(res, 200, {
                success: true,
                message: successGuidance
                    ? `支付通道配置已保存。${successGuidance}`
                    : '支付通道配置已保存。',
                config: nextConfig,
                secrets,
                activation_checks: savedActivationChecks,
                runtime
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

            const secrets = await buildPaymentSecretStatus(supabase);
            return sendJson(res, 200, {
                success: true,
                message: '支付密钥已删除。',
                secrets,
                runtime
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
