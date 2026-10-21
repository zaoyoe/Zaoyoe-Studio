'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildXiarengForm, signXiarengParams, createXiarengAdapter } = require('../server/integrations/suppliers/xiareng/client');
const { createConfiguredSupplierAdapterRegistry, getSupplierAccountConfiguration } = require('../server/integrations/suppliers/registry');

function fixture(overrides = {}) {
    return { code: 'XR-1', name: '演示商品', user_price: '12.340000', price: '99.99', stock: '15', delivery_way: 0, minimum: 0, config: {}, widget: [], ...overrides };
}
function setup(payloads, options = {}) {
    const calls = [];
    const adapter = createXiarengAdapter({ appId: 'merchant', appKey: 'key-do-not-output', ...options,
        async fetchImpl(url, init) {
            calls.push({ url, ...init });
            const payload = payloads.shift();
            if (payload instanceof Error) throw payload;
            if (payload && payload.__raw) return new Response(JSON.stringify(payload.value), { status: 200 });
            if (payload instanceof Response) return payload;
            return new Response(JSON.stringify({ code: 200, data: payload }), { status: 200 });
        }
    });
    return { adapter, calls };
}

test('Xiareng form/signature matches the published PHP algorithm including nested order, zero, bool, Unicode and key urldecode', () => {
    const params = { z: '', sku: { 颜色: '黑 色', size: 'A+B&%', blank: '' }, code: '中文 + %&', app_id: 12, flag: false, num: 0, unused: null, sign: 'ignored' };
    assert.equal(buildXiarengForm(params), 'app_id=12&code=%E4%B8%AD%E6%96%87+%2B+%25%26&flag=0&num=0&sku%5B%E9%A2%9C%E8%89%B2%5D=%E9%BB%91+%E8%89%B2&sku%5Bsize%5D=A%2BB%26%25&sku%5Bblank%5D=');
    const independentlyDecodedPhpInput = 'app_id=12&code=中文 + %&&flag=0&num=0&sku[颜色]=黑 色&sku[size]=A+B&%&sku[blank]=&key=key &中';
    const expected = crypto.createHash('md5').update(independentlyDecodedPhpInput).digest('hex');
    assert.equal(signXiarengParams(params, 'key+%26中'), expected);
    assert.notEqual(signXiarengParams({ ...params, sku: { size: 'A+B&%', 颜色: '黑 色', blank: '' } }, 'key+%26中'), expected);
});

test('catalog is flattened, filtered and paginated locally without invented upstream page parameters or raw credentials', async () => {
    const { adapter, calls } = setup([[{ id: 1, name: '类别', children: [fixture(), fixture({ code: 'XR-2', name: '其他' }), fixture(), null] }]]);
    const result = await adapter.listGoods({ pageNo: 1, pageSize: 1, keywords: '演示' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].providerGoodsId, 'XR-1');
    assert.equal(result.items[0].supplierUnitPrice, '12.340000');
    assert.equal(result.items[0].currency, 'CNY');
    assert.equal(result.items[0].currencyStatus, 'operator_confirmed');
    assert.equal(result.items[0].availableQuantity, 15);
    assert.equal(result.items[0].procurementReady, false);
    assert.equal('raw' in result.items[0], false);
    assert.equal(result.items[0].variantRequirements.importable, false);
    assert.equal(calls[0].url, 'https://xiareng.cc/shared/commodity/items');
    assert.equal(calls[0].redirect, 'error');
    assert.match(calls[0].headers['Content-Type'], /x-www-form-urlencoded/);
    const sent = new URLSearchParams(calls[0].body);
    assert.deepEqual([...sent.keys()], ['app_id', 'sign']);
    assert.equal(calls[0].body.includes('key-do-not-output'), false);
});

test('untrusted upstream normalized-looking fields cannot bypass sanitization', async () => {
    const { adapter } = setup([fixture({ providerGoodsId: 'injected', raw: { app_key: 'leak' }, secret: 'card data', supplierUnitPrice: '0' })]);
    const item = await adapter.getGoodsDetail('XR-1');
    assert.equal(item.providerGoodsId, 'XR-1');
    assert.equal('secret' in item, false);
    assert.equal('raw' in item, false);
    assert.equal(item.supplierUnitPrice, '12.340000');
    assert.equal(adapter.normalizeCatalogItem(item), item);
});

