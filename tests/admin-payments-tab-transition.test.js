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
    const timingMarks = [];
    const timingMeasures = [];

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
        AdminStudioTiming: options.captureTiming ? {
            mark(name, detail = {}) {
                timingMarks.push({ name, detail: { ...detail } });
            },
            measure(name, startName, endName, detail = {}) {
                timingMeasures.push({ name, startName, endName, detail: { ...detail } });
            }
        } : null,
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
        elements,
        timingMarks,
        timingMeasures
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
                        provider: 'mock',
                        session_key: 'PCS_TOPIC_1',
                        user_id: 'user_1',
                        user_email: 'intent-buyer@example.com',
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
                        user_id: 'user_1',
                        user_email: 'intent-buyer@example.com',
                        title: '未回填异常',
                        message: '当前订单没有成功关联支付意图。',
                        severity: 'warning',
                        provider: 'mock',
                        session_key: 'PCS_ANOMALY_1',
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
                        user_id: 'user_1',
                        user_email: 'buyer@example.com',
                        provider_order_no: 'ZPEC42F46329738A87345986347A2438',
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
    assert.match(elements['paymentsExceptionTopics'].innerHTML, /支付意图异常/);
    assert.match(elements['paymentsExceptionTopicList'].innerHTML, /发起人邮箱/);
    assert.match(elements['paymentsExceptionTopicList'].innerHTML, /intent-buyer@example\.com/);
    assert.match(elements['paymentsAnomalyList'].innerHTML, /未回填异常/);
    assert.match(elements['paymentsAnomalyList'].innerHTML, /intent-buyer@example\.com/);
    assert.match(elements['paymentsOrdersTable'].innerHTML, /buyer@example\.com/);
    assert.match(elements['paymentsOrdersTable'].innerHTML, /analytics-open-user-detail/);
    assert.match(elements['paymentsOrdersTable'].innerHTML, /ZPEC42F4\.\.\.7A2438/);
    assert.match(elements['paymentsOrdersTable'].innerHTML, /payments-copy-order-no/);
    assert.match(elements['paymentsCleanupPreview'].innerHTML, /AUTO_CDX_ORDER_1/);
});

test('payments overview warm-load keeps full ops tab data on demand', async () => {
    const fetchCalls = [];
    let releaseOverviewDeferred;
    const overviewDeferred = new Promise((resolve) => {
        releaseOverviewDeferred = resolve;
    });

    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        fetchCalls.push(`${parsedUrl.pathname}?${parsedUrl.searchParams.toString()}`);
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
    assert.equal(
        fetchCalls.some((call) => call.includes('view=ops')),
        false,
        'overview warm-load should not eagerly fetch the full ops tab'
    );
    releaseOverviewDeferred();
    await initPromise;

    assert.equal(
        fetchCalls.some((call) => call.includes('view=ops')),
        false,
        'overview staged loading should finish without full ops tab prefetch'
    );

    window.AdminPayments.switchTab('ops');
    await flushMicrotasks(10);

    assert.match(elements['paymentsOpsAlertQueue'].innerHTML, /预热告警仍在队列/);
    assert.match(elements['paymentsExceptionTopics'].innerHTML, /未回填专题/);
    assert.match(elements['paymentsAnomalyList'].innerHTML, /预热异常仍可见/);
    assert.match(elements['paymentsOrdersTable'].innerHTML, /ORD-PREFETCH-1/);
});

test('payments overview initialization resolves after core while staged scopes keep loading', async () => {
    const fetchCalls = [];
    let releaseOverviewDeferred;
    const overviewDeferred = new Promise((resolve) => {
        releaseOverviewDeferred = resolve;
    });

    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        fetchCalls.push(`${parsedUrl.pathname}?${parsedUrl.searchParams.toString()}`);
        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';

        if (view === 'overview' && scope === 'core') {
            return createJsonResponse({
                success: true,
                overview_scope: 'core',
                overview: {
                    total_orders: 2,
                    paid_orders: 2,
                    paid_rate: 100,
                    total_amount: 128,
                    total_points: 1280
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    unclaimed_paid_orders: 0
                },
                session_summary: {
                    total_sessions: 2,
                    match_rate: 100
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
                overview_scope: scope,
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    duplicate_webhook_orders: 0,
                    session_anomalies: 0,
                    query_failures: 0,
                    refund_failures: 0,
                    refund_reclaim_failures: 0,
                    refund_compensation_failures: 0
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

        throw new Error(`Unexpected fetch: ${url}`);
    };

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl);
    let initResolved = false;
    const initPromise = window.AdminPayments.init().then(() => {
        initResolved = true;
    });
    const fastResult = await Promise.race([
        initPromise.then(() => 'resolved'),
        flushMicrotasks(40).then(() => 'pending')
    ]);

    assert.equal(fastResult, 'resolved', 'overview init should resolve after the core scope paints');
    assert.equal(initResolved, true, 'overview init should not wait for deferred scopes');
    assert.equal(
        fetchCalls.some((call) => call.includes('scope=secondary')),
        true,
        'overview should still start the secondary overlay request'
    );
    assert.equal(
        fetchCalls.some((call) => call.includes('scope=ops')),
        true,
        'overview should still start the ops overlay request'
    );
    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常补充中/);

    releaseOverviewDeferred();
    await initPromise;
    await flushMicrotasks(10);

    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常 0/);
});

