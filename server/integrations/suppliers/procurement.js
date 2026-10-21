'use strict';

const crypto = require('node:crypto');

// No provider endpoints, timers or startup hooks live here. Both public adapters
// deliberately lack this contract until their merchant evidence is verified.
const CONTRACT = Object.freeze({
    version: 'shop-supplier-dispatch-v1',
    requestLookup: 'original_request_id',
    requestKey: 'unique_immutable',
    rejection: 'request_key_final',
    costCeiling: 'atomic_cny_max',
    currency: 'CNY',
    responses: 'identity_bound_nonsecret'
});
const CONTRACT_HASH = crypto.createHash('sha256').update(JSON.stringify(CONTRACT)).digest('hex');
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const HASH = /^[a-f\d]{64}$/;
const STATES = new Set(['prepared', 'dispatching', 'outcome_unknown', 'accepted', 'rejected', 'review']);

function protocolError(code = 'supplier_dispatch_unavailable') {
    // Do not expose database errors, upstream payloads, credentials or tokens.
    return Object.assign(new Error(code), { code });
}
function assertAdapter(adapter, providerId) {
    if (adapter?.providerId !== providerId || adapter.capabilities?.procurement !== true
        || adapter.capabilities?.requestLookup !== true
        || typeof adapter.createPurchase !== 'function' || typeof adapter.queryPurchase !== 'function'
        || !adapter.procurementContract
        || Object.keys(adapter.procurementContract).length !== Object.keys(CONTRACT).length
        || Object.entries(CONTRACT).some(([key, value]) => adapter.procurementContract[key] !== value)) {
        throw protocolError('supplier_dispatch_contract_unverified');
    }
}
function validateTicket(ticket, intentId) {
    if (!ticket || ticket.intentId !== intentId || !UUID.test(ticket.attemptId)
        || !UUID.test(ticket.token) || !UUID.test(ticket.request?.requestId)
        || !UUID.test(ticket.account?.id) || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(ticket.account.provider_id || '')
        || typeof ticket.account.credential_ref !== 'string'
        || !/^env:[A-Z][A-Z0-9_]{0,119}$/.test(ticket.account.credential_ref)
        || ticket.contractHash !== CONTRACT_HASH || !HASH.test(ticket.evidenceHash || '')
        || ticket.request.quantity !== 1 || typeof ticket.request.goodsNo !== 'string'
        || !ticket.request.goodsNo.trim() || ticket.request.goodsNo.length > 160
        || ticket.request.goodsNo !== ticket.request.goodsNo.trim()
        || ticket.request.maxCost?.currency !== 'CNY'
        || typeof ticket.request.maxCost.amount !== 'string'
        || !/^\d{1,12}(?:\.\d{1,6})?$/.test(ticket.request.maxCost.amount)
        || !/[1-9]/.test(ticket.request.maxCost.amount)
        || !ticket.request.variant || Array.isArray(ticket.request.variant)
        || typeof ticket.request.variant !== 'object'
        || Object.keys(ticket.request.variant).some(key => key !== 'race')
        || (Object.hasOwn(ticket.request.variant, 'race') && (typeof ticket.request.variant.race !== 'string'
            || !ticket.request.variant.race.trim() || ticket.request.variant.race.length > 160
            || ticket.request.variant.race !== ticket.request.variant.race.trim()))) {
        throw protocolError('supplier_dispatch_invalid_ticket');
    }
    return ticket;
}
function normalizeResult(raw, ticket) {
    const unknown = { outcome: 'unknown', requestId: ticket.request.requestId, code: 'outcome_unknown' };
    if (!raw || raw.requestId !== ticket.request.requestId || raw.accountId !== ticket.account.id) return unknown;
    if (raw.outcome === 'not_found') return { ...unknown, code: 'not_found' };
    if (!HASH.test(raw.evidenceHash || '')) return unknown;
    if (raw.outcome === 'accepted' && typeof raw.orderNo === 'string'
        && raw.orderNo.trim() === raw.orderNo && /^[\p{L}\p{N}._:-]{1,160}$/u.test(raw.orderNo)) {
        // An accepted/paid purchase is NOT a delivery receipt. No secrets,
        // amounts, provider messages or raw response fields cross this boundary.
        return { outcome: 'accepted', requestId: ticket.request.requestId,
            orderNo: raw.orderNo, evidenceHash: raw.evidenceHash, code: 'accepted' };
    }
    if (raw.outcome === 'rejected' && raw.definitivelyNotAccepted === true) {
        return { outcome: 'rejected', requestId: ticket.request.requestId,
            evidenceHash: raw.evidenceHash, code: 'explicitly_not_accepted' };
    }
    return unknown;
}
function disposition(result = {}) {
    return { status: STATES.has(result.status) ? result.status : 'blocked',
        applied: result.applied === true, acquired: result.acquired === true };
}

