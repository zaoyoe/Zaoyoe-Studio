const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const TERMINAL_VERIFY_STATUSES = Object.freeze(['success', 'failed']);
const DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    recent_window_minutes: 30,
    min_total_jobs_threshold: 6,
    failure_rate_threshold: 60,
    affected_user_threshold: 3,
    dedupe_window_minutes: 15,
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

function formatPercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : '';
}

function normalizeVerifyFailureMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.VERIFY_FAILURE_MONITOR_ENABLED, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        recent_window_minutes: normalizeNumber(
            source.recent_window_minutes,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_RECENT_WINDOW_MINUTES, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.recent_window_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        min_total_jobs_threshold: normalizeNumber(
            source.min_total_jobs_threshold,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_MIN_TOTAL_JOBS_THRESHOLD, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.min_total_jobs_threshold, 1, 100000),
            1,
            100000
        ),
        failure_rate_threshold: normalizeNumber(
            source.failure_rate_threshold,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_FAILURE_RATE_THRESHOLD, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.failure_rate_threshold, 1, 100),
            1,
            100
        ),
        affected_user_threshold: normalizeNumber(
            source.affected_user_threshold,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_AFFECTED_USER_THRESHOLD, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.affected_user_threshold, 1, 100000),
            1,
            100000
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_PAGE_SIZE, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.VERIFY_FAILURE_MONITOR_MAX_PAGES, DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.max_pages, 1, 100),
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

