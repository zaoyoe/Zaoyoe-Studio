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

async function withWalletCheckinHandler(mocks, callback) {
    const handlerPath = path.resolve(__dirname, '../api/wallet/checkin.js');
    const originalLoad = Module._load;
    const state = {
        helperCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return {
                async parseJsonBody(req) {
                    return req.body || {};
                },
                async requireAuthenticatedUser() {
                    return mocks.authResult;
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        if (request === '../_lib/site') {
            return {
                requireSupportedSite(value) {
                    const normalized = String(value || '').trim().toLowerCase();
                    return ['cn', 'intl'].includes(normalized) ? normalized : 'cn';
                }
            };
        }

        if (request === '../_lib/discount-trigger-linkage') {
            return {
                async maybeIssueCheckinDiscountAssets(payload) {
                    state.helperCalls.push(payload);
                    return mocks.helperResult || {
                        success: true,
                        event_type: 'checkin',
                        matched_rule_count: 1,
                        issued_count: 1,
                        assigned_discount_ids: ['discount-checkin-1']
                    };
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

test('wallet checkin endpoint proxies successful checkin data and linked discount summary', async () => {
    await withWalletCheckinHandler({
        authResult: {
            user: { id: 'user-checkin-1' },
            requestSupabase: {
                rpc(name, params) {
                    assert.equal(name, 'fn_daily_checkin_v2');
                    assert.equal(params.p_user_id, 'user-checkin-1');
                    assert.equal(params.p_site, 'cn');
                    return Promise.resolve({
                        data: {
                            success: true,
                            message: '签到成功',
                            points: 5,
                            base_reward: 5,
                            bonus_reward: 0,
                            consecutive_days: 3,
                            new_balance: 80
                        },
                        error: null
                    });
                }
            },
            adminSupabase: { from() {} },
            supabase: { from() {} }
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                site: 'cn',
                local_date: '2026-04-15'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.points, 5);
        assert.equal(payload.linked_discount_summary?.issued_count, 1);
        assert.equal(state.helperCalls.length, 1);
        assert.equal(state.helperCalls[0].checkinDate, '2026-04-15');
    });
});

test('wallet checkin endpoint does not call linkage helper when already checked in', async () => {
    await withWalletCheckinHandler({
        authResult: {
            user: { id: 'user-checkin-2' },
            requestSupabase: {
                rpc() {
                    return Promise.resolve({
                        data: {
                            success: false,
                            already_checked: true,
                            message: '今日已签到',
                            points: 0
                        },
                        error: null
                    });
                }
            },
            adminSupabase: { from() {} },
            supabase: { from() {} }
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                site: 'cn'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.already_checked, true);
        assert.equal(payload.linked_discount_summary, null);
        assert.equal(state.helperCalls.length, 0);
    });
});
