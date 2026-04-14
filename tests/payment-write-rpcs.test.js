const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createCheckoutSession,
    createPaymentRequest,
    completeMockPayment,
    updateCheckoutSession,
    __testUtils: paymentTestUtils
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

test('createCheckoutSession prefers the user-bound RPC when available', async () => {
    const rpcCalls = [];
    const supabase = {
        async rpc(name, args) {
            rpcCalls.push({ name, args });
            if (name === 'fn_create_payment_checkout_session') {
                return {
                    data: {
                        id: 'session-rpc-1',
                        session_key: args.p_payload.session_key,
                        provider: 'afdian',
                        user_id: 'user-1',
                        status: 'created'
                    },
                    error: null
                };
            }

            throw new Error(`Unexpected RPC: ${name}`);
        },
        from() {
            throw new Error('Direct table write should not run when checkout session RPC is available');
        }
    };

    const session = await createCheckoutSession({
        supabase,
        user: { id: 'user-1' },
        providerKey: 'afdian',
        site: 'cn',
        packageId: 'pkg-1',
        packageName: '测试套餐',
        paidPoints: 100,
        bonusPoints: 10,
        grantedPoints: 110,
        paidAmount: 2
    });

    assert.equal(session.id, 'session-rpc-1');
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'fn_create_payment_checkout_session');
    assert.equal(rpcCalls[0].args.p_user_id, 'user-1');
    assert.equal(rpcCalls[0].args.p_payload.status, 'created');
});

test('updateCheckoutSession prefers the user-bound RPC when available', async () => {
    const rpcCalls = [];
    const supabase = {
        async rpc(name, args) {
            rpcCalls.push({ name, args });
            if (name === 'fn_update_payment_checkout_session') {
                return {
                    data: {
                        id: 'session-rpc-2',
                        status: 'redirect_ready',
                        checkout_url: 'https://pay.example.com'
                    },
                    error: null
                };
            }

            throw new Error(`Unexpected RPC: ${name}`);
        },
        from() {
            throw new Error('Direct checkout session update should not run when RPC is available');
        }
    };

    const session = await updateCheckoutSession(supabase, 'session-rpc-2', {
        status: 'redirect_ready',
        checkout_url: 'https://pay.example.com'
    });

    assert.equal(session.id, 'session-rpc-2');
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'fn_update_payment_checkout_session');
    assert.equal(rpcCalls[0].args.p_session_id, 'session-rpc-2');
    assert.equal(rpcCalls[0].args.p_patch.status, 'redirect_ready');
});

test('pending payment order creation prefers the user-bound RPC when available', async () => {
    const rpcCalls = [];
    const supabase = {
        async rpc(name, args) {
            rpcCalls.push({ name, args });
            if (name === 'fn_create_pending_payment_order_for_checkout_session') {
                return {
                    data: {
                        id: 'order-rpc-1',
                        provider: 'afdian',
                        provider_order_no: args.p_payload.provider_order_no,
                        checkout_session_id: args.p_payload.checkout_session_id,
                        status: 'pending'
                    },
                    error: null
                };
            }

            throw new Error(`Unexpected RPC: ${name}`);
        },
        from() {
            throw new Error('Direct payment order insert should not run when RPC is available');
        }
    };

    const order = await paymentTestUtils.createPendingPaymentOrderForCheckoutSession({
        supabase,
        checkoutSession: {
            id: 'session-rpc-3',
            session_key: 'session-key-3',
            provider_metadata: {},
            request_payload: {}
        },
        user: { id: 'user-1' },
        providerKey: 'afdian',
        site: 'cn',
        packageId: 'pkg-1',
        packageName: '测试套餐',
        paidAmount: 2,
        grantedPoints: 110
    });

    assert.equal(order.id, 'order-rpc-1');
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'fn_create_pending_payment_order_for_checkout_session');
    assert.equal(rpcCalls[0].args.p_user_id, 'user-1');
    assert.equal(rpcCalls[0].args.p_payload.checkout_session_id, 'session-rpc-3');
});

test('createCheckoutSession falls back to direct insert when the RPC is unavailable', async () => {
    const supabase = {
        async rpc() {
            return {
                data: null,
                error: {
                    code: '42883',
                    message: 'function public.fn_create_payment_checkout_session does not exist'
                }
            };
        },
        from(table) {
            assert.equal(table, 'payment_checkout_sessions');
            return createQueryBuilder(async (query) => {
                assert.equal(query.mode, 'insert');
                return {
                    data: {
                        id: 'session-fallback-1',
                        ...query.payload
                    },
                    error: null
                };
            });
        }
    };

    const session = await createCheckoutSession({
        supabase,
        user: { id: 'user-1' },
        providerKey: 'afdian',
        site: 'cn',
        packageName: '回退套餐',
        paidPoints: 50,
        grantedPoints: 50,
        paidAmount: 1
    });

    assert.equal(session.id, 'session-fallback-1');
    assert.equal(session.status, 'created');
    assert.equal(session.user_id, 'user-1');
});

