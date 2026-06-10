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
        cases: [],
        legacyCases: [],
        events: [],
        notifications: [],
        auditLogs: [],
        tableErrors: {},
        upsertErrorsByTarget: {},
        silentUpsertDropsByTarget: {},
        bulkUpsertCalls: 0,
        ...overrides
    };
}

function createSupabaseStub(state) {
    return {
        from(table) {
            if (!['ops_alert_cases', 'ops_alert_case_events', 'shop_risk_cases'].includes(table)) {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                mode: 'select',
                filters: [],
                payload: null,
                payloads: null,
                maybeSingle: false,
                single: false
            };

            function applyFilters(rows) {
                return rows.filter((row) => queryState.filters.every(({ op = 'eq', column, value }) => {
                    const rowValue = column === 'site' && !row[column] ? 'cn' : row[column];
                    if (op === 'in') {
                        return Array.isArray(value) ? value.includes(rowValue) : false;
                    }
                    return rowValue === value;
                }));
            }

            function execute() {
                const tableError = state.tableErrors?.[table] || null;
                if (tableError) {
                    return {
                        data: queryState.maybeSingle ? null : [],
                        error: tableError
                    };
                }

                if (queryState.mode === 'select') {
                    const sourceRows = table === 'ops_alert_case_events'
                        ? (state.events || [])
                        : table === 'shop_risk_cases'
                            ? (state.legacyCases || [])
                            : (state.cases || []);
                    const rows = applyFilters(sourceRows);
                    return {
                        data: queryState.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (queryState.mode === 'upsert') {
                    const payloads = Array.isArray(queryState.payload)
                        ? queryState.payload.map((payload) => ({ ...(payload || {}) }))
                        : [{ ...(queryState.payload || {}) }];
                    if (Array.isArray(queryState.payload)) {
                        state.bulkUpsertCalls += 1;
                    }
                    const upsertError = payloads
                        .map((payload) => state.upsertErrorsByTarget?.[payload.target_id] || null)
                        .find(Boolean) || null;
                    if (upsertError) {
                        return {
                            data: queryState.single ? null : [],
                            error: upsertError
                        };
                    }
                    const targetRows = table === 'shop_risk_cases'
                        ? (state.legacyCases || [])
                        : (state.cases || []);
                    const rows = payloads.map((payload) => {
                        if (state.silentUpsertDropsByTarget?.[payload.target_id]) {
                            return null;
                        }
                        const existingIndex = targetRows.findIndex((row) => (
                            table === 'shop_risk_cases'
                                ? row.target_id === payload.target_id
                                : (
                                    String(row.site || 'cn').trim().toLowerCase() === String(payload.site || 'cn').trim().toLowerCase()
                                    && row.category_key === payload.category_key
                                    && row.target_id === payload.target_id
                                )
                        ));
                        const nextRow = existingIndex >= 0
                            ? {
                                ...targetRows[existingIndex],
                                ...payload
                            }
                            : {
                                id: payload.id || `${table === 'shop_risk_cases' ? 'legacy-case' : 'case'}-${targetRows.length + 1}`,
                                created_at: payload.created_at || new Date().toISOString(),
                                ...payload
                            };

                        if (!nextRow.updated_at) {
                            nextRow.updated_at = new Date().toISOString();
                        }

                        if (existingIndex >= 0) {
                            targetRows[existingIndex] = nextRow;
                        } else {
                            targetRows.push(nextRow);
                        }
                        return nextRow;
                    }).filter(Boolean);

                    return {
                        data: queryState.single ? rows[0] : rows,
                        error: null
                    };
                }

                if (queryState.mode === 'insert') {
                    const payloads = Array.isArray(queryState.payloads) ? queryState.payloads : [];
                    const rows = payloads.map((payload, index) => {
                        const nextRow = {
                            id: payload.id || `event-${state.events.length + index + 1}`,
                            created_at: payload.created_at || new Date().toISOString(),
                            ...payload
                        };
                        state.events.push(nextRow);
                        return nextRow;
                    });
                    return {
                        data: rows,
                        error: null
                    };
                }

                throw new Error(`Unsupported mode: ${queryState.mode}`);
            }

            const query = {
                select() {
                    return query;
                },
                eq(column, value) {
                    queryState.filters.push({ op: 'eq', column, value });
                    return query;
                },
                in(column, value) {
                    queryState.filters.push({ op: 'in', column, value });
                    return query;
                },
                maybeSingle() {
                    queryState.maybeSingle = true;
                    return query;
                },
                upsert(payload) {
                    queryState.mode = 'upsert';
                    queryState.payload = payload;
                    return query;
                },
                insert(payload) {
                    queryState.mode = 'insert';
                    queryState.payloads = Array.isArray(payload) ? payload : [payload];
                    return query;
                },
                single() {
                    queryState.single = true;
                    return query;
                },
                then(resolve, reject) {
                    return Promise.resolve(execute()).then(resolve, reject);
                },
                catch(reject) {
                    return query.then(undefined, reject);
                }
            };

            return query;
        }
    };
}

function createAdminModule(state) {
    return {
        async requireAdmin() {
            return {
                supabase: createSupabaseStub(state),
                user: state.user
            };
        },
        async parseJsonBody(req) {
            return req.body || {};
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        },
        async writeAdminAuditLog(entry) {
            state.auditLogs.push(entry);
        }
    };
}

function createAdminNotificationsModule(state) {
    return {
        async notifyUsers(_supabase, payload = {}) {
            const rows = (Array.isArray(payload.userIds) ? payload.userIds : [])
                .map((userId, index) => ({
                    id: `notification-${state.notifications.length + index + 1}`,
                    user_id: userId,
                    title: payload.title,
                    content: payload.content,
                    type: payload.type,
                    scope: payload.scope,
                    category: payload.category
                }));
            state.notifications.push(...rows);
            return {
                recipients: rows.length,
                created: rows.length,
                skipped: 0
            };
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/ops-alert-monitor-cases.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule(state);
        }
        if (request === '../../../../api/_lib/admin-notifications') {
            return createAdminNotificationsModule(state);
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

test('ops alert case handler claims a shop risk case and writes legacy-compatible audit log', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'claim',
                target_id: 'shop_order_risk:coupon:FLASH0'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.case.category_key, 'shop_risk');
        assert.equal(payload.case.status, 'claimed');
        assert.equal(payload.case.owner_admin_id, 'admin-user-1');
        assert.equal(payload.case.owner_label, 'admin@example.com');
        assert.equal(state.cases.length, 1);
        assert.equal(state.events.length, 1);
        assert.equal(state.events[0].action, 'claim');
        assert.equal(state.events[0].owner_admin_id, 'admin-user-1');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.shop_risk_case.claim');
    });
});

test('ops alert case handler falls back to legacy shop_risk_cases when ops_alert_cases is missing from schema cache', async () => {
    await withHandler({
        tableErrors: {
            ops_alert_cases: {
                code: 'PGRST205',
                message: "Could not find the table 'public.ops_alert_cases' in the schema cache"
            }
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'claim',
                target_id: 'shop_order_risk:coupon:FLASH0'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.case.category_key, 'shop_risk');
        assert.equal(payload.case.status, 'claimed');
        assert.equal(state.cases.length, 0);
        assert.equal(state.legacyCases.length, 1);
        assert.equal(state.legacyCases[0].target_id, 'shop_order_risk:coupon:FLASH0');
        assert.equal(state.events.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.shop_risk_case.claim');
    });
});

test('ops alert case handler requires resolution content when resolving a case', async () => {
    await withHandler({}, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                category_key: 'payments',
                target_id: 'payment_gateway:hupijiao:cn'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.message, '关闭告警时需要填写处理结论');
    });
});

