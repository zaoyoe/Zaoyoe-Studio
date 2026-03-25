const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    notifyActiveAdmins
} = require('./admin-notifications');
const {
    buildPaymentSecretStatus,
    loadStoredPaymentConfigs
} = require('./payments/providers');

const TRACKED_PAYMENT_CONFIG_ACTIONS = new Set([
    'admin.payment_channels.upsert',
    'admin.payment_channels.secret.delete'
]);
const PAYMENT_CONFIG_STATE_TYPES = Object.freeze([
    'payment_config_changed',
    'payment_config_recovered'
]);
const PAYMENT_SECRET_LABELS = Object.freeze({
    afdian_token: '爱发电 Token',
    hupijiao_api_key: '虎皮椒 API Key',
    hupijiao_secret_key: '虎皮椒 Secret Key'
});

const DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    recent_window_minutes: 20,
    state_lookback_minutes: 24 * 60,
    dedupe_window_minutes: 5,
    page_size: 500,
    max_pages: 10
});

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeNumber(value, fallback = 0, min = null, max = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    let next = parsed;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    return next;
}

function normalizeStringArray(values = []) {
    if (!Array.isArray(values)) return [];
    return values
        .map((value) => normalizeText(value))
        .filter(Boolean);
}

function normalizePaymentConfigChangeMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.PAYMENT_CONFIG_CHANGE_MONITOR_ENABLED, DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.PAYMENT_CONFIG_CHANGE_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        recent_window_minutes: normalizeNumber(
            source.recent_window_minutes,
            normalizeNumber(env?.PAYMENT_CONFIG_CHANGE_MONITOR_RECENT_WINDOW_MINUTES, DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.recent_window_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.PAYMENT_CONFIG_CHANGE_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.PAYMENT_CONFIG_CHANGE_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.PAYMENT_CONFIG_CHANGE_MONITOR_PAGE_SIZE, DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.PAYMENT_CONFIG_CHANGE_MONITOR_MAX_PAGES, DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
}

async function fetchPagedRows(buildQuery, pageSize = 500, maxPages = 10) {
    const rows = [];

    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildQuery().range(from, to);

        if (error) {
            throw error;
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);

        if (batch.length < pageSize) {
            break;
        }
    }

    return rows;
}

async function fetchRecentPaymentAuditRows(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('admin_audit_logs_view')
        .select('id, action_type, details, created_at, admin_id, admin_email')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true }), config.page_size, config.max_pages);
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getProviderLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const labelMap = {
        afdian: '爱发电',
        hupijiao: '虎皮椒',
        mock: '模拟支付'
    };
    return labelMap[normalized] || normalized;
}

function getActionLabel(actionType) {
    const normalized = normalizeText(actionType).toLowerCase();
    const labelMap = {
        'admin.payment_channels.upsert': '支付通道配置更新',
        'admin.payment_channels.secret.delete': '支付密钥删除'
    };
    return labelMap[normalized] || normalized;
}

function getPaymentSecretLabel(secretName) {
    const normalized = normalizeText(secretName);
    return PAYMENT_SECRET_LABELS[normalized] || normalized;
}

function buildRiskFlags(actionType, details = {}) {
    const flags = [];
    const normalizedAction = normalizeText(actionType).toLowerCase();
    const activeProvider = normalizeText(details.active_provider).toLowerCase();
    const updatedSecrets = normalizeStringArray(details.updated_secrets);

    if (normalizedAction === 'admin.payment_channels.upsert' && activeProvider === 'mock') {
        flags.push('当前活动通道已切换为模拟支付');
    }
    if (updatedSecrets.length > 0) {
        flags.push(`本次更新包含 ${updatedSecrets.length} 个支付密钥`);
    }
    if (normalizedAction === 'admin.payment_channels.secret.delete' && normalizeText(details.secret_name)) {
        flags.push(`支付密钥 ${normalizeText(details.secret_name)} 已被删除`);
    }

    return flags;
}

function getEnabledProviderLabels(paymentChannels = {}) {
    const providers = paymentChannels && typeof paymentChannels === 'object' ? paymentChannels.providers : null;
    if (!providers || typeof providers !== 'object') {
        return [];
    }

    return Object.entries(providers)
        .filter(([, providerConfig]) => providerConfig && providerConfig.enabled === true)
        .map(([providerKey]) => getProviderLabel(providerKey))
        .filter(Boolean);
}

