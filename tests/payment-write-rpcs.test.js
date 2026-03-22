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
            state.filters.push({ column, value });
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
