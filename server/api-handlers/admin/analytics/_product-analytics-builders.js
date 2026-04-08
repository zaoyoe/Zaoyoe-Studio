const summaryRowsBundleHandler = require('./summary-rows-bundle');

const {
    buildRangeWindow
} = summaryRowsBundleHandler.__testUtils;

const PRODUCT_ROW_PAGE_SIZE = 500;
const PRODUCT_ROW_MAX_PAGES = 12;
const DEFAULT_PRODUCT_RANK_LIMIT = 10;
const DEFAULT_LOW_STOCK_THRESHOLD = 3;

function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInteger(value, fallback = 0) {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, digits = 2) {
    const normalized = normalizeNumber(value, 0);
    const factor = 10 ** Math.max(0, Number(digits) || 0);
    return Math.round(normalized * factor) / factor;
}

function normalizePositiveInteger(value, fallback, min = 1, max = Number.POSITIVE_INFINITY) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function toDayKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeSite(site = 'all') {
    const normalized = String(site || 'all').trim().toLowerCase();
    return normalized || 'all';
}

function isIntlProduct(product = {}) {
    return product?.price_points_intl !== null && product?.price_points_intl !== undefined;
}

function isProductAvailableForSite(product = {}, site = 'all') {
    const normalizedSite = normalizeSite(site);
    if (normalizedSite === 'intl') {
        return isIntlProduct(product);
    }
    if (normalizedSite === 'cn') {
        return product?.price_points !== null && product?.price_points !== undefined;
    }
    return true;
}

function normalizeDeliveryType(value = '') {
    const normalized = normalizeText(value, 40).toUpperCase();
    return normalized || 'KEY';
}

function isInventoryManagedProduct(product = {}) {
    return normalizeDeliveryType(product?.delivery_type) === 'KEY';
}

function normalizeRefundStatus(value = '') {
    return normalizeText(value, 40).toLowerCase() || 'none';
}

function formatRefundStatusLabel(value = '') {
    const normalized = normalizeRefundStatus(value);
    if (normalized === 'refunded' || normalized === 'full_refund') return '已退款';
    if (normalized === 'partial_refund') return '部分退款';
    if (normalized === 'applied') return '退款申请中';
    if (normalized === 'none') return '未退款';
    return normalized || '退款状态';
}

function isRefundedOrder(order = {}) {
    const status = normalizeRefundStatus(order?.refund_status);
    return status === 'refunded' || status === 'full_refund';
}

function normalizeDeliveryStatus(value = '') {
    return normalizeText(value, 60).toLowerCase() || 'unknown';
}

function formatDeliveryStatusLabel(value = '') {
    const normalized = normalizeDeliveryStatus(value);
    if (normalized === 'delivered') return '已发货';
    if (normalized === 'processing') return '处理中';
    if (normalized === 'retry_waiting') return '重试等待';
    if (normalized === 'requeued') return '已重新排队';
    if (normalized === 'dead_letter') return '死信';
    if (normalized === 'pending') return '待处理';
    if (normalized === 'unknown') return '未知状态';
    return normalized || '履约状态';
}

function isDeliverySuccessStatus(value = '') {
    return normalizeDeliveryStatus(value) === 'delivered';
}

function isDeliveryRiskStatus(value = '') {
    return ['dead_letter', 'retry_waiting', 'requeued', 'processing'].includes(normalizeDeliveryStatus(value));
}

function getOrderQuantity(order = {}) {
    return Math.max(1, normalizeInteger(order?.item_count, 1));
}

function getOrderRevenue(order = {}) {
    const total = normalizeNumber(order?.total_price, Number.NaN);
    if (Number.isFinite(total) && total > 0) {
        return total;
    }
    return Math.max(0, normalizeNumber(order?.price_paid, 0));
}

function getEventMetadata(row = {}) {
    const eventData = row?.event_data && typeof row.event_data === 'object' && !Array.isArray(row.event_data)
        ? row.event_data
        : {};
    const metadata = eventData?.metadata && typeof eventData.metadata === 'object' && !Array.isArray(eventData.metadata)
        ? eventData.metadata
        : {};
    return {
        eventData,
        metadata
    };
}

function getEventProductId(row = {}) {
    const { eventData, metadata } = getEventMetadata(row);
    return normalizeText(
        metadata.product_id
        || eventData.product_id
        || eventData.entity_id
        || row?.product_id,
        160
    );
}

function getEventSourcePromptId(row = {}) {
    const { eventData, metadata } = getEventMetadata(row);
    return normalizeText(
        metadata.source_prompt_id
        || eventData.source_prompt_id
        || '',
        160
    );
}

function getEventOrderId(row = {}) {
    const { eventData, metadata } = getEventMetadata(row);
    return normalizeText(
        metadata.order_id
        || eventData.order_id
        || '',
        160
    );
}

function parseAnalyticsEventUrl(value = '') {
    const rawValue = normalizeText(value, 2000);
    if (!rawValue) {
        return null;
    }

    try {
        return new URL(rawValue, 'https://zaoyoe.local');
    } catch (_error) {
        return null;
    }
}

function inferSourcePageKeyFromUrl(urlObj) {
    if (!urlObj) {
        return '';
    }

    const hostname = normalizeText(urlObj.hostname, 255).toLowerCase();
    if (hostname && hostname !== 'zaoyoe.local') {
        return 'external';
    }

    const pathname = normalizeText(urlObj.pathname || '/', 255).toLowerCase();
    if (!pathname || pathname === '/' || pathname.endsWith('/index.html')) {
        return 'home';
    }
    if (pathname.includes('prompts')) {
        return 'prompts';
    }
    if (pathname.includes('shop')) {
        return 'shop';
    }
    if (pathname.includes('verify')) {
        return 'verify';
    }
    if (pathname.includes('guestbook')) {
        return 'guestbook';
    }

    return normalizeText(pathname.split('/').pop()?.replace(/\.html?$/i, '') || '', 80);
}

function inferSourceChannelKeyFromUrl(urlObj) {
    if (!urlObj) {
        return '';
    }

    const promptId = normalizeText(
        urlObj.searchParams?.get('prompt_id')
        || urlObj.searchParams?.get('promptId')
        || urlObj.searchParams?.get('id')
        || '',
        160
    );
    if (promptId) {
        return 'prompt_content';
    }

    const pageKey = inferSourcePageKeyFromUrl(urlObj);
    if (pageKey === 'home') {
        return 'homepage';
    }
    if (pageKey === 'prompts') {
        return 'prompt_content';
    }
    if (pageKey === 'guestbook') {
        return 'guestbook';
    }
    if (pageKey === 'verify') {
        return 'verify';
    }
    if (pageKey === 'external') {
        return 'external';
    }
    if (pageKey === 'shop') {
        return urlObj.searchParams?.get('category')
            ? 'shop_category'
            : 'shop_storefront';
    }

    return pageKey || 'shop_storefront';
}

function getEventSourcePageKey(row = {}) {
    const { eventData, metadata } = getEventMetadata(row);
    const explicitValue = normalizeText(
        metadata.source_page
        || eventData.source_page
        || '',
        80
    ).toLowerCase();
    if (explicitValue) {
        return explicitValue;
    }

    const referrerPageKey = inferSourcePageKeyFromUrl(parseAnalyticsEventUrl(row?.referrer || ''));
    if (referrerPageKey && referrerPageKey !== 'shop') {
        return referrerPageKey;
    }

    return inferSourcePageKeyFromUrl(parseAnalyticsEventUrl(row?.page_url || ''));
}

function getEventSourceChannelKey(row = {}) {
    const { eventData, metadata } = getEventMetadata(row);
    const explicitValue = normalizeText(
        metadata.source_channel
        || eventData.source_channel
        || '',
        80
    ).toLowerCase();
    if (explicitValue) {
        return explicitValue;
    }

    if (getEventSourcePromptId(row)) {
        return 'prompt_content';
    }

    return inferSourceChannelKeyFromUrl(parseAnalyticsEventUrl(row?.referrer || ''))
        || inferSourceChannelKeyFromUrl(parseAnalyticsEventUrl(row?.page_url || ''));
}

function formatSourcePageLabel(pageKey = '') {
    const normalizedKey = normalizeText(pageKey, 80).toLowerCase();
    if (normalizedKey === 'prompts') return '提示词页';
    if (normalizedKey === 'shop') return '商城页';
    if (normalizedKey === 'home') return '首页';
    if (normalizedKey === 'verify') return '验证页';
    if (normalizedKey === 'guestbook') return '留言板';
    if (normalizedKey === 'external') return '外部来源';
    return normalizedKey || '未知页面';
}

function formatSourceChannelLabel(channelKey = '') {
    const normalizedKey = normalizeText(channelKey, 80).toLowerCase();
    if (normalizedKey === 'prompt_content') return '提示词内容导流';
    if (normalizedKey === 'homepage') return '首页导流';
    if (normalizedKey === 'guestbook') return '留言板导流';
    if (normalizedKey === 'verify') return '验证页导流';
    if (normalizedKey === 'shop_category') return '商城分类浏览';
    if (normalizedKey === 'shop_storefront') return '商城自然浏览';
    if (normalizedKey === 'external') return '外部导流';
    return normalizedKey || '未知渠道';
}

function ensureAttributionBucket(bucketMap, key = '', label = '') {
    const normalizedKey = normalizeText(key, 80).toLowerCase();
    if (!normalizedKey) {
        return null;
    }

    const existing = bucketMap.get(normalizedKey);
    if (existing) {
        return existing;
    }

    const bucket = {
        key: normalizedKey,
        label: normalizeText(label, 80) || normalizedKey,
        count: 0,
        user_ids: new Set()
    };
    bucketMap.set(normalizedKey, bucket);
    return bucket;
}

function incrementAttributionBucket(bucketMap, key = '', label = '', userId = '') {
    const bucket = ensureAttributionBucket(bucketMap, key, label);
    if (!bucket) {
        return;
    }

    bucket.count += 1;
    if (userId) {
        bucket.user_ids.add(userId);
    }
}

function incrementPromptBucket(bucketMap, promptId = '', userId = '') {
    const normalizedPromptId = normalizeText(promptId, 160);
    if (!normalizedPromptId) {
        return;
    }

    const existing = bucketMap.get(normalizedPromptId) || {
        prompt_id: normalizedPromptId,
        count: 0,
        user_ids: new Set(),
        detail_view_count: 0,
        detail_view_user_ids: new Set(),
        purchase_click_count: 0,
        purchase_click_user_ids: new Set(),
        purchase_success_count: 0,
        purchase_success_user_ids: new Set(),
        purchase_event_keys: new Set(),
        purchase_order_samples: new Map(),
        gmv_points: 0
    };
    existing.count += 1;
    if (userId) {
        existing.user_ids.add(userId);
    }
    bucketMap.set(normalizedPromptId, existing);
}

function recordPromptAttributionEvent(bucketMap, promptId = '', eventName = '', userId = '', row = {}, orderRevenueById = null, orderById = null) {
    const normalizedPromptId = normalizeText(promptId, 160);
    if (!normalizedPromptId) {
        return;
    }

    incrementPromptBucket(bucketMap, normalizedPromptId, userId);
    const bucket = bucketMap.get(normalizedPromptId);
    if (!bucket) {
        return;
    }

    if (eventName === 'product_detail_view') {
        bucket.detail_view_count += 1;
        if (userId) {
            bucket.detail_view_user_ids.add(userId);
        }
        return;
    }

    if (eventName === 'product_purchase_click') {
        bucket.purchase_click_count += 1;
        if (userId) {
            bucket.purchase_click_user_ids.add(userId);
        }
        return;
    }

    if (eventName === 'shop_purchase' || eventName === 'product_purchase_success') {
        const purchaseEventKey = getEventOrderId(row) || normalizeText(row?.id, 160) || `${normalizedPromptId}:${normalizeText(row?.created_at, 80)}:${userId}`;
        if (bucket.purchase_event_keys.has(purchaseEventKey)) {
            return;
        }

        bucket.purchase_event_keys.add(purchaseEventKey);
        bucket.purchase_success_count += 1;
        if (userId) {
            bucket.purchase_success_user_ids.add(userId);
        }

        const { eventData, metadata } = getEventMetadata(row);
        const orderId = getEventOrderId(row);
        const orderRow = orderId && orderById instanceof Map ? orderById.get(orderId) || null : null;
        bucket.gmv_points += normalizeNumber(
            metadata.total_points
            ?? eventData.total_points
            ?? eventData.event_value
            ?? (orderId && orderRevenueById instanceof Map ? orderRevenueById.get(orderId) : 0),
            0
        );

        if (orderId) {
            bucket.purchase_order_samples.set(orderId, {
                order_id: orderId,
                user_id: userId,
                product_id: getEventProductId(row),
                product_name: normalizeText(orderRow?.snapshot_product_name, 200),
                site: normalizeSite(orderRow?.site || row?.site),
                total_points: roundNumber(
                    normalizeNumber(
                        metadata.total_points
                        ?? eventData.total_points
                        ?? eventData.event_value
                        ?? (orderRevenueById instanceof Map ? orderRevenueById.get(orderId) : 0),
                        0
                    ),
                    2
                ),
                refund_status: normalizeRefundStatus(orderRow?.refund_status),
                delivery_status: normalizeDeliveryStatus(orderRow?.delivery_status),
                created_at: normalizeText(orderRow?.created_at || row?.created_at, 80)
            });
        }
    }
}

