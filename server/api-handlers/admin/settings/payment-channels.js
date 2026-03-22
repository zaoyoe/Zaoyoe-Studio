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
    buildPaymentSecretStatus,
    loadStoredPaymentConfigs,
    normalizePaymentChannelsConfig,
    sanitizeText
} = require('../../../../api/_lib/payments/providers');
const {
    getMockPaymentRuntimeState
} = require('../../../../api/_lib/payments/orders');

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

        const { supabase, user } = await requireAdmin(req);

        if (req.method === 'GET') {
            const { paymentChannels } = await loadStoredPaymentConfigs(supabase);
            const secrets = await buildPaymentSecretStatus(supabase);

            return sendJson(res, 200, {
                success: true,
                config: paymentChannels,
                secrets,
                runtime
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { rechargeOptions } = await loadStoredPaymentConfigs(supabase);
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

            const secrets = await buildPaymentSecretStatus(supabase);
            return sendJson(res, 200, {
                success: true,
                message: '支付通道配置已保存。',
                config: nextConfig,
                secrets,
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
