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
        auditLogs: [],
        telegramTests: [],
        feishuTests: []
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
            const secretKeyMap = state.omitSecretKeyMap
                ? undefined
                : {
                    telegram_bot_token: 'ops_alert_telegram_bot_token',
                    feishu_webhook_url: 'ops_alert_feishu_webhook_url'
                };
            return {
                OPS_ALERT_SECRET_KEYS: secretKeyMap,
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
                },
                async sendTelegramAlert(job, runtime) {
                    state.telegramTests.push({
                        job: cloneValue(job),
                        runtime: cloneValue(runtime)
                    });

                    return {
                        ok: true,
                        status: 200,
                        body: JSON.stringify([{ chatId: '5104238366', ok: true, status: 200 }])
                    };
                },
                async sendFeishuAlert(job, runtime) {
                    state.feishuTests.push({
                        job: cloneValue(job),
                        runtime: cloneValue(runtime)
                    });

                    return {
                        ok: true,
                        status: 200,
                        body: JSON.stringify({ code: 0, msg: 'success' })
                    };
                },
                resolveEnabledChannels(runtime, severity) {
                    const channels = [];
                    const normalizedSeverity = String(severity || '').trim().toLowerCase() || 'warning';
                    const rank = { info: 10, warning: 20, critical: 30 };
                    if (runtime?.config?.channels?.telegram?.enabled) {
                        const min = String(runtime.config.channels.telegram.minimum_severity || 'warning').trim().toLowerCase();
                        if ((rank[normalizedSeverity] || 20) >= (rank[min] || 20)) channels.push('telegram');
                    }
                    if (runtime?.config?.channels?.feishu?.enabled) {
                        const min = String(runtime.config.channels.feishu.minimum_severity || 'warning').trim().toLowerCase();
                        if ((rank[normalizedSeverity] || 20) >= (rank[min] || 20)) channels.push('feishu');
                    }
                    return channels;
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

test('ops alert settings POST falls back to default secret keys when the shared export is missing', async () => {
    await withOpsAlertsSettingsHandler({
        omitSecretKeyMap: true
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {
                    telegram_bot_token: 'telegram-secret-token'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(state.upsertedSecrets, [
            {
                secretKey: 'ops_alert_telegram_bot_token',
                secretValue: 'telegram-secret-token'
            }
        ]);
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

test('ops alert settings POST can send a Telegram self-check without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_test_telegram',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'critical',
                            chat_ids: ['5104238366', '5104238367']
                        }
                    }
                },
                secrets: {
                    telegram_bot_token: 'temporary-telegram-token'
                }
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 0);
        assert.deepEqual(state.telegramTests[0].runtime.config.channels.telegram.chat_ids, ['5104238366', '5104238367']);
        assert.equal(state.telegramTests[0].runtime.secrets.telegram_bot_token, 'temporary-telegram-token');
        assert.match(state.telegramTests[0].job.title, /Telegram 自检/);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.telegram_test');
    });
});

test('ops alert settings POST can send a refund detail sample to Telegram without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_refund_telegram',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /退款详情示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_refund_ops');
        assert.equal(state.telegramTests[0].job.payload.provider_order_no, 'DEMO_HJ_ORDER_20260325');
        assert.equal(state.telegramTests[0].job.payload.user_id, 'demo_buyer_001');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.telegram_refund_sample');
    });
});

test('ops alert settings POST can send a payment gateway degradation sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_gateway_degraded',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付通道异常示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_gateway_degraded');
        assert.equal(state.telegramTests[0].job.payload.provider, 'hupijiao');
        assert.equal(state.telegramTests[0].job.payload.site, 'cn');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.gateway_degraded_sample');
    });
});

test('ops alert settings POST can send a payment gateway recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_gateway_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付通道恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_gateway_recovered');
        assert.equal(state.telegramTests[0].job.payload.provider, 'hupijiao');
        assert.equal(state.telegramTests[0].job.payload.site, 'cn');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.gateway_recovered_sample');
    });
});

test('ops alert settings POST can send a verify quota low sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_quota_low',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证额度告警示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_quota_low');
        assert.equal(state.telegramTests[0].job.payload.balance, 11);
        assert.equal(state.telegramTests[0].job.payload.queue_size, 7);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_quota_sample');
    });
});

test('ops alert settings POST can send a verify service disabled sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_service_disabled',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证服务停摆示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_service_disabled');
        assert.equal(state.telegramTests[0].job.payload.service_status, 'unavailable');
        assert.equal(state.telegramTests[0].job.payload.response_status, 503);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_service_disabled_sample');
    });
});