test('payments command center prime uses overview core and ops scopes without full init', async () => {
    const fetchCalls = [];
    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        fetchCalls.push(`${parsedUrl.pathname}?${parsedUrl.searchParams.toString()}`);
        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';
        const prefetch = parsedUrl.searchParams.get('prefetch') || '';

        if (view === 'overview' && scope === 'core' && prefetch === '1') {
            return createJsonResponse({
                success: true,
                overview_scope: 'core',
                overview: {
                    paid_rate: 96.5
                },
                anomaly_summary: {
                    review_orders: 2,
                    failed_orders: 1
                },
                ops_alert_summary: null,
                ops_alert_items: null
            });
        }

        if (view === 'overview' && scope === 'ops' && prefetch === '1') {
            return createJsonResponse({
                success: true,
                overview_scope: 'ops',
                ops_alert_summary: {
                    pending: 1,
                    retry: 3,
                    processing: 0,
                    dead_letter: 1,
                    actionable_count: 5
                },
                ops_alert_items: [
                    {
                        id: 'ops-1',
                        queue_status: 'retry',
                        title: '回调等待重试',
                        created_at: '2026-04-18T12:00:00.000Z'
                    }
                ]
            });
        }

        throw new Error(`Unexpected fetch: ${url}`);
    };

    const { window, timingMarks, timingMeasures } = createAdminPaymentsRuntime(fetchImpl, { captureTiming: true });
    const summary = await window.AdminPayments.primeCommandCenterSummary();
    await flushMicrotasks();

    assert.deepEqual(fetchCalls, [
        '/api/admin/payments/summary?view=overview&prefetch=1&scope=core&days=30',
        '/api/admin/payments/summary?view=overview&prefetch=1&scope=ops&days=30'
    ]);
    assert.equal(summary.ready, true);
    assert.equal(summary.paidRate, 96.5);
    assert.equal(summary.reviewOrders, 2);
    assert.equal(summary.failedOrders, 1);
    assert.equal(summary.retryCount, 3);
    assert.equal(summary.deadLetterCount, 1);
    assert.equal(summary.actionableCount, 8);
    assert.equal(summary.recentItems[0]?.copy, '回调等待重试');
    assert.equal(
        timingMarks.some((entry) => entry.name === 'payments:command-prime:start'),
        true,
        'payments prime should mark command summary start'
    );
    assert.equal(
        timingMarks.some((entry) => entry.name === 'payments:command-prime:end' && entry.detail.fulfilledCount === 2),
        true,
        'payments prime should mark command summary completion'
    );
    assert.equal(
        timingMeasures.some((entry) => entry.name === 'payments:command-prime'),
        true,
        'payments prime should measure command summary duration'
    );

    const cachedSummary = await window.AdminPayments.primeCommandCenterSummary();
    assert.equal(cachedSummary.actionableCount, 8);
    assert.equal(fetchCalls.length, 2);
    assert.equal(
        timingMarks.some((entry) => entry.name === 'payments:command-prime:cache-hit'),
        true,
        'cached payments prime should mark a cache hit'
    );
});

