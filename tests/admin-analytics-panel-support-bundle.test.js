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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/panel-support-bundle.js');
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

test('analytics panel support bundle aggregates shared panel rpc payloads and preserves fallback semantics', async () => {
    await withHandler({
        rpcs: {
            get_channel_breakdown_v2: [
                {
                    data: [
                        { channel: 'SEO', event_count: 0, user_count: 0, unlock_success_count: 0, verify_submit_count: 0, recharge_success_count: 0, shop_purchase_count: 0 }
                    ],
                    error: null
                }
            ],
            get_channel_breakdown: {
                data: [
                    { channel: 'SEO', users: 8, redemptions: 3, redemption_rate: 37.5 }
                ],
                error: null
            },
            get_content_top_v2: {
                data: [
                    { prompt_id: 'prompt-1', title: '热门 Prompt', view_count: 21, unlock_count: 7, comment_count: 4 }
                ],
                error: null
            },
            get_community_stats: {
                data: [
                    { stat_date: '2026-04-05', messages: 5, comments: 4, likes: 3 }
                ],
                error: null
            },
            get_points_distribution: {
                data: [
                    { range_label: '0-99', user_count: 12 }
                ],
                error: null
            },
            get_points_leaderboard: {
                data: [
                    { user_id: 'user-1', username: 'Alice', balance: 88, total_spent: 13 }
                ],
                error: null
            },
            get_redemption_funnel: {
                data: [
                    { step: '已生成', count: 10, conversion_rate: 100 },
                    { step: '已领取', count: 7, conversion_rate: 70 },
                    { step: '已核销', count: 4, conversion_rate: 40 }
                ],
                error: null
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/panel-support-bundle&site=cn&startDate=2026-04-01T00:00:00.000%2B08:00&endDate=2026-04-05T23:59:59.999%2B08:00',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.partial_failure_count, 0);
        assert.equal(payload.limits.topContent, 100);
        assert.equal(payload.limits.pointsLeaderboard, 100);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'analytics.view' });

        assert.equal(payload.segments.channelBreakdown.ok, true);
        assert.equal(payload.segments.channelBreakdown.rpc_name, 'get_channel_breakdown');
        assert.equal(payload.segments.topContent.ok, true);
        assert.equal(payload.segments.topContent.rpc_name, 'get_content_top_v2');
        assert.equal(payload.segments.pointsLeaderboard.ok, true);

        const channelV2Call = state.rpcCalls.find((entry) => entry.name === 'get_channel_breakdown_v2');
        const channelLegacyCall = state.rpcCalls.find((entry) => entry.name === 'get_channel_breakdown');
        const topContentCall = state.rpcCalls.find((entry) => entry.name === 'get_content_top_v2');
        const leaderboardCall = state.rpcCalls.find((entry) => entry.name === 'get_points_leaderboard');

        assert.ok(channelV2Call);
        assert.ok(channelLegacyCall);
        assert.ok(topContentCall);
        assert.ok(leaderboardCall);

        assert.equal(channelV2Call.params.p_site, 'cn');
        assert.equal(channelV2Call.params.p_start_date, '2026-04-01');
        assert.equal(channelV2Call.params.p_end_date, '2026-04-05');
        assert.equal(topContentCall.params.p_limit, 100);
        assert.equal(leaderboardCall.params.p_limit, 100);
        assert.equal(leaderboardCall.params.p_site, 'cn');
    });
});

test('analytics panel support bundle preserves partial failures without failing the whole response', async () => {
    await withHandler({
        rpcs: {
            get_points_leaderboard: {
                data: null,
                error: { message: 'Leaderboard unavailable', statusCode: 503 }
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/panel-support-bundle&site=all&days=30',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'all');
        assert.equal(payload.partial_failure_count, 1);
        assert.equal(payload.segments.pointsLeaderboard.ok, false);
        assert.equal(payload.segments.pointsLeaderboard.statusCode, 503);
        assert.equal(payload.segments.pointsLeaderboard.message, 'Leaderboard unavailable');
        assert.equal(payload.segments.channelBreakdown.ok, true);
    });
});

test('analytics panel support bundle keeps explicit date ranges on local calendar days in positive-offset timezones', async () => {
    await withHandler({}, async ({ handler }) => {
        const { toRpcDateValue, buildRpcRangeParams } = handler.__testUtils;

        assert.equal(toRpcDateValue('2026-04-05T00:00:00+08:00'), '2026-04-05');
        assert.equal(toRpcDateValue('2026-04-05T23:59:59.999+08:00'), '2026-04-05');

        const params = buildRpcRangeParams({
            startIso: '2025-04-06T00:00:00+08:00',
            endIso: '2026-04-05T23:59:59.999+08:00',
            days: 365
        }, 'all');

        assert.equal(params.p_site, null);
        assert.equal(params.p_start_date, '2025-04-06');
        assert.equal(params.p_end_date, '2026-04-05');
        assert.equal(params.p_days, 365);
    });
});

test('analytics panel support bundle rejects non-GET methods', async () => {
    await withHandler({}, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            url: '/api/admin?route=analytics/panel-support-bundle',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
