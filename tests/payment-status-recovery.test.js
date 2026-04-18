const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getPaymentRequestStatus
} = require('../api/_lib/payments/orders');

function createQueryBuilder(state, table, mode, patch = null) {
    const query = {
        table,
        mode,
        patch,
        filters: [],
        orderBy: null,
        limitValue: null,
        singleMode: ''
    };

    const builder = {
        select() {
            return builder;
        },
        update(nextPatch) {
            query.mode = 'update';
            query.patch = nextPatch;
            return builder;
        },
        eq(column, value) {
            query.filters.push({ op: 'eq', column, value });
            return builder;
        },
        neq(column, value) {
            query.filters.push({ op: 'neq', column, value });
            return builder;
        },
        in(column, values) {
            query.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [values] });
            return builder;
        },
        is(column, value) {
            query.filters.push({ op: 'is', column, value });
            return builder;
        },
        gte(column, value) {
            query.filters.push({ op: 'gte', column, value });
            return builder;
        },
        order(column, options = {}) {
            query.orderBy = { column, ascending: options.ascending !== false };
            return builder;
        },
        limit(value) {
            query.limitValue = Number(value) || 0;
            return builder;
        },
        maybeSingle() {
            query.singleMode = 'maybeSingle';
            return builder;
        },
        single() {
            query.singleMode = 'single';
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executeQuery(state, query)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        const current = row?.[column];

        if (op === 'eq') return current === value;
        if (op === 'neq') return current !== value;
        if (op === 'in') return value.includes(current);
        if (op === 'is') return current === value;
        if (op === 'gte') return String(current || '') >= String(value || '');
        return true;
    }));
}

function sortRows(rows, orderBy) {
    if (!orderBy?.column) {
        return rows.slice();
    }

    const sorted = rows.slice().sort((left, right) => {
        const leftValue = left?.[orderBy.column];
        const rightValue = right?.[orderBy.column];
        return String(leftValue || '').localeCompare(String(rightValue || ''));
    });

    return orderBy.ascending ? sorted : sorted.reverse();
}

function finalizeRows(rows, query) {
    let output = sortRows(rows, query.orderBy);
    if (query.limitValue > 0) {
        output = output.slice(0, query.limitValue);
    }

    if (query.singleMode === 'single' || query.singleMode === 'maybeSingle') {
        return {
            data: output[0] || null,
            error: null
        };
    }

    return {
        data: output,
        error: null
    };
}

function executeQuery(state, query) {
    const rows = state[query.table];
    if (!Array.isArray(rows)) {
        throw new Error(`Unexpected table access: ${query.table}`);
    }

    const matchedRows = applyFilters(rows, query.filters);
    if (query.mode === 'update') {
        matchedRows.forEach((row) => {
            Object.assign(row, query.patch || {});
        });
    }

    return finalizeRows(matchedRows, query);
}

function createSupabaseStub(state) {
    return {
        from(table) {
            return createQueryBuilder(state, table, 'select');
        }
    };
}

test('getPaymentRequestStatus recovers completed zpay orders that were not linked back to the checkout session', async () => {
    const nowIso = new Date().toISOString();
    const state = {
        payment_checkout_sessions: [
            {
                id: 'pcs_zpay_1',
                user_id: 'user_zpay_1',
                provider: 'zpay',
                site: 'cn',
                package_id: null,
                package_name: '自定义充值',
                requested_points: 0.01,
                granted_points: 0.01,
                expected_amount: 0.01,
                payment_order_id: null,
                status: 'redirect_ready',
                error_message: null,
                created_at: nowIso,
                updated_at: nowIso,
                completed_at: null,
                session_key: 'PCS_ZPAY_RECOVERY_1',
                provider_metadata: {
                    provider_order_no: 'ZPAY_ORDER_1'
                }
            }
        ],
        payment_orders: [
            {
                id: 'po_zpay_1',
                user_id: null,
                provider: 'zpay',
                provider_order_no: 'ZPAY_ORDER_1',
                checkout_session_id: null,
                site: 'cn',
                package_id: null,
                package_name: '自定义充值',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                status: 'redeemed',
                last_error: null,
                created_at: nowIso,
                updated_at: nowIso,
                paid_at: nowIso,
                claimed_at: nowIso,
                verified_at: nowIso,
                raw_payload: {},
                provider_metadata: {}
            }
        ]
    };

    const payload = await getPaymentRequestStatus({
        supabase: createSupabaseStub(state),
        user: {
            id: 'user_zpay_1'
        },
        body: {
            checkout_session_id: 'pcs_zpay_1',
            site: 'cn'
        }
    });

    assert.equal(payload.success, true);
    assert.equal(payload.status, 'completed');
    assert.equal(payload.payment_order_id, 'po_zpay_1');
    assert.equal(payload.payment_order_status, 'redeemed');
    assert.equal(payload.refresh_wallet, true);
    assert.equal(state.payment_checkout_sessions[0].payment_order_id, 'po_zpay_1');
    assert.equal(state.payment_checkout_sessions[0].status, 'completed');
    assert.equal(state.payment_orders[0].user_id, 'user_zpay_1');
    assert.equal(state.payment_orders[0].checkout_session_id, 'pcs_zpay_1');
});

test('getPaymentRequestStatus can recover a zpay order from provider_order_no passed by the client when session metadata is stale', async () => {
    const nowIso = new Date().toISOString();
    const state = {
        payment_checkout_sessions: [
            {
                id: 'pcs_zpay_2',
                user_id: 'user_zpay_2',
                provider: 'zpay',
                site: 'cn',
                package_id: null,
                package_name: '自定义充值',
                requested_points: 0.01,
                granted_points: 0.01,
                expected_amount: 0.01,
                payment_order_id: null,
                status: 'redirect_ready',
                error_message: null,
                created_at: nowIso,
                updated_at: nowIso,
                completed_at: null,
                session_key: 'PCS_ZPAY_RECOVERY_2',
                provider_metadata: {}
            }
        ],
        payment_orders: [
            {
                id: 'po_zpay_2',
                user_id: 'user_zpay_2',
                provider: 'zpay',
                provider_order_no: 'ZPAY_ORDER_2',
                checkout_session_id: null,
                site: 'cn',
                package_id: null,
                package_name: '自定义充值',
                expected_amount: 0.01,
                paid_amount: 0.01,
                points_amount: 0.01,
                status: 'redeemed',
                last_error: null,
                created_at: nowIso,
                updated_at: nowIso,
                paid_at: nowIso,
                claimed_at: nowIso,
                verified_at: nowIso,
                raw_payload: {
                    checkout_session_id: 'pcs_zpay_2'
                },
                provider_metadata: {}
            }
        ]
    };

    const payload = await getPaymentRequestStatus({
        supabase: createSupabaseStub(state),
        user: {
            id: 'user_zpay_2'
        },
        body: {
            checkout_session_id: 'pcs_zpay_2',
            provider_order_no: 'ZPAY_ORDER_2',
            site: 'cn'
        }
    });

    assert.equal(payload.success, true);
    assert.equal(payload.status, 'completed');
    assert.equal(payload.payment_order_id, 'po_zpay_2');
    assert.equal(payload.provider_order_no, 'ZPAY_ORDER_2');
    assert.equal(state.payment_checkout_sessions[0].payment_order_id, 'po_zpay_2');
    assert.equal(state.payment_checkout_sessions[0].status, 'completed');
});
