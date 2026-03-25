const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    fetchVerifyQuotaSnapshot
} = require('./verify-quota-alerts');

const ACTIVE_VERIFY_STATUSES = Object.freeze(['queued', 'running', 'processing', 'pending']);
const DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    request_timeout_ms: 10000,
    recent_activity_lookback_hours: 12,
    recent_failure_window_minutes: 30,
    queue_size_threshold: 10,
    active_job_threshold: 8,
    oldest_pending_minutes_threshold: 20,
    recent_failure_threshold: 4,
    dedupe_window_minutes: 30,
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

function normalizeVerifyQueueMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.VERIFY_QUEUE_MONITOR_ENABLED, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        request_timeout_ms: normalizeNumber(
            source.request_timeout_ms,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_REQUEST_TIMEOUT_MS, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.request_timeout_ms, 1000, 60 * 1000),
            1000,
            60 * 1000
        ),
        recent_activity_lookback_hours: normalizeNumber(
            source.recent_activity_lookback_hours,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_RECENT_ACTIVITY_LOOKBACK_HOURS, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.recent_activity_lookback_hours, 1, 72),
            1,
            72
        ),
        recent_failure_window_minutes: normalizeNumber(
            source.recent_failure_window_minutes,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_RECENT_FAILURE_WINDOW_MINUTES, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.recent_failure_window_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        queue_size_threshold: normalizeNumber(
            source.queue_size_threshold,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_QUEUE_SIZE_THRESHOLD, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.queue_size_threshold, 1, 100000),
            1,
            100000
        ),
        active_job_threshold: normalizeNumber(
            source.active_job_threshold,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_ACTIVE_JOB_THRESHOLD, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.active_job_threshold, 1, 100000),
            1,
            100000
        ),
        oldest_pending_minutes_threshold: normalizeNumber(
            source.oldest_pending_minutes_threshold,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_OLDEST_PENDING_MINUTES_THRESHOLD, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.oldest_pending_minutes_threshold, 1, 24 * 60),
            1,
            24 * 60
        ),
        recent_failure_threshold: normalizeNumber(
            source.recent_failure_threshold,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_RECENT_FAILURE_THRESHOLD, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.recent_failure_threshold, 1, 100000),
            1,
            100000
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_PAGE_SIZE, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.VERIFY_QUEUE_MONITOR_MAX_PAGES, DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
}

function parseHistoryMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        if (parsed?.kind === 'google_one_job') {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
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

async function fetchActiveVerificationLogs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('verification_logs')
        .select('id, user_id, verification_id, status, message, created_at, site')
        .in('status', ACTIVE_VERIFY_STATUSES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true }), config.page_size, config.max_pages);
}

async function fetchRecentFailedVerificationLogs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('verification_logs')
        .select('id, user_id, verification_id, status, message, created_at, site')
        .eq('status', 'failed')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

function formatMinutesLabel(minutes) {
    const value = Math.max(0, Math.round(Number(minutes || 0)));
    if (value < 60) {
        return `${value} 分钟`;
    }

    const hours = Math.floor(value / 60);
    const remain = value % 60;
    return remain > 0 ? `${hours} 小时 ${remain} 分钟` : `${hours} 小时`;
}

function summarizeTopLabels(values = [], maxItems = 3) {
    const counters = new Map();
    for (const value of values) {
        const normalized = normalizeText(value);
        if (!normalized) continue;
        counters.set(normalized, (counters.get(normalized) || 0) + 1);
    }

    return Array.from(counters.entries())
        .sort((left, right) => {
            if (right[1] !== left[1]) return right[1] - left[1];
            return left[0].localeCompare(right[0]);
        })
        .slice(0, maxItems)
        .map(([label, count]) => `${label} × ${count}`);
}

function getFailureErrorLabel(row = {}) {
    const payload = parseHistoryMessage(row.message) || {};
    return normalizeText(payload.error_message)
        || normalizeText(payload.error_code)
        || normalizeText(payload.stage_label)
        || 'unknown_error';
}

