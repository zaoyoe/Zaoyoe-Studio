const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    DISCOUNT_SELECT_FIELDS,
    buildDiscountLifecycleSummary
} = require('../discounts/_shared');
const {
    buildDiscountAssetSummary,
    buildDiscountRevenueSummary
} = require('../../../../api/_lib/discount-assets');
const {
    buildDiscountStackingPolicy
} = require('../../../../api/_lib/discount-pricing');
const {
    getPointsCatalogBaseData
} = require('../points/_catalog-base');

const RECENT_WINDOW_DAYS = 30;
const MARKETING_ASSETS_BASE_CACHE_TTL_MS = 5000;
const marketingAssetsBaseCache = new Map();
const WORKFLOW_DEFAULTS = Object.freeze({
    discount_lifecycle_sync: {
        workflow_key: 'discount_lifecycle_sync',
        workflow_name: '优惠券生命周期同步',
        asset_family: 'discount',
        status: 'active',
        schedule_label: '建议每小时执行',
        config: {
            interval_hours: 1
        }
    },
    risk_observation_closeout: {
        workflow_key: 'risk_observation_closeout',
        workflow_name: '观察期收口',
        asset_family: 'discount',
        status: 'active',
        schedule_label: '建议每 2 小时执行',
        config: {
            interval_hours: 2
        }
    },
    retired_discount_archive: {
        workflow_key: 'retired_discount_archive',
        workflow_name: '历史优惠归档',
        asset_family: 'discount',
        status: 'active',
        schedule_label: '建议每日执行',
        config: {
            interval_hours: 24,
            archive_grace_days: 30
        }
    },
    marketing_asset_recap: {
        workflow_key: 'marketing_asset_recap',
        workflow_name: '营销资产复盘快照',
        asset_family: 'combined',
        status: 'active',
        schedule_label: '建议每日执行',
        config: {
            interval_hours: 24
        }
    }
});

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSite(value, fallback = 'all') {
    return normalizeAdminSite(value, { defaultValue: fallback }) || fallback;
}

function normalizeWorkflowStatus(value, fallback = 'active') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return ['active', 'paused'].includes(normalized) ? normalized : fallback;
}

function normalizeWorkflowKey(value = '') {
    const normalized = normalizeText(value, 80).toLowerCase();
    return Object.prototype.hasOwnProperty.call(WORKFLOW_DEFAULTS, normalized) ? normalized : '';
}

function normalizeOverviewLoadMode(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'summary' || normalized === 'details') {
        return normalized;
    }
    return 'full';
}

function isMissingSchemaObjectError(error, relationName = '') {
    const message = normalizeText(error?.message, 500).toLowerCase();
    const normalizedRelation = normalizeText(relationName, 120).toLowerCase();
    if (!message) {
        return false;
    }

    const mentionsTarget = normalizedRelation
        ? message.includes(normalizedRelation)
        : message.includes('relation') || message.includes('column') || message.includes('table');

    return mentionsTarget && (
        message.includes('does not exist')
        || message.includes('not exist')
        || message.includes('undefined table')
        || message.includes('could not find')
        || message.includes('column')
    );
}

function isRefundedOrder(order = {}) {
    return ['refunded', 'full_refund'].includes(normalizeText(order?.refund_status, 40).toLowerCase());
}

function getSafeTimestamp(value) {
    const parsed = Date.parse(normalizeText(value, 80));
    return Number.isFinite(parsed) ? parsed : 0;
}

function matchesSiteScope(value, site = 'all') {
    const normalizedSite = normalizeSite(site, 'all');
    if (normalizedSite === 'all') {
        return true;
    }

    const normalizedValue = normalizeSite(value, 'all');
    return normalizedValue === 'all' || normalizedValue === normalizedSite;
}

function groupBy(rows = [], selector) {
    const groups = new Map();
    for (const row of rows || []) {
        const key = normalizeText(selector(row), 160);
        if (!key) continue;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(row);
    }
    return groups;
}

function getRecentWindowStart(now = new Date()) {
    return new Date(now.getTime() - (RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)).toISOString();
}

