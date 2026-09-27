const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_PATH = path.resolve(__dirname, '../js/guest-shop-client.js');
const CLIENT_SOURCE = fs.readFileSync(CLIENT_PATH, 'utf8');
const QR_PATH = path.resolve(__dirname, '../js/vendor/qrcode-generator-2.0.4.js');
const QR_SOURCE = fs.readFileSync(QR_PATH, 'utf8');
const STORAGE_KEY = 'guest_shop_checkout_v1';
const FUTURE_EXPIRY = '2099-01-01T00:00:00.000Z';

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(...tokens) {
        tokens.filter(Boolean).forEach((token) => this.values.add(token));
    }

    remove(...tokens) {
        tokens.filter(Boolean).forEach((token) => this.values.delete(token));
    }

    contains(token) {
        return this.values.has(token);
    }

    toggle(token, force) {
        if (force === true) {
            this.values.add(token);
            return true;
        }
        if (force === false) {
            this.values.delete(token);
            return false;
        }
        if (this.values.has(token)) {
            this.values.delete(token);
            return false;
        }
        this.values.add(token);
        return true;
    }
}

class FakeElement {
    constructor(ownerDocument, tagName = 'div', id = '') {
        this.ownerDocument = ownerDocument;
        this.tagName = String(tagName).toUpperCase();
        this.id = id;
        this.dataset = {};
        this.classList = new FakeClassList();
        this.children = [];
        this.parentElement = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.value = '';
        this.type = '';
        this.title = '';
        this.src = '';
        this.isConnected = true;
        this._textContent = '';
    }

    set textContent(value) {
        this._textContent = String(value ?? '');
        this.children = [];
    }

    get textContent() {
        if (this.children.length > 0) {
            return this.children.map((child) => child.textContent).join('');
        }
        return this._textContent;
    }

    get selectedOptions() {
        if (this.tagName !== 'SELECT') return [];
        const selected = this.children.find((child) => child.selected === true);
        return selected ? [selected] : this.children.slice(0, 1);
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    // Element.append is what the payment capsules use. ParentNode.append also
    // accepts strings; keep that so a later label tweak does not break the fixture.
    append(...nodes) {
        nodes.forEach((node) => {
            if (node == null) return;
            if (typeof node === 'string' || typeof node === 'number') {
                const text = this.ownerDocument.createElement('#text');
                text.textContent = String(node);
                this.appendChild(text);
                return;
            }
            if (node.parentElement && node.parentElement !== this) node.remove();
            this.appendChild(node);
        });
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        }
        this.parentElement = null;
        this.isConnected = false;
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(String(name));
        if (name === 'src') this.src = '';
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatch(type, target = this) {
        const event = {
            type,
            target,
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            }
        };
        for (const listener of this.listeners.get(type) || []) listener(event);
        return event;
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (matchesSelector(current, selector)) return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelectorAll(selector) {
        const result = [];
        const visit = (node) => {
            for (const child of node.children) {
                if (matchesSelector(child, selector)) result.push(child);
                visit(child);
            }
        };
        visit(this);
        return result;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    select() {}
}

function matchesSelector(element, selector) {
    return String(selector)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .some((part) => {
            if (part.startsWith('#')) return element.id === part.slice(1);
            if (part.startsWith('.')) return element.classList.contains(part.slice(1));
            if (part === '[data-pw-check]') return Boolean(element.dataset.pwCheck);
            const roleMatch = part.match(/^\[role="([^"]+)"\]$/u);
            if (roleMatch) return element.getAttribute('role') === roleMatch[1];
            const paymentKeyMatch = part.match(/^\[data-payment-key="([^"]+)"\]$/u);
            if (paymentKeyMatch) return element.dataset.paymentKey === paymentKeyMatch[1];
            return element.tagName.toLowerCase() === part.toLowerCase();
        });
}

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
    return {
        getItem(key) {
            return values.has(String(key)) ? values.get(String(key)) : null;
        },
        setItem(key, value) {
            values.set(String(key), String(value));
        },
        removeItem(key) {
            values.delete(String(key));
        },
        snapshot(key) {
            const value = values.get(String(key));
            return value === undefined ? null : JSON.parse(value);
        }
    };
}

function createScheduler() {
    let nextId = 1;
    const scheduled = new Map();
    return {
        setTimeout(handler, delay = 0) {
            const id = nextId++;
            scheduled.set(id, { handler, delay, interval: false });
            return id;
        },
        clearTimeout(id) {
            scheduled.delete(id);
        },
        setInterval(handler, delay = 0) {
            const id = nextId++;
            scheduled.set(id, { handler, delay, interval: true });
            return id;
        },
        clearInterval(id) {
            scheduled.delete(id);
        },
        async runImmediateTimers() {
            while (true) {
                const next = [...scheduled.entries()].find(([, task]) => !task.interval && task.delay <= 0);
                if (!next) return;
                const [id, task] = next;
                scheduled.delete(id);
                await task.handler();
            }
        },
        snapshot() {
            return [...scheduled.values()].map((task) => ({
                delay: task.delay,
                interval: task.interval
            }));
        }
    };
}

function createRuntime({
    fetchImpl,
    purchase,
    storageInitial = {},
    sessionStorageUnavailable = false,
    locationHref = 'https://www.fatherkey.com/shop.html',
    confirmImpl = () => true,
    ackFailuresRemaining = 0,
    ackFailureDeferred = null
}) {
    const elements = new Map();
    const scheduler = createScheduler();
    const sessionStorage = createStorage(storageInitial);
    const replacedUrls = [];
    const confirmMessages = [];
    const checkoutActions = [];
    let uuidSequence = 0;
    let checkoutIntent = null;

    const guestFetch = async (url, options = {}) => {
        const parsed = new URL(url, 'https://www.fatherkey.com');
        if (!parsed.pathname.endsWith('/orders') || String(options.method || 'GET').toUpperCase() !== 'POST') {
            return fetchImpl(url, options);
        }
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch (_) { body = {}; }
        const action = String(body.checkoutAction || '').trim().toLowerCase();
        if (!action) return fetchImpl(url, options);
        checkoutActions.push({ action, body });
        if (action === 'inspect') {
            return jsonResponse({ success: true, intent: checkoutIntent || { pending: false } });
        }
        if (action === 'prepare') {
            checkoutIntent = {
                pending: true,
                intent_id: 'ci.racefixtureintentselector000000000001',
                state: 'ready',
                site: String(body.site || 'cn'),
                product_id: String(body.productId || ''),
                sku_id: String(body.skuId || ''),
                quantity: Number(body.quantity || 1),
                provider: String(body.provider || 'zpay'),
                channel: String(body.channel || 'alipay'),
                buyer_credential_required: false,
                contact_required: Boolean(body.email),
                create_deadline_at: FUTURE_EXPIRY,
                expires_at: FUTURE_EXPIRY
            };
            return jsonResponse({ success: true, prepared: true, intent: checkoutIntent });
        }
        if (action === 'ack') {
            if (ackFailuresRemaining > 0) {
                ackFailuresRemaining -= 1;
                if (ackFailureDeferred) return ackFailureDeferred.promise;
                return jsonResponse({
                    success: false,
                    code: 'guest_checkout_intent_unavailable',
                    message: 'temporary acknowledgement failure'
                }, { status: 503 });
            }
            checkoutIntent = null;
            return jsonResponse({ success: true, acknowledged: true });
        }
        return fetchImpl(url, options);
    };

    const document = {
        title: 'Shop',
        readyState: 'complete',
        activeElement: null,
        getElementById(id) {
            const key = String(id);
            if (!elements.has(key)) {
                const tagName = key === 'guestCashPaymentChannel'
                    ? 'select'
                    : (key.includes('Btn') ? 'button' : 'div');
                const node = new FakeElement(document, tagName, key);
                if (key === 'guestCashPurchaseModal') node.hidden = true;
                if (key === 'guestCashQuantity') node.value = '1';
                if (key === 'guestCashOrderPassword') node.type = 'password';
                elements.set(key, node);
            }
            return elements.get(key);
        },
        createElement(tagName) {
            return new FakeElement(document, tagName);
        },
        addEventListener() {},
        execCommand() {
            return true;
        }
    };
    document.body = new FakeElement(document, 'body', 'body');
    document.activeElement = document.body;

    const parsedLocation = new URL(locationHref);
    const location = {
        href: parsedLocation.href,
        origin: parsedLocation.origin
    };
    const navigator = {
        userAgent: 'guest-shop-race-test',
        clipboard: {
            async writeText() {}
        }
    };
    const window = {
        document,
        Element: FakeElement,
        SiteConfig: { site: 'cn' },
        ShopClient: {
            currentPurchase: { ...purchase },
            isEnglishShopLocale() {
                return false;
            }
        },
        location,
        history: {
            replaceState(_state, _title, url) {
                replacedUrls.push(String(url));
            }
        },
        navigator,
        crypto: {
            randomUUID() {
                uuidSequence += 1;
                return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, '0')}`;
            }
        },
        matchMedia() {
            return { matches: false };
        },
        confirm(message) {
            confirmMessages.push(String(message));
            return confirmImpl(message, confirmMessages.length);
        },
        fetch: guestFetch,
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
        setInterval: scheduler.setInterval,
        clearInterval: scheduler.clearInterval,
        URL,
        URLSearchParams,
        navigator,
        console
    };
    if (sessionStorageUnavailable) {
        Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            get() {
                throw new Error('sessionStorage is unavailable');
            }
        });
    } else {
        window.sessionStorage = sessionStorage;
    }
    window.window = window;
    window.globalThis = window;

    const context = vm.createContext(window);
    vm.runInContext(QR_SOURCE, context, { filename: QR_PATH });
    vm.runInContext(CLIENT_SOURCE, context, { filename: CLIENT_PATH });

    return {
        window,
        document,
        sessionStorage,
        replacedUrls,
        confirmMessages,
        element(id) {
            return document.getElementById(id);
        },
        click(id) {
            const modal = document.getElementById('guestCashPurchaseModal');
            if (id === 'guestCashCreateOrderBtn') {
                return clickPaymentOption(this, 'zpay:alipay');
            }
            return modal.dispatch('click', document.getElementById(id));
        },
        runImmediateTimers() {
            return scheduler.runImmediateTimers();
        },
        scheduledTasks() {
            return scheduler.snapshot();
        },
        uuidCount() {
            return uuidSequence;
        },
        checkoutActions() {
            return checkoutActions.slice();
        }
    };
}

function purchase(overrides = {}) {
    return {
        productId: 'product-a',
        productSkuId: 'sku-a',
        productName: 'Product A',
        productNameEn: 'Product A',
        productSkuName: 'SKU A',
        manualDelivery: false,
        soldOut: false,
        ...overrides
    };
}

function contextFor(currentPurchase, site = 'cn') {
    return {
        productId: currentPurchase.productId,
        skuId: currentPurchase.productSkuId,
        site,
        productName: currentPurchase.productName,
        skuName: currentPurchase.productSkuName,
        manualDelivery: currentPurchase.manualDelivery === true,
        soldOut: currentPurchase.soldOut === true,
        contextKey: `${site}:${currentPurchase.productId}:${currentPurchase.productSkuId}`
    };
}

function paymentOption(runtime, key = 'zpay:alipay') {
    const container = runtime.element('guestCashPaymentOptions');
    const option = container.children.find((child) => child.dataset.paymentKey === key)
        || container.children[0];
    assert.ok(option, `payment option ${key} must be rendered`);
    return option;
}

function clickPaymentOption(runtime, key = 'zpay:alipay') {
    const option = paymentOption(runtime, key);
    return option.dispatch('click', option);
}

function previewPayload(currentPurchase) {
    return {
        success: true,
        product: {
            id: currentPurchase.productId,
            sku_id: currentPurchase.productSkuId,
            name: currentPurchase.productName,
            sku_name: currentPurchase.productSkuName
        },
        price: {
            quantity: 1,
            subtotal: 10,
            payable_amount: 10
        },
        payment_channels: ['zpay:alipay'],
        payment_providers: { zpay: { surcharge_rate: 0 } },
        buyer_credential_required: false,
        quantity_cap: 1,
        discount_enabled: false
    };
}

function createOrderPayload(orderNo, currentPurchase = purchase()) {
    return {
        success: true,
        order: {
            order_no: orderNo,
            site: 'cn',
            product_id: currentPurchase.productId,
            sku_id: currentPurchase.productSkuId,
            product_name: currentPurchase.productName,
            sku_name: currentPurchase.productSkuName,
            expires_at: FUTURE_EXPIRY,
            payment_status: 'pending',
            fulfillment_status: 'pending',
        },
        checkout: {
            provider: 'zpay',
            channel: 'alipay',
            qrcode_url: `https://payments.example.test/${orderNo}`
        }
    };
}

