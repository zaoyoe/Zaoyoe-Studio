const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const {
    __testUtils,
    enqueueOpsAlertJob,
    normalizeOpsAlertsConfig,
    sendFeishuAlert,
    sweepOpsAlertJobs
} = require('../api/_lib/ops-alerts');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        limit: null,
        payload: null,
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

    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }

    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') return row[column] === value;
        if (op === 'in') return value.includes(row[column]);
        if (op === 'gte') return compareValue(row[column], value) >= 0;
        if (op === 'lte') return compareValue(row[column], value) <= 0;
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

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'system_config' && query.mode === 'select') {
                    let rows = applyFilters(systemConfig, query.filters);
                    rows = sortRows(rows, query.order);
                    if (Number.isFinite(query.limit) && query.limit >= 0) {
                        rows = rows.slice(0, query.limit);
                    }
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    let rows = applyFilters(jobs, query.filters);
                    rows = sortRows(rows, query.order);
                    if (Number.isFinite(query.limit) && query.limit >= 0) {
                        rows = rows.slice(0, query.limit);
                    }
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: null
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
                }
            },
            ...overrides.config
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.example/hook',
            ...overrides.secrets
        }
    };
}

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

test('ops alerts exports sendFeishuAlert for admin preview actions', () => {
    assert.equal(typeof sendFeishuAlert, 'function');
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
            OPS_ALERTS_FEISHU_WEBHOOK_URL: 'https://open.feishu.example/hook'
        });

        assert.equal(runtime.secrets.telegram_bot_token, 'telegram-token-from-env');
        assert.equal(runtime.secrets.telegram_bot_token_source, 'environment');
        assert.equal(runtime.secrets.feishu_webhook_url, 'https://open.feishu.example/hook');
        assert.equal(runtime.secrets.feishu_webhook_url_source, 'environment');
    });
});
