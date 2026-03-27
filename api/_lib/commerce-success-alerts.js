const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig
} = require('./ops-alerts');

const DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG = Object.freeze({
    enabled: true,
    sweep_interval_ms: 2 * 60 * 1000,
    lookback_minutes: 30,
    state_lookback_minutes: 24 * 60,
    dedupe_window_minutes: 24 * 60,
    page_size: 500,
    max_pages: 10
});
const COMMERCE_SUCCESS_STATE_TYPES = Object.freeze([
    'shop_purchase_succeeded',
    'shop_purchase_summary',
    'wallet_recharge_succeeded',
    'wallet_recharge_summary'
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

function normalizeCommerceSuccessMonitorConfig(rawConfig = {}, env = process.env) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    return {
        enabled: normalizeBoolean(
            source.enabled,
            normalizeBoolean(env?.COMMERCE_SUCCESS_MONITOR_ENABLED, DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.enabled)
        ),
        sweep_interval_ms: normalizeNumber(
            source.sweep_interval_ms,
            normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_SWEEP_INTERVAL_MS, DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.sweep_interval_ms, 10000, 60 * 60 * 1000),
            10000,
            60 * 60 * 1000
        ),
        lookback_minutes: normalizeNumber(
            source.lookback_minutes,
            normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_LOOKBACK_MINUTES, DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.lookback_minutes, 1, 24 * 60),
            1,
            24 * 60
        ),
        state_lookback_minutes: normalizeNumber(
            source.state_lookback_minutes,
            normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_STATE_LOOKBACK_MINUTES, DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.state_lookback_minutes, 30, 7 * 24 * 60),
            30,
            7 * 24 * 60
        ),
        dedupe_window_minutes: normalizeNumber(
            source.dedupe_window_minutes,
            normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_DEDUPE_WINDOW_MINUTES, DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.dedupe_window_minutes, 1, 30 * 24 * 60),
            1,
            30 * 24 * 60
        ),
        page_size: normalizeNumber(
            source.page_size,
            normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_PAGE_SIZE, DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.page_size, 50, 5000),
            50,
            5000
        ),
        max_pages: normalizeNumber(
            source.max_pages,
            normalizeNumber(env?.COMMERCE_SUCCESS_MONITOR_MAX_PAGES, DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.max_pages, 1, 100),
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
        .select('id, user_id, site, snapshot_product_name, price_paid, total_price, item_count, delivery_status, refund_status, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentSuccessfulRechargeOrders(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('payment_orders')
        .select('id, user_id, provider, provider_order_no, site, package_name, expected_amount, paid_amount, points_amount, status, created_at, paid_at, claimed_at')
        .eq('status', 'redeemed')
        .gte('claimed_at', sinceIso)
        .order('claimed_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchRecentCommerceSuccessStateJobs(client, sinceIso, config) {
    return fetchPagedRows(() => client
        .from('ops_alert_jobs')
        .select('id, alert_type, severity, title, payload, created_at')
        .in('alert_type', COMMERCE_SUCCESS_STATE_TYPES)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }), config.page_size, config.max_pages);
}

