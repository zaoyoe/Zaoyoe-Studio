'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const script = fs.readFileSync(require.resolve('../js/tg.js'), 'utf8');
const ORDER = 'TG-ABCDEFGHIJKLMNOP';
const CODE = 'TG-PREM-12345678-12345678-12345678-12345678';
const STARS_CODE = 'TG-STAR-12345678-12345678-12345678-12345678';
function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
function storage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
function page({ fetch, savedStorage = storage(), crypto = webcrypto } = {}) {
    const elements = new Map();
    const documentEvents = new Map();
    const timers = new Map();
    let timerId = 0;
    function element() {
        return { value: '', textContent: '', hidden: false, disabled: false, className: '', children: [], listeners: new Map(),
            attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); },
            addEventListener(name, fn) { this.listeners.set(name, fn); },
            replaceChildren(...nodes) { this.children = nodes; this.textContent = nodes.map((node) => node.textContent).join(''); },
            async trigger(name) { await this.listeners.get(name)?.({ preventDefault() {}, currentTarget: this }); }
        };
    }
    const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        createElement: element, addEventListener: (name, fn) => documentEvents.set(name, fn) };
    const calls = [];
    document.getElementById('tgPurchaseProduct').value = 'premium_3';
    document.getElementById('tgPurchaseStars').value = '100';
    document.getElementById('tgPurchaseChannel').value = 'alipay';
    document.getElementById('tgPurchaseCheckout').hidden = true;
    const window = { document, crypto, TextEncoder, AbortController, URL, sessionStorage: savedStorage, navigator: { clipboard: { writeText: async () => {} } },
        fetch: async (url, options) => { calls.push({ url, options }); return fetch(url, options); },
        setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
        clearTimeout: (id) => timers.delete(id), addEventListener() {} };
    vm.runInNewContext(script, { window, Uint8Array, Date });
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    return { window, document, documentEvents, elements, calls, timers, storage: savedStorage, flush,
        get: (id) => document.getElementById(id),
        async submit(code = CODE) { document.getElementById('tgUsername').value = 'recipient_test'; document.getElementById('tgCode').value = code; await document.getElementById('tgRedeemForm').trigger('submit'); },
        posts: () => calls.filter((call) => call.url === '/api/tg/redeem') };
}
const enabledCatalog = () => response({ success: true, redemption_enabled: true });

test('lost responses, repeat clicks and reload reuse the persisted credentials without storing the plaintext code', async () => {
    const savedStorage = storage();
    const fetch = async (url) => { if (url.endsWith('/catalog')) return enabledCatalog(); throw new Error('network_failure'); };
    const ui = page({ fetch, savedStorage });
    await ui.flush();
    await Promise.all([ui.submit(), ui.submit()]);
    assert.equal(ui.posts().length, 1);
    const first = JSON.parse(ui.posts()[0].options.body);
    await ui.submit();
    assert.equal(ui.posts().length, 2);
    const second = JSON.parse(ui.posts()[1].options.body);
    assert.equal(first.idempotency_key, second.idempotency_key);
    assert.equal(first.status_token, second.status_token);
    assert.match(first.status_token, /^[a-f0-9]{64}$/);
    const stored = [...savedStorage.values.values()].join('');
    assert.ok(!stored.includes(CODE));
    assert.ok(stored.includes(first.idempotency_key));
    const reloaded = page({ fetch, savedStorage });
    await reloaded.flush();
    await reloaded.submit();
    const third = JSON.parse(reloaded.posts()[0].options.body);
    assert.equal(first.idempotency_key, third.idempotency_key);
    assert.equal(first.status_token, third.status_token);
});

test('a replay without a new status token remains queryable, with credentials only in a request header', async () => {
    let postCount = 0;
    const ui = page({ fetch: async (url) => {
        if (url.endsWith('/catalog')) return enabledCatalog();
        if (url.endsWith('/redeem')) {
            if (++postCount === 1) throw new Error('lost_response');
            return response({ success: true, existing: true, order_no: ORDER, status: 'pending' });
        }
        return response({ success: true, order_no: ORDER, username: 'recipient_test', term_months: 3, status: 'manual_review' });
    } });
    await ui.flush();
    await ui.submit();
    await ui.submit();
    const token = JSON.parse(ui.posts()[0].options.body).status_token;
    const query = ui.calls.find((call) => call.url.includes('/status?'));
    assert.ok(!query.url.includes(token));
    assert.ok(!query.url.includes('status_token'));
    assert.equal(query.options.headers['X-TG-Status-Token'], token);
    assert.equal(ui.get('tgCode').value, '');
    assert.equal(ui.get('tgStatusToken').value, token);
    assert.match(ui.get('tgStatusResult').textContent, /人工复核/);
    assert.equal(ui.timers.size, 0, 'manual review must not keep polling');
    assert.ok([...ui.storage.values.values()][0].includes(ORDER));
});

