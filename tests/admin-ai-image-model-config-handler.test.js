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

async function withAiImageModelConfigHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/ai-image/model-config.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        auditCalls: [],
        upsertCalls: [],
        deleteCalls: [],
        fetchCalls: [],
        runtimeConfigQueue: Array.isArray(options.runtimeConfigQueue)
            ? options.runtimeConfigQueue.map((entry) => ({ ...entry }))
            : [{ ...(options.runtimeConfig || {}) }]
    };

    delete require.cache[handlerPath];
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
                AI_IMAGE_SECRET_KEY: 'ai_image_api_key',
                buildAiImageProviderSecretKey(providerId = '') {
                    return `ai_image_provider__${String(providerId || '').trim()}`;
                },
                async listStoredAiImageProviderSecrets() {
                    return state.upsertCalls
                        .filter((call) => String(call.secretKey || '').startsWith('ai_image_provider__'))
                        .map((call) => ({
                            configured: true,
                            source: 'stored',
                            secretKey: call.secretKey,
                            providerId: call.metadata.providerId,
                            label: call.metadata.label,
                            apiKey: call.secretValue,
                            baseUrl: call.metadata.baseUrl,
                            model: call.metadata.model,
                            models: call.metadata.models || [],
                            imageModels: call.metadata.imageModels || call.metadata.image_models || call.metadata.models || [],
                            chatModels: call.metadata.chatModels || call.metadata.chat_models || [],
                            videoModels: call.metadata.videoModels || call.metadata.video_models || [],
                            detectedImageModels: call.metadata.detectedImageModels || call.metadata.detected_image_models || [],
                            detectedChatModels: call.metadata.detectedChatModels || call.metadata.detected_chat_models || call.metadata.chatModels || call.metadata.chat_models || [],
                            detectedVideoModels: call.metadata.detectedVideoModels || call.metadata.detected_video_models || call.metadata.videoModels || call.metadata.video_models || [],
                            detectedUnknownModels: call.metadata.detectedUnknownModels || call.metadata.detected_unknown_models || [],
                            visionModels: call.metadata.visionModels || call.metadata.vision_models || [],
                            modelGroup: call.metadata.modelGroup || call.metadata.model_group || 'image',
                            vendor: call.metadata.vendor || 'openai',
                            vendorLabel: call.metadata.vendorLabel || call.metadata.vendor_label || '',
                            vendor_label: call.metadata.vendorLabel || call.metadata.vendor_label || '',
                            protocol: call.metadata.protocol || 'openai-compatible',
                            provider: call.metadata.provider || 'openai-compatible',
                            isActive: call.metadata.isActive !== false,
                            displayOrder: call.metadata.displayOrder || 0
                        }));
                },
                async resolveAiImageRuntimeSecretConfig() {
                    const next = state.runtimeConfigQueue.length > 1
                        ? state.runtimeConfigQueue.shift()
                        : state.runtimeConfigQueue[0];
                    return {
                        configured: Boolean(next?.apiKey && next?.baseUrl),
                        source: next?.source || 'missing',
                        model: next?.model || 'gpt-image-2',
                        apiKey: next?.apiKey || '',
                        baseUrl: next?.baseUrl || 'https://api.openai.com/v1',
                        updatedAt: next?.updatedAt || null,
                        decryptErrorMessage: next?.decryptErrorMessage || ''
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
        delete require.cache[handlerPath];
    }
}

test('ai image model config handler returns runtime summary without secrets', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-ai-image-secret-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({ method: 'GET', headers: {} }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.configured, true);
        assert.equal(payload.source, 'stored');
        assert.equal(payload.baseUrl, 'https://api.example.com/v1');
        assert.equal(payload.model, 'gpt-image-2');
        assert.equal(JSON.stringify(payload).includes('sk-ai-image-secret'), false);
        assert.equal(state.requireAdminCalls[0].config.permission, 'settings.manage');
    });
});

test('ai image model config handler keeps visible models empty when upstream is unconfigured', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'missing',
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({ method: 'GET', headers: {} }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.configured, false);
        assert.equal(payload.model, 'gpt-image-2');
        assert.deepEqual(payload.imageModels, []);
        assert.deepEqual(payload.detectedImageModels, []);
        assert.deepEqual(payload.chatModels, []);
        assert.deepEqual(payload.detectedChatModels, []);
        assert.deepEqual(payload.providers, []);
    });
});