function statusPayload(orderNo, currentPurchase = purchase(), overrides = {}) {
    return {
        success: true,
        order: {
            order_no: orderNo,
            site: 'cn',
            product_id: currentPurchase.productId,
            sku_id: currentPurchase.productSkuId,
            product_name: currentPurchase.productName,
            sku_name: currentPurchase.productSkuName,
            provider: 'zpay',
            channel: 'alipay',
            expires_at: FUTURE_EXPIRY,
            payment_status: 'pending',
            fulfillment_status: 'pending',
            refund_status: '',
            ...overrides
        }
    };
}

function batchStatusPayload(orderNo, overrides = {}) {
    return {
        success: true,
        order_no: orderNo,
        site: 'cn',
        total_amount: '0.02',
        payment_status: 'pending',
        fulfillment_status: 'pending',
        expires_at: FUTURE_EXPIRY,
        items: [{ item_index: 0 }, { item_index: 1 }],
        checkout: {
            provider: 'zpay',
            channel: 'alipay',
            checkout_url: `https://payments.example.test/${orderNo}`,
            qrcode_image_url: `https://payments.example.test/${orderNo}/qr.png`
        },
        ...overrides
    };
}

function storedBatch(orderNo, overrides = {}) {
    return {
        version: 3,
        orderNo,
        site: 'cn',
        batchMode: true,
        batchEntries: [
            { productId: 'product-a', skuId: 'sku-a', quantity: 1 },
            { productId: 'product-b', skuId: 'sku-b', quantity: 1 }
        ],
        batchTotal: 0.02,
        expiresAt: FUTURE_EXPIRY,
        provider: 'zpay',
        channel: 'alipay',
        ...overrides
    };
}

function jsonResponse(payload, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        }
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function waitFor(predicate, message = 'condition was not reached') {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(message);
}

