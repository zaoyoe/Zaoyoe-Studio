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
        update(payload) {
            state.mode = 'update';
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
    state.notificationRows = Array.isArray(state.notificationRows) ? state.notificationRows : [];
    state.orderRows = Array.isArray(state.orderRows) ? state.orderRows : [];
    state.productRows = Array.isArray(state.productRows) ? state.productRows : [];
    state.skuRows = Array.isArray(state.skuRows) ? state.skuRows : [];
    state.previewErrorByAssetId = state.previewErrorByAssetId && typeof state.previewErrorByAssetId === 'object'
        ? state.previewErrorByAssetId
        : {};
    state.previewResponseByAssetId = state.previewResponseByAssetId && typeof state.previewResponseByAssetId === 'object'
        ? state.previewResponseByAssetId
        : {};
    state.claimRpcResponse = Object.prototype.hasOwnProperty.call(state, 'claimRpcResponse')
        ? state.claimRpcResponse
        : undefined;
    state.insertSeq = state.insertSeq || 1;
    state.rpcCalls = Array.isArray(state.rpcCalls) ? state.rpcCalls : [];

    return {
        from(table) {
            return createQueryBuilder((query) => {
                let rows;
                if (table === 'discount_codes') rows = state.discountRows.slice().map(cloneRow);
                else if (table === 'discount_user_assets') rows = state.assetRows.slice().map(cloneRow);
                else if (table === 'discount_event_logs') rows = state.eventRows.slice().map(cloneRow);
                else if (table === 'shop_orders') rows = state.orderRows.slice().map(cloneRow);
                else if (table === 'shop_products') rows = state.productRows.slice().map(cloneRow);
                else if (table === 'shop_product_skus') rows = state.skuRows.slice().map(cloneRow);
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

                if (query.mode === 'update') {
                    rows = applyFilters(rows, query.filters);
                    const updates = cloneRow(query.payload || {});
                    const updatedRows = rows.map((row) => ({
                        ...row,
                        ...updates
                    }));

                    if (table === 'discount_user_assets') {
                        const updatedIds = new Set(updatedRows.map((row) => row.id));
                        state.assetRows = state.assetRows.map((row) => (
                            updatedIds.has(row.id)
                                ? {
                                    ...row,
                                    ...updates
                                }
                                : row
                        ));
                    }

                    return {
                        data: query.single ? updatedRows[0] || null : updatedRows,
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
                const previewResponse = state.previewResponseByAssetId[String(params?.p_discount_asset_id || '').trim()] || null;
                if (previewResponse) {
                    return Promise.resolve(cloneRow(previewResponse));
                }
                const previewError = state.previewErrorByAssetId[String(params?.p_discount_asset_id || '').trim()] || null;
                if (previewError) {
                    return Promise.resolve({
                        data: null,
                        error: {
                            message: previewError.message || '当前不可用'
                        }
                    });
                }
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
            if (name === 'fn_claim_public_discount') {
                if (typeof state.claimRpcResponse === 'function') {
                    return Promise.resolve(cloneRow(state.claimRpcResponse(params)));
                }
                if (state.claimRpcResponse !== undefined) {
                    return Promise.resolve(cloneRow(state.claimRpcResponse));
                }
                return Promise.resolve({
                    data: null,
                    error: {
                        code: 'PGRST202',
                        message: `Could not find the function public.${name}(p_discount_id, p_discount_code, p_user_id, p_site, p_source_channel) in the schema cache`
                    }
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

        if (request === '../../../api/_lib/admin-notifications') {
            return {
                async notifyUsers(_supabase, payload = {}) {
                    state.notificationRows.push(cloneRow(payload));
                    const userIds = Array.isArray(payload.userIds) ? payload.userIds.filter(Boolean) : [];
                    return {
                        recipients: userIds.length,
                        created: userIds.length,
                        skipped: 0
                    };
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
                distribution_mode: 'user_assigned',
                discount_type: 'fixed',
                discount_value: 20,
                is_exclusive: true,
                stack_priority: 100,
                pricing_apply_stage: 'order_discount'
            },
            {
                id: 'discount_public',
                code: 'WELCOME20',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'public_claim',
                discount_type: 'percent',
                discount_value: 80,
                claim_limit_per_user: 1,
                is_exclusive: false,
                stack_priority: 18,
                pricing_apply_stage: 'catalog_price'
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
        assert.equal(payload.owned_discounts[0].benefit_label, '立减 20 积分');
        assert.equal(payload.owned_discounts[0].is_exclusive, true);
        assert.equal(payload.owned_discounts[0].stacking_label, '排他券');
        assert.equal(payload.claimable_discounts.length, 1);
        assert.equal(payload.claimable_discounts[0].discount_id, 'discount_public');
        assert.equal(payload.claimable_discounts[0].benefit_label, '8折');
        assert.equal(payload.claimable_discounts[0].is_exclusive, false);
        assert.equal(payload.claimable_discounts[0].stacking_label, '可并行权益');
        assert.equal(state.rpcCalls.length, 1);
    });
});

test('available discounts endpoint forwards selected SKU to preview RPCs', async () => {
    const productSkuId = '11111111-1111-4111-8111-111111111111';

    await withShopHandler('../api/shop/available-discounts.js', {
        discountRows: [
            {
                id: 'discount_sku_scoped',
                code: 'SKU90',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'user_assigned',
                discount_type: 'percent',
                discount_value: 90,
                scope_type: 'product',
                scope_product_id: 'product_1',
                scope_product_sku_id: productSkuId
            }
        ],
        assetRows: [
            {
                id: 'asset_sku_scoped',
                discount_id: 'discount_sku_scoped',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-05-25T09:00:00.000Z',
                claimed_at: '2026-05-25T09:00:00.000Z',
                source_channel: 'manual_grant'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                productId: 'product_1',
                productSkuId,
                quantity: 1,
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.rpcCalls.length, 1);
        assert.equal(state.rpcCalls[0].name, 'fn_validate_discount_code');
        assert.equal(state.rpcCalls[0].params.p_sku_id, productSkuId);
    });
});

test('available discounts endpoint exposes human-friendly source labels and scoped target product info', async () => {
    await withShopHandler('../api/shop/available-discounts.js', {
        discountRows: [
            {
                id: 'discount_scoped',
                code: 'WY637KWP',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'user_assigned',
                discount_type: 'fixed',
                discount_value: 2,
                scope_type: 'product',
                scope_product_id: 'product_target_1',
                scope_product_sku_id: 'sku_target_month'
            }
        ],
        productRows: [
            {
                id: 'product_target_1',
                name: '周卡会员',
                name_en: 'Weekly VIP',
                category: '会员',
                is_active: true
            }
        ],
        skuRows: [
            {
                id: 'sku_target_month',
                product_id: 'product_target_1',
                sku_code: 'month',
                sku_name: '月卡',
                is_active: true
            }
        ],
        assetRows: [
            {
                id: 'asset_scoped',
                discount_id: 'discount_scoped',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-16T10:20:21.000Z',
                claimed_at: '2026-04-16T10:20:21.000Z',
                source_channel: 'wallet_recharge'
            }
        ],
        previewErrorByAssetId: {
            asset_scoped: {
                message: '当前商品不适用这张卡券'
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                productId: 'product_current',
                quantity: 1,
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.owned_discounts.length, 1);
        assert.equal(payload.owned_discounts[0].available, false);
        assert.equal(payload.owned_discounts[0].source_label, '充值赠券');
        assert.equal(payload.owned_discounts[0].scope_type, 'product');
        assert.equal(payload.owned_discounts[0].scope_product_id, 'product_target_1');
        assert.equal(payload.owned_discounts[0].scope_product_sku_id, 'sku_target_month');
        assert.equal(payload.owned_discounts[0].scope_product.display_name, '周卡会员');
        assert.equal(payload.owned_discounts[0].scope_product_sku.display_name, '月卡');
        assert.equal(payload.owned_discounts[0].scope_label, '指定商品 · 周卡会员 / 月卡');
    });
});

test('available discounts endpoint preserves preview rejection messages for owned coupons', async () => {
    await withShopHandler('../api/shop/available-discounts.js', {
        discountRows: [
            {
                id: 'discount_fixed_zero',
                code: 'WY637KWP',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'user_assigned',
                discount_type: 'fixed',
                discount_value: 2,
                is_exclusive: false
            }
        ],
        assetRows: [
            {
                id: 'asset_fixed_zero',
                discount_id: 'discount_fixed_zero',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-16T17:35:00.000Z',
                claimed_at: '2026-04-16T17:35:00.000Z',
                source_channel: 'wallet_recharge'
            }
        ],
        previewResponseByAssetId: {
            asset_fixed_zero: {
                data: {
                    success: false,
                    message: '该优惠码不允许全额抵扣',
                    data: {
                        discount_code: 'WY637KWP',
                        discount_type: 'fixed',
                        discount_value: 2,
                        discount_amount: 2,
                        subtotal: 2,
                        final_total: 0
                    }
                },
                error: null
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                productId: 'product_zero_total',
                quantity: 1,
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.owned_discounts.length, 1);
        assert.equal(payload.owned_discounts[0].available, false);
        assert.equal(payload.owned_discounts[0].message, '该优惠码不允许全额抵扣');
        assert.equal(payload.owned_discounts[0].preview.final_total, 0);
    });
});

test('available discounts endpoint hides public claim coupons after the user reaches the claim limit', async () => {
    await withShopHandler('../api/shop/available-discounts.js', {
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
        assetRows: [
            {
                id: 'asset_claimed_once',
                discount_id: 'discount_public',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-10T08:00:00.000Z',
                claimed_at: '2026-04-10T08:00:00.000Z',
                source_channel: 'claim_center'
            }
        ]
    }, async ({ handler }) => {
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
        assert.equal(payload.claimable_discounts.length, 0);
    });
});

test('available discounts endpoint suppresses duplicate fresh public-claim assets before the cleanup migration runs', async () => {
    await withShopHandler('../api/shop/available-discounts.js', {
        discountRows: [
            {
                id: 'discount_public',
                code: 'WQXXIVPQ',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'public_claim',
                claim_limit_per_user: 1
            }
        ],
        assetRows: [
            {
                id: 'asset_keep',
                discount_id: 'discount_public',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-15T12:00:00.000Z',
                claimed_at: '2026-04-15T12:00:00.000Z',
                source_type: 'public_claim',
                source_channel: 'claim_center'
            },
            {
                id: 'asset_duplicate',
                discount_id: 'discount_public',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-15T12:00:01.000Z',
                claimed_at: '2026-04-15T12:00:01.000Z',
                source_type: 'public_claim',
                source_channel: 'claim_center'
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
        assert.equal(payload.owned_discounts[0].asset_id, 'asset_keep');
        assert.equal(payload.claimable_discounts.length, 0);
        assert.equal(state.rpcCalls.filter((call) => call.name === 'fn_validate_discount_code').length, 1);
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
        assert.equal(state.notificationRows.length, 1);
        assert.deepEqual(state.notificationRows[0]?.userIds, ['user_1']);
        assert.equal(state.notificationRows[0]?.title, '优惠券领取成功');
        assert.match(state.notificationRows[0]?.content || '', /我的钱包 > 卡券/);
    });
});

test('claim discount endpoint prefers the atomic claim RPC when it is available', async () => {
    await withShopHandler('../api/shop/claim-discount.js', {
        discountRows: [],
        assetRows: [],
        eventRows: [],
        claimRpcResponse: {
            data: {
                success: true,
                message: '领取成功',
                asset: {
                    id: 'asset_rpc_1',
                    discount_id: 'discount_public',
                    user_id: 'user_1',
                    asset_status: 'available',
                    claimed_at: '2026-04-15T13:00:00.000Z',
                    source_channel: 'claim_center',
                    audience_segment: 'public_claim'
                },
                discount: {
                    id: 'discount_public',
                    code: 'WELCOME20',
                    campaign_tag: 'spring-claim',
                    audience_segment: 'public_claim'
                }
            },
            error: null
        }
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
        assert.equal(payload.asset.id, 'asset_rpc_1');
        assert.equal(state.assetRows.length, 0);
        assert.equal(state.eventRows.length, 1);
        assert.equal(state.notificationRows.length, 1);
        assert.equal(state.notificationRows[0]?.title, '优惠券领取成功');
        assert.equal(state.rpcCalls[0].name, 'fn_claim_public_discount');
    });
});

test('claim discount endpoint treats repeated single-claim requests as already claimed instead of failing', async () => {
    await withShopHandler('../api/shop/claim-discount.js', {
        discountRows: [
            {
                id: 'discount_public',
                code: 'WQXXIVPQ',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'public_claim',
                claim_limit_per_user: 1,
                audience_segment: 'public_claim'
            }
        ],
        assetRows: [
            {
                id: 'asset_claimed_once',
                discount_id: 'discount_public',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-15T13:00:00.000Z',
                claimed_at: '2026-04-15T13:00:00.000Z',
                source_type: 'public_claim',
                source_channel: 'claim_center',
                audience_segment: 'public_claim'
            }
        ],
        eventRows: [],
        claimRpcResponse: {
            data: {
                success: false,
                status_code: 409,
                message: '你已达到该优惠券的领取上限'
            },
            error: null
        }
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
        assert.equal(payload.already_claimed, true);
        assert.equal(payload.asset.id, 'asset_claimed_once');
        assert.match(payload.message, /已领取过/);
        assert.equal(state.eventRows.length, 0);
        assert.equal(state.notificationRows.length, 0);
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
        assert.equal(payload.data.benefit_label, '立减 20 积分');
        assert.equal(payload.data.stacking_policy.pricing_apply_stage, 'catalog_price');
        assert.equal(payload.data.stacking_policy.exclusivity_label, '可并行权益');
        assert.equal(payload.data.stacking_policy.apply_stage_label, '目录价阶段');
        assert.equal(Array.isArray(payload.data.pricing_waterfall), true);
        assert.equal(payload.data.pricing_waterfall[2].key, 'discount');
        assert.equal(payload.data.pricing_waterfall[3].amount, 80);
        assert.equal(state.rpcCalls.length, 1);
        assert.equal(state.rpcCalls[0].name, 'fn_validate_discount_code');
    });
});

test('validate discount endpoint can combine multiple selected coupons into one stacked preview', async () => {
    await withShopHandler('../api/shop/validate-discount.js', {
        discountRows: [
            {
                id: 'discount_stack_a',
                code: 'STACKA10',
                allow_zero_total: false,
                is_exclusive: false,
                stack_priority: 8,
                pricing_apply_stage: 'catalog_price'
            },
            {
                id: 'discount_stack_b',
                code: 'STACKB5',
                allow_zero_total: false,
                is_exclusive: false,
                stack_priority: 16,
                pricing_apply_stage: 'order_discount'
            }
        ],
        previewResponseByAssetId: {
            asset_stack_a: {
                data: {
                    success: true,
                    message: '优惠码可用',
                    data: {
                        discount_id: 'discount_stack_a',
                        discount_code: 'STACKA10',
                        discount_type: 'fixed',
                        discount_value: 10,
                        discount_amount: 10,
                        subtotal: 100,
                        final_total: 90,
                        is_exclusive: false,
                        stack_priority: 8,
                        pricing_apply_stage: 'catalog_price',
                        distribution_mode: 'user_assigned'
                    }
                },
                error: null
            },
            asset_stack_b: {
                data: {
                    success: true,
                    message: '优惠码可用',
                    data: {
                        discount_id: 'discount_stack_b',
                        discount_code: 'STACKB5',
                        discount_type: 'fixed',
                        discount_value: 5,
                        discount_amount: 5,
                        subtotal: 100,
                        final_total: 95,
                        is_exclusive: false,
                        stack_priority: 16,
                        pricing_apply_stage: 'order_discount',
                        distribution_mode: 'user_assigned'
                    }
                },
                error: null
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                productId: 'product_1',
                quantity: 1,
                site: 'cn',
                discountSelections: [
                    {
                        discountAssetId: 'asset_stack_a',
                        discountCode: 'stacka10'
                    },
                    {
                        discountAssetId: 'asset_stack_b',
                        discountCode: 'stackb5'
                    }
                ]
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.data.discount_amount, 15);
        assert.equal(payload.data.final_total, 85);
        assert.equal(payload.data.benefit_label, '已叠加 2 张卡券');
        assert.equal(payload.data.applied_discounts.length, 2);
        assert.equal(payload.data.pricing_waterfall.length, 5);
        assert.equal(payload.data.stacking_policy.exclusivity_label, '已叠加 2 张');
        assert.equal(state.rpcCalls.length, 2);
        assert.equal(state.rpcCalls[0].params.p_discount_asset_id, 'asset_stack_a');
        assert.equal(state.rpcCalls[1].params.p_discount_asset_id, 'asset_stack_b');
    });
});

test('my discount assets endpoint groups wallet cards by availability and accumulates saved amount', async () => {
    const now = Date.now();
    const expiringSoonAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const assignedAt = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const usedAssignedAt = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    const consumedAt = new Date(now - 6 * 60 * 60 * 1000).toISOString();

    await withShopHandler('../api/shop/my-discount-assets.js', {
        discountRows: [
            {
                id: 'discount_available',
                code: 'VIP20',
                is_active: true,
                applicable_site: 'all',
                discount_type: 'fixed',
                discount_value: 20,
                distribution_mode: 'user_assigned',
                is_exclusive: false,
                stack_priority: 20,
                pricing_apply_stage: 'catalog_price',
                scope_type: 'product',
                scope_product_id: 'product_prompt_pro',
                lifecycle_status: 'active'
            },
            {
                id: 'discount_used',
                code: 'SPRING80',
                is_active: true,
                applicable_site: 'cn',
                discount_type: 'percent',
                discount_value: 80,
                distribution_mode: 'user_assigned',
                scope_type: 'category',
                scope_category: 'prompt',
                lifecycle_status: 'active'
            },
            {
                id: 'discount_paused',
                code: 'PAUSE50',
                is_active: false,
                applicable_site: 'cn',
                discount_type: 'fixed',
                discount_value: 50,
                distribution_mode: 'user_assigned',
                scope_type: 'all',
                lifecycle_status: 'paused_manual',
                status_reason: 'manual_pause'
            },
            {
                id: 'discount_intl_only',
                code: 'INTL10',
                is_active: true,
                applicable_site: 'intl',
                discount_type: 'fixed',
                discount_value: 10,
                distribution_mode: 'user_assigned',
                scope_type: 'all',
                lifecycle_status: 'active'
            }
        ],
        assetRows: [
            {
                id: 'asset_available',
                discount_id: 'discount_available',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: assignedAt,
                expires_at: expiringSoonAt,
                source_type: 'manual_assign',
                source_channel: 'vip_recall'
            },
            {
                id: 'asset_used',
                discount_id: 'discount_used',
                user_id: 'user_1',
                asset_status: 'used',
                assigned_at: usedAssignedAt,
                consumed_at: consumedAt,
                source_type: 'manual_assign',
                source_channel: 'recharge_bonus',
                last_order_id: 'order_1'
            },
            {
                id: 'asset_paused',
                discount_id: 'discount_paused',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-13T01:00:00.000Z',
                source_type: 'manual_assign',
                source_channel: 'admin_grant'
            },
            {
                id: 'asset_other_site',
                discount_id: 'discount_intl_only',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-12T01:00:00.000Z'
            }
        ],
        orderRows: [
            {
                id: 'order_1',
                discount_asset_id: 'asset_used',
                snapshot_product_name: 'Prompt Pro 月卡',
                discount_amount: 35,
                refund_status: 'none',
                created_at: '2026-04-15T02:00:00.000Z'
            }
        ],
        productRows: [
            {
                id: 'product_prompt_pro',
                name: 'Prompt Pro 年卡',
                name_en: 'Prompt Pro Annual',
                category: 'account',
                is_active: true
            }
        ]
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.total_count, 3);
        assert.equal(payload.summary.available_count, 1);
        assert.equal(payload.summary.used_count, 1);
        assert.equal(payload.summary.inactive_count, 1);
        assert.equal(payload.summary.expiring_soon_count, 1);
        assert.equal(payload.summary.saved_amount_total, 35);
        assert.equal(payload.available_assets[0].asset_id, 'asset_available');
        assert.equal(payload.available_assets[0].can_remove, true);
        assert.equal(payload.available_assets[0].status_label, '即将过期');
        assert.equal(payload.available_assets[0].scope_label, '指定商品 · Prompt Pro 年卡');
        assert.equal(payload.available_assets[0].scope_product.id, 'product_prompt_pro');
        assert.equal(payload.available_assets[0].scope_product.category, 'account');
        assert.equal(payload.available_assets[0].is_exclusive, false);
        assert.equal(payload.available_assets[0].stacking_label, '可并行权益');
        assert.equal(payload.used_assets[0].benefit_label, '8折');
        assert.equal(payload.used_assets[0].can_remove, false);
        assert.equal(payload.used_assets[0].related_order.snapshot_product_name, 'Prompt Pro 月卡');
        assert.equal(payload.inactive_assets[0].status_label, '手动停用');
    });
});

test('remove discount asset endpoint revokes a wallet coupon and records an audit event', async () => {
    await withShopHandler('../api/shop/remove-discount-asset.js', {
        discountRows: [
            {
                id: 'discount_wallet_remove',
                code: 'WY637KWP',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'user_assigned',
                discount_type: 'fixed',
                discount_value: 2,
                audience_segment: 'recharge_high_value',
                lifecycle_status: 'active'
            }
        ],
        assetRows: [
            {
                id: 'asset_wallet_remove',
                discount_id: 'discount_wallet_remove',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-16T12:37:00.000Z',
                source_type: 'manual_assign',
                source_channel: 'recharge_linkage',
                audience_segment: 'recharge_high_value'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                site: 'cn',
                assetId: 'asset_wallet_remove'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.asset_id, 'asset_wallet_remove');
        assert.equal(payload.asset_status, 'revoked');
        assert.equal(state.assetRows[0]?.asset_status, 'revoked');
        assert.equal(state.eventRows.length, 1);
        assert.equal(state.eventRows[0]?.event_type, 'wallet_remove');
        assert.equal(state.eventRows[0]?.discount_asset_id, 'asset_wallet_remove');
        assert.equal(state.eventRows[0]?.event_source, 'wallet_modal');
        assert.equal(state.eventRows[0]?.source_channel, 'recharge_linkage');
    });
});

test('remove discount asset endpoint rejects coupons that are no longer available', async () => {
    await withShopHandler('../api/shop/remove-discount-asset.js', {
        discountRows: [
            {
                id: 'discount_used_wallet',
                code: 'USED88',
                is_active: true,
                applicable_site: 'cn',
                distribution_mode: 'user_assigned',
                discount_type: 'percent',
                discount_value: 88,
                lifecycle_status: 'active'
            }
        ],
        assetRows: [
            {
                id: 'asset_used_wallet',
                discount_id: 'discount_used_wallet',
                user_id: 'user_1',
                asset_status: 'used',
                assigned_at: '2026-04-15T10:00:00.000Z',
                consumed_at: '2026-04-16T11:00:00.000Z'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                site: 'cn',
                assetId: 'asset_used_wallet'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /不能删除/);
        assert.equal(state.assetRows[0]?.asset_status, 'used');
        assert.equal(state.eventRows.length, 0);
    });
});

test('my discount assets endpoint shows the scoped product preview total when a product coupon is usable', async () => {
    await withShopHandler('../api/shop/my-discount-assets.js', {
        discountRows: [
            {
                id: 'discount_scoped',
                code: 'CZ187YE8',
                is_active: true,
                applicable_site: 'cn',
                discount_type: 'percent',
                discount_value: 9,
                distribution_mode: 'user_assigned',
                scope_type: 'product',
                scope_product_id: 'product_redeem',
                lifecycle_status: 'active'
            }
        ],
        assetRows: [
            {
                id: 'asset_scoped',
                discount_id: 'discount_scoped',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-13T08:00:00.000Z',
                source_channel: 'claim_center'
            }
        ],
        productRows: [
            {
                id: 'product_redeem',
                name: '兑换码',
                name_en: 'Redeem Code',
                category: 'other',
                is_active: true
            }
        ],
        previewResponseByAssetId: {
            asset_scoped: {
                data: {
                    success: true,
                    message: '优惠码可用',
                    data: {
                        discount_id: 'discount_scoped',
                        discount_asset_id: 'asset_scoped',
                        discount_code: 'CZ187YE8',
                        discount_type: 'percent',
                        discount_value: 9,
                        subtotal: 3,
                        discount_amount: 2.73,
                        final_total: 0.27
                    }
                },
                error: null
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.available_assets.length, 1);
        assert.equal(payload.available_assets[0].status_label, '可用');
        assert.equal(payload.available_assets[0].status_tone, 'available');
        assert.equal(payload.available_assets[0].scoped_product_available, true);
        assert.equal(payload.available_assets[0].scoped_product_preview.final_total, 0.27);
        assert.match(payload.available_assets[0].status_detail, /预计实付 0\.27 积分/);
    });
});

test('my discount assets endpoint suppresses duplicate fresh public-claim assets before database cleanup', async () => {
    await withShopHandler('../api/shop/my-discount-assets.js', {
        discountRows: [
            {
                id: 'discount_public',
                code: 'WQXXIVPQ',
                is_active: true,
                applicable_site: 'cn',
                discount_type: 'percent',
                discount_value: 90,
                distribution_mode: 'public_claim',
                claim_limit_per_user: 1,
                scope_type: 'all',
                lifecycle_status: 'active'
            }
        ],
        assetRows: [
            {
                id: 'asset_keep',
                discount_id: 'discount_public',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-15T12:00:00.000Z',
                claimed_at: '2026-04-15T12:00:00.000Z',
                source_type: 'public_claim',
                source_channel: 'claim_center'
            },
            {
                id: 'asset_duplicate',
                discount_id: 'discount_public',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-15T12:00:01.000Z',
                claimed_at: '2026-04-15T12:00:01.000Z',
                source_type: 'public_claim',
                source_channel: 'claim_center'
            }
        ]
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.total_count, 1);
        assert.equal(payload.summary.available_count, 1);
        assert.equal(payload.available_assets.length, 1);
        assert.equal(payload.available_assets[0].asset_id, 'asset_keep');
    });
});

test('my discount assets endpoint surfaces the scoped product unavailable reason when a target product cannot use the coupon', async () => {
    await withShopHandler('../api/shop/my-discount-assets.js', {
        discountRows: [
            {
                id: 'discount_scoped',
                code: 'CZ187YE8',
                is_active: true,
                applicable_site: 'cn',
                discount_type: 'fixed',
                discount_value: 1,
                distribution_mode: 'user_assigned',
                scope_type: 'product',
                scope_product_id: 'product_redeem',
                lifecycle_status: 'active'
            }
        ],
        assetRows: [
            {
                id: 'asset_scoped',
                discount_id: 'discount_scoped',
                user_id: 'user_1',
                asset_status: 'available',
                assigned_at: '2026-04-13T08:00:00.000Z',
                source_channel: 'claim_center'
            }
        ],
        productRows: [
            {
                id: 'product_redeem',
                name: '兑换码',
                name_en: 'Redeem Code',
                category: 'other',
                is_active: true
            }
        ],
        previewErrorByAssetId: {
            asset_scoped: {
                message: '该商品当前不支持使用这张卡券'
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.available_assets.length, 1);
        assert.equal(payload.available_assets[0].status_label, '暂不可用');
        assert.equal(payload.available_assets[0].status_tone, 'inactive');
        assert.equal(payload.available_assets[0].scoped_product_available, false);
        assert.match(payload.available_assets[0].status_detail, /该商品当前不支持使用这张卡券/);
    });
});