test('payments overview keeps callback topic count after visiting finance tab', async () => {
    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';

        if (view === 'overview' && scope === 'core') {
            return createJsonResponse({
                success: true,
                overview_scope: 'core',
                overview: {
                    total_orders: 31,
                    paid_orders: 29,
                    paid_rate: 93.55,
                    total_amount: 920.06,
                    total_points: 920
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    unclaimed_paid_orders: 0
                },
                session_summary: {
                    total_sessions: 31,
                    matched_sessions: 31,
                    order_match_rate: 100,
                    match_rate: 100
                },
                query_summary: {
                    total_attempts: 0,
                    failed_attempts: 0
                },
                refund_alert_items: null
            });
        }

        if (view === 'overview' && scope === 'secondary') {
            return createJsonResponse({
                success: true,
                overview_scope: 'secondary',
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    duplicate_webhook_orders: 19,
                    session_anomalies: 0,
                    query_failures: 0,
                    refund_failures: 0,
                    refund_reclaim_failures: 0,
                    refund_compensation_failures: 0
                },
                provider_stats: [],
                trend_24h: [],
                refund_alert_topics: [],
                refund_alert_items: []
            });
        }

        if (view === 'overview' && scope === 'ops') {
            return createJsonResponse({
                success: true,
                overview_scope: 'ops',
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

        if (view === 'finance') {
            return createJsonResponse({
                success: true,
                overview: {
                    total_orders: 41,
                    paid_orders: 29,
                    paid_rate: 70.73,
                    total_amount: 920.06,
                    total_points: 920
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    duplicate_webhook_orders: 0,
                    session_anomalies: 0,
                    query_failures: 0,
                    refund_failures: 0,
                    refund_reclaim_failures: 0,
                    refund_compensation_failures: 0
                },
                sitewide_summary: {
                    recharge_amount: 920.06,
                    recharge_points: 920,
                    shop_points_spent: 0,
                    refunded_shop_points: 0,
                    paid_balance: 0,
                    bonus_balance: 0
                },
                business_breakdown: [],
                points_breakdown: []
            });
        }

        throw new Error(`Unexpected fetch: ${url}`);
    };

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl);
    await window.AdminPayments.init();
    await flushMicrotasks(10);

    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常 19/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, /回调专题/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, />19</);

    window.AdminPayments.switchTab('finance');
    await flushMicrotasks(10);
    assert.match(elements['paymentsSitewideGrid'].innerHTML, /充值收入/);

    window.AdminPayments.switchTab('overview');

    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常 19/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, /回调专题/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, />19</);
    assert.doesNotMatch(elements['paymentsToolbarHighlights'].innerHTML, /异常 0/);
});

test('payments overview uses zero active ops topics over stale callback aggregate after ops tab is loaded', async () => {
    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';

        if (view === 'overview' && scope === 'core') {
            return createJsonResponse({
                success: true,
                overview_scope: 'core',
                overview: {
                    total_orders: 31,
                    paid_orders: 29,
                    paid_rate: 93.55,
                    total_amount: 920.06,
                    total_points: 920
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    unclaimed_paid_orders: 0
                },
                session_summary: {
                    total_sessions: 31,
                    matched_sessions: 31,
                    order_match_rate: 100,
                    match_rate: 100
                },
                query_summary: {
                    total_attempts: 0,
                    failed_attempts: 0
                },
                refund_alert_items: null
            });
        }

        if (view === 'overview' && scope === 'secondary') {
            return createJsonResponse({
                success: true,
                overview_scope: 'secondary',
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    duplicate_webhook_orders: 7,
                    session_anomalies: 12,
                    query_failures: 0,
                    refund_failures: 0,
                    refund_reclaim_failures: 0,
                    refund_compensation_failures: 0
                },
                provider_stats: [],
                trend_24h: [],
                refund_alert_topics: [],
                refund_alert_items: []
            });
        }

        if (view === 'overview' && scope === 'ops') {
            return createJsonResponse({
                success: true,
                overview_scope: 'ops',
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
                    failed_orders: 0,
                    open_cases: 0
                },
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

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl);
    await window.AdminPayments.init();
    await flushMicrotasks(10);

    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常 19/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, /回调专题/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, />19</);

    window.AdminPayments.switchTab('ops');
    await flushMicrotasks(10);
    assert.match(elements['paymentsExceptionTopics'].innerHTML, /全部专题/);
    assert.match(elements['paymentsExceptionTopics'].innerHTML, /0 项/);

    window.AdminPayments.switchTab('overview');

    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常 0/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, /回调专题/);
    assert.match(elements['paymentsOverviewGrid'].innerHTML, />0</);
    assert.doesNotMatch(elements['paymentsToolbarHighlights'].innerHTML, /异常 19/);
});

