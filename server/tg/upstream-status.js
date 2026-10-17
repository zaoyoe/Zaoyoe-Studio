'use strict';

const { createGramixClient, isDecimalString } = require('./gramix-client');
const { describeGramixError, recordedErrorDiagnostic } = require('./gramix-errors');
const { normalizeOrderSnapshot, enabled } = require('./worker');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const REQUEST_TIMEOUT_MS = 3000;
const SAFE_ERRORS = new Set(['gramix_timeout', 'gramix_network_error', 'gramix_http_error', 'gramix_invalid_response', 'gramix_configuration_error']);
const MESSAGES = Object.freeze({
    verified: '已核对上游订单身份、接收账号及商品权益。',
    not_submitted: '任务尚无上游提交记录，目前没有可查询的上游订单；请结合本地任务状态核对后续处理。',
    submission_unknown: '已有上游提交记录，但暂时无法按提交标识确认对应订单。请保留原任务并继续核对。',
    not_found: '本次未查到与原任务提交标识匹配的上游订单；提交结果仍未确认，请勿重复补发。',
    search_limited: '已查询最近的部分上游订单，未找到匹配记录；这不能证明上游未受理，请继续人工核对。',
    mismatch: '上游订单与原任务的身份或商品权益不一致，不能据此确认发货。',
    unavailable: '上游查询暂不可用，请稍后重试；原发货任务已保留。',
    unconfigured: '当前 API 尚未配置上游查询凭证，请先配置此运行环境的 Gramix 凭证。',
    unsupported: '此任务的上游服务不支持在本入口查询。'
});

function fulfillmentRuntime(env = process.env) {
    return {
        scope: 'current_api',
        fulfillment_enabled: enabled(env.TG_FULFILLMENT_ENABLED),
        provider_configured: Boolean(String(env.GRAMIX_API_KEY || '').trim()),
        worker_status: 'unverified'
    };
}

async function queryBalance(client, order, now) {
    const result = (data) => ({ checked_at: now().toISOString(), ...data });
    try {
        if (typeof client.getBalance !== 'function') return result({ status: 'unavailable', message: '当前查询客户端不支持余额检查。' });
        const response = await client.getBalance({ timeoutMs: REQUEST_TIMEOUT_MS });
        const valid = (value) => typeof value === 'string' && value.length <= 40 && isDecimalString(value);
        if (response?.statusCode !== 200 || !valid(response?.data?.usdt) || !valid(response?.data?.gram)) {
            return result({ status: 'unavailable', message: '上游余额响应无效，余额尚未确认。' });
        }
        const currency = ['usdt', 'gram'].includes(order.provider_payment_currency) ? order.provider_payment_currency : null;
        const balances = { usdt: response.data.usdt.trim(), gram: response.data.gram.trim() };
        const zero = currency ? /^0(?:\.0+)?$/.test(balances[currency]) : null;
        return result({ status: 'available', balances, payment_currency: currency, payment_balance_zero: zero,
            message: zero ? `当前上游 ${currency.toUpperCase()} 余额为 0，请核对对应账户资金；此结果不能代替原提交的错误或扣款记录。`
                : '此处为当前上游余额，不能据此认定原提交成功或失败。' });
    } catch (error) {
        return result({ status: 'unavailable', message: '当前余额检查未完成，原订单查单结果仍独立保留。', error: describeGramixError(error) });
    }
}

async function queryUpstreamStatus({ order, env = process.env, clientFactory = createGramixClient, now = () => new Date() } = {}) {
    let searched = null;
    let balancePromise = Promise.resolve(null);
    const recordedError = recordedErrorDiagnostic(order);
    const result = async (status, extra = {}) => ({
        checked_at: now().toISOString(), verified: status === 'verified', status,
        message: MESSAGES[status], reason: null, snapshot: null,
        ...(searched ? { search: { ...searched } } : {}), ...extra,
        diagnostics: { recorded_error: recordedError, balance: await balancePromise }
    });
    if (order.provider && order.provider !== 'gramix') return result('unsupported');
    if (!order.provider_order_id && !order.submitted_at) return result('not_submitted');
    if (order.provider_order_id && !UUID.test(order.provider_order_id)) return result('mismatch', { reason: 'tg_provider_order_invalid' });
    if (!order.provider_order_id && (typeof order.provider_idempotency_key !== 'string' || !order.provider_idempotency_key.trim())) {
        return result('submission_unknown', { reason: 'tg_provider_correlation_missing' });
    }
    try {
        const client = clientFactory({ env });
        if (order.last_error_code || order.status === 'manual_review') balancePromise = queryBalance(client, order, now);
        let providerId = order.provider_order_id;
        const lookup = providerId ? 'saved_id' : 'submission_key';
        if (!providerId) {
            // Search is bounded and read-only. A matching username, amount or
            // timestamp alone cannot identify an uncertain submission.
            searched = { pages: 0, scanned: 0, exhausted: false, missing_correlation: false };
            const matches = new Set();
            for (let page = 0; page < MAX_PAGES; page++) {
                const response = await client.listOrders({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, timeoutMs: REQUEST_TIMEOUT_MS });
                const value = response?.data;
                if (response?.statusCode !== 200 || !value || Array.isArray(value) || !Array.isArray(value.data)
                    || value.data.length > PAGE_SIZE || !Number.isSafeInteger(value.total) || value.total < 0
                    || value.limit !== PAGE_SIZE || value.offset !== page * PAGE_SIZE
                    || value.data.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
                    return result('unavailable', { reason: 'gramix_invalid_response' });
                }
                searched.pages++; searched.scanned += value.data.length;
                for (const entry of value.data) {
                    if (typeof entry.idempotencyKey !== 'string') searched.missing_correlation = true;
                    if (entry.idempotencyKey !== order.provider_idempotency_key) continue;
                    if (!UUID.test(String(entry.id || ''))) return result('mismatch', { reason: 'tg_provider_order_invalid' });
                    matches.add(entry.id.toLowerCase());
                }
                if (matches.size > 1) return result('mismatch', { reason: 'tg_provider_duplicate_correlation' });
                if (value.offset + value.data.length >= value.total) { searched.exhausted = true; break; }
                if (value.data.length < PAGE_SIZE) break;
            }
            if (!matches.size) return result(!searched.exhausted ? 'search_limited' : searched.missing_correlation ? 'submission_unknown' : 'not_found');
            providerId = [...matches][0];
        }
        const response = await client.getOrder(providerId, { timeoutMs: REQUEST_TIMEOUT_MS });
        const checked = normalizeOrderSnapshot(response, { ...order, provider_order_id: providerId });
        return result(checked.valid ? 'verified' : 'mismatch', {
            lookup, reason: checked.reason || null, snapshot: checked.valid ? checked.snapshot : null
        });
    } catch (error) {
        const reason = SAFE_ERRORS.has(error?.code) ? error.code : 'tg_provider_query_failed';
        return result(reason === 'gramix_configuration_error' ? 'unconfigured' : 'unavailable', {
            reason, error: describeGramixError(error),
            ...(reason === 'gramix_http_error' && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
                ? { http_status: error.statusCode } : {})
        });
    }
}

module.exports = { queryUpstreamStatus, fulfillmentRuntime };
