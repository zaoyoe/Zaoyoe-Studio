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

async function withHandler(options = {}, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/trend-series-bundle.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        rpcCalls: [],
        rpcCounts: Object.create(null)
    };
    const rpcMap = options.rpcs || {};

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
                            async rpc(name, params) {
                                const callCount = state.rpcCounts[name] || 0;
                                state.rpcCounts[name] = callCount + 1;
                                state.rpcCalls.push({
                                    name,
                                    params: params && typeof params === 'object' ? { ...params } : {}
                                });

                                const definition = rpcMap[name];
                                if (Array.isArray(definition)) {
                                    return definition[Math.min(callCount, definition.length - 1)] || { data: [], error: null };
                                }
                                if (typeof definition === 'function') {
                                    return definition({ params, callCount, state });
                                }
                                if (definition && typeof definition === 'object') {
                                    return definition;
                                }
                                return { data: [], error: null };
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

test('analytics trend series bundle aggregates shared trend rpc payloads', async () => {
    await withHandler({
        rpcs: {
            get_user_trend: {
                data: [
                    { stat_date: '2026-04-05', active_users: 32, new_users: 5, login_active_users: 41 }
                ],
                error: null
            },
            get_content_trend: {
                data: [
                    { stat_date: '2026-04-05', comments: 7, unlocks: 4, likes: 3 }
                ],
                error: null
            },
            get_revenue_trend: {
                data: [
                    { stat_date: '2026-04-05', revenue: 128.5, points_spent: 27 }
                ],
                error: null
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/trend-series-bundle&site=cn&startDate=2026-04-01T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.partial_failure_count, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'analytics.view' });

        assert.equal(payload.segments.userTrend.ok, true);
        assert.equal(payload.segments.userTrend.rpc_name, 'get_user_trend');
        assert.equal(payload.segments.contentTrend.ok, true);
        assert.equal(payload.segments.revenueTrend.ok, true);

        const userTrendCall = state.rpcCalls.find((entry) => entry.name === 'get_user_trend');
        const contentTrendCall = state.rpcCalls.find((entry) => entry.name === 'get_content_trend');
        const revenueTrendCall = state.rpcCalls.find((entry) => entry.name === 'get_revenue_trend');

        assert.ok(userTrendCall);
        assert.ok(contentTrendCall);
        assert.ok(revenueTrendCall);

        assert.equal(userTrendCall.params.p_site, 'cn');
        assert.equal(userTrendCall.params.p_start_date, '2026-04-01');
        assert.equal(userTrendCall.params.p_end_date, '2026-04-05');
        assert.equal(contentTrendCall.params.p_days, undefined);
        assert.equal(contentTrendCall.params.p_start_date, '2026-04-01');
        assert.equal(contentTrendCall.params.p_end_date, '2026-04-05');
        assert.equal(revenueTrendCall.params.p_site, 'cn');
    });
});

test('analytics trend series bundle preserves partial failures without failing the whole response', async () => {
    await withHandler({
        rpcs: {
            get_revenue_trend: {
                data: null,
                error: { message: 'Revenue unavailable', statusCode: 503 }
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/trend-series-bundle&site=all&days=14',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.partial_failure_count, 1);
        assert.equal(payload.segments.revenueTrend.ok, false);
        assert.equal(payload.segments.revenueTrend.statusCode, 503);
        assert.equal(payload.segments.revenueTrend.message, 'Revenue unavailable');
        assert.equal(payload.segments.userTrend.ok, true);
    });
});

test('analytics trend series bundle rejects non-GET methods', async () => {
    await withHandler({}, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            url: '/api/admin?route=analytics/trend-series-bundle',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
