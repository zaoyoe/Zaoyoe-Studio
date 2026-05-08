const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createPublicConfigHandlers
} = require('../server/api-handlers/public/config');

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

test('public site-system-config route resolves affiliate config by site', async () => {
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    from(table) {
                        assert.equal(table, 'system_config');
                        return {
                            select() {
                                return this;
                            },
                            in(column, values) {
                                assert.equal(column, 'config_key');
                                assert.deepEqual(values.sort(), ['affiliate_poster', 'affiliate_program']);
                                return {
                                    order() {
                                        return Promise.resolve({
                                            data: [
                                                {
                                                    config_key: 'affiliate_program',
                                                    config_value: {
                                                        __site_scoped: true,
                                                        default: {
                                                            commission_rate_shop: 0.1
                                                        },
                                                        sites: {
                                                            intl: {
                                                                commission_rate_shop: 0.2
                                                            }
                                                        }
                                                    },
                                                    updated_at: '2026-05-08T10:00:00.000Z'
                                                },
                                                {
                                                    config_key: 'affiliate_poster',
                                                    config_value: {
                                                        __site_scoped: true,
                                                        default: {
                                                            title: 'CN Poster'
                                                        },
                                                        sites: {
                                                            intl: {
                                                                title: 'INTL Poster'
                                                            }
                                                        }
                                                    },
                                                    updated_at: '2026-05-08T10:05:00.000Z'
                                                }
                                            ],
                                            error: null
                                        });
                                    }
                                };
                            }
                        };
                    }
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        }
    });
    const req = {
        method: 'GET',
        url: '/api/public?scope=config&route=site-system-config&site=intl&key=affiliate_program&key=affiliate_poster',
        headers: {
            host: 'localhost:3000'
        }
    };
    const res = createMockResponse();

    await handlers['site-system-config'](req, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.site, 'intl');
    assert.equal(payload.configs.affiliate_program.commission_rate_shop, 0.2);
    assert.equal(payload.configs.affiliate_poster.title, 'INTL Poster');
});
