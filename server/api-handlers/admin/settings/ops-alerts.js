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
    OPS_ALERTS_CONFIG_KEY,
    sendFeishuAlert,
    sendTelegramAlert
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

function mergeRuntimeSecrets(baseSecrets = {}, incomingSecrets = {}) {
    const nextSecrets = {
        telegram_bot_token: sanitizeText(baseSecrets.telegram_bot_token, 4000),
        feishu_webhook_url: sanitizeText(baseSecrets.feishu_webhook_url, 4000)
    };

    for (const [secretName] of Object.entries(getOpsAlertSecretKeys())) {
        const incomingValue = sanitizeText(incomingSecrets?.[secretName], 4000);
        if (incomingValue) {
            nextSecrets[secretName] = incomingValue;
        }
    }

    return nextSecrets;
}

function extractTelegramFailureMessage(result = {}) {
    if (sanitizeText(result.error)) {
        return sanitizeText(result.error);
    }

    const body = sanitizeText(result.body, 2000);
    if (!body) {
        return `HTTP ${Number(result.status || 0) || 0}`;
    }

    try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed)) {
            const firstFailed = parsed.find((item) => item && item.ok === false) || parsed[0];
            const message = sanitizeText(firstFailed?.error, 500)
                || sanitizeText(firstFailed?.body, 500)
                || sanitizeText(firstFailed?.description, 500);
            if (message) return message;
        } else if (parsed && typeof parsed === 'object') {
            const message = sanitizeText(parsed.description, 500)
                || sanitizeText(parsed.error, 500)
                || sanitizeText(parsed.message, 500);
            if (message) return message;
        }
    } catch (error) {
        return body.slice(0, 500);
    }

    return body.slice(0, 500);
}

function getConfiguredPreviewChannels(runtime) {
    const channels = [];
    if (runtime?.config?.channels?.telegram?.enabled === true) {
        channels.push('telegram');
    }
    if (runtime?.config?.channels?.feishu?.enabled === true) {
        channels.push('feishu');
    }
    return channels;
}

function validatePreviewRuntime(runtime, channels) {
    if (!channels.length) {
        return '请先启用至少一个站外告警通道';
    }

    if (channels.includes('telegram')) {
        const chatIds = Array.isArray(runtime?.config?.channels?.telegram?.chat_ids)
            ? runtime.config.channels.telegram.chat_ids
            : [];
        if (!sanitizeText(runtime?.secrets?.telegram_bot_token)) {
            return '已启用 Telegram 告警，但 Telegram Bot Token 未配置';
        }
        if (!chatIds.length) {
            return '已启用 Telegram 告警，但 Telegram Chat ID 未填写';
        }
    }

    if (channels.includes('feishu') && !sanitizeText(runtime?.secrets?.feishu_webhook_url)) {
        return '已启用飞书告警，但飞书 Webhook 未配置';
    }

    return '';
}

function extractDeliveryFailureMessage(channel, result = {}) {
    const message = extractTelegramFailureMessage(result);
    return `${channel}：${message}`;
}

function formatPreviewChannelLabels(channels = []) {
    const labels = channels.map((channel) => {
        if (channel === 'telegram') return 'Telegram';
        if (channel === 'feishu') return '飞书';
        return sanitizeText(channel) || channel;
    }).filter(Boolean);

    return labels.join('、');
}

async function sendOpsAlertPreview(job, runtime) {
    const channels = getConfiguredPreviewChannels(runtime);
    const validationError = validatePreviewRuntime(runtime, channels);
    if (validationError) {
        return {
            ok: false,
            channels,
            message: validationError
        };
    }

    const deliveries = [];
    for (const channel of channels) {
        let result;
        if (channel === 'telegram') {
            result = await sendTelegramAlert(job, runtime);
        } else if (channel === 'feishu') {
            result = await sendFeishuAlert(job, runtime);
        } else {
            result = {
                ok: false,
                status: 0,
                error: 'unsupported_channel'
            };
        }

        deliveries.push({
            channel,
            ...result
        });
    }

    const failed = deliveries.filter((item) => item.ok !== true);
    return {
        ok: failed.length === 0,
        channels,
        deliveries,
        message: failed.length
            ? failed.map((item) => extractDeliveryFailureMessage(item.channel, item)).join(' | ')
            : ''
    };
}

