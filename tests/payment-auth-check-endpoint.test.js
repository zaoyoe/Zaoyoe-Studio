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
        },
        get headers() {
            return state.headers;
        }
    };
}

async function withAuthCheckHandler(mockAdminModule, callback) {
    const handlerPath = path.resolve(__dirname, '../api/payments/auth-check.js');
    const originalLoad = Module._load;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return mockAdminModule;
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
        return await callback(handler);
    } finally {
        delete require.cache[handlerPath];
    }
}

test('payment auth-check returns session details for authenticated users', async () => {
    await withAuthCheckHandler({
        async requireAuthenticatedUser() {
            return {
                user: {
                    id: 'user-1',
                    email: 'member@example.com'
                },
                requestSupabase: {}
            };
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.user.id, 'user-1');
        assert.equal(payload.user.email, 'member@example.com');
        assert.equal(payload.auth.session_mode, 'request_client');
    });
});

test('payment auth-check returns auth errors without throwing', async () => {
    const authError = new Error('Auth session missing!');
    authError.statusCode = 401;

    await withAuthCheckHandler({
        async requireAuthenticatedUser() {
            throw authError;
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 401);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Auth session missing!');
    });
});

test('payment auth-check only allows GET', async () => {
    await withAuthCheckHandler({
        async requireAuthenticatedUser() {
            throw new Error('should not run');
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    }, async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(res.headers.allow, 'GET');
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
