const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
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

function hasOperation(operations, method, column = null) {
    return operations.some((operation) => (
        operation.method === method
        && (column === null || operation.args?.[0] === column)
    ));
}

function getEqValue(operations, column) {
    const matched = operations.find((operation) => operation.method === 'eq' && operation.args?.[0] === column);
    return matched ? matched.args?.[1] : undefined;
}

function getInValue(operations, column) {
    const matched = operations.find((operation) => operation.method === 'in' && operation.args?.[0] === column);
    return matched ? matched.args?.[1] : undefined;
}

function createQueryBuilder(state, table) {
    const operations = [];

    function finalize(mode) {
        state.queryCalls.push({ table, operations: [...operations], mode });
        return Promise.resolve(state.resolveQuery(table, operations, mode));
    }

    const builder = {
        select(columns, options) {
            operations.push({ method: 'select', args: [columns, options] });
            return builder;
        },
        eq(column, value) {
            operations.push({ method: 'eq', args: [column, value] });
            return builder;
        },
        in(column, values) {
            operations.push({ method: 'in', args: [column, values] });
            return builder;
        },
        gt(column, value) {
            operations.push({ method: 'gt', args: [column, value] });
            return builder;
        },
        gte(column, value) {
            operations.push({ method: 'gte', args: [column, value] });
            return builder;
        },
        lte(column, value) {
            operations.push({ method: 'lte', args: [column, value] });
            return builder;
        },
        not(column, operator, value) {
            operations.push({ method: 'not', args: [column, operator, value] });
            return builder;
        },
        is(column, value) {
            operations.push({ method: 'is', args: [column, value] });
            return builder;
        },
        or(expression) {
            operations.push({ method: 'or', args: [expression] });
            return builder;
        },
        order(column, options) {
            operations.push({ method: 'order', args: [column, options] });
            return builder;
        },
        range(from, to) {
            operations.push({ method: 'range', args: [from, to] });
            return finalize('range');
        },
        limit(value) {
            operations.push({ method: 'limit', args: [value] });
            return finalize('limit');
        },
        then(resolve, reject) {
            return finalize('then').then(resolve, reject);
        }
    };

    return builder;
}

