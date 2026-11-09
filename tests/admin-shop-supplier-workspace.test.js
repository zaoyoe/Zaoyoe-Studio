'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function element(value = '') {
    const classes = new Set();
    const attributes = new Map();
    return {
        value, innerHTML: '', textContent: '', hidden: false, disabled: false, checked: false,
        nodeType: 1, tagName: 'BUTTON', dataset: {},
        classList: {
            add(...names) { names.forEach((name) => classes.add(name)); },
            remove(...names) { names.forEach((name) => classes.delete(name)); },
            contains(name) { return classes.has(name); },
            toggle(name, force) { const on = force ?? !classes.has(name); on ? classes.add(name) : classes.delete(name); }
        },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); },
        removeAttribute(name) { attributes.delete(name); },
        replaceChildren() {
            this.innerHTML = '';
            this.textContent = '';
        }
    };
}

function nativeSelectElement() {
    const select = element('');
    let markup = '';
    let options = [];
    let selectedValue = '';
    Object.defineProperties(select, {
        innerHTML: {
            get() { return markup; },
            set(value) {
                markup = String(value || '');
                options = [...markup.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((match) => {
                    const valueAttribute = match[1].match(/\bvalue="([^"]*)"/i);
                    return {
                        value: valueAttribute ? valueAttribute[1] : '',
                        disabled: /\bdisabled(?:\s|$)/i.test(match[1]),
                        selected: /\bselected(?:\s|$)/i.test(match[1])
                    };
                });
                selectedValue = options.find((option) => option.selected)?.value ?? options[0]?.value ?? '';
            }
        },
        value: {
            get() { return selectedValue; },
            set(value) {
                const candidate = String(value ?? '');
                selectedValue = options.some((option) => option.value === candidate) ? candidate : '';
            }
        }
    });
    select.tagName = 'SELECT';
    return select;
}

function response(payload, status = 200) {
    return { ok: status < 400, status, async json() { return payload; } };
}

