'use strict';

const crypto = require('node:crypto');
const { createGramixClient, isDecimalString, normalizeRecipient } = require('./gramix-client');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_STATES = new Set(['created', 'processing', 'completed', 'failed', 'canceled']);
const SAFE_ERROR_CODES = new Set([
    'gramix_timeout', 'gramix_network_error', 'gramix_http_error',
    'gramix_invalid_response', 'gramix_configuration_error'
]);

function enabled(value) {
    return value === true || /^(true|1)$/i.test(String(value ?? '').trim());
}

function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function safeErrorCode(error) {
    return SAFE_ERROR_CODES.has(error?.code) ? error.code : 'tg_provider_request_failed';
}

function orderProduct(order) {
    if (!order || typeof order !== 'object') return null;
    const family = order.product_family ?? 'telegram_premium';
    if (family === 'telegram_premium' && [3, 6, 12].includes(order.term_months) && order.stars_quantity == null) {
        return { product_family: family, term_months: order.term_months, stars_quantity: null };
    }
    if (family === 'telegram_stars' && order.term_months === null
        && Number.isSafeInteger(order.stars_quantity) && order.stars_quantity >= 50 && order.stars_quantity <= 1000000) {
        return { product_family: family, term_months: null, stars_quantity: order.stars_quantity };
    }
    return null;
}

function normalizeOrderSnapshot(providerOrder, localOrder) {
    const product = orderProduct(localOrder);
    if (!product) return { valid: false, reason: 'tg_order_product_invalid', snapshot: {} };
    const detail = providerOrder?.data;
    if (providerOrder?.statusCode !== 200 || !detail || typeof detail !== 'object' || Array.isArray(detail)) {
        return { valid: false, reason: 'tg_provider_order_invalid', snapshot: {} };
    }

    let username;
    try { username = normalizeRecipient(detail.recipientName); } catch (_) { username = null; }
    const isStars = product.product_family === 'telegram_stars';
    const expectedType = isStars ? 'stars' : `premium_${product.term_months}_month`;
    // The official order GET schema reports Stars quantity only in
    // extraData.quantityStars; top-level quantity/stars are not evidence.
    const returnedStars = detail.extraData?.quantityStars;
    const quantityMatches = !isStars || (Number.isSafeInteger(returnedStars) && returnedStars === product.stars_quantity);
    const idempotencyMatches = detail.idempotencyKey == null
        ? null : detail.idempotencyKey === localOrder.provider_idempotency_key;
    // Gramix order GET calls USDT-denominated orders "usd". Verify against
    // the currency persisted before submission, never today's worker config.
    const expectedCurrency = localOrder.provider_payment_currency === 'usdt' ? 'usd'
        : localOrder.provider_payment_currency === 'gram' ? 'gram' : null;
    const providerStatus = PROVIDER_STATES.has(detail.status) ? detail.status : null;
    const snapshot = {
        verified_by: 'order_get',
        provider_order_id: UUID_PATTERN.test(String(detail.id || '')) ? String(detail.id).toLowerCase() : null,
        provider_status: providerStatus,
        completed: providerStatus === 'completed',
        telegram_username: username,
        product_family: detail.type === expectedType ? product.product_family : null,
        term_months: !isStars && detail.type === expectedType ? product.term_months : null,
        stars_quantity: isStars && detail.type === expectedType && quantityMatches ? returnedStars : null,
        product_type: detail.type === 'stars' || /^premium_(3|6|12)_month$/.test(String(detail.type)) ? detail.type : null,
        method: detail.method === 'api' ? 'api' : null,
        idempotency_key_matches: idempotencyMatches
    };
    if (isDecimalString(detail.amount)) snapshot.amount = detail.amount;
    if (['gram', 'usd'].includes(detail.currency)) snapshot.currency = detail.currency;

    const valid = snapshot.provider_order_id === String(localOrder.provider_order_id || '').toLowerCase()
        && username === String(localOrder.telegram_username || '').toLowerCase()
        && detail.type === expectedType && quantityMatches && detail.method === 'api'
        && expectedCurrency !== null && detail.currency === expectedCurrency
        && isDecimalString(detail.amount)
        && idempotencyMatches !== false && providerStatus !== null;
    return { valid, reason: valid ? null : 'tg_provider_order_mismatch', snapshot };
}

