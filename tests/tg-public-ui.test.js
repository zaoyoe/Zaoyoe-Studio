'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const script = fs.readFileSync(require.resolve('../js/tg.js'), 'utf8');
const orderQueryScript = fs.readFileSync(require.resolve('../js/tg-order-query.js'), 'utf8');
const ORDER = 'TG-ABCDEFGHIJKLMNOP';
const CODE = 'TG-PREM-12345678-12345678-12345678-12345678';
const STARS_CODE = 'TG-STAR-12345678-12345678-12345678-12345678';
function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
function purchaseAmount(ui) { return ui.get('tgPurchasePrice').children.find(node => node.className === 'tg-price-amount')?.textContent; }
function purchaseBreakdown(ui) { return ui.get('tgPurchasePrice').children.find(node => node.className === 'tg-price-breakdown').children.map(item => [item.children[0].textContent, item.children[1].textContent]); }
function storage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
function page({ fetch, savedStorage = storage(), crypto = webcrypto, preview = (code) => response({ success: true, product_family: code.includes('STAR') ? 'telegram_stars' : 'telegram_premium', term_months: code.includes('STAR') ? null : 3, stars_quantity: code.includes('STAR') ? 500 : null, expires_at: null }) } = {}) {
    const elements = new Map();
    const documentEvents = new Map();
    const windowEvents = new Map();
    const timers = new Map();
    let timerId = 0;
    function element(tag = 'div') {
        return { value: '', _text: '', get textContent() { return this._text + this.children.map(node => node.textContent || '').join(''); }, set textContent(value) { this._text = String(value); this.children = []; }, hidden: false, disabled: false, className: '', children: [], listeners: new Map(),
            tagName: tag.toUpperCase(), dataset: {}, open: false, append(...nodes) { this.children.push(...nodes); },
            showModal() { this.open = true; }, close() { this.open = false; }, focus() { document.activeElement = this; },
            getBoundingClientRect() { return { left: 100, top: 100, right: 800, bottom: 800 }; }, removeAttribute(name) { this.attributes.delete(name); },
            classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll() { return []; },
            attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); },
            addEventListener(name, fn) { const previous = this.listeners.get(name); this.listeners.set(name, async event => { if (previous) await previous(event); return fn(event); }); },
            replaceChildren(...nodes) { this._text = ''; this.children = nodes; },
            async trigger(name, event = {}) { await this.listeners.get(name)?.({ preventDefault() {}, currentTarget: this, ...event }); }
        };
    }
    const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        createElement: element, addEventListener: (name, fn) => documentEvents.set(name, fn) };
    const calls = [];
    document.getElementById('tgOrdersSearchBy').value = 'email';
    document.getElementById('tgPurchaseProduct').value = 'premium_3';
    document.getElementById('tgPurchaseStars').value = '100';
    document.getElementById('tgPurchaseChannel').value = 'alipay';
    document.getElementById('tgPurchaseCheckout').hidden = true;
    document.getElementById('tgRedeemConfirmation').hidden = true;
    const window = { qrcode: require('../js/vendor/qrcode-generator-2.0.4'), TgPaymentPricing: require('../js/tg-payment-pricing'), document, crypto, TextEncoder, AbortController, URL, sessionStorage: savedStorage, btoa: value => Buffer.from(value, 'binary').toString('base64'), navigator: { clipboard: { writeText: async () => {} } },
        confirm: () => true,
        fetch: async (url, options) => { calls.push({ url, options }); return url === '/api/tg/preview' ? preview(JSON.parse(options.body).code) : fetch(url, options); },
        setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
        clearTimeout: (id) => timers.delete(id), addEventListener(name, fn) { const previous = windowEvents.get(name); windowEvents.set(name, event => { previous?.(event); return fn(event); }); } };
    vm.runInNewContext(orderQueryScript, { window });
    vm.runInNewContext(script, { window, Uint8Array, Date });
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    return { window, document, documentEvents, windowEvents, elements, calls, timers, storage: savedStorage, flush,
        get: (id) => document.getElementById(id),
        async submit(code = CODE) { document.getElementById('tgUsername').value = 'recipient_test'; document.getElementById('tgCode').value = code; const before = calls.filter((call) => call.url === '/api/tg/redeem').length; await document.getElementById('tgRedeemForm').trigger('submit'); if (calls.filter((call) => call.url === '/api/tg/redeem').length === before && !document.getElementById('tgRedeemConfirmation').hidden) await document.getElementById('tgRedeemForm').trigger('submit'); },
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
    assert.ok(ui.get('tgStatusResult').textContent.includes(payload));
    const recipient = ui.get('tgStatusResult').children[0].children[1].children.find(field => field.children[0].textContent === '接收账号').children[1];
    assert.equal(recipient.children.length, 0, 'untrusted recipient stays text, never HTML');
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
    assert.equal(ui.elements.has('tgProductDescription'), false, 'product switches do not recreate removed helper copy');
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
const pricing = require('../js/tg-payment-pricing');
const purchaseQuote = (changes = {}) => ({ payment_channel: changes.payment_channel || 'alipay', ...pricing.breakdown(changes.subtotal_minor ?? 124, changes.payment_channel || 'alipay'), quote_id: QUOTE_ID, product_id: 'stars', product_family: 'telegram_stars', stars_quantity: 100, term_months: null, currency: 'CNY', price_version: 3, ...changes });
const purchaseOrder = (changes = {}) => ({ ...pricing.breakdown(changes.subtotal_minor ?? 124, changes.payment_channel || 'alipay'), order_no: PURCHASE_ORDER, product_family: 'telegram_stars', stars_quantity: 100, term_months: null, username: 'recipient_test', currency: 'CNY', price_version: 3, payment_channel: 'alipay', payment_status: 'pending', fulfillment_status: 'not_started', expires_at: new Date(Date.now() + 60000).toISOString(), checkout_url: 'https://pay.example.test/checkout', ...changes });
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
    assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /Stars 100 颗.*¥1\.26/);
    assert.equal(ui.calls.filter((call) => call.url.endsWith('/orders')).length, 0);
    const quoteRequest = JSON.parse(ui.calls.find((call) => call.url.endsWith('/quote')).options.body);
    assert.deepEqual(quoteRequest, { product_id: 'stars', username: 'recipient_test', stars_quantity: 100, channel: 'alipay' });
    await ui.get('tgPurchaseConfirm').trigger('click');
    const create = ui.calls.find((call) => call.url.endsWith('/orders'));
    const input = JSON.parse(create.options.body);
    assert.equal(input.quote_id, QUOTE_ID); assert.equal(input.expected_total_minor, 126); assert.equal(input.price_version, 3);
    assert.match(input.status_token, /^[a-f0-9]{64}$/); assert.equal(create.options.headers['Idempotency-Key'], input.idempotency_key);
    await ui.get('tgPurchaseCheckout').trigger('click');
    assert.equal(ui.get('tgPaymentDialog').open, true);
    assert.match(ui.get('tgPaymentContent').textContent, /支付宝扫码支付/);
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
        if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote({ price_version: 4, subtotal_minor: 135 }) });
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
        if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote({ price_version: priceVersion, subtotal_minor: priceVersion === 3 ? 124 : 135 }) });
        throw new Error('response lost');
    } });
    await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
    const original = ui.calls.find((call) => call.url.endsWith('/orders')).options.body;
    priceVersion = 4;
    await ui.get('tgPurchaseCancel').trigger('click'); await startStarsPurchase(ui); await startStarsPurchase(ui);
    assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /¥1\.35/);
    await ui.get('tgPurchaseConfirm').trigger('click');
    assert.equal(ui.calls.filter((call) => call.url.endsWith('/orders')).length, 1);
    assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /原订单.*¥1\.26/);
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
            if (url.endsWith('/quote')) return response({ success: true, quote: purchaseQuote(++quotes > 1 ? { quote_id: nextQuote, price_version: 4, subtotal_minor: 135 } : {}) });
            if (url.endsWith('/orders')) {
                if (++posts === 1) return response({ success: false, code, message: '请重新确认价格' }, 409);
                return response({ success: true, order: purchaseOrder({ subtotal_minor: 135, price_version: 4 }) });
            }
            return response({ success: true, order: purchaseOrder({ subtotal_minor: 135, price_version: 4 }) });
        } });
        await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
        assert.equal(ui.get('tgPurchaseConfirmation').hidden, true);
        assert.match(ui.get('tgPurchaseStatusResult').textContent, /未创建订单/);
        await ui.get('tgPurchaseConfirm').trigger('click');
        assert.equal(posts, 1, 'a rejected quote cannot be confirmed again');
        await startStarsPurchase(ui); assert.match(ui.get('tgPurchaseQuoteSummary').textContent, /¥1\.35/);
        await ui.get('tgPurchaseConfirm').trigger('click');
        const requests = ui.calls.filter((call) => call.url.endsWith('/orders')).map((call) => JSON.parse(call.options.body));
        assert.equal(requests.length, 2); assert.equal(requests[1].quote_id, nextQuote); assert.equal(requests[1].expected_total_minor, 137);
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
    for (const changes of [{ subtotal_minor: 125 }, { username: 'other_recipient' }, { stars_quantity: 101 }, { price_version: 4 }, { payment_channel: 'wxpay' }]) {
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
    const pollingTimers = (view) => [...view.timers.values()].filter(timer => timer.ms === 5000);
    assert.equal(pollingTimers(ui).length, 1);
    assert.equal([...ui.timers.values()].filter(timer => timer.ms === 1000).length, 1, 'payment dialog has its own expiry countdown');
    ui.document.hidden = true; ui.documentEvents.get('visibilitychange')(); assert.equal(ui.timers.size, 0);
    ui.document.hidden = false; ui.documentEvents.get('visibilitychange')(); assert.equal(pollingTimers(ui).length, 1);
    const reloaded = page({ fetch, savedStorage: ui.storage }); await reloaded.flush();
    assert.ok(reloaded.calls.some((call) => call.url.includes('/purchase/status?')));
    assert.ok(!reloaded.calls.some((call) => call.url.endsWith('/orders')));
    assert.equal(pollingTimers(reloaded).length, 1);
    paid = true; pollingTimers(reloaded)[0].fn(); await reloaded.flush();
    assert.match(reloaded.get('tgPurchaseStatusResult').textContent, /星星已到账/); assert.equal(reloaded.timers.size, 0); assert.equal(reloaded.get('tgPurchaseCheckout').hidden, true);
});

