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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/summary-payload-bundle.js');
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

test('analytics summary payload bundle builds overview, verify, and growth summaries from shared rows', async () => {
    await withHandler({
        tables: {
            prompt_unlocks: {
                rows: [
                    { id: 'unlock-cn-1', site: 'cn', unlocked_at: '2026-04-05T01:00:00.000Z' },
                    { id: 'unlock-cn-2', site: 'cn', unlocked_at: '2026-04-05T02:00:00.000Z' }
                ]
            },
            verification_logs: {
                rows: [
                    { verification_id: 'verify-cn-1', user_id: 'user-1', email: 'user1@example.com', site: 'cn', status: 'success', created_at: '2026-04-05T03:00:00.000Z', points_deducted: 2 },
                    { verification_id: 'verify-cn-2', user_id: 'user-2', email: 'user2@example.com', site: 'cn', status: 'failed', created_at: '2026-04-05T04:00:00.000Z', points_deducted: 3, error_message: 'quota low' }
                ]
            },
            guestbook_messages: {
                rows: [
                    { id: 'message-cn-1', site: 'cn', created_at: '2026-04-05T05:00:00.000Z', content: 'hello analytics' }
                ]
            },
            guestbook_comments: {
                rows: [
                    { id: 'comment-cn-1', site: 'cn', created_at: '2026-04-05T06:00:00.000Z', message_id: 'message-cn-1' }
                ]
            },
            guestbook_likes: {
                rows: [
                    { id: 'like-cn-1', site: 'cn', created_at: '2026-04-05T07:00:00.000Z' }
                ]
            },
            prompt_comments: {
                rows: [
                    { id: 'prompt-comment-cn-1', site: 'cn', created_at: '2026-04-05T08:00:00.000Z' }
                ]
            },
            points_ledger: {
                rows: [
                    { id: 'ledger-cn-1', site: 'cn', created_at: '2026-04-05T09:00:00.000Z', amount: 3, reference_id: 'AFFILIATE_REWARD_1', reason: 'reward' },
                    { id: 'ledger-cn-2', site: 'cn', created_at: '2026-04-05T10:00:00.000Z', amount: 2, reference_id: 'CHECKIN_1', reason: 'daily_checkin' }
                ]
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/summary-payload-bundle&site=cn&startDate=2026-04-05T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.summary_partial_failure_count, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'analytics.view' });

        assert.equal(payload.summaries.overviewBusinessMix.ok, true);
        assert.equal(payload.summaries.overviewBusinessMix.summary.metrics.unlockCount, 2);
        assert.equal(payload.summaries.overviewBusinessMix.summary.metrics.verifySuccessCount, 1);
        assert.equal(payload.summaries.overviewBusinessMix.summary.metrics.rewardPoints, 5);

        assert.equal(payload.summaries.verifyServiceSummary.ok, true);
        assert.equal(payload.summaries.verifyServiceSummary.summary.metrics.requestCount, 2);
        assert.equal(payload.summaries.verifyServiceSummary.summary.metrics.failedCount, 1);

        assert.equal(payload.summaries.growthSummary.ok, true);
        assert.equal(payload.summaries.growthSummary.summary.metrics.interactionCount, 3);
        assert.equal(payload.summaries.growthSummary.summary.metrics.referralRewardPoints, 3);
        assert.equal(payload.summaries.growthSummary.summary.metrics.checkinRewardPoints, 2);
    });
});

test('analytics summary payload bundle surfaces dependency failures per summary', async () => {
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
            url: '/api/admin?route=analytics/summary-payload-bundle&site=all&days=7',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.table_partial_failure_count, 1);
        assert.equal(payload.summary_partial_failure_count, 2);
        assert.equal(payload.summaries.verifyServiceSummary.ok, true);
        assert.equal(payload.summaries.overviewBusinessMix.ok, false);
        assert.equal(payload.summaries.growthSummary.ok, false);
        assert.deepEqual(payload.summaries.growthSummary.failed_dependency_keys, ['promptComments']);
    });
});

test('analytics summary payload bundle computes verify service metrics from the full verification window', async () => {
    const verificationRows = Array.from({ length: 120 }, (_, index) => {
        const createdAt = new Date(Date.UTC(2026, 3, 5, 12, index % 60, 0));
        createdAt.setUTCDate(createdAt.getUTCDate() - Math.floor(index / 4));
        return {
            verification_id: `verify-all-${index + 1}`,
            user_id: `user-${index + 1}`,
            email: `user${index + 1}@example.com`,
            site: 'all',
            status: index % 5 === 0 ? 'failed' : 'success',
            points_deducted: 1,
            created_at: createdAt.toISOString(),
            error_message: index % 5 === 0 ? 'quota low' : ''
        };
    });
    const verificationTimestamps = verificationRows.map((row) => String(row.created_at || ''));
    const explicitStartDate = verificationTimestamps.slice().sort()[0];
    const explicitEndDate = verificationTimestamps.slice().sort().at(-1);

    await withHandler({
        tables: {
            prompt_unlocks: { rows: [] },
            verification_logs: { rows: verificationRows },
            guestbook_messages: { rows: [] },
            guestbook_comments: { rows: [] },
            guestbook_likes: { rows: [] },
            prompt_comments: { rows: [] },
            points_ledger: { rows: [] }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: `/api/admin?route=analytics/summary-payload-bundle&site=all&startDate=${encodeURIComponent(explicitStartDate)}&endDate=${encodeURIComponent(explicitEndDate)}`,
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summaries.verifyServiceSummary.ok, true);
        assert.equal(payload.summaries.verifyServiceSummary.summary.metrics.requestCount, 120);
        assert.equal(payload.summaries.verifyServiceSummary.summary.metrics.failedCount, 24);
    });
});

test('analytics summary payload bundle rejects non-GET methods', async () => {
    await withHandler({}, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin?route=analytics/summary-payload-bundle',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
