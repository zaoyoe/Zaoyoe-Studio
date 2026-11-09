'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../js/shop-client.js'), 'utf8');
const start = source.indexOf('    requestPurchasePassword: function () {');
const end = source.indexOf('    init: async function', start);
assert.ok(start > 0 && end > start);
const methodsSource = `({${source.slice(start, end)}})`;
const challenge = { success: false, code: 'step_up_confirmation_required', requiresConfirmation: true, purchaseNotStarted: true };
function reply(status, payload) { return { status, ok: status >= 200 && status < 300, json: async () => payload }; }

function purchaseHarness({ responses = [], confirmation = { password: 'private-password', captchaToken: 'fresh-captcha' }, switchAt = 0 } = {}) {
    const sent = [], journalWrites = [], cleared = [];
    let contextReads = 0, prompts = 0, restored = 0;
    const journal = { read: () => null, begin: (...input) => journalWrites.push(input), clear: key => cleared.push(key) };
    const context = { window: { SiteConfig: { site: 'cn' } }, fetch: async (url, options) => {
        sent.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        if (sent.length === 1) return reply(200, { success: true, recoverySource: 'supplier_v2' });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
    } };
    const client = vm.runInNewContext(methodsSource, context);
    Object.assign(client, {
        currentPurchase: {}, isEnglishShopLocale: () => false, getAccessToken: async () => 'test-access-token',
        createPurchaseIdempotencyKey: () => 'fixed-idempotency',
        getPointsPurchaseJournal: async () => ({ actorId: ++contextReads === switchAt ? 'different-user' : 'current-user', site: 'cn', journal }),
        requestPurchasePassword: async () => { prompts++; return confirmation; },
        normalizeShopRequestError: error => error,
        restorePendingPointsPurchase: async () => { restored++; }
    });
    return { client, sent, journalWrites, cleared, get prompts() { return prompts; }, get restored() { return restored; } };
}
const purchase = { productId: 'test-product', quantity: 20, site: 'cn', idempotencyKey: 'same-purchase-key' };

test('purchase challenge retries once with the same actor, source and idempotency key without journaling credentials', async () => {
    const harness = purchaseHarness({ responses: [reply(403, challenge), reply(200, { success: true, data: { order_id: 'order-test' } })] });
    const result = await harness.client.requestPurchasePayloadWithServer(purchase, 'test-access-token');
    assert.equal(result.data.order_id, 'order-test');
    assert.equal(harness.sent.length, 3);
    assert.equal(harness.prompts, 1);
    const [first, retry] = harness.sent.slice(1);
    assert.equal(first.body.confirmPassword, undefined);
    assert.equal(retry.body.confirmPassword, 'private-password');
    assert.equal(retry.body.captchaToken, 'fresh-captcha');
    for (const request of [first, retry]) {
        assert.equal(request.body.idempotencyKey, purchase.idempotencyKey);
        assert.equal(request.headers['X-Idempotency-Key'], purchase.idempotencyKey);
        assert.equal(request.body.recoverySource, 'supplier_v2');
        assert.equal(request.body.site, 'cn');
    }
    assert.equal(harness.journalWrites.length, 1);
    assert.ok(!JSON.stringify(harness.journalWrites).includes('private-password'));
    assert.ok(!JSON.stringify(harness.journalWrites).includes('fresh-captcha'));
    assert.deepEqual(harness.cleared, [purchase.idempotencyKey]);
});

test('cancelling password confirmation does not retry and clears only a definitely unstarted purchase journal', async () => {
    const harness = purchaseHarness({ responses: [reply(403, challenge)], confirmation: '' });
    await assert.rejects(harness.client.requestPurchasePayloadWithServer(purchase), error => error.code === challenge.code && error.purchaseOutcomeUnknown === false);
    assert.equal(harness.sent.length, 2);
    assert.equal(harness.prompts, 1);
    assert.deepEqual(harness.cleared, [purchase.idempotencyKey]);
});

test('account switch after password entry blocks the retry', async () => {
    const harness = purchaseHarness({ responses: [reply(403, challenge)], switchAt: 3 });
    await assert.rejects(harness.client.requestPurchasePayloadWithServer(purchase), /账号或站点已切换/);
    assert.equal(harness.sent.length, 2);
    assert.equal(harness.prompts, 1);
});

test('network uncertainty never triggers another purchase request and preserves recovery state', async () => {
    for (const responses of [[new Error('connection reset')], [reply(403, challenge), new Error('lost post-commit response')]]) {
        const harness = purchaseHarness({ responses });
        await assert.rejects(harness.client.requestPurchasePayloadWithServer(purchase), error => error.purchaseOutcomeUnknown === true);
        assert.ok(harness.sent.length <= 3);
        assert.deepEqual(harness.cleared, []);
        assert.equal(harness.restored, 1);
    }
});

