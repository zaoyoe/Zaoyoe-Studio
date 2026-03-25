const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const OPS_ALERT_MONITOR_LOOKBACK_HOURS = 7 * 24;
const OPS_ALERT_MONITOR_PAGE_SIZE = 200;
const OPS_ALERT_MONITOR_MAX_PAGES = 5;

const ALERT_MONITOR_CATEGORIES = Object.freeze([
    {
        key: 'payments',
        label: '支付与退款',
        description: '聚合支付通道、退款售后和支付配置相关告警。',
        problem_types: ['payment_refund_ops', 'payment_gateway_degraded', 'payment_config_changed', 'payment_config_incident'],
        recovery_types: ['payment_gateway_recovered', 'payment_config_recovered']
    },
    {
        key: 'tickets',
        label: '工单与售后',
        description: '聚合工单超时与售后处理进度告警。',
        problem_types: ['ticket_sla_overdue'],
        recovery_types: ['ticket_sla_recovered']
    },
    {
        key: 'inventory',
        label: '库存与补货',
        description: '聚合库存偏低、售罄以及补货恢复告警。',
        problem_types: ['shop_inventory_low', 'shop_inventory_empty'],
        recovery_types: ['shop_inventory_recovered']
    },
    {
        key: 'fulfillment',
        label: '履约与死信',
        description: '聚合单笔履约失败、履约事故升级及恢复告警。',
        problem_types: ['shop_order_delivery_failed', 'shop_order_delivery_incident'],
        recovery_types: ['shop_order_delivery_recovered', 'shop_order_delivery_incident_recovered']
    }
]);

const ALL_MONITOR_ALERT_TYPES = Object.freeze(
    [...new Set(ALERT_MONITOR_CATEGORIES.flatMap((category) => [
        ...(category.problem_types || []),
        ...(category.recovery_types || [])
    ]))]
);

function normalizeText(value, maxLength = 400) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSeverity(value) {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (['info', 'warning', 'critical'].includes(normalized)) {
        return normalized;
    }
    return 'warning';
}

function normalizePayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

async function fetchPagedRows(buildQuery, pageSize = OPS_ALERT_MONITOR_PAGE_SIZE, maxPages = OPS_ALERT_MONITOR_MAX_PAGES) {
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

async function fetchRecentOpsAlertJobs(supabase, sinceIso) {
    return fetchPagedRows(() => supabase
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, content, payload, channels, remaining_channels, status, attempt_count, created_at')
        .in('alert_type', ALL_MONITOR_ALERT_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }));
}

