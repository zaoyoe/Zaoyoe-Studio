const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 15 * 60 * 1000,
    request_timeout_ms: 10000,
    low_balance_threshold: 20,
    low_remaining_jobs_threshold: 20,
    critical_balance_threshold: 5,
    critical_remaining_jobs_threshold: 5,
    min_queue_buffer_jobs: 5,
    dedupe_window_minutes: 6 * 60
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

function roundNumber(value, digits = 2) {
    const multiplier = 10 ** digits;
    return Math.round(normalizeNumber(value, 0) * multiplier) / multiplier;
}

function normalizeVerifyQuotaMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(source.enabled, normalizeBoolean(env?.VERIFY_QUOTA_MONITOR_ENABLED, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.enabled)),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        request_timeout_ms: normalizeNumber(
            source.request_timeout_ms,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_REQUEST_TIMEOUT_MS, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.request_timeout_ms, 1000, 60 * 1000),
            1000,
            60 * 1000
        ),
        low_balance_threshold: normalizeNumber(
            source.low_balance_threshold,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_LOW_BALANCE_THRESHOLD, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.low_balance_threshold, 0, 1000000),
            0,
            1000000
        ),
        low_remaining_jobs_threshold: normalizeNumber(
            source.low_remaining_jobs_threshold,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_LOW_REMAINING_JOBS_THRESHOLD, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.low_remaining_jobs_threshold, 0, 1000000),
            0,
            1000000
        ),
        critical_balance_threshold: normalizeNumber(
            source.critical_balance_threshold,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_CRITICAL_BALANCE_THRESHOLD, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.critical_balance_threshold, 0, 1000000),
            0,
            1000000
        ),
        critical_remaining_jobs_threshold: normalizeNumber(
            source.critical_remaining_jobs_threshold,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_CRITICAL_REMAINING_JOBS_THRESHOLD, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.critical_remaining_jobs_threshold, 0, 1000000),
            0,
            1000000
        ),
        min_queue_buffer_jobs: normalizeNumber(
            source.min_queue_buffer_jobs,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_MIN_QUEUE_BUFFER_JOBS, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.min_queue_buffer_jobs, 0, 1000000),
            0,
            1000000
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.VERIFY_QUOTA_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        )
    };
}

function pickNumeric(data, keys = [], fallback = null) {
    for (const key of keys) {
        const value = Number(data?.[key]);
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
}

function buildFetchOptions(timeoutMs) {
    const normalizedTimeout = Math.max(1000, Number(timeoutMs || DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.request_timeout_ms));
    const options = {};
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        options.signal = AbortSignal.timeout(normalizedTimeout);
    }
    return options;
}

async function fetchJson(url, {
    apiKey,
    fetchImpl = global.fetch,
    timeoutMs = DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.request_timeout_ms
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Fetch is unavailable');
    }

    const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
            'X-API-Key': apiKey
        },
        ...buildFetchOptions(timeoutMs)
    });

    const rawBody = await response.text().catch(() => '');
    let payload = {};

    if (rawBody) {
        try {
            payload = JSON.parse(rawBody);
        } catch (error) {
            payload = {
                raw: rawBody
            };
        }
    }

    return {
        ok: response.ok,
        status: Number(response.status || 0),
        data: payload,
        rawBody
    };
}

function buildErrorMessage(result, fallback) {
    const payload = result?.data;
    return normalizeText(
        payload?.message
        || payload?.error
        || payload?.detail
        || payload?.raw
        || fallback
    );
}