test('disabled catalog blocks redemption while manual status queries still work', async () => {
    const ui = page({ fetch: async (url) => url.endsWith('/catalog')
        ? response({ success: true, redemption_enabled: false })
        : response({ success: true, order_no: ORDER, username: 'recipient_test', term_months: 6, status: 'succeeded' }) });
    await ui.flush();
    await ui.submit();
    assert.equal(ui.posts().length, 0);
    assert.equal(ui.get('tgRedeemButton').disabled, true);
    ui.get('tgOrderNo').value = ORDER;
    ui.get('tgStatusToken').value = 'a'.repeat(64);
    await ui.get('tgStatusForm').trigger('submit');
    assert.match(ui.get('tgStatusResult').textContent, /开通完成/);
});

test('API-supplied text remains literal DOM text', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? enabledCatalog()
        : response({ success: true, order_no: ORDER, username: payload, term_months: 12, status: 'succeeded' }) });
    await ui.flush();
    ui.get('tgOrderNo').value = ORDER;
    ui.get('tgStatusToken').value = 'a'.repeat(64);
    await ui.get('tgStatusForm').trigger('submit');
    assert.ok(ui.get('tgStatusResult').children[1].textContent.includes(payload));
    assert.ok(!script.includes('.innerHTML'));
});

test('unavailable secure storage or cryptography fails before the request is submitted', async () => {
    for (const options of [{ crypto: {} }, { savedStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } }]) {
        const ui = page({ ...options, fetch: async () => enabledCatalog() });
        await ui.flush();
        await ui.submit();
        assert.equal(ui.posts().length, 0);
        assert.match(ui.get('tgFormMessage').textContent, /尚未提交/);
    }
});

test('pending order polling pauses while hidden and never resubmits redemption', async () => {
    const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? enabledCatalog()
        : response({ success: true, order_no: ORDER, username: 'recipient_test', term_months: 3, status: 'pending' }) });
    await ui.flush();
    ui.get('tgOrderNo').value = ORDER;
    ui.get('tgStatusToken').value = 'a'.repeat(64);
    await ui.get('tgStatusForm').trigger('submit');
    assert.equal(ui.timers.size, 1);
    ui.document.hidden = true;
    ui.documentEvents.get('visibilitychange')();
    assert.equal(ui.timers.size, 0);
    ui.document.hidden = false;
    ui.documentEvents.get('visibilitychange')();
    assert.equal(ui.timers.size, 1);
    const next = [...ui.timers.values()][0];
    next.fn();
    await ui.flush();
    assert.equal(ui.calls.filter((call) => call.url.includes('/status?')).length, 2);
    assert.equal(ui.posts().length, 0);
});

test('Stars redemption is determined by the code and renders the verified Stars entitlement', async () => {
    const ui = page({ fetch: async (url) => {
        if (url.endsWith('/catalog')) return enabledCatalog();
        if (url.endsWith('/redeem')) return response({ success: true, order_no: ORDER, status: 'pending' });
        return response({ success: true, order_no: ORDER, username: 'recipient_test', product_family: 'telegram_stars', term_months: null, stars_quantity: 1500, status: 'succeeded' });
    } });
    await ui.flush();
    await ui.get('tgModeRedeem').trigger('click');
    await ui.get('tgStarsPreview').trigger('click');
    assert.equal(ui.get('tgStarsPreview').attributes.get('aria-pressed'), 'true');
    assert.match(ui.get('tgProductDescription').textContent, /到账数量以兑换码/);
    await ui.submit(STARS_CODE);
    const input = JSON.parse(ui.posts()[0].options.body);
    assert.equal(input.code, STARS_CODE);
    assert.ok(!Object.hasOwn(input, 'stars_quantity'));
    assert.ok(!Object.hasOwn(input, 'product_family'));
    assert.match(ui.get('tgStatusResult').textContent, /星星已到账/);
    assert.match(ui.get('tgStatusResult').textContent, /Stars 1,500 颗/);
    assert.doesNotMatch(ui.get('tgStatusResult').textContent, /Premium/);
});

test('unknown or contradictory product entitlements are not shown as Premium or polled', async () => {
    for (const product of [
        { product_family: 'unknown', term_months: 3 },
        { product_family: null, term_months: 3 },
        { product_family: 'telegram_stars', stars_quantity: 49, term_months: null },
        { product_family: 'telegram_stars', stars_quantity: 1500, term_months: 3 },
        { product_family: 'telegram_premium', stars_quantity: 1500, term_months: 3 },
        { stars_quantity: 1500, term_months: null }
    ]) {
        const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? enabledCatalog()
            : response({ success: true, order_no: ORDER, username: 'recipient_test', status: 'pending', ...product }) });
        await ui.flush();
        ui.get('tgOrderNo').value = ORDER; ui.get('tgStatusToken').value = 'a'.repeat(64);
        await ui.get('tgStatusForm').trigger('submit');
        assert.match(ui.get('tgStatusResult').textContent, /订单权益尚未确认/);
        assert.equal(ui.timers.size, 0);
    }
});

