const {
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../_lib/admin');

const EVENT_OK_RESULTS = new Set([
    'processed_paid',
    'received',
    'ignored_non_success_ec',
    'ignored_non_order_event',
    'ignored_non_paid_status'
]);

function getIsoDaysAgo(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - Math.max(1, days));
    return date.toISOString();
}

function getIsoHoursAgo(hours) {
    const date = new Date();
    date.setUTCHours(date.getUTCHours() - Math.max(1, hours));
    return date.toISOString();
}

function formatHourBucket(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '';
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    const hour = `${date.getUTCHours()}`.padStart(2, '0');
    return `${month}-${day} ${hour}:00`;
}

function isEventAnomaly(event) {
    if (!event) return false;
    const processingResult = String(event.processing_result || '').trim();
    return (
        event.signature_valid === false
        || event.amount_valid === false
        || Boolean(String(event.error_message || '').trim())
        || (processingResult && !EVENT_OK_RESULTS.has(processingResult))
    );
}

function isOrderAnomaly(order) {
    if (!order) return false;
    return (
        ['pending_review', 'rejected', 'amount_mismatch'].includes(order.status)
        || (order.status === 'paid' && !order.user_id)
        || Boolean(String(order.last_error || '').trim())
    );
}

function buildOrderAnomaly(order) {
    let title = '订单待人工处理';
    let message = '请检查订单状态、金额和认领情况。';
    let severity = 'warning';

    if (order.status === 'amount_mismatch') {
        title = '订单金额不匹配';
        message = '支付金额与套餐期望金额不一致，建议人工复核。';
        severity = 'critical';
    } else if (order.status === 'rejected') {
        title = '订单签名校验失败';
        message = '该订单被系统拒绝，请检查回调签名和来源。';
        severity = 'critical';
    } else if (order.status === 'pending_review') {
        title = '订单待审核';
        message = order.last_error ? String(order.last_error) : '套餐匹配、金额校验或回调参数存在异常。';
        severity = 'warning';
    } else if (order.status === 'paid' && !order.user_id) {
        title = '已支付但未认领';
        message = '用户尚未在钱包输入订单号完成认领。';
        severity = 'info';
    }

    return {
        type: 'order',
        id: order.id,
        provider: order.provider,
        provider_order_no: order.provider_order_no,
        status: order.status,
        severity,
        title,
        message,
        created_at: order.created_at,
        site: order.site || null
    };
}

function buildEventAnomaly(event) {
    let title = '回调异常';
    let message = String(event.error_message || '').trim() || String(event.processing_result || '').trim() || '支付回调需要人工检查。';
    let severity = 'warning';

    if (event.signature_valid === false) {
        title = '回调签名异常';
        message = message || '签名校验失败。';
        severity = 'critical';
    } else if (event.amount_valid === false) {
        title = '回调金额异常';
        message = message || '回调金额与订单期望不一致。';
        severity = 'critical';
    } else if (String(event.processing_result || '').trim() === 'webhook_exception') {
        title = '回调处理异常';
        severity = 'critical';
    }

    return {
        type: 'event',
        id: event.id,
        provider: event.provider,
        provider_order_no: event.provider_order_no,
        status: event.processing_result || event.event_type || 'webhook',
        severity,
        title,
        message,
        created_at: event.created_at
    };
}

function buildTrend24h(events) {
    const now = new Date();
    const buckets = [];
    const bucketMap = new Map();

    for (let i = 23; i >= 0; i -= 1) {
        const date = new Date(now.getTime() - i * 60 * 60 * 1000);
        date.setUTCMinutes(0, 0, 0);
        const key = date.toISOString();
        const bucket = {
            bucket: key,
            label: formatHourBucket(key),
            total_events: 0,
            anomaly_events: 0,
            failed_events: 0
        };
        buckets.push(bucket);
        bucketMap.set(key, bucket);
    }

    (events || []).forEach((event) => {
        const date = new Date(event.created_at);
        if (Number.isNaN(date.getTime())) return;
        date.setUTCMinutes(0, 0, 0);
        const key = date.toISOString();
        const bucket = bucketMap.get(key);
        if (!bucket) return;

        bucket.total_events += 1;

        if (isEventAnomaly(event)) {
            bucket.anomaly_events += 1;
        }

        if (
            event.signature_valid === false
            || event.amount_valid === false
            || ['webhook_exception', 'process_rpc_failed', 'missing_signature', 'invalid_order_no', 'missing_afdian_token'].includes(String(event.processing_result || '').trim())
        ) {
            bucket.failed_events += 1;
        }
    });

    return buckets;
}

