const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildVerifyFailureRateSpikeAlerts,
    normalizeVerifyFailureMonitorConfig,
    runVerifyFailureRateSpikeSweep
} = require('../api/_lib/verify-failure-alerts');

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
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
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
        if (op === 'in') return Array.isArray(value) ? value.includes(row[column]) : false;
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
    const verificationLogs = state.verificationLogs || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'verification_logs' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(verificationLogs, query.filters), query.order), query.range),
                        error: null
                    };
                }

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

function buildLogMessage(payload) {
    return JSON.stringify({
        kind: 'google_one_job',
        ...payload
    });
}

test('buildVerifyFailureRateSpikeAlerts flags recent failure spikes with affected users and hot errors', () => {
    const alerts = buildVerifyFailureRateSpikeAlerts({
        key_name: 'primary-key',
        api_base_url: 'https://verify.test',
        checked_at: '2026-03-25T10:00:00.000Z'
    }, [
        {
            id: 'failed-1',
            status: 'failed',
            user_id: 'user-1',
            created_at: '2026-03-25T09:40:00.000Z',
            message: buildLogMessage({ email: 'member1@example.com', error_message: 'otp_invalid' })
        },
        {
            id: 'failed-2',
            status: 'failed',
            user_id: 'user-2',
            created_at: '2026-03-25T09:41:00.000Z',
            message: buildLogMessage({ email: 'member1@example.com', error_message: 'otp_invalid' })
        },
        {
            id: 'failed-3',
            status: 'failed',
            user_id: 'user-3',
            created_at: '2026-03-25T09:42:00.000Z',
            message: buildLogMessage({ email: 'member2@example.com', error_message: 'lock_conflict' })
        },
        {
            id: 'failed-4',
            status: 'failed',
            user_id: 'user-4',
            created_at: '2026-03-25T09:43:00.000Z',
            message: buildLogMessage({ email: 'member3@example.com', error_message: 'otp_invalid' })
        },
        {
            id: 'failed-5',
            status: 'failed',
            user_id: 'user-5',
            created_at: '2026-03-25T09:44:00.000Z',
            message: buildLogMessage({ email: 'member4@example.com', error_message: 'upstream_timeout' })
        },
        {
            id: 'failed-6',
            status: 'failed',
            user_id: 'user-6',
            created_at: '2026-03-25T09:45:00.000Z',
            message: buildLogMessage({ email: 'member5@example.com', error_message: 'otp_invalid' })
        },
        {
            id: 'success-1',
            status: 'success',
            user_id: 'user-7',
            created_at: '2026-03-25T09:46:00.000Z',
            message: buildLogMessage({ email: 'member6@example.com' })
        },
        {
            id: 'success-2',
            status: 'success',
            user_id: 'user-8',
            created_at: '2026-03-25T09:47:00.000Z',
            message: buildLogMessage({ email: 'member7@example.com' })
        }
    ], normalizeVerifyFailureMonitorConfig());

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'verify_failure_rate_spike');
    assert.equal(alerts[0].severity, 'critical');
    assert.match(alerts[0].content, /判定信号：/);
    assert.match(alerts[0].content, /任务概览：最近 30 分钟总 8 次 \/ 失败 6 次 \/ 成功 2 次 \/ 失败率 75\.00%/);
    assert.match(alerts[0].content, /受影响用户：member1@example\.com × 2、member2@example\.com × 1、member3@example\.com × 1/);
    assert.match(alerts[0].content, /最近错误：otp_invalid × 4；lock_conflict × 1；upstream_timeout × 1/);
    assert.equal(alerts[0].payload.failed_jobs, 6);
    assert.equal(alerts[0].payload.affected_user_count, 5);
    assert.equal(alerts[0].payload.failure_rate, 75);
});

test('runVerifyFailureRateSpikeSweep enqueues failure spike alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        verificationLogs: [
            {
                id: 'failed-1',
                status: 'failed',
                user_id: 'user-1',
                verification_id: 'job-1',
                created_at: '2026-03-25T09:40:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member1@example.com', error_message: 'otp_invalid' })
            },
            {
                id: 'failed-2',
                status: 'failed',
                user_id: 'user-2',
                verification_id: 'job-2',
                created_at: '2026-03-25T09:41:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member1@example.com', error_message: 'otp_invalid' })
            },
            {
                id: 'failed-3',
                status: 'failed',
                user_id: 'user-3',
                verification_id: 'job-3',
                created_at: '2026-03-25T09:42:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member2@example.com', error_message: 'lock_conflict' })
            },
            {
                id: 'failed-4',
                status: 'failed',
                user_id: 'user-4',
                verification_id: 'job-4',
                created_at: '2026-03-25T09:43:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member3@example.com', error_message: 'otp_invalid' })
            },
            {
                id: 'failed-5',
                status: 'failed',
                user_id: 'user-5',
                verification_id: 'job-5',
                created_at: '2026-03-25T09:44:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member4@example.com', error_message: 'upstream_timeout' })
            },
            {
                id: 'failed-6',
                status: 'failed',
                user_id: 'user-6',
                verification_id: 'job-6',
                created_at: '2026-03-25T09:45:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member5@example.com', error_message: 'otp_invalid' })
            },
            {
                id: 'success-1',
                status: 'success',
                user_id: 'user-7',
                verification_id: 'job-7',
                created_at: '2026-03-25T09:46:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member6@example.com' })
            },
            {
                id: 'success-2',
                status: 'success',
                user_id: 'user-8',
                verification_id: 'job-8',
                created_at: '2026-03-25T09:47:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member7@example.com' })
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runVerifyFailureRateSpikeSweep(supabase, {
        runtime,
        now: '2026-03-25T10:00:00.000Z',
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test',
            keyName: 'primary-key'
        }
    });

    assert.equal(first.spike_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'verify_failure_rate_spike');
    assert.equal(state.jobs[0].payload.failed_jobs, 6);
    assert.equal(state.jobs[0].payload.affected_user_count, 5);
    assert.equal(state.jobs[0].payload.failure_rate, 75);

    const second = await runVerifyFailureRateSpikeSweep(supabase, {
        runtime,
        now: '2026-03-25T10:00:00.000Z',
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test',
            keyName: 'primary-key'
        }
    });

    assert.equal(second.spike_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});
