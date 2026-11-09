const test = require('node:test');
const assert = require('node:assert/strict');

const { createXiarengAdapter } = require('../server/integrations/suppliers/xiareng/client');
const { shouldAutoDispatch, tryAutoDispatchSupplierOrder } = require('../server/integrations/suppliers/auto-dispatch');
const mutateHandler = require('../server/api-handlers/admin/shop/mutate');
const { validateProductPayload } = mutateHandler;
const { normalizeGuestQuantity, resolveGuestQuantityCap } = require('../api/_lib/guest-shop/promo');

function fixture(overrides = {}) {
    return {
        code: 'XR-1',
        name: '演示商品',
        user_price: '12.340000',
        price: '99.99',
        stock: '15',
        delivery_way: 0,
        minimum: 0,
        config: {},
        widget: [],
        ...overrides
    };
}

function setupAdapter(payloads, options = {}) {
    const calls = [];
    const adapter = createXiarengAdapter({
        appId: 'merchant',
        appKey: 'key-do-not-output',
        ...options,
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

const BASE_PURCHASE = {
    requestId: '2db86646-3d58-4549-a25b-9ca910aed939',
    goodsNo: 'XR-1',
    quantity: 1,
    variant: {},
    maxCost: { currency: 'CNY', amount: '10.00' }
};

test('XiarengAdapter: minimum quantity gate blocks under-quantity orders before upstream trade request', async () => {
    const { adapter, calls } = setupAdapter([fixture({ minimum: 5 })]);

    const result = await adapter.createPurchase({
        ...BASE_PURCHASE,
        quantity: 1
    });

    assert.equal(result.outcome, 'rejected');
    assert.equal(result.definitivelyNotAccepted, true);
    assert.equal(result.code, 'supplier_minimum_quantity_not_met');
    assert.match(result.reason, /最少需购买 5 件/);
    assert.equal(calls.some(c => /\/trade$/.test(c.url)), false, 'Upstream trade API should never be called when quantity < minimum');
});

test('XiarengAdapter: passes requestedQuantity to upstream when meeting minimum', async () => {
    const payloads = [
        fixture({ minimum: 5 }),
        fixture({ minimum: 5 }),
        { price: '0.16' },
        fixture({ minimum: 5 }),
        { stock: '100' },
        [],
        { tradeNo: '778217796203351836', amount: '0.80', secret: 'CARD-SECRET', stock: '100' }
    ];
    const { adapter, calls } = setupAdapter(payloads);

    const result = await adapter.createPurchase({
        ...BASE_PURCHASE,
        quantity: 5
    });

    assert.equal(result.outcome, 'accepted');
    assert.equal(result.orderNo, '778217796203351836');
    const tradeCall = calls.find(c => /\/trade$/.test(c.url));
    assert.ok(tradeCall);
    const sent = new URLSearchParams(tradeCall.body);
    assert.equal(sent.get('num'), '5');
});

test('XiarengAdapter: special product types safety gates (maximumQuantity, draftStatus, widget)', async () => {
    // 1. Exceeds maximum
    {
        const { adapter, calls } = setupAdapter([fixture({ maximum: 10 })]);
        const result = await adapter.createPurchase({
            ...BASE_PURCHASE,
            quantity: 12
        });
        assert.equal(result.outcome, 'rejected');
        assert.equal(result.code, 'supplier_maximum_quantity_exceeded');
        assert.equal(calls.some(c => /\/trade$/.test(c.url)), false);
    }

    // 2. Draft/Pick card mode (draft_status = 1)
    {
        const { adapter, calls } = setupAdapter([fixture({ draft_status: 1 })]);
        const result = await adapter.createPurchase(BASE_PURCHASE);
        assert.equal(result.outcome, 'rejected');
        assert.equal(result.code, 'supplier_draft_cards_not_supported');
        assert.equal(calls.some(c => /\/trade$/.test(c.url)), false);
    }

    // 3. Custom widget / parameters required (widget non-empty)
    {
        const { adapter, calls } = setupAdapter([fixture({ widget: [{ field: 'account', name: '账号' }] })]);
        const result = await adapter.createPurchase(BASE_PURCHASE);
        assert.equal(result.outcome, 'rejected');
        assert.equal(result.code, 'supplier_widget_params_required');
        assert.equal(calls.some(c => /\/trade$/.test(c.url)), false);
    }
});

test('auto-dispatch: shouldAutoDispatch obeys threshold and manual_all policy', () => {
    const policy = { enabled: true, mode: 'threshold', thresholdCny: 10.00 };

    assert.equal(shouldAutoDispatch(policy, 0.17), true);
    assert.equal(shouldAutoDispatch(policy, 10.00), true);
    assert.equal(shouldAutoDispatch(policy, 10.01), false);

    assert.equal(shouldAutoDispatch({ enabled: true, mode: 'manual_all', thresholdCny: 100 }, 0.17), false);
    assert.equal(shouldAutoDispatch({ enabled: false, mode: 'threshold', thresholdCny: 10 }, 0.17), false);
});

test('auto-dispatch: tryAutoDispatchSupplierOrder skips when quantity < minimumQuantity in snapshot', async () => {
    const mockDb = {
        from(table) {
            if (table === 'system_config') {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: { config_value: { mode: 'threshold', thresholdCny: 10.00, enabled: true } },
                                error: null
                            })
                        })
                    })
                };
            }
            if (table === 'shop_supplier_fulfillment_units') {
                return {
                    select: () => ({
                        or: () => ({
                            limit: () => ({
                                maybeSingle: async () => ({
                                    data: {
                                        id: 'unit-1',
                                        order_id: 'ord-1',
                                        mapping_id: 'map-1',
                                        quantity: 1
                                    },
                                    error: null
                                })
                            })
                        })
                    })
                };
            }
            if (table === 'shop_supplier_product_mappings') {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: {
                                    id: 'map-1',
                                    import_snapshot: {
                                        minimumQuantity: 5
                                    }
                                },
                                error: null
                            })
                        })
                    })
                };
            }
            throw new Error(`Unexpected table ${table}`);
        }
    };

    const order = {
        id: 'ord-1',
        fulfillment_source: 'supplier_v2',
        payment_status: 'confirmed',
        fulfillment_status: 'pending',
        total_amount: 0.17,
        quantity: 1
    };

    const result = await tryAutoDispatchSupplierOrder({ supabase: mockDb, order });
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'route_a_manual_review_required');
    assert.match(result.detail, /未达到上游起售数量/);
});

