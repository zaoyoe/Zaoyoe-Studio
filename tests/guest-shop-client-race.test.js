const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_PATH = path.resolve(__dirname, '../js/guest-shop-client.js');
const CLIENT_SOURCE = fs.readFileSync(CLIENT_PATH, 'utf8');
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
                if (key === 'guestCashPurchaseModal' || key === 'guestCashRecoveryPanel') node.hidden = true;
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

    vm.runInNewContext(CLIENT_SOURCE, window, { filename: CLIENT_PATH });

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
            recovery_code: 'R'.repeat(48)
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
    runtime.click('guestCashCreateOrderBtn');
    runtime.click('guestCashCreateOrderBtn');

    await waitFor(() => calls.filter((call) => call.path.endsWith('/orders')).length === 1,
        'the first commit request did not start');
    const createCalls = calls.filter((call) => call.path.endsWith('/orders'));
    assert.equal(createCalls.length, 1);
    const submitted = JSON.parse(createCalls[0].options.body);
    assert.equal(submitted.checkoutAction, 'commit');
    assert.match(submitted.intentId, /^ci\.[A-Za-z0-9_-]{24,96}$/u);
    assert.equal(Object.prototype.hasOwnProperty.call(submitted, 'idempotencyKey'), false);
    assert.deepEqual(runtime.checkoutActions().map((entry) => entry.action), ['inspect', 'prepare', 'commit']);
    assert.equal(runtime.element('guestCashCreateOrderBtn').getAttribute('aria-busy'), 'true');

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
    runtime.click('guestCashCreateOrderBtn');
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
    runtime.click('guestCashCreateOrderBtn');
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
    runtime.click('guestCashCreateOrderBtn');
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
    assert.deepEqual({ ...firstResult }, { available: false, reason: 'stale' });
    await waitFor(() => previewRequests.includes(purchaseB.productId));
    assert.notEqual(runtime.element('guestCashProductName').textContent, purchaseA.productName);

    previewB.resolve(jsonResponse(previewPayload(purchaseB)));
    const secondResult = await secondProbe;
    assert.deepEqual({ ...secondResult }, { available: true, reason: 'available' });
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
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, true);
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
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => statusOrderNumbers.includes('GUEST-SWITCH-A'));

    runtime.click('guestCashPurchaseDismissBtn');
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
    runtime.click('guestCashCreateOrderBtn');
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
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => calls.filter((pathname) => pathname.endsWith('/orders')).length === 1);
    assert.equal(runtime.element('guestCashPurchaseDismissBtn').disabled, false);
    runtime.click('guestCashPurchaseDismissBtn');
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
        'channel', 'expiresAt', 'intentId', 'orderNo', 'productId', 'provider',
        'savedAt', 'site', 'skuId', 'version'
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

test('status query in flight disables local leave and preserves the order for a late confirmation', async () => {
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
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(
        () => statusCalls === 1,
        'the created order did not begin its status request'
    );

    const orderNo = runtime.element('guestCashOrderNo').textContent;
    assert.equal(orderNo, 'GUEST-STATUS-LEAVE-1');
    assert.equal(runtime.element('guestCashCheckStatusBtn').disabled, true);
    assert.equal(runtime.element('guestCashCheckStatusBtn').getAttribute('aria-busy'), 'true');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, true);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, orderNo);

    // A synthetic click mirrors the event-handler path even though the action is
    // hidden. The execution guard must keep the local order and recovery handle.
    runtime.click('guestCashAbandonOrderBtn');
    assert.equal(runtime.element('guestCashOrderNo').textContent, orderNo);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, orderNo);
    assert.equal(runtime.element('guestCashState').dataset.state, 'awaiting_payment');

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

test('a synthetic create click cannot race an in-flight recovery request', async () => {
    const currentPurchase = purchase();
    const pendingRecovery = deferred();
    let recoveryCalls = 0;
    let createCalls = 0;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/recover')) {
                recoveryCalls += 1;
                return pendingRecovery.promise;
            }
            if (parsed.pathname.endsWith('/orders')) {
                createCalls += 1;
                return jsonResponse(createOrderPayload('GUEST-RACE-CREATE-1', currentPurchase));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    runtime.element('guestCashRecoveryOrderNo').value = 'GUEST-RECOVER-RACE-1';
    runtime.element('guestCashRecoveryCodeInput').value = 'R'.repeat(48);
    runtime.click('guestCashRecoverBtn');
    await waitFor(() => recoveryCalls === 1, 'recovery request did not start');

    assert.equal(runtime.element('guestCashRecoverBtn').disabled, true);
    assert.equal(runtime.element('guestCashPurchaseDismissBtn').disabled, false);
    // Event dispatch in this harness intentionally bypasses native disabled
    // button behavior; createOrder must still enforce the same single-flight
    // boundary at its execution layer.
    runtime.click('guestCashCreateOrderBtn');
    assert.equal(createCalls, 0);

    pendingRecovery.resolve(jsonResponse({
        ...createOrderPayload('GUEST-RECOVER-RACE-1', currentPurchase),
        order: {
            ...createOrderPayload('GUEST-RECOVER-RACE-1', currentPurchase).order,
            recovery_code: undefined
        }
    }));
    await waitFor(
        () => runtime.element('guestCashOrderNo').textContent === 'GUEST-RECOVER-RACE-1',
        'recovery did not settle after the competing create was ignored'
    );
    assert.equal(createCalls, 0);
});