test('payments overview refresh does not flash stale refund anomaly aggregate while ops scope is still loading', async () => {
    let releaseOpsDeferred;
    const opsDeferred = new Promise((resolve) => {
        releaseOpsDeferred = resolve;
    });

    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';

        if (view === 'overview' && scope === 'core') {
            return createJsonResponse({
                success: true,
                overview_scope: 'core',
                overview: {
                    total_orders: 1,
                    paid_orders: 1,
                    paid_rate: 100,
                    total_amount: 920.06,
                    total_points: 920
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    unclaimed_paid_orders: 0
                },
                session_summary: {
                    total_sessions: 1,
                    order_match_rate: 100,
                    match_rate: 100
                },
                query_summary: {
                    total_attempts: 0,
                    failed_attempts: 0
                },
                refund_alert_items: null
            });
        }

        if (view === 'overview' && scope === 'secondary') {
            return createJsonResponse({
                success: true,
                overview_scope: 'secondary',
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    duplicate_webhook_orders: 0,
                    session_anomalies: 0,
                    query_failures: 0,
                    refund_failures: 8,
                    refund_reclaim_failures: 0,
                    refund_compensation_failures: 0
                },
                provider_stats: [],
                trend_24h: [],
                refund_alert_topics: [],
                refund_alert_items: []
            });
        }

        if (view === 'overview' && scope === 'ops') {
            await opsDeferred;
            return createJsonResponse({
                success: true,
                overview_scope: 'ops',
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

        throw new Error(`Unexpected fetch: ${url}`);
    };

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl);
    const initPromise = window.AdminPayments.init();
    await flushMicrotasks(10);

    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常补充中/);
    assert.doesNotMatch(elements['paymentsToolbarHighlights'].innerHTML, /异常 8/);

    releaseOpsDeferred();
    await initPromise;
    await flushMicrotasks(10);

    assert.match(elements['paymentsToolbarHighlights'].innerHTML, /异常 0/);
    assert.doesNotMatch(elements['paymentsToolbarHighlights'].innerHTML, /异常 8/);
});

test('payments cleanup preview fallback hides raw fetch-failed errors', async () => {
    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');

        if (parsedUrl.pathname === '/api/admin/payments/cleanup') {
            throw new Error('TypeError: fetch failed');
        }

        if (parsedUrl.pathname !== '/api/admin/payments/summary') {
            throw new Error(`Unexpected fetch: ${url}`);
        }

        const view = parsedUrl.searchParams.get('view') || 'overview';
        const scope = parsedUrl.searchParams.get('scope') || 'full';

        if (view === 'overview' && scope === 'core') {
            return createJsonResponse({
                success: true,
                overview_scope: 'core',
                overview: {
                    total_orders: 2,
                    paid_orders: 2,
                    paid_rate: 100,
                    total_amount: 184,
                    total_points: 1840
                },
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    unclaimed_paid_orders: 0
                },
                session_summary: {
                    total_sessions: 0,
                    match_rate: 100
                },
                query_summary: {
                    total_attempts: 0,
                    failed_attempts: 0
                }
            });
        }

        if (view === 'overview' && scope === 'secondary') {
            return createJsonResponse({
                success: true,
                overview_scope: 'secondary',
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    duplicate_webhook_orders: 0,
                    session_anomalies: 0,
                    query_failures: 0,
                    refund_failures: 0,
                    refund_reclaim_failures: 0,
                    refund_compensation_failures: 0
                },
                provider_stats: [],
                trend_24h: [],
                refund_alert_topics: [],
                refund_alert_items: []
            });
        }

        if (view === 'overview' && scope === 'ops') {
            return createJsonResponse({
                success: true,
                overview_scope: 'ops',
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

        throw new Error(`Unexpected summary fetch: ${url}`);
    };

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl);
    await window.AdminPayments.init();
    await window.AdminPayments.previewCleanup();

    assert.match(elements['paymentsCleanupPreview'].innerHTML, /测试数据扫描失败/);
    assert.doesNotMatch(elements['paymentsCleanupPreview'].innerHTML, /TypeError: fetch failed/);
});

