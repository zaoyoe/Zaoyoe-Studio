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
            state.statusCode = code;
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

function createState(overrides = {}) {
    return {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        requireAdminCalls: [],
        verificationLogs: [],
        pointsLedger: [],
        profiles: [],
        authUsers: [],
        opsAlertJobs: [],
        opsAlertCases: [],
        opsAlertCaseEvents: [],
        ...overrides
    };
}

function createSupabaseStub(state) {
    const tableMap = {
        verification_logs: 'verificationLogs',
        points_ledger: 'pointsLedger',
        profiles: 'profiles',
        ops_alert_jobs: 'opsAlertJobs',
        ops_alert_cases: 'opsAlertCases',
        ops_alert_case_events: 'opsAlertCaseEvents'
    };

    return {
        auth: {
            admin: {
                async getUserById(userId) {
                    const user = (state.authUsers || []).find((item) => String(item?.id || '') === String(userId || '')) || null;
                    return user
                        ? { data: { user }, error: null }
                        : { data: { user: null }, error: { message: 'User not found' } };
                }
            }
        },
        from(table) {
            const stateKey = tableMap[table];
            if (!stateKey) {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                filters: [],
                order: null
            };

            function executeRange(from = 0, to = Number.MAX_SAFE_INTEGER) {
                let rows = (state[stateKey] || []).slice();
                rows = rows.filter((row) => queryState.filters.every((filter) => {
                    if (filter.op === 'in') {
                        return filter.values.includes(row[filter.column]);
                    }
                    if (filter.op === 'gte') {
                        return new Date(row[filter.column]).getTime() >= new Date(filter.value).getTime();
                    }
                    return true;
                }));

                if (queryState.order?.column) {
                    const { column, ascending } = queryState.order;
                    rows.sort((left, right) => {
                        const leftValue = new Date(left[column]).getTime();
                        const rightValue = new Date(right[column]).getTime();
                        return ascending ? leftValue - rightValue : rightValue - leftValue;
                    });
                }

                return {
                    data: rows.slice(from, to + 1),
                    error: null
                };
            }

            const query = {
                in(column, values) {
                    queryState.filters.push({
                        op: 'in',
                        column,
                        values: Array.isArray(values) ? values : []
                    });
                    return query;
                },
                gte(column, value) {
                    queryState.filters.push({ op: 'gte', column, value });
                    return query;
                },
                order(column, options = {}) {
                    queryState.order = {
                        column,
                        ascending: options.ascending !== false
                    };
                    return query;
                },
                async range(from, to) {
                    return executeRange(from, to);
                },
                async limit(limitValue) {
                    return executeRange(0, limitValue - 1);
                },
                then(resolve, reject) {
                    return Promise.resolve(executeRange(0, Number.MAX_SAFE_INTEGER)).then(resolve, reject);
                }
            };

            query.select = () => query;
            return query;
        }
    };
}