function workspace() {
    const ids = [
        'supplierCatalogProvider', 'supplierCatalogAccount', 'supplierCatalogSite', 'supplierCatalogSearchInput',
        'supplierCatalogCategory',
        'supplierCatalogTableBody', 'supplierCatalogProviderBadge', 'supplierCatalogSelectAll',
        'supplierCatalogImportButton', 'supplierCatalogSelectionCount', 'supplierCatalogPageInfo',
        'supplierCatalogPrevButton', 'supplierCatalogNextButton', 'supplierCatalogFeedback',
        'supplierCatalogDetailModal', 'supplierCatalogDetailBody', 'supplierCatalogDetailTitle',
        'supplierCatalogRace', 'supplierCatalogPreview', 'productSupplierSummary',
        'supplierCatalogTree', 'supplierCatalogTreeAllBtn',
        'supplierOperationsPanel', 'supplierOperationsTableBody', 'supplierOperationsStatus'
    ];
    const elements = new Map(ids.map((id) => [id, id === 'supplierCatalogCategory' ? nativeSelectElement() : element()]));
    const actions = new Map(['supplier-catalog-import-detail', 'supplier-catalog-preview'].map((action) => [action, element()]));
    elements.get('supplierCatalogProvider').value = 'xiareng';
    elements.get('supplierCatalogAccount').value = 'first';
    elements.get('supplierCatalogSite').value = 'cn';
    const document = {
        readyState: 'loading', addEventListener() {},
        getElementById(id) { return elements.get(id) || null; },
        querySelector(selector) { return actions.get(selector.match(/data-shop-action="([^"]+)"/)?.[1]) || null; },
        querySelectorAll() { return []; }
    };
    const pending = [];
    const window = {
        addEventListener() {}, confirm: () => true,
        AdminApi: { fetch(url, options) { const request = deferred(); pending.push({ url, options, ...request }); return request.promise; } }
    };
    vm.runInNewContext(source, { window, document, console, URLSearchParams, Set, Map }, { filename: 'admin-shop.js' });
    const shop = window.ShopAdmin;
    shop.buildAdminShopUrl = (_, params = {}) => `/api/admin/shop/supplier-catalog?${new URLSearchParams(params)}`;
    shop.getAdminAuthHeaders = async () => ({ 'Content-Type': 'application/json' });
    const invalidated = [];
    shop.invalidateShopTabCache = (tab) => invalidated.push(tab);
    shop.supplierCatalogProviderId = 'xiareng';
    shop.supplierCatalogAccountsProviderId = 'xiareng';
    shop.supplierCatalogAccountKey = 'first';
    shop.supplierCatalogAccounts = ['first', 'second'].map((accountKey) => ({ accountKey, enabled: true, configured: true }));
    return { shop, elements, actions, pending, window, invalidated };
}

function item(goodsNo = 'XR-1', overrides = {}) {
    return { providerGoodsId: goodsNo, name: goodsNo, supplierUnitPrice: '12.340000', currency: null,
        variantRequirements: { importable: true, requiresRace: false, races: [], reasons: [] }, ...overrides };
}

async function finishDetail(harness, goodsNo, overrides = {}) {
    const opened = harness.shop.openSupplierCatalogDetail(goodsNo);
    harness.pending.at(-1).resolve(response({ success: true, item: item(goodsNo, overrides) }));
    await opened;
}

test('late catalog responses cannot overwrite the newly selected account', async () => {
    const h = workspace();
    const first = h.shop.loadSupplierCatalog();
    h.elements.get('supplierCatalogAccount').value = 'second';
    h.shop.resetSupplierCatalogContext();
    const second = h.shop.loadSupplierCatalog();
    h.pending[1].resolve(response({
        success: true,
        total: 1,
        items: [item('SECOND')],
        categories: [],
        snapshotId: '00000000-0000-4000-8000-000000000001',
        syncedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        snapshotItemCount: 1
    }));
    await second;
    h.pending[0].resolve(response({ success: true, total: 1, items: [item('FIRST')] }));
    await first;
    assert.equal(new URL(h.pending[0].url, 'http://localhost').searchParams.get('accountKey'), 'first');
    assert.equal(new URL(h.pending[1].url, 'http://localhost').searchParams.get('accountKey'), 'second');
    assert.equal(h.shop.supplierCatalogItems[0].providerGoodsId, 'SECOND');
    assert.doesNotMatch(h.elements.get('supplierCatalogTableBody').innerHTML, /FIRST/);
});

test('a successful retry clears the transient expired-snapshot notice', async () => {
    const h = workspace();
    const staleSnapshotId = '00000000-0000-4000-8000-000000000021';
    const freshSnapshotId = '00000000-0000-4000-8000-000000000022';
    h.shop.supplierCatalogSnapshot = {
        providerId: 'xiareng',
        accountKey: 'first',
        site: 'cn',
        snapshotId: staleSnapshotId,
        syncedAt: new Date(Date.now() - 61_000).toISOString(),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        categories: [{ categoryKey: 'cat-1', name: '分类一', itemCount: 1 }],
        itemCount: 1
    };

    const loading = h.shop.loadSupplierCatalog({ page: 1 });
    h.pending[0].resolve(response({
        success: false,
        code: 'supplier_catalog_snapshot_expired',
        message: '虾仁目录快照已过期或已更新，请重新查询目录。'
    }, 409));
    await new Promise(setImmediate);
    assert.equal(h.pending.length, 2);

    h.pending[1].resolve(response({
        success: true,
        total: 1,
        items: [item('XR-FRESH')],
        categories: [{ categoryKey: 'cat-1', name: '分类一', itemCount: 1 }],
        snapshotId: freshSnapshotId,
        syncedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        snapshotItemCount: 1
    }));
    await loading;

    assert.equal(h.shop.supplierCatalogSnapshot.snapshotId, freshSnapshotId);
    assert.equal(h.shop.supplierCatalogItems[0].providerGoodsId, 'XR-FRESH');
    assert.equal(h.elements.get('supplierCatalogFeedback').hidden, true);
    assert.equal(h.elements.get('supplierCatalogFeedback').innerHTML, '');
});

test('expired Xiareng snapshots require category reselection instead of trusting a temporary key', async () => {
    const h = workspace();
    const staleSnapshotId = '00000000-0000-4000-8000-000000000001';
    const freshSnapshotId = '00000000-0000-4000-8000-000000000002';
    const staleExpiry = new Date(Date.now() - 1_000).toISOString();
    const freshSync = new Date().toISOString();
    const freshExpiry = new Date(Date.now() + 60_000).toISOString();

    h.elements.get('supplierCatalogCategory').innerHTML = '<option value="">全部分类</option><option value="cat-1">旧分类（1）</option>';
    h.elements.get('supplierCatalogCategory').value = 'cat-1';
    h.shop.supplierCatalogCategoryKey = 'cat-1';
    h.shop.supplierCatalogSnapshot = {
        providerId: 'xiareng',
        accountKey: 'first',
        site: 'cn',
        snapshotId: staleSnapshotId,
        syncedAt: new Date(Date.now() - 61_000).toISOString(),
        expiresAt: staleExpiry,
        categories: [{ categoryKey: 'cat-1', name: '分类一', itemCount: 1 }],
        itemCount: 1
    };

    const loading = h.shop.loadSupplierCatalog({ page: 1 });
    assert.equal(h.pending.length, 1);
    const staleRequest = new URL(h.pending[0].url, 'http://localhost');
    assert.equal(staleRequest.searchParams.get('snapshotId'), staleSnapshotId);
    assert.equal(staleRequest.searchParams.get('categoryKey'), 'cat-1');

    h.pending[0].resolve(response({
        success: false,
        code: 'supplier_catalog_snapshot_expired',
        message: '虾仁目录快照已过期或已更新，请重新查询目录。'
    }, 409));
    await new Promise(setImmediate);
    assert.equal(h.pending.length, 2);

    const bootstrapRequest = new URL(h.pending[1].url, 'http://localhost');
    assert.equal(bootstrapRequest.searchParams.get('snapshotId'), null);
    assert.equal(bootstrapRequest.searchParams.get('categoryKey'), null);
    h.pending[1].resolve(response({
        success: true,
        total: 2,
        items: [item('XR-ALL'), item('XR-CATEGORY')],
        categories: [{ categoryKey: 'cat-1', name: '快照更新后的其他分类', itemCount: 1 }],
        snapshotId: freshSnapshotId,
        syncedAt: freshSync,
        expiresAt: freshExpiry,
        snapshotItemCount: 2
    }));
    await loading;

    assert.equal(h.pending.length, 2, 'an expired cat-N key must not be retried automatically');
    assert.equal(h.shop.supplierCatalogCategoryNeedsReselect, true);
    assert.equal(h.shop.supplierCatalogCategoryKey, '');
    assert.equal(h.elements.get('supplierCatalogCategory').value, '__reselect__');
    assert.equal(h.shop.supplierCatalogItems.length, 0);
    assert.equal(h.shop.supplierCatalogTotal, 0);
    assert.match(h.elements.get('supplierCatalogFeedback').innerHTML, /请重新选择分类/);
    assert.match(h.elements.get('supplierCatalogTableBody').innerHTML, /分类快照已更新/);

    h.elements.get('supplierCatalogCategory').value = 'cat-1';
    h.shop.selectSupplierCatalogCategory('cat-1');
    const filtered = h.shop.loadSupplierCatalog({ page: 1 });
    assert.equal(h.pending.length, 3);
    const filteredRequest = new URL(h.pending[2].url, 'http://localhost');
    assert.equal(filteredRequest.searchParams.get('snapshotId'), freshSnapshotId);
    assert.equal(filteredRequest.searchParams.get('categoryKey'), 'cat-1');
    h.pending[2].resolve(response({
        success: true,
        total: 1,
        items: [item('XR-CATEGORY')],
        categories: [{ categoryKey: 'cat-1', name: '分类一', itemCount: 1 }],
        snapshotId: freshSnapshotId,
        syncedAt: freshSync,
        expiresAt: freshExpiry,
        snapshotItemCount: 2
    }));
    await filtered;

    assert.equal(h.shop.supplierCatalogCategoryKey, 'cat-1');
    assert.equal(h.elements.get('supplierCatalogCategory').value, 'cat-1');
    assert.equal(h.shop.supplierCatalogItems[0].providerGoodsId, 'XR-CATEGORY');
    assert.equal(h.shop.supplierCatalogTotal, 1);
});

test('manual Xiareng refresh keeps the catalog closed until a category is explicitly reselected', async () => {
    const h = workspace();
    const snapshotId = '00000000-0000-4000-8000-000000000011';
    const refreshedSnapshotId = '00000000-0000-4000-8000-000000000012';
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    h.elements.get('supplierCatalogCategory').innerHTML = '<option value="">全部分类</option><option value="cat-2">待刷新分类（1）</option>';
    h.elements.get('supplierCatalogCategory').value = 'cat-2';
    h.shop.supplierCatalogCategoryKey = 'cat-2';
    h.shop.supplierCatalogSnapshot = {
        providerId: 'xiareng', accountKey: 'first', site: 'cn', snapshotId,
        syncedAt: new Date().toISOString(), expiresAt,
        categories: [{ categoryKey: 'cat-2', name: '待刷新分类', itemCount: 1 }], itemCount: 1
    };

    const loading = h.shop.loadSupplierCatalog({ refresh: true, page: 1 });
    const refreshRequest = new URL(h.pending[0].url, 'http://localhost');
    assert.equal(refreshRequest.searchParams.get('refresh'), '1');
    assert.equal(refreshRequest.searchParams.get('snapshotId'), null);
    assert.equal(refreshRequest.searchParams.get('categoryKey'), null);
    h.pending[0].resolve(response({
        success: true,
        total: 2,
        items: [item('XR-ALL-1'), item('XR-ALL-2')],
        categories: [{ categoryKey: 'cat-2', name: '刷新后的分类', itemCount: 2 }],
        snapshotId: refreshedSnapshotId,
        syncedAt: new Date().toISOString(),
        expiresAt,
        snapshotItemCount: 2
    }));
    await loading;

    assert.equal(h.shop.supplierCatalogCategoryNeedsReselect, true);
    assert.equal(h.elements.get('supplierCatalogCategory').value, '__reselect__');
    assert.equal(h.shop.supplierCatalogItems.length, 0);
    assert.equal(h.shop.supplierCatalogTotal, 0);
    assert.doesNotMatch(h.elements.get('supplierCatalogTableBody').innerHTML, /XR-ALL/);
});

test('provider reset clears selections/detail and ignores late account discovery', async () => {
    const h = workspace();
    h.shop.supplierCatalogSelectedGoodsNos.add('OLD');
    h.shop.supplierCatalogAccountsProviderId = '';
    const old = h.shop.loadSupplierCatalog({ force: true });
    h.elements.get('supplierCatalogProvider').value = '16688';
    h.shop.resetSupplierCatalogContext({ providerChanged: true });
    h.pending[0].resolve(response({ success: true, accounts: [{ accountKey: 'stale', enabled: true, configured: true }] }));
    await old;
    assert.equal(h.shop.supplierCatalogAccountKey, '');
    assert.equal(h.shop.supplierCatalogAccounts.length, 0);
    assert.equal(h.shop.supplierCatalogSelectedGoodsNos.size, 0);
    assert.equal(h.shop.supplierCatalogDetailContext, null);
    assert.equal(h.elements.get('supplierCatalogDetailModal').getAttribute('aria-hidden'), 'true');
    assert.equal(h.pending.length, 1, 'stale account discovery must not trigger a catalog request');
});

test('disabled and unconfigured accounts stop before the upstream list request', async () => {
    for (const state of [{ enabled: false, configured: true }, { enabled: true, configured: false }]) {
        const h = workspace();
        h.shop.supplierCatalogAccounts = [{ accountKey: 'first', ...state }];
        await h.shop.loadSupplierCatalog();
        assert.equal(h.pending.length, 0);
        assert.match(h.elements.get('supplierCatalogFeedback').innerHTML, /停用|凭据/);
    }
});

test('detail keeps the original account/site and stale responses do not replace a newer product', async () => {
    const h = workspace();
    const old = h.shop.openSupplierCatalogDetail('OLD');
    const current = h.shop.openSupplierCatalogDetail('CURRENT');
    h.pending[1].resolve(response({ success: true, item: item('CURRENT') }));
    await current;
    h.pending[0].resolve(response({ success: true, item: item('OLD') }));
    await old;
    assert.equal(h.shop.supplierCatalogDetailItem.providerGoodsId, 'CURRENT');
    assert.equal(h.shop.supplierCatalogDetailContext.accountKey, 'first');
    assert.equal(h.shop.supplierCatalogDetailContext.site, 'cn');
    assert.equal(h.elements.get('supplierCatalogDetailBody').getAttribute('aria-busy'), 'false');
    assert.match(h.elements.get('supplierCatalogDetailBody').innerHTML, /CURRENT/);
    assert.doesNotMatch(h.elements.get('supplierCatalogDetailBody').innerHTML, /OLD/);
});

test('closing a detail invalidates pending detail and preview responses', async () => {
    const h = workspace();
    const loading = h.shop.openSupplierCatalogDetail('OLD');
    h.shop.closeSupplierCatalogDetail();
    h.pending[0].resolve(response({ success: true, item: item('OLD') }));
    await loading;
    assert.equal(h.shop.supplierCatalogDetailItem, null);
    await finishDetail(h, 'CURRENT');
    const preview = h.shop.previewSupplierCatalogDetail();
    h.shop.closeSupplierCatalogDetail();
    const before = h.elements.get('supplierCatalogPreview').textContent;
    h.pending.at(-1).resolve(response({ success: true, stock: { availableQuantity: 123 }, quote: { amount: '45' } }));
    await preview;
    assert.equal(h.elements.get('supplierCatalogPreview').textContent, before);
    assert.equal(h.elements.get('supplierCatalogDetailModal').getAttribute('aria-hidden'), 'true');
});

test('unverified complex variants, missing race and non-CN draft imports stay blocked', async () => {
    const h = workspace();
    await finishDetail(h, 'XR-1', { variantRequirements: { importable: false, reasons: ['SKU 待核验'] } });
    assert.equal(h.shop.isSupplierCatalogDetailImportable(), false);
    await h.shop.importSupplierCatalogDetail();
    assert.equal(h.pending.length, 1);
    h.shop.supplierCatalogDetailItem = item('XR-1', { variantRequirements: { importable: true, requiresRace: true, races: ['月卡'], reasons: [] } });
    assert.equal(h.shop.isSupplierCatalogDetailImportable(), false);
    h.elements.get('supplierCatalogRace').value = '月卡';
    assert.equal(h.shop.isSupplierCatalogDetailImportable(), true);
    h.shop.supplierCatalogDetailContext.site = 'intl';
    assert.equal(h.shop.isSupplierCatalogDetailImportable(), false);
    assert.equal(h.shop.isSupplierCatalogDetailImportable(false), true, 'read-only preview may remain available');
});

test('import freezes the viewed account/site/race, preserves feedback and does not close a newer detail', async () => {
    const h = workspace();
    await finishDetail(h, 'XR-1', { variantRequirements: { importable: true, requiresRace: true, races: ['月卡'], reasons: [] } });
    h.elements.get('supplierCatalogRace').value = '月卡';
    h.elements.get('supplierCatalogAccount').value = 'second';
    h.elements.get('supplierCatalogSite').value = 'intl';
    const importing = h.shop.importSupplierCatalogDetail();
    await new Promise(setImmediate); // Cross-context auth promise resolves before the POST starts.
    const request = h.pending.at(-1);
    assert.equal(request.options.method, 'POST');
    const body = JSON.parse(request.options.body);
    assert.equal(body.accountKey, 'first');
    assert.equal(body.site, 'cn');
    assert.deepEqual(body.variants, { 'XR-1': { race: '月卡' } });
    const next = h.shop.openSupplierCatalogDetail('NEW');
    h.pending.at(-1).resolve(response({ success: true, item: item('NEW') }));
    await next;
    request.resolve(response({ success: true, results: [{ goodsNo: 'XR-1', status: 'imported_as_draft', productId: 'draft', site: 'cn' }] }));
    await importing;
    assert.equal(h.shop.supplierCatalogDetailItem.providerGoodsId, 'NEW');
    assert.equal(h.elements.get('supplierCatalogDetailModal').classList.contains('active'), true);
    assert.match(h.elements.get('supplierCatalogFeedback').innerHTML, /编辑草稿/);
    assert.match(h.elements.get('supplierCatalogFeedback').innerHTML, /成功 1 项/);
    assert.deepEqual(h.invalidated, ['products']);
    assert.equal(h.pending.length, 3, 'successful import must not refetch catalog and erase its feedback');
    assert.equal(h.shop.supplierCatalogImportInFlight, false);
});

test('product mapping summary does not leak between products or after the editor closes', async () => {
    const h = workspace();
    const old = h.shop.loadProductSupplierSummary('old');
    const current = h.shop.loadProductSupplierSummary('current');
    h.pending[1].resolve(response({ success: true, mappings: [{ accountName: 'current account', goodsNo: 'CURRENT', site: 'cn', enabled: false }] }));
    await current;
    h.pending[0].resolve(response({ success: true, mappings: [{ accountName: 'old account', goodsNo: 'OLD', site: 'cn', enabled: false }] }));
    await old;
    const container = h.elements.get('productSupplierSummary');
    assert.match(container.innerHTML, /CURRENT/);
    assert.doesNotMatch(container.innerHTML, /old account/);
    const closing = h.shop.loadProductSupplierSummary('closing');
    ++h.shop.productSupplierSummaryToken; // Same invalidation used by product modal open/close.
    container.hidden = true;
    h.pending[2].resolve(response({ success: true, mappings: [{ goodsNo: 'CLOSED' }] }));
    await closing;
    assert.equal(container.hidden, true);
    assert.doesNotMatch(container.innerHTML, /CLOSED/);
});

test('unknown currency stays explicit and supplier-controlled text is escaped', async () => {
    const h = workspace();
    assert.equal(h.shop.formatSupplierCatalogPrice({ supplierUnitPrice: '0.12345678', currency: null }), '0.12345678 币种待核验');
    assert.equal(h.shop.formatSupplierCatalogPrice({ supplierUnitPrice: null, currency: 'CNY' }), '—');
    h.shop.renderSupplierCatalogDetail(item('XR-1', { name: '<img src=x onerror=alert(1)>', description: '<script>bad()</script>' }));
    const markup = h.elements.get('supplierCatalogDetailBody').innerHTML;
    assert.doesNotMatch(markup, /<script>|<img/);
    assert.match(markup, /&lt;script&gt;/);
    assert.doesNotMatch(markup, /12\.340000 CNY/);
});

test('runtime script and stylesheet carry the cache version inside their actual HTML URL attributes', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)];
    const script = scripts.find((entry) => entry[1].startsWith('js/admin-shop.js?'));
    assert.ok(script);
    assert.equal(new URL(script[1], 'http://localhost').searchParams.get('supplierCatalog'), '20261101_SUPPLIER_CATALOG_SESSION_SNAPSHOT_1');
    assert.equal(script[2].trim(), '', 'cache version must not become inline script text');
    const stylesheet = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)].find((entry) => entry[1].startsWith('css/admin-studio-page.css?'));
    assert.ok(stylesheet);
    assert.equal(new URL(stylesheet[1], 'http://localhost').searchParams.get('supplierCatalog'), '20261101_SUPPLIER_CATALOG_SESSION_SNAPSHOT_1');
});

