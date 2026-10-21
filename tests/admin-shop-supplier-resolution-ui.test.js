'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Journal = require('../js/shop-operation-journal');
const f = require('./helpers/shop-supplier-resolution-fixture');
const source = fs.readFileSync(path.join(__dirname, '../js/admin-shop.js'), 'utf8');
function method(name) { const found = source.match(new RegExp(`^    ${name}: (?:async )?function \\([^\\n]*\\) \\{[\\s\\S]*?^    \\},`, 'm'));
    assert.ok(found, name); return found[0]; }
function fixture(storage, options = {}) {
    const calls = []; const status = { textContent: '' }; const buttons = [{ disabled: false }]; const fields = [{ disabled: false }, { disabled: false }];
    const body = { innerHTML: '', setAttribute() {}, querySelectorAll: () => fields };
    const values = { supplierResolutionPublicNote: f.request().publicNote, supplierResolutionInternalNote: f.request().internalNote,
        supplierResolutionEvidence: f.request().evidenceRef, supplierResolutionAttested: '' };
    const overlay = { isConnected: true, querySelector(id) { return id === '#supplierResolutionStatus' ? status : id === '#supplierResolutionBody' ? body
        : { value: values[id.slice(1)], checked: true }; }, querySelectorAll: () => buttons };
    let actor = f.IDS.actor;
    const journal = Journal.create({ storage, kind: 'supplier_resolution', actorId: actor, site: 'cn', orderId: f.IDS.order, fundingKind: 'points' });
    const shop = vm.runInNewContext(`({${method('submitSupplierResolution')}\n${method('renderSupplierResolutionForm')}})`, {
        window: { crypto: { randomUUID: () => f.IDS.operation }, AdminApi: { fetch: async (url, init) => {
            assert.ok(journal.read(), 'journal must exist before sending financial request');
            const payload = JSON.parse(init.body); calls.push(payload);
            if (options.fail) throw Error('response lost');
            if (options.switchActor) actor = f.IDS.other;
            return { ok: true, json: async () => ({ success: true, result: options.notFound
                ? { status: 'not_found', operationId: f.IDS.operation } : f.result() }) };
        } } }
    });
    shop.supplierResolutionContext = { overlay, actorId: actor, journal, pending: journal.read(), row: f.operation(),
        site: 'cn', orderId: f.IDS.order, fundingKind: 'points', busy: false };
    Object.assign(shop, { getSupplierResolutionActor: async () => actor, buildAdminShopUrl: p => p,
        escapeHtml: String, escapeForAttr: String, invalidateShopTabCache() {},
        refreshSupplierResolutionViews: async () => { if (options.refreshFails) throw Error('list unavailable'); } });
    return { shop, journal, calls, overlay, fields, body, status };
}
test('lost admin commit locks original request, survives refresh and clears only a confirmed original result', async () => {
    const storage = f.memoryStorage(); const first = fixture(storage, { fail: true });
    await first.shop.submitSupplierResolution('commit');
    assert.equal(first.calls[0].action, 'commit'); assert.equal(first.calls[0].operationId, f.IDS.operation);
    assert.ok(first.fields.every(field => field.disabled)); assert.ok(first.journal.read());
    const refreshed = fixture(storage); await refreshed.shop.submitSupplierResolution('query');
    assert.equal(refreshed.calls.length, 1); assert.equal(refreshed.calls[0].action, 'query');
    assert.equal(refreshed.calls[0].operationId, first.calls[0].operationId); assert.equal('request' in refreshed.calls[0], false);
    assert.equal(refreshed.journal.read(), null); assert.match(refreshed.body.innerHTML, /原积分已按原付款明细退回/);
});
test('query miss does not unlock or alter original request; retry uses identical operation and amount', async () => {
    const storage = f.memoryStorage(); const first = fixture(storage, { fail: true }); await first.shop.submitSupplierResolution('commit');
    const next = fixture(storage, { notFound: true }); await next.shop.submitSupplierResolution('query');
    assert.ok(next.journal.read()); assert.match(next.status.textContent, /可按原信息重试/);
    await next.shop.submitSupplierResolution('commit');
    assert.equal(next.calls[1].operationId, first.calls[0].operationId); assert.deepEqual(next.calls[1].request, first.calls[0].request);
});
test('administrator account change during response cannot acknowledge the original actor journal', async () => {
    const storage = f.memoryStorage(); const h = fixture(storage, { switchActor: true });
    await h.shop.submitSupplierResolution('commit'); assert.ok(h.journal.read()); assert.match(h.status.textContent, /管理员账号已切换/);
});