test('price, delivery and configured currency preserve uncertainty rather than inventing usable procurement facts', async () => {
    const { adapter } = setup([fixture({ user_price: undefined, stock: '充足', delivery_way: 1 })]);
    const item = await adapter.getGoodsDetail('XR-1');
    assert.equal(item.supplierUnitPrice, null); // Never substitute visitor retail price.
    assert.equal(item.availableQuantity, null);
    assert.equal(item.deliveryMethod, null);
    assert.match(item.deliveryLabel, /待核验/);
    const configured = setup([fixture()], { currency: 'USD' });
    assert.equal((await configured.adapter.getGoodsDetail('XR-1')).currency, 'USD');
});

test('race is required and must be explicitly selected from documented category keys', async () => {
    const { adapter } = setup([fixture({ config: { category: { 月卡: '1', 年卡: '2' } } })]);
    const item = await adapter.getGoodsDetail('XR-1');
    assert.deepEqual(item.variantRequirements.races, ['月卡', '年卡']);
    assert.throws(() => adapter.normalizeVariant(item, {}), /请选择/);
    assert.throws(() => adapter.normalizeVariant(item, { race: '周卡' }), /请选择/);
    assert.throws(() => adapter.normalizeVariant(item, { race: '月卡', sku: { color: 'black' } }), /不支持/);
    assert.deepEqual(adapter.normalizeVariant(item, { race: '月卡' }), { race: '月卡' });
});

for (const [label, overrides] of Object.entries({
    sku: { config: { sku: { color: ['black', 'white'] } } }, widget: { widget: [{ name: 'email' }] },
    draft: { draft_status: 1 }, seckill: { seckill_status: 1 }, malformed: { config: 'ini text' }, unknown: { config: { newOption: true } }
})) {
    test(`${label} configuration remains preview-only and cannot be silently imported as default`, async () => {
        const { adapter } = setup([fixture(overrides)]);
        const item = await adapter.getGoodsDetail('XR-1');
        assert.equal(item.variantRequirements.importable, false);
        assert.ok(item.variantRequirements.reasons.length);
        assert.throws(() => adapter.normalizeVariant(item, {}));
    });
}

test('stock and valuation use only documented read paths, preserve precision and never claim a locked cost', async () => {
    const { adapter, calls } = setup([fixture(), { stock: '0' }, fixture(), { price: '0.12345678' }]);
    const stock = await adapter.getStock({ goodsNo: 'XR-1' });
    const quote = await adapter.quotePrice({ goodsNo: 'XR-1', quantity: 3 });
    assert.equal(stock.availableQuantity, 0);
    assert.equal(stock.locked, false);
    assert.equal(quote.amount, '0.12345678');
    // 2026-10-21 probe: `price` is the CNY total for the requested quantity.
    assert.equal(quote.amountBasis, 'total_cny');
    assert.equal(quote.currency, 'CNY');
    assert.equal(quote.locked, false);
    assert.match(calls[1].url, /\/stock$/);
    assert.match(calls[3].url, /\/valuation$/);
    assert.equal(new URLSearchParams(calls[3].body).get('num'), '3');
    assert.ok(calls.every((call) => !/trade|query|draft/.test(call.url)));
});

test('procurement stays undeclared and the registry rejects it before any fetch', () => {
    // The create/query methods exist so the verified profile can be wired later,
    // but the capability flag is what authorises them. Until a dispatch profile
    // matching the live API is approved in the database, procurement is refused.
    const { adapter, calls } = setup([]);
    assert.equal(adapter.capabilities.procurement, false);
    assert.equal(adapter.procurementProfile.requestLookup, 'none');
    assert.equal(adapter.procurementProfile.costCeiling, 'preflight_quote_then_verify');
    const registry = createConfiguredSupplierAdapterRegistry({ env: { SUPPLIER_XIARENG_APP_ID: 'a', SUPPLIER_XIARENG_APP_KEY: 'k' } });
    assert.throws(() => registry.require('xiareng', 'procurement'), (error) => error.code === 'supplier_capability_unsupported');
    assert.equal(calls.length, 0);
});

function purchaseFixture(extra = {}) {
    return [fixture(), fixture(), { price: '0.16' }, fixture(), { stock: '100' }, { tradeNo: '778217796203351836', amount: '0.16', secret: 'CARD-SECRET', stock: '16382', ...extra }];
}
const PURCHASE = { requestId: '2db86646-3d58-4549-a25b-9ca910aed939', goodsNo: 'XR-1', quantity: 1,
    variant: {}, maxCost: { currency: 'CNY', amount: '1.00' } };

