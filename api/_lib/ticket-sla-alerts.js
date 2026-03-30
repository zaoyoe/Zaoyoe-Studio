const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    formatAlertTimestamp
} = require('./alert-time');

const DEFAULT_TICKET_SLA_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    pending_overdue_minutes: 120,
    critical_overdue_minutes: 12 * 60,
    state_lookback_minutes: 24 * 60,
    dedupe_window_minutes: 60,
    page_size: 500,
    max_pages: 10
});
const TICKET_SLA_STATE_TYPES = Object.freeze([
    'ticket_sla_overdue',
    'ticket_sla_recovered'
]);

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

function normalizeTicketSlaMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(source.enabled, normalizeBoolean(env?.TICKET_SLA_MONITOR_ENABLED, DEFAULT_TICKET_SLA_MONITOR_CONFIG.enabled)),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.TICKET_SLA_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_TICKET_SLA_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        pending_overdue_minutes: normalizeNumber(
            source.pending_overdue_minutes,
            normalizeNumber(env?.TICKET_SLA_MONITOR_PENDING_OVERDUE_MINUTES, DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes, 5, 14 * 24 * 60),
            5,
            14 * 24 * 60
        ),
        critical_overdue_minutes: normalizeNumber(
            source.critical_overdue_minutes,
            normalizeNumber(env?.TICKET_SLA_MONITOR_CRITICAL_OVERDUE_MINUTES, DEFAULT_TICKET_SLA_MONITOR_CONFIG.critical_overdue_minutes, 30, 30 * 24 * 60),
            30,
            30 * 24 * 60
        ),
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.TICKET_SLA_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_TICKET_SLA_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.TICKET_SLA_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_TICKET_SLA_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.TICKET_SLA_MONITOR_PAGE_SIZE, DEFAULT_TICKET_SLA_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.TICKET_SLA_MONITOR_MAX_PAGES, DEFAULT_TICKET_SLA_MONITOR_CONFIG.max_pages, 1, 100),
            1,
            100
        )
    };
}

function getTicketReason(ticket = {}) {
    return normalizeText(ticket.reason || ticket.description);
}

function getTicketStatus(ticket = {}) {
    const normalized = normalizeText(ticket.status).toUpperCase();
    if (!normalized || normalized === 'OPEN') {
        return 'PENDING';
    }
    return normalized;
}

function shouldTrackTicketStatus(status) {
    return status === 'PENDING';
}

function formatWaitLabel(waitMinutes) {
    const normalized = Math.max(0, Math.round(Number(waitMinutes || 0)));
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    if (hours > 0 && minutes > 0) {
        return `${hours} 小时 ${minutes} 分钟`;
    }
    if (hours > 0) {
        return `${hours} 小时`;
    }
    return `${minutes} 分钟`;
}

function getTicketTargetId(value = {}) {
    if (!value || typeof value !== 'object') {
        return '';
    }

    if (normalizeText(value.target_id)) {
        return normalizeText(value.target_id);
    }

    return normalizeText(value.ticket_id || value.id);
}

function compareCreatedAtDescending(left = {}, right = {}) {
    const leftTime = Date.parse(normalizeText(left.created_at));
    const rightTime = Date.parse(normalizeText(right.created_at));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function getLatestTicketStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedType = normalizeText(alertType).toLowerCase();
    const normalizedTargetId = normalizeText(targetId);
    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === normalizedType)
        .filter((job) => !normalizedTargetId || getTicketTargetId(job.payload) === normalizedTargetId)
        .sort(compareCreatedAtDescending)[0] || null;
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

async function fetchPendingTickets(client, thresholdIso, config) {
    return fetchPagedRows(() => client
        .from('shop_tickets')
        .select('id, order_id, user_id, status, description, admin_notes, created_at, updated_at')
        .lte('created_at', thresholdIso)
        .order('created_at', { ascending: true }), config.page_size, config.max_pages);
}

async function fetchRecentTicketSlaStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', TICKET_SLA_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchTicketsByIds(client, ticketIds = [], config = {}) {
    const normalizedIds = Array.from(new Set((ticketIds || []).map((ticketId) => normalizeText(ticketId)).filter(Boolean)));
    if (!normalizedIds.length) {
        return [];
    }

    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_TICKET_SLA_MONITOR_CONFIG.page_size), 200));
    const rows = [];

    for (let index = 0; index < normalizedIds.length; index += chunkSize) {
        const batch = normalizedIds.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('shop_tickets')
            .select('id, order_id, user_id, status, description, admin_notes, created_at, updated_at')
            .in('id', batch);

        if (error) {
            throw error;
        }

        rows.push(...(Array.isArray(data) ? data : []));
    }

    return rows;
}

async function fetchProfilesByIds(client, userIds = [], config = {}) {
    const normalizedUserIds = Array.from(new Set((userIds || []).map((userId) => normalizeText(userId)).filter(Boolean)));
    if (!normalizedUserIds.length) {
        return [];
    }

    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_TICKET_SLA_MONITOR_CONFIG.page_size), 200));
    const rows = [];

    for (let index = 0; index < normalizedUserIds.length; index += chunkSize) {
        const batch = normalizedUserIds.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('profiles')
            .select('id, email')
            .in('id', batch);

        if (error) {
            throw error;
        }

        rows.push(...(Array.isArray(data) ? data : []));
    }

    return rows;
}

function buildProfilesContext(profiles = []) {
    const byId = new Map();

    for (const profile of profiles || []) {
        const id = normalizeText(profile?.id);
        if (id) {
            byId.set(id, profile);
        }
    }

    return { byId };
}

function resolveTicketUserEmail(ticket = {}, profilesContext = {}) {
    const payloadEmail = normalizeText(ticket.user_email, 255);
    if (payloadEmail) {
        return payloadEmail;
    }

    const userId = normalizeText(ticket.user_id, 120);
    if (!userId || !(profilesContext.byId instanceof Map)) {
        return '';
    }

    return normalizeText(profilesContext.byId.get(userId)?.email, 255);
}

function buildTicketSlaOverdueAlerts(tickets = [], rawConfig = {}, options = {}) {
    const config = normalizeTicketSlaMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const profilesContext = options.profilesContext && typeof options.profilesContext === 'object'
        ? options.profilesContext
        : { byId: new Map() };

    return (tickets || [])
        .map((ticket) => {
            const status = getTicketStatus(ticket);
            if (!shouldTrackTicketStatus(status)) {
                return null;
            }

            const createdAt = normalizeText(ticket.created_at);
            const createdMs = new Date(createdAt).getTime();
            if (!Number.isFinite(createdMs)) {
                return null;
            }

            const waitMinutes = Math.max(0, Math.round((nowDate.getTime() - createdMs) / 60000));
            if (waitMinutes < Number(config.pending_overdue_minutes || 0)) {
                return null;
            }

            const severity = waitMinutes >= Number(config.critical_overdue_minutes || 0) ? 'critical' : 'warning';
            const ticketId = normalizeText(ticket.id);
            const shortTicketId = ticketId ? ticketId.slice(0, 8) : 'unknown';
            const reason = getTicketReason(ticket);
            const userEmail = resolveTicketUserEmail(ticket, profilesContext);
            const waitLabel = formatWaitLabel(waitMinutes);
            const displayCreatedAt = formatAlertTimestamp(createdAt) || createdAt;
            const title = `工单超时未处理（${shortTicketId}）`;
            const lines = [
                `工单 ${shortTicketId} 已超过 ${Number(config.pending_overdue_minutes || 0)} 分钟仍未处理。`,
                `等待时长：${waitLabel}`,
                `责任人：未分配`
            ];

            if (normalizeText(ticket.order_id)) {
                lines.push(`订单号：${normalizeText(ticket.order_id)}`);
            }
            if (userEmail) {
                lines.push(`用户邮箱：${userEmail}`);
            }
            if (normalizeText(ticket.user_id)) {
                lines.push(`用户ID：${normalizeText(ticket.user_id)}`);
            }
            if (reason) {
                lines.push(`问题描述：${reason}`);
            }
            if (displayCreatedAt) {
                lines.push(`创建时间：${displayCreatedAt}`);
            }
            lines.push('处理入口：售后工单 -> 待处理 -> 工单详情');

            return {
                alertType: 'ticket_sla_overdue',
                severity,
                title,
                content: lines.join('\n'),
                payload: {
                    target_id: ticketId || null,
                    ticket_id: ticketId || null,
                    order_id: normalizeText(ticket.order_id) || null,
                    user_id: normalizeText(ticket.user_id) || null,
                    user_email: userEmail || null,
                    ticket_status: status,
                    wait_minutes: waitMinutes,
                    wait_label: waitLabel,
                    responsible_label: '未分配',
                    reason: reason || null,
                    created_at: createdAt || null,
                    updated_at: normalizeText(ticket.updated_at) || null,
                    entry_path: '售后工单 -> 待处理 -> 工单详情'
                },
                dedupeKey: crypto
                    .createHash('sha256')
                    .update(`ticket_sla_overdue:${ticketId || shortTicketId}:${severity}`)
                    .digest('hex'),
                dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_TICKET_SLA_MONITOR_CONFIG.dedupe_window_minutes)
            };
        })
        .filter(Boolean);
}

