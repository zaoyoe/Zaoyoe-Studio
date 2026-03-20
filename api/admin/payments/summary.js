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
    });

    return Array.from(statsMap.values()).map((item) => ({
        ...item,
        paid_rate: item.total_orders > 0 ? Number(((item.paid_orders / item.total_orders) * 100).toFixed(2)) : 0,
        claim_rate: item.paid_orders > 0 ? Number(((item.claimed_orders / item.paid_orders) * 100).toFixed(2)) : 0
    }));
}

module.exports = async function handler(req, res) {
    if (!['GET'].includes(req.method)) {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, requestSupabase, user } = await requireAdmin(req);
        const scopedClient = requestSupabase || supabase;
        const site = typeof req.query?.site === 'string' && req.query.site.trim() ? req.query.site.trim() : null;
        const days = Number.parseInt(req.query?.days, 10);
        const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
        const daysAgoIso = getIsoDaysAgo(normalizedDays);
        const trendSinceIso = getIsoHoursAgo(24);

        let overviewPromise = scopedClient.rpc('get_payment_overview', {
            p_days: normalizedDays,
            p_site: site
        });

        let recentOrdersQuery = scopedClient
            .from('payment_orders')
            .select('id, provider, provider_order_no, package_name, paid_amount, points_amount, status, user_id, created_at, paid_at, claimed_at, site, last_error, sign_verified, amount_verified')
            .gte('created_at', daysAgoIso)
            .order('created_at', { ascending: false })
            .limit(200);

        let recentEventsQuery = scopedClient
            .from('payment_events')
            .select('id, payment_order_id, provider, provider_order_no, event_type, signature_valid, amount_valid, processing_result, error_message, created_at')
            .gte('created_at', daysAgoIso)
            .order('created_at', { ascending: false })
            .limit(250);

        let trendQuery = scopedClient
            .from('payment_events')
            .select('provider, provider_order_no, payment_order_id, created_at, signature_valid, amount_valid, processing_result, error_message')
            .gte('created_at', trendSinceIso)
            .order('created_at', { ascending: true })
            .limit(500);

        let unclaimedPaidQuery = scopedClient
            .from('payment_orders')
            .select('id', { head: true, count: 'exact' })
            .eq('status', 'paid')
            .is('user_id', null)
            .gte('created_at', daysAgoIso);

        if (site) {
            recentOrdersQuery = recentOrdersQuery.eq('site', site);
            unclaimedPaidQuery = unclaimedPaidQuery.eq('site', site);
        }

        const [
            { data: overview, error: overviewError },
            { data: orderRows, error: recentError },
            { data: eventRows, error: eventError },
            { data: trendRows, error: trendError },
            { count: unclaimedPaidCount, error: unclaimedError }
        ] = await Promise.all([
            overviewPromise,
            recentOrdersQuery,
            recentEventsQuery,
            trendQuery,
            unclaimedPaidQuery
        ]);

        if (overviewError) throw overviewError;
        if (recentError) throw recentError;
        if (eventError) throw eventError;
        if (trendError) throw trendError;
        if (unclaimedError) throw unclaimedError;

        const siteOrderIds = new Set((orderRows || []).map((order) => order.id).filter(Boolean));
        const siteOrderNumbers = new Set((orderRows || []).map((order) => order.provider_order_no).filter(Boolean));
        const scopedEvents = site
            ? (eventRows || []).filter((event) => (
                (event.payment_order_id && siteOrderIds.has(event.payment_order_id))
                || (event.provider_order_no && siteOrderNumbers.has(event.provider_order_no))
            ))
            : (eventRows || []);
        const scopedTrendEvents = site
            ? (trendRows || []).filter((event) => (
                (event.payment_order_id && siteOrderIds.has(event.payment_order_id))
                || (event.provider_order_no && siteOrderNumbers.has(event.provider_order_no))
            ))
            : (trendRows || []);

        const recentOrders = (orderRows || []).slice(0, 20);
        const recentOrderAnomalies = (orderRows || [])
            .filter(isOrderAnomaly)
            .slice(0, 24)
            .map(buildOrderAnomaly);

        const duplicateMap = new Map();
        scopedEvents.forEach((event) => {
            const orderNo = String(event.provider_order_no || '').trim();
            if (!orderNo) return;
            duplicateMap.set(orderNo, (duplicateMap.get(orderNo) || 0) + 1);
        });
        const duplicateWebhookOrders = Array.from(duplicateMap.values()).filter((count) => count > 1).length;

        const recentEventAnomalies = scopedEvents
            .filter(isEventAnomaly)
            .slice(0, 24)
            .map(buildEventAnomaly);

        const recentAnomalies = [...recentOrderAnomalies, ...recentEventAnomalies]
            .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
            .slice(0, 20);

        const anomalySummary = {
            review_orders: Number(overview?.review_orders || 0),
            failed_orders: Number(overview?.failed_orders || 0),
            unclaimed_paid_orders: Number(unclaimedPaidCount || 0),
            recent_event_anomalies: recentEventAnomalies.length,
            duplicate_webhook_orders: duplicateWebhookOrders
        };

        const provider_stats = buildProviderStats(orderRows || []);
        const trend_24h = buildTrend24h(scopedTrendEvents);

        await writeAdminAuditLog({
            supabase: scopedClient,
            adminId: user.id,
            actionType: 'payments.summary.view',
            details: {
                site,
                days: normalizedDays
            }
        });

        return sendJson(res, 200, {
            success: true,
            overview,
            anomaly_summary: anomalySummary,
            provider_stats,
            trend_24h,
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