async function fetchProfilesByIds(client, userIds = [], config = {}) {
    const normalizedUserIds = Array.from(new Set((userIds || []).map((userId) => normalizeText(userId)).filter(Boolean)));
    if (!normalizedUserIds.length) {
        return [];
    }

    const rows = [];
    const chunkSize = Math.max(1, Math.min(Number(config.page_size || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.page_size), 200));

    for (let index = 0; index < normalizedUserIds.length; index += chunkSize) {
        const batch = normalizedUserIds.slice(index, index + chunkSize);
        const { data, error } = await client
            .from('profiles')
            .select('id, email, display_name, username')
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

function getCommerceTargetId(value = {}) {
    if (!value || typeof value !== 'object') {
        return '';
    }

    if (normalizeText(value.target_id)) {
        return normalizeText(value.target_id);
    }

    return normalizeText(value.order_id || value.payment_order_id || value.id);
}

function payloadContainsCommerceTarget(value = {}, targetId = '') {
    const normalizedTargetId = normalizeText(targetId);
    if (!normalizedTargetId) {
        return true;
    }

    if (getCommerceTargetId(value) === normalizedTargetId) {
        return true;
    }

    const items = Array.isArray(value?.items) ? value.items : [];
    return items.some((item) => getCommerceTargetId(item?.payload || item) === normalizedTargetId);
}

function compareCreatedAtDescending(left = {}, right = {}) {
    const leftTime = Date.parse(normalizeText(left.created_at));
    const rightTime = Date.parse(normalizeText(right.created_at));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

function getLatestCommerceStateJob(stateJobs = [], alertType, targetId = '') {
    const normalizedType = normalizeText(alertType).toLowerCase();
    const normalizedTargetId = normalizeText(targetId);
    const candidateTypes = normalizedType === 'shop_purchase_succeeded'
        ? ['shop_purchase_succeeded', 'shop_purchase_summary']
        : normalizedType === 'wallet_recharge_succeeded'
            ? ['wallet_recharge_succeeded', 'wallet_recharge_summary']
            : [normalizedType];
    return (stateJobs || [])
        .filter((job) => candidateTypes.includes(normalizeText(job.alert_type).toLowerCase()))
        .filter((job) => !normalizedTargetId || payloadContainsCommerceTarget(job.payload, normalizedTargetId))
        .sort(compareCreatedAtDescending)[0] || null;
}

function getShopDeliveryStatusLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const labelMap = {
        pending: '待发货',
        processing: '处理中',
        retry_waiting: '重试中',
        requeued: '已重排队',
        dead_letter: '死信待处理',
        delivered: '已发货'
    };
    return labelMap[normalized] || normalized;
}

function getRefundStatusLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return '';
    const labelMap = {
        none: '正常',
        no_refund: '正常',
        refunded: '已退款',
        full_refund: '已全额退款',
        partial_refund: '部分退款',
        refund_pending: '退款处理中'
    };
    return labelMap[normalized] || normalized;
}

function buildShopPurchaseSucceededAlerts(orders = [], profilesContext = {}, rawConfig = {}, options = {}) {
    const config = normalizeCommerceSuccessMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return (orders || []).map((order) => {
        const orderId = normalizeText(order.id);
        if (!orderId) {
            return null;
        }

        const userId = normalizeText(order.user_id);
        const profile = userId && profilesContext.byId instanceof Map ? profilesContext.byId.get(userId) : null;
        const buyerLabel = resolveUserLabel(profile, userId);
        const productName = normalizeText(order.snapshot_product_name) || '商城商品';
        const shortProduct = productName.length > 18 ? `${productName.slice(0, 18)}...` : productName;
        const createdAt = normalizeText(order.created_at) || nowDate.toISOString();
        const lines = [
            '商城有一笔新购买已完成，可同步关注发货与售后状态。',
            `购买者：${buyerLabel}`,
            userId ? `用户ID：${userId}` : '',
            normalizeText(order.site) ? `站点：${normalizeText(order.site).toUpperCase()}` : '',
            `商品：${productName}`,
            Number.isFinite(Number(order.item_count)) ? `数量：${Math.max(1, Math.round(Number(order.item_count || 1)))} 件` : '',
            Number.isFinite(Number(order.total_price)) || Number.isFinite(Number(order.price_paid))
                ? `订单金额：${Number.isFinite(Number(order.total_price)) ? Number(order.total_price).toFixed(2) : Number(order.price_paid).toFixed(2)} 元`
                : '',
            normalizeText(order.delivery_status) ? `履约状态：${getShopDeliveryStatusLabel(order.delivery_status)}` : '',
            normalizeText(order.refund_status) ? `退款状态：${getRefundStatusLabel(order.refund_status)}` : '',
            `购买时间：${createdAt}`,
            '处理入口：商城管理 -> 订单列表'
        ].filter(Boolean);

        return {
            alertType: 'shop_purchase_succeeded',
            severity: 'warning',
            title: `商城购买成功（${shortProduct}）`,
            content: lines.join('\n'),
            payload: {
                target_id: orderId,
                order_id: orderId,
                user_id: userId || null,
                buyer_label: buyerLabel,
                site: normalizeText(order.site) || null,
                product_name: productName,
                item_count: Number.isFinite(Number(order.item_count)) ? Math.max(1, Math.round(Number(order.item_count || 1))) : null,
                total_price: Number.isFinite(Number(order.total_price)) ? Number(order.total_price) : null,
                price_paid: Number.isFinite(Number(order.price_paid)) ? Number(order.price_paid) : null,
                delivery_status: normalizeText(order.delivery_status) || null,
                delivery_status_label: getShopDeliveryStatusLabel(order.delivery_status) || null,
                refund_status: normalizeText(order.refund_status) || null,
                refund_status_label: getRefundStatusLabel(order.refund_status) || null,
                created_at: createdAt,
                entry_path: '商城管理 -> 订单列表'
            },
            dedupeKey: crypto
                .createHash('sha256')
                .update(`shop_purchase_succeeded:${orderId}`)
                .digest('hex'),
            dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.dedupe_window_minutes)
        };
    }).filter(Boolean);
}