async function flushEventLoop(turns = 4) {
    for (let turn = 0; turn < turns; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

async function openCheckout(runtime, currentPurchase) {
    const result = await runtime.window.GuestShopCheckout.startGuestCheckout(contextFor(currentPurchase));
    assert.equal(result.started, true);
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, false);
    // The production modal first inspects the HttpOnly checkout-intent cookie
    // before enabling a new create. Let that non-side-effecting request settle
    // in the VM fixture so old race tests exercise the commit path, not the
    // intentionally disabled inspection state.
    await flushEventLoop();
}

test('a failed provider QR image falls back to a locally generated payment QR', async () => {
    const currentPurchase = purchase();
    const paymentUrl = 'https://payments.example.test/qr-local-fallback';
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const pathname = new URL(url, 'https://www.fatherkey.com').pathname;
            if (pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (pathname.endsWith('/orders')) {
                const payload = createOrderPayload('GUEST-QR-LOCAL', currentPurchase);
                payload.checkout.qrcode_url = paymentUrl;
                payload.checkout.qrcode_image_url = 'https://images.example.test/unavailable.png';
                return jsonResponse(payload);
            }
            if (pathname.endsWith('/status')) return jsonResponse(statusPayload('GUEST-QR-LOCAL', currentPurchase));
            throw new Error(`Unexpected request: ${pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    const image = runtime.element('guestCashZpayQrImage');
    await waitFor(() => image.src === 'https://images.example.test/unavailable.png');
    image.onerror();

    assert.match(image.src, /^data:image\/svg\+xml;charset=utf-8,/);
    assert.match(decodeURIComponent(image.src.split(',')[1]), /<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal(image.hidden, false);
    assert.equal(runtime.element('guestCashZpayQrFallback').hidden, true);
    assert.equal(runtime.element('guestCashZpayQrFallbackLink').hidden, true);

    image.onerror();
    assert.equal(image.hidden, true);
    assert.equal(runtime.element('guestCashZpayQrFallback').hidden, false);
    assert.equal(runtime.element('guestCashZpayQrFallbackLink').hidden, false);
    assert.equal(runtime.element('guestCashZpayQrFallbackLink').href, paymentUrl);
});

test('a payment URL without a provider image renders a local QR immediately', async () => {
    const currentPurchase = purchase();
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const pathname = new URL(url, 'https://www.fatherkey.com').pathname;
            if (pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (pathname.endsWith('/orders')) return jsonResponse(createOrderPayload('GUEST-QR-DIRECT', currentPurchase));
            if (pathname.endsWith('/status')) return jsonResponse(statusPayload('GUEST-QR-DIRECT', currentPurchase));
            throw new Error(`Unexpected request: ${pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    const image = runtime.element('guestCashZpayQrImage');
    await waitFor(() => image.src.startsWith('data:image/svg+xml'));
    assert.equal(image.hidden, false);
    assert.equal(runtime.element('guestCashZpayQrFallbackLink').hidden, true);
});

test('a changed server quote requires a fresh click before prepare or commit', async () => {
    const currentPurchase = purchase();
    let previewCount = 0;
    let price = 10;
    const actions = [];
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                previewCount += 1;
                const payload = previewPayload(currentPurchase);
                payload.price.subtotal = price;
                return jsonResponse(payload);
            }
            if (parsed.pathname.endsWith('/orders')) {
                const body = JSON.parse(options.body || '{}');
                actions.push(body.checkoutAction);
                return jsonResponse(createOrderPayload('GUEST-REPRICE-1', currentPurchase));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    assert.equal(runtime.element('guestCashPrice').textContent, '¥10.10');
    price = 12;

    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashState').textContent.includes('报价已变化'));

    assert.equal(previewCount, 3, 'availability probe plus uncached create re-quote are expected');
    assert.equal(runtime.element('guestCashPrice').textContent, '¥12.12');
    assert.deepEqual(actions, [], 'changed quote must stop before prepare or commit');
    assert.equal(paymentOption(runtime).disabled, false);

    clickPaymentOption(runtime);
    await waitFor(() => actions.includes('commit'));
    // The fixture handles `prepare` itself so it never reaches fetchImpl's
    // provider-order branch. Assert the externally visible provider call and
    // the complete checkout action log separately.
    assert.deepEqual(actions, ['commit']);
    assert.deepEqual(
        runtime.checkoutActions().map((entry) => entry.action).slice(0, 3),
        ['inspect', 'prepare', 'commit']
    );
});

test('a quote change detected by commit refreshes the quote and requires a second explicit click', async () => {
    const currentPurchase = purchase();
    let price = 10;
    let commitCount = 0;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                const payload = previewPayload(currentPurchase);
                payload.price.subtotal = price;
                return jsonResponse(payload);
            }
            if (parsed.pathname.endsWith('/orders')) {
                const body = JSON.parse(options.body || '{}');
                if (body.checkoutAction === 'commit' && commitCount++ === 0) {
                    price = 12;
                    return jsonResponse({
                        success: false,
                        code: 'guest_checkout_quote_changed',
                        message: '商品报价已变化，请重新确认后再创建订单'
                    }, { status: 409 });
                }
                return jsonResponse(createOrderPayload('GUEST-REPRICE-COMMIT-1', currentPurchase));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    assert.equal(runtime.element('guestCashPrice').textContent, '¥10.10');

    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashState').textContent.includes('报价已变化'));
    await waitFor(() => runtime.element('guestCashPrice').textContent === '¥12.12');

    const actionsAfterRequote = runtime.checkoutActions().map((entry) => entry.action);
    assert.deepEqual(actionsAfterRequote, ['inspect', 'prepare', 'commit']);
    assert.equal(paymentOption(runtime).disabled, false);

    clickPaymentOption(runtime);
    await waitFor(() => runtime.sessionStorage.snapshot(STORAGE_KEY)?.orderNo === 'GUEST-REPRICE-COMMIT-1');
    assert.deepEqual(
        runtime.checkoutActions().map((entry) => entry.action).filter((action) => action !== 'ack'),
        ['inspect', 'prepare', 'commit', 'prepare', 'commit']
    );
});

test('double create clicks share one prepare/commit intent and one provider-order attempt', async () => {
    const currentPurchase = purchase();
    const pendingCreate = deferred();
    const calls = [];
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            calls.push({ path: parsed.pathname, options });
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) return pendingCreate.promise;
            if (parsed.pathname.endsWith('/status')) {
                return jsonResponse(statusPayload(parsed.searchParams.get('orderNo'), currentPurchase));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    clickPaymentOption(runtime);

    await waitFor(() => calls.filter((call) => call.path.endsWith('/orders')).length === 1,
        'the first commit request did not start');
    const createCalls = calls.filter((call) => call.path.endsWith('/orders'));
    assert.equal(createCalls.length, 1);
    const submitted = JSON.parse(createCalls[0].options.body);
    assert.equal(submitted.checkoutAction, 'commit');
    assert.match(submitted.intentId, /^ci\.[A-Za-z0-9_-]{24,96}$/u);
    assert.equal(Object.prototype.hasOwnProperty.call(submitted, 'idempotencyKey'), false);
    assert.deepEqual(runtime.checkoutActions().map((entry) => entry.action), ['inspect', 'prepare', 'commit']);
    assert.equal(paymentOption(runtime).disabled, true);

    pendingCreate.resolve(jsonResponse(createOrderPayload('GUEST-DOUBLE-1', currentPurchase)));
    await waitFor(
        () => calls.some((call) => call.path.endsWith('/status')),
        'the created order did not enter status polling'
    );
    assert.equal(calls.filter((call) => call.path.endsWith('/orders')).length, 1);
});

test('a terminal snapshot retries a failed intent ack without creating another order', async () => {
    const currentPurchase = purchase();
    const pendingStatus = deferred();
    const runtime = createRuntime({
        purchase: currentPurchase,
        ackFailuresRemaining: 1,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) return jsonResponse(createOrderPayload('GUEST-ACK-RETRY-1', currentPurchase));
            if (parsed.pathname.endsWith('/status')) return pendingStatus.promise;
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(
        () => runtime.checkoutActions().filter((entry) => entry.action === 'ack').length === 1,
        'the initial intent ack did not fail in the fixture'
    );
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-ACK-RETRY-1');

    pendingStatus.resolve(jsonResponse(statusPayload('GUEST-ACK-RETRY-1', currentPurchase, {
        payment_status: 'expired'
    })));
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'expired',
        'the terminal snapshot did not settle'
    );
    await waitFor(
        () => runtime.checkoutActions().filter((entry) => entry.action === 'ack').length === 2,
        'the terminal snapshot did not retry the failed intent ack'
    );

    const actions = runtime.checkoutActions().map((entry) => entry.action);
    assert.deepEqual(actions.filter((action) => action === 'prepare'), ['prepare']);
    assert.deepEqual(actions.filter((action) => action === 'commit'), ['commit']);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-ACK-RETRY-1');
});

test('a terminal snapshot queues an ack retry when the first ack is still in flight', async () => {
    const currentPurchase = purchase();
    const pendingStatus = deferred();
    const pendingAck = deferred();
    const runtime = createRuntime({
        purchase: currentPurchase,
        ackFailuresRemaining: 1,
        ackFailureDeferred: pendingAck,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) return jsonResponse(createOrderPayload('GUEST-ACK-QUEUE-1', currentPurchase));
            if (parsed.pathname.endsWith('/status')) return pendingStatus.promise;
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(
        () => runtime.checkoutActions().filter((entry) => entry.action === 'ack').length === 1,
        'the initial ack did not enter the in-flight state'
    );
    pendingStatus.resolve(jsonResponse(statusPayload('GUEST-ACK-QUEUE-1', currentPurchase, {
        payment_status: 'expired'
    })));
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'expired',
        'the terminal snapshot did not settle while ack was in flight'
    );
    assert.equal(runtime.checkoutActions().filter((entry) => entry.action === 'ack').length, 1);

    pendingAck.resolve(jsonResponse({
        success: false,
        code: 'guest_checkout_intent_unavailable',
        message: 'temporary acknowledgement failure'
    }, { status: 503 }));
    await waitFor(
        () => runtime.checkoutActions().filter((entry) => entry.action === 'ack').length === 2,
        'the queued retry did not run after the first ack failed'
    );
    await flushEventLoop();

    assert.equal(runtime.checkoutActions().filter((entry) => entry.action === 'prepare').length, 1);
    assert.equal(runtime.checkoutActions().filter((entry) => entry.action === 'commit').length, 1);
});

test('delivered content keeps the local handle until a queued ack succeeds', async () => {
    const currentPurchase = purchase();
    const pendingStatus = deferred();
    const pendingAck = deferred();
    const runtime = createRuntime({
        purchase: currentPurchase,
        ackFailuresRemaining: 1,
        ackFailureDeferred: pendingAck,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) return jsonResponse(createOrderPayload('GUEST-ACK-DELIVERED-1', currentPurchase));
            if (parsed.pathname.endsWith('/status')) return pendingStatus.promise;
            if (parsed.pathname.endsWith('/claim')) return jsonResponse({ success: true, content: 'delivery-content' });
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(
        () => runtime.checkoutActions().filter((entry) => entry.action === 'ack').length === 1,
        'the initial delivered-order ack did not enter the in-flight state'
    );
    pendingStatus.resolve(jsonResponse(statusPayload('GUEST-ACK-DELIVERED-1', currentPurchase, {
        payment_status: 'confirmed',
        fulfillment_status: 'delivered'
    })));
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'delivered',
        'the delivered claim did not settle'
    );
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-ACK-DELIVERED-1');
    assert.equal(runtime.checkoutActions().filter((entry) => entry.action === 'ack').length, 1);

    pendingAck.resolve(jsonResponse({
        success: false,
        code: 'guest_checkout_intent_unavailable',
        message: 'temporary acknowledgement failure'
    }, { status: 503 }));
    await waitFor(
        () => runtime.checkoutActions().filter((entry) => entry.action === 'ack').length === 2,
        'the delivered path did not retry the failed ack'
    );
    await waitFor(
        () => runtime.sessionStorage.snapshot(STORAGE_KEY) === null,
        'the local handle was not cleared after the successful retry'
    );
});

test('a delayed preview cannot paint product A after the purchase context moved to product B', async () => {
    const purchaseA = purchase();
    const purchaseB = purchase({
        productId: 'product-b',
        productSkuId: 'sku-b',
        productName: 'Product B',
        productNameEn: 'Product B',
        productSkuName: 'SKU B'
    });
    const previewA = deferred();
    const previewB = deferred();
    const previewRequests = [];
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            assert.equal(parsed.pathname.endsWith('/preview'), true);
            const productId = parsed.searchParams.get('productId');
            previewRequests.push(productId);
            if (productId === purchaseA.productId) return previewA.promise;
            if (productId === purchaseB.productId) return previewB.promise;
            throw new Error(`Unexpected preview product: ${productId}`);
        }
    });

    const firstProbe = runtime.window.GuestShopCheckout.probeAvailability(contextFor(purchaseA));
    await waitFor(() => previewRequests.includes(purchaseA.productId));
    runtime.window.ShopClient.currentPurchase = { ...purchaseB };
    const secondProbe = runtime.window.GuestShopCheckout.probeAvailability(contextFor(purchaseB));

    previewA.resolve(jsonResponse(previewPayload(purchaseA)));
    const firstResult = await firstProbe;
    assert.deepEqual({ ...firstResult }, {
        available: false,
        reason: 'stale',
        discountEnabled: false,
        quantityCap: 1
    });
    await waitFor(() => previewRequests.includes(purchaseB.productId));
    assert.notEqual(runtime.element('guestCashProductName').textContent, purchaseA.productName);

    previewB.resolve(jsonResponse(previewPayload(purchaseB)));
    const secondResult = await secondProbe;
    assert.deepEqual({ ...secondResult }, {
        available: true,
        reason: 'available',
        discountEnabled: false,
        quantityCap: 1
    });
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseB.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, purchaseB.productSkuName);
});