test('createPurchase sends exactly one trade with the frozen request key and returns no secret', async () => {
    const { adapter, calls } = setup(purchaseFixture());
    const result = await adapter.createPurchase(PURCHASE);
    assert.equal(result.outcome, 'accepted');
    assert.equal(result.orderNo, '778217796203351836');
    assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
    assert.equal('secret' in result, false);
    assert.equal(JSON.stringify(result).includes('CARD-SECRET'), false);
    const trades = calls.filter((call) => /\/trade$/.test(call.url));
    assert.equal(trades.length, 1);
    const sent = new URLSearchParams(trades[0].body);
    assert.equal(sent.get('shared_code'), 'XR-1');
    assert.equal(sent.get('num'), '1');
    assert.equal(sent.get('device'), '0');
    assert.equal(sent.get('request_no'), PURCHASE.requestId);
    assert.equal(trades[0].body.includes('key-do-not-output'), false);
});

test('createPurchase refuses an over-ceiling quote before any trade request', async () => {
    const { adapter, calls } = setup([fixture(), fixture(), { price: '5.00' }]);
    const result = await adapter.createPurchase(PURCHASE);
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.definitivelyNotAccepted, true);
    assert.equal(result.code, 'cost_ceiling_exceeded');
    assert.equal(calls.some((call) => /\/trade$/.test(call.url)), false);
});

test('a replayed request key is ambiguous, never a rejection and never a second trade', async () => {
    const { adapter, calls } = setup([...purchaseFixture().slice(0, 5),
        { __raw: true, value: { code: 0, msg: 'The request ID already exists' } }]);
    const result = await adapter.createPurchase(PURCHASE);
    // The order exists upstream but its tradeNo is unrecoverable, so this must
    // stay ambiguous for human reconciliation instead of becoming a success.
    assert.equal(result.outcome, 'unknown');
    assert.equal(result.code, 'request_key_already_exists');
    assert.equal(calls.filter((call) => /\/trade$/.test(call.url)).length, 1);
});

test('a genuine business rejection is definitive and never becomes an unknown outcome', async () => {
    const { adapter } = setup([...purchaseFixture().slice(0, 5),
        { __raw: true, value: { code: 0, msg: '商品库存不足' } }]);
    const result = await adapter.createPurchase(PURCHASE);
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.definitivelyNotAccepted, true);
});

test('a debit above the authorised ceiling is never reported as accepted', async () => {
    const { adapter } = setup(purchaseFixture({ amount: '9.99' }));
    await assert.rejects(() => adapter.createPurchase(PURCHASE), (error) => error.code === 'supplier_cost_ceiling_exceeded');
});

test('createPurchase reports the debited amount so the caller can verify the ceiling after the fact', async () => {
    const { adapter } = setup(purchaseFixture());
    const result = await adapter.createPurchase(PURCHASE);
    assert.equal(result.outcome, 'accepted');
    assert.equal(result.actualAmountCny, '0.16');
    assert.equal('secret' in result, false);
    assert.equal(JSON.stringify(result).includes('CARD-SECRET'), false);
});

test('fetchDelivery reads the card content only for an order the supplier reports as paid', async () => {
    const unpaid = setup([{ status: 0, secret: '' }]);
    assert.equal(await unpaid.adapter.fetchDelivery({ requestId: PURCHASE.requestId, orderNo: '778217796203351836' }), null);

    const paid = setup([{ status: 1, secret: 'CARD-SECRET', widget: null }]);
    const delivery = await paid.adapter.fetchDelivery({ requestId: PURCHASE.requestId, orderNo: '778217796203351836' });
    assert.equal(delivery.content, 'CARD-SECRET');
    assert.equal(delivery.orderNo, '778217796203351836');
    assert.match(paid.calls[0].url, /\/query$/);

    // An empty payload is a failure, never an empty delivery.
    const blank = setup([{ status: 1, secret: '   ' }]);
    await assert.rejects(() => blank.adapter.fetchDelivery({ requestId: PURCHASE.requestId, orderNo: '778217796203351836' }),
        (error) => error.code === 'supplier_delivery_empty');

    // No order number, no request.
    const none = setup([]);
    await assert.rejects(() => none.adapter.fetchDelivery({ requestId: PURCHASE.requestId, orderNo: '' }), TypeError);
    assert.equal(none.calls.length, 0);
});

