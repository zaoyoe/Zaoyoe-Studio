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
    buildDiscountRevenueSummary
} = require('../../../../api/_lib/discount-assets');

const RECENT_USAGE_WINDOW_DAYS = 30;
const RISK_ALERT_LOOKBACK_HOURS = 7 * 24;
const POSTGREST_IN_FILTER_CHUNK_SIZE = 50;

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

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizePayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function chunkValues(values = [], chunkSize = POSTGREST_IN_FILTER_CHUNK_SIZE) {
    const normalizedValues = Array.isArray(values) ? values : [];
    const normalizedChunkSize = Math.max(1, Number(chunkSize) || POSTGREST_IN_FILTER_CHUNK_SIZE);
    const chunks = [];

    for (let index = 0; index < normalizedValues.length; index += normalizedChunkSize) {
        chunks.push(normalizedValues.slice(index, index + normalizedChunkSize));
    }

    return chunks;
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
    return ['refunded', 'full_refund'].includes(normalizeText(order?.refund_status).toLowerCase());
}

function formatTopLabels(values = [], limit = 3) {
    const counts = new Map();
    for (const rawValue of values || []) {
        const value = normalizeText(rawValue);
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

async function loadRecentDiscountOrders(supabase, codes = [], site = 'all') {
    const normalizedCodes = [...new Set((Array.isArray(codes) ? codes : []).map((code) => normalizeText(code).toUpperCase()).filter(Boolean))];
    if (!normalizedCodes.length) {
        return [];
    }

    const rows = [];
    for (const codeChunk of chunkValues(normalizedCodes)) {
        let query = supabase
            .from('shop_orders')
            .select('discount_code, user_id, created_at, price_paid, total_price, site, snapshot_product_name, refund_status, discount_amount')
            .in('discount_code', codeChunk)
            .gte('created_at', getRecentUsageWindowStart())
            .order('created_at', { ascending: false });

        if (site !== 'all') {
            query = query.eq('site', site);
        }

        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(Array.isArray(data) ? data : []));
    }

    rows.sort((left, right) => Date.parse(right?.created_at || '') - Date.parse(left?.created_at || ''));
    return rows;
}

async function loadHistoricalOrdersForUsers(supabase, userIds = [], site = 'all') {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => normalizeText(value)).filter(Boolean))];
    if (!ids.length) {
        return [];
    }

    const rows = [];
    for (const userChunk of chunkValues(ids)) {
        let query = supabase
            .from('shop_orders')
            .select('id, user_id, created_at, refund_status, site')
            .in('user_id', userChunk)
            .order('created_at', { ascending: true });

        if (site !== 'all') {
            query = query.eq('site', site);
        }

        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(Array.isArray(data) ? data : []));
    }

    rows.sort((left, right) => Date.parse(left?.created_at || '') - Date.parse(right?.created_at || ''));
    return rows;
}

function buildFirstNetOrderTimestampByUser(historicalOrders = []) {
    const firstOrderByUser = new Map();

    for (const order of historicalOrders || []) {
        if (isRefundedOrder(order)) {
            continue;
        }

        const userId = normalizeText(order?.user_id);
        const createdAt = normalizeText(order?.created_at);
        if (!userId || !createdAt) {
            continue;
        }

        const current = firstOrderByUser.get(userId);
        if (!current || Date.parse(createdAt) < Date.parse(current)) {
            firstOrderByUser.set(userId, createdAt);
        }
    }

    return firstOrderByUser;
}