test('ai image model config handler saves encrypted key and metadata', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfigQueue: [
            {
                source: 'missing',
                apiKey: '',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-image-2'
            },
            {
                source: 'stored',
                apiKey: 'sk-ai-image-secret-1234567890',
                baseUrl: 'https://api.example.com/v1',
                model: 'gpt-image-2'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                apiKey: 'sk-ai-image-secret-1234567890',
                baseUrl: 'https://api.example.com/v1/',
                model: ''
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.model, 'gpt-image-2');
        assert.equal(state.upsertCalls.length, 1);
        assert.equal(state.upsertCalls[0].secretKey, 'ai_image_api_key');
        assert.equal(state.upsertCalls[0].secretValue, 'sk-ai-image-secret-1234567890');
        assert.deepEqual(state.upsertCalls[0].metadata, {
            providerId: 'default',
            label: 'default',
            provider: 'openai-compatible',
            vendor: 'openai',
            protocol: 'openai-compatible',
            modelGroup: 'image',
            model_group: 'image',
            baseUrl: 'https://api.example.com/v1',
            model: '',
            models: [],
            imageModels: [],
            image_models: [],
            chatModels: [],
            chat_models: [],
            videoModels: [],
            video_models: [],
            detectedImageModels: [],
            detected_image_models: [],
            detectedChatModels: [],
            detected_chat_models: [],
            detectedVideoModels: [],
            detected_video_models: [],
            detectedUnknownModels: [],
            detected_unknown_models: [],
            visionModels: [],
            vision_models: [],
            isActive: true,
            displayOrder: 0,
            saved_via: 'admin_studio'
        });
        assert.equal(state.auditCalls[0].actionType, 'admin.ai_image_model_provider.upsert');
        assert.equal(JSON.stringify(payload).includes('sk-ai-image-secret'), false);
    });
});

test('ai image model config handler normalizes bare provider base URL to v1', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfigQueue: [
            {
                source: 'missing',
                apiKey: '',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-image-2'
            },
            {
                source: 'stored',
                apiKey: 'sk-ai-image-secret-1234567890',
                baseUrl: 'https://api.example.com/v1',
                model: 'gpt-image-2'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                apiKey: 'sk-ai-image-secret-1234567890',
                baseUrl: 'https://api.example.com',
                model: 'gpt-image-2'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.upsertCalls[0].metadata.baseUrl, 'https://api.example.com/v1');
    });
});

test('ai image model config handler updates metadata without re-entering stored key', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfigQueue: [
            {
                source: 'stored',
                apiKey: 'sk-existing-ai-image-key-1234567890',
                baseUrl: 'https://old.example.com/v1',
                model: 'gpt-image-2'
            },
            {
                source: 'stored',
                apiKey: 'sk-existing-ai-image-key-1234567890',
                baseUrl: 'https://new.example.com/v1',
                model: 'gpt-image-3'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                baseUrl: 'https://new.example.com/v1',
                model: 'gpt-image-3'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.upsertCalls.length, 1);
        assert.equal(state.upsertCalls[0].secretValue, 'sk-existing-ai-image-key-1234567890');
        assert.equal(state.upsertCalls[0].metadata.model, 'gpt-image-3');
    });
});

test('ai image model config handler can add an additional provider without replacing default key', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-default-ai-image-key-1234567890',
            baseUrl: 'https://default.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                providerId: 'flux',
                label: 'FLUX 上游',
                apiKey: 'sk-flux-provider-key-1234567890',
                baseUrl: 'https://flux.example.com/v1',
                model: 'flux-pro',
                models: 'flux-pro,flux-kontext',
                imageModels: 'flux-pro,flux-kontext',
                displayOrder: 20
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.upsertCalls.length, 1);
        assert.equal(state.upsertCalls[0].secretKey, 'ai_image_provider__flux');
        assert.equal(state.upsertCalls[0].secretValue, 'sk-flux-provider-key-1234567890');
        assert.equal(state.upsertCalls[0].metadata.providerId, 'flux');
        assert.equal(state.upsertCalls[0].metadata.model, 'flux-pro');
        assert.deepEqual(state.upsertCalls[0].metadata.models, ['flux-pro', 'flux-kontext']);
        assert.deepEqual(state.upsertCalls[0].metadata.imageModels, ['flux-pro', 'flux-kontext']);
        assert.equal(state.upsertCalls[0].metadata.modelGroup, 'image');
        assert.equal(payload.providers.some((provider) => provider.providerId === 'flux'), true);
        assert.equal(JSON.stringify(payload).includes('sk-flux-provider-key'), false);
    });
});

