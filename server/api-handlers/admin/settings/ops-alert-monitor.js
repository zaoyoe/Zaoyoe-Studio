const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    loadOpsAlertsRuntimeConfig
} = require('../../../../api/_lib/ops-alerts');
const {
    buildOwnerLabel,
    fetchAssignableOpsAlertAdmins,
    fetchOpsAlertCaseEventsByTargets,
    getOpsAlertCaseEventActionLabel,
    isMissingTableAccessError,
    mapCaseLastActionToEventAction
} = require('./_ops-alert-case-events');

const OPS_ALERT_MONITOR_LOOKBACK_HOURS = 7 * 24;
const OPS_ALERT_MONITOR_PAGE_SIZE = 200;
const OPS_ALERT_MONITOR_MAX_PAGES = 5;
const OPS_ALERT_CASE_EVENT_LIMIT = 3;
const OPS_ALERT_MONITOR_SHIFT_HOURS = 12;
const OPS_ALERT_MONITOR_SHIFT_BUCKET_COUNT = 6;
const OPS_ALERT_MONITOR_SHIFT_CATEGORY_LIMIT = 4;
const OPS_ALERT_MONITOR_SHIFT_ADMIN_LIMIT = 6;
const OPS_ALERT_MONITOR_SHIFT_CLOSE_REASON_LIMIT = 5;
const OPS_ALERT_CASES_SELECT_FIELDS = 'category_key, target_id, alert_type, status, owner_admin_id, owner_label, note, resolution, metadata, last_action, last_action_at, updated_at';

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
    },
    {
        key: 'verify',
        label: '验证服务',
        description: '聚合验证额度不足、服务停摆、队列堆积、失败率飙升和综合事故相关告警。',
        problem_types: ['verify_quota_low', 'verify_service_disabled', 'verify_queue_backlog', 'verify_failure_rate_spike', 'verify_incident_escalated'],
        recovery_types: ['verify_incident_recovered']
    },
    {
        key: 'security',
        label: '安全与审计',
        description: '聚合管理员异常登录等后台安全告警。',
        problem_types: ['security_admin_login_anomaly'],
        recovery_types: []
    }
]);