test('a delayed availability result cannot open guest checkout after its source modal is stale', async () => {
    const currentPurchase = purchase();
    const pendingPreview = deferred();
    let previewRequested = false;
    let sourceStillValid = true;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                previewRequested = true;
                return pendingPreview.promise;
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    const started = runtime.window.GuestShopCheckout.startGuestCheckout(
        contextFor(currentPurchase),
        {
            deferScrollLock: true,
            shouldOpen: () => sourceStillValid
        }
    );
    await waitFor(() => previewRequested, 'availability preview was not requested');
    sourceStillValid = false;
    pendingPreview.resolve(jsonResponse(previewPayload(currentPurchase)));

    const result = await started;
    assert.equal(result.started, false);
    assert.equal(result.reason, 'source_stale');
    assert.equal(runtime.document.body.classList.contains('guest-shop-modal-open'), false);
});

test('a delayed status response cannot paint order A after the modal moves to product B', async () => {
    const purchaseA = purchase();
    const purchaseB = purchase({
        productId: 'product-b',
        productSkuId: 'sku-b',
        productName: 'Product B',
        productNameEn: 'Product B',
        productSkuName: 'SKU B'
    });
    const oldStatus = deferred();
    const statusOrderNumbers = [];
    let claimCalls = 0;
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                const productId = parsed.searchParams.get('productId');
                return jsonResponse(previewPayload(productId === purchaseB.productId ? purchaseB : purchaseA));
            }
            if (parsed.pathname.endsWith('/orders')) {
                return jsonResponse(createOrderPayload('GUEST-SWITCH-A', purchaseA));
            }
            if (parsed.pathname.endsWith('/status')) {
                statusOrderNumbers.push(parsed.searchParams.get('orderNo'));
                return oldStatus.promise;
            }
            if (parsed.pathname.endsWith('/claim')) {
                claimCalls += 1;
                return jsonResponse({ success: true, content: 'must-not-render' });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    clickPaymentOption(runtime);
    await waitFor(() => statusOrderNumbers.includes('GUEST-SWITCH-A'));

    runtime.click('guestCashPurchaseModal');
    runtime.window.ShopClient.currentPurchase = { ...purchaseB };
    await openCheckout(runtime, purchaseB);
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseB.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, purchaseB.productSkuName);

    oldStatus.resolve(jsonResponse(statusPayload('GUEST-SWITCH-A', purchaseA, {
        payment_status: 'confirmed',
        fulfillment_status: 'delivered',
        product_name: 'STALE PRODUCT A'
    })));
    await flushEventLoop();

    assert.equal(runtime.element('guestCashProductName').textContent, purchaseB.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, purchaseB.productSkuName);
    assert.notEqual(runtime.element('guestCashProductName').textContent, 'STALE PRODUCT A');
    assert.equal(runtime.element('guestCashOrderNo').textContent, '-');
    assert.equal(runtime.element('guestCashState').dataset.state, 'configure');
    assert.equal(claimCalls, 0);
});

test('checkout remains usable in memory when sessionStorage access throws', async () => {
    const currentPurchase = purchase();
    const runtime = createRuntime({
        purchase: currentPurchase,
        sessionStorageUnavailable: true,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) {
                return jsonResponse(createOrderPayload('GUEST-NO-STORAGE', currentPurchase));
            }
            if (parsed.pathname.endsWith('/status')) {
                return jsonResponse(statusPayload('GUEST-NO-STORAGE', currentPurchase, {
                    payment_status: 'expired'
                }));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'expired');

    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-NO-STORAGE');
    assert.equal(runtime.element('guestCashProductName').textContent, currentPurchase.productName);
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, false);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
    assert.equal(runtime.element('guestCashStorageWarning').hidden, false);
});

test('a fresh return tab restores from order_no when sessionStorage is unavailable', async () => {
    const returnedPurchase = purchase({
        productId: 'product-return',
        productSkuId: 'sku-return',
        productName: 'Returned Product',
        productNameEn: 'Returned Product',
        productSkuName: 'Returned SKU'
    });
    const statusOrderNumbers = [];
    const runtime = createRuntime({
        purchase: purchase(),
        sessionStorageUnavailable: true,
        locationHref: 'https://www.fatherkey.com/shop.html?order_no=GUEST-RETURN-TAB&success=1#checkout',
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/status')) {
                statusOrderNumbers.push(parsed.searchParams.get('orderNo'));
                return jsonResponse(statusPayload('GUEST-RETURN-TAB', returnedPurchase, {
                    payment_status: 'expired'
                }));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await waitFor(() => runtime.element('guestCashState').dataset.state === 'expired');

    assert.deepEqual(statusOrderNumbers, ['GUEST-RETURN-TAB']);
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, false);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-RETURN-TAB');
    assert.equal(runtime.element('guestCashProductName').textContent, returnedPurchase.productName);
    assert.deepEqual(runtime.replacedUrls, ['/shop.html#checkout']);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
});

test('closing during create keeps a late success out of the hidden view but persists its safe order handle', async () => {
    const currentPurchase = purchase();
    const otherPurchase = purchase({
        productId: 'product-b',
        productSkuId: 'sku-b',
        productName: 'Product B',
        productNameEn: 'Product B',
        productSkuName: 'SKU B'
    });
    const pendingCreate = deferred();
    const calls = [];
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            calls.push(parsed.pathname);
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) return pendingCreate.promise;
            if (parsed.pathname.endsWith('/status')) return jsonResponse(statusPayload('GUEST-LATE-1', currentPurchase));
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(() => calls.filter((pathname) => pathname.endsWith('/orders')).length === 1);
    runtime.click('guestCashPurchaseModal');
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, true);

    pendingCreate.resolve(jsonResponse(createOrderPayload('GUEST-LATE-1', currentPurchase)));
    await waitFor(
        () => runtime.sessionStorage.snapshot(STORAGE_KEY)?.orderNo === 'GUEST-LATE-1',
        'late create success was not persisted for a later resume'
    );

    assert.equal(runtime.element('guestCashPurchaseModal').hidden, true);
    assert.notEqual(runtime.element('guestCashOrderNo').textContent, 'GUEST-LATE-1');
    assert.equal(calls.filter((pathname) => pathname.endsWith('/status')).length, 0);
    const saved = runtime.sessionStorage.snapshot(STORAGE_KEY);
    assert.deepEqual(Object.keys(saved).sort(), [
        'batchEntries', 'batchMode', 'batchTotal', 'channel', 'expiresAt',
        'intentId', 'orderNo', 'productId', 'provider', 'savedAt', 'site',
        'skuId', 'version'
    ]);
    assert.equal(saved.productId, currentPurchase.productId);
    assert.equal(saved.skuId, currentPurchase.productSkuId);
    assert.equal(Object.hasOwn(saved, 'recoveryCode'), false);
    assert.equal(Object.hasOwn(saved, 'idempotencyKey'), false);

    runtime.window.ShopClient.currentPurchase = { ...otherPurchase };
    await openCheckout(runtime, otherPurchase);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-LATE-1');
    assert.equal(runtime.element('guestCashProductName').textContent, currentPurchase.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, currentPurchase.productSkuName);
});

