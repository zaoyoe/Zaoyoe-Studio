const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublicConfigHandlers } = require('../server/api-handlers/public/config');

function createResponseRecorder() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
            return this;
        },
        end(payload) {
            this.body = payload;
            return this;
        }
    };
}

test('public notifications config handler returns sanitized announcement config for public pages', async () => {
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    from(table) {
                        assert.equal(table, 'system_config');
                        return {
                            select() { return this; },
                            eq() { return this; },
                            async maybeSingle() {
                                return {
                                    data: {
                                        config_value: {
                                            announcement_enabled: true,
                                            announcement_content: '<a href="https://zaoyoe.com">zaoyoe</a>',
                                            announcement_type: 'modal',
                                            announcement_color: 'blue',
                                            announcement_size: 'medium',
                                            announcement_decoration: 'fireworks',
                                            announcement_pages: ['homepage', 'guestbook'],
                                            announcement_updated_at: '2026-04-10T01:23:45.000Z'
                                        }
                                    },
                                    error: null
                                };
                            }
                        };
                    }
                };
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.notifications({ method: 'GET' }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(payload.success, true);
    assert.deepEqual(payload.config.announcement_pages, ['index', 'guestbook']);
    assert.equal(payload.config.announcement_enabled, true);
    assert.equal(payload.config.announcement_type, 'modal');
    assert.equal(payload.config.announcement_content, '<a href="https://zaoyoe.com">zaoyoe</a>');
});

test('public notifications config handler rejects unsupported methods', async () => {
    const handlers = createPublicConfigHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return {};
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
                return payload;
            }
        }
    });

    const res = createResponseRecorder();
    await handlers.notifications({ method: 'POST' }, res);
    const payload = JSON.parse(String(res.body || '{}'));

    assert.equal(res.statusCode, 405);
    assert.equal(payload.success, false);
});

test('public verify quota handler returns remaining uses and derived task counts for authenticated users', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://aidone.lol/openapi');
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body), {
            action: 'get_balance',
            cdkey: 'SYS-38147DAAF78A'
        });

        return new Response(JSON.stringify({
            success: true,
            remaining_uses: 0.5,
            total_used: 12
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        const handlers = createPublicConfigHandlers({
            admin: {
                async requireAuthenticatedUser() {
                    return {
                        user: {
                            id: 'user-1'
                        }
                    };
                },
                getOptionalSupabaseAdmin() {
                    return {
                        from(table) {
                            assert.equal(table, 'system_config');
                            return {
                                select() { return this; },
                                eq() { return this; },
                                async maybeSingle() {
                                    return {
                                        data: {
                                            config_value: {
                                                enabled: true,
                                                verify_cdkey: 'SYS-38147DAAF78A',
                                                verify_api_base_url: 'https://aidone.lol'
                                            }
                                        },
                                        error: null
                                    };
                                }
                            };
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                    return payload;
                }
            }
        });

        const res = createResponseRecorder();
        await handlers['verify-quota']({
            method: 'GET',
            headers: {
                authorization: 'Bearer member-token'
            }
        }, res);
        const payload = JSON.parse(String(res.body || '{}'));

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.remaining_uses, 0.5);
        assert.equal(payload.remaining_extract_jobs, 1);
        assert.equal(payload.remaining_full_jobs, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('public verify quota handler aggregates balances across a configured CDKey pool', async () => {
    const originalFetch = global.fetch;
    const seenKeys = [];
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://aidone.lol/openapi');
        assert.equal(init.method, 'POST');

        const payload = JSON.parse(init.body);
        assert.equal(payload.action, 'get_balance');
        seenKeys.push(payload.cdkey);

        const remainingUsesByKey = {
            'SYS-AAA111': 0.5,
            'SYS-BBB222': 1.0
        };

        return new Response(JSON.stringify({
            success: true,
            remaining_uses: remainingUsesByKey[payload.cdkey] || 0,
            total_used: payload.cdkey === 'SYS-AAA111' ? 3 : 7
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        const handlers = createPublicConfigHandlers({
            admin: {
                async requireAuthenticatedUser() {
                    return {
                        user: {
                            id: 'user-2'
                        }
                    };
                },
                getOptionalSupabaseAdmin() {
                    return {
                        from(table) {
                            assert.equal(table, 'system_config');
                            return {
                                select() { return this; },
                                eq() { return this; },
                                async maybeSingle() {
                                    return {
                                        data: {
                                            config_value: {
                                                enabled: true,
                                                verify_cdkeys: ['SYS-AAA111', 'SYS-BBB222'],
                                                verify_api_base_url: 'https://aidone.lol'
                                            }
                                        },
                                        error: null
                                    };
                                }
                            };
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                    return payload;
                }
            }
        });

        const res = createResponseRecorder();
        await handlers['verify-quota']({
            method: 'GET',
            headers: {
                authorization: 'Bearer member-token'
            }
        }, res);
        const payload = JSON.parse(String(res.body || '{}'));

        assert.deepEqual(seenKeys, ['SYS-AAA111', 'SYS-BBB222']);
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.remaining_uses, 1.5);
        assert.equal(payload.remaining_extract_jobs, 3);
        assert.equal(payload.remaining_full_jobs, 1);
        assert.equal(payload.key_count, 2);
        assert.equal(payload.healthy_key_count, 2);
    } finally {
        global.fetch = originalFetch;
    }
});
