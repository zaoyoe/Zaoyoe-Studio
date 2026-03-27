const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');
const {
    notifyActiveAdmins
} = require('./admin-notifications');

const DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 5 * 60 * 1000,
    lookback_minutes: 180,
    state_lookback_minutes: 24 * 60,
    dedupe_window_minutes: 20,
    discount_code_window_minutes: 30,
    discount_code_min_order_count: 4,
    discount_code_min_distinct_users: 3,
    zero_total_window_minutes: 20,
    zero_total_min_order_count: 3,
    zero_total_min_distinct_users: 2,
    user_velocity_window_minutes: 10,
    user_velocity_min_order_count: 4,
    user_velocity_min_total_quantity: 6,
    shared_login_ip_window_minutes: 30,
    shared_login_ip_min_order_count: 4,
    shared_login_ip_min_distinct_users: 3,
    shared_login_ip_min_total_quantity: 6,
    page_size: 500,
    max_pages: 10
});

const SHOP_ORDER_RISK_STATE_TYPES = Object.freeze([
    'shop_order_risk_anomaly',
    'shop_order_risk_recovered'
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

function normalizeShopOrderRiskMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.SHOP_ORDER_RISK_MONITOR_ENABLED, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.SHOP_ORDER_RISK_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        lookback_minutes: normalizeNumber(
            source.lookback_minutes,
            normalizeNumber(env?.SHOP_ORDER_RISK_MONITOR_LOOKBACK_MINUTES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.lookback_minutes, 10, 24 * 60),
            10,
            24 * 60
        ),
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.SHOP_ORDER_RISK_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.SHOP_ORDER_RISK_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.dedupe_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        discount_code_window_minutes: normalizeNumber(
            source.discount_code_window_minutes,
            normalizeNumber(env?.SHOP_ORDER_RISK_DISCOUNT_CODE_WINDOW_MINUTES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.discount_code_window_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        discount_code_min_order_count: normalizeNumber(
            source.discount_code_min_order_count,
            normalizeNumber(env?.SHOP_ORDER_RISK_DISCOUNT_CODE_MIN_ORDER_COUNT, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.discount_code_min_order_count, 2, 100),
            2,
            100
        ),
        discount_code_min_distinct_users: normalizeNumber(
            source.discount_code_min_distinct_users,
            normalizeNumber(env?.SHOP_ORDER_RISK_DISCOUNT_CODE_MIN_DISTINCT_USERS, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.discount_code_min_distinct_users, 1, 100),
            1,
            100
        ),
        zero_total_window_minutes: normalizeNumber(
            source.zero_total_window_minutes,
            normalizeNumber(env?.SHOP_ORDER_RISK_ZERO_TOTAL_WINDOW_MINUTES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.zero_total_window_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        zero_total_min_order_count: normalizeNumber(
            source.zero_total_min_order_count,
            normalizeNumber(env?.SHOP_ORDER_RISK_ZERO_TOTAL_MIN_ORDER_COUNT, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.zero_total_min_order_count, 1, 100),
            1,
            100
        ),
        zero_total_min_distinct_users: normalizeNumber(
            source.zero_total_min_distinct_users,
            normalizeNumber(env?.SHOP_ORDER_RISK_ZERO_TOTAL_MIN_DISTINCT_USERS, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.zero_total_min_distinct_users, 1, 100),
            1,
            100
        ),
        user_velocity_window_minutes: normalizeNumber(
            source.user_velocity_window_minutes,
            normalizeNumber(env?.SHOP_ORDER_RISK_USER_VELOCITY_WINDOW_MINUTES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.user_velocity_window_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        user_velocity_min_order_count: normalizeNumber(
            source.user_velocity_min_order_count,
            normalizeNumber(env?.SHOP_ORDER_RISK_USER_VELOCITY_MIN_ORDER_COUNT, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.user_velocity_min_order_count, 2, 100),
            2,
            100
        ),
        user_velocity_min_total_quantity: normalizeNumber(
            source.user_velocity_min_total_quantity,
            normalizeNumber(env?.SHOP_ORDER_RISK_USER_VELOCITY_MIN_TOTAL_QUANTITY, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.user_velocity_min_total_quantity, 2, 10000),
            2,
            10000
        ),
        shared_login_ip_window_minutes: normalizeNumber(
            source.shared_login_ip_window_minutes,
            normalizeNumber(env?.SHOP_ORDER_RISK_SHARED_LOGIN_IP_WINDOW_MINUTES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.shared_login_ip_window_minutes, 5, 24 * 60),
            5,
            24 * 60
        ),
        shared_login_ip_min_order_count: normalizeNumber(
            source.shared_login_ip_min_order_count,
            normalizeNumber(env?.SHOP_ORDER_RISK_SHARED_LOGIN_IP_MIN_ORDER_COUNT, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.shared_login_ip_min_order_count, 2, 100),
            2,
            100
        ),
        shared_login_ip_min_distinct_users: normalizeNumber(
            source.shared_login_ip_min_distinct_users,
            normalizeNumber(env?.SHOP_ORDER_RISK_SHARED_LOGIN_IP_MIN_DISTINCT_USERS, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.shared_login_ip_min_distinct_users, 2, 100),
            2,
            100
        ),
        shared_login_ip_min_total_quantity: normalizeNumber(
            source.shared_login_ip_min_total_quantity,
            normalizeNumber(env?.SHOP_ORDER_RISK_SHARED_LOGIN_IP_MIN_TOTAL_QUANTITY, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.shared_login_ip_min_total_quantity, 2, 10000),
            2,
            10000
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.SHOP_ORDER_RISK_MONITOR_PAGE_SIZE, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.SHOP_ORDER_RISK_MONITOR_MAX_PAGES, DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.max_pages, 1, 100),
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

async function fetchRecentShopOrders(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('shop_orders')
        .select('id, user_id, site, snapshot_product_name, price_paid, total_price, item_count, discount_code, discount_amount, created_at, refund_status')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentShopOrderRiskStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', SHOP_ORDER_RISK_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchProfilesByIds(client, userIds = [], config = {}) {
    const normalizedUserIds = Array.from(new Set((userIds || []).map((userId) => normalizeText(userId)).filter(Boolean)));
    if (!normalizedUserIds.length) {
        return [];
    }

    const rows = [];
    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.page_size), 200));

    for (let index = 0; index < normalizedUserIds.length; index += chunkSize) {
        const batch = normalizedUserIds.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('profiles')
            .select('id, email, display_name, username, last_login_ip')
            .in('id', batch);

        if (error) {
            throw error;
        }

        rows.push(...(Array.isArray(data) ? data : []));
    }

    return rows;
}

async function fetchPurchaseEntitlementsByUserIds(client, userIds = [], config = {}) {
    const normalizedUserIds = Array.from(new Set((userIds || []).map((userId) => normalizeText(userId)).filter(Boolean)));
    if (!normalizedUserIds.length) {
        return [];
    }

    const rows = [];
    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.page_size), 200));

    for (let index = 0; index < normalizedUserIds.length; index += chunkSize) {
        const batch = normalizedUserIds.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('user_purchase_entitlements')
            .select('user_id, unlimited_shop_purchases')
            .in('user_id', batch);

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

function buildPurchaseEntitlementContext(rows = []) {
    const unlimitedUserIds = new Set();
    for (const row of rows || []) {
        const userId = normalizeText(row?.user_id);
        if (!userId) continue;
        if (row?.unlimited_shop_purchases === true) {
            unlimitedUserIds.add(userId);
        }
    }
    return { unlimitedUserIds };
}

function resolveUserLabel(profile, userId = '') {
    const displayName = normalizeText(profile?.display_name);
    const username = normalizeText(profile?.username);
    const email = normalizeText(profile?.email);

    if (displayName) return displayName;
    if (username) return username;
    if (email.includes('@')) return email.split('@')[0];
    if (normalizeText(userId)) return `用户 ${normalizeText(userId).slice(0, 8)}`;
    return '未知用户';
}

function compareCreatedAtDescending(left = {}, right = {}) {
    const leftTime = Date.parse(normalizeText(left.created_at));
    const rightTime = Date.parse(normalizeText(right.created_at));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function getAlertTargetId(value = {}) {
    if (!value || typeof value !== 'object') {
        return '';
    }

    if (normalizeText(value.target_id)) {
        return normalizeText(value.target_id);
    }

    return normalizeText(value.order_id || value.user_id || value.discount_code || value.id);
}

function getLatestShopOrderRiskStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedType = normalizeText(alertType).toLowerCase();
    const normalizedTargetId = normalizeText(targetId);

    return (stateJobs || [])
        .filter((job) => normalizeText(job.alert_type).toLowerCase() === normalizedType)
        .filter((job) => !normalizedTargetId || getAlertTargetId(job.payload) === normalizedTargetId)
        .sort(compareCreatedAtDescending)[0] || null;
}

function shouldSkipRefundedOrder(order = {}) {
    const refundStatus = normalizeText(order.refund_status).toLowerCase();
    return refundStatus === 'refunded' || refundStatus === 'full_refund';
}

function isWithinWindow(createdAt, windowMinutes, nowDate) {
    const createdAtMs = Date.parse(normalizeText(createdAt));
    if (!Number.isFinite(createdAtMs)) {
        return false;
    }

    return createdAtMs >= nowDate.getTime() - Math.max(1, Number(windowMinutes || 1)) * 60 * 1000;
}

function countLabels(values = []) {
    const counts = new Map();

    for (const value of values || []) {
        const label = normalizeText(value);
        if (!label) continue;
        counts.set(label, (counts.get(label) || 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((left, right) => {
            if (right[1] !== left[1]) return right[1] - left[1];
            return left[0].localeCompare(right[0]);
        });
}

function formatTopLabels(values = [], maxItems = 3) {
    return countLabels(values)
        .slice(0, Math.max(1, maxItems))
        .map(([label, count]) => `${label} × ${count}`);
}

function getLatestCreatedAt(rows = []) {
    return (rows || []).reduce((latest, row) => {
        const candidate = normalizeText(row?.created_at);
        if (!candidate) return latest;
        if (!latest) return candidate;
        return Date.parse(candidate) > Date.parse(latest) ? candidate : latest;
    }, '');
}

function getZeroTotalOrderCount(orders = []) {
    return (orders || []).filter((order) => {
        const pricePaid = Number(order?.price_paid);
        const totalPrice = Number(order?.total_price);
        return Number.isFinite(pricePaid) && pricePaid <= 0 && Number.isFinite(totalPrice) && totalPrice > 0;
    }).length;
}

function getSiteLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return 'UNKNOWN';
    return normalized.toUpperCase();
}

function getProfileLastLoginIp(profile = {}) {
    return normalizeText(profile?.last_login_ip);
}

function buildDiscountCodeSpikeAlerts(orders = [], profilesContext = {}, config = {}, options = {}) {
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const filteredOrders = (orders || [])
        .filter((order) => !shouldSkipRefundedOrder(order))
        .filter((order) => isWithinWindow(order.created_at, config.discount_code_window_minutes, nowDate))
        .filter((order) => normalizeText(order.discount_code));
    const groups = new Map();

    for (const order of filteredOrders) {
        const discountCode = normalizeText(order.discount_code).toUpperCase();
        if (!discountCode) continue;
        if (!groups.has(discountCode)) {
            groups.set(discountCode, []);
        }
        groups.get(discountCode).push(order);
    }

    return Array.from(groups.entries()).map(([discountCode, groupOrders]) => {
        const distinctUserIds = Array.from(new Set(groupOrders.map((order) => normalizeText(order.user_id)).filter(Boolean)));
        if (
            groupOrders.length < Number(config.discount_code_min_order_count || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.discount_code_min_order_count)
            || distinctUserIds.length < Number(config.discount_code_min_distinct_users || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.discount_code_min_distinct_users)
        ) {
            return null;
        }

        const sampleUsers = distinctUserIds.slice(0, 5).map((userId) => {
            const profile = profilesContext.byId instanceof Map ? profilesContext.byId.get(userId) : null;
            return resolveUserLabel(profile, userId);
        }).filter(Boolean);
        const sampleProducts = formatTopLabels(groupOrders.map((order) => order.snapshot_product_name), 3);
        const siteLabels = formatTopLabels(groupOrders.map((order) => getSiteLabel(order.site)), 3);
        const orderRefs = groupOrders
            .map((order) => normalizeText(order.id))
            .filter(Boolean)
            .slice(0, 5);
        const latestOrderAt = getLatestCreatedAt(groupOrders);
        const zeroTotalCount = getZeroTotalOrderCount(groupOrders);
        const title = `优惠码高频使用异常（${discountCode}）`;
        const lines = [
            `优惠码 ${discountCode} 在最近 ${Math.max(1, Math.round(Number(config.discount_code_window_minutes || 0)))} 分钟内被高频使用，建议核查是否存在泄露或团伙扫货。`,
            `命中订单：${groupOrders.length} 笔`,
            `涉及账号：${distinctUserIds.length} 个`,
            `0 价订单：${zeroTotalCount} 笔`
        ];

        if (siteLabels.length) lines.push(`涉及站点：${siteLabels.join('、')}`);
        if (sampleProducts.length) lines.push(`热点商品：${sampleProducts.join('、')}`);
        if (sampleUsers.length) lines.push(`示例账号：${sampleUsers.join('、')}`);
        if (orderRefs.length) lines.push(`示例订单：${orderRefs.join('、')}`);
        if (latestOrderAt) lines.push(`最近下单时间：${latestOrderAt}`);
        lines.push('处理入口：商城管理 -> 订单列表 / 优惠券码');

        const fingerprint = groupOrders
            .map((order) => normalizeText(order.id))
            .filter(Boolean)
            .sort()
            .join('|');

        return {
            alertType: 'shop_order_risk_anomaly',
            severity: zeroTotalCount > 0 || groupOrders.length >= Number(config.discount_code_min_order_count || 0) + 2 ? 'critical' : 'warning',
            title,
            content: lines.join('\n'),
            payload: {
                target_id: `shop_order_risk:coupon:${discountCode}`,
                signal_type: 'discount_code_spike',
                discount_code: discountCode,
                order_count: groupOrders.length,
                distinct_user_count: distinctUserIds.length,
                zero_total_count: zeroTotalCount,
                site_labels: siteLabels,
                sample_products: sampleProducts,
                sample_users: sampleUsers,
                order_refs: orderRefs,
                latest_order_at: latestOrderAt || null,
                window_minutes: Math.max(1, Math.round(Number(config.discount_code_window_minutes || 0))),
                entry_path: '商城管理 -> 订单列表 / 优惠券码'
            },
            dedupeKey: crypto
                .createHash('sha256')
                .update(`shop_order_risk:discount_code_spike:${discountCode}:${fingerprint || 'empty'}`)
                .digest('hex'),
            dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.dedupe_window_minutes)
        };
    }).filter(Boolean);
}

function buildZeroTotalClusterAlerts(orders = [], profilesContext = {}, config = {}, options = {}) {
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const filteredOrders = (orders || [])
        .filter((order) => !shouldSkipRefundedOrder(order))
        .filter((order) => isWithinWindow(order.created_at, config.zero_total_window_minutes, nowDate))
        .filter((order) => {
            const pricePaid = Number(order.price_paid);
            const totalPrice = Number(order.total_price);
            return Number.isFinite(pricePaid) && pricePaid <= 0 && Number.isFinite(totalPrice) && totalPrice > 0;
        });

    const distinctUserIds = Array.from(new Set(filteredOrders.map((order) => normalizeText(order.user_id)).filter(Boolean)));
    if (
        filteredOrders.length < Number(config.zero_total_min_order_count || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.zero_total_min_order_count)
        || distinctUserIds.length < Number(config.zero_total_min_distinct_users || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.zero_total_min_distinct_users)
    ) {
        return [];
    }

    const sampleUsers = distinctUserIds.slice(0, 5).map((userId) => {
        const profile = profilesContext.byId instanceof Map ? profilesContext.byId.get(userId) : null;
        return resolveUserLabel(profile, userId);
    }).filter(Boolean);
    const sampleProducts = formatTopLabels(filteredOrders.map((order) => order.snapshot_product_name), 3);
    const siteLabels = formatTopLabels(filteredOrders.map((order) => getSiteLabel(order.site)), 3);
    const discountCodeLabels = formatTopLabels(filteredOrders.map((order) => normalizeText(order.discount_code) || '无优惠码'), 3);
    const orderRefs = filteredOrders
        .map((order) => normalizeText(order.id))
        .filter(Boolean)
        .slice(0, 5);
    const latestOrderAt = getLatestCreatedAt(filteredOrders);
    const lines = [
        `最近 ${Math.max(1, Math.round(Number(config.zero_total_window_minutes || 0)))} 分钟内出现连续 0 价商城订单，建议立即核查优惠码和订单规则。`,
        `命中订单：${filteredOrders.length} 笔`,
        `涉及账号：${distinctUserIds.length} 个`
    ];

    if (siteLabels.length) lines.push(`涉及站点：${siteLabels.join('、')}`);
    if (discountCodeLabels.length) lines.push(`热点优惠码：${discountCodeLabels.join('、')}`);
    if (sampleProducts.length) lines.push(`热点商品：${sampleProducts.join('、')}`);
    if (sampleUsers.length) lines.push(`示例账号：${sampleUsers.join('、')}`);
    if (orderRefs.length) lines.push(`示例订单：${orderRefs.join('、')}`);
    if (latestOrderAt) lines.push(`最近下单时间：${latestOrderAt}`);
    lines.push('处理入口：商城管理 -> 订单列表 / 优惠券码');

    const fingerprint = filteredOrders
        .map((order) => normalizeText(order.id))
        .filter(Boolean)
        .sort()
        .join('|');

    return [{
        alertType: 'shop_order_risk_anomaly',
        severity: 'critical',
        title: `商城 0 价订单异常（${filteredOrders.length} 笔）`,
        content: lines.join('\n'),
        payload: {
            target_id: 'shop_order_risk:zero_total:global',
            signal_type: 'zero_total_cluster',
            order_count: filteredOrders.length,
            distinct_user_count: distinctUserIds.length,
            site_labels: siteLabels,
            hot_discount_codes: discountCodeLabels,
            sample_products: sampleProducts,
            sample_users: sampleUsers,
            order_refs: orderRefs,
            latest_order_at: latestOrderAt || null,
            window_minutes: Math.max(1, Math.round(Number(config.zero_total_window_minutes || 0))),
            entry_path: '商城管理 -> 订单列表 / 优惠券码'
        },
        dedupeKey: crypto
            .createHash('sha256')
            .update(`shop_order_risk:zero_total_cluster:${fingerprint || 'empty'}`)
            .digest('hex'),
        dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.dedupe_window_minutes)
    }];
}

function buildUserVelocityAlerts(orders = [], profilesContext = {}, entitlementContext = {}, config = {}, options = {}) {
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const filteredOrders = (orders || [])
        .filter((order) => !shouldSkipRefundedOrder(order))
        .filter((order) => isWithinWindow(order.created_at, config.user_velocity_window_minutes, nowDate))
        .filter((order) => normalizeText(order.user_id));
    const groups = new Map();

    for (const order of filteredOrders) {
        const userId = normalizeText(order.user_id);
        if (!userId) continue;
        if (entitlementContext.unlimitedUserIds instanceof Set && entitlementContext.unlimitedUserIds.has(userId)) {
            continue;
        }
        if (!groups.has(userId)) {
            groups.set(userId, []);
        }
        groups.get(userId).push(order);
    }

    return Array.from(groups.entries()).map(([userId, groupOrders]) => {
        const totalQuantity = groupOrders.reduce((sum, order) => sum + Math.max(1, Math.round(Number(order.item_count || 1))), 0);
        if (
            groupOrders.length < Number(config.user_velocity_min_order_count || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.user_velocity_min_order_count)
            || totalQuantity < Number(config.user_velocity_min_total_quantity || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.user_velocity_min_total_quantity)
        ) {
            return null;
        }

        const profile = profilesContext.byId instanceof Map ? profilesContext.byId.get(userId) : null;
        const buyerLabel = resolveUserLabel(profile, userId);
        const sampleProducts = formatTopLabels(groupOrders.map((order) => order.snapshot_product_name), 3);
        const siteLabels = formatTopLabels(groupOrders.map((order) => getSiteLabel(order.site)), 3);
        const orderRefs = groupOrders
            .map((order) => normalizeText(order.id))
            .filter(Boolean)
            .slice(0, 6);
        const latestOrderAt = getLatestCreatedAt(groupOrders);
        const distinctProductCount = Array.from(new Set(groupOrders.map((order) => normalizeText(order.snapshot_product_name)).filter(Boolean))).length;
        const totalOrderValue = groupOrders.reduce((sum, order) => {
            const numericValue = Number(order.total_price);
            return sum + (Number.isFinite(numericValue) ? numericValue : 0);
        }, 0);
        const lines = [
            `账号 ${buyerLabel} 在最近 ${Math.max(1, Math.round(Number(config.user_velocity_window_minutes || 0)))} 分钟内出现高频下单，建议核查是否存在拆单扫货。`,
            `命中订单：${groupOrders.length} 笔`,
            `累计数量：${totalQuantity} 件`
        ];

        if (distinctProductCount > 0) lines.push(`涉及商品：${distinctProductCount} 个`);
        if (siteLabels.length) lines.push(`涉及站点：${siteLabels.join('、')}`);
        if (sampleProducts.length) lines.push(`热点商品：${sampleProducts.join('、')}`);
        if (orderRefs.length) lines.push(`示例订单：${orderRefs.join('、')}`);
        if (Number.isFinite(totalOrderValue) && totalOrderValue > 0) lines.push(`窗口原价合计：${totalOrderValue.toFixed(2)} 元`);
        if (latestOrderAt) lines.push(`最近下单时间：${latestOrderAt}`);
        lines.push('处理入口：商城管理 -> 订单列表 / 用户详情');

        const fingerprint = groupOrders
            .map((order) => normalizeText(order.id))
            .filter(Boolean)
            .sort()
            .join('|');

        return {
            alertType: 'shop_order_risk_anomaly',
            severity: totalQuantity >= Math.max(10, Number(config.user_velocity_min_total_quantity || 0) * 2) || groupOrders.length >= Math.max(6, Number(config.user_velocity_min_order_count || 0) * 2)
                ? 'critical'
                : 'warning',
            title: `账号短时扫货异常（${buyerLabel}）`,
            content: lines.join('\n'),
            payload: {
                target_id: `shop_order_risk:user_velocity:${userId}`,
                signal_type: 'user_velocity',
                user_id: userId,
                buyer_label: buyerLabel,
                order_count: groupOrders.length,
                total_quantity: totalQuantity,
                distinct_product_count: distinctProductCount,
                site_labels: siteLabels,
                sample_products: sampleProducts,
                order_refs: orderRefs,
                total_order_value: Number.isFinite(totalOrderValue) ? Number(totalOrderValue.toFixed(2)) : null,
                latest_order_at: latestOrderAt || null,
                window_minutes: Math.max(1, Math.round(Number(config.user_velocity_window_minutes || 0))),
                entry_path: '商城管理 -> 订单列表 / 用户详情'
            },
            dedupeKey: crypto
                .createHash('sha256')
                .update(`shop_order_risk:user_velocity:${userId}:${fingerprint || 'empty'}`)
                .digest('hex'),
            dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.dedupe_window_minutes)
        };
    }).filter(Boolean);
}

function buildSharedLoginIpAlerts(orders = [], profilesContext = {}, config = {}, options = {}) {
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const filteredOrders = (orders || [])
        .filter((order) => !shouldSkipRefundedOrder(order))
        .filter((order) => isWithinWindow(order.created_at, config.shared_login_ip_window_minutes, nowDate))
        .filter((order) => normalizeText(order.user_id));
    const groups = new Map();

    for (const order of filteredOrders) {
        const userId = normalizeText(order.user_id);
        const profile = profilesContext.byId instanceof Map ? profilesContext.byId.get(userId) : null;
        const lastLoginIp = getProfileLastLoginIp(profile);
        if (!lastLoginIp) continue;
        if (!groups.has(lastLoginIp)) {
            groups.set(lastLoginIp, []);
        }
        groups.get(lastLoginIp).push(order);
    }

    return Array.from(groups.entries()).map(([lastLoginIp, groupOrders]) => {
        const distinctUserIds = Array.from(new Set(groupOrders.map((order) => normalizeText(order.user_id)).filter(Boolean)));
        const totalQuantity = groupOrders.reduce((sum, order) => sum + Math.max(1, Math.round(Number(order.item_count || 1))), 0);
        if (
            groupOrders.length < Number(config.shared_login_ip_min_order_count || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.shared_login_ip_min_order_count)
            || distinctUserIds.length < Number(config.shared_login_ip_min_distinct_users || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.shared_login_ip_min_distinct_users)
            || totalQuantity < Number(config.shared_login_ip_min_total_quantity || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.shared_login_ip_min_total_quantity)
        ) {
            return null;
        }

        const sampleUsers = distinctUserIds.slice(0, 6).map((userId) => {
            const profile = profilesContext.byId instanceof Map ? profilesContext.byId.get(userId) : null;
            return resolveUserLabel(profile, userId);
        }).filter(Boolean);
        const sampleProducts = formatTopLabels(groupOrders.map((order) => order.snapshot_product_name), 3);
        const siteLabels = formatTopLabels(groupOrders.map((order) => getSiteLabel(order.site)), 3);
        const orderRefs = groupOrders
            .map((order) => normalizeText(order.id))
            .filter(Boolean)
            .slice(0, 6);
        const latestOrderAt = getLatestCreatedAt(groupOrders);
        const zeroTotalCount = getZeroTotalOrderCount(groupOrders);
        const distinctProductCount = Array.from(new Set(groupOrders.map((order) => normalizeText(order.snapshot_product_name)).filter(Boolean))).length;
        const totalOrderValue = groupOrders.reduce((sum, order) => {
            const numericValue = Number(order.total_price);
            return sum + (Number.isFinite(numericValue) ? numericValue : 0);
        }, 0);
        const anchorUserId = distinctUserIds[0] || null;
        const anchorProfile = anchorUserId && profilesContext.byId instanceof Map
            ? profilesContext.byId.get(anchorUserId)
            : null;
        const anchorUserLabel = resolveUserLabel(anchorProfile, anchorUserId || '');
        const lines = [
            `最近 ${Math.max(1, Math.round(Number(config.shared_login_ip_window_minutes || 0)))} 分钟内，多个账号共享同一登录 IP 后连续下单，建议核查是否存在养号、代下或团伙扫货。`,
            `共享登录 IP：${lastLoginIp}`,
            `命中订单：${groupOrders.length} 笔`,
            `涉及账号：${distinctUserIds.length} 个`,
            `累计数量：${totalQuantity} 件`
        ];

        if (distinctProductCount > 0) lines.push(`涉及商品：${distinctProductCount} 个`);
        if (zeroTotalCount > 0) lines.push(`0 价订单：${zeroTotalCount} 笔`);
        if (siteLabels.length) lines.push(`涉及站点：${siteLabels.join('、')}`);
        if (sampleProducts.length) lines.push(`热点商品：${sampleProducts.join('、')}`);
        if (sampleUsers.length) lines.push(`关联账号：${sampleUsers.join('、')}`);
        if (orderRefs.length) lines.push(`示例订单：${orderRefs.join('、')}`);
        if (Number.isFinite(totalOrderValue) && totalOrderValue > 0) lines.push(`窗口原价合计：${totalOrderValue.toFixed(2)} 元`);
        if (latestOrderAt) lines.push(`最近下单时间：${latestOrderAt}`);
        lines.push('处理入口：商城管理 -> 用户详情(关联账号) / 订单列表');

        const fingerprint = groupOrders
            .map((order) => normalizeText(order.id))
            .filter(Boolean)
            .sort()
            .join('|');

        return {
            alertType: 'shop_order_risk_anomaly',
            severity: zeroTotalCount > 0
                || distinctUserIds.length >= Math.max(4, Number(config.shared_login_ip_min_distinct_users || 0) + 1)
                || totalQuantity >= Math.max(10, Number(config.shared_login_ip_min_total_quantity || 0) * 2)
                ? 'critical'
                : 'warning',
            title: `共享登录 IP 异常（${lastLoginIp}）`,
            content: lines.join('\n'),
            payload: {
                target_id: `shop_order_risk:shared_ip:${lastLoginIp}`,
                signal_type: 'shared_login_ip_cluster',
                client_ip: lastLoginIp,
                user_id: anchorUserId,
                buyer_label: anchorUserLabel,
                related_user_ids: distinctUserIds.slice(0, 12),
                order_count: groupOrders.length,
                distinct_user_count: distinctUserIds.length,
                total_quantity: totalQuantity,
                distinct_product_count: distinctProductCount,
                zero_total_count: zeroTotalCount,
                site_labels: siteLabels,
                sample_products: sampleProducts,
                sample_users: sampleUsers,
                order_refs: orderRefs,
                total_order_value: Number.isFinite(totalOrderValue) ? Number(totalOrderValue.toFixed(2)) : null,
                latest_order_at: latestOrderAt || null,
                window_minutes: Math.max(1, Math.round(Number(config.shared_login_ip_window_minutes || 0))),
                entry_path: '商城管理 -> 用户详情(关联账号) / 订单列表'
            },
            dedupeKey: crypto
                .createHash('sha256')
                .update(`shop_order_risk:shared_login_ip_cluster:${lastLoginIp}:${fingerprint || 'empty'}`)
                .digest('hex'),
            dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.dedupe_window_minutes)
        };
    }).filter(Boolean);
}

function buildShopOrderRiskAnomalyAlerts(orders = [], contexts = {}, rawConfig = {}, options = {}) {
    const config = normalizeShopOrderRiskMonitorConfig(rawConfig);
    const profilesContext = contexts.profilesContext || { byId: new Map() };
    const entitlementContext = contexts.entitlementContext || { unlimitedUserIds: new Set() };
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    const alerts = [
        ...buildDiscountCodeSpikeAlerts(orders, profilesContext, config, { now: nowDate }),
        ...buildZeroTotalClusterAlerts(orders, profilesContext, config, { now: nowDate }),
        ...buildUserVelocityAlerts(orders, profilesContext, entitlementContext, config, { now: nowDate }),
        ...buildSharedLoginIpAlerts(orders, profilesContext, config, { now: nowDate })
    ];

    return alerts.sort((left, right) => {
        const leftSeverity = normalizeText(left?.severity).toLowerCase() === 'critical' ? 1 : 0;
        const rightSeverity = normalizeText(right?.severity).toLowerCase() === 'critical' ? 1 : 0;
        if (rightSeverity !== leftSeverity) {
            return rightSeverity - leftSeverity;
        }
        const leftTime = Date.parse(normalizeText(left?.payload?.latest_order_at));
        const rightTime = Date.parse(normalizeText(right?.payload?.latest_order_at));
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
}

function buildRecoverySummary(payload = {}) {
    const signalType = normalizeText(payload.signal_type).toLowerCase();

    if (signalType === 'discount_code_spike') {
        return `优惠码 ${normalizeText(payload.discount_code) || 'unknown'} 在风险窗口内已回落到阈值以下`;
    }
    if (signalType === 'zero_total_cluster') {
        return '风险窗口内 0 价订单数量已回落到阈值以下';
    }
    if (signalType === 'user_velocity') {
        return `账号 ${normalizeText(payload.buyer_label) || normalizeText(payload.user_id).slice(0, 8) || 'unknown'} 的短时下单频率已回落到阈值以下`;
    }
    if (signalType === 'shared_login_ip_cluster') {
        return `共享登录 IP ${normalizeText(payload.client_ip) || 'unknown'} 的多账号下单信号已回落到阈值以下`;
    }
    return '商城风险信号已回落到阈值以下';
}

function buildRecoveryTitle(payload = {}) {
    const signalType = normalizeText(payload.signal_type).toLowerCase();

    if (signalType === 'discount_code_spike') {
        return `优惠码风险已恢复（${normalizeText(payload.discount_code) || 'unknown'}）`;
    }
    if (signalType === 'zero_total_cluster') {
        return '商城 0 价订单风险已恢复';
    }
    if (signalType === 'user_velocity') {
        return `账号扫货风险已恢复（${normalizeText(payload.buyer_label) || normalizeText(payload.user_id).slice(0, 8) || 'unknown'}）`;
    }
    if (signalType === 'shared_login_ip_cluster') {
        return `共享登录 IP 风险已恢复（${normalizeText(payload.client_ip) || 'unknown'}）`;
    }
    return '商城风险告警已恢复';
}

function buildShopOrderRiskRecoveredAlerts(activeAlerts = [], stateJobs = [], rawConfig = {}, options = {}) {
    const config = normalizeShopOrderRiskMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const activeTargetIds = new Set((activeAlerts || []).map((alert) => getAlertTargetId(alert.payload)).filter(Boolean));
    const anomalyTargetIds = Array.from(new Set(
        (stateJobs || [])
            .filter((job) => normalizeText(job.alert_type).toLowerCase() === 'shop_order_risk_anomaly')
            .map((job) => getAlertTargetId(job.payload))
            .filter(Boolean)
    ));

    return anomalyTargetIds.map((targetId) => {
        const latestAnomaly = getLatestShopOrderRiskStateJob(stateJobs, 'shop_order_risk_anomaly', targetId);
        if (!latestAnomaly) {
            return null;
        }

        const latestRecovered = getLatestShopOrderRiskStateJob(stateJobs, 'shop_order_risk_recovered', targetId);
        const latestAnomalyAt = Date.parse(normalizeText(latestAnomaly.created_at));
        const latestRecoveredAt = Date.parse(normalizeText(latestRecovered?.created_at));
        if (Number.isFinite(latestAnomalyAt) && Number.isFinite(latestRecoveredAt) && latestRecoveredAt >= latestAnomalyAt) {
            return null;
        }
        if (activeTargetIds.has(targetId)) {
            return null;
        }

        const payload = latestAnomaly.payload && typeof latestAnomaly.payload === 'object'
            ? latestAnomaly.payload
            : {};
        const incidentRecoveredAt = nowDate.toISOString();
        const incidentDurationMinutes = Number.isFinite(latestAnomalyAt)
            ? Math.max(0, Math.round((nowDate.getTime() - latestAnomalyAt) / 60000))
            : 0;
        const recoverySummary = buildRecoverySummary(payload);
        const lines = [
            '商城风控异常已退出活跃状态，可从应急观察切回日常巡检。',
            `恢复结论：${recoverySummary}`
        ];

        if (normalizeText(payload.signal_type)) {
            lines.push(`风险类型：${normalizeText(payload.signal_type)}`);
        }
        if (normalizeText(payload.discount_code)) {
            lines.push(`优惠码：${normalizeText(payload.discount_code)}`);
        }
        if (normalizeText(payload.buyer_label)) {
            lines.push(`账号：${normalizeText(payload.buyer_label)}`);
        } else if (normalizeText(payload.user_id)) {
            lines.push(`用户ID：${normalizeText(payload.user_id)}`);
        }
        if (Number.isFinite(Number(payload.order_count))) {
            lines.push(`上次命中订单：${Math.max(0, Math.round(Number(payload.order_count || 0)))} 笔`);
        }
        if (Number.isFinite(Number(payload.distinct_user_count))) {
            lines.push(`上次涉及账号：${Math.max(0, Math.round(Number(payload.distinct_user_count || 0)))} 个`);
        }
        if (Number.isFinite(Number(payload.total_quantity))) {
            lines.push(`上次累计数量：${Math.max(0, Math.round(Number(payload.total_quantity || 0)))} 件`);
        }
        if (Number.isFinite(Number(payload.zero_total_count))) {
            lines.push(`上次 0 价订单：${Math.max(0, Math.round(Number(payload.zero_total_count || 0)))} 笔`);
        }
        if (Array.isArray(payload.hot_discount_codes) && payload.hot_discount_codes.length) {
            lines.push(`上次热点优惠码：${payload.hot_discount_codes.map((item) => normalizeText(item)).filter(Boolean).join('、')}`);
        }
        if (Array.isArray(payload.sample_products) && payload.sample_products.length) {
            lines.push(`上次热点商品：${payload.sample_products.map((item) => normalizeText(item)).filter(Boolean).join('、')}`);
        }
        if (normalizeText(latestAnomaly.created_at)) {
            lines.push(`上次异常：${normalizeText(latestAnomaly.created_at)}`);
        }
        lines.push(`恢复时间：${incidentRecoveredAt}`);
        lines.push(`持续时长：${incidentDurationMinutes} 分钟`);
        if (normalizeText(payload.entry_path)) {
            lines.push(`处理入口：${normalizeText(payload.entry_path)}`);
        }

        return {
            alertType: 'shop_order_risk_recovered',
            severity: 'warning',
            title: buildRecoveryTitle(payload),
            content: lines.join('\n'),
            payload: {
                target_id: targetId,
                signal_type: normalizeText(payload.signal_type) || null,
                discount_code: normalizeText(payload.discount_code) || null,
                user_id: normalizeText(payload.user_id) || null,
                buyer_label: normalizeText(payload.buyer_label) || null,
                incident_alert_job_id: normalizeText(latestAnomaly.id) || null,
                incident_started_at: normalizeText(latestAnomaly.created_at) || null,
                incident_recovered_at: incidentRecoveredAt,
                incident_duration_minutes: incidentDurationMinutes,
                recovery_summary: recoverySummary,
                previous_order_count: Number.isFinite(Number(payload.order_count)) ? Math.max(0, Math.round(Number(payload.order_count || 0))) : null,
                previous_distinct_user_count: Number.isFinite(Number(payload.distinct_user_count)) ? Math.max(0, Math.round(Number(payload.distinct_user_count || 0))) : null,
                previous_total_quantity: Number.isFinite(Number(payload.total_quantity)) ? Math.max(0, Math.round(Number(payload.total_quantity || 0))) : null,
                previous_zero_total_count: Number.isFinite(Number(payload.zero_total_count)) ? Math.max(0, Math.round(Number(payload.zero_total_count || 0))) : null,
                previous_hot_discount_codes: Array.isArray(payload.hot_discount_codes) ? payload.hot_discount_codes : [],
                previous_sample_products: Array.isArray(payload.sample_products) ? payload.sample_products : [],
                entry_path: normalizeText(payload.entry_path) || '商城管理 -> 订单列表'
            },
            allowedChannels: ['feishu'],
            dedupeKey: crypto
                .createHash('sha256')
                .update(`shop_order_risk_recovered:${targetId}:${normalizeText(latestAnomaly.id) || normalizeText(latestAnomaly.created_at) || 'unknown'}`)
                .digest('hex'),
            dedupeWindowMinutes: Math.max(
                Number(config.dedupe_window_minutes || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.dedupe_window_minutes),
                60
            )
        };
    }).filter(Boolean);
}

async function runShopOrderRiskSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const config = normalizeShopOrderRiskMonitorConfig(options.config, env);

    if (!config.enabled) {
        return {
            skipped: 'monitor_disabled',
            anomaly_count: 0,
            recovered_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            anomaly_count: 0,
            recovered_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const maxWindowMinutes = Math.max(
        Number(config.lookback_minutes || 0),
        Number(config.discount_code_window_minutes || 0),
        Number(config.zero_total_window_minutes || 0),
        Number(config.user_velocity_window_minutes || 0)
    );
    const sinceIso = new Date(nowDate.getTime() - maxWindowMinutes * 60 * 1000).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - Number(config.state_lookback_minutes || DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG.state_lookback_minutes) * 60 * 1000).toISOString();

    const [orders, stateJobs] = await Promise.all([
        fetchRecentShopOrders(supabase, sinceIso, config),
        fetchRecentShopOrderRiskStateJobs(supabase, stateSinceIso, config)
    ]);
    const userIds = Array.from(new Set((orders || []).map((order) => normalizeText(order.user_id)).filter(Boolean)));
    const [profiles, entitlements] = await Promise.all([
        fetchProfilesByIds(supabase, userIds, config),
        fetchPurchaseEntitlementsByUserIds(supabase, userIds, config)
    ]);
    const contexts = {
        profilesContext: buildProfilesContext(profiles),
        entitlementContext: buildPurchaseEntitlementContext(entitlements)
    };
    const alerts = buildShopOrderRiskAnomalyAlerts(orders, contexts, config, { now: nowDate });
    const recoveryAlerts = buildShopOrderRiskRecoveredAlerts(alerts, stateJobs, config, { now: nowDate });

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
            source: 'shop_order_risk_monitor'
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
            target_id: getAlertTargetId(alert.payload),
            signal_type: normalizeText(alert.payload?.signal_type) || null,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    for (const alert of recoveryAlerts) {
        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: nowDate.toISOString(),
            source: 'shop_order_risk_monitor'
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

        const adminNotificationResult = await notifyActiveAdmins(supabase, {
            title: alert.title,
            content: alert.content,
            type: 'success',
            dedupeWindowMinutes: Math.max(Number(alert.dedupeWindowMinutes || 0), 60)
        }).catch((error) => ({
            error: error.message || 'notify_failed'
        }));

        adminNotificationsCreated += Number(adminNotificationResult?.created || 0);
        adminNotificationsSkipped += Number(adminNotificationResult?.skipped || 0);

        results.push({
            target_id: getAlertTargetId(alert.payload),
            signal_type: normalizeText(alert.payload?.signal_type) || null,
            severity: alert.severity,
            queued: result?.queued === true,
            reason: result?.reason || null,
            admin_notification_created: Number(adminNotificationResult?.created || 0),
            admin_notification_error: normalizeText(adminNotificationResult?.error) || null
        });
    }

    return {
        anomaly_count: alerts.length,
        recovered_count: recoveryAlerts.length,
        critical_count: alerts.filter((alert) => normalizeText(alert.severity).toLowerCase() === 'critical').length,
        discount_code_spike_count: alerts.filter((alert) => normalizeText(alert.payload?.signal_type).toLowerCase() === 'discount_code_spike').length,
        zero_total_cluster_count: alerts.filter((alert) => normalizeText(alert.payload?.signal_type).toLowerCase() === 'zero_total_cluster').length,
        user_velocity_count: alerts.filter((alert) => normalizeText(alert.payload?.signal_type).toLowerCase() === 'user_velocity').length,
        shared_login_ip_cluster_count: alerts.filter((alert) => normalizeText(alert.payload?.signal_type).toLowerCase() === 'shared_login_ip_cluster').length,
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
    DEFAULT_SHOP_ORDER_RISK_MONITOR_CONFIG,
    SHOP_ORDER_RISK_STATE_TYPES,
    buildShopOrderRiskAnomalyAlerts,
    buildShopOrderRiskRecoveredAlerts,
    normalizeShopOrderRiskMonitorConfig,
    runShopOrderRiskSweep,
    __testUtils: {
        buildDiscountCodeSpikeAlerts,
        buildZeroTotalClusterAlerts,
        buildUserVelocityAlerts,
        buildSharedLoginIpAlerts,
        compareCreatedAtDescending,
        getAlertTargetId,
        getLatestShopOrderRiskStateJob,
        shouldSkipRefundedOrder,
        resolveUserLabel
    }
};
