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

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function withMarketplaceChannelsHandler(state, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/marketplace-channels.js');
    const originalLoad = Module._load;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin() {
                    state.secretKeyEnv = process.env.ADMIN_CONFIG_ENCRYPTION_KEY || '';
                    return {
                        supabase: state.supabase,
                        user: { id: 'admin-1', email: 'admin@example.com' }
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
                    state.auditLogs.push(clone(entry));
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
        return await callback(handler);
    } finally {
        delete require.cache[handlerPath];
    }
}

function createSupabaseStub(state) {
    state.tables = {
        system_config: clone(state.tables?.system_config || []),
        admin_secret_store: clone(state.tables?.admin_secret_store || [])
    };

    function getTable(table) {
        if (!state.tables[table]) {
            state.tables[table] = [];
        }
        return state.tables[table];
    }

    return {
        from(table) {
            const rows = getTable(table);
            return {
                select() {
                    const query = {
                        eq(field, value) {
                            query._eq = query._eq || [];
                            query._eq.push([field, value]);
                            return query;
                        },
                        maybeSingle() {
                            if (table !== 'system_config') {
                                return Promise.resolve({ data: null, error: null });
                            }

                            const row = rows.find((entry) => String(entry.config_key || '') === 'marketplace_channels') || null;
                            return Promise.resolve({
                                data: row ? clone(row) : null,
                                error: null
                            });
                        },
                        then(resolve, reject) {
                            try {
                                let data = clone(rows);
                                if (Array.isArray(query._eq)) {
                                    for (const [field, value] of query._eq) {
                                        data = data.filter((row) => String(row?.[field] || '') === String(value || ''));
                                    }
                                }
                                resolve({ data, error: null });
                            } catch (error) {
                                if (typeof reject === 'function') {
                                    reject(error);
                                    return;
                                }
                                throw error;
                            }
                        }
                    };

                    return query;
                },
                upsert(payload) {
                    const cloned = clone(payload);
                    const existingIndex = rows.findIndex((row) => String(row?.secret_key || row?.config_key || '') === String(cloned?.secret_key || cloned?.config_key || ''));
                    if (existingIndex >= 0) {
                        rows[existingIndex] = {
                            ...rows[existingIndex],
                            ...cloned
                        };
                    } else {
                        rows.push(cloned);
                    }
                    return Promise.resolve({ error: null });
                },
                delete() {
                    const query = {
                        eq(field, value) {
                            query._eq = [field, value];
                            return query;
                        },
                        then(resolve, reject) {
                            try {
                                if (query._eq) {
                                    const [field, value] = query._eq;
                                    state.tables[table] = rows.filter((row) => String(row?.[field] || '') !== String(value || ''));
                                }
                                resolve({ error: null });
                            } catch (error) {
                                if (typeof reject === 'function') {
                                    reject(error);
                                    return;
                                }
                                throw error;
                            }
                        }
                    };
                    return query;
                }
            };
        }
    };
}

test('marketplace channel helpers keep website and xianyu defaults and build namespaced secret keys', async () => {
    const helpers = require('../api/_lib/marketplace-channels');

    const config = helpers.normalizeMarketplaceChannelsConfig({});
    assert.equal(config.enabled, true);
    assert.equal(config.default_channel_key, 'website');
    assert.equal(config.channels.some((channel) => channel.key === 'website'), true);
    assert.equal(config.channels.some((channel) => channel.key === 'xianyu'), true);

    const secretKey = helpers.buildMarketplaceSecretKey('xianyu', 'main', 'session_cookie');
    assert.equal(secretKey, 'marketplace__xianyu__main__session_cookie');
    assert.deepEqual(helpers.parseMarketplaceSecretKey(secretKey), {
        channel_key: 'xianyu',
        account_key: 'main',
        secret_name: 'session_cookie'
    });
    assert.equal(
        helpers.buildMarketplaceChannelManifest(config).some((entry) => entry.secret_key === 'marketplace__xianyu__main__ingest_token'),
        true
    );
});

test('marketplace channel helpers validate xianyu readiness before go-live', async () => {
    const helpers = require('../api/_lib/marketplace-channels');
    const readyConfig = helpers.normalizeMarketplaceChannelsConfig({
        enabled: true,
        channels: [
            {
                key: 'xianyu',
                type: 'xianyu',
                enabled: true,
                inventory_mode: 'shared',
                delivery_mode: 'auto',
                default_account_key: 'main',
                accounts: [
                    {
                        key: 'main',
                        label: '主号',
                        enabled: true,
                        secret_names: ['ingest_token']
                    }
                ],
                product_mappings: [
                    {
                        label: '闲鱼 GPT',
                        xianyu_item_id: 'xy-item-ready',
                        product_id: '11111111-1111-4111-8111-111111111111'
                    }
                ]
            }
        ]
    });
    const readySecretStatus = {
        marketplace__xianyu__main__ingest_token: {
            configured: true
        }
    };
    const ready = helpers.validateXianyuMarketplaceReadiness(readyConfig, readySecretStatus);
    assert.equal(ready.status, 'ok');
    assert.equal(ready.items.some((item) => item.code === 'xianyu_ready'), true);

    const broken = helpers.validateXianyuMarketplaceReadiness({
        enabled: true,
        channels: [
            {
                key: 'xianyu',
                type: 'xianyu',
                enabled: true,
                accounts: [
                    {
                        key: 'main',
                        label: '主号',
                        enabled: true,
                        secret_names: ['ingest_token']
                    }
                ],
                product_mappings: [
                    {
                        label: '空映射',
                        xianyu_item_id: 'xy-item-broken',
                        product_id: ''
                    }
                ]
            }
        ]
    }, {
        marketplace__xianyu__main__ingest_token: {
            configured: false
        }
    });
    assert.equal(broken.status, 'error');
    assert.equal(broken.items.some((item) => item.code === 'xianyu_ingest_token_missing'), true);
    assert.equal(broken.items.some((item) => item.code === 'xianyu_mapping_product_missing'), true);
});

test('marketplace channel settings persist registry and secrets through admin handler', async () => {
    const state = {
        auditLogs: [],
        tables: {
            system_config: [
                {
                    config_key: 'marketplace_channels',
                    config_value: {
                        enabled: true,
                        default_channel_key: 'website',
                        inventory_mode: 'shared',
                        channels: [
                            {
                                key: 'website',
                                type: 'website',
                                label: '网站',
                                enabled: true,
                                inventory_mode: 'shared',
                                delivery_mode: 'manual',
                                source_channel: 'website',
                                default_account_key: '',
                                multi_account: false,
                                notes: '',
                                accounts: []
                            },
                            {
                                key: 'xianyu',
                                type: 'xianyu',
                                label: '闲鱼',
                                enabled: true,
                                inventory_mode: 'shared',
                                delivery_mode: 'auto',
                                source_channel: 'xianyu',
                                default_account_key: 'main',
                                multi_account: true,
                                notes: '',
                                product_mappings: [
                                    {
                                        label: '闲鱼示例商品',
                                        xianyu_item_id: 'xy-demo-item-1',
                                        product_id: '11111111-1111-4111-8111-111111111111'
                                    }
                                ],
                                accounts: [
                                    {
                                        key: 'main',
                                        label: '主号',
                                        enabled: true,
                                        role: 'primary',
                                        notes: '',
                                        secret_names: ['session_cookie', 'refresh_token', 'ingest_token']
                                    }
                                ]
                            }
                        ]
                    }
                }
            ]
        }
    };
    state.supabase = createSupabaseStub(state);

    await withMarketplaceChannelsHandler(state, async (handler) => {
        process.env.ADMIN_CONFIG_ENCRYPTION_KEY = 'marketplace-channel-test-secret';
        const getRes = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin/settings/marketplace-channels',
            headers: {}
        }, getRes);

        const getPayload = getRes.json();
        assert.equal(getRes.statusCode, 200);
        assert.equal(getPayload.success, true);
        assert.equal(getPayload.summary.channel_count >= 2, true);
        assert.equal(['ok', 'warning', 'error'].includes(getPayload.readiness.xianyu.status), true);
        assert.equal(getPayload.manifest.some((entry) => entry.secret_key === 'marketplace__xianyu__main__session_cookie'), true);
        assert.equal(getPayload.manifest.some((entry) => entry.secret_key === 'marketplace__xianyu__main__ingest_token'), true);

        const postRes = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                config: {
                    enabled: true,
                    default_channel_key: 'xianyu',
                    channels: [
                        {
                            key: 'website',
                            type: 'website',
                            label: '网站',
                            enabled: true,
                            accounts: []
                        },
                        {
                            key: 'xianyu',
                            type: 'xianyu',
                            label: '闲鱼',
                            enabled: true,
                            product_mappings: [
                                {
                                    label: '闲鱼示例商品',
                                    xianyu_item_id: 'xy-demo-item-1',
                                    product_id: '11111111-1111-4111-8111-111111111111'
                                }
                            ],
                            accounts: [
                                {
                                    key: 'main',
                                    label: '主号',
                                    enabled: true,
                                    secret_names: ['session_cookie', 'refresh_token', 'ingest_token']
                                }
                            ]
                        }
                    ]
                },
                secrets: {
                    marketplace__xianyu__main__session_cookie: 'cookie-value',
                    marketplace__xianyu__main__refresh_token: 'refresh-token-value',
                    marketplace__xianyu__main__ingest_token: 'ingest-token-value'
                }
            }
        }, postRes);

        const postPayload = postRes.json();
        assert.equal(postRes.statusCode, 200);
        assert.equal(postPayload.success, true);
        assert.equal(postPayload.readiness.xianyu.status, 'ok');
        assert.equal(postPayload.saved_secret_keys.length, 3);
        const savedXianyuChannel = postPayload.config.channels.find((channel) => channel.key === 'xianyu');
        assert.equal(savedXianyuChannel.product_mappings.length, 1);
        assert.equal(savedXianyuChannel.product_mappings[0].xianyu_item_id, 'xy-demo-item-1');
        assert.equal(savedXianyuChannel.product_mappings[0].product_id, '11111111-1111-4111-8111-111111111111');
        assert.equal(state.tables.system_config[0].config_key, 'marketplace_channels');
        assert.equal(state.tables.admin_secret_store.length, 3);
        assert.equal(state.tables.admin_secret_store[0].secret_key.startsWith('marketplace__xianyu__main__'), true);

        const deleteRes = createMockResponse();
        await handler({
            method: 'DELETE',
            headers: {},
            body: {
                secretKey: 'marketplace__xianyu__main__session_cookie'
            }
        }, deleteRes);

        const deletePayload = deleteRes.json();
        assert.equal(deleteRes.statusCode, 200);
        assert.equal(deletePayload.success, true);
        assert.equal(state.tables.admin_secret_store.some((row) => row.secret_key === 'marketplace__xianyu__main__session_cookie'), false);
        delete process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
    });
});