const PURCHASE_ORDER = 'TGP-12345678901234567890';
const QUOTE_ID = 'e24c9d34-b5cd-4d0f-b92b-4d2a0738e05e';
const PREMIUM_SALE = { id: 'premium_3', product_family: 'telegram_premium', term_months: 3, price_minor: 12999, price_version: 2, enabled: true };
const STARS_SALE = { id: 'stars', product_family: 'telegram_stars', term_months: null, unit_price_micros: 12345, price_version: 3, enabled: true };
const purchaseCatalog = (changes = {}) => response({ success: true, redemption_enabled: true, purchase_enabled: true, currency: 'CNY', payment_channels: [{ id: 'alipay' }, { id: 'wxpay' }], sale_products: [PREMIUM_SALE, STARS_SALE], ...changes });
const purchaseQuote = (changes = {}) => ({ quote_id: QUOTE_ID, product_id: 'stars', product_family: 'telegram_stars', stars_quantity: 100, term_months: null, currency: 'CNY', total_minor: 124, price_version: 3, ...changes });
const purchaseOrder = (changes = {}) => ({ order_no: PURCHASE_ORDER, product_family: 'telegram_stars', stars_quantity: 100, term_months: null, username: 'recipient_test', currency: 'CNY', total_minor: 124, price_version: 3, payment_channel: 'alipay', payment_status: 'pending', fulfillment_status: 'not_started', checkout_url: 'https://pay.example.test/checkout', ...changes });
async function startStarsPurchase(ui, quantity = '100') {
    await ui.get('tgStarsPreview').trigger('click');
    ui.get('tgPurchaseStars').value = quantity;
    ui.get('tgPurchaseUsername').value = '@recipient_test';
    await ui.get('tgPurchaseForm').trigger('submit');
}

test('purchase quotes are confirmed separately and use server amounts with a bound quote ID', async () => {
    const ui = page({ fetch: async (url) => {
        if (url.endsWith('/catalog')) return purchaseCatalog();
        if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote() });
        if (url.endsWith('/orders')) return response({ success: true, order: purchaseOrder() });
        return response({ success: true, order: purchaseOrder() });
    } });
    await ui.flush(); await startStarsPurchase(ui);
    assert.equal(ui.get('tgPurchaseConfirmation').hidden, false);
    assert.equal(ui.get('tgPurchaseForm').hidden, true);
    assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /Stars 100 颗 · ¥1\.24/);
    assert.equal(ui.calls.filter((call) => call.url.endsWith('/orders')).length, 0);
    const quoteRequest = JSON.parse(ui.calls.find((call) => call.url.endsWith('/quote')).options.body);
    assert.deepEqual(quoteRequest, { product_id: 'stars', username: 'recipient_test', stars_quantity: 100 });
    await ui.get('tgPurchaseConfirm').trigger('click');
    const create = ui.calls.find((call) => call.url.endsWith('/orders'));
    const input = JSON.parse(create.options.body);
    assert.equal(input.quote_id, QUOTE_ID); assert.equal(input.expected_total_minor, 124); assert.equal(input.price_version, 3);
    assert.match(input.status_token, /^[a-f0-9]{64}$/); assert.equal(create.options.headers['Idempotency-Key'], input.idempotency_key);
    assert.equal(ui.get('tgPurchaseCheckout').href, 'https://pay.example.test/checkout');
    assert.equal(ui.get('tgPurchaseCheckout').hidden, false);
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /等待付款/);
    const statusCall = ui.calls.find((call) => call.url.includes('/purchase/status?'));
    assert.equal(statusCall.options.headers['X-TG-Status-Token'], input.status_token);
    assert.ok(!statusCall.url.includes(input.status_token));
});

