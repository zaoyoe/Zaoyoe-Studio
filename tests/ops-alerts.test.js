const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const {
    __testUtils,
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig,
    normalizeOpsAlertsConfig,
    sendFeishuAlert,
    sweepOpsAlertJobs
} = require('../api/_lib/ops-alerts');

const SHANGHAI_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
});

function formatShanghaiTimestamp(value) {
    const parts = Object.create(null);
    for (const part of SHANGHAI_TIMESTAMP_FORMATTER.formatToParts(new Date(value))) {
        if (part.type !== 'literal') {
            parts[part.type] = part.value;
        }
    }
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} 北京时间`;
}

test('buildOpsAlertSummaryTargetId returns a stable case target for summary alerts', () => {
    assert.equal(
        __testUtils.buildOpsAlertSummaryTargetId({
            alertType: 'verify_quota_summary',
            dedupeKey: 'dedupe-verify-1'
        }),
        'ops_summary:verify_quota_summary'
    );
    assert.equal(
        __testUtils.buildOpsAlertSummaryTargetId({
            alertType: 'shop_inventory_low',
            dedupeKey: 'dedupe-inventory-1'
        }),
        ''
    );
});

test('loadOpsAlertsRuntimeConfig resolves site-scoped ops alert config overrides', async () => {
    const supabase = createSupabaseStub({
        systemConfig: [{
            config_key: 'ops_alerts',
            config_value: {
                __site_scoped: true,
                default: {
                    enabled: true,
                    dedupe_window_minutes: 15,
                    channels: {
                        telegram: {
                            enabled: true,
                            chat_ids: ['cn-chat']
                        }
                    }
                },
                sites: {
                    intl: {
                        enabled: false,
                        dedupe_window_minutes: 45,
                        channels: {
                            telegram: {
                                enabled: true,
                                chat_ids: ['intl-chat']
                            }
                        }
                    }
                }
            }
        }]
    });

    const cnRuntime = await loadOpsAlertsRuntimeConfig(supabase, {}, { site: 'cn' });
    const intlRuntime = await loadOpsAlertsRuntimeConfig(supabase, {}, { site: 'intl' });

    assert.equal(cnRuntime.config.enabled, true);
    assert.equal(cnRuntime.config.dedupe_window_minutes, 15);
    assert.deepEqual(cnRuntime.config.channels.telegram.chat_ids, ['cn-chat']);
    assert.equal(intlRuntime.config.enabled, false);
    assert.equal(intlRuntime.config.dedupe_window_minutes, 45);
    assert.deepEqual(intlRuntime.config.channels.telegram.chat_ids, ['intl-chat']);
});

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        limit: null,
        payload: null,
        upsertOptions: null,
        single: false,
        maybeSingle: false
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
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [values] });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
            return builder;
        },
        limit(value) {
            state.limit = Number(value);
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
        upsert(payload, options = {}) {
            state.mode = 'upsert';
            state.payload = payload;
            state.upsertOptions = options;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
            state.single = true;
            state.maybeSingle = true;
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

    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }

    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        const rowValue = column === 'site' && !row[column] ? 'cn' : row[column];
        if (op === 'eq') return rowValue === value;
        if (op === 'in') return value.includes(rowValue);
        if (op === 'gte') return compareValue(rowValue, value) >= 0;
        if (op === 'lte') return compareValue(rowValue, value) <= 0;
        return true;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) return rows.slice();

    const sorted = rows.slice().sort((left, right) => (
        order.ascending
            ? compareValue(left[order.column], right[order.column])
            : compareValue(right[order.column], left[order.column])
    ));

    return sorted;
}

function createSupabaseStub(state = {}) {
    const systemConfig = state.systemConfig || [];
    const jobs = state.jobs || [];
    const attempts = state.attempts || [];
    const cases = state.cases || [];
    const caseEvents = state.caseEvents || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'system_config' && query.mode === 'select') {
                    let rows = applyFilters(systemConfig, query.filters);
                    rows = sortRows(rows, query.order);
                    if (Number.isFinite(query.limit) && query.limit >= 0) {
                        rows = rows.slice(0, query.limit);
                    }
                    const singleRow = rows[0] || null;
                    const singleError = query.single && !query.maybeSingle && !singleRow && state.strictSingleNoRows
                        ? { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
                        : null;
                    return {
                        data: query.single ? singleRow : rows,
                        error: singleError
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    let rows = applyFilters(jobs, query.filters);
                    rows = sortRows(rows, query.order);
                    if (Number.isFinite(query.limit) && query.limit >= 0) {
                        rows = rows.slice(0, query.limit);
                    }
                    const singleRow = rows[0] || null;
                    const singleError = query.single && !query.maybeSingle && !singleRow && state.strictSingleNoRows
                        ? { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
                        : null;
                    return {
                        data: query.single ? singleRow : rows,
                        error: singleError
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => {
                        const next = {
                            id: row.id || `job-${jobs.length + index + 1}`,
                            created_at: row.created_at || new Date().toISOString(),
                            ...row
                        };
                        jobs.push(next);
                        return next;
                    });
                    return {
                        data: query.single ? inserted[0] : inserted,
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'update') {
                    const rows = applyFilters(jobs, query.filters);
                    rows.forEach((row) => {
                        Object.assign(row, query.payload || {});
                    });
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: rows.length ? null : { message: 'Job not found' }
                    };
                }

                if (table === 'ops_alert_job_attempts' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    payload.forEach((row, index) => {
                        attempts.push({
                            id: attempts.length + index + 1,
                            created_at: row.created_at || new Date().toISOString(),
                            ...row
                        });
                    });
                    return {
                        data: query.single ? attempts[attempts.length - 1] : payload,
                        error: null
                    };
                }

                if (table === 'ops_alert_cases' && query.mode === 'select') {
                    let rows = applyFilters(cases, query.filters);
                    rows = sortRows(rows, query.order);
                    if (Number.isFinite(query.limit) && query.limit >= 0) {
                        rows = rows.slice(0, query.limit);
                    }
                    const singleRow = rows[0] || null;
                    const singleError = query.single && !query.maybeSingle && !singleRow && state.strictSingleNoRows
                        ? { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
                        : null;
                    return {
                        data: query.single ? singleRow : rows,
                        error: singleError
                    };
                }

                if (table === 'ops_alert_cases' && query.mode === 'upsert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const upserted = payload.map((row) => {
                        const next = {
                            created_at: row.created_at || new Date().toISOString(),
                            updated_at: row.updated_at || new Date().toISOString(),
                            ...row
                        };
                        const existingIndex = cases.findIndex((item) => (
                            (item.site || 'cn') === (next.site || 'cn')
                            && item.category_key === next.category_key
                            && item.target_id === next.target_id
                        ));
                        if (existingIndex >= 0) {
                            cases[existingIndex] = {
                                ...cases[existingIndex],
                                ...next
                            };
                            return cases[existingIndex];
                        }
                        cases.push(next);
                        return next;
                    });
                    return {
                        data: query.single ? upserted[0] : upserted,
                        error: null
                    };
                }

                if (table === 'ops_alert_case_events' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => {
                        const next = {
                            id: row.id || `case-event-${caseEvents.length + index + 1}`,
                            created_at: row.created_at || new Date().toISOString(),
                            ...row
                        };
                        caseEvents.push(next);
                        return next;
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

function createRuntimeConfig(overrides = {}) {
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
                },
                email: {
                    enabled: false,
                    minimum_severity: 'warning',
                    recipients: [],
                    from_address: '',
                    reply_to: '',
                    subject_prefix: '[Zaoyoe告警]'
                }
            },
            ...overrides.config
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.example/hook',
            email_api_key: '',
            ...overrides.secrets
        }
    };
}

test('normalizeOpsAlertsConfig preserves admin-managed shop risk auto-response thresholds', () => {
    const config = normalizeOpsAlertsConfig({
        enabled: true,
        shop_order_risk: {
            auto_response_enabled: false,
            auto_disable_coupon_min_risk_score: 87,
            auto_ban_user_min_risk_score: 94,
            auto_ban_user_duration_days: 15,
            auto_suspend_product_min_risk_score: 98
        }
    });

    assert.equal(config.shop_order_risk.auto_response_enabled, false);
    assert.equal(config.shop_order_risk.auto_disable_coupon_min_risk_score, 87);
    assert.equal(config.shop_order_risk.auto_ban_user_min_risk_score, 94);
    assert.equal(config.shop_order_risk.auto_ban_user_duration_days, 15);
    assert.equal(config.shop_order_risk.auto_suspend_product_min_risk_score, 98);
});

test('normalizeOpsAlertsConfig supports configurable customer chat quick reply templates', () => {
    const defaults = normalizeOpsAlertsConfig({});
    assert.equal(defaults.customer_chat_message.quick_reply_templates.length, 5);

    const disabledAll = normalizeOpsAlertsConfig({
        customer_chat_message: {
            quick_reply_templates: []
        }
    });
    assert.deepEqual(disabledAll.customer_chat_message.quick_reply_templates, []);

    const config = normalizeOpsAlertsConfig({
        customer_chat_message: {
            quick_reply_templates: [
                {
                    id: 'claim-first',
                    business_type: 'general',
                    enabled: true,
                    label: '先接手',
                    hint: '先稳住',
                    text: '这边先接手处理。'
                },
                {
                    id: 'pay-check',
                    business_type: 'payment',
                    enabled: false,
                    label: '充值核对',
                    hint: '最近充值 {{payment_status}}',
                    text: '我先帮你核对充值状态。'
                }
            ]
        }
    });

    assert.deepEqual(config.customer_chat_message.quick_reply_templates, [
        {
            id: 'claim-first',
            business_type: 'general',
            enabled: true,
            label: '先接手',
            hint: '先稳住',
            text: '这边先接手处理。'
        },
        {
            id: 'pay-check',
            business_type: 'payment',
            enabled: false,
            label: '充值核对',
            hint: '最近充值 {{payment_status}}',
            text: '我先帮你核对充值状态。'
        }
    ]);
});

test('normalizeOpsAlertsConfig supports configurable ticket reply templates', () => {
    const defaults = normalizeOpsAlertsConfig({});
    assert.equal(defaults.tickets.reply_templates.length, 9);

    const disabledAll = normalizeOpsAlertsConfig({
        tickets: {
            reply_templates: []
        }
    });
    assert.deepEqual(disabledAll.tickets.reply_templates, []);

    const config = normalizeOpsAlertsConfig({
        tickets: {
            reply_templates: [
                {
                    id: 'resolve_refund_custom',
                    action: 'resolved',
                    issue_type: 'refund',
                    enabled: false,
                    title: '退款处理 {{ticket_id}}',
                    tag: '退款',
                    body: '订单 {{order_id}} 已完成处理，{{refund_summary}}。'
                },
                {
                    id: 'reject_other_custom',
                    action: 'REJECTED',
                    issue_type: 'other',
                    enabled: true,
                    title: '补充资料',
                    tag: '待补充',
                    body: '请补充工单 {{ticket_id}} 的截图和发生时间。'
                },
                {
                    id: 'skip_empty',
                    action: 'resolved',
                    issue_type: 'delivery',
                    enabled: true,
                    title: '空正文',
                    tag: '跳过',
                    body: '   '
                }
            ]
        }
    });

    assert.deepEqual(config.tickets.reply_templates, [
        {
            id: 'resolve_refund_custom',
            action: 'resolved',
            issue_type: 'refund',
            enabled: false,
            title: '退款处理 {{ticket_id}}',
            tag: '退款',
            body: '订单 {{order_id}} 已完成处理，{{refund_summary}}。'
        },
        {
            id: 'reject_other_custom',
            action: 'rejected',
            issue_type: 'other',
            enabled: true,
            title: '补充资料',
            tag: '待补充',
            body: '请补充工单 {{ticket_id}} 的截图和发生时间。'
        }
    ]);
});

async function withOpsAlertsModuleWithoutSecretKeyMap(callback) {
    const modulePath = path.resolve(__dirname, '../api/_lib/ops-alerts.js');
    const originalLoad = Module._load;

    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === './secrets') {
            return {
                getStoredAdminSecret: async () => null
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let moduleExports;
    try {
        moduleExports = require(modulePath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback(moduleExports);
    } finally {
        delete require.cache[modulePath];
    }
}

async function withOpsAlertsModuleWithSecretsMock(mockSecretsModule, callback) {
    const modulePath = path.resolve(__dirname, '../api/_lib/ops-alerts.js');
    const originalLoad = Module._load;

    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === './secrets') {
            return mockSecretsModule;
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let moduleExports;
    try {
        moduleExports = require(modulePath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback(moduleExports);
    } finally {
        delete require.cache[modulePath];
    }
}

test('enqueueOpsAlertJob dedupes repeated refund alerts inside the recent window', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const first = await enqueueOpsAlertJob(supabase, {
        alertType: 'payment_refund_ops',
        severity: 'critical',
        title: '支付退款积分回滚失败',
        content: '站点：CN\n订单号：HJ_ORDER_1',
        payload: {
            processing_result: 'admin_refund_compensation_failed',
            target_id: 'order-1',
            provider_order_no: 'HJ_ORDER_1'
        }
    }, { runtime });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'payment_refund_ops',
        severity: 'critical',
        title: '支付退款积分回滚失败',
        content: '站点：CN\n订单号：HJ_ORDER_1',
        payload: {
            processing_result: 'admin_refund_compensation_failed',
            target_id: 'order-1',
            provider_order_no: 'HJ_ORDER_1'
        }
    }, { runtime });

    assert.equal(first.queued, true);
    assert.equal(second.queued, false);
    assert.equal(second.reason, 'deduped');
    assert.equal(state.jobs.length, 1);
    assert.deepEqual(state.jobs[0].channels, ['telegram', 'feishu']);
    assert.deepEqual(state.jobs[0].remaining_channels, ['telegram', 'feishu']);
});

test('enqueueOpsAlertJob aggregates customer chat alerts into a single summary job when summary mode is enabled', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            customer_chat_message: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 60,
                summary_max_items: 5
            }
        }
    });

    const first = await enqueueOpsAlertJob(supabase, {
        alertType: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（阿木）',
        content: '你好，想咨询一下购买后多久发货？',
        payload: {
            sender_label: '阿木',
            user_id: 'user-001',
            content_preview: '你好，想咨询一下购买后多久发货？',
            created_at: '2026-03-27T05:12:00.000Z',
            entry_path: '客服消息 -> 会话详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T05:12:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（小羽）',
        content: '请问购买成功后多久可以发货？',
        payload: {
            sender_label: '小羽',
            user_id: 'user-002',
            content_preview: '请问购买成功后多久可以发货？',
            created_at: '2026-03-27T05:20:00.000Z',
            entry_path: '客服消息 -> 会话详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T05:20:00.000Z')
    });

    assert.equal(first.queued, true);
    assert.equal(first.summary, true);
    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'customer_chat_message_summary');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].payload.items.length, 2);
    assert.equal(state.jobs[0].payload.summary_window_minutes, 60);
    assert.equal(state.jobs[0].payload.summary_max_items, 5);
    assert.equal(state.jobs[0].title, '客服消息汇总（2 条新消息）');
    assert.equal(state.jobs[0].next_retry_at, state.jobs[0].payload.window_end_at);
    assert.equal(first.job.id, second.job.id);
});

test('enqueueOpsAlertJob aggregates purchase success alerts into a single summary job when summary mode is enabled', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            shop_purchase_success: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 120,
                summary_max_items: 3
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'shop_purchase_succeeded',
        severity: 'warning',
        title: '商城购买成功（Prompt Pro 年卡）',
        content: 'Prompt Pro 年卡',
        payload: {
            order_id: 'shop-order-001',
            buyer_label: '小羽',
            product_name: 'Prompt Pro 年卡',
            total_price: 59.8,
            created_at: '2026-03-27T06:10:00.000Z',
            entry_path: '商城管理 -> 订单列表'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:10:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'shop_purchase_succeeded',
        severity: 'warning',
        title: '商城购买成功（Prompt Pro 月卡）',
        content: 'Prompt Pro 月卡',
        payload: {
            order_id: 'shop-order-002',
            buyer_label: '阿木',
            product_name: 'Prompt Pro 月卡',
            total_price: 19.9,
            created_at: '2026-03-27T06:35:00.000Z',
            entry_path: '商城管理 -> 订单列表'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:35:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'shop_purchase_summary');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].payload.items.length, 2);
    assert.equal(state.jobs[0].payload.summary_window_minutes, 120);
    assert.equal(state.jobs[0].payload.summary_max_items, 3);
    assert.equal(state.jobs[0].title, '购买成功汇总（2 笔订单）');
});

test('enqueueOpsAlertJob aggregates inventory low and empty alerts into a single summary job when summary mode is enabled', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            shop_inventory: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 120,
                summary_max_items: 4
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'shop_inventory_low',
        severity: 'warning',
        title: 'Prompt Pro 月卡 库存不足',
        content: 'Prompt Pro 月卡 当前库存仅剩 3 件，已低于阈值 5 件。',
        payload: {
            product_id: 'product-low',
            product_name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 3,
            low_stock_threshold: 5,
            recent_sales_days: 7,
            recent_sales_count: 12,
            updated_at: '2026-03-27T06:10:00.000Z',
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:10:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'shop_inventory_empty',
        severity: 'critical',
        title: '账号季卡 已售罄',
        content: '账号季卡 当前已无可售库存，请尽快补货。',
        payload: {
            product_id: 'product-empty',
            product_name: '账号季卡',
            category: '账号',
            stock_count: 0,
            low_stock_threshold: 5,
            recent_sales_days: 7,
            recent_sales_count: 4,
            updated_at: '2026-03-27T06:45:00.000Z',
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:45:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'shop_inventory_summary');
    assert.equal(state.jobs[0].severity, 'critical');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].payload.items.length, 2);
    assert.equal(state.jobs[0].payload.items[0].alert_type, 'shop_inventory_low');
    assert.equal(state.jobs[0].payload.items[1].alert_type, 'shop_inventory_empty');
    assert.equal(state.jobs[0].payload.summary_window_minutes, 120);
    assert.equal(state.jobs[0].payload.summary_max_items, 4);
    assert.equal(state.jobs[0].payload.target_id, 'ops_summary:shop_inventory_summary');
    assert.equal(state.jobs[0].title, '库存与补货汇总（2 条库存告警）');
    assert.match(state.jobs[0].content, /窗口：2026-03-27 14:00:00 北京时间 - 2026-03-27 16:00:00 北京时间/);
});

test('enqueueOpsAlertJob creates the first inventory summary job when no existing summary row is found', async () => {
    const state = {
        jobs: [],
        strictSingleNoRows: true
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            shop_inventory: {
                enabled: true,
                summary_enabled: true,
                summary_schedule_mode: 'hourly',
                summary_hourly_minute: 0,
                summary_window_minutes: 60,
                summary_max_items: 10
            }
        }
    });

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'shop_inventory_empty',
        severity: 'critical',
        title: 'gemini 已售罄',
        content: 'gemini 当前已无可售库存，请尽快补货。',
        payload: {
            product_id: 'product-gemini',
            product_name: 'gemini',
            stock_count: 0,
            low_stock_threshold: 5,
            recent_sales_days: 7,
            recent_sales_count: 0,
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货'
        }
    }, {
        runtime,
        now: new Date('2026-03-29T01:15:00.000Z')
    });

    assert.equal(result.queued, true);
    assert.equal(result.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'shop_inventory_summary');
    assert.equal(state.jobs[0].payload.target_id, 'ops_summary:shop_inventory_summary');
    assert.equal(state.jobs[0].payload.item_count, 1);
    assert.equal(state.jobs[0].payload.items[0].alert_type, 'shop_inventory_empty');
});

test('enqueueOpsAlertJob aggregates overdue tickets into a single summary job when summary mode is enabled', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            tickets: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 120,
                summary_max_items: 5
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'ticket_sla_overdue',
        severity: 'warning',
        title: '工单超时未处理（ticket-a1）',
        content: '工单 ticket-a1 已超过 120 分钟仍未处理。',
        payload: {
            ticket_id: 'ticket-a1',
            target_id: 'ticket-a1',
            order_id: 'order-a1',
            user_id: 'user-a1',
            wait_minutes: 150,
            wait_label: '2 小时 30 分钟',
            ticket_status: 'PENDING',
            reason: '卡密未到账',
            updated_at: '2026-03-27T06:10:00.000Z',
            entry_path: '售后工单 -> 待处理 -> 工单详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:10:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'ticket_sla_overdue',
        severity: 'critical',
        title: '工单超时未处理（ticket-b2）',
        content: '工单 ticket-b2 已超过 120 分钟仍未处理。',
        payload: {
            ticket_id: 'ticket-b2',
            target_id: 'ticket-b2',
            order_id: 'order-b2',
            user_id: 'user-b2',
            wait_minutes: 320,
            wait_label: '5 小时 20 分钟',
            ticket_status: 'PENDING',
            reason: '用户重复催单',
            updated_at: '2026-03-27T06:45:00.000Z',
            entry_path: '售后工单 -> 待处理 -> 工单详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:45:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'ticket_sla_summary');
    assert.equal(state.jobs[0].severity, 'critical');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].payload.items.length, 2);
    assert.equal(state.jobs[0].payload.summary_window_minutes, 120);
    assert.equal(state.jobs[0].payload.summary_max_items, 5);
    assert.equal(state.jobs[0].title, '工单超时汇总（2 条超时工单）');
});

test('enqueueOpsAlertJob aggregates payment gateway alerts into a single summary job when summary mode is enabled', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            payment_gateway: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 90,
                summary_max_items: 6
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'payment_gateway_degraded',
        severity: 'warning',
        title: '爱发电 支付通道异常波动（CN）',
        content: '爱发电支付成功率异常',
        payload: {
            provider: 'afdian',
            site: 'cn',
            monitor_window_minutes: 30,
            degraded_reasons: ['支付成功率仅 16.67%（1/6）'],
            total_orders: 6,
            paid_orders: 1,
            review_orders: 4,
            failed_orders: 2,
            webhook_5xx: 3,
            query_5xx: 1,
            checked_at: '2026-03-27T06:15:00.000Z',
            entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:15:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'payment_gateway_degraded',
        severity: 'critical',
        title: '虎皮椒 支付通道异常波动（US）',
        content: '虎皮椒回调异常',
        payload: {
            provider: 'hupijiao',
            site: 'us',
            monitor_window_minutes: 30,
            degraded_reasons: ['回调 5xx 已累计 4 次'],
            total_orders: 8,
            paid_orders: 3,
            review_orders: 2,
            failed_orders: 3,
            webhook_5xx: 4,
            query_5xx: 0,
            checked_at: '2026-03-27T06:40:00.000Z',
            entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:40:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'payment_gateway_summary');
    assert.equal(state.jobs[0].severity, 'critical');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].payload.items.length, 2);
    assert.equal(state.jobs[0].payload.summary_window_minutes, 90);
    assert.equal(state.jobs[0].payload.summary_max_items, 6);
    assert.equal(state.jobs[0].title, '支付通道异常汇总（2 条通道异常）');
});

test('enqueueOpsAlertJob aggregates shop order delivery failures into a single summary job when summary mode is enabled', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            shop_order_delivery: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 75,
                summary_max_items: 4
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'shop_order_delivery_failed',
        severity: 'warning',
        title: '商城履约失败（shop-ord-a1）',
        content: '订单已连续重试失败 2 次',
        payload: {
            order_id: 'shop-ord-a1',
            target_id: 'shop-ord-a1',
            product_name: 'Prompt Pro 年卡',
            user_id: 'buyer-a1',
            delivery_status: 'retry_waiting',
            delivery_status_label: '重试中',
            delivery_attempt_count: 2,
            delivery_last_error: '库存锁定冲突，已等待下一轮重试',
            delivery_updated_at: '2026-03-27T06:15:00.000Z',
            entry_path: '商城管理 -> 履约任务 / 异常订单'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:15:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'shop_order_delivery_failed',
        severity: 'critical',
        title: '商城履约失败（shop-ord-b2）',
        content: '订单已进入履约死信队列',
        payload: {
            order_id: 'shop-ord-b2',
            target_id: 'shop-ord-b2',
            product_name: '卡密周卡',
            user_id: 'buyer-b2',
            delivery_status: 'dead_letter',
            delivery_status_label: '死信待处理',
            delivery_attempt_count: 4,
            delivery_last_error: '目标履约地址连续超时',
            delivery_updated_at: '2026-03-27T06:20:00.000Z',
            entry_path: '商城管理 -> 履约任务 / 异常订单'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T06:20:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'shop_order_delivery_summary');
    assert.equal(state.jobs[0].severity, 'critical');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].payload.items.length, 2);
    assert.equal(state.jobs[0].payload.summary_window_minutes, 75);
    assert.equal(state.jobs[0].payload.summary_max_items, 4);
    assert.equal(state.jobs[0].title, '履约失败汇总（2 条履约异常）');
});

test('enqueueOpsAlertJob schedules customer chat summaries on the hourly fixed minute when configured', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            quiet_hours: {
                timezone: 'UTC'
            },
            customer_chat_message: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 60,
                summary_max_items: 5,
                summary_schedule_mode: 'hourly',
                summary_hourly_minute: 0
            }
        }
    });

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（阿木）',
        content: '你好，想咨询一下购买后多久发货？',
        payload: {
            sender_label: '阿木',
            user_id: 'user-001',
            content_preview: '你好，想咨询一下购买后多久发货？',
            created_at: '2026-03-27T05:12:00.000Z',
            entry_path: '客服消息 -> 会话详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T05:12:00.000Z')
    });

    assert.equal(result.queued, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].payload.summary_schedule_mode, 'hourly');
    assert.equal(state.jobs[0].payload.summary_hourly_minute, 0);
    assert.equal(state.jobs[0].payload.summary_timezone, 'UTC');
    assert.equal(state.jobs[0].payload.window_start_at, '2026-03-27T05:00:00.000Z');
    assert.equal(state.jobs[0].payload.window_end_at, '2026-03-27T06:00:00.000Z');
    assert.equal(state.jobs[0].next_retry_at, '2026-03-27T06:00:00.000Z');
    assert.match(state.jobs[0].content, /每小时 00 分/);
});

test('enqueueOpsAlertJob schedules wallet recharge summaries on the daily fixed time when configured', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            quiet_hours: {
                timezone: 'UTC'
            },
            wallet_recharge_success: {
                enabled: true,
                summary_enabled: true,
                summary_window_minutes: 180,
                summary_max_items: 12,
                summary_schedule_mode: 'daily',
                summary_daily_hour: 9,
                summary_daily_minute: 0
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'wallet_recharge_succeeded',
        severity: 'warning',
        title: '充值成功（50元充值）',
        content: '50元充值',
        payload: {
            payment_order_id: 'payment-order-001',
            buyer_label: '小羽',
            package_name: '50元充值',
            paid_amount: 50,
            paid_at: '2026-03-27T08:10:00.000Z',
            entry_path: '支付对账 -> 最近订单'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T08:10:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'wallet_recharge_succeeded',
        severity: 'warning',
        title: '充值成功（100元充值）',
        content: '100元充值',
        payload: {
            payment_order_id: 'payment-order-002',
            buyer_label: '阿木',
            package_name: '100元充值',
            paid_amount: 100,
            paid_at: '2026-03-27T08:20:00.000Z',
            entry_path: '支付对账 -> 最近订单'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T08:20:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].payload.summary_schedule_mode, 'daily');
    assert.equal(state.jobs[0].payload.summary_daily_hour, 9);
    assert.equal(state.jobs[0].payload.summary_daily_minute, 0);
    assert.equal(state.jobs[0].payload.summary_timezone, 'UTC');
    assert.equal(state.jobs[0].payload.window_start_at, '2026-03-26T09:00:00.000Z');
    assert.equal(state.jobs[0].payload.window_end_at, '2026-03-27T09:00:00.000Z');
    assert.equal(state.jobs[0].next_retry_at, '2026-03-27T09:00:00.000Z');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.match(state.jobs[0].content, /每天 09:00（UTC）/);
});

test('enqueueOpsAlertJob aggregates off-hours customer chat alerts into the next work-hours summary even during quiet hours', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            quiet_hours: {
                enabled: true,
                start_hour: 23,
                end_hour: 8,
                timezone: 'UTC',
                allow_critical: true
            },
            work_hours: {
                enabled: true,
                start_hour: 9,
                end_hour: 18,
                timezone: 'UTC'
            },
            customer_chat_message: {
                enabled: true,
                work_hours_only_enabled: true,
                summary_enabled: false,
                summary_max_items: 5
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（阿木）',
        content: '夜里咨询发货时间',
        payload: {
            sender_label: '阿木',
            user_id: 'user-001',
            content_preview: '夜里咨询发货时间',
            created_at: '2026-03-27T23:30:00.000Z',
            entry_path: '客服消息 -> 会话详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T23:30:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（小羽）',
        content: '早上补充一个问题',
        payload: {
            sender_label: '小羽',
            user_id: 'user-002',
            content_preview: '早上补充一个问题',
            created_at: '2026-03-28T07:20:00.000Z',
            entry_path: '客服消息 -> 会话详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-28T07:20:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'customer_chat_message_summary');
    assert.equal(state.jobs[0].payload.summary_schedule_mode, 'work_hours');
    assert.equal(state.jobs[0].payload.work_hours_start_hour, 9);
    assert.equal(state.jobs[0].payload.work_hours_end_hour, 18);
    assert.equal(state.jobs[0].payload.work_hours_timezone, 'UTC');
    assert.equal(state.jobs[0].payload.window_start_at, '2026-03-27T18:00:00.000Z');
    assert.equal(state.jobs[0].payload.window_end_at, '2026-03-28T09:00:00.000Z');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].next_retry_at, '2026-03-28T09:00:00.000Z');
    assert.match(state.jobs[0].content, /工作时段 09:00-18:00（UTC）/);
});

test('enqueueOpsAlertJob aggregates off-hours verify queue alerts into the next work-hours summary', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            quiet_hours: {
                enabled: true,
                start_hour: 23,
                end_hour: 8,
                timezone: 'UTC',
                allow_critical: true
            },
            work_hours: {
                enabled: true,
                start_hour: 9,
                end_hour: 18,
                timezone: 'UTC'
            },
            verify_queue: {
                enabled: true,
                work_hours_only_enabled: true,
                summary_enabled: false,
                summary_max_items: 4
            }
        }
    });

    await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_queue_backlog',
        severity: 'warning',
        title: '验证任务堆积预警（primary-key）',
        content: '夜里出现任务堆积',
        payload: {
            key_name: 'primary-key',
            queue_size: 18,
            running_jobs: 4,
            active_job_count: 11,
            oldest_pending_label: '42 分钟',
            degraded_reasons: ['上游队列已堆积 18 个任务（阈值 10 个）'],
            checked_at: '2026-03-27T23:30:00.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> 队列状态 / 最近任务'
        }
    }, {
        runtime,
        now: new Date('2026-03-27T23:30:00.000Z')
    });
    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_queue_backlog',
        severity: 'warning',
        title: '验证任务堆积预警（backup-key）',
        content: '清晨仍有堆积',
        payload: {
            key_name: 'backup-key',
            queue_size: 12,
            running_jobs: 3,
            active_job_count: 7,
            oldest_pending_label: '19 分钟',
            degraded_reasons: ['最近 30 分钟失败 6 次（阈值 4 次）'],
            checked_at: '2026-03-28T07:10:00.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> 队列状态 / 最近任务'
        }
    }, {
        runtime,
        now: new Date('2026-03-28T07:10:00.000Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'verify_queue_summary');
    assert.equal(state.jobs[0].payload.summary_schedule_mode, 'work_hours');
    assert.equal(state.jobs[0].payload.work_hours_start_hour, 9);
    assert.equal(state.jobs[0].payload.work_hours_end_hour, 18);
    assert.equal(state.jobs[0].payload.work_hours_timezone, 'UTC');
    assert.equal(state.jobs[0].payload.window_start_at, '2026-03-27T18:00:00.000Z');
    assert.equal(state.jobs[0].payload.window_end_at, '2026-03-28T09:00:00.000Z');
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.jobs[0].next_retry_at, '2026-03-28T09:00:00.000Z');
    assert.match(state.jobs[0].content, /工作时段 09:00-18:00（UTC）/);
});

test('enqueueOpsAlertJob still sends direct alerts during work hours when work-hours-only mode is enabled', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            work_hours: {
                enabled: true,
                start_hour: 9,
                end_hour: 18,
                timezone: 'UTC'
            },
            customer_chat_message: {
                enabled: true,
                work_hours_only_enabled: true,
                summary_enabled: false
            }
        }
    });

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（白班）',
        content: '白天咨询',
        payload: {
            sender_label: '白班',
            user_id: 'user-003',
            content_preview: '白天咨询',
            created_at: '2026-03-28T10:15:00.000Z',
            entry_path: '客服消息 -> 会话详情'
        }
    }, {
        runtime,
        now: new Date('2026-03-28T10:15:00.000Z')
    });

    assert.equal(result.queued, true);
    assert.equal(result.summary, undefined);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'customer_chat_message_received');
});

test('buildExternalAlertText renders rich refund details for payment refund ops alerts', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_refund_ops',
        severity: 'critical',
        title: '支付退款积分回滚失败',
        payload: {
            topic_label: '回滚失败',
            processing_result: 'admin_refund_compensation_failed',
            site: 'cn',
            provider: 'hupijiao',
            provider_order_no: 'HJ_ORDER_88',
            target_id: 'order-hj-88',
            user_id: 'user-88',
            order_status: 'redeemed',
            refund_status: 'paid',
            expected_amount: 30,
            paid_amount: 30,
            points_amount: 1000,
            credited: true,
            refund_reclaimed_points: 1000,
            refund_reclaimed_paid_points: 800,
            refund_reclaimed_bonus_points: 200,
            compensation_restored_paid_points: 800,
            compensation_restored_bonus_points: 200,
            note: '人工备注：网关异常',
            last_error: '网关退款失败',
            detail: '网关退款失败后，系统自动补回积分也失败了，需要立即人工核对账务并修复。',
            entry_path: '支付对账 -> 异常运维 -> 回滚失败'
        }
    });

    assert.match(text, /专题：回滚失败/);
    assert.match(text, /异常类型：退款失败后积分回滚失败/);
    assert.match(text, /支付通道：虎皮椒/);
        assert.match(text, /订单号：HJ_ORDER_88/);
        assert.match(text, /付款者\/用户ID：user-88/);
        assert.match(text, /金额：应付 30\.00 元 \/ 实付 30\.00 元/);
    assert.match(text, /积分：1000 点（已入账：是）/);
    assert.match(text, /扣回积分：总 1000 点 \/ 本金 800 点 \/ 赠送 200 点/);
    assert.match(text, /补回积分：本金 800 点 \/ 赠送 200 点/);
    assert.match(text, /最近错误：网关退款失败/);
    assert.match(text, /处理入口：支付对账 -> 异常运维 -> 回滚失败/);
});

test('buildExternalAlertText prefixes INTL site alerts for admin routing clarity', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'ops_alert_test',
        severity: 'warning',
        title: '站外告警联调测试',
        site: 'intl',
        payload: {
            site: 'intl'
        },
        content: ['联调测试']
    });

    assert.match(text, /^\[INTL站\]/);
    assert.doesNotMatch(text, /^\[CN站\]/);
});

test('buildExternalAlertText renders customer chat message details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'customer_chat_message_received',
        severity: 'warning',
        title: '客服新消息（阿木）',
        payload: {
            sender_label: '阿木',
            user_id: 'user-001',
            session_id: 'guest@example.com',
            sender_email: 'guest@example.com',
            message_type: 'text',
            message_type_label: '文本消息',
            content_preview: '你好，想咨询一下购买后多久发货？',
            created_at: '2026-03-26T05:00:00.000Z',
            entry_path: '客服消息 -> 会话详情'
        }
    });

    assert.match(text, /发送者：阿木/);
    assert.match(text, /用户ID：user-001/);
    assert.match(text, /消息内容：你好，想咨询一下购买后多久发货/);
    assert.match(text, /处理入口：客服消息 -> 会话详情/);
});

test('buildExternalAlertText renders customer chat message summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'customer_chat_message_summary',
        severity: 'warning',
        title: '客服消息汇总（2 条新消息）',
        payload: {
            window_start_at: '2026-03-27T05:00:00.000Z',
            window_end_at: '2026-03-27T06:00:00.000Z',
            item_count: 2,
            summary_max_items: 5,
            items: [
                {
                    created_at: '2026-03-27T05:12:00.000Z',
                    payload: {
                        sender_label: '阿木',
                        user_id: 'user-001',
                        content_preview: '你好，想咨询一下购买后多久发货？'
                    }
                },
                {
                    created_at: '2026-03-27T05:20:00.000Z',
                    payload: {
                        sender_label: '小羽',
                        user_id: 'user-002',
                        content_preview: '请问购买成功后多久可以发货？'
                    }
                }
            ],
            entry_path: '客服消息 -> 会话详情'
        }
    });

    assert.match(text, /客服消息汇总/);
    assert.match(text, /累计消息：2 条/);
    assert.match(text, /1\. 阿木/);
    assert.match(text, /用户ID：user-001/);
    assert.match(text, /内容：你好，想咨询一下购买后多久发货/);
    assert.match(text, /2\. 小羽/);
    assert.match(text, /处理入口：客服消息 -> 会话详情/);
});

test('buildExternalAlertText renders shop purchase success details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_purchase_succeeded',
        severity: 'warning',
        title: '商城购买成功（Prompt Pro 年卡）',
        payload: {
            order_id: 'shop-order-001',
            buyer_label: '小羽',
            user_id: 'user-001',
            site: 'cn',
            product_name: 'Prompt Pro 年卡',
            item_count: 1,
            total_price: 59.8,
            delivery_status: 'pending',
            delivery_status_label: '待发货',
            refund_status: 'none',
            refund_status_label: '正常',
            created_at: '2026-03-26T05:10:00.000Z',
            entry_path: '商城管理 -> 订单列表'
        }
    });

    assert.match(text, /订单号：shop-order-001/);
    assert.match(text, /购买者：小羽/);
    assert.match(text, /商品：Prompt Pro 年卡/);
    assert.match(text, /订单金额：59.80 元/);
});

test('buildExternalAlertText renders shop purchase summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_purchase_summary',
        severity: 'warning',
        title: '购买成功汇总（2 笔订单）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T08:00:00.000Z',
            item_count: 2,
            summary_max_items: 3,
            items: [
                {
                    created_at: '2026-03-27T06:10:00.000Z',
                    payload: {
                        order_id: 'shop-order-001',
                        buyer_label: '小羽',
                        product_name: 'Prompt Pro 年卡',
                        total_price: 59.8
                    }
                },
                {
                    created_at: '2026-03-27T06:35:00.000Z',
                    payload: {
                        order_id: 'shop-order-002',
                        buyer_label: '阿木',
                        product_name: 'Prompt Pro 月卡',
                        total_price: 19.9
                    }
                }
            ],
            entry_path: '商城管理 -> 订单列表'
        }
    });

    assert.match(text, /购买成功汇总/);
    assert.match(text, /累计订单：2 笔/);
    assert.match(text, /1\. 小羽 · Prompt Pro 年卡/);
    assert.match(text, /订单号：shop-order-001/);
    assert.match(text, /金额：59.80 元/);
    assert.match(text, /2\. 阿木 · Prompt Pro 月卡/);
    assert.match(text, /处理入口：商城管理 -> 订单列表/);
});

test('buildExternalAlertText renders wallet recharge success details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'wallet_recharge_succeeded',
        severity: 'warning',
        title: '充值成功（50元充值）',
        payload: {
            payment_order_id: 'payment-order-001',
            provider_order_no: 'HPJ001',
            buyer_label: '小羽',
            user_id: 'user-001',
            site: 'cn',
            provider: 'hupijiao',
            package_name: '50元充值',
            expected_amount: 50,
            paid_amount: 50,
            points_amount: 500,
            status: 'redeemed',
            paid_at: '2026-03-26T05:12:00.000Z',
            claimed_at: '2026-03-26T05:13:00.000Z',
            entry_path: '支付对账 -> 最近订单'
        }
    });

    assert.match(text, /充值单号：payment-order-001/);
    assert.match(text, /付款者：小羽/);
    assert.match(text, /到账积分：500 点/);
    assert.match(text, /处理入口：支付对账 -> 最近订单/);
});

test('buildExternalAlertText renders wallet recharge summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'wallet_recharge_summary',
        severity: 'warning',
        title: '充值成功汇总（2 笔充值）',
        payload: {
            window_start_at: '2026-03-27T08:00:00.000Z',
            window_end_at: '2026-03-27T09:00:00.000Z',
            item_count: 2,
            summary_max_items: 10,
            items: [
                {
                    created_at: '2026-03-27T08:10:00.000Z',
                    payload: {
                        payment_order_id: 'payment-order-001',
                        buyer_label: '小羽',
                        package_name: '50元充值',
                        paid_amount: 50
                    }
                },
                {
                    created_at: '2026-03-27T08:20:00.000Z',
                    payload: {
                        payment_order_id: 'payment-order-002',
                        buyer_label: '阿木',
                        package_name: '100元充值',
                        paid_amount: 100
                    }
                }
            ],
            entry_path: '支付对账 -> 最近订单'
        }
    });

    assert.match(text, /充值成功汇总/);
    assert.match(text, /累计充值：2 笔/);
    assert.match(text, /1\. 小羽 · 50元充值/);
    assert.match(text, /充值单号：payment-order-001/);
    assert.match(text, /金额：50.00 元/);
    assert.match(text, /2\. 阿木 · 100元充值/);
    assert.match(text, /处理入口：支付对账 -> 最近订单/);
});

test('buildExternalAlertText renders payment config changed details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_config_changed',
        severity: 'critical',
        title: '支付配置已变更（admin@example.com）',
        payload: {
            site: 'intl',
            admin_email: 'admin@example.com',
            action_label: '支付通道配置更新',
            active_provider: 'mock',
            active_provider_label: '模拟支付',
            updated_provider_labels: ['模拟支付', '虎皮椒'],
            updated_secrets: ['hupijiao_secret_key'],
            risk_flags: ['当前活动通道已切换为模拟支付', '本次更新包含 1 个支付密钥'],
            created_at: '2026-03-25T10:00:00.000Z',
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计'
        }
    });

    assert.match(text, /支付配置告警/);
    assert.match(text, /站点：INTL/);
    assert.match(text, /操作人：admin@example.com/);
    assert.match(text, /变更类型：支付通道配置更新/);
    assert.match(text, /当前生效通道：模拟支付/);
    assert.match(text, /启用通道：模拟支付、虎皮椒/);
    assert.match(text, /更新密钥：hupijiao_secret_key/);
    assert.match(text, /风险提示：当前活动通道已切换为模拟支付；本次更新包含 1 个支付密钥/);
    assert.match(text, /处理入口：后台设置 -> 管理员访问 \/ Admin Audit Logs -> 支付配置审计/);
});

test('buildExternalAlertText renders payment config incident details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_config_incident',
        severity: 'critical',
        title: '支付配置异常升级（3 次）',
        payload: {
            site: 'intl',
            lookback_minutes: 20,
            incident_change_count: 3,
            distinct_admin_count: 2,
            admin_emails: ['admin@example.com', 'owner@example.com'],
            action_labels: ['支付通道配置更新 × 2', '支付密钥删除'],
            signal_labels: ['最近 20 分钟内累计 3 次高风险支付配置改动', '涉及 2 位管理员'],
            risk_signals: ['当前活动通道已切换为模拟支付', '支付密钥 hupijiao_secret_key 已被删除'],
            provider_labels: ['模拟支付', '虎皮椒'],
            secret_labels: ['虎皮椒 Secret Key'],
            latest_change_at: '2026-03-25T10:12:00.000Z',
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计'
        }
    });

    assert.match(text, /支付配置事故/);
    assert.match(text, /站点：INTL/);
    assert.match(text, /观察窗口：最近 20 分钟/);
    assert.match(text, /命中次数：3 次/);
    assert.match(text, /涉及管理员：2 位/);
    assert.match(text, /操作人：admin@example.com、owner@example.com/);
    assert.match(text, /变更类型：支付通道配置更新 × 2；支付密钥删除/);
    assert.match(text, /风险信号：当前活动通道已切换为模拟支付；支付密钥 hupijiao_secret_key 已被删除/);
    assert.match(text, /涉及通道：模拟支付、虎皮椒/);
    assert.match(text, /涉及密钥：虎皮椒 Secret Key/);
    assert.match(text, /处理入口：后台设置 -> 管理员访问 \/ Admin Audit Logs -> 支付配置审计/);
});

test('buildExternalAlertText renders payment config incident recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_config_incident_recovered',
        severity: 'warning',
        title: '支付配置事故已恢复',
        payload: {
            site: 'intl',
            recovery_summary: '支付配置集中事故阈值已解除，当前仍保留 1 次单次高风险改动',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: '2026-03-25T10:32:00.000Z',
            incident_duration_minutes: 32,
            previous_incident_change_count: 3,
            active_change_count: 1,
            active_admin_emails: ['admin@example.com'],
            active_action_labels: ['支付通道配置更新'],
            active_risk_signals: ['本次更新包含 1 个支付密钥'],
            active_provider_labels: ['虎皮椒'],
            active_secret_labels: ['虎皮椒 Secret Key'],
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计'
        }
    });

    assert.match(text, /支付配置事故恢复/);
    assert.match(text, /站点：INTL/);
    assert.match(text, /恢复结论：支付配置集中事故阈值已解除，当前仍保留 1 次单次高风险改动/);
    assert.match(text, new RegExp(`上次升级：${formatShanghaiTimestamp('2026-03-25T10:00:00.000Z')}`));
    assert.match(text, new RegExp(`恢复时间：${formatShanghaiTimestamp('2026-03-25T10:32:00.000Z')}`));
    assert.match(text, /持续时长：32 分钟/);
    assert.match(text, /上次事故规模：3 次高风险改动/);
    assert.match(text, /当前剩余高风险改动：1 次/);
    assert.match(text, /当前涉及管理员：admin@example.com/);
    assert.match(text, /当前动作：支付通道配置更新/);
    assert.match(text, /当前风险信号：本次更新包含 1 个支付密钥/);
    assert.match(text, /当前涉及通道：虎皮椒/);
    assert.match(text, /当前涉及密钥：虎皮椒 Secret Key/);
});

test('buildExternalAlertText renders payment config recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_config_recovered',
        severity: 'warning',
        title: '支付配置风险已恢复（已切回真实支付）',
        payload: {
            site: 'intl',
            recovery_summary: '当前活动通道已切回 爱发电',
            previous_admin_email: 'admin@example.com',
            recovery_admin_email: 'owner@example.com',
            previous_action_label: '支付通道配置更新',
            recovery_action_label: '支付通道配置更新',
            current_active_provider: 'afdian',
            current_active_provider_label: '爱发电',
            current_enabled_provider_labels: ['爱发电', '虎皮椒'],
            restored_secret_source: 'stored_site',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: '2026-03-25T10:18:00.000Z',
            incident_duration_minutes: 18,
            previous_risk_flags: ['当前活动通道已切换为模拟支付'],
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 支付配置审计'
        }
    });

    assert.match(text, /支付配置恢复/);
    assert.match(text, /站点：INTL/);
    assert.match(text, /恢复结论：当前活动通道已切回 爱发电/);
    assert.match(text, /上次操作人：admin@example.com/);
    assert.match(text, /修复人：owner@example.com/);
    assert.match(text, /当前生效通道：爱发电/);
    assert.match(text, /当前启用通道：爱发电、虎皮椒/);
    assert.match(text, /当前密钥来源：后台密钥库/);
    assert.match(text, /持续时长：18 分钟/);
    assert.match(text, /处理入口：后台设置 -> 管理员访问 \/ Admin Audit Logs -> 支付配置审计/);
});

test('sendFeishuAlert treats non-zero webhook result codes as delivery failures', async () => {
    const result = await __testUtils.sendFeishuAlert({
        alert_type: 'payment_refund_ops',
        severity: 'critical',
        title: '支付退款积分回滚失败',
        payload: {
            topic_label: '回滚失败',
            processing_result: 'admin_refund_compensation_failed',
            site: 'cn',
            provider_order_no: 'HJ_ORDER_99'
        }
    }, {
        config: normalizeOpsAlertsConfig({
            channels: {
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secrets: {
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    }, {
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({ code: 19024, msg: 'Key Words Not Found' });
            }
        })
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 200);
    assert.match(result.error || '', /Key Words Not Found|feishu_error_19024/);
});

test('sendTelegramAlert retries transient fetch failures before reporting failure', async () => {
    let calls = 0;
    const result = await __testUtils.sendTelegramAlert({
        alert_type: 'ops_alert_test',
        severity: 'warning',
        title: 'Telegram retry smoke',
        content: ['network retry']
    }, {
        config: normalizeOpsAlertsConfig({
            timeout_ms: 15000,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['5104238366']
                }
            }
        }),
        secrets: {
            telegram_bot_token: 'telegram-token'
        }
    }, {
        telegramFetchRetryDelayMs: 0,
        fetchImpl: async () => {
            calls += 1;
            if (calls < 3) {
                throw new TypeError('fetch failed');
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ ok: true })
            };
        }
    });

    assert.equal(calls, 3);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
});

test('sendTelegramAlert does not retry aborted requests to avoid duplicate delivery', async () => {
    let calls = 0;
    await assert.rejects(
        __testUtils.sendTelegramAlert({
            alert_type: 'ops_alert_test',
            severity: 'warning',
            title: 'Telegram abort smoke'
        }, {
            config: normalizeOpsAlertsConfig({
                timeout_ms: 15000,
                channels: {
                    telegram: {
                        enabled: true,
                        minimum_severity: 'warning',
                        chat_ids: ['5104238366']
                    }
                }
            }),
            secrets: {
                telegram_bot_token: 'telegram-token'
            }
        }, {
            telegramFetchRetryDelayMs: 0,
            fetchImpl: async () => {
                calls += 1;
                const error = new Error('This operation was aborted');
                error.name = 'AbortError';
                throw error;
            }
        }),
        /aborted/
    );

    assert.equal(calls, 1);
});

test('sendTelegramAlert reports partial delivery when one Telegram target has a fetch receipt failure', async () => {
    let calls = 0;
    const result = await __testUtils.sendTelegramAlert({
        alert_type: 'ops_alert_test',
        severity: 'warning',
        title: 'Telegram partial smoke',
        site: 'intl',
        content: ['network receipt partial']
    }, {
        config: normalizeOpsAlertsConfig({
            timeout_ms: 15000,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['5104238366', '5104238367']
                }
            }
        }),
        secrets: {
            telegram_bot_token: 'telegram-token'
        }
    }, {
        telegramFetchRetryCount: 0,
        telegramFetchRetryDelayMs: 0,
        fetchImpl: async () => {
            calls += 1;
            if (calls === 2) {
                throw new TypeError('fetch failed');
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ ok: true })
            };
        }
    });

    assert.equal(calls, 2);
    assert.equal(result.ok, false);
    assert.equal(result.partial, true);
    assert.equal(result.receipt_uncertain, true);
    assert.equal(result.delivered_count, 1);
    assert.equal(result.receipt_uncertain_count, 1);
    assert.equal(result.failed_count, 1);
    assert.match(result.error || '', /fetch failed/);
});

test('sendTelegramAlert marks single target fetch receipt failures as uncertain partial delivery', async () => {
    let calls = 0;
    const result = await __testUtils.sendTelegramAlert({
        alert_type: 'ops_alert_test',
        severity: 'warning',
        title: 'Telegram uncertain receipt smoke',
        site: 'intl',
        content: ['network receipt uncertain']
    }, {
        config: normalizeOpsAlertsConfig({
            timeout_ms: 15000,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['5104238366']
                }
            }
        }),
        secrets: {
            telegram_bot_token: 'telegram-token'
        }
    }, {
        telegramFetchRetryCount: 0,
        telegramFetchRetryDelayMs: 0,
        fetchImpl: async () => {
            calls += 1;
            throw new TypeError('fetch failed');
        }
    });

    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.partial, true);
    assert.equal(result.receipt_uncertain, true);
    assert.equal(result.delivered_count, 0);
    assert.equal(result.receipt_uncertain_count, 1);
    assert.equal(result.failed_count, 1);
    assert.match(result.error || '', /fetch failed/);
});

test('buildExternalAlertText renders provider degradation details for payment gateway alerts', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_gateway_degraded',
        severity: 'critical',
        title: '爱发电 支付通道异常波动（CN）',
        payload: {
            provider: 'afdian',
            site: 'cn',
            monitor_window_minutes: 30,
            degraded_reasons: [
                '支付成功率仅 16.67%（1/6）',
                '回调 5xx 已累计 3 次'
            ],
            total_orders: 6,
            paid_orders: 1,
            review_orders: 4,
            failed_orders: 2,
            paid_rate: 16.67,
            webhook_total: 5,
            webhook_success: 2,
            webhook_failed: 3,
            webhook_4xx: 0,
            webhook_5xx: 3,
            webhook_success_rate: 40,
            query_total: 5,
            query_success: 2,
            query_failed: 3,
            query_4xx: 0,
            query_5xx: 2,
            query_success_rate: 40,
            entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势'
        }
    });

    assert.match(text, /支付通道告警/);
    assert.match(text, /支付通道：爱发电/);
    assert.match(text, /站点：CN/);
    assert.match(text, /巡检窗口：最近 30 分钟/);
    assert.match(text, /判定信号：支付成功率仅 16\.67%（1\/6）；回调 5xx 已累计 3 次/);
    assert.match(text, /订单概览：总 6 笔 \/ 成功 1 笔 \/ 待审核 4 笔 \/ 失败 2 笔 \/ 成功率 16\.67%/);
    assert.match(text, /回调概览：总 5 次 \/ 成功 2 次 \/ 失败 3 次 \/ 4xx 0 次 \/ 5xx 3 次 \/ 成功率 40\.00%/);
    assert.match(text, /处理入口：支付对账 -> 支付总览 -> 通道表现 \/ 最近24小时异常趋势/);
});

test('buildExternalAlertText renders payment gateway recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_gateway_recovered',
        severity: 'warning',
        title: '爱发电 支付通道已恢复（CN）',
        payload: {
            provider: 'afdian',
            site: 'cn',
            recovery_summary: '支付通道异常阈值已解除',
            incident_started_at: '2026-03-25T09:30:00.000Z',
            incident_recovered_at: '2026-03-25T09:54:00.000Z',
            incident_duration_minutes: 24,
            previous_degraded_reasons: [
                '支付成功率仅 16.67%（1/6）',
                '回调 5xx 已累计 3 次'
            ],
            total_orders: 8,
            paid_orders: 7,
            review_orders: 1,
            failed_orders: 0,
            paid_rate: 87.5,
            webhook_total: 6,
            webhook_success: 6,
            webhook_failed: 0,
            webhook_5xx: 0,
            webhook_success_rate: 100,
            query_total: 6,
            query_success: 6,
            query_failed: 0,
            query_5xx: 0,
            query_success_rate: 100,
            entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势'
        }
    });

    assert.match(text, /支付通道恢复/);
    assert.match(text, /支付通道：爱发电/);
    assert.match(text, /站点：CN/);
    assert.match(text, /恢复结论：支付通道异常阈值已解除/);
    assert.match(text, new RegExp(`上次异常：${formatShanghaiTimestamp('2026-03-25T09:30:00.000Z')}`));
    assert.match(text, new RegExp(`恢复时间：${formatShanghaiTimestamp('2026-03-25T09:54:00.000Z')}`));
    assert.match(text, /持续时长：24 分钟/);
    assert.match(text, /上次异常信号：支付成功率仅 16.67%（1\/6）；回调 5xx 已累计 3 次/);
    assert.match(text, /当前订单概览：总 8 笔 \/ 成功 7 笔 \/ 待审核 1 笔 \/ 失败 0 笔 \/ 成功率 87\.50%/);
});

test('buildExternalAlertText renders verify quota low details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_quota_low',
        severity: 'warning',
        title: '验证额度不足预警（primary-key）',
        payload: {
            key_name: 'primary-key',
            balance: 11,
            total_used: 324,
            cost_per_job: 1,
            remaining_jobs: 11,
            queue_size: 7,
            running_jobs: 2,
            degraded_reasons: [
                '剩余额度 11.00 点（阈值 20.00 点）',
                '预计仅可继续 11 次验证（阈值 20 次）'
            ],
            checked_at: '2026-03-25T10:00:00.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态'
        }
    });

    assert.match(text, /验证额度告警/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /剩余额度：11\.00 点/);
    assert.match(text, /预计剩余：11 次/);
    assert.match(text, /判定信号：剩余额度 11\.00 点（阈值 20\.00 点）；预计仅可继续 11 次验证（阈值 20 次）/);
    assert.match(text, /队列概览：排队 7 个 \/ 运行中 2 个/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 当前额度 \/ 队列状态/);
});

test('buildExternalAlertText renders verify service disabled details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_service_disabled',
        severity: 'critical',
        title: '验证服务不可用（primary-key）',
        payload: {
            service_status_label: '服务不可用',
            key_name: 'primary-key',
            api_base_url: 'https://iqless.icu',
            upstream_endpoint: 'https://iqless.icu/openapi',
            last_error: '上游验证服务返回 503',
            response_status: 503,
            checked_at: '2026-03-25T10:00:00.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> API Key / 接口状态'
        }
    });

    assert.match(text, /验证服务告警/);
    assert.match(text, /当前状态：服务不可用/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /API Base：https:\/\/iqless\.icu/);
    assert.match(text, /请求地址：https:\/\/iqless\.icu\/openapi/);
    assert.match(text, /最近错误：上游验证服务返回 503/);
    assert.match(text, /响应状态：503/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> API Key \/ 接口状态/);
});

test('buildExternalAlertText backfills verify service request endpoint for legacy payloads', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_service_disabled',
        severity: 'critical',
        title: '验证服务不可用',
        payload: {
            service_status_label: '服务不可用',
            key_name: 'legacy-key',
            api_base_url: 'https://aidone.lol',
            last_error: '<!doctype html><title>404 Not Found</title>',
            response_status: 404,
            checked_at: '2026-04-11T14:58:10.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> API Key / 接口状态'
        }
    });

    assert.match(text, /API Base：https:\/\/aidone\.lol/);
    assert.match(text, /请求地址：https:\/\/aidone\.lol\/openapi/);
    assert.match(text, /响应状态：404/);
});

test('buildExternalAlertText renders verify failure spike details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_failure_rate_spike',
        severity: 'critical',
        title: '验证失败率异常（primary-key）',
        payload: {
            key_name: 'primary-key',
            monitor_window_minutes: 30,
            total_jobs: 9,
            failed_jobs: 7,
            success_jobs: 2,
            failure_rate: 77.78,
            affected_user_count: 5,
            affected_user_labels: ['member1@example.com × 2', 'member2@example.com × 2', 'member3@example.com × 1'],
            hot_errors: ['otp_invalid × 4', 'lock_conflict × 2', 'upstream_timeout × 1'],
            degraded_reasons: [
                '最近 30 分钟失败率 77.78%（7/9，阈值 60.00%）',
                '受影响用户 5 人（阈值 3 人）'
            ],
            checked_at: '2026-03-25T10:00:00.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> 最近任务 / 最近失败'
        }
    });

    assert.match(text, /验证失败率告警/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /时间窗：最近 30 分钟/);
    assert.match(text, /判定信号：最近 30 分钟失败率 77\.78%（7\/9，阈值 60\.00%）；受影响用户 5 人（阈值 3 人）/);
    assert.match(text, /任务概览：总 9 次 \/ 失败 7 次 \/ 成功 2 次 \/ 失败率 77\.78%/);
    assert.match(text, /受影响用户数：5 人/);
    assert.match(text, /受影响用户：member1@example\.com × 2、member2@example\.com × 2、member3@example\.com × 1/);
    assert.match(text, /最近错误：otp_invalid × 4；lock_conflict × 2；upstream_timeout × 1/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 最近任务 \/ 最近失败/);
});

test('buildExternalAlertText renders verify incident escalation details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_incident_escalated',
        severity: 'critical',
        title: '验证综合异常升级（primary-key）',
        payload: {
            key_name: 'primary-key',
            api_base_url: 'https://iqless.icu',
            lookback_minutes: 30,
            triggered_signal_count: 3,
            signal_labels: ['验证服务停摆', '验证失败率飙升', '验证任务堆积'],
            signal_summaries: [
                '服务不可用 / balance_http_503',
                '失败率 77.78%（7/9）',
                '排队 18 个 / 本地活跃 11 个'
            ],
            signal_timeline: [
                '验证服务停摆：2026-03-25T10:00:00.000Z',
                '验证失败率飙升：2026-03-25T10:02:00.000Z',
                '验证任务堆积：2026-03-25T10:04:00.000Z'
            ],
            latest_signal_at: '2026-03-25T10:04:00.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 \/ 接口状态 \/ 队列状态 \/ 最近失败'
        }
    });

    assert.match(text, /验证综合告警/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /API Base：https:\/\/iqless\.icu/);
    assert.match(text, /时间窗：最近 30 分钟/);
    assert.match(text, /升级信号：验证服务停摆、验证失败率飙升、验证任务堆积/);
    assert.match(text, /命中数量：3 类/);
    assert.match(text, /关键摘要：服务不可用 \/ balance_http_503；失败率 77\.78%（7\/9）；排队 18 个 \/ 本地活跃 11 个/);
    assert.match(text, new RegExp(`最近触发：验证服务停摆：${formatShanghaiTimestamp('2026-03-25T10:00:00.000Z')}；验证失败率飙升：${formatShanghaiTimestamp('2026-03-25T10:02:00.000Z')}；验证任务堆积：${formatShanghaiTimestamp('2026-03-25T10:04:00.000Z')}`));
    assert.match(text, new RegExp(`最新时间：${formatShanghaiTimestamp('2026-03-25T10:04:00.000Z')}`));
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 当前额度 \/ 接口状态 \/ 队列状态 \/ 最近失败/);
});

test('buildExternalAlertText renders verify incident recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_incident_recovered',
        severity: 'warning',
        title: '验证综合异常已恢复（primary-key）',
        payload: {
            key_name: 'primary-key',
            api_base_url: 'https://iqless.icu',
            recovery_summary: '验证综合高危组合已解除，当前仍保留 1 类低优先级信号',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: '2026-03-25T10:18:00.000Z',
            incident_duration_minutes: 18,
            active_signal_labels: ['验证额度不足'],
            active_signal_summaries: ['剩余额度 18.00 点 / 预计 9 次'],
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 \/ 接口状态 \/ 队列状态 \/ 最近失败'
        }
    });

    assert.match(text, /验证恢复通知/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /API Base：https:\/\/iqless\.icu/);
    assert.match(text, /恢复结论：验证综合高危组合已解除，当前仍保留 1 类低优先级信号/);
    assert.match(text, new RegExp(`上次升级：${formatShanghaiTimestamp('2026-03-25T10:00:00.000Z')}`));
    assert.match(text, new RegExp(`恢复时间：${formatShanghaiTimestamp('2026-03-25T10:18:00.000Z')}`));
    assert.match(text, /持续时长：18 分钟/);
    assert.match(text, /当前仍有信号：验证额度不足/);
    assert.match(text, /当前摘要：剩余额度 18.00 点 \/ 预计 9 次/);
});

test('buildExternalAlertText renders verify queue backlog details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_queue_backlog',
        severity: 'warning',
        title: '验证任务堆积预警（primary-key）',
        payload: {
            key_name: 'primary-key',
            queue_size: 18,
            running_jobs: 4,
            active_job_count: 11,
            oldest_pending_label: '42 分钟',
            hot_targets: ['member1@example.com × 3', 'member2@example.com × 2'],
            hot_errors: ['lock_conflict × 4', 'otp_invalid × 2'],
            degraded_reasons: [
                '上游队列已堆积 18 个任务（阈值 10 个）',
                '最近 30 分钟失败 6 次（阈值 4 次）'
            ],
            checked_at: '2026-03-25T10:00:00.000Z',
            entry_path: '后台设置 -> 验证服务配置 -> 队列状态 / 最近任务'
        }
    });

    assert.match(text, /验证队列告警/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /判定信号：上游队列已堆积 18 个任务（阈值 10 个）；最近 30 分钟失败 6 次（阈值 4 次）/);
    assert.match(text, /队列概览：上游排队 18 个 \/ 运行中 4 个 \/ 本地活跃 11 个/);
    assert.match(text, /最老活跃任务：42 分钟/);
    assert.match(text, /热点目标：member1@example\.com × 3、member2@example\.com × 2/);
    assert.match(text, /最近错误：lock_conflict × 4；otp_invalid × 2/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 队列状态 \/ 最近任务/);
});

test('buildExternalAlertText renders ticket SLA overdue details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'ticket_sla_overdue',
        severity: 'warning',
        title: '工单超时未处理（ticket-de）',
        payload: {
            ticket_id: 'ticket-demo-sla-001',
            order_id: 'shop-order-demo-001',
            user_id: 'demo_ticket_user_001',
            user_email: 'demo.ticket@example.com',
            ticket_status: 'PENDING',
            wait_minutes: 195,
            wait_label: '3 小时 15 分钟',
            responsible_label: '未分配',
            reason: '卡密未到账，用户已重复反馈仍未处理。',
            created_at: '2026-03-25T10:00:00.000Z',
            updated_at: '2026-03-25T10:10:00.000Z',
            entry_path: '售后工单 -> 待处理 -> 工单详情'
        }
    });

    assert.match(text, /工单 SLA 告警/);
    assert.match(text, /工单号：ticket-demo-sla-001/);
    assert.match(text, /订单号：shop-order-demo-001/);
    assert.match(text, /用户邮箱：demo\.ticket@example\.com/);
    assert.match(text, /用户ID：demo_ticket_user_001/);
    assert.match(text, /等待时长：3 小时 15 分钟/);
    assert.match(text, /责任人：未分配/);
    assert.match(text, /当前状态：待处理/);
    assert.match(text, /问题描述：卡密未到账，用户已重复反馈仍未处理。/);
    assert.match(text, /处理入口：售后工单 -> 待处理 -> 工单详情/);
});

test('buildExternalAlertText renders new support ticket details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'ticket_new',
        severity: 'warning',
        title: '新售后工单（ticket-de）',
        payload: {
            ticket_id: 'ticket-demo-001',
            order_id: 'shop-order-demo-001',
            user_id: 'demo_ticket_user_001',
            user_email: 'demo.ticket@example.com',
            ticket_status: 'PENDING',
            reason: '卡密未到账，用户需要人工补发。',
            created_at: '2026-03-30T12:00:00.000Z',
            entry_path: '售后工单 -> 待处理 -> 工单详情'
        }
    });

    assert.match(text, /新售后工单/);
    assert.match(text, /工单号：ticket-demo-001/);
    assert.match(text, /订单号：shop-order-demo-001/);
    assert.match(text, /用户邮箱：demo\.ticket@example\.com/);
    assert.match(text, /用户ID：demo_ticket_user_001/);
    assert.match(text, /当前状态：待处理/);
    assert.match(text, /问题描述：卡密未到账，用户需要人工补发。/);
    assert.match(text, new RegExp(`创建时间：${formatShanghaiTimestamp('2026-03-30T12:00:00.000Z')}`));
    assert.match(text, /处理入口：售后工单 -> 待处理 -> 工单详情/);
});

test('buildExternalAlertText renders ticket SLA recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'ticket_sla_recovered',
        severity: 'warning',
        title: '工单超时已恢复（ticket-de）',
        payload: {
            ticket_id: 'ticket-demo-sla-001',
            order_id: 'shop-order-demo-001',
            user_id: 'demo_ticket_user_001',
            user_email: 'demo.ticket@example.com',
            recovery_summary: '工单已解决，已退出超时未处理状态',
            previous_wait_label: '3 小时 15 分钟',
            ticket_status: 'RESOLVED',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            updated_at: '2026-03-25T10:42:00.000Z',
            incident_recovered_at: '2026-03-25T10:42:00.000Z',
            incident_duration_minutes: 42,
            reason: '已人工补发卡密并回复用户，当前无需继续催办。',
            entry_path: '售后工单 -> 已处理 -> 工单详情'
        }
    });

    assert.match(text, /工单 SLA 恢复/);
    assert.match(text, /工单号：ticket-demo-sla-001/);
    assert.match(text, /订单号：shop-order-demo-001/);
    assert.match(text, /用户邮箱：demo\.ticket@example\.com/);
    assert.match(text, /用户ID：demo_ticket_user_001/);
    assert.match(text, /恢复结论：工单已解决，已退出超时未处理状态/);
    assert.match(text, /上次超时等待：3 小时 15 分钟/);
    assert.match(text, /当前状态：已解决/);
    assert.match(text, /持续时长：42 分钟/);
    assert.match(text, /处理入口：售后工单 -> 已处理 -> 工单详情/);
});

test('resolveEnabledChannels applies tickets routing rules to new support ticket alerts', () => {
    const runtime = createRuntimeConfig({
        config: {
            routing: {
                tickets: {
                    telegram: false,
                    feishu: true,
                    email: false
                }
            }
        }
    });

    const channels = __testUtils.resolveEnabledChannels(runtime, 'warning', 'ticket_new');
    assert.deepEqual(channels, ['feishu']);
});

test('buildExternalAlertText renders ticket SLA summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'ticket_sla_summary',
        severity: 'critical',
        title: '工单超时汇总（2 条超时工单）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T08:00:00.000Z',
            item_count: 2,
            summary_max_items: 5,
            entry_path: '售后工单 -> 待处理 -> 工单详情',
            items: [
                {
                    alert_type: 'ticket_sla_overdue',
                    payload: {
                        ticket_id: 'ticket-a1',
                        order_id: 'order-a1',
                        user_id: 'user-a1',
                        user_email: 'user-a1@example.com',
                        wait_label: '2 小时 30 分钟',
                        ticket_status: 'PENDING',
                        reason: '卡密未到账',
                        responsible_label: '未分配',
                        updated_at: '2026-03-27T06:10:00.000Z'
                    }
                },
                {
                    alert_type: 'ticket_sla_overdue',
                    payload: {
                        ticket_id: 'ticket-b2',
                        order_id: 'order-b2',
                        user_id: 'user-b2',
                        user_email: 'user-b2@example.com',
                        wait_label: '5 小时 20 分钟',
                        ticket_status: 'PENDING',
                        reason: '用户重复催单',
                        responsible_label: '夜班值守',
                        updated_at: '2026-03-27T06:45:00.000Z'
                    }
                }
            ]
        }
    });

    assert.match(text, /站外告警汇总/);
    assert.match(text, /工单超时汇总/);
    assert.match(text, new RegExp(`时间窗口：${formatShanghaiTimestamp('2026-03-27T06:00:00.000Z')} - ${formatShanghaiTimestamp('2026-03-27T08:00:00.000Z')}`));
    assert.match(text, /累计超时工单：2 条/);
    assert.match(text, /1\. ticket-a1 · 已等待 2 小时 30 分钟/);
    assert.match(text, /用户邮箱：user-a1@example\.com/);
    assert.match(text, /2\. ticket-b2 · 已等待 5 小时 20 分钟/);
    assert.match(text, /用户邮箱：user-b2@example\.com/);
    assert.match(text, /当前负责人：夜班值守/);
    assert.match(text, new RegExp(`时间：${formatShanghaiTimestamp('2026-03-27T06:45:00.000Z')}`));
    assert.match(text, /处理入口：售后工单 -> 待处理 -> 工单详情/);
});

test('buildExternalAlertText renders payment gateway summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_gateway_summary',
        severity: 'critical',
        title: '支付通道异常汇总（2 条通道异常）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T07:30:00.000Z',
            item_count: 2,
            summary_max_items: 6,
            entry_path: '支付对账 -> 支付总览 -> 通道表现 / 最近24小时异常趋势',
            items: [
                {
                    alert_type: 'payment_gateway_degraded',
                    payload: {
                        provider: 'afdian',
                        site: 'cn',
                        degraded_reasons: ['支付成功率仅 16.67%（1/6）'],
                        total_orders: 6,
                        paid_orders: 1,
                        review_orders: 4,
                        failed_orders: 2,
                        webhook_total: 5,
                        query_total: 4,
                        webhook_5xx: 3,
                        query_5xx: 1,
                        checked_at: '2026-03-27T06:10:00.000Z'
                    }
                },
                {
                    alert_type: 'payment_gateway_degraded',
                    payload: {
                        provider: 'hupijiao',
                        site: 'us',
                        degraded_reasons: ['回调 5xx 已累计 4 次'],
                        total_orders: 8,
                        paid_orders: 3,
                        review_orders: 2,
                        failed_orders: 3,
                        webhook_total: 6,
                        query_total: 5,
                        webhook_5xx: 4,
                        query_5xx: 0,
                        checked_at: '2026-03-27T06:45:00.000Z'
                    }
                }
            ]
        }
    });

    assert.match(text, /支付通道异常汇总/);
    assert.match(text, /累计通道异常：2 条/);
    assert.match(text, /1\. 爱发电（CN）/);
    assert.match(text, /2\. 虎皮椒（US）/);
    assert.match(text, /回调\/查码：回调 5xx 3 次 \/ 查码 5xx 1 次/);
    assert.match(text, /处理入口：支付对账 -> 支付总览 -> 通道表现 \/ 最近24小时异常趋势/);
});

test('buildExternalAlertText renders verify quota summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_quota_summary',
        severity: 'warning',
        title: '验证额度告警汇总（2 条额度告警）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T07:30:00.000Z',
            item_count: 2,
            summary_max_items: 5,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态',
            items: [
                {
                    alert_type: 'verify_quota_low',
                    payload: {
                        key_name: 'primary-key',
                        balance: 11,
                        remaining_jobs: 11,
                        queue_size: 7,
                        running_jobs: 2,
                        degraded_reasons: ['剩余额度 11.00 点（阈值 20.00 点）'],
                        checked_at: '2026-03-27T06:10:00.000Z'
                    }
                },
                {
                    alert_type: 'verify_quota_low',
                    payload: {
                        key_name: 'backup-key',
                        balance: 8,
                        remaining_jobs: 6,
                        queue_size: 3,
                        running_jobs: 1,
                        degraded_reasons: ['预计仅可继续 6 次验证（阈值 20 次）'],
                        checked_at: '2026-03-27T06:45:00.000Z'
                    }
                }
            ]
        }
    });

    assert.match(text, /验证额度告警汇总/);
    assert.match(text, /累计额度告警：2 条/);
    assert.match(text, /1\. primary-key/);
    assert.match(text, /剩余能力：11\.00 点 \/ 预计 11 次/);
    assert.match(text, /队列概览：排队 7 个 \/ 运行中 2 个/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 当前额度 \/ 队列状态/);
});

test('buildExternalAlertText renders verify queue summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_queue_summary',
        severity: 'warning',
        title: '验证堆积告警汇总（2 条堆积告警）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T07:30:00.000Z',
            item_count: 2,
            summary_max_items: 5,
            entry_path: '后台设置 -> 验证服务配置 -> 队列状态 / 最近任务',
            items: [
                {
                    alert_type: 'verify_queue_backlog',
                    payload: {
                        key_name: 'primary-key',
                        queue_size: 18,
                        running_jobs: 4,
                        active_job_count: 11,
                        oldest_pending_label: '42 分钟',
                        degraded_reasons: ['上游队列已堆积 18 个任务（阈值 10 个）'],
                        hot_errors: ['lock_conflict × 4'],
                        checked_at: '2026-03-27T06:10:00.000Z'
                    }
                },
                {
                    alert_type: 'verify_queue_backlog',
                    payload: {
                        key_name: 'backup-key',
                        queue_size: 12,
                        running_jobs: 3,
                        active_job_count: 7,
                        oldest_pending_label: '19 分钟',
                        degraded_reasons: ['最近 30 分钟失败 6 次（阈值 4 次）'],
                        hot_errors: ['otp_invalid × 2'],
                        checked_at: '2026-03-27T06:45:00.000Z'
                    }
                }
            ]
        }
    });

    assert.match(text, /验证堆积告警汇总/);
    assert.match(text, /累计堆积告警：2 条/);
    assert.match(text, /1\. primary-key/);
    assert.match(text, /队列概览：上游排队 18 个 \/ 运行中 4 个 \/ 本地活跃 11 个/);
    assert.match(text, /最近错误：lock_conflict × 4/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 队列状态 \/ 最近任务/);
});

test('buildExternalAlertText renders verify failure summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'verify_failure_summary',
        severity: 'critical',
        title: '验证失败率告警汇总（2 条失败率告警）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T07:30:00.000Z',
            item_count: 2,
            summary_max_items: 5,
            entry_path: '后台设置 -> 验证服务配置 -> 最近任务 / 最近失败',
            items: [
                {
                    alert_type: 'verify_failure_rate_spike',
                    payload: {
                        key_name: 'primary-key',
                        total_jobs: 9,
                        failed_jobs: 7,
                        success_jobs: 2,
                        failure_rate: 77.78,
                        affected_user_count: 5,
                        degraded_reasons: ['最近 30 分钟失败率 77.78%（7/9，阈值 60.00%）'],
                        hot_errors: ['otp_invalid × 4'],
                        checked_at: '2026-03-27T06:10:00.000Z'
                    }
                },
                {
                    alert_type: 'verify_failure_rate_spike',
                    payload: {
                        key_name: 'backup-key',
                        total_jobs: 8,
                        failed_jobs: 6,
                        success_jobs: 2,
                        failure_rate: 75,
                        affected_user_count: 4,
                        degraded_reasons: ['受影响用户 4 人（阈值 3 人）'],
                        hot_errors: ['lock_conflict × 3'],
                        checked_at: '2026-03-27T06:45:00.000Z'
                    }
                }
            ]
        }
    });

    assert.match(text, /验证失败率告警汇总/);
    assert.match(text, /累计失败率告警：2 条/);
    assert.match(text, /1\. primary-key/);
    assert.match(text, /任务概览：总 9 次 \/ 失败 7 次 \/ 成功 2 次 \/ 失败率 77\.78%/);
    assert.match(text, /受影响用户：5 人/);
    assert.match(text, /最近错误：otp_invalid × 4/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 最近任务 \/ 最近失败/);
});

test('buildExternalAlertText renders shop order delivery summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_order_delivery_summary',
        severity: 'critical',
        title: '履约失败汇总（2 条履约异常）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T07:15:00.000Z',
            item_count: 2,
            summary_max_items: 4,
            entry_path: '商城管理 -> 履约任务 / 异常订单',
            items: [
                {
                    alert_type: 'shop_order_delivery_failed',
                    payload: {
                        order_id: 'shop-ord-a1',
                        product_name: 'Prompt Pro 年卡',
                        user_id: 'buyer-a1',
                        delivery_status_label: '重试中',
                        delivery_attempt_count: 2,
                        delivery_last_error: '库存锁定冲突，已等待下一轮重试',
                        delivery_updated_at: '2026-03-27T06:10:00.000Z'
                    }
                },
                {
                    alert_type: 'shop_order_delivery_failed',
                    payload: {
                        order_id: 'shop-ord-b2',
                        product_name: '卡密周卡',
                        user_id: 'buyer-b2',
                        delivery_status_label: '死信待处理',
                        delivery_attempt_count: 4,
                        delivery_last_error: '目标履约地址连续超时',
                        delivery_updated_at: '2026-03-27T06:45:00.000Z'
                    }
                }
            ]
        }
    });

    assert.match(text, /履约失败汇总/);
    assert.match(text, /累计履约异常：2 条/);
    assert.match(text, /1\. shop-ord-a1 · Prompt Pro 年卡/);
    assert.match(text, /当前状态：重试中/);
    assert.match(text, /失败次数：2/);
    assert.match(text, /最近错误：库存锁定冲突，已等待下一轮重试/);
    assert.match(text, /2\. shop-ord-b2 · 卡密周卡/);
    assert.match(text, /处理入口：商城管理 -> 履约任务 \/ 异常订单/);
});

test('buildExternalAlertText renders shop inventory low details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_inventory_low',
        severity: 'warning',
        title: 'Prompt Pro 月卡 库存不足',
        payload: {
            product_name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 3,
            low_stock_threshold: 5,
            recent_sales_days: 7,
            recent_sales_count: 12,
            delivery_type: 'KEY',
            updated_at: '2026-03-25T10:00:00.000Z',
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货'
        }
    });

    assert.match(text, /商城库存告警/);
    assert.match(text, /商品：Prompt Pro 月卡/);
    assert.match(text, /分类：提示词/);
    assert.match(text, /当前库存：3 件（阈值 5 件）/);
    assert.match(text, /近 7 天销量：12 件/);
    assert.match(text, /发货模式：卡密直发/);
    assert.match(text, /处理入口：商城管理 -> 商品列表 -> 库存 \/ 补货/);
});

test('buildExternalAlertText renders shop inventory recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_inventory_recovered',
        severity: 'warning',
        title: 'Prompt Pro 月卡 库存已恢复',
        payload: {
            product_name: 'Prompt Pro 月卡',
            category: '提示词',
            recovery_summary: '商品库存已高于阈值，当前可售库存 18 件',
            stock_count: 18,
            previous_stock_count: 3,
            low_stock_threshold: 5,
            recent_sales_days: 7,
            recent_sales_count: 12,
            delivery_type: 'KEY',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            updated_at: '2026-03-25T10:54:00.000Z',
            incident_recovered_at: '2026-03-25T10:54:00.000Z',
            incident_duration_minutes: 54,
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货'
        }
    });

    assert.match(text, /商城库存恢复/);
    assert.match(text, /商品：Prompt Pro 月卡/);
    assert.match(text, /分类：提示词/);
    assert.match(text, /恢复结论：商品库存已高于阈值，当前可售库存 18 件/);
    assert.match(text, /当前库存：18 件（阈值 5 件）/);
    assert.match(text, /上次告警库存：3 件/);
    assert.match(text, /近 7 天销量：12 件/);
    assert.match(text, /持续时长：54 分钟/);
    assert.match(text, /处理入口：商城管理 -> 商品列表 -> 库存 \/ 补货/);
});

test('buildExternalAlertText renders shop inventory summary details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_inventory_summary',
        severity: 'critical',
        title: '库存与补货汇总（2 条库存告警）',
        payload: {
            window_start_at: '2026-03-27T06:00:00.000Z',
            window_end_at: '2026-03-27T08:00:00.000Z',
            item_count: 2,
            summary_max_items: 4,
            entry_path: '商城管理 -> 商品列表 -> 库存 / 补货',
            items: [
                {
                    alert_type: 'shop_inventory_low',
                    payload: {
                        product_name: 'Prompt Pro 月卡',
                        category: '提示词',
                        stock_count: 3,
                        low_stock_threshold: 5,
                        recent_sales_days: 7,
                        recent_sales_count: 12,
                        updated_at: '2026-03-27T06:10:00.000Z'
                    }
                },
                {
                    alert_type: 'shop_inventory_empty',
                    payload: {
                        product_name: '账号季卡',
                        category: '账号',
                        stock_count: 0,
                        low_stock_threshold: 5,
                        recent_sales_days: 7,
                        recent_sales_count: 4,
                        updated_at: '2026-03-27T06:45:00.000Z'
                    }
                }
            ]
        }
    });

    assert.match(text, /站外告警汇总/);
    assert.match(text, new RegExp(`时间窗口：${formatShanghaiTimestamp('2026-03-27T06:00:00.000Z')} - ${formatShanghaiTimestamp('2026-03-27T08:00:00.000Z')}`));
    assert.match(text, /库存与补货汇总/);
    assert.match(text, /累计库存告警：2 条/);
    assert.match(text, /Prompt Pro 月卡 · 低库存/);
    assert.match(text, /账号季卡 · 已售罄/);
    assert.match(text, /当前库存：0 件（已售罄）/);
    assert.match(text, /处理入口：商城管理 -> 商品列表 -> 库存 \/ 补货/);
});

test('buildExternalAlertText renders shop order delivery failure details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_order_delivery_failed',
        severity: 'critical',
        title: '商城履约失败（shop-ord）',
        payload: {
            order_id: 'shop-order-demo-delivery-001',
            product_name: 'Prompt Pro 年卡',
            user_id: 'demo_delivery_user_001',
            item_count: 2,
            total_price: 59.8,
            delivery_status: 'dead_letter',
            delivery_status_label: '死信待处理',
            delivery_attempt_count: 4,
            delivery_last_error: '目标履约地址连续超时',
            refund_status: 'none',
            refund_status_label: '正常',
            created_at: '2026-03-25T10:00:00.000Z',
            delivery_updated_at: '2026-03-25T10:15:00.000Z',
            entry_path: '商城管理 -> 履约任务 / 异常订单'
        }
    });

    assert.match(text, /商城履约告警/);
    assert.match(text, /订单号：shop-order-demo-delivery-001/);
    assert.match(text, /商品：Prompt Pro 年卡/);
    assert.match(text, /用户ID：demo_delivery_user_001/);
    assert.match(text, /购买数量：2 件/);
    assert.match(text, /订单金额：59\.80 元/);
    assert.match(text, /履约状态：死信待处理/);
    assert.match(text, /失败次数：4/);
    assert.match(text, /退款状态：正常/);
    assert.match(text, /最近错误：目标履约地址连续超时/);
    assert.match(text, /处理入口：商城管理 -> 履约任务 \/ 异常订单/);
});

test('buildExternalAlertText renders shop order delivery incident details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_order_delivery_incident',
        severity: 'critical',
        title: '商城履约异常升级（4 笔）',
        payload: {
            incident_order_count: 4,
            dead_letter_count: 2,
            retry_waiting_count: 2,
            distinct_user_count: 3,
            distinct_product_count: 2,
            signal_labels: [
                '当前有 4 笔订单处于履约异常状态',
                '其中 2 笔已进入死信队列',
                '影响 3 位用户'
            ],
            hot_products: ['Prompt Pro 年卡 × 3', '卡密周卡 × 1'],
            hot_errors: ['目标履约地址连续超时 × 2', '库存锁定冲突，已等待下一轮重试 × 2'],
            order_refs: ['shop-order-demo-delivery-001', 'shop-order-demo-delivery-002'],
            latest_failure_at: '2026-03-25T10:15:00.000Z',
            entry_path: '商城管理 -> 履约任务 / 异常订单（示例）'
        }
    });

    assert.match(text, /商城履约事故/);
    assert.match(text, /升级信号：当前有 4 笔订单处于履约异常状态；其中 2 笔已进入死信队列；影响 3 位用户/);
    assert.match(text, /异常订单：4 笔（死信 2 \/ 重试 2）/);
    assert.match(text, /受影响用户：3 位/);
    assert.match(text, /涉及商品：2 个/);
    assert.match(text, /热点商品：Prompt Pro 年卡 × 3、卡密周卡 × 1/);
    assert.match(text, /热点错误：目标履约地址连续超时 × 2；库存锁定冲突，已等待下一轮重试 × 2/);
    assert.match(text, /示例订单：shop-order-demo-delivery-001、shop-order-demo-delivery-002/);
    assert.match(text, /处理入口：商城管理 -> 履约任务 \/ 异常订单（示例）/);
});

test('buildExternalAlertText renders shop order delivery incident recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_order_delivery_incident_recovered',
        severity: 'warning',
        title: '商城履约事故已恢复',
        payload: {
            incident_started_at: '2026-03-25T10:00:00.000Z',
            incident_recovered_at: '2026-03-25T10:46:00.000Z',
            incident_duration_minutes: 46,
            previous_incident_order_count: 4,
            previous_dead_letter_count: 2,
            previous_retry_waiting_count: 2,
            recovery_summary: '履约集中事故阈值已解除，当前仍保留 1 笔单笔异常订单',
            active_order_count: 1,
            active_dead_letter_count: 0,
            active_retry_waiting_count: 1,
            active_user_count: 1,
            active_products: ['卡密周卡 × 1'],
            active_errors: ['库存锁定冲突，已等待下一轮重试 × 1'],
            entry_path: '商城管理 -> 履约任务 / 异常订单（示例）'
        }
    });

    assert.match(text, /商城履约事故恢复/);
    assert.match(text, /恢复结论：履约集中事故阈值已解除，当前仍保留 1 笔单笔异常订单/);
    assert.match(text, /上次事故规模：4 笔（死信 2 \/ 重试 2）/);
    assert.match(text, /当前剩余异常：1 笔（死信 0 \/ 重试 1）/);
    assert.match(text, /当前受影响用户：1 位/);
    assert.match(text, /当前热点商品：卡密周卡 × 1/);
    assert.match(text, /当前热点错误：库存锁定冲突，已等待下一轮重试 × 1/);
    assert.match(text, /处理入口：商城管理 -> 履约任务 \/ 异常订单（示例）/);
});

test('buildExternalAlertText renders shop order delivery recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_order_delivery_recovered',
        severity: 'warning',
        title: '商城履约已恢复（shop-ord）',
        payload: {
            order_id: 'shop-order-demo-delivery-001',
            product_name: 'Prompt Pro 年卡',
            user_id: 'demo_delivery_user_001',
            item_count: 2,
            total_price: 59.8,
            previous_delivery_status: 'dead_letter',
            previous_delivery_status_label: '死信待处理',
            previous_delivery_attempt_count: 4,
            previous_delivery_last_error: '目标履约地址连续超时',
            delivery_status: 'delivered',
            delivery_status_label: '已发货',
            refund_status: 'none',
            refund_status_label: '正常',
            incident_started_at: '2026-03-25T10:00:00.000Z',
            delivery_updated_at: '2026-03-25T10:36:00.000Z',
            incident_recovered_at: '2026-03-25T10:37:00.000Z',
            incident_duration_minutes: 37,
            recovery_summary: '订单已成功履约，已退出履约异常状态',
            entry_path: '商城管理 -> 履约任务 / 异常订单（示例）'
        }
    });

    assert.match(text, /商城履约恢复/);
    assert.match(text, /订单号：shop-order-demo-delivery-001/);
    assert.match(text, /商品：Prompt Pro 年卡/);
    assert.match(text, /用户ID：demo_delivery_user_001/);
    assert.match(text, /购买数量：2 件/);
    assert.match(text, /订单金额：59\.80 元/);
    assert.match(text, /恢复结论：订单已成功履约，已退出履约异常状态/);
    assert.match(text, /上次异常状态：死信待处理/);
    assert.match(text, /上次失败次数：4/);
    assert.match(text, /当前履约状态：已发货/);
    assert.match(text, /退款状态：正常/);
    assert.match(text, /持续时长：37 分钟/);
    assert.match(text, /上次错误：目标履约地址连续超时/);
    assert.match(text, /处理入口：商城管理 -> 履约任务 \/ 异常订单（示例）/);
});

test('buildExternalAlertText renders shop order risk anomaly details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_order_risk_anomaly',
        severity: 'critical',
        title: '优惠码高频使用异常（FLASH0）',
        payload: {
            signal_type: 'discount_code_spike',
            risk_score: 94,
            risk_level: 'critical',
            primary_action: 'disable-coupon',
            response_summary: '建议立即停用优惠码 FLASH0，并复核最近命中订单。',
            discount_code: 'FLASH0',
            order_count: 4,
            distinct_user_count: 3,
            zero_total_count: 4,
            window_minutes: 30,
            site_labels: ['CN × 3', 'INTL × 1'],
            sample_products: ['Prompt Pro 年卡 × 2', '卡密周卡 × 2'],
            sample_users: ['Alpha', 'Beta', 'Gamma'],
            order_refs: ['order-1', 'order-2'],
            latest_order_at: '2026-03-27T10:06:00.000Z',
            entry_path: '商城管理 -> 订单列表 / 优惠券码'
        }
    });

    assert.match(text, /商城风控告警/);
    assert.match(text, /风险类型：优惠码高频使用/);
    assert.match(text, /风险等级：紧急 \(94 分\)/);
    assert.match(text, /优惠码：FLASH0/);
    assert.match(text, /命中订单：4 笔/);
    assert.match(text, /涉及账号：3 个/);
    assert.match(text, /0 价订单：4 笔/);
    assert.match(text, /统计窗口：30 分钟/);
    assert.match(text, /建议动作：建议立即停用优惠码 FLASH0，并复核最近命中订单。/);
    assert.match(text, /首选处置：停用优惠码/);
    assert.match(text, /热点商品：Prompt Pro 年卡 × 2、卡密周卡 × 2/);
    assert.match(text, /处理入口：商城管理 -> 订单列表 \/ 优惠券码/);
});

test('buildExternalAlertText renders shop order risk recovery details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'shop_order_risk_recovered',
        severity: 'warning',
        title: '优惠码风险已恢复（FLASH0）',
        payload: {
            signal_type: 'discount_code_spike',
            recovery_summary: '优惠码 FLASH0 在风险窗口内已回落到阈值以下',
            discount_code: 'FLASH0',
            previous_risk_score: 94,
            previous_risk_level: 'critical',
            previous_primary_action: 'disable-coupon',
            previous_response_summary: '建议立即停用优惠码 FLASH0，并复核最近命中订单。',
            previous_order_count: 4,
            previous_distinct_user_count: 3,
            previous_zero_total_count: 4,
            previous_hot_discount_codes: ['FLASH0 × 4'],
            previous_sample_products: ['Prompt Pro 年卡 × 2', '卡密周卡 × 2'],
            incident_started_at: '2026-03-27T09:50:00.000Z',
            incident_recovered_at: '2026-03-27T10:20:00.000Z',
            incident_duration_minutes: 30,
            entry_path: '商城管理 -> 订单列表 / 优惠券码'
        }
    });

    assert.match(text, /商城风控恢复/);
    assert.match(text, /风险类型：优惠码高频使用/);
    assert.match(text, /恢复结论：优惠码 FLASH0 在风险窗口内已回落到阈值以下/);
    assert.match(text, /上次风险等级：紧急 \(94 分\)/);
    assert.match(text, /优惠码：FLASH0/);
    assert.match(text, /上次命中订单：4 笔/);
    assert.match(text, /上次涉及账号：3 个/);
    assert.match(text, /上次 0 价订单：4 笔/);
    assert.match(text, /上次建议动作：建议立即停用优惠码 FLASH0，并复核最近命中订单。/);
    assert.match(text, /上次首选处置：停用优惠码/);
    assert.match(text, /持续时长：30 分钟/);
    assert.match(text, /处理入口：商城管理 -> 订单列表 \/ 优惠券码/);
});

test('buildExternalAlertText renders admin login anomaly details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'security_admin_login_anomaly',
        severity: 'critical',
        title: '管理员异常登录（admin@example.com）',
        payload: {
            admin_email: 'admin@example.com',
            client_ip: '203.0.113.88',
            client_ip_group: '203.0.113.0/24',
            user_agent: 'Mozilla/5.0 Demo Chrome/124',
            user_agent_fingerprint: 'chrome:unknown:desktop',
            occurred_at: '2026-03-25T10:00:00.000Z',
            previous_ips: ['198.51.100.21', '198.51.100.22'],
            recent_distinct_ip_count: 3,
            recent_distinct_user_agent_count: 2,
            detected_reasons: [
                '管理员首次从该 IP 段登录后台',
                '最近窗口内出现 3 个登录 IP 段'
            ],
            origin: 'https://www.fatherkey.com',
            referer: 'https://www.fatherkey.com/admin-entry.html',
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs -> 异常登录信号'
        }
    });

    assert.match(text, /管理员安全告警/);
    assert.match(text, /管理员：admin@example.com/);
    assert.match(text, /登录 IP：203\.0\.113\.88/);
    assert.match(text, /登录 IP 段：203\.0\.113\.0\/24/);
    assert.match(text, /设备家族：chrome:unknown:desktop/);
    assert.match(text, /判定信号：管理员首次从该 IP 段登录后台；最近窗口内出现 3 个登录 IP 段/);
    assert.match(text, /最近窗口内 IP 段数：3/);
    assert.match(text, /历史常用 IP：198\.51\.100\.21、198\.51\.100\.22/);
    assert.match(text, /处理入口：后台设置 -> 管理员访问 \/ Admin Audit Logs -> 异常登录信号/);
});

test('ops alerts exports sendFeishuAlert for admin preview actions', () => {
    assert.equal(typeof sendFeishuAlert, 'function');
});

test('enqueueOpsAlertJob can restrict delivery to selected channels', async () => {
    const state = { jobs: [] };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_incident_recovered',
        severity: 'warning',
        title: '验证综合异常已恢复（primary-key）',
        content: '恢复结论：验证综合高危组合已解除',
        payload: {
            target_id: 'verify_incident:https://verify.test'
        },
        allowedChannels: ['feishu']
    }, { runtime });

    assert.equal(result.queued, true);
    assert.equal(state.jobs.length, 1);
    assert.deepEqual(state.jobs[0].channels, ['feishu']);
    assert.deepEqual(state.jobs[0].remaining_channels, ['feishu']);
});

test('enqueueOpsAlertJob auto-reopens a resolved case when the same target receives a new alert', async () => {
    const state = {
        jobs: [],
        cases: [{
            category_key: 'verify',
            target_id: 'verify_service:https://aidone.lol',
            alert_type: 'verify_service_disabled',
            status: 'resolved',
            owner_admin_id: 'zaoyoe@gmail.com',
            owner_label: 'zaoyoe@gmail.com',
            resolution: '已经后台修复',
            metadata: {
                title: '验证服务不可用'
            },
            last_action: 'resolved',
            last_action_by: 'zaoyoe@gmail.com',
            last_action_at: '2026-04-11T12:02:28.000Z',
            updated_at: '2026-04-11T12:02:28.000Z'
        }],
        caseEvents: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_service_disabled',
        severity: 'critical',
        title: '验证服务不可用',
        content: '验证服务当前不可用，新的验证请求将无法正常创建。',
        payload: {
            target_id: 'verify_service:https://aidone.lol',
            api_base_url: 'https://aidone.lol',
            response_status: 404
        },
        createdAt: '2026-04-11T19:57:32.000Z',
        source: 'verify_service_monitor'
    }, { runtime });

    assert.equal(result.queued, true);
    assert.equal(result.caseSync?.reopened, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.cases.length, 1);
    assert.equal(state.cases[0].status, 'open');
    assert.equal(state.cases[0].last_action, 'reopened');
    assert.equal(state.cases[0].resolution, null);
    assert.equal(state.caseEvents.length, 1);
    assert.equal(state.caseEvents[0].action, 'reopen');
    assert.equal(state.caseEvents[0].status, 'open');
});

test('enqueueOpsAlertJob does not auto-reopen a case closed after the triggering alert', async () => {
    const state = {
        jobs: [],
        cases: [{
            category_key: 'verify',
            target_id: 'verify_service:https://aidone.lol',
            alert_type: 'verify_service_disabled',
            status: 'resolved',
            owner_admin_id: 'zaoyoe@gmail.com',
            owner_label: 'zaoyoe@gmail.com',
            resolution: '已经人工关闭当前告警',
            metadata: {
                title: '验证服务不可用'
            },
            last_action: 'resolved',
            last_action_by: 'zaoyoe@gmail.com',
            last_action_at: '2026-04-11T20:00:00.000Z',
            updated_at: '2026-04-11T20:00:00.000Z'
        }],
        caseEvents: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_service_disabled',
        severity: 'critical',
        title: '验证服务不可用',
        content: '验证服务当前不可用，新的验证请求将无法正常创建。',
        payload: {
            target_id: 'verify_service:https://aidone.lol',
            api_base_url: 'https://aidone.lol',
            response_status: 404
        },
        createdAt: '2026-04-11T19:57:32.000Z',
        source: 'verify_service_monitor'
    }, { runtime });

    assert.equal(result.queued, true);
    assert.equal(result.caseSync?.reopened, false);
    assert.equal(result.caseSync?.reason, 'case_closed_after_alert');
    assert.equal(state.jobs.length, 1);
    assert.equal(state.cases[0].status, 'resolved');
    assert.equal(state.cases[0].last_action, 'resolved');
    assert.equal(state.cases[0].resolution, '已经人工关闭当前告警');
    assert.equal(state.caseEvents.length, 0);
});

test('enqueueOpsAlertJob auto-reopens a resolved case when an actionable summary receives a new alert', async () => {
    const state = {
        jobs: [],
        cases: [{
            category_key: 'verify',
            target_id: 'ops_summary:verify_quota_summary',
            alert_type: 'verify_quota_summary',
            status: 'resolved',
            owner_admin_id: 'zaoyoe@gmail.com',
            owner_label: 'zaoyoe@gmail.com',
            resolution: '额度已补充',
            metadata: {
                title: '验证额度告警汇总'
            },
            last_action: 'resolved',
            last_action_by: 'zaoyoe@gmail.com',
            last_action_at: '2026-05-11T10:00:00.000Z',
            updated_at: '2026-05-11T10:00:00.000Z'
        }],
        caseEvents: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            verify_quota: {
                enabled: true,
                summary_enabled: true,
                summary_schedule_mode: 'hourly',
                summary_hourly_minute: 0,
                summary_window_minutes: 60,
                summary_max_items: 10
            }
        }
    });

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_quota_low',
        severity: 'critical',
        title: '验证额度不足预警（primary-key）',
        content: '验证额度告警\nAPI Key：primary-key',
        payload: {
            target_id: 'verify_quota:primary-key',
            key_name: 'primary-key',
            balance: 0,
            remaining_jobs: 0,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态'
        },
        createdAt: '2026-05-11T12:04:10.404Z',
        source: 'verify_quota_monitor'
    }, {
        runtime,
        now: new Date('2026-05-11T12:04:10.404Z')
    });

    assert.equal(result.queued, true);
    assert.equal(result.summary, true);
    assert.equal(result.caseSync?.reopened, true);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'verify_quota_summary');
    assert.equal(state.jobs[0].payload.target_id, 'ops_summary:verify_quota_summary');
    assert.equal(state.cases[0].status, 'open');
    assert.equal(state.cases[0].last_action, 'reopened');
    assert.equal(state.cases[0].resolution, null);
    assert.equal(state.caseEvents.length, 1);
    assert.equal(state.caseEvents[0].action, 'reopen');
    assert.equal(state.caseEvents[0].target_id, 'ops_summary:verify_quota_summary');
});

test('enqueueOpsAlertJob does not auto-reopen an actionable summary closed after the triggering alert', async () => {
    const state = {
        jobs: [],
        cases: [{
            category_key: 'verify',
            target_id: 'ops_summary:verify_quota_summary',
            alert_type: 'verify_quota_summary',
            status: 'resolved',
            owner_admin_id: 'zaoyoe@gmail.com',
            owner_label: 'zaoyoe@gmail.com',
            resolution: '额度已人工确认，无需继续关注',
            metadata: {
                title: '验证额度告警汇总'
            },
            last_action: 'resolved',
            last_action_by: 'zaoyoe@gmail.com',
            last_action_at: '2026-05-11T10:00:00.000Z',
            updated_at: '2026-05-11T10:00:00.000Z'
        }],
        caseEvents: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            verify_quota: {
                enabled: true,
                summary_enabled: true,
                summary_schedule_mode: 'hourly',
                summary_hourly_minute: 0,
                summary_window_minutes: 60,
                summary_max_items: 10
            }
        }
    });

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_quota_low',
        severity: 'critical',
        title: '验证额度不足预警（primary-key）',
        content: '验证额度告警\nAPI Key：primary-key',
        payload: {
            target_id: 'verify_quota:primary-key',
            key_name: 'primary-key',
            balance: 0,
            remaining_jobs: 0,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态'
        },
        createdAt: '2026-05-11T09:04:10.404Z',
        source: 'verify_quota_monitor'
    }, {
        runtime,
        now: new Date('2026-05-11T09:04:10.404Z')
    });

    assert.equal(result.queued, true);
    assert.equal(result.summary, true);
    assert.equal(result.caseSync?.reopened, false);
    assert.equal(result.caseSync?.reason, 'case_closed_after_alert');
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'verify_quota_summary');
    assert.equal(state.cases[0].status, 'resolved');
    assert.equal(state.cases[0].last_action, 'resolved');
    assert.equal(state.cases[0].resolution, '额度已人工确认，无需继续关注');
    assert.equal(state.caseEvents.length, 0);
});

test('enqueueOpsAlertJob does not auto-reopen an actionable summary already closed for the same window', async () => {
    const state = {
        jobs: [],
        cases: [],
        caseEvents: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            verify_quota: {
                enabled: true,
                summary_enabled: true,
                summary_schedule_mode: 'hourly',
                summary_hourly_minute: 0,
                summary_window_minutes: 60,
                summary_max_items: 10
            }
        }
    });

    const first = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_quota_low',
        severity: 'critical',
        title: '验证额度不足预警（primary-key）',
        content: '验证额度告警\nAPI Key：primary-key',
        payload: {
            target_id: 'verify_quota:primary-key',
            key_name: 'primary-key',
            balance: 0,
            remaining_jobs: 0,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态'
        },
        createdAt: '2026-05-11T12:04:10.404Z',
        source: 'verify_quota_monitor'
    }, {
        runtime,
        now: new Date('2026-05-11T12:04:10.404Z')
    });

    assert.equal(first.queued, true);
    assert.equal(first.summary, true);
    assert.equal(state.jobs.length, 1);

    state.cases.push({
        site: 'cn',
        category_key: 'verify',
        target_id: 'ops_summary:verify_quota_summary',
        alert_type: 'verify_quota_summary',
        status: 'resolved',
        owner_admin_id: 'zaoyoe@gmail.com',
        owner_label: 'zaoyoe@gmail.com',
        resolution: '当前汇总窗口已确认，无需继续关注',
        metadata: {
            title: '验证额度告警汇总',
            resolved_summary_window_start_at: state.jobs[0].payload.window_start_at,
            resolved_summary_window_end_at: state.jobs[0].payload.window_end_at
        },
        last_action: 'resolved',
        last_action_by: 'zaoyoe@gmail.com',
        last_action_at: '2026-05-11T12:10:00.000Z',
        updated_at: '2026-05-11T12:10:00.000Z'
    });

    const second = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_quota_low',
        severity: 'critical',
        title: '验证额度不足预警（backup-key）',
        content: '验证额度告警\nAPI Key：backup-key',
        payload: {
            target_id: 'verify_quota:backup-key',
            key_name: 'backup-key',
            balance: 0,
            remaining_jobs: 0,
            entry_path: '后台设置 -> 验证服务配置 -> 当前额度 / 队列状态'
        },
        createdAt: '2026-05-11T12:20:10.404Z',
        source: 'verify_quota_monitor'
    }, {
        runtime,
        now: new Date('2026-05-11T12:20:10.404Z')
    });

    assert.equal(second.queued, true);
    assert.equal(second.summary, true);
    assert.equal(second.caseSync?.reopened, false);
    assert.equal(second.caseSync?.reason, 'case_closed_after_summary_window');
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].payload.item_count, 2);
    assert.equal(state.cases[0].status, 'resolved');
    assert.equal(state.cases[0].last_action, 'resolved');
    assert.equal(state.cases[0].resolution, '当前汇总窗口已确认，无需继续关注');
    assert.equal(state.caseEvents.length, 0);
});

test('enqueueOpsAlertJob keeps resolved cases isolated by site when auto-reopening', async () => {
    const state = {
        jobs: [],
        cases: [{
            site: 'cn',
            category_key: 'verify',
            target_id: 'verify_service:https://aidone.lol',
            alert_type: 'verify_service_disabled',
            status: 'resolved',
            resolution: '国内站验证服务已恢复',
            last_action: 'resolved',
            last_action_at: '2026-04-11T12:02:28.000Z'
        }],
        caseEvents: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const result = await enqueueOpsAlertJob(supabase, {
        alertType: 'verify_service_disabled',
        severity: 'critical',
        title: '验证服务不可用',
        content: '验证服务当前不可用，新的验证请求将无法正常创建。',
        payload: {
            site: 'intl',
            target_id: 'verify_service:https://aidone.lol',
            api_base_url: 'https://aidone.lol',
            response_status: 404
        },
        createdAt: '2026-04-11T19:57:32.000Z',
        source: 'verify_service_monitor'
    }, { runtime });

    assert.equal(result.queued, true);
    assert.equal(result.caseSync?.reopened, false);
    assert.equal(result.caseSync?.reason, 'missing_case');
    assert.equal(state.cases[0].status, 'resolved');
    assert.equal(state.caseEvents.length, 0);
});

test('sweepOpsAlertJobs delivers queued alerts and records per-channel attempts', async () => {
    const state = {
        jobs: [
            {
                id: 'job-1',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                dedupe_key: 'dedupe-1',
                title: '支付退款积分回滚失败',
                content: '站点：CN\n订单号：HJ_ORDER_2',
                payload: {
                    provider_order_no: 'HJ_ORDER_2'
                },
                channels: ['telegram', 'feishu'],
                remaining_channels: ['telegram', 'feishu'],
                status: 'pending',
                attempt_count: 0,
                max_attempts: 6,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                created_at: new Date(Date.now() - 2000).toISOString()
            }
        ],
        attempts: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();
    const outbound = [];

    const result = await sweepOpsAlertJobs(supabase, {
        runtime,
        workerName: 'test-worker',
        fetchImpl: async (url, options = {}) => {
            outbound.push({ url, options });
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({ ok: true });
                }
            };
        }
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.delivered, 1);
    assert.equal(result.retried, 0);
    assert.equal(outbound.length, 2);
    assert.equal(state.jobs[0].status, 'delivered');
    assert.deepEqual(state.jobs[0].remaining_channels, []);
    assert.equal(state.jobs[0].attempt_count, 1);
    assert.equal(state.jobs[0].worker_name, 'test-worker');
    assert.equal(state.attempts.length, 2);
    assert.equal(state.attempts.every((item) => item.status === 'delivered'), true);
});

test('sweepOpsAlertJobs suppresses stale verify service alerts after the case is resolved', async () => {
    const state = {
        jobs: [
            {
                id: 'job-resolved-verify',
                alert_type: 'verify_service_disabled',
                severity: 'critical',
                dedupe_key: 'dedupe-resolved-verify',
                title: '验证服务不可用',
                content: '验证服务当前不可用，新的验证请求将无法正常创建。',
                payload: {
                    target_id: 'verify_service:https://aidone.lol',
                    api_base_url: 'https://aidone.lol',
                    response_status: 404
                },
                channels: ['telegram', 'feishu'],
                remaining_channels: ['telegram', 'feishu'],
                status: 'pending',
                attempt_count: 0,
                max_attempts: 6,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                created_at: new Date(Date.now() - 2000).toISOString()
            }
        ],
        attempts: [],
        cases: [{
            category_key: 'verify',
            target_id: 'verify_service:https://aidone.lol',
            alert_type: 'verify_service_disabled',
            status: 'resolved',
            last_action: 'resolved',
            resolution: '验证服务已恢复'
        }]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const result = await sweepOpsAlertJobs(supabase, {
        runtime,
        fetchImpl: async () => {
            throw new Error('stale verify alert should not be delivered');
        }
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.delivered, 0);
    assert.equal(result.retried, 0);
    assert.equal(result.suppressed, 1);
    assert.equal(state.jobs[0].status, 'suppressed');
    assert.equal(state.jobs[0].last_error, 'case_already_resolved');
    assert.deepEqual(state.jobs[0].remaining_channels, []);
    assert.equal(state.jobs[0].attempt_count, 1);
    assert.equal(state.attempts.length, 0);
});

test('sweepOpsAlertJobs does not suppress an intl alert from a cn resolved case', async () => {
    const state = {
        jobs: [
            {
                id: 'job-intl-verify-active',
                alert_type: 'verify_service_disabled',
                severity: 'critical',
                dedupe_key: 'dedupe-intl-verify-active',
                title: '验证服务不可用',
                content: '验证服务当前不可用，新的验证请求将无法正常创建。',
                payload: {
                    site: 'intl',
                    target_id: 'verify_service:https://aidone.lol',
                    api_base_url: 'https://aidone.lol',
                    response_status: 404
                },
                channels: ['telegram'],
                remaining_channels: ['telegram'],
                status: 'pending',
                attempt_count: 0,
                max_attempts: 6,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                created_at: new Date(Date.now() - 2000).toISOString()
            }
        ],
        attempts: [],
        cases: [{
            site: 'cn',
            category_key: 'verify',
            target_id: 'verify_service:https://aidone.lol',
            alert_type: 'verify_service_disabled',
            status: 'resolved',
            last_action: 'resolved',
            resolution: '国内站验证服务已恢复'
        }]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const result = await sweepOpsAlertJobs(supabase, {
        runtime,
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({ ok: true });
            }
        })
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.delivered, 1);
    assert.equal(result.suppressed, 0);
    assert.equal(state.jobs[0].status, 'delivered');
    assert.equal(state.attempts.length, 1);
});

test('sweepOpsAlertJobs keeps failed channels for retry without duplicating delivered channels', async () => {
    const state = {
        jobs: [
            {
                id: 'job-2',
                alert_type: 'payment_refund_ops',
                severity: 'critical',
                dedupe_key: 'dedupe-2',
                title: '支付退款积分扣回失败',
                content: '站点：CN\n订单号：HJ_ORDER_3',
                payload: {
                    provider_order_no: 'HJ_ORDER_3'
                },
                channels: ['telegram', 'feishu'],
                remaining_channels: ['telegram', 'feishu'],
                status: 'pending',
                attempt_count: 1,
                max_attempts: 6,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                created_at: new Date(Date.now() - 2000).toISOString()
            }
        ],
        attempts: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig();

    const result = await sweepOpsAlertJobs(supabase, {
        runtime,
        fetchImpl: async (url) => {
            if (url.includes('telegram.org')) {
                return {
                    ok: true,
                    status: 200,
                    async text() {
                        return '{"ok":true}';
                    }
                };
            }

            return {
                ok: false,
                status: 502,
                async text() {
                    return '{"error":"gateway"}';
                }
            };
        }
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.delivered, 0);
    assert.equal(result.retried, 1);
    assert.equal(state.jobs[0].status, 'retry');
    assert.deepEqual(state.jobs[0].remaining_channels, ['feishu']);
    assert.equal(state.jobs[0].attempt_count, 2);
    assert.equal(state.attempts.length, 2);
    assert.equal(state.attempts.some((item) => item.channel === 'telegram' && item.status === 'delivered'), true);
    assert.equal(state.attempts.some((item) => item.channel === 'feishu' && item.status === 'failed'), true);
});

test('ops alerts runtime secret resolution falls back to default secret keys when the shared export is missing', async () => {
    await withOpsAlertsModuleWithoutSecretKeyMap(async (opsAlertsModule) => {
        const runtime = await opsAlertsModule.loadOpsAlertsRuntimeConfig({
            from() {
                return createQueryBuilder(async (query) => {
                    if (query.mode === 'select') {
                        return { data: [], error: null };
                    }

                    throw new Error(`Unexpected query mode: ${query.mode}`);
                });
            }
        }, {
            OPS_ALERTS_TELEGRAM_BOT_TOKEN: 'telegram-token-from-env',
            OPS_ALERTS_FEISHU_WEBHOOK_URL: 'https://open.feishu.example/hook',
            OPS_ALERTS_EMAIL_API_KEY: 're_test_email_key'
        });

        assert.equal(runtime.secrets.telegram_bot_token, 'telegram-token-from-env');
        assert.equal(runtime.secrets.telegram_bot_token_source, 'environment');
        assert.equal(runtime.secrets.feishu_webhook_url, 'https://open.feishu.example/hook');
        assert.equal(runtime.secrets.feishu_webhook_url_source, 'environment');
        assert.equal(runtime.secrets.email_api_key, 're_test_email_key');
        assert.equal(runtime.secrets.email_api_key_source, 'environment');
    });
});

test('ops alerts runtime secret resolution degrades gracefully when a stored secret cannot be decrypted', async () => {
    await withOpsAlertsModuleWithSecretsMock({
        getStoredAdminSecret: async (_supabase, secretKey) => {
            if (secretKey === 'ops_alert_telegram_bot_token') {
                throw new Error('Unsupported state or unable to authenticate data');
            }
            return null;
        }
    }, async (opsAlertsModule) => {
        const runtime = await opsAlertsModule.loadOpsAlertsRuntimeConfig({
            from() {
                return createQueryBuilder(async (query) => {
                    if (query.mode === 'select') {
                        return { data: [], error: null };
                    }

                    throw new Error(`Unexpected query mode: ${query.mode}`);
                });
            }
        }, {});

        assert.equal(runtime.secrets.telegram_bot_token, '');
        assert.equal(runtime.secrets.telegram_bot_token_source, 'error');
        assert.equal(
            runtime.secrets.telegram_bot_token_error_message,
            'Telegram Bot Token 无法解密，请检查 ADMIN_CONFIG_ENCRYPTION_KEY 是否与写入该密钥时一致，或重新保存该密钥。'
        );
        assert.equal(runtime.secrets.feishu_webhook_url_source, 'missing');
        assert.equal(runtime.secrets.email_api_key_source, 'missing');
    });
});

test('resolveEnabledChannels includes email only when the backend email channel is fully configured', () => {
    const runtime = createRuntimeConfig({
        config: {
            channels: {
                telegram: { enabled: false },
                feishu: { enabled: false },
                email: {
                    enabled: true,
                    minimum_severity: 'warning',
                    recipients: ['ops@example.com', 'owner@example.com'],
                    from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                    reply_to: 'owner@zaoyoe.com',
                    subject_prefix: '[Zaoyoe告警]'
                }
            }
        },
        secrets: {
            telegram_bot_token: '',
            feishu_webhook_url: '',
            email_api_key: 're_email_key'
        }
    });

    assert.deepEqual(__testUtils.resolveEnabledChannels(runtime, 'critical'), ['email']);
});

test('resolveEnabledChannels suppresses non-critical alerts during configured quiet hours', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            quiet_hours: {
                enabled: true,
                start_hour: 23,
                end_hour: 8,
                timezone: 'Asia/Shanghai',
                allow_critical: true
            },
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'warning', 'shop_inventory_low', {
            now: new Date('2026-03-27T16:00:00.000Z')
        }),
        []
    );
});

test('resolveEnabledChannels suppresses non-critical alerts during temporary mute window', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            temporary_mute: {
                until: '2026-03-27T10:00:00.000Z',
                allow_critical: true
            },
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'warning', 'shop_inventory_low', {
            now: new Date('2026-03-27T09:00:00.000Z')
        }),
        []
    );
});

test('resolveEnabledChannels still allows critical alerts during temporary mute when configured', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            temporary_mute: {
                until: '2026-03-27T10:00:00.000Z',
                allow_critical: true
            },
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'shop_inventory_empty', {
            now: new Date('2026-03-27T09:00:00.000Z')
        }),
        ['telegram']
    );
});

test('resolveEnabledChannels still allows critical alerts during quiet hours when configured', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            quiet_hours: {
                enabled: true,
                start_hour: 23,
                end_hour: 8,
                timezone: 'Asia/Shanghai',
                allow_critical: true
            },
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'shop_inventory_empty', {
            now: new Date('2026-03-27T16:00:00.000Z')
        }),
        ['telegram']
    );
});

test('resolveEnabledChannels filters channels by alert-type routing', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                },
                email: {
                    enabled: true,
                    minimum_severity: 'warning',
                    recipients: ['ops@example.com'],
                    from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                    subject_prefix: '[Zaoyoe告警]'
                }
            },
            routing: {
                shop_inventory: {
                    telegram: false,
                    feishu: true,
                    email: false
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key',
            feishu_webhook_url: 'https://open.feishu.cn/webhook/test',
            email_api_key: 're_email_key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'warning', 'shop_inventory_low'),
        ['feishu']
    );
});

test('resolveEnabledChannels filters channels by expanded alert-type routing', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                },
                email: {
                    enabled: true,
                    minimum_severity: 'warning',
                    recipients: ['ops@example.com'],
                    from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                    subject_prefix: '[Zaoyoe告警]'
                }
            },
            routing: {
                payment_gateway: {
                    telegram: true,
                    feishu: false,
                    email: false
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key',
            feishu_webhook_url: 'https://open.feishu.cn/webhook/test',
            email_api_key: 're_email_key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'payment_gateway_degraded'),
        ['telegram']
    );
});

test('resolveEnabledChannels routes payment config alerts through the grouped payment config key', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                },
                email: {
                    enabled: true,
                    minimum_severity: 'warning',
                    recipients: ['ops@example.com'],
                    from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                    subject_prefix: '[Zaoyoe告警]'
                }
            },
            routing: {
                payment_config: {
                    telegram: false,
                    feishu: true,
                    email: true
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key',
            feishu_webhook_url: 'https://open.feishu.cn/webhook/test',
            email_api_key: 're_email_key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'payment_config_incident'),
        ['feishu', 'email']
    );
});

test('resolveEnabledChannels suppresses alerts by type-scoped mute rules', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            },
            mute_rules: {
                types: {
                    customer_chat_message: {
                        until: '2026-03-27T12:00:00.000Z',
                        allow_critical: false
                    }
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key',
            feishu_webhook_url: 'https://open.feishu.cn/webhook/test'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'warning', 'customer_chat_message_received', {
            now: new Date('2026-03-27T10:00:00.000Z')
        }),
        []
    );
});

test('resolveEnabledChannels suppresses expanded type-scoped verify incident rules', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            },
            mute_rules: {
                types: {
                    verify_failure: {
                        until: '2026-03-28T12:00:00.000Z',
                        allow_critical: false
                    }
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'verify_incident_escalated', {
            now: new Date('2026-03-28T10:00:00.000Z')
        }),
        []
    );
});

test('resolveEnabledChannels suppresses admin login alerts by the grouped admin login type mute rule', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            },
            mute_rules: {
                types: {
                    admin_login_anomaly: {
                        until: '2026-03-28T12:00:00.000Z',
                        allow_critical: false
                    }
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'security_admin_login_anomaly', {
            now: new Date('2026-03-28T10:00:00.000Z')
        }),
        []
    );
});

test('resolveEnabledChannels suppresses alerts by module-scoped mute rules', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            },
            mute_rules: {
                modules: {
                    commerce: {
                        until: '2026-03-27T12:00:00.000Z',
                        allow_critical: false
                    }
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key',
            feishu_webhook_url: 'https://open.feishu.cn/webhook/test'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'warning', 'shop_purchase_succeeded', {
            now: new Date('2026-03-27T10:00:00.000Z')
        }),
        []
    );
});

test('resolveEnabledChannels suppresses shop risk alerts by module-scoped mute rules', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            },
            mute_rules: {
                modules: {
                    shop_risk: {
                        until: '2026-03-28T12:00:00.000Z',
                        allow_critical: false
                    }
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'shop_order_risk_anomaly', {
            now: new Date('2026-03-28T10:00:00.000Z')
        }),
        []
    );
});

test('resolveEnabledChannels lets critical alerts bypass scoped mute rules when allowed', () => {
    const runtime = createRuntimeConfig({
        config: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['123456']
                }
            },
            mute_rules: {
                modules: {
                    inventory: {
                        until: '2026-03-27T12:00:00.000Z',
                        allow_critical: true
                    }
                }
            }
        },
        secrets: {
            telegram_bot_token: 'telegram-key'
        }
    });

    assert.deepEqual(
        __testUtils.resolveEnabledChannels(runtime, 'critical', 'shop_inventory_empty', {
            now: new Date('2026-03-27T10:00:00.000Z')
        }),
        ['telegram']
    );
});

test('sendEmailAlert uses Resend with recipients, sender, and severity subject', async () => {
    let request = null;
    const result = await __testUtils.sendEmailAlert({
        alert_type: 'payment_gateway_degraded',
        severity: 'critical',
        title: '虎皮椒 支付通道异常波动（CN）',
        content: '支付通道异常'
    }, {
        config: normalizeOpsAlertsConfig({
            channels: {
                email: {
                    enabled: true,
                    minimum_severity: 'warning',
                    recipients: ['ops@example.com', 'owner@example.com'],
                    from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>',
                    reply_to: 'owner@zaoyoe.com',
                    subject_prefix: '[Zaoyoe告警]'
                }
            }
        }),
        secrets: {
            email_api_key: 're_email_key'
        }
    }, {
        fetchImpl: async (url, options) => {
            request = { url, options };
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({ id: 'email_123' });
                }
            };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.options.headers.Authorization, 'Bearer re_email_key');
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.to, ['ops@example.com', 'owner@example.com']);
    assert.equal(body.from, 'Zaoyoe Ops <alerts@zaoyoe.com>');
    assert.equal(body.reply_to, 'owner@zaoyoe.com');
    assert.match(body.subject, /\[Zaoyoe告警\] \[CN站\] \[CRITICAL\] 虎皮椒 支付通道异常波动（CN）/);
});

test('sweepOpsAlertJobs can deliver email-only queued alerts', async () => {
    const state = {
        jobs: [
            {
                id: 'job-email-1',
                alert_type: 'verify_quota_low',
                severity: 'warning',
                title: '验证额度不足',
                content: '验证额度不足',
                payload: {},
                status: 'pending',
                channels: ['email'],
                remaining_channels: ['email'],
                attempt_count: 0,
                max_attempts: 3,
                next_retry_at: new Date(Date.now() - 1000).toISOString(),
                created_at: new Date(Date.now() - 2000).toISOString()
            }
        ],
        attempts: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createRuntimeConfig({
        config: {
            channels: {
                telegram: { enabled: false },
                feishu: { enabled: false },
                email: {
                    enabled: true,
                    minimum_severity: 'warning',
                    recipients: ['ops@example.com'],
                    from_address: 'Zaoyoe Ops <alerts@zaoyoe.com>'
                }
            }
        },
        secrets: {
            telegram_bot_token: '',
            feishu_webhook_url: '',
            email_api_key: 're_email_key'
        }
    });

    const result = await sweepOpsAlertJobs(supabase, {
        runtime,
        fetchImpl: async (url) => ({
            ok: url === 'https://api.resend.com/emails',
            status: 200,
            async text() {
                return '{"id":"email_123"}';
            }
        })
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.delivered, 1);
    assert.equal(result.retried, 0);
    assert.equal(state.jobs[0].status, 'delivered');
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].channel, 'email');
    assert.equal(state.attempts[0].status, 'delivered');
});