const ALL_MONITOR_ALERT_TYPES = Object.freeze(
    [...new Set(ALERT_MONITOR_CATEGORIES.flatMap((category) => [
        ...(category.problem_types || []),
        ...(category.recovery_types || [])
    ]))]
);
const ALL_MONITOR_PROBLEM_TYPES = new Set(
    ALERT_MONITOR_CATEGORIES.flatMap((category) => category.problem_types || [])
);
const ALL_MONITOR_RECOVERY_TYPES = new Set(
    ALERT_MONITOR_CATEGORIES.flatMap((category) => category.recovery_types || [])
);
const ALERT_MONITOR_CATEGORY_LABELS = Object.freeze(
    ALERT_MONITOR_CATEGORIES.reduce((accumulator, category) => {
        accumulator[category.key] = category.label;
        return accumulator;
    }, {})
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

function getSafeTimestamp(value) {
    const parsed = Date.parse(normalizeText(value, 80));
    return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(timestamp) {
    return Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp).toISOString()
        : null;
}

function getAlertTypeState(alertType = '') {
    const normalizedAlertType = normalizeText(alertType, 120).toLowerCase();
    if (ALL_MONITOR_PROBLEM_TYPES.has(normalizedAlertType)) {
        return 'problem';
    }
    if (ALL_MONITOR_RECOVERY_TYPES.has(normalizedAlertType)) {
        return 'recovered';
    }
    return 'unknown';
}

function buildOpsAlertCaseKey(categoryKey, targetId) {
    return `${normalizeText(categoryKey, 80).toLowerCase()}::${normalizeText(targetId, 200)}`;
}

function buildOpsAlertCaseRecord(row = {}, categoryKeyFallback = '') {
    return {
        category_key: normalizeText(row.category_key, 80).toLowerCase() || normalizeText(categoryKeyFallback, 80).toLowerCase() || null,
        target_id: normalizeText(row.target_id, 200) || null,
        alert_type: normalizeText(row.alert_type, 120).toLowerCase() || null,
        status: normalizeText(row.status, 40).toLowerCase() || 'open',
        owner_admin_id: normalizeText(row.owner_admin_id, 160) || null,
        owner_label: normalizeText(row.owner_label, 255) || null,
        note: normalizeText(row.note, 2000) || null,
        resolution: normalizeText(row.resolution, 2000) || null,
        metadata: normalizePayload(row.metadata),
        last_action: normalizeText(row.last_action, 80).toLowerCase() || 'opened',
        last_action_at: normalizeText(row.last_action_at, 80) || null,
        updated_at: normalizeText(row.updated_at, 80) || null
    };
}

function isMissingOpsAlertCasesTableError(error) {
    return isMissingTableAccessError(error, 'ops_alert_cases');
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

async function fetchLegacyShopRiskCasesByTargetIds(supabase, targetIds = []) {
    const normalizedTargetIds = Array.from(new Set(
        (Array.isArray(targetIds) ? targetIds : [])
            .map((value) => normalizeText(value, 200))
            .filter(Boolean)
    ));

    if (!normalizedTargetIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('shop_risk_cases')
        .select('target_id, status, owner_admin_id, owner_label, note, resolution, metadata, last_action, last_action_at, updated_at')
        .in('target_id', normalizedTargetIds);

    if (error) {
        throw error;
    }

    return new Map(
        (Array.isArray(data) ? data : []).map((row) => {
            const caseRecord = buildOpsAlertCaseRecord({
                ...row,
                category_key: 'shop_risk'
            }, 'shop_risk');
            return [
                buildOpsAlertCaseKey('shop_risk', caseRecord.target_id),
                caseRecord
            ];
        })
    );
}

async function fetchOpsAlertCasesByTargets(supabase, targets = []) {
    const normalizedTargets = Array.from(new Map(
        (Array.isArray(targets) ? targets : [])
            .map((item) => ({
                category_key: normalizeText(item?.category_key || item?.categoryKey, 80).toLowerCase(),
                target_id: normalizeText(item?.target_id || item?.targetId, 200)
            }))
            .filter((item) => item.category_key && item.target_id)
            .map((item) => [buildOpsAlertCaseKey(item.category_key, item.target_id), item])
    ).values());

    if (!normalizedTargets.length) {
        return new Map();
    }

    const groupedTargets = normalizedTargets.reduce((accumulator, item) => {
        if (!accumulator.has(item.category_key)) {
            accumulator.set(item.category_key, []);
        }
        accumulator.get(item.category_key).push(item.target_id);
        return accumulator;
    }, new Map());

    const caseMap = new Map();

    try {
        for (const [categoryKey, targetIds] of groupedTargets.entries()) {
            const { data, error } = await supabase
                .from('ops_alert_cases')
                .select(OPS_ALERT_CASES_SELECT_FIELDS)
                .in('category_key', [categoryKey])
                .in('target_id', Array.from(new Set(targetIds)));

            if (error) {
                throw error;
            }

            (Array.isArray(data) ? data : []).forEach((row) => {
                const caseRecord = buildOpsAlertCaseRecord(row, categoryKey);
                caseMap.set(
                    buildOpsAlertCaseKey(caseRecord.category_key, caseRecord.target_id),
                    caseRecord
                );
            });
        }

        return caseMap;
    } catch (error) {
        if (!isMissingOpsAlertCasesTableError(error)) {
            throw error;
        }
    }

    const legacyShopRiskCases = await fetchLegacyShopRiskCasesByTargetIds(
        supabase,
        groupedTargets.get('shop_risk') || []
    );
    legacyShopRiskCases.forEach((value, key) => {
        caseMap.set(key, value);
    });

    return caseMap;
}

function buildFallbackOpsAlertCaseEvent(caseRecord = {}) {
    const fallbackCreatedAt = normalizeText(caseRecord?.last_action_at, 80) || normalizeText(caseRecord?.updated_at, 80);
    const mappedAction = mapCaseLastActionToEventAction(caseRecord?.last_action);
    if (!mappedAction && !fallbackCreatedAt) {
        return null;
    }

    const resolution = normalizeText(caseRecord?.resolution, 2000) || null;
    const note = normalizeText(caseRecord?.note, 2000) || null;
    const ownerLabel = normalizeText(caseRecord?.owner_label, 255) || null;
    let summary = '';

    if (mappedAction === 'resolve' && resolution) {
        summary = resolution;
    } else if (note) {
        summary = note;
    } else if (ownerLabel && ['claim', 'assign'].includes(mappedAction)) {
        summary = `负责人 ${ownerLabel}`;
    }

    return {
        id: null,
        category_key: normalizeText(caseRecord?.category_key, 80).toLowerCase() || null,
        target_id: normalizeText(caseRecord?.target_id, 200) || null,
        alert_type: normalizeText(caseRecord?.alert_type, 120).toLowerCase() || null,
        action: mappedAction || null,
        action_label: getOpsAlertCaseEventActionLabel(mappedAction),
        summary: summary || null,
        status: normalizeText(caseRecord?.status, 40).toLowerCase() || null,
        owner_admin_id: normalizeText(caseRecord?.owner_admin_id, 160) || null,
        owner_label: ownerLabel,
        actor_admin_id: normalizeText(caseRecord?.last_action_by, 160) || null,
        actor_label: null,
        note,
        resolution,
        metadata: normalizePayload(caseRecord?.metadata),
        created_at: fallbackCreatedAt || null
    };
}

function buildOpsAlertCaseEventView(event = {}) {
    return {
        id: normalizeText(event.id, 160) || null,
        action: normalizeText(event.action, 80).toLowerCase() || null,
        action_label: normalizeText(event.action_label, 120) || null,
        summary: normalizeText(event.summary, 2000) || null,
        status: normalizeText(event.status, 40).toLowerCase() || null,
        owner_admin_id: normalizeText(event.owner_admin_id, 160) || null,
        owner_label: normalizeText(event.owner_label, 255) || null,
        actor_admin_id: normalizeText(event.actor_admin_id, 160) || null,
        actor_label: normalizeText(event.actor_label, 255) || null,
        note: normalizeText(event.note, 2000) || null,
        resolution: normalizeText(event.resolution, 2000) || null,
        metadata: normalizePayload(event.metadata),
        created_at: normalizeText(event.created_at, 80) || null
    };
}

function buildOpsAlertItemCaseState(categoryKey = '', targetId = '', caseRecord = null, caseEventsByKey = new Map()) {
    const normalizedCategoryKey = normalizeText(categoryKey, 80).toLowerCase();
    const normalizedTargetId = normalizeText(targetId, 200);
    const caseKey = buildOpsAlertCaseKey(normalizedCategoryKey, normalizedTargetId);
    const rawEvents = caseEventsByKey instanceof Map ? caseEventsByKey.get(caseKey) : null;
    const timeline = Array.isArray(rawEvents) && rawEvents.length
        ? rawEvents.map((event) => buildOpsAlertCaseEventView(event)).slice(0, OPS_ALERT_CASE_EVENT_LIMIT)
        : [];
    const fallbackEvent = timeline.length ? null : buildFallbackOpsAlertCaseEvent({
        ...caseRecord,
        category_key: normalizedCategoryKey || caseRecord?.category_key,
        target_id: normalizedTargetId || caseRecord?.target_id
    });
    const recentEvents = timeline.length
        ? timeline
        : (fallbackEvent ? [buildOpsAlertCaseEventView(fallbackEvent)] : []);
    const latestEvent = recentEvents[0] || null;
    const latestNoteEvent = recentEvents.find((event) => normalizeText(event?.note, 2000));

    return {
        case_status: normalizeText(caseRecord?.status || latestEvent?.status, 40).toLowerCase() || 'open',
        case_owner_admin_id: normalizeText(caseRecord?.owner_admin_id || latestEvent?.owner_admin_id, 160) || null,
        case_owner_label: normalizeText(caseRecord?.owner_label || latestEvent?.owner_label, 255) || null,
        case_note: normalizeText(caseRecord?.note, 2000) || null,
        case_resolution: normalizeText(caseRecord?.resolution, 2000) || null,
        case_last_action: normalizeText(caseRecord?.last_action, 80).toLowerCase()
            || normalizeText(latestEvent?.action, 80).toLowerCase()
            || null,
        case_last_action_at: normalizeText(caseRecord?.last_action_at, 80)
            || normalizeText(latestEvent?.created_at, 80)
            || null,
        case_updated_at: normalizeText(caseRecord?.updated_at, 80) || null,
        case_recent_note: normalizeText(latestNoteEvent?.note, 2000) || null,
        case_recent_note_at: normalizeText(latestNoteEvent?.created_at, 80) || null,
        case_latest_event_action: normalizeText(latestEvent?.action, 80).toLowerCase() || null,
        case_latest_event_label: normalizeText(latestEvent?.action_label, 120) || null,
        case_latest_event_summary: normalizeText(latestEvent?.summary, 2000) || null,
        case_latest_event_at: normalizeText(latestEvent?.created_at, 80) || null,
        case_latest_event_by_label: normalizeText(latestEvent?.actor_label, 255) || null,
        case_latest_event_owner_label: normalizeText(latestEvent?.owner_label, 255) || null,
        case_recent_events: recentEvents.map((event) => ({
            id: normalizeText(event.id, 160) || null,
            action: normalizeText(event.action, 80).toLowerCase() || null,
            action_label: normalizeText(event.action_label, 120) || null,
            summary: normalizeText(event.summary, 2000) || null,
            status: normalizeText(event.status, 40).toLowerCase() || null,
            owner_label: normalizeText(event.owner_label, 255) || null,
            actor_label: normalizeText(event.actor_label, 255) || null,
            note: normalizeText(event.note, 2000) || null,
            resolution: normalizeText(event.resolution, 2000) || null,
            created_at: normalizeText(event.created_at, 80) || null,
            metadata: normalizePayload(event.metadata)
        }))
    };
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
        || normalizeText(payload.key_name, 160)
        || normalizeText(payload.admin_email, 160)
        || normalizeText(payload.client_ip, 160)
        || normalizeText(payload.provider_order_no, 160)
        || normalizeText(job.id, 160)
        || 'unknown';
}

function getAlertCategoryKey(alertType = '') {
    const normalizedAlertType = normalizeText(alertType, 120).toLowerCase();
    const matchedCategory = ALERT_MONITOR_CATEGORIES.find((category) => (
        category.problem_types.includes(normalizedAlertType)
        || category.recovery_types.includes(normalizedAlertType)
    ));
    return normalizeText(matchedCategory?.key, 80).toLowerCase() || '';
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
    if (normalizeText(payload.key_name, 160)) {
        return {
            label: 'API Key',
            value: normalizeText(payload.key_name, 160)
        };
    }
    if (normalizeText(payload.admin_email, 160)) {
        return {
            label: '管理员',
            value: normalizeText(payload.admin_email, 160)
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
    if (normalizeText(payload.api_base_url, 160)) {
        return {
            label: 'API Base',
            value: normalizeText(payload.api_base_url, 160)
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

function buildAlertItem(job = {}, categoryKey = '', options = {}) {
    const payload = normalizePayload(job.payload);
    const reference = getAlertReference(job);
    const targetId = getAlertTargetId(job);
    const opsAlertCasesByKey = options.opsAlertCasesByKey instanceof Map
        ? options.opsAlertCasesByKey
        : new Map();
    const caseEventsByKey = options.caseEventsByKey instanceof Map
        ? options.caseEventsByKey
        : new Map();
    const caseRecord = opsAlertCasesByKey.get(buildOpsAlertCaseKey(categoryKey, targetId)) || null;
    const caseState = buildOpsAlertItemCaseState(categoryKey, targetId, caseRecord, caseEventsByKey);

    return {
        id: normalizeText(job.id, 160),
        alert_type: normalizeText(job.alert_type, 120).toLowerCase(),
        severity: normalizeSeverity(job.severity),
        title: normalizeText(job.title, 240) || '系统告警',
        message: getAlertExcerpt(job),
        created_at: normalizeText(job.created_at, 80) || null,
        target_id: targetId,
        reference_label: reference.label,
        reference_value: reference.value,
        signal_type: normalizeText(payload.signal_type, 120) || null,
        discount_code: normalizeText(payload.discount_code, 160) || null,
        buyer_label: normalizeText(payload.buyer_label, 160) || null,
        user_id: normalizeText(payload.user_id, 160) || null,
        admin_email: normalizeText(payload.admin_email, 160) || null,
        client_ip: normalizeText(payload.client_ip, 160) || null,
        key_name: normalizeText(payload.key_name, 160) || null,
        api_base_url: normalizeText(payload.api_base_url, 240) || null,
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
        user_agent_summary: normalizeText(payload.user_agent_summary, 160) || null,
        ...caseState
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

function buildShopRiskThresholdHitEntries(jobs = [], config = {}, options = {}) {
    const thresholdConfig = buildShopRiskThresholdConfig(config);
    const opsAlertCasesByKey = options.opsAlertCasesByKey instanceof Map
        ? options.opsAlertCasesByKey
        : new Map();
    const caseEventsByKey = options.caseEventsByKey instanceof Map
        ? options.caseEventsByKey
        : new Map();
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
        const targetId = getAlertTargetId(job);
        const caseRecord = opsAlertCasesByKey.get(buildOpsAlertCaseKey('shop_risk', targetId)) || null;
        const caseState = buildOpsAlertItemCaseState('shop_risk', targetId, caseRecord, caseEventsByKey);

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
                    || '已命中停用优惠码阈值。',
                case_status: caseState.case_status,
                case_owner_label: caseState.case_owner_label
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
                    || '已命中自动封禁账号阈值。',
                case_status: caseState.case_status,
                case_owner_label: caseState.case_owner_label
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
                    || '已命中自动下架商品阈值。',
                case_status: caseState.case_status,
                case_owner_label: caseState.case_owner_label
            });
        }
    }

    return entries.slice(0, 5);
}

function buildShopRiskAutoResponseHistoryEntries(jobs = [], config = {}, options = {}) {
    const thresholdConfig = buildShopRiskThresholdConfig(config);
    const opsAlertCasesByKey = options.opsAlertCasesByKey instanceof Map
        ? options.opsAlertCasesByKey
        : new Map();
    const caseEventsByKey = options.caseEventsByKey instanceof Map
        ? options.caseEventsByKey
        : new Map();

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
            const targetId = getAlertTargetId(job);
            const caseRecord = opsAlertCasesByKey.get(buildOpsAlertCaseKey('shop_risk', targetId)) || null;
            const caseState = buildOpsAlertItemCaseState('shop_risk', targetId, caseRecord, caseEventsByKey);

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
                title: normalizeText(job.title, 240) || '商城风控自动处置',
                case_status: caseState.case_status,
                case_owner_label: caseState.case_owner_label
            };
        })
        .filter(Boolean)
        .slice(0, 5);
}

function buildOpsAlertCaseSummary(items = []) {
    return (Array.isArray(items) ? items : []).reduce((summary, item) => {
        const status = normalizeText(item?.case_status, 40).toLowerCase() || 'open';
        if (status === 'claimed') {
            summary.claimed += 1;
        } else if (status === 'resolved') {
            summary.resolved += 1;
        } else {
            summary.open += 1;
        }
        return summary;
    }, {
        open: 0,
        claimed: 0,
        resolved: 0
    });
}

function buildCategorySnapshot(category, jobs = [], options = {}) {
    const shopRiskThresholdConfig = buildShopRiskThresholdConfig(options.shopRiskConfig);
    const opsAlertCasesByKey = options.opsAlertCasesByKey instanceof Map
        ? options.opsAlertCasesByKey
        : new Map();
    const caseEventsByKey = options.caseEventsByKey instanceof Map
        ? options.caseEventsByKey
        : new Map();
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
    const builtItems = activeJobs.map((job) => buildAlertItem(job, category.key, {
        opsAlertCasesByKey,
        caseEventsByKey
    }));

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
        items: builtItems,
        case_summary: buildOpsAlertCaseSummary(builtItems),
        ...(String(category.key || '').trim().toLowerCase() === 'shop_risk' ? {
            thresholds: shopRiskThresholdConfig,
            recent_threshold_hits: buildShopRiskThresholdHitEntries(filteredJobs, shopRiskThresholdConfig, {
                opsAlertCasesByKey,
                caseEventsByKey
            }),
            recent_auto_responses: buildShopRiskAutoResponseHistoryEntries(filteredJobs, shopRiskThresholdConfig, {
                opsAlertCasesByKey,
                caseEventsByKey
            })
        } : {})
    };
}

function buildOpsAlertMonitorEventTimeline(caseEventsByKey = new Map()) {
    const timelineByKey = new Map();

    if (!(caseEventsByKey instanceof Map)) {
        return timelineByKey;
    }

    caseEventsByKey.forEach((events, caseKey) => {
        const normalizedEvents = (Array.isArray(events) ? events : [])
            .map((event) => ({
                ...event,
                created_time: getSafeTimestamp(event?.created_at)
            }))
            .filter((event) => event.created_time > 0)
            .sort((left, right) => left.created_time - right.created_time);

        timelineByKey.set(caseKey, normalizedEvents);
    });

    return timelineByKey;
}

function buildOpsAlertMonitorJobTimeline(jobs = []) {
    const timelineByKey = new Map();

    sortByCreatedAtDesc(jobs)
        .slice()
        .reverse()
        .forEach((job) => {
            const categoryKey = getAlertCategoryKey(job.alert_type);
            const targetId = getAlertTargetId(job);
            if (!categoryKey || !targetId) {
                return;
            }

            const caseKey = buildOpsAlertCaseKey(categoryKey, targetId);
            if (!timelineByKey.has(caseKey)) {
                timelineByKey.set(caseKey, []);
            }

            timelineByKey.get(caseKey).push({
                category_key: categoryKey,
                category_label: ALERT_MONITOR_CATEGORY_LABELS[categoryKey] || categoryKey,
                target_id: targetId,
                alert_type: normalizeText(job.alert_type, 120).toLowerCase(),
                severity: normalizeSeverity(job.severity),
                created_at: normalizeText(job.created_at, 80) || null,
                created_time: getCreatedAtTime(job)
            });
        });

    return timelineByKey;
}

function getLatestTimelineEntryBeforeTime(entries = [], timeMs = 0) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const candidate = entries[index];
        if (Number(candidate?.created_time || 0) <= timeMs) {
            return candidate;
        }
    }

    return null;
}

