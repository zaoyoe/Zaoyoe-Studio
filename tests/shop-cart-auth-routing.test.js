const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../js/shop-client.js'), 'utf8');

function cartEntry(id, guestPurchasable = true, overrides = {}) {
    return {
        entryKey: id,
        productId: id,
        productSkuId: `${id}-sku`,
        product: { id },
        guestPurchasable,
        quantity: 2,
        unitPrice: 10,
        totalPoints: 20,
        displayName: id,
        ...overrides
    };
}

function createRuntime({ entries = [cartEntry('one')], signedIn = true, cachedAuth = false, getSession } = {}) {
    const calls = { guest: [], purchases: [], purchaseSheets: [], toasts: [], login: [], successes: [] };
    const activeClasses = new Set();
    const reviewModal = {
        classList: {
            add: (name) => activeClasses.add(name),
            remove: (name) => activeClasses.delete(name),
            contains: (name) => activeClasses.has(name)
        }
    };
    const session = signedIn ? { access_token: 'synthetic-session-token', user: { id: 'synthetic-user' } } : null;
    const client = { auth: { getSession: getSession || (async () => ({ data: { session } })) } };
    const window = {
        SiteConfig: { site: 'cn' },
        GuestShopCheckout: {
            async startGuestBatchCheckout(items) {
                calls.guest.push(items);
                return { started: true };
            }
        }
    };
    const context = vm.createContext({
        window,
        console,
        document: {
            getElementById: (id) => id === 'shopCartCheckoutModal' ? reviewModal : null,
            querySelector: () => null
        }
    });
    const names = [
        'getCartCheckoutPaymentMode', 'resolveShopAuthState', 'openCartCheckoutModal',
        'openPurchaseModalFromCartEntry', 'isGuestCashEntryCandidate', 'confirmCartCheckout'
    ];
    const methods = names.map((name) => {
        const match = source.match(new RegExp(`^    ${name}: (?:async )?function \\([^\\n]*\\) \\{[\\s\\S]*?^    \\},`, 'm'));
        assert.ok(match, `Missing shop method ${name}`);
        return match[0];
    }).join('\n');
    const shop = vm.runInContext(`({${methods}})`, context);
    let intentSequence = 0;
    Object.assign(shop, {
        shopAuthStateKnown: cachedAuth,
        cartOpen: true,
        cartCheckoutProcessing: false,
        cartItems: new Map(entries.map((entry) => [entry.entryKey, entry.quantity])),
        cartSnapshots: {},
        currentPurchase: {},
        currentAgentId: null,
        getShopSupabaseClient: () => client,
        getCartEntries: () => entries,
        getCartCopy: () => ({
            cartEmptyToast: 'empty', mixedCheckoutToast: 'mixed',
            authUnavailableToast: 'auth-unavailable', guestCashDiscountUnsupportedToast: 'guest-discount',
            guestCashCheckoutUnavailableToast: 'guest-unavailable', cartCheckoutLabel: 'Cart'
        }),
        getGuestCashBatchDiscountEntry: (items) => items.find((entry) => entry.appliedDiscount) || null,
        showShopToast: (...args) => calls.toasts.push(args),
        closeCart() { this.cartOpen = false; },
        setCartOpen(value) { this.cartOpen = value; },
        renderCart() {},
        renderCartCheckoutModal() {},
        closeCartCheckoutModal() { activeClasses.delete('active'); this.cartCheckoutProcessing = false; },
        getGuestCartCheckoutStartFailureMessage: () => 'guest-start-failed',
        isShopProductManualDelivery: () => false,
        isShopProductUnavailableForCurrentSite: () => false,
        getPurchaseQuantityCapForProduct: () => 10,
        prefetchDiscountAssetsForProduct: async () => [],
        getShopProductSiteNamePair: (product) => ({ name: product.id, nameEn: product.id }),
        resolveQuantityPricingRulesForProductSelection: () => [],
        openPurchaseModal(...args) {
            calls.purchaseSheets.push(args);
            this.currentPurchase = { guestCashEligible: true, forceGuestCash: args[8].forceGuestCash };
        },
        refreshCurrentPurchaseGuidance() {},
        syncPurchaseAccessAfterOpen() {},
        sanitizeCartState() {},
        isShopProductSelectionSoldOut: () => false,
        getAccessToken: async () => {
            const { data } = await client.auth.getSession();
            return data.session?.access_token || '';
        },
        promptLoginForPurchase: (message) => calls.login.push(message),
        createPurchaseIdempotencyKey: () => `synthetic-intent-${++intentSequence}`,
        async requestPurchasePayloadWithServer(payload, token) {
            calls.purchases.push({ payload, token });
            return { order_id: `synthetic-order-${payload.productId}` };
        },
        buildCartSuccessPayload: (successes) => ({
            content: 'synthetic-delivery',
            items: successes.map(({ entry }) => ({ productId: entry.productId, createdAt: '2026-10-18T00:00:00Z' })),
            orderIds: successes.map(({ entry }) => `synthetic-order-${entry.productId}`),
            remainingPoints: 100
        }),
        loadProducts: async () => [],
        clearCartAbandonEngagementTimer() {},
        showSuccessModal: (...args) => calls.successes.push(args),
        triggerShopOrderEngagement() {}
    });
    context.resolveShopSourceContext = () => ({ sourcePage: 'shop' });
    return { shop, calls, activeClasses };
}