test('only an explicit unstarted password challenge opens the password dialog, with at most one retry', async () => {
    for (const response of [reply(403, { ...challenge, purchaseNotStarted: undefined }), reply(403, { ...challenge, code: 'csrf_origin_rejected' }), reply(500, challenge)]) {
        const harness = purchaseHarness({ responses: [response] });
        await assert.rejects(harness.client.requestPurchasePayloadWithServer(purchase));
        assert.equal(harness.prompts, 0);
        assert.equal(harness.sent.length, 2);
    }
    const repeated = purchaseHarness({ responses: [reply(403, challenge), reply(403, challenge)] });
    await assert.rejects(repeated.client.requestPurchasePayloadWithServer(purchase));
    assert.equal(repeated.prompts, 1);
    assert.equal(repeated.sent.length, 3);
});

function dialogHarness({ captcha = true, mount } = {}) {
    const elements = [], windowEvents = new Map(), removedWidgets = [];
    let widgetOptions;
    function element(tag) {
        const e = { tag, value: '', children: [], events: {}, attributes: {},
            append(...nodes) { this.children.push(...nodes); },
            addEventListener(type, callback) { this.events[type] = callback; },
            setAttribute(key, value) { this.attributes[key] = value; },
            showModal() { this.shown = true; }, focus() {}, remove() { this.removed = true; }
        };
        elements.push(e); return e;
    }
    const window = {
        addEventListener(type, callback) { windowEvents.set(type, callback); },
        removeEventListener(type) { windowEvents.delete(type); },
        turnstile: { remove(id) { removedWidgets.push(id); } },
        ZaoyoeSecurity: { isTurnstileEnabled: () => captcha, mountTurnstile(container, options) { widgetOptions = options; return mount ? mount(options) : 'fresh-widget'; } }
    };
    const client = vm.runInNewContext(methodsSource, { document: { createElement: element, body: { append() {} } }, window });
    client.isEnglishShopLocale = () => false;
    const promise = client.requestPurchasePassword();
    const find = tag => elements.find(e => e.tag === tag);
    return { elements, find, promise, windowEvents, removedWidgets, get widgetOptions() { return widgetOptions; },
        submit() { find('form').events.submit({ preventDefault() {} }); },
        cancel() { find('dialog').events.cancel({ preventDefault() {} }); }
    };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('password dialog requires a fresh CAPTCHA token and clears the password, widget and pagehide listener on success', async () => {
    const h = dialogHarness();
    await flush();
    const input = h.find('input'), button = h.elements.find(e => e.tag === 'button' && e.type === 'submit');
    input.value = '  private-password  ';
    assert.equal(button.disabled, true);
    h.submit();
    assert.equal(h.find('dialog').removed, undefined);
    h.widgetOptions.callback('new-captcha-token');
    assert.equal(button.disabled, false);
    h.submit();
    const result = await h.promise;
    assert.equal(result.password, '  private-password  ');
    assert.equal(result.captchaToken, 'new-captcha-token');
    assert.equal(input.value, '');
    assert.equal(h.find('dialog').removed, true);
    assert.equal(h.windowEvents.size, 0);
    assert.deepEqual(h.removedWidgets, ['fresh-widget']);
});

test('CAPTCHA expiry/error cannot be bypassed by form submission, while cancel still cleans up', async () => {
    for (const event of ['onExpired', 'onError']) {
        const h = dialogHarness(); await flush();
        h.find('input').value = 'private-password';
        h.widgetOptions.callback('valid-token');
        h.widgetOptions[event](); h.submit();
        assert.equal(h.find('dialog').removed, undefined);
        assert.match(h.find('p').textContent, /安全验证暂不可用/);
        h.cancel();
        assert.equal(await h.promise, '');
        assert.equal(h.find('input').value, '');
        assert.equal(h.windowEvents.size, 0);
    }
});

test('late CAPTCHA widget resolution after cancellation removes the widget and cannot revive the dialog', async () => {
    let finishMount;
    const h = dialogHarness({ mount: () => new Promise(resolve => { finishMount = resolve; }) });
    await flush();
    h.find('input').value = 'private-password';
    h.cancel();
    assert.equal(await h.promise, '');
    finishMount('late-widget'); await flush();
    assert.deepEqual(h.removedWidgets, ['late-widget']);
    h.widgetOptions.callback('late-token');
    assert.equal(h.find('input').value, '');
    assert.equal(h.find('dialog').removed, true);
});

test('CAPTCHA mount failure keeps submission blocked and pagehide cancels without retaining a password', async () => {
    for (const mount of [() => null, () => { throw new Error('script failed'); }]) {
        const h = dialogHarness({ mount }); await flush();
        h.find('input').value = 'private-password'; h.submit();
        assert.equal(h.find('dialog').removed, undefined);
        assert.match(h.find('p').textContent, /安全验证暂不可用/);
        h.windowEvents.get('pagehide')();
        assert.equal(await h.promise, '');
        assert.equal(h.find('input').value, '');
        assert.equal(h.windowEvents.size, 0);
    }
});
