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

async function withCodexHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/codex.js');
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
            if (response && typeof response === 'object') {
                if (typeof response.text !== 'function') {
                    response.text = async () => {
                        if (typeof response.bodyText === 'string') {
                            return response.bodyText;
                        }
                        if (typeof response.json === 'function') {
                            return JSON.stringify(await response.json());
                        }
                        return '';
                    };
                }

                if (typeof response.json !== 'function') {
                    response.json = async () => {
                        const text = await response.text();
                        return text ? JSON.parse(text) : {};
                    };
                }
            }
            return response;
        }

        return {
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({
                    choices: [{
                        message: {
                            content: 'default-codex-response'
                        }
                    }]
                });
            },
            async json() {
                return {
                    choices: [{
                        message: {
                            content: 'default-codex-response'
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
                async resolveCodexRuntimeConfig() {
                    return {
                        configured: Boolean(state.runtimeConfig.apiKey && state.runtimeConfig.baseUrl),
                        source: state.runtimeConfig.source || 'stored',
                        model: state.runtimeConfig.model || 'gpt-5-codex',
                        apiKey: state.runtimeConfig.apiKey || '',
                        baseUrl: state.runtimeConfig.baseUrl || '',
                        apiFormat: state.runtimeConfig.apiFormat || 'chat.completions',
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

test('codex handler GET returns runtime config summary', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com/v1',
            model: 'gpt-5-codex',
            apiFormat: 'chat.completions'
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
            model: 'gpt-5-codex',
            baseUrl: 'https://relay.example.com/v1',
            apiFormat: 'chat.completions',
            adminId: 'admin-1'
        });
    });
});

test('codex handler POST proxies prompt to an OpenAI-compatible chat completions relay', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com/v1',
            model: 'gpt-5-codex',
            apiFormat: 'chat.completions'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    id: 'chatcmpl_123',
                    choices: [{
                        message: {
                            content: 'hello from codex relay'
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
                prompt: 'Write a quick product description.',
                temperature: 0.2,
                maxTokens: 300,
                budget: {
                    tier: 'balanced'
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.fetchCalls.length, 1);
        assert.equal(state.fetchCalls[0].input, 'https://relay.example.com/v1/chat/completions');
        assert.equal(state.fetchCalls[0].init.headers.Authorization, 'Bearer sk-test-codex-1234567890');

        const upstreamBody = JSON.parse(state.fetchCalls[0].init.body);
        assert.deepEqual(upstreamBody, {
            model: 'gpt-5-codex',
            messages: [{
                role: 'user',
                content: 'Write a quick product description.'
            }],
            stream: false,
            temperature: 0.2,
            max_tokens: 300
        });

        assert.equal(res.json().success, true);
        assert.equal(res.json().text, 'hello from codex relay');
        assert.equal(res.json().apiFormat, 'chat.completions');
    });
});

test('codex handler supports responses-format relays', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    id: 'resp_123',
                    output_text: 'response api ok'
                };
            }
        })
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                messages: [{
                    role: 'user',
                    content: 'Summarize this issue.'
                }],
                maxTokens: 128,
                budget: {
                    tier: 'balanced'
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.fetchCalls[0].input, 'https://relay.example.com/v1/responses');

        const upstreamBody = JSON.parse(state.fetchCalls[0].init.body);
        assert.deepEqual(upstreamBody, {
            model: 'gpt-5.4',
            input: [{
                role: 'user',
                content: 'Summarize this issue.'
            }],
            max_output_tokens: 128
        });

        assert.equal(res.json().text, 'response api ok');
        assert.equal(res.json().apiFormat, 'responses');
    });
});

test('codex handler extracts chat-style text even when a responses relay returns chat-shaped payloads', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: [{
                                type: 'text',
                                text: '{"title":"test"}'
                            }]
                        }
                    }]
                };
            }
        })
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                messages: [{
                    role: 'user',
                    content: 'Describe this image.'
                }],
                budget: {
                    tier: 'balanced'
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().text, '{"title":"test"}');
    });
});

test('codex handler falls back to plain-text bodies when relay returns non-JSON success payloads', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            bodyText: '{"title":"plain text json"}'
        })
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                messages: [{
                    role: 'user',
                    content: 'Describe this image.'
                }],
                budget: {
                    tier: 'balanced'
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().text, '{"title":"plain text json"}');
    });
});

test('codex handler converts Gemini-style multimodal contents into responses input items', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    id: 'resp_vision_123',
                    output_text: '{"title":"Sample"}'
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
                    parts: [
                        { text: 'Describe this image' },
                        {
                            inline_data: {
                                mime_type: 'image/jpeg',
                                data: 'BASE64_IMAGE_DATA'
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 512
                },
                budget: {
                    tier: 'balanced'
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const upstreamBody = JSON.parse(state.fetchCalls[0].init.body);
        assert.deepEqual(upstreamBody, {
            model: 'gpt-5.4',
            input: [{
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Describe this image' },
                    { type: 'input_image', image_url: 'data:image/jpeg;base64,BASE64_IMAGE_DATA' }
                ]
            }],
            temperature: 0.7,
            max_output_tokens: 512
        });
        assert.equal(res.json().text, '{"title":"Sample"}');
    });
});

test('codex handler applies lean request budgets and Responses reasoning config', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            async json() {
                return {
                    id: 'resp_budget_123',
                    output_text: 'budget ok'
                };
            }
        })
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const longPrompt = 'x'.repeat(1200);

        await handler({
            method: 'POST',
            headers: {},
            body: {
                prompt: longPrompt,
                reasoning_effort: 'low',
                budget: {
                    tier: 'lean',
                    maxInputChars: 1000,
                    maxOutputTokens: 100
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const upstreamBody = JSON.parse(state.fetchCalls[0].init.body);
        assert.deepEqual(upstreamBody, {
            model: 'gpt-5.4',
            input: [{
                role: 'user',
                content: 'x'.repeat(1000)
            }],
            reasoning: {
                effort: 'low'
            },
            max_output_tokens: 100
        });
        assert.equal(res.json().budget.tier, 'lean');
        assert.equal(res.json().budget.inputChars, 1000);
        assert.equal(res.json().budget.truncated, true);
        assert.equal(res.json().budget.truncatedChars, 200);
    });
});

test('codex handler redacts upstream secrets from error payloads', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        },
        fetchImpl: async () => ({
            ok: false,
            status: 502,
            async json() {
                return {
                    error: {
                        message: 'relay failed for Bearer abc.def.ghi and sk-test-secret-1234567890',
                        apiKey: 'sk-test-secret-1234567890'
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
                prompt: 'hello',
                budget: {
                    tier: 'lean'
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 502);
        assert.match(payload.message, /Bearer \[redacted\]/);
        assert.doesNotMatch(JSON.stringify(payload), /sk-test-secret/);
        assert.equal(payload.error.apiKey, '[redacted]');
    });
});

test('codex handler rejects admin requests without an explicit budget tier', async () => {
    await withCodexHandler({
        runtimeConfig: {
            apiKey: 'sk-test-codex-1234567890',
            baseUrl: 'https://relay.example.com',
            model: 'gpt-5.4',
            apiFormat: 'responses'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                prompt: 'hello without budget'
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.equal(state.fetchCalls.length, 0);
        assert.match(res.json().message, /budget tier is required/i);
    });
});
