const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminPaymentsPath = path.resolve(__dirname, '../js/admin-payments.js');

class FakeClassList {
    constructor(initial = []) {
        this.values = new Set(initial);
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
    constructor({ id = '', classes = [], dataset = {} } = {}) {
        this.id = id;
        this.dataset = { ...dataset };
        this.classList = new FakeClassList(classes);
        this.parentElement = null;
        this.children = [];
        this.hidden = false;
        this.disabled = false;
        this.checked = true;
        this.value = '';
        this._innerHTML = '';
        this.textContent = '';
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    querySelectorAll(selector) {
        if (selector === '.admin-tab') {
            return this.children.filter((child) => child.classList.contains('admin-tab'));
        }
        return [];
    }

    querySelector(selector) {
        if (selector === '.admin-tab.active') {
            return this.children.find((child) => child.classList.contains('admin-tab') && child.classList.contains('active')) || null;
        }
        return null;
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (matchesSelector(current, selector)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    addEventListener() {}

    removeEventListener() {}

    scrollIntoView() {}

    set innerHTML(value) {
        this._innerHTML = String(value ?? '');
    }

    get innerHTML() {
        return this._innerHTML;
    }

    get childElementCount() {
        return this._innerHTML ? 1 : this.children.length;
    }
}

function matchesSelector(element, selector) {
    if (!element || !selector) {
        return false;
    }

    if (selector.startsWith('#')) {
        return element.id === selector.slice(1);
    }

    if (selector.startsWith('.')) {
        return selector
            .slice(1)
            .split('.')
            .filter(Boolean)
            .every((className) => element.classList.contains(className));
    }

    return false;
}

function createStorage(initial = {}) {
    const state = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return state.has(String(key)) ? state.get(String(key)) : null;
        },
        setItem(key, value) {
            state.set(String(key), String(value));
        },
        removeItem(key) {
            state.delete(String(key));
        }
    };
}

function createAdminPaymentsRuntime(fetchImpl, options = {}) {
    const source = fs.readFileSync(adminPaymentsPath, 'utf8');
    const elements = {};

    function registerElement(id, classes = [], dataset = {}) {
        const element = new FakeElement({ id, classes, dataset });
        elements[id] = element;
        return element;
    }

    const modulePayments = registerElement('module-payments', ['module-container', 'active']);
    const toolbarRight = registerElement('paymentsToolbarRight');
    const toolbarMeta = registerElement('paymentsToolbarMeta');
    toolbarRight.appendChild(toolbarMeta);

    const tabsNav = registerElement('paymentsTabsNav');
    tabsNav.appendChild(new FakeElement({ classes: ['admin-tab', 'active'], dataset: { tab: 'overview' } }));
    tabsNav.appendChild(new FakeElement({ classes: ['admin-tab'], dataset: { tab: 'finance' } }));
    tabsNav.appendChild(new FakeElement({ classes: ['admin-tab'], dataset: { tab: 'ops' } }));

    registerElement('payments-tab-overview', ['payments-tab-content', 'active']);
    registerElement('payments-tab-finance', ['payments-tab-content']);
    registerElement('payments-tab-ops', ['payments-tab-content']);

    [
        'paymentsRefreshBtn',
        'paymentsAutoRefreshToggle',
        'paymentsRangeLabel',
        'paymentsRangeMeta',
        'paymentsCustomStartDate',
        'paymentsCustomEndDate',
        'paymentsToolbarHighlights',
        'paymentsAccessState',
        'paymentsDashboardBody',
        'paymentsOverviewGrid',
        'paymentsRefundAlertsPanel',
        'paymentsRefundAlertsMeta',
        'paymentsRefundAlerts',
        'paymentsProviderStats',
        'paymentsTrendChart',
        'paymentsTrendLegend',
        'paymentsSitewideGrid',
        'paymentsBusinessBreakdown',
        'paymentsPointsBreakdown',
        'paymentsOpsAlertQueuePanel',
        'paymentsOpsAlertQueueMeta',
        'paymentsOpsAlertQueue',
        'paymentsExceptionTopics',
        'paymentsExceptionTopicList',
        'paymentsAnomalyList',
        'paymentsOrdersTable',
        'paymentsCleanupPreview',
        'paymentsWorkbenchContext',
        'paymentsIssueSummary',
        'paymentsPrioritySummary',
        'paymentsCleanupBtn',
        'paymentsCleanupPreviewBtn'
    ].forEach((id) => {
        if (!elements[id]) {
            registerElement(id);
        }
    });

    const document = {
        getElementById(id) {
            return elements[id] || null;
        },
        querySelectorAll(selector) {
            if (selector === '.payments-tab-content') {
                return [
                    elements['payments-tab-overview'],
                    elements['payments-tab-finance'],
                    elements['payments-tab-ops']
                ];
            }
            if (selector === '.payments-range-btn') {
                return [];
            }
            return [];
        },
        querySelector(selector) {
            if (selector === '.module-container.active') {
                return modulePayments;
            }
            return null;
        },
        addEventListener() {}
    };

    const localStorage = createStorage();
    const window = {
        isAdmin: true,
        localStorage,
        document,
        showToast() {},
        prompt() { return ''; },
        confirm() { return true; },
        dispatchEvent() { return true; },
        addEventListener() {},
        removeEventListener() {},
        setTimeout(handler) {
            if (options.runTimeoutsImmediately && typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        clearTimeout() {},
        setInterval(handler) {
            if (options.runIntervalsImmediately && typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        clearInterval() {},
        getComputedStyle() {
            return { display: 'block' };
        }
    };

    if (options.runIdleImmediately) {
        window.requestIdleCallback = (handler) => {
            if (typeof handler === 'function') {
                handler();
            }
            return 1;
        };
        window.cancelIdleCallback = () => {};
    }

    window.window = window;
    window.fetch = fetchImpl;

    const context = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        document,
        window,
        localStorage,
        fetch: fetchImpl,
        Event: function Event(type) {
            this.type = type;
        },
        URL,
        URLSearchParams,
        globalThis: window
    };

    vm.runInNewContext(source, context);

    return {
        window,
        elements
    };
}

function createJsonResponse(payload) {
    return {
        ok: true,
        status: 200,
        async json() {
            return payload;
        }
    };
}

async function flushMicrotasks(rounds = 6) {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
}

test('payments ops tab auto-recovers after switching during initial overview load', async () => {
    const fetchCalls = [];
    let releaseOverviewDeferred;
    const overviewDeferred = new Promise((resolve) => {
        releaseOverviewDeferred = resolve;
    });

    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        fetchCalls.push(`${parsedUrl.pathname}?${parsedUrl.searchParams.toString()}`);

        if (parsedUrl.pathname === '/api/admin/payments/cleanup') {
            return createJsonResponse({
                success: true,
                preview: {
                    counts: {
                        payment_orders: 1,
                        payment_events: 0,
                        afdian_orders: 0,
                        auth_users: 0
                    },
                    samples: {
                        orders: [
                            {
                                provider_order_no: 'AUTO_CDX_ORDER_1',
                                status: 'paid',
                                created_at: '2026-04-18T12:00:00.000Z'
                            }
                        ],
                        users: []
                    }
                }
            });
        }

        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';

        if (view === 'overview' && scope === 'core') {
            return createJsonResponse({
                success: true,
                overview: {
                    total_orders: 1,
                    paid_orders: 1,
                    paid_rate: 100,
                    total_amount: 92,
                    total_points: 920
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    unclaimed_paid_orders: 0
                },
                session_summary: {
                    total_sessions: 0,
                    match_rate: 0
                },
                query_summary: {
                    total_attempts: 0,
                    failed_attempts: 0
                }
            });
        }

        if (view === 'overview' && (scope === 'secondary' || scope === 'ops')) {
            await overviewDeferred;
            return createJsonResponse({
                success: true,
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    open_cases: 0
                },
                provider_stats: [],
                trend_24h: [],
                refund_alert_topics: [],
                refund_alert_items: [],
                ops_alert_summary: {
                    total: 0,
                    pending: 0,
                    retry: 0,
                    processing: 0,
                    dead_letter: 0,
                    handled: 0,
                    ignored: 0
                },
                ops_alert_items: []
            });
        }

        if (view === 'ops') {
            return createJsonResponse({
                success: true,
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 1,
                    open_cases: 1
                },
                ops_alert_summary: {
                    total: 1,
                    pending: 1,
                    retry: 0,
                    processing: 0,
                    dead_letter: 0,
                    handled: 0,
                    ignored: 0
                },
                ops_alert_items: [
                    {
                        type: 'ops_alert_job',
                        id: 'ops_1',
                        queue_status: 'pending',
                        ops_status: 'pending',
                        title: '支付告警待处理',
                        message: '需要人工确认告警渠道。',
                        severity: 'warning',
                        created_at: '2026-04-18T12:00:00.000Z',
                        channels: ['telegram'],
                        remaining_channels: ['telegram'],
                        ops_available_actions: ['mark_handled']
                    }
                ],
                exception_topics: [
                    {
                        key: 'checkout_unlinked',
                        label: '未回填专题',
                        severity: 'warning',
                        description: '支付意图已完成但没有关联订单。',
                        count: 1
                    }
                ],
                exception_topic_items: [
                    {
                        type: 'session',
                        id: 'topic_1',
                        topic_key: 'checkout_unlinked',
                        title: '支付意图已完成但未回填',
                        message: '需要人工补查回填链路。',
                        severity: 'warning',
                        created_at: '2026-04-18T12:00:00.000Z',
                        ops_status: 'open',
                        ops_available_actions: ['mark_handled']
                    }
                ],
                recent_anomalies: [
                    {
                        type: 'session',
                        id: 'anomaly_1',
                        title: '未回填异常',
                        message: '当前订单没有成功关联支付意图。',
                        severity: 'warning',
                        provider: 'mock',
                        provider_order_no: 'ORD-1',
                        created_at: '2026-04-18T12:00:00.000Z',
                        ops_status: 'open',
                        ops_available_actions: ['mark_handled']
                    }
                ],
                recent_orders: [
                    {
                        id: 'order_1',
                        provider: 'mock',
                        provider_order_no: 'ORD-1',
                        package_name: '月付套餐',
                        paid_amount: 92,
                        points_amount: 920,
                        status: 'paid',
                        site: 'cn',
                        created_at: '2026-04-18T12:00:00.000Z',
                        claimed_at: null,
                        order_available_actions: []
                    }
                ]
            });
        }

        throw new Error(`Unexpected fetch: ${url}`);
    };

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl);

    const initPromise = window.AdminPayments.init();
    await flushMicrotasks();
    assert.equal(
        fetchCalls.some((call) => call.includes('view=overview') && call.includes('scope=core')),
        true,
        'initial overview request should start first'
    );

    window.AdminPayments.switchTab('ops');
    assert.equal(elements['payments-tab-ops'].classList.contains('active'), true);

    releaseOverviewDeferred();
    await initPromise;

    assert.equal(
        fetchCalls.some((call) => call.includes('view=ops')),
        true,
        'ops summary should auto-reload after the overview request finishes'
    );
    assert.match(elements['paymentsOpsAlertQueue'].innerHTML, /支付告警待处理/);
    assert.match(elements['paymentsExceptionTopics'].innerHTML, /全部专题/);
    assert.match(elements['paymentsAnomalyList'].innerHTML, /未回填异常/);
    assert.match(elements['paymentsOrdersTable'].innerHTML, /ORD-1/);
    assert.match(elements['paymentsCleanupPreview'].innerHTML, /AUTO_CDX_ORDER_1/);
});

test('payments overview warm-load does not clobber prefetched ops data with empty overview payloads', async () => {
    let releaseOverviewDeferred;
    const overviewDeferred = new Promise((resolve) => {
        releaseOverviewDeferred = resolve;
    });

    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';

        if (view === 'overview' && scope === 'core') {
            return createJsonResponse({
                success: true,
                overview: {
                    total_orders: 1,
                    paid_orders: 1,
                    paid_rate: 100,
                    total_amount: 92,
                    total_points: 920
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    unclaimed_paid_orders: 0
                },
                session_summary: {
                    total_sessions: 0,
                    match_rate: 0
                },
                query_summary: {
                    total_attempts: 0,
                    failed_attempts: 0
                },
                ops_alert_summary: null,
                ops_alert_items: null,
                exception_topics: [],
                exception_topic_items: [],
                recent_anomalies: [],
                recent_orders: []
            });
        }

        if (view === 'overview' && (scope === 'secondary' || scope === 'ops')) {
            await overviewDeferred;
            return createJsonResponse({
                success: true,
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    open_cases: 0
                },
                provider_stats: [],
                trend_24h: [],
                refund_alert_topics: [],
                refund_alert_items: [],
                ops_alert_summary: {
                    total: 0,
                    pending: 0,
                    retry: 0,
                    processing: 0,
                    dead_letter: 0,
                    handled: 0,
                    ignored: 0
                },
                ops_alert_items: [],
                exception_topics: [],
                exception_topic_items: [],
                recent_anomalies: [],
                recent_orders: []
            });
        }

        if (view === 'ops') {
            return createJsonResponse({
                success: true,
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 1,
                    open_cases: 1
                },
                ops_alert_summary: {
                    total: 1,
                    pending: 1,
                    retry: 0,
                    processing: 0,
                    dead_letter: 0,
                    handled: 0,
                    ignored: 0
                },
                ops_alert_items: [
                    {
                        type: 'ops_alert_job',
                        id: 'ops_prefetch_1',
                        queue_status: 'pending',
                        ops_status: 'pending',
                        title: '预热告警仍在队列',
                        message: '模拟模块预取拿到的站外告警。',
                        severity: 'warning',
                        created_at: '2026-04-18T12:00:00.000Z',
                        channels: ['telegram'],
                        remaining_channels: ['telegram'],
                        ops_available_actions: ['mark_handled']
                    }
                ],
                exception_topics: [
                    {
                        key: 'checkout_unlinked',
                        label: '未回填专题',
                        severity: 'warning',
                        description: '支付意图已完成但没有关联订单。',
                        count: 1
                    }
                ],
                exception_topic_items: [
                    {
                        type: 'session',
                        id: 'topic_prefetch_1',
                        topic_key: 'checkout_unlinked',
                        title: '预热专题仍可见',
                        message: 'overview 空响应不应该把这里覆盖掉。',
                        severity: 'warning',
                        created_at: '2026-04-18T12:00:00.000Z',
                        ops_status: 'open',
                        ops_available_actions: ['mark_handled']
                    }
                ],
                recent_anomalies: [
                    {
                        type: 'session',
                        id: 'anomaly_prefetch_1',
                        title: '预热异常仍可见',
                        message: 'overview 空响应不应该把这里覆盖掉。',
                        severity: 'warning',
                        provider: 'mock',
                        provider_order_no: 'ORD-PREFETCH-1',
                        created_at: '2026-04-18T12:00:00.000Z',
                        ops_status: 'open',
                        ops_available_actions: ['mark_handled']
                    }
                ],
                recent_orders: [
                    {
                        id: 'order_prefetch_1',
                        provider: 'mock',
                        provider_order_no: 'ORD-PREFETCH-1',
                        package_name: '月付套餐',
                        paid_amount: 92,
                        points_amount: 920,
                        status: 'paid',
                        site: 'cn',
                        created_at: '2026-04-18T12:00:00.000Z',
                        claimed_at: null,
                        order_available_actions: []
                    }
                ]
            });
        }

        if (parsedUrl.pathname === '/api/admin/payments/cleanup') {
            return createJsonResponse({
                success: true,
                preview: {
                    counts: {
                        payment_orders: 0,
                        payment_events: 0,
                        afdian_orders: 0,
                        auth_users: 0
                    },
                    samples: {
                        orders: [],
                        users: []
                    }
                }
            });
        }

        throw new Error(`Unexpected fetch: ${url}`);
    };

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl, {
        runIdleImmediately: true
    });

    const initPromise = window.AdminPayments.init();
    await flushMicrotasks();

    await window.AdminPayments.scheduleTabPrefetch('overview');
    releaseOverviewDeferred();
    await initPromise;

    window.AdminPayments.switchTab('ops', { reload: false });

    assert.match(elements['paymentsOpsAlertQueue'].innerHTML, /预热告警仍在队列/);
    assert.match(elements['paymentsExceptionTopics'].innerHTML, /未回填专题/);
    assert.match(elements['paymentsAnomalyList'].innerHTML, /预热异常仍可见/);
    assert.match(elements['paymentsOrdersTable'].innerHTML, /ORD-PREFETCH-1/);
});
