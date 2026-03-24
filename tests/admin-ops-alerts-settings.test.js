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

function createDefaultState() {
    return {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        config: {
            enabled: false,
            channels: {
                telegram: {
                    enabled: false,
                    minimum_severity: 'warning',
                    chat_ids: []
                },
                feishu: {
                    enabled: false,
                    minimum_severity: 'warning'
                }
            }
        },
        secretStatus: {
            telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: '',
            feishu_webhook_url: ''
        },
        systemConfigUpserts: [],
        upsertedSecrets: [],
        deletedSecrets: [],
        auditLogs: []
    };
}

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)));
    }

    if (typeof value === 'string') {
        return Array.from(new Set(
            value
                .split(/[\n,]/)
                .map((item) => String(item ?? '').trim())
                .filter(Boolean)
        ));
    }

    return [];
}

function createNormalizedConfig(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const channels = source.channels && typeof source.channels === 'object' ? source.channels : {};
    const telegram = channels.telegram && typeof channels.telegram === 'object' ? channels.telegram : {};
    const feishu = channels.feishu && typeof channels.feishu === 'object' ? channels.feishu : {};

    return {
        enabled: normalizeBoolean(source.enabled, false),
        channels: {
            telegram: {
                enabled: normalizeBoolean(telegram.enabled, false),
                minimum_severity: ['info', 'warning', 'critical'].includes(String(telegram.minimum_severity || '').trim())
                    ? String(telegram.minimum_severity).trim()
                    : 'warning',
                chat_ids: normalizeStringArray(telegram.chat_ids)
            },
            feishu: {
                enabled: normalizeBoolean(feishu.enabled, false),
                minimum_severity: ['info', 'warning', 'critical'].includes(String(feishu.minimum_severity || '').trim())
                    ? String(feishu.minimum_severity).trim()
                    : 'warning'
            }
        }
    };
}

function createMockSupabase(state) {
    return {
        from(table) {
            if (table === 'system_config') {
                return {
                    async upsert(payload) {
                        state.systemConfigUpserts.push(cloneValue(payload));
                        if (payload.config_key === 'ops_alerts') {
                            state.config = createNormalizedConfig(payload.config_value);
                        }
                        return { error: null };
                    }
                };
            }

            throw new Error(`Unexpected table access: ${table}`);
        }
    };
}

function createMockAdminModule(state) {
    return {
        async requireAdmin() {
            return {
                supabase: createMockSupabase(state),
                user: state.user
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
            state.auditLogs.push(cloneValue(entry));
        }
    };
}

function buildSecretStatus(state) {
    return cloneValue(state.secretStatus);
}

async function withOpsAlertsSettingsHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/ops-alerts.js');
    const originalLoad = Module._load;
    const state = Object.assign(createDefaultState(), cloneValue(stateOverrides || {}));

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createMockAdminModule(state);
        }

        if (request === '../../../../api/_lib/secrets') {
            return {
                OPS_ALERT_SECRET_KEYS: {
                    telegram_bot_token: 'ops_alert_telegram_bot_token',
                    feishu_webhook_url: 'ops_alert_feishu_webhook_url'
                },
                async upsertStoredAdminSecret({ secretKey, secretValue }) {
                    state.upsertedSecrets.push({ secretKey, secretValue });
                    if (secretKey === 'ops_alert_telegram_bot_token') {
                        state.runtimeSecrets.telegram_bot_token = secretValue;
                        state.secretStatus.telegram_bot_token = {
                            configured: true,
                            source: 'stored',
                            updatedAt: '2026-03-24T10:00:00.000Z'
                        };
                    }
                    if (secretKey === 'ops_alert_feishu_webhook_url') {
                        state.runtimeSecrets.feishu_webhook_url = secretValue;
                        state.secretStatus.feishu_webhook_url = {
                            configured: true,
                            source: 'stored',
                            updatedAt: '2026-03-24T10:00:00.000Z'
                        };
                    }
                },
                async deleteStoredAdminSecret(_supabase, secretKey) {
                    state.deletedSecrets.push(secretKey);
                    if (secretKey === 'ops_alert_telegram_bot_token') {
                        state.runtimeSecrets.telegram_bot_token = '';
                        state.secretStatus.telegram_bot_token = {
                            configured: false,
                            source: 'missing',
                            updatedAt: null
                        };
                    }
                    if (secretKey === 'ops_alert_feishu_webhook_url') {
                        state.runtimeSecrets.feishu_webhook_url = '';
                        state.secretStatus.feishu_webhook_url = {
                            configured: false,
                            source: 'missing',
                            updatedAt: null
                        };
                    }
                }
            };
        }

        if (request === '../../../../api/_lib/ops-alerts') {
            return {
                OPS_ALERTS_CONFIG_KEY: 'ops_alerts',
                normalizeOpsAlertsConfig(raw) {
                    return createNormalizedConfig(raw);
                },
                async loadOpsAlertsRuntimeConfig() {
                    return {
                        config: cloneValue(state.config),
                        secrets: cloneValue(state.runtimeSecrets)
                    };
                },
                buildOpsAlertSecretStatus() {
                    return buildSecretStatus(state);
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
        return await callback(handler, state);
    } finally {
        delete require.cache[handlerPath];
    }
}

test('ops alert settings GET returns the current config and secret status', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: { enabled: true, minimum_severity: 'critical', chat_ids: ['123456'] },
                feishu: { enabled: false, minimum_severity: 'warning' }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-24T10:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler) => {
        const req = { method: 'GET', body: null };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.config.enabled, true);
        assert.equal(payload.config.channels.telegram.minimum_severity, 'critical');
        assert.deepEqual(payload.config.channels.telegram.chat_ids, ['123456']);
        assert.equal(payload.secrets.telegram_bot_token.configured, true);
        assert.equal(payload.secrets.telegram_bot_token.source, 'stored');
        assert.equal(payload.secrets.feishu_webhook_url.configured, false);
    });
});

test('ops alert settings POST saves config, stores secrets, and records an audit log', async () => {
    await withOpsAlertsSettingsHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'critical',
                            chat_ids: ['123456', '789000']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {
                    telegram_bot_token: 'telegram-secret-token',
                    feishu_webhook_url: 'https://open.feishu.cn/webhook/test'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.config.enabled, true);
        assert.equal(payload.config.channels.telegram.enabled, true);
        assert.deepEqual(payload.config.channels.telegram.chat_ids, ['123456', '789000']);
        assert.equal(state.systemConfigUpserts.length, 1);
        assert.equal(state.systemConfigUpserts[0].config_key, 'ops_alerts');
        assert.equal(state.upsertedSecrets.length, 2);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.upsert');
        assert.deepEqual(state.auditLogs[0].details.updated_secrets, ['telegram_bot_token', 'feishu_webhook_url']);
        assert.equal(payload.secrets.telegram_bot_token.configured, true);
        assert.equal(payload.secrets.feishu_webhook_url.configured, true);
    });
});

test('ops alert settings DELETE removes a stored secret and returns refreshed status', async () => {
    await withOpsAlertsSettingsHandler({
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-24T10:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'DELETE',
            body: {
                secretName: 'telegram_bot_token'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(state.deletedSecrets, ['ops_alert_telegram_bot_token']);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.secret.delete');
        assert.equal(payload.secrets.telegram_bot_token.configured, false);
        assert.equal(payload.secrets.telegram_bot_token.source, 'missing');
    });
});
