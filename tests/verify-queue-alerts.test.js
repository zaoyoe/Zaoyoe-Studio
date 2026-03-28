const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildVerifyQueueBacklogAlerts,
    normalizeVerifyQueueMonitorConfig,
    runVerifyQueueBacklogSweep
} = require('../api/_lib/verify-queue-alerts');

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

function buildLogMessage(payload) {
    return JSON.stringify({
        kind: 'google_one_job',
        ...payload
    });
}

test('buildVerifyQueueBacklogAlerts flags queue backlog with hot targets and recent errors', () => {
    const alerts = buildVerifyQueueBacklogAlerts({
        ok: true,
        api_base_url: 'https://verify.test',
        key_name: 'primary-key',
        queue_size: 18,
        running_jobs: 4,
        checked_at: '2026-03-25T10:00:00.000Z'
    }, [
        {
            id: 'active-1',
            status: 'queued',
            user_id: 'user-1',
            created_at: '2026-03-25T09:18:00.000Z',
            message: buildLogMessage({ email: 'member1@example.com' })
        },
        {
            id: 'active-2',
            status: 'running',
            user_id: 'user-2',
            created_at: '2026-03-25T09:25:00.000Z',
            message: buildLogMessage({ email: 'member1@example.com' })
        },
        {
            id: 'active-3',
            status: 'processing',
            user_id: 'user-3',
            created_at: '2026-03-25T09:28:00.000Z',
            message: buildLogMessage({ email: 'member2@example.com' })
        },
        {
            id: 'active-4',
            status: 'pending',
            user_id: 'user-4',
            created_at: '2026-03-25T09:30:00.000Z',
            message: buildLogMessage({ email: 'member3@example.com' })
        },
        {
            id: 'active-5',
            status: 'queued',
            user_id: 'user-5',
            created_at: '2026-03-25T09:32:00.000Z',
            message: buildLogMessage({ email: 'member4@example.com' })
        },
        {
            id: 'active-6',
            status: 'queued',
            user_id: 'user-6',
            created_at: '2026-03-25T09:34:00.000Z',
            message: buildLogMessage({ email: 'member5@example.com' })
        },
        {
            id: 'active-7',
            status: 'queued',
            user_id: 'user-7',
            created_at: '2026-03-25T09:36:00.000Z',
            message: buildLogMessage({ email: 'member6@example.com' })
        },
        {
            id: 'active-8',
            status: 'queued',
            user_id: 'user-8',
            created_at: '2026-03-25T09:38:00.000Z',
            message: buildLogMessage({ email: 'member7@example.com' })
        },
        {
            id: 'active-9',
            status: 'queued',
            user_id: 'user-9',
            created_at: '2026-03-25T09:40:00.000Z',
            message: buildLogMessage({ email: 'member8@example.com' })
        }
    ], [
        {
            id: 'failed-1',
            status: 'failed',
            user_id: 'user-11',
            created_at: '2026-03-25T09:45:00.000Z',
            message: buildLogMessage({ error_message: 'lock_conflict' })
        },
        {
            id: 'failed-2',
            status: 'failed',
            user_id: 'user-12',
            created_at: '2026-03-25T09:47:00.000Z',
            message: buildLogMessage({ error_message: 'lock_conflict' })
        },
        {
            id: 'failed-3',
            status: 'failed',
            user_id: 'user-13',
            created_at: '2026-03-25T09:48:00.000Z',
            message: buildLogMessage({ error_message: 'otp_invalid' })
        },
        {
            id: 'failed-4',
            status: 'failed',
            user_id: 'user-14',
            created_at: '2026-03-25T09:49:00.000Z',
            message: buildLogMessage({ error_message: 'lock_conflict' })
        }
    ], normalizeVerifyQueueMonitorConfig(), {
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'verify_queue_backlog');
    assert.equal(alerts[0].severity, 'warning');
    assert.match(alerts[0].content, /判定信号：/);
    assert.match(alerts[0].content, /队列概览：上游排队 18 个 \/ 运行中 4 个 \/ 本地活跃 9 个/);
    assert.match(alerts[0].content, /热点目标：member1@example\.com × 2/);
    assert.match(alerts[0].content, /最近错误：lock_conflict × 3；otp_invalid × 1/);
    assert.equal(alerts[0].payload.oldest_pending_minutes, 42);
    assert.equal(alerts[0].payload.recent_failure_count, 4);
});

test('runVerifyQueueBacklogSweep enqueues queue backlog alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        verificationLogs: [
            {
                id: 'active-1',
                status: 'queued',
                user_id: 'user-1',
                verification_id: 'job-1',
                created_at: '2026-03-25T09:18:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member1@example.com' })
            },
            {
                id: 'active-2',
                status: 'running',
                user_id: 'user-2',
                verification_id: 'job-2',
                created_at: '2026-03-25T09:25:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member2@example.com' })
            },
            {
                id: 'active-3',
                status: 'processing',
                user_id: 'user-3',
                verification_id: 'job-3',
                created_at: '2026-03-25T09:28:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member3@example.com' })
            },
            {
                id: 'active-4',
                status: 'pending',
                user_id: 'user-4',
                verification_id: 'job-4',
                created_at: '2026-03-25T09:30:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member4@example.com' })
            },
            {
                id: 'active-5',
                status: 'queued',
                user_id: 'user-5',
                verification_id: 'job-5',
                created_at: '2026-03-25T09:32:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member5@example.com' })
            },
            {
                id: 'active-6',
                status: 'queued',
                user_id: 'user-6',
                verification_id: 'job-6',
                created_at: '2026-03-25T09:34:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member6@example.com' })
            },
            {
                id: 'active-7',
                status: 'queued',
                user_id: 'user-7',
                verification_id: 'job-7',
                created_at: '2026-03-25T09:36:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member7@example.com' })
            },
            {
                id: 'active-8',
                status: 'queued',
                user_id: 'user-8',
                verification_id: 'job-8',
                created_at: '2026-03-25T09:38:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member8@example.com' })
            },
            {
                id: 'failed-1',
                status: 'failed',
                user_id: 'user-11',
                verification_id: 'job-11',
                created_at: '2026-03-25T09:45:00.000Z',
                site: 'cn',
                message: buildLogMessage({ error_message: 'lock_conflict' })
            },
            {
                id: 'failed-2',
                status: 'failed',
                user_id: 'user-12',
                verification_id: 'job-12',
                created_at: '2026-03-25T09:47:00.000Z',
                site: 'cn',
                message: buildLogMessage({ error_message: 'lock_conflict' })
            },
            {
                id: 'failed-3',
                status: 'failed',
                user_id: 'user-13',
                verification_id: 'job-13',
                created_at: '2026-03-25T09:48:00.000Z',
                site: 'cn',
                message: buildLogMessage({ error_message: 'otp_invalid' })
            },
            {
                id: 'failed-4',
                status: 'failed',
                user_id: 'user-14',
                verification_id: 'job-14',
                created_at: '2026-03-25T09:49:00.000Z',
                site: 'cn',
                message: buildLogMessage({ error_message: 'lock_conflict' })
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const fetchImpl = async (input) => {
        const url = String(input || '');
        if (url === 'https://verify.test/api/balance') {
            return new Response(JSON.stringify({
                balance: 32,
                total_used: 324,
                cost_per_job: 1,
                name: 'primary-key'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        if (url === 'https://verify.test/api/queue') {
            return new Response(JSON.stringify({
                queue_size: 18,
                running_jobs: 4
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const first = await runVerifyQueueBacklogSweep(supabase, {
        runtime,
        fetchImpl,
        now: '2026-03-25T10:00:00.000Z',
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test'
        }
    });

    assert.equal(first.backlog_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'verify_queue_backlog');
    assert.equal(state.jobs[0].payload.queue_size, 18);
    assert.equal(state.jobs[0].payload.active_job_count, 8);
    assert.equal(state.jobs[0].payload.recent_failure_count, 4);

    const second = await runVerifyQueueBacklogSweep(supabase, {
        runtime,
        fetchImpl,
        now: '2026-03-25T10:00:00.000Z',
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test'
        }
    });

    assert.equal(second.backlog_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});

test('runVerifyQueueBacklogSweep prefers ops alert runtime queue config over legacy verify settings config', async () => {
    const state = {
        jobs: [],
        verificationLogs: [
            {
                id: 'active-1',
                status: 'queued',
                user_id: 'user-1',
                verification_id: 'job-1',
                created_at: '2026-03-25T09:18:00.000Z',
                site: 'cn',
                message: buildLogMessage({ email: 'member1@example.com' })
            },
            {
                id: 'failed-1',
                status: 'failed',
                user_id: 'user-11',
                verification_id: 'job-11',
                created_at: '2026-03-25T09:45:00.000Z',
                site: 'cn',
                message: buildLogMessage({ error_message: 'lock_conflict' })
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime({
        verify_queue: {
            queue_size_threshold: 10,
            active_job_threshold: 1,
            oldest_pending_minutes_threshold: 30,
            recent_failure_threshold: 1
        }
    });

    const fetchImpl = async (input) => {
        const url = String(input || '');
        if (url === 'https://verify.test/api/balance') {
            return new Response(JSON.stringify({
                balance: 50,
                total_used: 324,
                cost_per_job: 1,
                name: 'primary-key'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        if (url === 'https://verify.test/api/queue') {
            return new Response(JSON.stringify({
                queue_size: 18,
                running_jobs: 0
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await runVerifyQueueBacklogSweep(supabase, {
        runtime,
        now: '2026-03-25T10:00:00.000Z',
        fetchImpl,
        verifyConfig: {
            apiKey: 'verify-api-key',
            apiBaseUrl: 'https://verify.test',
            queueMonitorConfig: {
                queue_size_threshold: 50,
                active_job_threshold: 50,
                oldest_pending_minutes_threshold: 120,
                recent_failure_threshold: 10
            }
        }
    });

    assert.equal(result.backlog_count, 1);
    assert.equal(state.jobs.length, 1);
    assert.match(state.jobs[0].content, /阈值 10 个/);
});
