const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPaymentRequest
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

test('createPaymentRequest launches ZPAY checkout and precreates the payment order with the real out_trade_no', async () => {
    const state = {
        checkoutSessions: [],
        paymentOrders: [],
        pointsPackages: [
            {
                id: 'pkg-1',
                name: '易支付测试套餐',
                points_amount: 100,
                bonus_points: 10,
                price_cny: 9.9,
                is_active: true
            }
        ],
        systemConfigRows: [
            {
                config_key: 'payment_channels',
                config_value: {
                    active_provider: 'zpay',
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
                            package_hint: '',
                            custom_amount_hint: ''
                        },
                        hupijiao: {
                            enabled: false,
                            display_name: '虎皮椒',
                            checkout_url: '',
                            gateway_url: '',
                            merchant_id: '',
                            notify_url: '',
                            return_url: ''
                        },
                        zpay: {
                            enabled: true,
                            display_name: '易支付',
                            checkout_url: 'https://zpayz.cn',
                            pid: 'pid-123',
                            payment_type: 'alipay',
                            channel_ids: '',
                            notify_url: 'https://verify-api.zaoyoe.com/api/payments/zpay/webhook',
                            return_url: 'https://www.zaoyoe.com/wallet',
                            package_hint: '请完成易支付支付',
                            custom_amount_hint: ''
                        }
                    }
                }
            },
            {
                config_key: 'recharge_options',
                config_value: {
                    custom_amount_enabled: false,
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

    const originalFetch = global.fetch;
    global.fetch = async (url, request) => {
        assert.equal(String(url), 'https://zpayz.cn/mapi.php');
        assert.match(String(request.body || ''), /pid=pid-123/);
        assert.match(String(request.body || ''), /clientip=203\.0\.113\.8/);
        assert.match(String(request.body || ''), /out_trade_no=ZP[A-Z0-9]{30}/);

        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            async text() {
                return JSON.stringify({
                    code: 1,
                    msg: 'success',
                    trade_no: 'TRADE_ZPAY_1',
                    O_id: 'OID_ZPAY_1',
                    payurl: 'https://zpayz.cn/pay/demo/1'
                });
            }
        };
    };

    try {
        const result = await createPaymentRequest({
            supabase,
            user: {
                id: 'user-1'
            },
            body: {
                site: 'cn',
                provider_key: 'zpay',
                package_id: 'pkg-1'
            },
            env: {
                APP_BASE_URL: 'https://www.zaoyoe.com',
                ZPAY_PKEY: 'pkey-123'
            },
            requestHost: 'www.zaoyoe.com',
            clientIp: '203.0.113.8',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
        });

        assert.equal(result.success, true);
        assert.equal(result.provider, 'zpay');
        assert.equal(result.mode, 'redirect');
        assert.equal(result.checkout_url, 'https://zpayz.cn/pay/demo/1');
        assert.equal(result.query_mode, 'provider_order_no');
        assert.match(String(result.provider_order_no || ''), /^ZP[A-Z0-9]{30}$/);
        assert.equal(state.checkoutSessions.length, 1);
        assert.equal(state.paymentOrders.length, 1);
        assert.match(state.paymentOrders[0].provider_order_no, /^ZP[A-Z0-9]{30}$/);
        assert.equal(state.paymentOrders[0].checkout_session_id, state.checkoutSessions[0].id);
        assert.equal(state.checkoutSessions[0].status, 'redirect_ready');
        assert.equal(
            state.checkoutSessions[0].provider_metadata.provider_order_no,
            state.paymentOrders[0].provider_order_no
        );
        assert.equal(
            state.checkoutSessions[0].provider_metadata.trade_no,
            'TRADE_ZPAY_1'
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('createPaymentRequest rewrites managed ZPAY callback urls for intl site checkouts', async () => {
    const state = {
        checkoutSessions: [],
        paymentOrders: [],
        pointsPackages: [
            {
                id: 'pkg-1',
                name: '国际站易支付测试套餐',
                points_amount: 100,
                bonus_points: 10,
                price_cny: 9.9,
                is_active: true
            }
        ],
        systemConfigRows: [
            {
                config_key: 'payment_channels',
                config_value: {
                    active_provider: 'zpay',
                    providers: {
                        mock: {
                            enabled: false,
                            display_name: '模拟支付',
                            description: ''
                        },
                        afdian: {
                            enabled: false,
                            display_name: '爱发电',
                            checkout_url: 'https://afdian.com/a/zaoyoe',
                            package_hint: '',
                            custom_amount_hint: ''
                        },
                        hupijiao: {
                            enabled: false,
                            display_name: '虎皮椒',
                            checkout_url: '',
                            gateway_url: '',
                            merchant_id: '',
                            notify_url: '',
                            return_url: ''
                        },
                        zpay: {
                            enabled: true,
                            display_name: '易支付',
                            checkout_url: 'https://zpayz.cn',
                            pid: 'pid-123',
                            payment_type: 'alipay',
                            channel_ids: '',
                            notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook',
                            return_url: 'https://www.zaoyoe.com/wallet',
                            package_hint: '请完成易支付支付',
                            custom_amount_hint: ''
                        }
                    }
                }
            },
            {
                config_key: 'recharge_options',
                config_value: {
                    custom_amount_enabled: false,
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

    const originalFetch = global.fetch;
    global.fetch = async (url, request) => {
        assert.equal(String(url), 'https://zpayz.cn/mapi.php');
        assert.match(String(request.body || ''), /notify_url=https%3A%2F%2Fwww\.zaoyoe\.xyz%2Fapi%2Fpayments%2Fzpay%2Fwebhook/);
        assert.match(String(request.body || ''), /return_url=https%3A%2F%2Fwww\.zaoyoe\.xyz%2Fwallet/);

        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            async text() {
                return JSON.stringify({
                    code: 1,
                    msg: 'success',
                    trade_no: 'TRADE_ZPAY_2',
                    O_id: 'OID_ZPAY_2',
                    payurl: 'https://zpayz.cn/pay/demo/2'
                });
            }
        };
    };

    try {
        const result = await createPaymentRequest({
            supabase,
            user: {
                id: 'user-2'
            },
            body: {
                site: 'intl',
                provider_key: 'zpay',
                package_id: 'pkg-1'
            },
            env: {
                APP_BASE_URL: 'https://www.zaoyoe.com',
                ZPAY_PKEY: 'pkey-123'
            },
            requestHost: 'www.zaoyoe.xyz',
            clientIp: '203.0.113.9',
            userAgent: 'Mozilla/5.0'
        });

        assert.equal(result.success, true);
        assert.equal(result.provider, 'zpay');
        assert.equal(state.paymentOrders[0].site, 'intl');
        assert.equal(state.checkoutSessions[0].site, 'intl');
    } finally {
        global.fetch = originalFetch;
    }
});
