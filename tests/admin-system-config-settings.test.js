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

function createSupabaseStub(state) {
    return {
        from(table) {
            if (table === 'system_config') {
                return {
                    select() {
                        return {
                            async order() {
                                return { data: state.systemConfig.slice(), error: null };
                            }
                        };
                    },
                    async upsert(payload) {
                        const key = String(payload?.config_key || '').trim();
                        const index = state.systemConfig.findIndex((item) => item.config_key === key);
                        if (index >= 0) {
                            state.systemConfig[index] = {
                                ...state.systemConfig[index],
                                config_value: payload.config_value
                            };
                        } else {
                            state.systemConfig.push({
                                config_key: key,
                                config_value: payload.config_value
                            });
                        }
                        return { data: null, error: null };
                    }
                };
            }

            if (table === 'points_packages') {
                return {
                    async select() {
                        return {
                            data: state.pointsPackages.slice(),
                            error: null
                        };
                    },
                    update(payload) {
                        return {
                            async eq(column, value) {
                                const row = state.pointsPackages.find((item) => item[column] === value);
                                if (row) Object.assign(row, payload);
                                return { data: null, error: null };
                            }
                        };
                    },
                    async insert(payload) {
                        state.pointsPackages.push({
                            id: `pkg-${state.pointsPackages.length + 1}`,
                            ...payload
                        });
                        return { data: null, error: null };
                    },
                    delete() {
                        return {
                            async eq(column, value) {
                                state.pointsPackages = state.pointsPackages.filter((item) => item[column] !== value);
                                return { data: null, error: null };
                            }
                        };
                    }
                };
            }

            throw new Error(`Unexpected table access: ${table}`);
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/system-config.js');
    const originalLoad = Module._load;
    const state = {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        systemConfig: [
            { config_key: 'notifications', config_value: { announcement_enabled: true, announcement_content: 'hello' } },
            { config_key: 'verify_settings', config_value: { enabled: true, price_per_verify: 10 } }
        ],
        pointsPackages: [
            { id: 'pkg-1', name: '旧礼包' }
        ],
        auditLogs: [],
        ...stateOverrides
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin() {
                    const supabase = createSupabaseStub(state);
                    return {
                        user: state.user,
                        supabase,
                        adminSupabase: supabase
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditLogs.push(entry);
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

test('system config handler GET returns stored config rows for admin settings bootstrap', async () => {
    await withHandler({}, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(Array.isArray(payload.items), true);
        assert.equal(payload.items.length, 2);
    });
});

test('system config handler POST saves generic config values and records an audit log', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                key: 'notifications',
                value: {
                    announcement_enabled: true,
                    announcement_content: 'updated'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.systemConfig.find((item) => item.config_key === 'notifications')?.config_value?.announcement_content, 'updated');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].details.config_key, 'notifications');
    });
});

test('system config handler POST syncs points_packages when packages config changes', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                key: 'packages',
                value: [
                    { name: '首充', points: 100, bonus: 10, price: 9.9, enabled: true, sort: 1 },
                    { name: '月卡', points: 300, bonus: 30, price: 29.9, enabled: true, sort: 2 }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.pointsPackages.some((item) => item.name === '首充'), true);
        assert.equal(state.pointsPackages.some((item) => item.name === '月卡'), true);
        assert.equal(state.pointsPackages.some((item) => item.name === '旧礼包'), false);
        assert.equal(payload.package_sync.synced_count, 2);
    });
});
