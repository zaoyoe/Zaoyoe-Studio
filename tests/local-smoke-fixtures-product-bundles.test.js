const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const smokeFixturePath = path.resolve(__dirname, '../js/local-smoke-fixtures.js');

function createClassList() {
    return {
        add() {},
        remove() {},
        toggle() {},
        contains() {
            return false;
        }
    };
}

function createElementStub(tagName = 'div', HTMLElementCtor = function HTMLElement() {}) {
    const element = new HTMLElementCtor();
    element.tagName = String(tagName || 'div').toUpperCase();
    element.id = '';
    element.textContent = '';
    element.className = '';
    element.hidden = false;
    element.style = {};
    element.dataset = {};
    element.clientWidth = 0;
    element.scrollWidth = 0;
    element.clientHeight = 0;
    element.scrollHeight = 0;
    element.classList = createClassList();
    element.setAttribute = function setAttribute() {};
    element.appendChild = function appendChild() {};
    element.replaceChildren = function replaceChildren() {};
    element.cloneNode = function cloneNode() {
        return createElementStub(tagName, HTMLElementCtor);
    };
    element.querySelector = function querySelector() {
        return null;
    };
    element.querySelectorAll = function querySelectorAll() {
        return [];
    };
    element.getBoundingClientRect = function getBoundingClientRect() {
        return { width: 0, top: 0 };
    };
    return element;
}

function loadSmokeFixtureRuntime() {
    const script = fs.readFileSync(smokeFixturePath, 'utf8');
    const fallbackFetchCalls = [];
    function HTMLElement() {}

    const document = {
        readyState: 'loading',
        head: {
            appendChild() {}
        },
        body: Object.assign(createElementStub('body', HTMLElement), {
            classList: createClassList()
        }),
        documentElement: {
            className: '',
            setAttribute() {}
        },
        createElement(tagName) {
            return createElementStub(tagName, HTMLElement);
        },
        getElementById() {
            return null;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };

    const listeners = new Map();
    const window = {
        location: new URL('http://127.0.0.1:8000/admin-studio.html?smoke=1&module=commerce-center'),
        document,
        console: {
            info() {},
            warn() {},
            error() {},
            log() {}
        },
        navigator: {},
        localStorage: {
            getItem() {
                return null;
            },
            setItem() {},
            removeItem() {}
        },
        sessionStorage: {
            getItem() {
                return null;
            },
            setItem() {},
            removeItem() {}
        },
        HTMLElement,
        Event: function Event(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        MouseEvent: function MouseEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        Response,
        Headers,
        URL,
        URLSearchParams,
        setTimeout() {
            return 1;
        },
        clearTimeout() {},
        requestAnimationFrame(handler) {
            if (typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type) {
            listeners.delete(type);
        },
        dispatchEvent() {
            return true;
        },
        fetch: async function fallbackFetch(input) {
            fallbackFetchCalls.push(typeof input === 'string' ? input : String(input?.url || ''));
            return new Response(JSON.stringify({
                success: false,
                message: 'fallback fetch should not be used for product bundle fixtures'
            }), {
                status: 404,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                }
            });
        }
    };

    window.window = window;
    window.globalThis = window;

    vm.runInNewContext(script, {
        window,
        document,
        console: window.console,
        navigator: window.navigator,
        localStorage: window.localStorage,
        sessionStorage: window.sessionStorage,
        Response,
        Headers,
        URL,
        URLSearchParams,
        setTimeout: window.setTimeout,
        clearTimeout: window.clearTimeout,
        requestAnimationFrame: window.requestAnimationFrame,
        globalThis: window
    });

    return {
        window,
        fallbackFetchCalls
    };
}

test('local smoke fixtures intercept product analytics bundle routes without falling back to network', async () => {
    const { window, fallbackFetchCalls } = loadSmokeFixtureRuntime();

    const dashboardResponse = await window.fetch('http://127.0.0.1:8000/api/admin?route=analytics/product-dashboard-bundle&site=all&limit=10');
    const dashboardPayload = await dashboardResponse.json();
    assert.equal(dashboardResponse.status, 200);
    assert.equal(dashboardPayload.success, true);
    assert.equal(dashboardPayload.segments.summary.ok, true);
    assert.equal(Array.isArray(dashboardPayload.segments.productMatrix.payload.items), true);

    const funnelResponse = await window.fetch('http://127.0.0.1:8000/api/admin?route=analytics/product-funnel-bundle&site=all&limit=6');
    const funnelPayload = await funnelResponse.json();
    assert.equal(funnelResponse.status, 200);
    assert.equal(funnelPayload.success, true);
    assert.equal(funnelPayload.segments.summary.ok, true);
    assert.equal(Array.isArray(funnelPayload.segments.productRows.payload), true);

    const detailResponse = await window.fetch('http://127.0.0.1:8000/api/admin?route=analytics/product-detail-bundle&site=all&productId=shop-prod-cn-1&recentOrderLimit=3');
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.success, true);
    assert.equal(detailPayload.product_id, 'shop-prod-cn-1');
    assert.equal(detailPayload.segments.summary.ok, true);
    assert.equal(Array.isArray(detailPayload.segments.recentOrders.payload), true);

    assert.equal(fallbackFetchCalls.length, 0);
});
