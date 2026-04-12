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
            state.statusCode = Number(code) || 200;
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

function parseOrFilters(expression = '') {
    return String(expression || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
            const ilikeMatch = item.match(/^([^.]*)\.ilike\.%(.*)%$/i);
            if (ilikeMatch) {
                return {
                    column: String(ilikeMatch[1] || '').trim(),
                    operator: 'ilike',
                    value: String(ilikeMatch[2] || '').replace(/\\([,()\\])/g, '$1').toLowerCase()
                };
            }
            const eqMatch = item.match(/^([^.]*)\.eq\.(.*)$/i);
            if (eqMatch) {
                return {
                    column: String(eqMatch[1] || '').trim(),
                    operator: 'eq',
                    value: String(eqMatch[2] || '').replace(/\\([,()\\])/g, '$1')
                };
            }
            return null;
        })
        .filter(Boolean);
}

function createQueryBuilder(state, table, rows = []) {
    const queryState = {
        table,
        rows: Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [],
        orderBy: '',
        ascending: false,
        from: 0,
        to: 99,
        eqFilters: [],
        inFilters: [],
        orExpression: ''
    };

    const builder = {
        select() {
            return builder;
        },
        order(column, config = {}) {
            queryState.orderBy = String(column || '');
            queryState.ascending = config?.ascending === true;
            return builder;
        },
        range(from, to) {
            queryState.from = Number(from) || 0;
            queryState.to = Number(to) || 0;
            return builder;
        },
        limit(limitValue) {
            const limit = Math.max(0, Number(limitValue) || 0);
            queryState.from = 0;
            queryState.to = Math.max(0, limit - 1);
            return builder;
        },
        eq(column, value) {
            queryState.eqFilters.push([String(column || ''), String(value || '')]);
            return builder;
        },
        in(column, values) {
            queryState.inFilters.push([String(column || ''), Array.isArray(values) ? values.map((item) => String(item || '')) : []]);
            return builder;
        },
        or(expression) {
            queryState.orExpression = String(expression || '');
            return builder;
        },
        then(resolve, reject) {
            state.calls.push({
                table,
                eqFilters: queryState.eqFilters.map((item) => [...item]),
                inFilters: queryState.inFilters.map(([column, values]) => [column, [...values]]),
                orExpression: queryState.orExpression,
                range: [queryState.from, queryState.to]
            });

            let filteredRows = [...queryState.rows];

            for (const [column, value] of queryState.eqFilters) {
                filteredRows = filteredRows.filter((row) => String(row?.[column] || '') === value);
            }

            for (const [column, values] of queryState.inFilters) {
                filteredRows = filteredRows.filter((row) => values.includes(String(row?.[column] || '')));
            }

            const orFilters = parseOrFilters(queryState.orExpression);
            if (orFilters.length > 0) {
                filteredRows = filteredRows.filter((row) => (
                    orFilters.some((filter) => {
                        if (filter.operator === 'eq') {
                            return String(row?.[filter.column] || '') === filter.value;
                        }
                        return String(row?.[filter.column] || '').toLowerCase().includes(filter.value);
                    })
                ));
            }

            if (queryState.orderBy) {
                filteredRows.sort((left, right) => {
                    const leftValue = String(left?.[queryState.orderBy] || '');
                    const rightValue = String(right?.[queryState.orderBy] || '');
                    return queryState.ascending
                        ? leftValue.localeCompare(rightValue)
                        : rightValue.localeCompare(leftValue);
                });
            }

            const slicedRows = filteredRows.slice(queryState.from, queryState.to + 1);
            return Promise.resolve({
                data: slicedRows,
                count: filteredRows.length,
                error: null
            }).then(resolve, reject);
        }
    };

    return builder;
}