test('changing purchase selections cancels an in-flight quote and its confirmation', async () => {
    for (const change of [
        async (ui) => { ui.get('tgPurchaseUsername').value = 'another_recipient'; await ui.get('tgPurchaseUsername').trigger('input'); },
        async (ui) => { ui.get('tgPurchaseStars').value = '200'; await ui.get('tgPurchaseStars').trigger('input'); },
        async (ui) => { ui.get('tgPurchaseChannel').value = 'wxpay'; await ui.get('tgPurchaseChannel').trigger('change'); },
        async (ui) => ui.get('tgPremiumPreview').trigger('click'),
        async (ui) => ui.get('tgModeRedeem').trigger('click')
    ]) {
        let resolveQuote;
        const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? purchaseCatalog() : new Promise((resolve) => { resolveQuote = resolve; }) });
        await ui.flush();
        const quoting = startStarsPurchase(ui);
        await ui.flush();
        await change(ui);
        resolveQuote(response({ success: true, quote: purchaseQuote() }));
        await quoting;
        assert.equal(ui.get('tgPurchaseConfirmation').hidden, true);
        assert.equal(ui.get('tgPurchaseForm').hidden, false);
        assert.equal(ui.get('tgPurchaseMessage').textContent, '');
        await ui.get('tgPurchaseConfirm').trigger('click');
        assert.equal(ui.calls.filter((call) => call.url.endsWith('/orders')).length, 0);
    }
    const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, quote: purchaseQuote() }) });
    await ui.flush(); await startStarsPurchase(ui);
    assert.equal(ui.get('tgPurchaseConfirmation').hidden, false);
    await ui.get('tgPurchaseCancel').trigger('click');
    assert.equal(ui.get('tgPurchaseConfirmation').hidden, true);
    await ui.get('tgPurchaseConfirm').trigger('click');
    assert.equal(ui.calls.filter((call) => call.url.endsWith('/orders')).length, 0);
});

test('Stars quantity limits, disabled sales and invalid prices stop before quoting', async () => {
    for (const quantity of ['49', '1000001', '50.5', 'NaN']) {
        const ui = page({ fetch: async () => purchaseCatalog() }); await ui.flush(); await startStarsPurchase(ui, quantity);
        assert.ok(!ui.calls.some((call) => call.url.endsWith('/quote')));
        assert.match(ui.get('tgPurchaseMessage').textContent, /整数星星数量/);
    }
    for (const catalog of [
        { purchase_enabled: false }, { currency: 'USD' }, { sale_products: [] }, { payment_channels: [] },
        { sale_products: [{ ...STARS_SALE, enabled: false }] }, { sale_products: [{ ...STARS_SALE, unit_price_micros: 0 }] }
    ]) {
        const ui = page({ fetch: async () => purchaseCatalog(catalog) }); await ui.flush(); await startStarsPurchase(ui);
        assert.equal(ui.get('tgPurchaseButton').disabled, true);
        assert.ok(!ui.calls.some((call) => call.url.endsWith('/quote')));
    }
});

test('unconfirmed quote currency, price version, product, quantity and quote ID are rejected', async () => {
    for (const changes of [{ currency: 'USD' }, { price_version: 2 }, { price_version: 3.5 }, { total_minor: 0 }, { total_minor: 1.5 }, { stars_quantity: 101 }, { quote_id: '' }, { product_family: undefined }, { product_id: 'premium_3' }]) {
        const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, quote: purchaseQuote(changes) }) });
        await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
        assert.ok(!ui.calls.some((call) => call.url.endsWith('/orders')));
        assert.match(ui.get('tgPurchaseMessage').textContent, /未能确认|价格已更新/);
    }
});

test('lost purchase creation responses reuse one request and credentials across retries and reloads', async () => {
    const savedStorage = storage();
    const fetch = async (url) => url.endsWith('/catalog') ? purchaseCatalog() : url.endsWith('/quote') ? response({ success: true, quote: purchaseQuote() }) : Promise.reject(new Error('lost_response'));
    const ui = page({ fetch, savedStorage }); await ui.flush(); await startStarsPurchase(ui);
    await Promise.all([ui.get('tgPurchaseConfirm').trigger('click'), ui.get('tgPurchaseConfirm').trigger('click')]);
    await ui.get('tgPurchaseConfirm').trigger('click');
    const requests = ui.calls.filter((call) => call.url.endsWith('/orders'));
    assert.equal(requests.length, 2); assert.equal(requests[0].options.body, requests[1].options.body);
    const reloaded = page({ fetch, savedStorage }); await reloaded.flush(); await startStarsPurchase(reloaded); await reloaded.get('tgPurchaseConfirm').trigger('click');
    assert.equal(reloaded.calls.find((call) => call.url.endsWith('/orders')).options.body, requests[0].options.body);
});

test('a changed catalog price refreshes before a new quote can be confirmed', async () => {
    let catalogs = 0;
    const ui = page({ fetch: async (url) => {
        if (url.endsWith('/catalog')) return purchaseCatalog({ sale_products: [{ ...STARS_SALE, price_version: ++catalogs > 1 ? 4 : 3, unit_price_micros: catalogs > 1 ? 13456 : STARS_SALE.unit_price_micros }] });
        if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote({ price_version: 4, total_minor: 135 }) });
        throw new Error('must confirm the refreshed price first');
    } });
    await ui.flush(); await startStarsPurchase(ui);
    assert.equal(catalogs, 2);
    assert.equal(ui.get('tgPurchaseConfirmation').hidden, true);
    assert.match(ui.get('tgPurchaseMessage').textContent, /价格已更新/);
    await ui.get('tgPurchaseConfirm').trigger('click');
    assert.equal(ui.calls.filter((call) => call.url.endsWith('/orders')).length, 0);
    await startStarsPurchase(ui);
    assert.equal(ui.get('tgPurchaseConfirmation').hidden, false);
    assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /¥1\.35/);
});

