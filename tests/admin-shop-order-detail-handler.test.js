const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function createQueryBuilder(state, table) {
    const operations = [];

    function finalize(mode) {
        state.queryCalls.push({ table, operations: [...operations], mode });
        if (typeof state.resolveQuery === 'function') {
            const resolved = state.resolveQuery(table, operations, mode);
            if (resolved !== undefined) {
                return Promise.resolve(resolved);
            }
        }
        const queue = state.queryResults[table] || [];
        const nextResult = queue.length ? queue.shift() : { data: [], error: null, count: 0 };
        return Promise.resolve(nextResult);
    }

    const builder = {
        select(columns, options) {
            operations.push({ method: 'select', args: [columns, options] });
            return builder;
        },
        eq(column, value) {
            operations.push({ method: 'eq', args: [column, value] });
            return builder;
        },
        in(column, values) {
            operations.push({ method: 'in', args: [column, values] });
            return builder;
        },
        order(column, options) {
            operations.push({ method: 'order', args: [column, options] });
            return builder;
        },
        limit(value) {
            operations.push({ method: 'limit', args: [value] });
            return finalize('limit');
        },
        maybeSingle() {
            operations.push({ method: 'maybeSingle', args: [] });
            return finalize('maybeSingle');
        },
        single() {
            operations.push({ method: 'single', args: [] });
            return finalize('single');
        },
        then(resolve, reject) {
            return finalize('then').then(resolve, reject);
        }
    };

    return builder;
}

async function withShopOrderDetailHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/order-detail.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        queryCalls: [],
        queryResults: {},
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: {
                            from(table) {
                                return createQueryBuilder(state, table);
                            }
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
    }
}