function buildProviderStats(orders) {
    const statsMap = new Map();

    (orders || []).forEach((order) => {
        const provider = String(order.provider || 'unknown');
        if (!statsMap.has(provider)) {
            statsMap.set(provider, {
                provider,
                total_orders: 0,
                paid_orders: 0,
                claimed_orders: 0,
                review_orders: 0,
                failed_orders: 0
            });
        }

        const row = statsMap.get(provider);
        row.total_orders += 1;

        if (['paid', 'redeemed'].includes(order.status)) {
            row.paid_orders += 1;
        }
        if (order.user_id) {
            row.claimed_orders += 1;
        }
        if (order.status === 'pending_review') {
            row.review_orders += 1;
        }
        if (['rejected', 'amount_mismatch'].includes(order.status)) {
            row.failed_orders += 1;
        }
        row.total_amount = Number((Number(row.total_amount || 0) + Number(order.paid_amount || order.expected_amount || 0)).toFixed(2));
        row.total_points = Number((Number(row.total_points || 0) + Number(order.points_amount || 0)).toFixed(1));
    });

    return Array.from(statsMap.values()).map((item) => ({
        ...item,
        paid_rate: item.total_orders > 0 ? Number(((item.paid_orders / item.total_orders) * 100).toFixed(2)) : 0,
        claim_rate: item.paid_orders > 0 ? Number(((item.claimed_orders / item.paid_orders) * 100).toFixed(2)) : 0
    })).sort((left, right) => (
        Number(right.total_orders || 0) - Number(left.total_orders || 0)
        || Number(right.total_amount || 0) - Number(left.total_amount || 0)
    ));
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, digits = 1) {
    const multiplier = 10 ** digits;
    return Math.round(normalizeNumber(value, 0) * multiplier) / multiplier;
}

function isMissingColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'));
}

function isSuccessOrder(order) {
    return ['paid', 'redeemed'].includes(String(order?.status || '').trim());
}

function classifyLedgerCategory(entry) {
    const reason = String(entry?.reason || '').trim().toLowerCase();
    const amount = normalizeNumber(entry?.amount, 0);

    if (amount >= 0) {
        if (
            reason.includes('充值')
            || reason.includes('recharge')
            || reason.includes('package_purchase')
            || reason.includes('模拟充值')
            || reason.includes('afdian')
        ) {
            return { key: 'recharge', label: '充值入账' };
        }
        if (reason.includes('兑换码') || reason.includes('redeem')) {
            return { key: 'redeem_code', label: '兑换码入账' };
        }
        if (
            reason.includes('返佣')
            || reason.includes('奖励')
            || reason.includes('reward')
            || reason.includes('signup')
            || reason.includes('checkin')
        ) {
            return { key: 'rewards', label: '奖励 / 返佣' };
        }
        if (reason.includes('refund') || reason.includes('退款')) {
            return { key: 'refund', label: '退款返还' };
        }
        if (reason.includes('admin') || reason.includes('manual') || reason.includes('系统')) {
            return { key: 'admin_in', label: '管理入账' };
        }
        return { key: 'other_in', label: '其他入账' };
    }

    if (reason.includes('商城购买') || reason.includes('shop_purchase')) {
        return { key: 'shop_purchase', label: '商城消费' };
    }
    if (reason.includes('unlock') || reason.includes('解锁')) {
        return { key: 'content_unlock', label: '内容解锁' };
    }
    if (reason.includes('验证') || reason.includes('gemini') || reason.includes('verify')) {
        return { key: 'verification', label: '验证消耗' };
    }
    if (reason.includes('refund') || reason.includes('退款')) {
        return { key: 'refund_out', label: '退款扣回' };
    }
    if (reason.includes('deduct') || reason.includes('扣除') || reason.includes('admin')) {
        return { key: 'admin_deduct', label: '管理扣减' };
    }
    return { key: 'other_out', label: '其他支出' };
}

