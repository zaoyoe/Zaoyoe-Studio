'use strict';

const { normalizeOrderSnapshot } = require('./worker');
const { _private: { body } } = require('../api-handlers/public/tg');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_FIELDS = 'id,order_no,order_source,purchase_id,telegram_username,product_family,term_months,stars_quantity,status,provider,provider_order_id,provider_payment_currency,provider_idempotency_key,attempt_count,submitted_at,completed_at,last_error_code,last_error_message,created_at,updated_at';
const MESSAGES = {
    not_found: '订单不存在或查询凭证无效', version_conflict: '订单已发生变化，请刷新详情后再操作',
    close_not_allowed: '该订单已有付款、履约或未确认的支付请求，不能关闭', payment_unverified: '没有可用的已核验付款记录，不能放行发货',
    review_not_allowed: '仅可处理待人工复核且未被工作进程占用的订单', source_unconfirmed: '付款或兑换码归属尚未确认',
    submission_unknown: '上游提交结果未知，禁止重新发货', provider_unverified: '上游身份、权益或状态未通过核对', invalid_request: '操作参数无效'
};
function invalid(message = '筛选或操作参数无效') { return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_request' }); }
function cleanOrder(data) {
    if (!data) return null;
    return Object.fromEntries(ORDER_FIELDS.split(',').filter((key) => key !== 'provider_idempotency_key' && Object.hasOwn(data, key)).map((key) => [key, data[key]]));
}
async function lookupOrder(supabase, field, value) {
    const { data, error } = await supabase.from('tg_redemption_orders').select(ORDER_FIELDS).eq(field, value).maybeSingle();
    if (error) throw error;
    return data;
}
async function reconcile(order, clientFactory, env) {
    if (!order?.provider_order_id) return { verified: false, reason: 'provider_order_missing', snapshot: null };
    const normalized = normalizeOrderSnapshot(await clientFactory({ env }).getOrder(order.provider_order_id), order);
    return { checked_at: new Date().toISOString(), verified: normalized.valid === true, reason: normalized.reason || null, snapshot: normalized.valid ? normalized.snapshot : null };
}
async function history(supabase, type, id) {
    const { data, error } = await supabase.from('tg_audit_events').select('id,actor_user_id,event_type,metadata,created_at')
        .eq('target_type', type).eq('target_id', id).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    // Explicit projection prevents future audit payloads leaking credentials.
    return (data || []).map((event) => ({ id: event.id, actor_user_id: event.actor_user_id, event_type: event.event_type, created_at: event.created_at,
        metadata: Object.fromEntries(['action', 'note', 'actor', 'previous_status', 'result_status', 'reason', 'error_code', 'status'].filter((key) => typeof event.metadata?.[key] === 'string').map((key) => [key, event.metadata[key]])) }));
}
async function reviewInput(req, actions) {
    const input = await body(req);
    if (!actions.includes(input.action) || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 500
        || typeof input.expected_updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(input.expected_updated_at) || !Number.isFinite(Date.parse(input.expected_updated_at))) throw invalid('请填写处理原因并刷新订单版本');
    return { ...input, note: input.note.trim() };
}
function rpcResult(admin, res, data) {
    if (data?.success === true) return admin.sendJson(res, 200, { success: true, status: data.status });
    const code = Object.hasOwn(MESSAGES, data?.code) ? data.code : 'review_not_allowed';
    return admin.sendJson(res, code === 'not_found' ? 404 : 409, { success: false, code, message: MESSAGES[code] });
}
function filters(query, params, kind) {
    const enums = { product_family: ['telegram_premium', 'telegram_stars'] };
    if (kind === 'purchase') Object.assign(enums, { payment_status: ['pending', 'awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'expired', 'cancelled'], fulfillment_status: ['not_started', 'pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed'], payment_channel: ['alipay', 'wxpay', 'usdt_bep20'] });
    if (kind === 'order') Object.assign(enums, { order_source: ['purchase', 'redemption', 'all'] });
    if (kind === 'batch') Object.assign(enums, { status: ['draft', 'active', 'disabled', 'revoked', 'expired', 'exhausted'] });
    for (const [key, allowed] of Object.entries(enums)) {
        const value = params.get(key);
        if (params.getAll(key).length > 1) throw invalid();
        if (!value || key === 'order_source' && value === 'all') continue;
        if (!allowed.includes(value)) throw invalid();
        query = key === 'payment_status' && value === 'pending' ? query.in(key, ['awaiting_payment', 'checkout_creating']) : query.eq(key, value);
    }
    const username = params.get('username');
    if (username) {
        const value = username.replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{5,32}$/.test(value) || kind === 'batch') throw invalid('请输入完整 Telegram 用户名');
        query = query.eq('telegram_username', value);
    }
    const search = params.get('search');
    if (search) {
        const pattern = kind === 'purchase' ? /^TGP-[A-Z0-9]{20}$/ : kind === 'order' ? /^TG-[A-Z0-9]{12,24}$/ : /^[A-Za-z0-9_-]{1,80}$/;
        if (!pattern.test(search)) throw invalid('请输入完整订单号或批次编号');
        query = query.eq(kind === 'batch' ? 'batch_no' : 'order_no', search);
    }
    const from = params.get('from'); const to = params.get('to');
    for (const value of [from, to]) if (value && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) throw invalid('时间范围无效');
    if (from && to && Date.parse(from) >= Date.parse(to)) throw invalid('结束时间必须晚于开始时间');
    if (from) query = query.gte('created_at', new Date(from).toISOString());
    if (to) query = query.lt('created_at', new Date(to).toISOString());
    return query;
}
module.exports = { UUID, ORDER_FIELDS, invalid, cleanOrder, lookupOrder, reconcile, history, reviewInput, rpcResult, filters };