function buildWalletRechargeSucceededAlerts(paymentOrders = [], profilesContext = {}, rawConfig = {}, options = {}) {
    const config = normalizeCommerceSuccessMonitorConfig(rawConfig);
    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());

    return (paymentOrders || []).map((paymentOrder) => {
        const paymentOrderId = normalizeText(paymentOrder.id);
        if (!paymentOrderId) {
            return null;
        }

        const userId = normalizeText(paymentOrder.user_id);
        const profile = userId && profilesContext.byId instanceof Map ? profilesContext.byId.get(userId) : null;
        const buyerLabel = resolveUserLabel(profile, userId);
        const packageName = normalizeText(paymentOrder.package_name) || '充值订单';
        const shortPackage = packageName.length > 18 ? `${packageName.slice(0, 18)}...` : packageName;
        const claimedAt = normalizeText(paymentOrder.claimed_at) || nowDate.toISOString();
        const lines = [
            '有一笔充值已成功入账，可同步关注到账积分与支付状态。',
            `付款者：${buyerLabel}`,
            userId ? `用户ID：${userId}` : '',
            normalizeText(paymentOrder.site) ? `站点：${normalizeText(paymentOrder.site).toUpperCase()}` : '',
            normalizeText(paymentOrder.provider) ? `支付通道：${normalizeText(paymentOrder.provider)}` : '',
            normalizeText(paymentOrder.provider_order_no) ? `支付单号：${normalizeText(paymentOrder.provider_order_no)}` : '',
            `充值档位：${packageName}`,
            Number.isFinite(Number(paymentOrder.expected_amount)) || Number.isFinite(Number(paymentOrder.paid_amount))
                ? `金额：应付 ${Number.isFinite(Number(paymentOrder.expected_amount)) ? Number(paymentOrder.expected_amount).toFixed(2) : '--'} 元 / 实付 ${Number.isFinite(Number(paymentOrder.paid_amount)) ? Number(paymentOrder.paid_amount).toFixed(2) : '--'} 元`
                : '',
            Number.isFinite(Number(paymentOrder.points_amount)) ? `到账积分：${Math.max(0, Math.round(Number(paymentOrder.points_amount || 0)))} 点` : '',
            normalizeText(paymentOrder.status) ? `订单状态：${normalizeText(paymentOrder.status)}` : '',
            normalizeText(paymentOrder.paid_at) ? `支付时间：${normalizeText(paymentOrder.paid_at)}` : '',
            `入账时间：${claimedAt}`,
            '处理入口：支付对账 -> 最近订单'
        ].filter(Boolean);

        return {
            alertType: 'wallet_recharge_succeeded',
            severity: 'warning',
            title: `充值成功（${shortPackage}）`,
            content: lines.join('\n'),
            payload: {
                target_id: paymentOrderId,
                payment_order_id: paymentOrderId,
                user_id: userId || null,
                buyer_label: buyerLabel,
                site: normalizeText(paymentOrder.site) || null,
                provider: normalizeText(paymentOrder.provider) || null,
                provider_order_no: normalizeText(paymentOrder.provider_order_no) || null,
                package_name: packageName,
                expected_amount: Number.isFinite(Number(paymentOrder.expected_amount)) ? Number(paymentOrder.expected_amount) : null,
                paid_amount: Number.isFinite(Number(paymentOrder.paid_amount)) ? Number(paymentOrder.paid_amount) : null,
                points_amount: Number.isFinite(Number(paymentOrder.points_amount)) ? Math.max(0, Math.round(Number(paymentOrder.points_amount || 0))) : null,
                status: normalizeText(paymentOrder.status) || null,
                paid_at: normalizeText(paymentOrder.paid_at) || null,
                claimed_at: claimedAt,
                created_at: normalizeText(paymentOrder.created_at) || null,
                entry_path: '支付对账 -> 最近订单'
            },
            dedupeKey: crypto
                .createHash('sha256')
                .update(`wallet_recharge_succeeded:${paymentOrderId}`)
                .digest('hex'),
            dedupeWindowMinutes: Number(config.dedupe_window_minutes || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.dedupe_window_minutes)
        };
    }).filter(Boolean);
}