test('Stars totals change immediately and round exact micro prices upward without submitting orders', async () => {
    const ui = page({ fetch: async () => purchaseCatalog() }); await ui.flush();
    await ui.get('tgStarsPreview').trigger('click');
    assert.equal(purchaseAmount(ui), '¥1.26');
    ui.get('tgPurchaseStars').value = '101'; await ui.get('tgPurchaseStars').trigger('input');
    assert.equal(purchaseAmount(ui), '¥1.27');
    for (const quantity of ['', '49', '1000001', '50.1']) {
        ui.get('tgPurchaseStars').value = quantity; await ui.get('tgPurchaseStars').trigger('input');
        assert.doesNotMatch(ui.get('tgPurchasePrice').textContent, /¥/);
        assert.equal(ui.get('tgPurchaseButton').disabled, true);
    }
    assert.ok(!ui.calls.some(call => call.url.endsWith('/quote') || call.url.endsWith('/orders')));
    const micro = page({ fetch: async () => purchaseCatalog({ sale_products: [{ ...STARS_SALE, unit_price_micros: 1 }] }) }); await micro.flush();
    await micro.get('tgStarsPreview').trigger('click'); micro.get('tgPurchaseStars').value = '50'; await micro.get('tgPurchaseStars').trigger('input');
    assert.equal(purchaseAmount(micro), '¥0.02');
    micro.get('tgPurchaseStars').value = '1000000'; await micro.get('tgPurchaseStars').trigger('input');
    assert.equal(purchaseAmount(micro), '¥1.01');
});

test('Premium selections update prices while configured off-sale prices remain visible and unavailable to buy', async () => {
    const ui = page({ fetch: async () => purchaseCatalog({ sale_products: [PREMIUM_SALE,
        { ...PREMIUM_SALE, id: 'premium_6', term_months: 6, price_minor: 25999, enabled: false },
        { ...PREMIUM_SALE, id: 'premium_12', term_months: 12, price_minor: null, enabled: false }] }) });
    await ui.flush(); assert.equal(purchaseAmount(ui), '¥131.29');
    assert.match(ui.get('tgPurchaseProduct').children[0].textContent, /3 个月 · ¥129\.99/);
    ui.get('tgPurchaseProduct').value = 'premium_6'; await ui.get('tgPurchaseProduct').trigger('change');
    assert.equal(purchaseAmount(ui), '¥262.59'); assert.equal(ui.get('tgPurchaseButton').textContent, '当前商品暂未开售');
    assert.equal(ui.get('tgPurchaseButton').disabled, true);
    ui.get('tgPurchaseProduct').value = 'premium_12'; await ui.get('tgPurchaseProduct').trigger('change');
    assert.equal(ui.get('tgPurchasePrice').textContent, '价格暂未公布'); assert.doesNotMatch(ui.get('tgPurchasePrice').textContent, /¥0/);
});

