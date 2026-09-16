const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    DEFAULT_GUEST_SHOP_MONITOR_CONFIG,
    GUEST_SHOP_ALERT_TYPES,
    GUEST_SHOP_ORDER_MONITOR_COLUMNS,
    GUEST_SHOP_PAYMENT_MONITOR_COLUMNS,
    GUEST_SHOP_RESERVATION_MONITOR_COLUMNS,
    buildGuestShopMonitorAlerts,
    classifyGuestShopMonitorOrder,
    computeGuestShopMonitorMetrics,
    normalizeGuestShopMonitorConfig,
    percentile,
    runGuestShopAlertSweep
} = require('../api/_lib/guest-shop-alerts');

const NOW = new Date('2026-09-14T12:00:00.000Z');

function minutesAgo(minutes) {
    return new Date(NOW.getTime() - Number(minutes) * 60 * 1000).toISOString();
}

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        payload: null,
        range: null,
        single: false,
        maybeSingle: false
    };

    const builder = {
        select() { return builder; },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        lte(column, value) {
            state.filters.push({ op: 'lte', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, ascending: options.ascending !== false };
            return builder;
        },
        range(from, to) {
            state.range = { from, to };
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
            state.single = true;
            state.maybeSingle = true;
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function compareValue(left, right) {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') return row[column] === value;
        if (op === 'gte') return compareValue(row[column], value) >= 0;
        if (op === 'lte') return compareValue(row[column], value) <= 0;
        if (op === 'in') return Array.isArray(value) ? value.includes(row[column]) : false;
        return true;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) return rows.slice();
    return rows.slice().sort((left, right) => (
        order.ascending
            ? compareValue(left[order.column], right[order.column])
            : compareValue(right[order.column], left[order.column])
    ));
}

function applyRange(rows, range) {
    if (!range) return rows;
    return rows.slice(range.from, range.to + 1);
}

function createSupabaseStub(state = {}) {
    const jobs = state.jobs || [];
    const orders = state.orders || [];
    const payments = state.payments || [];
    const reservations = state.reservations || [];
    const cases = state.cases || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'guest_shop_orders' && query.mode === 'select') {
                    return { data: applyRange(sortRows(applyFilters(orders, query.filters), query.order), query.range), error: null };
                }
                if (table === 'guest_shop_payment_orders' && query.mode === 'select') {
                    return { data: applyRange(sortRows(applyFilters(payments, query.filters), query.order), query.range), error: null };
                }
                if (table === 'guest_shop_inventory_reservations' && query.mode === 'select') {
                    return { data: applyRange(sortRows(applyFilters(reservations, query.filters), query.order), query.range), error: null };
                }
                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    return { data: applyRange(sortRows(applyFilters(jobs, query.filters), query.order), query.range), error: null };
                }
                if (table === 'ops_alert_jobs' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `job-${jobs.length + index + 1}`,
                        created_at: row.created_at || NOW.toISOString(),
                        ...row
                    }));
                    inserted.forEach((row) => jobs.push({ ...row }));
                    return { data: query.single ? inserted[0] : inserted, error: null };
                }
                if (table === 'ops_alert_cases' && query.mode === 'select') {
                    return { data: query.maybeSingle ? null : [], error: null };
                }
                throw new Error(`Unexpected table access: ${table}/${query.mode}`);
            });
        }
    };
}