test('ai image model config handler preserves custom vendor label', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-default-ai-image-key-1234567890',
            baseUrl: 'https://default.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                providerId: 'openrouter',
                label: 'OpenRouter 上游',
                apiKey: 'sk-openrouter-provider-key-1234567890',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'custom-creative-model',
                modelGroup: 'chat',
                vendor: 'custom',
                vendorLabel: 'OpenRouter',
                chatModels: 'custom-creative-model'
            }
        }, res);

        const payload = res.json();
        const savedProvider = payload.providers.find((provider) => provider.providerId === 'openrouter');
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.upsertCalls[0].metadata.vendor, 'custom');
        assert.equal(state.upsertCalls[0].metadata.vendorLabel, 'OpenRouter');
        assert.equal(state.upsertCalls[0].metadata.vendor_label, 'OpenRouter');
        assert.equal(savedProvider.vendor, 'custom');
        assert.equal(savedProvider.vendorLabel, 'OpenRouter');
        assert.equal(savedProvider.vendor_label, 'OpenRouter');
    });
});

test('ai image model config handler saves chat vision provider metadata', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-default-ai-image-key-1234567890',
            baseUrl: 'https://default.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                providerId: 'openai-chat',
                label: 'OpenAI Chat',
                apiKey: 'sk-chat-provider-key-1234567890',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o-mini',
                modelGroup: 'chat',
                vendor: 'openai',
                protocol: 'openai-compatible',
                chatModels: 'gpt-4o-mini,gpt-4.1',
                visionModels: 'gpt-4o-mini'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.upsertCalls[0].secretKey, 'ai_image_provider__openai-chat');
        assert.equal(state.upsertCalls[0].metadata.modelGroup, 'chat');
        assert.equal(state.upsertCalls[0].metadata.vendor, 'openai');
        assert.equal(state.upsertCalls[0].metadata.protocol, 'openai-compatible');
        assert.deepEqual(state.upsertCalls[0].metadata.chatModels, ['gpt-4o-mini', 'gpt-4.1']);
        assert.deepEqual(state.upsertCalls[0].metadata.visionModels, ['gpt-4o-mini']);
        assert.deepEqual(payload.providers.find((provider) => provider.providerId === 'openai-chat').visionModels, ['gpt-4o-mini']);
        assert.equal(JSON.stringify(payload).includes('sk-chat-provider-key'), false);
    });
});

test('ai image model config handler respects explicit image group and drops stale chat models', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-default-ai-image-key-1234567890',
            baseUrl: 'https://default.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                providerId: 'mixed-default',
                label: 'Default',
                apiKey: 'sk-default-ai-image-key-1234567890',
                baseUrl: 'https://sub2api.fatherkey.com/v1',
                model: 'gpt-image-2',
                modelGroup: 'image',
                imageModels: 'gpt-image-2',
                chatModels: 'gpt-4o-mini,gpt-4.1'
            }
        }, res);

        const payload = res.json();
        const savedProvider = payload.providers.find((provider) => provider.providerId === 'mixed-default');
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.upsertCalls[0].metadata.modelGroup, 'image');
        assert.deepEqual(state.upsertCalls[0].metadata.imageModels, ['gpt-image-2']);
        assert.deepEqual(state.upsertCalls[0].metadata.chatModels, []);
        assert.equal(savedProvider.modelGroup, 'image');
        assert.deepEqual(savedProvider.chatModels, []);
    });
});

test('ai image model config handler saves mixed provider only when both is explicit', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-default-ai-image-key-1234567890',
            baseUrl: 'https://default.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                providerId: 'mixed-default',
                label: 'Default',
                apiKey: 'sk-default-ai-image-key-1234567890',
                baseUrl: 'https://sub2api.fatherkey.com/v1',
                model: 'gpt-image-2',
                modelGroup: 'both',
                imageModels: 'gpt-image-2',
                chatModels: 'gpt-4o-mini,gpt-4.1'
            }
        }, res);

        const payload = res.json();
        const savedProvider = payload.providers.find((provider) => provider.providerId === 'mixed-default');
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.upsertCalls[0].metadata.modelGroup, 'both');
        assert.deepEqual(state.upsertCalls[0].metadata.imageModels, ['gpt-image-2']);
        assert.deepEqual(state.upsertCalls[0].metadata.chatModels, ['gpt-4o-mini', 'gpt-4.1']);
        assert.equal(savedProvider.modelGroup, 'both');
        assert.deepEqual(savedProvider.chatModels, ['gpt-4o-mini', 'gpt-4.1']);
    });
});

