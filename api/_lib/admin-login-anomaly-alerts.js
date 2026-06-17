const crypto = require('crypto');
const { isIP } = require('node:net');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    normalizeIp
} = require('./request-security');
const {
    notifyActiveAdmins
} = require('./admin-notifications');
const {
    DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG
} = require('./admin-login-anomaly-defaults');

const ADMIN_ACCESS_AUDIT_ACTION = 'admin.access.session.issue';

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
    const rootSource = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const source = rootSource.admin_login_anomaly && typeof rootSource.admin_login_anomaly === 'object' && !Array.isArray(rootSource.admin_login_anomaly)
        ? rootSource.admin_login_anomaly
        : rootSource;

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
        ip_grouping_enabled: normalizeBoolean(
            source.ip_grouping_enabled,
            normalizeBoolean(env?.ADMIN_LOGIN_ANOMALY_MONITOR_IP_GROUPING_ENABLED, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ip_grouping_enabled)
        ),
        ipv4_group_prefix_bits: Math.round(normalizeNumber(
            source.ipv4_group_prefix_bits,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_IPV4_GROUP_PREFIX_BITS, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ipv4_group_prefix_bits, 8, 32),
            8,
            32
        )),
        ipv6_group_prefix_bits: Math.round(normalizeNumber(
            source.ipv6_group_prefix_bits,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_IPV6_GROUP_PREFIX_BITS, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ipv6_group_prefix_bits, 16, 128),
            16,
            128
        )),
        recent_distinct_ip_group_threshold: Math.round(normalizeNumber(
            source.recent_distinct_ip_group_threshold,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_RECENT_DISTINCT_IP_GROUP_THRESHOLD, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_distinct_ip_group_threshold, 2, 20),
            2,
            20
        )),
        user_agent_family_grouping_enabled: normalizeBoolean(
            source.user_agent_family_grouping_enabled,
            normalizeBoolean(env?.ADMIN_LOGIN_ANOMALY_MONITOR_UA_FAMILY_GROUPING_ENABLED, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.user_agent_family_grouping_enabled)
        ),
        recent_distinct_user_agent_family_threshold: Math.round(normalizeNumber(
            source.recent_distinct_user_agent_family_threshold,
            normalizeNumber(env?.ADMIN_LOGIN_ANOMALY_MONITOR_RECENT_DISTINCT_UA_FAMILY_THRESHOLD, DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_distinct_user_agent_family_threshold, 2, 20),
            2,
            20
        )),
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

function ipv4ToBytes(ip) {
    const octets = String(ip || '').split('.');
    if (octets.length !== 4) return null;

    const bytes = octets.map((octet) => Number(octet));
    if (bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return null;
    }
    return bytes;
}

function expandIpv6(ip) {
    const normalized = String(ip || '').toLowerCase();
    const halves = normalized.split('::');
    if (halves.length > 2) return null;

    const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];

    const convertIpv4Tail = (groups) => {
        if (!groups.length) return true;
        const last = groups[groups.length - 1];
        if (!last || !last.includes('.')) return true;

        const bytes = ipv4ToBytes(last);
        if (!bytes) return false;
        groups.splice(
            groups.length - 1,
            1,
            ((bytes[0] << 8) | bytes[1]).toString(16),
            ((bytes[2] << 8) | bytes[3]).toString(16)
        );
        return true;
    };

    if (!convertIpv4Tail(left) || !convertIpv4Tail(right)) {
        return null;
    }

    const totalGroups = left.length + right.length;
    if ((halves.length === 1 && totalGroups !== 8) || totalGroups > 8) {
        return null;
    }

    const zeroGroups = halves.length === 2 ? 8 - totalGroups : 0;
    const groups = [
        ...left,
        ...Array.from({ length: zeroGroups }, () => '0'),
        ...right
    ];

    if (groups.length !== 8) return null;
    return groups.map((group) => {
        const value = Number.parseInt(group, 16);
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
            return null;
        }
        return value;
    });
}

function ipv6ToBytes(ip) {
    const groups = expandIpv6(ip);
    if (!groups || groups.some((group) => group === null)) {
        return null;
    }

    const bytes = [];
    for (const group of groups) {
        bytes.push((group >> 8) & 0xff, group & 0xff);
    }
    return bytes;
}

function maskBytes(bytes = [], prefixBits = 0) {
    const masked = bytes.slice();
    let remainingBits = Math.max(0, Math.min(masked.length * 8, Math.round(Number(prefixBits) || 0)));

    for (let index = 0; index < masked.length; index += 1) {
        if (remainingBits >= 8) {
            remainingBits -= 8;
            continue;
        }

        if (remainingBits <= 0) {
            masked[index] = 0;
            continue;
        }

        const mask = (0xff << (8 - remainingBits)) & 0xff;
        masked[index] = masked[index] & mask;
        remainingBits = 0;
    }

    return masked;
}

