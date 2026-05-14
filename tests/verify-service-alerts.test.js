const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildVerifyServiceDisabledAlerts,
    fetchVerifyServiceStatus,
    normalizeVerifyServiceMonitorConfig,
    runVerifyServiceDisabledSweep
} = require('../api/_lib/verify-service-alerts');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        payload: null,
        range: null,
        single: false
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, values });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
            return builder;
        },
        range(from, to) {
            state.range = { from, to };
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        upsert(payload) {
            state.mode = 'upsert';
            state.payload = payload;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
            state.single = 'maybe';
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

function compareValue(left, right) {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);

    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate - rightDate;
    }

    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        const rowValue = column === 'site' && !row[column] ? 'cn' : row[column];
        if (op === 'eq') return rowValue === value;
        if (op === 'gte') return compareValue(rowValue, value) >= 0;
        if (op === 'in') return Array.isArray(value) && value.includes(rowValue);
        return true;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) return rows.slice();

    return rows.slice().sort((left, right) => (
        order.ascending
            ? compareValue(left[order.column], right[order.column])
            : compareValue(right[order.column], left[order.column])
    ));
}

function applyRange(rows, range) {
    if (!range) return rows;
    return rows.slice(range.from, range.to + 1);
}

function createSupabaseStub(state = {}) {
    const jobs = state.jobs || [];
    const cases = state.cases || [];
    const caseEvents = state.caseEvents || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(jobs, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `job-${jobs.length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    }));

                    inserted.forEach((row) => jobs.push({ ...row }));

                    return {
                        data: query.single ? inserted[0] : inserted,
                        error: null
                    };
                }

                if (table === 'ops_alert_cases' && query.mode === 'select') {
                    const rows = applyFilters(cases, query.filters);
                    const data = query.single ? (rows[0] || null) : rows;
                    return {
                        data,
                        error: null
                    };
                }

                if (table === 'ops_alert_cases' && query.mode === 'upsert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const upserted = payload.map((row) => {
                        const nextRow = {
                            created_at: row.created_at || new Date().toISOString(),
                            updated_at: row.updated_at || new Date().toISOString(),
                            ...row
                        };
                        const existingIndex = cases.findIndex((item) => (
                            (item.site || 'cn') === (nextRow.site || 'cn')
                            && item.category_key === nextRow.category_key
                            && item.target_id === nextRow.target_id
                        ));
                        if (existingIndex >= 0) {
                            cases[existingIndex] = {
                                ...cases[existingIndex],
                                ...nextRow
                            };
                            return cases[existingIndex];
                        }
                        cases.push(nextRow);
                        return nextRow;
                    });

                    return {
                        data: query.single ? upserted[0] : upserted,
                        error: null
                    };
                }

                if (table === 'ops_alert_case_events' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `case-event-${caseEvents.length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    }));

                    inserted.forEach((row) => caseEvents.push({ ...row }));

                    return {
                        data: query.single ? inserted[0] : inserted,
                        error: null
                    };
                }

                throw new Error(`Unexpected table access: ${table}/${query.mode}`);
            });
        }
    };
}

function createOpsRuntime() {
    return {
        config: normalizeOpsAlertsConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['10001']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    };
}

test('fetchVerifyServiceStatus marks missing verify config as unconfigured', async () => {
    const status = await fetchVerifyServiceStatus({}, {
        now: '2026-03-25T10:00:00.000Z'
    });
    const alerts = buildVerifyServiceDisabledAlerts(status, normalizeVerifyServiceMonitorConfig());

    assert.equal(status.ok, false);
    assert.equal(status.status, 'unconfigured');
    assert.equal(status.status_label, '未配置');
    assert.match(status.last_error, /未配置验证 API Base URL 和 API Key/);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'verify_service_disabled');
    assert.equal(alerts[0].severity, 'critical');
    assert.match(alerts[0].content, /当前状态：未配置/);
    assert.match(alerts[0].content, /处理入口：后台设置 -> 验证服务配置 -> API Key \/ 接口状态/);
});