function isOpsAlertBacklogAtTime(jobEntries = [], eventEntries = [], timeMs = 0) {
    const latestJob = getLatestTimelineEntryBeforeTime(jobEntries, timeMs);
    if (!latestJob || getAlertTypeState(latestJob.alert_type) !== 'problem') {
        return false;
    }

    const latestEvent = getLatestTimelineEntryBeforeTime(eventEntries, timeMs);
    if (!latestEvent) {
        return true;
    }

    const latestEventStatus = normalizeText(latestEvent.status, 40).toLowerCase();
    const latestEventAction = normalizeText(latestEvent.action, 80).toLowerCase();
    const latestEventTime = Number(latestEvent.created_time || 0);

    if (
        (latestEventStatus === 'resolved' || latestEventAction === 'resolve')
        && latestEventTime >= Number(latestJob.created_time || 0)
    ) {
        return false;
    }

    return true;
}

function countOpsAlertBacklogAtTime(jobTimelineByKey = new Map(), eventTimelineByKey = new Map(), timeMs = 0) {
    let count = 0;

    jobTimelineByKey.forEach((jobEntries, caseKey) => {
        if (isOpsAlertBacklogAtTime(jobEntries, eventTimelineByKey.get(caseKey) || [], timeMs)) {
            count += 1;
        }
    });

    return count;
}

