const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    notifyActiveAdmins
} = require('./admin-notifications');

const VERIFY_INCIDENT_SIGNAL_TYPES = Object.freeze([
    'verify_service_disabled',
    'verify_failure_rate_spike',
    'verify_queue_backlog',
    'verify_quota_low'
]);
const VERIFY_INCIDENT_STATE_TYPES = Object.freeze([
    'verify_incident_escalated',
    'verify_incident_recovered'
]);
const PRIMARY_VERIFY_INCIDENT_SIGNAL_TYPES = Object.freeze([
    'verify_service_disabled',
    'verify_failure_rate_spike'
]);
const DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    lookback_minutes: 30,
    state_lookback_minutes: 24 * 60,
    min_signal_count: 2,
    dedupe_window_minutes: 20,
    page_size: 200,
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

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function formatPercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : '';
}

function formatCreditAmount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(2)} 点` : '';
}

function normalizeVerifyIncidentMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.VERIFY_INCIDENT_MONITOR_ENABLED, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.VERIFY_INCIDENT_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        lookback_minutes: normalizeNumber(
            source.lookback_minutes,
            normalizeNumber(env?.VERIFY_INCIDENT_MONITOR_LOOKBACK_MINUTES, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.lookback_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.VERIFY_INCIDENT_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
        ),
        min_signal_count: normalizeNumber(
            source.min_signal_count,
            normalizeNumber(env?.VERIFY_INCIDENT_MONITOR_MIN_SIGNAL_COUNT, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.min_signal_count, 2, 10),
            2,
            10
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.VERIFY_INCIDENT_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.VERIFY_INCIDENT_MONITOR_PAGE_SIZE, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.page_size, 20, 1000),
            20,
            1000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.VERIFY_INCIDENT_MONITOR_MAX_PAGES, DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
}

async function fetchPagedRows(buildQuery, pageSize = 200, maxPages = 10) {
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

async function fetchRecentVerifySignalJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', VERIFY_INCIDENT_SIGNAL_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentVerifyIncidentStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', VERIFY_INCIDENT_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

function getSignalLabel(alertType) {
    const normalized = normalizeText(alertType).toLowerCase();
    const labelMap = {
        verify_service_disabled: '验证服务停摆',
        verify_failure_rate_spike: '验证失败率飙升',
        verify_queue_backlog: '验证任务堆积',
        verify_quota_low: '验证额度不足'
    };
    return labelMap[normalized] || normalized;
}

function getSignalSummary(job = {}) {
    const payload = normalizeJsonObject(job.payload);
    const alertType = normalizeText(job.alert_type).toLowerCase();

    if (alertType === 'verify_service_disabled') {
        const stateLabel = normalizeText(payload.service_status_label) || '不可用';
        const errorLabel = normalizeText(payload.last_error);
        return errorLabel ? `${stateLabel} / ${errorLabel}` : stateLabel;
    }

    if (alertType === 'verify_failure_rate_spike') {
        const failedJobs = Math.max(0, Math.round(Number(payload.failed_jobs || 0)));
        const totalJobs = Math.max(0, Math.round(Number(payload.total_jobs || 0)));
        const rateLabel = formatPercent(payload.failure_rate);
        return `失败率 ${rateLabel || 'unknown'}（${failedJobs}/${totalJobs}）`;
    }

    if (alertType === 'verify_queue_backlog') {
        return `排队 ${Math.max(0, Math.round(Number(payload.queue_size || 0)))} 个 / 本地活跃 ${Math.max(0, Math.round(Number(payload.active_job_count || 0)))} 个`;
    }

    if (alertType === 'verify_quota_low') {
        const balanceLabel = formatCreditAmount(payload.balance);
        const remainingJobs = Math.max(0, Math.floor(Number(payload.remaining_jobs || 0)));
        return `剩余额度 ${balanceLabel || 'unknown'} / 预计 ${remainingJobs} 次`;
    }

    return normalizeText(job.title);
}

function buildSignalFingerprint(job = {}) {
    const payload = normalizeJsonObject(job.payload);
    const alertType = normalizeText(job.alert_type).toLowerCase();

    if (alertType === 'verify_service_disabled') {
        return [
            alertType,
            normalizeText(payload.service_status),
            normalizeText(payload.last_error),
            String(Number(payload.response_status || 0) || 0)
        ].join(':');
    }

    if (alertType === 'verify_failure_rate_spike') {
        return [
            alertType,
            String(Math.round(Number(payload.failure_rate || 0) * 10)),
            String(Math.max(0, Math.round(Number(payload.failed_jobs || 0)))),
            String(Math.max(0, Math.round(Number(payload.affected_user_count || 0))))
        ].join(':');
    }

    if (alertType === 'verify_queue_backlog') {
        return [
            alertType,
            String(Math.max(0, Math.round(Number(payload.queue_size || 0)))),
            String(Math.max(0, Math.round(Number(payload.active_job_count || 0))))
        ].join(':');
    }

    if (alertType === 'verify_quota_low') {
        return [
            alertType,
            String(Math.round(Number(payload.balance || 0))),
            String(Math.max(0, Math.round(Number(payload.remaining_jobs || 0))))
        ].join(':');
    }

    return alertType;
}

function summarizeSignalTimeline(jobs = []) {
    return jobs.map((job) => {
        const createdAt = normalizeText(job.created_at);
        if (!createdAt) {
            return `${getSignalLabel(job.alert_type)}：unknown`;
        }
        return `${getSignalLabel(job.alert_type)}：${createdAt}`;
    });
}

function getLatestVerifySignalJobs(signalJobs = []) {
    const latestByType = new Map();

    for (const job of signalJobs || []) {
        const alertType = normalizeText(job.alert_type).toLowerCase();
        if (!VERIFY_INCIDENT_SIGNAL_TYPES.includes(alertType)) continue;
        if (!latestByType.has(alertType)) {
            latestByType.set(alertType, job);
        }
    }

    return Array.from(latestByType.values());
}

function getTargetIdFromPayload(payload = {}) {
    const normalizedPayload = normalizeJsonObject(payload);
    const targetId = normalizeText(normalizedPayload.target_id);
    if (targetId) {
        return targetId;
    }

    const keyName = normalizeText(normalizedPayload.key_name);
    const apiBaseUrl = normalizeText(normalizedPayload.api_base_url);
    return `verify_incident:${apiBaseUrl || keyName || 'default'}`;
}

function compareCreatedAtDescending(left = {}, right = {}) {
    const leftTime = Date.parse(normalizeText(left.created_at));
    const rightTime = Date.parse(normalizeText(right.created_at));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function getLatestIncidentStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedTargetId = normalizeText(targetId);
    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === normalizeText(alertType).toLowerCase())
        .filter((job) => !normalizedTargetId || getTargetIdFromPayload(job.payload) === normalizedTargetId)
        .sort(compareCreatedAtDescending)[0] || null;
}

function formatDurationMinutes(totalMinutes) {
    const numeric = Math.max(0, Math.round(Number(totalMinutes || 0)));
    if (numeric >= 60) {
        const hours = Math.floor(numeric / 60);
        const minutes = numeric % 60;
        return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
    }
    return `${numeric} 分钟`;
}

function buildVerifyIncidentEscalationAlerts(signalJobs = [], rawConfig = {}) {
    const config = normalizeVerifyIncidentMonitorConfig(rawConfig);
    const latestJobs = getLatestVerifySignalJobs(signalJobs);
    if (latestJobs.length < Number(config.min_signal_count || 0)) {
        return [];
    }

    const signalTypes = latestJobs.map((job) => normalizeText(job.alert_type).toLowerCase());
    const hasPrimarySignal = signalTypes.some((type) => PRIMARY_VERIFY_INCIDENT_SIGNAL_TYPES.includes(type));
    if (!hasPrimarySignal) {
        return [];
    }

    const representativePayload = latestJobs
        .map((job) => normalizeJsonObject(job.payload))
        .find((payload) => normalizeText(payload.key_name) || normalizeText(payload.api_base_url)) || {};
    const keyName = normalizeText(representativePayload.key_name);
    const apiBaseUrl = normalizeText(representativePayload.api_base_url);
    const signalLabels = latestJobs.map((job) => getSignalLabel(job.alert_type));
    const signalSummaries = latestJobs.map(getSignalSummary).filter(Boolean);
    const signalTimeline = summarizeSignalTimeline(latestJobs);
    const latestSignalAt = latestJobs.reduce((latest, job) => {
        const createdAt = normalizeText(job.created_at);
        if (!createdAt) return latest;
        if (!latest) return createdAt;
        return Date.parse(createdAt) > Date.parse(latest) ? createdAt : latest;
    }, '');

    const title = `验证综合异常升级${keyName ? `（${keyName}）` : ''}`;
    const lines = [
        `${keyName || '验证服务'} 在最近 ${Math.max(1, Math.round(Number(config.lookback_minutes || 0)))} 分钟内同时命中多类高风险信号，建议立即人工介入。`,
        `升级信号：${signalLabels.join('、')}`,
        `命中数量：${latestJobs.length} 类`
    ];

    if (apiBaseUrl) {
        lines.push(`API Base：${apiBaseUrl}`);
    }
    if (signalSummaries.length) {
        lines.push(`关键摘要：${signalSummaries.join('；')}`);
    }
    if (signalTimeline.length) {
        lines.push(`最近触发：${signalTimeline.join('；')}`);
    }
    if (latestSignalAt) {
        lines.push(`最新时间：${latestSignalAt}`);
    }
    lines.push('处理入口：后台设置 -> 验证服务配置 -> 当前额度 / 接口状态 / 队列状态 / 最近失败');

    const fingerprint = latestJobs
        .map(buildSignalFingerprint)
        .sort()
        .join('|');

    return [{
        alertType: 'verify_incident_escalated',
        severity: 'critical',
        title,
        content: lines.join('\n'),
        payload: {
            target_id: `verify_incident:${apiBaseUrl || keyName || 'default'}`,
            key_name: keyName || null,
            api_base_url: apiBaseUrl || null,
            lookback_minutes: Math.max(1, Math.round(Number(config.lookback_minutes || 0))),
            triggered_signal_count: latestJobs.length,
            signal_types: signalTypes,
            signal_labels: signalLabels,
            signal_summaries: signalSummaries,
            signal_timeline: signalTimeline,
            latest_signal_at: latestSignalAt || null,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 接口状态 / 队列状态 / 最近失败'
        },
        dedupeKey: crypto
            .createHash('sha256')
            .update(`verify_incident_escalated:${apiBaseUrl || keyName || 'default'}:${fingerprint}`)
            .digest('hex'),
        dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.dedupe_window_minutes)
    }];
}

function buildVerifyIncidentRecoveryAlerts(signalJobs = [], stateJobs = [], rawConfig = {}, options = {}) {
    const config = normalizeVerifyIncidentMonitorConfig(rawConfig);
    const activeSignalJobs = getLatestVerifySignalJobs(signalJobs);
    const activeEscalationAlerts = buildVerifyIncidentEscalationAlerts(signalJobs, config);
    if (activeEscalationAlerts.length) {
        return [];
    }

    const latestEscalated = getLatestIncidentStateJob(stateJobs, 'verify_incident_escalated');
    if (!latestEscalated) {
        return [];
    }

    const incidentPayload = normalizeJsonObject(latestEscalated.payload);
    const targetId = getTargetIdFromPayload(incidentPayload);
    const latestRecovered = getLatestIncidentStateJob(stateJobs, 'verify_incident_recovered', targetId);
    const latestEscalatedAt = Date.parse(normalizeText(latestEscalated.created_at));
    const latestRecoveredAt = Date.parse(normalizeText(latestRecovered?.created_at));

    if (Number.isFinite(latestEscalatedAt) && Number.isFinite(latestRecoveredAt) && latestRecoveredAt >= latestEscalatedAt) {
        return [];
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const keyName = normalizeText(incidentPayload.key_name);
    const apiBaseUrl = normalizeText(incidentPayload.api_base_url);
    const activeSignalLabels = activeSignalJobs.map((job) => getSignalLabel(job.alert_type));
    const activeSignalSummaries = activeSignalJobs.map(getSignalSummary).filter(Boolean);
    const incidentStartedAt = normalizeText(latestEscalated.created_at);
    const incidentRecoveredAt = nowDate.toISOString();
    const incidentDurationMinutes = Number.isFinite(latestEscalatedAt)
        ? Math.max(0, Math.round((nowDate.getTime() - latestEscalatedAt) / 60000))
        : 0;
    const recoverySummary = activeSignalLabels.length
        ? `验证综合高危组合已解除，当前仍保留 ${activeSignalLabels.length} 类低优先级信号`
        : '验证综合高危组合已解除，当前未发现持续中的验证异常信号';
    const lines = [
        `${keyName || '验证服务'} 的综合高危组合已退出升级状态，可从应急排障切回观察模式。`,
        `恢复结论：${recoverySummary}`
    ];

    if (apiBaseUrl) {
        lines.push(`API Base：${apiBaseUrl}`);
    }
    if (incidentStartedAt) {
        lines.push(`上次升级：${incidentStartedAt}`);
    }
    lines.push(`恢复时间：${incidentRecoveredAt}`);
    lines.push(`持续时长：${formatDurationMinutes(incidentDurationMinutes)}`);
    if (activeSignalLabels.length) {
        lines.push(`当前仍有信号：${activeSignalLabels.join('、')}`);
    }
    if (activeSignalSummaries.length) {
        lines.push(`当前摘要：${activeSignalSummaries.join('；')}`);
    }
    lines.push('处理入口：后台设置 -> 验证服务配置 -> 当前额度 / 接口状态 / 队列状态 / 最近失败');

    return [{
        alertType: 'verify_incident_recovered',
        severity: 'warning',
        title: `验证综合异常已恢复${keyName ? `（${keyName}）` : ''}`,
        content: lines.join('\n'),
        payload: {
            target_id: targetId,
            key_name: keyName || null,
            api_base_url: apiBaseUrl || null,
            incident_alert_job_id: normalizeText(latestEscalated.id) || null,
            incident_started_at: incidentStartedAt || null,
            incident_recovered_at: incidentRecoveredAt,
            incident_duration_minutes: incidentDurationMinutes,
            recovery_summary: recoverySummary,
            active_signal_count: activeSignalLabels.length,
            active_signal_types: activeSignalJobs.map((job) => normalizeText(job.alert_type).toLowerCase()).filter(Boolean),
            active_signal_labels: activeSignalLabels,
            active_signal_summaries: activeSignalSummaries,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 接口状态 / 队列状态 / 最近失败'
        },
        allowedChannels: ['feishu'],
        dedupeKey: crypto
            .createHash('sha256')
            .update(`verify_incident_recovered:${targetId}:${normalizeText(latestEscalated.id) || incidentStartedAt || 'unknown'}`)
            .digest('hex'),
        dedupeWindowMinutes: Math.max(
            Number(config.dedupe_window_minutes || DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG.dedupe_window_minutes),
            60
        )
    }];
}

async function runVerifyIncidentEscalationSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const verifyConfig = options.verifyConfig || {};
    const config = normalizeVerifyIncidentMonitorConfig(
        options.config || verifyConfig.incidentMonitorConfig,
        env
    );

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            incident_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            incident_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.lookback_minutes || 0) * 60 * 1000).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || 0) * 60 * 1000).toISOString();
    const signalJobs = await fetchRecentVerifySignalJobs(supabase, sinceIso, config);
    const stateJobs = await fetchRecentVerifyIncidentStateJobs(supabase, stateSinceIso, config);
    const alerts = buildVerifyIncidentEscalationAlerts(signalJobs, config);
    const recoveryAlerts = buildVerifyIncidentRecoveryAlerts(signalJobs, stateJobs, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    let recoveryQueued = 0;
    let recoveryDeduped = 0;
    let recoverySkippedNoChannels = 0;
    let adminNotificationsCreated = 0;
    let adminNotificationsSkipped = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: nowDate.toISOString(),
            source: 'verify_incident_monitor'
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
            title: alert.title,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    for (const alert of recoveryAlerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: nowDate.toISOString(),
            source: 'verify_incident_monitor'
        }, {
            runtime,
            env
        });

        if (result?.queued === true) {
            recoveryQueued += 1;
        } else if (result?.reason === 'deduped') {
            recoveryDeduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            recoverySkippedNoChannels += 1;
        }

        const adminNotificationResult = await notifyActiveAdmins(supabase, {
            title: alert.title,
            content: alert.content,
            type: 'success',
            dedupeWindowMinutes: Math.max(
                Number(alert.dedupeWindowMinutes || 0),
                60
            )
        }).catch((error) => ({
            error: error.message || 'notify_failed'
        }));

        adminNotificationsCreated += Number(adminNotificationResult?.created || 0);
        adminNotificationsSkipped += Number(adminNotificationResult?.skipped || 0);

        results.push({
            title: alert.title,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null,
            admin_notification_created: Number(adminNotificationResult?.created || 0),
            admin_notification_error: normalizeText(adminNotificationResult?.error) || null
        });
    }

    return {
        incident_count: alerts.length,
        recovered_count: recoveryAlerts.length,
        queued,
        deduped,
        recovered_queued: recoveryQueued,
        recovered_deduped: recoveryDeduped,
        skipped_no_channels: skippedNoChannels,
        recovered_skipped_no_channels: recoverySkippedNoChannels,
        admin_notifications_created: adminNotificationsCreated,
        admin_notifications_skipped: adminNotificationsSkipped,
        signal_job_count: signalJobs.length,
        state_job_count: stateJobs.length,
        results
    };
}

module.exports = {
    DEFAULT_VERIFY_INCIDENT_MONITOR_CONFIG,
    PRIMARY_VERIFY_INCIDENT_SIGNAL_TYPES,
    VERIFY_INCIDENT_SIGNAL_TYPES,
    VERIFY_INCIDENT_STATE_TYPES,
    buildVerifyIncidentEscalationAlerts,
    buildVerifyIncidentRecoveryAlerts,
    normalizeVerifyIncidentMonitorConfig,
    runVerifyIncidentEscalationSweep,
    __testUtils: {
        buildSignalFingerprint,
        formatDurationMinutes,
        getLatestIncidentStateJob,
        getLatestVerifySignalJobs,
        getSignalLabel,
        getSignalSummary,
        getTargetIdFromPayload,
        summarizeSignalTimeline
    }
};