test('ai image model config handler persists detected candidates separately from visible models', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-default-ai-image-key-1234567890',
            baseUrl: 'https://default.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                providerId: 'gemini',
                label: 'Gemini',
                apiKey: 'sk-gemini-provider-key-1234567890',
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                model: 'imagen-4.0-generate-preview-06-06',
                vendor: 'gemini',
                protocol: 'gemini-native',
                modelGroup: 'both',
                imageModels: 'imagen-4.0-generate-preview-06-06',
                chatModels: 'gemini-2.5-flash',
                detectedImageModels: 'imagen-4.0-generate-preview-06-06,imagen-4.0-ultra-generate-preview-06-06',
                detectedChatModels: 'gemini-2.5-flash,gemini-2.5-pro',
                detectedUnknownModels: 'embedding-001'
            }
        }, res);

        const payload = res.json();
        const savedProvider = payload.providers.find((provider) => provider.providerId === 'gemini');
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(state.upsertCalls[0].metadata.imageModels, ['imagen-4.0-generate-preview-06-06']);
        assert.deepEqual(state.upsertCalls[0].metadata.chatModels, ['gemini-2.5-flash']);
        assert.deepEqual(state.upsertCalls[0].metadata.detectedImageModels, [
            'imagen-4.0-generate-preview-06-06',
            'imagen-4.0-ultra-generate-preview-06-06'
        ]);
        assert.deepEqual(state.upsertCalls[0].metadata.detectedChatModels, ['gemini-2.5-flash', 'gemini-2.5-pro']);
        assert.deepEqual(state.upsertCalls[0].metadata.detectedUnknownModels, ['embedding-001']);
        assert.deepEqual(savedProvider.imageModels, ['imagen-4.0-generate-preview-06-06']);
        assert.deepEqual(savedProvider.chatModels, ['gemini-2.5-flash']);
        assert.deepEqual(savedProvider.detectedImageModels, [
            'imagen-4.0-generate-preview-06-06',
            'imagen-4.0-ultra-generate-preview-06-06'
        ]);
        assert.deepEqual(savedProvider.detectedChatModels, ['gemini-2.5-flash', 'gemini-2.5-pro']);
    });
});

test('ai image model config handler requires key before first save', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'missing',
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                baseUrl: 'https://api.example.com/v1',
                model: 'gpt-image-2'
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.equal(state.upsertCalls.length, 0);
        assert.match(res.json().message, /请先录入有效的 AI 图片 API Key/);
    });
});

test('ai image model config handler runs availability probe without leaking key', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'probe-task-1',
                    data: [{
                        b64_json: Buffer.from('probe-image').toString('base64')
                    }]
                })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'test-model',
                    baseUrl: 'https://api.example.com',
                    model: 'gpt-image'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.check.ok, true);
        assert.equal(payload.check.baseUrl, 'https://api.example.com/v1');
        assert.equal(payload.check.model, 'gpt-image-2');
        assert.equal(payload.check.resultType, 'base64');
        assert.equal(state.fetchCalls[0].url, 'https://api.example.com/v1/images/generations');
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
        assert.match(payload.message, /返回结果/);
    });
});

test('ai image model config handler runs matrix probe for generation and edit resolutions', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: `probe-task-${state.fetchCalls.length}`,
                    data: [{
                        b64_json: Buffer.from('probe-image').toString('base64')
                    }]
                })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'test-model',
                    matrix: true,
                    modes: ['text', 'image'],
                    resolutions: ['1k', '4k'],
                    baseUrl: 'https://api.example.com',
                    model: 'gpt-image-2'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.check.ok, true);
        assert.equal(payload.check.total, 4);
        assert.equal(payload.check.passed, 4);
        assert.equal(payload.check.failed, 0);
        assert.equal(payload.check.checks.length, 4);
        assert.deepEqual(state.fetchCalls.map((call) => call.url), [
            'https://api.example.com/v1/images/generations',
            'https://api.example.com/v1/images/generations',
            'https://api.example.com/v1/images/edits',
            'https://api.example.com/v1/images/edits'
        ]);
        assert.equal(JSON.parse(state.fetchCalls[0].options.body).size, '1024x1024');
        assert.equal(JSON.parse(state.fetchCalls[1].options.body).size, '2880x2880');
        assert.equal(state.fetchCalls[2].options.body instanceof FormData, true);
        assert.equal(state.fetchCalls[3].options.body instanceof FormData, true);
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
    });
});