function getCreatedAtTime(row = {}) {
    const timestamp = Date.parse(normalizeText(row.created_at, 80));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortByCreatedAtDesc(rows = []) {
    return rows.slice().sort((left, right) => getCreatedAtTime(right) - getCreatedAtTime(left));
}

function getAlertTargetId(job = {}) {
    const payload = normalizePayload(job.payload);
    return normalizeText(payload.target_id, 160)
        || normalizeText(payload.ticket_id, 160)
        || normalizeText(payload.product_id, 160)
        || normalizeText(payload.order_id, 160)
        || normalizeText(payload.provider_order_no, 160)
        || normalizeText(job.id, 160)
        || 'unknown';
}

function getAlertExcerpt(job = {}) {
    const title = normalizeText(job.title, 240);
    const lines = normalizeText(job.content, 1200)
        .split('\n')
        .map((line) => normalizeText(line, 240))
        .filter(Boolean)
        .filter((line) => line !== title);

    return lines[0] || '';
}

function getAlertReference(job = {}) {
    const payload = normalizePayload(job.payload);

    if (normalizeText(payload.provider_order_no, 160)) {
        return {
            label: '订单号',
            value: normalizeText(payload.provider_order_no, 160)
        };
    }
    if (normalizeText(payload.ticket_id, 160)) {
        return {
            label: '工单号',
            value: normalizeText(payload.ticket_id, 160)
        };
    }
    if (normalizeText(payload.product_name, 160)) {
        return {
            label: '商品',
            value: normalizeText(payload.product_name, 160)
        };
    }
    if (normalizeText(payload.order_id, 160)) {
        return {
            label: '订单',
            value: normalizeText(payload.order_id, 160)
        };
    }
    if (normalizeText(payload.target_id, 160)) {
        return {
            label: '目标',
            value: normalizeText(payload.target_id, 160)
        };
    }

    return {
        label: '记录',
        value: normalizeText(job.id, 160) || 'unknown'
    };
}

function buildAlertItem(job = {}) {
    const reference = getAlertReference(job);
    return {
        id: normalizeText(job.id, 160),
        alert_type: normalizeText(job.alert_type, 120).toLowerCase(),
        severity: normalizeSeverity(job.severity),
        title: normalizeText(job.title, 240) || '系统告警',
        message: getAlertExcerpt(job),
        created_at: normalizeText(job.created_at, 80) || null,
        target_id: getAlertTargetId(job),
        reference_label: reference.label,
        reference_value: reference.value
    };
}

function buildCategorySnapshot(category, jobs = []) {
    const filteredJobs = sortByCreatedAtDesc(
        jobs.filter((job) => {
            const alertType = normalizeText(job.alert_type, 120).toLowerCase();
            return category.problem_types.includes(alertType) || category.recovery_types.includes(alertType);
        })
    );

    const latestByTarget = new Map();
    for (const job of filteredJobs) {
        const targetId = getAlertTargetId(job);
        if (!latestByTarget.has(targetId)) {
            latestByTarget.set(targetId, job);
        }
    }

    const activeJobs = Array.from(latestByTarget.values())
        .filter((job) => category.problem_types.includes(normalizeText(job.alert_type, 120).toLowerCase()))
        .sort((left, right) => getCreatedAtTime(right) - getCreatedAtTime(left));
    const criticalCount = activeJobs.filter((job) => normalizeSeverity(job.severity) === 'critical').length;
    const latestJob = filteredJobs[0] || null;
    const latestState = latestJob
        ? (category.problem_types.includes(normalizeText(latestJob.alert_type, 120).toLowerCase()) ? 'problem' : 'recovered')
        : 'idle';

    return {
        key: category.key,
        label: category.label,
        description: category.description,
        active_count: activeJobs.length,
        critical_count: criticalCount,
        recent_job_count: filteredJobs.length,
        latest_state: latestState,
        latest_at: normalizeText(latestJob?.created_at, 80) || null,
        latest_title: normalizeText(latestJob?.title, 240) || null,
        latest_message: latestJob ? getAlertExcerpt(latestJob) : '',
        items: activeJobs.slice(0, 3).map(buildAlertItem)
    };
}

module.exports = async (req, res) => {
    try {
        const { supabase } = await requireAdmin(req);

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const now = new Date();
        const sinceIso = new Date(now.getTime() - OPS_ALERT_MONITOR_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
        const jobs = await fetchRecentOpsAlertJobs(supabase, sinceIso);
        const categories = ALERT_MONITOR_CATEGORIES.map((category) => buildCategorySnapshot(category, jobs));
        const totalActiveCount = categories.reduce((sum, category) => sum + Number(category.active_count || 0), 0);
        const totalCriticalCount = categories.reduce((sum, category) => sum + Number(category.critical_count || 0), 0);
        const activeCategoryCount = categories.filter((category) => Number(category.active_count || 0) > 0).length;

        return sendJson(res, 200, {
            success: true,
            fetched_at: now.toISOString(),
            summary: {
                lookback_hours: OPS_ALERT_MONITOR_LOOKBACK_HOURS,
                total_job_count: jobs.length,
                total_active_count: totalActiveCount,
                total_critical_count: totalCriticalCount,
                active_category_count: activeCategoryCount
            },
            categories
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ops alert monitor settings failed'
        });
    }
};