test('failed parent refresh never changes an acknowledged financial result back to unknown', async () => {
    const h = fixture(f.memoryStorage(), { refreshFails: true });
    await h.shop.submitSupplierResolution('commit');
    await Promise.resolve();
    assert.equal(h.journal.read(), null);
    assert.equal(h.shop.supplierResolutionContext.row.customerResolution.status, 'refunded');
    assert.match(h.status.textContent, /结案已确认/);
    assert.doesNotMatch(h.status.textContent, /尚未收到处理确认/);
    assert.equal(h.calls.length, 1);
});
function refreshFixture(fundingKind) {
    const calls = []; const shell = { innerHTML: 'old' };
    const detail = { isConnected: true, dataset: { orderNo: 'GUEST-ORIGINAL' }, querySelector: () => shell };
    const nodes = { [fundingKind === 'points' ? 'orderContentModal' : 'guestExceptionDetailModal']: detail,
        supplierOperationsPanel: { open: true } };
    const shop = vm.runInNewContext(`({${method('refreshSupplierResolutionViews')}})`, {
        document: { getElementById: id => nodes[id] || null }
    });
    Object.assign(shop, { currentTab: fundingKind === 'points' ? 'orders' : 'guest-exceptions',
        currentOrderDetailId: f.IDS.order, orderDetailRequestToken: 7, ordersPage: 3, guestExceptionsPage: 2,
        loadOrderDetailViaAdminApi: async id => { calls.push(['points-detail', id]); return { resolution: f.resolution() }; },
        renderOrderDetailBody: payload => payload.resolution.message,
        loadGuestOrdersViaAdminApi: async input => { calls.push(['guest-detail', input]); return { rows: [{ id: f.IDS.order,
            order_no: 'GUEST-ORIGINAL', supplier_customer_resolution: f.resolution({ status: 'compensated' }) }] }; },
        renderGuestExceptionDetailBody: row => row.supplier_customer_resolution.message,
        searchOrders: async (...args) => calls.push(['points-list', ...args]),
        loadGuestOrderExceptions: async page => calls.push(['guest-list', page]),
        loadSupplierOperations: async () => calls.push(['procurements']) });
    return { shop, shell, detail, calls, context: { fundingKind, orderId: f.IDS.order,
        site: 'cn', row: { orderNo: 'GUEST-ORIGINAL' } } };
}
test('confirmed points closure refreshes the original detail, same list page and visible procurement panel', async () => {
    const h = refreshFixture('points');
    await h.shop.refreshSupplierResolutionViews(h.context);
    assert.equal(h.shell.innerHTML, f.resolution().message);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['points-detail', f.IDS.order],
        ['points-list', 3, { openDetails: false }], ['procurements']]);
});
test('confirmed guest closure refreshes the original guest detail and list without opening another modal', async () => {
    const h = refreshFixture('guest_cash');
    await h.shop.refreshSupplierResolutionViews(h.context);
    assert.equal(h.shell.innerHTML, f.resolution().message);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['guest-detail', { site: 'cn', exception: 'all',
        orderNo: 'GUEST-ORIGINAL', page: 1, pageSize: 1 }], ['guest-list', 2], ['procurements']]);
});
test('late detail refresh cannot overwrite a different order or a newly opened detail', async () => {
    for (const kind of ['points', 'guest_cash']) {
        const h = refreshFixture(kind);
        if (kind === 'points') h.shop.loadOrderDetailViaAdminApi = async () => {
            h.shop.orderDetailRequestToken++; return { resolution: f.resolution() };
        };
        else h.shop.loadGuestOrdersViaAdminApi = async () => {
            h.detail.isConnected = false;
            return { rows: [{ id: f.IDS.order, order_no: 'GUEST-ORIGINAL', supplier_customer_resolution: f.resolution() }] };
        };
        await h.shop.refreshSupplierResolutionViews(h.context);
        assert.equal(h.shell.innerHTML, 'old');
    }
});