function getLatestProblemJobBeforeTime(jobEntries = [], timeMs = 0, minTimeMs = 0) {
    for (let index = jobEntries.length - 1; index >= 0; index -= 1) {
        const candidate = jobEntries[index];
        const candidateTime = Number(candidate?.created_time || 0);
        if (candidateTime <= minTimeMs || candidateTime > timeMs) {
            continue;
        }
        if (getAlertTypeState(candidate.alert_type) === 'problem') {
            return candidate;
        }
    }

    return null;
}

function getOpsAlertResolveDurationMinutes(resolveEvent = {}, eventEntries = [], jobEntries = []) {
    const resolveTime = Number(resolveEvent.created_time || getSafeTimestamp(resolveEvent.created_at));
    if (!resolveTime) {
        return null;
    }

    let cycleStartTime = 0;
    let lastResolvedTime = 0;

    for (const event of Array.isArray(eventEntries) ? eventEntries : []) {
        const eventTime = Number(event?.created_time || getSafeTimestamp(event?.created_at));
        if (!eventTime || eventTime >= resolveTime) {
            break;
        }

        const action = normalizeText(event.action, 80).toLowerCase();
        if (action === 'resolve') {
            lastResolvedTime = eventTime;
            cycleStartTime = 0;
            continue;
        }
        if (action === 'reopen') {
            cycleStartTime = eventTime;
            continue;
        }
        if (!cycleStartTime && ['claim', 'assign'].includes(action)) {
            cycleStartTime = eventTime;
        }
    }

    if (!cycleStartTime) {
        const latestProblemJob = getLatestProblemJobBeforeTime(jobEntries, resolveTime, lastResolvedTime);
        cycleStartTime = Number(latestProblemJob?.created_time || 0);
    }

    if (!cycleStartTime || cycleStartTime > resolveTime) {
        return null;
    }

    return Math.max(0, Math.round((resolveTime - cycleStartTime) / 60000));
}