test('price details follow the selected product and keep the subtotal and fee separate from the payable total', async () => {
    const ui = page({ fetch: async () => purchaseCatalog({ sale_products: [PREMIUM_SALE,
        { ...PREMIUM_SALE, id: 'premium_12', term_months: 12, price_minor: 21800 }, STARS_SALE],
        payment_channels: [{ id: 'alipay' }, { id: 'usdt_bep20' }], usdt_per_cny: '0.14' }) });
    await ui.flush();
    ui.get('tgPurchaseProduct').value = 'premium_12'; await ui.get('tgPurchaseProduct').trigger('change');
    assert.equal(purchaseAmount(ui), '¥220.18');
    assert.deepEqual(purchaseBreakdown(ui), [['商品规格', 'Premium 12个月'], ['商品金额', '¥218.00'], ['通道手续费', '¥2.181%']]);
    ui.get('tgPurchaseChannel').value = 'usdt_bep20'; await ui.get('tgPurchaseChannel').trigger('change');
    assert.equal(purchaseAmount(ui), '30.8300');
    assert.deepEqual(purchaseBreakdown(ui), [['商品规格', 'Premium 12个月'], ['商品金额', '¥218.00'], ['通道手续费', '¥2.181%']]);
    await ui.get('tgStarsPreview').trigger('click');
    assert.deepEqual(purchaseBreakdown(ui), [['商品规格', '100 颗 Stars'], ['商品金额', '¥1.24'], ['通道手续费', '¥0.021%']]);
    ui.get('tgPurchaseStars').value = '101'; await ui.get('tgPurchaseStars').trigger('input');
    assert.deepEqual(purchaseBreakdown(ui), [['商品规格', '101 颗 Stars'], ['商品金额', '¥1.25'], ['通道手续费', '¥0.021%']]);
    assert.equal(ui.calls.filter(call => /quote|orders/.test(call.url)).length, 0);
});

test('a priced product without an available payment channel does not retain loading placeholders', async () => {
    const ui = page({ fetch: async () => purchaseCatalog({ payment_channels: [] }) });
    await ui.flush();
    assert.equal(purchaseAmount(ui), '金额暂不可用');
    assert.deepEqual(purchaseBreakdown(ui), [['商品规格', 'Premium 3个月'], ['商品金额', '¥129.99'], ['通道手续费', '—']]);
    assert.equal(ui.get('tgPurchaseButton').disabled, true);
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
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog({ payment_channels: [{ id: 'alipay' }, { id: 'usdt_bep20' }], usdt_per_cny: '0.14' })
        : response({ success: true, order: purchaseOrder({ payment_channel: 'usdt_bep20', checkout_url: undefined, crypto_checkout: cryptoCheckout() }) }) }); await ui.flush();
    assert.match(ui.get('tgPurchaseChannel').children[1].textContent, /USDT/);
    ui.get('tgPurchaseChannel').value = 'usdt_bep20'; await ui.get('tgStarsPreview').trigger('click'); await ui.get('tgPurchaseChannel').trigger('change');
    assert.match(ui.get('tgPurchasePrice').textContent, /USDT/);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    await ui.get('tgPurchaseCheckout').trigger('click');
    const result = ui.get('tgPaymentContent'); assert.match(result.textContent, /1\.2346 USDT/); assert.match(result.textContent, /BSC \(BEP20\)/);
    assert.ok(result.textContent.includes('0x' + 'a'.repeat(40))); assert.equal(ui.get('tgPaymentDialog').open, true);
    ui.window.navigator.clipboard.writeText = async value => { copied = value; };
    await result.children[1].children[5].children[0].trigger('click'); assert.equal(copied, '0x' + 'a'.repeat(40));
    await result.children[1].children[5].children[1].trigger('click'); assert.equal(copied, '1.234567890123456789');
});

test('expired or invalid USDT instructions never expose a transferable address or external checkout link', async () => {
    for (const checkout of [cryptoCheckout({ quote_expires_at: new Date(Date.now() - 1000).toISOString() }), cryptoCheckout({ pay_currency: 'usdterc20' }), cryptoCheckout({ pay_address: 'javascript:bad' })]) {
        const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog({ payment_channels: [{ id: 'usdt_bep20' }] })
            : response({ success: true, order: purchaseOrder({ payment_channel: 'usdt_bep20', crypto_checkout: checkout }) }) }); await ui.flush();
        ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64); await ui.get('tgPurchaseStatusForm').trigger('submit');
        assert.ok(!ui.get('tgPurchaseStatusResult').textContent.includes(checkout.pay_address));
        await ui.get('tgPurchaseCheckout').trigger('click');
        assert.ok(!ui.get('tgPaymentContent').textContent.includes(checkout.pay_address));
        assert.match(ui.get('tgPaymentStateMessage').textContent, /过期|暂不可用/);
        assert.equal(ui.get('tgPurchaseCheckout').href, undefined);
    }
});

test('historical USDT amount and network remain visible in customer order details without payment credentials', async () => {
    const checkout = cryptoCheckout();
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog()
        : response({ success: true, order: purchaseOrder({ payment_channel: 'usdt_bep20', payment_status: 'expired',
            crypto_payment: { network: checkout.network, pay_currency: checkout.pay_currency, pay_amount: checkout.pay_amount } }) }) });
    await ui.flush(); await selectOriginalLookup(ui);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    const text = ui.get('tgPurchaseStatusResult').textContent;
    assert.match(text, /1\.2346 USDT/);
    assert.match(text, /BSC \(BEP20\)/);
    assert.doesNotMatch(text, new RegExp(checkout.pay_address));
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

test('redemption first previews the actual entitlement and only a second confirmation submits it', async () => {
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? enabledCatalog() : response({ success: false, message: 'test stop' }, 409) });
    await ui.flush(); ui.get('tgUsername').value = 'recipient_test'; ui.get('tgCode').value = STARS_CODE;
    await ui.get('tgRedeemForm').trigger('submit');
    assert.equal(ui.posts().length, 0); assert.equal(ui.get('tgRedeemConfirmation').hidden, false);
    assert.match(ui.get('tgRedeemConfirmation').textContent, /500/); assert.match(ui.get('tgRedeemConfirmation').textContent, /recipient_test/);
    assert.match(ui.get('tgRedeemButton').textContent, /确认权益/); assert.equal(ui.storage.values.size, 0);
    await ui.get('tgRedeemForm').trigger('submit'); assert.equal(ui.posts().length, 1);
    assert.equal(JSON.parse(ui.posts()[0].options.body).code, STARS_CODE);
});

test('editing recipient or code invalidates the preview and a late response cannot restore it', { timeout: 5000 }, async () => {
    let notifyPreview;
    const nextPreview = () => new Promise(resolve => { notifyPreview = resolve; });
    const ui = page({ fetch: async () => enabledCatalog(), preview: () => new Promise(resolve => { notifyPreview(resolve); }) });
    await ui.flush(); ui.get('tgUsername').value = 'recipient_test'; ui.get('tgCode').value = CODE;
    const firstStarted = nextPreview(); const first = ui.get('tgRedeemForm').trigger('submit');
    const finishFirst = await firstStarted;
    ui.get('tgUsername').value = 'another_user'; await ui.get('tgUsername').trigger('input');
    finishFirst(response({ success: true, product_family: 'telegram_premium', term_months: 3, stars_quantity: null })); await first;
    assert.equal(ui.get('tgRedeemConfirmation').hidden, true); assert.equal(ui.posts().length, 0);
    const nextStarted = nextPreview(); const next = ui.get('tgRedeemForm').trigger('submit');
    const finishNext = await nextStarted;
    finishNext(response({ success: true, product_family: 'telegram_premium', term_months: 3, stars_quantity: null })); await next;
    assert.match(ui.get('tgRedeemConfirmation').textContent, /another_user/); assert.equal(ui.posts().length, 0);
    ui.get('tgCode').value = STARS_CODE; await ui.get('tgCode').trigger('input'); assert.equal(ui.get('tgRedeemConfirmation').hidden, true);
});