async function withDeliveryTasksHandler(callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/delivery-tasks.js');
    const originalLoad = Module._load;
    const nowIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const state = {
        requireAdminCalls: [],
        queryCalls: [],
        resolveQuery(table, operations, mode) {
            const taskMain = {
                id: 'task_pending',
                order_id: 'ord_1',
                status: 'pending',
                attempt_count: 0,
                max_attempts: 5,
                created_at: '2026-04-03T01:00:00.000Z',
                updated_at: '2026-04-03T01:00:00.000Z'
            };
            const taskDead = {
                id: 'task_dead',
                order_id: 'ord_2',
                status: 'dead_letter',
                attempt_count: 4,
                max_attempts: 5,
                last_error: 'Gateway Timeout',
                last_response_status: 504,
                conflict_count: 1,
                last_conflict_reason: 'channel_max_inflight',
                dead_lettered_at: '2026-04-03T03:00:00.000Z',
                created_at: '2026-04-03T02:00:00.000Z',
                updated_at: '2026-04-03T03:00:00.000Z'
            };
            const taskLock = {
                id: 'task_lock',
                order_id: 'ord_3',
                status: 'processing',
                attempt_count: 1,
                max_attempts: 5,
                lock_token: 'lock_active',
                lock_expires_at: nowIso,
                worker_name: 'worker-a',
                reservation_acquired_at: '2026-04-03T02:55:00.000Z',
                reservation_lock_token: 'lock_active',
                reservation_worker_name: 'worker-a',
                created_at: '2026-04-03T02:50:00.000Z',
                updated_at: '2026-04-03T02:59:00.000Z'
            };
            const conflictRecord = {
                id: 'conflict_1',
                task_id: 'task_dead',
                order_id: 'ord_2',
                scope: 'channel',
                reason_key: 'channel_max_inflight',
                target_key: 'user:buyer@example.com',
                channel_key: 'vendor:example',
                worker_name: 'worker-a',
                lock_token: null,
                task_status: 'dead_letter',
                next_attempt_at: null,
                created_at: '2026-04-03T03:00:00.000Z'
            };

            if (table === 'admin_audit_logs_view') {
                return { data: [], count: 0, error: null };
            }

            if (table === 'shop_webhook_task_conflicts') {
                return { data: [conflictRecord], error: null };
            }

            if (table === 'shop_webhook_tasks') {
                const selectOptions = operations.find((operation) => operation.method === 'select')?.args?.[1] || {};
                const status = getEqValue(operations, 'status');
                const statusIn = getInValue(operations, 'status');
                const orderIds = getInValue(operations, 'order_id');
                let taskRows = [taskMain, taskDead, taskLock];
                if (Array.isArray(orderIds)) {
                    taskRows = taskRows.filter((task) => orderIds.includes(task.order_id));
                }

                if (selectOptions?.head && status) {
                    const count = taskRows.filter((task) => task.status === status).length;
                    const countMap = {
                        pending: 1,
                        processing: 1,
                        retry_waiting: 0,
                        requeued: 0,
                        dead_letter: 1,
                        delivered: 0
                    };
                    return { data: null, count: Array.isArray(orderIds) ? count : countMap[status] || 0, error: null };
                }

                if (selectOptions?.head && hasOperation(operations, 'gt', 'manual_replay_count')) {
                    return { data: null, count: 0, error: null };
                }

                if (selectOptions?.head && hasOperation(operations, 'gt', 'conflict_count')) {
                    return { data: null, count: 1, error: null };
                }

                if (selectOptions?.head && hasOperation(operations, 'gt', 'lock_expires_at')) {
                    return { data: null, count: 1, error: null };
                }

                if (selectOptions?.head && hasOperation(operations, 'lte', 'lock_expires_at')) {
                    return { data: null, count: 0, error: null };
                }

                if (selectOptions?.head && hasOperation(operations, 'is', 'lock_token')) {
                    return { data: null, count: 0, error: null };
                }

                if (hasOperation(operations, 'not', 'reservation_acquired_at')) {
                    return { data: taskRows.filter((task) => task.id === 'task_lock'), error: null };
                }

                if (hasOperation(operations, 'in', 'id')) {
                    return {
                        data: taskRows.filter((task) => operations.find((operation) => operation.method === 'in' && operation.args?.[0] === 'id')?.args?.[1]?.includes(task.id)),
                        error: null
                    };
                }

                if (Array.isArray(statusIn)) {
                    const filtered = taskRows.filter((task) => statusIn.includes(task.status));
                    if (mode === 'range') {
                        return { data: filtered, count: filtered.length, error: null };
                    }
                    return { data: filtered, error: null };
                }

                if (status === 'dead_letter') {
                    const filtered = taskRows.filter((task) => task.status === 'dead_letter');
                    if (mode === 'range') {
                        return { data: filtered, count: filtered.length, error: null };
                    }
                    return { data: filtered, error: null };
                }

                if (status === 'processing') {
                    const filtered = taskRows.filter((task) => task.status === 'processing');
                    if (mode === 'range') {
                        return { data: filtered, count: filtered.length, error: null };
                    }
                    return { data: filtered, error: null };
                }

                if (mode === 'range') {
                    return { data: taskRows.filter((task) => task.id === 'task_pending'), count: taskRows.filter((task) => task.id === 'task_pending').length, error: null };
                }

                return { data: [], error: null };
            }

            if (table === 'shop_orders') {
                const sourceChannel = getEqValue(operations, 'source_channel');
                const channelAccountKey = getEqValue(operations, 'channel_account_key');
                const idFilter = getInValue(operations, 'id');
                let rows = [
                    {
                        id: 'ord_1',
                        user_id: 'user_1',
                        snapshot_product_name: 'Season Pass',
                        price_paid: 49,
                        total_price: 49,
                        delivery_status: 'pending',
                        source_channel: 'website',
                        channel_account_key: 'main',
                        external_order_id: '',
                        created_at: '2026-04-03T01:00:00.000Z',
                        item_count: 1,
                        refund_status: 'none'
                    },
                    {
                        id: 'ord_2',
                        user_id: 'user_2',
                        snapshot_product_name: 'Prompt Pack',
                        price_paid: 99,
                        total_price: 99,
                        delivery_status: 'dead_letter',
                        source_channel: 'xianyu',
                        channel_account_key: 'main',
                        external_order_id: 'XY-1002',
                        created_at: '2026-04-03T02:00:00.000Z',
                        item_count: 1,
                        refund_status: 'none'
                    },
                    {
                        id: 'ord_3',
                        user_id: 'user_3',
                        snapshot_product_name: 'API Product',
                        price_paid: 19,
                        total_price: 19,
                        delivery_status: 'processing',
                        source_channel: 'xianyu',
                        channel_account_key: 'backup-1',
                        external_order_id: 'XY-1003',
                        created_at: '2026-04-03T02:50:00.000Z',
                        item_count: 1,
                        refund_status: 'none'
                    }
                ];
                if (sourceChannel) {
                    rows = rows.filter((row) => row.source_channel === sourceChannel);
                }
                if (channelAccountKey) {
                    rows = rows.filter((row) => row.channel_account_key === channelAccountKey);
                }
                if (Array.isArray(idFilter)) {
                    rows = rows.filter((row) => idFilter.includes(row.id));
                }
                return {
                    data: rows,
                    error: null
                };
            }

            if (table === 'shop_webhook_task_attempts') {
                return {
                    data: [
                        {
                            id: 'attempt_1',
                            task_id: 'task_dead',
                            attempt_no: 4,
                            worker_name: 'worker-a',
                            started_at: '2026-04-03T02:58:00.000Z',
                            finished_at: '2026-04-03T02:58:10.000Z',
                            success: false,
                            response_status: 504,
                            error_message: 'Gateway Timeout',
                            duration_ms: 10000
                        }
                    ],
                    error: null
                };
            }

            return { data: [], count: 0, error: null };
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async parseJsonBody() {
                    return {};
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: {
                            from(table) {
                                return createQueryBuilder(state, table);
                            }
                        },
                        user: { id: 'admin_1', email: 'ops@example.com' }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog() {}
            };
        }

        if (request === '../../../../api/_lib/payments/shop-delivery-strategy') {
            return {
                async loadShopDeliveryStrategyConfig() {
                    return {};
                },
                normalizeShopDeliveryStrategyConfig(value) {
                    return value || {};
                },
                async upsertShopDeliveryStrategyConfig() {
                    return {};
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
    }
}

test('shop delivery tasks handler returns paged task, dead letter, lock, and reservation context', async () => {
    await withDeliveryTasksHandler(async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/delivery-tasks&page=1&pageSize=2&deadLetterPage=1&deadLetterPageSize=2&lockPage=1&lockPageSize=2'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.tasks.length, 1);
        assert.equal(payload.deadLetter.total, 1);
        assert.equal(payload.lockConflicts.total, 1);
        assert.equal(payload.reservations.total, 1);
        assert.equal(payload.tasks[0]?.order?.snapshot_product_name, 'Season Pass');
        assert.equal(payload.deadLetter.tasks[0]?.order?.snapshot_product_name, 'Prompt Pack');
        assert.equal(payload.lockConflicts.tasks[0]?.order?.snapshot_product_name, 'API Product');
        assert.equal(payload.conflicts.records.length, 1);
        assert.equal(state.requireAdminCalls[0]?.options?.permission, 'shop.manage');
    });
});

test('shop delivery tasks handler filters compact recovery tasks by marketplace source channel', async () => {
    await withDeliveryTasksHandler(async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/delivery-tasks&compact=marketplace_recovery&sourceChannel=xianyu&statuses=dead_letter,retry_waiting,requeued,processing&page=1&pageSize=6'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.tasks.length, 2);
        assert.deepEqual(payload.tasks.map((task) => task.order_id).sort(), ['ord_2', 'ord_3']);
        assert.equal(payload.tasks.every((task) => task.order?.source_channel === 'xianyu'), true);
        assert.equal(payload.filters.marketplace.source_channel, 'xianyu');
        assert.equal(payload.filters.marketplace.order_count, 2);
        assert.equal(payload.summary.dead_letter, 1);
        assert.equal(payload.summary.processing, 1);
        assert.equal(
            state.queryCalls.some((entry) => (
                entry.table === 'shop_webhook_tasks'
                && hasOperation(entry.operations, 'in', 'order_id')
            )),
            true
        );
    });
});