test('payments issue summary renders a focused order spotlight for deep-linked orders', async () => {
    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url, 'https://example.com');
        if (parsedUrl.pathname !== '/api/admin/payments/summary') {
            throw new Error(`Unexpected fetch: ${url}`);
        }

        return createJsonResponse({
            success: true,
            anomaly_summary: {
                review_orders: 1,
                failed_orders: 0
            },
            ops_alert_summary: {
                total: 0,
                pending: 0,
                retry: 0,
                processing: 0,
                dead_letter: 0,
                handled: 0,
                ignored: 0
            },
            refund_alert_topics: [],
            refund_alert_items: [],
            ops_alert_items: [],
            exception_topics: [],
            exception_topic_items: [],
            recent_anomalies: [],
            recent_checkout_sessions: [],
            recent_orders: [
                {
                    id: 'pay_123',
                    provider_order_no: 'ZPAY-123',
                    package_name: 'Google One 月卡',
                    paid_amount: 29,
                    points_amount: 2900,
                    status: 'pending_review',
                    provider: 'zpay',
                    site: 'cn',
                    created_at: '2026-04-22T06:20:00.000Z',
                    claimed_at: '2026-04-22T06:25:00.000Z',
                    order_available_actions: ['approve_review', 'reject_review']
                }
            ]
        });
    };

    const { window, elements } = createAdminPaymentsRuntime(fetchImpl);
    window.buildOpsAlertWorkspaceAnalyticsSignalContextState = () => ({
        eyebrow: 'Payments Focus',
        title: '当前来自分析信号联动',
        summary: '支付工作台已按当前支付单聚焦。',
        chips: []
    });

    await window.openAdminPaymentsShellContext({
        focus: {
            paymentOrderId: 'pay_123'
        },
        payload: {
            paymentOrderId: 'pay_123',
            referenceLabel: '支付单',
            referenceValue: 'ZPAY-123',
            defaultTab: 'overview',
            tab: 'overview'
        }
    }, {
        defaultTab: 'overview',
        tab: 'overview'
    });
    await flushMicrotasks();

    assert.match(elements.paymentsIssueSummary.innerHTML, /已聚焦/);
    assert.match(elements.paymentsIssueSummary.innerHTML, /ZPAY-123/);
    assert.match(elements.paymentsIssueSummary.innerHTML, /Google One 月卡/);
    assert.match(elements.paymentsIssueSummary.innerHTML, /待审核/);
});

test('payments reopen keeps success feedback stable when workbench analytics context is active', async () => {
    const toasts = [];
    const recordedFeedback = [];
    const fetchImpl = async (url, options = {}) => {
        const parsedUrl = new URL(url, 'https://example.com');

        if (parsedUrl.pathname === '/api/admin/payments/actions') {
            const body = JSON.parse(options.body || '{}');
            assert.equal(body.targetType, 'session');
            assert.equal(body.targetId, 'topic_1');
            assert.equal(body.action, 'reopen');
            return createJsonResponse({
                success: true,
                message: '重新打开成功',
                reload: false
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
                    total_sessions: 1,
                    match_rate: 100
                },
                query_summary: {
                    total_attempts: 0,
                    failed_attempts: 0
                }
            });
        }

        if (view === 'overview' && scope === 'secondary') {
            return createJsonResponse({
                success: true,
                anomaly_summary: {
                    review_orders: 0,
                    failed_orders: 0,
                    open_cases: 1
                },
                provider_stats: [],
                trend_24h: [],
                refund_alert_topics: [],
                refund_alert_items: []
            });
        }

        if (view === 'overview' && scope === 'ops') {
            return createJsonResponse({
                success: true,
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
                        message: '需要重新打开后继续核查。',
                        severity: 'warning',
                        created_at: '2026-04-23T07:44:00.000Z',
                        ops_status: 'handled',
                        ops_available_actions: ['reopen']
                    }
                ],
                recent_anomalies: [],
                recent_orders: []
            });
        }

        throw new Error(`Unexpected fetch: ${url}`);
    };

    const { window } = createAdminPaymentsRuntime(fetchImpl);
    window.showToast = (message, tone) => {
        toasts.push({ message, tone });
    };
    window.recordAnalyticsResolutionFeedback = (payload) => {
        recordedFeedback.push(payload);
        return payload;
    };

    await window.AdminPayments.init();
    window.AdminPayments.showWorkbenchContext({
        productId: 'product_1',
        productName: '支付异常商品'
    });

    const result = await window.AdminPayments.handleAnomalyAction('session', 'topic_1', 'reopen');

    assert.equal(result?.message, '重新打开成功');
    assert.deepEqual(toasts, [
        { message: '重新打开成功', tone: 'success' }
    ]);
    assert.equal(recordedFeedback.length, 1);
    assert.equal(recordedFeedback[0].entityId, 'topic_1');
    assert.equal(recordedFeedback[0].statusKey, 'abnormal');
});