test('an import completed after a context switch invalidates product cache without leaking old feedback', async () => {
    const h = workspace();
    const importing = h.shop.importSupplierCatalogGoods(['XR-1'], { confirm: false });
    await new Promise(setImmediate);
    h.shop.resetSupplierCatalogContext({ providerChanged: true });
    h.elements.get('supplierCatalogFeedback').innerHTML = 'new context';
    h.pending[0].resolve(response({ success: true, results: [{ goodsNo: 'XR-1', status: 'imported_as_draft', productId: 'draft' }] }));
    await importing;
    assert.equal(h.elements.get('supplierCatalogFeedback').innerHTML, 'new context');
    assert.deepEqual(h.invalidated, ['products']);
    assert.equal(h.shop.supplierCatalogImportInFlight, false);
});


test('procurement history loads only on demand, including for disabled unconfigured accounts', async () => {
    const h = workspace();
    assert.equal(h.pending.length, 0);
    h.shop.supplierCatalogAccounts = [{ accountKey: 'first', enabled: false, configured: false }];
    const loading = h.shop.loadSupplierOperations();
    const request = h.pending[0];
    const url = new URL(request.url, 'http://localhost');
    assert.equal(url.searchParams.get('action'), 'procurements');
    assert.equal(url.searchParams.get('providerId'), 'xiareng');
    assert.equal(url.searchParams.get('accountKey'), 'first');
    assert.equal(request.options.cache, 'no-store');
    request.resolve(response({ success: true, rows: [], hasMore: false }));
    await loading;
    assert.match(h.elements.get('supplierOperationsTableBody').innerHTML, /暂无采购/);
});