async function fetchPagedRows(buildQuery, pageSize = 1000, maxPages = 50) {
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

async function fetchPaymentOrders(client, sinceIso, site) {
    return fetchPagedRows(() => {
        let query = client
            .from('payment_orders')
            .select('id, provider, provider_order_no, package_name, paid_amount, expected_amount, points_amount, status, user_id, created_at, paid_at, claimed_at, site, last_error, sign_verified, amount_verified')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false });

        if (site) {
            query = query.eq('site', site);
        }

        return query;
    });
}

async function fetchPaymentEvents(client, sinceIso) {
    return fetchPagedRows(() => client
        .from('payment_events')
        .select('id, payment_order_id, provider, provider_order_no, event_type, signature_valid, amount_valid, processing_result, error_message, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }));
}

async function fetchShopOrders(client, sinceIso, site) {
    const variants = [
        {
            select: 'id, user_id, price_paid, snapshot_product_name, refund_status, created_at, site',
            hasSite: true
        },
        {
            select: 'id, user_id, price_paid, snapshot_product_name, refund_status, created_at',
            hasSite: false
        }
    ];

    for (const variant of variants) {
        try {
            const rows = await fetchPagedRows(() => {
                let query = client
                    .from('shop_orders')
                    .select(variant.select)
                    .gte('created_at', sinceIso)
                    .order('created_at', { ascending: false });

                if (site && variant.hasSite) {
                    query = query.eq('site', site);
                }

                return query;
            });

            if (site && !variant.hasSite && site !== 'cn') {
                return [];
            }

            return rows.map((row) => ({
                ...row,
                site: variant.hasSite ? (row.site || 'cn') : 'cn'
            }));
        } catch (error) {
            if (isMissingColumnError(error) && variant === variants[variants.length - 1]) {
                return [];
            }

            if (!isMissingColumnError(error) || variant === variants[variants.length - 1]) {
                throw error;
            }
        }
    }

    return [];
}

async function fetchPointsLedger(client, sinceIso, site) {
    const variants = [
        {
            select: 'id, user_id, amount, reason, reference_id, created_at, site',
            hasSite: true
        },
        {
            select: 'id, user_id, amount, reason, reference_id, created_at',
            hasSite: false
        }
    ];

    for (const variant of variants) {
        try {
            const rows = await fetchPagedRows(() => {
                let query = client
                    .from('points_ledger')
                    .select(variant.select)
                    .gte('created_at', sinceIso)
                    .order('created_at', { ascending: false });

                if (site && variant.hasSite) {
                    query = query.eq('site', site);
                }

                return query;
            });

            if (site && !variant.hasSite && site !== 'cn') {
                return [];
            }

            return rows.map((row) => ({
                ...row,
                site: variant.hasSite ? (row.site || 'cn') : 'cn'
            }));
        } catch (error) {
            if (isMissingColumnError(error) && variant === variants[variants.length - 1]) {
                return [];
            }

            if (!isMissingColumnError(error) || variant === variants[variants.length - 1]) {
                throw error;
            }
        }
    }

    return [];
}

async function fetchPointsBalances(client, site) {
    const variants = [
        {
            select: 'user_id, paid_balance, bonus_balance, total_balance, site',
            hasSite: true
        },
        {
            select: 'user_id, paid_balance, bonus_balance, total_balance',
            hasSite: false
        }
    ];

    for (const variant of variants) {
        try {
            const rows = await fetchPagedRows(() => {
                let query = client
                    .from('points_balance')
                    .select(variant.select)
                    .order('updated_at', { ascending: false });

                if (site && variant.hasSite) {
                    query = query.eq('site', site);
                }

                return query;
            });

            if (site && !variant.hasSite && site !== 'cn') {
                return [];
            }

            return rows.map((row) => ({
                ...row,
                site: variant.hasSite ? (row.site || 'cn') : 'cn'
            }));
        } catch (error) {
            if (isMissingColumnError(error) && variant === variants[variants.length - 1]) {
                return [];
            }

            if (!isMissingColumnError(error) || variant === variants[variants.length - 1]) {
                throw error;
            }
        }
    }

    return [];
}

function buildOverview(orders) {
    const successfulOrders = (orders || []).filter(isSuccessOrder);
    const paidOrders = successfulOrders.length;
    const claimedOrders = (orders || []).filter((order) => Boolean(order.user_id)).length;
    const totalOrders = (orders || []).length;

    return {
        total_orders: totalOrders,
        paid_orders: paidOrders,
        redeemed_orders: (orders || []).filter((order) => order.status === 'redeemed').length,
        claimed_orders: claimedOrders,
        review_orders: (orders || []).filter((order) => order.status === 'pending_review').length,
        failed_orders: (orders || []).filter((order) => ['rejected', 'amount_mismatch'].includes(order.status)).length,
        total_amount: roundNumber(successfulOrders.reduce((sum, order) => sum + normalizeNumber(order.paid_amount, normalizeNumber(order.expected_amount, 0)), 0), 2),
        total_points: roundNumber(successfulOrders.reduce((sum, order) => sum + normalizeNumber(order.points_amount, 0), 0), 1),
        paid_rate: totalOrders > 0 ? roundNumber((paidOrders / totalOrders) * 100, 2) : 0,
        claim_rate: paidOrders > 0 ? roundNumber((claimedOrders / paidOrders) * 100, 2) : 0
    };
}

function buildFinanceSummary(paymentOrders, shopOrders, ledgerRows, balanceRows) {
    const successfulPayments = (paymentOrders || []).filter(isSuccessOrder);
    const nonRefundedShopOrders = (shopOrders || []).filter((order) => String(order.refund_status || 'none') !== 'refunded');
    const refundedShopOrders = (shopOrders || []).filter((order) => String(order.refund_status || 'none') === 'refunded');

    const pointsInflow = roundNumber((ledgerRows || [])
        .filter((entry) => normalizeNumber(entry.amount, 0) > 0)
        .reduce((sum, entry) => sum + normalizeNumber(entry.amount, 0), 0), 1);
    const pointsOutflow = roundNumber((ledgerRows || [])
        .filter((entry) => normalizeNumber(entry.amount, 0) < 0)
        .reduce((sum, entry) => sum + Math.abs(normalizeNumber(entry.amount, 0)), 0), 1);

    return {
        recharge_amount: roundNumber(successfulPayments.reduce((sum, order) => sum + normalizeNumber(order.paid_amount, normalizeNumber(order.expected_amount, 0)), 0), 2),
        recharge_points: roundNumber(successfulPayments.reduce((sum, order) => sum + normalizeNumber(order.points_amount, 0), 0), 1),
        recharge_order_count: successfulPayments.length,
        shop_points_spent: roundNumber(nonRefundedShopOrders.reduce((sum, order) => sum + normalizeNumber(order.price_paid, 0), 0), 1),
        shop_order_count: nonRefundedShopOrders.length,
        refunded_shop_points: roundNumber(refundedShopOrders.reduce((sum, order) => sum + normalizeNumber(order.price_paid, 0), 0), 1),
        refunded_shop_order_count: refundedShopOrders.length,
        points_inflow: pointsInflow,
        points_outflow: pointsOutflow,
        net_points_flow: roundNumber(pointsInflow - pointsOutflow, 1),
        circulating_points: roundNumber((balanceRows || []).reduce((sum, row) => sum + normalizeNumber(row.total_balance, 0), 0), 1),
        paid_balance: roundNumber((balanceRows || []).reduce((sum, row) => sum + normalizeNumber(row.paid_balance, 0), 0), 1),
        bonus_balance: roundNumber((balanceRows || []).reduce((sum, row) => sum + normalizeNumber(row.bonus_balance, 0), 0), 1)
    };
}

function buildPointsBreakdown(ledgerRows) {
    const categoryMap = new Map();

    (ledgerRows || []).forEach((entry) => {
        const category = classifyLedgerCategory(entry);
        if (!categoryMap.has(category.key)) {
            categoryMap.set(category.key, {
                key: category.key,
                label: category.label,
                inflow: 0,
                outflow: 0
            });
        }

        const row = categoryMap.get(category.key);
        const amount = normalizeNumber(entry.amount, 0);
        if (amount >= 0) {
            row.inflow += amount;
        } else {
            row.outflow += Math.abs(amount);
        }
    });

    return Array.from(categoryMap.values())
        .map((item) => ({
            ...item,
            inflow: roundNumber(item.inflow, 1),
            outflow: roundNumber(item.outflow, 1),
            net: roundNumber(item.inflow - item.outflow, 1)
        }))
        .sort((left, right) => Math.abs(right.net) - Math.abs(left.net));
}

function buildBusinessBreakdown({ paymentOrders, shopOrders, balanceRows, sitewideSummary }) {
    const mockOrders = (paymentOrders || []).filter((order) => order.provider === 'mock');
    const successfulMockOrders = mockOrders.filter(isSuccessOrder);
    const orderCount = (paymentOrders || []).length;

    return [
        {
            title: '充值收入',
            description: `近期开出的支付订单 ${orderCount} 笔，成功 ${sitewideSummary.recharge_order_count} 笔。`,
            metric: `¥${sitewideSummary.recharge_amount.toLocaleString('zh-CN', { minimumFractionDigits: sitewideSummary.recharge_amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`,
            meta: `${sitewideSummary.recharge_points.toLocaleString('zh-CN')} 已入账`,
            help: '统计标准支付订单的成功入账金额和对应到账点数。'
        },
        {
            title: '商城消费',
            description: `商城已消费 ${sitewideSummary.shop_order_count} 笔，退款 ${sitewideSummary.refunded_shop_order_count} 笔。`,
            metric: sitewideSummary.shop_points_spent.toLocaleString('zh-CN'),
            meta: sitewideSummary.refunded_shop_points > 0
                ? `已退款 ${sitewideSummary.refunded_shop_points.toLocaleString('zh-CN')}`
                : '当前无退款冲销',
            help: '统计商城订单消耗的点数，不含已退款冲销部分。'
        },
        {
            title: '模拟支付',
            description: '用于临时直到账的充值记录，也会进入标准支付订单。',
            metric: `${successfulMockOrders.length.toLocaleString('zh-CN')} 笔`,
            meta: `${roundNumber(successfulMockOrders.reduce((sum, order) => sum + normalizeNumber(order.points_amount, 0), 0), 1).toLocaleString('zh-CN')} 已入账`,
            help: '用于统计当前启用的模拟充值通道，方便和真实支付分开核对。'
        },
        {
            title: '当前积分存量',
            description: `活跃余额分布在 ${(balanceRows || []).length.toLocaleString('zh-CN')} 个用户/站点账户中。`,
            metric: sitewideSummary.circulating_points.toLocaleString('zh-CN'),
            meta: `付费 ${sitewideSummary.paid_balance.toLocaleString('zh-CN')} · 奖励 ${sitewideSummary.bonus_balance.toLocaleString('zh-CN')}`,
            help: '展示当前仍在用户账户中流通的总余额，以及付费与奖励余额的拆分。'
        }
    ];
}

module.exports = async function handler(req, res) {
    if (!['GET'].includes(req.method)) {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, requestSupabase, user } = await requireAdmin(req);
        const scopedClient = supabase || requestSupabase;
        const site = typeof req.query?.site === 'string' && req.query.site.trim() ? req.query.site.trim() : null;
        const view = ['overview', 'finance', 'ops'].includes(String(req.query?.view || '').trim())
            ? String(req.query.view).trim()
            : 'overview';
        const days = Number.parseInt(req.query?.days, 10);
        const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
        const daysAgoIso = getIsoDaysAgo(normalizedDays);
        const trendSinceIso = getIsoHoursAgo(24);
        const needsEvents = view === 'overview' || view === 'ops';
        const needsFinance = view === 'finance';

        const [
            orderRows,
            eventRows,
            shopOrders,
            pointsLedgerRows,
            pointsBalanceRows
        ] = await Promise.all([
            fetchPaymentOrders(scopedClient, daysAgoIso, site),
            needsEvents ? fetchPaymentEvents(scopedClient, daysAgoIso) : Promise.resolve([]),
            needsFinance ? fetchShopOrders(scopedClient, daysAgoIso, site) : Promise.resolve([]),
            needsFinance ? fetchPointsLedger(scopedClient, daysAgoIso, site) : Promise.resolve([]),
            needsFinance ? fetchPointsBalances(scopedClient, site) : Promise.resolve([])
        ]);

        const overview = buildOverview(orderRows || []);

        const siteOrderIds = new Set((orderRows || []).map((order) => order.id).filter(Boolean));
        const siteOrderNumbers = new Set((orderRows || []).map((order) => order.provider_order_no).filter(Boolean));
        const scopedEvents = (eventRows || []).filter((event) => {
            if (!site) return true;
            return (
                (event.payment_order_id && siteOrderIds.has(event.payment_order_id))
                || (event.provider_order_no && siteOrderNumbers.has(event.provider_order_no))
            );
        });
        const scopedTrendEvents = scopedEvents.filter((event) => new Date(event.created_at).getTime() >= new Date(trendSinceIso).getTime());

        const recentOrders = view === 'ops' ? (orderRows || []).slice(0, 20) : [];
        const recentOrderAnomalies = view === 'ops'
            ? (orderRows || [])
                .filter(isOrderAnomaly)
                .slice(0, 24)
                .map(buildOrderAnomaly)
            : [];

        const duplicateMap = new Map();
        scopedEvents.forEach((event) => {
            const orderNo = String(event.provider_order_no || '').trim();
            if (!orderNo) return;
            duplicateMap.set(orderNo, (duplicateMap.get(orderNo) || 0) + 1);
        });
        const duplicateWebhookOrders = Array.from(duplicateMap.values()).filter((count) => count > 1).length;

        const recentEventAnomalies = needsEvents
            ? scopedEvents
                .filter(isEventAnomaly)
                .slice(0, 24)
                .map(buildEventAnomaly)
            : [];

        const recentAnomalies = view === 'ops'
            ? [...recentOrderAnomalies, ...recentEventAnomalies]
                .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
                .slice(0, 20)
            : [];

        const anomalySummary = {
            review_orders: Number(overview.review_orders || 0),
            failed_orders: Number(overview.failed_orders || 0),
            unclaimed_paid_orders: (orderRows || []).filter((order) => order.status === 'paid' && !order.user_id).length,
            recent_event_anomalies: recentEventAnomalies.length,
            duplicate_webhook_orders: duplicateWebhookOrders
        };

        const provider_stats = buildProviderStats(orderRows || []);
        const trend_24h = view === 'overview' ? buildTrend24h(scopedTrendEvents) : undefined;
        const sitewide_summary = needsFinance
            ? buildFinanceSummary(orderRows || [], shopOrders || [], pointsLedgerRows || [], pointsBalanceRows || [])
            : undefined;
        const points_breakdown = needsFinance ? buildPointsBreakdown(pointsLedgerRows || []) : undefined;
        const business_breakdown = needsFinance
            ? buildBusinessBreakdown({
                paymentOrders: orderRows || [],
                shopOrders: shopOrders || [],
                balanceRows: pointsBalanceRows || [],
                sitewideSummary: sitewide_summary
            })
            : undefined;

        await writeAdminAuditLog({
            supabase: requestSupabase || scopedClient,
            adminId: user.id,
            actionType: 'payments.summary.view',
            details: {
                site,
                days: normalizedDays,
                view
            }
        });

        return sendJson(res, 200, {
            success: true,
            overview,
            anomaly_summary: anomalySummary,
            provider_stats,
            trend_24h,
            sitewide_summary,
            points_breakdown,
            business_breakdown,
            recent_anomalies: recentAnomalies,
            recent_orders: recentOrders || []
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        return sendJson(res, statusCode, {
            success: false,
            message: error.message || 'Failed to load payment summary'
        });
    }
};