test('signed-in carts use points for guest-capable products and mixed product eligibility', () => {
    const { shop } = createRuntime({ cachedAuth: true });
    assert.equal(shop.getCartCheckoutPaymentMode([cartEntry('guest')]), 'wallet');
    assert.equal(shop.getCartCheckoutPaymentMode([cartEntry('guest'), cartEntry('member', false)]), 'wallet');
    assert.equal(shop.getCartCheckoutPaymentMode([cartEntry('member', false)]), 'wallet');
    assert.equal(shop.getCartCheckoutPaymentMode([]), 'empty');
});

test('single-item checkout resolves the session and opens points redemption without a forced cash flag', async () => {
    const { shop, calls } = createRuntime({ signedIn: true, cachedAuth: false });
    await shop.openCartCheckoutModal();
    assert.equal(shop.shopAuthStateKnown, true);
    assert.equal(calls.guest.length, 0);
    assert.equal(calls.purchaseSheets.length, 1);
    const options = calls.purchaseSheets[0][8];
    assert.equal(options.forceGuestCash, false);
    assert.equal(options.productSkuId, 'one-sku');
    assert.equal(options.initialQuantity, 2);
    assert.equal(shop.isGuestCashEntryCandidate(), false);
});

test('signed-in mixed cart opens the points review instead of rejecting mixed eligibility', async () => {
    const { shop, calls, activeClasses } = createRuntime({ entries: [cartEntry('guest'), cartEntry('member', false)] });
    await shop.openCartCheckoutModal();
    assert.equal(activeClasses.has('active'), true);
    assert.equal(calls.guest.length, 0);
    assert.deepEqual(calls.toasts, []);
});

test('points submit rechecks auth and sends each SKU, quantity and attached coupon to the member purchase path', async () => {
    const discount = { code: 'MEMBER', assetId: 'asset', selections: [{ code: 'STACK', assetId: 'stack-asset', scopeProductSkuId: 'one-sku' }] };
    const entries = [cartEntry('one', true, { appliedDiscount: discount }), cartEntry('two', false)];
    const { shop, calls } = createRuntime({ entries, signedIn: true, cachedAuth: false });
    await shop.confirmCartCheckout();
    assert.equal(calls.guest.length, 0);
    assert.equal(calls.purchases.length, 2);
    assert.deepEqual(calls.purchases.map(({ payload }) => payload.productId), ['one', 'two']);
    const first = calls.purchases[0];
    assert.equal(first.token, 'synthetic-session-token');
    assert.equal(first.payload.quantity, 2);
    assert.equal(first.payload.productSkuId, 'one-sku');
    assert.equal(first.payload.discountCode, 'MEMBER');
    assert.equal(first.payload.discountAssetId, 'asset');
    assert.equal(first.payload.discountSelections[0].assetId, 'stack-asset');
    assert.equal(calls.successes.length, 1);
    assert.equal(shop.cartItems.size, 0);
});