test('late procurement history cannot overwrite a newly selected account or provider', async () => {
    for (const providerChanged of [false, true]) {
        const h = workspace();
        const old = h.shop.loadSupplierOperations();
        h.elements.get('supplierCatalogAccount').value = 'second';
        if (providerChanged) h.elements.get('supplierCatalogProvider').value = '16688';
        h.shop.resetSupplierCatalogContext({ providerChanged });
        assert.equal(h.elements.get('supplierOperationsPanel').open, false);
        // A provider switch intentionally clears the account selector. The
        // current request can only start after the operator selects an account
        // for the newly selected provider.
        if (providerChanged) h.elements.get('supplierCatalogAccount').value = 'second';
        const current = h.shop.loadSupplierOperations();
        h.pending[1].resolve(response({ success: true, rows: [{ orderNo: 'CURRENT', fundingKind: 'points' }], hasMore: false }));
        await current;
        h.pending[0].resolve(response({ success: true, rows: [{ orderNo: 'OLD-ACCOUNT', fundingKind: 'guest_cash' }], hasMore: false }));
        await old;
        assert.match(h.elements.get('supplierOperationsTableBody').innerHTML, /CURRENT/);
        assert.doesNotMatch(h.elements.get('supplierOperationsTableBody').innerHTML, /OLD-ACCOUNT/);
    }
});