test('unavailable or malformed previews never allow the second click to submit redemption', async () => {
    for (const data of [{ success: false, message: '兑换码不可用' }, { success: true, product_family: 'telegram_stars', term_months: 3, stars_quantity: 500 }]) {
        const ui = page({ fetch: async () => enabledCatalog(), preview: () => response(data) }); await ui.flush();
        ui.get('tgUsername').value = 'recipient_test'; ui.get('tgCode').value = CODE;
        await ui.get('tgRedeemForm').trigger('submit'); await ui.get('tgRedeemForm').trigger('submit');
        assert.equal(ui.posts().length, 0); assert.equal(ui.get('tgRedeemConfirmation').hidden, true);
    }
});

test('customer close requires confirmation, hides payment instructions while pending and refreshes the resulting state', async () => {
    let closed = false; let finish;
    const ui = page({ fetch: async url => {
        if (url.endsWith('/catalog')) return purchaseCatalog();
        if (url.endsWith('/cancel')) return new Promise(resolve => { finish = () => { closed = true; resolve(response({ success: true })); }; });
        return response({ success: true, order: purchaseOrder(closed ? { payment_status: 'cancelled', can_close: false } : { can_close: true }) });
    } }); await ui.flush();
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit'); assert.equal(ui.get('tgPurchaseClose').hidden, false);
    ui.window.confirm = () => false; await ui.get('tgPurchaseClose').trigger('click'); assert.equal(ui.calls.filter(call => call.url.endsWith('/cancel')).length, 0);
    ui.window.confirm = () => true; const pending = ui.get('tgPurchaseClose').trigger('click'); await ui.flush();
    assert.equal(ui.get('tgPurchaseCheckout').hidden, true); assert.equal(ui.get('tgPurchaseClose').hidden, true);
    await ui.get('tgPurchaseClose').trigger('click'); const calls = ui.calls.filter(call => call.url.endsWith('/cancel')); assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), { order_no: PURCHASE_ORDER }); assert.equal(calls[0].options.headers['X-TG-Status-Token'], 'b'.repeat(64));
    finish(); await pending;
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /订单已关闭/); assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    assert.equal(ui.get('tgPurchaseStatusToken').value, 'b'.repeat(64)); assert.equal(ui.timers.size, 0);
});

test('an unconfirmed close leaves payment instructions hidden and retains recovery credentials', async () => {
    const ui = page({ fetch: async url => {
        if (url.endsWith('/catalog')) return purchaseCatalog();
        if (url.endsWith('/cancel')) throw new Error('lost_response');
        return response({ success: true, order: purchaseOrder({ can_close: true }) });
    } }); await ui.flush();
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'c'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit'); await ui.get('tgPurchaseClose').trigger('click');
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /关闭结果未确认/); assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    assert.equal(ui.get('tgPurchaseOrderNo').value, PURCHASE_ORDER); assert.equal(ui.get('tgPurchaseStatusToken').value, 'c'.repeat(64));
});

test('manual completion overrides a previous receipt sync, stops polling and shows the customer explanation in both order views', async () => {
    let completed = false;
    const note = '已与您核对并完成退款，到账时间以支付平台为准。';
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog()
        : url.endsWith('/quote') ? response({ success: true, quote: purchaseQuote() })
            : url.endsWith('/orders') ? response({ success: true, order: purchaseOrder() })
                : response({ success: true, order: purchaseOrder(completed
                    ? { payment_status: 'paid', fulfillment_status: 'closed', closed_at: new Date().toISOString(), completion_note: note }
                    : {}), payment_sync: { state: 'received', message: '渠道已收款，等待核对' } }) });
    await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
    assert.equal(ui.get('tgPaymentDialog').open, true);
    await ui.get('tgPurchaseStatusForm').trigger('submit'); assert.match(ui.get('tgPaymentStateMessage').textContent, /渠道已收款/);
    completed = true; await ui.get('tgPurchaseStatusForm').trigger('submit');
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /订单已完结/); assert.match(ui.get('tgPurchaseStatusResult').textContent, new RegExp(note));
    assert.equal(ui.get('tgPaymentTitle').textContent, '订单已完结'); assert.equal(ui.get('tgPaymentStateMessage').textContent, '订单已完结');
    assert.match(ui.get('tgPaymentContent').textContent, new RegExp(note)); assert.doesNotMatch(ui.get('tgPaymentContent').textContent, /等待核对|等待发货|暂时无法确认支付状态/);
    assert.equal(ui.get('tgPaymentSteps').hidden, true); assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    assert.equal(ui.get('tgPurchaseClose').hidden, true); assert.equal(ui.get('tgPaymentCancelOrder').hidden, true);
    assert.ok(![...ui.timers.values()].some(timer => [1000, 5000, 15000].includes(timer.ms)), 'completed orders stop payment countdown and polling');
    const stored = [...ui.storage.values.values()].join(''); assert.ok(stored.includes('"completed":true'));
});

test('payment-review completion shows the administrator explanation despite a stale unconfirmed sync and disables payment actions', async () => {
    const note = '经支付渠道核对未发现有效付款，本订单已完结。';
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog()
        : url.endsWith('/quote') ? response({ success: true, quote: purchaseQuote() })
            : url.endsWith('/orders') ? response({ success: true, order: purchaseOrder() })
                : response({ success: true, order: purchaseOrder({ payment_status: 'manual_review', paid_at: null, fulfillment_status: 'closed',
                    closed_at: new Date().toISOString(), completion_note: note }),
                    payment_sync: { state: 'unconfirmed', message: '暂时无法确认支付状态' } }) });
    await ui.flush(); await startStarsPurchase(ui); await ui.get('tgPurchaseConfirm').trigger('click');
    assert.equal(ui.get('tgPaymentDialog').open, true);
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /订单已完结/);
    assert.ok(ui.get('tgPurchaseStatusResult').textContent.includes(note));
    assert.equal(ui.get('tgPaymentTitle').textContent, '订单已完结');
    assert.equal(ui.get('tgPaymentStateMessage').textContent, '订单已完结');
    assert.ok(ui.get('tgPaymentContent').textContent.includes(note));
    assert.doesNotMatch(ui.get('tgPaymentContent').textContent, /暂时无法确认支付状态|等待发货|继续支付/);
    for (const id of ['tgPaymentSteps', 'tgPurchaseCheckout', 'tgPurchaseClose', 'tgPaymentCancelOrder']) assert.equal(ui.get(id).hidden, true);
    assert.ok(![...ui.timers.values()].some(timer => [1000, 5000, 15000].includes(timer.ms)));
    assert.ok([...ui.storage.values.values()].join('').includes('"completed":true'));
});

