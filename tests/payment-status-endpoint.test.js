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
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

test('public payments status handler returns current checkout session state for the authenticated user', async () => {
    const state = {};
    const handlers = createPaymentsHandlers({
        admin: {
            async requireAuthenticatedUser() {
                return {
                    user: {
                        id: 'user_zpay_1'
                    },
                    requestSupabase: {
                        label: 'request-client'
                    },
                    adminSupabase: {
                        label: 'admin-client'
                    }
                };
            },
            async parseJsonBody() {
                return {
                    checkout_session_id: 'pcs_zpay_1',
                    site: 'cn'
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            },
            getOptionalSupabaseAdmin() {
                return null;
            }
        },
        requestSecurity: {
            resolveClientIp() {
                return '203.0.113.5';
            },
            async takeRateLimitToken() {
                return {
                    allowed: true,
                    limit: 60,
                    remaining: 59,
                    retryAfterSeconds: 0
                };
            },
            applyRateLimitHeaders() {}
        },
        paymentProviders: {},
        paymentOrders: {
            async getPaymentRequestStatus({ supabase, user, body }) {
                state.supabase = supabase;
                state.user = user;
                state.body = body;
                return {
                    success: true,
                    status: 'completed',
                    checkout_session_id: body.checkout_session_id,
                    provider: 'zpay',
                    paid_amount: 0.01,
                    points_amount: 0.01,
                    message: '支付成功，积分已到账。'
                };
            }
        },
        env: {
            APP_ENV: 'production'
        }
    });

    const req = {
        method: 'POST',
        headers: {
            host: 'www.zaoyoe.com'
        }
    };
    const res = createMockResponse();

    await handlers.status(req, res);
    const payload = res.json();

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.status, 'completed');
    assert.equal(payload.checkout_session_id, 'pcs_zpay_1');
    assert.equal(state.supabase.label, 'admin-client');
    assert.equal(state.user.id, 'user_zpay_1');
    assert.deepEqual(state.body, {
        checkout_session_id: 'pcs_zpay_1',
        site: 'cn'
    });
});
