const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    loadOpsAlertsRuntimeConfig
} = require('../../../../api/_lib/ops-alerts');

const OPS_ALERT_MONITOR_LOOKBACK_HOURS = 7 * 24;
const OPS_ALERT_MONITOR_PAGE_SIZE = 200;
const OPS_ALERT_MONITOR_MAX_PAGES = 5;

const ALERT_MONITOR_CATEGORIES = Object.freeze([
    {
        key: 'payments',
        label: '支付与退款',
        description: '聚合支付通道、退款售后和支付配置相关告警。',
        problem_types: ['payment_refund_ops', 'payment_gateway_degraded', 'payment_config_changed', 'payment_config_incident'],
        recovery_types: ['payment_gateway_recovered', 'payment_config_recovered', 'payment_config_incident_recovered']
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
    },
    {
        key: 'shop_risk',
        label: '商城风控',
        description: '聚合优惠码滥用、0 价订单和短时扫货风险告警。',
        problem_types: ['shop_order_risk_anomaly'],
        recovery_types: ['shop_order_risk_recovered']
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

function getShopOrderRiskSignalLabel(value) {
    const normalized = normalizeText(value, 80).toLowerCase();
    const labelMap = {
        discount_code_spike: '优惠码高频使用',
        zero_total_cluster: '0 价订单聚集',
        user_velocity: '账号短时扫货',
        shared_login_ip_cluster: '共享登录 IP 多账号下单',
        shared_login_signature_cluster: '共享登录签名多账号下单'
    };
    return labelMap[normalized] || normalized;
}

function getShopOrderRiskActionLabel(value) {
    const normalized = normalizeText(value, 80).toLowerCase();
    const labelMap = {
        'disable-coupon': '自动停用优惠码',
        'open-user-ban': '封禁高风险账号',
        'suspend-product': '自动下架商品',
        'review-orders': '复核风险订单'
    };
    return labelMap[normalized] || normalized || '人工复核';
}

function getShopOrderRiskAutoStatusLabel(value, autoResponseEnabled = true) {
    const normalized = normalizeText(value, 80).toLowerCase();
    const labelMap = {
        applied: '已自动处置',
        already_inactive: '目标已停用',
        already_blocked: '账号已封禁',
        not_found: '目标不存在',
        failed: '自动处置失败',
        pending_review: autoResponseEnabled ? '待人工确认' : '自动处置关闭',
        auto_response_disabled: '自动处置关闭'
    };
    return labelMap[normalized] || (autoResponseEnabled ? '待人工确认' : '自动处置关闭');
}

function getAlertReference(job = {}) {
    const payload = normalizePayload(job.payload);
    const signalType = normalizeText(payload.signal_type, 120).toLowerCase();

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
    if (normalizeText(payload.discount_code, 160)) {
        return {
            label: '优惠码',
            value: normalizeText(payload.discount_code, 160)
        };
    }
    if (signalType === 'shared_login_signature_cluster' && normalizeText(payload.login_signature_label, 160)) {
        return {
            label: '共享登录签名',
            value: normalizeText(payload.login_signature_label, 160)
        };
    }
    if (normalizeText(payload.client_ip, 160)) {
        return {
            label: '共享登录 IP',
            value: normalizeText(payload.client_ip, 160)
        };
    }
    if (normalizeText(payload.login_signature_label, 160)) {
        return {
            label: '共享登录签名',
            value: normalizeText(payload.login_signature_label, 160)
        };
    }
    if (normalizeText(payload.buyer_label, 160)) {
        return {
            label: '账号',
            value: normalizeText(payload.buyer_label, 160)
        };
    }
    if (normalizeText(payload.signal_type, 160)) {
        return {
            label: '风控信号',
            value: getShopOrderRiskSignalLabel(payload.signal_type)
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
    const payload = normalizePayload(job.payload);
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
        reference_value: reference.value,
        signal_type: normalizeText(payload.signal_type, 120) || null,
        discount_code: normalizeText(payload.discount_code, 160) || null,
        buyer_label: normalizeText(payload.buyer_label, 160) || null,
        user_id: normalizeText(payload.user_id, 160) || null,
        client_ip: normalizeText(payload.client_ip, 160) || null,
        risk_level: normalizeText(payload.risk_level, 40) || null,
        risk_score: Number.isFinite(Number(payload.risk_score)) ? Math.max(0, Math.round(Number(payload.risk_score || 0))) : null,
        primary_action: normalizeText(payload.primary_action, 80) || null,
        response_summary: normalizeText(payload.response_summary, 240) || null,
        auto_response_action: normalizeText(payload.auto_response_action, 80) || null,
        auto_response_status: normalizeText(payload.auto_response_status, 80) || null,
        auto_response_summary: normalizeText(payload.auto_response_summary, 240) || null,
        auto_response_applied_at: normalizeText(payload.auto_response_applied_at, 80) || null,
        auto_response_target: normalizeText(payload.auto_response_target, 160) || null,
        auto_response_target_type: normalizeText(payload.auto_response_target_type, 80) || null,
        login_signature_label: normalizeText(payload.login_signature_label, 160) || null,
        user_agent_summary: normalizeText(payload.user_agent_summary, 160) || null
    };
}

function buildShopRiskThresholdConfig(config = {}) {
    const source = config && typeof config === 'object' ? config : {};
    return {
        auto_response_enabled: source.auto_response_enabled !== false,
        auto_disable_coupon_min_risk_score: Number.isFinite(Number(source.auto_disable_coupon_min_risk_score))
            ? Math.max(65, Math.min(99, Math.round(Number(source.auto_disable_coupon_min_risk_score))))
            : 90,
        auto_ban_user_min_risk_score: Number.isFinite(Number(source.auto_ban_user_min_risk_score))
            ? Math.max(80, Math.min(99, Math.round(Number(source.auto_ban_user_min_risk_score))))
            : 96,
        auto_ban_user_duration_days: Number.isFinite(Number(source.auto_ban_user_duration_days))
            ? Math.max(1, Math.min(30, Math.round(Number(source.auto_ban_user_duration_days))))
            : 7,
        auto_suspend_product_min_risk_score: Number.isFinite(Number(source.auto_suspend_product_min_risk_score))
            ? Math.max(85, Math.min(99, Math.round(Number(source.auto_suspend_product_min_risk_score))))
            : 97
    };
}

function buildShopRiskThresholdHitEntries(jobs = [], config = {}) {
    const thresholdConfig = buildShopRiskThresholdConfig(config);
    const entries = [];

    for (const job of sortByCreatedAtDesc(jobs)) {
        if (normalizeText(job.alert_type, 120).toLowerCase() !== 'shop_order_risk_anomaly') {
            continue;
        }

        const payload = normalizePayload(job.payload);
        const score = Number(payload.risk_score || 0);
        if (!Number.isFinite(score)) {
            continue;
        }

        const primaryAction = normalizeText(payload.primary_action, 80).toLowerCase();
        const signalType = normalizeText(payload.signal_type, 120).toLowerCase();
        const autoResponseStatus = normalizeText(payload.auto_response_status, 80).toLowerCase()
            || (thresholdConfig.auto_response_enabled ? 'pending_review' : 'auto_response_disabled');
        const reference = getAlertReference(job);

        if (
            primaryAction === 'disable-coupon'
            && normalizeText(payload.discount_code, 160)
            && score >= thresholdConfig.auto_disable_coupon_min_risk_score
        ) {
            entries.push({
                id: `${normalizeText(job.id, 160) || normalizeText(payload.target_id, 160)}:disable-coupon`,
                created_at: normalizeText(job.created_at, 80) || null,
                action: 'disable-coupon',
                action_label: getShopOrderRiskActionLabel('disable-coupon'),
                threshold: thresholdConfig.auto_disable_coupon_min_risk_score,
                risk_score: Math.max(0, Math.round(score)),
                reference_label: '优惠码',
                reference_value: normalizeText(payload.discount_code, 160).toUpperCase(),
                title: normalizeText(job.title, 240) || '优惠码风险命中',
                status: autoResponseStatus,
                status_label: getShopOrderRiskAutoStatusLabel(autoResponseStatus, thresholdConfig.auto_response_enabled),
                summary: normalizeText(payload.auto_response_summary, 240)
                    || normalizeText(payload.response_summary, 240)
                    || '已命中停用优惠码阈值。'
            });
        }

        if (
            primaryAction === 'open-user-ban'
            && signalType === 'user_velocity'
            && normalizeText(payload.user_id, 160)
            && score >= thresholdConfig.auto_ban_user_min_risk_score
        ) {
            entries.push({
                id: `${normalizeText(job.id, 160) || normalizeText(payload.target_id, 160)}:ban-user`,
                created_at: normalizeText(job.created_at, 80) || null,
                action: 'ban-user',
                action_label: getShopOrderRiskActionLabel('open-user-ban'),
                threshold: thresholdConfig.auto_ban_user_min_risk_score,
                risk_score: Math.max(0, Math.round(score)),
                reference_label: reference.label || '账号',
                reference_value: normalizeText(payload.buyer_label, 160) || normalizeText(reference.value, 160) || normalizeText(payload.user_id, 160),
                title: normalizeText(job.title, 240) || '账号风控阈值命中',
                status: autoResponseStatus,
                status_label: getShopOrderRiskAutoStatusLabel(autoResponseStatus, thresholdConfig.auto_response_enabled),
                summary: normalizeText(payload.auto_response_summary, 240)
                    || normalizeText(payload.response_summary, 240)
                    || '已命中自动封禁账号阈值。'
            });
        }

        if (
            signalType === 'zero_total_cluster'
            && normalizeText(payload.primary_product_id, 160)
            && Number(payload.primary_product_order_share || 0) >= 0.6
            && Number(payload.primary_product_order_count || 0) >= 3
            && score >= thresholdConfig.auto_suspend_product_min_risk_score
        ) {
            entries.push({
                id: `${normalizeText(job.id, 160) || normalizeText(payload.target_id, 160)}:suspend-product`,
                created_at: normalizeText(job.created_at, 80) || null,
                action: 'suspend-product',
                action_label: getShopOrderRiskActionLabel('suspend-product'),
                threshold: thresholdConfig.auto_suspend_product_min_risk_score,
                risk_score: Math.max(0, Math.round(score)),
                reference_label: '商品',
                reference_value: normalizeText(payload.primary_product_name, 160) || normalizeText(payload.primary_product_id, 160),
                title: normalizeText(job.title, 240) || '商品风控阈值命中',
                status: autoResponseStatus,
                status_label: getShopOrderRiskAutoStatusLabel(autoResponseStatus, thresholdConfig.auto_response_enabled),
                summary: normalizeText(payload.auto_response_summary, 240)
                    || '已命中自动下架商品阈值。'
            });
        }
    }

    return entries.slice(0, 5);
}

function buildShopRiskAutoResponseHistoryEntries(jobs = [], config = {}) {
    const thresholdConfig = buildShopRiskThresholdConfig(config);

    return sortByCreatedAtDesc(jobs)
        .filter((job) => normalizeText(job.alert_type, 120).toLowerCase() === 'shop_order_risk_anomaly')
        .map((job) => {
            const payload = normalizePayload(job.payload);
            const action = normalizeText(payload.auto_response_action, 80).toLowerCase();
            const summary = normalizeText(payload.auto_response_summary, 240);
            if (!action && !summary) {
                return null;
            }

            const reference = getAlertReference(job);
            const status = normalizeText(payload.auto_response_status, 80).toLowerCase()
                || (thresholdConfig.auto_response_enabled ? 'pending_review' : 'auto_response_disabled');

            return {
                id: normalizeText(job.id, 160) || normalizeText(payload.target_id, 160),
                created_at: normalizeText(payload.auto_response_applied_at, 80) || normalizeText(job.created_at, 80) || null,
                action,
                action_label: getShopOrderRiskActionLabel(action),
                target: normalizeText(payload.auto_response_target, 160) || normalizeText(reference.value, 160) || null,
                target_type: normalizeText(payload.auto_response_target_type, 80) || null,
                status,
                status_label: getShopOrderRiskAutoStatusLabel(status, thresholdConfig.auto_response_enabled),
                summary: summary || normalizeText(payload.response_summary, 240) || '已写入自动处置记录。',
                reference_label: reference.label,
                reference_value: reference.value,
                title: normalizeText(job.title, 240) || '商城风控自动处置'
            };
        })
        .filter(Boolean)
        .slice(0, 5);
}

function buildCategorySnapshot(category, jobs = [], options = {}) {
    const shopRiskThresholdConfig = buildShopRiskThresholdConfig(options.shopRiskConfig);
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
        items: activeJobs.slice(0, 3).map(buildAlertItem),
        ...(String(category.key || '').trim().toLowerCase() === 'shop_risk' ? {
            thresholds: shopRiskThresholdConfig,
            recent_threshold_hits: buildShopRiskThresholdHitEntries(filteredJobs, shopRiskThresholdConfig),
            recent_auto_responses: buildShopRiskAutoResponseHistoryEntries(filteredJobs, shopRiskThresholdConfig)
        } : {})
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
        const runtime = await loadOpsAlertsRuntimeConfig(supabase);
        const jobs = await fetchRecentOpsAlertJobs(supabase, sinceIso);
        const categories = ALERT_MONITOR_CATEGORIES.map((category) => buildCategorySnapshot(category, jobs, {
            shopRiskConfig: runtime?.config?.shop_order_risk || {}
        }));
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