test('recovering order B while order A status is in flight isolates A and resumes polling B', async () => {
    const purchaseA = purchase();
    const purchaseB = purchase({
        productId: 'product-b',
        productSkuId: 'sku-b',
        productName: 'Recovered Product B',
        productNameEn: 'Recovered Product B',
        productSkuName: 'Recovered SKU B'
    });
    const oldStatus = deferred();
    const statusOrderNumbers = [];
    let createCount = 0;
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(purchaseA));
            if (parsed.pathname.endsWith('/orders')) {
                createCount += 1;
                return jsonResponse(createOrderPayload('GUEST-A-0001', purchaseA));
            }
            if (parsed.pathname.endsWith('/recover')) {
                return jsonResponse({
                    ...createOrderPayload('GUEST-B-0002', purchaseB),
                    order: {
                        ...createOrderPayload('GUEST-B-0002', purchaseB).order,
                        recovery_code: undefined
                    }
                });
            }
            if (parsed.pathname.endsWith('/status')) {
                const orderNo = parsed.searchParams.get('orderNo');
                statusOrderNumbers.push(orderNo);
                if (orderNo === 'GUEST-A-0001') return oldStatus.promise;
                if (orderNo === 'GUEST-B-0002') return jsonResponse(statusPayload(orderNo, purchaseB));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => statusOrderNumbers.includes('GUEST-A-0001'), 'order A did not begin polling');
    assert.equal(createCount, 1);

    runtime.element('guestCashRecoveryOrderNo').value = 'GUEST-B-0002';
    runtime.element('guestCashRecoveryCodeInput').value = 'B'.repeat(48);
    runtime.click('guestCashRecoverBtn');
    await waitFor(
        () => runtime.element('guestCashOrderNo').textContent === 'GUEST-B-0002',
        'order B was not recovered while order A was in flight'
    );
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseB.productName);

    oldStatus.resolve(jsonResponse(statusPayload('GUEST-A-0001', purchaseA, {
        payment_status: 'confirmed',
        fulfillment_status: 'delivered',
        product_name: 'STALE PRODUCT A'
    })));
    await flushEventLoop();
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-B-0002');
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseB.productName);
    assert.notEqual(runtime.element('guestCashProductName').textContent, 'STALE PRODUCT A');
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-B-0002');
    await runtime.runImmediateTimers();

    await waitFor(
        () => statusOrderNumbers.includes('GUEST-B-0002'),
        'the status single-flight lock released, but polling was not resumed for recovered order B'
    );
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
        runtime.click('guestCashCreateOrderBtn');
        await waitFor(
            () => runtime.element('guestCashCreateOrderBtn').textContent === '确认原订单结果',
            'an indeterminate create did not expose the protected confirmation action'
        );

        assert.equal(createBodies.length, 1);
        assert.equal(runtime.element('guestCashState').dataset.state, 'payment_creation_unknown');
        assert.equal(runtime.element('guestCashCreateOrderBtn').disabled, false);
        assert.equal(runtime.element('guestCashPaymentChannel').disabled, true);
        assert.equal(runtime.uuidCount(), 0);
        assert.deepEqual(Object.keys(createBodies[0]).sort(), [
            'checkoutAction', 'email', 'intentId'
        ]);

        runtime.window.ShopClient.currentPurchase = { ...purchaseB };
        runtime.element('guestCashContact').value = 'original@example.com';
        runtime.element('guestCashPaymentChannel').children[0].dataset.channel = 'wxpay';
        runtime.click('guestCashCreateOrderBtn');

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
    let recoverCalls = 0;
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
            if (parsed.pathname.endsWith('/recover')) {
                recoverCalls += 1;
                throw new Error('recover must stay blocked while an unknown create is unresolved');
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => createBodies.length === 1);
    runtime.click('guestCashPurchaseDismissBtn');
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, true);

    runtime.window.ShopClient.currentPurchase = { ...purchaseB };
    firstCreate.reject(new TypeError('late connection reset'));
    await firstCreate.promise.catch(() => undefined);
    await flushEventLoop();
    assert.equal(runtime.element('guestCashCreateOrderBtn').textContent, '确认原订单结果');
    assert.equal(runtime.uuidCount(), 0);

    const reopened = await runtime.window.GuestShopCheckout.startGuestCheckout(contextFor(purchaseB));
    assert.equal(reopened.started, true);
    assert.equal(runtime.element('guestCashPurchaseModal').hidden, false);
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseA.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, purchaseA.productSkuName);
    assert.equal(runtime.element('guestCashCreateOrderBtn').textContent, '确认原订单结果');
    assert.equal(runtime.element('guestCashShowRecoveryBtn').disabled, true);
    assert.equal(runtime.element('guestCashRecoverBtn').disabled, true);
    runtime.element('guestCashRecoveryOrderNo').value = 'GUEST-OTHER-1';
    runtime.element('guestCashRecoveryCodeInput').value = 'R'.repeat(48);
    runtime.click('guestCashRecoverBtn');
    await flushEventLoop();
    assert.equal(recoverCalls, 0);

    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => createBodies.length === 2);
    assert.deepEqual(createBodies[1], createBodies[0]);
    assert.equal(createBodies[1].checkoutAction, 'commit');
    assert.equal(Object.prototype.hasOwnProperty.call(createBodies[1], 'idempotencyKey'), false);
    assert.equal(runtime.uuidCount(), 0);
    await waitFor(() => statusCalls === 1);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-LATE-UNKNOWN-1');
});

