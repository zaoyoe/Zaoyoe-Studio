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
            state.headers[String(name || '').toLowerCase()] = value;
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

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        payload: null,
        filters: [],
        order: [],
        limit: null,
        selectOptions: {},
        singleMode: ''
    };

    const builder = {
        select(fields = '*', options = {}) {
            state.selectFields = fields;
            state.selectOptions = options && typeof options === 'object' ? options : {};
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        upsert(payload, options = {}) {
            state.mode = 'upsert';
            state.payload = payload;
            state.upsertOptions = options && typeof options === 'object' ? options : {};
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        in(column, value) {
            state.filters.push({ op: 'in', column, value: Array.isArray(value) ? value : [value] });
            return builder;
        },
        order(column, options = {}) {
            state.order.push({ column, ascending: options.ascending !== false });
            return builder;
        },
        limit(value) {
            state.limit = Number(value) || 0;
            return builder;
        },
        single() {
            state.singleMode = 'single';
            return builder;
        },
        maybeSingle() {
            state.singleMode = 'maybeSingle';
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function applyFilters(rows = [], filters = []) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') return row[column] === value;
        if (op === 'in') return value.includes(row[column]);
        return true;
    }));
}

function createSupabaseStub(state = {}) {
    state.agents = Array.isArray(state.agents) ? state.agents : [];
    state.pricing = Array.isArray(state.pricing) ? state.pricing : [];
    state.apiBaseUrls = Array.isArray(state.apiBaseUrls) ? state.apiBaseUrls : [];
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    state.results = Array.isArray(state.results) ? state.results : [];
    state.systemConfig = Array.isArray(state.systemConfig) ? state.systemConfig : [];
    state.inserted = Array.isArray(state.inserted) ? state.inserted : [];
    state.upserted = Array.isArray(state.upserted) ? state.upserted : [];
    state.updated = Array.isArray(state.updated) ? state.updated : [];
    state.fromCalls = Array.isArray(state.fromCalls) ? state.fromCalls : [];
    state.agentSeq = state.agentSeq || 1;
    state.pricingSeq = state.pricingSeq || 1;
    state.apiBaseSeq = state.apiBaseSeq || 1;
    const missingTables = new Set(Array.isArray(state.missingTables) ? state.missingTables : []);

    return {
        from(table) {
            state.fromCalls.push(table);
            return createQueryBuilder(async (query) => {
                if (missingTables.has(table)) {
                    return {
                        data: null,
                        error: {
                            code: 'PGRST205',
                            message: `Could not find the table 'public.${table}' in the schema cache`
                        }
                    };
                }

                const rows = table === 'ai_image_agents'
                    ? state.agents
                    : table === 'ai_image_pricing_rules'
                        ? state.pricing
                        : table === 'ai_image_api_base_urls'
                            ? state.apiBaseUrls
                            : table === 'ai_image_tasks'
                                ? state.tasks
                                : table === 'ai_image_results'
                                    ? state.results
                                    : table === 'system_config'
                                        ? state.systemConfig
                                        : null;
                if (!rows) {
                    throw new Error(`Unexpected table: ${table}`);
                }

                if (query.mode === 'insert') {
                    const prefix = table === 'ai_image_agents'
                        ? 'agent'
                        : (table === 'ai_image_api_base_urls' ? 'api-base' : 'pricing');
                    const seq = table === 'ai_image_agents'
                        ? state.agentSeq++
                        : (table === 'ai_image_api_base_urls' ? state.apiBaseSeq++ : state.pricingSeq++);
                    const inserted = {
                        id: query.payload.id || `${prefix}-00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
                        created_at: '2026-06-21T12:00:00.000Z',
                        updated_at: '2026-06-21T12:00:00.000Z',
                        ...clone(query.payload)
                    };
                    rows.unshift(inserted);
                    state.inserted.push({ table, payload: clone(query.payload), row: clone(inserted) });
                    return {
                        data: query.singleMode ? inserted : [inserted],
                        error: null
                    };
                }

                if (query.mode === 'update') {
                    const matched = applyFilters(rows, query.filters);
                    matched.forEach((row) => {
                        Object.assign(row, clone(query.payload), {
                            updated_at: '2026-06-21T12:01:00.000Z'
                        });
                    });
                    state.updated.push({ table, payload: clone(query.payload), filters: clone(query.filters) });
                    const first = matched[0] || null;
                    return {
                        data: query.singleMode ? first : matched,
                        error: first ? null : { message: 'not found' }
                    };
                }

                if (query.mode === 'upsert') {
                    if (table !== 'system_config') {
                        throw new Error(`Unexpected upsert table: ${table}`);
                    }
                    const payload = clone(query.payload);
                    const existing = rows.find((row) => String(row.config_key || '') === String(payload.config_key || ''));
                    if (existing) {
                        Object.assign(existing, payload);
                    } else {
                        rows.unshift({
                            created_at: '2026-06-21T12:00:00.000Z',
                            ...payload
                        });
                    }
                    state.upserted.push({ table, payload, options: clone(query.upsertOptions || {}) });
                    return {
                        data: query.singleMode ? (existing || rows[0]) : rows.map(clone),
                        error: null
                    };
                }

                let output = applyFilters(rows, query.filters);
                query.order.slice().reverse().forEach((order) => {
                    output = output.slice().sort((a, b) => {
                        const left = String(a?.[order.column] || '');
                        const right = String(b?.[order.column] || '');
                        return order.ascending ? left.localeCompare(right) : right.localeCompare(left);
                    });
                });
                if (query.limit) {
                    output = output.slice(0, query.limit);
                }
                if (query.selectOptions?.head) {
                    return {
                        data: null,
                        count: output.length,
                        error: null
                    };
                }
                if (query.singleMode === 'single' || query.singleMode === 'maybeSingle') {
                    return {
                        data: output[0] || null,
                        error: null
                    };
                }
                return {
                    data: output.map(clone),
                    error: null
                };
            });
        }
    };
}

async function withHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/ai-image/config.js');
    const originalLoad = Module._load;
    const state = options.state || {};
    const supabase = createSupabaseStub(state);
    state.auditEntries = Array.isArray(state.auditEntries) ? state.auditEntries : [];
    state.requireAdminCalls = Array.isArray(state.requireAdminCalls) ? state.requireAdminCalls : [];

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase,
                        user: { id: options.userId || 'admin-user-1' }
                    };
                },
                async parseJsonBody() {
                    return options.body || {};
                },
                sendJson,
                async writeAdminAuditLog(entry) {
                    state.auditEntries.push(clone(entry));
                }
            };
        }
        if (request === '../../_ai-image-models' && options.aiImageModelsMock) {
            return options.aiImageModelsMock;
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback({ handler, state, supabase });
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('admin ai image config lists agents and pricing for selected site plus global rules', async () => {
    const state = {
        agents: [
            {
                id: 'agent-cn',
                site: 'cn',
                slug: 'portrait-cutout',
                name: '抠人像',
                mode: 'agent',
                default_resolution: '1k',
                default_ratio: '1:1',
                pricing_override: {},
                metadata: {},
                is_active: true,
                display_order: 2
            },
            {
                id: 'agent-intl',
                site: 'intl',
                slug: 'intl-only',
                name: 'Intl',
                mode: 'agent',
                default_resolution: '1k',
                default_ratio: '1:1',
                pricing_override: {},
                metadata: {},
                is_active: true,
                display_order: 1
            },
            {
                id: 'agent-global',
                site: 'all',
                slug: 'upscale',
                name: '高清修复',
                mode: 'agent',
                default_resolution: '2k',
                default_ratio: '1:1',
                pricing_override: {},
                metadata: {},
                is_active: true,
                display_order: 0
            }
        ],
        pricing: [
            {
                id: 'pricing-cn',
                site: 'cn',
                mode: 'text',
                billing_mode: 'points',
                model: 'gpt-image-1',
                resolution: '2k',
                ratio: '16:9',
                quantity: 1,
                points: 18,
                priority: 10,
                metadata: {},
                is_active: true
            },
            {
                id: 'pricing-intl',
                site: 'intl',
                mode: 'text',
                billing_mode: 'points',
                model: 'gpt-image-1',
                resolution: '2k',
                ratio: '16:9',
                quantity: 1,
                points: 18,
                priority: 10,
                metadata: {},
                is_active: true
            }
        ],
        apiBaseUrls: [
            {
                id: 'api-base-cn',
                site: 'cn',
                label: 'FatherKey Sub2API',
                base_url: 'https://sub2api.fatherkey.com/v1',
                is_active: true,
                display_order: 10,
                metadata: {}
            },
            {
                id: 'api-base-global',
                site: 'all',
                label: 'Global Sub2API',
                base_url: 'https://sub2api.example.com/v1',
                is_active: true,
                display_order: 20,
                metadata: {}
            },
            {
                id: 'api-base-intl',
                site: 'intl',
                label: 'Zaoyoe Sub2API',
                base_url: 'https://sub2api.zaoyoe.xyz/v1',
                is_active: true,
                display_order: 30,
                metadata: {}
            }
        ]
    };

    await withHandler({ state }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/ai-image/config?site=cn' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(payload.agents.map((agent) => agent.id).sort(), ['agent-cn', 'agent-global']);
        assert.deepEqual(payload.pricing.map((rule) => rule.id), ['pricing-cn']);
        assert.deepEqual(payload.api_base_urls.map((item) => item.id).sort(), ['api-base-cn', 'api-base-global']);
        assert.equal(payload.guardrails.submit.user.limit, 12);
        assert.equal(payload.guardrails.tasks.running, 2);
        assert.deepEqual(state.requireAdminCalls[0].config.anyOf, ['settings.manage', 'prompts.manage']);
    });
});

test('admin ai image config reads site scoped guardrails from system config', async () => {
    const state = {
        systemConfig: [{
            config_key: 'ai_image_guardrails',
            config_value: {
                __site_scoped: true,
                default: {
                    submit: {
                        user: { limit: 12, windowMs: 60000 }
                    },
                    tasks: {
                        running: 2,
                        queued: 5,
                        active: 6
                    }
                },
                sites: {
                    cn: {
                        submit: {
                            user: { limit: 5, windowMs: 30000 },
                            ip: { limit: 15, windowMs: 60000 }
                        },
                        tasks: {
                            running: 1,
                            queued: 3,
                            active: 4
                        }
                    }
                }
            }
        }]
    };

    await withHandler({ state }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/ai-image/config?site=cn' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.guardrails.submit.user.limit, 5);
        assert.equal(payload.guardrails.submit.user.windowMs, 30000);
        assert.equal(payload.guardrails.submit.ip.limit, 15);
        assert.equal(payload.guardrails.tasks.running, 1);
        assert.equal(payload.guardrails.tasks.queued, 3);
    });
});

test('admin ai image config returns estimated R2 usage and storage policy', async () => {
    const state = {
        systemConfig: [{
            config_key: 'ai_image_storage_policy',
            config_value: {
                __site_scoped: true,
                default: {
                    previewRetentionDays: 90,
                    originalRetentionDays: 180,
                    failedRetentionDays: 14,
                    warnStorageGb: 0.001,
                    stopStorageGb: 0.002,
                    lifecycleEnabled: false
                },
                sites: {}
            }
        }],
        results: [
            {
                id: 'result-cn-1',
                site: 'cn',
                image_url: 'https://cdn.example.com/ai-images/preview-1.webp',
                original_image_url: 'https://cdn.example.com/ai-images/original-1.png',
                storage_path: 'ai-images/preview-1.webp',
                original_storage_path: 'ai-images/original-1.png',
                metadata: {
                    preview_bytes: 1000,
                    original_bytes: 4000,
                    original_status: 'ready'
                },
                created_at: '2026-06-21T10:00:00.000Z'
            },
            {
                id: 'result-cn-2',
                site: 'cn',
                image_url: 'https://cdn.example.com/ai-images/preview-2.webp',
                original_image_url: '',
                storage_path: 'ai-images/preview-2.webp',
                original_storage_path: '',
                metadata: {
                    preview_bytes: 500,
                    original_status: 'pending'
                },
                created_at: '2026-06-21T10:01:00.000Z'
            },
            {
                id: 'result-cn-3',
                site: 'cn',
                image_url: 'https://cdn.example.com/ai-images/legacy-preview.png',
                original_image_url: 'https://cdn.example.com/ai-images/legacy-original.png',
                storage_path: 'ai-images/legacy-preview.png',
                original_storage_path: 'ai-images/legacy-original.png',
                metadata: {},
                created_at: '2026-06-21T10:02:00.000Z'
            },
            {
                id: 'result-intl-1',
                site: 'intl',
                image_url: 'https://cdn.example.com/ai-images/intl-preview.webp',
                original_image_url: 'https://cdn.example.com/ai-images/intl-original.png',
                storage_path: 'ai-images/intl-preview.webp',
                original_storage_path: 'ai-images/intl-original.png',
                metadata: {
                    preview_bytes: 9000,
                    original_bytes: 9000
                },
                created_at: '2026-06-21T10:03:00.000Z'
            }
        ]
    };

    await withHandler({ state }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/ai-image/config?site=cn' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.storage_policy.previewRetentionDays, 90);
        assert.equal(payload.storage_policy.originalRetentionDays, 180);
        assert.equal(payload.storage_usage.sampled_results, 3);
        assert.equal(payload.storage_usage.preview_objects, 3);
        assert.equal(payload.storage_usage.original_objects, 2);
        assert.equal(payload.storage_usage.preview_bytes, 1500);
        assert.equal(payload.storage_usage.original_bytes, 4000);
        assert.equal(payload.storage_usage.total_bytes, 5500);
        assert.equal(payload.storage_usage.pending_originals, 1);
        assert.equal(payload.storage_usage.unknown_preview_objects, 1);
        assert.equal(payload.storage_usage.unknown_original_objects, 1);
    });
});

test('admin ai image config returns sanitized runtime and queue health', async () => {
    const originalEnv = {
        AI_IMAGE_API_KEY: process.env.AI_IMAGE_API_KEY,
        AI_IMAGE_API_BASE_URL: process.env.AI_IMAGE_API_BASE_URL,
        AI_IMAGE_MODEL: process.env.AI_IMAGE_MODEL,
        AI_IMAGE_R2_ENDPOINT: process.env.AI_IMAGE_R2_ENDPOINT,
        AI_IMAGE_R2_ACCESS_KEY_ID: process.env.AI_IMAGE_R2_ACCESS_KEY_ID,
        AI_IMAGE_R2_SECRET_ACCESS_KEY: process.env.AI_IMAGE_R2_SECRET_ACCESS_KEY,
        AI_IMAGE_R2_BUCKET_NAME: process.env.AI_IMAGE_R2_BUCKET_NAME,
        AI_IMAGE_R2_PUBLIC_URL: process.env.AI_IMAGE_R2_PUBLIC_URL
    };
    Object.assign(process.env, {
        AI_IMAGE_API_KEY: 'sk-live-secret-value',
        AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
        AI_IMAGE_MODEL: 'gpt-image',
        AI_IMAGE_R2_ENDPOINT: 'https://r2.example.com',
        AI_IMAGE_R2_ACCESS_KEY_ID: 'r2-access',
        AI_IMAGE_R2_SECRET_ACCESS_KEY: 'r2-secret',
        AI_IMAGE_R2_BUCKET_NAME: 'ai-images',
        AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.example.com'
    });

    const state = {
        tasks: [
            {
                id: 'task-queued-old',
                site: 'cn',
                status: 'queued',
                mode: 'text',
                billing_mode: 'points',
                model: 'gpt-image-2',
                resolution: '2k',
                ratio: '16:9',
                created_at: '2026-06-21T10:00:00.000Z',
                updated_at: '2026-06-21T10:00:00.000Z'
            },
            {
                id: 'task-running',
                site: 'cn',
                status: 'running',
                mode: 'image',
                billing_mode: 'points',
                model: 'gpt-image-2',
                resolution: '1k',
                ratio: '1:1',
                created_at: '2026-06-21T10:03:00.000Z',
                updated_at: '2026-06-21T10:03:00.000Z'
            },
            {
                id: 'task-failed-recent',
                site: 'cn',
                status: 'failed',
                mode: 'text',
                billing_mode: 'points',
                model: 'gpt-image-2',
                resolution: '4k',
                ratio: '9:16',
                error_code: 'provider_429',
                error_message: 'rate limited',
                created_at: '2026-06-21T10:02:00.000Z',
                updated_at: '2026-06-21T10:05:00.000Z',
                completed_at: '2026-06-21T10:05:00.000Z'
            },
            {
                id: 'task-intl-queued',
                site: 'intl',
                status: 'queued',
                mode: 'text',
                billing_mode: 'points',
                model: 'gpt-image-2',
                created_at: '2026-06-21T09:00:00.000Z',
                updated_at: '2026-06-21T09:00:00.000Z'
            }
        ]
    };

    try {
        await withHandler({ state }, async ({ handler }) => {
            const res = createMockResponse();
            await handler({ method: 'GET', url: '/api/admin/ai-image/config?site=cn' }, res);
            const payload = res.json();

            assert.equal(res.statusCode, 200);
            assert.equal(payload.runtime.model.configured, true);
            assert.equal(payload.runtime.model.model, 'gpt-image-2');
            assert.equal(payload.runtime.model.source, 'ai-image-env');
            assert.equal(payload.runtime.model.api_key_tail, 'alue');
            assert.equal(JSON.stringify(payload).includes('sk-live-secret-value'), false);
            assert.equal(payload.runtime.storage.configured, true);
            assert.equal(payload.runtime.queue.counts.queued, 1);
            assert.equal(payload.runtime.queue.counts.running, 1);
            assert.equal(payload.runtime.queue.counts.failed, 1);
            assert.equal(payload.runtime.queue.recent_failure.error_code, 'provider_429');
            assert.equal(payload.runtime.queue.recent_failure.error_message, 'rate limited');
        });
    } finally {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        });
    }
});

test('admin ai image config labels stored AI image provider as configured', async () => {
    await withHandler({
        aiImageModelsMock: {
            normalizeImageModel(model = '') {
                return String(model || '').trim() || 'gpt-image-2';
            },
            async resolveAiImageRuntimeConfig() {
                return {
                    configured: true,
                    source: 'ai-image-provider-stored',
                    apiKey: 'sk-ai-image-secret-1234567890',
                    baseUrl: 'https://api.eaheng.com/v1',
                    model: 'gpt-image-2'
                };
            },
            resolveR2Config() {
                return {
                    configured: false,
                    bucket: '',
                    publicUrl: ''
                };
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/ai-image/config?site=cn' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.runtime.model.source, 'ai-image-stored');
        assert.equal(payload.runtime.model.source_label, 'AI 图片后台安全配置');
        assert.equal(payload.runtime.model.configured, true);
    });
});

test('admin ai image config tolerates missing API base URL table during page load', async () => {
    const state = {
        missingTables: ['ai_image_api_base_urls'],
        agents: [{
            id: 'agent-global',
            site: 'all',
            slug: 'upscale',
            name: '高清修复',
            mode: 'agent',
            default_resolution: '2k',
            default_ratio: '1:1',
            pricing_override: {},
            metadata: {},
            is_active: true,
            display_order: 0
        }],
        pricing: [{
            id: 'pricing-cn',
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: 'gpt-image-1',
            resolution: '2k',
            ratio: '16:9',
            quantity: 1,
            points: 18,
            priority: 10,
            metadata: {},
            is_active: true
        }]
    };

    await withHandler({ state }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/ai-image/config?site=cn' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.agents.length, 1);
        assert.equal(payload.pricing.length, 1);
        assert.deepEqual(payload.api_base_urls, []);
        assert.match(payload.warnings.api_base_urls, /用户 API 白名单表尚未创建/);
        assert.match(payload.warnings.api_base_urls, /20260621_ai_image_workbench_core\.sql/);
    });
});

test('admin ai image config saves pricing rule with normalized commercial constraints', async () => {
    const state = {};

    await withHandler({
        state,
        body: {
            action: 'save-pricing',
            site: 'cn',
            mode: 'text',
            billingMode: 'points',
            model: 'gpt-image-1',
            resolution: '2k',
            ratio: '16:9',
            quantity: 20,
            points: 18.345,
            priority: 5,
            metadata: { source: 'admin-ui' }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.pricing.quantity, 8);
        assert.equal(payload.pricing.points, 18.35);
        assert.equal(state.inserted[0].table, 'ai_image_pricing_rules');
        assert.equal(state.inserted[0].payload.created_by, 'admin-user-1');
        assert.equal(state.auditEntries[0].actionType, 'ai_image.pricing.create');
    });
});

test('admin ai image config saves API billing rule with zero site points', async () => {
    const state = {};

    await withHandler({
        state,
        body: {
            action: 'save-pricing',
            site: 'all',
            mode: 'chat',
            billingMode: 'api',
            model: '*',
            points: 999,
            metadata: {}
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.pricing.billing_mode, 'api');
        assert.equal(payload.pricing.points, 0);
        assert.equal(state.inserted[0].payload.points, 0);
    });
});

test('admin ai image config saves Sub2API-compatible token pricing metadata', async () => {
    const state = {};

    await withHandler({
        state,
        body: {
            action: 'save-pricing',
            site: 'all',
            mode: 'chat',
            billingMode: 'points',
            model: 'gpt-5.4',
            resolution: '1k',
            ratio: '*',
            quantity: 1,
            points: 0.02,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    request_base: '0.01',
                    multiplier: '1.5',
                    rates: {
                        input: '2',
                        output: '8',
                        cache_write: '0.4',
                        cache_read: '0.2',
                        image_output: '12'
                    },
                    estimate: {
                        input_tokens: '1000',
                        output_tokens: '500',
                        cache_write_tokens: '20',
                        cache_read_tokens: '100'
                    }
                }
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.pricing.mode, 'chat');
        assert.equal(payload.pricing.metadata.billing_strategy, 'token_sub2api');
        assert.equal(payload.pricing.metadata.pricing.rates.input, 2);
        assert.equal(payload.pricing.metadata.pricing.rates.cache_write, 0.4);
        assert.equal(payload.pricing.metadata.pricing.estimate.cache_write_tokens, 20);
        assert.equal(payload.pricing.metadata.pricing.multiplier, 1.5);
        assert.equal(state.inserted[0].payload.metadata.pricing.sub2api_compatible, true);
    });
});

test('admin ai image config saves user API base URL allowlist entries', async () => {
    const state = {};

    await withHandler({
        state,
        body: {
            action: 'save-api-base-url',
            site: 'cn',
            label: 'FatherKey Sub2API',
            baseUrl: 'https://sub2api.fatherkey.com/v1/',
            metadata: { source: 'admin-ui' }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.api_base_url.base_url, 'https://sub2api.fatherkey.com/v1');
        assert.equal(payload.api_base_url.label, 'FatherKey Sub2API');
        assert.equal(state.inserted[0].table, 'ai_image_api_base_urls');
        assert.equal(state.inserted[0].payload.created_by, 'admin-user-1');
        assert.equal(state.auditEntries[0].actionType, 'ai_image.api_base_url.create');
    });
});

test('admin ai image config infers the NewAPI label for the canonical FatherKey URL', async () => {
    const state = {};

    await withHandler({
        state,
        body: {
            action: 'save-api-base-url',
            site: 'cn',
            label: '',
            baseUrl: 'https://new.fatherkey.com/v1/'
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.api_base_url.base_url, 'https://new.fatherkey.com/v1');
        assert.equal(payload.api_base_url.label, 'FatherKey NewAPI');
    });
});

test('admin ai image config saves site scoped guardrails', async () => {
    const state = {
        systemConfig: [{
            config_key: 'ai_image_guardrails',
            config_value: {
                __site_scoped: true,
                default: {
                    submit: {
                        user: { limit: 12, windowMs: 60000 }
                    },
                    tasks: {
                        running: 2,
                        queued: 5,
                        active: 6
                    }
                },
                sites: {}
            }
        }]
    };

    await withHandler({
        state,
        body: {
            action: 'save-guardrails',
            site: 'cn',
            guardrails: {
                submit: {
                    global: { limit: 100, windowMs: 60000 },
                    ip: { limit: 20, windowMs: 60000 },
                    user: { limit: 8, windowMs: 60000 },
                    heavyUser: { limit: 3, windowMs: 60000 },
                    model: { limit: 5, windowMs: 60000 }
                },
                upload: {
                    global: { limit: 300, windowMs: 60000 },
                    ip: { limit: 24, windowMs: 60000 },
                    user: { limit: 12, windowMs: 60000 }
                },
                download: {
                    global: { limit: 1000, windowMs: 60000 },
                    ip: { limit: 120, windowMs: 60000 },
                    user: { limit: 80, windowMs: 60000 },
                    resource: { limit: 12, windowMs: 60000 }
                },
                tasks: {
                    running: 1,
                    queued: 4,
                    active: 5
                }
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.guardrails.submit.user.limit, 8);
        assert.equal(state.upserted[0].table, 'system_config');
        assert.equal(state.upserted[0].payload.config_key, 'ai_image_guardrails');
        assert.equal(state.upserted[0].payload.config_value.__site_scoped, true);
        assert.equal(state.upserted[0].payload.config_value.sites.cn.submit.user.limit, 8);
        assert.equal(state.upserted[0].payload.config_value.sites.cn.tasks.running, 1);
        assert.equal(state.auditEntries[0].actionType, 'ai_image.guardrails.update');
    });
});

test('admin ai image config saves site scoped storage policy', async () => {
    const state = {
        systemConfig: [{
            config_key: 'ai_image_storage_policy',
            config_value: {
                __site_scoped: true,
                default: {
                    previewRetentionDays: 180,
                    originalRetentionDays: 365,
                    failedRetentionDays: 30,
                    warnStorageGb: 8,
                    stopStorageGb: 10,
                    lifecycleEnabled: false
                },
                sites: {}
            }
        }]
    };

    await withHandler({
        state,
        body: {
            action: 'save-storage-policy',
            site: 'cn',
            storage_policy: {
                previewRetentionDays: 60,
                originalRetentionDays: 180,
                failedRetentionDays: 14,
                warnStorageGb: 5,
                stopStorageGb: 4,
                lifecycleEnabled: true
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.storage_policy.previewRetentionDays, 60);
        assert.equal(payload.storage_policy.originalRetentionDays, 180);
        assert.equal(payload.storage_policy.warnStorageGb, 5);
        assert.equal(payload.storage_policy.stopStorageGb, 5);
        assert.equal(payload.storage_policy.lifecycleEnabled, true);
        assert.equal(state.upserted[0].payload.config_key, 'ai_image_storage_policy');
        assert.equal(state.upserted[0].payload.config_value.sites.cn.previewRetentionDays, 60);
        assert.equal(state.auditEntries[0].actionType, 'ai_image.storage_policy.update');
    });
});

test('admin ai image config reports migration guidance when saving API base URL before table exists', async () => {
    const state = {
        missingTables: ['ai_image_api_base_urls']
    };

    await withHandler({
        state,
        body: {
            action: 'save-api-base-url',
            site: 'cn',
            label: 'FatherKey Sub2API',
            baseUrl: 'https://sub2api.fatherkey.com/v1'
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 503);
        assert.equal(payload.success, false);
        assert.match(payload.message, /用户 API 白名单表尚未创建/);
        assert.match(payload.message, /schema cache/);
        assert.equal(state.inserted.length, 0);
        assert.equal(state.auditEntries.length, 0);
    });
});

test('admin ai image config saves scenario agent and preserves system prompt', async () => {
    const state = {};

    await withHandler({
        state,
        body: {
            action: 'save-agent',
            site: 'all',
            name: '高清修复',
            nameEn: 'HD Restore',
            description: '提升图片清晰度',
            systemPrompt: '只执行高清修复，不改变主体身份。',
            mode: 'agent',
            defaultModel: 'gpt-image-1',
            defaultResolution: '2k',
            defaultRatio: '1:1',
            displayOrder: 3,
            metadata: { icon: 'sparkles' }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.agent.slug, '高清修复');
        assert.equal(payload.agent.system_prompt, '只执行高清修复，不改变主体身份。');
        assert.equal(payload.agent.default_resolution, '2k');
        assert.equal(state.inserted[0].table, 'ai_image_agents');
        assert.equal(state.auditEntries[0].actionType, 'ai_image.agent.create');
    });
});

test('admin ai image config soft disables pricing rules instead of deleting history', async () => {
    const pricingId = '11111111-1111-4111-8111-111111111111';
    const state = {
        pricing: [{
            id: pricingId,
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: 'gpt-image-1',
            resolution: '1k',
            ratio: '1:1',
            quantity: 1,
            points: 8,
            priority: 10,
            metadata: {},
            is_active: true
        }]
    };

    await withHandler({
        state,
        body: {
            action: 'delete-pricing',
            id: pricingId
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.pricing.is_active, false);
        assert.equal(state.pricing[0].is_active, false);
        assert.equal(state.updated[0].table, 'ai_image_pricing_rules');
        assert.equal(state.auditEntries[0].actionType, 'ai_image.pricing.disable');
    });
});

test('admin ai image config soft disables user API base URL allowlist entries', async () => {
    const apiBaseId = '22222222-2222-4222-8222-222222222222';
    const state = {
        apiBaseUrls: [{
            id: apiBaseId,
            site: 'cn',
            label: 'FatherKey Sub2API',
            base_url: 'https://sub2api.fatherkey.com/v1',
            is_active: true,
            display_order: 10,
            metadata: {}
        }]
    };

    await withHandler({
        state,
        body: {
            action: 'disable-api-base-url',
            id: apiBaseId
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', url: '/api/admin/ai-image/config' }, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.api_base_url.is_active, false);
        assert.equal(state.apiBaseUrls[0].is_active, false);
        assert.equal(state.updated[0].table, 'ai_image_api_base_urls');
        assert.equal(state.auditEntries[0].actionType, 'ai_image.api_base_url.disable');
    });
});