test('a closed order queried with its original credential has a terminal fallback and no remaining payment actions', async () => {
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog()
        : response({ success: true, order: purchaseOrder({ payment_status: 'manual_review', fulfillment_status: 'closed', closed_at: new Date().toISOString() }) }) });
    await ui.flush(); ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'a'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /订单已完结/); assert.match(ui.get('tgPurchaseStatusResult').textContent, /自动发货已停止/);
    assert.equal(ui.get('tgPurchaseCheckout').hidden, true); assert.equal(ui.get('tgPurchaseClose').hidden, true);
    assert.ok(![...ui.timers.values()].some(timer => [1000, 5000, 15000].includes(timer.ms)));
});

test('closed redemption displays the administrator explanation literally and stops polling', async () => {
    const note = '已完成协商处理，兑换码已作废。<img src=x onerror=alert(1)>';
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? enabledCatalog()
        : response({ success: true, order_no: ORDER, username: 'recipient_test', term_months: 3, status: 'closed', closed_at: '2026-10-17T10:00:00Z', completion_note: note }) });
    await ui.flush(); ui.get('tgOrderNo').value = ORDER; ui.get('tgStatusToken').value = 'a'.repeat(64);
    await ui.get('tgStatusForm').trigger('submit');
    assert.match(ui.get('tgStatusResult').textContent, /订单已完结/); assert.ok(ui.get('tgStatusResult').textContent.includes(`完结说明：${note}`));
    assert.match(ui.get('tgStatusResult').textContent, /完结时间/); assert.equal(ui.timers.size, 0); assert.equal(ui.posts().length, 0);
    assert.equal(ui.get('tgStatusResult').children.at(-1).children.at(-1).children.length, 0, 'public completion note remains literal text');
});

test('an incomplete redemption closure never appears as a confirmed completion', async () => {
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? enabledCatalog()
        : response({ success: true, order_no: ORDER, username: 'recipient_test', term_months: 3, status: 'closed' }) });
    await ui.flush(); ui.get('tgOrderNo').value = ORDER; ui.get('tgStatusToken').value = 'a'.repeat(64);
    await ui.get('tgStatusForm').trigger('submit'); assert.doesNotMatch(ui.get('tgStatusResult').textContent, /订单已完结|Invalid Date/);
});


function descendants(root, predicate) {
    return root.children.flatMap(node => [...(predicate(node) ? [node] : []), ...descendants(node, predicate)]);
}
async function selectOriginalLookup(ui, kind = 'purchase') {
    ui.get('tgOrdersSearchBy').value = 'tracking';
    await ui.get('tgOrdersSearchBy').trigger('change');
    await ui.get(kind === 'purchase' ? 'tgLookupTabPurchase' : 'tgLookupTabRedeem').trigger('click');
}

test('original-token lookup opens details immediately and a late response cannot reopen the closed dialog', async () => {
    let finish;
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog()
        : new Promise(resolve => { finish = resolve; }) });
    await ui.flush(); await selectOriginalLookup(ui);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    const pending = ui.get('tgPurchaseStatusForm').trigger('submit');
    const dialog = ui.get('tgOrderDetailDialog');
    assert.equal(dialog.open, true);
    assert.equal(ui.get('tgOrderDetailNumber').textContent, PURCHASE_ORDER);
    assert.equal(ui.get('tgOrderDetailContent').attributes.get('aria-busy'), 'true');
    assert.equal(ui.get('tgOrderDetailRefresh').disabled, true);
    assert.ok(descendants(ui.get('tgPurchaseStatusResult'), node => node.className.includes('tg-orders-detail-skeleton')).length >= 10);
    assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    await ui.get('tgOrderDetailClose').trigger('click');
    await dialog.trigger('close');
    finish(response({ success: true, order: purchaseOrder() })); await pending;
    assert.equal(dialog.open, false);
    assert.equal(ui.get('tgLegacyOrdersResults').hidden, false);
    assert.equal(ui.get('tgLegacyOrdersList').children[0].className, 'tg-panel tg-orders-order-card');
    assert.equal(ui.get('tgPaymentDialog').open, false);
    assert.equal(ui.calls.filter(call => call.options?.method === 'POST').length, 0);
});

test('changing query method invalidates pending original credentials even after switching back', async () => {
    let finish;
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog()
        : new Promise(resolve => { finish = resolve; }) });
    await ui.flush(); await selectOriginalLookup(ui);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    const pending = ui.get('tgPurchaseStatusForm').trigger('submit');
    ui.get('tgOrdersSearchBy').value = 'email'; await ui.get('tgOrdersSearchBy').trigger('change');
    await selectOriginalLookup(ui);
    finish(response({ success: true, order: purchaseOrder() })); await pending;
    assert.equal(ui.get('tgOrderDetailDialog').open, false);
    assert.equal(ui.get('tgLegacyOrdersResults').hidden, true);
    assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    assert.doesNotMatch(ui.get('tgPurchaseStatusResult').textContent, /recipient_test/);
    assert.equal(ui.timers.size, 0);
});

test('opening another order prevents a stale reply and queued close event from replacing the new details', async () => {
    const secondOrder = 'TGP-ABCDEFGHIJKLMNOPQRST'; let finishFirst;
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog()
        : url.includes(secondOrder) ? response({ success: true, order: purchaseOrder({ order_no: secondOrder, username: 'new_recipient' }) })
            : new Promise(resolve => { finishFirst = resolve; }) });
    await ui.flush(); await selectOriginalLookup(ui);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    const pending = ui.get('tgPurchaseStatusForm').trigger('submit');
    await ui.get('tgOrderDetailClose').trigger('click');
    ui.get('tgPurchaseOrderNo').value = secondOrder; await ui.get('tgPurchaseOrderNo').trigger('input');
    ui.get('tgOrderDetailContent').scrollTop = 300;
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    assert.equal(ui.get('tgOrderDetailContent').scrollTop, 0, 'another order starts at its overview');
    await ui.get('tgOrderDetailDialog').trigger('close');
    finishFirst(response({ success: true, order: purchaseOrder() })); await pending;
    assert.equal(ui.get('tgOrderDetailDialog').open, true);
    assert.equal(ui.get('tgOrderDetailNumber').textContent, secondOrder);
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /new_recipient/);
    assert.doesNotMatch(ui.get('tgPurchaseStatusResult').textContent, /recipient_test/);
    assert.equal(ui.get('tgOrderDetailContent').attributes.get('aria-busy'), 'false');
    assert.equal(ui.get('tgOrderDetailRefresh').disabled, false);
    assert.match(ui.get('tgLegacyOrdersList').textContent, /new_recipient/);
});