test('failed recovery restores order A checkout and polling instead of exposing a new-create state', async () => {
    const purchaseA = purchase();
    const statusOrderNumbers = [];
    let createCalls = 0;
    let recoverCalls = 0;
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(purchaseA));
            if (parsed.pathname.endsWith('/orders')) {
                createCalls += 1;
                return jsonResponse(createOrderPayload('GUEST-KEEP-A', purchaseA));
            }
            if (parsed.pathname.endsWith('/recover')) {
                recoverCalls += 1;
                return jsonResponse({
                    success: false,
                    code: 'guest_recovery_invalid',
                    message: '订单或取货口令不正确'
                }, { status: 403 });
            }
            if (parsed.pathname.endsWith('/status')) {
                const orderNo = parsed.searchParams.get('orderNo');
                statusOrderNumbers.push(orderNo);
                return jsonResponse(statusPayload(orderNo, purchaseA));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => statusOrderNumbers.length === 1);
    await flushEventLoop();
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-KEEP-A');
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, false);
    assert.equal(runtime.element('guestCashZpayQrImage').hidden, false);
    const originalQrImage = runtime.element('guestCashZpayQrImage').src;

    runtime.element('guestCashRecoveryOrderNo').value = 'GUEST-FAIL-B';
    runtime.element('guestCashRecoveryCodeInput').value = 'B'.repeat(48);
    runtime.click('guestCashRecoverBtn');

    await waitFor(
        () => recoverCalls === 1 && statusOrderNumbers.length >= 2,
        'failed recovery did not restart polling for the original order'
    );
    assert.deepEqual([...new Set(statusOrderNumbers)], ['GUEST-KEEP-A']);
    assert.equal(createCalls, 1);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-KEEP-A');
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseA.productName);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, false);
    assert.equal(runtime.element('guestCashZpayQrImage').hidden, false);
    assert.equal(runtime.element('guestCashZpayQrImage').src, originalQrImage);
    assert.equal(runtime.element('guestCashCreateOrderBtn').hidden, true);
    assert.equal(runtime.element('guestCashCheckStatusBtn').hidden, false);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-KEEP-A');
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
    runtime.click('guestCashCreateOrderBtn');
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
            runtime.click('guestCashCreateOrderBtn');
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

