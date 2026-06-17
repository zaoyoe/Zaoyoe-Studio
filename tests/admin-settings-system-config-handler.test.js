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

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeComparableValue(value) {
    return value == null ? '' : String(value);
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (!filter) {
            return true;
        }

        if (filter.kind === 'in') {
            return (Array.isArray(filter.values) ? filter.values : []).some((value) => (
                normalizeComparableValue(row?.[filter.field]) === normalizeComparableValue(value)
            ));
        }

        return true;
    }));
}

function createSupabaseDouble(state) {
    function getTable(table) {
        if (!state.tables[table]) {
            state.tables[table] = [];
        }
        return state.tables[table];
    }

    return {
        from(table) {
            return {
                select() {
                    const filters = [];
                    return {
                        in(field, values) {
                            filters.push({ kind: 'in', field, values });
                            return this;
                        },
                        order() {
                            return this;
                        },
                        then(resolve, reject) {
                            try {
                                resolve({
                                    data: clone(applyFilters(getTable(table), filters)),
                                    error: null
                                });
                            } catch (error) {
                                if (typeof reject === 'function') {
                                    reject(error);
                                    return;
                                }
                                throw error;
                            }
                        }
                    };
                },
                upsert(payload, options = {}) {
                    const rows = getTable(table);
                    const conflictField = String(options?.onConflict || 'config_key').trim();
                    const cloned = clone(payload);
                    const existingIndex = rows.findIndex((row) => (
                        normalizeComparableValue(row?.[conflictField]) === normalizeComparableValue(cloned?.[conflictField])
                    ));

                    if (existingIndex >= 0) {
                        rows[existingIndex] = {
                            ...rows[existingIndex],
                            ...cloned
                        };
                    } else {
                        rows.push(cloned);
                    }

                    return Promise.resolve({ data: null, error: null });
                }
            };
        }
    };
}