test('ops alert case handler returns a friendly migration message for generic cases when ops_alert_cases is missing', async () => {
    await withHandler({
        tableErrors: {
            ops_alert_cases: {
                code: 'PGRST205',
                message: "Could not find the table 'public.ops_alert_cases' in the schema cache"
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'claim',
                category_key: 'payments',
                target_id: 'payment_gateway:hupijiao:cn'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 503);
        assert.equal(payload.success, false);
        assert.equal(payload.message, '集中告警处置表尚未完成迁移，请先执行最新数据库迁移后再试');
    });
});

test('ops alert case handler resolves an existing case while preserving owner information', async () => {
    await withHandler({
        cases: [
            {
                id: 'case-1',
                site: 'cn',
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:FLASH0',
                alert_type: 'shop_order_risk_anomaly',
                status: 'claimed',
                owner_admin_id: 'admin-user-2',
                owner_label: 'ops@example.com',
                note: '已接手',
                resolution: null,
                metadata: { from: 'test' },
                last_action: 'claimed',
                last_action_by: 'admin-user-2',
                last_action_at: '2026-03-27T08:00:00.000Z',
                created_at: '2026-03-27T07:59:00.000Z',
                updated_at: '2026-03-27T08:00:00.000Z'
            }
        ]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                target_id: 'shop_order_risk:coupon:FLASH0',
                note: '已停用优惠码并完成订单复核。'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.case.status, 'resolved');
        assert.equal(payload.case.owner_admin_id, 'admin-user-2');
        assert.equal(payload.case.owner_label, 'ops@example.com');
        assert.equal(payload.case.resolution, '已停用优惠码并完成订单复核。');
        assert.equal(state.cases[0].status, 'resolved');
        assert.equal(state.events.length, 1);
        assert.equal(state.events[0].action, 'resolve');
        assert.equal(state.events[0].resolution, '已停用优惠码并完成订单复核。');
        assert.equal(state.auditLogs[0].actionType, 'admin.shop_risk_case.resolve');
    });
});

