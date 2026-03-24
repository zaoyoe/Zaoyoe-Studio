const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    deleteStoredAdminSecret,
    OPS_ALERT_SECRET_KEYS: CONFIGURED_OPS_ALERT_SECRET_KEYS,
    upsertStoredAdminSecret
} = require('../../../../api/_lib/secrets');
const {
    buildOpsAlertSecretStatus,
    loadOpsAlertsRuntimeConfig,
    normalizeOpsAlertsConfig,
    OPS_ALERTS_CONFIG_KEY
} = require('../../../../api/_lib/ops-alerts');

const DEFAULT_OPS_ALERT_SECRET_KEYS = Object.freeze({
    telegram_bot_token: 'ops_alert_telegram_bot_token',
    feishu_webhook_url: 'ops_alert_feishu_webhook_url'
});

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function getOpsAlertSecretKeys() {
    const secretKeys = CONFIGURED_OPS_ALERT_SECRET_KEYS;
    if (secretKeys && typeof secretKeys === 'object' && !Array.isArray(secretKeys)) {
        return secretKeys;
    }

    return DEFAULT_OPS_ALERT_SECRET_KEYS;
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
        const { supabase, user } = await requireAdmin(req);

        if (req.method === 'GET') {
            const runtime = await loadOpsAlertsRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                config: runtime.config,
                secrets: buildOpsAlertSecretStatus(runtime)
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const nextConfig = normalizeOpsAlertsConfig(body.config);
            const incomingSecrets = body.secrets && typeof body.secrets === 'object' ? body.secrets : {};
            const updatedSecrets = [];
            const secretKeys = getOpsAlertSecretKeys();

            await upsertSystemConfig(
                supabase,
                OPS_ALERTS_CONFIG_KEY,
                nextConfig,
                user.id,
                '站外运维告警配置'
            );

            for (const [secretName, secretKey] of Object.entries(secretKeys)) {
                const secretValue = sanitizeText(incomingSecrets[secretName], 4000);
                if (!secretValue) continue;

                await upsertStoredAdminSecret({
                    supabase,
                    secretKey,
                    secretValue,
                    adminId: user.id,
                    description: `Ops alert secret: ${secretName}`,
                    metadata: {
                        service: 'ops_alerts',
                        key_name: secretName,
                        saved_via: 'admin_ops_alerts'
                    }
                });

                updatedSecrets.push(secretName);
            }

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.ops_alerts.upsert',
                details: {
                    enabled: nextConfig.enabled,
                    telegram_enabled: nextConfig.channels?.telegram?.enabled === true,
                    feishu_enabled: nextConfig.channels?.feishu?.enabled === true,
                    updated_secrets: updatedSecrets
                }
            });

            const runtime = await loadOpsAlertsRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                message: '站外运维告警配置已保存。',
                config: runtime.config,
                secrets: buildOpsAlertSecretStatus(runtime)
            });
        }

        if (req.method === 'DELETE') {
            const body = await parseJsonBody(req);
            const secretName = sanitizeText(body.secretName, 100);
            const secretKey = getOpsAlertSecretKeys()[secretName];

            if (!secretKey) {
                return sendJson(res, 400, {
                    success: false,
                    message: '无效的站外告警密钥标识'
                });
            }

            await deleteStoredAdminSecret(supabase, secretKey);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.ops_alerts.secret.delete',
                details: {
                    secret_name: secretName
                }
            });

            const runtime = await loadOpsAlertsRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                message: '站外告警密钥已删除。',
                config: runtime.config,
                secrets: buildOpsAlertSecretStatus(runtime)
            });
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ops alert settings failed'
        });
    }
};