function getPaymentConfigRecoveryTarget(payload = {}) {
    const actionType = normalizeText(payload.action_type).toLowerCase();
    const activeProvider = normalizeText(payload.active_provider).toLowerCase();
    const secretName = normalizeText(payload.secret_name);

    if (actionType === 'admin.payment_channels.upsert' && activeProvider === 'mock') {
        return {
            kind: 'active_provider_mock',
            targetId: 'payment_config:active_provider:mock'
        };
    }

    if (actionType === 'admin.payment_channels.secret.delete' && secretName) {
        return {
            kind: 'secret_deleted',
            targetId: `payment_config:secret:${secretName}`,
            secretName
        };
    }

    return null;
}

function getLatestPaymentConfigRiskJob(stateJobs = [], targetId = '') {
    const normalizedTargetId = normalizeText(targetId);
    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'payment_config_changed')
        .filter((job) => getPaymentConfigRecoveryTarget(job.payload)?.targetId === normalizedTargetId)
        .sort((left, right) => Date.parse(normalizeText(right.created_at)) - Date.parse(normalizeText(left.created_at)))
        [0] || null;
}

function getLatestPaymentConfigRecoveredJob(stateJobs = [], targetId = '') {
    const normalizedTargetId = normalizeText(targetId);
    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'payment_config_recovered')
        .filter((job) => normalizeText(job.payload?.target_id) === normalizedTargetId)
        .sort((left, right) => Date.parse(normalizeText(right.created_at)) - Date.parse(normalizeText(left.created_at)))
        [0] || null;
}

function findRecoveryAuditForTarget(auditRows = [], target = {}, afterMs = 0) {
    const rows = (auditRows || [])
        .slice()
        .sort((left, right) => Date.parse(normalizeText(right.created_at)) - Date.parse(normalizeText(left.created_at)));

    for (const row of rows) {
        const createdAtMs = Date.parse(normalizeText(row.created_at));
        if (Number.isFinite(afterMs) && Number.isFinite(createdAtMs) && createdAtMs <= afterMs) {
            continue;
        }

        const actionType = normalizeText(row.action_type).toLowerCase();
        const details = normalizeJsonObject(row.details);
        if (actionType !== 'admin.payment_channels.upsert') {
            continue;
        }

        if (target.kind === 'active_provider_mock') {
            if (normalizeText(details.active_provider).toLowerCase() && normalizeText(details.active_provider).toLowerCase() !== 'mock') {
                return row;
            }
            continue;
        }

        if (target.kind === 'secret_deleted') {
            const updatedSecrets = normalizeStringArray(details.updated_secrets);
            if (target.secretName && updatedSecrets.includes(target.secretName)) {
                return row;
            }
        }
    }

    return null;
}