function getActiveTargetLabel(row = {}) {
    const payload = parseHistoryMessage(row.message) || {};
    return normalizeText(payload.email)
        || normalizeText(row.user_id)
        || normalizeText(row.verification_id);
}

function buildVerifyQueueBacklogAlerts(snapshot = {}, activeLogs = [], failedLogs = [], rawConfig = {}, options = {}) {
    const config = normalizeVerifyQueueMonitorConfig(rawConfig);
    if (!snapshot?.ok) {
        return [];
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const queueSize = Math.max(0, Math.round(Number(snapshot.queue_size || 0)));
    const runningJobs = Math.max(0, Math.round(Number(snapshot.running_jobs || 0)));
    const activeJobCount = Array.isArray(activeLogs) ? activeLogs.length : 0;
    const recentFailureCount = Array.isArray(failedLogs) ? failedLogs.length : 0;
    const oldestPendingMs = (activeLogs || []).reduce((maxAge, row) => {
        const createdMs = Date.parse(row.created_at);
        if (!Number.isFinite(createdMs)) return maxAge;
        return Math.max(maxAge, nowDate.getTime() - createdMs);
    }, 0);
    const oldestPendingMinutes = Math.max(0, Math.round(oldestPendingMs / (60 * 1000)));
    const hotTargets = summarizeTopLabels((activeLogs || []).map(getActiveTargetLabel));
    const hotErrors = summarizeTopLabels((failedLogs || []).map(getFailureErrorLabel));
    const reasons = [];

    if (queueSize >= Number(config.queue_size_threshold || 0)) {
        reasons.push(`上游队列已堆积 ${queueSize} 个任务（阈值 ${Math.max(1, Math.round(Number(config.queue_size_threshold || 0)))} 个）`);
    }
    if (activeJobCount >= Number(config.active_job_threshold || 0)) {
        reasons.push(`本地活跃任务 ${activeJobCount} 个（阈值 ${Math.max(1, Math.round(Number(config.active_job_threshold || 0)))} 个）`);
    }
    if (oldestPendingMinutes >= Number(config.oldest_pending_minutes_threshold || 0)) {
        reasons.push(`最老活跃任务已等待 ${formatMinutesLabel(oldestPendingMinutes)}（阈值 ${formatMinutesLabel(config.oldest_pending_minutes_threshold)})`);
    }
    if (recentFailureCount >= Number(config.recent_failure_threshold || 0)) {
        reasons.push(`最近 ${Math.max(1, Math.round(Number(config.recent_failure_window_minutes || 0)))} 分钟失败 ${recentFailureCount} 次（阈值 ${Math.max(1, Math.round(Number(config.recent_failure_threshold || 0)))} 次）`);
    }

    if (!reasons.length) {
        return [];
    }

    const keyLabel = normalizeText(snapshot.key_name);
    const title = `验证任务堆积预警${keyLabel ? `（${keyLabel}）` : ''}`;
    const lines = [
        `${keyLabel || '验证服务'} 当前出现任务堆积或错误放大迹象。`,
        `判定信号：${reasons.join('；')}`,
        `队列概览：上游排队 ${queueSize} 个 / 运行中 ${runningJobs} 个 / 本地活跃 ${activeJobCount} 个`
    ];

    if (oldestPendingMinutes > 0) {
        lines.push(`最老活跃任务：已等待 ${formatMinutesLabel(oldestPendingMinutes)}`);
    }
    if (hotTargets.length) {
        lines.push(`热点目标：${hotTargets.join('、')}`);
    }
    if (hotErrors.length) {
        lines.push(`最近错误：${hotErrors.join('；')}`);
    }
    if (normalizeText(snapshot.queue_error)) {
        lines.push(`队列查询：${normalizeText(snapshot.queue_error)}`);
    }
    if (normalizeText(snapshot.checked_at)) {
        lines.push(`检查时间：${normalizeText(snapshot.checked_at)}`);
    }
    lines.push('处理入口：后台设置 -> 验证服务配置 -> 队列 / 最近任务状态');

    return [{
        alertType: 'verify_queue_backlog',
        severity: 'warning',
        title,
        content: lines.join('\n'),
        payload: {
            target_id: `verify_queue:${normalizeText(snapshot.api_base_url) || 'default'}`,
            key_name: keyLabel || null,
            api_base_url: normalizeText(snapshot.api_base_url) || null,
            queue_size: queueSize,
            running_jobs: runningJobs,
            active_job_count: activeJobCount,
            oldest_pending_minutes: oldestPendingMinutes,
            oldest_pending_label: oldestPendingMinutes > 0 ? formatMinutesLabel(oldestPendingMinutes) : null,
            recent_failure_count: recentFailureCount,
            recent_failure_window_minutes: Math.max(1, Math.round(Number(config.recent_failure_window_minutes || 0))),
            hot_targets: hotTargets,
            hot_errors: hotErrors,
            degraded_reasons: reasons,
            queue_error: normalizeText(snapshot.queue_error) || null,
            checked_at: normalizeText(snapshot.checked_at) || null,
            entry_path: '后台设置 -> 验证服务配置 -> 队列 / 最近任务状态'
        },
        dedupeKey: crypto
            .createHash('sha256')
            .update(`verify_queue_backlog:${queueSize}:${activeJobCount}:${Math.floor(oldestPendingMinutes / 10)}:${recentFailureCount}:${hotErrors.join('|')}`)
            .digest('hex'),
        dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG.dedupe_window_minutes)
    }];
}

async function runVerifyQueueBacklogSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const verifyConfig = options.verifyConfig || {};
    const config = normalizeVerifyQueueMonitorConfig(
        options.config || verifyConfig.queueMonitorConfig,
        env
    );

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            backlog_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            backlog_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const apiBaseUrl = normalizeText(verifyConfig.apiBaseUrl || verifyConfig.api_base_url);
    const apiKey = normalizeText(verifyConfig.apiKey || verifyConfig.api_key);
    if (!apiBaseUrl || !apiKey) {
        return {
            skipped: 'verify_api_not_configured',
            backlog_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const snapshot = await fetchVerifyQuotaSnapshot(verifyConfig, {
        fetchImpl: options.fetchImpl,
        timeoutMs: config.request_timeout_ms,
        now: options.now
    });

    if (!snapshot.ok) {
        return {
            skipped: 'verify_upstream_unavailable',
            backlog_count: 0,
            queued: 0,
            deduped: 0,
            error: normalizeText(snapshot.error) || 'verify_upstream_unavailable'
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const activeSinceIso = new Date(nowDate.getTime() - Number(config.recent_activity_lookback_hours || 0) * 60 * 60 * 1000).toISOString();
    const failedSinceIso = new Date(nowDate.getTime() - Number(config.recent_failure_window_minutes || 0) * 60 * 1000).toISOString();

    const [activeLogs, failedLogs] = await Promise.all([
        fetchActiveVerificationLogs(supabase, activeSinceIso, config),
        fetchRecentFailedVerificationLogs(supabase, failedSinceIso, config)
    ]);

    const alerts = buildVerifyQueueBacklogAlerts(snapshot, activeLogs, failedLogs, config, { now: nowDate });
    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'verify_queue_monitor'
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

    return {
        backlog_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        queue_size: snapshot.queue_size,
        running_jobs: snapshot.running_jobs,
        active_job_count: activeLogs.length,
        recent_failure_count: failedLogs.length,
        results
    };
}

module.exports = {
    ACTIVE_VERIFY_STATUSES,
    DEFAULT_VERIFY_QUEUE_MONITOR_CONFIG,
    buildVerifyQueueBacklogAlerts,
    normalizeVerifyQueueMonitorConfig,
    runVerifyQueueBacklogSweep,
    __testUtils: {
        formatMinutesLabel,
        getActiveTargetLabel,
        getFailureErrorLabel,
        parseHistoryMessage,
        summarizeTopLabels
    }
};
