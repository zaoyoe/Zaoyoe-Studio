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
    sendEmailAlert,
    OPS_ALERTS_CONFIG_KEY,
    sendFeishuAlert,
    sendTelegramAlert
} = require('../../../../api/_lib/ops-alerts');

const DEFAULT_OPS_ALERT_SECRET_KEYS = Object.freeze({
    telegram_bot_token: 'ops_alert_telegram_bot_token',
    feishu_webhook_url: 'ops_alert_feishu_webhook_url',
    email_api_key: 'ops_alert_email_api_key'
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
        feishu_webhook_url: sanitizeText(baseSecrets.feishu_webhook_url, 4000),
        email_api_key: sanitizeText(baseSecrets.email_api_key, 4000)
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
    if (runtime?.config?.channels?.email?.enabled === true) {
        channels.push('email');
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

    if (channels.includes('email')) {
        const recipients = Array.isArray(runtime?.config?.channels?.email?.recipients)
            ? runtime.config.channels.email.recipients
            : [];
        if (!sanitizeText(runtime?.secrets?.email_api_key)) {
            return '已启用邮件告警，但 Email API Key 未配置';
        }
        if (!recipients.length) {
            return '已启用邮件告警，但收件人未填写';
        }
        if (!sanitizeText(runtime?.config?.channels?.email?.from_address)) {
            return '已启用邮件告警，但发件地址未填写';
        }
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
        if (channel === 'email') return '邮件';
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
        } else if (channel === 'email') {
            result = await sendEmailAlert(job, runtime);
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
    const channels = getConfiguredPreviewChannels(runtime);

    return {
        alert_type: 'ops_alert_test',
        severity: 'warning',
        title: '站外告警通道自检',
        content: [
            '这是一条站外告警通道自检消息。',
            `触发管理员：${sanitizeText(user?.email || user?.id) || 'unknown'}`,
            `已启用通道：${formatPreviewChannelLabels(channels) || '未启用'}`,
            `Telegram 目标 chat 数量：${chatCount}`,
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

function buildCustomerChatMessageSampleJob(user) {
    const nowIso = new Date().toISOString();

    return {
        alert_type: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（阿木）',
        payload: {
            target_id: 'chat-message-demo-001',
            message_id: 'chat-message-demo-001',
            user_id: 'user_demo_chat_001',
            session_id: 'guest.demo@example.com',
            sender_label: '阿木',
            sender_email: 'guest.demo@example.com',
            message_type: 'text',
            message_type_label: '文本消息',
            content: '你好，我刚刚充值成功了，想确认一下积分多久到账？',
            content_preview: '你好，我刚刚充值成功了，想确认一下积分多久到账？',
            created_at: nowIso,
            entry_path: '客服消息 -> 会话详情',
            detail: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了客服消息示例发送`
        }
    };
}

function buildShopPurchaseSuccessSampleJob(user) {
    const nowIso = new Date().toISOString();

    return {
        alert_type: 'shop_purchase_succeeded',
        severity: 'warning',
        title: '商城购买成功（Prompt Pro 年卡）',
        payload: {
            target_id: 'shop-order-demo-001',
            order_id: 'shop-order-demo-001',
            user_id: 'user_demo_buyer_001',
            buyer_label: '小羽',
            site: 'cn',
            product_name: 'Prompt Pro 年卡',
            item_count: 1,
            total_price: 59.8,
            price_paid: 59.8,
            delivery_status: 'pending',
            delivery_status_label: '待发货',
            refund_status: 'none',
            refund_status_label: '正常',
            created_at: nowIso,
            entry_path: '商城管理 -> 订单列表',
            detail: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了商城购买成功示例发送`
        }
    };
}

function buildWalletRechargeSuccessSampleJob(user) {
    const nowIso = new Date().toISOString();

    return {
        alert_type: 'wallet_recharge_succeeded',
        severity: 'warning',
        title: '充值成功（50元充值）',
        payload: {
            target_id: 'payment-order-demo-001',
            payment_order_id: 'payment-order-demo-001',
            provider_order_no: 'HPJ-DEMO-20260326',
            user_id: 'user_demo_buyer_001',
            buyer_label: '小羽',
            site: 'cn',
            provider: 'hupijiao',
            package_name: '50元充值',
            expected_amount: 50,
            paid_amount: 50,
            points_amount: 500,
            status: 'redeemed',
            paid_at: nowIso,
            claimed_at: nowIso,
            created_at: nowIso,
            entry_path: '支付对账 -> 最近订单',
            detail: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了充值成功示例发送`
        }
    };
}

function buildGatewayDegradedSampleJob(user) {
    return {
        alert_type: 'payment_gateway_degraded',
        severity: 'critical',
        title: '虎皮椒 支付通道异常波动（CN）',
        payload: {
            provider: 'hupijiao',
            site: 'cn',
            monitor_window_minutes: 30,
            degraded_reasons: [
                '支付成功率仅 33.33%（2/6）',
                '回调成功率仅 40.00%（失败 3，5xx 3）',
                '查码 5xx 已累计 3 次'
            ],
            total_orders: 6,
            paid_orders: 2,
            review_orders: 3,
            failed_orders: 1,
            paid_rate: 33.33,
            review_ratio: 50,
            failed_ratio: 16.67,
            webhook_total: 5,
            webhook_success: 2,
            webhook_failed: 3,
            webhook_4xx: 0,
            webhook_5xx: 3,
            webhook_success_rate: 40,
            query_total: 5,
            query_success: 2,
            query_failed: 3,
            query_4xx: 0,
            query_5xx: 3,
            query_success_rate: 40,
            target_id: 'payment_gateway:hupijiao:cn',
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了支付通道异常示例发送`,
            entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势（示例）'
        }
    };
}

function buildGatewayRecoveredSampleJob(user) {
    return {
        alert_type: 'payment_gateway_recovered',
        severity: 'warning',
        title: '虎皮椒 支付通道已恢复（CN）',
        payload: {
            provider: 'hupijiao',
            site: 'cn',
            target_id: 'payment_gateway:hupijiao:cn',
            gateway_alert_job_id: 'payment-gateway-demo-001',
            incident_started_at: '2026-03-25T09:30:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 24,
            recovery_summary: '支付通道异常阈值已解除',
            previous_degraded_reasons: [
                '支付成功率仅 33.33%（2/6）',
                '回调成功率仅 40.00%（失败 3，5xx 3）'
            ],
            total_orders: 8,
            paid_orders: 7,
            review_orders: 1,
            failed_orders: 0,
            paid_rate: 87.5,
            webhook_total: 6,
            webhook_success: 6,
            webhook_failed: 0,
            webhook_5xx: 0,
            webhook_success_rate: 100,
            query_total: 6,
            query_success: 6,
            query_failed: 0,
            query_5xx: 0,
            query_success_rate: 100,
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了支付通道恢复示例发送`,
            entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势（示例）'
        }
    };
}

function buildVerifyQuotaLowSampleJob(user) {
    return {
        alert_type: 'verify_quota_low',
        severity: 'warning',
        title: '验证额度不足预警（primary-key）',
        payload: {
            target_id: 'verify_quota:primary-key',
            key_name: 'primary-key',
            balance: 11,
            credits: 11,
            total_used: 324,
            cost_per_job: 1,
            remaining_jobs: 11,
            queue_size: 7,
            running_jobs: 2,
            low_balance_threshold: 20,
            low_remaining_jobs_threshold: 20,
            critical_balance_threshold: 5,
            critical_remaining_jobs_threshold: 5,
            degraded_reasons: [
                '剩余额度 11.00 点（阈值 20.00 点）',
                '预计仅可继续 11 次验证（阈值 20 次）',
                '剩余额度仅够覆盖约 11 次验证，当前队列 7 个、运行中 2 个'
            ],
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了验证额度示例发送`,
            checked_at: new Date().toISOString(),
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态（示例）'
        }
    };
}

function buildVerifyServiceDisabledSampleJob(user) {
    return {
        alert_type: 'verify_service_disabled',
        severity: 'critical',
        title: '验证服务不可用（primary-key）',
        payload: {
            target_id: 'verify_service:https://a8yx0rez5w.localto.net',
            service_status: 'unavailable',
            service_status_label: '服务不可用',
            key_name: 'primary-key',
            api_base_url: 'https://a8yx0rez5w.localto.net',
            last_error: '示例：上游验证服务返回 503，当前无法创建新验证任务。',
            response_status: 503,
            checked_at: new Date().toISOString(),
            reason: 'balance_http_503',
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了验证服务停摆示例发送`,
            entry_path: '后台设置 -> 验证服务配置 -> API Key / 接口状态（示例）'
        }
    };
}

function buildVerifyQueueBacklogSampleJob(user) {
    return {
        alert_type: 'verify_queue_backlog',
        severity: 'warning',
        title: '验证任务堆积预警（primary-key）',
        payload: {
            target_id: 'verify_queue:https://a8yx0rez5w.localto.net',
            key_name: 'primary-key',
            api_base_url: 'https://a8yx0rez5w.localto.net',
            queue_size: 18,
            running_jobs: 4,
            active_job_count: 11,
            oldest_pending_minutes: 42,
            oldest_pending_label: '42 分钟',
            recent_failure_count: 6,
            recent_failure_window_minutes: 30,
            hot_targets: ['member1@example.com × 3', 'member2@example.com × 2'],
            hot_errors: ['lock_conflict × 4', 'otp_invalid × 2'],
            degraded_reasons: [
                '上游队列已堆积 18 个任务（阈值 10 个）',
                '本地活跃任务 11 个（阈值 8 个）',
                '最老活跃任务已等待 42 分钟（阈值 20 分钟）',
                '最近 30 分钟失败 6 次（阈值 4 次）'
            ],
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了验证任务堆积示例发送`,
            checked_at: new Date().toISOString(),
            entry_path: '后台设置 -> 验证服务配置 -> 队列状态 / 最近任务（示例）'
        }
    };
}

function buildVerifyFailureRateSpikeSampleJob(user) {
    return {
        alert_type: 'verify_failure_rate_spike',
        severity: 'critical',
        title: '验证失败率异常（primary-key）',
        payload: {
            target_id: 'verify_failure:https://a8yx0rez5w.localto.net',
            key_name: 'primary-key',
            api_base_url: 'https://a8yx0rez5w.localto.net',
            monitor_window_minutes: 30,
            total_jobs: 9,
            failed_jobs: 7,
            success_jobs: 2,
            failure_rate: 77.78,
            affected_user_count: 5,
            affected_user_labels: ['member1@example.com × 2', 'member2@example.com × 2', 'member3@example.com × 1'],
            hot_errors: ['otp_invalid × 4', 'lock_conflict × 2', 'upstream_timeout × 1'],
            degraded_reasons: [
                '最近 30 分钟失败率 77.78%（7/9，阈值 60.00%）',
                '受影响用户 5 人（阈值 3 人）'
            ],
            checked_at: new Date().toISOString(),
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了验证失败率异常示例发送`,
            entry_path: '后台设置 -> 验证服务配置 -> 最近任务 / 最近失败（示例）'
        }
    };
}

function buildVerifyIncidentEscalatedSampleJob(user) {
    return {
        alert_type: 'verify_incident_escalated',
        severity: 'critical',
        title: '验证综合异常升级（primary-key）',
        payload: {
            target_id: 'verify_incident:https://a8yx0rez5w.localto.net',
            key_name: 'primary-key',
            api_base_url: 'https://a8yx0rez5w.localto.net',
            lookback_minutes: 30,
            triggered_signal_count: 3,
            signal_types: ['verify_service_disabled', 'verify_failure_rate_spike', 'verify_queue_backlog'],
            signal_labels: ['验证服务停摆', '验证失败率飙升', '验证任务堆积'],
            signal_summaries: [
                '服务不可用 / balance_http_503',
                '失败率 77.78%（7/9）',
                '排队 18 个 / 本地活跃 11 个'
            ],
            signal_timeline: [
                '验证服务停摆：2026-03-25T10:00:00.000Z',
                '验证失败率飙升：2026-03-25T10:02:00.000Z',
                '验证任务堆积：2026-03-25T10:04:00.000Z'
            ],
            latest_signal_at: '2026-03-25T10:04:00.000Z',
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了验证综合异常示例发送`,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 接口状态 / 队列状态 / 最近失败（示例）'
        }
    };
}

function buildVerifyIncidentRecoveredSampleJob(user) {
    return {
        alert_type: 'verify_incident_recovered',
        severity: 'warning',
        title: '验证综合异常已恢复（primary-key）',
        payload: {
            target_id: 'verify_incident:https://a8yx0rez5w.localto.net',
            key_name: 'primary-key',
            api_base_url: 'https://a8yx0rez5w.localto.net',
            incident_alert_job_id: 'verify-incident-demo-001',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 18,
            recovery_summary: '验证综合高危组合已解除，当前仍保留 1 类低优先级信号',
            active_signal_count: 1,
            active_signal_types: ['verify_quota_low'],
            active_signal_labels: ['验证额度不足'],
            active_signal_summaries: ['剩余额度 18.00 点 / 预计 9 次'],
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了验证恢复示例发送`,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 接口状态 / 队列状态 / 最近失败（示例）'
        }
    };
}

function buildTicketSlaOverdueSampleJob(user) {
    const createdAt = new Date(Date.now() - 195 * 60 * 1000).toISOString();
    return {
        alert_type: 'ticket_sla_overdue',
        severity: 'warning',
        title: '工单超时未处理（ticket-de）',
        payload: {
            target_id: 'ticket-demo-sla-001',
            ticket_id: 'ticket-demo-sla-001',
            order_id: 'shop-order-demo-001',
            user_id: 'demo_ticket_user_001',
            ticket_status: 'PENDING',
            wait_minutes: 195,
            wait_label: '3 小时 15 分钟',
            responsible_label: '未分配',
            reason: '卡密未到账，用户已重复反馈仍未处理。',
            created_at: createdAt,
            updated_at: createdAt,
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了工单超时示例发送`,
            entry_path: '售后工单 -> 待处理 -> 工单详情（示例）'
        }
    };
}

function buildTicketSlaRecoveredSampleJob(user) {
    return {
        alert_type: 'ticket_sla_recovered',
        severity: 'warning',
        title: '工单超时已恢复（ticket-de）',
        payload: {
            target_id: 'ticket-demo-sla-001',
            ticket_id: 'ticket-demo-sla-001',
            order_id: 'shop-order-demo-001',
            user_id: 'demo_ticket_user_001',
            incident_alert_job_id: 'ticket-sla-overdue-demo-001',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 42,
            previous_wait_minutes: 195,
            previous_wait_label: '3 小时 15 分钟',
            ticket_status: 'RESOLVED',
            recovery_summary: '工单已解决，已退出超时未处理状态',
            reason: '已人工补发卡密并回复用户，当前无需继续催办。',
            created_at: '2026-03-25T06:45:00.000Z',
            updated_at: new Date().toISOString(),
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了工单恢复示例发送`,
            entry_path: '售后工单 -> 已处理 -> 工单详情（示例）'
        }
    };
}

function buildShopOrderDeliveryRecoveredSampleJob(user) {
    return {
        alert_type: 'shop_order_delivery_recovered',
        severity: 'warning',
        title: '商城履约已恢复（shop-ord）',
        payload: {
            target_id: 'shop-order-demo-delivery-001',
            order_id: 'shop-order-demo-delivery-001',
            user_id: 'demo_delivery_user_001',
            product_name: 'Prompt Pro 年卡',
            item_count: 2,
            total_price: 59.8,
            price_paid: 59.8,
            previous_delivery_status: 'dead_letter',
            previous_delivery_status_label: '死信待处理',
            previous_delivery_attempt_count: 4,
            previous_delivery_last_error: '目标履约地址连续超时',
            delivery_status: 'delivered',
            delivery_status_label: '已发货',
            refund_status: 'none',
            refund_status_label: '正常',
            incident_alert_job_id: 'shop-delivery-demo-001',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 37,
            recovery_summary: '订单已成功履约，已退出履约异常状态',
            created_at: '2026-03-25T09:30:00.000Z',
            delivery_updated_at: new Date().toISOString(),
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了履约恢复示例发送`,
            entry_path: '商城管理 -> 履约任务 / 异常订单（示例）'
        }
    };
}

function buildShopInventoryLowSampleJob(user) {
    return {
        alert_type: 'shop_inventory_low',
        severity: 'warning',
        title: 'Prompt Pro 月卡 库存不足',
        payload: {
            target_id: 'shop-product-demo-low-stock',
            product_id: 'shop-product-demo-low-stock',
            product_name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 3,
            low_stock_threshold: 5,
            recent_sales_days: 7,
            recent_sales_count: 12,
            delivery_type: 'KEY',
            updated_at: new Date().toISOString(),
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了库存预警示例发送`,
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货（示例）'
        }
    };
}

function buildShopInventoryRecoveredSampleJob(user) {
    return {
        alert_type: 'shop_inventory_recovered',
        severity: 'warning',
        title: 'Prompt Pro 月卡 库存已恢复',
        payload: {
            target_id: 'shop-product-demo-low-stock',
            product_id: 'shop-product-demo-low-stock',
            product_name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 18,
            previous_stock_count: 3,
            low_stock_threshold: 5,
            recent_sales_days: 7,
            recent_sales_count: 12,
            delivery_type: 'KEY',
            incident_alert_job_id: 'inventory-low-demo-001',
            incident_started_at: '2026-03-25T09:00:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 54,
            recovery_summary: '商品库存已高于阈值，当前可售库存 18 件',
            updated_at: new Date().toISOString(),
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了库存恢复示例发送`,
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货（示例）'
        }
    };
}

function buildAdminLoginAnomalySampleJob(user) {
    return {
        alert_type: 'security_admin_login_anomaly',
        severity: 'critical',
        title: `管理员异常登录（${sanitizeText(user?.email || user?.id) || 'admin@example.com'}）`,
        payload: {
            target_id: sanitizeText(user?.id) || 'admin-demo-user',
            admin_id: sanitizeText(user?.id) || 'admin-demo-user',
            admin_email: sanitizeText(user?.email || user?.id) || 'admin@example.com',
            client_ip: '203.0.113.88',
            user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 Chrome/124.0',
            occurred_at: new Date().toISOString(),
            previous_ips: ['198.51.100.21', '198.51.100.22'],
            recent_distinct_ip_count: 3,
            recent_distinct_user_agent_count: 2,
            detected_reasons: [
                '管理员首次从该 IP 登录后台',
                '最近窗口内出现 3 个登录 IP',
                '最近窗口内出现 2 个登录设备指纹'
            ],
            origin: 'https://www.zaoyoe.com',
            referer: 'https://www.zaoyoe.com/admin-entry.html',
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 异常登录信号（示例）'
        }
    };
}

function buildShopOrderDeliveryFailedSampleJob(user) {
    const createdAt = new Date(Date.now() - 95 * 60 * 1000).toISOString();
    const updatedAt = new Date(Date.now() - 12 * 60 * 1000).toISOString();

    return {
        alert_type: 'shop_order_delivery_failed',
        severity: 'critical',
        title: '商城履约失败（shop-ord）',
        payload: {
            target_id: 'shop-order-demo-delivery-001',
            order_id: 'shop-order-demo-delivery-001',
            user_id: 'demo_delivery_user_001',
            product_name: 'Prompt Pro 年卡',
            item_count: 2,
            total_price: 59.8,
            price_paid: 59.8,
            delivery_status: 'dead_letter',
            delivery_status_label: '死信待处理',
            delivery_attempt_count: 4,
            delivery_last_error: '示例：库存已锁定，但目标履约地址连续超时，任务已进入死信队列。',
            refund_status: 'none',
            refund_status_label: '正常',
            created_at: createdAt,
            delivery_updated_at: updatedAt,
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了履约失败示例发送`,
            entry_path: '商城管理 -> 履约任务 / 异常订单（示例）'
        }
    };
}

function buildShopOrderDeliveryIncidentSampleJob(user) {
    return {
        alert_type: 'shop_order_delivery_incident',
        severity: 'critical',
        title: '商城履约异常升级（4 笔）',
        payload: {
            target_id: 'shop_order_delivery_incident:global',
            incident_order_count: 4,
            dead_letter_count: 2,
            retry_waiting_count: 2,
            distinct_user_count: 3,
            distinct_product_count: 2,
            signal_labels: [
                '当前有 4 笔订单处于履约异常状态',
                '其中 2 笔已进入死信队列',
                '影响 3 位用户'
            ],
            hot_products: ['Prompt Pro 年卡 × 3', '卡密周卡 × 1'],
            hot_errors: ['目标履约地址连续超时 × 2', '库存锁定冲突，已等待下一轮重试 × 2'],
            order_refs: ['shop-order-demo-delivery-001', 'shop-order-demo-delivery-002', 'shop-order-demo-delivery-003'],
            latest_failure_at: new Date().toISOString(),
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了履约异常升级示例发送`,
            entry_path: '商城管理 -> 履约任务 / 异常订单（示例）'
        }
    };
}

function buildShopOrderDeliveryIncidentRecoveredSampleJob(user) {
    return {
        alert_type: 'shop_order_delivery_incident_recovered',
        severity: 'warning',
        title: '商城履约事故已恢复',
        payload: {
            target_id: 'shop_order_delivery_incident:global',
            incident_alert_job_id: 'shop-delivery-incident-demo-001',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 46,
            previous_incident_order_count: 4,
            previous_dead_letter_count: 2,
            previous_retry_waiting_count: 2,
            recovery_summary: '履约集中事故阈值已解除，当前仍保留 1 笔单笔异常订单',
            active_order_count: 1,
            active_dead_letter_count: 0,
            active_retry_waiting_count: 1,
            active_user_count: 1,
            active_products: ['卡密周卡 × 1'],
            active_errors: ['库存锁定冲突，已等待下一轮重试 × 1'],
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了履约事故恢复示例发送`,
            entry_path: '商城管理 -> 履约任务 / 异常订单（示例）'
        }
    };
}

function buildPaymentConfigChangedSampleJob(user) {
    return {
        alert_type: 'payment_config_changed',
        severity: 'critical',
        title: `支付配置已变更（${sanitizeText(user?.email || user?.id) || 'admin@example.com'}）`,
        payload: {
            target_id: 'audit-demo-payment-config-001',
            audit_id: 'audit-demo-payment-config-001',
            admin_id: sanitizeText(user?.id) || 'admin-demo-user',
            admin_email: sanitizeText(user?.email || user?.id) || 'admin@example.com',
            action_type: 'admin.payment_channels.upsert',
            action_label: '支付通道配置更新',
            active_provider: 'mock',
            active_provider_label: '模拟支付',
            updated_providers: ['mock', 'hupijiao'],
            updated_provider_labels: ['模拟支付', '虎皮椒'],
            updated_secrets: ['hupijiao_secret_key'],
            risk_flags: ['当前活动通道已切换为模拟支付', '本次更新包含 1 个支付密钥'],
            created_at: new Date().toISOString(),
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计（示例）'
        }
    };
}

function buildPaymentConfigIncidentSampleJob(user) {
    return {
        alert_type: 'payment_config_incident',
        severity: 'critical',
        title: '支付配置异常升级（3 次）',
        payload: {
            target_id: 'payment_config_incident:global',
            lookback_minutes: 20,
            incident_change_count: 3,
            distinct_admin_count: 2,
            admin_emails: [
                sanitizeText(user?.email || user?.id) || 'admin@example.com',
                'owner@example.com'
            ],
            action_labels: ['支付通道配置更新 × 2', '支付密钥删除'],
            signal_labels: [
                '最近 20 分钟内累计 3 次高风险支付配置改动',
                '涉及 2 位管理员',
                '核心动作：支付通道配置更新 × 2、支付密钥删除'
            ],
            risk_signals: [
                '当前活动通道已切换为模拟支付',
                '支付密钥 hupijiao_secret_key 已被删除',
                '本次更新包含 2 个支付密钥'
            ],
            provider_labels: ['模拟支付', '虎皮椒', '爱发电'],
            secret_labels: ['虎皮椒 Secret Key', '爱发电 Token'],
            latest_change_at: new Date().toISOString(),
            audit_refs: ['audit-demo-payment-config-001', 'audit-demo-payment-config-002', 'audit-demo-payment-config-003'],
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了支付配置异常升级示例发送`,
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计（示例）'
        }
    };
}

function buildPaymentConfigRecoveredSampleJob(user) {
    return {
        alert_type: 'payment_config_recovered',
        severity: 'warning',
        title: '支付配置风险已恢复（已切回真实支付）',
        payload: {
            target_id: 'payment_config:active_provider:mock',
            config_alert_job_id: 'job-demo-payment-config-001',
            recovery_audit_id: 'audit-demo-payment-config-restore-001',
            risk_target_kind: 'active_provider_mock',
            previous_action_type: 'admin.payment_channels.upsert',
            previous_action_label: '支付通道配置更新',
            previous_admin_email: sanitizeText(user?.email || user?.id) || 'admin@example.com',
            recovery_action_type: 'admin.payment_channels.upsert',
            recovery_action_label: '支付通道配置更新',
            recovery_admin_email: sanitizeText(user?.email || user?.id) || 'admin@example.com',
            incident_started_at: '2026-03-25T10:05:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 18,
            recovery_summary: '当前活动通道已切回 爱发电',
            previous_risk_flags: ['当前活动通道已切换为模拟支付'],
            previous_active_provider: 'mock',
            previous_active_provider_label: '模拟支付',
            current_active_provider: 'afdian',
            current_active_provider_label: '爱发电',
            current_enabled_provider_labels: ['爱发电', '虎皮椒'],
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了支付配置恢复示例发送`,
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计（示例）'
        }
    };
}

function buildPaymentConfigIncidentRecoveredSampleJob(user) {
    return {
        alert_type: 'payment_config_incident_recovered',
        severity: 'warning',
        title: '支付配置事故已恢复',
        payload: {
            target_id: 'payment_config_incident:global',
            incident_alert_job_id: 'job-demo-payment-config-incident-001',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: new Date().toISOString(),
            incident_duration_minutes: 32,
            previous_incident_change_count: 3,
            previous_distinct_admin_count: 2,
            recovery_summary: '支付配置集中事故阈值已解除，当前仍保留 1 次单次高风险改动',
            active_change_count: 1,
            active_admin_count: 1,
            active_admin_emails: [sanitizeText(user?.email || user?.id) || 'admin@example.com'],
            active_action_labels: ['支付通道配置更新'],
            active_risk_signals: ['本次更新包含 1 个支付密钥'],
            active_provider_labels: ['虎皮椒'],
            active_secret_labels: ['虎皮椒 Secret Key'],
            note: `管理员 ${sanitizeText(user?.email || user?.id) || 'unknown'} 触发了支付配置事故恢复示例发送`,
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计（示例）'
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
            if (
                sanitizeText(body.action) === 'send_test_telegram'
                || sanitizeText(body.action) === 'send_sample_refund_telegram'
                || sanitizeText(body.action) === 'send_sample_customer_chat_message'
                || sanitizeText(body.action) === 'send_sample_shop_purchase_succeeded'
                || sanitizeText(body.action) === 'send_sample_wallet_recharge_succeeded'
                || sanitizeText(body.action) === 'send_sample_gateway_degraded'
                || sanitizeText(body.action) === 'send_sample_gateway_recovered'
                || sanitizeText(body.action) === 'send_sample_verify_service_disabled'
                || sanitizeText(body.action) === 'send_sample_verify_queue_backlog'
                || sanitizeText(body.action) === 'send_sample_verify_failure_rate_spike'
                || sanitizeText(body.action) === 'send_sample_verify_incident_escalated'
                || sanitizeText(body.action) === 'send_sample_verify_incident_recovered'
                || sanitizeText(body.action) === 'send_sample_verify_quota_low'
                || sanitizeText(body.action) === 'send_sample_ticket_sla_overdue'
                || sanitizeText(body.action) === 'send_sample_ticket_sla_recovered'
                || sanitizeText(body.action) === 'send_sample_shop_inventory_low'
                || sanitizeText(body.action) === 'send_sample_shop_inventory_recovered'
                || sanitizeText(body.action) === 'send_sample_admin_login_anomaly'
                || sanitizeText(body.action) === 'send_sample_shop_order_delivery_failed'
                || sanitizeText(body.action) === 'send_sample_shop_order_delivery_incident'
                || sanitizeText(body.action) === 'send_sample_shop_order_delivery_incident_recovered'
                || sanitizeText(body.action) === 'send_sample_shop_order_delivery_recovered'
                || sanitizeText(body.action) === 'send_sample_payment_config_changed'
                || sanitizeText(body.action) === 'send_sample_payment_config_incident'
                || sanitizeText(body.action) === 'send_sample_payment_config_incident_recovered'
                || sanitizeText(body.action) === 'send_sample_payment_config_recovered'
            ) {
                const storedRuntime = await loadOpsAlertsRuntimeConfig(supabase);
                const runtime = {
                    config: normalizeOpsAlertsConfig(body.config),
                    secrets: mergeRuntimeSecrets(storedRuntime?.secrets, body.secrets)
                };

                const normalizedAction = sanitizeText(body.action);
                const job = normalizedAction === 'send_sample_refund_telegram'
                    ? buildTelegramRefundSampleJob(user)
                    : normalizedAction === 'send_sample_customer_chat_message'
                        ? buildCustomerChatMessageSampleJob(user)
                    : normalizedAction === 'send_sample_shop_purchase_succeeded'
                        ? buildShopPurchaseSuccessSampleJob(user)
                    : normalizedAction === 'send_sample_wallet_recharge_succeeded'
                        ? buildWalletRechargeSuccessSampleJob(user)
                    : normalizedAction === 'send_sample_gateway_degraded'
                        ? buildGatewayDegradedSampleJob(user)
                    : normalizedAction === 'send_sample_gateway_recovered'
                        ? buildGatewayRecoveredSampleJob(user)
                        : normalizedAction === 'send_sample_verify_service_disabled'
                            ? buildVerifyServiceDisabledSampleJob(user)
                        : normalizedAction === 'send_sample_verify_queue_backlog'
                            ? buildVerifyQueueBacklogSampleJob(user)
                        : normalizedAction === 'send_sample_verify_failure_rate_spike'
                            ? buildVerifyFailureRateSpikeSampleJob(user)
                        : normalizedAction === 'send_sample_verify_incident_escalated'
                            ? buildVerifyIncidentEscalatedSampleJob(user)
                        : normalizedAction === 'send_sample_verify_incident_recovered'
                            ? buildVerifyIncidentRecoveredSampleJob(user)
                        : normalizedAction === 'send_sample_verify_quota_low'
                                ? buildVerifyQuotaLowSampleJob(user)
                                : normalizedAction === 'send_sample_ticket_sla_overdue'
                                    ? buildTicketSlaOverdueSampleJob(user)
                                    : normalizedAction === 'send_sample_ticket_sla_recovered'
                                        ? buildTicketSlaRecoveredSampleJob(user)
                                : normalizedAction === 'send_sample_shop_inventory_low'
                                    ? buildShopInventoryLowSampleJob(user)
                                    : normalizedAction === 'send_sample_shop_inventory_recovered'
                                        ? buildShopInventoryRecoveredSampleJob(user)
                                        : normalizedAction === 'send_sample_admin_login_anomaly'
                                            ? buildAdminLoginAnomalySampleJob(user)
                                            : normalizedAction === 'send_sample_shop_order_delivery_failed'
                                                ? buildShopOrderDeliveryFailedSampleJob(user)
                                                : normalizedAction === 'send_sample_shop_order_delivery_incident'
                                                    ? buildShopOrderDeliveryIncidentSampleJob(user)
                                                : normalizedAction === 'send_sample_shop_order_delivery_incident_recovered'
                                                    ? buildShopOrderDeliveryIncidentRecoveredSampleJob(user)
                                            : normalizedAction === 'send_sample_shop_order_delivery_recovered'
                                                ? buildShopOrderDeliveryRecoveredSampleJob(user)
                                            : normalizedAction === 'send_sample_payment_config_changed'
                                                ? buildPaymentConfigChangedSampleJob(user)
                                            : normalizedAction === 'send_sample_payment_config_incident'
                                                ? buildPaymentConfigIncidentSampleJob(user)
                                            : normalizedAction === 'send_sample_payment_config_incident_recovered'
                                                ? buildPaymentConfigIncidentRecoveredSampleJob(user)
                                            : normalizedAction === 'send_sample_payment_config_recovered'
                                                ? buildPaymentConfigRecoveredSampleJob(user)
                        : buildTelegramTestJob(user, runtime);
                const result = await sendOpsAlertPreview(job, runtime);

                await writeAdminAuditLog({
                    supabase,
                    adminId: user.id,
                    actionType: normalizedAction === 'send_sample_refund_telegram'
                        ? 'admin.ops_alerts.telegram_refund_sample'
                        : normalizedAction === 'send_sample_customer_chat_message'
                            ? 'admin.ops_alerts.customer_chat_message_sample'
                        : normalizedAction === 'send_sample_shop_purchase_succeeded'
                            ? 'admin.ops_alerts.shop_purchase_succeeded_sample'
                        : normalizedAction === 'send_sample_wallet_recharge_succeeded'
                            ? 'admin.ops_alerts.wallet_recharge_succeeded_sample'
                        : normalizedAction === 'send_sample_gateway_degraded'
                            ? 'admin.ops_alerts.gateway_degraded_sample'
                        : normalizedAction === 'send_sample_gateway_recovered'
                            ? 'admin.ops_alerts.gateway_recovered_sample'
                        : normalizedAction === 'send_sample_verify_service_disabled'
                            ? 'admin.ops_alerts.verify_service_disabled_sample'
                        : normalizedAction === 'send_sample_verify_queue_backlog'
                            ? 'admin.ops_alerts.verify_queue_backlog_sample'
                        : normalizedAction === 'send_sample_verify_failure_rate_spike'
                            ? 'admin.ops_alerts.verify_failure_rate_spike_sample'
                        : normalizedAction === 'send_sample_verify_incident_escalated'
                            ? 'admin.ops_alerts.verify_incident_escalated_sample'
                        : normalizedAction === 'send_sample_verify_incident_recovered'
                            ? 'admin.ops_alerts.verify_incident_recovered_sample'
                        : normalizedAction === 'send_sample_verify_quota_low'
                                ? 'admin.ops_alerts.verify_quota_sample'
                                : normalizedAction === 'send_sample_ticket_sla_overdue'
                                    ? 'admin.ops_alerts.ticket_sla_sample'
                                    : normalizedAction === 'send_sample_ticket_sla_recovered'
                                        ? 'admin.ops_alerts.ticket_sla_recovered_sample'
                                    : normalizedAction === 'send_sample_shop_inventory_low'
                                        ? 'admin.ops_alerts.shop_inventory_sample'
                                        : normalizedAction === 'send_sample_shop_inventory_recovered'
                                            ? 'admin.ops_alerts.shop_inventory_recovered_sample'
                                        : normalizedAction === 'send_sample_admin_login_anomaly'
                                            ? 'admin.ops_alerts.admin_login_anomaly_sample'
                                            : normalizedAction === 'send_sample_shop_order_delivery_failed'
                                                ? 'admin.ops_alerts.shop_delivery_failed_sample'
                                                : normalizedAction === 'send_sample_shop_order_delivery_incident'
                                                    ? 'admin.ops_alerts.shop_delivery_incident_sample'
                                                : normalizedAction === 'send_sample_shop_order_delivery_incident_recovered'
                                                    ? 'admin.ops_alerts.shop_delivery_incident_recovered_sample'
                                                : normalizedAction === 'send_sample_shop_order_delivery_recovered'
                                                    ? 'admin.ops_alerts.shop_delivery_recovered_sample'
                                                : normalizedAction === 'send_sample_payment_config_changed'
                                                    ? 'admin.ops_alerts.payment_config_changed_sample'
                                                : normalizedAction === 'send_sample_payment_config_incident'
                                                    ? 'admin.ops_alerts.payment_config_incident_sample'
                                                : normalizedAction === 'send_sample_payment_config_incident_recovered'
                                                    ? 'admin.ops_alerts.payment_config_incident_recovered_sample'
                                                : normalizedAction === 'send_sample_payment_config_recovered'
                                                    ? 'admin.ops_alerts.payment_config_recovered_sample'
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
                        : normalizedAction === 'send_sample_customer_chat_message'
                            ? `客服消息示例已发送到 ${channelLabels || '已启用通道'}`
                        : normalizedAction === 'send_sample_shop_purchase_succeeded'
                            ? `购买成功示例消息已发送到 ${channelLabels || '已启用通道'}`
                        : normalizedAction === 'send_sample_wallet_recharge_succeeded'
                            ? `充值成功示例消息已发送到 ${channelLabels || '已启用通道'}`
                        : normalizedAction === 'send_sample_gateway_degraded'
                            ? `支付通道异常示例消息已发送到 ${channelLabels || '已启用通道'}`
                        : normalizedAction === 'send_sample_gateway_recovered'
                            ? `支付通道恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
                        : normalizedAction === 'send_sample_verify_service_disabled'
                                ? `验证服务停摆示例消息已发送到 ${channelLabels || '已启用通道'}`
                            : normalizedAction === 'send_sample_verify_queue_backlog'
                                ? `验证任务堆积示例消息已发送到 ${channelLabels || '已启用通道'}`
                            : normalizedAction === 'send_sample_verify_failure_rate_spike'
                            ? `验证失败率异常示例消息已发送到 ${channelLabels || '已启用通道'}`
                            : normalizedAction === 'send_sample_verify_incident_escalated'
                                ? `验证综合异常示例消息已发送到 ${channelLabels || '已启用通道'}`
                            : normalizedAction === 'send_sample_verify_incident_recovered'
                                ? `验证恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
                            : normalizedAction === 'send_sample_verify_quota_low'
                                ? `验证额度告警示例消息已发送到 ${channelLabels || '已启用通道'}`
                                : normalizedAction === 'send_sample_ticket_sla_overdue'
                                    ? `工单超时示例消息已发送到 ${channelLabels || '已启用通道'}`
                                    : normalizedAction === 'send_sample_ticket_sla_recovered'
                                        ? `工单恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
                                    : normalizedAction === 'send_sample_shop_inventory_low'
                                        ? `库存预警示例消息已发送到 ${channelLabels || '已启用通道'}`
                                        : normalizedAction === 'send_sample_shop_inventory_recovered'
                                            ? `库存恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
                                        : normalizedAction === 'send_sample_admin_login_anomaly'
                                            ? `管理员异常登录示例消息已发送到 ${channelLabels || '已启用通道'}`
                                            : normalizedAction === 'send_sample_shop_order_delivery_failed'
                                                ? `履约失败示例消息已发送到 ${channelLabels || '已启用通道'}`
                                                : normalizedAction === 'send_sample_shop_order_delivery_incident'
                                                    ? `履约异常升级示例消息已发送到 ${channelLabels || '已启用通道'}`
                                                : normalizedAction === 'send_sample_shop_order_delivery_incident_recovered'
                                                    ? `履约事故恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
                                                : normalizedAction === 'send_sample_shop_order_delivery_recovered'
                                                    ? `履约恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
                                                : normalizedAction === 'send_sample_payment_config_changed'
                                                    ? `支付配置变更示例消息已发送到 ${channelLabels || '已启用通道'}`
                                                : normalizedAction === 'send_sample_payment_config_incident'
                                                    ? `支付配置异常升级示例消息已发送到 ${channelLabels || '已启用通道'}`
                                                : normalizedAction === 'send_sample_payment_config_incident_recovered'
                                                    ? `支付配置事故恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
                                                : normalizedAction === 'send_sample_payment_config_recovered'
                                                    ? `支付配置恢复示例消息已发送到 ${channelLabels || '已启用通道'}`
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

            const muteTypeRules = Object.fromEntries(
                Object.entries(nextConfig.mute_rules?.types || {})
                    .map(([key, rule]) => {
                        const until = sanitizeText(rule?.until, 120);
                        if (!until) return null;
                        return [key, {
                            until,
                            allow_critical: rule?.allow_critical !== false
                        }];
                    })
                    .filter(Boolean)
            );

            const muteModuleRules = Object.fromEntries(
                Object.entries(nextConfig.mute_rules?.modules || {})
                    .map(([key, rule]) => {
                        const until = sanitizeText(rule?.until, 120);
                        if (!until) return null;
                        return [key, {
                            until,
                            allow_critical: rule?.allow_critical !== false
                        }];
                    })
                    .filter(Boolean)
            );

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.ops_alerts.upsert',
                details: {
                    enabled: nextConfig.enabled,
                    temporary_mute_until: sanitizeText(nextConfig.temporary_mute?.until, 120) || null,
                    temporary_mute_allow_critical: nextConfig.temporary_mute?.allow_critical !== false,
                    quiet_hours_enabled: nextConfig.quiet_hours?.enabled === true,
                    quiet_hours_start_hour: Number(nextConfig.quiet_hours?.start_hour),
                    quiet_hours_end_hour: Number(nextConfig.quiet_hours?.end_hour),
                    quiet_hours_timezone: sanitizeText(nextConfig.quiet_hours?.timezone, 120) || null,
                    quiet_hours_allow_critical: nextConfig.quiet_hours?.allow_critical !== false,
                    mute_type_keys_active: Object.keys(muteTypeRules),
                    mute_module_keys_active: Object.keys(muteModuleRules),
                    mute_type_rules: muteTypeRules,
                    mute_module_rules: muteModuleRules,
                    telegram_enabled: nextConfig.channels?.telegram?.enabled === true,
                    feishu_enabled: nextConfig.channels?.feishu?.enabled === true,
                    email_enabled: nextConfig.channels?.email?.enabled === true,
                    routing_customer_chat_message_channels: [
                        nextConfig.routing?.customer_chat_message?.telegram !== false ? 'telegram' : null,
                        nextConfig.routing?.customer_chat_message?.feishu !== false ? 'feishu' : null,
                        nextConfig.routing?.customer_chat_message?.email !== false ? 'email' : null
                    ].filter(Boolean),
                    routing_shop_purchase_success_channels: [
                        nextConfig.routing?.shop_purchase_success?.telegram !== false ? 'telegram' : null,
                        nextConfig.routing?.shop_purchase_success?.feishu !== false ? 'feishu' : null,
                        nextConfig.routing?.shop_purchase_success?.email !== false ? 'email' : null
                    ].filter(Boolean),
                    routing_wallet_recharge_success_channels: [
                        nextConfig.routing?.wallet_recharge_success?.telegram !== false ? 'telegram' : null,
                        nextConfig.routing?.wallet_recharge_success?.feishu !== false ? 'feishu' : null,
                        nextConfig.routing?.wallet_recharge_success?.email !== false ? 'email' : null
                    ].filter(Boolean),
                    customer_chat_message_summary_enabled: nextConfig.customer_chat_message?.summary_enabled === true,
                    customer_chat_message_summary_window_minutes: Number(nextConfig.customer_chat_message?.summary_window_minutes || 0),
                    customer_chat_message_summary_max_items: Number(nextConfig.customer_chat_message?.summary_max_items || 0),
                    shop_purchase_success_summary_enabled: nextConfig.shop_purchase_success?.summary_enabled === true,
                    shop_purchase_success_summary_window_minutes: Number(nextConfig.shop_purchase_success?.summary_window_minutes || 0),
                    shop_purchase_success_summary_max_items: Number(nextConfig.shop_purchase_success?.summary_max_items || 0),
                    wallet_recharge_success_summary_enabled: nextConfig.wallet_recharge_success?.summary_enabled === true,
                    wallet_recharge_success_summary_window_minutes: Number(nextConfig.wallet_recharge_success?.summary_window_minutes || 0),
                    wallet_recharge_success_summary_max_items: Number(nextConfig.wallet_recharge_success?.summary_max_items || 0),
                    routing_shop_inventory_channels: [
                        nextConfig.routing?.shop_inventory?.telegram !== false ? 'telegram' : null,
                        nextConfig.routing?.shop_inventory?.feishu !== false ? 'feishu' : null,
                        nextConfig.routing?.shop_inventory?.email !== false ? 'email' : null
                    ].filter(Boolean),
                    shop_risk_auto_response_enabled: nextConfig.shop_order_risk?.auto_response_enabled === true,
                    shop_risk_auto_disable_coupon_min_risk_score: Number(nextConfig.shop_order_risk?.auto_disable_coupon_min_risk_score || 0) || null,
                    shop_risk_auto_ban_user_min_risk_score: Number(nextConfig.shop_order_risk?.auto_ban_user_min_risk_score || 0) || null,
                    shop_risk_auto_ban_user_duration_days: Number(nextConfig.shop_order_risk?.auto_ban_user_duration_days || 0) || null,
                    shop_risk_auto_suspend_product_min_risk_score: Number(nextConfig.shop_order_risk?.auto_suspend_product_min_risk_score || 0) || null,
                    shop_inventory_enabled: nextConfig.shop_inventory?.enabled !== false,
                    shop_inventory_low_stock_threshold: Number(nextConfig.shop_inventory?.low_stock_threshold || 0) || 0,
                    shop_inventory_sweep_interval_ms: Number(nextConfig.shop_inventory?.sweep_interval_ms || 0) || null,
                    shop_inventory_sales_window_days: Number(nextConfig.shop_inventory?.sales_window_days || 0) || null,
                    shop_inventory_dedupe_window_minutes: Number(nextConfig.shop_inventory?.dedupe_window_minutes || 0) || null,
                    shop_inventory_recovery_notification_enabled: nextConfig.shop_inventory?.recovery_notification_enabled !== false,
                    customer_chat_message_enabled: nextConfig.customer_chat_message?.enabled !== false,
                    customer_chat_message_sweep_interval_ms: Number(nextConfig.customer_chat_message?.sweep_interval_ms || 0) || null,
                    customer_chat_message_lookback_minutes: Number(nextConfig.customer_chat_message?.lookback_minutes || 0) || null,
                    customer_chat_message_dedupe_window_minutes: Number(nextConfig.customer_chat_message?.dedupe_window_minutes || 0) || null,
                    shop_purchase_success_enabled: nextConfig.shop_purchase_success?.enabled !== false,
                    shop_purchase_success_sweep_interval_ms: Number(nextConfig.shop_purchase_success?.sweep_interval_ms || 0) || null,
                    shop_purchase_success_lookback_minutes: Number(nextConfig.shop_purchase_success?.lookback_minutes || 0) || null,
                    shop_purchase_success_dedupe_window_minutes: Number(nextConfig.shop_purchase_success?.dedupe_window_minutes || 0) || null,
                    wallet_recharge_success_enabled: nextConfig.wallet_recharge_success?.enabled !== false,
                    wallet_recharge_success_sweep_interval_ms: Number(nextConfig.wallet_recharge_success?.sweep_interval_ms || 0) || null,
                    wallet_recharge_success_lookback_minutes: Number(nextConfig.wallet_recharge_success?.lookback_minutes || 0) || null,
                    wallet_recharge_success_dedupe_window_minutes: Number(nextConfig.wallet_recharge_success?.dedupe_window_minutes || 0) || null,
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