function buildRecentUsageMap(orders = [], historicalOrders = []) {
    const groups = new Map();
    const firstNetOrderTimestampByUser = buildFirstNetOrderTimestampByUser(historicalOrders);

    for (const order of orders || []) {
        const discountCode = normalizeText(order?.discount_code).toUpperCase();
        if (!discountCode) continue;
        if (!groups.has(discountCode)) {
            groups.set(discountCode, []);
        }
        groups.get(discountCode).push(order);
    }

    const usageMap = new Map();
    for (const [discountCode, groupOrders] of groups.entries()) {
        const distinctUsers = new Set(groupOrders.map((order) => normalizeText(order?.user_id)).filter(Boolean));
        const refundedOrders = groupOrders.filter((order) => isRefundedOrder(order));
        const netOrders = groupOrders.filter((order) => !isRefundedOrder(order));
        const newCustomerUsers = new Set();
        const grossDiscountCost = groupOrders.reduce((sum, order) => (
            sum + (Number.isFinite(Number(order?.discount_amount)) ? Math.max(0, Number(order.discount_amount)) : 0)
        ), 0);
        const netDiscountCost = netOrders.reduce((sum, order) => (
            sum + (Number.isFinite(Number(order?.discount_amount)) ? Math.max(0, Number(order.discount_amount)) : 0)
        ), 0);
        const revenueSummary = buildDiscountRevenueSummary(groupOrders);

        for (const order of netOrders) {
            const userId = normalizeText(order?.user_id);
            const createdAt = normalizeText(order?.created_at);
            if (!userId || !createdAt) {
                continue;
            }

            if (firstNetOrderTimestampByUser.get(userId) === createdAt) {
                newCustomerUsers.add(userId);
            }
        }

        usageMap.set(discountCode, {
            window_days: RECENT_USAGE_WINDOW_DAYS,
            recent_order_count: groupOrders.length,
            recent_net_order_count: netOrders.length,
            recent_refund_count: refundedOrders.length,
            recent_distinct_user_count: distinctUsers.size,
            recent_zero_total_count: getZeroTotalOrderCount(groupOrders),
            last_used_at: normalizeText(groupOrders[0]?.created_at) || null,
            top_product_names: formatTopLabels(groupOrders.map((order) => order?.snapshot_product_name), 3),
            recent_discount_cost_gross: grossDiscountCost,
            recent_discount_cost_net: netDiscountCost,
            recent_revenue_gross: revenueSummary.gmv_gross,
            recent_revenue_net: revenueSummary.gmv_net,
            new_customer_order_count: newCustomerUsers.size
        });
    }

    return usageMap;
}

function attachRecentUsageSummary(rows = [], usageMap = new Map()) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const discountCode = normalizeText(row?.code).toUpperCase();
        return {
            ...row,
            usage_summary: usageMap.get(discountCode) || {
                window_days: RECENT_USAGE_WINDOW_DAYS,
                recent_order_count: 0,
                recent_net_order_count: 0,
                recent_refund_count: 0,
                recent_distinct_user_count: 0,
                recent_zero_total_count: 0,
                last_used_at: null,
                top_product_names: [],
                recent_discount_cost_gross: 0,
                recent_discount_cost_net: 0,
                recent_revenue_gross: 0,
                recent_revenue_net: 0,
                new_customer_order_count: 0
            }
        };
    });
}

async function loadDiscountAssetRows(supabase, discountIds = []) {
    const ids = [...new Set((Array.isArray(discountIds) ? discountIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!ids.length) {
        return [];
    }

    try {
        const rows = [];
        for (const idChunk of chunkValues(ids)) {
            const { data, error } = await supabase
                .from('discount_user_assets')
                .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, restored_at, source_channel, audience_segment')
                .in('discount_id', idChunk);

            if (error) throw error;
            rows.push(...(Array.isArray(data) ? data : []));
        }

        return rows;
    } catch (error) {
        if (isMissingTableAccessError(error, 'discount_user_assets')) {
            return [];
        }
        throw error;
    }
}

function buildDiscountAssetSummaryMap(rows = []) {
    const groups = new Map();
    for (const row of rows || []) {
        const discountId = normalizeText(row?.discount_id, 160);
        if (!discountId) continue;
        if (!groups.has(discountId)) {
            groups.set(discountId, []);
        }
        groups.get(discountId).push(row);
    }

    const summaryMap = new Map();
    for (const [discountId, groupRows] of groups.entries()) {
        summaryMap.set(discountId, {
            summary: buildDiscountAssetSummary(groupRows),
            rows: groupRows
        });
    }
    return summaryMap;
}

function attachAssetSummary(rows = [], assetSummaryMap = new Map()) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const discountId = normalizeText(row?.id, 160);
        const assetState = assetSummaryMap.get(discountId) || {
            summary: buildDiscountAssetSummary([]),
            rows: []
        };
        return {
            ...row,
            asset_summary: assetState.summary,
            funnel_summary: buildDiscountFunnelSummary({
                distributionMode: row?.distribution_mode,
                assets: assetState.rows,
                orders: []
            })
        };
    });
}