function buildPaymentConfigRecoveredAlerts(stateJobs = [], auditRows = [], paymentChannels = {}, secretStatus = {}, rawConfig = {}, options = {}) {
    const config = normalizePaymentConfigChangeMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const recoveryTargets = Array.from(new Set(
        (stateJobs || [])
            .map((job) => getPaymentConfigRecoveryTarget(job.payload))
            .filter(Boolean)
            .map((target) => target.targetId)
    ));

    return recoveryTargets.map((targetId) => {
        const latestChanged = getLatestPaymentConfigRiskJob(stateJobs, targetId);
        if (!latestChanged) {
            return null;
        }

        const target = getPaymentConfigRecoveryTarget(latestChanged.payload);
        if (!target) {
            return null;
        }

        const latestRecovered = getLatestPaymentConfigRecoveredJob(stateJobs, targetId);
        const latestChangedAt = Date.parse(normalizeText(latestChanged.created_at));
        const latestRecoveredAt = Date.parse(normalizeText(latestRecovered?.created_at));
        if (Number.isFinite(latestRecoveredAt) && Number.isFinite(latestChangedAt) && latestRecoveredAt >= latestChangedAt) {
            return null;
        }

        const recoveryAudit = findRecoveryAuditForTarget(auditRows, target, latestChangedAt);
        if (!recoveryAudit) {
            return null;
        }

        const currentActiveProvider = normalizeText(paymentChannels.active_provider).toLowerCase();
        const currentSecret = target.secretName ? (secretStatus?.[target.secretName] || {}) : {};
        const mockRecovered = target.kind === 'active_provider_mock' && currentActiveProvider && currentActiveProvider !== 'mock';
        const secretRecovered = target.kind === 'secret_deleted' && currentSecret.configured === true;
        if (!mockRecovered && !secretRecovered) {
            return null;
        }

        const changedPayload = normalizeJsonObject(latestChanged.payload);
        const changedRiskFlags = normalizeStringArray(changedPayload.risk_flags);
        const recoveryAdminEmail = normalizeText(recoveryAudit.admin_email) || 'unknown-admin';
        const recoveryActionLabel = getActionLabel(recoveryAudit.action_type);
        const incidentRecoveredAt = normalizeText(recoveryAudit.created_at) || nowDate.toISOString();
        const incidentRecoveredMs = Date.parse(incidentRecoveredAt);
        const incidentDurationMinutes = Number.isFinite(latestChangedAt) && Number.isFinite(incidentRecoveredMs)
            ? Math.max(0, Math.round((incidentRecoveredMs - latestChangedAt) / 60000))
            : 0;
        const currentEnabledProviderLabels = getEnabledProviderLabels(paymentChannels);
        const recoverySummary = target.kind === 'active_provider_mock'
            ? `当前活动通道已切回 ${getProviderLabel(currentActiveProvider)}`
            : `${getPaymentSecretLabel(target.secretName)} 已重新补齐`;
        const lines = [
            target.kind === 'active_provider_mock'
                ? '支付活动通道已从模拟支付切回真实支付。'
                : `已检测到 ${getPaymentSecretLabel(target.secretName)} 重新可用。`,
            `恢复结论：${recoverySummary}`,
            `修复动作：${recoveryActionLabel}`,
            `修复人：${recoveryAdminEmail}`
        ];

        if (target.kind === 'active_provider_mock') {
            lines.push(`当前生效通道：${getProviderLabel(currentActiveProvider)}`);
            if (currentEnabledProviderLabels.length) {
                lines.push(`当前启用通道：${currentEnabledProviderLabels.join('、')}`);
            }
        }

        if (target.kind === 'secret_deleted') {
            lines.push(`恢复密钥：${getPaymentSecretLabel(target.secretName)}`);
            if (normalizeText(currentSecret.source)) {
                lines.push(`当前密钥来源：${normalizeText(currentSecret.source) === 'stored' ? '后台密钥库' : (normalizeText(currentSecret.source) === 'environment' ? '环境变量' : normalizeText(currentSecret.source))}`);
            }
            if (normalizeText(currentSecret.updatedAt)) {
                lines.push(`密钥更新时间：${normalizeText(currentSecret.updatedAt)}`);
            }
        }

        if (normalizeText(latestChanged.created_at)) {
            lines.push(`上次风险：${normalizeText(latestChanged.created_at)}`);
        }
        lines.push(`恢复时间：${incidentRecoveredAt}`);
        lines.push(`持续时长：${incidentDurationMinutes} 分钟`);
        if (changedRiskFlags.length) {
            lines.push(`上次风险提示：${changedRiskFlags.join('；')}`);
        }
        lines.push('处理入口：后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计');

        return {
            alertType: 'payment_config_recovered',
            severity: 'warning',
            title: target.kind === 'active_provider_mock'
                ? '支付配置风险已恢复（已切回真实支付）'
                : `支付密钥已补齐（${getPaymentSecretLabel(target.secretName)}）`,
            content: lines.join('\n'),
            payload: {
                target_id: targetId,
                config_alert_job_id: normalizeText(latestChanged.id) || null,
                recovery_audit_id: normalizeText(recoveryAudit.id) || null,
                risk_target_kind: target.kind,
                previous_action_type: normalizeText(changedPayload.action_type) || null,
                previous_action_label: getActionLabel(changedPayload.action_type) || null,
                previous_admin_email: normalizeText(changedPayload.admin_email) || null,
                recovery_action_type: normalizeText(recoveryAudit.action_type) || null,
                recovery_action_label: recoveryActionLabel || null,
                recovery_admin_email: recoveryAdminEmail,
                incident_started_at: normalizeText(latestChanged.created_at) || null,
                incident_recovered_at: incidentRecoveredAt,
                incident_duration_minutes: incidentDurationMinutes,
                recovery_summary: recoverySummary,
                previous_risk_flags: changedRiskFlags,
                previous_active_provider: normalizeText(changedPayload.active_provider) || null,
                previous_active_provider_label: normalizeText(changedPayload.active_provider_label) || getProviderLabel(changedPayload.active_provider) || null,
                current_active_provider: currentActiveProvider || null,
                current_active_provider_label: getProviderLabel(currentActiveProvider) || null,
                current_enabled_provider_labels: currentEnabledProviderLabels,
                restored_secret_name: target.secretName || null,
                restored_secret_label: target.secretName ? getPaymentSecretLabel(target.secretName) : null,
                restored_secret_source: normalizeText(currentSecret.source) || null,
                restored_secret_updated_at: normalizeText(currentSecret.updatedAt) || null,
                entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计'
            },
            allowedChannels: ['feishu'],
            dedupeKey: crypto
                .createHash('sha256')
                .update(`payment_config_recovered:${targetId}:${normalizeText(latestChanged.id) || normalizeText(latestChanged.created_at) || 'unknown'}:${normalizeText(recoveryAudit.id) || normalizeText(recoveryAudit.created_at) || 'unknown'}`)
                .digest('hex'),
            dedupeWindowMinutes: Math.max(60, Number(config.dedupe_window_minutes || DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.dedupe_window_minutes))
        };
    }).filter(Boolean);
}