test('an unfinished original request shows its original amount before replay after a price change', async () => {
    let priceVersion = 3;
    const ui = page({ fetch: async (url) => {
        if (url.endsWith('/catalog')) return purchaseCatalog({ sale_products: [{ ...STARS_SALE, price_version: priceVersion, unit_price_micros: priceVersion === 3 ? STARS_SALE.unit_price_micros : 13456 }] });
        if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote({ price_version: priceVersion, total_minor: priceVersion === 3 ? 124 : 135 }) });
        throw new Error('response lost');
    } });
    await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
    const original = ui.calls.find((call) => call.url.endsWith('/orders')).options.body;
    priceVersion = 4;
    await ui.get('tgPurchaseCancel').trigger('click'); await startStarsPurchase(ui); await startStarsPurchase(ui);
    assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /¥1\.35/);
    await ui.get('tgPurchaseConfirm').trigger('click');
    assert.equal(ui.calls.filter((call) => call.url.endsWith('/orders')).length, 1);
    assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /原订单.*¥1\.24/);
    assert.match(ui.get('tgPurchaseMessage').textContent, /原订单金额/);
    await ui.get('tgPurchaseConfirm').trigger('click');
    const requests = ui.calls.filter((call) => call.url.endsWith('/orders'));
    assert.equal(requests.length, 2);
    assert.equal(requests[1].options.body, original);
});

test('confirmed expired or stale quotes release the old request and require a fresh price confirmation', async () => {
    for (const code of ['quote_expired', 'quote_stale', 'quote_conflict', 'quote_mismatch', 'price_changed', 'price_version_conflict']) {
        let quotes = 0; let posts = 0;
        const nextQuote = 'f24c9d34-b5cd-4d0f-b92b-4d2a0738e05e';
        const ui = page({ fetch: async (url) => {
            if (url.endsWith('/catalog')) return purchaseCatalog({ sale_products: [{ ...STARS_SALE, price_version: posts ? 4 : 3, unit_price_micros: posts ? 13456 : STARS_SALE.unit_price_micros }] });
            if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote(++quotes > 1 ? { quote_id: nextQuote, price_version: 4, total_minor: 135 } : {}) });
            if (url.endsWith('/orders')) {
                if (++posts === 1) return response({ success: false, code, message: '请重新确认价格' }, 409);
                return response({ success: true, order: purchaseOrder({ total_minor: 135, price_version: 4 }) });
            }
            return response({ success: true, order: purchaseOrder({ total_minor: 135, price_version: 4 }) });
        } });
        await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
        assert.equal(ui.get('tgPurchaseConfirmation').hidden, true);
        assert.match(ui.get('tgPurchaseStatusResult').textContent, /未创建订单/);
        await ui.get('tgPurchaseConfirm').trigger('click');
        assert.equal(posts, 1, 'a rejected quote cannot be confirmed again');
        await startStarsPurchase(ui); assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /¥1\.35/);
        await ui.get('tgPurchaseConfirm').trigger('click');
        const requests = ui.calls.filter((call) => call.url.endsWith('/orders')).map((call) => JSON.parse(call.options.body));
        assert.equal(requests.length, 2); assert.equal(requests[1].quote_id, nextQuote); assert.equal(requests[1].expected_total_minor, 135);
        assert.notEqual(requests[1].idempotency_key, requests[0].idempotency_key);
        assert.notEqual(requests[1].status_token, requests[0].status_token);
    }
});

test('server-confirmed expired purchases allow the same selection to create a fresh order after reload', async () => {
    let quotes = 0; let posts = 0;
    const nextOrder = 'TGP-ABCDEFGHIJABCDEFGHIJ';
    const fetch = async (url) => {
        if (url.endsWith('/catalog')) return purchaseCatalog();
        if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote(++quotes > 1 ? { quote_id: 'f24c9d34-b5cd-4d0f-b92b-4d2a0738e05e' } : {}) });
        if (url.endsWith('/orders')) return response({ success: true, order: purchaseOrder(++posts > 1 ? { order_no: nextOrder } : {}) });
        return response({ success: true, order: purchaseOrder(url.includes(nextOrder) ? { order_no: nextOrder } : { payment_status: 'expired' }) });
    };
    const ui = page({ fetch }); await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /支付已过期/); assert.equal(ui.timers.size, 0);
    const first = JSON.parse(ui.calls.find((call) => call.url.endsWith('/orders')).options.body);
    const reloaded = page({ fetch, savedStorage: ui.storage }); await reloaded.flush();
    await startStarsPurchase(reloaded); await reloaded.get('tgPurchaseConfirm').trigger('click');
    const second = JSON.parse(reloaded.calls.find((call) => call.url.endsWith('/orders')).options.body);
    assert.notEqual(second.quote_id, first.quote_id); assert.notEqual(second.idempotency_key, first.idempotency_key);
    assert.equal(reloaded.get('tgPurchaseOrderNo').value, nextOrder);
});

