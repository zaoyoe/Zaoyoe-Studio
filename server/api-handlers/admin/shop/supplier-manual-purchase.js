'use strict';

const crypto = require('node:crypto');
const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { createConfiguredSupplierAdapterRegistry } = require('../../../integrations/suppliers/registry');
const { sealDelivery } = require('../../../integrations/suppliers/delivery');

// Operator-controlled manual purchase (Plan B).
//
// The server never trades on its own here: an administrator asks for a live
// quote, sees the exact CNY amount, and only an explicit confirmation for that
// exact amount authorises the single trade request. The supplier request key is
// the intent's immutable original request id, so a retry can never debit twice.
//
// This module deliberately does not consult or relax the four automated
// dispatch gates. `dispatch_enabled` stays off and `capabilities.procurement`
// stays false; the manual path calls the adapter methods directly.

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const MONEY = /^\d{1,12}(?:\.\d{1,6})?$/;
const FAILURE_CODE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const ACTIONS = new Set(['context', 'quote', 'confirm', 'finalize']);

const MESSAGES = {
    supplier_manual_disabled: '人工采购尚未启用，请联系运维打开开关后再试',
    supplier_manual_unavailable: '采购服务暂不可用，请稍后重试；已提交的采购请先查询结果',
    supplier_manual_invalid_request: '请提供完整且一致的采购信息',
    supplier_manual_intent_missing: '未找到这笔订单的采购记录，请刷新后重试',
    supplier_manual_purchase_missing: '未找到这次报价记录，请重新报价',
    supplier_manual_not_ready: '当前订单还不满足人工采购条件，请先核对订单状态',
    supplier_manual_quote_failed: '暂时无法从上游获取报价，请稍后重试',
    supplier_manual_quote_stale: '报价已过期或金额已变化，请重新报价后再确认',
    supplier_manual_claimed_elsewhere: '这笔采购已被其他操作接管，请刷新后核对结果',
    supplier_manual_debit_uncertain: '上游响应未能确认，已登记为待核对；请先查询上游结果，不要重复采购',
    supplier_manual_delivery_missing: '上游已受理但暂未返回卡密，请稍后使用“完成入账”重试',
    supplier_manual_record_failed: '上游已受理，但本次入账尚未完成；请使用“完成入账”重试，不要重新采购',
    supplier_manual_state_conflict: '当前采购状态不允许此操作，请刷新后重试'
};

function failure(code, statusCode = 503, message = null) {
    return Object.assign(new Error(message || MESSAGES[code] || MESSAGES.supplier_manual_unavailable), {
        code,
        statusCode
    });
}

function text(value, max = 200) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isEnabled(env) {
    return String(env?.SHOP_SUPPLIER_MANUAL_PURCHASE_ENABLED || '').toLowerCase() === 'true';
}

function requireAdapterMethod(adapter, name) {
    if (!adapter || typeof adapter[name] !== 'function') {
        throw failure('supplier_manual_unavailable', 503, '当前供应商账号不支持人工采购，请检查供货配置');
    }
    return adapter;
}

async function rpc(db, name, params) {
    const response = await db.rpc(name, params);
    if (response?.error) throw failure('supplier_manual_unavailable');
    const data = response?.data;
    return Array.isArray(data) ? data[0] : data;
}

// The intent row is the only source of the account and the immutable request
// key. Nothing is taken from the request body except identifiers and the amount
// the administrator literally read on screen.
async function loadIntentContext(db, intentId) {
    if (!UUID.test(intentId || '')) throw failure('supplier_manual_invalid_request', 400);
    const { data: intent, error: intentError } = await db
        .from('shop_supplier_procurement_intents')
        .select('id, unit_id, supplier_account_id, original_request_id, status')
        .eq('id', intentId)
        .maybeSingle();
    if (intentError) throw failure('supplier_manual_unavailable');
    if (!intent) throw failure('supplier_manual_intent_missing', 404);
    const { data: account, error: accountError } = await db
        .from('shop_supplier_accounts')
        .select('id, provider_id, credential_ref, is_enabled, account_key')
        .eq('id', intent.supplier_account_id)
        .maybeSingle();
    if (accountError) throw failure('supplier_manual_unavailable');
    if (!account || account.is_enabled !== true) {
        throw failure('supplier_manual_not_ready', 409, '供应商账号未启用，无法人工采购');
    }
    return { intent, account };
}

