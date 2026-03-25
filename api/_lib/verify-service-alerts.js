const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    fetchVerifyQuotaSnapshot
} = require('./verify-quota-alerts');

const DEFAULT_VERIFY_SERVICE_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    request_timeout_ms: 10000,
    dedupe_window_minutes: 15
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

function normalizeVerifyServiceMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.VERIFY_SERVICE_MONITOR_ENABLED, DEFAULT_VERIFY_SERVICE_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.VERIFY_SERVICE_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_VERIFY_SERVICE_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        request_timeout_ms: normalizeNumber(
            source.request_timeout_ms,
            normalizeNumber(env?.VERIFY_SERVICE_MONITOR_REQUEST_TIMEOUT_MS, DEFAULT_VERIFY_SERVICE_MONITOR_CONFIG.request_timeout_ms, 1000, 60 * 1000),
            1000,
            60 * 1000
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.VERIFY_SERVICE_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_VERIFY_SERVICE_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        )
    };
}

function buildMissingConfigMessage(apiBaseUrl, apiKey) {
    if (!apiBaseUrl && !apiKey) {
        return '未配置验证 API Base URL 和 API Key';
    }
    if (!apiBaseUrl) {
        return '未配置验证 API Base URL';
    }
    if (!apiKey) {
        return '未配置验证 API Key';
    }
    return '验证服务配置不完整';
}

function getStatusLabel(status) {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === 'unconfigured') return '未配置';
    if (normalized === 'auth_failed') return '凭证异常';
    return '服务不可用';
}

function getStatusTitle(status, keyName) {
    const suffix = normalizeText(keyName) ? `（${normalizeText(keyName)}）` : '';
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === 'unconfigured') {
        return `验证服务未配置${suffix}`;
    }
    if (normalized === 'auth_failed') {
        return `验证服务凭证异常${suffix}`;
    }
    return `验证服务不可用${suffix}`;
}

function getStatusSummary(status) {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === 'unconfigured') {
        return '验证服务当前未完成配置，新的验证请求将无法正常创建。';
    }
    if (normalized === 'auth_failed') {
        return '验证服务当前无法通过上游鉴权校验，新的验证请求将无法正常创建。';
    }
    return '验证服务当前不可用，新的验证请求将无法正常创建。';
}

async function fetchVerifyServiceStatus(verifyConfig = {}, options = {}) {
    const apiBaseUrl = String(verifyConfig.apiBaseUrl || verifyConfig.api_base_url || '').trim().replace(/\/+$/, '');
    const apiKey = normalizeText(verifyConfig.apiKey || verifyConfig.api_key);
    const checkedAt = new Date(options.now || Date.now()).toISOString();

    if (!apiBaseUrl || !apiKey) {
        return {
            ok: false,
            status: 'unconfigured',
            status_label: getStatusLabel('unconfigured'),
            reason: 'verify_api_not_configured',
            last_error: buildMissingConfigMessage(apiBaseUrl, apiKey),
            api_base_url: apiBaseUrl || null,
            checked_at: checkedAt
        };
    }

    let snapshot;
    try {
        snapshot = await fetchVerifyQuotaSnapshot(verifyConfig, {
            fetchImpl: options.fetchImpl,
            timeoutMs: options.timeoutMs,
            now: options.now
        });
    } catch (error) {
        return {
            ok: false,
            status: 'unavailable',
            status_label: getStatusLabel('unavailable'),
            reason: 'verify_request_failed',
            last_error: normalizeText(error?.message) || 'verify_request_failed',
            api_base_url: apiBaseUrl,
            checked_at: checkedAt
        };
    }

    if (snapshot?.ok) {
        return {
            ok: true,
            status: 'available',
            status_label: '可用',
            key_name: normalizeText(snapshot.key_name) || null,
            api_base_url: normalizeText(snapshot.api_base_url) || apiBaseUrl,
            checked_at: normalizeText(snapshot.checked_at) || checkedAt
        };
    }

    const statusCode = Number(snapshot?.status || 0);
    const status = statusCode === 401 || statusCode === 403 ? 'auth_failed' : 'unavailable';

    return {
        ok: false,
        status,
        status_label: getStatusLabel(status),
        reason: normalizeText(snapshot?.error) || (statusCode ? `balance_http_${statusCode}` : 'verify_upstream_unavailable'),
        last_error: normalizeText(snapshot?.error) || (statusCode ? `balance_http_${statusCode}` : 'verify_upstream_unavailable'),
        response_status: statusCode || null,
        api_base_url: apiBaseUrl,
        checked_at: checkedAt
    };
}