function mergeWorkflowRow(row = {}, now = new Date()) {
    const key = normalizeWorkflowKey(row?.workflow_key);
    const defaults = key ? WORKFLOW_DEFAULTS[key] : null;
    const config = row?.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? row.config
        : {};
    const merged = {
        id: normalizeText(row?.id, 160) || '',
        workflow_key: key || normalizeText(row?.workflow_key, 80),
        workflow_name: normalizeText(row?.workflow_name, 120) || defaults?.workflow_name || '营销工作流',
        asset_family: normalizeText(row?.asset_family, 40) || defaults?.asset_family || 'combined',
        status: normalizeWorkflowStatus(row?.status, defaults?.status || 'active'),
        schedule_label: normalizeText(row?.schedule_label, 120) || defaults?.schedule_label || '手动触发',
        sort_order: Math.max(0, Number.parseInt(row?.sort_order, 10) || 0),
        next_run_at: normalizeText(row?.next_run_at, 80) || '',
        last_run_at: normalizeText(row?.last_run_at, 80) || '',
        last_run_status: normalizeText(row?.last_run_status, 40) || '',
        last_run_summary: normalizeText(row?.last_run_summary, 400) || '',
        config: {
            ...(defaults?.config || {}),
            ...config
        }
    };
    merged.is_due = merged.status === 'active'
        && (!merged.next_run_at || getSafeTimestamp(merged.next_run_at) <= now.getTime());
    return merged;
}

function buildDefaultWorkflowRows(now = new Date()) {
    return Object.values(WORKFLOW_DEFAULTS)
        .map((row, index) => mergeWorkflowRow({
            ...row,
            sort_order: index + 1
        }, now))
        .sort((left, right) => left.sort_order - right.sort_order);
}

function computeNextRunAt(workflow = {}, startedAt = new Date()) {
    const intervalHours = Math.max(1, Number.parseInt(workflow?.config?.interval_hours, 10) || 24);
    return new Date(startedAt.getTime() + intervalHours * 60 * 60 * 1000).toISOString();
}

function cloneMarketingAssetRow(row = {}) {
    if (!row || typeof row !== 'object') {
        return {};
    }
    return {
        ...row,
        config: row.config && typeof row.config === 'object' && !Array.isArray(row.config)
            ? { ...row.config }
            : row.config
    };
}

function cloneMarketingAssetsBaseData(baseData = {}) {
    return {
        discounts: (Array.isArray(baseData.discounts) ? baseData.discounts : []).map(cloneMarketingAssetRow),
        packages: (Array.isArray(baseData.packages) ? baseData.packages : []).map(cloneMarketingAssetRow),
        batches: (Array.isArray(baseData.batches) ? baseData.batches : []).map(cloneMarketingAssetRow),
        workflows: (Array.isArray(baseData.workflows) ? baseData.workflows : []).map(cloneMarketingAssetRow)
    };
}

function clearMarketingAssetsBaseCache() {
    marketingAssetsBaseCache.clear();
}

async function loadDiscountRows(supabase) {
    const { data, error } = await supabase
        .from('discount_codes')
        .select(DISCOUNT_SELECT_FIELDS)
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }
    return Array.isArray(data) ? data : [];
}

async function loadRecentDiscountOrders(supabase, discountCodes = [], site = 'all') {
    const codes = [...new Set((Array.isArray(discountCodes) ? discountCodes : []).map((value) => normalizeText(value, 80).toUpperCase()).filter(Boolean))];
    if (!codes.length) {
        return [];
    }

    let query = supabase
        .from('shop_orders')
        .select('id, discount_code, price_paid, discount_amount, refund_status, created_at, site')
        .in('discount_code', codes)
        .gte('created_at', getRecentWindowStart())
        .order('created_at', { ascending: false });

    if (normalizeSite(site, 'all') !== 'all') {
        query = query.eq('site', normalizeSite(site, 'all'));
    }

    const { data, error } = await query;
    if (error) {
        throw error;
    }
    return Array.isArray(data) ? data : [];
}

