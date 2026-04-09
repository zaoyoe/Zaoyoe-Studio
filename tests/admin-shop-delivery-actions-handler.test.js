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

function createTableBuilder(state, table) {
    const operations = [];
    let operationType = 'select';
    let payloadValue = null;

    function finalize(mode) {
        state.queryCalls.push({ table, operations: [...operations], mode, operationType, payload: payloadValue });

        if (operationType === 'update') {
            const queue = state.updateResults[table] || [];
            return Promise.resolve(queue.length ? queue.shift() : { data: [], error: null });
        }

        if (operationType === 'insert') {
            const queue = state.insertResults[table] || [];
            return Promise.resolve(queue.length ? queue.shift() : { data: [], error: null });
        }

        const queue = state.selectResults[table] || [];
        return Promise.resolve(queue.length ? queue.shift() : { data: null, error: null });
    }

    const builder = {
        select(columns) {
            operations.push({ method: 'select', args: [columns] });
            operationType = 'select';
            return builder;
        },
        update(payload) {
            operations.push({ method: 'update', args: [payload] });
            operationType = 'update';
            payloadValue = payload;
            state.updates.push({ table, payload });
            return builder;
        },
        insert(payload) {
            operations.push({ method: 'insert', args: [payload] });
            operationType = 'insert';
            payloadValue = payload;
            state.inserts.push({ table, payload });
            return builder;
        },
        eq(column, value) {
            operations.push({ method: 'eq', args: [column, value] });
            return builder;
        },
        single() {
            operations.push({ method: 'single', args: [] });
            return finalize('single');
        },
        then(resolve, reject) {
            return finalize('then').then(resolve, reject);
        }
    };

    return builder;
}

async function withDeliveryActionsHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/delivery-actions.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        queryCalls: [],
        updates: [],
        inserts: [],
        auditCalls: [],
        requestBody: {},
        selectResults: {},
        updateResults: {},
        insertResults: {},
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async parseJsonBody() {
                    return state.requestBody;
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: {
                            from(table) {
                                return createTableBuilder(state, table);
                            }
                        },
                        user: { id: 'admin_1', email: 'ops@example.com' }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(payload) {
                    state.auditCalls.push(payload);
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

test('shop delivery actions handler rejects non-POST methods', async () => {
    await withDeliveryActionsHandler({}, async ({ handler }) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('shop delivery actions handler replays a task and updates order state', async () => {
    await withDeliveryActionsHandler({
        requestBody: {
            taskId: 'task_1',
            action: 'replay',
            note: '人工补单'
        },
        selectResults: {
            shop_webhook_tasks: [{
                data: {
                    id: 'task_1',
                    order_id: 'ord_1',
                    status: 'dead_letter',
                    attempt_count: 4,
                    max_attempts: 5,
                    last_error: 'Webhook timeout',
                    last_response_status: 504,
                    last_response_body: 'timeout',
                    manual_replay_count: 1,
                    executed_at: null,
                    target_url: 'https://vendor.example.com/deliver',
                    locked_at: null,
                    lock_expires_at: null,
                    lock_token: null,
                    worker_name: null,
                    reservation_acquired_at: null,
                    reservation_lock_token: null,
                    reservation_worker_name: null,
                    target_key: 'user:buyer@example.com',
                    channel_key: 'vendor:example',
                    conflict_count: 0,
                    last_conflict_at: null,
                    last_conflict_reason: null,
                    last_conflict_scope: null,
                    last_conflict_note: null,
                    updated_at: '2026-04-03T03:00:00.000Z'
                },
                error: null
            }]
        }
    }, async ({ handler, state }) => {
        const req = { method: 'POST', headers: {}, url: '/api/admin?route=shop/delivery-actions' };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.action, 'replay');
        assert.equal(payload.status, 'pending');
        assert.equal(
            state.updates.some((entry) => entry.table === 'shop_webhook_tasks' && entry.payload.manual_replay_count === 2),
            true,
            'replay should increment manual replay count on the task'
        );
        assert.equal(
            state.updates.some((entry) => entry.table === 'shop_orders' && entry.payload.delivery_status === 'pending'),
            true,
            'replay should restore the order into a pending delivery state'
        );
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0]?.actionType, 'shop.delivery.replay');
    });
});

test('shop delivery actions handler force-unlocks a task and records conflict audit context', async () => {
    await withDeliveryActionsHandler({
        requestBody: {
            taskId: 'task_force',
            action: 'force_unlock',
            note: 'worker 卡住'
        },
        selectResults: {
            shop_webhook_tasks: [{
                data: {
                    id: 'task_force',
                    order_id: 'ord_force',
                    status: 'processing',
                    attempt_count: 2,
                    max_attempts: 5,
                    last_error: null,
                    last_response_status: null,
                    last_response_body: null,
                    manual_replay_count: 0,
                    executed_at: null,
                    target_url: 'https://vendor.example.com/deliver',
                    locked_at: '2026-04-03T03:00:00.000Z',
                    lock_expires_at: '2026-04-03T03:05:00.000Z',
                    lock_token: 'lock_1',
                    worker_name: 'worker-zombie',
                    reservation_acquired_at: '2026-04-03T03:00:00.000Z',
                    reservation_lock_token: 'lock_1',
                    reservation_worker_name: 'worker-zombie',
                    target_key: 'user:buyer@example.com',
                    channel_key: 'vendor:example',
                    conflict_count: 1,
                    last_conflict_at: null,
                    last_conflict_reason: null,
                    last_conflict_scope: null,
                    last_conflict_note: null,
                    updated_at: '2026-04-03T03:01:00.000Z'
                },
                error: null
            }]
        }
    }, async ({ handler, state }) => {
        const req = { method: 'POST', headers: {}, url: '/api/admin?route=shop/delivery-actions' };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.status, 'retry_waiting');
        assert.equal(
            state.updates.some((entry) => entry.table === 'shop_webhook_tasks' && entry.payload.last_conflict_scope === 'manual'),
            true,
            'force unlock should mark the task with a manual conflict scope'
        );
        assert.equal(
            state.inserts.some((entry) => entry.table === 'shop_webhook_task_conflicts'),
            true,
            'force unlock should append a conflict audit record'
        );
        assert.equal(state.auditCalls[0]?.actionType, 'shop.delivery.force_unlock');
    });
});