test('read-only order lookup sends the complete tradeNo and maps only documented payment states', async () => {
    const paidOrderNo = 'XR-ORDER-20261021-PAID';
    const paid = setup([{ status: 1, secret: 'CARD-SECRET-DO-NOT-RETURN' }]);
    const paidResult = await paid.adapter.queryPurchaseByOrderNo(paidOrderNo);
    const paidRequest = new URLSearchParams(paid.calls[0].body);

    assert.equal(paid.calls.length, 1);
    assert.match(paid.calls[0].url, /\/query$/);
    assert.equal(paidRequest.get('tradeNo'), paidOrderNo);
    assert.equal(paidRequest.get('app_id'), 'merchant');
    assert.equal(paidResult.supplierOrderNo, paidOrderNo);
    assert.equal(paidResult.paymentStatus, 'paid');
    assert.equal(paidResult.deliveryContentPresent, true);
    assert.equal('secret' in paidResult, false);
    assert.doesNotMatch(JSON.stringify(paidResult), /CARD-SECRET-DO-NOT-RETURN/);

    const unpaidOrderNo = 'XR-ORDER-20261021-UNPAID';
    const unpaid = setup([{ status: 0, secret: '' }]);
    const unpaidResult = await unpaid.adapter.queryPurchaseByOrderNo(unpaidOrderNo);
    const unpaidRequest = new URLSearchParams(unpaid.calls[0].body);

    assert.equal(unpaidRequest.get('tradeNo'), unpaidOrderNo);
    assert.equal(unpaidResult.paymentStatus, 'unpaid');
    assert.equal(unpaidResult.deliveryContentPresent, false);
    assert.equal('secret' in unpaidResult, false);
});

test('read-only order lookup rejects malformed order numbers and undocumented supplier states before safe evidence is returned', async () => {
    const malformed = setup([]);
    await assert.rejects(() => malformed.adapter.queryPurchaseByOrderNo(' XR-ORDER-1'), TypeError);
    assert.equal(malformed.calls.length, 0);

    for (const payload of [
        { status: 2, secret: '' },
        { status: 'paid', secret: '' },
        { status: 1, secret: { card: 'CARD-SECRET-DO-NOT-RETURN' } }
    ]) {
        const { adapter, calls } = setup([payload]);
        await assert.rejects(adapter.queryPurchaseByOrderNo('XR-ORDER-20261021-INVALID'), (error) => {
            assert.equal(error.code, 'supplier_invalid_response');
            assert.doesNotMatch(error.message, /CARD-SECRET-DO-NOT-RETURN|paid/);
            return true;
        });
        assert.equal(calls.length, 1);
    }
});

test('queryPurchase never guesses: no trade number means no request, and status 0 is not paid', async () => {
    const empty = setup([]);
    assert.equal(await empty.adapter.queryPurchase({ requestId: PURCHASE.requestId, orderNo: null }), null);
    assert.equal(empty.calls.length, 0);

    const unpaid = setup([{ status: 0, secret: '' }]);
    assert.equal((await unpaid.adapter.queryPurchase({ requestId: PURCHASE.requestId, orderNo: '778217796203351836' })).outcome, 'unpaid');

    const paid = setup([{ status: 1, secret: 'CARD-SECRET', widget: null }]);
    const result = await paid.adapter.queryPurchase({ requestId: PURCHASE.requestId, orderNo: '778217796203351836' });
    assert.equal(result.outcome, 'accepted');
    assert.equal(result.orderNo, '778217796203351836');
    assert.equal(JSON.stringify(result).includes('CARD-SECRET'), false);
    assert.match(paid.calls[0].url, /\/query$/);
});

test('protocol, HTTP and network failures never expose raw upstream error text or secret-bearing causes', async () => {
    for (const payload of [new Response('<html>key-do-not-output</html>'), new Response(JSON.stringify({ code: 0, msg: 'key-do-not-output' })), new Response('error', { status: 503 }), new Error('key-do-not-output')]) {
        const { adapter } = setup([payload]);
        await assert.rejects(adapter.listGoods(), (error) => {
            assert.equal(error.name, 'SupplierAdapterError');
            assert.equal(error.outcomeUnknown, false);
            assert.equal(error.message.includes('key-do-not-output'), false);
            assert.equal(error.cause, undefined);
            return true;
        });
    }
});

test('catalog responses above the old limit remain readable while oversized responses still fail closed', async () => {
    const largePayload = JSON.stringify({ code: 200, data: [], padding: 'x'.repeat(3 * 1024 * 1024) });
    const { adapter: largeAdapter } = setup([new Response(largePayload)]);
    assert.deepEqual(await largeAdapter.listGoods(), { total: 0, items: [] });

    const oversized = setup([new Response(' '.repeat(8 * 1024 * 1024 + 1))]);
    await assert.rejects(oversized.adapter.listGoods(), (error) => error.code === 'supplier_response_too_large');

    const { adapter } = setup([fixture({ code: 'OTHER' })]);
    await assert.rejects(adapter.getGoodsDetail('XR-1'), (error) => error.code === 'supplier_invalid_response');
});

