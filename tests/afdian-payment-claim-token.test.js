const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPaymentRequest,
    verifyPaymentIntentClaimToken
} = require('../api/_lib/payments/orders');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        payload: null,
        filters: [],
        order: null,
        limit: null,
        single: false,
        maybeSingle: false
    };

    const builder = {
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [values] });
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, options };
            return builder;
        },
        limit(value) {
            state.limit = value;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
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

function applyFilters(rows, query) {
    let result = rows.filter((row) => query.filters.every((filter) => {
        if (filter.op === 'eq') {
            return row[filter.column] === filter.value;
        }
        if (filter.op === 'in') {
            return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
        }
        return false;
    }));

    if (query.order?.column) {
        const ascending = query.order.options?.ascending !== false;
        result = [...result].sort((left, right) => {
            const leftValue = left[query.order.column];
            const rightValue = right[query.order.column];
            if (leftValue === rightValue) return 0;
            if (leftValue == null) return 1;
            if (rightValue == null) return -1;
            return ascending
                ? (leftValue > rightValue ? 1 : -1)
                : (leftValue < rightValue ? 1 : -1);
        });
    }

    if (Number.isFinite(query.limit)) {
        result = result.slice(0, query.limit);
    }

    return result;
}

test('createPaymentRequest returns a signed afdian payment claim token for redirect purchases', async () => {
    const state = {
        checkoutSessions: [],
        paymentOrders: [],
        pointsPackages: [
            {
                id: 'pkg-1',
                name: '国际套餐',
                points_amount: 200,
                bonus_points: 0,
                price_cny: 20,
                is_active: true
            }
        ],
        systemConfigRows: [
            {
                config_key: 'payment_channels',
                config_value: {
                    active_provider: 'afdian',
                    providers: {
                        mock: {
                            enabled: false,
                            display_name: '模拟支付',
                            description: ''
                        },
                        afdian: {
                            enabled: true,
                            display_name: '爱发电',
                            checkout_url: 'https://afdian.com/a/zaoyoe',
                            package_hint: '支付完成后返回查询订单',
                            custom_amount_hint: ''
                        }
                    }
                }
            },
            {
                config_key: 'recharge_options',
                config_value: {
                    custom_amount_enabled: true,
                    mock_payment_enabled: false
                }
            }
        ]
    };

    const supabase = {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'system_config' && query.mode === 'select') {
                    const rows = applyFilters(state.systemConfigRows, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'admin_secret_store' && query.mode === 'select') {
                    return {
                        data: query.single || query.maybeSingle ? null : [],
                        error: null
                    };
                }

                if (table === 'points_packages' && query.mode === 'select') {
                    const rows = applyFilters(state.pointsPackages, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'insert') {
                    const nextRow = {
                        id: `checkout-session-${state.checkoutSessions.length + 1}`,
                        ...query.payload
                    };
                    state.checkoutSessions.push(nextRow);
                    return { data: nextRow, error: null };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'update') {
                    const rows = applyFilters(state.checkoutSessions, query);
                    rows.forEach((row) => Object.assign(row, query.payload || {}));
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_orders' && query.mode === 'select') {
                    const rows = applyFilters(state.paymentOrders, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_orders' && query.mode === 'insert') {
                    const nextRow = {
                        id: `payment-order-${state.paymentOrders.length + 1}`,
                        ...query.payload
                    };
                    state.paymentOrders.push(nextRow);
                    return { data: nextRow, error: null };
                }

                throw new Error(`Unexpected table access in test: ${table}/${query.mode}`);
            });
        }
    };

    const result = await createPaymentRequest({
        supabase,
        user: {
            id: 'user-intl-1'
        },
        body: {
            site: 'intl',
            provider_key: 'afdian',
            package_id: 'pkg-1'
        },
        env: {
            APP_BASE_URL: 'https://www.zaoyoe.com',
            PAYMENT_AFDIAN_URL: 'https://afdian.com/a/zaoyoe',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
        },
        requestHost: 'www.zaoyoe.com'
    });

    assert.equal(result.success, true);
    assert.equal(result.provider, 'afdian');
    assert.equal(result.mode, 'redirect');
    assert.equal(result.checkout_url, 'https://afdian.com/a/zaoyoe');
    assert.ok(result.payment_claim);
    assert.equal(result.payment_claim.site, 'intl');
    assert.equal(result.payment_claim.points_amount, 200);
    assert.equal(result.payment_claim.expected_amount, 20);

    const verified = verifyPaymentIntentClaimToken(result.payment_claim.token, {
        env: {
            SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
        },
        userId: 'user-intl-1',
        site: 'intl',
        providerKey: 'afdian'
    });

    assert.ok(verified);
    assert.equal(verified.checkoutSessionId, result.checkout_session_id);
    assert.equal(verified.packageId, 'pkg-1');
    assert.equal(verified.pointsAmount, 200);
    assert.equal(state.paymentOrders.length, 1);
    assert.equal(state.paymentOrders[0].checkout_session_id, result.checkout_session_id);
});