function buildOpsAlertShiftAdminKey(adminId = '', adminLabel = '') {
    const normalizedAdminId = normalizeText(adminId, 160);
    if (normalizedAdminId) {
        return normalizedAdminId;
    }

    const normalizedAdminLabel = normalizeText(adminLabel, 255).toLowerCase();
    return normalizedAdminLabel ? `label:${normalizedAdminLabel}` : '';
}

function ensureOpsAlertShiftAdminStat(statsMap, adminLookupById, adminId = '', adminLabel = '', currentAdminId = '') {
    const key = buildOpsAlertShiftAdminKey(adminId, adminLabel);
    if (!key) {
        return null;
    }

    if (!statsMap.has(key)) {
        const normalizedAdminId = normalizeText(adminId, 160) || null;
        const normalizedLabel = normalizeText(
            adminLookupById.get(normalizedAdminId)?.label || adminLabel || adminId,
            255
        ) || '未指定负责人';

        statsMap.set(key, {
            admin_id: normalizedAdminId,
            label: normalizedLabel,
            claimed_count: 0,
            assigned_count: 0,
            resolved_count: 0,
            note_count: 0,
            reopened_count: 0,
            active_count: 0,
            critical_active_count: 0,
            resolution_minutes_total: 0,
            resolution_sample_count: 0,
            is_current: normalizedAdminId !== null && normalizedAdminId === normalizeText(currentAdminId, 160)
        });
    }

    return statsMap.get(key);
}