test('ops alert case handler accepts resolution content without a separate note when resolving', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                category_key: 'payments',
                target_id: 'payment_gateway:hupijiao:cn',
                alert_type: 'payment_gateway_degraded',
                title: '支付通道异常',
                resolution: '已确认通道恢复，关闭本次告警。'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.case.status, 'resolved');
        assert.equal(payload.case.resolution, '已确认通道恢复，关闭本次告警。');
        assert.equal(state.cases[0].resolution, '已确认通道恢复，关闭本次告警。');
        assert.equal(state.events[0].resolution, '已确认通道恢复，关闭本次告警。');
    });
});

test('ops alert case handler supports batch claim for generic monitor items', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'claim',
                items: [
                    {
                        category_key: 'payments',
                        target_id: 'payment_gateway:hupijiao:cn',
                        alert_type: 'payment_gateway_degraded',
                        title: '支付通道异常'
                    },
                    {
                        category_key: 'inventory',
                        target_id: 'shop_inventory:product-a',
                        alert_type: 'shop_inventory_low',
                        title: '库存偏低'
                    }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.processed_count, 2);
        assert.equal(payload.cases.length, 2);
        assert.equal(state.cases.length, 2);
        assert.equal(state.cases[0].status, 'claimed');
        assert.equal(state.cases[1].status, 'claimed');
        assert.equal(state.events.length, 2);
        assert.equal(state.events[0].action, 'claim');
        assert.equal(state.events[1].action, 'claim');
        assert.equal(state.bulkUpsertCalls, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alert_case.batch.claim');
    });
});

