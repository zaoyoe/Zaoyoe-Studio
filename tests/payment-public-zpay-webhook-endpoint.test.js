const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPaymentsHandlers
} = require('../server/api-handlers/public/payments');

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
        get statusCode() {
            return state.statusCode;
        },
        get headers() {
            return state.headers;
        },
        get body() {
            return state.body;
        }
    };
}

test('public payments handlers expose zpay webhook via shared handler and admin supabase client', async () => {
    const state = {};
    const adminSupabase = {
        label: 'admin-supabase'
    };

    const handlers = createPaymentsHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                state.optionalAdminRequested = true;
                return adminSupabase;
            },
            getSupabaseAdmin() {
                state.fallbackAdminRequested = true;
                return {
                    label: 'fallback-admin'
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {},
        paymentProviders: {},
        paymentOrders: {},
        zpayWebhook: {
            createZpayWebhookHandler({ getSupabase, env }) {
                state.receivedEnv = env;
                return async function zpayWebhookHandler(req, res) {
                    state.receivedMethod = req.method;
                    state.receivedSupabase = await getSupabase({ req, res });
                    res.end('success');
                };
            }
        },
        env: {
            APP_ENV: 'production',
            APP_BASE_URL: 'https://www.zaoyoe.com'
        }
    });

    assert.equal(typeof handlers['zpay/webhook'], 'function');

    const req = {
        method: 'GET',
        headers: {
            host: 'www.zaoyoe.com'
        }
    };
    const res = createMockResponse();

    await handlers['zpay/webhook'](req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'success');
    assert.equal(state.optionalAdminRequested, true);
    assert.equal(state.fallbackAdminRequested, undefined);
    assert.equal(state.receivedMethod, 'GET');
    assert.equal(state.receivedSupabase, adminSupabase);
    assert.equal(state.receivedEnv.APP_ENV, 'production');
});
