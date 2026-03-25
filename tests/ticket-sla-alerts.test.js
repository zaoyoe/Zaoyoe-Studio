const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildTicketSlaOverdueAlerts,
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
    const tickets = state.tickets || [];
    const jobs = state.jobs || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_tickets' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(tickets, query.filters), query.order), query.range),
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

test('buildTicketSlaOverdueAlerts flags pending tickets that exceed the SLA window', () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const alerts = buildTicketSlaOverdueAlerts([
        {
            id: 'ticket-1',
            order_id: 'order-1',
            user_id: 'user-1',
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
    assert.equal(alerts[0].payload.wait_minutes, 195);
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

    const second = await runTicketSlaOverdueSweep(supabase, {
        now,
        runtime
    });

    assert.equal(second.overdue_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});