function createAdminModule(state) {
    return {
        async requireAdmin(_req, options = {}) {
            state.requireAdminCalls.push(options);
            return {
                supabase: createSupabaseStub(state),
                user: state.user
            };
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/verify-monitor.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule(state);
        }
        return originalLoad(request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback(handler, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

function buildLog(message, overrides = {}) {
    return {
        id: overrides.id || 'log-1',
        user_id: Object.prototype.hasOwnProperty.call(overrides, 'user_id') ? overrides.user_id : 'user-1',
        verification_id: overrides.verification_id || 'job-1',
        status: overrides.status || 'queued',
        message: JSON.stringify({
            kind: 'google_one_job',
            email: overrides.email || 'member@example.com',
            stage_label: overrides.stage_label || '',
            raw_status: overrides.raw_status || '',
            error_message: overrides.error_message || '',
            error_code: overrides.error_code || '',
            ...message
        }),
        points_deducted: overrides.points_deducted ?? 10,
        site: overrides.site || 'cn',
        created_at: overrides.created_at || '2026-03-25T10:00:00.000Z'
    };
}

function buildVerifyAlertJob(alertType, overrides = {}) {
    return {
        id: overrides.id || `${alertType}-1`,
        alert_type: alertType,
        severity: overrides.severity || 'warning',
        title: overrides.title || '验证告警',
        content: overrides.content || '验证告警\n最近状态异常',
        payload: overrides.payload || {},
        created_at: overrides.created_at || '2026-03-25T10:40:00.000Z'
    };
}

function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

test('verify monitor settings handler returns recent tasks, recent failures, and local summary', async () => {
    await withHandler({
        verificationLogs: [
            buildLog({ job_id: 'job-success' }, {
                id: 'log-success',
                verification_id: 'job-success',
                status: 'success',
                email: 'ok@example.com',
                stage_label: '验证完成',
                created_at: '2026-03-25T10:30:00.000Z'
            }),
            buildLog({ job_id: 'job-failed' }, {
                id: 'log-failed',
                verification_id: 'job-failed',
                status: 'failed',
                email: 'failed@example.com',
                error_message: 'otp_invalid',
                created_at: '2026-03-25T10:20:00.000Z'
            }),
            buildLog({ job_id: 'job-active' }, {
                id: 'log-active',
                verification_id: 'job-active',
                status: 'running',
                email: 'busy@example.com',
                stage_label: '等待上游执行',
                created_at: '2026-03-25T10:10:00.000Z'
            }),
            buildLog({ job_id: 'job-active', stage_label: '重复旧状态' }, {
                id: 'log-active-older',
                verification_id: 'job-active',
                status: 'queued',
                email: 'busy@example.com',
                created_at: '2026-03-25T10:05:00.000Z'
            })
        ],
        opsAlertJobs: [
            buildVerifyAlertJob('verify_quota_low', {
                id: 'verify-alert-open',
                title: '验证额度不足预警（primary-key）',
                content: '验证额度告警\nAPI Key：primary-key',
                payload: {
                    target_id: 'verify_quota:primary-key',
                    key_name: 'primary-key',
                    api_base_url: 'https://verify.test',
                    balance: 11,
                    remaining_jobs: 11
                },
                created_at: hoursAgo(2)
            }),
            buildVerifyAlertJob('verify_incident_recovered', {
                id: 'verify-alert-recovered',
                title: '验证综合异常已恢复（primary-key）',
                content: '验证综合异常恢复\n恢复结论：验证服务已恢复正常',
                payload: {
                    target_id: 'verify_incident:primary-key',
                    key_name: 'primary-key',
                    api_base_url: 'https://verify.test'
                },
                created_at: hoursAgo(1)
            })
        ],
        opsAlertCases: [
            {
                site: 'cn',
                category_key: 'verify',
                target_id: 'verify_incident:primary-key',
                alert_type: 'verify_incident_escalated',
                status: 'claimed',
                owner_admin_id: 'admin-user-1',
                owner_label: 'admin@example.com',
                note: '继续观察恢复后的额度和失败率。',
                resolution: null,
                metadata: {},
                last_action: 'noted',
                last_action_at: hoursAgo(0.8),
                updated_at: hoursAgo(0.8)
            }
        ],
        opsAlertCaseEvents: [
            {
                id: 'event-verify-1',
                site: 'cn',
                category_key: 'verify',
                target_id: 'verify_incident:primary-key',
                alert_type: 'verify_incident_escalated',
                action: 'add_note',
                status: 'claimed',
                owner_admin_id: 'admin-user-1',
                owner_label: 'admin@example.com',
                actor_admin_id: 'admin-user-1',
                actor_label: 'admin@example.com',
                note: '继续观察恢复后的额度和失败率。',
                resolution: null,
                metadata: {},
                created_at: hoursAgo(0.8)
            }
        ]
    }, async (handler, state) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(
            state.requireAdminCalls[0],
            { anyOf: ['settings.manage', 'analytics.view'] }
        );
        assert.equal(payload.summary.active_task_count, 1);
        assert.equal(payload.summary.failure_task_count, 1);
        assert.equal(payload.summary.sample_size, 4);
        assert.equal(Array.isArray(payload.recent_tasks), true);
        assert.equal(payload.recent_tasks.length, 3);
        assert.equal(payload.recent_tasks[0].verification_id, 'job-success');
        assert.equal(payload.recent_tasks[1].verification_id, 'job-failed');
        assert.equal(payload.recent_tasks[2].verification_id, 'job-active');
        assert.equal(payload.recent_task_pagination.page, 1);
        assert.equal(payload.recent_task_pagination.total_items, 3);
        assert.equal(payload.recent_failures.length, 1);
        assert.equal(payload.recent_failures[0].error_message, 'otp_invalid');
        assert.equal(payload.recent_failures[0].summary, 'otp_invalid');
        assert.equal(payload.recent_failure_pagination.page, 1);
        assert.equal(payload.recent_failure_pagination.total_items, 1);
        assert.equal(payload.facts.success_task_count, 1);
        assert.equal(payload.facts.stalled_task_count, 1);
        assert.equal(payload.facts.status_breakdown.some((item) => item.key === 'failed' && item.count === 1), true);
        assert.equal(payload.facts.site_breakdown.some((item) => item.key === 'cn' && item.count === 3), true);
        assert.equal(payload.facts.top_failure_reasons[0].key, 'otp_invalid');
        assert.equal(payload.alert_summary.visible_count, 2);
        assert.equal(payload.alert_summary.active_problem_count, 1);
        assert.equal(payload.alert_summary.claimed_count, 1);
        assert.equal(payload.alert_items[0].category_key, 'verify');
        assert.equal(payload.alert_items[0].target_id, 'verify_quota:primary-key');
        assert.equal(payload.alert_items[1].case_status, 'claimed');
        assert.equal(payload.alert_items[1].case_recent_events[0].action, 'add_note');
    });
});

test('verify monitor settings handler recovers submitter identity from points ledger references', async () => {
    const userId = '2e69a374-1111-4111-8111-111111111111';
    await withHandler({
        verificationLogs: [
            buildLog({
                job_id: '26576',
                task_type: 'extract'
            }, {
                id: 'log-legacy-success',
                user_id: '',
                verification_id: '26576',
                status: 'success',
                email: 'verenasheridan@gmail.com',
                stage_label: '验证完成',
                created_at: '2026-04-30T02:32:00.000Z'
            })
        ],
        pointsLedger: [
            {
                id: 'ledger-verify-26576',
                user_id: userId,
                reference_id: '26576',
                created_at: '2026-04-30T02:33:00.000Z'
            }
        ],
        profiles: [
            {
                id: userId,
                email: 'site-owner@example.com',
                username: 'site-owner',
                display_name: '站内用户'
            }
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.recent_tasks[0].verification_id, '26576');
        assert.equal(payload.recent_tasks[0].user_id, userId);
        assert.equal(payload.recent_tasks[0].submitter_email, 'site-owner@example.com');
        assert.equal(payload.recent_tasks[0].submitter_display_name, '站内用户');
        assert.equal(payload.recent_tasks[0].email, 'verenasheridan@gmail.com');
        assert.equal(payload.recent_tasks[0].task_type, 'extract');
    });
});

test('verify monitor settings handler paginates recent tasks and failures from query params', async () => {
    await withHandler({
        verificationLogs: [
            buildLog({ job_id: 'job-1' }, { id: 'log-1', verification_id: 'job-1', status: 'success', created_at: '2026-03-25T10:30:00.000Z' }),
            buildLog({ job_id: 'job-2' }, { id: 'log-2', verification_id: 'job-2', status: 'failed', error_message: 'otp_invalid', created_at: '2026-03-25T10:29:00.000Z' }),
            buildLog({ job_id: 'job-3' }, { id: 'log-3', verification_id: 'job-3', status: 'running', created_at: '2026-03-25T10:28:00.000Z' }),
            buildLog({ job_id: 'job-4' }, { id: 'log-4', verification_id: 'job-4', status: 'failed', error_message: 'provider_timeout', created_at: '2026-03-25T10:27:00.000Z' }),
            buildLog({ job_id: 'job-5' }, { id: 'log-5', verification_id: 'job-5', status: 'queued', created_at: '2026-03-25T10:26:00.000Z' })
        ]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/settings/verify-monitor?taskPage=2&taskPageSize=2&failurePage=2&failurePageSize=1',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.recent_tasks.length, 2);
        assert.equal(payload.recent_tasks[0].verification_id, 'job-3');
        assert.equal(payload.recent_tasks[1].verification_id, 'job-4');
        assert.equal(payload.recent_task_pagination.page, 2);
        assert.equal(payload.recent_task_pagination.page_size, 2);
        assert.equal(payload.recent_task_pagination.total_items, 5);
        assert.equal(payload.recent_task_pagination.total_pages, 3);
        assert.equal(payload.recent_failures.length, 1);
        assert.equal(payload.recent_failures[0].verification_id, 'job-4');
        assert.equal(payload.recent_failure_pagination.page, 2);
        assert.equal(payload.recent_failure_pagination.page_size, 1);
        assert.equal(payload.recent_failure_pagination.total_items, 2);
        assert.equal(payload.recent_failure_pagination.total_pages, 2);
    });
});

test('verify monitor settings handler surfaces actionable failed-task guidance', async () => {
    const guidance = '请删除或者关闭付款资料后重试';
    await withHandler({
        verificationLogs: [
            buildLog({
                job_id: 'job-payment-profile',
                error_message: '任务失败',
                message: guidance,
                error_code: 'payment_profile_conflict'
            }, {
                id: 'log-payment-profile',
                verification_id: 'job-payment-profile',
                status: 'failed',
                created_at: '2026-03-25T10:30:00.000Z'
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.recent_failures[0].error_message, guidance);
        assert.equal(payload.recent_failures[0].summary, guidance);
        assert.equal(payload.recent_tasks[0].summary, guidance);
        assert.equal(payload.facts.top_failure_reasons[0].key, 'payment_profile_conflict');
    });
});

test('verify monitor settings handler rejects non-GET methods', async () => {
    await withHandler({}, async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
