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

async function withAdminHandler(handlerRelativePath, callback) {
    const handlerPath = path.resolve(__dirname, handlerRelativePath);
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin' || request === '../../../api/_lib/admin') {
            return {
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    const error = new Error('permission probe');
                    error.statusCode = 418;
                    throw error;
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog() {},
                getSupabaseAdmin() {
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

test('shop mutate handler requires shop.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/shop/mutate.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'noop' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('payments cleanup handler requires payments.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/payments/cleanup.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: {}, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'payments.manage' });
    });
});

test('tickets create handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/create.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: {}, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('settings gemini-key handler requires settings.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/settings/gemini-key.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'settings.manage' });
    });
});

test('ops alerts settings handler requires ops_alerts.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/settings/ops-alerts.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'ops_alerts.manage' });
    });
});

test('admin gemini proxy allows either prompts.manage or content.moderate', async () => {
    await withAdminHandler('../server/api-handlers/admin/gemini.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, {
            anyOf: ['prompts.manage', 'content.moderate']
        });
    });
});