function buildTicketSlaRecoveryAlerts(tickets = [], stateJobs = [], rawConfig = {}, options = {}) {
    const config = normalizeTicketSlaMonitorConfig(rawConfig);
    const profilesContext = options.profilesContext && typeof options.profilesContext === 'object'
        ? options.profilesContext
        : { byId: new Map() };
    const activeOverdueAlerts = buildTicketSlaOverdueAlerts(tickets, config, {
        ...options,
        profilesContext
    });
    const activeTargetIds = new Set(activeOverdueAlerts.map((alert) => getTicketTargetId(alert.payload)));
    const overdueTargetIds = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'ticket_sla_overdue')
            .map((job) => getTicketTargetId(job.payload))
            .filter(Boolean)
    ));
    const ticketsById = new Map((tickets || []).map((ticket) => [normalizeText(ticket.id), ticket]));
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return overdueTargetIds.map((targetId) => {
        const latestOverdue = getLatestTicketStateJob(stateJobs, 'ticket_sla_overdue', targetId);
        if (!latestOverdue) {
            return null;
        }

        const latestRecovered = getLatestTicketStateJob(stateJobs, 'ticket_sla_recovered', targetId);
        const latestOverdueAt = Date.parse(normalizeText(latestOverdue.created_at));
        const latestRecoveredAt = Date.parse(normalizeText(latestRecovered?.created_at));
        if (Number.isFinite(latestOverdueAt) && Number.isFinite(latestRecoveredAt) && latestRecoveredAt >= latestOverdueAt) {
            return null;
        }
        if (activeTargetIds.has(targetId)) {
            return null;
        }

        const currentTicket = ticketsById.get(targetId);
        if (!currentTicket) {
            return null;
        }

        const currentStatus = getTicketStatus(currentTicket);
        if (shouldTrackTicketStatus(currentStatus)) {
            return null;
        }

        const overduePayload = latestOverdue.payload && typeof latestOverdue.payload === 'object' ? latestOverdue.payload : {};
        const shortTicketId = targetId.slice(0, 8) || 'unknown';
        const incidentRecoveredAt = nowDate.toISOString();
        const incidentDurationMinutes = Number.isFinite(latestOverdueAt)
            ? Math.max(0, Math.round((nowDate.getTime() - latestOverdueAt) / 60000))
            : 0;
        const orderId = normalizeText(currentTicket.order_id || overduePayload.order_id);
        const userId = normalizeText(currentTicket.user_id || overduePayload.user_id);
        const userEmail = resolveTicketUserEmail(currentTicket, profilesContext) || normalizeText(overduePayload.user_email, 255);
        const currentReason = getTicketReason(currentTicket) || normalizeText(overduePayload.reason);
        const currentUpdatedAt = normalizeText(currentTicket.updated_at);
        const displayIncidentStartedAt = formatAlertTimestamp(latestOverdue.created_at) || normalizeText(latestOverdue.created_at);
        const displayCurrentUpdatedAt = formatAlertTimestamp(currentUpdatedAt) || currentUpdatedAt;
        const displayIncidentRecoveredAt = formatAlertTimestamp(incidentRecoveredAt) || incidentRecoveredAt;
        const recoverySummary = currentStatus === 'RESOLVED'
            ? '工单已解决，已退出超时未处理状态'
            : currentStatus === 'REJECTED'
                ? '工单已拒绝，已退出超时未处理状态'
                : `工单当前状态已变更为 ${currentStatus || 'UNKNOWN'}，已退出超时未处理状态`;
        const lines = [
            `工单 ${shortTicketId} 已退出超时未处理状态，可从催办处理切回正常跟进。`,
            `恢复结论：${recoverySummary}`
        ];

        if (orderId) {
            lines.push(`订单号：${orderId}`);
        }
        if (userEmail) {
            lines.push(`用户邮箱：${userEmail}`);
        }
        if (userId) {
            lines.push(`用户ID：${userId}`);
        }
        if (normalizeText(overduePayload.wait_label)) {
            lines.push(`上次超时等待：${normalizeText(overduePayload.wait_label)}`);
        }
        lines.push(`当前状态：${currentStatus}`);
        if (displayIncidentStartedAt) {
            lines.push(`上次超时：${displayIncidentStartedAt}`);
        }
        if (displayCurrentUpdatedAt) {
            lines.push(`最近更新时间：${displayCurrentUpdatedAt}`);
        }
        lines.push(`恢复时间：${displayIncidentRecoveredAt}`);
        lines.push(`持续时长：${formatWaitLabel(incidentDurationMinutes)}`);
        if (currentReason) {
            lines.push(`问题描述：${currentReason}`);
        }
        lines.push('处理入口：售后工单 -> 已处理 -> 工单详情');

        return {
            alertType: 'ticket_sla_recovered',
            severity: 'warning',
            title: `工单超时已恢复（${shortTicketId}）`,
            content: lines.join('\n'),
            payload: {
                target_id: targetId,
                ticket_id: targetId,
                order_id: orderId || null,
                user_id: userId || null,
                user_email: userEmail || null,
                incident_alert_job_id: normalizeText(latestOverdue.id) || null,
                incident_started_at: normalizeText(latestOverdue.created_at) || null,
                incident_recovered_at: incidentRecoveredAt,
                incident_duration_minutes: incidentDurationMinutes,
                previous_wait_minutes: Number(overduePayload.wait_minutes || 0) || null,
                previous_wait_label: normalizeText(overduePayload.wait_label) || null,
                ticket_status: currentStatus,
                recovery_summary: recoverySummary,
                reason: currentReason || null,
                created_at: normalizeText(currentTicket.created_at) || normalizeText(overduePayload.created_at) || null,
                updated_at: currentUpdatedAt || null,
                entry_path: '售后工单 -> 已处理 -> 工单详情'
            },
            allowedChannels: ['feishu'],
            dedupeKey: crypto
                .createHash('sha256')
                .update(`ticket_sla_recovered:${targetId}:${normalizeText(latestOverdue.id) || normalizeText(latestOverdue.created_at) || 'unknown'}`)
                .digest('hex'),
            dedupeWindowMinutes: Math.max(
                Number(config.dedupe_window_minutes || DEFAULT_TICKET_SLA_MONITOR_CONFIG.dedupe_window_minutes),
                60
            )
        };
    }).filter(Boolean);
}

