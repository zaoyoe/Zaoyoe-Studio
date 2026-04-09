const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
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

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        payload: null,
        single: false
    };

    const builder = {
        select() {
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, values: Array.isArray(values) ? values.slice() : [] });
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, ascending: options.ascending !== false };
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        single() {
            state.single = true;
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

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.op === 'eq') return row[filter.column] === filter.value;
        if (filter.op === 'in') return filter.values.includes(row[filter.column]);
        if (filter.op === 'gte') {
            const rowTime = Date.parse(row[filter.column] || '');
            const targetTime = Date.parse(filter.value || '');
            if (!Number.isFinite(targetTime)) return true;
            return Number.isFinite(rowTime) ? rowTime >= targetTime : false;
        }
        return true;
    }));
}

function cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
}

function createSupabaseStub(state) {
    state.discountRows = Array.isArray(state.discountRows) ? state.discountRows : [];
    state.assetRows = Array.isArray(state.assetRows) ? state.assetRows : [];
    state.eventRows = Array.isArray(state.eventRows) ? state.eventRows : [];
    state.insertSeq = state.insertSeq || 1;
    state.rpcCalls = Array.isArray(state.rpcCalls) ? state.rpcCalls : [];

    return {
        from(table) {
            return createQueryBuilder((query) => {
                let rows;
                if (table === 'discount_codes') rows = state.discountRows.slice().map(cloneRow);
                else if (table === 'discount_user_assets') rows = state.assetRows.slice().map(cloneRow);
                else if (table === 'discount_event_logs') rows = state.eventRows.slice().map(cloneRow);
                else throw new Error(`Unexpected table request: ${table}`);

                if (query.mode === 'insert') {
                    const payloadRows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const insertedRows = payloadRows.map((row) => ({
                        id: row.id || `row_${state.insertSeq++}`,
                        ...cloneRow(row)
                    }));
                    if (table === 'discount_user_assets') {
                        state.assetRows.push(...insertedRows);
                    } else if (table === 'discount_event_logs') {
                        state.eventRows.push(...insertedRows);
                    }
                    return {
                        data: query.single ? insertedRows[0] : insertedRows,
                        error: null
                    };
                }

                rows = applyFilters(rows, query.filters);
                if (query.order?.column) {
                    rows.sort((left, right) => {
                        const leftValue = Date.parse(left[query.order.column] || '') || 0;
                        const rightValue = Date.parse(right[query.order.column] || '') || 0;
                        return query.order.ascending ? leftValue - rightValue : rightValue - leftValue;
                    });
                }

                const first = rows[0] || null;
                return {
                    data: query.single ? first : rows,
                    error: first || !query.single ? null : { status: 406, message: 'Not found' }
                };
            });
        },
        rpc(name, params) {
            state.rpcCalls.push({ name, params });
            if (name === 'fn_validate_discount_code') {
                return Promise.resolve({
                    data: {
                        success: true,
                        message: '优惠码可用',
                        data: {
                            discount_id: params.p_discount_asset_id ? 'discount_owned' : 'discount_public',
                            discount_code: params.p_discount_code,
                            discount_type: 'fixed',
                            discount_value: 20,
                            discount_amount: 20,
                            subtotal: 100,
                            final_total: 80,
                            is_exclusive: params.p_discount_asset_id ? true : false,
                            stack_priority: params.p_discount_asset_id ? 100 : 18,
                            pricing_apply_stage: params.p_discount_asset_id ? 'order_discount' : 'catalog_price'
                        }
                    },
                    error: null
                });
            }
            throw new Error(`Unexpected RPC: ${name}`);
        }
    };
}

async function withShopHandler(relativePath, initialState, callback) {
    const handlerPath = path.resolve(__dirname, relativePath);
    const originalLoad = Module._load;
    const state = {
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return {
                getOptionalSupabaseAdmin() {
                    return createSupabaseStub(state);
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                async requireAuthenticatedUser() {
                    const supabase = createSupabaseStub(state);
                    return {
                        user: { id: 'user_1', email: 'member@example.com' },
                        supabase,
                        requestSupabase: supabase,
                        adminSupabase: supabase
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        if (request === '../_lib/request-security') {
            return {
                resolveClientIp() {
                    return '203.0.113.8';
                },
                takeRateLimitToken() {
                    return {
                        allowed: true,
                        limit: 10,
                        remaining: 9,
                        resetAt: Date.now() + 60_000,
                        retryAfterSeconds: 60
                    };
                },
                applyRateLimitHeaders() {}
            };
        }

        if (request === '../_lib/site') {
            return {
                requireSupportedSite(value) {
                    return String(value || 'cn').trim().toLowerCase() || 'cn';
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

test('available discounts endpoint returns owned assets and public claimable coupons', async () => {
    await withShopHandler('../api/shop/available-discounts.js', {
        discountRows: [
            {
                id: 'discount_owned',
                code: 'VIP20',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'user_assigned'
            },
            {
                id: 'discount_public',
                code: 'WELCOME20',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'public_claim',
                claim_limit_per_user: 1
            }
        ],
        assetRows: [
            {
                id: 'asset_1',
                discount_id: 'discount_owned',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-09T08:00:00.000Z',
                claimed_at: '2026-04-09T08:00:00.000Z',
                source_channel: 'vip_recall'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                productId: 'product_1',
                quantity: 1,
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.owned_discounts.length, 1);
        assert.equal(payload.owned_discounts[0].asset_id, 'asset_1');
        assert.equal(payload.claimable_discounts.length, 1);
        assert.equal(payload.claimable_discounts[0].discount_id, 'discount_public');
        assert.equal(state.rpcCalls.length, 1);
    });
});

test('claim discount endpoint inserts a new asset and logs a claim event', async () => {
    await withShopHandler('../api/shop/claim-discount.js', {
        discountRows: [
            {
                id: 'discount_public',
                code: 'WELCOME20',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'public_claim',
                claim_limit_per_user: 1
            }
        ],
        assetRows: [],
        eventRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                discountId: 'discount_public',
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.assetRows.length, 1);
        assert.equal(state.eventRows.length, 1);
        assert.equal(state.eventRows[0].event_type, 'claim');
    });
});

test('validate discount endpoint returns pricing waterfall and stacking policy for owned or claim-backed coupons', async () => {
    await withShopHandler('../api/shop/validate-discount.js', {
        discountRows: [
            {
                id: 'discount_public',
                code: 'WELCOME20',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'public_claim'
            }
        ],
        assetRows: [],
        eventRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                productId: 'product_1',
                quantity: 1,
                site: 'cn',
                discountCode: ' welcome20 '
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.data.stacking_policy.pricing_apply_stage, 'catalog_price');
        assert.equal(payload.data.stacking_policy.exclusivity_label, '可并行');
        assert.equal(payload.data.stacking_policy.apply_stage_label, '目录价阶段');
        assert.equal(Array.isArray(payload.data.pricing_waterfall), true);
        assert.equal(payload.data.pricing_waterfall[2].key, 'discount');
        assert.equal(payload.data.pricing_waterfall[3].amount, 80);
        assert.equal(state.rpcCalls.length, 1);
        assert.equal(state.rpcCalls[0].name, 'fn_validate_discount_code');
    });
});