test('timeout aborts a read; it does not produce procurement outcome uncertainty', async () => {
    const adapter = createXiarengAdapter({ appId: 'a', appKey: 'k', timeoutMs: 500,
        fetchImpl: async (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
    await assert.rejects(adapter.listGoods(), (error) => error.code === 'supplier_timeout' && error.retryable && !error.outcomeUnknown);
});

test('multiple accounts of one provider sign with distinct credentials; persisted references cannot read unrelated env secrets', async () => {
    const env = { SUPPLIER_XIARENG_APP_ID: 'first', SUPPLIER_XIARENG_APP_KEY: 'first-key', SUPPLIER_XIARENG_SECOND_APP_ID: 'second', SUPPLIER_XIARENG_SECOND_APP_KEY: 'second-key' };
    const requests = [];
    const options = { xiareng: { async fetchImpl(_, init) { requests.push(new URLSearchParams(init.body)); return new Response(JSON.stringify({ code: 200, data: [] })); } } };
    for (const prefix of ['SUPPLIER_XIARENG', 'SUPPLIER_XIARENG_SECOND']) {
        const account = { provider_id: 'xiareng', credential_ref: `env:${prefix}` };
        const registry = createConfiguredSupplierAdapterRegistry({ env, account, options });
        await registry.require('xiareng', 'catalog').listGoods();
    }
    assert.deepEqual(requests.map((request) => request.get('app_id')), ['first', 'second']);
    assert.notEqual(requests[0].get('sign'), requests[1].get('sign'));
    for (const ref of ['env:SUPABASE_SERVICE_ROLE', 'env:SUPPLIER_16688', 'file:/tmp/key', 'env:SUPPLIER_XIARENG;OTHER']) {
        const account = { provider_id: 'xiareng', credential_ref: ref };
        assert.equal(getSupplierAccountConfiguration(account, env).configured, false);
        assert.throws(() => createConfiguredSupplierAdapterRegistry({ env, account }), (error) => error.code === 'supplier_credential_ref_invalid');
    }
});


test('malformed category trees fail visibly instead of silently becoming an empty catalog', async () => {
    for (const data of [{ children: [] }, [null], [{ name: 'broken' }], [{ children: {} }]]) {
        const { adapter } = setup([data]);
        await assert.rejects(adapter.listGoods(), (error) => error.code === 'supplier_invalid_response');
    }
});

test('identity and variant keys cannot be silently trimmed, truncated or coerced', async () => {
    for (const code of [' XR-1', 'XR-1 ', 'X'.repeat(161)]) {
        const { adapter } = setup([fixture({ code })]);
        await assert.rejects(adapter.getGoodsDetail('XR-1'), (error) => error.code === 'supplier_invalid_response');
    }
    const { adapter } = setup([fixture({ config: { category: { valid: 1 } } })]);
    const item = await adapter.getGoodsDetail('XR-1');
    for (const race of [' valid', 'valid ', 'v'.repeat(161), 123]) assert.throws(() => adapter.normalizeVariant(item, { race }));
    const malformed = setup([fixture({ config: { category: { ' padded ': 1 } } })]);
    assert.equal((await malformed.adapter.getGoodsDetail('XR-1')).variantRequirements.importable, false);
});

test('malformed scalar SKU configuration is preview-only even when it has no enumerable keys', async () => {
    for (const sku of [5, true]) {
        const { adapter } = setup([fixture({ config: { sku } })]);
        assert.equal((await adapter.getGoodsDetail('XR-1')).variantRequirements.importable, false);
    }
});

test('empty upstream option containers are a single default variant, not an unverifiable configuration', async () => {
    // The live catalogue returns config: [] and widget: '' for goods without
    // options. Those must stay importable, while any real option payload must not.
    for (const overrides of [{ config: [], widget: [] }, { config: '', widget: '' }, { config: {}, widget: [] }]) {
        const { adapter } = setup([fixture(overrides)]);
        const item = await adapter.getGoodsDetail('XR-1');
        assert.equal(item.variantRequirements.importable, true, JSON.stringify(overrides));
        assert.deepEqual(item.variantRequirements.races, []);
        assert.equal(item.variantRequirements.requiresRace, false);
        assert.deepEqual(adapter.normalizeVariant(item, {}), {});
    }
    const { adapter } = setup([fixture({ config: 'ini text' })]);
    assert.equal((await adapter.getGoodsDetail('XR-1')).variantRequirements.importable, false);
    const widgets = setup([fixture({ widget: [{ name: 'email' }] })]);
    assert.equal((await widgets.adapter.getGoodsDetail('XR-1')).variantRequirements.importable, false);
});