function attachLifecycleSummary(rows = [], now = new Date()) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        lifecycle_summary: buildDiscountLifecycleSummary(row, { now })
    }));
}

function getRiskAlertExcerpt(job = {}) {
    const title = normalizeText(job?.title);
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
        || payload?.previous_hot_discount_codes?.[0]
    , 160).toUpperCase();
}

function getRiskAlertSite(job = {}, fallback = 'cn') {
    const payload = normalizePayload(job?.payload);
    const normalized = normalizeSite(payload?.site || payload?.site_id || payload?.siteId || fallback);
    return normalized === 'intl' ? 'intl' : 'cn';
}

function getRiskCaseSites(site = 'all') {
    const normalized = normalizeSite(site);
    return normalized === 'all' ? ['cn', 'intl'] : [normalized === 'intl' ? 'intl' : 'cn'];
}

function buildRiskCaseTargets(discountCodes = [], site = 'all') {
    const sites = getRiskCaseSites(site);
    return [...new Set((Array.isArray(discountCodes) ? discountCodes : [discountCodes])
        .map((code) => normalizeText(code).toUpperCase())
        .filter(Boolean))]
        .flatMap((discountCode) => sites.map((caseSite) => ({
            site: caseSite,
            category_key: 'shop_risk',
            target_id: `shop_order_risk:coupon:${discountCode}`
        })));
}

function filterRiskJobsForSite(jobs = [], site = 'all') {
    const normalized = normalizeSite(site);
    if (normalized === 'all') {
        return Array.isArray(jobs) ? jobs : [];
    }
    return (Array.isArray(jobs) ? jobs : []).filter((job) => getRiskAlertSite(job, normalized) === normalized);
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

function buildDiscountRiskSummaryMap(discountCodes = [], jobs = [], caseMap = new Map(), caseEventsByKey = new Map(), site = 'cn') {
    const normalizedCodes = new Set((Array.isArray(discountCodes) ? discountCodes : []).map((code) => normalizeText(code).toUpperCase()).filter(Boolean));
    const latestJobByTarget = new Map();

    for (const job of jobs || []) {
        const targetId = getRiskAlertTargetId(job);
        const discountCode = getRiskSummaryDiscountCode(job) || (targetId.startsWith('shop_order_risk:coupon:') ? targetId.split(':').slice(2).join(':').toUpperCase() : '');
        if (!targetId || !discountCode || !normalizedCodes.has(discountCode)) {
            continue;
        }
        const jobSite = getRiskAlertSite(job, site);
        const jobKey = buildOpsAlertCaseKey('shop_risk', targetId, jobSite);
        if (!latestJobByTarget.has(jobKey)) {
            latestJobByTarget.set(jobKey, job);
        }
    }

    const summaryMap = new Map();
    normalizedCodes.forEach((discountCode) => {
        const targetId = `shop_order_risk:coupon:${discountCode}`;
        const fallbackSite = getRiskCaseSites(site)[0];
        const latestJob = getRiskCaseSites(site)
            .map((caseSite) => latestJobByTarget.get(buildOpsAlertCaseKey('shop_risk', targetId, caseSite)))
            .find(Boolean) || null;
        const latestPayload = normalizePayload(latestJob?.payload);
        const caseSite = latestJob ? getRiskAlertSite(latestJob, fallbackSite) : fallbackSite;
        const caseRecord = caseMap.get(buildOpsAlertCaseKey('shop_risk', targetId, caseSite)) || null;
        const caseState = buildOpsAlertItemCaseState('shop_risk', targetId, caseRecord, caseEventsByKey, { site: caseSite });
        const hasCaseState = Boolean(caseRecord) || (Array.isArray(caseState?.case_recent_events) && caseState.case_recent_events.length > 0);
        const latestAlertType = normalizeText(latestJob?.alert_type, 120).toLowerCase();
        const isRecovered = latestAlertType === 'shop_order_risk_recovered';
        const normalizedCaseState = hasCaseState
            ? caseState
            : {
                ...caseState,
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
            };

        summaryMap.set(discountCode, {
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
            ...normalizedCaseState
        });
    });

    return summaryMap;
}

function attachDiscountRiskSummary(rows = [], riskSummaryMap = new Map()) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const discountCode = normalizeText(row?.code).toUpperCase();
        return {
            ...row,
            risk_summary: riskSummaryMap.get(discountCode) || {
                has_recent_alert: false,
                latest_alert_type: null,
                latest_alert_state: 'idle',
                latest_alert_title: null,
                latest_alert_summary: null,
                latest_alert_at: null,
                signal_type: null,
                risk_level: null,
                risk_score: null,
                auto_response_action: null,
                auto_response_status: null,
                auto_response_summary: null,
                auto_response_applied_at: null,
                response_summary: null,
                recovery_auto_action: null,
                recovery_auto_status: null,
                recovery_auto_summary: null,
                recovery_auto_applied_at: null,
                previous_zero_total_count: null,
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
            }
        };
    });
}

