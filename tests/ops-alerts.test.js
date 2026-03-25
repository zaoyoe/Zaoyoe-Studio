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

test('buildExternalAlertText renders payment config changed details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'payment_config_changed',
        severity: 'critical',
        title: '支付配置已变更（admin@example.com）',
        payload: {
            admin_email: 'admin@example.com',
            action_label: '支付通道配置更新',
            active_provider: 'mock',
            active_provider_label: '模拟支付',
            updated_provider_labels: ['模拟支付', '虎皮椒'],
            updated_secrets: ['hupijiao_secret_key'],
            risk_flags: ['当前活动通道已切换为模拟支付', '本次更新包含 1 个支付密钥'],
            created_at: '2026-03-25T10:00:00.000Z',
            entry_path: '后台设置 -> 支付通道配置 / Admin Audit Logs'
        }
    });

    assert.match(text, /支付配置告警/);
    assert.match(text, /操作人：admin@example.com/);
    assert.match(text, /变更类型：支付通道配置更新/);
    assert.match(text, /当前生效通道：模拟支付/);
    assert.match(text, /启用通道：模拟支付、虎皮椒/);
    assert.match(text, /更新密钥：hupijiao_secret_key/);
    assert.match(text, /风险提示：当前活动通道已切换为模拟支付；本次更新包含 1 个支付密钥/);
    assert.match(text, /处理入口：后台设置 -> 支付通道配置 \/ Admin Audit Logs/);
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
    assert.match(text, /上次异常：2026-03-25T09:30:00.000Z/);
    assert.match(text, /恢复时间：2026-03-25T09:54:00.000Z/);
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
    assert.match(text, /最近错误：上游验证服务返回 503/);
    assert.match(text, /响应状态：503/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> API Key \/ 接口状态/);
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
            entry_path: '后台设置 -> 验证服务配置 -> 最近任务状态 / 验证日志'
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
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 最近任务状态 \/ 验证日志/);
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
            entry_path: '后台设置 -> 验证服务配置 -> 站外告警 / 最近任务状态 / 验证日志'
        }
    });

    assert.match(text, /验证综合告警/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /API Base：https:\/\/iqless\.icu/);
    assert.match(text, /时间窗：最近 30 分钟/);
    assert.match(text, /升级信号：验证服务停摆、验证失败率飙升、验证任务堆积/);
    assert.match(text, /命中数量：3 类/);
    assert.match(text, /关键摘要：服务不可用 \/ balance_http_503；失败率 77\.78%（7\/9）；排队 18 个 \/ 本地活跃 11 个/);
    assert.match(text, /最近触发：验证服务停摆：2026-03-25T10:00:00.000Z；验证失败率飙升：2026-03-25T10:02:00.000Z；验证任务堆积：2026-03-25T10:04:00.000Z/);
    assert.match(text, /最新时间：2026-03-25T10:04:00.000Z/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 站外告警 \/ 最近任务状态 \/ 验证日志/);
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
            entry_path: '后台设置 -> 验证服务配置 -> 站外告警 / 最近任务状态 / 验证日志'
        }
    });

    assert.match(text, /验证恢复通知/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /API Base：https:\/\/iqless\.icu/);
    assert.match(text, /恢复结论：验证综合高危组合已解除，当前仍保留 1 类低优先级信号/);
    assert.match(text, /上次升级：2026-03-25T10:00:00.000Z/);
    assert.match(text, /恢复时间：2026-03-25T10:18:00.000Z/);
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
            entry_path: '后台设置 -> 验证服务配置 -> 队列 / 最近任务状态'
        }
    });

    assert.match(text, /验证队列告警/);
    assert.match(text, /API Key：primary-key/);
    assert.match(text, /判定信号：上游队列已堆积 18 个任务（阈值 10 个）；最近 30 分钟失败 6 次（阈值 4 次）/);
    assert.match(text, /队列概览：上游排队 18 个 \/ 运行中 4 个 \/ 本地活跃 11 个/);
    assert.match(text, /最老活跃任务：42 分钟/);
    assert.match(text, /热点目标：member1@example\.com × 3、member2@example\.com × 2/);
    assert.match(text, /最近错误：lock_conflict × 4；otp_invalid × 2/);
    assert.match(text, /处理入口：后台设置 -> 验证服务配置 -> 队列 \/ 最近任务状态/);
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
    assert.match(text, /用户ID：demo_ticket_user_001/);
    assert.match(text, /等待时长：3 小时 15 分钟/);
    assert.match(text, /责任人：未分配/);
    assert.match(text, /当前状态：待处理/);
    assert.match(text, /问题描述：卡密未到账，用户已重复反馈仍未处理。/);
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
    assert.match(text, /用户ID：demo_ticket_user_001/);
    assert.match(text, /恢复结论：工单已解决，已退出超时未处理状态/);
    assert.match(text, /上次超时等待：3 小时 15 分钟/);
    assert.match(text, /当前状态：已解决/);
    assert.match(text, /持续时长：42 分钟/);
    assert.match(text, /处理入口：售后工单 -> 已处理 -> 工单详情/);
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

test('buildExternalAlertText renders admin login anomaly details', () => {
    const text = __testUtils.buildExternalAlertText({
        alert_type: 'security_admin_login_anomaly',
        severity: 'critical',
        title: '管理员异常登录（admin@example.com）',
        payload: {
            admin_email: 'admin@example.com',
            client_ip: '203.0.113.88',
            user_agent: 'Mozilla/5.0 Demo Chrome/124',
            occurred_at: '2026-03-25T10:00:00.000Z',
            previous_ips: ['198.51.100.21', '198.51.100.22'],
            recent_distinct_ip_count: 3,
            recent_distinct_user_agent_count: 2,
            detected_reasons: [
                '管理员首次从该 IP 登录后台',
                '最近窗口内出现 3 个登录 IP'
            ],
            origin: 'https://www.zaoyoe.com',
            referer: 'https://www.zaoyoe.com/admin-entry.html',
            entry_path: '后台设置 -> 管理员访问 / Admin Audit Logs'
        }
    });

    assert.match(text, /管理员安全告警/);
    assert.match(text, /管理员：admin@example.com/);
    assert.match(text, /登录 IP：203\.0\.113\.88/);
    assert.match(text, /判定信号：管理员首次从该 IP 登录后台；最近窗口内出现 3 个登录 IP/);
    assert.match(text, /最近窗口内 IP 数：3/);
    assert.match(text, /历史常用 IP：198\.51\.100\.21、198\.51\.100\.22/);
    assert.match(text, /处理入口：后台设置 -> 管理员访问 \/ Admin Audit Logs/);
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
