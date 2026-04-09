const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    fetchOpsAlertCasesByTargets,
    fetchOpsAlertCaseEventsByTargets,
    buildOpsAlertItemCaseState
} = require('../settings/_ops-alert-case-state');
const {
    buildOpsAlertCaseKey,
    isMissingTableAccessError
} = require('../settings/_ops-alert-case-events');
const {
    DISCOUNT_SELECT_FIELDS,
    buildDiscountLifecycleSummary
} = require('./_shared');
const {
    buildDiscountAssetSummary,
    buildDiscountFunnelSummary,
    buildDiscountRevenueSummary,
    buildDiscountSegmentSummary
} = require('../../../../api/_lib/discount-assets');

const RECENT_USAGE_WINDOW_DAYS = 30;
const RISK_ALERT_LOOKBACK_HOURS = 7 * 24;
const DETAIL_ORDER_LIMIT = 12;
const DETAIL_USER_LIMIT = 8;
const DETAIL_TIMELINE_LIMIT = 12;
const DISCOUNT_AUDIT_ACTION_TYPES = Object.freeze([
    'discount.code.create',
    'discount.code.update',
    'discount.code.toggle',
    'discount.code.delete'
]);

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeDiscountApplicableSite(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function getRecentUsageWindowStart(now = new Date()) {
    return new Date(now.getTime() - (RECENT_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000)).toISOString();
}

function getRiskAlertWindowStart(now = new Date()) {
    return new Date(now.getTime() - (RISK_ALERT_LOOKBACK_HOURS * 60 * 60 * 1000)).toISOString();
}

function getZeroTotalOrderCount(orders = []) {
    return (orders || []).filter((order) => {
        const pricePaid = Number(order?.price_paid);
        const totalPrice = Number(order?.total_price);
        return Number.isFinite(pricePaid) && pricePaid <= 0 && Number.isFinite(totalPrice) && totalPrice > 0;
    }).length;
}

function isRefundedOrder(order = {}) {
    return ['refunded', 'full_refund'].includes(normalizeText(order?.refund_status, 40).toLowerCase());
}

function formatTopLabels(values = [], limit = 3) {
    const counts = new Map();
    for (const rawValue of values || []) {
        const value = normalizeText(rawValue, 255);
        if (!value) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((left, right) => {
            if (right[1] !== left[1]) {
                return right[1] - left[1];
            }
            return left[0].localeCompare(right[0]);
        })
        .slice(0, Math.max(1, Number(limit) || 3))
        .map(([label]) => label);
}

function getSafeTimestamp(value) {
    const parsed = Date.parse(normalizeText(value, 80));
    return Number.isFinite(parsed) ? parsed : 0;
}

function getRiskAlertExcerpt(job = {}) {
    const title = normalizeText(job?.title, 240);
    const lines = normalizeText(job?.content, 1200)
        .split('\n')
        .map((line) => normalizeText(line, 240))
        .filter(Boolean)
        .filter((line) => line !== title);

    return lines[0] || '';
}

function getRiskAlertTargetId(job = {}) {
    const payload = normalizePayload(job?.payload);
    const explicitTargetId = normalizeText(payload?.target_id, 200);
    if (explicitTargetId) {
        return explicitTargetId;
    }

    const discountCode = normalizeText(payload?.discount_code, 160).toUpperCase();
    if (discountCode) {
        return `shop_order_risk:coupon:${discountCode}`;
    }

    return '';
}

function getRiskSummaryDiscountCode(job = {}) {
    const payload = normalizePayload(job?.payload);
    return normalizeText(
        payload?.discount_code
        || payload?.previous_hot_discount_codes?.[0],
        160
    ).toUpperCase();
}

async function fetchPagedRows(buildQuery, pageSize = 200, maxPages = 5) {
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

async function loadDiscountRow(supabase, { id = '', code = '' } = {}) {
    const normalizedId = normalizeText(id, 160);
    const normalizedCode = normalizeText(code, 80).toUpperCase();

    if (!normalizedId && !normalizedCode) {
        const error = new Error('id or code is required');
        error.statusCode = 400;
        throw error;
    }

    let query = supabase
        .from('discount_codes')
        .select(DISCOUNT_SELECT_FIELDS);

    if (normalizedId) {
        query = query.eq('id', normalizedId);
    } else {
        query = query.eq('code', normalizedCode);
    }

    const { data, error } = await query.single();
    if (error || !data) {
        const notFoundError = new Error(error?.message || '优惠码不存在');
        notFoundError.statusCode = error?.status === 406 ? 404 : 404;
        throw notFoundError;
    }

    return data;
}

function assertDiscountVisibleForSite(discount, site = 'all') {
    if (site === 'all') {
        return;
    }

    const applicableSite = normalizeDiscountApplicableSite(discount?.applicable_site);
    if (applicableSite !== 'all' && applicableSite !== site) {
        const error = new Error('当前站点视图下未找到该优惠码');
        error.statusCode = 404;
        throw error;
    }
}

async function loadRecentDiscountOrders(supabase, discountCode = '', site = 'all') {
    const normalizedDiscountCode = normalizeText(discountCode, 80).toUpperCase();
    if (!normalizedDiscountCode) {
        return [];
    }

    let query = supabase
        .from('shop_orders')
        .select('id, user_id, created_at, price_paid, total_price, site, snapshot_product_name, item_count, discount_amount, refund_status, discount_code, discount_version')
        .eq('discount_code', normalizedDiscountCode)
        .gte('created_at', getRecentUsageWindowStart())
        .order('created_at', { ascending: false });

    if (site !== 'all') {
        query = query.eq('site', site);
    }

    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function loadHistoricalOrdersForUsers(supabase, userIds = [], site = 'all') {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!ids.length) {
        return [];
    }

    let query = supabase
        .from('shop_orders')
        .select('id, user_id, created_at, refund_status, site')
        .in('user_id', ids)
        .order('created_at', { ascending: true });

    if (site !== 'all') {
        query = query.eq('site', site);
    }

    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function loadDiscountAssetRows(supabase, discountId = '') {
    const normalizedDiscountId = normalizeText(discountId, 160);
    if (!normalizedDiscountId) {
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('discount_user_assets')
            .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment, source_batch_id, last_order_id')
            .eq('discount_id', normalizedDiscountId)
            .order('assigned_at', { ascending: false });

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingRelationError(error, 'discount_user_assets')) {
            return [];
        }
        throw error;
    }
}

async function loadDiscountEventRows(supabase, discountId = '') {
    const normalizedDiscountId = normalizeText(discountId, 160);
    if (!normalizedDiscountId) {
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('discount_event_logs')
            .select('id, discount_id, user_id, discount_asset_id, order_id, event_type, site, source_channel, event_source, audience_segment, created_at')
            .eq('discount_id', normalizedDiscountId)
            .gte('created_at', getRecentUsageWindowStart())
            .order('created_at', { ascending: false });

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingRelationError(error, 'discount_event_logs')) {
            return [];
        }
        throw error;
    }
}

async function loadProfilesByIds(supabase, userIds = []) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!ids.length) {
        return new Map();
    }

    let data = null;
    let error = null;

    ({ data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, email, avatar_url')
        .in('id', ids));

    if (error) {
        ({ data, error } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', ids));
    }

    if (error) throw error;

    return new Map((data || []).map((row) => [normalizeText(row?.id, 160), row]));
}

function resolveUserLabel(profile = null, userId = '') {
    const displayName = normalizeText(profile?.display_name, 160);
    const username = normalizeText(profile?.username, 160);
    const email = normalizeText(profile?.email, 255);
    return displayName || username || email || normalizeText(userId, 160) || '未知用户';
}

function buildUsageSummary(orders = [], historicalOrders = []) {
    const distinctUsers = new Set((orders || []).map((order) => normalizeText(order?.user_id, 160)).filter(Boolean));
    const ordered = (orders || []).slice().sort((left, right) => getSafeTimestamp(right?.created_at) - getSafeTimestamp(left?.created_at));
    const refundedOrders = ordered.filter((order) => isRefundedOrder(order));
    const netOrders = ordered.filter((order) => !isRefundedOrder(order));
    const revenueSummary = buildDiscountRevenueSummary(ordered);
    const firstOrderByUser = new Map();
    for (const order of historicalOrders || []) {
        const userId = normalizeText(order?.user_id, 160);
        if (!userId || isRefundedOrder(order)) continue;
        if (!firstOrderByUser.has(userId)) {
            firstOrderByUser.set(userId, normalizeText(order?.created_at, 80) || null);
        }
    }
    const newCustomerOrderCount = netOrders.filter((order) => {
        const userId = normalizeText(order?.user_id, 160);
        const firstOrderAt = firstOrderByUser.get(userId);
        return firstOrderAt && normalizeText(order?.created_at, 80) === firstOrderAt;
    }).length;

    return {
        window_days: RECENT_USAGE_WINDOW_DAYS,
        recent_order_count: ordered.length,
        recent_net_order_count: netOrders.length,
        recent_refund_count: refundedOrders.length,
        recent_distinct_user_count: distinctUsers.size,
        recent_zero_total_count: getZeroTotalOrderCount(ordered),
        last_used_at: normalizeText(ordered[0]?.created_at, 80) || null,
        top_product_names: formatTopLabels(ordered.map((order) => order?.snapshot_product_name), 3),
        recent_discount_cost_gross: revenueSummary.discount_cost_gross,
        recent_discount_cost_net: revenueSummary.discount_cost_net,
        recent_revenue_gross: revenueSummary.gmv_gross,
        recent_revenue_net: revenueSummary.gmv_net,
        new_customer_order_count: newCustomerOrderCount
    };
}

function buildRecentOrderRows(orders = [], profileMap = new Map()) {
    return (orders || [])
        .slice(0, DETAIL_ORDER_LIMIT)
        .map((order) => {
            const userId = normalizeText(order?.user_id, 160);
            const profile = profileMap.get(userId) || null;
            const pricePaid = Number(order?.price_paid);
            const totalPrice = Number(order?.total_price);

            return {
                id: normalizeText(order?.id, 160) || null,
                user_id: userId || null,
                user_label: resolveUserLabel(profile, userId),
                avatar_url: normalizeText(profile?.avatar_url, 1000) || null,
                product_name: normalizeText(order?.snapshot_product_name, 255) || '未知商品',
                site: normalizeSite(order?.site),
                created_at: normalizeText(order?.created_at, 80) || null,
                item_count: Math.max(1, Number.parseInt(order?.item_count, 10) || 1),
                discount_amount: Number.isFinite(Number(order?.discount_amount)) ? Number(order.discount_amount) : 0,
                price_paid: Number.isFinite(pricePaid) ? pricePaid : null,
                total_price: Number.isFinite(totalPrice) ? totalPrice : null,
                refund_status: normalizeText(order?.refund_status, 40).toLowerCase() || 'none',
                discount_version: Math.max(0, Number.parseInt(order?.discount_version, 10) || 0) || null,
                is_zero_total_risk: Number.isFinite(pricePaid) && pricePaid <= 0 && Number.isFinite(totalPrice) && totalPrice > 0
            };
        });
}

function buildRecentUsers(orders = [], profileMap = new Map()) {
    const byUser = new Map();

    for (const order of orders || []) {
        const userId = normalizeText(order?.user_id, 160);
        if (!userId) continue;

        if (!byUser.has(userId)) {
            byUser.set(userId, {
                user_id: userId,
                usage_count: 0,
                zero_total_count: 0,
                latest_used_at: normalizeText(order?.created_at, 80) || null,
                sites: new Set(),
                products: []
            });
        }

        const entry = byUser.get(userId);
        entry.usage_count += 1;
        if (Number(order?.price_paid) <= 0 && Number(order?.total_price) > 0) {
            entry.zero_total_count += 1;
        }

        const createdAt = getSafeTimestamp(order?.created_at);
        const latestUsedAt = getSafeTimestamp(entry.latest_used_at);
        if (createdAt > latestUsedAt) {
            entry.latest_used_at = normalizeText(order?.created_at, 80) || entry.latest_used_at;
        }

        const site = normalizeSite(order?.site);
        if (site && site !== 'all') {
            entry.sites.add(site);
        }
        entry.products.push(normalizeText(order?.snapshot_product_name, 255));
    }

    return Array.from(byUser.values())
        .map((entry) => {
            const profile = profileMap.get(entry.user_id) || null;
            return {
                user_id: entry.user_id,
                user_label: resolveUserLabel(profile, entry.user_id),
                avatar_url: normalizeText(profile?.avatar_url, 1000) || null,
                usage_count: entry.usage_count,
                zero_total_count: entry.zero_total_count,
                latest_used_at: entry.latest_used_at,
                sites: Array.from(entry.sites).sort(),
                top_products: formatTopLabels(entry.products, 3)
            };
        })
        .sort((left, right) => {
            if (right.usage_count !== left.usage_count) {
                return right.usage_count - left.usage_count;
            }
            return getSafeTimestamp(right.latest_used_at) - getSafeTimestamp(left.latest_used_at);
        })
        .slice(0, DETAIL_USER_LIMIT);
}

function buildRecentAssetRows(assets = [], profileMap = new Map()) {
    return (assets || [])
        .slice(0, DETAIL_ORDER_LIMIT)
        .map((asset) => {
            const userId = normalizeText(asset?.user_id, 160);
            const profile = profileMap.get(userId) || null;
            return {
                id: normalizeText(asset?.id, 160) || null,
                user_id: userId || null,
                user_label: resolveUserLabel(profile, userId),
                avatar_url: normalizeText(profile?.avatar_url, 1000) || null,
                asset_status: normalizeText(asset?.asset_status, 40).toLowerCase() || 'available',
                assigned_at: normalizeText(asset?.assigned_at, 80) || null,
                claimed_at: normalizeText(asset?.claimed_at, 80) || null,
                consumed_at: normalizeText(asset?.consumed_at, 80) || null,
                restored_at: normalizeText(asset?.restored_at, 80) || null,
                expires_at: normalizeText(asset?.expires_at, 80) || null,
                source_type: normalizeText(asset?.source_type, 80).toLowerCase() || null,
                source_channel: normalizeText(asset?.source_channel, 80).toLowerCase() || null,
                audience_segment: normalizeText(asset?.audience_segment, 80).toLowerCase() || null,
                source_batch_id: normalizeText(asset?.source_batch_id, 120) || null
            };
        });
}

async function fetchRecentShopRiskAlertJobs(supabase) {
    try {
        return await fetchPagedRows(() => supabase
            .from('ops_alert_jobs')
            .select('id, alert_type, severity, title, content, payload, created_at')
            .in('alert_type', ['shop_order_risk_anomaly', 'shop_order_risk_recovered'])
            .gte('created_at', getRiskAlertWindowStart())
            .order('created_at', { ascending: false }));
    } catch (error) {
        if (isMissingTableAccessError(error, 'ops_alert_jobs')) {
            return [];
        }
        throw error;
    }
}

function buildRiskSummary(discountCode = '', jobs = [], caseMap = new Map(), caseEventsByKey = new Map()) {
    const normalizedCode = normalizeText(discountCode, 160).toUpperCase();
    const targetId = `shop_order_risk:coupon:${normalizedCode}`;
    const latestJob = (jobs || []).find((job) => {
        const jobTargetId = getRiskAlertTargetId(job);
        const jobDiscountCode = getRiskSummaryDiscountCode(job) || (jobTargetId.startsWith('shop_order_risk:coupon:') ? jobTargetId.split(':').slice(2).join(':').toUpperCase() : '');
        return jobTargetId === targetId || jobDiscountCode === normalizedCode;
    }) || null;
    const latestPayload = normalizePayload(latestJob?.payload);
    const caseRecord = caseMap.get(buildOpsAlertCaseKey('shop_risk', targetId)) || null;
    const caseState = buildOpsAlertItemCaseState('shop_risk', targetId, caseRecord, caseEventsByKey, { eventLimit: DETAIL_TIMELINE_LIMIT });
    const hasCaseState = Boolean(caseRecord) || (Array.isArray(caseState?.case_recent_events) && caseState.case_recent_events.length > 0);
    const latestAlertType = normalizeText(latestJob?.alert_type, 120).toLowerCase();
    const isRecovered = latestAlertType === 'shop_order_risk_recovered';

    return {
        has_recent_alert: Boolean(latestJob),
        latest_alert_type: latestAlertType || null,
        latest_alert_state: isRecovered ? 'recovered' : (latestJob ? 'problem' : 'idle'),
        latest_alert_title: normalizeText(latestJob?.title, 240) || null,
        latest_alert_summary: getRiskAlertExcerpt(latestJob) || null,
        latest_alert_at: normalizeText(latestJob?.created_at, 80) || null,
        signal_type: normalizeText(latestPayload.signal_type, 120) || null,
        risk_level: normalizeText(latestPayload.risk_level || latestPayload.previous_risk_level, 40) || null,
        risk_score: Number.isFinite(Number(latestPayload.risk_score ?? latestPayload.previous_risk_score))
            ? Math.max(0, Math.round(Number(latestPayload.risk_score ?? latestPayload.previous_risk_score)))
            : null,
        auto_response_action: normalizeText(latestPayload.auto_response_action || latestPayload.previous_auto_response_action, 80) || null,
        auto_response_status: normalizeText(latestPayload.auto_response_status || latestPayload.previous_auto_response_status, 80) || null,
        auto_response_summary: normalizeText(latestPayload.auto_response_summary || latestPayload.previous_auto_response_summary, 240) || null,
        auto_response_applied_at: normalizeText(latestPayload.auto_response_applied_at, 80) || null,
        response_summary: normalizeText(latestPayload.response_summary || latestPayload.previous_response_summary, 240) || null,
        recovery_auto_action: normalizeText(latestPayload.recovery_auto_action, 80) || null,
        recovery_auto_status: normalizeText(latestPayload.recovery_auto_status, 80) || null,
        recovery_auto_summary: normalizeText(latestPayload.recovery_auto_summary, 240) || null,
        recovery_auto_applied_at: normalizeText(latestPayload.recovery_auto_applied_at, 80) || null,
        previous_zero_total_count: Number.isFinite(Number(latestPayload.previous_zero_total_count))
            ? Math.max(0, Math.round(Number(latestPayload.previous_zero_total_count)))
            : null,
        ...(hasCaseState
            ? caseState
            : {
                case_status: null,
                case_owner_admin_id: null,
                case_owner_label: null,
                case_note: null,
                case_resolution: null,
                case_last_action: null,
                case_last_action_at: null,
                case_updated_at: null,
                case_recent_note: null,
                case_recent_note_at: null,
                case_latest_event_action: null,
                case_latest_event_label: null,
                case_latest_event_summary: null,
                case_latest_event_at: null,
                case_latest_event_by_label: null,
                case_latest_event_owner_label: null,
                case_recent_events: []
            })
    };
}

function buildRiskTimeline(riskSummary = {}, jobs = []) {
    const timeline = [];

    (jobs || []).forEach((job) => {
        const payload = normalizePayload(job?.payload);
        timeline.push({
            type: 'alert_job',
            created_at: normalizeText(job?.created_at, 80) || null,
            title: normalizeText(job?.title, 240) || '风控告警',
            summary: getRiskAlertExcerpt(job)
                || normalizeText(payload?.auto_response_summary || payload?.previous_auto_response_summary, 240)
                || normalizeText(payload?.response_summary || payload?.previous_response_summary, 240)
                || null,
            state: normalizeText(job?.alert_type, 120).toLowerCase() === 'shop_order_risk_recovered' ? 'recovered' : 'problem'
        });
    });

    (Array.isArray(riskSummary?.case_recent_events) ? riskSummary.case_recent_events : []).forEach((event) => {
        timeline.push({
            type: 'case_event',
            created_at: normalizeText(event?.created_at, 80) || null,
            title: normalizeText(event?.action_label, 120) || 'Case 更新',
            summary: normalizeText(event?.summary || event?.note || event?.resolution, 240) || null,
            state: normalizeText(event?.status, 40).toLowerCase() || 'open',
            actor_label: normalizeText(event?.actor_label, 255) || null,
            owner_label: normalizeText(event?.owner_label, 255) || null
        });
    });

    return timeline
        .filter((item) => item.created_at)
        .sort((left, right) => getSafeTimestamp(right.created_at) - getSafeTimestamp(left.created_at))
        .slice(0, DETAIL_TIMELINE_LIMIT);
}

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = normalizeText(error?.message, 600).toLowerCase();
    const normalizedRelation = normalizeText(relationName, 120).toLowerCase();

    if (!normalizedMessage) {
        return false;
    }

    const mentionsRelation = normalizedRelation
        ? normalizedMessage.includes(normalizedRelation)
        : normalizedMessage.includes('relation') || normalizedMessage.includes('table');

    return mentionsRelation && (
        normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('not exist')
        || normalizedMessage.includes('could not find')
        || normalizedMessage.includes('undefined table')
    );
}

async function fetchAuditRows(supabase, tableName = 'admin_audit_logs_view', selection = 'id, action_type, details, created_at, admin_id, admin_email') {
    return fetchPagedRows(() => supabase
        .from(tableName)
        .select(selection)
        .in('action_type', DISCOUNT_AUDIT_ACTION_TYPES)
        .order('created_at', { ascending: false }), 100, 2);
}

async function fetchDiscountAuditRows(supabase, discount = {}) {
    let rows = [];

    try {
        rows = await fetchAuditRows(supabase, 'admin_audit_logs_view', 'id, action_type, details, created_at, admin_id, admin_email');
    } catch (error) {
        if (!isMissingRelationError(error, 'admin_audit_logs_view')) {
            throw error;
        }

        try {
            rows = await fetchAuditRows(supabase, 'admin_audit_logs', 'id, action_type, details, created_at, admin_id');
        } catch (fallbackError) {
            if (isMissingRelationError(fallbackError, 'admin_audit_logs')) {
                return [];
            }
            throw fallbackError;
        }
    }

    const discountId = normalizeText(discount?.id, 160);
    const discountCode = normalizeText(discount?.code, 80).toUpperCase();

    return rows
        .filter((row) => {
            const details = normalizePayload(row?.details);
            return normalizeText(details.discount_id, 160) === discountId
                || normalizeText(details.code, 80).toUpperCase() === discountCode
                || normalizeText(details.previous_code, 80).toUpperCase() === discountCode;
        })
        .sort((left, right) => getSafeTimestamp(right?.created_at) - getSafeTimestamp(left?.created_at));
}

function buildDiscountAuditTitle(row = {}) {
    const actionType = normalizeText(row?.action_type, 120).toLowerCase();
    const details = normalizePayload(row?.details);

    if (actionType === 'discount.code.create') {
        return '创建优惠券';
    }
    if (actionType === 'discount.code.update') {
        return '更新优惠券配置';
    }
    if (actionType === 'discount.code.toggle') {
        return details.next_active === true ? '恢复启用优惠券' : '停用优惠券';
    }
    if (actionType === 'discount.code.delete') {
        return '删除优惠券';
    }

    return actionType || '优惠券审计';
}

function buildDiscountAuditSummary(row = {}) {
    const details = normalizePayload(row?.details);
    const summaryParts = [];

    if (normalizeText(details.review_note, 2000)) {
        summaryParts.push(`复核结论：${normalizeText(details.review_note, 2000)}`);
    }

    if (details.risk_reviewed === true) {
        summaryParts.push('已完成风险复核');
    }

    if (details.resolve_case_requested === true) {
        summaryParts.push('已请求同步关闭风险 case');
    }

    if (normalizeText(details.operation_source, 120)) {
        summaryParts.push(`来源：${normalizeText(details.operation_source, 120)}`);
    }

    if (!summaryParts.length && row?.action_type === 'discount.code.update' && normalizeText(details.previous_code, 80) && normalizeText(details.code, 80)) {
        summaryParts.push(`优惠码：${normalizeText(details.previous_code, 80)} -> ${normalizeText(details.code, 80)}`);
    }

    if (!summaryParts.length) {
        summaryParts.push('已写入后台审计日志。');
    }

    return summaryParts.join(' · ');
}

function buildDiscountAuditTimeline(rows = []) {
    return (rows || []).map((row) => {
        const actionType = normalizeText(row?.action_type, 120).toLowerCase();
        const details = normalizePayload(row?.details);
        const isRestoreAction = actionType === 'discount.code.toggle' && details.next_active === true;
        return {
            type: 'audit_log',
            action_type: actionType || null,
            is_restore_action: isRestoreAction,
            created_at: normalizeText(row?.created_at, 80) || null,
            title: buildDiscountAuditTitle(row),
            summary: buildDiscountAuditSummary(row),
            state: actionType === 'discount.code.toggle'
                ? (details.next_active === true ? 'recovered' : 'problem')
                : 'open',
            actor_label: normalizeText(row?.admin_email, 255) || normalizeText(row?.admin_id, 160) || null,
            owner_label: null
        };
    });
}

function mergeDiscountTimelines(...timelineGroups) {
    return timelineGroups
        .flatMap((group) => Array.isArray(group) ? group : [])
        .filter((item) => normalizeText(item?.created_at, 80))
        .sort((left, right) => getSafeTimestamp(right?.created_at) - getSafeTimestamp(left?.created_at))
        .slice(0, DETAIL_TIMELINE_LIMIT);
}

module.exports = async function adminDiscountsDetailHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'discounts.manage' });
        const searchParams = getSearchParams(req);
        const site = normalizeSite(searchParams.get('site') || req.adminSite);
        const discount = await loadDiscountRow(supabase, {
            id: searchParams.get('id'),
            code: searchParams.get('code')
        });
        assertDiscountVisibleForSite(discount, site);

        const discountCode = normalizeText(discount?.code, 80).toUpperCase();
        const recentOrders = await loadRecentDiscountOrders(supabase, discountCode, site);
        const discountAssets = await loadDiscountAssetRows(supabase, discount?.id);
        const discountEvents = await loadDiscountEventRows(supabase, discount?.id);
        const historicalOrders = await loadHistoricalOrdersForUsers(
            supabase,
            recentOrders.map((order) => order?.user_id),
            site
        );
        const profileMap = await loadProfilesByIds(
            supabase,
            [
                ...recentOrders.map((order) => order?.user_id),
                ...discountAssets.map((asset) => asset?.user_id)
            ]
        );

        const riskTargets = [{
            category_key: 'shop_risk',
            target_id: `shop_order_risk:coupon:${discountCode}`
        }];
        const recentRiskJobs = await fetchRecentShopRiskAlertJobs(supabase);
        const filteredRiskJobs = recentRiskJobs.filter((job) => {
            const jobTargetId = getRiskAlertTargetId(job);
            const jobDiscountCode = getRiskSummaryDiscountCode(job) || (jobTargetId.startsWith('shop_order_risk:coupon:') ? jobTargetId.split(':').slice(2).join(':').toUpperCase() : '');
            return jobDiscountCode === discountCode || jobTargetId === `shop_order_risk:coupon:${discountCode}`;
        });
        const [opsAlertCasesByKey, caseEventsByKey] = await Promise.all([
            fetchOpsAlertCasesByTargets(supabase, riskTargets),
            fetchOpsAlertCaseEventsByTargets(supabase, riskTargets)
        ]);
        const discountAuditRows = await fetchDiscountAuditRows(supabase, discount);

        const usageSummary = buildUsageSummary(recentOrders, historicalOrders);
        const assetSummary = buildDiscountAssetSummary(discountAssets);
        const funnelSummary = buildDiscountFunnelSummary({
            distributionMode: discount?.distribution_mode,
            assets: discountAssets,
            events: discountEvents,
            orders: recentOrders
        });
        const segmentSummary = buildDiscountSegmentSummary({
            orders: recentOrders,
            assets: discountAssets,
            events: discountEvents
        });
        const riskSummary = buildRiskSummary(discountCode, filteredRiskJobs, opsAlertCasesByKey, caseEventsByKey);

        return sendJson(res, 200, {
            success: true,
            site,
            detail_window_days: RECENT_USAGE_WINDOW_DAYS,
            discount: {
                ...discount,
                lifecycle_summary: buildDiscountLifecycleSummary(discount, { now: new Date() }),
                usage_summary: usageSummary,
                risk_summary: riskSummary,
                asset_summary: assetSummary,
                funnel_summary: funnelSummary,
                segment_summary: segmentSummary
            },
            recent_orders: buildRecentOrderRows(recentOrders, profileMap),
            recent_users: buildRecentUsers(recentOrders, profileMap),
            recent_assets: buildRecentAssetRows(discountAssets, profileMap),
            discount_events: discountEvents,
            risk_timeline: mergeDiscountTimelines(
                buildRiskTimeline(riskSummary, filteredRiskJobs),
                buildDiscountAuditTimeline(discountAuditRows)
            )
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load discount detail'
        });
    }
};