async function fetchRecentVerificationResults(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('verification_logs')
        .select('id, user_id, verification_id, status, message, created_at, site')
        .in('status', TERMINAL_VERIFY_STATUSES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
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

function getFailureUserLabel(row = {}) {
    const payload = parseHistoryMessage(row.message) || {};
    return normalizeText(payload.email)
        || normalizeText(row.user_id)
        || normalizeText(row.verification_id)
        || 'unknown_user';
}

function getFailureErrorLabel(row = {}) {
    const payload = parseHistoryMessage(row.message) || {};
    return normalizeText(payload.error_message)
        || normalizeText(payload.error_code)
        || normalizeText(payload.stage_label)
        || 'unknown_error';
}

function buildVerifyFailureRateSpikeAlerts(snapshot = {}, recentLogs = [], rawConfig = {}) {
    const config = normalizeVerifyFailureMonitorConfig(rawConfig);
    const totalJobs = Array.isArray(recentLogs) ? recentLogs.length : 0;
    if (totalJobs < Number(config.min_total_jobs_threshold || 0)) {
        return [];
    }

    const failedLogs = (recentLogs || []).filter((row) => normalizeText(row.status).toLowerCase() === 'failed');
    const failedJobs = failedLogs.length;
    if (failedJobs <= 0) {
        return [];
    }

    const successJobs = Math.max(0, totalJobs - failedJobs);
    const failureRate = Math.round((failedJobs / totalJobs) * 10000) / 100;
    const affectedUsers = Array.from(new Set(failedLogs.map(getFailureUserLabel).filter(Boolean)));
    const affectedUserCount = affectedUsers.length;
    const affectedUserLabels = summarizeTopLabels(failedLogs.map(getFailureUserLabel));
    const hotErrors = summarizeTopLabels(failedLogs.map(getFailureErrorLabel));
    const reasons = [];

    if (failureRate >= Number(config.failure_rate_threshold || 0)) {
        reasons.push(`最近 ${Math.max(1, Math.round(Number(config.recent_window_minutes || 0)))} 分钟失败率 ${formatPercent(failureRate)}（${failedJobs}/${totalJobs}，阈值 ${formatPercent(config.failure_rate_threshold)}）`);
    }
    if (affectedUserCount >= Number(config.affected_user_threshold || 0)) {
        reasons.push(`受影响用户 ${affectedUserCount} 人（阈值 ${Math.max(1, Math.round(Number(config.affected_user_threshold || 0)))} 人）`);
    }

    if (!reasons.length) {
        return [];
    }

    const keyLabel = normalizeText(snapshot.key_name);
    const title = `验证失败率异常${keyLabel ? `（${keyLabel}）` : ''}`;
    const lines = [
        `${keyLabel || '验证服务'} 最近出现失败率异常飙升，可能已经影响真实用户验证。`,
        `判定信号：${reasons.join('；')}`,
        `任务概览：最近 ${Math.max(1, Math.round(Number(config.recent_window_minutes || 0)))} 分钟总 ${totalJobs} 次 / 失败 ${failedJobs} 次 / 成功 ${successJobs} 次 / 失败率 ${formatPercent(failureRate)}`
    ];

    if (affectedUserLabels.length) {
        lines.push(`受影响用户：${affectedUserLabels.join('、')}`);
    }
    if (hotErrors.length) {
        lines.push(`最近错误：${hotErrors.join('；')}`);
    }
    if (normalizeText(snapshot.checked_at)) {
        lines.push(`检查时间：${normalizeText(snapshot.checked_at)}`);
    }
    lines.push('处理入口：后台设置 -> 验证服务配置 -> 最近任务 / 最近失败');

    return [{
        alertType: 'verify_failure_rate_spike',
        severity: 'critical',
        title,
        content: lines.join('\n'),
        payload: {
            target_id: `verify_failure:${normalizeText(snapshot.api_base_url) || keyLabel || 'default'}`,
            key_name: keyLabel || null,
            api_base_url: normalizeText(snapshot.api_base_url) || null,
            monitor_window_minutes: Math.max(1, Math.round(Number(config.recent_window_minutes || 0))),
            total_jobs: totalJobs,
            failed_jobs: failedJobs,
            success_jobs: successJobs,
            failure_rate: failureRate,
            affected_user_count: affectedUserCount,
            affected_user_labels: affectedUserLabels,
            hot_errors: hotErrors,
            degraded_reasons: reasons,
            checked_at: normalizeText(snapshot.checked_at) || null,
            entry_path: '后台设置 -> 验证服务配置 -> 最近任务 / 最近失败'
        },
        dedupeKey: crypto
            .createHash('sha256')
            .update(`verify_failure_rate_spike:${normalizeText(snapshot.api_base_url) || keyLabel || 'default'}:${Math.round(failureRate * 10)}:${failedJobs}:${affectedUserCount}:${hotErrors.join('|')}`)
            .digest('hex'),
        dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG.dedupe_window_minutes)
    }];
}

async function runVerifyFailureRateSpikeSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const verifyConfig = options.verifyConfig || {};
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    const runtimeMonitorConfig = runtime?.config?.verify_failure && typeof runtime.config.verify_failure === 'object'
        ? runtime.config.verify_failure
        : {};
    const config = normalizeVerifyFailureMonitorConfig({
        ...(verifyConfig.failureMonitorConfig && typeof verifyConfig.failureMonitorConfig === 'object' ? verifyConfig.failureMonitorConfig : {}),
        ...(options.config && typeof options.config === 'object' ? options.config : {}),
        ...runtimeMonitorConfig
    }, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            spike_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            spike_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const apiBaseUrl = normalizeText(verifyConfig.apiBaseUrl || verifyConfig.api_base_url);
    const apiKey = normalizeText(verifyConfig.apiKey || verifyConfig.api_key);
    if (!apiBaseUrl || !apiKey) {
        return {
            skipped: 'verify_api_not_configured',
            spike_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(nowDate.getTime() - Number(config.recent_window_minutes || 0) * 60 * 1000).toISOString();
    const recentLogs = await fetchRecentVerificationResults(supabase, sinceIso, config);
    const alerts = buildVerifyFailureRateSpikeAlerts({
        key_name: normalizeText(verifyConfig.keyName || verifyConfig.key_name),
        api_base_url: apiBaseUrl,
        checked_at: nowDate.toISOString()
    }, recentLogs, config);

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'verify_failure_monitor'
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
        spike_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        total_jobs: recentLogs.length,
        failed_jobs: recentLogs.filter((row) => normalizeText(row.status).toLowerCase() === 'failed').length,
        results
    };
}

module.exports = {
    DEFAULT_VERIFY_FAILURE_MONITOR_CONFIG,
    TERMINAL_VERIFY_STATUSES,
    buildVerifyFailureRateSpikeAlerts,
    normalizeVerifyFailureMonitorConfig,
    runVerifyFailureRateSpikeSweep,
    __testUtils: {
        getFailureErrorLabel,
        getFailureUserLabel,
        parseHistoryMessage,
        summarizeTopLabels
    }
};
