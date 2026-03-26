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

function createAdminModule() {
    return {
        async requireAdmin() {
            return {
                user: { id: 'admin-user-1', email: 'admin@example.com' }
            };
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    };
}

async function withHandler(relativePath, callback) {
    const handlerPath = path.resolve(__dirname, relativePath);
    const originalLoad = Module._load;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule();
        }
        return originalLoad(request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback(handler);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('verify monitor quota proxy forwards upstream quota data', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://zaoyoe-verify-server-production.up.railway.app/api/quota');
        assert.equal(init.headers.Authorization, 'Bearer admin-token');

        return new Response(JSON.stringify({
            success: true,
            balance: 12,
            total_used: 4,
            cost_per_job: 1,
            key_name: 'primary-key'
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        await withHandler('../server/api-handlers/admin/settings/verify-monitor-quota.js', async (handler) => {
            const req = {
                method: 'GET',
                headers: {
                    authorization: 'Bearer admin-token'
                }
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.balance, 12);
            assert.equal(payload.total_used, 4);
            assert.equal(payload.cost_per_job, 1);
            assert.equal(payload.key_name, 'primary-key');
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify monitor queue proxy forwards upstream queue data', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://zaoyoe-verify-server-production.up.railway.app/api/queue');
        assert.equal(init.headers.Authorization, 'Bearer admin-token');

        return new Response(JSON.stringify({
            success: true,
            queue_size: 7,
            running_jobs: 2,
            key_name: 'primary-key',
            api_base_url: 'https://verify.test'
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        await withHandler('../server/api-handlers/admin/settings/verify-monitor-queue.js', async (handler) => {
            const req = {
                method: 'GET',
                headers: {
                    authorization: 'Bearer admin-token'
                }
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.queue_size, 7);
            assert.equal(payload.running_jobs, 2);
            assert.equal(payload.api_base_url, 'https://verify.test');
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify monitor quota proxy rejects non-GET methods', async () => {
    await withHandler('../server/api-handlers/admin/settings/verify-monitor-quota.js', async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('verify monitor queue proxy rejects non-GET methods', async () => {
    await withHandler('../server/api-handlers/admin/settings/verify-monitor-queue.js', async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