async function loadDiscountAssetRows(supabase, discountIds = []) {
    const ids = [...new Set((Array.isArray(discountIds) ? discountIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!ids.length) {
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('discount_user_assets')
            .select('id, discount_id, asset_status, assigned_at, claimed_at, consumed_at, restored_at')
            .in('discount_id', ids);
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingSchemaObjectError(error, 'discount_user_assets')) {
            return [];
        }
        throw error;
    }
}

async function loadWorkflowRows(supabase, now = new Date()) {
    try {
        const { data, error } = await supabase
            .from('marketing_asset_workflows')
            .select('id, workflow_key, workflow_name, asset_family, status, schedule_label, sort_order, next_run_at, last_run_at, last_run_status, last_run_summary, config')
            .order('sort_order', { ascending: true });
        if (error) throw error;
        const rows = (Array.isArray(data) ? data : []).map((row) => mergeWorkflowRow(row, now));
        return rows.length ? rows : buildDefaultWorkflowRows(now);
    } catch (error) {
        if (isMissingSchemaObjectError(error, 'marketing_asset_workflows')) {
            return buildDefaultWorkflowRows(now);
        }
        throw error;
    }
}

async function loadWorkflowRuns(supabase, workflowIds = []) {
    const ids = [...new Set((Array.isArray(workflowIds) ? workflowIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!ids.length) {
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('marketing_asset_workflow_runs')
            .select('id, workflow_id, workflow_key, trigger_source, started_at, finished_at, run_status, summary, stats')
            .in('workflow_id', ids)
            .order('started_at', { ascending: false });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingSchemaObjectError(error, 'marketing_asset_workflow_runs')) {
            return [];
        }
        throw error;
    }
}

async function loadMarketingAssetsBaseData(supabase, now = new Date(), site = 'all') {
    const cacheKey = `overview-base:${normalizeSite(site, 'all')}`;
    const cached = marketingAssetsBaseCache.get(cacheKey);
    const nowMs = Date.now();
    if (cached?.value && nowMs - cached.cachedAt <= MARKETING_ASSETS_BASE_CACHE_TTL_MS) {
        return cloneMarketingAssetsBaseData(cached.value);
    }
    if (cached?.promise) {
        return cloneMarketingAssetsBaseData(await cached.promise);
    }

    const loadPromise = Promise.all([
        loadDiscountRows(supabase),
        getPointsCatalogBaseData(supabase, { site }),
        loadWorkflowRows(supabase, now)
    ]).then(([discounts, pointsBase, workflows]) => ({
        discounts,
        packages: pointsBase.packages,
        batches: pointsBase.batches,
        workflows
    }));

    marketingAssetsBaseCache.set(cacheKey, {
        cachedAt: nowMs,
        promise: loadPromise,
        value: null
    });

    try {
        const value = await loadPromise;
        marketingAssetsBaseCache.set(cacheKey, {
            cachedAt: Date.now(),
            value: cloneMarketingAssetsBaseData(value)
        });
        return cloneMarketingAssetsBaseData(value);
    } catch (error) {
        marketingAssetsBaseCache.delete(cacheKey);
        throw error;
    }
}

function buildDiscountFamilyState({ discounts = [], orders = [], assets = [], site = 'all', now = new Date() } = {}) {
    const visibleDiscounts = (Array.isArray(discounts) ? discounts : [])
        .filter((row) => matchesSiteScope(row?.applicable_site, site));
    const ordersByCode = groupBy(orders, (row) => normalizeText(row?.discount_code, 80).toUpperCase());
    const assetsByDiscountId = groupBy(assets, (row) => normalizeText(row?.discount_id, 160));

    const rows = visibleDiscounts.map((discount) => {
        const code = normalizeText(discount?.code, 80).toUpperCase();
        const usageOrders = ordersByCode.get(code) || [];
        const assetRows = assetsByDiscountId.get(normalizeText(discount?.id, 160)) || [];
        const revenueSummary = buildDiscountRevenueSummary(usageOrders);
        const assetSummary = buildDiscountAssetSummary(assetRows);
        const lifecycleSummary = buildDiscountLifecycleSummary(discount, { now });
        const stackingPolicy = buildDiscountStackingPolicy(discount);
        const recentActivityAt = [
            normalizeText(discount?.last_restored_at, 80),
            normalizeText(discount?.last_paused_at, 80),
            normalizeText(discount?.starts_at, 80),
            normalizeText(discount?.expires_at, 80),
            assetSummary.recent_consumed_at,
            assetSummary.recent_assigned_at,
            normalizeText(usageOrders[0]?.created_at, 80),
            normalizeText(discount?.created_at, 80)
        ].sort((left, right) => getSafeTimestamp(right) - getSafeTimestamp(left))[0] || '';

        return {
            type: 'discount',
            id: normalizeText(discount?.id, 160),
            label: code || '优惠券',
            status_label: lifecycleSummary.label || '生效中',
            status_key: lifecycleSummary.key || 'active',
            family_label: '优惠券',
            site_label: normalizeSite(discount?.applicable_site, 'all').toUpperCase(),
            delivery_label: normalizeText(discount?.distribution_mode, 40),
            stacking_policy: stackingPolicy,
            recent_activity_at: recentActivityAt,
            metrics: [
                `${revenueSummary.order_count_net || 0} 单净核销`,
                `${assetSummary.issued_count || 0} 张已发放`,
                `净营收 ${revenueSummary.gmv_net || 0}`
            ],
            destination_module: 'discounts',
            destination_id: normalizeText(discount?.id, 160)
        };
    });

    const totals = rows.reduce((summary, row) => {
        const matchedOrders = ordersByCode.get(row.label) || [];
        const revenueSummary = buildDiscountRevenueSummary(matchedOrders);
        summary.total_count += 1;
        if (row.status_key === 'scheduled') summary.scheduled_count += 1;
        if (row.status_key === 'active') summary.active_count += 1;
        if (row.status_key === 'paused_risk') summary.paused_risk_count += 1;
        if (row.status_key === 'paused_manual') summary.paused_manual_count += 1;
        if (row.delivery_label === 'public_claim') summary.public_claim_count += 1;
        if (row.delivery_label === 'user_assigned') summary.user_assigned_count += 1;
        summary.recent_revenue_net += revenueSummary.gmv_net || 0;
        summary.recent_discount_cost_net += revenueSummary.discount_cost_net || 0;
        return summary;
    }, {
        total_count: 0,
        scheduled_count: 0,
        active_count: 0,
        paused_risk_count: 0,
        paused_manual_count: 0,
        public_claim_count: 0,
        user_assigned_count: 0,
        recent_revenue_net: 0,
        recent_discount_cost_net: 0
    });

    const assetSummary = buildDiscountAssetSummary(assets.filter((row) => rows.some((item) => item.id === normalizeText(row?.discount_id, 160))));

    return {
        summary: {
            ...totals,
            asset_issued_count: assetSummary.issued_count,
            asset_available_count: assetSummary.available_count
        },
        rows: rows.sort((left, right) => getSafeTimestamp(right.recent_activity_at) - getSafeTimestamp(left.recent_activity_at))
    };
}

function buildPackageMetrics(packages = [], batches = [], site = 'all') {
    const visibleBatches = (Array.isArray(batches) ? batches : [])
        .filter((batch) => matchesSiteScope(batch?.site, site));
    const batchMap = groupBy(visibleBatches, (row) => normalizeText(row?.package_id, 160));
    const rows = (Array.isArray(packages) ? packages : []).map((pkg) => {
        const packageBatches = batchMap.get(normalizeText(pkg?.id, 160)) || [];
        const generatedCount = packageBatches.reduce((sum, row) => sum + Math.max(0, Number(row?.total_count) || 0), 0);
        const usedCount = packageBatches.reduce((sum, row) => sum + Math.max(0, Number(row?.used_count) || 0), 0);
        const recentActivityAt = packageBatches
            .map((row) => normalizeText(row?.created_at, 80))
            .sort((left, right) => getSafeTimestamp(right) - getSafeTimestamp(left))[0]
            || normalizeText(pkg?.created_at, 80);
        return {
            type: 'points_package',
            id: normalizeText(pkg?.id, 160),
            label: normalizeText(pkg?.name, 160) || '积分套餐',
            status_label: pkg?.is_active === false ? '已停用' : '生效中',
            family_label: '兑换码/套餐',
            site_label: normalizeSite(site, 'all').toUpperCase(),
            recent_activity_at: recentActivityAt,
            metrics: [
                `${packageBatches.length} 个批次`,
                `${usedCount}/${generatedCount} 已核销`,
                `${Math.max(0, Number(pkg?.points_amount) || 0) + Math.max(0, Number(pkg?.bonus_points) || 0)} 积分权益`
            ],
            destination_module: 'points',
            destination_id: normalizeText(pkg?.id, 160),
            batch_count: packageBatches.length,
            generated_count: generatedCount,
            used_count: usedCount
        };
    });

    return {
        summary: {
            package_count: rows.length,
            active_package_count: rows.filter((row) => row.status_label === '生效中').length,
            batch_count: visibleBatches.length,
            generated_code_count: visibleBatches.reduce((sum, row) => sum + Math.max(0, Number(row?.total_count) || 0), 0),
            used_code_count: visibleBatches.reduce((sum, row) => sum + Math.max(0, Number(row?.used_count) || 0), 0)
        },
        rows: rows.sort((left, right) => getSafeTimestamp(right.recent_activity_at) - getSafeTimestamp(left.recent_activity_at))
    };
}

function buildWorkflowCandidateState(workflowKey = '', discounts = [], site = 'all', now = new Date(), config = {}) {
    const visibleDiscounts = (Array.isArray(discounts) ? discounts : [])
        .filter((row) => matchesSiteScope(row?.applicable_site, site));
    const archiveGraceDays = Math.max(1, Number.parseInt(config?.archive_grace_days, 10) || 30);
    const archiveThreshold = now.getTime() - (archiveGraceDays * 24 * 60 * 60 * 1000);

    if (workflowKey === 'discount_lifecycle_sync') {
        const scheduledToActivate = visibleDiscounts.filter((row) => (
            row?.is_active !== false
            && getSafeTimestamp(row?.starts_at) > 0
            && getSafeTimestamp(row?.starts_at) <= now.getTime()
            && normalizeText(row?.lifecycle_status, 40).toLowerCase() === 'scheduled'
        ));
        const futureToSchedule = visibleDiscounts.filter((row) => (
            row?.is_active !== false
            && getSafeTimestamp(row?.starts_at) > now.getTime()
            && normalizeText(row?.lifecycle_status, 40).toLowerCase() !== 'scheduled'
        ));
        const toExpire = visibleDiscounts.filter((row) => (
            getSafeTimestamp(row?.expires_at) > 0
            && getSafeTimestamp(row?.expires_at) <= now.getTime()
            && !['expired', 'archived'].includes(normalizeText(row?.lifecycle_status, 40).toLowerCase())
        ));
        return {
            due_count: scheduledToActivate.length + futureToSchedule.length + toExpire.length,
            details: {
                scheduled_to_activate: scheduledToActivate,
                future_to_schedule: futureToSchedule,
                to_expire: toExpire
            }
        };
    }

    if (workflowKey === 'risk_observation_closeout') {
        const dueRows = visibleDiscounts.filter((row) => (
            normalizeText(row?.status_reason, 40).toLowerCase() === 'risk_observation'
            && getSafeTimestamp(row?.observation_ends_at) > 0
            && getSafeTimestamp(row?.observation_ends_at) <= now.getTime()
        ));
        return {
            due_count: dueRows.length,
            details: {
                observation_completed: dueRows
            }
        };
    }

    if (workflowKey === 'retired_discount_archive') {
        const archiveRows = visibleDiscounts.filter((row) => (
            normalizeText(row?.lifecycle_status, 40).toLowerCase() === 'expired'
            && getSafeTimestamp(row?.expires_at) > 0
            && getSafeTimestamp(row?.expires_at) <= archiveThreshold
        ));
        return {
            due_count: archiveRows.length,
            details: {
                archive_candidates: archiveRows
            }
        };
    }

    return {
        due_count: 1,
        details: {}
    };
}

function buildUnifiedAssetItems(discountState = {}, packageState = {}) {
    const rows = [
        ...(Array.isArray(discountState?.rows) ? discountState.rows : []),
        ...(Array.isArray(packageState?.rows) ? packageState.rows : [])
    ];

    return rows
        .sort((left, right) => getSafeTimestamp(right.recent_activity_at) - getSafeTimestamp(left.recent_activity_at))
        .slice(0, 10);
}

function buildWorkflowOverviewRows({ workflows = [], workflowRuns = [], workflowSourceDiscounts = [], site = 'all', now = new Date() } = {}) {
    const workflowRunsByWorkflowId = groupBy(workflowRuns, (row) => normalizeText(row?.workflow_id, 160));
    return (Array.isArray(workflows) ? workflows : []).map((workflow) => {
        const runRows = workflowRunsByWorkflowId.get(normalizeText(workflow?.id, 160)) || [];
        const latestRun = runRows[0] || null;
        const candidates = buildWorkflowCandidateState(workflow.workflow_key, workflowSourceDiscounts, site, now, workflow.config);
        return {
            ...workflow,
            due_count: candidates.due_count,
            latest_run: latestRun
                ? {
                    started_at: normalizeText(latestRun?.started_at, 80),
                    finished_at: normalizeText(latestRun?.finished_at, 80),
                    run_status: normalizeText(latestRun?.run_status, 40),
                    summary: normalizeText(latestRun?.summary, 400)
                }
                : null
        };
    });
}

function buildOverviewPayload({ discountState = {}, packageState = {}, workflows = [], workflowRuns = [], workflowSourceDiscounts = [], site = 'all', now = new Date() } = {}) {
    const workflowRows = buildWorkflowOverviewRows({
        workflows,
        workflowRuns,
        workflowSourceDiscounts,
        site,
        now
    });
    return {
        success: true,
        generated_at: now.toISOString(),
        site_context: normalizeSite(site, 'all'),
        summary: {
            discount_count: Math.max(0, Number(discountState?.summary?.total_count) || 0),
            package_count: Math.max(0, Number(packageState?.summary?.package_count) || 0),
            issued_asset_count: Math.max(0, Number(discountState?.summary?.asset_issued_count) || 0),
            redemption_generated_count: Math.max(0, Number(packageState?.summary?.generated_code_count) || 0),
            recent_revenue_net: Math.max(0, Number(discountState?.summary?.recent_revenue_net) || 0),
            recent_discount_cost_net: Math.max(0, Number(discountState?.summary?.recent_discount_cost_net) || 0),
            due_workflow_count: workflowRows.filter((row) => row.status === 'active' && row.due_count > 0).length
        },
        asset_families: [
            {
                key: 'discount',
                label: '优惠券',
                summary: discountState.summary || {},
                primary_action: {
                    module: 'discounts',
                    label: '打开优惠券模块'
                }
            },
            {
                key: 'points_package',
                label: '兑换码/套餐',
                summary: packageState.summary || {},
                primary_action: {
                    module: 'points',
                    label: '打开兑换码/套餐'
                }
            }
        ],
        unified_assets: buildUnifiedAssetItems(discountState, packageState),
        workflows: workflowRows
    };
}

function buildDetailsOverlayPayload({ discountState = {}, workflows = [], workflowRuns = [], workflowSourceDiscounts = [], site = 'all', now = new Date() } = {}) {
    const workflowRows = buildWorkflowOverviewRows({
        workflows,
        workflowRuns,
        workflowSourceDiscounts,
        site,
        now
    });
    const discountSummary = discountState?.summary && typeof discountState.summary === 'object'
        ? discountState.summary
        : {};

    return {
        success: true,
        generated_at: now.toISOString(),
        site_context: normalizeSite(site, 'all'),
        load_mode: 'details',
        details_pending: false,
        summary: {
            issued_asset_count: Math.max(0, Number(discountSummary.asset_issued_count) || 0),
            recent_revenue_net: Math.max(0, Number(discountSummary.recent_revenue_net) || 0),
            recent_discount_cost_net: Math.max(0, Number(discountSummary.recent_discount_cost_net) || 0),
            due_workflow_count: workflowRows.filter((row) => row.status === 'active' && row.due_count > 0).length
        },
        asset_families: [
            {
                key: 'discount',
                summary: discountSummary
            }
        ],
        unified_assets_mode: 'discount_patch',
        unified_assets: Array.isArray(discountState?.rows) ? discountState.rows : [],
        workflows: workflowRows
    };
}

async function updateDiscountRowsByIds(supabase, ids = [], patch = {}) {
    const rowIds = [...new Set((Array.isArray(ids) ? ids : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!rowIds.length) {
        return 0;
    }

    const { error } = await supabase
        .from('discount_codes')
        .update(patch)
        .in('id', rowIds);

    if (error) {
        throw error;
    }
    return rowIds.length;
}

async function upsertWorkflowState(supabase, workflow = {}, runResult = {}, now = new Date()) {
    const workflowId = normalizeText(workflow?.id, 160);
    const nextRunAt = computeNextRunAt(workflow, now);
    const summaryText = normalizeText(runResult?.summary, 400) || '已执行';

    try {
        if (workflowId) {
            await supabase
                .from('marketing_asset_workflows')
                .update({
                    last_run_at: now.toISOString(),
                    next_run_at: nextRunAt,
                    last_run_status: normalizeText(runResult?.run_status, 40) || 'success',
                    last_run_summary: summaryText
                })
                .eq('id', workflowId);
        }

        if (workflowId) {
            await supabase
                .from('marketing_asset_workflow_runs')
                .insert({
                    workflow_id: workflowId,
                    workflow_key: normalizeText(workflow?.workflow_key, 80),
                    trigger_source: normalizeText(runResult?.trigger_source, 40) || 'manual',
                    started_at: now.toISOString(),
                    finished_at: now.toISOString(),
                    run_status: normalizeText(runResult?.run_status, 40) || 'success',
                    summary: summaryText,
                    stats: runResult?.stats && typeof runResult.stats === 'object' && !Array.isArray(runResult.stats)
                        ? runResult.stats
                        : {}
                });
        }
    } catch (error) {
        if (
            isMissingSchemaObjectError(error, 'marketing_asset_workflows')
            || isMissingSchemaObjectError(error, 'marketing_asset_workflow_runs')
        ) {
            return;
        }
        throw error;
    }
}

async function executeWorkflow({ supabase, workflow = {}, discounts = [], site = 'all', now = new Date() } = {}) {
    const workflowKey = normalizeWorkflowKey(workflow?.workflow_key);
    const candidateState = buildWorkflowCandidateState(workflowKey, discounts, site, now, workflow.config);
    const nowIso = now.toISOString();

    if (workflowKey === 'discount_lifecycle_sync') {
        const scheduledToActivateIds = candidateState.details.scheduled_to_activate.map((row) => row.id);
        const futureToScheduleIds = candidateState.details.future_to_schedule.map((row) => row.id);
        const expireIds = candidateState.details.to_expire.map((row) => row.id);

        const activatedCount = await updateDiscountRowsByIds(supabase, scheduledToActivateIds, {
            lifecycle_status: 'active',
            status_reason: 'scheduled_activated',
            observation_ends_at: null
        });
        const scheduledCount = await updateDiscountRowsByIds(supabase, futureToScheduleIds, {
            lifecycle_status: 'scheduled',
            status_reason: 'scheduled_start'
        });
        const expiredCount = await updateDiscountRowsByIds(supabase, expireIds, {
            lifecycle_status: 'expired',
            status_reason: 'expired',
            observation_ends_at: null
        });

        const result = {
            workflow_key: workflowKey,
            run_status: 'success',
            trigger_source: 'manual',
            stats: {
                activated_count: activatedCount,
                scheduled_count: scheduledCount,
                expired_count: expiredCount
            },
            summary: `同步完成：激活 ${activatedCount} 张，预排 ${scheduledCount} 张，过期 ${expiredCount} 张。`
        };
        await upsertWorkflowState(supabase, workflow, result, now);
        return result;
    }

    if (workflowKey === 'risk_observation_closeout') {
        const ids = candidateState.details.observation_completed.map((row) => row.id);
        const completedCount = await updateDiscountRowsByIds(supabase, ids, {
            lifecycle_status: 'active',
            status_reason: 'observation_complete',
            observation_ends_at: null,
            last_restored_at: nowIso
        });
        const result = {
            workflow_key: workflowKey,
            run_status: 'success',
            trigger_source: 'manual',
            stats: {
                observation_closed_count: completedCount
            },
            summary: `观察期收口完成：关闭 ${completedCount} 张优惠券的观察状态。`
        };
        await upsertWorkflowState(supabase, workflow, result, now);
        return result;
    }

    if (workflowKey === 'retired_discount_archive') {
        const ids = candidateState.details.archive_candidates.map((row) => row.id);
        const archivedCount = await updateDiscountRowsByIds(supabase, ids, {
            lifecycle_status: 'archived',
            status_reason: 'archived_by_workflow',
            is_active: false,
            observation_ends_at: null
        });
        const result = {
            workflow_key: workflowKey,
            run_status: 'success',
            trigger_source: 'manual',
            stats: {
                archived_count: archivedCount
            },
            summary: `历史归档完成：归档 ${archivedCount} 张已退休优惠券。`
        };
        await upsertWorkflowState(supabase, workflow, result, now);
        return result;
    }

    const discountState = buildDiscountFamilyState({
        discounts,
        orders: [],
        assets: [],
        site,
        now
    });
    const result = {
        workflow_key: workflowKey,
        run_status: 'success',
        trigger_source: 'manual',
        stats: {
            discount_count: discountState.summary.total_count || 0,
            active_count: discountState.summary.active_count || 0,
            scheduled_count: discountState.summary.scheduled_count || 0
        },
        summary: `复盘快照已生成：当前共有 ${discountState.summary.total_count || 0} 张优惠券，其中 ${discountState.summary.active_count || 0} 张生效中。`
    };
    await upsertWorkflowState(supabase, workflow, result, now);

    return result;
}

module.exports = async function marketingAssetsCenterHandler(req, res) {
    const method = normalizeText(req.method, 20).toUpperCase();
    const now = new Date();

    if (!['GET', 'POST'].includes(method)) {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        if (method === 'GET') {
            const { supabase } = await requireAdmin(req, { permission: 'analytics.view' });
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeSite(url.searchParams.get('site') || req.adminSite, 'all');
            const loadMode = normalizeOverviewLoadMode(url.searchParams.get('mode'));
            const includeDetails = loadMode !== 'summary';

            const {
                discounts,
                packages,
                batches,
                workflows
            } = await loadMarketingAssetsBaseData(supabase, now, site);

            const [orders, assets, workflowRuns] = includeDetails
                ? await Promise.all([
                    loadRecentDiscountOrders(supabase, discounts.map((row) => row.code), site),
                    loadDiscountAssetRows(supabase, discounts.map((row) => row.id)),
                    loadWorkflowRuns(supabase, workflows.map((row) => row.id))
                ])
                : [[], [], []];

            const discountState = buildDiscountFamilyState({
                discounts,
                orders,
                assets,
                site,
                now
            });
            if (loadMode === 'details') {
                return sendJson(res, 200, buildDetailsOverlayPayload({
                    discountState,
                    workflows,
                    workflowRuns,
                    workflowSourceDiscounts: discounts,
                    site,
                    now
                }));
            }

            const packageState = buildPackageMetrics(packages, batches, site);
            const payload = buildOverviewPayload({
                discountState,
                packageState,
                workflows,
                workflowRuns,
                workflowSourceDiscounts: discounts,
                site,
                now
            });
            payload.load_mode = loadMode;
            payload.details_pending = !includeDetails;
            return sendJson(res, 200, payload);
        }

        const { supabase, user } = await requireAdmin(req, { permission: 'discounts.manage' });
        const body = await parseJsonBody(req);
        const action = normalizeText(body?.action, 60).toLowerCase();
        const workflowKey = normalizeWorkflowKey(body?.workflow_key || body?.workflowKey);
        const site = normalizeSite(body?.site || req.adminSite, 'all');

        if (action !== 'run_workflow' || !workflowKey) {
            return sendJson(res, 400, {
                success: false,
                message: 'action 或 workflow_key 无效'
            });
        }

        const [discounts, workflows] = await Promise.all([
            loadDiscountRows(supabase),
            loadWorkflowRows(supabase, now)
        ]);
        const workflow = workflows.find((row) => row.workflow_key === workflowKey) || mergeWorkflowRow(WORKFLOW_DEFAULTS[workflowKey], now);
        const result = await executeWorkflow({
            supabase,
            workflow,
            discounts,
            site,
            now
        });
        clearMarketingAssetsBaseCache();

        if (user?.id) {
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'marketing.assets.workflow.run',
                module: 'marketing_assets',
                details: {
                    workflow_key: workflow.workflow_key,
                    workflow_name: workflow.workflow_name,
                    site: normalizeSite(site, 'all'),
                    stats: result.stats
                }
            });
        }

        return sendJson(res, 200, {
            success: true,
            workflow: {
                workflow_key: workflow.workflow_key,
                workflow_name: workflow.workflow_name,
                site_context: site
            },
            run_result: result
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '营销资产中心请求失败'
        });
    }
};