test('procurement rows escape merchant text, retain zero costs and link native order types', async () => {
    const h = workspace();
    const loading = h.shop.loadSupplierOperations();
    h.pending[0].resolve(response({ success: true, hasMore: true, rows: [{
        orderNo: '<img src=x onerror=bad()>', nativeOrderId: 'abc" onclick="bad()', productName: '<script>bad()</script>',
        supplierOrderNo: '<svg onload=bad()>', fundingKind: 'points', costVerified: true, actualCostCny: '0.000000',
        reservedCostCny: '0', procurementState: 'accepted', deliveryState: 'delivered'
    }, { orderNo: 'GUEST-1', nativeOrderId: 'guest-id', fundingKind: 'guest_cash', costVerified: false,
        actualCostCny: null, reservedCostCny: '20', deliveryState: 'quarantined', quarantineReason: 'duplicate_content' }] }));
    await loading;
    const markup = h.elements.get('supplierOperationsTableBody').innerHTML;
    assert.doesNotMatch(markup, /<img|<script|<svg|" onclick="/);
    assert.match(markup, /&lt;img/);
    assert.match(markup, /0\.000000 CNY/);
    assert.match(markup, /data-shop-action="order-show-content"/);
    assert.match(markup, /data-shop-action="guest-exception-row-detail"/);
    assert.match(markup, /待核验/);
    assert.match(markup, /内容与其他采购重复/);
    assert.match(h.elements.get('supplierOperationsStatus').textContent, /最近 50 笔/);
});

