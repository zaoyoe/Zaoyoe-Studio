'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Journal = require('../js/shop-operation-journal');
const f = require('./helpers/shop-supplier-resolution-fixture');
const source = fs.readFileSync(path.join(__dirname, '../js/shop-client.js'), 'utf8');
function method(name) { const found = source.match(new RegExp(`^    ${name}: (?:async )?function \\([^\\n]*\\) \\{[\\s\\S]*?^    \\},`, 'm'));
    assert.ok(found, name); return found[0]; }
const PURCHASE_KEY = 'points-purchase-original-operation-20261019';
const purchase = { productId: f.IDS.intent, productSkuId: f.IDS.request, quantity: 1, site: 'cn', idempotencyKey: PURCHASE_KEY };
const savedRequest = { productId: purchase.productId, productSkuId: purchase.productSkuId, quantity: 1, source: 'single' };
function journal(storage, patch = {}) { return Journal.create({ storage, kind: 'points_purchase', actorId: f.IDS.actor, site: 'cn', ...patch }); }
function resolutionJournal(storage, patch = {}) { return journal(storage, { kind: 'supplier_resolution', orderId: f.IDS.order, fundingKind: 'points', ...patch }); }
function runtime(storage, options = {}) {
    const calls = []; let actor = f.IDS.actor; const site = { site: 'cn' };
    const window = { ShopOperationJournal: Journal, sessionStorage: storage, SiteConfig: site,
        supabaseClient: { auth: { getSession: async () => ({ data: { session: { user: { id: actor }, access_token: 'test-token' } } }) } } };
    const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    const shop = vm.runInNewContext(`({${['getPointsPurchaseJournal', 'requestPurchasePayloadWithServer', 'recoverPendingPointsPurchase'].map(method).join('\n')}})`, {
        window, console, fetch: async (url, init) => {
            const body = JSON.parse(init.body); calls.push({ url, body, headers: init.headers });
            if (body.prepareRecovery) return reply({ success: true, recoverySource: options.local ? 'local' : 'supplier_v2' });
            if (body.recoverOnly) { if (options.switchActorAfterRecovery) actor = f.IDS.other;
                return reply({ success: true, recovery: options.unconfirmed ? { status: 'unconfirmed' }
                    : { status: 'confirmed', orderId: f.IDS.order, resolution: null } }); }
            if (options.actualError) throw Error('test transport lost after commit');
            if (options.malformed) return { ok: true, status: 200, json: async () => { throw Error('truncated'); } };
            if (options.sourceChanged) return reply({ success: false, code: 'purchase_source_changed', message: '供货方式已更新' }, 409);
            return reply({ success: true, data: { order_id: f.IDS.order } });
        }
    });
    Object.assign(shop, { getAccessToken: async () => 'test-token', isEnglishShopLocale: () => false,
        createPurchaseIdempotencyKey: () => 'points-purchase-new-operation-20261019', normalizeShopRequestError: err => err,
        restorePendingPointsPurchase: async () => {}, currentPurchase: { idempotencyKey: PURCHASE_KEY },
        cartItems: new Map([['edited-after-refresh', 3]]) });
    return { shop, calls, site, switchActor: () => { actor = f.IDS.other; } };
}
function recoveryUi() { return { panel: { removed: false, remove() { this.removed = true; } }, text: { textContent: '' },
    button: { disabled: false, cloneNode() { return { disabled: false, addEventListener() {} }; }, replaceWith() {} } }; }