function createProcurementRunner({ db, resolveAdapter, env = process.env } = {}) {
    if (typeof db?.rpc !== 'function' || typeof resolveAdapter !== 'function') throw protocolError();
    async function rpc(action, intentId, params = {}) {
        let response;
        try { response = await db.rpc('fn_shop_supplier_dispatch_v2', {
            p_action: action, p_intent_id: intentId, ...params
        }); } catch { throw protocolError(); }
        if (response?.error) throw protocolError();
        const data = Array.isArray(response?.data) ? response.data[0] : response?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw protocolError();
        return data;
    }
    async function run(intentId, mode) {
        if (!UUID.test(String(intentId))) throw protocolError('supplier_dispatch_invalid_intent');
        const enabled = mode === 'dispatch' ? env.SHOP_SUPPLIER_DISPATCH_V2_ENABLED : env.SHOP_SUPPLIER_RECONCILE_V2_ENABLED;
        if (String(enabled || '').toLowerCase() !== 'true') return { status: 'disabled', applied: false, acquired: false };
        const preparation = await rpc(mode === 'dispatch' ? 'prepare' : 'claim_query', intentId, { p_contract_hash: CONTRACT_HASH });
        if (preparation.acquired !== true) return disposition(preparation);
        const ticket = validateTicket(preparation.ticket, intentId);
        let adapter;
        try {
            adapter = await resolveAdapter(ticket.account);
            assertAdapter(adapter, ticket.account.provider_id);
        } catch {
            // A prepared lease may safely expire without sending. A query lease
            // also expires; neither path authorizes another create request.
            return { status: mode === 'dispatch' ? 'prepared' : 'outcome_unknown', applied: false, acquired: true,
                reason: 'supplier_dispatch_contract_unverified' };
        }
        if (mode === 'dispatch') {
            // This RPC MUST commit and return an explicit acknowledgement before
            // HTTP. Lost/truncated acknowledgements never result in submission.
            let begun;
            try {
                begun = await rpc('begin', intentId, { p_token: ticket.token, p_contract_hash: CONTRACT_HASH });
            } catch {
                return { status: 'outcome_unknown', applied: false, acquired: true };
            }
            if (begun.applied !== true || begun.status !== 'dispatching') return disposition(begun);
        }
        let raw;
        try {
            raw = mode === 'dispatch'
                ? await adapter.createPurchase(structuredClone(ticket.request))
                : await adapter.queryPurchase({ requestId: ticket.request.requestId,
                    orderNo: ticket.orderNo || null, accountId: ticket.account.id });
        } catch {
            // Even retryable/"not found"/timeout errors cannot prove no debit.
            raw = null;
        }
        const normalized = normalizeResult(raw, ticket);
        try {
            return disposition(await rpc('record', intentId, { p_token: ticket.token, p_result: normalized }));
        } catch {
            // Request may already have succeeded. Do not invoke createPurchase
            // again or invent a success when persistence cannot be confirmed.
            return { status: 'outcome_unknown', applied: false, acquired: true };
        }
    }
    return Object.freeze({ dispatch: intentId => run(intentId, 'dispatch'), reconcile: intentId => run(intentId, 'query') });
}

module.exports = { CONTRACT, CONTRACT_HASH, createProcurementRunner, normalizeResult, validateTicket };