function createTgWorker({ supabase, client, env = process.env, now = () => Date.now(), leaseTokenFactory = () => crypto.randomUUID() } = {}) {
    if (!supabase || typeof supabase.rpc !== 'function') throw new Error('TG worker requires a server-side database client');
    const pollSeconds = boundedInteger(env.TG_FULFILLMENT_POLL_SECONDS, 15, 5, 3600);
    const leaseSeconds = boundedInteger(env.TG_FULFILLMENT_LEASE_SECONDS, 120, 30, 600);
    let provider = client;

    async function rpc(name, params) {
        let result;
        try { result = await supabase.rpc(name, params); } catch (_) {
            const error = new Error('TG worker database operation failed');
            error.code = 'tg_worker_database_error';
            throw error;
        }
        if (result?.error) {
            const error = new Error('TG worker database operation failed');
            error.code = 'tg_worker_database_error';
            throw error;
        }
        return result?.data;
    }

    function nextAttempt(order) {
        const attempt = boundedInteger(order?.attempt_count, 1, 1, 10000);
        const delay = Math.min(3600, pollSeconds * 2 ** Math.min(6, Math.max(0, attempt - 1)));
        return new Date(now() + delay * 1000).toISOString();
    }

    async function finish(order, state, { providerOrderId = order.provider_order_id || null, snapshot = {}, errorCode = null, errorMessage = null } = {}) {
        const result = await rpc('fn_tg_finish_order', {
            p_order_id: order.id,
            p_lease_token: order.lease_token,
            p_state: state,
            p_provider_order_id: providerOrderId,
            p_provider_snapshot: snapshot,
            p_error_code: errorCode,
            p_error_message: errorMessage,
            p_next_attempt_at: ['processing', 'retry_waiting'].includes(state) ? nextAttempt(order) : null
        });
        if (result?.success !== true) return {
            success: false, processed: false,
            code: result?.code || 'tg_order_result_rejected', order_id: order.id
        };
        return { success: true, processed: true, status: result.status || state, order_id: order.id };
    }

    async function purchase(order) {
        const paymentCurrency = env.GRAMIX_PAYMENT_CURRENCY || 'usdt';
        if (!['gram', 'usdt'].includes(paymentCurrency)) return finish(order, 'manual_review', {
            errorCode: 'tg_payment_currency_invalid', errorMessage: '上游扣款币种未确认，尚未提交购买'
        });
        // Persist the submission marker before crossing the network boundary.
        // A crash after this point cannot reclaim the order for another buy.
        const marked = await rpc('fn_tg_mark_submitted', {
            p_order_id: order.id, p_lease_token: order.lease_token, p_payment_currency: paymentCurrency
        });
        if (marked?.success !== true || marked.payment_currency !== paymentCurrency) return {
            success: false, processed: false, code: 'tg_submission_marker_rejected'
        };
        let response;
        try {
            provider ||= createGramixClient({ env });
            const input = {
                recipientName: order.telegram_username,
                paymentCurrency: marked.payment_currency,
                idempotencyKey: order.provider_idempotency_key
            };
            response = order.product_family === 'telegram_stars'
                ? await provider.purchaseStars({ ...input, stars: order.stars_quantity })
                : await provider.purchasePremium({ ...input, duration: order.term_months });
        } catch (error) {
            // Even a timeout may have created and charged an upstream order.
            // Keep the code locked for reconciliation instead of buying again.
            return finish(order, 'manual_review', {
                errorCode: safeErrorCode(error), errorMessage: '上游订单提交结果尚未确认，等待人工核查'
            });
        }
        const data = response?.data;
        if (response?.statusCode !== 201 || !UUID_PATTERN.test(String(data?.orderId || ''))
            || !PROVIDER_STATES.has(data?.status)
            || data?.idempotencyKey !== order.provider_idempotency_key) {
            return finish(order, 'manual_review', {
                errorCode: 'tg_provider_create_response_invalid', errorMessage: '上游订单受理结果无效，等待人工核查'
            });
        }
        // HTTP 201 confirms acceptance, never delivery. A later GET must
        // confirm recipient, product, duration and completed status together.
        return finish(order, 'processing', {
            providerOrderId: data.orderId.toLowerCase(),
            snapshot: { provider_order_id: data.orderId.toLowerCase(), provider_status: data.status, completed: false }
        });
    }

    async function poll(order) {
        if (!['gram', 'usdt'].includes(order.provider_payment_currency)) return finish(order, 'manual_review', {
            errorCode: 'tg_payment_currency_unconfirmed', errorMessage: '历史订单扣款币种未确认，等待人工核查'
        });
        let response;
        try {
            provider ||= createGramixClient({ env });
            response = await provider.getOrder(order.provider_order_id);
        } catch (error) {
            return finish(order, error?.retryable === true ? 'retry_waiting' : 'manual_review', {
                errorCode: safeErrorCode(error), errorMessage: '上游订单状态查询未完成，尚未确认兑换成功'
            });
        }
        const checked = normalizeOrderSnapshot(response, order);
        if (!checked.valid) return finish(order, 'manual_review', {
            snapshot: checked.snapshot, errorCode: checked.reason,
            errorMessage: '上游订单与当前兑换权益不一致，等待人工核查'
        });
        const status = checked.snapshot.provider_status;
        if (status === 'completed') return finish(order, 'succeeded', { snapshot: checked.snapshot });
        if (status === 'failed' || status === 'canceled') return finish(order, 'failed', {
            snapshot: checked.snapshot, errorCode: 'tg_provider_order_failed', errorMessage: '上游未完成本次兑换，请联系客服处理'
        });
        return finish(order, 'processing', { snapshot: checked.snapshot });
    }

    return {
        async runOnce({ orderId = null } = {}) {
            if (!enabled(env.TG_FULFILLMENT_ENABLED)) return { success: true, processed: false, disabled: true };
            const claim = await rpc('fn_tg_claim_fulfillment_order', {
                p_order_id: orderId,
                p_lease_token: leaseTokenFactory(),
                p_lease_seconds: leaseSeconds,
                p_product_families: ['telegram_premium', 'telegram_stars'],
                p_order_sources: ['redemption', 'purchase']
            });
            if (!claim?.success || !claim.order) return {
                success: claim?.success !== false || claim?.code === 'no_order',
                processed: false,
                code: claim?.code || null
            };
            const order = claim.order;
            if (!order.id || !order.lease_token) return { success: false, processed: false, code: 'tg_claim_invalid' };
            if (!orderProduct(order)) return finish(order, 'manual_review', {
                errorCode: 'tg_order_product_invalid', errorMessage: '订单兑换权益无法确认，尚未提交购买'
            });
            if (claim.action === 'buy' && !order.provider_order_id && !order.submitted_at
                && order.provider_payment_currency == null) return purchase(order);
            if (claim.action === 'poll' && UUID_PATTERN.test(String(order.provider_order_id || ''))) return poll(order);
            return finish(order, 'manual_review', { errorCode: 'tg_order_action_invalid', errorMessage: '订单提交状态无法确认，等待人工核查' });
        }
    };
}

module.exports = { createTgWorker, normalizeOrderSnapshot, enabled };