test('journal survives same-tab module recreation and permits only identical retry and matching clear', () => {
    const storage = f.memoryStorage(); const j = journal(storage); j.begin(PURCHASE_KEY, savedRequest);
    const restored = journal(storage); assert.equal(restored.read().operationId, PURCHASE_KEY);
    assert.deepEqual(restored.begin(PURCHASE_KEY, { source: 'single', quantity: 1, productSkuId: purchase.productSkuId, productId: purchase.productId }).request, savedRequest);
    assert.throws(() => restored.begin(PURCHASE_KEY, { ...savedRequest, quantity: 2 }), { code: 'shop_operation_pending' });
    assert.throws(() => restored.begin('different-operation-20261019', savedRequest), { code: 'shop_operation_pending' });
    assert.equal(restored.clear('another-operation'), false); assert.ok(restored.read());
    assert.equal(restored.clear(PURCHASE_KEY), true); assert.equal(restored.read(), null);
});
test('journal is scoped by actor, site, funding kind and native order', () => {
    const storage = f.memoryStorage(); resolutionJournal(storage).begin(f.IDS.operation, f.request());
    for (const patch of [{ actorId: f.IDS.other }, { site: 'intl' }, { orderId: f.IDS.other }, { fundingKind: 'guest_cash' }])
        assert.equal(resolutionJournal(storage, patch).read(), null);
    assert.equal(journal(storage).read(), null);
});
test('journal does not silently forget corrupted operations or expired timestamps', () => {
    const storage = f.memoryStorage(); journal(storage).begin(PURCHASE_KEY, savedRequest); const key = [...storage.rows.keys()][0];
    const old = JSON.parse(storage.getItem(key)); old.createdAt = 1; storage.setItem(key, JSON.stringify(old));
    assert.equal(journal(storage).read().operationId, PURCHASE_KEY); // Never TTL-clear an unknown financial outcome.
    for (const value of ['{invalid', JSON.stringify({ ...old, actorId: f.IDS.other }), JSON.stringify({ ...old, request: { ...savedRequest, access_token: 'forbidden' } })]) {
        storage.setItem(key, value); assert.throws(() => journal(storage).read(), { code: 'shop_operation_storage' });
        assert.equal(storage.getItem(key), value);
    }
});
test('storage failure prevents submission journal creation; extra secrets and mismatched kinds are refused', () => {
    const storage = { getItem: () => null, setItem() { throw Error('quota'); } };
    assert.throws(() => journal(storage).begin(PURCHASE_KEY, savedRequest), { code: 'shop_operation_storage' });
    assert.throws(() => journal(f.memoryStorage()).begin(PURCHASE_KEY, { ...savedRequest, claim_secret: 'forbidden' }), { code: 'shop_operation_storage' });
    assert.throws(() => resolutionJournal(f.memoryStorage()).begin(f.IDS.operation, f.request({ kind: 'manual_compensation' })), { code: 'shop_operation_storage' });
});
for (const options of [{ actualError: true }, { malformed: true }]) {
    test(`unknown supplier purchase -> refreshed frontend -> query original operation without another purchase (${Object.keys(options)[0]})`, async () => {
        const storage = f.memoryStorage(); const first = runtime(storage, options);
        await assert.rejects(first.shop.requestPurchasePayloadWithServer(purchase, 'test-token'), e => e.purchaseOutcomeUnknown === true);
        assert.equal(first.calls.length, 2); assert.equal(first.calls[0].body.prepareRecovery, true);
        assert.equal(first.calls[1].headers['X-Idempotency-Key'], PURCHASE_KEY);
        const pending = journal(storage).read(); assert.equal(pending.operationId, PURCHASE_KEY);
        const refreshed = runtime(storage); const context = await refreshed.shop.getPointsPurchaseJournal(); const ui = recoveryUi();
        await refreshed.shop.recoverPendingPointsPurchase(context, pending, ui.panel, ui.text, ui.button);
        assert.deepEqual(refreshed.calls.map(c => c.body), [{ recoverOnly: true, site: 'cn', idempotencyKey: PURCHASE_KEY }]);
        assert.equal(journal(storage).read(), null); assert.match(ui.text.textContent, /已确认原订单/);
        assert.equal(refreshed.shop.cartItems.get('edited-after-refresh'), 3);
        assert.equal(first.calls.concat(refreshed.calls).filter(c => !c.body.prepareRecovery && !c.body.recoverOnly).length, 1);
    });
}
test('unconfirmed query keeps original request and blocks starting a second supplier purchase', async () => {
    const storage = f.memoryStorage(); journal(storage).begin(PURCHASE_KEY, savedRequest); const r = runtime(storage, { unconfirmed: true });
    const context = await r.shop.getPointsPurchaseJournal(); const ui = recoveryUi();
    await r.shop.recoverPendingPointsPurchase(context, context.journal.read(), ui.panel, ui.text, ui.button);
    assert.match(ui.text.textContent, /请勿重复购买/); assert.ok(journal(storage).read());
    await assert.rejects(r.shop.requestPurchasePayloadWithServer(purchase), { code: 'shop_operation_pending' });
    assert.equal(r.calls.length, 1); assert.equal(r.calls[0].body.recoverOnly, true);
});
test('account change during recovery cannot clear the original user operation', async () => {
    const storage = f.memoryStorage(); journal(storage).begin(PURCHASE_KEY, savedRequest); const r = runtime(storage, { switchActorAfterRecovery: true });
    const context = await r.shop.getPointsPurchaseJournal(); const ui = recoveryUi();
    await r.shop.recoverPendingPointsPurchase(context, context.journal.read(), ui.panel, ui.text, ui.button);
    assert.match(ui.text.textContent, /账号或站点已切换/); assert.ok(journal(storage).read());
});
test('ordinary local inventory purchase creates no supplier recovery entry', async () => {
    const storage = f.memoryStorage(); const r = runtime(storage, { local: true });
    assert.equal((await r.shop.requestPurchasePayloadWithServer(purchase)).success, true);
    assert.equal(r.calls[1].body.recoverySource, 'local'); assert.equal(storage.rows.size, 0);
});
test('authoritative source change is an explicit pre-purchase rejection and releases only its pending journal', async () => {
    const storage = f.memoryStorage(); const r = runtime(storage, { sourceChanged: true });
    await assert.rejects(r.shop.requestPurchasePayloadWithServer(purchase), { code: 'purchase_source_changed', purchaseOutcomeUnknown: false });
    assert.equal(journal(storage).read(), null);
});
test('stale site payload is stopped before source handshake or purchase', async () => {
    const r = runtime(f.memoryStorage()); await assert.rejects(r.shop.requestPurchasePayloadWithServer({ ...purchase, site: 'intl' }), { code: 'purchase_auth_changed' });
    assert.equal(r.calls.length, 0);
});
