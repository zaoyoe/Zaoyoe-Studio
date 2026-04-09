const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const adminLib = require('../api/_lib/admin');

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

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        payload: null,
        order: null,
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

function cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.op === 'eq') {
            return row[filter.column] === filter.value;
        }
        if (filter.op === 'in') {
            return filter.values.includes(row[filter.column]);
        }
        return true;
    }));
}

function createSupabaseStub(state) {
    state.discountRows = Array.isArray(state.discountRows) ? state.discountRows : [];
    state.profileRows = Array.isArray(state.profileRows) ? state.profileRows : [];
    state.assetRows = Array.isArray(state.assetRows) ? state.assetRows : [];
    state.insertSeq = state.insertSeq || 1;

    return {
        from(table) {
            return createQueryBuilder((query) => {
                let rows;
                if (table === 'discount_codes') rows = state.discountRows.slice().map(cloneRow);
                else if (table === 'profiles') rows = state.profileRows.slice().map(cloneRow);
                else if (table === 'discount_user_assets') rows = state.assetRows.slice().map(cloneRow);
                else throw new Error(`Unexpected table request: ${table}`);

                if (query.mode === 'insert') {
                    const payloadRows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const insertedRows = payloadRows.map((row) => ({
                        id: row.id || `asset_${state.insertSeq++}`,
                        ...cloneRow(row)
                    }));
                    state.assetRows.push(...insertedRows);
                    return {
                        data: query.single ? insertedRows[0] : insertedRows,
                        error: null
                    };
                }

                rows = applyFilters(rows, query.filters);
                if (query.order?.column) {
                    rows.sort((left, right) => {
                        const leftValue = String(left[query.order.column] || '');
                        const rightValue = String(right[query.order.column] || '');
                        return query.order.ascending
                            ? leftValue.localeCompare(rightValue)
                            : rightValue.localeCompare(leftValue);
                    });
                }

                const first = rows[0] || null;
                return {
                    data: query.single ? first : rows,
                    error: first || !query.single ? null : { status: 406, message: 'Not found' }
                };
            });
        }
    };
}

async function withDiscountAssetsHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/discounts/assets.js');
    const originalLoad = Module._load;
    const state = {
        auditCalls: [],
        requireAdminCalls: [],
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: createSupabaseStub(state),
                        user: { id: 'admin_1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditCalls.push(entry);
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

test('discount assets handler assigns coupon assets to resolved recipients and skips duplicates', async () => {
    await withDiscountAssetsHandler({
        discountRows: [
            {
                id: 'discount_1',
                code: 'VIPBACK',
                applicable_site: 'cn',
                distribution_mode: 'user_assigned',
                expires_at: '2026-12-31T23:59:00.000Z'
            }
        ],
        profileRows: [
            { id: 'user_1', username: 'alice' },
            { id: 'user_2', username: 'bob' }
        ],
        assetRows: [
            {
                id: 'asset_existing',
                discount_id: 'discount_1',
                user_id: 'user_2',
                asset_status: 'available'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'assign',
                site: 'cn',
                discount_id: 'discount_1',
                recipients: 'alice,bob,ghost-user',
                source_channel: 'vip_recall',
                audience_segment: 'vip'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.assigned_count, 1);
        assert.equal(payload.skipped_count, 1);
        assert.equal(payload.unresolved_count, 1);
        assert.equal(state.assetRows.length, 2);
        assert.equal(state.auditCalls.length, 1);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});
