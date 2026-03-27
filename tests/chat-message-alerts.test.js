const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildCustomerChatMessageAlerts,
    runCustomerChatMessageSweep
} = require('../api/_lib/chat-message-alerts');

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
    const jobs = state.jobs || [];
    const messages = state.messages || [];
    const profiles = state.profiles || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'chat_messages' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(messages, query.filters), query.order), query.range),
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

test('buildCustomerChatMessageAlerts renders sender, content, and timestamp details', () => {
    const alerts = buildCustomerChatMessageAlerts([
        {
            id: 'chat-message-001',
            session_id: 'guest@example.com',
            user_id: 'user-001',
            content: '你好，我想咨询下这个提示词套餐支持哪些模型？',
            message_type: 'text',
            created_at: '2026-03-26T01:12:00.000Z',
            is_admin: false
        }
    ], {
        byId: new Map([
            ['user-001', {
                id: 'user-001',
                email: 'guest@example.com',
                display_name: '阿木'
            }]
        ]),
        byEmail: new Map()
    }, {}, {
        now: new Date('2026-03-26T01:13:00.000Z')
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'customer_chat_message_received');
    assert.equal(alerts[0].payload.sender_label, '阿木');
    assert.match(alerts[0].content, /发送者：阿木/);
    assert.match(alerts[0].content, /消息内容：你好，我想咨询下这个提示词套餐支持哪些模型/);
    assert.match(alerts[0].content, /处理入口：客服消息 -> 会话详情/);
});

test('runCustomerChatMessageSweep queues outbound alerts for fresh user messages', async () => {
    const state = {
        messages: [
            {
                id: 'chat-message-100',
                session_id: 'guest@example.com',
                user_id: 'user-100',
                content: '客服在吗？我刚刚付款了。',
                message_type: 'text',
                created_at: '2026-03-26T02:00:00.000Z',
                is_admin: false
            }
        ],
        profiles: [
            {
                id: 'user-100',
                email: 'guest@example.com',
                username: 'guest100'
            }
        ],
        jobs: []
    };
    const supabase = createSupabaseStub(state);

    const result = await runCustomerChatMessageSweep(supabase, {
        now: new Date('2026-03-26T02:05:00.000Z'),
        runtime: createOpsRuntime()
    });

    assert.equal(result.message_count, 1);
    assert.equal(result.queued, 1);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'customer_chat_message_received');
    assert.equal(state.jobs[0].payload.sender_label, 'guest100');
    assert.match(state.jobs[0].content, /客服在吗？我刚刚付款了/);
});

test('runCustomerChatMessageSweep respects runtime customer chat monitor config', async () => {
    const state = {
        messages: [
            {
                id: 'chat-message-200',
                session_id: 'guest@example.com',
                user_id: 'user-200',
                content: '有人吗？',
                message_type: 'text',
                created_at: '2026-03-26T02:10:00.000Z',
                is_admin: false
            }
        ],
        profiles: [
            {
                id: 'user-200',
                email: 'guest@example.com',
                username: 'guest200'
            }
        ],
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();
    runtime.config.customer_chat_message.enabled = false;

    const result = await runCustomerChatMessageSweep(supabase, {
        now: new Date('2026-03-26T02:12:00.000Z'),
        runtime
    });

    assert.equal(result.message_count, 0);
    assert.equal(result.queued, 0);
    assert.equal(result.skipped, 'monitor_disabled');
    assert.equal(state.jobs.length, 0);
});