async function withShopOrdersHandler(tables = {}, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/orders.js');
    const originalLoad = Module._load;
    const state = {
        calls: [],
        requireAdminCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, config = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (['cn', 'intl', 'all'].includes(normalized)) {
                        return normalized;
                    }
                    return String(config?.defaultValue || '').trim().toLowerCase() || '';
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: {
                            from(table) {
                                return createQueryBuilder(state, table, tables[table] || []);
                            }
                        },
                        adminSupabase: {
                            auth: {
                                admin: {
                                    async getUserById() {
                                        return { data: { user: null }, error: null };
                                    }
                                }
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

test('shop orders handler supports free-text product search for analytics drill-downs', async () => {
    await withShopOrdersHandler({
        shop_orders: [
            {
                id: 'ord_1',
                user_id: 'user_1',
                product_id: 'prod-season',
                inventory_id: 'inv_1',
                snapshot_product_name: 'Season Pass',
                items: [{ product_name: 'Season Pass', content: 'A1', price: 200 }],
                created_at: '2026-04-05T08:00:00.000Z',
                total_price: 200
            },
            {
                id: 'ord_2',
                user_id: 'user_2',
                product_id: 'prod-mood',
                inventory_id: 'inv_2',
                snapshot_product_name: 'Mood Pack',
                items: [{ product_name: 'Mood Pack', content: 'B1', price: 80 }],
                created_at: '2026-04-05T09:00:00.000Z',
                total_price: 80
            }
        ],
        profiles: [
            { id: 'user_1', username: 'alpha', avatar_url: null, email: 'alpha@example.com' },
            { id: 'user_2', username: 'beta', avatar_url: null, email: 'beta@example.com' }
        ],
        shop_inventory: []
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/orders&query=Mood&page=1&pageSize=10'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.count, 1);
        assert.equal(payload.rows.length, 1);
        assert.equal(payload.rows[0]?.id, 'ord_2');
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
        assert.equal(
            state.calls.some((entry) => entry.table === 'shop_orders' && entry.orExpression.includes('snapshot_product_name.ilike.%Mood%')),
            true,
            'handler should search orders by product-facing text when analytics sends a product query'
        );
    });
});

test('shop orders handler resolves order content through exact order-item linkage when inventory_id is empty', async () => {
    await withShopOrdersHandler({
        shop_orders: [
            {
                id: 'ord_linked',
                user_id: 'user_linked',
                product_id: 'prod-linked',
                inventory_id: null,
                snapshot_product_name: 'Linked Account',
                created_at: '2026-04-06T08:00:00.000Z',
                total_price: 120,
                price_paid: 120
            }
        ],
        shop_order_items: [
            {
                id: 'item_1',
                order_id: 'ord_linked',
                inventory_id: 'inv_linked',
                snapshot_product_name: 'Linked Account',
                price_paid: 120,
                created_at: '2026-04-06T08:00:01.000Z'
            }
        ],
        shop_inventory: [
            {
                id: 'inv_linked',
                content: 'linked@example.com----secret',
                status: 'sold'
            }
        ],
        profiles: [
            { id: 'user_linked', username: 'linked-user', avatar_url: null, email: 'linked@example.com' }
        ]
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/orders&query=Linked&page=1&pageSize=10'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.rows.length, 1);
        assert.equal(payload.rows[0]?.linkage_source, 'order_items');
        assert.deepEqual(payload.rows[0]?.linked_inventory_ids, ['inv_linked']);
        assert.equal(payload.rows[0]?.resolved_items?.[0]?.content, 'linked@example.com----secret');
        assert.equal(
            state.calls.some((entry) => entry.table === 'shop_order_items' && entry.inFilters.some(([column]) => column === 'order_id')),
            true,
            'handler should load exact order-item rows before attempting to resolve inventory content'
        );
    });
});

test('shop orders handler still resolves explicit SHOP_ORDER_ ids exactly', async () => {
    const orderId = '11111111-1111-4111-8111-111111111111';
    await withShopOrdersHandler({
        shop_orders: [
            {
                id: orderId,
                user_id: 'user_9',
                product_id: 'prod-9',
                inventory_id: 'inv_9',
                snapshot_product_name: 'Exact Match',
                items: [{ product_name: 'Exact Match', content: 'Z1', price: 50 }],
                created_at: '2026-04-05T10:00:00.000Z',
                total_price: 50
            }
        ],
        profiles: [
            { id: 'user_9', username: 'gamma', avatar_url: null, email: 'gamma@example.com' }
        ],
        shop_inventory: []
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: `/api/admin?route=shop/orders&query=SHOP_ORDER_${orderId}`
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.rows.length, 1);
        assert.equal(payload.rows[0]?.id, orderId);
        assert.equal(
            state.calls.some((entry) => entry.table === 'shop_orders' && entry.eqFilters.some(([column, value]) => column === 'id' && value === orderId)),
            true,
            'handler should keep exact order-id lookups for SHOP_ORDER_ queries'
        );
    });
});

test('shop orders handler does not apply text operators to uuid columns for short numeric searches', async () => {
    await withShopOrdersHandler({
        shop_orders: [
            {
                id: '22222222-2222-4222-8222-222222222222',
                user_id: '33333333-3333-4333-8333-333333333333',
                product_id: '44444444-4444-4444-8444-444444444444',
                inventory_id: null,
                snapshot_product_name: '账号 7 天套餐',
                created_at: '2026-04-09T08:00:00.000Z',
                total_price: 70,
                price_paid: 70
            }
        ],
        profiles: [
            {
                id: '33333333-3333-4333-8333-333333333333',
                username: 'seven',
                avatar_url: null,
                email: 'seven@example.com'
            }
        ],
        shop_order_items: [],
        shop_inventory: []
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/orders&query=7&page=1&pageSize=10'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const orderSearchCall = state.calls.find((entry) => entry.table === 'shop_orders' && entry.orExpression.includes('snapshot_product_name.ilike.%7%'));

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.count, 1);
        assert.equal(payload.rows[0]?.id, '22222222-2222-4222-8222-222222222222');
        assert.ok(orderSearchCall, 'handler should still search product-facing text for short numeric queries');
        assert.equal(orderSearchCall.orExpression.includes('id.ilike'), false);
        assert.equal(orderSearchCall.orExpression.includes('product_id.ilike'), false);
        assert.equal(orderSearchCall.orExpression.includes('user_id.ilike'), false);
        assert.equal(orderSearchCall.orExpression.includes('id.eq.7'), false);
        assert.equal(orderSearchCall.orExpression.includes('product_id.eq.7'), false);
        assert.equal(orderSearchCall.orExpression.includes('user_id.eq.7'), false);
    });
});

test('shop orders handler supports refund and delivery issue filters for analytics drill-down lists', async () => {
    await withShopOrdersHandler({
        shop_orders: [
            {
                id: 'ord_refund',
                user_id: 'user_1',
                product_id: 'prod-1',
                inventory_id: 'inv_1',
                snapshot_product_name: 'Season Pass',
                items: [{ product_name: 'Season Pass', content: 'A1', price: 200 }],
                created_at: '2026-04-05T08:00:00.000Z',
                total_price: 200,
                refund_status: 'full_refund',
                delivery_status: 'delivered'
            },
            {
                id: 'ord_dead',
                user_id: 'user_2',
                product_id: 'prod-1',
                inventory_id: 'inv_2',
                snapshot_product_name: 'Season Pass',
                items: [{ product_name: 'Season Pass', content: 'B1', price: 200 }],
                created_at: '2026-04-05T09:00:00.000Z',
                total_price: 200,
                refund_status: 'none',
                delivery_status: 'dead_letter'
            }
        ],
        profiles: [
            { id: 'user_1', username: 'alpha', avatar_url: null, email: 'alpha@example.com' },
            { id: 'user_2', username: 'beta', avatar_url: null, email: 'beta@example.com' }
        ],
        shop_inventory: []
    }, async ({ handler, state }) => {
        const refundReq = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/orders&query=Season&refundStatus=full_refund&page=1&pageSize=10'
        };
        const refundRes = createMockResponse();
        await handler(refundReq, refundRes);
        const refundPayload = refundRes.json();

        assert.equal(refundRes.statusCode, 200);
        assert.equal(refundPayload.count, 1);
        assert.equal(refundPayload.rows[0]?.id, 'ord_refund');

        const deliveryReq = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/orders&query=Season&deliveryStatus=dead_letter&page=1&pageSize=10'
        };
        const deliveryRes = createMockResponse();
        await handler(deliveryReq, deliveryRes);
        const deliveryPayload = deliveryRes.json();

        assert.equal(deliveryRes.statusCode, 200);
        assert.equal(deliveryPayload.count, 1);
        assert.equal(deliveryPayload.rows[0]?.id, 'ord_dead');
        assert.equal(
            state.calls.some((entry) => entry.table === 'shop_orders' && entry.eqFilters.some(([column, value]) => column === 'refund_status' && value === 'full_refund')),
            true,
            'handler should forward analytics refund filters into the shop order query'
        );
        assert.equal(
            state.calls.some((entry) => entry.table === 'shop_orders' && entry.eqFilters.some(([column, value]) => column === 'delivery_status' && value === 'dead_letter')),
            true,
            'handler should forward analytics delivery filters into the shop order query'
        );
    });
});