function buildTelegramTestJob(user, runtime) {
    const chatCount = Array.isArray(runtime?.config?.channels?.telegram?.chat_ids)
        ? runtime.config.channels.telegram.chat_ids.length
        : 0;

    return {
        alert_type: 'ops_alert_test',
        severity: 'warning',
        title: '站外退款告警 Telegram 自检',
        content: [
            '这是一条 Telegram 通道自检消息。',
            `触发管理员：${sanitizeText(user?.email || user?.id) || 'unknown'}`,
            `目标 chat 数量：${chatCount}`,
            `发送时间：${new Date().toISOString()}`,
            '说明：该消息不会写入退款异常队列，也不会受 45 分钟去重限制。'
        ].join('\n')
    };
}

function buildTelegramRefundSampleJob(user) {
    const nowIso = new Date().toISOString();

    return {
        alert_type: 'payment_refund_ops',
        severity: 'critical',
        title: '支付退款积分回滚失败',
        payload: {
            topic_label: '回滚失败',
            processing_result: 'admin_refund_compensation_failed',
            site: 'cn',
            provider: 'hupijiao',
            provider_order_no: 'DEMO_HJ_ORDER_20260325',
            target_id: 'order-demo-refund-telegram',
            user_id: 'demo_buyer_001',
            order_status: 'redeemed',
            refund_status: 'paid',
            expected_amount: 29.9,
            paid_amount: 29.9,
            points_amount: 1200,
            credited: true,
            refund_reclaimed_points: 1200,
            refund_reclaimed_paid_points: 1000,
            refund_reclaimed_bonus_points: 200,
            compensation_restored_paid_points: 1000,
            compensation_restored_bonus_points: 200,
            gateway_open_order_id: 'HJ-GATEWAY-DEMO-20260325',
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了退款详情示例发送`,
            last_error: '示例：网关退款失败后，积分回滚链路未完成，需要人工复核。',
            response_status: 500,
            detail: '这是一条退款详情示例消息，用于验证 Telegram 是否能完整展示订单号、付款者、金额与积分明细。',
            claimed_at: nowIso,
            paid_at: nowIso,
            entry_path: '支付对账 -> 异常运维 -> 回滚失败（示例）'
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
            if (sanitizeText(body.action) === 'send_test_telegram' || sanitizeText(body.action) === 'send_sample_refund_telegram') {
                const storedRuntime = await loadOpsAlertsRuntimeConfig(supabase);
                const runtime = {
                    config: normalizeOpsAlertsConfig(body.config),
                    secrets: mergeRuntimeSecrets(storedRuntime?.secrets, body.secrets)
                };

                const normalizedAction = sanitizeText(body.action);
                const job = normalizedAction === 'send_sample_refund_telegram'
                    ? buildTelegramRefundSampleJob(user)
                    : buildTelegramTestJob(user, runtime);
                const result = await sendOpsAlertPreview(job, runtime);

                await writeAdminAuditLog({
                    supabase,
                    adminId: user.id,
                    actionType: normalizedAction === 'send_sample_refund_telegram'
                        ? 'admin.ops_alerts.telegram_refund_sample'
                        : 'admin.ops_alerts.telegram_test',
                    details: {
                        ok: result?.ok === true,
                        channels: result?.channels || [],
                        delivery_count: Array.isArray(result?.deliveries) ? result.deliveries.length : 0
                    }
                });

                if (!result?.ok) {
                    return sendJson(res, 502, {
                        success: false,
                        message: `站外测试消息发送失败：${result.message || '未知错误'}`
                    });
                }

                const channelLabels = formatPreviewChannelLabels(result.channels);
                return sendJson(res, 200, {
                    success: true,
                    message: normalizedAction === 'send_sample_refund_telegram'
                        ? `退款详情示例消息已发送到 ${channelLabels || '已启用通道'}`
                        : `测试站外告警已发送到 ${channelLabels || '已启用通道'}`
                });
            }

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
