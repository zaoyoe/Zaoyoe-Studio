const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const TRACKED_PAYMENT_CONFIG_ACTIONS = new Set([
    'admin.payment_channels.upsert',
    'admin.payment_channels.secret.delete'
]);

const DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    recent_window_minutes: 20,
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
            lines.push('处理入口：后台设置 -> 支付通道配置 / Admin Audit Logs');

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
                    entry_path: '后台设置 -> 支付通道配置 / Admin Audit Logs'
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
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            change_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.recent_window_minutes || DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG.recent_window_minutes) * 60 * 1000).toISOString();
    const auditRows = await fetchRecentPaymentAuditRows(supabase, sinceIso, config);
    const alerts = buildPaymentConfigChangedAlerts(auditRows, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
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

    return {
        change_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        results
    };
}

module.exports = {
    DEFAULT_PAYMENT_CONFIG_CHANGE_MONITOR_CONFIG,
    buildPaymentConfigChangedAlerts,
    normalizePaymentConfigChangeMonitorConfig,
    runPaymentConfigChangedSweep
};
