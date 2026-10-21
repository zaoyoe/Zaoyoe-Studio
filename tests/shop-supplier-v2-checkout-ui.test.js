'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shopSource = fs.readFileSync(path.join(__dirname, '../js/shop-client.js'), 'utf8');
const walletSource = fs.readFileSync(path.join(__dirname, '../js/components/WalletModal.js'), 'utf8');
function shopMethod(name) {
    const match = shopSource.match(new RegExp(`^    ${name}: (?:async )?function \\([^\\n]*\\) \\{[\\s\\S]*?^    \\},`, 'm'));
    assert.ok(match, name);
    return match[0];
}
function purchaseRuntime({ supplier = true, fail = null } = {}) {
    const calls = { toasts: [], successes: [], engagements: [], balances: [], analytics: [], errors: [] };
    const button = { innerHTML: '购买', disabled: false };
    const back = { disabled: false };
    const context = vm.createContext({ console: { error: e => calls.errors.push(e), warn() {} },
        document: { getElementById: () => back },
        window: { requestAnimationFrame: fn => fn(), setTimeout: fn => fn(),
            updateUserPointsUI: value => calls.balances.push(value) },
        trackShopAnalyticsEvent: (...args) => calls.analytics.push(args),
        buildShopTrackingMetadata: data => data });
    const shop = vm.runInContext(`({${shopMethod('confirmPurchase')}})`, context);
    Object.assign(shop, {
        currentPurchase: { productId: 'product', productName: 'Test', productSkuId: 'sku', quantity: 1,
            unitPrice: 10, idempotencyKey: 'original-operation',
            cartOrigin: { productId: 'product', skuId: 'sku', lifecycleToken: 'cart-token' } },
        cartItems: new Map([['entry', 1]]), cartSnapshots: { entry: {} },
        cartLifecycleTokens: { entry: 'cart-token' },
        getCartLifecycleToken(entryKey) { return this.cartLifecycleTokens[entryKey] || null; },
        forgetCartLifecycleToken(entryKey) { delete this.cartLifecycleTokens[entryKey]; },
        isShopCurrentPurchaseManualDelivery: () => false, isShopCurrentPurchaseSoldOut: () => false,
        getCachedProductById: () => ({ id: 'product' }), isShopProductUnavailableForCurrentSite: () => false,
        resolvePurchaseActionButton: () => button, waitForPurchaseDiscountAssetsBeforeSubmit: async () => true,
        getAccessToken: async () => 'synthetic-token', getCurrentPurchasePricingSummary: () => ({ subtotal: 10, discountAmount: 0, finalTotal: 10 }),
        async purchaseWithServer() {
            if (fail) throw fail;
            return { data: { order_id: 'order', total_price: 10, remaining_points: 55,
                ...(supplier ? { fulfillment_source: 'supplier_v2', delivery_status: 'pending', content: null }
                    : { content: 'synthetic-content', delivery_status: 'delivered' }) } };
        },
        buildCartProductSnapshot: () => ({}), buildCartEntryKey: () => 'entry', renderCart() {}, closePurchaseModal() {},
        buildSuccessModalItemPayload: item => item, showShopToast: (...args) => calls.toasts.push(args),
        showSuccessModal: (...args) => calls.successes.push(args), triggerShopOrderEngagement: (...args) => calls.engagements.push(args),
        loadProducts: async () => [], isInventoryStockErrorMessage: () => false,
        createPurchaseIdempotencyKey: () => 'new-operation'
    });
    return { shop, calls, button, back };
}
test('single supplier purchase updates balance/cart and purchase analytics without a secret modal or delivery event', async () => {
    const { shop, calls, button, back } = purchaseRuntime();
    await shop.confirmPurchase();
    assert.equal(calls.errors.length, 0);
    assert.equal(calls.successes.length, 0);
    assert.equal(calls.engagements.length, 0);
    assert.match(calls.toasts[0][0], /订单已受理/);
    assert.deepEqual(calls.balances, [55]);
    assert.equal(shop.cartItems.size, 0);
    assert.equal(shop.purchaseProcessing, false);
    assert.equal(calls.analytics.filter(c => c[0] === 'product_purchase_success').length, 1);
    assert.equal(button.disabled, true); // The successful purchase closes its modal.
    assert.equal(back.disabled, true);
});
test('existing local single purchase still displays content and emits delivery engagement', async () => {
    const { shop, calls } = purchaseRuntime({ supplier: false });
    await shop.confirmPurchase();
    assert.equal(calls.errors.length, 0);
    assert.equal(calls.successes[0][0], 'synthetic-content');
    assert.equal(calls.engagements[0][0], 'order_delivered');
});
test('late single purchase response does not remove a cart line added in a newer lifecycle', async () => {
    const { shop } = purchaseRuntime();
    shop.purchaseWithServer = async () => {
        shop.cartLifecycleTokens.entry = 'new-cart-token';
        return { data: { order_id: 'order', total_price: 10, remaining_points: 55,
            fulfillment_source: 'supplier_v2', delivery_status: 'pending', content: null } };
    };
    await shop.confirmPurchase();
    assert.equal(shop.cartItems.get('entry'), 1);
    assert.equal(shop.cartLifecycleTokens.entry, 'new-cart-token');
});
for (const fail of [Object.assign(new Error('请求中断'), { purchaseOutcomeUnknown: true }),
    Object.assign(new Error('服务暂不可用'), { code: 'supplier_checkout_unavailable' })]) {
    test(`single uncertain purchase retains its operation identity (${fail.code || 'transport'})`, async () => {
        const { shop, button, back } = purchaseRuntime({ fail });
        await shop.confirmPurchase();
        assert.equal(shop.currentPurchase.idempotencyKey, 'original-operation');
        assert.equal(shop.cartItems.size, 1);
        assert.equal(shop.purchaseProcessing, false);
        assert.equal(button.disabled, false);
        assert.equal(back.disabled, false);
    });
}
test('purchase transport and malformed success responses are marked uncertain for same-operation recovery', async () => {
    for (const fetchResult of [() => { throw new Error('synthetic transport failure'); },
        () => ({ ok: true, status: 200, json: async () => { throw new Error('truncated response'); } }),
        () => ({ ok: false, status: 503, json: async () => ({ message: 'temporary failure' }) })]) {
        let prepared = false;
        const shop = vm.runInNewContext(`({${shopMethod('requestPurchasePayloadWithServer')}})`, {
            fetch: (...args) => {
                if (!prepared) { prepared = true; return { ok: true, json: async () => ({ success: true, recoverySource: 'supplier_v2' }) }; }
                return fetchResult(...args);
            }, window: {}, console
        });
        Object.assign(shop, { createPurchaseIdempotencyKey: () => 'test-operation', isEnglishShopLocale: () => false,
            normalizeShopRequestError: err => err, restorePendingPointsPurchase: async () => {},
            getPointsPurchaseJournal: async () => ({ actorId: 'test-actor', site: 'cn',
                journal: { read: () => null, begin() {}, clear() { assert.fail('unknown outcome must remain pending'); } } }) });
        await assert.rejects(shop.requestPurchasePayloadWithServer({ productId: 'product' }, 'synthetic-token'),
            err => err.purchaseOutcomeUnknown === true);
    }
});