function createOpsRuntime(overrides = {}) {
    return {
        config: normalizeOpsAlertsConfig({
            enabled: true,
            channels: {
                telegram: { enabled: true, minimum_severity: 'warning', chat_ids: ['10001'] },
                feishu: { enabled: true, minimum_severity: 'warning' }
            },
            ...(overrides.config && typeof overrides.config === 'object' ? overrides.config : {})
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
            ...(overrides.secrets && typeof overrides.secrets === 'object' ? overrides.secrets : {})
        }
    };
}

function makeOrder(overrides = {}) {
    return {
        id: overrides.id || 'ord-1',
        order_no: overrides.order_no || 'GCN202609140001',
        site: 'cn',
        currency: 'CNY',
        product_id: 'prod-1',
        sku_id: 'sku-1',
        snapshot_product_name: '内部测试卡',
        snapshot_sku_name: '默认',
        quantity: 1,
        unit_amount: 9.9,
        total_amount: 9.9,
        payment_status: 'confirmed',
        reservation_status: 'consumed',
        fulfillment_status: 'pending',
        refund_status: 'none',
        paid_at: minutesAgo(20),
        fulfilled_at: null,
        metadata: {},
        created_at: minutesAgo(30),
        updated_at: minutesAgo(15),
        ...overrides
    };
}

test('monitor select lists never include secrets or card content', () => {
    const source = fs.readFileSync(path.join(__dirname, '../api/_lib/guest-shop-alerts.js'), 'utf8');
    assert.match(source, /source: 'guest_shop_monitor'/);
    assert.doesNotMatch(source, /shop_order_delivery/);
    assert.doesNotMatch(GUEST_SHOP_ORDER_MONITOR_COLUMNS, /claim_secret|recovery_code/);
    assert.doesNotMatch(GUEST_SHOP_PAYMENT_MONITOR_COLUMNS, /claim_secret|recovery_code|response_payload/);
    assert.doesNotMatch(GUEST_SHOP_RESERVATION_MONITOR_COLUMNS, /claim_secret|content/);
    assert.match(source, /skipSummary: true/);
    assert.equal(GUEST_SHOP_ALERT_TYPES.includes('guest_shop_paid_unfulfilled'), true);
});

test('normalizeGuestShopMonitorConfig reads env defaults without ops-alerts runtime config', () => {
    const config = normalizeGuestShopMonitorConfig({}, {
        GUEST_SHOP_MONITOR_SWEEP_INTERVAL_MS: '30000',
        GUEST_SHOP_MONITOR_PAID_UNFULFILLED_PERSIST_MINUTES: '12'
    });
    assert.equal(config.enabled, true);
    assert.equal(config.sweep_interval_ms, 30000);
    assert.equal(config.paid_unfulfilled_persist_minutes, 12);
    assert.equal(config.fulfillment_p95_seconds, DEFAULT_GUEST_SHOP_MONITOR_CONFIG.fulfillment_p95_seconds);
});

test('paid unfulfilled waits 10 minutes and still counts paid_unfulfillable', () => {
    const fresh = makeOrder({
        id: 'fresh',
        order_no: 'FRESH',
        paid_at: minutesAgo(4),
        fulfillment_status: 'fulfilling'
    });
    const stale = makeOrder({
        id: 'stale',
        order_no: 'STALE',
        paid_at: minutesAgo(11),
        fulfillment_status: 'paid_unfulfillable'
    });
    const delivered = makeOrder({
        id: 'done',
        order_no: 'DONE',
        fulfillment_status: 'delivered',
        fulfilled_at: minutesAgo(1)
    });
    const { metrics, alerts } = buildGuestShopMonitorAlerts([fresh, stale, delivered], [], [], {}, { now: NOW });
    assert.equal(metrics.paid_unfulfilled_count, 1);
    assert.equal(alerts.some((item) => item.alertType === 'guest_shop_paid_unfulfilled'), true);
    assert.deepEqual(alerts.find((item) => item.alertType === 'guest_shop_paid_unfulfilled').payload.order_nos, ['STALE']);
    assert.equal(classifyGuestShopMonitorOrder(stale, null, NOW.getTime()).paid_unfulfillable, true);
});

test('amount mismatch, review and dead letter alert immediately', () => {
    const { alerts } = buildGuestShopMonitorAlerts([
        makeOrder({ id: 'm1', order_no: 'MISMATCH', payment_status: 'amount_mismatch', fulfillment_status: 'pending' }),
        makeOrder({ id: 'r1', order_no: 'REVIEW', payment_status: 'review', fulfillment_status: 'pending' }),
        makeOrder({ id: 'd1', order_no: 'DEAD', fulfillment_status: 'dead_letter' })
    ], [], [], {}, { now: NOW });

    const types = alerts.map((item) => item.alertType).sort();
    assert.deepEqual(types, [
        'guest_shop_amount_mismatch',
        'guest_shop_dead_letter',
        'guest_shop_paid_unfulfilled',
        'guest_shop_payment_review'
    ].sort());
    assert.equal(alerts.find((item) => item.alertType === 'guest_shop_dead_letter').severity, 'critical');
});

test('refund hanging uses metadata queued_at then updated_at, and escalates after 2 hours', () => {
    const pendingWarn = makeOrder({
        id: 'rw',
        order_no: 'REFUND-WARN',
        refund_status: 'pending',
        updated_at: minutesAgo(10),
        metadata: { refund_queued_at: minutesAgo(45) }
    });
    const pendingCrit = makeOrder({
        id: 'rc',
        order_no: 'REFUND-CRIT',
        refund_status: 'pending',
        updated_at: minutesAgo(200)
    });
    const failed = makeOrder({
        id: 'rf',
        order_no: 'REFUND-FAIL',
        refund_status: 'failed'
    });
    const { metrics, alerts } = buildGuestShopMonitorAlerts([pendingWarn, pendingCrit, failed], [], [], {}, { now: NOW });
    assert.equal(metrics.refund_hanging_count, 3);
    assert.equal(metrics.refund_hanging_critical_count, 2);
    const alert = alerts.find((item) => item.alertType === 'guest_shop_refund_hanging');
    assert.equal(alert.severity, 'critical');
});

test('reservation expired alerts only when 15-minute window exceeds 5', () => {
    const reservations = Array.from({ length: 6 }, (_, index) => ({
        id: `res-${index}`,
        order_id: `ord-exp-${index}`,
        status: 'held',
        reserved_until: minutesAgo(3 + index),
        order_no: `EXP${index}`
    }));
    const below = buildGuestShopMonitorAlerts([], [], reservations.slice(0, 5), {}, { now: NOW });
    assert.equal(below.metrics.reservation_expired_count, 5);
    assert.equal(below.alerts.some((item) => item.alertType === 'guest_shop_reservation_expired'), false);

    const orders = reservations.map((row) => makeOrder({ id: row.order_id, order_no: row.order_no, payment_status: 'pending' }));
    const above = buildGuestShopMonitorAlerts(orders, [], reservations, {}, { now: NOW });
    assert.equal(above.metrics.reservation_expired_count, 6);
    const alert = above.alerts.find((item) => item.alertType === 'guest_shop_reservation_expired');
    assert.ok(alert);
    assert.equal(alert.payload.order_nos.length <= 5, true);
});

test('fulfillment latency uses 24h delivered samples with P95/P99 thresholds', () => {
    const samples = [10, 20, 30, 40, 400];
    const orders = samples.map((seconds, index) => makeOrder({
        id: `lat-${index}`,
        order_no: `LAT${index}`,
        fulfillment_status: 'delivered',
        paid_at: minutesAgo(30),
        fulfilled_at: new Date(NOW.getTime() - (30 * 60 * 1000) + seconds * 1000).toISOString()
    }));
    assert.equal(percentile(samples, 95), 400);
    const { metrics, alerts } = buildGuestShopMonitorAlerts(orders, [], [], {}, { now: NOW });
    assert.equal(metrics.fulfillment_sample_count, 5);
    assert.ok(metrics.fulfillment_p95_seconds > 120);
    const alert = alerts.find((item) => item.alertType === 'guest_shop_fulfillment_latency');
    assert.ok(alert);
    assert.equal(alert.severity, 'critical');
});

test('runGuestShopAlertSweep still computes metrics when ops alerts are disabled', async () => {
    const supabase = createSupabaseStub({
        orders: [makeOrder({ order_no: 'UNFUL', paid_at: minutesAgo(15), fulfillment_status: 'failed' })]
    });
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => { logs.push(args.map(String).join(' ')); };
    try {
        const result = await runGuestShopAlertSweep(supabase, {
            runtime: createOpsRuntime({ config: { enabled: false } }),
            now: NOW
        });
        assert.equal(result.skipped, 'ops_alerts_disabled');
        assert.equal(result.paid_unfulfilled_count, 1);
        assert.equal(result.queued, 0);
        assert.equal(result.source, 'guest_shop_monitor');
        assert.equal(logs.some((line) => line.includes('paid_unfulfilled_count')), true);
    } finally {
        console.log = originalLog;
    }
});

test('runGuestShopAlertSweep enqueues aggregated alerts with stable dedupe and skipSummary', async () => {
    const state = {
        orders: [
            makeOrder({ id: 'a', order_no: 'AAA', paid_at: minutesAgo(20), fulfillment_status: 'failed' }),
            makeOrder({ id: 'b', order_no: 'BBB', payment_status: 'amount_mismatch' }),
            makeOrder({ id: 'c', order_no: 'CCC', fulfillment_status: 'dead_letter' })
        ],
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const first = await runGuestShopAlertSweep(supabase, {
        runtime: createOpsRuntime(),
        now: NOW
    });
    assert.ok(first.queued >= 2);
    assert.equal(state.jobs.every((job) => job.source === 'guest_shop_monitor'), true);
    assert.equal(state.jobs.some((job) => job.alert_type === 'guest_shop_paid_unfulfilled'), true);
    assert.equal(JSON.stringify(state.jobs).includes('claim_secret'), false);
    assert.equal(JSON.stringify(state.jobs).includes('recovery_code'), false);

    const second = await runGuestShopAlertSweep(supabase, {
        runtime: createOpsRuntime(),
        now: NOW
    });
    assert.equal(second.queued, 0);
    assert.ok(second.deduped >= 1);
});

test('monitor disabled short-circuits without querying tables', async () => {
    const supabase = {
        from() {
            throw new Error('should not query when disabled');
        }
    };
    const result = await runGuestShopAlertSweep(supabase, {
        config: { enabled: false },
        now: NOW
    });
    assert.equal(result.skipped, 'monitor_disabled');
    assert.equal(result.queued, 0);
});