test('ai image model config handler runs chat and vision probes for chat model group', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name) {
                        const headers = {
                            'x-sub2api-channel-id': 'channel-7',
                            'x-sub2api-channel-name': 'OpenAI direct',
                            'x-request-id': 'req-chat-probe'
                        };
                        return headers[String(name || '').toLowerCase()] || '';
                    }
                },
                text: async () => JSON.stringify({
                    id: `chat-probe-${state.fetchCalls.length}`,
                    choices: [{
                        message: { content: '模型可用' }
                    }]
                })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'test-model',
                    matrix: true,
                    modelGroup: 'chat',
                    chatModels: 'gpt-4o-mini',
                    baseUrl: 'https://api.example.com/v1',
                    model: 'gpt-4o-mini'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.check.total, 2);
        assert.deepEqual(payload.check.checks.map((item) => item.mode), ['chat', 'vision']);
        assert.deepEqual(payload.check.visionModels, ['gpt-4o-mini']);
        assert.deepEqual(payload.check.vision_models, ['gpt-4o-mini']);
        assert.equal(payload.check.checks[0].upstream.channelId, 'channel-7');
        assert.equal(payload.check.checks[0].upstream.channelName, 'OpenAI direct');
        assert.equal(payload.check.checks[0].upstream.requestId, 'req-chat-probe');
        assert.deepEqual(state.fetchCalls.map((call) => call.url), [
            'https://api.example.com/v1/chat/completions',
            'https://api.example.com/v1/chat/completions'
        ]);
        assert.equal(JSON.parse(state.fetchCalls[1].options.body).messages[0].content[1].type, 'image_url');
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
    });
});

test('ai image model config handler discovers upstream models during probe', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            if (String(url).endsWith('/models')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        data: [
                            { id: 'gpt-image-2', object: 'model' },
                            { id: 'gpt-4o-mini', object: 'model' },
                            { id: 'gpt-4.1', object: 'model' }
                        ]
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: `probe-${state.fetchCalls.length}`,
                    choices: [{
                        message: { content: '模型可用' }
                    }]
                })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'test-model',
                    matrix: true,
                    discoverModels: true,
                    modelGroup: 'chat',
                    chatModels: 'gpt-5.5',
                    baseUrl: 'https://api.example.com/v1',
                    model: 'gpt-5.5'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.check.discovery.ok, true);
        assert.deepEqual(payload.check.discovery.chatModels, ['gpt-4o-mini', 'gpt-4.1']);
        assert.deepEqual(payload.check.discovery.imageModels, ['gpt-image-2']);
        assert.deepEqual(payload.check.modelPresence.chat.missing, ['gpt-5.5']);
        assert.equal(payload.check.modelPresence.chat.listed, false);
        assert.equal(state.fetchCalls[0].url, 'https://api.example.com/v1/models');
        assert.deepEqual(state.fetchCalls.slice(1).map((call) => call.url), [
            'https://api.example.com/v1/chat/completions',
            'https://api.example.com/v1/chat/completions'
        ]);
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
    });
});

test('ai image model config handler discovers upstream models without running probes', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [
                        { id: 'gpt-image-2', object: 'model' },
                        { id: 'gpt-4o-mini', object: 'model' },
                        { id: 'unknown-provider-model', object: 'model' }
                    ]
                })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'discover-models',
                    baseUrl: 'https://api.example.com/v1',
                    model: 'gpt-image-2'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.discovery.ok, true);
        assert.deepEqual(payload.discovery.imageModels, ['gpt-image-2']);
        assert.deepEqual(payload.discovery.chatModels, ['gpt-4o-mini']);
        assert.deepEqual(payload.discovery.unknownModels, ['unknown-provider-model']);
        assert.deepEqual(state.fetchCalls.map((call) => call.url), ['https://api.example.com/v1/models']);
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
    });
});

test('ai image model config handler treats video-only upstream models as usable discovery results', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'jimeng-vgfm'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [
                        { id: 'jimeng-vgfm', object: 'model' },
                        { id: 'seedance-1-0-pro', object: 'model' }
                    ]
                })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'discover-models',
                    baseUrl: 'https://api.example.com/v1',
                    model: 'jimeng-vgfm'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.discovery.ok, true);
        assert.deepEqual(payload.discovery.imageModels, []);
        assert.deepEqual(payload.discovery.chatModels, []);
        assert.deepEqual(payload.discovery.videoModels, ['jimeng-vgfm', 'seedance-1-0-pro']);
        assert.match(payload.message, /发现 2 个模型/);
        assert.deepEqual(state.fetchCalls.map((call) => call.url), ['https://api.example.com/v1/models']);
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
    });
});