test('incomplete responses and ambiguous quote-use errors keep the original purchase request', async () => {
    for (const failure of [
        response({ success: false, code: 'quote_stale' }, 503),
        response({ success: false, code: 'quote_already_used' }, 409),
        response({ success: false, code: 'idempotency_conflict' }, 409),
        response({ success: true, order: { order_no: 'invalid' } })
    ]) {
        let quotes = 0;
        const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? purchaseCatalog()
            : url.endsWith('/quote') ? response({ success: true, quote: purchaseQuote({ quote_id: ++quotes > 1 ? 'f24c9d34-b5cd-4d0f-b92b-4d2a0738e05e' : QUOTE_ID }) }) : failure });
        await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
        await ui.get('tgPurchaseCancel').trigger('click'); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
        const requests = ui.calls.filter((call) => call.url.endsWith('/orders'));
        assert.equal(requests.length, 2); assert.equal(requests[0].options.body, requests[1].options.body);
    }
});

test('mismatched order snapshots never expose a payment link or release the request', async () => {
    for (const changes of [{ total_minor: 125 }, { username: 'other_recipient' }, { stars_quantity: 101 }, { price_version: 4 }, { payment_channel: 'wxpay' }]) {
        let posts = 0;
        const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? purchaseCatalog()
            : url.endsWith('/quote') ? response({ success: true, quote: purchaseQuote() })
                : url.endsWith('/orders') ? (++posts, response({ success: true, order: purchaseOrder(changes) }))
                    : response({ success: true, order: purchaseOrder(changes) }) });
        await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
        assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
        await ui.get('tgPurchaseStatusForm').trigger('submit');
        assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
        assert.match(ui.get('tgPurchaseStatusResult').textContent, /不一致/);
        await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click'); assert.equal(posts, 1);
    }
});

test('purchase checkout links require HTTPS and verified order entitlements', async () => {
    for (const url of ['javascript:alert(1)', 'http://pay.example.test', 'https://user:secret@pay.example.test']) {
        const ui = page({ fetch: async (target) => target.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, order: purchaseOrder({ checkout_url: url }) }) });
        await ui.flush(); ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'a'.repeat(64);
        await ui.get('tgPurchaseStatusForm').trigger('submit'); assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    }
    const ui = page({ fetch: async (target) => target.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, order: purchaseOrder({ product_family: undefined }) }) });
    await ui.flush(); ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'a'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit'); assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /暂未确认/);
});

test('purchase status polling restores safely, pauses in the background and stops after fulfillment', async () => {
    let paid = false;
    const fetch = async (url) => url.endsWith('/catalog') ? purchaseCatalog() : url.endsWith('/quote') ? response({ success: true, quote: purchaseQuote() })
        : url.endsWith('/orders') ? response({ success: true, order: purchaseOrder() }) : response({ success: true, order: purchaseOrder(paid ? { payment_status: 'paid', fulfillment_status: 'succeeded' } : {}) });
    const ui = page({ fetch }); await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
    assert.equal(ui.timers.size, 1); ui.document.hidden = true; ui.documentEvents.get('visibilitychange')(); assert.equal(ui.timers.size, 0);
    ui.document.hidden = false; ui.documentEvents.get('visibilitychange')(); assert.equal(ui.timers.size, 1);
    const reloaded = page({ fetch, savedStorage: ui.storage }); await reloaded.flush();
    assert.ok(reloaded.calls.some((call) => call.url.includes('/purchase/status?')));
    assert.ok(!reloaded.calls.some((call) => call.url.endsWith('/orders')));
    paid = true; [...reloaded.timers.values()][0].fn(); await reloaded.flush();
    assert.match(reloaded.get('tgPurchaseStatusResult').textContent, /星星已到账/); assert.equal(reloaded.timers.size, 0); assert.equal(reloaded.get('tgPurchaseCheckout').hidden, true);
});