test('background status query keeps action labels stable and preserves the order for a late confirmation', async () => {
    const currentPurchase = purchase();
    const pendingStatus = deferred();
    let statusCalls = 0;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) {
                return jsonResponse(createOrderPayload('GUEST-STATUS-LEAVE-1', currentPurchase));
            }
            if (parsed.pathname.endsWith('/status')) {
                statusCalls += 1;
                return pendingStatus.promise;
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(
        () => statusCalls === 1,
        'the created order did not begin its status request'
    );

    const orderNo = runtime.element('guestCashOrderNo').textContent;
    assert.equal(orderNo, 'GUEST-STATUS-LEAVE-1');
    assert.equal(runtime.element('guestCashCheckStatusBtn').disabled, false);
    assert.equal(runtime.element('guestCashCheckStatusBtn').getAttribute('aria-busy'), 'false');
    assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '查询支付状态');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, false);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').disabled, false);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, orderNo);

    assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, orderNo);

    pendingStatus.resolve(jsonResponse(statusPayload(orderNo, currentPurchase, {
        payment_status: 'confirmed',
        fulfillment_status: 'pending'
    })));
    await flushEventLoop();

    assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
    assert.equal(runtime.element('guestCashState').dataset.state, 'confirmed');
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, orderNo);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, true);
});

test('cancellation wins over a late status response that started before the cancel request', async () => {
    const currentPurchase = purchase();
    const pendingStatus = deferred();
    const pendingCancel = deferred();
    let statusCalls = 0;
    let cancelCalls = 0;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) {
                return jsonResponse(createOrderPayload('GUEST-CANCEL-RACE-1', currentPurchase));
            }
            if (parsed.pathname.endsWith('/status')) {
                statusCalls += 1;
                return pendingStatus.promise;
            }
            if (parsed.pathname.endsWith('/cancel')) {
                cancelCalls += 1;
                return pendingCancel.promise;
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(() => statusCalls === 1, 'the order did not start its status request');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').disabled, false);

    runtime.click('guestCashAbandonOrderBtn');
    await waitFor(() => cancelCalls === 1, 'the cancel request did not start while status was in flight');
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-CANCEL-RACE-1');
    assert.equal(runtime.element('guestCashState').dataset.state, 'awaiting_payment');
    assert.equal(runtime.element('guestCashState').textContent, '正在取消订单并释放库存...');

    pendingStatus.resolve(jsonResponse(statusPayload('GUEST-CANCEL-RACE-1', currentPurchase, {
        payment_status: 'confirmed',
        fulfillment_status: 'pending'
    })));
    await flushEventLoop();
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-CANCEL-RACE-1');
    assert.equal(runtime.element('guestCashState').textContent, '正在取消订单并释放库存...');
    assert.equal(runtime.element('guestCashState').dataset.state, 'awaiting_payment');

    pendingCancel.resolve(jsonResponse({ success: true, cancelled: true }));
    await flushEventLoop();
    assert.equal(runtime.element('guestCashOrderNo').textContent, '-');
    assert.equal(runtime.element('guestCashState').dataset.state, 'configure');
    assert.equal(runtime.element('guestCashState').textContent, '订单已取消，库存已释放。请重新选择支付方式创建新订单。');
});

test('refresh restores a two-item batch payment QR and cancels through the batch route', async () => {
    const orderNo = 'GCB-20260927000000-ABCDEF123456';
    const requests = [];
    const runtime = createRuntime({
        purchase: purchase(),
        storageInitial: { [STORAGE_KEY]: JSON.stringify(storedBatch(orderNo)) },
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            requests.push({ path: parsed.pathname, method: String(options.method || 'GET').toUpperCase() });
            if (parsed.pathname.endsWith('/checkout-batches/status')) {
                return jsonResponse(batchStatusPayload(orderNo));
            }
            if (parsed.pathname.endsWith('/checkout-batches/cancel')) {
                assert.equal(JSON.parse(options.body).orderNo, orderNo);
                return jsonResponse({ success: true, cancelled: true, order_no: orderNo });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await waitFor(() => runtime.element('guestCashZpayQrImage').src === `https://payments.example.test/${orderNo}/qr.png`);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, false);
    assert.equal(runtime.element('guestCashProductName').textContent, '购物车批量结算');
    assert.equal(runtime.element('guestCashSkuName').textContent, '2 件商品');
    assert.equal(runtime.element('guestCashZpayQrImage').src, `https://payments.example.test/${orderNo}/qr.png`);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, false);
    runtime.click('guestCashAbandonOrderBtn');
    await waitFor(() => runtime.sessionStorage.snapshot(STORAGE_KEY) === null);
    assert.equal(requests.filter((request) => request.path.endsWith('/checkout-batches/cancel')).length, 1);
    assert.equal(requests.filter((request) => request.path === '/api/shop/guest/cancel').length, 0);
    assert.equal(runtime.element('guestCashOrderNo').textContent, '-');
});

test('a paid batch discovered during cancellation refreshes status and claims delivery', async () => {
    const orderNo = 'GCB-20260927000000-PAIDONCANCEL1';
    const requests = [];
    const runtime = createRuntime({
        purchase: purchase(),
        storageInitial: { [STORAGE_KEY]: JSON.stringify(storedBatch(orderNo)) },
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            const method = String(options.method || 'GET').toUpperCase();
            requests.push({
                path: parsed.pathname,
                method,
                forceProviderRefresh: parsed.searchParams.has('force_provider_refresh')
            });
            if (parsed.pathname.endsWith('/checkout-batches/status')) {
                if (parsed.searchParams.has('force_provider_refresh')) {
                    return jsonResponse(batchStatusPayload(orderNo, {
                        payment_status: 'confirmed',
                        fulfillment_status: 'delivered',
                        checkout: null
                    }));
                }
                return jsonResponse(batchStatusPayload(orderNo));
            }
            if (parsed.pathname.endsWith('/checkout-batches/cancel')) {
                return jsonResponse({
                    success: false,
                    code: 'guest_order_not_cancellable',
                    message: '订单已付款或状态已变化，无法取消'
                }, { status: 409 });
            }
            if (parsed.pathname.endsWith('/checkout-batches/claim')) {
                return jsonResponse({
                    success: true,
                    order_no: orderNo,
                    fulfilled_at: '2026-09-27T00:00:00.000Z',
                    items: [{ item_index: 0, content: 'delivery-key-a' }, { item_index: 1, content: 'delivery-key-b' }]
                });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await waitFor(() => runtime.element('guestCashZpayQrImage').src === `https://payments.example.test/${orderNo}/qr.png`);
    runtime.click('guestCashAbandonOrderBtn');
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'delivered');

    assert.equal(requests.filter((request) => request.path.endsWith('/checkout-batches/cancel')).length, 1);
    assert.equal(requests.filter((request) => request.path.endsWith('/checkout-batches/status')
        && request.forceProviderRefresh).length, 1);
    assert.equal(requests.filter((request) => request.path.endsWith('/checkout-batches/claim')).length, 1);
    assert.match(runtime.element('guestCashDeliveredContent').textContent, /delivery-key-a/u);
    assert.match(runtime.element('guestCashDeliveredContent').textContent, /delivery-key-b/u);
    assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
});

test('a batch with a lost claim cookie stops auto-restoring after showing its order number once', async () => {
    const orderNo = 'GCB-20260927000000-LOSTCOOKIE12';
    const runtime = createRuntime({
        purchase: purchase(),
        storageInitial: { [STORAGE_KEY]: JSON.stringify(storedBatch(orderNo)) },
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/checkout-batches/status')) {
                return jsonResponse({ success: false, code: 'guest_claim_invalid', message: '取货凭证无效' }, { status: 403 });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'manual_review');
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
    assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, true);
    assert.equal(runtime.element('guestCashCheckStatusBtn').hidden, true);
    assert.equal(runtime.element('guestCashConfigurePanel').hidden, true);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
});

test('a claim-proof failure during status polling clears the old QR and stops polling', async () => {
    const orderNo = 'GCB-20260927000000-POLLCOOKIE1';
    let statusCalls = 0;
    const runtime = createRuntime({
        purchase: purchase(),
        storageInitial: { [STORAGE_KEY]: JSON.stringify(storedBatch(orderNo)) },
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/checkout-batches/status')) {
                statusCalls += 1;
                if (statusCalls === 1) return jsonResponse(batchStatusPayload(orderNo));
                return jsonResponse({ success: false, code: 'guest_claim_invalid', message: '取货凭证无效' }, { status: 403 });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await waitFor(() => statusCalls === 2 && runtime.element('guestCashState').dataset.state === 'manual_review');

    assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
    assert.match(runtime.element('guestCashState').textContent, /凭证已失效/u);
    assert.equal(runtime.element('guestCashZpayQrImage').hidden, true);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashCheckStatusBtn').hidden, true);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, true);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
    assert.deepEqual(runtime.scheduledTasks(), []);

    runtime.click('guestCashCheckStatusBtn');
    runtime.click('guestCashAbandonOrderBtn');
    await flushEventLoop();
    assert.equal(statusCalls, 2, 'an invalidated claim proof must not trigger another status request');
});

test('cancel with an invalid batch claim proof hides stale payment actions and QR', async () => {
    const orderNo = 'GCB-20260927000000-CANCELPROOF1';
    const requests = [];
    const runtime = createRuntime({
        purchase: purchase(),
        storageInitial: { [STORAGE_KEY]: JSON.stringify(storedBatch(orderNo)) },
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            const method = String(options.method || 'GET').toUpperCase();
            requests.push({ path: parsed.pathname, method });
            if (parsed.pathname.endsWith('/checkout-batches/status')) {
                return jsonResponse(batchStatusPayload(orderNo));
            }
            if (parsed.pathname.endsWith('/checkout-batches/cancel')) {
                return jsonResponse({ success: false, code: 'guest_claim_invalid', message: '取货凭证无效' }, { status: 403 });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await waitFor(() => runtime.element('guestCashZpayQrImage').src === `https://payments.example.test/${orderNo}/qr.png`);
    runtime.click('guestCashAbandonOrderBtn');
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'manual_review');

    assert.equal(requests.filter((request) => request.path.endsWith('/checkout-batches/cancel')).length, 1);
    assert.equal(runtime.element('guestCashState').textContent, '当前浏览器的订单凭证已失效，无法恢复付款二维码或取消订单。请勿重复付款，保留订单号联系客服核对。');
    assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
    assert.equal(runtime.element('guestCashZpayQrImage').hidden, true);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashConfigurePanel').hidden, true);
    assert.equal(runtime.element('guestCashCheckStatusBtn').hidden, true);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, true);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
});

test('a transient background status failure keeps the unpaid-order actions in place', async () => {
    const currentPurchase = purchase();
    const pendingStatus = deferred();
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) {
                return jsonResponse(createOrderPayload('GUEST-STATUS-RETRY-1', currentPurchase));
            }
            if (parsed.pathname.endsWith('/status')) return pendingStatus.promise;
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashAbandonOrderBtn').disabled);
    pendingStatus.resolve(jsonResponse({ error: 'temporary_unavailable' }, { status: 503 }));
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'checking');

    assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '查询支付状态');
    assert.equal(runtime.element('guestCashCheckStatusBtn').getAttribute('aria-busy'), 'false');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').textContent, '取消订单');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, false);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').disabled, false);
});

test('manual status check during background polling runs once and shows busy only for that check', async () => {
    const currentPurchase = purchase();
    const backgroundStatus = deferred();
    const manualStatus = deferred();
    const statusRequests = [];
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) {
                return jsonResponse(createOrderPayload('GUEST-MANUAL-POLL-1', currentPurchase));
            }
            if (parsed.pathname.endsWith('/status')) {
                statusRequests.push(parsed.searchParams.get('force_provider_refresh'));
                return statusRequests.length === 1 ? backgroundStatus.promise : manualStatus.promise;
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(() => statusRequests.length === 1);
    assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '查询支付状态');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, false);

    runtime.click('guestCashCheckStatusBtn');
    assert.equal(statusRequests.length, 1, 'the live provider query must wait for the current request');
    assert.equal(
        runtime.element('guestCashState').textContent,
        '正在等待当前核验完成，将继续查询支付状态...',
        'manual status checks must provide immediate feedback while a background check is active'
    );
    assert.equal(runtime.element('guestCashState').dataset.state, 'checking');
    backgroundStatus.resolve(jsonResponse(statusPayload('GUEST-MANUAL-POLL-1', currentPurchase)));
    await waitFor(() => statusRequests.length === 2);

    assert.deepEqual(statusRequests, [null, '1']);
    assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '查询中...');
    assert.equal(runtime.element('guestCashCheckStatusBtn').getAttribute('aria-busy'), 'true');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, false);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').disabled, false);

    manualStatus.resolve(jsonResponse(statusPayload('GUEST-MANUAL-POLL-1', currentPurchase)));
    await flushEventLoop();
    assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '查询支付状态');
    assert.equal(runtime.element('guestCashCheckStatusBtn').getAttribute('aria-busy'), 'false');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, false);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').disabled, false);
});