function resolveAdapter(account) {
    let registry;
    try {
        registry = createConfiguredSupplierAdapterRegistry({ account });
    } catch {
        throw failure('supplier_manual_unavailable', 503, '供应商凭据不可用，请检查环境配置');
    }
    const adapter = registry.get(account.provider_id);
    if (!adapter) throw failure('supplier_manual_unavailable', 503, '当前供应商适配器未注册');
    return adapter;
}

async function loadPurchase(db, purchaseId) {
    if (!UUID.test(purchaseId || '')) throw failure('supplier_manual_invalid_request', 400);
    const { data, error } = await db
        .from('shop_supplier_manual_purchases')
        .select('id, intent_id, unit_id, supplier_account_id, original_request_id, state, attempt_count, quoted_amount_cny, cost_ceiling_cny, quote_expires_at, supplier_order_no, actual_amount_cny')
        .eq('id', purchaseId)
        .maybeSingle();
    if (error) throw failure('supplier_manual_unavailable');
    if (!data) throw failure('supplier_manual_purchase_missing', 404);
    return data;
}

function summarizeContext(projection) {
    if (!projection || typeof projection !== 'object') throw failure('supplier_manual_unavailable');
    return {
        status: projection.status === 'ready' ? 'ready' : 'blocked',
        reason: text(projection.reason, 64) || null,
        intentId: projection.intentId || null,
        nativeOrderId: projection.nativeOrderId || null,
        fundingKind: projection.fundingKind || null,
        site: projection.site || null,
        goodsNo: text(projection.goodsNo, 160) || null,
        variant: projection.variant && typeof projection.variant === 'object' ? projection.variant : {},
        quantity: 1,
        costCeilingCny: typeof projection.costCeilingCny === 'string' ? projection.costCeilingCny : null,
        perUnitCeilingCny: typeof projection.perUnitCeilingCny === 'string' ? projection.perUnitCeilingCny : null,
        providerId: text(projection.providerId, 64) || null,
        purchaseId: projection.purchaseId || null,
        purchaseState: text(projection.purchaseState, 32) || null,
        attemptCount: Number.isInteger(projection.attemptCount) ? projection.attemptCount : 0,
        quotedAmountCny: typeof projection.quotedAmountCny === 'string' ? projection.quotedAmountCny : null,
        quoteExpiresAt: projection.quoteExpiresAt || null,
        supplierOrderNo: text(projection.supplierOrderNo, 160) || null
    };
}

// A manual attempt is only finalisable when the supplier already returned an
// order number but the receipt is still missing.
function canFinalize(purchase) {
    return purchase?.state === 'confirmed' && Boolean(text(purchase.supplier_order_no, 160));
}

async function actionContext(db, intentId) {
    const projection = await rpc(db, 'fn_shop_supplier_manual_context_v2', { p_intent_id: intentId });
    const context = summarizeContext(projection);
    const purchase = context.purchaseId ? await loadPurchase(db, context.purchaseId).catch(() => null) : null;
    return { ...context, canFinalize: canFinalize(purchase) };
}

async function actionQuote(db, { intentId, adminId }) {
    const context = await actionContext(db, intentId);
    if (context.status !== 'ready') {
        return { status: 'blocked', reason: context.reason || 'not_ready', context };
    }
    const { account } = await loadIntentContext(db, intentId);
    const adapter = requireAdapterMethod(resolveAdapter(account), 'quotePrice');
    let quote;
    try {
        quote = await adapter.quotePrice({
            goodsNo: context.goodsNo,
            quantity: 1,
            variant: context.variant
        });
    } catch {
        throw failure('supplier_manual_quote_failed', 502, MESSAGES.supplier_manual_quote_failed);
    }
    const amount = typeof quote?.amount === 'string' ? quote.amount : '';
    if (!MONEY.test(amount) || String(quote?.currency || '').toUpperCase() !== 'CNY') {
        throw failure('supplier_manual_quote_failed', 502, MESSAGES.supplier_manual_quote_failed);
    }
    const recorded = await rpc(db, 'fn_shop_supplier_manual_quote_v2', {
        p_intent_id: intentId,
        p_admin_id: adminId,
        p_quoted_amount_cny: amount
    });
    if (recorded?.status !== 'quoted') {
        return { status: 'blocked', reason: text(recorded?.reason, 64) || 'not_ready', context };
    }
    return {
        status: 'quoted',
        purchaseId: recorded.purchaseId,
        quotedAmountCny: recorded.quotedAmountCny,
        quoteCurrency: recorded.quoteCurrency,
        quoteExpiresAt: recorded.quoteExpiresAt,
        costCeilingCny: recorded.costCeilingCny,
        attemptCount: recorded.attemptCount,
        overCeiling: recorded.overCeiling === true,
        goodsNo: text(recorded.goodsNo, 160),
        providerId: text(recorded.providerId, 64),
        context
    };
}

