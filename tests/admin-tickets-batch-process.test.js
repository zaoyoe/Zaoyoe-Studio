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
        user: { id: 'admin-batch-1', email: 'batch@example.com' },
        calls: [],
        failures: {},
        ...overrides
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/batch-process.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin() {
                    return {
                        supabase: {},
                        user: state.user
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        if (request === './process') {
            return {
                async processTicketWithContext(payload) {
                    state.calls.push(payload);
                    const failure = state.failures[payload.ticketId];
                    if (failure) {
                        const error = new Error(failure.message || 'Ticket processing failed');
                        error.statusCode = failure.statusCode;
                        throw error;
                    }

                    return {
                        success: true,
                        ticket: {
                            id: payload.ticketId,
                            status: payload.newStatus
                        }
                    };
                }
            };
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

test('tickets batch process handler processes multiple tickets through the shared ticket helper', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                ticketIds: ['ticket-batch-1', 'ticket-batch-2'],
                newStatus: 'RESOLVED',
                adminReply: '当前问题已统一处理完成',
                internalNote: '批量处理自夜间清队列'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.processedCount, 2);
        assert.equal(payload.skippedCount, 0);
        assert.equal(payload.failedCount, 0);
        assert.equal(state.calls.length, 2);
        assert.equal(state.calls[0].source, 'ticket.batch_process');
        assert.equal(state.calls[0].doRefund, false);
        assert.equal(state.calls[0].adminReply, '当前问题已统一处理完成');
    });
});

test('tickets batch process handler reports skipped and failed tickets separately', async () => {
    await withHandler({
        failures: {
            'ticket-batch-skip': {
                statusCode: 409,
                message: '工单当前状态为已解决，不能重复处理'
            },
            'ticket-batch-fail': {
                statusCode: 500,
                message: '写入通知失败'
            }
        }
    }, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                ticketIds: ['ticket-batch-ok', 'ticket-batch-skip', 'ticket-batch-fail'],
                newStatus: 'REJECTED',
                adminReply: '当前信息不足，请补充后再提交'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.processedCount, 1);
        assert.equal(payload.skippedCount, 1);
        assert.equal(payload.failedCount, 1);
        assert.equal(payload.skipped[0].ticketId, 'ticket-batch-skip');
        assert.equal(payload.failed[0].ticketId, 'ticket-batch-fail');
    });
});