async function fetchVerifyQuotaSnapshot(verifyConfig = {}, options = {}) {
    const apiBaseUrl = String(verifyConfig.apiBaseUrl || verifyConfig.api_base_url || '').replace(/\/+$/, '');
    const apiKey = normalizeText(verifyConfig.apiKey || verifyConfig.api_key);

    if (!apiBaseUrl || !apiKey) {
        return {
            ok: false,
            error: 'verify_api_not_configured'
        };
    }

    const balanceResult = await fetchJson(`${apiBaseUrl}/api/balance`, {
        apiKey,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs
    });

    if (!balanceResult.ok) {
        return {
            ok: false,
            error: buildErrorMessage(balanceResult, `balance_http_${balanceResult.status || 0}`),
            status: balanceResult.status,
            balance_result: balanceResult
        };
    }

    let queueResult = null;
    let queueError = '';
    try {
        queueResult = await fetchJson(`${apiBaseUrl}/api/queue`, {
            apiKey,
            fetchImpl: options.fetchImpl,
            timeoutMs: options.timeoutMs
        });
        if (!queueResult.ok) {
            queueError = buildErrorMessage(queueResult, `queue_http_${queueResult.status || 0}`);
        }
    } catch (error) {
        queueError = normalizeText(error?.message) || 'queue_request_failed';
    }

    const balanceData = balanceResult.data || {};
    const queueData = queueResult?.data || {};
    const balance = roundNumber(pickNumeric(balanceData, ['balance', 'credits'], 0), 2);
    const totalUsed = roundNumber(pickNumeric(balanceData, ['total_used', 'used', 'totalUsed'], 0), 2);
    const costPerJob = Math.max(0.000001, roundNumber(pickNumeric(balanceData, ['cost_per_job', 'costPerJob'], 1), 4));
    const remainingJobs = Math.max(0, Math.floor(balance / costPerJob));
    const queueSize = Math.max(0, Math.round(pickNumeric(queueData, ['queue_size', 'queued_jobs', 'pending_jobs', 'pending'], 0) || 0));
    const runningJobs = Math.max(0, Math.round(pickNumeric(queueData, ['running_jobs', 'processing_jobs', 'active_jobs', 'running'], 0) || 0));

    return {
        ok: true,
        api_base_url: apiBaseUrl,
        key_name: normalizeText(balanceData.name || balanceData.key_name || balanceData.keyName),
        balance,
        credits: balance,
        total_used: totalUsed,
        cost_per_job: costPerJob,
        remaining_jobs: remainingJobs,
        queue_size: queueSize,
        running_jobs: runningJobs,
        queue_error: queueError || '',
        checked_at: new Date(options.now || Date.now()).toISOString()
    };
}