function getOpsAlertResolutionBucket(event = {}) {
    const categoryKey = normalizeText(event.category_key, 80).toLowerCase();
    const resolutionText = [
        normalizeText(event.resolution, 2000),
        normalizeText(event.summary, 2000)
    ].filter(Boolean).join(' ').toLowerCase();

    if (resolutionText.includes('误报') || resolutionText.includes('无需处理') || resolutionText.includes('重复')) {
        return { key: 'false_positive', label: '误报 / 无需处理' };
    }
    if (
        resolutionText.includes('自动')
        || resolutionText.includes('已停用')
        || resolutionText.includes('已封禁')
        || resolutionText.includes('已下架')
    ) {
        return { key: 'auto_response', label: '自动处置完成' };
    }
    if (
        resolutionText.includes('恢复')
        || resolutionText.includes('已补货')
        || resolutionText.includes('补货完成')
        || resolutionText.includes('恢复正常')
        || resolutionText.includes('阈值已解除')
    ) {
        return { key: 'recovered', label: '系统恢复 / 已补齐' };
    }
    if (
        categoryKey === 'shop_risk'
        || resolutionText.includes('风控')
        || resolutionText.includes('优惠码')
        || resolutionText.includes('封禁')
        || resolutionText.includes('下架')
    ) {
        return { key: 'risk_control', label: '风控处置完成' };
    }
    if (
        categoryKey === 'verify'
        || resolutionText.includes('验证')
        || resolutionText.includes('额度')
        || resolutionText.includes('队列')
        || resolutionText.includes('失败率')
    ) {
        return { key: 'verify', label: '验证服务已处理' };
    }
    if (
        categoryKey === 'security'
        || resolutionText.includes('安全')
        || resolutionText.includes('异常登录')
        || resolutionText.includes('管理员')
        || resolutionText.includes('ip')
    ) {
        return { key: 'security', label: '安全告警已处理' };
    }
    if (
        categoryKey === 'payments'
        || resolutionText.includes('支付')
        || resolutionText.includes('退款')
        || resolutionText.includes('通道')
    ) {
        return { key: 'payments', label: '支付 / 退款已处理' };
    }
    if (
        categoryKey === 'inventory'
        || resolutionText.includes('库存')
        || resolutionText.includes('补货')
    ) {
        return { key: 'inventory', label: '库存 / 补货已处理' };
    }
    if (
        categoryKey === 'fulfillment'
        || resolutionText.includes('履约')
        || resolutionText.includes('发货')
        || resolutionText.includes('死信')
    ) {
        return { key: 'fulfillment', label: '履约 / 死信已处理' };
    }
    if (
        categoryKey === 'tickets'
        || resolutionText.includes('工单')
        || resolutionText.includes('售后')
    ) {
        return { key: 'tickets', label: '工单 / 售后已处理' };
    }
    if (resolutionText) {
        return { key: 'manual', label: '人工处理完成' };
    }
    return { key: 'other', label: '其他关闭原因' };
}

function buildOpsAlertShiftCategorySummary(categories = []) {
    return (Array.isArray(categories) ? categories : [])
        .map((category) => {
            const items = Array.isArray(category.items) ? category.items : [];
            const backlogItems = items.filter((item) => normalizeText(item?.case_status, 40).toLowerCase() !== 'resolved');
            const claimedCount = backlogItems.filter((item) => normalizeText(item?.case_status, 40).toLowerCase() === 'claimed').length;
            const pendingCount = backlogItems.filter((item) => normalizeText(item?.case_status, 40).toLowerCase() !== 'claimed').length;
            const criticalCount = backlogItems.filter((item) => normalizeSeverity(item?.severity) === 'critical').length;

            return {
                key: normalizeText(category.key, 80).toLowerCase() || null,
                label: normalizeText(category.label, 120) || normalizeText(category.key, 80) || '告警分类',
                backlog_count: backlogItems.length,
                claimed_count: claimedCount,
                pending_count: pendingCount,
                critical_count: criticalCount
            };
        })
        .filter((category) => Number(category.backlog_count || 0) > 0)
        .sort((left, right) => {
            const backlogDelta = Number(right.backlog_count || 0) - Number(left.backlog_count || 0);
            if (backlogDelta !== 0) return backlogDelta;
            const criticalDelta = Number(right.critical_count || 0) - Number(left.critical_count || 0);
            if (criticalDelta !== 0) return criticalDelta;
            return normalizeText(left.label, 120).localeCompare(normalizeText(right.label, 120));
        })
        .slice(0, OPS_ALERT_MONITOR_SHIFT_CATEGORY_LIMIT);
}

