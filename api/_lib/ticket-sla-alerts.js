const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_TICKET_SLA_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 10 * 60 * 1000,
    pending_overdue_minutes: 120,
    critical_overdue_minutes: 12 * 60,
    dedupe_window_minutes: 60,
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
        .select('id, order_id, user_id, status, reason, description, admin_notes, created_at, updated_at')
        .lte('created_at', thresholdIso)
        .order('created_at', { ascending: true }), config.page_size, config.max_pages);
}

function buildTicketSlaOverdueAlerts(tickets = [], rawConfig = {}, options = {}) {
    const config = normalizeTicketSlaMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

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
            const waitLabel = formatWaitLabel(waitMinutes);
            const title = `工单超时未处理（${shortTicketId}）`;
            const lines = [
                `工单 ${shortTicketId} 已超过 ${Number(config.pending_overdue_minutes || 0)} 分钟仍未处理。`,
                `等待时长：${waitLabel}`,
                `责任人：未分配`
            ];

            if (normalizeText(ticket.order_id)) {
                lines.push(`订单号：${normalizeText(ticket.order_id)}`);
            }
            if (normalizeText(ticket.user_id)) {
                lines.push(`用户ID：${normalizeText(ticket.user_id)}`);
            }
            if (reason) {
                lines.push(`问题描述：${reason}`);
            }
            if (createdAt) {
                lines.push(`创建时间：${createdAt}`);
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

async function runTicketSlaOverdueSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const config = normalizeTicketSlaMonitorConfig(options.config, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            overdue_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
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
    const tickets = await fetchPendingTickets(supabase, thresholdIso, config);
    const alerts = buildTicketSlaOverdueAlerts(tickets, config, { now: nowDate });

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
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

    return {
        overdue_count: alerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        results
    };
}

module.exports = {
    DEFAULT_TICKET_SLA_MONITOR_CONFIG,
    buildTicketSlaOverdueAlerts,
    normalizeTicketSlaMonitorConfig,
    runTicketSlaOverdueSweep,
    __testUtils: {
        fetchPagedRows,
        formatWaitLabel,
        getTicketReason,
        getTicketStatus,
        shouldTrackTicketStatus
    }
};