test('ops alert case handler keeps batch resolve successes when one item fails', async () => {
    await withHandler({
        upsertErrorsByTarget: {
            'shop_inventory:broken-product': {
                code: '23514',
                message: 'simulated item failure'
            }
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                resolution: '已完成批量复核。',
                items: [
                    {
                        category_key: 'inventory',
                        target_id: 'shop_inventory:product-a',
                        alert_type: 'shop_inventory_low',
                        title: '库存偏低'
                    },
                    {
                        category_key: 'inventory',
                        target_id: 'shop_inventory:broken-product',
                        alert_type: 'shop_inventory_low',
                        title: '库存写入失败'
                    }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.processed_count, 1);
        assert.equal(payload.summary.failed_count, 1);
        assert.match(payload.message, /另有 1 条未完成/);
        assert.equal(state.cases.length, 1);
        assert.equal(state.cases[0].target_id, 'shop_inventory:product-a');
        assert.equal(state.cases[0].status, 'resolved');
        assert.equal(state.events.length, 1);
        assert.equal(payload.failed[0].target_id, 'shop_inventory:broken-product');
    });
});

test('ops alert case handler does not report batch resolve success when rows are not persisted', async () => {
    await withHandler({
        silentUpsertDropsByTarget: {
            'shop_inventory:product-a': true,
            'shop_inventory:product-b': true
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                resolution: '已完成批量复核。',
                items: [
                    {
                        category_key: 'inventory',
                        target_id: 'shop_inventory:product-a',
                        alert_type: 'shop_inventory_low',
                        title: '库存偏低'
                    },
                    {
                        category_key: 'inventory',
                        target_id: 'shop_inventory:product-b',
                        alert_type: 'shop_inventory_empty',
                        title: '库存售罄'
                    }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 500);
        assert.equal(payload.success, false);
        assert.equal(payload.summary.processed_count, 0);
        assert.equal(payload.summary.failed_count, 2);
        assert.equal(state.cases.length, 0);
        assert.equal(state.events.length, 0);
        assert.equal(state.bulkUpsertCalls, 1);
        assert.equal(payload.failed.every((item) => item.reason === 'case_not_persisted'), true);
    });
});

test('ops alert case handler resolves batch items using each alert case site', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                metadata: {
                    site: 'all'
                },
                resolution: '已批量处理，关闭当前筛选告警。',
                items: [
                    {
                        category_key: 'inventory',
                        target_id: 'ops_summary:shop_inventory_summary',
                        case_site: 'cn',
                        title: '库存与补货汇总',
                        alert_job_id: 'inventory-summary-cn-job',
                        alert_created_at: '2026-06-10T12:12:19.000Z',
                        summary_window_start_at: '2026-06-10T12:00:00.000Z',
                        summary_window_end_at: '2026-06-10T13:00:00.000Z'
                    },
                    {
                        category_key: 'inventory',
                        target_id: 'ops_summary:shop_inventory_summary',
                        caseSite: 'intl',
                        title: '库存与补货汇总',
                        alert_job_id: 'inventory-summary-intl-job',
                        alert_created_at: '2026-06-10T12:16:30.000Z',
                        summary_window_start_at: '2026-06-10T12:00:00.000Z',
                        summary_window_end_at: '2026-06-10T13:00:00.000Z'
                    }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.processed_count, 2);
        assert.equal(state.cases.length, 2);

        const cnCase = state.cases.find((item) => item.site === 'cn');
        const intlCase = state.cases.find((item) => item.site === 'intl');
        assert.equal(cnCase?.status, 'resolved');
        assert.equal(intlCase?.status, 'resolved');
        assert.equal(cnCase?.target_id, 'ops_summary:shop_inventory_summary');
        assert.equal(intlCase?.target_id, 'ops_summary:shop_inventory_summary');
        assert.equal(cnCase?.metadata.alert_job_id, 'inventory-summary-cn-job');
        assert.equal(cnCase?.metadata.alert_created_at, '2026-06-10T12:12:19.000Z');
        assert.equal(cnCase?.metadata.summary_window_start_at, '2026-06-10T12:00:00.000Z');
        assert.equal(cnCase?.metadata.summary_window_end_at, '2026-06-10T13:00:00.000Z');
        assert.equal(cnCase?.metadata.resolved_alert_job_id, 'inventory-summary-cn-job');
        assert.equal(cnCase?.metadata.resolved_alert_created_at, '2026-06-10T12:12:19.000Z');
        assert.equal(cnCase?.metadata.resolved_summary_window_start_at, '2026-06-10T12:00:00.000Z');
        assert.equal(cnCase?.metadata.resolved_summary_window_end_at, '2026-06-10T13:00:00.000Z');
        assert.equal(intlCase?.metadata.resolved_alert_job_id, 'inventory-summary-intl-job');
        assert.equal(intlCase?.metadata.resolved_alert_created_at, '2026-06-10T12:16:30.000Z');
        assert.equal(intlCase?.metadata.resolved_summary_window_end_at, '2026-06-10T13:00:00.000Z');
        assert.equal(state.cases.some((item) => item.site === 'all'), false);
        assert.equal(state.bulkUpsertCalls, 1);
        assert.equal(state.events.length, 2);
        assert.deepEqual(state.events.map((item) => item.site).sort(), ['cn', 'intl']);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alert_case.batch.resolve');
    });
});

test('ops alert case handler sends an admin personal reminder when assigning to another admin', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'assign',
                category_key: 'payments',
                target_id: 'payment_gateway:hupijiao:cn',
                alert_type: 'payment_gateway_degraded',
                title: '支付通道异常',
                reference_label: '通道',
                reference_value: '虎皮椒',
                owner_admin_id: 'admin-user-2',
                owner_label: 'owner@example.com',
                note: '辛苦接手继续排查'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.case.owner_admin_id, 'admin-user-2');
        assert.equal(state.notifications.length, 1);
        assert.equal(state.notifications[0].user_id, 'admin-user-2');
        assert.equal(state.notifications[0].scope, 'admin_personal');
        assert.equal(state.notifications[0].category, 'assignment');
        assert.match(state.notifications[0].title, /站内代办已转交给你/);
        assert.match(state.notifications[0].content, /admin@example.com 刚刚给你转交了 1 条站内代办/);
        assert.match(state.notifications[0].content, /处理入口：客服消息 -> 站内代办/);
        assert.equal(payload.summary.assignment_notification_created, 1);
        assert.equal(state.auditLogs[0].details.assignment_notification_created, 1);
    });
});