for (const failureMode of ['network failure', 'HTTP 503']) {
    test(`${failureMode} without an order number confirms the original server-held intent`, async () => {
        const purchaseA = purchase();
        const purchaseB = purchase({
            productId: 'product-b',
            productSkuId: 'sku-b',
            productName: 'Product B',
            productNameEn: 'Product B',
            productSkuName: 'SKU B'
        });
        const createBodies = [];
        let statusCalls = 0;
        const runtime = createRuntime({
            purchase: purchaseA,
            fetchImpl: async (url, options = {}) => {
                const parsed = new URL(url, 'https://www.fatherkey.com');
                if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(purchaseA));
                if (parsed.pathname.endsWith('/orders')) {
                    createBodies.push(JSON.parse(options.body));
                    if (createBodies.length === 1) {
                        if (failureMode === 'network failure') throw new TypeError('connection lost');
                        return jsonResponse({
                            success: false,
                            code: 'guest_payment_creation_in_progress',
                            message: 'temporary provider failure'
                        }, { status: 503 });
                    }
                    return jsonResponse(createOrderPayload('GUEST-REPLAY-1', purchaseA));
                }
                if (parsed.pathname.endsWith('/status')) {
                    statusCalls += 1;
                    return jsonResponse(statusPayload('GUEST-REPLAY-1', purchaseA));
                }
                throw new Error(`Unexpected request: ${parsed.pathname}`);
            }
        });

        await openCheckout(runtime, purchaseA);
        runtime.element('guestCashContact').value = 'original@example.com';
    clickPaymentOption(runtime);
        await waitFor(
            () => runtime.element('guestCashState').dataset.state === 'payment_creation_unknown',
            'an indeterminate create did not expose the protected confirmation state'
        );

        assert.equal(createBodies.length, 1);
        assert.equal(runtime.element('guestCashState').dataset.state, 'payment_creation_unknown');
        assert.equal(paymentOption(runtime).disabled, false);
        assert.equal(runtime.element('guestCashPaymentChannel').disabled, true);
        assert.equal(runtime.uuidCount(), 0);
        assert.deepEqual(Object.keys(createBodies[0]).sort(), [
            'checkoutAction', 'email', 'intentId'
        ]);

        runtime.window.ShopClient.currentPurchase = { ...purchaseB };
        runtime.element('guestCashContact').value = 'original@example.com';
        runtime.element('guestCashPaymentChannel').children[0].dataset.channel = 'wxpay';
    clickPaymentOption(runtime);

        await waitFor(() => createBodies.length === 2, 'the original create request was not replayed');
        assert.deepEqual(createBodies[1], createBodies[0]);
        assert.equal(createBodies[1].checkoutAction, 'commit');
        assert.equal(createBodies[1].intentId, createBodies[0].intentId);
        assert.equal(Object.prototype.hasOwnProperty.call(createBodies[1], 'idempotencyKey'), false);
        assert.equal(runtime.uuidCount(), 0);
        await waitFor(() => statusCalls === 1, 'the replayed order did not enter status polling');
        assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-REPLAY-1');
    });
}

test('contact storage preflight failure is shown as a definite pre-create error', async () => {
    const currentPurchase = purchase();
    const commitBodies = [];
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) {
                const body = JSON.parse(options.body || '{}');
                if (body.checkoutAction === 'commit') {
                    commitBodies.push(body);
                    return jsonResponse({
                        success: false,
                        code: 'guest_contact_storage_unavailable',
                        message: '游客订单联系信息暂不可用，请稍后重试'
                    }, { status: 503 });
                }
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    runtime.element('guestCashContact').value = 'buyer@example.com';
    clickPaymentOption(runtime);

    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'error',
        'a pre-create contact-storage error was left in the unknown-payment state'
    );
    assert.equal(commitBodies.length, 1);
    assert.equal(runtime.element('guestCashState').dataset.state, 'error');
    assert.match(runtime.element('guestCashState').textContent, /联系信息暂不可用/u);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
});