test('ops alert settings POST can send a verify queue backlog sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_queue_backlog',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证任务堆积示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_queue_backlog');
        assert.equal(state.telegramTests[0].job.payload.queue_size, 18);
        assert.equal(state.telegramTests[0].job.payload.active_job_count, 11);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_queue_backlog_sample');
    });
});

test('ops alert settings POST can send a verify failure rate spike sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_failure_rate_spike',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证失败率异常示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_failure_rate_spike');
        assert.equal(state.telegramTests[0].job.payload.failed_jobs, 7);
        assert.equal(state.telegramTests[0].job.payload.affected_user_count, 5);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_failure_rate_spike_sample');
    });
});

test('ops alert settings POST can send a verify incident escalation sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_incident_escalated',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证综合异常示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_incident_escalated');
        assert.equal(state.telegramTests[0].job.payload.triggered_signal_count, 3);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_incident_escalated_sample');
    });
});

test('ops alert settings POST can send a verify incident recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_verify_incident_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /验证恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'verify_incident_recovered');
        assert.equal(state.telegramTests[0].job.payload.incident_duration_minutes, 18);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.verify_incident_recovered_sample');
    });
});

test('ops alert settings POST can send a ticket SLA overdue sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_ticket_sla_overdue',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /工单超时示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'ticket_sla_overdue');
        assert.equal(state.telegramTests[0].job.payload.ticket_status, 'PENDING');
        assert.equal(state.telegramTests[0].job.payload.wait_minutes, 195);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.ticket_sla_sample');
    });
});

test('ops alert settings POST can send a ticket SLA recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_ticket_sla_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /工单恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'ticket_sla_recovered');
        assert.equal(state.telegramTests[0].job.payload.ticket_status, 'RESOLVED');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.ticket_sla_recovered_sample');
    });
});

test('ops alert settings POST can send a shop inventory low sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_inventory_low',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /库存预警示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_inventory_low');
        assert.equal(state.telegramTests[0].job.payload.stock_count, 3);
        assert.equal(state.telegramTests[0].job.payload.recent_sales_count, 12);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_inventory_sample');
    });
});

test('ops alert settings POST can send a shop inventory recovery sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_inventory_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /库存恢复示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_inventory_recovered');
        assert.equal(state.telegramTests[0].job.payload.stock_count, 18);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_inventory_recovered_sample');
    });
});

test('ops alert settings POST can send an admin login anomaly sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_admin_login_anomaly',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /管理员异常登录示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'security_admin_login_anomaly');
        assert.equal(state.telegramTests[0].job.payload.client_ip, '203.0.113.88');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.admin_login_anomaly_sample');
    });
});

test('ops alert settings POST can send a shop order delivery failed sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_order_delivery_failed',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /履约失败示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_order_delivery_failed');
        assert.equal(state.telegramTests[0].job.payload.delivery_status, 'dead_letter');
        assert.equal(state.telegramTests[0].job.payload.delivery_attempt_count, 4);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_delivery_failed_sample');
    });
});

test('ops alert settings POST can send a shop order delivery recovered sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_shop_order_delivery_recovered',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /履约恢复示例消息已发送到 Telegram、飞书/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'shop_order_delivery_recovered');
        assert.equal(state.telegramTests[0].job.payload.delivery_status, 'delivered');
        assert.equal(state.telegramTests[0].job.payload.previous_delivery_status, 'dead_letter');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.shop_delivery_recovered_sample');
    });
});

test('ops alert settings POST can send a payment config changed sample without persisting config changes', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: ''
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_sample_payment_config_changed',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /支付配置变更示例消息已发送到 Telegram/);
        assert.equal(state.systemConfigUpserts.length, 0);
        assert.equal(state.upsertedSecrets.length, 0);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.telegramTests[0].job.alert_type, 'payment_config_changed');
        assert.equal(state.telegramTests[0].job.payload.active_provider, 'mock');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alerts.payment_config_changed_sample');
    });
});

test('ops alert settings preview actions fan out to Feishu when the channel is enabled', async () => {
    await withOpsAlertsSettingsHandler({
        config: createNormalizedConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['stored-chat']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T08:00:00.000Z' }
        },
        runtimeSecrets: {
            telegram_bot_token: 'stored-telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/webhook/demo'
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                action: 'send_test_telegram',
                config: {
                    enabled: true,
                    channels: {
                        telegram: {
                            enabled: true,
                            minimum_severity: 'warning',
                            chat_ids: ['5104238366']
                        },
                        feishu: {
                            enabled: true,
                            minimum_severity: 'warning'
                        }
                    }
                },
                secrets: {}
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.match(payload.message, /Telegram、飞书/);
        assert.equal(state.telegramTests.length, 1);
        assert.equal(state.feishuTests.length, 1);
    });
});
