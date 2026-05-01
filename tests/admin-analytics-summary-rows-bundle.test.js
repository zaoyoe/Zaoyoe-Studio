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
            state.statusCode = Number(code) || 200;
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

function createQueryBuilder(state, table, rows = [], options = {}) {
    const queryState = {
        table,
        rows: Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [],
        orderBy: '',
        ascending: false,
        from: 0,
        to: 499,
        eqFilters: [],
        gteFilters: [],
        lteFilters: [],
        shouldFail: options.shouldFail === true
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
        eq(column, value) {
            queryState.eqFilters.push([String(column || ''), value]);
            return builder;
        },
        gte(column, value) {
            queryState.gteFilters.push([String(column || ''), String(value || '')]);
            return builder;
        },
        lte(column, value) {
            queryState.lteFilters.push([String(column || ''), String(value || '')]);
            return builder;
        },
        then(resolve, reject) {
            state.calls.push({
                table,
                eqFilters: queryState.eqFilters.map((item) => [...item]),
                gteFilters: queryState.gteFilters.map((item) => [...item]),
                lteFilters: queryState.lteFilters.map((item) => [...item]),
                orderBy: queryState.orderBy,
                ascending: queryState.ascending,
                range: [queryState.from, queryState.to]
            });

            if (queryState.shouldFail) {
                return Promise.resolve({
                    data: null,
                    error: { message: `Failed to load ${table}` }
                }).then(resolve, reject);
            }

            let filteredRows = [...queryState.rows];

            for (const [column, value] of queryState.eqFilters) {
                filteredRows = filteredRows.filter((row) => String(row?.[column] || '') === String(value || ''));
            }

            for (const [column, value] of queryState.gteFilters) {
                filteredRows = filteredRows.filter((row) => String(row?.[column] || '') >= value);
            }

            for (const [column, value] of queryState.lteFilters) {
                filteredRows = filteredRows.filter((row) => String(row?.[column] || '') <= value);
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
                error: null
            }).then(resolve, reject);
        }
    };

    return builder;
}

async function withHandler(options = {}, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/summary-rows-bundle.js');
    const originalLoad = Module._load;
    const state = {
        calls: [],
        requireAdminCalls: []
    };
    const tables = options.tables || {};

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
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: {
                            from(table) {
                                const tableState = tables[table] || {};
                                return createQueryBuilder(state, table, tableState.rows || [], tableState);
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

test('analytics summary rows bundle filters site and explicit date range across shared tables', async () => {
    await withHandler({
        tables: {
            prompt_unlocks: {
                rows: [
                    { id: 'unlock-cn-1', site: 'cn', unlocked_at: '2026-04-05T01:00:00.000Z' },
                    { id: 'unlock-cn-2', site: 'cn', unlocked_at: '2026-04-03T01:00:00.000Z' },
                    { id: 'unlock-intl-1', site: 'intl', unlocked_at: '2026-04-05T02:00:00.000Z' }
                ]
            },
            verification_logs: {
                rows: [
                    { verification_id: 'verify-cn-1', site: 'cn', created_at: '2026-04-05T03:00:00.000Z' },
                    { verification_id: 'verify-old-1', site: 'cn', created_at: '2026-04-01T03:00:00.000Z' }
                ]
            },
            guestbook_messages: {
                rows: [
                    { id: 'message-cn-1', site: 'cn', created_at: '2026-04-04T03:00:00.000Z' }
                ]
            },
            guestbook_comments: {
                rows: [
                    { id: 'comment-cn-1', site: 'cn', created_at: '2026-04-04T04:00:00.000Z', message_id: 'message-cn-1' }
                ]
            },
            guestbook_likes: {
                rows: [
                    { id: 'like-cn-1', site: 'cn', created_at: '2026-04-04T05:00:00.000Z' }
                ]
            },
            prompt_comments: {
                rows: [
                    { id: 'prompt-comment-cn-1', site: 'cn', created_at: '2026-04-05T06:00:00.000Z' }
                ]
            },
            points_ledger: {
                rows: [
                    { id: 'ledger-cn-1', user_id: 'user-ledger-1', site: 'cn', created_at: '2026-04-05T07:00:00.000Z', amount: 5 }
                ]
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/summary-rows-bundle&site=cn&startDate=2026-04-04T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.partial_failure_count, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'analytics.view' });
        assert.equal(payload.tables.promptUnlocks.ok, true);
        assert.equal(payload.tables.promptUnlocks.rowCount, 1);
        assert.equal(payload.tables.promptUnlocks.rows[0]?.id, 'unlock-cn-1');
        assert.equal(payload.tables.verificationLogs.rowCount, 1);
        assert.equal(payload.tables.verificationLogs.rows[0]?.verification_id, 'verify-cn-1');
        assert.equal(payload.tables.pointsLedger.rowCount, 1);
        assert.equal(payload.tables.pointsLedger.rows[0]?.user_id, 'user-ledger-1');

        const unlockCall = state.calls.find((entry) => entry.table === 'prompt_unlocks');
        assert.ok(unlockCall);
        assert.deepEqual(unlockCall.eqFilters, [['site', 'cn']]);
        assert.deepEqual(unlockCall.gteFilters, [['unlocked_at', '2026-04-04T00:00:00.000Z']]);
        assert.deepEqual(unlockCall.lteFilters, [['unlocked_at', '2026-04-05T23:59:59.999Z']]);
    });
});

test('analytics summary rows bundle surfaces partial table failures without failing the entire bundle', async () => {
    await withHandler({
        tables: {
            prompt_unlocks: { rows: [] },
            verification_logs: { rows: [] },
            guestbook_messages: { rows: [] },
            guestbook_comments: { rows: [] },
            guestbook_likes: { rows: [] },
            prompt_comments: { shouldFail: true },
            points_ledger: { rows: [] }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/summary-rows-bundle&site=all&days=7',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.partial_failure_count, 1);
        assert.equal(payload.tables.promptComments.ok, false);
        assert.equal(payload.tables.promptComments.message, 'Failed to load prompt_comments');
    });
});

test('analytics summary rows bundle rejects non-GET methods', async () => {
    await withHandler({}, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin?route=analytics/summary-rows-bundle',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