async function fetchRecentPaymentConfigStateJobs(client, sinceIso, config) {
    const rows = await fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, payload, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true }), config.page_size, config.max_pages);

    return rows.filter((row) => PAYMENT_CONFIG_STATE_TYPES.includes(normalizeText(row.alert_type).toLowerCase()));
}

function buildPaymentConfigChangedAlerts(auditRows = [], rawConfig = {}, options = {}) {
    const config = normalizePaymentConfigChangeMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return (auditRows || [])
        .filter((row) => TRACKED_PAYMENT_CONFIG_ACTIONS.has(normalizeText(row.action_type).toLowerCase()))
        .map((row) => {
            const auditId = normalizeText(row.id);
            if (!auditId) {
                return null;
            }

            const actionType = normalizeText(row.action_type);
            const details = normalizeJsonObject(row.details);
            const adminId = normalizeText(row.admin_id);
            const adminEmail = normalizeText(row.admin_email) || 'unknown-admin';
            const updatedProviders = normalizeStringArray(details.updated_providers);
            const updatedSecrets = normalizeStringArray(details.updated_secrets);
            const activeProvider = normalizeText(details.active_provider).toLowerCase();
            const createdAt = normalizeText(row.created_at);
            const riskFlags = buildRiskFlags(actionType, details);
            const actionLabel = getActionLabel(actionType);
            const title = normalizeText(actionType).toLowerCase() === 'admin.payment_channels.secret.delete'
                ? `支付密钥已删除（${adminEmail}）`
                : `支付配置已变更（${adminEmail}）`;
            const lines = [
                normalizeText(actionType).toLowerCase() === 'admin.payment_channels.secret.delete'
                    ? `${adminEmail} 删除了一项支付密钥配置。`
                    : `${adminEmail} 修改了支付通道配置。`,
                `变更类型：${actionLabel}`
            ];

            if (activeProvider) {
                lines.push(`当前生效通道：${getProviderLabel(activeProvider)}`);
            }
            if (updatedProviders.length) {
                lines.push(`启用通道：${updatedProviders.map((item) => getProviderLabel(item)).join('、')}`);
            }
            if (updatedSecrets.length) {
                lines.push(`更新密钥：${updatedSecrets.join('、')}`);
            }
            if (normalizeText(details.secret_name)) {
                lines.push(`删除密钥：${normalizeText(details.secret_name)}`);
            }
            if (riskFlags.length) {
                lines.push(`风险提示：${riskFlags.join('；')}`);
            }
            if (createdAt) {
                lines.push(`发生时间：${createdAt}`);
            }
            lines.push('处理入口：后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计');

            return {
                alertType: 'payment_config_changed',
                severity: 'critical',
                title,
                content: lines.join('\n'),
                payload: {
                    target_id: auditId,
                    audit_id: auditId,
                    admin_id: adminId || null,
                    admin_email: adminEmail,
                    action_type: actionType || null,
                    action_label: actionLabel || null,
                    active_provider: activeProvider || null,
                    active_provider_label: getProviderLabel(activeProvider) || null,
                    updated_providers: updatedProviders,
                    updated_provider_labels: updatedProviders.map((item) => getProviderLabel(item)).filter(Boolean),
                    updated_secrets: updatedSecrets,
                    secret_name: normalizeText(details.secret_name) || null,
                    risk_flags: riskFlags,
                    created_at: createdAt || nowDate.toISOString(),
                    entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计'
                },
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`payment_config_changed:${auditId}`)
                    .digest('hex'),
                dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.dedupe_window_minutes)
            };
        })
        .filter(Boolean);
}