test('auto-dispatch: manual delivery order is skipped to Route A', async () => {
    const mockDb = {
        from(table) {
            if (table === 'system_config') {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: { config_value: { mode: 'threshold', thresholdCny: 10.00, enabled: true } },
                                error: null
                            })
                        })
                    })
                };
            }
            throw new Error(`Unexpected table ${table}`);
        }
    };

    const order = {
        id: 'ord-manual',
        fulfillment_source: 'supplier_v2',
        payment_status: 'confirmed',
        fulfillment_status: 'pending',
        total_amount: 0.17,
        manual_delivery: true,
        quantity: 1
    };

    const result = await tryAutoDispatchSupplierOrder({ supabase: mockDb, order });
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'route_a_manual_review_required');
    assert.match(result.detail, /人工发货/);
});

test('admin mutate: validateProductPayload validates min_purchase_quantity and conflicts', async () => {
    const mockDb = {
        from() {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: { name: 'account' }, error: null })
                    })
                })
            };
        }
    };

    // Valid: min <= max
    const validResult = await validateProductPayload(mockDb, {
        payload: {
            name: '测试商品',
            category: 'account',
            price: 10,
            min_purchase_quantity: 5,
            max_purchase_quantity: 10
        }
    });
    assert.equal(validResult.blockingIssues.length, 0);

    // Invalid: min > max
    const invalidResult = await validateProductPayload(mockDb, {
        payload: {
            name: '测试商品',
            category: 'account',
            price: 10,
            min_purchase_quantity: 10,
            max_purchase_quantity: 5
        }
    });
    assert.equal(invalidResult.blockingIssues.some(i => i.code === 'purchase_limit_conflict'), true);
    const conflictIssue = invalidResult.blockingIssues.find(i => i.code === 'purchase_limit_conflict');
    assert.match(conflictIssue.message, /起售数量不能大于单次限购数量/);

    // Invalid: negative or 0
    const nonPosResult = await validateProductPayload(mockDb, {
        payload: {
            name: '测试商品',
            category: 'account',
            price: 10,
            min_purchase_quantity: 0
        }
    });
    assert.equal(nonPosResult.blockingIssues.some(i => i.code === 'min_purchase_quantity_invalid'), true);
});