function buildVerifyServiceDisabledAlerts(serviceStatus = {}, rawConfig = {}) {
    const config = normalizeVerifyServiceMonitorConfig(rawConfig);
    if (serviceStatus?.ok) {
        return [];
    }

    const keyName = normalizeText(serviceStatus.key_name);
    const status = normalizeText(serviceStatus.status) || 'unavailable';
    const statusLabel = normalizeText(serviceStatus.status_label) || getStatusLabel(status);
    const responseStatus = Number(serviceStatus.response_status);
    const hasResponseStatus = Number.isFinite(responseStatus) && responseStatus > 0;
    const title = getStatusTitle(status, keyName);
    const lines = [
        getStatusSummary(status),
        `当前状态：${statusLabel}`
    ];

    if (keyName) {
        lines.push(`API Key：${keyName}`);
    }
    if (normalizeText(serviceStatus.api_base_url)) {
        lines.push(`API Base：${normalizeText(serviceStatus.api_base_url)}`);
    }
    if (normalizeText(serviceStatus.last_error)) {
        lines.push(`最近错误：${normalizeText(serviceStatus.last_error)}`);
    }
    if (hasResponseStatus) {
        lines.push(`响应状态：${responseStatus}`);
    }
    if (normalizeText(serviceStatus.checked_at)) {
        lines.push(`检查时间：${normalizeText(serviceStatus.checked_at)}`);
    }
    lines.push('处理入口：后台设置 -> 验证服务配置 -> API Key / 接口状态');

    return [{
        alertType: 'verify_service_disabled',
        severity: 'critical',
        title,
        content: lines.join('\n'),
        payload: {
            target_id: `verify_service:${normalizeText(serviceStatus.api_base_url) || 'default'}`,
            service_status: status,
            service_status_label: statusLabel,
            key_name: keyName || null,
            api_base_url: normalizeText(serviceStatus.api_base_url) || null,
            last_error: normalizeText(serviceStatus.last_error) || null,
            response_status: hasResponseStatus ? responseStatus : null,
            checked_at: normalizeText(serviceStatus.checked_at) || null,
            reason: normalizeText(serviceStatus.reason) || null,
            entry_path: '后台设置 -> 验证服务配置 -> API Key / 接口状态'
        },
        dedupeKey: crypto
            .createHash('sha256')
            .update(`verify_service_disabled:${status}:${normalizeText(serviceStatus.reason) || 'unknown'}:${normalizeText(serviceStatus.api_base_url) || 'default'}`)
            .digest('hex'),
        dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_VERIFY_SERVICE_MONITOR_CONFIG.dedupe_window_minutes)
    }];
}

async function runVerifyServiceDisabledSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const verifyConfig = options.verifyConfig || {};
    const config = normalizeVerifyServiceMonitorConfig(
        options.config || verifyConfig.serviceMonitorConfig,
        env
    );

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            disabled_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            disabled_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const serviceStatus = await fetchVerifyServiceStatus(verifyConfig, {
        fetchImpl: options.fetchImpl,
        timeoutMs: config.request_timeout_ms,
        now: options.now
    });
    const alerts = buildVerifyServiceDisabledAlerts(serviceStatus, config);

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'verify_service_monitor'
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
        disabled_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        status: serviceStatus.status,
        status_label: serviceStatus.status_label,
        last_error: serviceStatus.last_error,
        response_status: serviceStatus.response_status || null,
        results
    };
}

module.exports = {
    DEFAULT_VERIFY_SERVICE_MONITOR_CONFIG,
    buildVerifyServiceDisabledAlerts,
    fetchVerifyServiceStatus,
    normalizeVerifyServiceMonitorConfig,
    runVerifyServiceDisabledSweep
};