test('a low-value USDT provider rejection clears the failed checkout before the next purchase', async () => {
    const currentPurchase = purchase();
    const commitBodies = [];
    let previewCount = 0;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                previewCount += 1;
                return jsonResponse({
                    ...previewPayload(currentPurchase),
                    payment_channels: ['nowpayments:usdtbsc'],
                    payment_providers: { nowpayments: { surcharge_rate: 0.01 } },
                    price: {
                        quantity: 1,
                        subtotal: 0.01,
                        payable_amount: 0.0101,
                        currency: 'CNY'
                    }
                });
            }
            if (parsed.pathname.endsWith('/orders')) {
                const body = JSON.parse(options.body || '{}');
                if (body.checkoutAction === 'commit') {
                    commitBodies.push(body);
                    return jsonResponse({
                        success: false,
                        code: 'guest_provider_create_failed',
                        message: '金额过低，无法创建支付订单'
                    }, { status: 502 });
                }
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime, 'nowpayments:usdtbsc');
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'error',
        'the low-value provider rejection did not settle as a definite error'
    );
    await flushEventLoop();

    assert.equal(commitBodies.length, 1);
    assert.equal(previewCount >= 2, true, 'the confirmation flow must re-quote before commit');
    assert.equal(runtime.element('guestCashOrderNo').textContent, '-');
    assert.equal(runtime.element('guestCashOrderNoRow').hidden, true);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowpaymentsPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowAddress').textContent, '');
    assert.equal(runtime.element('guestCashZpayCountdown').hidden, true);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
    assert.equal(paymentOption(runtime, 'nowpayments:usdtbsc').disabled, false);

    // A subsequent product click must stay in the fresh confirmation phase;
    // it must not inspect or restore the rejected payment as a wallet stage.
    runtime.click('guestCashPurchaseModal');
    await flushEventLoop();
    await openCheckout(runtime, currentPurchase);
    assert.equal(runtime.element('guestCashOrderNoRow').hidden, true);
    assert.equal(runtime.element('guestCashConfigurePanel').hidden, false);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowAddress').textContent, '');
});

test('a missing USDT checkout credential is a definite failure and cannot restore the old payment stage', async () => {
    const currentPurchase = purchase();
    const commitBodies = [];
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                return jsonResponse({
                    ...previewPayload(currentPurchase),
                    payment_channels: ['nowpayments:usdtbsc'],
                    payment_providers: { nowpayments: { surcharge_rate: 0.01 } }
                });
            }
            if (parsed.pathname.endsWith('/orders')) {
                const body = JSON.parse(options.body || '{}');
                if (body.checkoutAction === 'commit') {
                    commitBodies.push(body);
                    return jsonResponse({
                        success: false,
                        code: 'guest_provider_checkout_missing',
                        message: 'NOWPayments 未返回 USDT 钱包地址'
                    }, { status: 502 });
                }
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime, 'nowpayments:usdtbsc');
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'error',
        'a missing provider checkout credential was left in the unknown-payment state'
    );
    await flushEventLoop();

    assert.equal(commitBodies.length, 1);
    assert.equal(runtime.element('guestCashOrderNo').textContent, '-');
    assert.equal(runtime.element('guestCashOrderNoRow').hidden, true);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowpaymentsPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowAddress').textContent, '');
    assert.equal(runtime.element('guestCashZpayCountdown').hidden, true);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
    assert.equal(paymentOption(runtime, 'nowpayments:usdtbsc').disabled, false);

    await openCheckout(runtime, currentPurchase);
    assert.equal(runtime.element('guestCashOrderNoRow').hidden, true);
    assert.equal(runtime.element('guestCashConfigurePanel').hidden, false);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowAddress').textContent, '');
});

test('a pending USDT order without a wallet address never becomes a waiting-payment checkout', async () => {
    const currentPurchase = purchase();
    let statusCalls = 0;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                return jsonResponse({
                    ...previewPayload(currentPurchase),
                    payment_channels: ['nowpayments:usdtbsc'],
                    payment_providers: { nowpayments: { surcharge_rate: 0.01 } }
                });
            }
            if (parsed.pathname.endsWith('/orders')) {
                const body = JSON.parse(options.body || '{}');
                if (body.checkoutAction === 'commit') {
                    const payload = createOrderPayload('GUEST-USDT-NO-WALLET', currentPurchase);
                    payload.order.provider = 'nowpayments';
                    payload.order.channel = 'usdtbsc';
                    payload.checkout = {
                        provider: 'nowpayments',
                        channel: 'usdtbsc',
                        payment_id: 'np-payment-1',
                        pay_address: '0x1234567890abcdef1234567890abcdef12345678',
                        pay_amount: 1.25,
                        pay_currency: 'USDTBSC'
                    };
                    return jsonResponse(payload);
                }
            }
            if (parsed.pathname.endsWith('/status')) {
                statusCalls += 1;
                return jsonResponse(statusPayload('GUEST-USDT-NO-WALLET', currentPurchase, {
                    provider: 'nowpayments',
                    channel: 'usdtbsc',
                    payment_status: 'pending',
                    fulfillment_status: 'pending'
                }));
            }
            if (parsed.pathname.endsWith('/cancel')) {
                return jsonResponse({ success: true, cancelled: true });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime, 'nowpayments:usdtbsc');
    await waitFor(() => statusCalls === 1, 'the USDT order did not start its status request');
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'payment_creation_unknown',
        'a pending USDT order without checkout was shown as ordinary awaiting payment'
    );

    assert.match(runtime.element('guestCashState').textContent, /支付凭证不可用/u);
    assert.doesNotMatch(runtime.element('guestCashState').textContent, /等待支付确认/u);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowpaymentsPanel').hidden, true);
    assert.equal(runtime.element('guestCashNowAddress').textContent, '');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, false);
    assert.equal(runtime.element('guestCashAbandonOrderBtn').disabled, false);
    assert.deepEqual(runtime.scheduledTasks(), []);

    runtime.click('guestCashCheckStatusBtn');
    await waitFor(() => statusCalls === 2, 'manual status refresh did not run');
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'payment_creation_unknown',
        'manual status refresh restored the waiting-payment message'
    );
    assert.doesNotMatch(runtime.element('guestCashState').textContent, /等待支付确认/u);
    assert.deepEqual(runtime.scheduledTasks(), []);

    runtime.click('guestCashAbandonOrderBtn');
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'configure');
    assert.equal(runtime.element('guestCashState').textContent, '订单已取消，库存已释放。请重新选择支付方式创建新订单。');
    assert.equal(runtime.element('guestCashOrderNo').textContent, '-');
});

test('a late unknown create error survives modal close and reopens on the frozen original context', async () => {
    const purchaseA = purchase();
    const purchaseB = purchase({
        productId: 'product-b',
        productSkuId: 'sku-b',
        productName: 'Product B',
        productNameEn: 'Product B',
        productSkuName: 'SKU B'
    });
    const firstCreate = deferred();
    const createBodies = [];
    let statusCalls = 0;
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                const requestedProduct = parsed.searchParams.get('productId');
                return jsonResponse(previewPayload(
                    requestedProduct === purchaseB.productId ? purchaseB : purchaseA
                ));
            }
            if (parsed.pathname.endsWith('/orders')) {
                createBodies.push(JSON.parse(options.body));
                if (createBodies.length === 1) return firstCreate.promise;
                return jsonResponse(createOrderPayload('GUEST-LATE-UNKNOWN-1', purchaseA));
            }
            if (parsed.pathname.endsWith('/status')) {
                statusCalls += 1;
                return jsonResponse(statusPayload('GUEST-LATE-UNKNOWN-1', purchaseA));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    clickPaymentOption(runtime);
    await waitFor(() => createBodies.length === 1);
    runtime.click('guestCashPurchaseModal');
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, true);

    runtime.window.ShopClient.currentPurchase = { ...purchaseB };
    firstCreate.reject(new TypeError('late connection reset'));
    await firstCreate.promise.catch(() => undefined);
    await flushEventLoop();
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, true);
    assert.equal(runtime.uuidCount(), 0);

    const reopened = await runtime.window.GuestShopCheckout.startGuestCheckout(contextFor(purchaseB));
    assert.equal(reopened.started, true);
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, false);
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseA.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, purchaseA.productSkuName);
    assert.equal(runtime.element('guestCashState').dataset.state, 'payment_creation_unknown');
    clickPaymentOption(runtime);
    await waitFor(() => createBodies.length === 2);
    assert.deepEqual(createBodies[1], createBodies[0]);
    assert.equal(createBodies[1].checkoutAction, 'commit');
    assert.equal(Object.prototype.hasOwnProperty.call(createBodies[1], 'idempotencyKey'), false);
    assert.equal(runtime.uuidCount(), 0);
    await waitFor(() => statusCalls === 1);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-LATE-UNKNOWN-1');
});