function buildScopeSummary(rows = [], site = 'all') {
    const normalizedSite = normalizeSite(site);
    const rowList = Array.isArray(rows) ? rows : [];
    const globalCount = rowList.filter((row) => normalizeDiscountApplicableSite(row?.applicable_site) === 'all').length;
    const cnCount = rowList.filter((row) => normalizeDiscountApplicableSite(row?.applicable_site) === 'cn').length;
    const intlCount = rowList.filter((row) => normalizeDiscountApplicableSite(row?.applicable_site) === 'intl').length;

    if (normalizedSite === 'all') {
        return {
            mode: 'aggregate',
            visible_count: rowList.length,
            global_count: globalCount,
            cn_count: cnCount,
            intl_count: intlCount
        };
    }

    const otherSite = normalizedSite === 'cn' ? 'intl' : 'cn';
    const siteSpecificCount = normalizedSite === 'cn' ? cnCount : intlCount;
    const otherSiteCount = otherSite === 'cn' ? cnCount : intlCount;

    return {
        mode: 'site_plus_global',
        site: normalizedSite,
        other_site: otherSite,
        visible_count: globalCount + siteSpecificCount,
        global_count: globalCount,
        site_specific_count: siteSpecificCount,
        other_site_count: otherSiteCount
    };
}

module.exports = async function adminDiscountsListHandler(req, res) {
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

        let query = supabase
            .from('discount_codes')
            .select(DISCOUNT_SELECT_FIELDS)
            .order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;
        const allRows = Array.isArray(data) ? data : [];
        const rows = site === 'all'
            ? allRows
            : allRows.filter((row) => {
                const applicableSite = normalizeDiscountApplicableSite(row?.applicable_site);
                return applicableSite === 'all' || applicableSite === site;
            });
        const recentOrders = await loadRecentDiscountOrders(supabase, rows.map((row) => row?.code), site);
        const historicalOrders = await loadHistoricalOrdersForUsers(
            supabase,
            recentOrders.map((order) => order?.user_id),
            site
        );
        const assetRows = await loadDiscountAssetRows(supabase, rows.map((row) => row?.id));
        const usageMap = buildRecentUsageMap(recentOrders, historicalOrders);
        const assetSummaryMap = buildDiscountAssetSummaryMap(assetRows);
        const riskTargets = buildRiskCaseTargets(rows.map((row) => row?.code), site);
        const recentRiskJobs = filterRiskJobsForSite(await fetchRecentShopRiskAlertJobs(supabase), site);
        const [opsAlertCasesByKey, caseEventsByKey] = await Promise.all([
            fetchOpsAlertCasesByTargets(supabase, riskTargets),
            fetchOpsAlertCaseEventsByTargets(supabase, riskTargets)
        ]);
        const riskSummaryMap = buildDiscountRiskSummaryMap(rows.map((row) => row?.code), recentRiskJobs, opsAlertCasesByKey, caseEventsByKey, site);
        const rowsWithLifecycle = attachLifecycleSummary(rows, new Date());

        return sendJson(res, 200, {
            success: true,
            site,
            usage_window_days: RECENT_USAGE_WINDOW_DAYS,
            scope_summary: buildScopeSummary(allRows, site),
            rows: attachDiscountRiskSummary(
                attachAssetSummary(
                    attachRecentUsageSummary(rowsWithLifecycle, usageMap),
                    assetSummaryMap
                ),
                riskSummaryMap
            )
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load discounts'
        });
    }
};