async function runTicketSlaOverdueSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    const runtimeMonitorConfig = runtime?.config?.tickets && typeof runtime.config.tickets === 'object'
        ? runtime.config.tickets
        : {};
    const config = normalizeTicketSlaMonitorConfig({
        ...runtimeMonitorConfig,
        ...(options.config && typeof options.config === 'object' ? options.config : {})
    }, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            overdue_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            overdue_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const thresholdIso = new Date(nowDate.getTime() - Number(config.pending_overdue_minutes || DEFAULT_TICKET_SLA_MONITOR_CONFIG.pending_overdue_minutes) * 60 * 1000).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || DEFAULT_TICKET_SLA_MONITOR_CONFIG.state_lookback_minutes) * 60 * 1000).toISOString();
    const [tickets, stateJobs] = await Promise.all([
        fetchPendingTickets(supabase, thresholdIso, config),
        fetchRecentTicketSlaStateJobs(supabase, stateSinceIso, config)
    ]);
    const trackedTicketIds = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'ticket_sla_overdue')
            .map((job) => getTicketTargetId(job.payload))
            .filter(Boolean)
    ));
    const trackedTickets = await fetchTicketsByIds(supabase, trackedTicketIds, config);
    const profileUserIds = Array.from(new Set([
        ...(tickets || []).map((ticket) => normalizeText(ticket.user_id)).filter(Boolean),
        ...(trackedTickets || []).map((ticket) => normalizeText(ticket.user_id)).filter(Boolean)
    ]));
    const profilesContext = buildProfilesContext(await fetchProfilesByIds(supabase, profileUserIds, config));
    const alerts = buildTicketSlaOverdueAlerts(tickets, config, {
        now: nowDate,
        profilesContext
    });
    const recoveryAlerts = buildTicketSlaRecoveryAlerts(trackedTickets, stateJobs, config, {
        now: nowDate,
        profilesContext
    });

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
            source: 'ticket_sla_monitor'
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
            ticket_id: alert.payload?.ticket_id || null,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    for (const alert of recoveryAlerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: nowDate.toISOString(),
            source: 'ticket_sla_monitor'
        }, {
            runtime,
            env
        });

        if (result?.queued === true) {
            recoveredQueued += 1;
        } else if (result?.reason === 'deduped') {
            recoveredDeduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            recoveredSkippedNoChannels += 1;
        }

        results.push({
            ticket_id: alert.payload?.ticket_id || null,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null,
            admin_notification_created: 0,
            admin_notification_error: null
        });
    }

    return {
        overdue_count: alerts.length,
        recovered_count: recoveryAlerts.length,
        queued,
        deduped,
        recovered_queued: recoveredQueued,
        recovered_deduped: recoveredDeduped,
        skipped_no_channels: skippedNoChannels,
        recovered_skipped_no_channels: recoveredSkippedNoChannels,
        admin_notifications_created: adminNotificationsCreated,
        admin_notifications_skipped: adminNotificationsSkipped,
        state_job_count: stateJobs.length,
        results
    };
}

module.exports = {
    DEFAULT_TICKET_SLA_MONITOR_CONFIG,
    TICKET_SLA_STATE_TYPES,
    buildTicketSlaOverdueAlerts,
    buildTicketSlaRecoveryAlerts,
    normalizeTicketSlaMonitorConfig,
    runTicketSlaOverdueSweep,
    __testUtils: {
        compareCreatedAtDescending,
        fetchPagedRows,
        formatWaitLabel,
        getLatestTicketStateJob,
        getTicketReason,
        getTicketStatus,
        getTicketTargetId,
        shouldTrackTicketStatus
    }
};