test('unavailable procurement history can retry and invalid site makes no request', async () => {
    const h = workspace();
    const loading = h.shop.loadSupplierOperations();
    h.pending[0].resolve(response({ success: false, message: '采购记录暂不可用' }, 503));
    await loading;
    assert.match(h.elements.get('supplierOperationsStatus').textContent, /暂不可用/);
    const retry = h.shop.loadSupplierOperations();
    h.pending[1].resolve(response({ success: true, rows: [], hasMore: false }));
    await retry;
    assert.match(h.elements.get('supplierOperationsStatus').textContent, /共 0 笔/);
    h.elements.get('supplierCatalogSite').value = 'intl';
    await h.shop.loadSupplierOperations();
    assert.equal(h.pending.length, 2);
    assert.match(h.elements.get('supplierOperationsStatus').textContent, /国内站/);
});

test('tree selection updates groupKey or categoryKey and passes to query', async () => {
    const h = workspace();
    const snapshotPayload = {
        snapshotId: '11111111-1111-4111-8111-111111111111',
        syncedAt: '2026-11-03T00:00:00.000Z',
        expiresAt: '2026-11-03T01:00:00.000Z',
        snapshotItemCount: 10,
        categories: [
            { categoryId: 10, categoryKey: 'cat-10', name: 'Gemini 3.1pro', itemCount: 6 },
            { categoryId: 20, categoryKey: 'cat-20', name: 'Other', itemCount: 4 }
        ],
        categoryTree: {
            groups: [
                {
                    groupKey: 'gemini',
                    title: 'Gemini',
                    categories: [
                        { categoryId: 10, categoryKey: 'cat-10', name: 'Gemini 3.1pro', itemCount: 6 }
                    ],
                    totalItemCount: 6
                }
            ],
            standalone: [
                { categoryId: 20, categoryKey: 'cat-20', name: 'Other', itemCount: 4 }
            ],
            totalCategories: 2
        }
    };
    h.shop.applySupplierCatalogSnapshot(snapshotPayload, h.shop.getSupplierCatalogQuery());
    assert.match(h.elements.get('supplierCatalogTree').innerHTML, /Gemini 3\.1pro/);
    assert.match(h.elements.get('supplierCatalogTree').innerHTML, /data-group-key="gemini"/);

    // Select category cat-10
    h.shop.selectSupplierCatalogCategory('cat-10');
    assert.equal(h.shop.supplierCatalogCategoryKey, 'cat-10');
    assert.equal(h.shop.supplierCatalogGroupKey, '');
    assert.equal(h.elements.get('supplierCatalogCategory').value, 'cat-10');

    // Select group gemini
    h.shop.selectSupplierCatalogGroup('gemini');
    assert.equal(h.shop.supplierCatalogCategoryKey, '');
    assert.equal(h.shop.supplierCatalogGroupKey, 'gemini');
    assert.equal(h.elements.get('supplierCatalogCategory').value, '');

    // Reset all
    h.shop.selectSupplierCatalogCategory('');
    h.shop.supplierCatalogGroupKey = '';
    assert.equal(h.shop.supplierCatalogCategoryKey, '');
    assert.equal(h.shop.supplierCatalogGroupKey, '');
    assert.equal(h.shop.supplierCatalogExplicitAll, true);

    // Test Array categoryTree format (from buildCategoryTree)
    const arrayTreePayload = {
        snapshotId: '22222222-2222-4222-8222-222222222222',
        syncedAt: '2026-11-03T00:00:00.000Z',
        expiresAt: '2026-11-03T01:00:00.000Z',
        snapshotItemCount: 15,
        categories: [
            { categoryId: 101, categoryKey: 'cat-101', name: '谷歌邮箱自营', itemCount: 10 },
            { categoryId: 102, categoryKey: 'cat-102', name: '独立分类', itemCount: 5 }
        ],
        categoryTree: [
            {
                type: 'group',
                groupKey: 'xr-2',
                name: '谷歌邮箱',
                children: [
                    { type: 'category', categoryKey: 'cat-101', name: '谷歌邮箱自营', itemCount: 10 }
                ],
                itemCount: 10
            },
            {
                type: 'category',
                categoryKey: 'cat-102',
                name: '独立分类',
                itemCount: 5
            }
        ]
    };
    h.shop.applySupplierCatalogSnapshot(arrayTreePayload, h.shop.getSupplierCatalogQuery());
    const treeHtml = h.elements.get('supplierCatalogTree').innerHTML;
    assert.match(treeHtml, /谷歌邮箱/);
    assert.match(treeHtml, /谷歌邮箱自营/);
    assert.match(treeHtml, /独立分类/);
    assert.match(treeHtml, /data-group-key="xr-2"/);
    assert.match(treeHtml, /data-category-key="cat-101"/);
    assert.match(treeHtml, /data-category-key="cat-102"/);
});