function buildOpsAlertMonitorShiftReport({
    categories = [],
    jobs = [],
    caseEventsByKey = new Map(),
    assignableAdmins = [],
    currentAdminId = '',
    now = new Date()
} = {}) {
    const nowTime = now instanceof Date ? now.getTime() : getSafeTimestamp(now);
    const shiftWindowMs = OPS_ALERT_MONITOR_SHIFT_HOURS * 60 * 60 * 1000;
    const windowStartTime = nowTime - shiftWindowMs;
    const previousWindowStartTime = windowStartTime - shiftWindowMs;
    const bucketDurationMs = Math.round(shiftWindowMs / OPS_ALERT_MONITOR_SHIFT_BUCKET_COUNT);
    const eventTimelineByKey = buildOpsAlertMonitorEventTimeline(caseEventsByKey);
    const jobTimelineByKey = buildOpsAlertMonitorJobTimeline(jobs);
    const adminLookupById = new Map(
        (Array.isArray(assignableAdmins) ? assignableAdmins : [])
            .map((admin) => [normalizeText(admin?.id, 160), admin])
            .filter(([adminId]) => Boolean(adminId))
    );
    const shiftEvents = [];

    eventTimelineByKey.forEach((events) => {
        (Array.isArray(events) ? events : []).forEach((event) => {
            const eventTime = Number(event?.created_time || 0);
            if (eventTime >= previousWindowStartTime && eventTime <= nowTime) {
                shiftEvents.push(event);
            }
        });
    });
    shiftEvents.sort((left, right) => Number(left.created_time || 0) - Number(right.created_time || 0));

    const totals = {
        claimed_count: 0,
        assigned_count: 0,
        resolved_count: 0,
        note_count: 0,
        reopened_count: 0,
        avg_resolution_minutes: null,
        active_backlog_count: 0,
        active_claimed_count: 0,
        active_pending_count: 0,
        previous_backlog_count: 0,
        backlog_delta: 0,
        longest_waiting_minutes: null
    };
    const reasonMap = new Map();
    const adminStatsMap = new Map();
    const resolvedDurations = [];
    const categorySummary = buildOpsAlertShiftCategorySummary(categories);

    (Array.isArray(categories) ? categories : []).forEach((category) => {
        const items = Array.isArray(category?.items) ? category.items : [];
        items.forEach((item) => {
            if (normalizeText(item?.case_status, 40).toLowerCase() === 'resolved') {
                return;
            }

            totals.active_backlog_count += 1;
            if (normalizeText(item?.case_status, 40).toLowerCase() === 'claimed') {
                totals.active_claimed_count += 1;
            } else {
                totals.active_pending_count += 1;
            }

            const createdTime = getSafeTimestamp(item?.created_at);
            if (createdTime > 0) {
                const waitMinutes = Math.max(0, Math.round((nowTime - createdTime) / 60000));
                if (totals.longest_waiting_minutes === null || waitMinutes > totals.longest_waiting_minutes) {
                    totals.longest_waiting_minutes = waitMinutes;
                }
            }

            const ownerStat = ensureOpsAlertShiftAdminStat(
                adminStatsMap,
                adminLookupById,
                item?.case_owner_admin_id,
                item?.case_owner_label,
                currentAdminId
            );
            if (ownerStat) {
                ownerStat.active_count += 1;
                if (normalizeSeverity(item?.severity) === 'critical') {
                    ownerStat.critical_active_count += 1;
                }
            }
        });
    });

    shiftEvents
        .filter((event) => Number(event?.created_time || 0) >= windowStartTime)
        .forEach((event) => {
            const action = normalizeText(event.action, 80).toLowerCase();
            const caseKey = buildOpsAlertCaseKey(event.category_key, event.target_id);
            const caseEvents = eventTimelineByKey.get(caseKey) || [];
            const jobEntries = jobTimelineByKey.get(caseKey) || [];

            if (action === 'claim') {
                totals.claimed_count += 1;
                const stat = ensureOpsAlertShiftAdminStat(
                    adminStatsMap,
                    adminLookupById,
                    event.owner_admin_id || event.actor_admin_id,
                    event.owner_label || event.actor_label,
                    currentAdminId
                );
                if (stat) {
                    stat.claimed_count += 1;
                }
                return;
            }

            if (action === 'assign') {
                totals.assigned_count += 1;
                const stat = ensureOpsAlertShiftAdminStat(
                    adminStatsMap,
                    adminLookupById,
                    event.owner_admin_id || event.actor_admin_id,
                    event.owner_label || event.actor_label,
                    currentAdminId
                );
                if (stat) {
                    stat.assigned_count += 1;
                }
                return;
            }

            if (action === 'add_note') {
                totals.note_count += 1;
                const stat = ensureOpsAlertShiftAdminStat(
                    adminStatsMap,
                    adminLookupById,
                    event.actor_admin_id || event.owner_admin_id,
                    event.actor_label || event.owner_label,
                    currentAdminId
                );
                if (stat) {
                    stat.note_count += 1;
                }
                return;
            }

            if (action === 'reopen') {
                totals.reopened_count += 1;
                const stat = ensureOpsAlertShiftAdminStat(
                    adminStatsMap,
                    adminLookupById,
                    event.actor_admin_id || event.owner_admin_id,
                    event.actor_label || event.owner_label,
                    currentAdminId
                );
                if (stat) {
                    stat.reopened_count += 1;
                }
                return;
            }

            if (action === 'resolve') {
                totals.resolved_count += 1;
                const stat = ensureOpsAlertShiftAdminStat(
                    adminStatsMap,
                    adminLookupById,
                    event.actor_admin_id || event.owner_admin_id,
                    event.actor_label || event.owner_label,
                    currentAdminId
                );
                if (stat) {
                    stat.resolved_count += 1;
                }

                const durationMinutes = getOpsAlertResolveDurationMinutes(event, caseEvents, jobEntries);
                if (Number.isFinite(durationMinutes)) {
                    resolvedDurations.push(durationMinutes);
                    if (stat) {
                        stat.resolution_minutes_total += durationMinutes;
                        stat.resolution_sample_count += 1;
                    }
                }

                const bucket = getOpsAlertResolutionBucket(event);
                const bucketKey = normalizeText(bucket.key, 80) || 'other';
                if (!reasonMap.has(bucketKey)) {
                    reasonMap.set(bucketKey, {
                        key: bucketKey,
                        label: normalizeText(bucket.label, 120) || '其他关闭原因',
                        count: 0
                    });
                }
                reasonMap.get(bucketKey).count += 1;
            }
        });

    if (resolvedDurations.length) {
        totals.avg_resolution_minutes = Math.round(
            resolvedDurations.reduce((sum, value) => sum + Number(value || 0), 0) / resolvedDurations.length
        );
    }

    totals.previous_backlog_count = countOpsAlertBacklogAtTime(jobTimelineByKey, eventTimelineByKey, windowStartTime);
    totals.backlog_delta = totals.active_backlog_count - totals.previous_backlog_count;

    const trend = Array.from({ length: OPS_ALERT_MONITOR_SHIFT_BUCKET_COUNT }, (_, index) => {
        const bucketStartTime = windowStartTime + index * bucketDurationMs;
        const bucketEndTime = index === OPS_ALERT_MONITOR_SHIFT_BUCKET_COUNT - 1
            ? nowTime
            : Math.min(nowTime, bucketStartTime + bucketDurationMs);

        const bucketEvents = shiftEvents.filter((event) => (
            Number(event?.created_time || 0) >= bucketStartTime
            && Number(event?.created_time || 0) < bucketEndTime
        ));

        return {
            bucket_start: toIsoString(bucketStartTime),
            bucket_end: toIsoString(bucketEndTime),
            backlog_count: countOpsAlertBacklogAtTime(jobTimelineByKey, eventTimelineByKey, bucketEndTime),
            claimed_count: bucketEvents.filter((event) => normalizeText(event.action, 80).toLowerCase() === 'claim').length,
            assigned_count: bucketEvents.filter((event) => normalizeText(event.action, 80).toLowerCase() === 'assign').length,
            resolved_count: bucketEvents.filter((event) => normalizeText(event.action, 80).toLowerCase() === 'resolve').length
        };
    });

    const adminStats = Array.from(adminStatsMap.values())
        .map((stat) => ({
            admin_id: stat.admin_id,
            label: stat.label,
            claimed_count: stat.claimed_count,
            assigned_count: stat.assigned_count,
            resolved_count: stat.resolved_count,
            note_count: stat.note_count,
            reopened_count: stat.reopened_count,
            active_count: stat.active_count,
            critical_active_count: stat.critical_active_count,
            avg_resolution_minutes: stat.resolution_sample_count > 0
                ? Math.round(stat.resolution_minutes_total / stat.resolution_sample_count)
                : null,
            is_current: stat.is_current
        }))
        .sort((left, right) => {
            const resolvedDelta = Number(right.resolved_count || 0) - Number(left.resolved_count || 0);
            if (resolvedDelta !== 0) return resolvedDelta;
            const activeDelta = Number(right.active_count || 0) - Number(left.active_count || 0);
            if (activeDelta !== 0) return activeDelta;
            const intakeDelta = (
                Number(right.claimed_count || 0)
                + Number(right.assigned_count || 0)
            ) - (
                Number(left.claimed_count || 0)
                + Number(left.assigned_count || 0)
            );
            if (intakeDelta !== 0) return intakeDelta;
            if (left.is_current && !right.is_current) return -1;
            if (!left.is_current && right.is_current) return 1;
            return normalizeText(left.label, 255).localeCompare(normalizeText(right.label, 255));
        })
        .slice(0, OPS_ALERT_MONITOR_SHIFT_ADMIN_LIMIT);

    const closeReasons = Array.from(reasonMap.values())
        .sort((left, right) => {
            const countDelta = Number(right.count || 0) - Number(left.count || 0);
            if (countDelta !== 0) return countDelta;
            return normalizeText(left.label, 120).localeCompare(normalizeText(right.label, 120));
        })
        .slice(0, OPS_ALERT_MONITOR_SHIFT_CLOSE_REASON_LIMIT);

    return {
        shift_hours: OPS_ALERT_MONITOR_SHIFT_HOURS,
        bucket_hours: Math.max(1, Math.round(bucketDurationMs / (60 * 60 * 1000))),
        window_start: toIsoString(windowStartTime),
        window_end: toIsoString(nowTime),
        previous_window_start: toIsoString(previousWindowStartTime),
        previous_window_end: toIsoString(windowStartTime),
        totals,
        close_reasons: closeReasons,
        admin_stats: adminStats,
        categories: categorySummary,
        trend
    };
}