function formatIpv6Bytes(bytes = []) {
    const groups = [];
    for (let index = 0; index < 16; index += 2) {
        groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
    }
    return groups.join(':');
}

function buildIpGroup(ip, config = {}) {
    const normalized = normalizeIp(ip);
    if (!normalized) return '';
    if (!config.ip_grouping_enabled) return normalized;

    const version = isIP(normalized);
    if (version === 4) {
        const prefix = Math.round(Number(config.ipv4_group_prefix_bits || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ipv4_group_prefix_bits));
        const bytes = ipv4ToBytes(normalized);
        if (!bytes) return normalized;
        return `${maskBytes(bytes, prefix).join('.')}/${prefix}`;
    }
    if (version === 6) {
        const prefix = Math.round(Number(config.ipv6_group_prefix_bits || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.ipv6_group_prefix_bits));
        const bytes = ipv6ToBytes(normalized);
        if (!bytes) return normalized;
        return `${formatIpv6Bytes(maskBytes(bytes, prefix))}/${prefix}`;
    }

    return normalized;
}

function getBrowserFamily(userAgent = '') {
    const normalized = String(userAgent || '').toLowerCase();
    if (!normalized) return '';
    if (/\bedg(?:e|a|ios)?\//.test(normalized)) return 'edge';
    if (/\bopr\/|\bopera\//.test(normalized)) return 'opera';
    if (/\bfirefox\/|\bfxios\//.test(normalized)) return 'firefox';
    if (/\bcrios\/|\bchrome\/|\bchromium\//.test(normalized)) return 'chrome';
    if (/\bversion\/[\d.]+.*\bsafari\//.test(normalized) || /\bsafari\//.test(normalized)) return 'safari';
    if (/\bcurl\//.test(normalized)) return 'curl';
    if (/\bpostmanruntime\//.test(normalized)) return 'postman';
    if (/\bnode(?:\.js)?\//.test(normalized)) return 'node';

    const firstProduct = normalized.match(/[a-z][a-z0-9_-]*(?=\/|\s|$)/i)?.[0];
    return firstProduct || normalized.slice(0, 80);
}

function getPlatformFamily(userAgent = '') {
    const normalized = String(userAgent || '').toLowerCase();
    if (!normalized) return '';
    if (/\bipad\b/.test(normalized)) return 'ipados';
    if (/\biphone\b|\bipod\b/.test(normalized)) return 'ios';
    if (/\bandroid\b/.test(normalized)) return 'android';
    if (/\bwindows nt\b/.test(normalized)) return 'windows';
    if (/\bmac os x\b|\bmacintosh\b/.test(normalized)) return 'macos';
    if (/\bcros\b/.test(normalized)) return 'chromeos';
    if (/\blinux\b/.test(normalized)) return 'linux';
    return 'unknown';
}

function getDeviceFamily(userAgent = '') {
    const normalized = String(userAgent || '').toLowerCase();
    if (!normalized) return '';
    if (/\bmobile\b|\biphone\b|\bandroid.*mobile\b/.test(normalized)) return 'mobile';
    if (/\bipad\b|\btablet\b|\bandroid\b/.test(normalized)) return 'tablet';
    return 'desktop';
}

function buildUserAgentFingerprint(userAgent = '', config = {}) {
    const raw = normalizeText(userAgent);
    if (!raw) return '';
    if (!config.user_agent_family_grouping_enabled) return raw;

    return [
        getBrowserFamily(raw),
        getPlatformFamily(raw),
        getDeviceFamily(raw)
    ].filter(Boolean).join(':') || raw.slice(0, 160);
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

function buildReasonList({
    isNewIpGroup,
    isNewUserAgentFingerprint,
    recentDistinctIpGroups,
    recentDistinctUserAgentFingerprints,
    config
}) {
    const reasons = [];
    const ipUnitLabel = config.ip_grouping_enabled ? ' IP 段' : ' IP';
    const ipGroupThreshold = Math.max(
        2,
        Math.round(Number(config.recent_distinct_ip_group_threshold || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_distinct_ip_group_threshold))
    );
    const userAgentFamilyThreshold = Math.max(
        2,
        Math.round(Number(config.recent_distinct_user_agent_family_threshold || DEFAULT_ADMIN_LOGIN_ANOMALY_MONITOR_CONFIG.recent_distinct_user_agent_family_threshold))
    );

    if (isNewIpGroup && isNewUserAgentFingerprint) {
        reasons.push(`管理员首次从新的${ipUnitLabel}和设备家族组合登录后台`);
    }
    if (recentDistinctIpGroups.length >= ipGroupThreshold) {
        reasons.push(`最近窗口内出现 ${recentDistinctIpGroups.length} 个登录${ipUnitLabel}`);
    }
    if (recentDistinctUserAgentFingerprints.length >= userAgentFamilyThreshold) {
        reasons.push(`最近窗口内出现 ${recentDistinctUserAgentFingerprints.length} 个登录设备家族`);
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
            const previousIpGroups = getDistinctValues(earlierRows, (candidate) => buildIpGroup(getEventIp(candidate), config));
            const previousUserAgentFingerprints = getDistinctValues(earlierRows, (candidate) => buildUserAgentFingerprint(getEventUserAgent(candidate), config));
            const recentDistinctIps = getDistinctValues(recentRows, getEventIp);
            const recentDistinctIpGroups = getDistinctValues(recentRows, (candidate) => buildIpGroup(getEventIp(candidate), config));
            const recentDistinctRawUserAgents = getDistinctValues(recentRows, getEventUserAgent);
            const recentDistinctUserAgentFingerprints = getDistinctValues(recentRows, (candidate) => buildUserAgentFingerprint(getEventUserAgent(candidate), config));
            const clientIpGroup = buildIpGroup(clientIp, config);
            const userAgent = getEventUserAgent(row);
            const userAgentFingerprint = buildUserAgentFingerprint(userAgent, config);
            const isNewIpGroup = previousIpGroups.length > 0 && clientIpGroup && !previousIpGroups.includes(clientIpGroup);
            const isNewUserAgentFingerprint = previousUserAgentFingerprints.length > 0
                && userAgentFingerprint
                && !previousUserAgentFingerprints.includes(userAgentFingerprint);
            const reasons = buildReasonList({
                isNewIpGroup,
                isNewUserAgentFingerprint,
                recentDistinctIpGroups,
                recentDistinctUserAgentFingerprints,
                config
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

            if (userAgent) {
                lines.push(`设备指纹：${userAgent}`);
            }
            if (userAgentFingerprint && userAgentFingerprint !== userAgent) {
                lines.push(`设备家族：${userAgentFingerprint}`);
            }
            lines.push(`判定信号：${reasons.join('；')}`);

            if (previousIps.length) {
                lines.push(`历史常用 IP：${previousIps.slice(-3).join('、')}`);
            }
            if (clientIpGroup && clientIpGroup !== clientIp) {
                lines.push(`登录 IP 段：${clientIpGroup}`);
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
                    client_ip_group: clientIpGroup || null,
                    user_agent: userAgent || null,
                    user_agent_fingerprint: userAgentFingerprint || null,
                    is_new_ip_group: isNewIpGroup,
                    is_new_user_agent_fingerprint: isNewUserAgentFingerprint,
                    occurred_at: createdAt,
                    previous_ips: previousIps,
                    previous_ip_groups: previousIpGroups,
                    previous_user_agent_fingerprints: previousUserAgentFingerprints,
                    recent_distinct_ip_count: recentDistinctIpGroups.length,
                    recent_distinct_raw_ip_count: recentDistinctIps.length,
                    recent_distinct_user_agent_count: recentDistinctUserAgentFingerprints.length,
                    recent_distinct_raw_user_agent_count: recentDistinctRawUserAgents.length,
                    detected_reasons: reasons,
                    origin: normalizeText(details.origin) || null,
                    referer: normalizeText(details.referer) || null,
                    entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 异常登录信号'
                },
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`security_admin_login_anomaly:${adminId}:${clientIpGroup || clientIp}:${crypto.createHash('sha256').update(userAgentFingerprint || userAgent || '').digest('hex')}`)
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
    const explicitConfig = options.config && typeof options.config === 'object' ? options.config : {};
    let config = normalizeAdminLoginAnomalyMonitorConfig(explicitConfig, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            anomaly_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    const runtimeMonitorConfig = runtime?.config?.admin_login_anomaly && typeof runtime.config.admin_login_anomaly === 'object'
        ? runtime.config.admin_login_anomaly
        : {};
    if (Object.keys(runtimeMonitorConfig).length || Object.keys(explicitConfig).length) {
        config = normalizeAdminLoginAnomalyMonitorConfig({
            ...runtimeMonitorConfig,
            ...explicitConfig
        }, env);
    }

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            anomaly_count: 0,
            queued: 0,
            deduped: 0
        };
    }

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