test('status review suppresses an existing checkout and does not schedule another poll', async () => {
    const purchaseA = purchase();
    let statusCalls = 0;
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(purchaseA));
            if (parsed.pathname.endsWith('/orders')) {
                return jsonResponse(createOrderPayload('GUEST-STATUS-REVIEW', purchaseA));
            }
            if (parsed.pathname.endsWith('/status')) {
                statusCalls += 1;
                return jsonResponse({
                    ...statusPayload('GUEST-STATUS-REVIEW', purchaseA, {
                        payment_status: 'review'
                    }),
                    checkout: {
                        provider: 'zpay',
                        channel: 'alipay',
                        qrcode_url: 'https://payments.example.test/must-not-render'
                    }
                });
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    clickPaymentOption(runtime);
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'payment_creation_unknown'
    );
    await flushEventLoop();

    assert.equal(statusCalls, 1);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashZpayPanel').hidden, true);
    assert.equal(runtime.element('guestCashZpayQrImage').hidden, true);
    assert.equal(runtime.element('guestCashZpayQrImage').src, '');
    assert.deepEqual(runtime.scheduledTasks(), []);
    await runtime.runImmediateTimers();
    await flushEventLoop();
    assert.equal(statusCalls, 1);
});

test('confirmed manual-fulfillment states clear a prior checkout without losing manual status access', async (t) => {
    for (const fulfillmentStatus of ['paid_unfulfillable', 'dead_letter']) {
        await t.test(fulfillmentStatus, async () => {
            const currentPurchase = purchase();
            const pendingStatus = deferred();
            let statusCalls = 0;
            const orderNo = `GUEST-${fulfillmentStatus.toUpperCase()}`;
            const runtime = createRuntime({
                purchase: currentPurchase,
                fetchImpl: async (url) => {
                    const parsed = new URL(url, 'https://www.fatherkey.com');
                    if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
                    if (parsed.pathname.endsWith('/orders')) {
                        return jsonResponse(createOrderPayload(orderNo, currentPurchase));
                    }
                    if (parsed.pathname.endsWith('/status')) {
                        statusCalls += 1;
                        return pendingStatus.promise;
                    }
                    throw new Error(`Unexpected request: ${parsed.pathname}`);
                }
            });

            await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
            await waitFor(() => statusCalls === 1, 'the initial status request did not start');

            assert.equal(runtime.element('guestCashCheckoutPanel').hidden, false);
            assert.equal(runtime.element('guestCashZpayPanel').hidden, false);
            assert.equal(runtime.element('guestCashZpayQrImage').hidden, false);
            assert.notEqual(runtime.element('guestCashZpayQrImage').src, '');
            assert.equal(runtime.element('guestCashZpayCountdown').hidden, false);
            assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, orderNo);
            assert.equal(runtime.scheduledTasks().some((task) => task.interval), true);

            pendingStatus.resolve(jsonResponse(statusPayload(orderNo, currentPurchase, {
                payment_status: 'confirmed',
                fulfillment_status: fulfillmentStatus
            })));
            await waitFor(() => runtime.element('guestCashState').dataset.state === fulfillmentStatus);
            await flushEventLoop();

            assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
            assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
            assert.equal(runtime.element('guestCashZpayPanel').hidden, true);
            assert.equal(runtime.element('guestCashZpayQrImage').hidden, true);
            assert.equal(runtime.element('guestCashZpayQrImage').src, '');
            assert.equal(runtime.element('guestCashZpayCountdown').hidden, true);
            assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
            assert.equal(runtime.element('guestCashCheckStatusBtn').hidden, false);
            assert.equal(runtime.element('guestCashCheckStatusBtn').disabled, false);
            assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '刷新处理状态');
            assert.deepEqual(runtime.scheduledTasks(), []);
        });
    }
});

test('unknown-create resume renders a terminal result without exposing the returned checkout', async () => {
    const purchaseA = purchase();
    let createCalls = 0;
    let statusCalls = 0;
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(purchaseA));
            if (parsed.pathname.endsWith('/orders')) {
                createCalls += 1;
                if (createCalls === 1) throw new TypeError('response lost');
                const payload = createOrderPayload('GUEST-RESUME-EXPIRED', purchaseA);
                payload.payment_status = 'expired';
                payload.order.payment_status = 'expired';
                payload.checkout.qrcode_url = 'https://payments.example.test/expired-must-not-render';
                return jsonResponse(payload);
            }
            if (parsed.pathname.endsWith('/status')) {
                statusCalls += 1;
                return jsonResponse(statusPayload('GUEST-RESUME-EXPIRED', purchaseA));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'payment_creation_unknown');
    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'expired');
    await flushEventLoop();

    assert.equal(createCalls, 2);
    assert.equal(statusCalls, 0);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-RESUME-EXPIRED');
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashZpayPanel').hidden, true);
    assert.equal(runtime.element('guestCashZpayQrImage').hidden, true);
    assert.equal(runtime.element('guestCashZpayQrImage').src, '');
    assert.deepEqual(runtime.scheduledTasks(), []);
});

test('a terminal order must be explicitly returned to configuration before a current-SKU replacement is created', async () => {
    const purchaseA = purchase();
    const purchaseB = purchase({
        productId: 'product-b',
        productSkuId: 'sku-b',
        productName: 'Product B',
        productNameEn: 'Product B',
        productSkuName: 'SKU B'
    });
    const createBodies = [];
    const previewProducts = [];
    let allowTerminalReset = false;
    const runtime = createRuntime({
        purchase: purchaseA,
        confirmImpl() {
            return allowTerminalReset;
        },
        fetchImpl: async (url, options = {}) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) {
                const productId = parsed.searchParams.get('productId');
                previewProducts.push(productId);
                return jsonResponse(previewPayload(productId === purchaseB.productId ? purchaseB : purchaseA));
            }
            if (parsed.pathname.endsWith('/orders')) {
                const body = JSON.parse(options.body);
                createBodies.push(body);
                if (createBodies.length === 1) {
                    return jsonResponse(createOrderPayload('GUEST-TERMINAL-A', purchaseA));
                }
                return jsonResponse(createOrderPayload('GUEST-TERMINAL-B', purchaseB));
            }
            if (parsed.pathname.endsWith('/status')) {
                const orderNo = parsed.searchParams.get('orderNo');
                if (orderNo === 'GUEST-TERMINAL-A') {
                    return jsonResponse(statusPayload(orderNo, purchaseA, { payment_status: 'expired' }));
                }
                return jsonResponse(statusPayload(orderNo, purchaseB));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'expired');

    assert.equal(createBodies.length, 1);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-TERMINAL-A');
    assert.equal(runtime.element('guestCashState').dataset.state, 'expired');
    assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '刷新处理状态');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, true);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-TERMINAL-A');

    runtime.window.ShopClient.currentPurchase = { ...purchaseB };
    clickPaymentOption(runtime);
    await flushEventLoop();

    assert.equal(createBodies.length, 1, 'rejecting confirmation must not create a replacement order');
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-TERMINAL-A');
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-TERMINAL-A');
    assert.match(runtime.confirmMessages.at(-1), /不会取消服务端订单或立即释放库存/);
    assert.match(runtime.confirmMessages.at(-1), /旧付款码不可再付/);

    allowTerminalReset = true;
    clickPaymentOption(runtime);
    await waitFor(() => previewProducts.includes(purchaseB.productId), 'current SKU was not re-quoted after terminal reset');

    assert.equal(createBodies.length, 1, 'returning to configuration must not itself create a payment order');
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
    assert.equal(runtime.element('guestCashOrderNoRow').hidden, true);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashConfigurePanel').hidden, false);
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseB.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, purchaseB.productSkuName);

    const freshRuntime = createRuntime({
        purchase: purchaseB,
        fetchImpl: async (url) => {
            throw new Error(`terminal handle must not survive a refresh: ${url}`);
        }
    });
    await flushEventLoop();
    assert.equal(freshRuntime.element('guestCashPurchaseModal').hidden, true);

    clickPaymentOption(runtime);
    await waitFor(() => createBodies.length === 2, 'the second click did not create the replacement order');
    assert.equal(createBodies[1].checkoutAction, 'commit');
    const lastPrepare = runtime.checkoutActions().filter((entry) => entry.action === 'prepare').at(-1);
    assert.equal(lastPrepare.body.productId, purchaseB.productId);
    assert.equal(lastPrepare.body.skuId, purchaseB.productSkuId);
});

test('closing delivered content asks before discarding un-copied delivery content', async () => {
    const currentPurchase = purchase();
    const runtime = createRuntime({
        purchase: currentPurchase,
        confirmImpl() {
            return false;
        },
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) return jsonResponse(createOrderPayload('GUEST-DELIVERY-GUARD', currentPurchase));
            if (parsed.pathname.endsWith('/status')) {
                return jsonResponse(statusPayload('GUEST-DELIVERY-GUARD', currentPurchase, {
                    payment_status: 'confirmed',
                    fulfillment_status: 'delivered'
                }));
            }
            if (parsed.pathname.endsWith('/claim')) return jsonResponse({ success: true, content: 'delivery-content' });
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    clickPaymentOption(runtime);
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'delivered');

    runtime.click('guestCashPurchaseModal');

    assert.equal(runtime.element('guestCashPurchaseModal').hidden, false);
    assert.match(runtime.confirmMessages.at(-1), /发货内容尚未复制/);
});
