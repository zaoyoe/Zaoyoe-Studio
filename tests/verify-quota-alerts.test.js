const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildVerifyQuotaLowAlerts,
    normalizeVerifyQuotaMonitorConfig,
    runVerifyQuotaLowSweep
} = require('../api/_lib/verify-quota-alerts');

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
        lte(column, value) {
            state.filters.push({ op: 'lte', column, value });
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
        if (op === 'lte') return compareValue(row[column], value) <= 0;
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

                    inserted.forEach((row) => {
                        jobs.push({
                            ...row
                        });
                    });

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

function createOpsRuntime(configOverrides = {}) {
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
            },
            ...configOverrides
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    };
}

test('buildVerifyQuotaLowAlerts flags low verify quota with queue coverage context', () => {
    const alerts = buildVerifyQuotaLowAlerts({
        ok: true,
        key_name: 'primary-key',
        balance: 11,
        total_used: 324,
        cost_per_job: 1,
        remaining_jobs: 11,
        queue_size: 7,
        running_jobs: 2,
        checked_at: '2026-03-25T10:00:00.000Z'
    }, normalizeVerifyQuotaMonitorConfig());

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'verify_quota_low');
    assert.equal(alerts[0].severity, 'warning');
    assert.match(alerts[0].title, /primary-key/);
    assert.equal(alerts[0].payload.remaining_jobs, 11);
    assert.equal(alerts[0].payload.queue_size, 7);
    assert.match(alerts[0].content, /判定信号：/);
    assert.match(alerts[0].content, /队列概览：排队 7 个 \/ 运行中 2 个/);
});

test('runVerifyQuotaLowSweep enqueues low quota alerts with stable dedupe per severity', async () => {
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
                remaining_uses: 11,
                total_used: 324,
                name: 'primary-key'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const first = await runVerifyQuotaLowSweep(supabase, {
        runtime,
        fetchImpl,
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test'
        }
    });

    assert.equal(first.low_quota_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'verify_quota_low');
    assert.equal(state.jobs[0].payload.balance, 11);
    assert.equal(state.jobs[0].payload.queue_size, 0);
    assert.equal(state.jobs[0].payload.running_jobs, 0);
    assert.equal(state.jobs[0].payload.queue_error, 'provider_queue_not_supported');

    const second = await runVerifyQuotaLowSweep(supabase, {
        runtime,
        fetchImpl,
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test'
        }
    });

    assert.equal(second.low_quota_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});

test('runVerifyQuotaLowSweep prefers ops alert runtime quota config over legacy verify settings config', async () => {
    const state = {
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime({
        verify_quota: {
            low_balance_threshold: 30,
            low_remaining_jobs_threshold: 30,
            critical_balance_threshold: 10,
            critical_remaining_jobs_threshold: 10,
            min_queue_buffer_jobs: 0,
            dedupe_window_minutes: 120
        }
    });

    const fetchImpl = async (input, init = {}) => {
        const url = String(input || '');
        if (url === 'https://verify.test/openapi') {
            assert.equal(init.method, 'POST');
            assert.deepEqual(JSON.parse(init.body), {
                action: 'get_balance',
                cdkey: 'verify-api-key'
            });
            return new Response(JSON.stringify({
                remaining_uses: 28,
                total_used: 324,
                name: 'primary-key'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await runVerifyQuotaLowSweep(supabase, {
        runtime,
        fetchImpl,
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test',
            monitorConfig: {
                low_balance_threshold: 5,
                low_remaining_jobs_threshold: 5,
                critical_balance_threshold: 2,
                critical_remaining_jobs_threshold: 2
            }
        }
    });

    assert.equal(result.low_quota_count, 1);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].payload.low_balance_threshold, 30);
    assert.equal(state.jobs[0].payload.low_remaining_jobs_threshold, 30);
});
