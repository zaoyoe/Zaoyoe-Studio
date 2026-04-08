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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/summary-window-bundle.js');
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

test('analytics summary window bundle aggregates active and comparison site summaries through shared summary payload logic', async () => {
    await withHandler({
        rpcs: {
            get_ai_summary_data_v2: ({ params }) => ({
                data: {
                    overview: {
                        dau: params?.p_site === 'cn' ? 12 : params?.p_site === 'intl' ? 7 : 19,
                        new_users_week: params?.p_site === 'cn' ? 3 : params?.p_site === 'intl' ? 2 : 5
                    },
                    user_trend: [
                        { stat_date: '2026-04-05', active_users: 18, new_users: 5 }
                    ],
                    channel_breakdown: [
                        { channel: 'SEO', event_count: 9 }
                    ],
                    top_content: [
                        { prompt_id: 'prompt-1', title: '热门 Prompt', unlock_count: 4, comment_count: 2 }
                    ],
                    event_overview: {
                        prompt_view_count: 21
                    },
                    event_funnels: {
                        content_unlock_funnel: []
                    },
                    generated_at: '2026-04-05T10:00:00.000Z'
                },
                error: null
            }),
            get_overview_stats_with_trend: ({ params }) => ({
                data: {
                    dau_growth: params?.p_site === 'cn' ? 8 : 5,
                    comments_growth: params?.p_site === 'cn' ? 6 : 3
                },
                error: null
            })
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/summary-window-bundle&site=all&includeComparisonSites=1&startDate=2026-04-01T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.active_site, 'all');
        assert.equal(payload.include_comparison_sites, true);
        assert.equal(payload.top_content_limit, 5);
        assert.equal(payload.partial_failure_count, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'analytics.view' });

        assert.equal(payload.summaries.all.ok, true);
        assert.equal(payload.summaries.cn.ok, true);
        assert.equal(payload.summaries.intl.ok, true);
        assert.equal(payload.summaries.all.rpc_name, 'get_ai_summary_data_v2');
        assert.equal(payload.summaries.cn.summary.overview.dau_growth, 8);
        assert.equal(payload.summaries.intl.summary.generated_at, '2026-04-05T10:00:00.000Z');

        const allSummaryCall = state.rpcCalls.find((entry) => entry.name === 'get_ai_summary_data_v2' && entry.params.p_site === null);
        const cnSummaryCall = state.rpcCalls.find((entry) => entry.name === 'get_ai_summary_data_v2' && entry.params.p_site === 'cn');
        const intlSummaryCall = state.rpcCalls.find((entry) => entry.name === 'get_ai_summary_data_v2' && entry.params.p_site === 'intl');

        assert.ok(allSummaryCall);
        assert.ok(cnSummaryCall);
        assert.ok(intlSummaryCall);
        assert.equal(allSummaryCall.params.p_start_date, '2026-04-01');
        assert.equal(allSummaryCall.params.p_end_date, '2026-04-05');
    });
});

test('analytics summary window bundle preserves partial failures without failing the whole response', async () => {
    await withHandler({
        rpcs: {
            get_ai_summary_data_v2: ({ callCount }) => {
                if (callCount >= 2) {
                    return {
                        data: null,
                        error: { message: 'INTL summary unavailable', statusCode: 503 }
                    };
                }
                return {
                    data: {
                        overview: { dau: 12 },
                        user_trend: [],
                        channel_breakdown: [],
                        top_content: [],
                        generated_at: '2026-04-05T10:00:00.000Z'
                    },
                    error: null
                };
            },
            get_overview_stats_with_trend: {
                data: { dau_growth: 4, comments_growth: 2 },
                error: null
            },
            get_overview_stats: {
                data: { dau: 8 },
                error: null
            },
            get_user_trend: {
                data: [],
                error: null
            },
            get_channel_breakdown: {
                data: [],
                error: null
            },
            get_content_top: {
                data: [],
                error: null
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/summary-window-bundle&site=all&includeComparisonSites=1&days=30',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.partial_failure_count, 0);
        assert.equal(payload.summaries.intl.ok, true);
        assert.equal(payload.summaries.intl.used_legacy_fallback, true);
        assert.equal(payload.summaries.intl.rpc_name, 'fallback_summary_window');
    });
});

test('analytics summary window bundle rejects non-GET methods', async () => {
    await withHandler({}, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            url: '/api/admin?route=analytics/summary-window-bundle',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