test('createCheckoutSession rejects unsupported site values before writing payment tables', async () => {
    await assert.rejects(
        () => createCheckoutSession({
            supabase: {
                from() {
                    throw new Error('Supabase should not be called for invalid site values');
                },
                rpc() {
                    throw new Error('Supabase should not be called for invalid site values');
                }
            },
            user: { id: 'user-1' },
            providerKey: 'afdian',
            site: 'preview',
            packageName: '测试套餐',
            paidPoints: 100,
            grantedPoints: 100,
            paidAmount: 2
        }),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.match(error.message, /site 不支持/);
            return true;
        }
    );
});

test('createPaymentRequest rejects unsupported site values before touching Supabase', async () => {
    await assert.rejects(
        () => createPaymentRequest({
            supabase: {
                from() {
                    throw new Error('Supabase should not be called for invalid site values');
                },
                rpc() {
                    throw new Error('Supabase should not be called for invalid site values');
                }
            },
            user: { id: 'user-1' },
            body: {
                site: 'preview',
                provider_key: 'afdian',
                package_id: 'pkg-1'
            }
        }),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.match(error.message, /site 不支持/);
            return true;
        }
    );
});

test('createPaymentRequest falls back to admin writes when request-scoped payment writes are denied', async () => {
    const state = {
        requestWrites: [],
        adminWrites: [],
        checkoutSessions: [],
        paymentOrders: [],
        pointsPackages: [
            {
                id: 'pkg-request-fallback-1',
                name: '请求回退套餐',
                points_amount: 10,
                bonus_points: 0,
                price_cny: 10,
                is_active: true
            }
        ],
        systemConfigRows: [
            {
                config_key: 'payment_channels',
                config_value: {
                    active_provider: 'afdian',
                    providers: {
                        afdian: {
                            enabled: true,
                            display_name: '爱发电',
                            checkout_url: 'https://afdian.com/a/zaoyoe',
                            package_hint: '支付后回到钱包输入订单号',
                            custom_amount_hint: '自定义充值请按报价支付'
                        },
                        mock: {
                            enabled: false,
                            display_name: '模拟支付',
                            description: ''
                        },
                        hupijiao: {
                            enabled: false,
                            display_name: '虎皮椒',
                            checkout_url: ''
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

    const requestSupabase = {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'points_packages' && query.mode === 'select') {
                    const rows = applyFilters(state.pointsPackages, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'insert') {
                    state.requestWrites.push({ table, mode: query.mode, payload: query.payload });
                    return {
                        data: null,
                        error: {
                            code: '42501',
                            message: 'permission denied for table payment_checkout_sessions'
                        }
                    };
                }

                throw new Error(`Unexpected request-scoped table access in test: ${table}/${query.mode}`);
            });
        }
    };

    const adminSupabase = {
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

                if (table === 'payment_checkout_sessions' && query.mode === 'insert') {
                    const nextRow = {
                        id: `checkout-session-${state.checkoutSessions.length + 1}`,
                        ...query.payload
                    };
                    state.adminWrites.push({ table, mode: query.mode, payload: query.payload });
                    state.checkoutSessions.push(nextRow);
                    return { data: nextRow, error: null };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'update') {
                    const rows = applyFilters(state.checkoutSessions, query);
                    rows.forEach((row) => Object.assign(row, query.payload || {}));
                    state.adminWrites.push({ table, mode: query.mode, payload: query.payload });
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
                    state.adminWrites.push({ table, mode: query.mode, payload: query.payload });
                    state.paymentOrders.push(nextRow);
                    return { data: nextRow, error: null };
                }

                throw new Error(`Unexpected admin table access in test: ${table}/${query.mode}`);
            });
        }
    };

    const result = await createPaymentRequest({
        supabase: requestSupabase,
        adminSupabase,
        user: {
            id: 'user-request-fallback-1'
        },
        body: {
            site: 'cn',
            provider_key: 'afdian',
            package_id: 'pkg-request-fallback-1'
        },
        env: {
            APP_BASE_URL: 'https://www.zaoyoe.com',
            PAYMENT_AFDIAN_URL: 'https://afdian.com/a/zaoyoe',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
        },
        requestHost: '127.0.0.1:8000'
    });

    assert.equal(result.success, true);
    assert.equal(result.provider, 'afdian');
    assert.equal(result.mode, 'redirect');
    assert.equal(result.checkout_url, 'https://afdian.com/a/zaoyoe');
    assert.equal(state.requestWrites.length, 1);
    assert.equal(state.requestWrites[0].table, 'payment_checkout_sessions');
    assert.equal(state.checkoutSessions.length, 1);
    assert.equal(state.checkoutSessions[0].user_id, 'user-request-fallback-1');
    assert.equal(state.checkoutSessions[0].status, 'redirect_ready');
    assert.equal(state.paymentOrders.length, 1);
    assert.equal(state.paymentOrders[0].checkout_session_id, state.checkoutSessions[0].id);
});

test('completeMockPayment rejects unsupported site values before touching Supabase', async () => {
    await assert.rejects(
        () => completeMockPayment({
            supabase: {
                from() {
                    throw new Error('Supabase should not be called for invalid site values');
                },
                rpc() {
                    throw new Error('Supabase should not be called for invalid site values');
                }
            },
            user: { id: 'user-1' },
            body: {
                site: 'preview',
                order_no: 'MOCK-1'
            }
        }),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.match(error.message, /site 不支持/);
            return true;
        }
    );
});