function evidenceFor(requestId, orderNo, amount, status) {
    return crypto.createHash('sha256')
        .update(JSON.stringify({ requestId, orderNo, amount, status }))
        .digest('hex');
}

async function recordOutcome(db, { purchaseId, adminId, outcome, tradeNo, actualAmountCny, evidenceHash, sealed, failureCode }) {
    return rpc(db, 'fn_shop_supplier_manual_record_v2', {
        p_purchase_id: purchaseId,
        p_admin_id: adminId,
        p_outcome: outcome,
        p_trade_no: tradeNo || null,
        p_actual_amount_cny: actualAmountCny || null,
        p_evidence_hash: evidenceHash || null,
        p_sealed: sealed || null,
        p_failure_code: failureCode || null
    });
}

// Turns the supplier answer into a recorded outcome. Never called twice for the
// same attempt: `record` is idempotent on the stored result hash.
async function settleAccepted(db, { purchase, adapter, orderNo, actualAmountCny, evidenceHash, adminId }) {
    const delivery = await adapter.fetchDelivery({
        requestId: purchase.original_request_id,
        orderNo
    }).catch(() => null);
    if (!delivery || typeof delivery.content !== 'string' || !delivery.content.trim()) {
        await recordOutcome(db, {
            purchaseId: purchase.id,
            adminId,
            outcome: 'unknown',
            failureCode: 'supplier_delivery_missing'
        });
        return {
            status: 'unknown',
            reason: 'supplier_delivery_missing',
            supplierOrderNo: orderNo,
            message: MESSAGES.supplier_manual_delivery_missing
        };
    }
    let sealed;
    try {
        sealed = sealDelivery(delivery.content, {
            unitId: purchase.unit_id,
            intentId: purchase.intent_id,
            site: 'cn',
            orderNo
        });
    } catch {
        await recordOutcome(db, {
            purchaseId: purchase.id,
            adminId,
            outcome: 'unknown',
            failureCode: 'supplier_delivery_seal_failed'
        });
        return {
            status: 'unknown',
            reason: 'supplier_delivery_seal_failed',
            supplierOrderNo: orderNo,
            message: '卡密已取回但未能安全封存，请联系运维核对后再入账'
        };
    }
    let recorded;
    try {
        recorded = await recordOutcome(db, {
            purchaseId: purchase.id,
            adminId,
            outcome: 'accepted',
            tradeNo: orderNo,
            actualAmountCny,
            evidenceHash,
            sealed
        });
    } catch {
        throw failure('supplier_manual_record_failed', 503, MESSAGES.supplier_manual_record_failed);
    }
    return {
        status: recorded?.status === 'delivered' ? 'delivered' : 'quarantined',
        reason: recorded?.status === 'delivered' ? null : 'delivery_quarantined',
        supplierOrderNo: orderNo,
        actualAmountCny
    };
}