function sortAttributionRows(left, right) {
    return right.count - left.count
        || right.user_count - left.user_count
        || String(left.label || left.key || '').localeCompare(String(right.label || right.key || ''), 'zh-CN');
}

function buildAttributionRows(bucketMap) {
    return Array.from(bucketMap.values())
        .map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            count: bucket.count,
            user_count: bucket.user_ids.size
        }))
        .sort(sortAttributionRows);
}

function buildPromptSourceRows(bucketMap) {
    return Array.from(bucketMap.values())
        .map((bucket) => ({
            prompt_id: bucket.prompt_id,
            count: bucket.count,
            user_count: bucket.user_ids.size,
            user_samples: Array.from(bucket.user_ids).slice(0, 5),
            detail_view_count: bucket.detail_view_count,
            detail_view_user_count: bucket.detail_view_user_ids.size,
            detail_view_user_samples: Array.from(bucket.detail_view_user_ids).slice(0, 5),
            purchase_click_count: bucket.purchase_click_count,
            purchase_click_user_count: bucket.purchase_click_user_ids.size,
            purchase_click_user_samples: Array.from(bucket.purchase_click_user_ids).slice(0, 5),
            purchase_success_count: bucket.purchase_success_count,
            purchase_success_user_count: bucket.purchase_success_user_ids.size,
            purchase_success_user_samples: Array.from(bucket.purchase_success_user_ids).slice(0, 5),
            order_samples: Array.from(bucket.purchase_order_samples.values())
                .sort((left, right) => String(right?.created_at || '').localeCompare(String(left?.created_at || '')))
                .slice(0, 5),
            gmv_points: roundNumber(bucket.gmv_points, 2)
        }))
        .sort((left, right) => (
            normalizeNumber(right.gmv_points, 0) - normalizeNumber(left.gmv_points, 0)
            || right.purchase_success_count - left.purchase_success_count
            || right.purchase_click_count - left.purchase_click_count
            || right.detail_view_count - left.detail_view_count
            || right.count - left.count
            || right.user_count - left.user_count
            || String(left.prompt_id || '').localeCompare(String(right.prompt_id || ''), 'zh-CN')
        ));
}

function buildProductOrderStatusBreakdownRows(orders = [], { kind = 'refund' } = {}) {
    const bucketMap = new Map();

    (Array.isArray(orders) ? orders : []).forEach((order) => {
        const isRefundKind = kind === 'refund';
        const status = isRefundKind
            ? normalizeRefundStatus(order?.refund_status)
            : normalizeDeliveryStatus(order?.delivery_status);

        if (isRefundKind && status === 'none') {
            return;
        }

        if (!isRefundKind && status === 'unknown') {
            return;
        }

        const site = normalizeSite(order?.site);
        const userId = normalizeText(order?.user_id, 160);
        const bucket = bucketMap.get(status) || {
            status,
            label: isRefundKind ? formatRefundStatusLabel(status) : formatDeliveryStatusLabel(status),
            count: 0,
            user_ids: new Set(),
            site_counts: new Map()
        };

        bucket.count += 1;
        if (userId) {
            bucket.user_ids.add(userId);
        }
        bucket.site_counts.set(site, (bucket.site_counts.get(site) || 0) + 1);
        bucketMap.set(status, bucket);
    });

    return Array.from(bucketMap.values())
        .map((bucket) => {
            const siteRows = Array.from(bucket.site_counts.entries())
                .sort((left, right) => right[1] - left[1] || String(left[0] || '').localeCompare(String(right[0] || ''), 'zh-CN'))
                .map(([site, count]) => ({
                    site,
                    label: site === 'intl' ? 'INTL' : (site === 'cn' ? 'CN' : String(site || 'ALL').toUpperCase()),
                    count
                }));

            return {
                status: bucket.status,
                label: bucket.label,
                count: bucket.count,
                user_count: bucket.user_ids.size,
                tone: kind === 'refund'
                    ? 'danger'
                    : (isDeliveryRiskStatus(bucket.status) ? 'warning' : (isDeliverySuccessStatus(bucket.status) ? 'success' : 'neutral')),
                site_rows: siteRows,
                site_summary: siteRows.map((row) => `${row.label} ${row.count}`).join(' / ')
            };
        })
        .sort((left, right) => {
            const leftRisk = kind === 'refund'
                ? 1
                : (isDeliveryRiskStatus(left.status) ? 2 : (isDeliverySuccessStatus(left.status) ? 0 : 1));
            const rightRisk = kind === 'refund'
                ? 1
                : (isDeliveryRiskStatus(right.status) ? 2 : (isDeliverySuccessStatus(right.status) ? 0 : 1));

            return rightRisk - leftRisk
                || right.count - left.count
                || right.user_count - left.user_count
                || String(left.label || '').localeCompare(String(right.label || ''), 'zh-CN');
        });
}

function buildProductEventStageSummary(entry = {}) {
    const legacyViewCount = normalizeInteger(entry.view_count, 0);
    const legacyViewUserCount = entry.viewer_ids instanceof Set ? entry.viewer_ids.size : 0;
    const detailViewCount = normalizeInteger(entry.detail_view_count, 0);
    const detailViewUserCount = entry.detail_viewer_ids instanceof Set ? entry.detail_viewer_ids.size : 0;
    const purchaseSuccessCount = entry.purchase_event_keys instanceof Set ? entry.purchase_event_keys.size : 0;
    const purchaseSuccessUserCount = entry.purchase_success_user_ids instanceof Set ? entry.purchase_success_user_ids.size : 0;

    return [
        {
            key: 'product_card_click',
            label: '商品卡点击',
            count: normalizeInteger(entry.card_click_count, 0),
            user_count: entry.card_click_user_ids instanceof Set ? entry.card_click_user_ids.size : 0,
            status: normalizeInteger(entry.card_click_count, 0) > 0 ? 'ready' : 'collecting',
            basis: 'product_card_click',
            basis_label: '新版埋点'
        },
        {
            key: 'product_detail_view',
            label: '详情浏览',
            count: detailViewCount || legacyViewCount,
            user_count: detailViewUserCount || legacyViewUserCount,
            status: detailViewCount > 0 ? 'ready' : (legacyViewCount > 0 ? 'legacy' : 'collecting'),
            basis: detailViewCount > 0 ? 'product_detail_view' : 'shop_view',
            basis_label: detailViewCount > 0 ? '新版埋点' : '兼容旧埋点'
        },
        {
            key: 'product_purchase_click',
            label: '购买点击',
            count: normalizeInteger(entry.purchase_click_count, 0),
            user_count: entry.purchase_click_user_ids instanceof Set ? entry.purchase_click_user_ids.size : 0,
            status: normalizeInteger(entry.purchase_click_count, 0) > 0 ? 'ready' : 'collecting',
            basis: 'product_purchase_click',
            basis_label: '新版埋点'
        },
        {
            key: 'product_purchase_success',
            label: '支付成功',
            count: purchaseSuccessCount,
            user_count: purchaseSuccessUserCount,
            status: purchaseSuccessCount > 0 ? 'ready' : 'collecting',
            basis: 'shop_purchase + product_purchase_success',
            basis_label: '兼容汇总'
        }
    ];
}