test('shop orders handler falls back to profile search when query matches user email', async () => {
    const userId = '55555555-5555-4555-8555-555555555555';
    await withShopOrdersHandler({
        shop_orders: [
            {
                id: 'ord_email_1',
                user_id: userId,
                product_id: 'prod_api',
                inventory_id: null,
                snapshot_product_name: 'Webhook Goods',
                created_at: '2026-04-08T10:00:00.000Z',
                total_price: 300,
                price_paid: 300,
                refund_status: 'none',
                delivery_status: 'pending'
            }
        ],
        profiles: [
            { id: userId, username: 'ops-user', avatar_url: null, email: 'ops@example.com' }
        ],
        shop_order_items: [],
        shop_inventory: []
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/orders&query=ops%40example.com&page=1&pageSize=10'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.count, 1);
        assert.equal(payload.rows[0]?.id, 'ord_email_1');
        assert.equal(
            state.calls.some((entry) => entry.table === 'profiles' && entry.orExpression.includes('email.ilike.%ops@example.com%')),
            true,
            'handler should search profiles when direct order search misses and user email is provided'
        );
        assert.equal(
            state.calls.some((entry) => entry.table === 'shop_orders' && entry.inFilters.some(([column, values]) => column === 'user_id' && values.includes(userId))),
            true,
            'handler should map profile ids back into the shop order query'
        );
    });
});

test('shop orders handler ignores non-uuid profile ids when fallback profile search matches numeric queries', async () => {
    await withShopOrdersHandler({
        shop_orders: [],
        profiles: [
            { id: '7', username: 'user7', avatar_url: null, email: '7@example.com' }
        ],
        shop_order_items: [],
        shop_inventory: []
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/orders&query=7&page=1&pageSize=10'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();
        const shopOrderUserLookup = state.calls.find((entry) => (
            entry.table === 'shop_orders'
            && entry.inFilters.some(([column]) => column === 'user_id')
        ));

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.count, 0);
        assert.equal(Array.isArray(payload.rows), true);
        assert.equal(payload.rows.length, 0);
        assert.equal(shopOrderUserLookup, undefined);
    });
});