async function withSystemConfigHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/system-config.js');
    const originalLoad = Module._load;
    const state = {
        auditEntries: [],
        notifications: [],
        requireAdminCalls: [],
        adminUserIds: clone(options?.adminUserIds || ['admin_1']),
        tables: {
            system_config: clone(options?.tables?.system_config || [])
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, options = {}) {
                    const normalized = String(Array.isArray(value) ? value[0] : (value || '')).trim().toLowerCase();
                    const normalizedDefault = Object.prototype.hasOwnProperty.call(options, 'defaultValue')
                        ? String(options.defaultValue || '').trim().toLowerCase()
                        : '';
                    if (normalized === 'cn' || normalized === 'intl' || normalized === 'all') {
                        return normalized;
                    }
                    return normalizedDefault;
                },
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: createSupabaseDouble(state),
                        user: { id: 'admin_1', email: 'admin@example.com' }
                    };
                },
                requireWritableAdminSite(value, options = {}) {
                    const rawSite = String(Array.isArray(value) ? value[0] : (value || '')).trim().toLowerCase();
                    if (rawSite === 'cn' || rawSite === 'intl') {
                        return rawSite;
                    }

                    const error = new Error(options.message || (rawSite
                        ? `Writable admin site must be cn or intl; received ${rawSite}`
                        : 'Writable admin site is required'));
                    error.statusCode = 400;
                    throw error;
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditEntries.push(clone(entry));
                }
            };
        }

        if (request === '../../../../api/_lib/admin-notifications') {
            return {
                async listActiveAdminUserIds() {
                    return clone(state.adminUserIds);
                },
                async notifyUsers(_supabase, payload) {
                    state.notifications.push(clone(payload));
                    return {
                        recipients: Array.isArray(payload?.userIds) ? payload.userIds.length : 0,
                        created: Array.isArray(payload?.userIds) ? payload.userIds.length : 0,
                        skipped: 0
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

test('system config handler GET returns only the requested domain keys', async () => {
    await withSystemConfigHandler({
        tables: {
            system_config: [
                { config_key: 'unlock_pricing', config_value: { default_points: 1 } },
                { config_key: 'affiliate_program', config_value: { enabled: true } }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/settings/system-config?domain=commerce',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal('unlock_pricing' in res.json().configs, true);
        assert.equal('affiliate_program' in res.json().configs, false);
    });
});

test('system config handler POST persists allowed keys and writes audit', async () => {
    await withSystemConfigHandler({
        tables: {
            system_config: []
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                key: 'security',
                value: { login_alerts: true }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.system_config.length, 1);
        assert.equal(state.tables.system_config[0].config_key, 'security');
        assert.equal(state.auditEntries[0]?.actionType, 'system_config.update');
    });
});

test('system config handler stores reward-related settings per writable site', async () => {
    await withSystemConfigHandler({
        tables: {
            system_config: [
                {
                    config_key: 'checkin_system',
                    config_value: {
                        base_points: 5,
                        consecutive_7_points: 50
                    }
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                key: 'checkin_system',
                site: 'intl',
                value: {
                    base_points: 8,
                    consecutive_7_points: 80
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.system_config[0].config_value.__site_scoped, true);
        assert.deepEqual(state.tables.system_config[0].config_value.default, {
            base_points: 5,
            consecutive_7_points: 50
        });
        assert.deepEqual(state.tables.system_config[0].config_value.sites.intl, {
            base_points: 8,
            consecutive_7_points: 80
        });
        assert.equal(state.auditEntries[0]?.details?.site_scoped, true);
        assert.equal(state.auditEntries[0]?.details?.site, 'intl');
    });
});

test('system config handler preserves zero unlock pricing per writable site', async () => {
    await withSystemConfigHandler({
        tables: {
            system_config: [
                {
                    config_key: 'unlock_pricing',
                    config_value: {
                        default_points: 1,
                        vip_discount: 0.9,
                        free_daily_limit: 3
                    }
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                key: 'unlock_pricing',
                site: 'cn',
                value: {
                    default_points: 0,
                    vip_discount: 0.9,
                    free_daily_limit: 2
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.system_config[0].config_value.__site_scoped, true);
        assert.deepEqual(state.tables.system_config[0].config_value.default, {
            default_points: 1,
            vip_discount: 0.9,
            free_daily_limit: 3
        });
        assert.deepEqual(state.tables.system_config[0].config_value.sites.cn, {
            default_points: 0,
            vip_discount: 0.9,
            free_daily_limit: 2
        });
    });
});

test('system config handler stores verify settings per writable site', async () => {
    await withSystemConfigHandler({
        tables: {
            system_config: [
                {
                    config_key: 'verify_settings',
                    config_value: {
                        verify_cdkey: 'CN-CDKEY',
                        price_per_verify: 10
                    }
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                key: 'verify_settings',
                site: 'intl',
                value: {
                    verify_cdkey: 'INTL-CDKEY',
                    price_per_verify: 6
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.system_config[0].config_value.__site_scoped, true);
        assert.deepEqual(state.tables.system_config[0].config_value.default, {
            verify_cdkey: 'CN-CDKEY',
            price_per_verify: 10
        });
        assert.deepEqual(state.tables.system_config[0].config_value.sites.intl, {
            verify_cdkey: 'INTL-CDKEY',
            price_per_verify: 6
        });
    });
});

test('system config handler rejects unknown keys', async () => {
    await withSystemConfigHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                key: 'not_allowed_key',
                value: {}
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Unsupported system config key/);
        assert.equal(state.tables.system_config.length, 0);
        assert.equal(state.auditEntries.length, 0);
    });
});

test('system config handler notifies other admins when announcement settings change', async () => {
    await withSystemConfigHandler({
        adminUserIds: ['admin_1', 'admin_2', 'admin_3'],
        tables: {
            system_config: [
                {
                    config_key: 'notifications',
                    config_value: {
                        announcement_enabled: false,
                        announcement_content: '',
                        announcement_type: 'banner',
                        announcement_pages: ['all']
                    }
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                key: 'notifications',
                site: 'intl',
                value: {
                    announcement_enabled: true,
                    announcement_content: '<p>今晚 23:00 维护</p>',
                    announcement_type: 'modal',
                    announcement_pages: ['all'],
                    announcement_page_overrides: {
                        shop: {
                            content: '<p>商城专属公告</p>'
                        },
                        verify: {
                            content: '<p>验证页专属公告</p>'
                        }
                    }
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().site, 'intl');
        assert.equal(state.tables.system_config[0].config_value.__site_scoped, true);
        assert.equal(state.tables.system_config[0].config_value.sites.intl.announcement_enabled, true);
        assert.equal(state.notifications.length, 1);
        assert.deepEqual(state.notifications[0].userIds, ['admin_2', 'admin_3']);
        assert.equal(state.notifications[0].scope, 'admin_personal');
        assert.equal(state.notifications[0].category, 'announcement');
        assert.equal(state.notifications[0].type, 'info');
        assert.match(state.notifications[0].content, /专属页面：商城 \/ 验证/);
    });
});