for (const action of ['openCartCheckoutModal', 'confirmCartCheckout']) {
    test(`${action} keeps signed-out all-guest carts on cash checkout even after stale signed-in state`, async () => {
        const { shop, calls } = createRuntime({ entries: [cartEntry('one'), cartEntry('two')], signedIn: false, cachedAuth: true });
        await shop[action]();
        assert.equal(shop.shopAuthStateKnown, false);
        assert.equal(calls.guest.length, 1);
        assert.equal(calls.purchases.length, 0);
        assert.equal(calls.purchaseSheets.length, 0);
    });

    test(`${action} retains the guest mixed-cart guard`, async () => {
        const { shop, calls } = createRuntime({ entries: [cartEntry('one'), cartEntry('two', false)], signedIn: false });
        await shop[action]();
        assert.equal(calls.guest.length, 0);
        assert.equal(calls.purchases.length, 0);
        assert.deepEqual(calls.toasts, [['mixed', 'error']]);
    });

    test(`${action} does not choose a payment branch when session lookup fails`, async () => {
        const { shop, calls, activeClasses } = createRuntime({ getSession: async () => { throw new Error('session lookup unavailable'); } });
        await shop[action]();
        assert.equal(calls.guest.length, 0);
        assert.equal(calls.purchases.length, 0);
        assert.equal(calls.purchaseSheets.length, 0);
        assert.equal(activeClasses.has('active'), false);
        assert.deepEqual(calls.toasts, [['auth-unavailable', 'error']]);
    });

    test(`${action} treats an auth error response as unknown instead of choosing cash`, async () => {
        const { shop, calls, activeClasses } = createRuntime({
            cachedAuth: true,
            getSession: async () => ({ data: { session: null }, error: new Error('session unavailable') })
        });
        await shop[action]();
        assert.equal(shop.shopAuthStateKnown, null);
        assert.equal(calls.guest.length, 0);
        assert.equal(calls.purchases.length, 0);
        assert.equal(calls.purchaseSheets.length, 0);
        assert.equal(activeClasses.has('active'), false);
        assert.deepEqual(calls.toasts, [['auth-unavailable', 'error']]);
    });
}

test('an expired member session on a wallet-only cart prompts login without a cash fallback', async () => {
    const { shop, calls } = createRuntime({ entries: [cartEntry('member', false)], signedIn: false, cachedAuth: true });
    await shop.confirmCartCheckout();
    assert.equal(calls.login.length, 1);
    assert.equal(calls.guest.length, 0);
    assert.equal(calls.purchases.length, 0);
});


test('token lookup failure after points selection unlocks checkout without submitting an order', async () => {
    const { shop, calls } = createRuntime();
    shop.getAccessToken = async () => { throw new Error('token refresh unavailable'); };
    await shop.confirmCartCheckout();
    assert.equal(shop.cartCheckoutProcessing, false);
    assert.equal(calls.guest.length, 0);
    assert.equal(calls.purchases.length, 0);
    assert.deepEqual(calls.toasts, [['auth-unavailable', 'error']]);
    assert.equal(shop.cartItems.size, 1);
});

test('a session expiring before points submission prompts login and preserves cart contents', async () => {
    const { shop, calls } = createRuntime();
    shop.getAccessToken = async () => '';
    await shop.confirmCartCheckout();
    assert.equal(shop.cartCheckoutProcessing, false);
    assert.equal(calls.login.length, 1);
    assert.equal(calls.guest.length, 0);
    assert.equal(calls.purchases.length, 0);
    assert.equal(shop.cartItems.size, 1);
});

test('concurrent points confirmations submit the cart once after session lookup', async () => {
    const { shop, calls } = createRuntime({ entries: [cartEntry('one'), cartEntry('two', false)] });
    await Promise.all([shop.confirmCartCheckout(), shop.confirmCartCheckout()]);
    assert.deepEqual(calls.purchases.map(({ payload }) => payload.productId), ['one', 'two']);
    assert.equal(calls.guest.length, 0);
    assert.equal(calls.successes.length, 1);
});


test('closing the cart during session lookup cancels the pending checkout opening', async () => {
    let resolveSession;
    const pendingSession = new Promise((resolve) => { resolveSession = resolve; });
    const { shop, calls, activeClasses } = createRuntime({ getSession: () => pendingSession });
    const opening = shop.openCartCheckoutModal();
    shop.closeCart();
    resolveSession({ data: { session: { access_token: 'synthetic-session-token' } } });
    await opening;
    assert.equal(calls.purchaseSheets.length, 0);
    assert.equal(calls.guest.length, 0);
    assert.equal(activeClasses.has('active'), false);
});

test('closing points review during session lookup prevents a delayed redemption', async () => {
    let resolveSession;
    const pendingSession = new Promise((resolve) => { resolveSession = resolve; });
    const { shop, calls, activeClasses } = createRuntime({ getSession: () => pendingSession });
    activeClasses.add('active');
    const confirming = shop.confirmCartCheckout();
    shop.closeCartCheckoutModal();
    resolveSession({ data: { session: { access_token: 'synthetic-session-token' } } });
    await confirming;
    assert.equal(calls.purchases.length, 0);
    assert.equal(calls.guest.length, 0);
    assert.equal(shop.cartItems.size, 1);
});

test('repeated guest checkout clicks during session lookup start the cash review once', async () => {
    const { shop, calls } = createRuntime({ signedIn: false });
    await Promise.all([shop.openCartCheckoutModal(), shop.openCartCheckoutModal()]);
    assert.equal(calls.guest.length, 1);
    assert.equal(calls.purchases.length, 0);
});