test('multi-variant detail renders options and imports with multiVariants payload', async () => {
    const h = workspace();
    const multivariantItem = item('XR-MULTI', {
        supplierUnitPrice: '10.00',
        variantRequirements: {
            importable: true,
            requiresRace: true,
            races: ['标准版', '高级版'],
            racePrices: { '标准版': '10.00', '高级版': '25.00' },
            reasons: []
        }
    });
    h.shop.renderSupplierCatalogDetail(multivariantItem);
    const bodyMarkup = h.elements.get('supplierCatalogDetailBody').innerHTML;
    assert.match(bodyMarkup, /规格与交付核验/);
    assert.match(bodyMarkup, /全部规格（自动匹配导入 2 个规格 SKU）/);
    assert.match(bodyMarkup, /标准版/);
    assert.match(bodyMarkup, /高级版/);
    assert.match(bodyMarkup, /supplierCatalogAllVariantsInfo/);

    // Test import with multiVariants passed to importSupplierCatalogGoods
    const importing = h.shop.importSupplierCatalogGoods(['XR-MULTI'], {
        context: { providerId: 'xiareng', accountKey: 'first', site: 'cn' },
        variants: { 'XR-MULTI': { race: '标准版' } },
        multiVariants: {
            'XR-MULTI': [
                { race: '标准版', price: '10.00', costCeiling: '10.00' },
                { race: '高级版', price: '25.00', costCeiling: '25.00' }
            ]
        }
    });
    await new Promise(setImmediate);
    const request = h.pending.at(-1);
    assert.equal(request.options.method, 'POST');
    const parsedBody = JSON.parse(request.options.body);
    assert.deepEqual(parsedBody.multiVariants, {
        'XR-MULTI': [
            { race: '标准版', price: '10.00', costCeiling: '10.00' },
            { race: '高级版', price: '25.00', costCeiling: '25.00' }
        ]
    });
    assert.deepEqual(parsedBody.variants, { 'XR-MULTI': { race: '标准版' } });
    request.resolve(response({ success: true, results: [{ goodsNo: 'XR-MULTI', status: 'imported_as_draft', productId: 'p-1', site: 'cn' }] }));
    await importing;
    assert.match(h.elements.get('supplierCatalogFeedback').innerHTML, /成功 1 项/);
});

