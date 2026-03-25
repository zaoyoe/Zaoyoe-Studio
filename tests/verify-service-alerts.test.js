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
        if (op === 'eq') return row[column] === value;
        if (op === 'gte') return compareValue(row[column], value) >= 0;
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

    const fetchImpl = async (input) => {
        const url = String(input || '');
        if (url === 'https://verify.test/api/balance') {
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