function formatCreditAmount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(2)} 点` : '';
}

function buildVerifyQuotaReasons(snapshot = {}, config = {}) {
    const reasons = [];
    const balance = Number(snapshot.balance || 0);
    const remainingJobs = Number(snapshot.remaining_jobs || 0);
    const queueSize = Number(snapshot.queue_size || 0);
    const runningJobs = Number(snapshot.running_jobs || 0);

    if (balance <= Number(config.low_balance_threshold || 0)) {
        reasons.push(`剩余额度 ${formatCreditAmount(balance)}（阈值 ${formatCreditAmount(config.low_balance_threshold)}）`);
    }

    if (remainingJobs <= Number(config.low_remaining_jobs_threshold || 0)) {
        reasons.push(`预计仅可继续 ${Math.max(0, Math.floor(remainingJobs))} 次验证（阈值 ${Math.max(0, Math.floor(Number(config.low_remaining_jobs_threshold || 0)))} 次）`);
    }

    if ((queueSize > 0 || runningJobs > 0) && remainingJobs <= (queueSize + runningJobs + Number(config.min_queue_buffer_jobs || 0))) {
        reasons.push(`剩余额度仅够覆盖约 ${Math.max(0, Math.floor(remainingJobs))} 次验证，当前队列 ${queueSize} 个、运行中 ${runningJobs} 个`);
    }

    return reasons;
}

function buildVerifyQuotaLowAlerts(snapshot = {}, rawConfig = {}) {
    const config = normalizeVerifyQuotaMonitorConfig(rawConfig);
    if (!snapshot?.ok) {
        return [];
    }

    const reasons = buildVerifyQuotaReasons(snapshot, config);
    if (!reasons.length) {
        return [];
    }

    const balance = Number(snapshot.balance || 0);
    const remainingJobs = Number(snapshot.remaining_jobs || 0);
    const severity = (
        balance <= Number(config.critical_balance_threshold || 0)
        || remainingJobs <= Number(config.critical_remaining_jobs_threshold || 0)
    ) ? 'critical' : 'warning';

    const keyLabel = normalizeText(snapshot.key_name);
    const title = `验证额度不足预警${keyLabel ? `（${keyLabel}）` : ''}`;
    const lines = [
        `${keyLabel || '当前验证 API Key'} 的剩余额度已接近风险阈值。`,
        `判定信号：${reasons.join('；')}`,
        `额度概览：剩余 ${formatCreditAmount(snapshot.balance)} / 单次成本 ${formatCreditAmount(snapshot.cost_per_job)} / 预计剩余 ${Math.max(0, Math.floor(snapshot.remaining_jobs || 0))} 次 / 已累计消耗 ${formatCreditAmount(snapshot.total_used)}`
    ];

    if (Number.isFinite(Number(snapshot.queue_size)) || Number.isFinite(Number(snapshot.running_jobs))) {
        lines.push(`队列概览：排队 ${Math.max(0, Math.round(Number(snapshot.queue_size || 0)))} 个 / 运行中 ${Math.max(0, Math.round(Number(snapshot.running_jobs || 0)))} 个`);
    }

    if (normalizeText(snapshot.queue_error)) {
        lines.push(`队列查询：${normalizeText(snapshot.queue_error)}`);
    }

    lines.push('处理入口：后台设置 -> 验证服务配置 -> 当前额度 / 队列状态');

    const targetId = `verify_quota:${keyLabel || 'default'}`;
    return [{
        alertType: 'verify_quota_low',
        severity,
        title,
        content: lines.join('\n'),
        payload: {
            target_id: targetId,
            key_name: keyLabel || null,
            balance: balance,
            credits: balance,
            total_used: Number(snapshot.total_used || 0),
            cost_per_job: Number(snapshot.cost_per_job || 0),
            remaining_jobs: Math.max(0, Math.floor(remainingJobs)),
            queue_size: Math.max(0, Math.round(Number(snapshot.queue_size || 0))),
            running_jobs: Math.max(0, Math.round(Number(snapshot.running_jobs || 0))),
            queue_error: normalizeText(snapshot.queue_error) || null,
            checked_at: normalizeText(snapshot.checked_at) || null,
            low_balance_threshold: Number(config.low_balance_threshold || 0),
            low_remaining_jobs_threshold: Number(config.low_remaining_jobs_threshold || 0),
            critical_balance_threshold: Number(config.critical_balance_threshold || 0),
            critical_remaining_jobs_threshold: Number(config.critical_remaining_jobs_threshold || 0),
            degraded_reasons: reasons,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态'
        },
        dedupeKey: crypto
            .createHash('sha256')
            .update(`verify_quota_low:${keyLabel || 'default'}:${severity}`)
            .digest('hex'),
        dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG.dedupe_window_minutes)
    }];
}

async function runVerifyQuotaLowSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const verifyConfig = options.verifyConfig || {};
    const config = normalizeVerifyQuotaMonitorConfig(
        options.config || verifyConfig.monitorConfig,
        env
    );

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            low_quota_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            low_quota_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    if (!normalizeText(verifyConfig.apiKey || verifyConfig.api_key) || !normalizeText(verifyConfig.apiBaseUrl || verifyConfig.api_base_url)) {
        return {
            skipped: 'verify_api_not_configured',
            low_quota_count: 0,
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
            low_quota_count: 0,
            queued: 0,
            deduped: 0,
            error: normalizeText(snapshot.error) || 'verify_upstream_unavailable'
        };
    }

    const alerts = buildVerifyQuotaLowAlerts(snapshot, config);
    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'verify_quota_monitor'
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
        low_quota_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        balance: snapshot.balance,
        remaining_jobs: snapshot.remaining_jobs,
        queue_size: snapshot.queue_size,
        running_jobs: snapshot.running_jobs,
        results
    };
}

module.exports = {
    DEFAULT_VERIFY_QUOTA_MONITOR_CONFIG,
    buildVerifyQuotaLowAlerts,
    fetchVerifyQuotaSnapshot,
    normalizeVerifyQuotaMonitorConfig,
    runVerifyQuotaLowSweep,
    __testUtils: {
        buildVerifyQuotaReasons,
        buildErrorMessage,
        pickNumeric
    }
};