async function runCommerceSuccessSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const runtime = options.runtime || await loadOpsAlertsRuntimeConfig(supabase, env);
    const runtimePurchaseConfig = runtime?.config?.shop_purchase_success && typeof runtime.config.shop_purchase_success === 'object'
        ? runtime.config.shop_purchase_success
        : {};
    const runtimeRechargeConfig = runtime?.config?.wallet_recharge_success && typeof runtime.config.wallet_recharge_success === 'object'
        ? runtime.config.wallet_recharge_success
        : {};
    const purchaseConfig = normalizeCommerceSuccessMonitorConfig({
        ...runtimePurchaseConfig,
        ...(options.purchaseConfig && typeof options.purchaseConfig === 'object' ? options.purchaseConfig : {})
    }, env);
    const rechargeConfig = normalizeCommerceSuccessMonitorConfig({
        ...runtimeRechargeConfig,
        ...(options.rechargeConfig && typeof options.rechargeConfig === 'object' ? options.rechargeConfig : {})
    }, env);

    if (!purchaseConfig.enabled && !rechargeConfig.enabled) {
        return {
            skipped: 'monitor_disabled',
            purchase_count: 0,
            recharge_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    if (!runtime?.config?.enabled) {
        return {
            skipped: 'ops_alerts_disabled',
            purchase_count: 0,
            recharge_count: 0,
            queued: 0,
            deduped: 0
        };
    }

    const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const activeConfigs = [purchaseConfig, rechargeConfig].filter((config) => config.enabled);
    const maxStateLookbackMinutes = activeConfigs.length
        ? Math.max(...activeConfigs.map((config) => Number(config.state_lookback_minutes || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.state_lookback_minutes)))
        : DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.state_lookback_minutes;
    const stateQueryConfig = activeConfigs.reduce((accumulator, config) => ({
        page_size: Math.max(accumulator.page_size, Number(config.page_size || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.page_size)),
        max_pages: Math.max(accumulator.max_pages, Number(config.max_pages || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.max_pages))
    }), {
        page_size: DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.page_size,
        max_pages: DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.max_pages
    });
    const purchaseSinceIso = new Date(
        nowDate.getTime() - Number(purchaseConfig.lookback_minutes || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.lookback_minutes) * 60 * 1000
    ).toISOString();
    const rechargeSinceIso = new Date(
        nowDate.getTime() - Number(rechargeConfig.lookback_minutes || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.lookback_minutes) * 60 * 1000
    ).toISOString();
    const stateSinceIso = new Date(nowDate.getTime() - maxStateLookbackMinutes * 60 * 1000).toISOString();

    const [shopOrders, paymentOrders, stateJobs] = await Promise.all([
        purchaseConfig.enabled ? fetchRecentShopOrders(supabase, purchaseSinceIso, purchaseConfig) : Promise.resolve([]),
        rechargeConfig.enabled ? fetchRecentSuccessfulRechargeOrders(supabase, rechargeSinceIso, rechargeConfig) : Promise.resolve([]),
        fetchRecentCommerceSuccessStateJobs(supabase, stateSinceIso, stateQueryConfig)
    ]);

    const userIds = Array.from(new Set([
        ...(shopOrders || []).map((order) => normalizeText(order.user_id)),
        ...(paymentOrders || []).map((order) => normalizeText(order.user_id))
    ].filter(Boolean)));
    const profilesConfig = activeConfigs.reduce((accumulator, config) => ({
        page_size: Math.max(accumulator.page_size, Number(config.page_size || DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.page_size))
    }), {
        page_size: DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG.page_size
    });
    const profilesContext = buildProfilesContext(await fetchProfilesByIds(supabase, userIds, profilesConfig));
    const purchaseAlerts = purchaseConfig.enabled
        ? buildShopPurchaseSucceededAlerts(shopOrders, profilesContext, purchaseConfig, { now: nowDate })
        : [];
    const rechargeAlerts = rechargeConfig.enabled
        ? buildWalletRechargeSucceededAlerts(paymentOrders, profilesContext, rechargeConfig, { now: nowDate })
        : [];
    const alerts = [...purchaseAlerts, ...rechargeAlerts];

    let queued = 0;
    let deduped = 0;
    let skippedNoChannels = 0;
    const results = [];

    for (const alert of alerts) {
        const targetId = alert.payload?.order_id || alert.payload?.payment_order_id || alert.payload?.target_id;
        const latestJob = getLatestCommerceStateJob(stateJobs, alert.alertType, targetId);
        if (latestJob) {
            deduped += 1;
            results.push({
                alert_type: alert.alertType,
                target_id: targetId || null,
                queued: false,
                reason: 'deduped'
            });
            continue;
        }

        const result = await enqueueOpsAlertJob(supabase, {
            ...alert,
            createdAt: alert.payload?.claimed_at || alert.payload?.created_at || nowDate.toISOString(),
            source: 'commerce_success_monitor'
        }, {
            runtime,
            env,
            now: nowDate
        });

        if (result?.queued === true) {
            queued += 1;
        } else if (result?.reason === 'deduped') {
            deduped += 1;
        } else if (result?.reason === 'no_active_channels') {
            skippedNoChannels += 1;
        }

        results.push({
            alert_type: alert.alertType,
            target_id: targetId || null,
            queued: result?.queued === true,
            reason: result?.reason || null
        });
    }

    return {
        purchase_count: purchaseAlerts.length,
        recharge_count: rechargeAlerts.length,
        queued,
        deduped,
        skipped_no_channels: skippedNoChannels,
        state_job_count: stateJobs.length,
        results
    };
}

module.exports = {
    COMMERCE_SUCCESS_STATE_TYPES,
    DEFAULT_COMMERCE_SUCCESS_MONITOR_CONFIG,
    buildShopPurchaseSucceededAlerts,
    buildWalletRechargeSucceededAlerts,
    normalizeCommerceSuccessMonitorConfig,
    runCommerceSuccessSweep,
    __testUtils: {
        buildProfilesContext,
        compareCreatedAtDescending,
        fetchPagedRows,
        getLatestCommerceStateJob,
        getRefundStatusLabel,
        getShopDeliveryStatusLabel,
        resolveUserLabel
    }
};