test('email results open details first, keep credentials out of URLs, and discard details when credentials change', async () => {
    let finishRefresh;
    let statusCount = 0;
    const order = purchaseOrder();
    const ui = page({ fetch: async url => {
        if (url.endsWith('/catalog')) return purchaseCatalog({ order_query: { enabled: true } });
        if (url.endsWith('/orders/query')) return response({ success: true, kind: 'purchase', page: 1, page_size: 20, total: 1, orders: [order] });
        if (++statusCount === 1) return response({ success: true, order });
        return new Promise(resolve => { finishRefresh = resolve; });
    } });
    await ui.flush();
    ui.get('tgOrdersEmail').value = 'buyer@example.test'; ui.get('tgOrdersPassword').value = 'Query-secret!1';
    await ui.get('tgOrdersQueryForm').trigger('submit');
    const button = descendants(ui.get('tgOrdersList'), node => node.tagName === 'BUTTON')[0];
    await button.trigger('click');
    assert.equal(ui.get('tgOrderDetailDialog').open, true);
    assert.equal(ui.get('tgPaymentDialog').open, false);
    const statusCall = ui.calls.find(call => call.url.includes('/purchase/status?'));
    assert.ok(statusCall.options.headers['X-TG-Order-Credential']);
    assert.ok(!statusCall.url.includes('buyer') && !statusCall.url.includes('Query-secret'));
    assert.equal(statusCall.options.headers['X-TG-Status-Token'], undefined);
    assert.equal(ui.get('tgPurchaseCopyTracking').hidden, true);
    await ui.get('tgPurchaseCheckout').trigger('click');
    assert.equal(ui.get('tgPaymentDialog').open, true);
    await ui.get('tgPaymentClose').trigger('click'); await ui.get('tgPaymentDialog').trigger('close');
    assert.equal(ui.get('tgOrderLookupPage').hidden, false);
    assert.equal(ui.get('tgOrderDetailDialog').open, true);
    const refresh = ui.get('tgOrderDetailRefresh').trigger('click');
    ui.get('tgOrdersEmail').value = 'other@example.test'; await ui.get('tgOrdersEmail').trigger('input');
    finishRefresh(response({ success: true, order })); await refresh;
    assert.equal(ui.get('tgOrderDetailDialog').open, false);
    assert.equal(ui.get('tgPurchaseStatusResult').hidden, true);
    assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    assert.equal(ui.get('tgOrdersResults').hidden, true);
    await button.trigger('click');
    assert.equal(statusCount, 2, 'a detached card cannot reuse the previous account credentials');
});

test('detail dialogs close on Escape or a deliberate backdrop click and preserve inside-to-outside drags', async () => {
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? enabledCatalog()
        : response({ success: true, order_no: ORDER, username: 'recipient_test', term_months: 3, status: 'succeeded' }) });
    await ui.flush(); await selectOriginalLookup(ui, 'redeem');
    ui.get('tgOrderNo').value = ORDER; ui.get('tgStatusToken').value = 'a'.repeat(64);
    await ui.get('tgStatusForm').trigger('submit');
    const dialog = ui.get('tgOrderDetailDialog');
    await dialog.trigger('pointerdown', { target: dialog, button: 0, clientX: 200, clientY: 200 });
    await dialog.trigger('click', { target: dialog, clientX: 40, clientY: 40 });
    assert.equal(dialog.open, true, 'selecting text and releasing outside must not dismiss details');
    await dialog.trigger('pointerdown', { target: dialog, button: 0, clientX: 40, clientY: 40 });
    await dialog.trigger('click', { target: dialog, clientX: 40, clientY: 40 });
    assert.equal(dialog.open, false);
    await ui.get('tgStatusForm').trigger('submit');
    await dialog.trigger('cancel');
    assert.equal(dialog.open, false);
});

test('shared order cards distinguish payment from delivery and never label a CNY price as USDT', async () => {
    const ui = page({ fetch: async () => enabledCatalog() }); await ui.flush();
    const makeCard = order => ui.window.TgOrderQuery.createCard({ order, onOpen: async () => {} });
    const card = makeCard(purchaseOrder({ payment_channel: 'usdt_bep20', payment_status: 'paid', fulfillment_status: 'manual_review', crypto_checkout: { pay_amount: '2.345678', pay_currency: 'usdttrc20' } }));
    assert.match(card.textContent, /已付款正在人工复核/);
    assert.match(card.textContent, /TRON \(TRC20\)/);
    assert.match(card.textContent, /2\.3457 USDT/);
    const unknownAmount = makeCard(purchaseOrder({ payment_channel: 'usdt_bep20' }));
    assert.match(unknownAmount.textContent, /USDT 金额见详情/);
    assert.doesNotMatch(unknownAmount.textContent, /1\.26 USDT/);
});

test('USDT orders without historical checkout records show missing data instead of waiting for a channel', async () => {
    const states = [
        { payment_status: 'manual_review', fulfillment_status: 'closed', closed_at: '2026-10-17T11:11:17.131Z', completion_note: '管理员已核对并完结此订单。' },
        { payment_status: 'pending', fulfillment_status: 'closed', closed_at: '2026-10-17T11:11:17.131Z' },
        { payment_status: 'manual_review', fulfillment_status: 'not_started' },
        { payment_status: 'paid', fulfillment_status: 'succeeded' },
        { payment_status: 'expired', fulfillment_status: 'not_started' },
        { payment_status: 'cancelled', fulfillment_status: 'not_started' },
        { payment_status: 'failed', fulfillment_status: 'not_started' }
    ];
    for (const state of states) {
        const order = purchaseOrder({ subtotal_minor: 1400, payment_channel: 'usdt_bep20', ...state });
        const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, order }) });
        await ui.flush(); await selectOriginalLookup(ui);
        ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
        await ui.get('tgPurchaseStatusForm').trigger('submit');
        assert.equal(ui.get('tgOrderDetailDialog').open, true);
        assert.match(ui.get('tgPurchaseStatusResult').textContent, /未记录 USDT 金额/);
        assert.match(ui.get('tgPurchaseStatusResult').textContent, /未记录网络协议/);
        assert.doesNotMatch(ui.get('tgPurchaseStatusResult').textContent, /USDT 金额待渠道确认|网络待确认|14\.14 USDT/);
        assert.match(ui.get('tgLegacyOrdersList').textContent, /未记录 USDT 金额/);
        assert.doesNotMatch(ui.get('tgLegacyOrdersList').textContent, /USDT 金额见详情|14\.14 USDT/);
        assert.equal(ui.get('tgPurchaseCheckout').hidden, true);
    }
});

