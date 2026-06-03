const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const {
    VERIFY_MONITOR_INTERNAL_HEADER_NAME
} = require('../api/_lib/verify-monitor-internal-access');

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

function createAdminModule(options = {}) {
    return {
        async requireAdmin() {
            return {
                user: { id: 'admin-user-1', email: 'admin@example.com' }
            };
        },
        getOptionalSupabaseAdmin() {
            return typeof options.getOptionalSupabaseAdmin === 'function'
                ? options.getOptionalSupabaseAdmin()
                : null;
        },
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    };
}

async function withHandler(relativePath, callback, options = {}) {
    const handlerPath = path.resolve(__dirname, relativePath);
    const originalLoad = Module._load;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule(options);
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

async function withEnv(patch, callback) {
    const previous = {};

    for (const [key, value] of Object.entries(patch || {})) {
        previous[key] = process.env[key];
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }

    try {
        return await callback();
    } finally {
        for (const key of Object.keys(patch || {})) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

test('verify monitor quota proxy forwards upstream quota data with internal auth header', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://verify-api.fatherkey.com/api/quota');
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.headers[VERIFY_MONITOR_INTERNAL_HEADER_NAME], 'verify-internal-secret');

        return new Response(JSON.stringify({
            success: true,
            provider: 'catcard',
            provider_label: '通道 2 · 1free',
            adapter: 'pixel_bridge_rest',
            api_base_url: 'https://1free.qzz.io',
            balance: 12,
            remaining_uses: 12,
            remaining_extract_uses: 2,
            remaining_full_uses: 10,
            remaining_extract_jobs: 24,
            remaining_full_jobs: 12,
            total_used: 4,
            cost_per_job: 1,
            extract_cost_per_job: 0.5,
            full_cost_per_job: 1,
            key_name: 'primary-key',
            key_count: 2,
            healthy_key_count: 1,
            key_states: [{
                api_key: 'SYS-AAA',
                masked_key: 'SYS-...-AAA',
                key_name: 'SYS-...-AAA',
                ok: true,
                status: 200,
                remaining_uses: 12,
                total_used: 4
            }]
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: 'verify-internal-secret' }, async () => {
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
                assert.equal(payload.provider, 'catcard');
                assert.equal(payload.provider_label, '通道 2 · 1free');
                assert.equal(payload.adapter, 'pixel_bridge_rest');
                assert.equal(payload.api_base_url, 'https://1free.qzz.io');
                assert.equal(payload.balance, 12);
                assert.equal(payload.remaining_uses, 12);
                assert.equal(payload.remaining_extract_uses, 2);
                assert.equal(payload.remaining_full_uses, 10);
                assert.equal(payload.remaining_extract_jobs, 24);
                assert.equal(payload.remaining_full_jobs, 12);
                assert.equal(payload.total_used, 4);
                assert.equal(payload.cost_per_job, 1);
                assert.equal(payload.extract_cost_per_job, 0.5);
                assert.equal(payload.full_cost_per_job, 1);
                assert.equal(payload.key_name, 'primary-key');
                assert.equal(payload.key_count, 2);
                assert.equal(payload.healthy_key_count, 1);
                assert.equal(Array.isArray(payload.key_states), true);
                assert.equal(payload.key_states[0].api_key, 'SYS-AAA');
            });
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify monitor quota proxy uses a 15 second timeout budget', () => {
    const source = require('node:fs').readFileSync(
        path.resolve(__dirname, '../server/api-handlers/admin/settings/verify-monitor-quota.js'),
        'utf8'
    );

    assert.equal(source.includes('const VERIFY_MONITOR_PROXY_TIMEOUT_MS = 15000;'), true);
    assert.equal(source.includes('timeoutMs: VERIFY_MONITOR_PROXY_TIMEOUT_MS'), true);
});

test('verify monitor quota proxy falls back to forwarding admin authorization when internal auth key is missing', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://verify-api.fatherkey.com/api/quota');
        assert.equal(init.headers.Authorization, 'Bearer admin-token');
        assert.equal(init.headers[VERIFY_MONITOR_INTERNAL_HEADER_NAME], undefined);

        return new Response(JSON.stringify({
            success: true,
            balance: 0.5,
            remaining_uses: 0.5,
            remaining_extract_jobs: 1,
            remaining_full_jobs: 0,
            total_used: 9,
            cost_per_job: 1,
            extract_cost_per_job: 0.5,
            full_cost_per_job: 1,
            key_name: 'primary-key',
            key_states: [{
                api_key: 'SYS-ZERO',
                masked_key: 'SYS-...ZERO',
                key_name: 'SYS-...ZERO',
                ok: true,
                status: 200,
                remaining_uses: 0.5,
                total_used: 9
            }]
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: null, VERIFY_INTERNAL_ACCESS_KEY: null }, async () => {
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
                assert.equal(payload.balance, 0.5);
                assert.equal(payload.remaining_extract_jobs, 1);
                assert.equal(payload.remaining_full_jobs, 0);
                assert.equal(Array.isArray(payload.key_states), true);
                assert.equal(payload.key_states[0].api_key, 'SYS-ZERO');
            });
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify monitor queue proxy falls back to forwarding admin authorization when internal auth key is missing', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://verify-api.fatherkey.com/api/queue');
        assert.equal(init.headers.Authorization, 'Bearer admin-token');
        assert.equal(init.headers[VERIFY_MONITOR_INTERNAL_HEADER_NAME], undefined);

        return new Response(JSON.stringify({
            success: true,
            queue_size: 0,
            running_jobs: 0,
            key_name: 'primary-key',
            api_base_url: 'https://aidone.lol'
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    try {
        await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: null, VERIFY_INTERNAL_ACCESS_KEY: null }, async () => {
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
                assert.equal(payload.queue_size, 0);
                assert.equal(payload.running_jobs, 0);
            });
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify monitor queue proxy forwards upstream queue data with internal auth header', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
        assert.equal(String(input), 'https://verify-api.fatherkey.com/api/queue');
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.headers[VERIFY_MONITOR_INTERNAL_HEADER_NAME], 'verify-internal-secret');

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
        await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: 'verify-internal-secret' }, async () => {
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
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify monitor quota proxy fails closed when internal auth key and admin authorization are both missing', async () => {
    await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: null, VERIFY_INTERNAL_ACCESS_KEY: null }, async () => {
        await withHandler('../server/api-handlers/admin/settings/verify-monitor-quota.js', async (handler) => {
            const req = {
                method: 'GET',
                headers: {}
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 500);
            assert.equal(payload.success, false);
            assert.equal(payload.message, '验证运维内部凭证未配置，且当前管理员会话不可转发');
        });
    });
});

