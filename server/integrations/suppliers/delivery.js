'use strict';

const crypto = require('node:crypto');

// Read-only queries of the ORIGINAL procurement. This protocol never purchases,
// cancels, refunds, rewards or turns on a supplier account.
const CONTRACT = Object.freeze({
    version: 'shop-supplier-delivery-v1',
    identity: 'account_original_request_and_order',
    delivery: 'complete_single_text',
    cost: 'final_actual_cny',
    evidence: 'immutable_receipt'
});
const CONTRACT_HASH = crypto.createHash('sha256').update(JSON.stringify(CONTRACT)).digest('hex');
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const HASH = /^[a-f\d]{64}$/;
const MONEY = /^\d{1,12}(?:\.\d{1,6})?$/;
const KEY_ID = /^[a-zA-Z0-9_-]{1,40}$/;
function safeError(code = 'supplier_delivery_unavailable', statusCode = 503) {
    return Object.assign(new Error('供货内容暂不可用，请稍后重试或联系客服核对'), { code, statusCode });
}
function normalizeContent(value) {
    if (typeof value !== 'string') throw safeError('supplier_delivery_invalid_content');
    const result = value.replace(/\r\n?/g, '\n').trim();
    if (!result || Buffer.byteLength(result, 'utf8') > 32768 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) {
        throw safeError('supplier_delivery_invalid_content');
    }
    return result;
}
function independentSecret(value, env) {
    if (typeof value !== 'string' || value.length < 32 || value.trim() !== value
        || [env.SUPABASE_SERVICE_ROLE_KEY, env.CRON_SECRET, env.SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY]
            .filter(Boolean).includes(value)) throw safeError('supplier_delivery_keys_unavailable');
    return value;
}
function keyFor(keyId, env) {
    if (!KEY_ID.test(keyId || '')) throw safeError('supplier_delivery_keys_unavailable');
    let keys;
    try { keys = JSON.parse(env.SHOP_SUPPLIER_DELIVERY_KEYS || '{}'); } catch { throw safeError('supplier_delivery_keys_unavailable'); }
    const seed = independentSecret(keys?.[keyId], env);
    return crypto.createHash('sha256').update(seed, 'utf8').digest();
}
function fingerprint(content, env) {
    const seed = env.SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY;
    if (typeof seed !== 'string' || seed.length < 32 || seed.trim() !== seed
        || [env.SUPABASE_SERVICE_ROLE_KEY, env.CRON_SECRET].filter(Boolean).includes(seed)) {
        throw safeError('supplier_delivery_keys_unavailable');
    }
    return crypto.createHmac('sha256', seed).update(content, 'utf8').digest('hex');
}
function aad(context) {
    if (!UUID.test(context?.unitId) || !UUID.test(context?.intentId) || context.site !== 'cn'
        || !/^[\p{L}\p{N}._:-]{1,160}$/u.test(context.orderNo || '')) throw safeError('supplier_delivery_invalid_context');
    return Buffer.from(JSON.stringify(['supplier-delivery-v1', context.site, context.unitId, context.intentId, context.orderNo]));
}
function sealDelivery(value, context, env = process.env) {
    const content = normalizeContent(value);
    const keyId = env.SHOP_SUPPLIER_DELIVERY_ACTIVE_KEY;
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(keyId, env), nonce);
    cipher.setAAD(aad(context));
    const ciphertext = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
    return {
        version: 1, algorithm: 'aes-256-gcm', keyId, nonce: nonce.toString('base64'),
        ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
        fingerprint: fingerprint(content, env)
    };
}
function openDelivery(payload, context, env = process.env) {
    try {
        if (payload?.version !== 1 || payload.algorithm !== 'aes-256-gcm' || !HASH.test(payload.fingerprint || '')) throw safeError();
        const decode = (value, size) => {
            if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw safeError();
            const result = Buffer.from(value, 'base64');
            if (result.toString('base64') !== value || (size && result.length !== size)) throw safeError();
            return result;
        };
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(payload.keyId, env), decode(payload.nonce, 12));
        decipher.setAAD(aad(context));
        decipher.setAuthTag(decode(payload.tag, 16));
        const content = normalizeContent(Buffer.concat([decipher.update(decode(payload.ciphertext)), decipher.final()]).toString('utf8'));
        if (fingerprint(content, env) !== payload.fingerprint) throw safeError();
        return content;
    } catch { throw safeError('supplier_delivery_decrypt_failed'); }
}
function validateTicket(ticket, intentId) {
    if (!UUID.test(intentId) || ticket?.intentId !== intentId || !UUID.test(ticket.unitId)
        || !UUID.test(ticket.account?.id) || !UUID.test(ticket.requestId) || ticket.site !== 'cn'
        || ticket.contractHash !== CONTRACT_HASH || !HASH.test(ticket.proofHash || '')
        || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(ticket.account?.provider_id || '')
        || !/^env:[A-Z][A-Z0-9_]{0,119}$/.test(ticket.account?.credential_ref || '')
        || !/^[\p{L}\p{N}._:-]{1,160}$/u.test(ticket.orderNo || '')) throw safeError('supplier_delivery_invalid_ticket');
    return ticket;
}
function normalizeReceipt(raw, ticket) {
    if (!raw || raw.accountId !== ticket.account.id || raw.requestId !== ticket.requestId || raw.orderNo !== ticket.orderNo
        || raw.outcome !== 'delivered' || raw.completeDelivery !== true || raw.quantity !== 1
        || raw.finalCost !== true || raw.cost?.currency !== 'CNY' || typeof raw.cost.amount !== 'string'
        || !MONEY.test(raw.cost.amount) || !HASH.test(raw.evidenceHash || '')) return null;
    try {
        return { actualCostCny: raw.cost.amount, evidenceHash: raw.evidenceHash, content: normalizeContent(raw.content) };
    } catch { return null; }
}
function createDeliveryRunner({ db, resolveAdapter, env = process.env } = {}) {
    if (typeof db?.rpc !== 'function' || typeof resolveAdapter !== 'function') throw safeError();
    async function call(name, params) {
        let response;
        try { response = await db.rpc(name, params); } catch { throw safeError(); }
        if (response?.error) throw safeError();
        const data = Array.isArray(response?.data) ? response.data[0] : response?.data;
        if (!data || typeof data !== 'object') throw safeError();
        return data;
    }
    return {
        async reconcile(intentId) {
            if (env.SHOP_SUPPLIER_DELIVERY_V2_ENABLED !== 'true') return { status: 'disabled' };
            if (!UUID.test(intentId || '')) throw safeError('supplier_delivery_invalid_request', 400);
            const result = await call('fn_shop_supplier_delivery_ticket_v2', { p_intent_id: intentId, p_contract_hash: CONTRACT_HASH });
            if (['delivered', 'quarantined', 'awaiting_acceptance'].includes(result.status)) return { status: result.status };
            if (result.status !== 'ready') throw safeError('supplier_delivery_invalid_ticket');
            const ticket = validateTicket(result.ticket, intentId);
            let adapter;
            try { adapter = await resolveAdapter(ticket.account); } catch { throw safeError(); }
            if (adapter?.providerId !== ticket.account.provider_id || adapter.capabilities?.deliveryQuery !== true
                || typeof adapter.queryDelivery !== 'function' || !adapter.deliveryContract
                || Object.keys(adapter.deliveryContract).length !== Object.keys(CONTRACT).length
                || Object.entries(CONTRACT).some(([key, value]) => adapter.deliveryContract[key] !== value)) {
                throw safeError('supplier_delivery_contract_unverified');
            }
            let raw;
            try { raw = await adapter.queryDelivery({ requestId: ticket.requestId, orderNo: ticket.orderNo }); }
            catch { return { status: 'pending' }; }
            const receipt = normalizeReceipt(raw, ticket);
            if (!receipt) return { status: 'pending' };
            const context = { unitId: ticket.unitId, intentId, site: ticket.site, orderNo: ticket.orderNo };
            const sealed = sealDelivery(receipt.content, context, env);
            const stored = await call('fn_shop_supplier_record_delivery_v2', {
                p_intent_id: intentId,
                p_receipt: { requestId: ticket.requestId, accountId: ticket.account.id, orderNo: ticket.orderNo,
                    contractHash: CONTRACT_HASH, proofHash: ticket.proofHash, evidenceHash: receipt.evidenceHash,
                    actualCostCny: receipt.actualCostCny, sealed }
            });
            if (!['delivered', 'quarantined'].includes(stored.status) || stored.applied !== true) throw safeError();
            return { status: stored.status, applied: true };
        }
    };
}
async function loadCustomerDelivery(db, { orderId, fundingKind, userId = null, site = 'cn' }, env = process.env) {
    if (!UUID.test(orderId || '') || !['points', 'guest_cash'].includes(fundingKind) || site !== 'cn'
        || (fundingKind === 'points' && !UUID.test(userId || ''))) throw safeError('supplier_delivery_forbidden', 403);
    let result;
    try { result = await db.rpc('fn_shop_supplier_customer_delivery_v2', {
        p_order_id: orderId, p_funding_kind: fundingKind, p_buyer_user_id: userId, p_site: site
    }); } catch { throw safeError(); }
    if (result?.error) throw safeError();
    const data = Array.isArray(result?.data) ? result.data[0] : result?.data;
    if (['pending', 'closed'].includes(data?.status)) return { status: data.status, content: '' };
    if (data?.status !== 'delivered') throw safeError('supplier_delivery_forbidden', 403);
    return { status: 'delivered', content: openDelivery(data.sealed, {
        unitId: data.unitId, intentId: data.intentId, site, orderNo: data.orderNo
    }, env) };
}
module.exports = { CONTRACT, CONTRACT_HASH, normalizeContent, sealDelivery, openDelivery, validateTicket,
    normalizeReceipt, createDeliveryRunner, loadCustomerDelivery };
