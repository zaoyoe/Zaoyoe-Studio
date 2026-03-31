const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    notifyActiveAdmins
} = require('./admin-notifications');

const ADMIN_ACCESS_AUDIT_ACTION = 'admin.access.session.issue';
const DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    recent_window_minutes: 30,
    baseline_lookback_days: 30,
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

function normalizeAdminLoginAnomalyMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.ADMIN_LOGIN_ANOMALY_MONITOR_ENABLED, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        recent_window_minutes: normalizeNumber(
            source.recent_window_minutes,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_RECENT_WINDOW_MINUTES, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_window_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        baseline_lookback_days: normalizeNumber(
            source.baseline_lookback_days,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_BASELINE_LOOKBACK_DAYS, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.baseline_lookback_days, 1, 180),
            1,
            180
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_PAGE_SIZE, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_MAX_PAGES, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.max_pages, 1, 100),
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

async function fetchAdminAccessAuditRows(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('admin_audit_logs_view')
        .select('id, action_type, details, created_at, admin_id, admin_email')
        .eq('action_type', ADMIN_ACCESS_AUDIT_ACTION)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true }), config.page_size, config.max_pages);
}

function getDistinctValues(rows = [], picker) {
    return Array.from(new Set(
        rows.map((row) => normalizeText(picker(row))).filter(Boolean)
    ));
}

function parseAuditDetails(details) {
    return details && typeof details === 'object' && !Array.isArray(details)
        ? details
        : {};
}

function getEventIp(row = {}) {
    const details = parseAuditDetails(row.details);
    return normalizeText(details.client_ip);
}

function getEventUserAgent(row = {}) {
    const details = parseAuditDetails(row.details);
    return normalizeText(details.user_agent);
}

function getEventAdminLabel(row = {}) {
    const details = parseAuditDetails(row.details);
    return normalizeText(row.admin_email) || normalizeText(details.admin_email) || normalizeText(row.admin_id) || 'unknown-admin';
}

function buildReasonList({ isNewIp, recentDistinctIps, recentDistinctUserAgents }) {
    const reasons = [];
    if (isNewIp) {
        reasons.push('管理员首次从该 IP 登录后台');
    }
    if (recentDistinctIps.length >= 2) {
        reasons.push(`最近窗口内出现 ${recentDistinctIps.length} 个登录 IP`);
    }
    if (recentDistinctUserAgents.length >= 2) {
        reasons.push(`最近窗口内出现 ${recentDistinctUserAgents.length} 个登录设备指纹`);
    }
    return reasons;
}