test('a payable USDT order still distinguishes an unfinished checkout from missing historical data', async () => {
    const order = purchaseOrder({ payment_channel: 'usdt_bep20', checkout_url: null });
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, order }) });
    await ui.flush(); await selectOriginalLookup(ui);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /USDT 金额待渠道确认/);
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /网络待确认/);
    assert.doesNotMatch(ui.get('tgPurchaseStatusResult').textContent, /未记录/);
    assert.match(ui.get('tgLegacyOrdersList').textContent, /USDT 金额见详情/);
    const savedCard = ui.window.TgOrderQuery.createCard({ order: { order_no: PURCHASE_ORDER, payment_channel: 'usdt_bep20', total_minor: order.total_minor }, onOpen: async () => {} });
    assert.match(savedCard.textContent, /USDT 金额见详情/);
    assert.doesNotMatch(savedCard.textContent, /未记录 USDT 金额/);
});

test('closed USDT order details and cards retain the recorded channel amount and network', async () => {
    const order = purchaseOrder({ payment_channel: 'usdt_bep20', payment_status: 'manual_review', fulfillment_status: 'closed', closed_at: '2026-10-17T11:11:17.131Z',
        crypto_payment: { pay_amount: '2.345678', pay_currency: 'usdtton', network: 'TON' } });
    const ui = page({ fetch: async url => url.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, order }) });
    await ui.flush(); await selectOriginalLookup(ui);
    ui.get('tgPurchaseOrderNo').value = PURCHASE_ORDER; ui.get('tgPurchaseStatusToken').value = 'b'.repeat(64);
    await ui.get('tgPurchaseStatusForm').trigger('submit');
    for (const id of ['tgPurchaseStatusResult', 'tgLegacyOrdersList']) {
        assert.match(ui.get(id).textContent, /2\.3457 USDT/);
        assert.match(ui.get(id).textContent, /TON/);
        assert.doesNotMatch(ui.get(id).textContent, /未记录|待渠道确认|金额见详情|网络待确认/);
    }
});

test('historical USDT details backfill the list amount without persisting payment credentials', async () => {
    const savedStorage = storage();
    const statusToken = 'a'.repeat(64);
    const order = purchaseOrder({
        ...pricing.breakdown(124, 'usdt_bep20'),
        payment_channel: 'usdt_bep20',
        payment_status: 'paid',
        fulfillment_status: 'manual_review',
        crypto_payment: { network: 'BSC (BEP20)', pay_currency: 'usdtbsc', pay_amount: '1.234567890123456789' }
    });
    savedStorage.setItem('tg.purchase.attempts.v1', JSON.stringify([{
        fingerprint: 'b'.repeat(64), statusToken, idempotencyKey: `tg_buy_${'c'.repeat(64)}`, orderNo: PURCHASE_ORDER,
        request: { product_id: 'stars', quote_id: QUOTE_ID, product_family: 'telegram_stars', term_months: null, stars_quantity: 100,
            username: 'recipient_test', channel: 'usdt_bep20', expected_total_minor: order.total_minor, subtotal_minor: order.subtotal_minor,
            payment_fee_minor: order.payment_fee_minor, payment_fee_rate_bps: order.payment_fee_rate_bps, price_version: order.price_version }
    }]));
    const fetch = async url => url.endsWith('/catalog') ? purchaseCatalog({ payment_channels: [{ id: 'usdt_bep20' }], usdt_per_cny: '0.14' })
        : response({ success: true, order });
    const ui = page({ fetch, savedStorage }); await ui.flush();
    assert.match(ui.get('tgRecentPurchaseList').textContent, /1\.2346 USDT/);
    const stored = JSON.parse(savedStorage.values.get('tg.purchase.attempts.v1'))[0];
    assert.equal(stored.request.usdt_pay_amount, '1.234567890123456789');
    assert.equal(stored.request.pay_currency, 'usdtbsc');
    for (const field of ['pay_address', 'payment_id', 'payin_extra_id']) assert.equal(Object.hasOwn(stored.request, field), false);

    const reloaded = page({ fetch, savedStorage }); await reloaded.flush();
    assert.match(reloaded.get('tgRecentPurchaseList').textContent, /1\.2346 USDT/);
});


test('clearing query credentials defeats browser form restoration on reload and back navigation', async () => {
    const ui = page({ fetch: async () => purchaseCatalog({ order_query: { enabled: true } }) }); await ui.flush();
    const ids = ['tgOrdersEmail', 'tgOrdersPassword', 'tgOrdersOrderNo', 'tgOrderNo', 'tgStatusToken', 'tgPurchaseOrderNo', 'tgPurchaseStatusToken'];
    for (const id of ids) ui.get(id).value = 'old-query-value';
    await ui.get('tgOrdersClear').trigger('click');
    for (const id of ids) assert.equal(ui.get(id).value, '', id);
    // Browsers restore values after initialization and again on bfcache return.
    for (const persisted of [false, true]) {
        for (const id of ids) ui.get(id).value = 'browser-restored-value';
        ui.windowEvents.get('pageshow')({ persisted });
        for (const id of ids) assert.equal(ui.get(id).value, '', id);
    }
    assert.equal(ui.get('tgOrdersPassword').type, 'password');
    assert.equal(ui.get('tgOrdersTogglePassword').attributes.get('aria-pressed'), 'false');
    const html = fs.readFileSync(require.resolve('../tg.html'), 'utf8');
    assert.match(html, /id="tgOrdersPassword"[^>]*autocomplete="new-password"/);
});

test('clear then reload preserves saved orders without silently restoring the previous query', async () => {
    const savedStorage = storage();
    const attempt = {
        fingerprint: 'b'.repeat(64), statusToken: 'a'.repeat(64), idempotencyKey: `tg_buy_${'c'.repeat(64)}`, orderNo: PURCHASE_ORDER,
        request: { product_id: 'stars', username: 'recipient_test', product_family: 'telegram_stars', stars_quantity: 100, channel: 'alipay', expected_total_minor: purchaseOrder().total_minor, price_version: 3 }
    };
    savedStorage.setItem('tg.purchase.attempts.v1', JSON.stringify([attempt]));
    const fetch = async url => url.endsWith('/catalog') ? purchaseCatalog() : response({ success: true, order: purchaseOrder() });
    const ui = page({ fetch, savedStorage }); await ui.flush();
    assert.equal(ui.get('tgPurchaseOrderNo').value, PURCHASE_ORDER);
    await ui.get('tgOrdersClear').trigger('click');
    const reloaded = page({ fetch, savedStorage }); await reloaded.flush();
    for (const id of ['tgOrdersEmail', 'tgOrdersPassword', 'tgOrdersOrderNo', 'tgPurchaseOrderNo', 'tgPurchaseStatusToken']) assert.equal(reloaded.get(id).value, '', id);
    assert.equal(reloaded.calls.filter(call => call.url.includes('/purchase/status')).length, 0);
    assert.equal(JSON.parse(savedStorage.getItem('tg.purchase.attempts.v1'))[0].orderNo, PURCHASE_ORDER);
    assert.match(reloaded.get('tgRecentPurchaseList').textContent, new RegExp(PURCHASE_ORDER));
    const button = descendants(reloaded.get('tgRecentPurchaseList'), node => node.tagName === 'BUTTON')[0];
    await button.trigger('click');
    assert.equal(reloaded.get('tgOrderDetailDialog').open, true);
    assert.equal(reloaded.get('tgPurchaseOrderNo').value, PURCHASE_ORDER);
    assert.equal(reloaded.calls.filter(call => call.url.includes('/purchase/status')).length, 1);
});

