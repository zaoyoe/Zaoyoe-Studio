const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildTicketSlaOverdueAlerts,
    buildTicketSlaRecoveryAlerts,
    normalizeTicketSlaMonitorConfig,
    runTicketSlaOverdueSweep
} = require('../api/_lib/ticket-sla-alerts');

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
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
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
        update(payload) {
            state.mode = 'update';
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
        if (op === 'in') return Array.isArray(value) && value.includes(row[column]);
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
    const tickets = state.tickets || [];
    const profiles = state.profiles || [];
    const jobs = state.jobs || [];
    const adminRoles = state.adminRoles || [];
    const systemNotifications = state.systemNotifications || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_tickets' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(tickets, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'profiles' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(profiles, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    const rows = applyRange(sortRows(applyFilters(jobs, query.filters), query.order), query.range);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
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

                if (table === 'ops_alert_jobs' && query.mode === 'update') {
                    const matched = applyFilters(jobs, query.filters);
                    matched.forEach((row) => Object.assign(row, query.payload || {}));
                    return {
                        data: query.single ? (matched[0] || null) : matched,
                        error: null
                    };
                }

                if (table === 'admin_roles' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(adminRoles, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(systemNotifications, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `notification-${systemNotifications.length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    }));

                    inserted.forEach((row) => {
                        systemNotifications.push({
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

function createOpsRuntime(overrides = {}) {
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
            ...(overrides.config && typeof overrides.config === 'object' ? overrides.config : {})
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
            ...(overrides.secrets && typeof overrides.secrets === 'object' ? overrides.secrets : {})
        }
    };
}

test('buildTicketSlaOverdueAlerts flags pending tickets that exceed the SLA window', () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const alerts = buildTicketSlaOverdueAlerts([
        {
            id: 'ticket-1',
            order_id: 'order-1',
            user_id: 'user-1',
            user_email: 'member1@example.com',
            status: 'PENDING',
            reason: '卡密未到账',
            created_at: '2026-03-25T08:45:00.000Z',
            updated_at: '2026-03-25T08:45:00.000Z'
        },
        {
            id: 'ticket-2',
            order_id: 'order-2',
            user_id: 'user-2',
            status: 'RESOLVED',
            reason: '已处理',
            created_at: '2026-03-25T07:45:00.000Z',
            updated_at: '2026-03-25T09:00:00.000Z'
        }
    ], normalizeTicketSlaMonitorConfig(), { now });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'ticket_sla_overdue');
    assert.equal(alerts[0].payload.ticket_id, 'ticket-1');
    assert.equal(alerts[0].payload.user_email, 'member1@example.com');
    assert.equal(alerts[0].payload.wait_minutes, 195);
    assert.match(alerts[0].content, /用户邮箱：member1@example\.com/);
    assert.match(alerts[0].content, /等待时长：3 小时 15 分钟/);
});

test('runTicketSlaOverdueSweep enqueues overdue ticket alerts with stable dedupe', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const state = {
        tickets: [
            {
                id: 'ticket-1',
                order_id: 'order-1',
                user_id: 'user-1',
                status: 'OPEN',
                description: '卡密未到账',
                created_at: '2026-03-25T08:45:00.000Z',
                updated_at: '2026-03-25T08:45:00.000Z'
            }
        ],
        profiles: [
            {
                id: 'user-1',
                email: 'member1@example.com'
            }
        ],
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runTicketSlaOverdueSweep(supabase, {
        now,
        runtime
    });

    assert.equal(first.overdue_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'ticket_sla_overdue');
    assert.equal(state.jobs[0].payload.ticket_status, 'PENDING');
    assert.equal(state.jobs[0].payload.order_id, 'order-1');
    assert.equal(state.jobs[0].payload.user_email, 'member1@example.com');

    const second = await runTicketSlaOverdueSweep(supabase, {
        now,
        runtime
    });

    assert.equal(second.overdue_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});

test('runTicketSlaOverdueSweep reuses ops alerts tickets config and queues ticket summaries when enabled', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const state = {
        tickets: [
            {
                id: 'ticket-1',
                order_id: 'order-1',
                user_id: 'user-1',
                status: 'OPEN',
                description: '卡密未到账',
                created_at: '2026-03-25T08:45:00.000Z',
                updated_at: '2026-03-25T08:45:00.000Z'
            },
            {
                id: 'ticket-2',
                order_id: 'order-2',
                user_id: 'user-2',
                status: 'OPEN',
                description: '用户催办',
                created_at: '2026-03-25T07:30:00.000Z',
                updated_at: '2026-03-25T09:00:00.000Z'
            }
        ],
        profiles: [
            { id: 'user-1', email: 'member1@example.com' },
            { id: 'user-2', email: 'member2@example.com' }
        ],
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime({
        config: {
            tickets: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 90,
                summary_max_items: 3
            }
        }
    });

    const result = await runTicketSlaOverdueSweep(supabase, {
        now,
        runtime
    });

    assert.equal(result.overdue_count, 2);
    assert.equal(result.queued, 2);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'ticket_sla_summary');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].payload.summary_window_minutes, 90);
    assert.equal(state.jobs[0].payload.summary_max_items, 3);
    const summaryEmails = state.jobs[0].payload.items.map((item) => item?.payload?.user_email).sort();
    assert.deepEqual(summaryEmails, ['member1@example.com', 'member2@example.com']);
});

test('buildTicketSlaRecoveryAlerts emits a recovery notice after an overdue ticket is resolved', () => {
    const alerts = buildTicketSlaRecoveryAlerts([
        {
            id: 'ticket-1',
            order_id: 'order-1',
            user_id: 'user-1',
            user_email: 'member1@example.com',
            status: 'RESOLVED',
            description: '已人工补发卡密并回复用户',
            created_at: '2026-03-25T06:45:00.000Z',
            updated_at: '2026-03-25T10:42:00.000Z'
        }
    ], [
        {
            id: 'ticket-overdue-1',
            alert_type: 'ticket_sla_overdue',
            severity: 'warning',
            title: '工单超时未处理（ticket-1）',
            created_at: '2026-03-25T10:00:00.000Z',
            payload: {
                target_id: 'ticket-1',
                ticket_id: 'ticket-1',
                order_id: 'order-1',
                user_id: 'user-1',
                wait_minutes: 195,
                wait_label: '3 小时 15 分钟',
                reason: '卡密未到账'
            }
        }
    ], normalizeTicketSlaMonitorConfig(), {
        now: '2026-03-25T10:42:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'ticket_sla_recovered');
    assert.equal(alerts[0].severity, 'warning');
    assert.deepEqual(alerts[0].allowedChannels, ['feishu']);
    assert.equal(alerts[0].payload.user_email, 'member1@example.com');
    assert.match(alerts[0].content, /用户邮箱：member1@example\.com/);
    assert.match(alerts[0].content, /恢复结论：工单已解决，已退出超时未处理状态/);
    assert.match(alerts[0].content, /上次超时等待：3 小时 15 分钟/);
    assert.equal(alerts[0].payload.incident_alert_job_id, 'ticket-overdue-1');
    assert.equal(alerts[0].payload.ticket_status, 'RESOLVED');
    assert.equal(alerts[0].payload.incident_duration_minutes, 42);
});

test('runTicketSlaOverdueSweep enqueues recovery notices and writes admin notifications once', async () => {
    const now = new Date('2026-03-25T10:42:00.000Z');
    const state = {
        tickets: [
            {
                id: 'ticket-1',
                order_id: 'order-1',
                user_id: 'user-1',
                status: 'RESOLVED',
                description: '已人工补发卡密并回复用户',
                created_at: '2026-03-25T06:45:00.000Z',
                updated_at: '2026-03-25T10:42:00.000Z'
            }
        ],
        profiles: [
            { id: 'user-1', email: 'member1@example.com' }
        ],
        jobs: [
            {
                id: 'ticket-overdue-1',
                alert_type: 'ticket_sla_overdue',
                severity: 'warning',
                title: '工单超时未处理（ticket-1）',
                created_at: '2026-03-25T10:00:00.000Z',
                payload: {
                    target_id: 'ticket-1',
                    ticket_id: 'ticket-1',
                    order_id: 'order-1',
                    user_id: 'user-1',
                    wait_minutes: 195,
                    wait_label: '3 小时 15 分钟',
                    reason: '卡密未到账'
                }
            }
        ],
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null },
            { user_id: 'admin-2', role_name: 'super_admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runTicketSlaOverdueSweep(supabase, {
        now,
        runtime
    });

    assert.equal(first.overdue_count, 0);
    assert.equal(first.recovered_count, 1);
    assert.equal(first.recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 2);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.jobs[1].alert_type, 'ticket_sla_recovered');
    assert.deepEqual(state.jobs[1].channels, ['feishu']);
    assert.equal(state.jobs[1].payload.user_email, 'member1@example.com');
    assert.equal(state.systemNotifications.length, 2);
    assert.match(state.systemNotifications[0].title, /工单超时已恢复/);

    const second = await runTicketSlaOverdueSweep(supabase, {
        now: '2026-03-25T10:43:00.000Z',
        runtime
    });

    assert.equal(second.recovered_count, 0);
    assert.equal(second.recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.systemNotifications.length, 2);
});