test('recovery disclosure focuses its order field and modal close clears entered credentials', async () => {
    const currentPurchase = purchase();
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    runtime.click('guestCashShowRecoveryBtn');

    assert.equal(runtime.element('guestCashRecoveryPanel').hidden, false);
    assert.equal(runtime.element('guestCashShowRecoveryBtn').getAttribute('aria-expanded'), 'true');
    assert.equal(runtime.document.activeElement, runtime.element('guestCashRecoveryOrderNo'));

    runtime.element('guestCashRecoveryOrderNo').value = 'GUEST-RECOVER-CLOSE-1';
    runtime.element('guestCashRecoveryCodeInput').value = 'x'.repeat(48);
    runtime.click('guestCashPurchaseDismissBtn');

    assert.equal(runtime.element('guestCashPurchaseModal').hidden, true);
    assert.equal(runtime.element('guestCashRecoveryPanel').hidden, true);
    assert.equal(runtime.element('guestCashRecoveryPanel').getAttribute('aria-hidden'), 'true');
    assert.equal(runtime.element('guestCashShowRecoveryBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(runtime.element('guestCashRecoveryOrderNo').value, '');
    assert.equal(runtime.element('guestCashRecoveryCodeInput').value, '');
});

test('successful recovery clears entered credentials and collapses the recovery panel', async () => {
    const currentPurchase = purchase();
    const recoveredOrderNo = 'GUEST-RECOVER-CLEAR-1';
    let recoveryCalls = 0;
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/recover')) {
                recoveryCalls += 1;
                return jsonResponse(createOrderPayload(recoveredOrderNo, currentPurchase));
            }
            if (parsed.pathname.endsWith('/status')) {
                return jsonResponse(statusPayload(recoveredOrderNo, currentPurchase));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    runtime.click('guestCashShowRecoveryBtn');
    runtime.element('guestCashRecoveryOrderNo').value = recoveredOrderNo;
    runtime.element('guestCashRecoveryCodeInput').value = 'x'.repeat(48);
    runtime.click('guestCashRecoverBtn');
    await waitFor(
        () => recoveryCalls === 1 && runtime.element('guestCashOrderNo').textContent === recoveredOrderNo,
        'successful recovery did not settle'
    );

    assert.equal(runtime.element('guestCashRecoveryPanel').hidden, true);
    assert.equal(runtime.element('guestCashShowRecoveryBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(runtime.element('guestCashRecoveryOrderNo').value, '');
    assert.equal(runtime.element('guestCashRecoveryCodeInput').value, '');
});

test('leaving an unpaid order clears entered recovery credentials', async () => {
    const currentPurchase = purchase();
    const orderNo = 'GUEST-ABANDON-CLEAR-1';
    const runtime = createRuntime({
        purchase: currentPurchase,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(currentPurchase));
            if (parsed.pathname.endsWith('/orders')) return jsonResponse(createOrderPayload(orderNo, currentPurchase));
            if (parsed.pathname.endsWith('/status')) return jsonResponse(statusPayload(orderNo, currentPurchase));
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, currentPurchase);
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(
        () => runtime.element('guestCashAbandonOrderBtn').hidden === false,
        'the unpaid order did not become leaveable'
    );

    runtime.click('guestCashShowRecoveryBtn');
    runtime.element('guestCashRecoveryOrderNo').value = 'GUEST-ABANDON-RECOVERY-1';
    runtime.element('guestCashRecoveryCodeInput').value = 'x'.repeat(48);
    runtime.click('guestCashAbandonOrderBtn');

    assert.notEqual(runtime.element('guestCashOrderNo').textContent, orderNo);
    assert.equal(runtime.element('guestCashRecoveryPanel').hidden, true);
    assert.equal(runtime.element('guestCashShowRecoveryBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(runtime.element('guestCashRecoveryOrderNo').value, '');
    assert.equal(runtime.element('guestCashRecoveryCodeInput').value, '');
});

test('recovery review never renders the returned checkout and never starts polling', async () => {
    const purchaseA = purchase();
    const purchaseB = purchase({
        productId: 'product-review',
        productSkuId: 'sku-review',
        productName: 'Review Product',
        productNameEn: 'Review Product',
        productSkuName: 'Review SKU'
    });
    let recoverCalls = 0;
    let statusCalls = 0;
    const runtime = createRuntime({
        purchase: purchaseA,
        fetchImpl: async (url) => {
            const parsed = new URL(url, 'https://www.fatherkey.com');
            if (parsed.pathname.endsWith('/preview')) return jsonResponse(previewPayload(purchaseA));
            if (parsed.pathname.endsWith('/recover')) {
                recoverCalls += 1;
                const payload = createOrderPayload('GUEST-RECOVER-REVIEW', purchaseB);
                payload.order.payment_status = 'review';
                payload.checkout.qrcode_url = 'https://payments.example.test/recovery-must-not-render';
                return jsonResponse(payload);
            }
            if (parsed.pathname.endsWith('/status')) {
                statusCalls += 1;
                return jsonResponse(statusPayload('GUEST-RECOVER-REVIEW', purchaseB));
            }
            throw new Error(`Unexpected request: ${parsed.pathname}`);
        }
    });

    await openCheckout(runtime, purchaseA);
    runtime.element('guestCashRecoveryOrderNo').value = 'GUEST-RECOVER-REVIEW';
    runtime.element('guestCashRecoveryCodeInput').value = 'C'.repeat(48);
    runtime.click('guestCashRecoverBtn');
    await waitFor(
        () => runtime.element('guestCashState').dataset.state === 'payment_creation_unknown'
    );
    await flushEventLoop();

    assert.equal(recoverCalls, 1);
    assert.equal(statusCalls, 0);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-RECOVER-REVIEW');
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashZpayPanel').hidden, true);
    assert.equal(runtime.element('guestCashZpayQrImage').hidden, true);
    assert.equal(runtime.element('guestCashZpayQrImage').src, '');
    assert.equal(runtime.element('guestCashCreateOrderBtn').hidden, true);
    assert.equal(runtime.element('guestCashCheckStatusBtn').hidden, false);
    assert.deepEqual(runtime.scheduledTasks(), []);
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
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => runtime.element('guestCashCreateOrderBtn').textContent === '确认原订单结果');
    runtime.click('guestCashCreateOrderBtn');
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
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => runtime.element('guestCashCreateOrderBtn').textContent === '回到配置后创建新订单');

    assert.equal(createBodies.length, 1);
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-TERMINAL-A');
    assert.equal(runtime.element('guestCashCreateOrderBtn').textContent, '回到配置后创建新订单');
    assert.equal(runtime.element('guestCashCheckStatusBtn').textContent, '刷新处理状态');
    assert.equal(runtime.element('guestCashAbandonOrderBtn').hidden, true);
    assert.equal(runtime.element('guestCashTerminalRestartHint').hidden, false);
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-TERMINAL-A');

    runtime.window.ShopClient.currentPurchase = { ...purchaseB };
    runtime.click('guestCashCreateOrderBtn');
    await flushEventLoop();

    assert.equal(createBodies.length, 1, 'rejecting confirmation must not create a replacement order');
    assert.equal(runtime.element('guestCashOrderNo').textContent, 'GUEST-TERMINAL-A');
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY).orderNo, 'GUEST-TERMINAL-A');
    assert.match(runtime.confirmMessages.at(-1), /取货口令尚未复制或保存/);
    assert.match(runtime.confirmMessages.at(-1), /不会取消服务端订单或立即释放库存/);
    assert.match(runtime.confirmMessages.at(-1), /旧付款码不可再付/);

    allowTerminalReset = true;
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => previewProducts.includes(purchaseB.productId), 'current SKU was not re-quoted after terminal reset');

    assert.equal(createBodies.length, 1, 'returning to configuration must not itself create a payment order');
    assert.equal(runtime.sessionStorage.snapshot(STORAGE_KEY), null);
    assert.equal(runtime.element('guestCashOrderNoRow').hidden, true);
    assert.equal(runtime.element('guestCashCheckoutPanel').hidden, true);
    assert.equal(runtime.element('guestCashConfigurePanel').hidden, false);
    assert.equal(runtime.element('guestCashProductName').textContent, purchaseB.productName);
    assert.equal(runtime.element('guestCashSkuName').textContent, purchaseB.productSkuName);
    assert.equal(runtime.element('guestCashCreateOrderBtn').textContent, '创建支付订单');
    assert.equal(runtime.element('guestCashTerminalRestartHint').hidden, true);
    assert.equal(runtime.element('guestCashRecoveryCode').textContent, '');

    const freshRuntime = createRuntime({
        purchase: purchaseB,
        fetchImpl: async (url) => {
            throw new Error(`terminal handle must not survive a refresh: ${url}`);
        }
    });
    await flushEventLoop();
    assert.equal(freshRuntime.element('guestCashPurchaseModal').hidden, true);

    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => createBodies.length === 2, 'the second click did not create the replacement order');
    assert.equal(createBodies[1].checkoutAction, 'commit');
    const lastPrepare = runtime.checkoutActions().filter((entry) => entry.action === 'prepare').at(-1);
    assert.equal(lastPrepare.body.productId, purchaseB.productId);
    assert.equal(lastPrepare.body.skuId, purchaseB.productSkuId);
});

test('closing delivered content asks before discarding an un-copied recovery code', async () => {
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
    runtime.click('guestCashCreateOrderBtn');
    await waitFor(() => runtime.element('guestCashState').dataset.state === 'delivered');

    runtime.click('guestCashPurchaseDismissBtn');

    assert.equal(runtime.element('guestCashPurchaseModal').hidden, false);
    assert.match(runtime.confirmMessages.at(-1), /发货内容尚未复制/);
    assert.match(runtime.confirmMessages.at(-1), /取货口令尚未复制或保存/);
});
