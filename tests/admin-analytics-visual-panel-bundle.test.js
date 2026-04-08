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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/visual-panel-bundle.js');
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

test('analytics visual panel bundle aggregates shared visual rpc payloads around the real-event conversion funnel', async () => {
    await withHandler({
        rpcs: {
            get_activity_heatmap: {
                data: [
                    { day_of_week: 1, hour_of_day: 8, activity_count: 4, is_proxy_metric: false, metric_basis: 'effective_business_event_heatmap', metric_label: '真实业务事件热度' }
                ],
                error: null
            },
            get_retention_cohort: {
                data: [
                    { cohort_week: '2026-W13', week_0: 100, week_1: 48, week_2: 35, week_3: 28, week_4: 22, is_proxy_metric: false, metric_basis: 'site_attributed_cohort_effective_business_activity', metric_label: '首站点归因 cohort + 真实业务回访' }
                ],
                error: null
            },
            get_conversion_funnel_v2: [
                {
                    data: [
                        { step_name: 'Prompt 浏览', user_count: 21, conversion_rate: 100, is_proxy_metric: false, metric_basis: 'user_events', metric_label: '真实业务事件漏斗' },
                        { step_name: '解锁点击', user_count: 11, conversion_rate: 52.4, is_proxy_metric: false, metric_basis: 'user_events', metric_label: '真实业务事件漏斗' },
                        { step_name: '内容解锁', user_count: 7, conversion_rate: 33.3, is_proxy_metric: false, metric_basis: 'user_events', metric_label: '真实业务事件漏斗' }
                    ],
                    error: null
                }
            ],
            get_top_contributors: {
                data: [
                    { user_id: 'user-1', username: 'Alice', comment_count: 8, message_count: 5, total_likes_received: 13, contribution_score: 21 }
                ],
                error: null
            },
            get_geo_distribution_by_site: {
                data: [
                    { region: 'China', user_count: 12 }
                ],
                error: null
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/visual-panel-bundle&site=intl&days=30&weeks=9&topContributorsLimit=12',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'intl');
        assert.equal(payload.weeks, 9);
        assert.equal(payload.limits.topContributors, 12);
        assert.equal(payload.partial_failure_count, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'analytics.view' });

        assert.equal(payload.segments.activityHeatmap.ok, true);
        assert.equal(payload.segments.activityHeatmap.payload[0].is_proxy_metric, false);
        assert.equal(payload.segments.activityHeatmap.payload[0].metric_basis, 'effective_business_event_heatmap');
        assert.equal(payload.segments.retentionCohort.ok, true);
        assert.equal(payload.segments.conversionFunnel.ok, true);
        assert.equal(payload.segments.conversionFunnel.rpc_name, 'get_conversion_funnel_v2');
        assert.equal(payload.segments.conversionFunnel.used_legacy_fallback, false);
        assert.equal(payload.segments.conversionFunnel.fallback_reason, '');
        assert.equal(payload.segments.topContributors.ok, true);
        assert.equal(payload.segments.geoDistribution.ok, true);

        const heatmapCall = state.rpcCalls.find((entry) => entry.name === 'get_activity_heatmap');
        const retentionCall = state.rpcCalls.find((entry) => entry.name === 'get_retention_cohort');
        const conversionCall = state.rpcCalls.find((entry) => entry.name === 'get_conversion_funnel_v2');
        const contributorsCall = state.rpcCalls.find((entry) => entry.name === 'get_top_contributors');

        assert.ok(heatmapCall);
        assert.ok(retentionCall);
        assert.ok(conversionCall);
        assert.ok(contributorsCall);

        assert.equal(heatmapCall.params.p_site, 'intl');
        assert.equal(heatmapCall.params.p_days, 30);
        assert.equal(retentionCall.params.p_weeks, 9);
        assert.equal(retentionCall.params.p_site, 'intl');
        assert.match(String(retentionCall.params.p_start_date || ''), /^\d{4}-\d{2}-\d{2}$/);
        assert.match(String(retentionCall.params.p_end_date || ''), /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(conversionCall.params.p_site, 'intl');
        assert.equal(conversionCall.params.p_days, 30);
        assert.equal(contributorsCall.params.p_limit, 12);
        assert.equal(contributorsCall.params.p_site, 'intl');
        assert.equal(state.rpcCalls.some((entry) => entry.name === 'get_conversion_funnel'), false);
    });
});

test('analytics visual panel bundle preserves partial failures without failing the whole response', async () => {
    await withHandler({
        rpcs: {
            get_geo_distribution_by_site: {
                data: null,
                error: { message: 'Geo unavailable', statusCode: 502 }
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/visual-panel-bundle&site=all&days=14',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.partial_failure_count, 1);
        assert.equal(payload.segments.geoDistribution.ok, false);
        assert.equal(payload.segments.geoDistribution.statusCode, 502);
        assert.equal(payload.segments.geoDistribution.message, 'Geo unavailable');
        assert.equal(payload.segments.activityHeatmap.ok, true);
    });
});

test('analytics visual panel bundle rejects non-GET methods', async () => {
    await withHandler({}, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            url: '/api/admin?route=analytics/visual-panel-bundle',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
