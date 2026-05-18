const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

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

async function withOrdersModule(mocks, callback) {
    const modulePath = path.resolve(__dirname, '../api/_lib/payments/orders.js');
    const originalLoad = Module._load;

    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) {
            return mocks[request];
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let loadedModule;
    try {
        loadedModule = require(modulePath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback(loadedModule);
    } finally {
        delete require.cache[modulePath];
    }
}

test('getPaymentRequestStatus actively refreshes a pending zpay order into completed when provider query confirms payment', async () => {
    const nowIso = new Date().toISOString();
    const state = {
        payment_checkout_sessions: [
            {
                id: 'pcs-zpay-refresh-1',
                user_id: 'user-zpay-refresh-1',
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
                session_key: 'PCS_ZPAY_REFRESH_1',
                provider_metadata: {
                    provider_order_no: 'ZPAY_REFRESH_ORDER_1'
                }
            }
        ],
        payment_orders: [
            {
                id: 'po-zpay-refresh-1',
                user_id: 'user-zpay-refresh-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_REFRESH_ORDER_1',
                checkout_session_id: 'pcs-zpay-refresh-1',
                site: 'cn',
                package_id: null,
                package_name: '自定义充值',
                expected_amount: 0.01,
                paid_amount: null,
                points_amount: 0.01,
                status: 'pending',
                last_error: null,
                created_at: nowIso,
                updated_at: nowIso,
                paid_at: null,
                claimed_at: null,
                verified_at: null,
                raw_payload: {},
                provider_metadata: {}
            }
        ]
    };
    const calls = {
        recharge: null
    };

    const mocks = {
        '../site': require('../api/_lib/site'),
        './provider-adapters': {
            getPaymentProviderAdapter(providerKey) {
                if (providerKey === 'zpay') {
                    return {
                        async resolveRuntimeContext() {
                            return {};
                        },
                        async queryOrder({ providerOrderNo }) {
                            return {
                                supported: true,
                                success: true,
                                providerOrderNo,
                                tradeNo: 'TRADE_REFRESH_1',
                                paidAmount: 0.01,
                                status: 'paid',
                                statusRaw: 'TRADE_SUCCESS',
                                responsePayload: {
                                    code: '1',
                                    status: 1
                                }
                            };
                        }
                    };
                }

                return {};
            },
            normalizePointValue(value) {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : 0;
            },
            amountsMatch(expected, actual) {
                return Math.abs(Number(expected || 0) - Number(actual || 0)) < 0.0001;
            }
        },
        './providers': {
            async loadStoredPaymentConfigs() {
                return {
                    paymentChannels: {},
                    rechargeOptions: {}
                };
            }
        },
        './rpc': {
            async rechargePointsForPayment(payload) {
                calls.recharge = payload;
                return {
                    error: null
                };
            }
        },
        '../discount-trigger-linkage': {
            async maybeIssueAffiliateDiscountAssetsForRecharge() {},
            async maybeIssueRechargeDiscountAssets() {}
        },
        './zpay-points': {
            deriveZpayPointBreakdown() {
                return {
                    paidPoints: 0.01,
                    bonusPoints: 0
                };
            }
        }
    };

    await withOrdersModule(mocks, async ({ getPaymentRequestStatus }) => {
        const payload = await getPaymentRequestStatus({
            supabase: createSupabaseStub(state),
            user: {
                id: 'user-zpay-refresh-1'
            },
            body: {
                checkout_session_id: 'pcs-zpay-refresh-1',
                provider_order_no: 'ZPAY_REFRESH_ORDER_1',
                site: 'cn'
            }
        });

        assert.equal(payload.success, true);
        assert.equal(payload.status, 'completed');
        assert.equal(payload.payment_order_status, 'redeemed');
        assert.equal(payload.refresh_wallet, true);
        assert.equal(state.payment_orders[0].status, 'redeemed');
        assert.equal(state.payment_checkout_sessions[0].status, 'completed');
        assert.equal(state.payment_checkout_sessions[0].payment_order_id, 'po-zpay-refresh-1');
        assert.equal(calls.recharge.referenceId, 'zpay_ZPAY_REFRESH_ORDER_1');
    });
});

test('getPaymentRequestStatus lets mobile return requests bypass the long zpay status query throttle', async () => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const recentQueryIso = new Date(now - 2_000).toISOString();
    const state = {
        payment_checkout_sessions: [
            {
                id: 'pcs-zpay-force-refresh-1',
                user_id: 'user-zpay-force-refresh-1',
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
                session_key: 'PCS_ZPAY_FORCE_REFRESH_1',
                provider_metadata: {
                    provider_order_no: 'ZPAY_FORCE_REFRESH_ORDER_1'
                }
            }
        ],
        payment_orders: [
            {
                id: 'po-zpay-force-refresh-1',
                user_id: 'user-zpay-force-refresh-1',
                provider: 'zpay',
                provider_order_no: 'ZPAY_FORCE_REFRESH_ORDER_1',
                checkout_session_id: 'pcs-zpay-force-refresh-1',
                site: 'cn',
                package_id: null,
                package_name: '自定义充值',
                expected_amount: 0.01,
                paid_amount: null,
                points_amount: 0.01,
                status: 'pending',
                last_error: null,
                created_at: nowIso,
                updated_at: nowIso,
                paid_at: null,
                claimed_at: null,
                verified_at: null,
                raw_payload: {},
                provider_metadata: {
                    query_verified_at: recentQueryIso,
                    status_poll_query_at: recentQueryIso
                }
            }
        ]
    };
    const calls = {
        query: 0,
        recharge: null
    };

    const mocks = {
        '../site': require('../api/_lib/site'),
        './provider-adapters': {
            getPaymentProviderAdapter(providerKey) {
                if (providerKey === 'zpay') {
                    return {
                        async resolveRuntimeContext() {
                            return {};
                        },
                        async queryOrder({ providerOrderNo }) {
                            calls.query += 1;
                            return {
                                supported: true,
                                success: true,
                                providerOrderNo,
                                tradeNo: 'TRADE_FORCE_REFRESH_1',
                                paidAmount: 0.01,
                                status: 'paid',
                                statusRaw: 'TRADE_SUCCESS',
                                responsePayload: {
                                    code: '1',
                                    status: 1
                                }
                            };
                        }
                    };
                }

                return {};
            },
            normalizePointValue(value) {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : 0;
            },
            amountsMatch(expected, actual) {
                return Math.abs(Number(expected || 0) - Number(actual || 0)) < 0.0001;
            }
        },
        './providers': {
            async loadStoredPaymentConfigs() {
                return {
                    paymentChannels: {},
                    rechargeOptions: {}
                };
            }
        },
        './rpc': {
            async rechargePointsForPayment(payload) {
                calls.recharge = payload;
                return {
                    error: null
                };
            }
        },
        '../discount-trigger-linkage': {
            async maybeIssueAffiliateDiscountAssetsForRecharge() {},
            async maybeIssueRechargeDiscountAssets() {}
        },
        './zpay-points': {
            deriveZpayPointBreakdown() {
                return {
                    paidPoints: 0.01,
                    bonusPoints: 0
                };
            }
        }
    };

    await withOrdersModule(mocks, async ({ getPaymentRequestStatus }) => {
        const throttledPayload = await getPaymentRequestStatus({
            supabase: createSupabaseStub(state),
            user: {
                id: 'user-zpay-force-refresh-1'
            },
            body: {
                checkout_session_id: 'pcs-zpay-force-refresh-1',
                provider_order_no: 'ZPAY_FORCE_REFRESH_ORDER_1',
                site: 'cn'
            }
        });

        assert.equal(throttledPayload.status, 'pending');
        assert.equal(calls.query, 0);
        assert.equal(state.payment_orders[0].status, 'pending');

        const forcedPayload = await getPaymentRequestStatus({
            supabase: createSupabaseStub(state),
            user: {
                id: 'user-zpay-force-refresh-1'
            },
            body: {
                checkout_session_id: 'pcs-zpay-force-refresh-1',
                provider_order_no: 'ZPAY_FORCE_REFRESH_ORDER_1',
                site: 'cn',
                force_provider_refresh: true
            }
        });

        assert.equal(calls.query, 1);
        assert.equal(forcedPayload.status, 'completed');
        assert.equal(forcedPayload.payment_order_status, 'redeemed');
        assert.equal(state.payment_orders[0].status, 'redeemed');
        assert.equal(calls.recharge.referenceId, 'zpay_ZPAY_FORCE_REFRESH_ORDER_1');
    });
});