async function fetchPagedRows(buildQuery, pageSize = PRODUCT_ROW_PAGE_SIZE, maxPages = PRODUCT_ROW_MAX_PAGES) {
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

async function fetchShopProducts(supabase) {
    return fetchPagedRows(() => supabase
        .from('shop_products')
        .select('id, name, category, is_active, stock_count, delivery_type, price_points, price_points_intl, updated_at')
        .order('updated_at', { ascending: false }));
}

async function fetchShopInventory(supabase) {
    return fetchPagedRows(() => supabase
        .from('shop_inventory')
        .select('id, product_id, status, buyer_id, sold_at, created_at')
        .order('created_at', { ascending: false }));
}

async function fetchShopOrders(supabase, { site = 'all', startIso = '', endIso = '' } = {}) {
    return fetchPagedRows(() => {
        let query = supabase
            .from('shop_orders')
            .select('id, user_id, product_id, site, item_count, price_paid, total_price, snapshot_product_name, refund_status, delivery_status, created_at')
            .order('created_at', { ascending: false });

        if (site && site !== 'all') {
            query = query.eq('site', site);
        }
        if (startIso) {
            query = query.gte('created_at', startIso);
        }
        if (endIso) {
            query = query.lte('created_at', endIso);
        }
        return query;
    });
}

async function fetchProductEvents(supabase, { site = 'all', startIso = '', endIso = '' } = {}) {
    return fetchPagedRows(() => {
        let query = supabase
            .from('user_events')
            .select('id, user_id, site, event_name, event_type, event_data, page_url, referrer, created_at')
            .order('created_at', { ascending: false });

        if (site && site !== 'all') {
            query = query.eq('site', site);
        }
        if (startIso) {
            query = query.gte('created_at', startIso);
        }
        if (endIso) {
            query = query.lte('created_at', endIso);
        }
        return query;
    });
}

function filterProductsForSite(products = [], site = 'all') {
    return (Array.isArray(products) ? products : []).filter((product) => isProductAvailableForSite(product, site));
}

function buildProductMetricEntries({ products = [], orders = [], events = [], inventory = [], site = 'all' } = {}) {
    const filteredProducts = filterProductsForSite(products, site);
    const productMap = new Map(filteredProducts.map((product) => [normalizeText(product?.id, 160), product]));
    const inventoryByProduct = new Map();
    const metricsByProduct = new Map();
    const orderRevenueById = new Map(
        (Array.isArray(orders) ? orders : []).map((order) => [
            normalizeText(order?.id, 160),
            roundNumber(getOrderRevenue(order), 2)
        ]).filter(([orderId]) => orderId)
    );
    const orderById = new Map(
        (Array.isArray(orders) ? orders : []).map((order) => [
            normalizeText(order?.id, 160),
            order
        ]).filter(([orderId]) => orderId)
    );

    function ensureEntry(productId, fallbackName = '') {
        const normalizedId = normalizeText(productId, 160);
        if (!normalizedId) return null;

        const existing = metricsByProduct.get(normalizedId);
        if (existing) {
            return existing;
        }

        const product = productMap.get(normalizedId) || null;
        const entry = {
            product_id: normalizedId,
            product_name: normalizeText(product?.name, 200) || normalizeText(fallbackName, 200) || '未命名商品',
            category: normalizeText(product?.category, 120) || '未分类',
            is_active: product?.is_active !== false,
            delivery_type: normalizeDeliveryType(product?.delivery_type),
            stock_count: Math.max(0, normalizeInteger(product?.stock_count, 0)),
            units_sold: 0,
            order_count: 0,
            refunded_order_count: 0,
            gmv_points: 0,
            buyer_ids: new Set(),
            viewer_ids: new Set(),
            view_count: 0,
            card_click_user_ids: new Set(),
            card_click_count: 0,
            detail_viewer_ids: new Set(),
            detail_view_count: 0,
            purchase_click_user_ids: new Set(),
            purchase_click_count: 0,
            purchase_success_user_ids: new Set(),
            purchase_event_keys: new Set(),
            event_purchase_count: 0,
            delivery_success_count: 0,
            delivery_risk_count: 0,
            recent_prompt_ids: new Set(),
            source_page_buckets: new Map(),
            source_channel_buckets: new Map(),
            prompt_source_buckets: new Map()
        };
        metricsByProduct.set(normalizedId, entry);
        return entry;
    }

    (Array.isArray(inventory) ? inventory : []).forEach((row) => {
        const productId = normalizeText(row?.product_id, 160);
        if (!productId) return;
        if (site !== 'all' && !productMap.has(productId)) return;
        const bucket = inventoryByProduct.get(productId) || [];
        bucket.push(row);
        inventoryByProduct.set(productId, bucket);
    });

    filteredProducts.forEach((product) => {
        ensureEntry(product?.id, product?.name);
    });

    (Array.isArray(orders) ? orders : []).forEach((order) => {
        const entry = ensureEntry(order?.product_id, order?.snapshot_product_name);
        if (!entry) return;

        const quantity = getOrderQuantity(order);
        const revenue = getOrderRevenue(order);
        const userId = normalizeText(order?.user_id, 160);
        const refunded = isRefundedOrder(order);
        const deliveryStatus = normalizeDeliveryStatus(order?.delivery_status);

        if (refunded) {
            entry.refunded_order_count += 1;
        } else {
            entry.order_count += 1;
            entry.units_sold += quantity;
            entry.gmv_points += revenue;
            if (userId) entry.buyer_ids.add(userId);
        }

        if (isDeliverySuccessStatus(deliveryStatus)) {
            entry.delivery_success_count += 1;
        } else if (!refunded && isDeliveryRiskStatus(deliveryStatus)) {
            entry.delivery_risk_count += 1;
        }
    });

    (Array.isArray(events) ? events : []).forEach((row) => {
        const productId = getEventProductId(row);
        if (!productId) return;
        if (site !== 'all' && !productMap.has(productId) && !metricsByProduct.has(productId)) return;
        const entry = ensureEntry(productId);
        if (!entry) return;

        const eventName = normalizeText(row?.event_name, 120).toLowerCase();
        const userId = normalizeText(row?.user_id, 160);
        const promptId = getEventSourcePromptId(row);
        const sourcePageKey = getEventSourcePageKey(row);
        const sourceChannelKey = getEventSourceChannelKey(row);
        const attributionEligible = ['shop_view', 'product_card_click', 'product_detail_view', 'product_purchase_click'].includes(eventName);

        if (eventName === 'shop_view') {
            entry.view_count += 1;
            if (userId) entry.viewer_ids.add(userId);
        }

        if (eventName === 'product_card_click') {
            entry.card_click_count += 1;
            if (userId) entry.card_click_user_ids.add(userId);
        }

        if (eventName === 'product_detail_view') {
            entry.detail_view_count += 1;
            if (userId) entry.detail_viewer_ids.add(userId);
        }

        if (eventName === 'product_purchase_click') {
            entry.purchase_click_count += 1;
            if (userId) entry.purchase_click_user_ids.add(userId);
        }

        if (eventName === 'shop_purchase' || eventName === 'product_purchase_success') {
            const purchaseEventKey = getEventOrderId(row) || normalizeText(row?.id, 160) || `${productId}:${normalizeText(row?.created_at, 80)}:${userId}`;
            if (purchaseEventKey) {
                entry.purchase_event_keys.add(purchaseEventKey);
            }
            if (userId) {
                entry.purchase_success_user_ids.add(userId);
            }
        }

        if (attributionEligible) {
            incrementAttributionBucket(entry.source_page_buckets, sourcePageKey, formatSourcePageLabel(sourcePageKey), userId);
            incrementAttributionBucket(entry.source_channel_buckets, sourceChannelKey, formatSourceChannelLabel(sourceChannelKey), userId);
        }

        if (promptId) {
            entry.recent_prompt_ids.add(promptId);
            incrementPromptBucket(entry.prompt_source_buckets, promptId, userId);
            recordPromptAttributionEvent(entry.prompt_source_buckets, promptId, eventName, userId, row, orderRevenueById, orderById);
        }
    });

    return Array.from(metricsByProduct.values()).map((entry) => {
        const inventoryRows = inventoryByProduct.get(entry.product_id) || [];
        const availableInventoryCount = inventoryRows.filter((row) => normalizeText(row?.status, 40).toLowerCase() === 'available').length;
        const soldInventoryCount = inventoryRows.filter((row) => normalizeText(row?.status, 40).toLowerCase() === 'sold').length;
        const reserveInventoryCount = inventoryRows.filter((row) => normalizeText(row?.status, 40).toLowerCase() === 'reserve').length;
        const faultInventoryCount = inventoryRows.filter((row) => normalizeText(row?.status, 40).toLowerCase() === 'fault').length;
        const buyerCount = entry.buyer_ids.size;
        const viewUserCount = entry.viewer_ids.size;
        const conversionRate = viewUserCount > 0 ? roundNumber((buyerCount / viewUserCount) * 100, 2) : 0;
        const avgOrderValue = entry.order_count > 0 ? roundNumber(entry.gmv_points / entry.order_count, 2) : 0;
        const refundRate = entry.order_count + entry.refunded_order_count > 0
            ? roundNumber((entry.refunded_order_count / (entry.order_count + entry.refunded_order_count)) * 100, 2)
            : 0;
        const deliveryRiskRate = entry.order_count > 0
            ? roundNumber((entry.delivery_risk_count / entry.order_count) * 100, 2)
            : 0;
        const deliverySuccessRate = entry.order_count > 0
            ? roundNumber((entry.delivery_success_count / entry.order_count) * 100, 2)
            : 0;
        const sourcePages = buildAttributionRows(entry.source_page_buckets);
        const sourceChannels = buildAttributionRows(entry.source_channel_buckets);
        const promptSources = buildPromptSourceRows(entry.prompt_source_buckets);
        const topPromptSource = promptSources[0] || null;
        const contentAssistedPromptCount = promptSources.length;
        const contentAssistedDetailViewCount = promptSources.reduce((sum, row) => sum + normalizeInteger(row?.detail_view_count, 0), 0);
        const contentAssistedPurchaseClickCount = promptSources.reduce((sum, row) => sum + normalizeInteger(row?.purchase_click_count, 0), 0);
        const contentAssistedPurchaseSuccessCount = promptSources.reduce((sum, row) => sum + normalizeInteger(row?.purchase_success_count, 0), 0);
        const contentAssistedGmvPoints = roundNumber(
            promptSources.reduce((sum, row) => sum + normalizeNumber(row?.gmv_points, 0), 0),
            2
        );

        return {
            product_id: entry.product_id,
            product_name: entry.product_name,
            category: entry.category,
            is_active: entry.is_active,
            delivery_type: entry.delivery_type,
            stock_count: entry.stock_count,
            available_inventory_count: availableInventoryCount,
            sold_inventory_count: soldInventoryCount,
            reserve_inventory_count: reserveInventoryCount,
            fault_inventory_count: faultInventoryCount,
            units_sold: entry.units_sold,
            order_count: entry.order_count,
            refunded_order_count: entry.refunded_order_count,
            gmv_points: roundNumber(entry.gmv_points, 2),
            buyer_count: buyerCount,
            view_count: entry.view_count,
            view_user_count: viewUserCount,
            card_click_count: entry.card_click_count,
            card_click_user_count: entry.card_click_user_ids.size,
            detail_view_count: entry.detail_view_count,
            detail_view_user_count: entry.detail_viewer_ids.size,
            purchase_click_count: entry.purchase_click_count,
            purchase_click_user_count: entry.purchase_click_user_ids.size,
            event_purchase_count: entry.purchase_event_keys.size || entry.event_purchase_count,
            event_purchase_user_count: entry.purchase_success_user_ids.size,
            conversion_rate: conversionRate,
            avg_order_value: avgOrderValue,
            refund_rate: refundRate,
            delivery_risk_rate: deliveryRiskRate,
            delivery_success_count: entry.delivery_success_count,
            delivery_risk_count: entry.delivery_risk_count,
            delivery_success_rate: deliverySuccessRate,
            content_assisted_prompt_count: contentAssistedPromptCount,
            content_assisted_detail_view_count: contentAssistedDetailViewCount,
            content_assisted_purchase_click_count: contentAssistedPurchaseClickCount,
            content_assisted_purchase_success_count: contentAssistedPurchaseSuccessCount,
            content_assisted_gmv_points: contentAssistedGmvPoints,
            top_prompt_id: topPromptSource?.prompt_id || '',
            top_prompt_gmv_points: roundNumber(normalizeNumber(topPromptSource?.gmv_points, 0), 2),
            top_prompt_purchase_success_count: normalizeInteger(topPromptSource?.purchase_success_count, 0),
            related_prompt_ids: (promptSources.length > 0
                ? promptSources.map((row) => row.prompt_id)
                : Array.from(entry.recent_prompt_ids)
            ).slice(0, 5),
            source_pages: sourcePages,
            source_channels: sourceChannels,
            prompt_sources: promptSources,
            event_stage_summary: buildProductEventStageSummary(entry)
        };
    });
}

function buildProductUserValueSummary({ products = [], orders = [] } = {}) {
    const paidOrders = (Array.isArray(orders) ? orders : [])
        .filter((order) => !isRefundedOrder(order))
        .slice()
        .sort((left, right) => String(left?.created_at || '').localeCompare(String(right?.created_at || '')));
    const refundedOrders = (Array.isArray(orders) ? orders : [])
        .filter((order) => isRefundedOrder(order));
    const productNameById = new Map(
        (Array.isArray(products) ? products : []).map((row) => [
            normalizeText(row?.id, 160),
            normalizeText(row?.name, 200)
        ]).filter(([productId]) => productId)
    );
    const buyerMetrics = new Map();
    const paidOrderTimeline = new Map();

    paidOrders.forEach((order) => {
        const productId = normalizeText(order?.product_id, 160);
        const productName = normalizeText(order?.snapshot_product_name, 200);
        if (productId && productName && !productNameById.has(productId)) {
            productNameById.set(productId, productName);
        }
    });

    paidOrders.forEach((order) => {
        const userId = normalizeText(order?.user_id, 160);
        if (!userId) {
            return;
        }

        const productId = normalizeText(order?.product_id, 160);
        const bucket = buyerMetrics.get(userId) || {
            user_id: userId,
            paid_order_count: 0,
            refunded_order_count: 0,
            gmv_points: 0,
            product_ids: new Set(),
            first_paid_product_id: '',
            first_paid_at: '',
            last_paid_at: ''
        };

        bucket.paid_order_count += 1;
        bucket.gmv_points += getOrderRevenue(order);
        if (productId) {
            bucket.product_ids.add(productId);
            if (!bucket.first_paid_product_id) {
                bucket.first_paid_product_id = productId;
            }
        }

        const createdAt = String(order?.created_at || '').trim();
        if (createdAt && (!bucket.first_paid_at || createdAt < bucket.first_paid_at)) {
            bucket.first_paid_at = createdAt;
        }
        if (createdAt && (!bucket.last_paid_at || createdAt > bucket.last_paid_at)) {
            bucket.last_paid_at = createdAt;
        }

        buyerMetrics.set(userId, bucket);
        const timeline = paidOrderTimeline.get(userId) || [];
        timeline.push(order);
        paidOrderTimeline.set(userId, timeline);
    });

    refundedOrders.forEach((order) => {
        const userId = normalizeText(order?.user_id, 160);
        if (!userId || !buyerMetrics.has(userId)) {
            return;
        }

        const bucket = buyerMetrics.get(userId);
        bucket.refunded_order_count += 1;
        buyerMetrics.set(userId, bucket);
    });

    const segmentCounters = {
        first_order_buyers: 0,
        repeat_buyers: 0,
        cross_product_buyers: 0,
        refund_risk_buyers: 0
    };
    const buyerRows = Array.from(buyerMetrics.values()).map((row) => {
        const segmentLabels = ['首单成交'];
        segmentCounters.first_order_buyers += 1;

        if (normalizeInteger(row.paid_order_count, 0) >= 2) {
            segmentCounters.repeat_buyers += 1;
            segmentLabels.push('窗口复购');
        }
        if (row.product_ids instanceof Set && row.product_ids.size >= 2) {
            segmentCounters.cross_product_buyers += 1;
            segmentLabels.push('跨商品购买');
        }
        if (normalizeInteger(row.refunded_order_count, 0) > 0) {
            segmentCounters.refund_risk_buyers += 1;
            segmentLabels.push('退款风险');
        }

        return {
            user_id: row.user_id,
            order_count: normalizeInteger(row.paid_order_count, 0),
            gmv_points: roundNumber(row.gmv_points, 2),
            refunded_order_count: normalizeInteger(row.refunded_order_count, 0),
            total_window_product_count: row.product_ids instanceof Set ? row.product_ids.size : 0,
            first_paid_product_id: row.first_paid_product_id,
            first_paid_at: row.first_paid_at,
            last_paid_at: row.last_paid_at,
            segment_labels: segmentLabels
        };
    });
    const sortedBuyerRows = sortByNumeric(buyerRows, 'gmv_points');
    const buyerSnapshot = sortedBuyerRows.slice(0, 5);

    const segmentSampleKeys = {
        first_order_buyers: '首单成交',
        repeat_buyers: '窗口复购',
        cross_product_buyers: '跨商品购买',
        refund_risk_buyers: '退款风险'
    };
    const segmentSamples = Object.fromEntries(
        Object.keys(segmentSampleKeys).map((key) => [key, []])
    );
    sortedBuyerRows.forEach((row) => {
        Object.entries(segmentSampleKeys).forEach(([key, label]) => {
            if (!row.segment_labels.includes(label) || segmentSamples[key].length >= 3) {
                return;
            }
            segmentSamples[key].push({
                user_id: row.user_id,
                order_count: row.order_count,
                gmv_points: row.gmv_points,
                refunded_order_count: row.refunded_order_count
            });
        });
    });

    const buyerSegmentSummary = [
        {
            key: 'first_order_buyers',
            label: '首单成交',
            count: segmentCounters.first_order_buyers,
            tone: 'success',
            note: '当前窗口完成首笔有效订单的成交用户',
            sample_users: segmentSamples.first_order_buyers
        },
        {
            key: 'repeat_buyers',
            label: '窗口复购',
            count: segmentCounters.repeat_buyers,
            tone: 'warning',
            note: '当前窗口发生两笔及以上有效订单',
            sample_users: segmentSamples.repeat_buyers
        },
        {
            key: 'cross_product_buyers',
            label: '跨商品购买',
            count: segmentCounters.cross_product_buyers,
            tone: 'default',
            note: '当前窗口购买了两件及以上商品',
            sample_users: segmentSamples.cross_product_buyers
        },
        {
            key: 'refund_risk_buyers',
            label: '退款风险',
            count: segmentCounters.refund_risk_buyers,
            tone: 'danger',
            note: '当前窗口存在退款订单的成交用户',
            sample_users: segmentSamples.refund_risk_buyers
        }
    ];

    const firstPurchaseDestinationBuckets = new Map();
    buyerRows.forEach((row) => {
        const productId = normalizeText(row.first_paid_product_id, 160);
        if (!productId) {
            return;
        }

        const bucket = firstPurchaseDestinationBuckets.get(productId) || {
            product_id: productId,
            product_name: productNameById.get(productId) || `商品 ${productId}`,
            user_count: 0
        };
        bucket.user_count += 1;
        firstPurchaseDestinationBuckets.set(productId, bucket);
    });

    const firstPurchaseDestinations = Array.from(firstPurchaseDestinationBuckets.values())
        .sort((left, right) => {
            const userDiff = normalizeInteger(right.user_count, 0) - normalizeInteger(left.user_count, 0);
            if (userDiff !== 0) {
                return userDiff;
            }
            return String(left.product_id || '').localeCompare(String(right.product_id || ''));
        })
        .map((row) => ({
            product_id: row.product_id,
            product_name: row.product_name,
            user_count: normalizeInteger(row.user_count, 0)
        }));

    const postPurchaseDestinationBuckets = new Map();
    paidOrderTimeline.forEach((timeline, userId) => {
        timeline.slice(1).forEach((order) => {
            const productId = normalizeText(order?.product_id, 160);
            if (!productId) {
                return;
            }
            const bucket = postPurchaseDestinationBuckets.get(productId) || {
                product_id: productId,
                product_name: productNameById.get(productId) || normalizeText(order?.snapshot_product_name, 200) || `商品 ${productId}`,
                user_ids: new Set(),
                order_count: 0,
                gmv_points: 0
            };
            bucket.user_ids.add(userId);
            bucket.order_count += 1;
            bucket.gmv_points += getOrderRevenue(order);
            postPurchaseDestinationBuckets.set(productId, bucket);
        });
    });

    const postPurchaseDestinations = Array.from(postPurchaseDestinationBuckets.values())
        .sort((left, right) => {
            const userDiff = (right.user_ids instanceof Set ? right.user_ids.size : 0) - (left.user_ids instanceof Set ? left.user_ids.size : 0);
            if (userDiff !== 0) {
                return userDiff;
            }
            return String(left.product_id || '').localeCompare(String(right.product_id || ''));
        })
        .map((row) => ({
            product_id: row.product_id,
            product_name: row.product_name,
            user_count: row.user_ids instanceof Set ? row.user_ids.size : 0,
            order_count: normalizeInteger(row.order_count, 0),
            gmv_points: roundNumber(row.gmv_points, 2)
        }));

    return {
        buyer_snapshot: buyerSnapshot,
        buyer_segment_summary: buyerSegmentSummary,
        first_purchase_destinations: firstPurchaseDestinations,
        post_purchase_destinations: postPurchaseDestinations
    };
}

function buildProductSummaryPayload({ products = [], orders = [], events = [], inventory = [], site = 'all' } = {}) {
    const entries = buildProductMetricEntries({ products, orders, events, inventory, site });
    const activeProducts = entries.filter((entry) => entry.is_active);
    const sellingProducts = activeProducts.filter((entry) => entry.stock_count > 0);
    const lowStockProducts = activeProducts.filter((entry) => isInventoryManagedProduct(entry) && entry.stock_count > 0 && entry.stock_count <= DEFAULT_LOW_STOCK_THRESHOLD);
    const soldOutProducts = activeProducts.filter((entry) => isInventoryManagedProduct(entry) && entry.stock_count <= 0);

    const totalViewUsers = entries.reduce((sum, entry) => sum + entry.view_user_count, 0);
    const totalViewCount = entries.reduce((sum, entry) => sum + entry.view_count, 0);
    const totalCardClickUsers = entries.reduce((sum, entry) => sum + entry.card_click_user_count, 0);
    const totalCardClickCount = entries.reduce((sum, entry) => sum + entry.card_click_count, 0);
    const totalDetailViewUsers = entries.reduce((sum, entry) => sum + entry.detail_view_user_count, 0);
    const totalDetailViewCount = entries.reduce((sum, entry) => sum + entry.detail_view_count, 0);
    const totalPurchaseClickUsers = entries.reduce((sum, entry) => sum + entry.purchase_click_user_count, 0);
    const totalPurchaseClickCount = entries.reduce((sum, entry) => sum + entry.purchase_click_count, 0);
    const totalBuyers = entries.reduce((sum, entry) => sum + entry.buyer_count, 0);
    const totalOrders = entries.reduce((sum, entry) => sum + entry.order_count, 0);
    const totalRefundedOrders = entries.reduce((sum, entry) => sum + entry.refunded_order_count, 0);
    const totalUnits = entries.reduce((sum, entry) => sum + entry.units_sold, 0);
    const totalGmv = entries.reduce((sum, entry) => sum + entry.gmv_points, 0);
    const totalDeliverySuccess = entries.reduce((sum, entry) => sum + entry.delivery_success_count, 0);
    const totalDeliveryRisk = entries.reduce((sum, entry) => sum + entry.delivery_risk_count, 0);
    const topRevenueEntry = [...entries]
        .filter((entry) => normalizeNumber(entry?.gmv_points, 0) > 0)
        .sort((left, right) => normalizeNumber(right?.gmv_points, 0) - normalizeNumber(left?.gmv_points, 0))[0] || null;
    const userSignalMaps = {
        shop_view: new Map(),
        product_card_click: new Map(),
        product_detail_view: new Map(),
        product_purchase_click: new Map(),
        buyer: new Map()
    };

    (Array.isArray(events) ? events : []).forEach((event) => {
        const eventName = normalizeText(event?.event_name, 120).toLowerCase();
        if (!userSignalMaps[eventName]) {
            return;
        }
        const userId = normalizeText(event?.user_id, 160);
        if (!userId) {
            return;
        }
        const bucket = userSignalMaps[eventName].get(userId) || {
            user_id: userId,
            event_count: 0
        };
        bucket.event_count += 1;
        userSignalMaps[eventName].set(userId, bucket);
    });

    (Array.isArray(orders) ? orders : []).forEach((order) => {
        if (isRefundedOrder(order)) {
            return;
        }
        const userId = normalizeText(order?.user_id, 160);
        if (!userId) {
            return;
        }
        const bucket = userSignalMaps.buyer.get(userId) || {
            user_id: userId,
            order_count: 0,
            gmv_points: 0
        };
        bucket.order_count += 1;
        bucket.gmv_points += getOrderRevenue(order);
        userSignalMaps.buyer.set(userId, bucket);
    });

    const userSignalSamples = {
        shop_view: sortByNumeric(Array.from(userSignalMaps.shop_view.values()), 'event_count').slice(0, 4),
        product_card_click: sortByNumeric(Array.from(userSignalMaps.product_card_click.values()), 'event_count').slice(0, 4),
        product_detail_view: sortByNumeric(Array.from(userSignalMaps.product_detail_view.values()), 'event_count').slice(0, 4),
        product_purchase_click: sortByNumeric(Array.from(userSignalMaps.product_purchase_click.values()), 'event_count').slice(0, 4),
        buyer: sortByNumeric(Array.from(userSignalMaps.buyer.values()), 'gmv_points').slice(0, 4).map((row) => ({
            ...row,
            gmv_points: roundNumber(row.gmv_points, 2)
        }))
    };
    const userValueSummary = buildProductUserValueSummary({ products, orders });

    return {
        active_product_count: activeProducts.length,
        selling_product_count: sellingProducts.length,
        product_with_sales_count: entries.filter((entry) => entry.units_sold > 0).length,
        unique_buyer_count: totalBuyers,
        view_user_count: totalViewUsers,
        view_count: totalViewCount,
        card_click_user_count: totalCardClickUsers,
        card_click_count: totalCardClickCount,
        detail_view_user_count: totalDetailViewUsers,
        detail_view_count: totalDetailViewCount,
        purchase_click_user_count: totalPurchaseClickUsers,
        purchase_click_count: totalPurchaseClickCount,
        order_count: totalOrders,
        refunded_order_count: totalRefundedOrders,
        units_sold: totalUnits,
        gmv_points: roundNumber(totalGmv, 2),
        avg_order_value: totalOrders > 0 ? roundNumber(totalGmv / totalOrders, 2) : 0,
        purchase_conversion_rate: totalViewUsers > 0 ? roundNumber((totalBuyers / totalViewUsers) * 100, 2) : 0,
        delivery_success_rate: totalOrders > 0 ? roundNumber((totalDeliverySuccess / totalOrders) * 100, 2) : 0,
        refund_rate: totalOrders + totalRefundedOrders > 0
            ? roundNumber((totalRefundedOrders / (totalOrders + totalRefundedOrders)) * 100, 2)
            : 0,
        low_stock_product_count: lowStockProducts.length,
        sold_out_product_count: soldOutProducts.length,
        delivery_risk_product_count: entries.filter((entry) => entry.delivery_risk_count > 0).length,
        top_product_name: topRevenueEntry?.product_name || '',
        user_signal_samples: userSignalSamples,
        buyer_snapshot: userValueSummary.buyer_snapshot,
        buyer_segment_summary: userValueSummary.buyer_segment_summary,
        first_purchase_destinations: userValueSummary.first_purchase_destinations,
        post_purchase_destinations: userValueSummary.post_purchase_destinations,
        metric_basis: 'shop_products + shop_orders + shop_inventory + user_events'
    };
}

function buildProductTrendPayload({ orders = [], events = [], startIso = '', endIso = '' } = {}) {
    const startKey = toDayKey(startIso);
    const endKey = toDayKey(endIso);
    const buckets = new Map();
    const buyerSets = new Map();
    const viewerSets = new Map();

    function ensureBucket(dayKey) {
        if (!dayKey) return null;
        if (!buckets.has(dayKey)) {
            buckets.set(dayKey, {
                day: dayKey,
                order_count: 0,
                units_sold: 0,
                gmv_points: 0,
                refund_count: 0,
                delivery_success_count: 0,
                view_count: 0
            });
            buyerSets.set(dayKey, new Set());
            viewerSets.set(dayKey, new Set());
        }
        return buckets.get(dayKey);
    }

    (Array.isArray(orders) ? orders : []).forEach((order) => {
        const dayKey = toDayKey(order?.created_at);
        const bucket = ensureBucket(dayKey);
        if (!bucket) return;

        if (isRefundedOrder(order)) {
            bucket.refund_count += 1;
            return;
        }

        bucket.order_count += 1;
        bucket.units_sold += getOrderQuantity(order);
        bucket.gmv_points += getOrderRevenue(order);
        if (isDeliverySuccessStatus(order?.delivery_status)) {
            bucket.delivery_success_count += 1;
        }
        const userId = normalizeText(order?.user_id, 160);
        if (userId) {
            buyerSets.get(dayKey).add(userId);
        }
    });

    (Array.isArray(events) ? events : []).forEach((row) => {
        const dayKey = toDayKey(row?.created_at);
        const bucket = ensureBucket(dayKey);
        if (!bucket) return;

        if (normalizeText(row?.event_name, 120).toLowerCase() === 'shop_view') {
            bucket.view_count += 1;
            const userId = normalizeText(row?.user_id, 160);
            if (userId) {
                viewerSets.get(dayKey).add(userId);
            }
        }
    });

    return Array.from(buckets.values())
        .filter((row) => (!startKey || row.day >= startKey) && (!endKey || row.day <= endKey))
        .sort((left, right) => left.day.localeCompare(right.day))
        .map((row) => ({
            day: row.day,
            order_count: row.order_count,
            units_sold: row.units_sold,
            gmv_points: roundNumber(row.gmv_points, 2),
            refund_count: row.refund_count,
            delivery_success_count: row.delivery_success_count,
            view_count: row.view_count,
            buyer_count: buyerSets.get(row.day)?.size || 0,
            view_user_count: viewerSets.get(row.day)?.size || 0
        }));
}

function buildProductSiteComparisonPayload({ products = [], orders = [], events = [], inventory = [], activeSite = 'all' } = {}) {
    const snapshots = ['cn', 'intl'].map((site) => ({
        site,
        label: site === 'intl' ? 'INTL' : 'CN',
        summary: buildProductSummaryPayload({ products, orders: orders.filter((row) => normalizeSite(row?.site) === site), events: events.filter((row) => normalizeSite(row?.site) === site), inventory, site })
    }));

    return {
        mode: activeSite === 'all' ? 'comparison' : 'focused',
        active_site: normalizeSite(activeSite),
        snapshots
    };
}

function buildProductCategoryBreakdownPayload({ products = [], orders = [], events = [], inventory = [], site = 'all', limit = 6 } = {}) {
    const entries = buildProductMetricEntries({ products, orders, events, inventory, site });
    const safeLimit = Math.max(1, normalizeInteger(limit, 6));
    const bucketMap = new Map();
    const totalGmv = entries.reduce((sum, entry) => sum + normalizeNumber(entry?.gmv_points, 0), 0);

    entries.forEach((entry) => {
        const category = normalizeText(entry?.category, 120) || '未分类';
        const bucket = bucketMap.get(category) || {
            category,
            product_count: 0,
            active_product_count: 0,
            order_count: 0,
            refunded_order_count: 0,
            units_sold: 0,
            buyer_count: 0,
            view_user_count: 0,
            gmv_points: 0,
            delivery_risk_count: 0
        };

        bucket.product_count += 1;
        if (entry?.is_active !== false) {
            bucket.active_product_count += 1;
        }
        bucket.order_count += normalizeInteger(entry?.order_count, 0);
        bucket.refunded_order_count += normalizeInteger(entry?.refunded_order_count, 0);
        bucket.units_sold += normalizeInteger(entry?.units_sold, 0);
        bucket.buyer_count += normalizeInteger(entry?.buyer_count, 0);
        bucket.view_user_count += normalizeInteger(entry?.view_user_count, 0);
        bucket.gmv_points += normalizeNumber(entry?.gmv_points, 0);
        bucket.delivery_risk_count += normalizeInteger(entry?.delivery_risk_count, 0);
        bucketMap.set(category, bucket);
    });

    const rows = Array.from(bucketMap.values())
        .map((bucket) => ({
            category: bucket.category,
            product_count: bucket.product_count,
            active_product_count: bucket.active_product_count,
            order_count: bucket.order_count,
            refunded_order_count: bucket.refunded_order_count,
            units_sold: bucket.units_sold,
            buyer_count: bucket.buyer_count,
            view_user_count: bucket.view_user_count,
            gmv_points: roundNumber(bucket.gmv_points, 2),
            gmv_share_rate: totalGmv > 0 ? roundNumber((bucket.gmv_points / totalGmv) * 100, 2) : 0,
            conversion_rate: bucket.view_user_count > 0 ? roundNumber((bucket.buyer_count / bucket.view_user_count) * 100, 2) : 0,
            refund_rate: bucket.order_count + bucket.refunded_order_count > 0
                ? roundNumber((bucket.refunded_order_count / (bucket.order_count + bucket.refunded_order_count)) * 100, 2)
                : 0,
            delivery_risk_rate: bucket.order_count > 0 ? roundNumber((bucket.delivery_risk_count / bucket.order_count) * 100, 2) : 0
        }))
        .sort((left, right) => (
            normalizeNumber(right.gmv_points, 0) - normalizeNumber(left.gmv_points, 0)
            || right.order_count - left.order_count
            || right.product_count - left.product_count
            || String(left.category || '').localeCompare(String(right.category || ''), 'zh-CN')
        ));

    const visibleRows = rows.slice(0, safeLimit);
    if (rows.length > safeLimit) {
        const remainingRows = rows.slice(safeLimit);
        const otherRow = remainingRows.reduce((aggregate, row) => ({
            category: '其他分类',
            product_count: aggregate.product_count + normalizeInteger(row?.product_count, 0),
            active_product_count: aggregate.active_product_count + normalizeInteger(row?.active_product_count, 0),
            order_count: aggregate.order_count + normalizeInteger(row?.order_count, 0),
            refunded_order_count: aggregate.refunded_order_count + normalizeInteger(row?.refunded_order_count, 0),
            units_sold: aggregate.units_sold + normalizeInteger(row?.units_sold, 0),
            buyer_count: aggregate.buyer_count + normalizeInteger(row?.buyer_count, 0),
            view_user_count: aggregate.view_user_count + normalizeInteger(row?.view_user_count, 0),
            gmv_points: aggregate.gmv_points + normalizeNumber(row?.gmv_points, 0),
            gmv_share_rate: aggregate.gmv_share_rate + normalizeNumber(row?.gmv_share_rate, 0),
            conversion_rate: 0,
            refund_rate: 0,
            delivery_risk_rate: 0
        }), {
            category: '其他分类',
            product_count: 0,
            active_product_count: 0,
            order_count: 0,
            refunded_order_count: 0,
            units_sold: 0,
            buyer_count: 0,
            view_user_count: 0,
            gmv_points: 0,
            gmv_share_rate: 0,
            conversion_rate: 0,
            refund_rate: 0,
            delivery_risk_rate: 0
        });

        otherRow.gmv_points = roundNumber(otherRow.gmv_points, 2);
        otherRow.gmv_share_rate = roundNumber(otherRow.gmv_share_rate, 2);
        otherRow.conversion_rate = otherRow.view_user_count > 0 ? roundNumber((otherRow.buyer_count / otherRow.view_user_count) * 100, 2) : 0;
        otherRow.refund_rate = otherRow.order_count + otherRow.refunded_order_count > 0
            ? roundNumber((otherRow.refunded_order_count / (otherRow.order_count + otherRow.refunded_order_count)) * 100, 2)
            : 0;
        otherRow.delivery_risk_rate = otherRow.order_count > 0
            ? roundNumber((remainingRows.reduce((sum, row) => sum + normalizeNumber(row?.delivery_risk_rate, 0) * normalizeInteger(row?.order_count, 0), 0) / otherRow.order_count), 2)
            : 0;
        visibleRows.push(otherRow);
    }

    return {
        total_category_count: rows.length,
        total_gmv_points: roundNumber(totalGmv, 2),
        rows: visibleRows,
        metric_basis: 'shop_products + shop_orders + shop_inventory + user_events'
    };
}

function getMedianValue(values = []) {
    const normalized = (Array.isArray(values) ? values : [])
        .map((value) => normalizeNumber(value, 0))
        .filter((value) => value > 0)
        .sort((left, right) => left - right);

    if (normalized.length === 0) {
        return 0;
    }

    const middleIndex = Math.floor(normalized.length / 2);
    if (normalized.length % 2 === 1) {
        return normalized[middleIndex];
    }
    return roundNumber((normalized[middleIndex - 1] + normalized[middleIndex]) / 2, 2);
}

function getProductOperatingQuadrant(entry = {}, benchmarks = {}) {
    const exposure = normalizeNumber(entry?.view_user_count, 0);
    const conversion = normalizeNumber(entry?.conversion_rate, 0);
    const exposureBenchmark = Math.max(1, normalizeNumber(benchmarks?.exposure_midpoint, 0));
    const conversionBenchmark = normalizeNumber(benchmarks?.conversion_midpoint, 0);
    const highExposure = exposure >= exposureBenchmark;
    const highConversion = conversion >= conversionBenchmark;

    if (highExposure && highConversion) {
        return { key: 'star', label: '明星成交', tone: 'success' };
    }
    if (highExposure && !highConversion) {
        return { key: 'conversion_gap', label: '高曝光待转化', tone: 'warning' };
    }
    if (!highExposure && highConversion) {
        return { key: 'potential', label: '潜力补量', tone: 'accent' };
    }
    return { key: 'observe', label: '低动销观察', tone: 'neutral' };
}

function buildProductOperatingMatrixPayload({ products = [], orders = [], events = [], inventory = [], site = 'all', limit = 12 } = {}) {
    const entries = buildProductMetricEntries({ products, orders, events, inventory, site })
        .filter((entry) => (
            normalizeInteger(entry?.view_user_count, 0) > 0
            || normalizeInteger(entry?.buyer_count, 0) > 0
            || normalizeNumber(entry?.gmv_points, 0) > 0
            || normalizeInteger(entry?.order_count, 0) > 0
        ));
    const safeLimit = Math.max(1, normalizeInteger(limit, 12));
    const maxGmv = entries.reduce((maxValue, entry) => Math.max(maxValue, normalizeNumber(entry?.gmv_points, 0)), 0);
    const benchmarks = {
        exposure_midpoint: getMedianValue(entries.map((entry) => entry.view_user_count)),
        conversion_midpoint: getMedianValue(entries.map((entry) => entry.conversion_rate)),
        gmv_midpoint: getMedianValue(entries.map((entry) => entry.gmv_points))
    };

    const items = entries
        .map((entry) => {
            const quadrant = getProductOperatingQuadrant(entry, benchmarks);
            const gmvPoints = normalizeNumber(entry?.gmv_points, 0);
            return {
                product_id: entry.product_id,
                product_name: entry.product_name,
                category: entry.category,
                view_user_count: normalizeInteger(entry?.view_user_count, 0),
                buyer_count: normalizeInteger(entry?.buyer_count, 0),
                order_count: normalizeInteger(entry?.order_count, 0),
                units_sold: normalizeInteger(entry?.units_sold, 0),
                conversion_rate: normalizeNumber(entry?.conversion_rate, 0),
                refund_rate: normalizeNumber(entry?.refund_rate, 0),
                delivery_risk_rate: normalizeNumber(entry?.delivery_risk_rate, 0),
                gmv_points: roundNumber(gmvPoints, 2),
                quadrant_key: quadrant.key,
                quadrant_label: quadrant.label,
                tone: quadrant.tone,
                bubble_size: maxGmv > 0 ? roundNumber(10 + ((gmvPoints / maxGmv) * 16), 2) : 10
            };
        })
        .sort((left, right) => (
            normalizeNumber(right.gmv_points, 0) - normalizeNumber(left.gmv_points, 0)
            || right.view_user_count - left.view_user_count
            || right.order_count - left.order_count
            || String(left.product_name || '').localeCompare(String(right.product_name || ''), 'zh-CN')
        ))
        .slice(0, safeLimit);

    const quadrantSummaryMap = new Map();
    items.forEach((item) => {
        const bucket = quadrantSummaryMap.get(item.quadrant_key) || {
            key: item.quadrant_key,
            label: item.quadrant_label,
            tone: item.tone,
            count: 0
        };
        bucket.count += 1;
        quadrantSummaryMap.set(item.quadrant_key, bucket);
    });

    return {
        benchmark: benchmarks,
        quadrant_summary: Array.from(quadrantSummaryMap.values()).sort((left, right) => right.count - left.count),
        items,
        metric_basis: 'shop_products + shop_orders + shop_inventory + user_events'
    };
}

function sortByNumeric(rows = [], key = '', direction = 'desc') {
    const safeRows = Array.isArray(rows) ? [...rows] : [];
    safeRows.sort((left, right) => {
        const diff = normalizeNumber(right?.[key], 0) - normalizeNumber(left?.[key], 0);
        if (direction === 'asc') {
            return -diff || normalizeText(left?.product_name).localeCompare(normalizeText(right?.product_name), 'zh-CN');
        }
        return diff || normalizeText(left?.product_name).localeCompare(normalizeText(right?.product_name), 'zh-CN');
    });
    return safeRows;
}

function buildProductRankPayloads({ products = [], orders = [], events = [], inventory = [], site = 'all', limit = DEFAULT_PRODUCT_RANK_LIMIT } = {}) {
    const entries = buildProductMetricEntries({ products, orders, events, inventory, site });
    const safeLimit = Math.max(1, normalizeInteger(limit, DEFAULT_PRODUCT_RANK_LIMIT));

    return {
        salesTop: sortByNumeric(entries.filter((entry) => entry.units_sold > 0), 'units_sold').slice(0, safeLimit),
        gmvTop: sortByNumeric(entries.filter((entry) => entry.gmv_points > 0), 'gmv_points').slice(0, safeLimit),
        conversionTop: sortByNumeric(entries.filter((entry) => entry.view_user_count > 0 && entry.buyer_count > 0), 'conversion_rate').slice(0, safeLimit),
        refundRateTop: sortByNumeric(
            entries.filter((entry) => entry.refunded_order_count > 0 && entry.refund_rate > 0),
            'refund_rate'
        ).slice(0, safeLimit),
        deliveryRiskRateTop: sortByNumeric(
            entries.filter((entry) => entry.delivery_risk_count > 0 && entry.delivery_risk_rate > 0),
            'delivery_risk_rate'
        ).slice(0, safeLimit),
        contentDrivenTop: sortByNumeric(
            entries.filter((entry) => entry.content_assisted_prompt_count > 0 && (
                entry.content_assisted_gmv_points > 0
                || entry.content_assisted_purchase_success_count > 0
                || entry.content_assisted_purchase_click_count > 0
                || entry.content_assisted_detail_view_count > 0
            )),
            'content_assisted_gmv_points'
        ).slice(0, safeLimit),
        highExposureLowConversion: sortByNumeric(
            entries
                .filter((entry) => entry.view_user_count > 0)
                .map((entry) => ({
                    ...entry,
                    low_conversion_score: roundNumber(entry.view_user_count * (1 - (entry.conversion_rate / 100)), 2)
                }))
                .filter((entry) => entry.conversion_rate < 35),
            'low_conversion_score'
        ).slice(0, safeLimit)
    };
}

function buildInventoryTurnoverHints(entries = []) {
    const hints = [];
    const lowStockWithDemand = sortByNumeric(
        entries.filter((entry) => entry.stock_count > 0 && entry.stock_count <= DEFAULT_LOW_STOCK_THRESHOLD && entry.units_sold > 0),
        'units_sold'
    )[0];
    if (lowStockWithDemand) {
        hints.push({
            tone: 'warning',
            title: `${lowStockWithDemand.product_name} 库存偏低`,
            summary: `当前库存 ${lowStockWithDemand.stock_count}，窗口内已售 ${lowStockWithDemand.units_sold} 件，建议尽快补货或限制曝光。`,
            product_id: lowStockWithDemand.product_id
        });
    }

    const soldOutHot = sortByNumeric(
        entries.filter((entry) => entry.stock_count <= 0 && entry.units_sold > 0),
        'units_sold'
    )[0];
    if (soldOutHot) {
        hints.push({
            tone: 'danger',
            title: `${soldOutHot.product_name} 已售罄`,
            summary: `窗口内仍有 ${soldOutHot.units_sold} 件成交记录，建议检查库存恢复与站点可售状态。`,
            product_id: soldOutHot.product_id
        });
    }

    const deliveryRisk = sortByNumeric(entries.filter((entry) => entry.delivery_risk_count > 0), 'delivery_risk_count')[0];
    if (deliveryRisk) {
        hints.push({
            tone: 'warning',
            title: `${deliveryRisk.product_name} 履约风险偏高`,
            summary: `当前有 ${deliveryRisk.delivery_risk_count} 笔履约风险订单，建议联动 API 履约和订单处理排查。`,
            product_id: deliveryRisk.product_id
        });
    }

    return hints;
}

function buildProductHealthPayloads({ products = [], orders = [], events = [], inventory = [], site = 'all', limit = DEFAULT_PRODUCT_RANK_LIMIT } = {}) {
    const entries = buildProductMetricEntries({ products, orders, events, inventory, site });
    const safeLimit = Math.max(1, normalizeInteger(limit, DEFAULT_PRODUCT_RANK_LIMIT));

    return {
        lowStockProducts: sortByNumeric(
            entries.filter((entry) => entry.is_active && isInventoryManagedProduct(entry) && entry.stock_count > 0 && entry.stock_count <= DEFAULT_LOW_STOCK_THRESHOLD),
            'stock_count',
            'asc'
        ).slice(0, safeLimit),
        soldOutProducts: sortByNumeric(
            entries.filter((entry) => entry.is_active && isInventoryManagedProduct(entry) && entry.stock_count <= 0),
            'units_sold'
        ).slice(0, safeLimit),
        deliveryRiskProducts: sortByNumeric(
            entries.filter((entry) => entry.delivery_risk_count > 0),
            'delivery_risk_count'
        ).slice(0, safeLimit),
        refundRiskProducts: sortByNumeric(
            entries.filter((entry) => entry.refunded_order_count > 0),
            'refunded_order_count'
        ).slice(0, safeLimit),
        inventoryTurnoverHints: buildInventoryTurnoverHints(entries).slice(0, safeLimit)
    };
}

function buildProductFunnelStageSummary({ orders = [], events = [], productId = '' } = {}) {
    const normalizedProductId = normalizeText(productId, 160);
    const cardClickUsers = new Set();
    const detailViewUsers = new Set();
    const legacyViewUsers = new Set();
    const purchaseClickUsers = new Set();
    const buyerUsers = new Set();
    const deliveredUsers = new Set();
    const refundedUsers = new Set();
    let paidOrderCount = 0;
    let deliveredOrderCount = 0;
    let refundedOrderCount = 0;
    let deliveryRiskCount = 0;

    (Array.isArray(events) ? events : []).forEach((row) => {
        if (normalizedProductId && getEventProductId(row) !== normalizedProductId) {
            return;
        }

        const eventName = normalizeText(row?.event_name, 120).toLowerCase();
        const userId = normalizeText(row?.user_id, 160);
        if (!userId) {
            return;
        }

        if (eventName === 'product_card_click') {
            cardClickUsers.add(userId);
            return;
        }

        if (eventName === 'product_detail_view') {
            detailViewUsers.add(userId);
            return;
        }

        if (eventName === 'shop_view') {
            legacyViewUsers.add(userId);
            return;
        }

        if (eventName === 'product_purchase_click') {
            purchaseClickUsers.add(userId);
        }
    });

    (Array.isArray(orders) ? orders : []).forEach((order) => {
        if (normalizedProductId && normalizeText(order?.product_id, 160) !== normalizedProductId) {
            return;
        }

        const userId = normalizeText(order?.user_id, 160);
        const refunded = isRefundedOrder(order);
        const deliveryStatus = normalizeDeliveryStatus(order?.delivery_status);

        if (refunded) {
            refundedOrderCount += 1;
            if (userId) {
                refundedUsers.add(userId);
            }
            return;
        }

        paidOrderCount += 1;
        if (userId) {
            buyerUsers.add(userId);
        }

        if (isDeliverySuccessStatus(deliveryStatus)) {
            deliveredOrderCount += 1;
            if (userId) {
                deliveredUsers.add(userId);
            }
        } else if (isDeliveryRiskStatus(deliveryStatus)) {
            deliveryRiskCount += 1;
        }
    });

    const purchaseIntentUsers = new Set([...purchaseClickUsers, ...buyerUsers]);
    const detailStageUsers = new Set([...detailViewUsers, ...legacyViewUsers]);
    if (detailStageUsers.size === 0 && purchaseIntentUsers.size > 0) {
        purchaseIntentUsers.forEach((userId) => detailStageUsers.add(userId));
    }
    const detailStageBasis = detailViewUsers.size > 0
        ? (legacyViewUsers.size > 0
            ? {
                basis_type: 'legacy',
                basis_label: '新版 + 兼容',
                note: 'product_detail_view + shop_view'
            }
            : {
                basis_type: 'real',
                basis_label: '新版埋点',
                note: 'user_events.product_detail_view'
            })
        : (legacyViewUsers.size > 0
            ? {
                basis_type: 'legacy',
                basis_label: '兼容旧埋点',
                note: 'user_events.shop_view'
            }
            : {
                basis_type: 'warning',
                basis_label: '支付兜底',
                note: '按支付成功用户回推意向'
            });
    const purchaseIntentBasis = purchaseClickUsers.size > 0
        ? {
            basis_type: 'real',
            basis_label: '新版埋点',
            note: 'user_events.product_purchase_click'
        }
        : (buyerUsers.size > 0
            ? {
                basis_type: 'legacy',
                basis_label: '订单兜底',
                note: '缺少点击事件时按支付成功用户兼容'
            }
            : {
                basis_type: 'warning',
                basis_label: '开始采集中',
                note: '当前窗口暂无购买意图样本'
            });

    const purchaseConversionRate = detailStageUsers.size > 0
        ? roundNumber((buyerUsers.size / detailStageUsers.size) * 100, 2)
        : 0;
    const deliverySuccessRate = buyerUsers.size > 0
        ? roundNumber((deliveredUsers.size / buyerUsers.size) * 100, 2)
        : 0;
    const refundRate = paidOrderCount + refundedOrderCount > 0
        ? roundNumber((refundedOrderCount / (paidOrderCount + refundedOrderCount)) * 100, 2)
        : 0;
    const detailToIntentRate = detailStageUsers.size > 0
        ? roundNumber((purchaseIntentUsers.size / detailStageUsers.size) * 100, 2)
        : 0;
    const intentToPaidRate = purchaseIntentUsers.size > 0
        ? roundNumber((buyerUsers.size / purchaseIntentUsers.size) * 100, 2)
        : 0;
    const cardClickUserCount = cardClickUsers.size;
    const detailStageUserCount = detailStageUsers.size;
    const purchaseIntentUserCount = purchaseIntentUsers.size;

    return {
        stage_mode: 'detail_to_delivery',
        proxy_stage_count: detailStageBasis.basis_type === 'real' && purchaseIntentBasis.basis_type === 'real'
            ? 0
            : Number(detailStageBasis.basis_type !== 'real') + Number(purchaseIntentBasis.basis_type !== 'real'),
        metric_basis: 'user_events.product_* + shop_orders',
        notice: '当前漏斗按详情浏览、购买意图、支付成功、发货成功主链展示；详情浏览优先用新版埋点，缺失时回退到兼容口径。',
        stages: [
            {
                key: 'detail_stage_users',
                label: normalizedProductId ? '商品详情浏览' : '详情浏览用户',
                value: detailStageUserCount,
                basis_type: detailStageBasis.basis_type,
                basis_label: detailStageBasis.basis_label,
                note: detailStageBasis.note
            },
            {
                key: 'purchase_intent_users',
                label: '购买意图',
                value: purchaseIntentUserCount,
                basis_type: purchaseIntentBasis.basis_type,
                basis_label: purchaseIntentBasis.basis_label,
                note: purchaseIntentBasis.note
            },
            {
                key: 'paid_users',
                label: '支付成功用户',
                value: buyerUsers.size,
                basis_type: 'real',
                basis_label: '真实订单',
                note: 'shop_orders（排除退款）'
            },
            {
                key: 'delivered_users',
                label: '发货成功用户',
                value: deliveredUsers.size,
                basis_type: 'real',
                basis_label: '真实履约',
                note: 'shop_orders.delivery_status=delivered'
            },
            {
                key: 'refunded_users',
                label: '退款用户',
                value: refundedUsers.size,
                basis_type: 'real',
                basis_label: '真实售后',
                note: 'shop_orders.refund_status'
            }
        ],
        card_click_user_count: cardClickUserCount,
        detail_view_user_count: detailStageUserCount,
        purchase_click_user_count: purchaseIntentUserCount,
        paid_order_count: paidOrderCount,
        delivered_order_count: deliveredOrderCount,
        refunded_order_count: refundedOrderCount,
        delivery_risk_count: deliveryRiskCount,
        purchase_conversion_rate: purchaseConversionRate,
        detail_to_intent_rate: detailToIntentRate,
        intent_to_paid_rate: intentToPaidRate,
        delivery_success_rate: deliverySuccessRate,
        refund_rate: refundRate
    };
}

function buildProductFunnelProductRows(entries = [], limit = 6) {
    const safeLimit = Math.max(1, normalizeInteger(limit, 6));
    return sortByNumeric(
        (Array.isArray(entries) ? entries : [])
            .filter((entry) => entry.view_user_count > 0 || entry.order_count > 0 || entry.refunded_order_count > 0)
            .map((entry) => ({
                product_id: entry.product_id,
                product_name: entry.product_name,
                category: entry.category,
                card_click_user_count: entry.card_click_user_count,
                detail_view_user_count: entry.detail_view_user_count || entry.view_user_count,
                detail_stage_basis: entry.detail_view_user_count > 0 ? 'real' : (entry.view_user_count > 0 ? 'legacy' : 'collecting'),
                purchase_click_user_count: Math.max(entry.purchase_click_user_count || 0, entry.buyer_count || 0),
                view_user_count: entry.view_user_count,
                buyer_count: entry.buyer_count,
                order_count: entry.order_count,
                delivery_success_count: entry.delivery_success_count,
                refunded_order_count: entry.refunded_order_count,
                delivery_risk_count: entry.delivery_risk_count,
                purchase_conversion_rate: entry.conversion_rate,
                detail_to_intent_rate: (Math.max(entry.purchase_click_user_count || 0, entry.buyer_count || 0) > 0 && (entry.detail_view_user_count || entry.view_user_count || 0) > 0)
                    ? roundNumber((Math.max(entry.purchase_click_user_count || 0, entry.buyer_count || 0) / Math.max(entry.detail_view_user_count || entry.view_user_count || 0, 1)) * 100, 2)
                    : 0,
                intent_to_paid_rate: Math.max(entry.purchase_click_user_count || 0, entry.buyer_count || 0) > 0
                    ? roundNumber((entry.buyer_count / Math.max(entry.purchase_click_user_count || 0, entry.buyer_count || 0)) * 100, 2)
                    : 0,
                delivery_success_rate: entry.delivery_success_rate,
                refund_rate: entry.refund_rate
            })),
        'detail_view_user_count'
    ).slice(0, safeLimit);
}

function buildProductFunnelPayload({ products = [], orders = [], events = [], inventory = [], site = 'all', limit = 6, productId = '' } = {}) {
    const normalizedSite = normalizeSite(site);
    const normalizedProductId = normalizeText(productId, 160);
    const entries = buildProductMetricEntries({ products, orders, events, inventory, site: normalizedSite });
    const filteredEntries = normalizedProductId
        ? entries.filter((entry) => entry.product_id === normalizedProductId)
        : entries;
    const entry = normalizedProductId
        ? filteredEntries[0] || null
        : null;
    const summary = buildProductFunnelStageSummary({
        orders,
        events,
        productId: normalizedProductId
    });
    const compareSites = normalizedSite === 'all' ? ['cn', 'intl'] : [normalizedSite];
    const siteComparison = {
        mode: normalizedSite === 'all' ? 'comparison' : 'focused',
        active_site: normalizedSite,
        snapshots: compareSites.map((siteKey) => ({
            site: siteKey,
            label: siteKey === 'intl' ? 'INTL' : 'CN',
            summary: buildProductFunnelStageSummary({
                orders: (Array.isArray(orders) ? orders : []).filter((row) => normalizeSite(row?.site) === siteKey),
                events: (Array.isArray(events) ? events : []).filter((row) => normalizeSite(row?.site) === siteKey),
                productId: normalizedProductId
            })
        }))
    };

    return {
        summary: {
            ...summary,
            product_id: normalizedProductId || '',
            product_name: entry?.product_name || '',
            category: entry?.category || '',
            purchase_conversion_rate: entry?.conversion_rate ?? summary.purchase_conversion_rate,
            delivery_success_rate: entry?.delivery_success_rate ?? summary.delivery_success_rate,
            refund_rate: entry?.refund_rate ?? summary.refund_rate
        },
        siteComparison,
        productRows: normalizedProductId ? [] : buildProductFunnelProductRows(filteredEntries, limit)
    };
}

function buildProductDetailPayload({ products = [], orders = [], events = [], inventory = [], site = 'all', productId = '', startIso = '', endIso = '', recentOrderLimit = 6 } = {}) {
    const normalizedProductId = normalizeText(productId, 160);
    if (!normalizedProductId) {
        return null;
    }

    const entries = buildProductMetricEntries({ products, orders, events, inventory, site });
    const entry = entries.find((item) => item.product_id === normalizedProductId) || null;
    if (!entry) {
        return null;
    }

    const productOrders = (Array.isArray(orders) ? orders : [])
        .filter((row) => normalizeText(row?.product_id, 160) === normalizedProductId)
        .sort((left, right) => String(right?.created_at || '').localeCompare(String(left?.created_at || '')));
    const productEvents = (Array.isArray(events) ? events : [])
        .filter((row) => getEventProductId(row) === normalizedProductId)
        .sort((left, right) => String(right?.created_at || '').localeCompare(String(left?.created_at || '')));

    const windowBuyerMetrics = new Map();
    (Array.isArray(orders) ? orders : []).forEach((order) => {
        const userId = normalizeText(order?.user_id, 160);
        if (!userId) {
            return;
        }

        const bucket = windowBuyerMetrics.get(userId) || {
            user_id: userId,
            paid_order_count: 0,
            refunded_order_count: 0,
            product_ids: new Set(),
            first_paid_product_id: '',
            first_paid_product_name: '',
            first_paid_at: ''
        };

        if (isRefundedOrder(order)) {
            bucket.refunded_order_count += 1;
            windowBuyerMetrics.set(userId, bucket);
            return;
        }

        const orderProductId = normalizeText(order?.product_id, 160);
        bucket.paid_order_count += 1;
        if (orderProductId) {
            bucket.product_ids.add(orderProductId);
        }

        const createdAt = String(order?.created_at || '');
        if (!bucket.first_paid_at || (createdAt && createdAt < bucket.first_paid_at)) {
            bucket.first_paid_at = createdAt;
            bucket.first_paid_product_id = orderProductId;
            bucket.first_paid_product_name = normalizeText(order?.snapshot_product_name, 200);
        }

        windowBuyerMetrics.set(userId, bucket);
    });

    const buyerBuckets = new Map();
    productOrders.forEach((order) => {
        if (isRefundedOrder(order)) {
            return;
        }

        const userId = normalizeText(order?.user_id, 160);
        if (!userId) {
            return;
        }

        const bucket = buyerBuckets.get(userId) || {
            user_id: userId,
            order_count: 0,
            units_sold: 0,
            gmv_points: 0,
            last_order_at: ''
        };
        bucket.order_count += 1;
        bucket.units_sold += getOrderQuantity(order);
        bucket.gmv_points += getOrderRevenue(order);
        bucket.last_order_at = bucket.last_order_at && bucket.last_order_at > String(order?.created_at || '')
            ? bucket.last_order_at
            : String(order?.created_at || '');
        buyerBuckets.set(userId, bucket);
    });

    const buyerSegmentSummaryCounters = {
        first_product_buyers: 0,
        repeat_buyers: 0,
        cross_product_buyers: 0,
        refund_risk_buyers: 0
    };

    const buyerSnapshot = sortByNumeric(Array.from(buyerBuckets.values()), 'gmv_points').slice(0, 5).map((row) => {
        const userMetrics = windowBuyerMetrics.get(row.user_id) || {
            paid_order_count: row.order_count,
            refunded_order_count: 0,
            product_ids: new Set([normalizedProductId]),
            first_paid_product_id: normalizedProductId
        };

        const segmentLabels = [];
        if (userMetrics.first_paid_product_id === normalizedProductId) {
            buyerSegmentSummaryCounters.first_product_buyers += 1;
            segmentLabels.push('本商品首购');
        }
        if (normalizeInteger(userMetrics.paid_order_count, 0) >= 2) {
            buyerSegmentSummaryCounters.repeat_buyers += 1;
            segmentLabels.push('窗口复购');
        }
        if ((userMetrics.product_ids instanceof Set ? userMetrics.product_ids.size : 0) >= 2) {
            buyerSegmentSummaryCounters.cross_product_buyers += 1;
            segmentLabels.push('跨商品购买');
        }
        if (normalizeInteger(userMetrics.refunded_order_count, 0) > 0) {
            buyerSegmentSummaryCounters.refund_risk_buyers += 1;
            segmentLabels.push('退款风险');
        }

        return {
            ...row,
            gmv_points: roundNumber(row.gmv_points, 2),
            total_window_order_count: normalizeInteger(userMetrics.paid_order_count, 0),
            total_window_product_count: userMetrics.product_ids instanceof Set ? userMetrics.product_ids.size : 0,
            refunded_order_count: normalizeInteger(userMetrics.refunded_order_count, 0),
            segment_labels: segmentLabels
        };
    });

    const buyerSegmentSummary = [
        {
            key: 'first_product_buyers',
            label: '本商品首购',
            count: buyerSegmentSummaryCounters.first_product_buyers,
            tone: 'success',
            note: '当前窗口首笔成交就落在这件商品'
        },
        {
            key: 'repeat_buyers',
            label: '窗口复购',
            count: buyerSegmentSummaryCounters.repeat_buyers,
            tone: 'warning',
            note: '当前窗口内发生两笔及以上有效订单'
        },
        {
            key: 'cross_product_buyers',
            label: '跨商品购买',
            count: buyerSegmentSummaryCounters.cross_product_buyers,
            tone: 'default',
            note: '当前窗口同时购买了两件及以上商品'
        },
        {
            key: 'refund_risk_buyers',
            label: '退款风险',
            count: buyerSegmentSummaryCounters.refund_risk_buyers,
            tone: 'danger',
            note: '当前窗口存在退款订单'
        }
    ];

    const currentProductBuyerIds = new Set(Array.from(buyerBuckets.keys()));
    const buyerPaidOrderTimeline = new Map();
    (Array.isArray(orders) ? orders : []).forEach((order) => {
        if (isRefundedOrder(order)) {
            return;
        }

        const userId = normalizeText(order?.user_id, 160);
        if (!userId) {
            return;
        }

        const bucket = buyerPaidOrderTimeline.get(userId) || [];
        bucket.push(order);
        buyerPaidOrderTimeline.set(userId, bucket);
    });
    buyerPaidOrderTimeline.forEach((rows) => {
        rows.sort((left, right) => String(left?.created_at || '').localeCompare(String(right?.created_at || '')));
    });

    const currentProductPaidTimeline = new Map();
    productOrders.forEach((order) => {
        if (isRefundedOrder(order)) {
            return;
        }
        const userId = normalizeText(order?.user_id, 160);
        if (!userId) {
            return;
        }
        const bucket = currentProductPaidTimeline.get(userId) || [];
        bucket.push(order);
        currentProductPaidTimeline.set(userId, bucket);
    });
    currentProductPaidTimeline.forEach((rows) => {
        rows.sort((left, right) => String(left?.created_at || '').localeCompare(String(right?.created_at || '')));
    });

    const productNameById = new Map(
        products.map((row) => [
            normalizeText(row?.id, 160),
            normalizeText(row?.name, 200)
        ]).filter(([productId]) => productId)
    );
    productOrders.forEach((order) => {
        const productId = normalizeText(order?.product_id, 160);
        const productName = normalizeText(order?.snapshot_product_name, 200);
        if (productId && productName && !productNameById.has(productId)) {
            productNameById.set(productId, productName);
        }
    });

    const firstPurchaseDestinationBuckets = new Map();
    currentProductBuyerIds.forEach((userId) => {
        const userMetrics = windowBuyerMetrics.get(userId);
        const firstProductId = normalizeText(userMetrics?.first_paid_product_id, 160);
        if (!firstProductId) {
            return;
        }

        const bucket = firstPurchaseDestinationBuckets.get(firstProductId) || {
            product_id: firstProductId,
            product_name: productNameById.get(firstProductId) || `商品 ${firstProductId}`,
            is_current_product: firstProductId === normalizedProductId,
            user_count: 0
        };
        bucket.user_count += 1;
        firstPurchaseDestinationBuckets.set(firstProductId, bucket);
    });

    const crossSellDestinationBuckets = new Map();
    orders.forEach((order) => {
        if (isRefundedOrder(order)) {
            return;
        }

        const userId = normalizeText(order?.user_id, 160);
        if (!userId || !currentProductBuyerIds.has(userId)) {
            return;
        }

        const productId = normalizeText(order?.product_id, 160);
        if (!productId || productId === normalizedProductId) {
            return;
        }

        const bucket = crossSellDestinationBuckets.get(productId) || {
            product_id: productId,
            product_name: productNameById.get(productId) || normalizeText(order?.snapshot_product_name, 200) || `商品 ${productId}`,
            order_count: 0,
            gmv_points: 0,
            user_ids: new Set()
        };
        bucket.order_count += 1;
        bucket.gmv_points += getOrderRevenue(order);
        bucket.user_ids.add(userId);
        crossSellDestinationBuckets.set(productId, bucket);
    });

    const firstPurchaseDestinations = Array.from(firstPurchaseDestinationBuckets.values())
        .sort((left, right) => normalizeInteger(right.user_count, 0) - normalizeInteger(left.user_count, 0))
        .map((row) => ({
            product_id: row.product_id,
            product_name: row.product_name,
            is_current_product: row.is_current_product,
            user_count: normalizeInteger(row.user_count, 0)
        }));

    const crossSellDestinations = Array.from(crossSellDestinationBuckets.values())
        .sort((left, right) => {
            const userDiff = (right.user_ids instanceof Set ? right.user_ids.size : 0) - (left.user_ids instanceof Set ? left.user_ids.size : 0);
            if (userDiff !== 0) {
                return userDiff;
            }
            return normalizeInteger(right.order_count, 0) - normalizeInteger(left.order_count, 0);
        })
        .map((row) => ({
            product_id: row.product_id,
            product_name: row.product_name,
            user_count: row.user_ids instanceof Set ? row.user_ids.size : 0,
            order_count: normalizeInteger(row.order_count, 0),
            gmv_points: roundNumber(row.gmv_points, 2)
        }));

    const postPurchaseDestinationBuckets = new Map();
    currentProductBuyerIds.forEach((userId) => {
        const currentProductTimeline = currentProductPaidTimeline.get(userId) || [];
        const firstCurrentProductOrder = currentProductTimeline[0] || null;
        const firstCurrentProductAt = String(firstCurrentProductOrder?.created_at || '').trim();
        if (!firstCurrentProductAt) {
            return;
        }

        const paidOrders = buyerPaidOrderTimeline.get(userId) || [];
        paidOrders.forEach((order) => {
            const createdAt = String(order?.created_at || '').trim();
            if (!createdAt || createdAt <= firstCurrentProductAt) {
                return;
            }

            const productId = normalizeText(order?.product_id, 160);
            if (!productId) {
                return;
            }

            const bucket = postPurchaseDestinationBuckets.get(productId) || {
                product_id: productId,
                product_name: productNameById.get(productId) || normalizeText(order?.snapshot_product_name, 200) || `商品 ${productId}`,
                is_current_product: productId === normalizedProductId,
                order_count: 0,
                gmv_points: 0,
                user_ids: new Set(),
                first_followup_at: ''
            };

            bucket.order_count += 1;
            bucket.gmv_points += getOrderRevenue(order);
            bucket.user_ids.add(userId);
            if (!bucket.first_followup_at || createdAt < bucket.first_followup_at) {
                bucket.first_followup_at = createdAt;
            }
            postPurchaseDestinationBuckets.set(productId, bucket);
        });
    });

    const postPurchaseDestinations = Array.from(postPurchaseDestinationBuckets.values())
        .sort((left, right) => {
            const userDiff = (right.user_ids instanceof Set ? right.user_ids.size : 0) - (left.user_ids instanceof Set ? left.user_ids.size : 0);
            if (userDiff !== 0) {
                return userDiff;
            }
            return normalizeInteger(right.order_count, 0) - normalizeInteger(left.order_count, 0);
        })
        .map((row) => ({
            product_id: row.product_id,
            product_name: row.product_name,
            is_current_product: row.is_current_product,
            user_count: row.user_ids instanceof Set ? row.user_ids.size : 0,
            order_count: normalizeInteger(row.order_count, 0),
            gmv_points: roundNumber(row.gmv_points, 2),
            first_followup_at: row.first_followup_at
        }));

    const recentOrders = productOrders.slice(0, Math.max(1, normalizeInteger(recentOrderLimit, 6))).map((order) => ({
        order_id: normalizeText(order?.id, 160),
        user_id: normalizeText(order?.user_id, 160),
        site: normalizeSite(order?.site),
        quantity: getOrderQuantity(order),
        total_points: roundNumber(getOrderRevenue(order), 2),
        refund_status: normalizeRefundStatus(order?.refund_status),
        delivery_status: normalizeDeliveryStatus(order?.delivery_status),
        created_at: order?.created_at || ''
    }));

    const siteSnapshots = ['cn', 'intl'].map((siteKey) => {
        const siteEntry = buildProductMetricEntries({
            products,
            orders: productOrders.filter((row) => normalizeSite(row?.site) === siteKey),
            events: productEvents.filter((row) => normalizeSite(row?.site) === siteKey),
            inventory,
            site: siteKey
        }).find((row) => row.product_id === normalizedProductId) || null;

        return {
            site: siteKey,
            label: siteKey === 'intl' ? 'INTL' : 'CN',
            summary: siteEntry ? {
                order_count: siteEntry.order_count,
                buyer_count: siteEntry.buyer_count,
                gmv_points: siteEntry.gmv_points,
                purchase_conversion_rate: siteEntry.conversion_rate,
                delivery_success_rate: siteEntry.delivery_success_rate,
                refunded_order_count: siteEntry.refunded_order_count
            } : {
                order_count: 0,
                buyer_count: 0,
                gmv_points: 0,
                purchase_conversion_rate: 0,
                delivery_success_rate: 0,
                refunded_order_count: 0
            }
        };
    });
    const refundBreakdown = buildProductOrderStatusBreakdownRows(productOrders, { kind: 'refund' });
    const deliveryBreakdown = buildProductOrderStatusBreakdownRows(productOrders, { kind: 'delivery' });
    const topSourcePage = Array.isArray(entry.source_pages) ? entry.source_pages[0] || null : null;
    const topSourceChannel = Array.isArray(entry.source_channels) ? entry.source_channels[0] || null : null;
    const topPromptSource = Array.isArray(entry.prompt_sources) ? entry.prompt_sources[0] || null : null;

    return {
        summary: {
            product_id: entry.product_id,
            product_name: entry.product_name,
            category: entry.category,
            is_active: entry.is_active,
            delivery_type: entry.delivery_type,
            stock_count: entry.stock_count,
            available_inventory_count: entry.available_inventory_count,
            sold_inventory_count: entry.sold_inventory_count,
            reserve_inventory_count: entry.reserve_inventory_count,
            fault_inventory_count: entry.fault_inventory_count,
            units_sold: entry.units_sold,
            order_count: entry.order_count,
            refunded_order_count: entry.refunded_order_count,
            gmv_points: entry.gmv_points,
            buyer_count: entry.buyer_count,
            view_count: entry.view_count,
            view_user_count: entry.view_user_count,
            card_click_count: entry.card_click_count,
            card_click_user_count: entry.card_click_user_count,
            detail_view_count: entry.detail_view_count,
            detail_view_user_count: entry.detail_view_user_count,
            purchase_click_count: entry.purchase_click_count,
            purchase_click_user_count: entry.purchase_click_user_count,
            event_purchase_count: entry.event_purchase_count,
            event_purchase_user_count: entry.event_purchase_user_count,
            conversion_rate: entry.conversion_rate,
            avg_order_value: entry.avg_order_value,
            refund_rate: entry.refund_rate,
            delivery_success_count: entry.delivery_success_count,
            delivery_risk_count: entry.delivery_risk_count,
            delivery_success_rate: entry.delivery_success_rate,
            related_prompt_ids: Array.isArray(entry.related_prompt_ids) ? entry.related_prompt_ids : [],
            source_pages: Array.isArray(entry.source_pages) ? entry.source_pages : [],
            source_channels: Array.isArray(entry.source_channels) ? entry.source_channels : [],
            prompt_sources: Array.isArray(entry.prompt_sources) ? entry.prompt_sources : [],
            content_assisted_prompt_count: normalizeInteger(entry.content_assisted_prompt_count, 0),
            content_assisted_detail_view_count: normalizeInteger(entry.content_assisted_detail_view_count, 0),
            content_assisted_purchase_click_count: normalizeInteger(entry.content_assisted_purchase_click_count, 0),
            content_assisted_purchase_success_count: normalizeInteger(entry.content_assisted_purchase_success_count, 0),
            content_assisted_gmv_points: roundNumber(entry.content_assisted_gmv_points, 2),
            top_prompt_id: normalizeText(entry.top_prompt_id, 160),
            top_prompt_gmv_points: roundNumber(entry.top_prompt_gmv_points, 2),
            top_prompt_purchase_success_count: normalizeInteger(entry.top_prompt_purchase_success_count, 0),
            top_source_page: topSourcePage,
            top_source_channel: topSourceChannel,
            top_prompt_source: topPromptSource,
            refund_breakdown: refundBreakdown,
            delivery_breakdown: deliveryBreakdown,
            event_stage_summary: Array.isArray(entry.event_stage_summary) ? entry.event_stage_summary : [],
            buyer_snapshot: buyerSnapshot,
            buyer_segment_summary: buyerSegmentSummary,
            first_purchase_destinations: firstPurchaseDestinations,
            cross_sell_destinations: crossSellDestinations,
            post_purchase_destinations: postPurchaseDestinations,
            site_snapshots: siteSnapshots,
            metric_basis: 'shop_products + shop_orders + shop_inventory + user_events'
        },
        trend: buildProductTrendPayload({
            orders: productOrders,
            events: productEvents,
            startIso,
            endIso
        }),
        funnel: buildProductFunnelPayload({
            products,
            orders,
            events,
            inventory,
            site,
            productId: normalizedProductId
        }),
        recentOrders
    };
}

function buildProductBundleSuccess(payload, options = {}) {
    return {
        ok: true,
        statusCode: 200,
        message: '',
        source: options.source || '',
        payload
    };
}

function buildProductBundleFailure(error, fallbackMessage = 'Failed to load product analytics segment') {
    return {
        ok: false,
        statusCode: Number(error?.statusCode) || 500,
        message: error?.message || fallbackMessage,
        source: '',
        payload: null
    };
}

async function loadProductAnalyticsDataset(supabase, { site = 'all', startIso = '', endIso = '', includeInventory = true, includeEvents = true } = {}) {
    const [products, orders, inventory, events] = await Promise.all([
        fetchShopProducts(supabase),
        fetchShopOrders(supabase, { site, startIso, endIso }),
        includeInventory ? fetchShopInventory(supabase) : Promise.resolve([]),
        includeEvents ? fetchProductEvents(supabase, { site, startIso, endIso }) : Promise.resolve([])
    ]);

    return {
        products,
        orders,
        inventory,
        events
    };
}

module.exports = {
    DEFAULT_PRODUCT_RANK_LIMIT,
    DEFAULT_LOW_STOCK_THRESHOLD,
    buildRangeWindow,
    normalizePositiveInteger,
    loadProductAnalyticsDataset,
    buildProductSummaryPayload,
    buildProductTrendPayload,
    buildProductSiteComparisonPayload,
    buildProductCategoryBreakdownPayload,
    buildProductOperatingMatrixPayload,
    buildProductRankPayloads,
    buildProductHealthPayloads,
    buildProductFunnelPayload,
    buildProductDetailPayload,
    buildProductBundleSuccess,
    buildProductBundleFailure
};
