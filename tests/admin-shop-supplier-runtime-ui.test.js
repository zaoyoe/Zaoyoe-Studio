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
function escape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function state(patch = {}) { return { phase: 'query', state: 'review', lastCode: 'timeout', alertCode: 'runtime_exhausted',
    attempts: 24, nextRunAt: null, lastAttemptAt: '2026-10-19T10:00:00Z', ...patch }; }
const scope = { providerId: 'xiareng', accountKey: 'original', site: 'cn', actorId: f.IDS.actor };
function fixture(storage = f.memoryStorage(), options = {}) {
    let actor = f.IDS.actor; let query = { ...scope }; const calls = [];
    const status = { textContent: '' }; const button = { disabled: false, isConnected: true,
        dataset: { ...scope, intentId: f.IDS.intent, orderId: f.IDS.order, fundingKind: 'points' } };
    const names = ['getSupplierRuntimeJournal', 'resumeSupplierRuntime', 'renderSupplierRuntime'];
    const shop = vm.runInNewContext(`({${names.map(method).join('\n')}})`, {
        document: { getElementById: () => status }, window: { ShopOperationJournal: Journal, localStorage: storage,
            crypto: { randomUUID: () => f.IDS.operation }, AdminApi: { fetch: async (url, init) => {
                const body = JSON.parse(init.body); calls.push(body);
                assert.ok(journal().read(), 'operation is persisted before HTTP');
                if (options.onSend) options.onSend({ setActor: value => { actor = value; }, setQuery: value => { query = value; }, shop, status, button });
                if (options.fail) throw Error('response lost');
                return { ok: true, json: async () => options.payload || { success: true, applied: options.applied !== false, operationId: body.operationId } };
            } } }
    });
    function journal() { return shop.getSupplierRuntimeJournal(f.operation(), scope); }
    Object.assign(shop, { supplierOperationsRequestToken: 7, getSupplierCatalogQuery: () => query,
        getSupplierResolutionActor: async () => actor, escapeHtml: escape, escapeForAttr: escape, formatOrderDetailTime: String,
        buildAdminShopUrl: p => p, getAdminAuthHeaders: async () => {
            if (options.switchAtAuth) actor = f.IDS.other;
            return { Authorization: 'test-session' };
        }, loadSupplierOperations: async () => {
            shop.supplierOperationsRequestToken++; button.isConnected = false;
            if (options.refreshThrows) throw Error('list failed');
            return !options.refreshFails;
        } });
    return { shop, button, status, calls, journal, setActor: value => { actor = value; }, setQuery: value => { query = value; } };
}
test('runtime journal persists only original scope and rejects a new operation or changed original request', () => {
    const storage = f.memoryStorage(); const h = fixture(storage); const request = { providerId: 'xiareng', accountKey: 'original', intentId: f.IDS.intent };
    h.journal().begin(f.IDS.operation, request);
    assert.equal(h.journal().read().operationId, f.IDS.operation);
    assert.throws(() => h.journal().begin(f.IDS.other, request), { code: 'shop_operation_pending' });
    assert.throws(() => h.journal().begin(f.IDS.operation, { ...request, accountKey: 'changed' }), { code: 'shop_operation_pending' });
    assert.equal(h.shop.getSupplierRuntimeJournal(f.operation(), { ...scope, actorId: f.IDS.other }).read(), null);
    assert.equal(h.shop.getSupplierRuntimeJournal(f.operation({ nativeOrderId: f.IDS.other }), scope).read(), null);
    assert.throws(() => h.journal().begin(f.IDS.operation, { ...request, credential: 'forbidden' }), { code: 'shop_operation_storage' });
    assert.doesNotMatch([...storage.rows.values()].join(''), /credential|test-session/);
});
test('lost resume ACK survives refresh; retry reuses same UUID and exact original request', async () => {
    const storage = f.memoryStorage(); const first = fixture(storage, { fail: true });
    await first.shop.resumeSupplierRuntime(first.button); assert.ok(first.journal().read());
    const next = fixture(storage);
    const html = next.shop.renderSupplierRuntime(f.operation({ runtime: state({ state: 'waiting', attempts: 0 }) }), scope);
    assert.match(html, /核对并重试本次恢复/);
    await next.shop.resumeSupplierRuntime(next.button);
    assert.deepEqual(next.calls, first.calls); assert.equal(next.journal().read(), null);
    assert.match(next.status.textContent, /已恢复待调度/);
});
test('malformed or mismatched ACK stays pending; explicit applied=false is confirmed and clears only original journal', async () => {
    for (const payload of [{ success: true, applied: true, operationId: f.IDS.other },
        { success: true, applied: 'yes', operationId: f.IDS.operation }, { success: false }]) {
        const h = fixture(undefined, { payload }); await h.shop.resumeSupplierRuntime(h.button);
        assert.ok(h.journal().read()); assert.match(h.status.textContent, /尚未确认/);
    }
    const h = fixture(undefined, { applied: false }); await h.shop.resumeSupplierRuntime(h.button);
    assert.equal(h.journal().read(), null); assert.match(h.status.textContent, /当前任务不能恢复/);
});
test('blocked local storage prevents any HTTP and leaves persisted corrupt entry intact', async () => {
    const broken = { getItem: () => null, setItem() { throw Error('quota'); } };
    const h = fixture(broken); await h.shop.resumeSupplierRuntime(h.button); assert.equal(h.calls.length, 0);
    const storage = f.memoryStorage(); const next = fixture(storage); next.journal().begin(f.IDS.operation,
        { providerId: 'xiareng', accountKey: 'original', intentId: f.IDS.intent });
    const key = [...storage.rows.keys()][0]; storage.setItem(key, '{invalid');
    await next.shop.resumeSupplierRuntime(next.button); assert.equal(next.calls.length, 0); assert.equal(storage.getItem(key), '{invalid');
});
test('actor switch before sending or during response cannot acknowledge another administrator operation', async () => {
    const before = fixture(); before.setActor(f.IDS.other); await before.shop.resumeSupplierRuntime(before.button);
    assert.equal(before.calls.length, 0); assert.equal(before.journal().read(), null);
    const atAuth = fixture(undefined, { switchAtAuth: true }); await atAuth.shop.resumeSupplierRuntime(atAuth.button);
    assert.equal(atAuth.calls.length, 0); assert.ok(atAuth.journal().read());
    const after = fixture(undefined, { onSend: ({ setActor }) => setActor(f.IDS.other) });
    await after.shop.resumeSupplierRuntime(after.button); assert.ok(after.journal().read());
    assert.match(after.status.textContent, /管理员账号已切换/);
});
test('old resume result keeps original acknowledgement but cannot refresh/overwrite a different account view', async () => {
    const h = fixture(undefined, { onSend: ({ setQuery, shop, status }) => {
        setQuery({ ...scope, accountKey: 'different' }); shop.supplierOperationsRequestToken++; status.textContent = 'different account';
    } });
    await h.shop.resumeSupplierRuntime(h.button);
    assert.equal(h.journal().read(), null); assert.equal(h.status.textContent, 'different account');
    assert.equal(h.shop.supplierOperationsRequestToken, 8);
    assert.equal(h.calls[0].accountKey, 'original');
});
test('acknowledged resume stays confirmed when parent refresh fails or throws after replacing button', async () => {
    for (const options of [{ refreshFails: true }, { refreshThrows: true }]) {
        const h = fixture(undefined, options); await h.shop.resumeSupplierRuntime(h.button);
        assert.equal(h.journal().read(), null); assert.match(h.status.textContent, /恢复结果已确认，列表尚未更新/);
        assert.equal(h.calls.length, 1); assert.equal(h.button.isConnected, false);
    }
});
test('detail summary remains read-only; recovery appears only with original account context and safe labels', () => {
    const h = fixture(); const row = f.operation({ runtime: state() });
    assert.doesNotMatch(h.shop.renderSupplierRuntime(row), /supplier-runtime-resume/);
    assert.match(h.shop.renderSupplierRuntime(row, scope), /data-account-key="original"/);
    assert.doesNotMatch(h.shop.renderSupplierRuntime({ ...row, runtime: state({ phase: 'review' }) }, scope), /supplier-runtime-resume/);
    const malicious = h.shop.renderSupplierRuntime({ ...row, runtime: state({ state: 'waiting', nextRunAt: '<img onerror=x>', alertCode: '<script>x' }) }, scope);
    assert.doesNotMatch(malicious, /<img|<script/); assert.match(malicious, /&lt;img/);
    assert.doesNotMatch(h.shop.renderSupplierRuntime(row, { ...scope, site: 'intl' }), /supplier-runtime-resume/);
});
function listFixture(options = {}) {
    const body = { innerHTML: '' }; const status = { textContent: '' };
    let shop;
    shop = vm.runInNewContext(`({${method('loadSupplierOperations')}})`, { document: { getElementById: id => id === 'supplierOperationsTableBody' ? body : status },
        window: { AdminApi: { fetch: async () => {
            if (options.stale) { shop.supplierOperationsRequestToken++; body.innerHTML = 'new view'; status.textContent = 'new view'; }
            return { ok: !options.fail, json: async () => ({ success: !options.fail, rows: [f.operation({ runtime: state() })], hasMore: false }) };
        } } } });
    Object.assign(shop, { supplierOperationsRequestToken: 0, getSupplierCatalogQuery: () => scope, buildAdminShopUrl: p => p,
        getSupplierResolutionActor: async () => { if (options.noActor) throw Error('auth unavailable'); return f.IDS.actor; },
        getSupplierOperationLabels: () => ({ procurement: '原采购', delivery: '等待确认' }),
        renderSupplierRuntime: (row, context) => context.actorId ? 'with recovery' : 'read-only',
        renderSupplierManualEntry: () => '',
        escapeHtml: escape, escapeForAttr: escape });
    return { shop, body, status };
}
test('readonly procurement list tolerates unavailable actor and reports actual refresh result', async () => {
    const h = listFixture({ noActor: true }); assert.equal(await h.shop.loadSupplierOperations(), true); assert.match(h.body.innerHTML, /read-only/);
    const fail = listFixture({ fail: true }); assert.equal(await fail.shop.loadSupplierOperations(), false);
    assert.match(fail.body.innerHTML, /暂不可用/);
    const stale = listFixture({ stale: true }); assert.equal(await stale.shop.loadSupplierOperations(), false);
    assert.equal(stale.body.innerHTML, 'new view'); assert.equal(stale.status.textContent, 'new view');
});