test('runVerifyServiceDisabledSweep enqueues verify service disabled alerts with stable dedupe', async () => {
    const state = {
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const fetchImpl = async (input, init = {}) => {
        const url = String(input || '');
        if (url === 'https://verify.test/openapi') {
            assert.equal(init.method, 'POST');
            assert.deepEqual(JSON.parse(init.body), {
                action: 'get_balance',
                cdkey: 'verify-api-key'
            });
            return new Response(JSON.stringify({
                message: 'upstream_verify_503'
            }), {
                status: 503,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const first = await runVerifyServiceDisabledSweep(supabase, {
        runtime,
        fetchImpl,
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test'
        }
    });

    assert.equal(first.disabled_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'verify_service_disabled');
    assert.equal(state.jobs[0].payload.service_status, 'unavailable');
    assert.equal(state.jobs[0].payload.response_status, 503);
    assert.equal(state.jobs[0].payload.upstream_endpoint, 'https://verify.test/openapi');
    assert.match(state.jobs[0].content, /请求地址：https:\/\/verify\.test\/openapi/);

    const second = await runVerifyServiceDisabledSweep(supabase, {
        runtime,
        fetchImpl,
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test'
        }
    });

    assert.equal(second.disabled_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});

test('runVerifyServiceDisabledSweep treats a CDKey pool as available when any key is healthy', async () => {
    const state = {
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();
    const seenKeys = [];

    const fetchImpl = async (input, init = {}) => {
        const url = String(input || '');
        if (url === 'https://aidone.lol/openapi') {
            assert.equal(init.method, 'POST');
            const body = JSON.parse(init.body);
            seenKeys.push(body.cdkey);

            if (body.cdkey === 'SYS-OLD-BAD') {
                return new Response(JSON.stringify({
                    success: false,
                    message: 'Invalid API key'
                }), {
                    status: 401,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }

            return new Response(JSON.stringify({
                success: true,
                remaining_uses: 3,
                total_used: 1,
                key_name: 'healthy-key'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await runVerifyServiceDisabledSweep(supabase, {
        runtime,
        fetchImpl,
        verifyConfig: {
            apiKey: 'SYS-OLD-BAD',
            apiKeys: ['SYS-OLD-BAD', 'SYS-NEW-GOOD'],
            apiBaseUrl: 'https://aidone.lol'
        }
    });

    assert.deepEqual(seenKeys, ['SYS-OLD-BAD', 'SYS-NEW-GOOD']);
    assert.equal(result.disabled_count, 0);
    assert.equal(result.queued, 0);
    assert.equal(state.jobs.length, 0);
});

test('fetchVerifyServiceStatus records the normalized request endpoint when aidone route returns HTML 404', async () => {
    const seenUrls = [];
    const fetchImpl = async (input, init = {}) => {
        const url = String(input || '');
        seenUrls.push(url);
        assert.equal(init.method, 'POST');

        if (url === 'https://aidone.lol/openapi') {
            return new Response('<!doctype html><title>404 Not Found</title><h1>Not Found</h1>', {
                status: 404,
                headers: {
                    'Content-Type': 'text/html'
                }
            });
        }

        if (url === 'https://aidone.lol') {
            return new Response(JSON.stringify({
                message: 'Method Not Allowed'
            }), {
                status: 405,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const status = await fetchVerifyServiceStatus({
        apiKey: 'SYS-ROUTE-TEST',
        apiBaseUrl: 'https://aidone.lol'
    }, {
        fetchImpl,
        now: '2026-04-11T12:17:36.000Z'
    });
    const alerts = buildVerifyServiceDisabledAlerts(status, normalizeVerifyServiceMonitorConfig());

    assert.deepEqual(seenUrls, [
        'https://aidone.lol/openapi',
        'https://aidone.lol'
    ]);
    assert.equal(status.ok, false);
    assert.equal(status.response_status, 404);
    assert.equal(status.api_base_url, 'https://aidone.lol');
    assert.equal(status.upstream_endpoint, 'https://aidone.lol/openapi');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].payload.upstream_endpoint, 'https://aidone.lol/openapi');
    assert.match(alerts[0].content, /请求地址：https:\/\/aidone\.lol\/openapi/);
});

test('runVerifyServiceDisabledSweep auto-resolves lingering verify service disabled cases after recovery', async () => {
    const state = {
        jobs: [],
        cases: [{
            category_key: 'verify',
            target_id: 'verify_service:https://aidone.lol',
            alert_type: 'verify_service_disabled',
            status: 'claimed',
            owner_admin_id: 'zaoyoe@gmail.com',
            owner_label: 'zaoyoe@gmail.com',
            metadata: {
                title: '验证服务不可用'
            },
            last_action: 'claimed',
            last_action_by: 'zaoyoe@gmail.com',
            last_action_at: '2026-04-11T03:15:39.000Z',
            updated_at: '2026-04-11T03:19:51.000Z'
        }],
        caseEvents: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const fetchImpl = async (input, init = {}) => {
        const url = String(input || '');
        if (url === 'https://aidone.lol/openapi') {
            assert.equal(init.method, 'POST');
            assert.deepEqual(JSON.parse(init.body), {
                action: 'get_balance',
                cdkey: 'SYS-NEW-GOOD'
            });
            return new Response(JSON.stringify({
                success: true,
                remaining_uses: 3,
                total_used: 1,
                key_name: 'healthy-key'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await runVerifyServiceDisabledSweep(supabase, {
        runtime,
        fetchImpl,
        now: '2026-04-11T03:38:11.000Z',
        verifyConfig: {
            apiKey: 'SYS-NEW-GOOD',
            apiBaseUrl: 'https://aidone.lol'
        }
    });

    assert.equal(result.disabled_count, 0);
    assert.equal(result.queued, 0);
    assert.equal(result.resolved_count, 1);
    assert.equal(result.recovery_reason, 'auto_resolved');
    assert.equal(state.jobs.length, 0);
    assert.equal(state.cases.length, 1);
    assert.equal(state.cases[0].status, 'resolved');
    assert.equal(state.cases[0].last_action, 'resolved');
    assert.match(state.cases[0].resolution, /已恢复正常/);
    assert.equal(state.caseEvents.length, 1);
    assert.equal(state.caseEvents[0].action, 'resolve');
    assert.equal(state.caseEvents[0].status, 'resolved');
});
