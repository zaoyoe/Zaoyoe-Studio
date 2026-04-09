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

async function withCodexConfigHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/codex-config.js');
    const originalLoad = Module._load;
    const originalFetch = global.fetch;
    const state = {
        requireAdminCalls: [],
        resolveCalls: 0,
        auditCalls: [],
        upsertCalls: [],
        deleteCalls: [],
        fetchCalls: [],
        runtimeConfigQueue: Array.isArray(options.runtimeConfigQueue)
            ? options.runtimeConfigQueue.map((entry) => ({ ...entry }))
            : [{ ...(options.runtimeConfig || {}) }]
    };

    delete require.cache[handlerPath];
    global.fetch = async (input, init = {}) => {
        state.fetchCalls.push({ input, init });
        if (typeof options.fetchImpl === 'function') {
            return options.fetchImpl(input, init, state);
        }

        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    output_text: 'OK'
                };
            }
        };
    };

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: { mock: true },
                        user: { id: 'admin-1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(payload) {
                    state.auditCalls.push(payload);
                }
            };
        }

        if (request === '../../../../api/_lib/secrets') {
            return {
                CODEX_SECRET_KEY: 'codex_api_key',
                async resolveCodexRuntimeConfig() {
                    state.resolveCalls += 1;
                    const next = state.runtimeConfigQueue.length > 1
                        ? state.runtimeConfigQueue.shift()
                        : state.runtimeConfigQueue[0];
                    return {
                        configured: Boolean(next?.apiKey && next?.baseUrl),
                        source: next?.source || 'missing',
                        model: next?.model || 'gpt-5.4',
                        apiKey: next?.apiKey || '',
                        baseUrl: next?.baseUrl || '',
                        apiFormat: next?.apiFormat || 'responses',
                        updatedAt: null,
                        updatedBy: 'admin-1'
                    };
                },
                async upsertStoredAdminSecret(payload) {
                    state.upsertCalls.push(payload);
                },
                async deleteStoredAdminSecret(supabase, secretKey) {
                    state.deleteCalls.push({ supabase, secretKey });
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
        global.fetch = originalFetch;
        delete require.cache[handlerPath];
    }
}

test('codex config handler updates metadata without re-entering key when stored config already exists', async () => {
    await withCodexConfigHandler({
        runtimeConfigQueue: [
            {
                source: 'stored',
                apiKey: 'sk-existing-codex-key-1234567890',
                baseUrl: 'https://old.example.com',
                model: 'gpt-5.4',
                apiFormat: 'responses'
            },
            {
                source: 'stored',
                apiKey: 'sk-existing-codex-key-1234567890',
                baseUrl: 'https://api.cisct.xyz',
                model: 'gpt-5.4',
                apiFormat: 'responses'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                baseUrl: 'https://api.cisct.xyz',
                model: 'gpt-5.4',
                apiFormat: 'responses'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.upsertCalls.length, 1);
        assert.equal(state.upsertCalls[0].secretValue, 'sk-existing-codex-key-1234567890');
        assert.deepEqual(state.upsertCalls[0].metadata, {
            provider: 'codex',
            baseUrl: 'https://api.cisct.xyz',
            model: 'gpt-5.4',
            apiFormat: 'responses',
            saved_via: 'admin_studio'
        });
        assert.equal(res.json().success, true);
    });
});

test('codex config handler requires a key when no stored key exists', async () => {
    await withCodexConfigHandler({
        runtimeConfig: {
            source: 'missing',
            apiKey: '',
            baseUrl: '',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                baseUrl: 'https://api.cisct.xyz',
                model: 'gpt-5.4',
                apiFormat: 'responses'
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.equal(state.upsertCalls.length, 0);
        assert.match(res.json().message, /请先录入有效的 Codex API Key/);
    });
});

test('codex config handler can test connectivity without saving config', async () => {
    await withCodexConfigHandler({
        runtimeConfig: {
            source: 'environment',
            apiKey: 'sk-existing-codex-key-1234567890',
            baseUrl: 'https://api.cisct.xyz',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    output_text: 'OK'
                };
            }
        })
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                testOnly: true,
                baseUrl: 'https://api.cisct.xyz',
                model: 'gpt-5.4',
                apiFormat: 'responses'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.upsertCalls.length, 0);
        assert.equal(state.fetchCalls.length, 1);
        assert.equal(state.fetchCalls[0].input, 'https://api.cisct.xyz/v1/responses');
        assert.equal(JSON.parse(state.fetchCalls[0].init.body).model, 'gpt-5.4');
        assert.equal(res.json().success, true);
        assert.equal(res.json().text, 'OK');
        assert.match(res.json().message, /连通性测试通过/);
        assert.equal(state.auditCalls[0]?.actionType, 'admin.codex_config.test');
    });
});