async function runPaymentConfigChangedSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const config = normalizePaymentConfigChangeMonitorConfig(options.config, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            change_count: 0,
            recovery_count: 0,
            queued: 0,
            deduped: 0,
            recovered_queued: 0,
            recovered_deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            change_count: 0,
            recovery_count: 0,
            queued: 0,
            deduped: 0,
            recovered_queued: 0,
            recovered_deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const recentSinceIso = new Date(nowDate.getTime() - Number(config.recent_window_minutes || DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.recent_window_minutes) * 60 * 1000).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.state_lookback_minutes) * 60 * 1000).toISOString();
    const auditRows = Array.isArray(options.auditRows)
        ? options.auditRows
        : await fetchRecentPaymentAuditRows(supabase, stateSinceIso, config);
    const recentAuditRows = (auditRows || []).filter((row) => Date.parse(normalizeText(row.created_at)) >= Date.parse(recentSinceIso));
    const stateJobs = Array.isArray(options.stateJobs)
        ? options.stateJobs
        : await fetchRecentPaymentConfigStateJobs(supabase, stateSinceIso, config);
    const paymentChannels = options.currentPaymentChannels
        || (await loadStoredPaymentConfigs(supabase)).paymentChannels;
    const secretStatus = options.currentSecretStatus
        || await buildPaymentSecretStatus(supabase, env);
    const alerts = buildPaymentConfigChangedAlerts(recentAuditRows, config, { now: nowDate });
    const recoveryAlerts = buildPaymentConfigRecoveredAlerts(stateJobs, auditRows, paymentChannels, secretStatus, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    let recoveredQueued = 0;
    let recoveredDeduped = 0;
    let recoveredSkippedNoChannels = 0;
    let adminNotificationsCreated = 0;
    let adminNotificationsSkipped = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'payment_config_change_monitor'
        }, {
            runtime,
            env
        });

        if (result?.queued === true) {
            queued += 1;
        } else if (result?.reason === 'deduped') {
            deduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            skippedNoChannels += 1;
        }

        results.push({
            audit_id: alert.payload?.audit_id || null,
            action_type: alert.payload?.action_type || null,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    for (const alert of recoveryAlerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'payment_config_change_monitor'
        }, {
            runtime,
            env
        });

        if (result?.queued === true) {
            recoveredQueued += 1;

            const notificationResult = await notifyActiveAdmins(supabase, {
                title: alert.title,
                content: alert.content,
                type: 'success',
                dedupeWindowMinutes: Math.max(Number(alert.dedupeWindowMinutes || 60), 60)
            });
            adminNotificationsCreated += Number(notificationResult?.created || 0);
            adminNotificationsSkipped += Number(notificationResult?.skipped || 0);
        } else if (result?.reason === 'deduped') {
            recoveredDeduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            recoveredSkippedNoChannels += 1;
        }

        results.push({
            audit_id: alert.payload?.recovery_audit_id || null,
            action_type: alert.payload?.recovery_action_type || null,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    return {
        change_count: alerts.length,
        recovery_count: recoveryAlerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        recovered_queued: recoveredQueued,
        recovered_deduped: recoveredDeduped,
        recovered_skipped_no_channels: recoveredSkippedNoChannels,
        admin_notifications_created: adminNotificationsCreated,
        admin_notifications_skipped: adminNotificationsSkipped,
        results
    };
}

module.exports = {
    DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG,
    buildPaymentConfigChangedAlerts,
    buildPaymentConfigRecoveredAlerts,
    normalizePaymentConfigChangeMonitorConfig,
    runPaymentConfigChangedSweep
};