test('Stars totals change immediately and round exact micro prices upward without submitting orders', async () => {
    const ui = page({ fetch: async () => purchaseCatalog() }); await ui.flush();
    await ui.get('tgStarsPreview').trigger('click');
    assert.match(ui.get('tgPurchasePrice').textContent, /¥1\.24/);
    ui.get('tgPurchaseStars').value = '101'; await ui.get('tgPurchaseStars').trigger('input');
    assert.match(ui.get('tgPurchasePrice').textContent, /¥1\.25/);
    for (const quantity of ['', '49', '1000001', '50.1']) {
        ui.get('tgPurchaseStars').value = quantity; await ui.get('tgPurchaseStars').trigger('input');
        assert.doesNotMatch(ui.get('tgPurchasePrice').textContent, /¥/);
        assert.equal(ui.get('tgPurchaseButton').disabled, true);
    }
    assert.ok(!ui.calls.some(call => call.url.endsWith('/quote') || call.url.endsWith('/orders')));
    const micro = page({ fetch: async () => purchaseCatalog({ sale_products: [{ ...STARS_SALE, unit_price_micros: 1 }] }) }); await micro.flush();
    await micro.get('tgStarsPreview').trigger('click'); micro.get('tgPurchaseStars').value = '50'; await micro.get('tgPurchaseStars').trigger('input');
    assert.match(micro.get('tgPurchasePrice').textContent, /¥0\.01/);
    micro.get('tgPurchaseStars').value = '1000000'; await micro.get('tgPurchaseStars').trigger('input');
    assert.match(micro.get('tgPurchasePrice').textContent, /¥1\.00/);
});

test('Premium selections update prices while configured off-sale prices remain visible and unavailable to buy', async () => {
    const ui = page({ fetch: async () => purchaseCatalog({ sale_products: [PREMIUM_SALE,
        { ...PREMIUM_SALE, id: 'premium_6', term_months: 6, price_minor: 25999, enabled: false },
        { ...PREMIUM_SALE, id: 'premium_12', term_months: 12, price_minor: null, enabled: false }] }) });
    await ui.flush(); assert.match(ui.get('tgPurchasePrice').textContent, /¥129\.99/);
    assert.match(ui.get('tgPurchaseProduct').children[0].textContent, /3 个月 · ¥129\.99/);
    ui.get('tgPurchaseProduct').value = 'premium_6'; await ui.get('tgPurchaseProduct').trigger('change');
    assert.match(ui.get('tgPurchasePrice').textContent, /¥259\.99/); assert.match(ui.get('tgPurchasePrice').textContent, /暂未开售/);
    assert.equal(ui.get('tgPurchaseButton').disabled, true);
    ui.get('tgPurchaseProduct').value = 'premium_12'; await ui.get('tgPurchaseProduct').trigger('change');
    assert.equal(ui.get('tgPurchasePrice').textContent, '价格暂未公布'); assert.doesNotMatch(ui.get('tgPurchasePrice').textContent, /¥0/);
});

test('recipient input debounces lookup, renders literal names and safely falls back when the image fails', async () => {
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? enabledCatalog() : response({ success: true, recipient: {
        username: 'recipient_test', display_name: '<img src=x onerror=alert(1)>', avatar_url: 'https://cdn4.telesco.pe/file/avatar_1.jpg', recipient_type: 'user'
    } }) }); await ui.flush();
    ui.get('tgPurchaseUsername').value = 'recip'; await ui.get('tgPurchaseUsername').trigger('input');
    ui.get('tgPurchaseUsername').value = '@Recipient_Test'; await ui.get('tgPurchaseUsername').trigger('input');
    const lookups = [...ui.timers.entries()].filter(([, timer]) => timer.ms === 450); assert.equal(lookups.length, 1);
    const [id, timer] = lookups[0]; ui.timers.delete(id); await timer.fn();
    const calls = ui.calls.filter(call => call.url.includes('/recipient?')); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/tg/recipient?username=recipient_test');
    const container = ui.get('tgPurchaseRecipient'); assert.equal(container.hidden, false);
    assert.equal(container.children[1].children[0].textContent, '<img src=x onerror=alert(1)>');
    const [fallback, image] = container.children[0].children; assert.equal(image.referrerPolicy, 'no-referrer');
    await image.trigger('load'); assert.equal(image.hidden, false); assert.equal(fallback.hidden, true);
    await image.trigger('error'); assert.equal(image.hidden, true); assert.equal(fallback.hidden, false);
    assert.ok(!ui.calls.some(call => call.url.endsWith('/orders') || call.url.endsWith('/redeem')));
});