test('pageshow clears browser-restored email fields without cancelling a restored order request', async () => {
    const savedStorage = storage();
    savedStorage.setItem('tg.purchase.attempts.v1', JSON.stringify([{
        fingerprint: 'b'.repeat(64), statusToken: 'a'.repeat(64), idempotencyKey: `tg_buy_${'c'.repeat(64)}`, orderNo: PURCHASE_ORDER,
        request: { product_id: 'stars', username: 'recipient_test', product_family: 'telegram_stars', stars_quantity: 100, channel: 'alipay', expected_total_minor: purchaseOrder().total_minor, price_version: 3 }
    }]));
    let finishStatus;
    const ui = page({ savedStorage, fetch: async url => url.endsWith('/catalog') ? purchaseCatalog() : new Promise(resolve => { finishStatus = resolve; }) });
    await ui.flush();
    ui.get('tgOrdersEmail').value = 'restored@example.test'; ui.get('tgOrdersPassword').value = 'old-secret';
    ui.windowEvents.get('pageshow')({ persisted: false });
    assert.equal(ui.get('tgOrdersEmail').value, ''); assert.equal(ui.get('tgOrdersPassword').value, '');
    finishStatus(response({ success: true, order: purchaseOrder() })); await ui.flush();
    assert.equal(ui.get('tgPurchaseOrderNo').value, PURCHASE_ORDER);
    assert.match(ui.get('tgPurchaseStatusResult').textContent, /recipient_test/);
    ui.get('tgOrdersEmail').value = 'buyer@example.test'; ui.get('tgOrdersPassword').value = 'Query-secret!1';
    ui.windowEvents.get('pagehide')({ persisted: true });
    assert.equal(ui.get('tgOrdersEmail').value, ''); assert.equal(ui.get('tgOrdersPassword').value, '');
});


test('initial catalog loading reserves the purchase layout and cannot show a disabled business state or submit a quote', async () => {
    let finishCatalog;
    const ui = page({ fetch: async () => new Promise(resolve => { finishCatalog = resolve; }) });
    assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'loading');
    assert.equal(ui.get('tgPurchaseForm').attributes.get('aria-busy'), 'true');
    for (const id of ['tgPurchaseProductCards', 'tgPurchaseChannelCards', 'tgPurchasePrice', 'tgPurchaseButton']) {
        assert.doesNotMatch(ui.get(id).textContent, /待公布|未开放|暂未/);
    }
    assert.equal(ui.get('tgPurchaseProductCards').children.length, 3);
    assert.equal(ui.get('tgPurchaseChannelCards').children.length, 2);
    assert.equal(ui.get('tgPurchasePrice').children.length, 3);
    assert.equal(ui.get('tgPurchaseButton').disabled, true);
    await ui.get('tgPurchaseForm').trigger('submit');
    assert.equal(ui.calls.length, 1);
    finishCatalog(purchaseCatalog()); await ui.flush();
    assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'ready');
    assert.equal(ui.get('tgPurchaseForm').attributes.get('aria-busy'), 'false');
    assert.equal(purchaseAmount(ui), '¥131.29');
    assert.equal(ui.get('tgPurchaseButton').disabled, false);
});

test('catalog HTTP and transport failures expose a retry action that locks duplicate retries until ready', async () => {
    for (const failure of ['http', 'transport']) {
        let attempts = 0; let finishRetry;
        const ui = page({ fetch: async () => {
            if (++attempts > 1) return new Promise(resolve => { finishRetry = resolve; });
            if (failure === 'transport') throw new Error('offline');
            return response({ success: false }, 503);
        } });
        await ui.flush();
        assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'error');
        assert.equal(ui.get('tgPurchaseForm').attributes.get('aria-busy'), 'false');
        assert.equal(ui.get('tgPurchaseButton').disabled, false);
        assert.equal(ui.get('tgPurchaseButton').textContent, '重新加载');
        assert.equal(ui.get('tgPurchaseButton').formNoValidate, true);
        assert.match(ui.get('tgPurchaseMessage').textContent, /暂时无法连接购买服务/);
        assert.doesNotMatch(ui.get('tgPurchasePrice').textContent, /待公布|未开放/);
        const pendingRetry = ui.get('tgPurchaseForm').trigger('submit');
        assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'loading');
        assert.equal(ui.get('tgPurchaseButton').disabled, true);
        await ui.get('tgPurchaseForm').trigger('submit');
        assert.equal(attempts, 2);
        finishRetry(purchaseCatalog()); await pendingRetry;
        assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'ready');
        assert.equal(ui.get('tgPurchaseButton').disabled, false);
        assert.equal(ui.get('tgPurchaseButton').formNoValidate, false);
        assert.equal(ui.get('tgPurchaseMessage').textContent, '');
        assert.equal(ui.calls.filter(call => /quote|orders/.test(call.url)).length, 0);
    }
});

test('a catalog that explicitly disables purchases retains the real closed state after loading', async () => {
    const ui = page({ fetch: async () => purchaseCatalog({ purchase_enabled: false, payment_channels: [], sale_products: [] }) });
    await ui.flush();
    assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'ready');
    assert.equal(ui.get('tgPurchaseButton').disabled, true);
    assert.equal(ui.get('tgPurchaseButton').textContent, '购买服务暂未开放');
    assert.equal(ui.get('tgPurchasePrice').textContent, '价格暂未公布');
});

test('background FX catalog refresh keeps the current prices through a failed request and clears the error on recovery', async () => {
    let attempts = 0; let failRefresh;
    const catalog = { usdt_fx_mode: 'market' };
    const ui = page({ fetch: async () => ++attempts === 2
        ? new Promise((resolve, reject) => { failRefresh = reject; }) : purchaseCatalog(catalog) });
    await ui.flush();
    const previousAmount = ui.get('tgPurchasePrice').textContent;
    const refreshTimer = () => Array.from(ui.timers.values()).find(timer => timer.ms === 300000);
    const pendingRefresh = refreshTimer().fn(); await ui.flush();
    assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'ready');
    assert.equal(ui.get('tgPurchasePrice').textContent, previousAmount);
    failRefresh(new Error('offline')); await pendingRefresh;
    assert.equal(ui.get('tgPurchaseForm').dataset.catalogState, 'ready');
    assert.equal(ui.get('tgPurchasePrice').textContent, previousAmount);
    assert.match(ui.get('tgPurchaseMessage').textContent, /暂时无法更新售价/);
    await refreshTimer().fn();
    assert.equal(ui.get('tgPurchaseMessage').textContent, '');
    assert.equal(ui.get('tgPurchasePrice').textContent, previousAmount);
});
