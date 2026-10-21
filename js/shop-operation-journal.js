/* Refresh recovery for money-affecting shop operations. No tokens or card content. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ShopOperationJournal = api;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
    function failure(code) {
        return Object.assign(new Error(code === 'shop_operation_pending'
            ? '尚有一笔操作待核对，请先查询原操作结果。'
            : '暂时无法保存操作恢复信息，请保留当前页面并核对订单。'), { code, purchaseOutcomeUnknown: true });
    }
    function create({ storage, kind, actorId, site, orderId = '', fundingKind = '' }) {
        if (!['points_purchase', 'supplier_resolution', 'supplier_runtime'].includes(kind) || !UUID.test(actorId || '')
            || !['cn', 'intl'].includes(site) || (kind !== 'points_purchase' && (!UUID.test(orderId) || !['points','guest_cash'].includes(fundingKind)))) throw failure('shop_operation_storage');
        const key = ['shop-operation-v1', kind, actorId, site, orderId, fundingKind].join(':');
        function normalizeRequest(request) {
            if (!request || typeof request !== 'object' || Array.isArray(request)) throw failure('shop_operation_storage');
            const allowed = kind === 'points_purchase' ? ['productId', 'productSkuId', 'quantity', 'source']
                : kind === 'supplier_runtime' ? ['providerId', 'accountKey', 'intentId'] : ['kind', 'publicNote', 'internalNote', 'evidenceRef', 'amount', 'attested'];
            if (Object.keys(request).some(name => !allowed.includes(name))) throw failure('shop_operation_storage');
            if (kind === 'points_purchase') {
                if (!UUID.test(request.productId || '') || (request.productSkuId !== null && !UUID.test(request.productSkuId || ''))
                    || !Number.isInteger(request.quantity) || request.quantity < 1 || !['single', 'cart'].includes(request.source)) throw failure('shop_operation_storage');
            } else if (kind === 'supplier_runtime') {
                if (site !== 'cn' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(request.providerId || '')
                    || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.accountKey || '')
                    || !UUID.test(request.intentId || '')) throw failure('shop_operation_storage');
            } else {
                if (request.kind !== (fundingKind === 'points' ? 'points_refund' : 'manual_compensation') || request.attested !== true
                    || typeof request.amount !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(request.amount) || Number(request.amount) <= 0) throw failure('shop_operation_storage');
                for (const [name, max] of [['publicNote', 500], ['internalNote', 1000], ['evidenceRef', 500]]) {
                    if (typeof request[name] !== 'string' || request[name].trim().length < 8 || request[name].length > max) throw failure('shop_operation_storage');
                }
            }
            return Object.fromEntries(allowed.map(name => [name, request[name]]));
        }
        function read() {
            try {
                const raw = storage.getItem(key);
                if (raw === null) return null;
                const row = JSON.parse(raw);
                if (row.version !== 1 || row.kind !== kind || row.actorId !== actorId || row.site !== site || row.orderId !== orderId || row.fundingKind !== fundingKind
                    || typeof row.operationId !== 'string' || row.operationId.length < 16 || row.operationId.length > 200
                    || !Number.isFinite(row.createdAt) || row.createdAt <= 0 || (kind !== 'points_purchase' && !UUID.test(row.operationId)) || !row.request || typeof row.request !== 'object' || Array.isArray(row.request)
                    || JSON.stringify(row.request).length > 12000) throw Error('invalid journal');
                normalizeRequest(row.request);
                return row;
            } catch { throw failure('shop_operation_storage'); }
        }
        function begin(operationId, request) {
            if (typeof operationId !== 'string' || operationId.length < 16 || operationId.length > 200
                || (kind !== 'points_purchase' && !UUID.test(operationId))) throw failure('shop_operation_storage');
            request = normalizeRequest(request);
            const old = read();
            if (old) {
                if (old.operationId !== operationId || JSON.stringify(old.request) !== JSON.stringify(request)) throw failure('shop_operation_pending');
                return old;
            }
            const row = { version: 1, kind, actorId, site, orderId, fundingKind, operationId, request, createdAt: Date.now() };
            // Both callers supply explicit allowlists. Refuse accidental secret persistence.
            const raw = JSON.stringify(row);
            if (/"(?:access_token|authorization|claim_secret|sealed|card_secret)"\s*:/i.test(raw) || raw.length > 16000) throw failure('shop_operation_storage');
            try {
                storage.setItem(key, raw);
                const saved = read();
                if (JSON.stringify(saved) !== raw) throw Error('journal not saved');
                return saved;
            } catch { throw failure('shop_operation_storage'); }
        }
        function clear(operationId) {
            const row = read();
            if (!row || row.operationId !== operationId) return false;
            try { storage.removeItem(key); if (read() !== null) throw Error('journal not cleared'); }
            catch { throw failure('shop_operation_storage'); }
            return true;
        }
        return { read, begin, clear };
    }
    return { create };
});