test('verify monitor quota returns local provider failure when proxy credentials are unavailable', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
        assert.equal(String(input), 'https://1free.qzz.io/api/pixel-keys/verify');
        return new Response(JSON.stringify({
            code: 1,
            msg: '1free key 未激活或余额不可用',
            data: {
                status: 'inactive',
                remaining: 0
            }
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    };

    const supabase = {
        from(tableName) {
            assert.equal(tableName, 'system_config');
            return {
                select(columns) {
                    assert.equal(columns, 'config_value');
                    return {
                        eq(column, value) {
                            assert.equal(column, 'config_key');
                            assert.equal(value, 'verify_settings');
                            return {
                                async maybeSingle() {
                                    return {
                                        data: {
                                            config_value: {
                                                active_provider: 'catcard',
                                                providers: {
                                                    catcard: {
                                                        api_base_url: 'https://1free.qzz.io',
                                                        cdkeys: ['catcard-key-1']
                                                    }
                                                }
                                            }
                                        },
                                        error: null
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    try {
        await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: null, VERIFY_INTERNAL_ACCESS_KEY: null }, async () => {
            await withHandler('../server/api-handlers/admin/settings/verify-monitor-quota.js', async (handler) => {
                const req = {
                    method: 'GET',
                    headers: {}
                };
                const res = createMockResponse();

                await handler(req, res);
                const payload = res.json();

                assert.equal(payload.success, false);
                assert.equal(payload.provider, 'catcard');
                assert.equal(payload.message, '1free key 未激活或余额不可用');
                assert.notEqual(payload.message, '验证运维内部凭证未配置，且当前管理员会话不可转发');
            }, {
                getOptionalSupabaseAdmin: () => supabase
            });
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('verify monitor queue returns local queue failure when proxy credentials are unavailable', async () => {
    await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: null, VERIFY_INTERNAL_ACCESS_KEY: null }, async () => {
        await withHandler('../server/api-handlers/admin/settings/verify-monitor-queue.js', async (handler) => {
            const req = {
                method: 'GET',
                headers: {}
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 503);
            assert.equal(payload.success, false);
            assert.equal(payload.message, '验证服务本地队列不可用');
        }, {
            getOptionalSupabaseAdmin: () => ({})
        });
    });
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