for (const [status, text] of [['pending', '待供货'], ['review', '处理中'], ['refunding', '退款中'],
    ['refunded', '已退款'], ['partially_refunded', '部分退款'], ['expired', '已过期'], ['delivered', '已完成']]) {
    test(`wallet list renders native supplier status ${status} instead of assuming delivery`, () => {
        const container = { innerHTML: '' };
        const match = walletSource.match(/^        renderOrders\(orders\) \{[\s\S]*?^        \},/m);
        assert.ok(match);
        const wallet = vm.runInNewContext(`({${match[0]}})`, {
            document: { getElementById: () => container }, window: {}
        });
        Object.assign(wallet, { getShopOrderPaidAmount: () => 10, normalizePointValue: Number,
            normalizeOptionalPointValue: () => null, formatPoints: String, formatWalletAmount: String,
            getLocalizedProductNameFromPayload: () => 'Test', renderWalletInlineIcon: () => '', escapeHtml: String,
            buildDataAttributes: () => ' data-order="test"', encodeActionValue: String, prefetchShopOrderDetails() {} });
        wallet.renderOrders([{ id: 'order', isShopOrder: true, transactionType: 'shop', created_at: '2026-10-19',
            fulfillment_source: 'supplier_v2', supplier_status: status, status: 'completed', delivery_status: 'pending' }]);
        assert.match(container.innerHTML, new RegExp(`order-status[^>]*>${text}</div>`));
    });
}
