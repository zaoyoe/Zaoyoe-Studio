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

async function withGeminiHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/gemini.js');
    const originalLoad = Module._load;
    const originalFetch = global.fetch;
    const state = {
        requireAdminCalls: [],
        runtimeConfig: options.runtimeConfig || {},
        fetchCalls: []
    };

    delete require.cache[handlerPath];
    global.fetch = async (input, init = {}) => {
        state.fetchCalls.push({ input, init });
        if (typeof options.fetchImpl === 'function') {
            const response = await options.fetchImpl(input, init, state);
            if (response && typeof response.json !== 'function') {
                response.json = async () => ({});
            }
            return response;
        }

        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    candidates: [{
                        content: {
                            parts: [{ text: 'default-gemini-response' }]
                        }
                    }]
                };
            }
        };
    };

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../api/_lib/admin') {
            return {
                async requireAdmin(req, optionsArg = {}) {
                    state.requireAdminCalls.push({ req, options: optionsArg });
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
                }
            };
        }

        if (request === '../../../api/_lib/secrets') {
            return {
                async resolveGeminiRuntimeConfig() {
                    return {
                        configured: Boolean(state.runtimeConfig.apiKey),
                        source: state.runtimeConfig.source || 'stored',
                        model: state.runtimeConfig.model || 'gemini-2.0-flash',
                        apiKey: state.runtimeConfig.apiKey || '',
                        updatedAt: null,
                        updatedBy: 'admin-1'
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
        global.fetch = originalFetch;
        delete require.cache[handlerPath];
    }
}

test('gemini handler GET returns runtime config summary', async () => {
    await withGeminiHandler({
        runtimeConfig: {
            apiKey: 'AIzaSyTestGeminiKey12345678901234567890',
            model: 'gemini-2.5-flash'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(state.requireAdminCalls[0]?.options, {
            anyOf: ['prompts.manage', 'content.moderate']
        });
        assert.deepEqual(res.json(), {
            success: true,
            configured: true,
            source: 'stored',
            model: 'gemini-2.5-flash',
            adminId: 'admin-1'
        });
    });
});

test('gemini handler applies request budgets, truncates long text, and caps max output tokens', async () => {
    await withGeminiHandler({
        runtimeConfig: {
            apiKey: 'AIzaSyTestGeminiKey12345678901234567890',
            model: 'gemini-2.0-flash'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    candidates: [{
                        content: {
                            parts: [{ text: 'gemini ok' }]
                        }
                    }]
                };
            }
        })
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                contents: [{
                    parts: [{
                        text: 'x'.repeat(1200)
                    }]
                }],
                generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 600
                },
                budget: {
                    tier: 'lean',
                    maxInputChars: 1000,
                    maxOutputTokens: 120
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.fetchCalls.length, 1);
        assert.match(state.fetchCalls[0].input, /generateContent\?key=/);

        const upstreamBody = JSON.parse(state.fetchCalls[0].init.body);
        assert.equal(upstreamBody.contents[0].parts[0].text, 'x'.repeat(1000));
        assert.deepEqual(upstreamBody.generationConfig, {
            temperature: 0.4,
            maxOutputTokens: 120
        });
        assert.equal(res.json().text, 'gemini ok');
        assert.equal(res.json().budget.tier, 'lean');
        assert.equal(res.json().budget.inputChars, 1000);
        assert.equal(res.json().budget.truncated, true);
        assert.equal(res.json().budget.truncatedChars, 200);
    });
});

test('gemini handler rejects admin requests without an explicit budget tier', async () => {
    await withGeminiHandler({
        runtimeConfig: {
            apiKey: 'AIzaSyTestGeminiKey12345678901234567890',
            model: 'gemini-2.0-flash'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                contents: [{
                    parts: [{ text: 'missing budget' }]
                }]
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.equal(state.fetchCalls.length, 0);
        assert.match(res.json().message, /budget tier is required/i);
    });
});

test('gemini handler redacts upstream secrets from error payloads', async () => {
    await withGeminiHandler({
        runtimeConfig: {
            apiKey: 'AIzaSyTestGeminiKey12345678901234567890',
            model: 'gemini-2.0-flash'
        },
        fetchImpl: async () => ({
            ok: false,
            status: 502,
            async json() {
                return {
                    error: {
                        message: 'relay failed for Bearer abc.def.ghi and AIzaSySuperSecretValue123456789',
                        apiKey: 'AIzaSySuperSecretValue123456789'
                    }
                };
            }
        })
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                contents: [{
                    parts: [{ text: 'hello' }]
                }],
                budget: {
                    tier: 'lean'
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 502);
        assert.match(payload.message, /Bearer \[redacted\]/);
        assert.doesNotMatch(JSON.stringify(payload), /AIzaSySuperSecretValue/);
        assert.equal(payload.error.apiKey, '[redacted]');
    });
});