async function actionConfirm(db, { purchaseId, quotedAmountCny, adminId }) {
    if (!MONEY.test(quotedAmountCny || '')) throw failure('supplier_manual_invalid_request', 400);
    const before = await loadPurchase(db, purchaseId);
    const claimed = await rpc(db, 'fn_shop_supplier_manual_confirm_v2', {
        p_purchase_id: purchaseId,
        p_admin_id: adminId,
        p_quoted_amount_cny: quotedAmountCny
    });
    if (claimed?.claimed !== true) {
        const reason = text(claimed?.reason, 64) || 'not_quoted';
        const stale = ['quote_expired', 'quote_amount_changed', 'manual_purchase_not_quoted'].includes(reason);
        return {
            status: 'not_claimed',
            reason,
            stale,
            purchaseState: text(claimed?.purchaseState, 32) || before.state,
            supplierOrderNo: text(claimed?.supplierOrderNo, 160) || null,
            canFinalize: Boolean(text(claimed?.supplierOrderNo, 160)),
            message: stale ? MESSAGES.supplier_manual_quote_stale : MESSAGES.supplier_manual_claimed_elsewhere
        };
    }

    const { account } = await loadIntentContext(db, before.intent_id);
    const adapter = requireAdapterMethod(resolveAdapter(account), 'createPurchase');

    let outcome;
    try {
        outcome = await adapter.createPurchase({
            requestId: claimed.requestId || before.original_request_id,
            goodsNo: claimed.goodsNo,
            quantity: 1,
            variant: claimed.variant && typeof claimed.variant === 'object' ? claimed.variant : {},
            maxCost: { currency: 'CNY', amount: claimed.costCeilingCny }
        });
    } catch (error) {
        // The trade call itself failed without a definitive answer: the debit may
        // or may not exist. Never retry here; park it for reconciliation.
        const code = FAILURE_CODE.test(String(error?.code || '')) ? String(error.code) : 'supplier_request_failed';
        await recordOutcome(db, { purchaseId, adminId, outcome: 'unknown', failureCode: code });
        return { status: 'unknown', reason: code, message: MESSAGES.supplier_manual_debit_uncertain };
    }

    if (outcome?.outcome === 'rejected') {
        const code = FAILURE_CODE.test(String(outcome.code || '')) ? String(outcome.code) : 'supplier_rejected';
        const recorded = await recordOutcome(db, { purchaseId, adminId, outcome: 'rejected', failureCode: code });
        return { status: 'rejected', reason: code, recorded: recorded?.status || 'rejected' };
    }
    if (outcome?.outcome === 'unknown') {
        const code = FAILURE_CODE.test(String(outcome.code || '')) ? String(outcome.code) : 'supplier_outcome_unknown';
        await recordOutcome(db, { purchaseId, adminId, outcome: 'unknown', failureCode: code });
        return { status: 'unknown', reason: code, message: MESSAGES.supplier_manual_debit_uncertain };
    }
    if (outcome?.outcome !== 'accepted' || !text(outcome.orderNo, 160) || !MONEY.test(outcome.actualAmountCny || '')) {
        await recordOutcome(db, { purchaseId, adminId, outcome: 'unknown', failureCode: 'supplier_invalid_response' });
        return { status: 'unknown', reason: 'supplier_invalid_response', message: MESSAGES.supplier_manual_debit_uncertain };
    }

    const orderNo = text(outcome.orderNo, 160);
    const actualAmountCny = outcome.actualAmountCny;
    const evidenceHash = /^[a-f0-9]{64}$/.test(outcome.evidenceHash || '')
        ? outcome.evidenceHash
        : evidenceFor(claimed.requestId || before.original_request_id, orderNo, actualAmountCny, 'accepted');

    // Persist the order number before anything else can fail: after this point a
    // crash is recoverable through `finalize` without a second trade request.
    const staged = await rpc(db, 'fn_shop_supplier_manual_stage_v2', {
        p_purchase_id: purchaseId,
        p_admin_id: adminId,
        p_trade_no: orderNo,
        p_actual_amount_cny: actualAmountCny,
        p_evidence_hash: evidenceHash
    });
    if (staged?.staged === false && staged?.supplierOrderNo && staged.supplierOrderNo !== orderNo) {
        throw failure('supplier_manual_state_conflict', 409);
    }

    const purchase = await loadPurchase(db, purchaseId);
    return settleAccepted(db, {
        purchase: { ...purchase, unit_id: purchase.unit_id, intent_id: purchase.intent_id },
        adapter,
        orderNo,
        actualAmountCny,
        evidenceHash,
        adminId
    });
}