test('Xiareng supplier catalog allows selecting items, selecting all, and importing selected items with autoAllVariants', async () => {
    const h = workspace();
    h.shop.supplierCatalogItems = [
        { providerGoodsId: 'XR-ITEM-1', name: '商品1', price: '10', deliveryMethod: 1 },
        { providerGoodsId: 'XR-ITEM-2', name: '商品2', price: '20', deliveryMethod: 1 }
    ];
    h.shop.renderSupplierCatalogRows();
    const rowsHtml = h.elements.get('supplierCatalogTableBody').innerHTML;
    assert.doesNotMatch(rowsHtml, /disabled title="请在详情中核对规格后导入"/);
    assert.match(rowsHtml, /data-goods-no="XR-ITEM-1"/);

    // Sync controls
    h.shop.syncSupplierCatalogControls();
    assert.equal(h.elements.get('supplierCatalogSelectAll').disabled, false);
    assert.equal(h.elements.get('supplierCatalogSelectionCount').textContent, '已选 0 项');

    // Select all
    h.shop.selectAllSupplierCatalogPage(true);
    assert.equal(h.shop.supplierCatalogSelectedGoodsNos.size, 2);
    assert.equal(h.elements.get('supplierCatalogSelectAll').checked, true);
    assert.equal(h.elements.get('supplierCatalogSelectionCount').textContent, '已选 2 项');
    assert.equal(h.elements.get('supplierCatalogImportButton').disabled, false);

    // Import selected items
    const importing = h.shop.importSupplierCatalogGoods(null, { confirm: false });
    await new Promise(setImmediate);
    const request = h.pending.at(-1);
    assert.equal(request.options.method, 'POST');
    const parsed = JSON.parse(request.options.body);
    assert.equal(parsed.action, 'import');
    assert.deepEqual(parsed.goodsNos, ['XR-ITEM-1', 'XR-ITEM-2']);
    assert.equal(parsed.autoAllVariants, true);
    request.resolve(response({
        success: true,
        results: [
            { goodsNo: 'XR-ITEM-1', status: 'imported_as_draft', productId: 'p-1', site: 'cn' },
            { goodsNo: 'XR-ITEM-2', status: 'imported_as_draft', productId: 'p-2', site: 'cn' }
        ]
    }));
    await importing;
    assert.match(h.elements.get('supplierCatalogFeedback').innerHTML, /成功 2 项/);
});

test('batch import matrix preselects active category and supports group category lookup', () => {
    const h = workspace();
    const tree = [
        {
            type: 'group',
            groupKey: 'grp-1',
            categories: [
                { categoryKey: 'cat-1' },
                { categoryKey: 'cat-2' }
            ]
        }
    ];
    const catKeys = h.shop.findCategoryKeysForGroup(tree, 'grp-1');
    assert.deepEqual([...catKeys], ['cat-1', 'cat-2']);

    const emptyKeys = h.shop.findCategoryKeysForGroup(tree, 'nonexistent');
    assert.deepEqual([...emptyKeys], []);
});