function buildAdminLoginAnomalyAlerts(auditRows = [], rawConfig = {}, options = {}) {
    const config = normalizeAdminLoginAnomalyMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const recentWindowStart = nowDate.getTime() - Number(config.recent_window_minutes || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_window_minutes) * 60 * 1000;

    return (auditRows || [])
        .map((row, index, allRows) => {
            const createdAt = normalizeText(row.created_at);
            const createdMs = Date.parse(createdAt);
            if (!Number.isFinite(createdMs) || createdMs < recentWindowStart) {
                return null;
            }

            const adminId = normalizeText(row.admin_id);
            const clientIp = getEventIp(row);
            if (!adminId || !clientIp) {
                return null;
            }

            const sameAdminRows = allRows.filter((candidate) => normalizeText(candidate.admin_id) === adminId);
            const earlierRows = sameAdminRows.filter((candidate) => Date.parse(candidate.created_at) < createdMs);
            const recentRows = sameAdminRows.filter((candidate) => {
                const candidateMs = Date.parse(candidate.created_at);
                return Number.isFinite(candidateMs)
                    && candidateMs >= recentWindowStart
                    && candidateMs <= createdMs;
            });

            const previousIps = getDistinctValues(earlierRows, getEventIp);
            const recentDistinctIps = getDistinctValues(recentRows, getEventIp);
            const recentDistinctUserAgents = getDistinctValues(recentRows, getEventUserAgent);
            const isNewIp = previousIps.length > 0 && !previousIps.includes(clientIp);
            const reasons = buildReasonList({
                isNewIp,
                recentDistinctIps,
                recentDistinctUserAgents
            });

            if (!reasons.length) {
                return null;
            }

            const details = parseAuditDetails(row.details);
            const adminLabel = getEventAdminLabel(row);
            const title = `管理员异常登录（${adminLabel}）`;
            const lines = [
                `${adminLabel} 的后台访问行为触发了异常登录判定。`,
                `登录 IP：${clientIp}`
            ];

            const userAgent = getEventUserAgent(row);
            if (userAgent) {
                lines.push(`设备指纹：${userAgent}`);
            }
            lines.push(`判定信号：${reasons.join('；')}`);

            if (previousIps.length) {
                lines.push(`历史常用 IP：${previousIps.slice(-3).join('、')}`);
            }
            if (normalizeText(details.origin)) {
                lines.push(`来源 Origin：${normalizeText(details.origin)}`);
            }
            if (normalizeText(details.referer)) {
                lines.push(`来源 Referer：${normalizeText(details.referer)}`);
            }
            lines.push(`发生时间：${createdAt}`);
            lines.push('处理入口：后台设置 -> 管理员访问 / Admin Audit Logs -> 异常登录信号');

            return {
                alertType: 'security_admin_login_anomaly',
                severity: 'critical',
                title,
                content: lines.join('\n'),
                payload: {
                    target_id: adminId,
                    admin_id: adminId,
                    admin_email: adminLabel,
                    client_ip: clientIp,
                    user_agent: userAgent || null,
                    occurred_at: createdAt,
                    previous_ips: previousIps,
                    recent_distinct_ip_count: recentDistinctIps.length,
                    recent_distinct_user_agent_count: recentDistinctUserAgents.length,
                    detected_reasons: reasons,
                    origin: normalizeText(details.origin) || null,
                    referer: normalizeText(details.referer) || null,
                    entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 异常登录信号'
                },
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`security_admin_login_anomaly:${adminId}:${clientIp}:${crypto.createHash('sha256').update(userAgent || '').digest('hex')}`)
                    .digest('hex'),
                dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.dedupe_window_minutes)
            };
        })
        .filter(Boolean);
}

async function notifyAdminLoginAnomalyReminder(supabase, alert = {}) {
    if (!supabase || !alert?.title || !alert?.content) {
        return {
            created: 0,
            skipped: 0,
            recipients: 0
        };
    }

    return notifyActiveAdmins(supabase, {
        title: alert.title,
        content: alert.content,
        type: 'alert',
        scope: 'admin_personal',
        category: 'security',
        dedupeWindowMinutes: Number(alert.dedupeWindowMinutes || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.dedupe_window_minutes)
    });
}

async function runAdminLoginAnomalySweep(supabase, options = {}) {
    const env = options.env || process.env;
    const config = normalizeAdminLoginAnomalyMonitorConfig(options.config, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            anomaly_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            anomaly_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const sinceIso = new Date(
        nowDate.getTime() - Number(config.baseline_lookback_days || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.baseline_lookback_days) * 24 * 60 * 60 * 1000
    ).toISOString();
    const auditRows = await fetchAdminAccessAuditRows(supabase, sinceIso, config);
    const alerts = buildAdminLoginAnomalyAlerts(auditRows, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    let adminNotificationsCreated = 0;
    let adminNotificationsSkipped = 0;
    const results = [];

    for (const alert of alerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: 'admin_login_anomaly_monitor'
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

        try {
            const reminderResult = await notifyAdminLoginAnomalyReminder(supabase, alert);
            adminNotificationsCreated += Number(reminderResult?.created || 0);
            adminNotificationsSkipped += Number(reminderResult?.skipped || 0);
        } catch (notificationError) {
            console.warn('[admin-login-anomaly-alerts] failed to create admin personal reminder:', notificationError.message || notificationError);
        }

        results.push({
            admin_id: alert.payload?.admin_id || null,
            client_ip: alert.payload?.client_ip || null,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    return {
        anomaly_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        admin_notifications_created: adminNotificationsCreated,
        admin_notifications_skipped: adminNotificationsSkipped,
        results
    };
}

module.exports = {
    ADMIN_ACCESS_AUDIT_ACTION,
    DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG,
    buildAdminLoginAnomalyAlerts,
    normalizeAdminLoginAnomalyMonitorConfig,
    runAdminLoginAnomalySweep,
    __testUtils: {
        fetchAdminAccessAuditRows,
        getEventAdminLabel,
        getEventIp,
        getEventUserAgent
    }
};