test('ai image model config handler classifies Gemini image models before generic content methods', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            model: 'gemini-3.1-flash-image'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    models: [
                        {
                            name: 'models/gemini-3.1-flash-image',
                            displayName: 'Gemini 3.1 Flash Image',
                            supportedGenerationMethods: ['generateContent']
                        },
                        {
                            name: 'models/gemini-3-pro-image-preview',
                            displayName: 'Gemini 3 Pro Image Preview',
                            supportedGenerationMethods: ['generateContent']
                        },
                        {
                            name: 'models/gemini-3-pro-preview',
                            displayName: 'Gemini 3 Pro Preview',
                            supportedGenerationMethods: ['generateContent']
                        }
                    ]
                })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'discover-models',
                    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                    protocol: 'gemini-native',
                    model: 'gemini-3.1-flash-image'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.discovery.ok, true);
        assert.deepEqual(payload.discovery.imageModels, [
            'gemini-3.1-flash-image',
            'gemini-3-pro-image-preview'
        ]);
        assert.deepEqual(payload.discovery.chatModels, ['gemini-3-pro-preview']);
        assert.deepEqual(payload.discovery.unknownModels, []);
        assert.deepEqual(state.fetchCalls.map((call) => {
            const url = new URL(call.url);
            return `${url.origin}${url.pathname}`;
        }), ['https://generativelanguage.googleapis.com/v1beta/models']);
    });
});

test('ai image model config handler matrix probe reports partial failures without leaking key', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, options = {}) => {
            state.fetchCalls.push({ url: String(url), options });
            const isEdit = String(url).includes('/images/edits');
            return {
                ok: !isEdit,
                status: isEdit ? 503 : 200,
                text: async () => JSON.stringify(isEdit
                    ? { error: { code: 'temporarily_unavailable', message: 'Upstream service temporarily unavailable' } }
                    : { data: [{ b64_json: Buffer.from('probe-image').toString('base64') }] })
            };
        };

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'test-model',
                    matrix: true,
                    modes: ['text', 'image'],
                    resolutions: ['1k'],
                    baseUrl: 'https://api.example.com/v1',
                    model: 'gpt-image-2'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 207);
        assert.equal(payload.success, false);
        assert.equal(payload.check.ok, false);
        assert.equal(payload.check.total, 2);
        assert.equal(payload.check.passed, 1);
        assert.equal(payload.check.failed, 1);
        assert.equal(payload.check.checks[1].mode, 'image');
        assert.equal(payload.check.checks[1].code, 'temporarily_unavailable');
        assert.match(payload.check.checks[1].message, /temporarily unavailable/i);
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
    });
});

test('ai image model config handler reports availability probe upstream failure safely', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfig: {
            source: 'stored',
            apiKey: 'sk-existing-ai-image-key-1234567890',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2'
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: false,
            status: 504,
            text: async () => JSON.stringify({
                error: {
                    code: 'upstream_timeout',
                    message: 'provider timeout'
                }
            })
        });

        try {
            await handler({
                method: 'POST',
                headers: {},
                body: {
                    action: 'test-model',
                    baseUrl: 'https://api.example.com/v1',
                    model: 'gpt-image-2'
                }
            }, res);
        } finally {
            globalThis.fetch = originalFetch;
        }

        const payload = res.json();
        assert.equal(res.statusCode, 504);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'upstream_timeout');
        assert.match(payload.message, /provider timeout/);
        assert.equal(JSON.stringify(payload).includes('sk-existing-ai-image-key'), false);
    });
});

test('ai image model config handler deletes only stored config', async () => {
    await withAiImageModelConfigHandler({
        runtimeConfigQueue: [
            {
                source: 'stored',
                apiKey: 'sk-existing-ai-image-key-1234567890',
                baseUrl: 'https://api.example.com/v1',
                model: 'gpt-image-2'
            },
            {
                source: 'missing',
                apiKey: '',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-image-2'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({ method: 'DELETE', headers: {} }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.deleteCalls.length, 1);
        assert.equal(state.deleteCalls[0].secretKey, 'ai_image_api_key');
        assert.equal(state.auditCalls[0].actionType, 'admin.ai_image_model_provider.delete');
        assert.equal(res.json().success, true);
    });
});