async function actionFinalize(db, { purchaseId, adminId }) {
    const purchase = await loadPurchase(db, purchaseId);
    if (!canFinalize(purchase)) {
        return {
            status: 'not_finalizable',
            reason: purchase.state === 'confirmed' ? 'supplier_order_missing' : 'purchase_' + purchase.state,
            purchaseState: purchase.state,
            message: '这次采购还没有可入账的上游订单号'
        };
    }
    const { account } = await loadIntentContext(db, purchase.intent_id);
    const adapter = requireAdapterMethod(resolveAdapter(account), 'fetchDelivery');
    const orderNo = text(purchase.supplier_order_no, 160);
    const actualAmountCny = typeof purchase.actual_amount_cny === 'string'
        ? purchase.actual_amount_cny
        : String(purchase.actual_amount_cny || '');
    if (!MONEY.test(actualAmountCny)) {
        return { status: 'not_finalizable', reason: 'amount_missing', message: '这次采购缺少已确认的金额，请核对上游' };
    }
    const { data: events } = await db
        .from('shop_supplier_manual_purchase_events')
        .select('detail')
        .eq('purchase_id', purchaseId)
        .eq('event_kind', 'submitted')
        .order('created_at', { ascending: false })
        .limit(1);
    const stored = Array.isArray(events) && events[0]?.detail && typeof events[0].detail === 'object'
        ? events[0].detail
        : {};
    const evidenceHash = /^[a-f0-9]{64}$/.test(stored.evidenceHash || '')
        ? stored.evidenceHash
        : evidenceFor(purchase.original_request_id, orderNo, actualAmountCny, 'accepted');
    return settleAccepted(db, { purchase, adapter, orderNo, actualAmountCny, evidenceHash, adminId });
}

module.exports = async function supplierManualPurchase(req, res, options = {}) {
    const env = options.env || process.env;
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }
    if (!isEnabled(env)) {
        return sendJson(res, 503, { success: false, code: 'supplier_manual_disabled', message: MESSAGES.supplier_manual_disabled });
    }
    try {
        const { adminSupabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        if (!adminSupabase) throw failure('supplier_manual_unavailable');
        const body = await parseJsonBody(req);
        if (!body || Array.isArray(body) || typeof body !== 'object'
            || Object.keys(body).some((key) => !['action', 'intentId', 'purchaseId', 'quotedAmountCny', 'confirm'].includes(key))
            || !ACTIONS.has(body.action)) {
            return sendJson(res, 400, { success: false, code: 'supplier_manual_invalid_request', message: MESSAGES.supplier_manual_invalid_request });
        }
        if (body.action === 'confirm' && body.confirm !== true) {
            return sendJson(res, 400, { success: false, code: 'supplier_manual_invalid_request', message: '请先确认本次采购金额' });
        }

        let result;
        if (body.action === 'context') {
            result = await actionContext(adminSupabase, text(body.intentId, 40));
        } else if (body.action === 'quote') {
            result = await actionQuote(adminSupabase, { intentId: text(body.intentId, 40), adminId: user.id });
        } else if (body.action === 'confirm') {
            result = await actionConfirm(adminSupabase, {
                purchaseId: text(body.purchaseId, 40),
                quotedAmountCny: text(body.quotedAmountCny, 24),
                adminId: user.id
            });
        } else {
            result = await actionFinalize(adminSupabase, { purchaseId: text(body.purchaseId, 40), adminId: user.id });
        }

        if (body.action === 'confirm' || body.action === 'finalize') {
            // The procurement result is already committed. An auxiliary audit
            // failure must never turn it into an apparent failure.
            try {
                await writeAdminAuditLog({
                    supabase: adminSupabase,
                    adminId: user.id,
                    action: 'shop.supplier.manual_purchase',
                    targetType: 'shop_supplier_manual_purchase',
                    targetId: text(body.purchaseId, 40) || text(body.intentId, 40),
                    details: {
                        step: body.action,
                        status: result?.status || null,
                        reason: result?.reason || null,
                        supplierOrderNo: result?.supplierOrderNo || null,
                        actualAmountCny: result?.actualAmountCny || null
                    }
                });
            } catch { /* the immutable DB receipt is the authoritative audit */ }
        }

        return sendJson(res, 200, { success: true, result });
    } catch (error) {
        const status = Number(error?.statusCode) || 503;
        const code = error?.code || 'supplier_manual_unavailable';
        return sendJson(res, status, {
            success: false,
            code,
            message: MESSAGES[code] || (status >= 500 ? MESSAGES.supplier_manual_unavailable : error.message)
        });
    }
};
