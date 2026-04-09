const VALID_ASSET_STATUSES = new Set([
    'available',
    'used',
    'expired',
    'revoked'
]);

const VALID_DISTRIBUTION_MODES = new Set([
    'general_code',
    'public_claim',
    'user_assigned'
]);

const VALID_DISCOUNT_EVENT_TYPES = new Set([
    'discover',
    'claim',
    'apply_attempt',
    'redeem',
    'refund_restore'
]);

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeDistributionMode(value, fallback = 'general_code') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_DISTRIBUTION_MODES.has(normalized) ? normalized : fallback;
}

function normalizeDiscountAssetStatus(value, fallback = 'available') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_ASSET_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeDiscountEventType(value, fallback = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_DISCOUNT_EVENT_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeSite(value, fallback = 'all') {
    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized) return fallback;
    if (normalized === 'global') return 'all';
    if (['all', 'cn', 'intl'].includes(normalized)) return normalized;
    return fallback;
}

function isRefundedOrder(order = {}) {
    return ['refunded', 'full_refund'].includes(normalizeText(order?.refund_status, 40).toLowerCase());
}

function getSafeTimestamp(value) {
    const parsed = Date.parse(normalizeText(value, 80));
    return Number.isFinite(parsed) ? parsed : 0;
}

function sumNumeric(rows = [], field = '') {
    return (rows || []).reduce((sum, row) => {
        const value = Number(row?.[field]);
        return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
}

function countBy(rows = [], selector) {
    const counts = new Map();
    for (const row of rows || []) {
        const key = normalizeText(selector(row), 160) || 'unknown';
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function mapCountEntries(counts = new Map(), formatter = (value) => value) {
    return Array.from(counts.entries())
        .map(([key, count]) => ({
            key,
            label: formatter(key),
            count: Math.max(0, Number(count) || 0)
        }))
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return left.label.localeCompare(right.label);
        });
}

function buildDiscountAssetSummary(assets = []) {
    const rows = Array.isArray(assets) ? assets : [];
    const summary = {
        issued_count: rows.length,
        available_count: 0,
        used_count: 0,
        expired_count: 0,
        revoked_count: 0,
        restored_count: 0,
        assigned_count: 0,
        claimed_count: 0,
        recent_assigned_at: null,
        recent_claimed_at: null,
        recent_consumed_at: null
    };

    for (const asset of rows) {
        const status = normalizeDiscountAssetStatus(asset?.asset_status, 'available');
        if (status === 'available') summary.available_count += 1;
        if (status === 'used') summary.used_count += 1;
        if (status === 'expired') summary.expired_count += 1;
        if (status === 'revoked') summary.revoked_count += 1;
        if (normalizeText(asset?.restored_at, 80)) summary.restored_count += 1;
        if (normalizeText(asset?.assigned_at, 80)) summary.assigned_count += 1;
        if (normalizeText(asset?.claimed_at, 80)) summary.claimed_count += 1;

        if (getSafeTimestamp(asset?.assigned_at) > getSafeTimestamp(summary.recent_assigned_at)) {
            summary.recent_assigned_at = normalizeText(asset?.assigned_at, 80) || null;
        }
        if (getSafeTimestamp(asset?.claimed_at) > getSafeTimestamp(summary.recent_claimed_at)) {
            summary.recent_claimed_at = normalizeText(asset?.claimed_at, 80) || null;
        }
        if (getSafeTimestamp(asset?.consumed_at) > getSafeTimestamp(summary.recent_consumed_at)) {
            summary.recent_consumed_at = normalizeText(asset?.consumed_at, 80) || null;
        }
    }

    return summary;
}

function buildDiscountFunnelSummary({ distributionMode = 'general_code', assets = [], events = [], orders = [] } = {}) {
    const normalizedDistributionMode = normalizeDistributionMode(distributionMode, 'general_code');
    const eventRows = Array.isArray(events) ? events : [];
    const orderRows = Array.isArray(orders) ? orders : [];
    const assetSummary = buildDiscountAssetSummary(assets);
    const refundedOrders = orderRows.filter((row) => isRefundedOrder(row));
    const netOrders = orderRows.filter((row) => !isRefundedOrder(row));

    const stepCounts = {
        discover: eventRows.filter((event) => normalizeDiscountEventType(event?.event_type) === 'discover').length,
        claim: eventRows.filter((event) => normalizeDiscountEventType(event?.event_type) === 'claim').length,
        apply_attempt: eventRows.filter((event) => normalizeDiscountEventType(event?.event_type) === 'apply_attempt').length,
        redeem: eventRows.filter((event) => normalizeDiscountEventType(event?.event_type) === 'redeem').length || netOrders.length,
        refund_restore: eventRows.filter((event) => normalizeDiscountEventType(event?.event_type) === 'refund_restore').length || refundedOrders.length
    };

    const baseIssuedCount = normalizedDistributionMode === 'general_code'
        ? Math.max(stepCounts.apply_attempt, netOrders.length + refundedOrders.length)
        : assetSummary.issued_count;
    const baseClaimCount = normalizedDistributionMode === 'user_assigned'
        ? assetSummary.issued_count
        : Math.max(stepCounts.claim, assetSummary.claimed_count);
    const baseDiscoverCount = normalizedDistributionMode === 'general_code'
        ? Math.max(stepCounts.discover, stepCounts.apply_attempt, netOrders.length + refundedOrders.length)
        : Math.max(stepCounts.discover, baseIssuedCount);

    const rows = [
        {
            key: normalizedDistributionMode === 'general_code' ? 'attempted' : 'discover',
            label: normalizedDistributionMode === 'general_code' ? '尝试使用' : '看到优惠',
            count: baseDiscoverCount
        }
    ];

    if (normalizedDistributionMode !== 'general_code') {
        rows.push({
            key: normalizedDistributionMode === 'user_assigned' ? 'issued' : 'claimed',
            label: normalizedDistributionMode === 'user_assigned' ? '已发到账户' : '成功领取',
            count: normalizedDistributionMode === 'user_assigned' ? baseIssuedCount : baseClaimCount
        });
    }

    rows.push({
        key: 'apply_attempt',
        label: '尝试核销',
        count: Math.max(stepCounts.apply_attempt, netOrders.length + refundedOrders.length)
    });
    rows.push({
        key: 'redeem',
        label: '成功核销',
        count: netOrders.length
    });
    rows.push({
        key: 'refund',
        label: '退款回退',
        count: refundedOrders.length
    });

    const firstCount = Math.max(0, Number(rows[0]?.count || 0));
    return rows.map((row, index) => {
        const previousCount = Math.max(0, Number(rows[index - 1]?.count || firstCount));
        const currentCount = Math.max(0, Number(row.count || 0));
        const conversionBase = index === 0 ? firstCount : previousCount;
        const conversionRate = conversionBase > 0
            ? Number(((currentCount / conversionBase) * 100).toFixed(1))
            : 0;
        return {
            ...row,
            count: currentCount,
            conversion_rate: conversionRate
        };
    });
}

function buildDiscountRevenueSummary(orders = []) {
    const rows = Array.isArray(orders) ? orders : [];
    const refundedOrders = rows.filter((row) => isRefundedOrder(row));
    const netOrders = rows.filter((row) => !isRefundedOrder(row));
    return {
        order_count_gross: rows.length,
        order_count_net: netOrders.length,
        refund_count: refundedOrders.length,
        gmv_gross: Math.max(0, sumNumeric(rows, 'price_paid')),
        gmv_net: Math.max(0, sumNumeric(netOrders, 'price_paid')),
        discount_cost_gross: Math.max(0, sumNumeric(rows, 'discount_amount')),
        discount_cost_net: Math.max(0, sumNumeric(netOrders, 'discount_amount'))
    };
}

function buildDiscountSegmentSummary({ orders = [], assets = [], events = [] } = {}) {
    const orderRows = Array.isArray(orders) ? orders : [];
    const assetRows = Array.isArray(assets) ? assets : [];
    const eventRows = Array.isArray(events) ? events : [];

    return {
        sites: mapCountEntries(countBy(orderRows, (row) => normalizeSite(row?.site, 'all')), (value) => value.toUpperCase()),
        source_channels: mapCountEntries(
            countBy([...assetRows, ...eventRows], (row) => normalizeText(row?.source_channel || row?.event_source || 'direct', 80).toLowerCase()),
            (value) => value || 'direct'
        ),
        audience_segments: mapCountEntries(
            countBy(assetRows, (row) => normalizeText(row?.audience_segment || 'all_users', 80).toLowerCase()),
            (value) => value || 'all_users'
        )
    };
}

module.exports = {
    VALID_ASSET_STATUSES,
    VALID_DISTRIBUTION_MODES,
    VALID_DISCOUNT_EVENT_TYPES,
    normalizeText,
    normalizeDistributionMode,
    normalizeDiscountAssetStatus,
    normalizeDiscountEventType,
    normalizeSite,
    isRefundedOrder,
    getSafeTimestamp,
    buildDiscountAssetSummary,
    buildDiscountFunnelSummary,
    buildDiscountRevenueSummary,
    buildDiscountSegmentSummary
};