test('late recipient replies cannot overwrite another username and clearing the input removes the old profile', async () => {
    let resolveOld;
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? enabledCatalog()
        : url.includes('older_user') ? new Promise(resolve => { resolveOld = resolve; })
        : response({ success: true, recipient: { username: 'newer_user', display_name: '最新接收者', avatar_url: 'https://evil.example/avatar.png', recipient_type: 'user' } }) });
    await ui.flush(); ui.get('tgUsername').value = 'older_user'; const first = ui.get('tgUsername').trigger('blur'); await ui.flush();
    ui.get('tgUsername').value = 'newer_user'; await ui.get('tgUsername').trigger('blur');
    resolveOld(response({ success: true, recipient: { username: 'older_user', display_name: '过期接收者', avatar_url: null } })); await first;
    const container = ui.get('tgRedeemRecipient'); assert.match(container.textContent, /最新接收者/); assert.doesNotMatch(container.textContent, /过期接收者/);
    assert.equal(container.children[0].children.length, 1, 'untrusted image URLs never reach an image element');
    ui.get('tgUsername').value = ''; await ui.get('tgUsername').trigger('input'); assert.equal(container.hidden, true); assert.equal(container.children.length, 0);
});

test('missing recipient and temporary lookup failures show distinct messages', async () => {
    for (const [status, expected] of [[404, /未找到/], [504, /暂时无法/]]) {
        const ui = page({ fetch: async url => url.endsWith('/catalog') ? enabledCatalog() : response({ success: false }, status) }); await ui.flush();
        ui.get('tgUsername').value = 'recipient_test'; await ui.get('tgUsername').trigger('blur');
        assert.match(ui.get('tgRedeemRecipient').textContent, expected); assert.equal(ui.get('tgRedeemRecipient').attributes.get('aria-busy'), 'false');
    }
});

const cryptoCheckout = (changes = {}) => ({ network: 'BSC (BEP20)', pay_currency: 'usdtbsc', pay_amount: '1.234567890123456789',
    pay_address: '0x' + 'a'.repeat(40), quote_expires_at: new Date(Date.now() + 60000).toISOString(), ...changes });
test('USDT remains a distinct payment choice and shows exact transfer amount, network and address after order verification', async () => {
    let copied;
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog({ payment_channels: [{ id: 'alipay' }, { id: 'usdt_bep20' }] })
        : response({ success: true, order: purchaseOrder({ payment_channel: 'usdt_bep20', checkout_url: undefined, crypto_checkout: cryptoCheckout() }) }) }); await ui.flush();
    assert.match(ui.get('tgPurchaseChannel').children[1].textContent, /USDT.*BEP20/);
    ui.get('tgPurchaseChannel').value = 'usdt_bep20'; await ui.get('tgStarsPreview').trigger('click'); await ui.get('tgPurchaseChannel').trigger('change');
    assert.match(ui.get('tgPurchasePrice').textContent, /¥1\.24/); assert.match(ui.get('tgPurchasePrice').textContent, /USDT 转账金额/);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    const result = ui.get('tgPurchaseStatusResult'); assert.match(result.textContent, /1\.234567890123456789 USDT/); assert.match(result.textContent, /BSC（BEP20）/);
    assert.ok(result.textContent.includes('0x' + 'a'.repeat(40))); assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    ui.window.navigator.clipboard.writeText = async value => { copied = value; };
    await result.children[3].children[5].children[0].trigger('click'); assert.equal(copied, '0x' + 'a'.repeat(40));
});

test('expired or invalid USDT instructions never expose a transferable address or external checkout link', async () => {
    for (const checkout of [cryptoCheckout({ quote_expires_at: new Date(Date.now() - 1000).toISOString() }), cryptoCheckout({ pay_currency: 'usdterc20' }), cryptoCheckout({ pay_address: 'javascript:bad' })]) {
        const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog({ payment_channels: [{ id: 'usdt_bep20' }] })
            : response({ success: true, order: purchaseOrder({ payment_channel: 'usdt_bep20', crypto_checkout: checkout }) }) }); await ui.flush();
        ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64); await ui.get('tgPurchaseStatusForm').trigger('submit');
        assert.ok(!ui.get('tgPurchaseStatusResult').textContent.includes(checkout.pay_address)); assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    }
});

test('clicking order lookup switches from the workspace view to the order lookup subpage and back', async () => {
    const ui = page({ fetch: async (url) => url.endsWith('/catalog') ? enabledCatalog() : response({ success: false }, 404) });
    await ui.flush();
    assert.equal(ui.get('tgWorkspaceView').hidden, false);
    assert.equal(ui.get('tgOrderLookupPage').hidden, true);
    await ui.get('tgOrderLookupToggle').trigger('click');
    assert.equal(ui.get('tgWorkspaceView').hidden, true);
    assert.equal(ui.get('tgOrderLookupPage').hidden, false);
    assert.equal(ui.get('tgOrderLookupToggle').attributes.get('aria-current'), 'page');
    await ui.get('tgOrderLookupBack').trigger('click');
    assert.equal(ui.get('tgWorkspaceView').hidden, false);
    assert.equal(ui.get('tgOrderLookupPage').hidden, true);
    assert.equal(ui.get('tgOrderLookupToggle').attributes.get('aria-current'), 'false');
});
