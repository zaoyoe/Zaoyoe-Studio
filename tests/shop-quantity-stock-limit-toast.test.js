'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const shopClientSource = fs.readFileSync(path.join(repoRoot, 'js/shop-client.js'), 'utf8');

function createMockShopClient() {
    let lastToast = null;

    const client = {
        isEnglishShopLocale() { return false; },
        showShopToast(message, type) {
            lastToast = { message, type };
        },
        getLastToast() { return lastToast; },
        clearLastToast() { lastToast = null; },

        // Mock purchase state
        currentPurchase: {
            productId: 'test-product',
            productSkuId: 'test-sku',
            quantity: 1,
            product: {
                id: 'test-product',
                skus: [
                    { id: 'test-sku', is_active: true, price_points: 10, stock_count: 1 }
                ]
            }
        },
        allProductsCache: [],

        isGuestCashEntryActive() { return true; },
        getGuestCashQuantityCap() { return 1; },
        getCurrentPurchaseQuantityCap() { return 1; },
        isShopCurrentPurchaseManualDelivery() { return false; },
        isShopCurrentPurchaseSoldOut() { return false; },
        updatePriceForQuantity() {},

        // Load implementations from source
        getProductSkusForPurchase(product = {}) {
            return (Array.isArray(product?.skus) ? product.skus : [])
                .filter((sku) => sku?.is_active !== false)
                .map((sku) => ({ ...sku }))
                .filter((sku) => sku.id && sku.price_points !== null && sku.price_points !== undefined);
        },
        getCachedProductById(id) {
            if (this.currentPurchase?.product?.id === id) return this.currentPurchase.product;
            return this.allProductsCache.find((p) => p.id === id) || null;
        }
    };

    // Extract methods from shopClientSource using Function
    const extractMethod = (methodName) => {
        const regex = new RegExp(`${methodName}:\\s*function\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\s{4}\\},`, 'm');
        const match = regex.exec(shopClientSource);
        assert.ok(match, `Could not extract method ${methodName} from js/shop-client.js`);
        const params = match[1].split(',').map((p) => p.trim()).filter(Boolean);
        const body = match[2];
        return new Function(...params, body);
    };

    client.getKnownPurchaseStockCount = extractMethod('getKnownPurchaseStockCount');
    client.showGuestQuantityLimitToast = extractMethod('showGuestQuantityLimitToast');
    client.showPurchaseQuantityLimitToast = extractMethod('showPurchaseQuantityLimitToast');
    client.adjustQuantity = extractMethod('adjustQuantity');
    client.onQuantityInput = extractMethod('onQuantityInput');

    return client;
}

test('guest quantity limit toasts prioritize insufficient stock warning when target quantity exceeds stock', () => {
    const client = createMockShopClient();

    // Case 1: stock is 1, user clicks + (targetQuantity = 2). Stock is insufficient!
    client.currentPurchase.product.skus[0].stock_count = 1;
    client.adjustQuantity(1);
    assert.deepEqual(client.getLastToast(), {
        message: '库存不足，请联系客服补货',
        type: 'error'
    });

    // Case 2: stock is 5, guest cap is 1, user clicks + (targetQuantity = 2). Stock is sufficient (5 >= 2), but guest cap is 1!
    client.clearLastToast();
    client.currentPurchase.product.skus[0].stock_count = 5;
    client.adjustQuantity(1);
    assert.deepEqual(client.getLastToast(), {
        message: '游客用户最多可购 1 件，登录后可以购买多件。',
        type: 'error'
    });

    // Case 3: keyboard input: user types 10 when stock is 2. Target quantity 10 > stock 2 -> insufficient stock!
    client.clearLastToast();
    client.currentPurchase.product.skus[0].stock_count = 2;
    client.onQuantityInput({ value: '10' });
    assert.deepEqual(client.getLastToast(), {
        message: '库存不足，请联系客服补货',
        type: 'error'
    });

    // Case 4: keyboard input: user types 3 when stock is 10 and guest cap is 1. Target quantity 3 <= stock 10 -> guest limit!
    client.clearLastToast();
    client.currentPurchase.product.skus[0].stock_count = 10;
    client.onQuantityInput({ value: '3' });
    assert.deepEqual(client.getLastToast(), {
        message: '游客用户最多可购 1 件，登录后可以购买多件。',
        type: 'error'
    });
});

test('purchase quantity limit toast also prioritizes insufficient stock for logged-in users', () => {
    const client = createMockShopClient();
    client.isGuestCashEntryActive = () => false;
    client.getCurrentPurchaseQuantityCap = () => 1;

    // Logged in user: stock is 1, tries to buy 2 -> insufficient stock
    client.currentPurchase.product.skus[0].stock_count = 1;
    client.adjustQuantity(1);
    assert.deepEqual(client.getLastToast(), {
        message: '库存不足，请联系客服补货',
        type: 'error'
    });

    // Logged in user: stock is 10, single-order purchase limit is 1 -> purchase limit toast
    client.clearLastToast();
    client.currentPurchase.product.skus[0].stock_count = 10;
    client.adjustQuantity(1);
    assert.deepEqual(client.getLastToast(), {
        message: '该商品单次最高可购 1 件，特殊需求请联系客服。',
        type: 'error'
    });
});