test('shop order detail handler returns linked inventory, fulfillment, ticket, and risk context', async () => {
    await withShopOrderDetailHandler({
        resolveQuery(table, operations) {
            if (table === 'shop_tickets') {
                return {
                    data: [
                        {
                            id: 'ticket_1',
                            order_id: 'ord_1',
                            user_id: 'user_1',
                            issue_type: 'DELIVERY',
                            status: 'PENDING',
                            description: '没有收到账号',
                            created_at: '2026-04-03T04:00:00.000Z',
                            updated_at: '2026-04-03T04:10:00.000Z'
                        },
                        {
                            id: 'ticket_2',
                            order_id: 'ord_1',
                            user_id: 'user_1',
                            issue_type: 'REFUND',
                            status: 'RESOLVED',
                            description: '退款已处理',
                            created_at: '2026-04-03T05:00:00.000Z',
                            updated_at: '2026-04-03T05:30:00.000Z'
                        }
                    ],
                    error: null
                };
            }

            if (table === 'ops_alert_cases') {
                const categoryKey = operations.find((operation) => operation.method === 'eq' && operation.args?.[0] === 'category_key')?.args?.[1];
                if (categoryKey === 'fulfillment') {
                    return {
                        data: {
                            id: 'case_fulfillment',
                            category_key: 'fulfillment',
                            target_id: 'ord_1',
                            alert_type: 'shop_order_delivery_failed',
                            status: 'claimed',
                            owner_label: 'ops@example.com',
                            note: '已人工介入',
                            resolution: null,
                            updated_at: '2026-04-03T03:20:00.000Z',
                            metadata: {}
                        },
                        error: null
                    };
                }

                if (operations.some((operation) => operation.method === 'in' && operation.args?.[0] === 'target_id')) {
                    return {
                        data: [
                            {
                                id: 'case_risk',
                                category_key: 'shop_risk',
                                target_id: 'shop_order_risk:coupon:SPRING',
                                alert_type: 'shop_order_risk_anomaly',
                                status: 'open',
                                owner_label: 'risk@example.com',
                                note: '优惠码波动异常',
                                resolution: null,
                                updated_at: '2026-04-03T05:00:00.000Z',
                                metadata: {}
                            }
                        ],
                        error: null
                    };
                }
            }

            return undefined;
        },
        queryResults: {
            shop_orders: [
                {
                    data: {
                        id: 'ord_1',
                        user_id: 'user_1',
                        product_id: 'prod_1',
                        snapshot_product_name: 'Premium Account',
                        inventory_id: null,
                        delivery_task_id: 'task_1',
                        delivery_status: 'dead_letter',
                        delivery_last_error: 'Webhook timeout',
                        discount_code: 'SPRING',
                        item_count: 2,
                        price_paid: 99,
                        total_price: 99,
                        site: 'cn',
                        created_at: '2026-04-03T02:00:00.000Z',
                        refund_status: 'none'
                    },
                    error: null
                }
            ],
            shop_order_items: [
                {
                    data: [
                        {
                            id: 'item_1',
                            order_id: 'ord_1',
                            inventory_id: 'inv_1',
                            snapshot_product_name: 'Premium Account',
                            price_paid: 49.5,
                            created_at: '2026-04-03T02:00:01.000Z'
                        },
                        {
                            id: 'item_2',
                            order_id: 'ord_1',
                            inventory_id: 'inv_2',
                            snapshot_product_name: 'Premium Account',
                            price_paid: 49.5,
                            created_at: '2026-04-03T02:00:02.000Z'
                        }
                    ],
                    error: null
                }
            ],
            shop_inventory: [
                {
                    data: [
                        {
                            id: 'inv_1',
                            content: 'user-a----pass-a',
                            status: 'sold',
                            buyer_id: 'user_1',
                            sold_at: '2026-04-03T02:00:10.000Z'
                        },
                        {
                            id: 'inv_2',
                            content: 'user-b----pass-b',
                            status: 'sold',
                            buyer_id: 'user_1',
                            sold_at: '2026-04-03T02:00:12.000Z'
                        }
                    ],
                    error: null
                }
            ],
            profiles: [
                {
                    data: {
                        id: 'user_1',
                        username: 'buyer',
                        avatar_url: null,
                        email: 'buyer@example.com'
                    },
                    error: null
                }
            ],
            shop_webhook_tasks: [
                {
                    data: {
                        id: 'task_1',
                        order_id: 'ord_1',
                        status: 'dead_letter',
                        attempt_count: 4,
                        max_attempts: 5,
                        last_error: 'Webhook timeout',
                        last_response_status: 504,
                        dead_lettered_at: '2026-04-03T03:00:00.000Z',
                        manual_replay_count: 1,
                        lock_token: null,
                        lock_expires_at: null,
                        target_url: 'https://vendor.example.com/deliver',
                        target_key: 'user:buyer@example.com',
                        channel_key: 'vendor:example',
                        conflict_count: 2,
                        created_at: '2026-04-03T02:01:00.000Z',
                        updated_at: '2026-04-03T03:00:00.000Z'
                    },
                    error: null
                }
            ],
            shop_webhook_task_attempts: [
                {
                    data: [
                        {
                            id: 'attempt_1',
                            task_id: 'task_1',
                            attempt_no: 4,
                            worker_name: 'worker-a',
                            started_at: '2026-04-03T02:58:00.000Z',
                            finished_at: '2026-04-03T02:58:10.000Z',
                            success: false,
                            response_status: 504,
                            error_message: 'Gateway Timeout',
                            duration_ms: 10000
                        }
                    ],
                    error: null
                }
            ],
            shop_tickets: [
            ],
            ops_alert_cases: [
            ]
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/order-detail?id=ord_1'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.order?.id, 'ord_1');
        assert.equal(payload.order?.profiles?.email, 'buyer@example.com');
        assert.equal(payload.order?.linkage_source, 'order_items');
        assert.equal(payload.order?.linked_inventory_items?.length, 2);
        assert.equal(payload.order?.resolved_items?.[0]?.content, 'user-a----pass-a');
        assert.equal(payload.fulfillment?.task?.id, 'task_1');
        assert.equal(payload.fulfillment?.case?.status, 'claimed');
        assert.equal(payload.tickets?.total, 2);
        assert.equal(payload.risk?.total, 1);
        assert.equal(
            state.requireAdminCalls[0]?.options?.permission,
            'shop.manage'
        );
    });
});

test('shop order detail handler validates missing order id', async () => {
    await withShopOrderDetailHandler({}, async ({ handler }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/order-detail'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Missing order id');
    });
});