module.exports = async (req, res) => {
    try {
        const { supabase, adminSupabase, user } = await requireAdmin(req, { permission: 'ops_alerts.manage' });

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
        const targets = jobs
            .map((job) => ({
                category_key: getAlertCategoryKey(job.alert_type),
                target_id: getAlertTargetId(job)
            }));
        const opsAlertCasesByKey = await fetchOpsAlertCasesByTargets(
            supabase,
            targets
        );
        const caseEventsByKey = await fetchOpsAlertCaseEventsByTargets(supabase, targets);
        const assignableAdmins = await fetchAssignableOpsAlertAdmins({
            supabase,
            adminSupabase,
            currentUserId: user.id
        });
        const currentAdmin = assignableAdmins.find((item) => item.is_current) || null;
        const categories = ALERT_MONITOR_CATEGORIES.map((category) => buildCategorySnapshot(category, jobs, {
            shopRiskConfig: runtime?.config?.shop_order_risk || {},
            opsAlertCasesByKey,
            caseEventsByKey
        }));
        const shiftReport = buildOpsAlertMonitorShiftReport({
            categories,
            jobs,
            caseEventsByKey,
            assignableAdmins,
            currentAdminId: normalizeText(currentAdmin?.id || user.id, 160) || null,
            now
        });
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
                active_category_count: activeCategoryCount,
                shift_report: shiftReport
            },
            assignable_admins: assignableAdmins,
            current_admin_id: normalizeText(currentAdmin?.id || user.id, 160) || null,
            current_admin_label: normalizeText(currentAdmin?.label, 255) || buildOwnerLabel(user),
            categories
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ops alert monitor settings failed'
        });
    }
};
