'use strict';

const DAY = 86400000;
const OFFSET = 8 * 3600000;
const MODULES = ['business', 'operations', 'inventory'];
function invalid(message = '数据中心筛选参数无效') { return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_data_center_filter' }); }
function iso(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:[.]\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid('时间范围无效');
    day(value.slice(0, 10));
    return new Date(value).toISOString();
}
function day(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw invalid('请选择有效日期');
    return Date.parse(value + 'T00:00:00+08:00');
}
function unique(params, allowed) {
    for (const key of params.keys()) if (params.getAll(key).length !== 1 || allowed && !allowed.includes(key)) throw invalid();
    if (params.has('pageSize') && params.has('page_size')) throw invalid();
}
function windowParams(params, now = Date.now()) {
    unique(params, ['module', 'range', 'as_of', 'start', 'end', 'route']);
    const module = params.get('module') || 'business';
    const range = params.get('range') || '7d';
    if (!MODULES.includes(module) || !['today', '7d', '30d', 'custom'].includes(range)) throw invalid();
    const asOf = params.has('as_of') ? Date.parse(iso(params.get('as_of'))) : now;
    if (asOf > now + 5000 || asOf < now - 15 * 60000) throw invalid('数据已过期，请刷新数据中心');
    const today = Math.floor((asOf + OFFSET) / DAY) * DAY - OFFSET;
    let from, end;
    if (range === 'custom') {
        from = day(params.get('start')); end = day(params.get('end')) + DAY;
        if (end <= from || end - from > 93 * DAY || from > today || end > today + DAY) throw invalid('自定义日期最多 93 天，且不能晚于今日');
    } else {
        from = today - ({ today: 0, '7d': 6, '30d': 29 }[range]) * DAY;
        end = today + DAY;
    }
    const to = Math.min(end, asOf);
    const previousFrom = from - (end - from);
    return { module, range, timezone: 'Asia/Shanghai', from: new Date(from).toISOString(), to: new Date(to).toISOString(),
        previous_from: new Date(previousFrom).toISOString(), previous_to: new Date(previousFrom + to - from).toISOString(), as_of: new Date(asOf).toISOString() };
}
function migrationError(error) {
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(error?.code)) {
        return Object.assign(new Error('数据中心统计尚未初始化，请先应用数据中心数据库迁移。'), { statusCode: 409, code: 'tg_data_center_migration_required' });
    }
    return error;
}
async function aggregate(supabase, window) {
    const { data, error } = await supabase.rpc('fn_tg_admin_data_center', {
        p_module: window.module, p_from: window.from, p_to: window.to, p_previous_from: window.previous_from, p_previous_to: window.previous_to, p_as_of: window.as_of
    });
    if (error) throw migrationError(error);
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || data.module !== window.module) throw new Error('Invalid TG aggregate');
    // SQL returns an explicit, credential-free reporting projection. Do not add raw rows or provider payloads here.
    return { success: true, window, snapshot_at: window.as_of, data };
}
const ENUMS = {
    product_family: ['telegram_premium', 'telegram_stars'], term_months: ['3', '6', '12'],
    payment_status: ['pending', 'awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'expired', 'cancelled'],
    fulfillment_status: ['not_started', 'pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed'],
    payment_channel: ['alipay', 'wxpay', 'usdt_bep20'], currency: ['CNY', 'USDT'], pay_currency: ['usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20', 'unknown'],
    receipt: ['confirmed', 'review', 'amount_unknown'], order_source: ['all', 'purchase', 'redemption'],
    attention: ['all', 'payment_review', 'fulfillment_review', 'failed', 'overdue'], inventory: ['available', 'in_flight', 'expiring', 'used', 'all'],
    date_field: ['created_at', 'paid_at', 'completed_at'], status: ['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed', 'draft', 'active', 'disabled', 'revoked', 'expired', 'exhausted']
};
function listParams(params, kind, now = Date.now()) {
    unique(params, [...Object.keys(ENUMS), 'from', 'to', 'search', 'username', 'batch_id', 'data_center', 'as_of', 'page', 'pageSize', 'page_size', 'route']);
    if (!['purchase', 'order', 'batch', 'code'].includes(kind)) throw invalid();
    const values = {};
    for (const [key, allowed] of Object.entries(ENUMS)) {
        const value = params.get(key); if (!value) continue;
        if (!allowed.includes(value)) throw invalid(); values[key] = value;
    }
    if (kind === 'purchase' && (values.status || values.date_field === 'completed_at' || values.inventory || values.order_source)
        || kind === 'order' && (values.date_field === 'paid_at' || values.inventory || values.receipt || values.currency || values.payment_status || values.fulfillment_status || values.payment_channel || values.pay_currency)
        || ['batch', 'code'].includes(kind) && (values.date_field && values.date_field !== 'created_at' || values.receipt || values.currency || values.attention || values.payment_status || values.fulfillment_status || values.order_source || values.payment_channel || values.pay_currency)) throw invalid();
    if (kind === 'order') {
        if (values.status && !['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed'].includes(values.status)) throw invalid();
        values.order_source ||= 'all';
    }
    if (kind === 'batch' && values.status && !['draft', 'active', 'disabled', 'revoked', 'expired', 'exhausted'].includes(values.status)) throw invalid();
    for (const field of ['from', 'to']) if (params.get(field)) values[field] = iso(params.get(field));
    if (values.from && values.to && Date.parse(values.from) >= Date.parse(values.to)) throw invalid();
    if (params.get('search')) {
        const pattern = kind === 'purchase' ? /^TGP-[A-Z0-9]{20}$/ : kind === 'order' ? /^TG-[A-Z0-9]{12,24}$/ : /^[A-Za-z0-9_-]{1,80}$/;
        if (!pattern.test(params.get('search'))) throw invalid(); values.search = params.get('search');
    }
    if (params.get('username')) {
        const username = params.get('username').replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{5,32}$/.test(username) || ['batch', 'code'].includes(kind)) throw invalid(); values.username = username;
    }
    if (params.get('batch_id')) {
        if (kind !== 'code' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(params.get('batch_id'))) throw invalid(); values.batch_id = params.get('batch_id');
    }
    const asOf = params.has('as_of') ? Date.parse(iso(params.get('as_of'))) : now;
    if (asOf > now + 5000 || asOf < now - 24 * 3600000) throw invalid('筛选快照已过期，请返回数据中心刷新');
    if (kind === 'code' && (!values.batch_id || Object.keys(values).some(key => !['inventory', 'batch_id'].includes(key)))) throw invalid();
    return { values, as_of: new Date(asOf).toISOString() };
}
async function list(supabase, params, kind, page, pageSize) {
    const parsed = listParams(params, kind);
    const { data, error } = await supabase.rpc('fn_tg_admin_data_center_list', { p_kind: kind, p_filters: parsed.values, p_as_of: parsed.as_of, p_page: page, p_page_size: pageSize });
    if (error) throw migrationError(error);
    if (!Array.isArray(data?.rows) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Invalid TG drilldown');
    return { ...data, snapshot_at: parsed.as_of };
}
module.exports = { MODULES, windowParams, listParams, aggregate, list, migrationError };