test('promo: normalizeGuestQuantity respects min purchase quantity', () => {
    assert.equal(normalizeGuestQuantity(1, { min: 5, max: 20 }), null);
    assert.equal(normalizeGuestQuantity(5, { min: 5, max: 20 }), 5);
    assert.equal(normalizeGuestQuantity(6, { min: 5, max: 20 }), 6);
    assert.equal(normalizeGuestQuantity(25, { min: 5, max: 20 }), null);
});

test('promo: resolveGuestQuantityCap respects minPurchaseQuantity', () => {
    const cap = resolveGuestQuantityCap({
        skuMaxQuantity: 10,
        minPurchaseQuantity: 5
    });
    assert.equal(cap >= 5, true);
});

test('shop-client: getProductMinPurchaseQuantity inherits product min_purchase_quantity when SKU is default 1', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../js/shop-client.js'), 'utf8');

    // Verify getProductMinPurchaseQuantity logic doesn't use ?? blindly to overwrite product min with sku default 1
    assert.match(source, /const validSkuMin = Number\.isSafeInteger\(skuMinParsed\) && skuMinParsed > 1 \? skuMinParsed : null;/);
    assert.match(source, /const validProdMin = Number\.isSafeInteger\(prodMinParsed\) && prodMinParsed > 1 \? prodMinParsed : 1;/);
    assert.match(source, /return validSkuMin \?\? validProdMin;/);

    // Verify buyProduct initializes initialQuantity with minPurchaseQuantity
    assert.match(source, /const minPurchaseQuantity = this\.getProductMinPurchaseQuantity\(liveProduct, \{ skuId: requestedSkuId \}\);/);
    assert.match(source, /Math\.max\(\s*minPurchaseQuantity,\s*Math\.min\(quantityCap/);

    // Verify decreaseBtn remains clickable to trigger toast, but toggles is-disabled when quantity <= minQuantity
    assert.match(source, /const atMin = isDecrease && currentQty <= minQuantity;/);
    assert.match(source, /button\.disabled = locked;/);
    assert.match(source, /button\.classList\.toggle\('is-disabled', atMin\);/);

    // Verify showPurchaseMinQuantityToast shows warning toast with minimum quantity
    assert.match(source, /showPurchaseMinQuantityToast:\s*function\s*\(minQuantity\)/);
    assert.match(source, /该商品最少需购买 \$\{min\} 件/);
    assert.match(source, /this\.showShopToast\(message,\s*'warning'\)/);
});

test('public shop API includes min_purchase_quantity in catalog select attempts', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../server/api-handlers/public/shop.js'), 'utf8');

    assert.match(source, /'min_purchase_quantity',\s*'updated_at',\s*'created_at'/);
    assert.match(source, /'min_purchase_quantity',\s*'max_purchase_quantity'/);
});

test('toast capsule animation: floats up and shakes horizontally without bounce', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../css/shop-page.css'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../js/shop-client.js'), 'utf8');

    // CSS defines entrance slide up + horizontal shake
    assert.match(css, /@keyframes shopToastSlideUpShake\s*\{/);
    assert.match(css, /transform:\s*translate3d\(calc\(-50%\s*-\s*6px\),\s*0,\s*0\);/);
    assert.match(css, /transform:\s*translate3d\(calc\(-50%\s*\+\s*5px\),\s*0,\s*0\);/);

    // CSS defines in-place shake for consecutive triggers
    assert.match(css, /@keyframes shopToastShake\s*\{/);
    assert.match(css, /\.shop-success-toast\.shop-toast-shake\s*\{/);

    // No bounce animation
    assert.doesNotMatch(css, /@keyframes shopToastBounce/);
    assert.doesNotMatch(js, /shop-toast-bounce/);

    // CSS defines exit float-out animation
    assert.match(css, /@keyframes shopToastFloatOut\s*\{/);
    assert.match(css, /\.shop-success-toast\[data-shop-toast-global="1"\]\.is-visible\.is-hiding\s*\{/);

    // JS handles hideShopToast with is-hiding exit transition
    assert.match(js, /hideShopToast:\s*function\s*\(\)\s*\{/);
    assert.match(js, /toast\.classList\.add\('is-hiding'\);/);
});
