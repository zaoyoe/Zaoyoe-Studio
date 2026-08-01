const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const {
    createAiImageHandlers,
    inferMode,
    inferProviderIdFromPublicModelProviders,
    resolveModel,
    resolveModelGroup,
    resolveAllowedApiBaseUrls
} = require('../server/api-handlers/public/ai-image');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: '',
        flushCount: 0
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
        write(payload = '') {
            state.body += String(payload || '');
            return true;
        },
        flushHeaders() {
            return undefined;
        },
        flush() {
            state.flushCount += 1;
        },
        end(payload = '') {
            state.body += String(payload || '');
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
        },
        get body() {
            return state.body;
        },
        get flushCount() {
            return state.flushCount;
        }
    };
}

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return payload;
}

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        table: '',
        filters: [],
        payload: null,
        selectFields: '*',
        order: [],
        limit: null,
        singleMode: ''
    };

    const builder = {
        select(fields = '*') {
            state.selectFields = fields;
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
            state.upsertOptions = options;
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
        lt(column, value) {
            state.filters.push({ op: 'lt', column, value });
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
        if (op === 'lt') return Number(row[column]) < Number(value);
        return true;
    }));
}

function applyOrder(rows = [], order = []) {
    return order.reduce((currentRows, item) => {
        const sorted = currentRows.slice().sort((left, right) => {
            const leftValue = left?.[item.column] || '';
            const rightValue = right?.[item.column] || '';
            return String(leftValue).localeCompare(String(rightValue));
        });
        return item.ascending === false ? sorted.reverse() : sorted;
    }, rows.slice());
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createDefaultApiBaseUrls() {
    return [
        {
            id: 'api-base-default-cn',
            site: 'cn',
            label: 'FatherKey Sub2API',
            base_url: 'https://sub2api.fatherkey.com/v1',
            is_active: true,
            display_order: 10,
            metadata: {}
        },
        {
            id: 'api-base-default-intl',
            site: 'intl',
            label: 'Zaoyoe Sub2API',
            base_url: 'https://sub2api.zaoyoe.xyz/v1',
            is_active: true,
            display_order: 20,
            metadata: {}
        }
    ];
}

function createSupabaseStub(state = {}) {
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    state.results = Array.isArray(state.results) ? state.results : [];
    state.pricingRules = Array.isArray(state.pricingRules) ? state.pricingRules : [];
    state.agents = Array.isArray(state.agents) ? state.agents : [];
    state.apiUsage = Array.isArray(state.apiUsage) ? state.apiUsage : [];
    state.apiBaseUrls = Array.isArray(state.apiBaseUrls) ? state.apiBaseUrls : createDefaultApiBaseUrls();
    state.userApiKeys = Array.isArray(state.userApiKeys) ? state.userApiKeys : [];
    state.downloadEvents = Array.isArray(state.downloadEvents) ? state.downloadEvents : [];
    state.taskPrefs = Array.isArray(state.taskPrefs) ? state.taskPrefs : [];
    state.pointsLedger = Array.isArray(state.pointsLedger) ? state.pointsLedger : [];
    state.systemConfig = Array.isArray(state.systemConfig) ? state.systemConfig : [];
    state.insertedTasks = Array.isArray(state.insertedTasks) ? state.insertedTasks : [];
    state.updateCalls = Array.isArray(state.updateCalls) ? state.updateCalls : [];
    state.fromCalls = Array.isArray(state.fromCalls) ? state.fromCalls : [];
    state.rpcCalls = Array.isArray(state.rpcCalls) ? state.rpcCalls : [];
    state.taskSeq = state.taskSeq || 1;

    return {
        rpc(name, args = {}) {
            state.rpcCalls.push({ name, args: clone(args) });
            if (name === 'take_rate_limit_tokens' && state.batchRateLimitEnabled) {
                const results = [];
                for (const check of (Array.isArray(args.p_checks) ? args.p_checks : [])) {
                    const result = typeof state.rateLimitHandler === 'function'
                        ? state.rateLimitHandler({
                            p_key: check.key,
                            p_limit: check.limit,
                            p_window_ms: check.window_ms,
                            p_now: args.p_now
                        })
                        : {
                            allowed: true,
                            limit_value: check.limit,
                            remaining: Math.max(0, Number(check.limit || 1) - 1),
                            reset_at: '2026-06-21T12:01:00.000Z',
                            retry_after_seconds: 1,
                            hit_count: 1
                        };
                    results.push({
                        scope: check.scope,
                        ...result
                    });
                    if (result.allowed === false) break;
                }
                return Promise.resolve({ data: results, error: null });
            }
            if (name === 'take_rate_limit_token') {
                const result = typeof state.rateLimitHandler === 'function'
                    ? state.rateLimitHandler(args)
                    : {
                        allowed: true,
                        limit_value: args.p_limit || 60,
                        remaining: Math.max(0, Number(args.p_limit || 60) - 1),
                        reset_at: '2026-06-21T12:01:00.000Z',
                        retry_after_seconds: 1,
                        hit_count: 1
                    };
                return Promise.resolve({
                    data: result,
                    error: null
                });
            }
            if (name === 'fn_admit_ai_workbench_task' && state.fastAdmissionEnabled) {
                const taskPayload = clone(args.p_task || {});
                const existingTask = taskPayload.client_task_id
                    ? state.tasks.find((task) => task.user_id === taskPayload.user_id
                        && task.site === taskPayload.site
                        && task.client_task_id === taskPayload.client_task_id)
                    : null;
                if (existingTask) {
                    return Promise.resolve({
                        data: { success: true, duplicate: true, task: clone(existingTask) },
                        error: null
                    });
                }
                const now = '2026-06-21T12:00:00.000Z';
                const task = {
                    id: taskPayload.id || `00000000-0000-4000-8000-${String(state.taskSeq).padStart(12, '0')}`,
                    created_at: now,
                    updated_at: now,
                    ...taskPayload,
                    status: args.p_target_status || 'queued',
                    started_at: args.p_target_status === 'running' ? (args.p_started_at || now) : null
                };
                state.taskSeq += 1;
                state.insertedTasks.push(task);
                state.tasks.unshift(task);
                return Promise.resolve({
                    data: { success: true, duplicate: false, task: clone(task) },
                    error: null
                });
            }
            if (
                name === 'fn_deduct_points_admin_site_with_breakdown'
                || name === 'fn_deduct_points_admin_site'
                || name === 'fn_deduct_points'
            ) {
                return Promise.resolve({
                    data: { deducted: Number(args.p_amount || args.amount || 0) },
                    error: null
                });
            }
            return Promise.resolve({
                data: null,
                error: { message: `Unexpected RPC: ${name}` }
            });
        },
        from(table) {
            state.fromCalls.push(table);
            return createQueryBuilder(async (query) => {
                query.table = table;

                const tableRows = {
                    ai_image_tasks: state.tasks,
                    ai_image_results: state.results,
                    ai_image_pricing_rules: state.pricingRules,
                    ai_image_agents: state.agents,
                    ai_image_api_base_urls: state.apiBaseUrls,
                    ai_image_user_api_keys: state.userApiKeys,
                    ai_image_api_usage: state.apiUsage,
                    ai_image_download_events: state.downloadEvents,
                    ai_image_task_user_prefs: state.taskPrefs,
                    points_ledger: state.pointsLedger,
                    system_config: state.systemConfig
                }[table];

                if (!tableRows) {
                    throw new Error(`Unexpected table: ${table}`);
                }

                if (query.mode === 'insert') {
                    const now = '2026-06-21T12:00:00.000Z';
                    const payloads = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const insertedRows = payloads.map((item, index) => ({
                        id: item.id || `00000000-0000-4000-8000-00000000000${state.taskSeq + index}`,
                        created_at: now,
                        updated_at: now,
                        ...clone(item)
                    }));
                    state.taskSeq += insertedRows.length;
            if (table === 'ai_image_tasks') {
                state.insertedTasks.push(...insertedRows);
                state.tasks.unshift(...insertedRows);
            } else if (table === 'ai_image_results') {
                state.results.push(...insertedRows);
            } else if (table === 'ai_image_api_usage') {
                state.apiUsage.push(...insertedRows);
            } else if (table === 'ai_image_user_api_keys') {
                state.userApiKeys.push(...insertedRows);
            } else if (table === 'ai_image_download_events') {
                state.downloadEvents.push(...insertedRows);
                    } else if (table === 'ai_image_task_user_prefs') {
                        state.taskPrefs.push(...insertedRows);
                    } else {
                        throw new Error(`Unexpected insert table: ${table}`);
                    }
                    return {
                        data: query.singleMode ? insertedRows[0] : insertedRows,
                        error: null
                    };
                }

                if (query.mode === 'upsert') {
                    const now = '2026-06-21T12:00:00.000Z';
                    const payloads = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const conflictColumns = String(query.upsertOptions?.onConflict || '')
                        .split(',')
                        .map((column) => column.trim())
                        .filter(Boolean);
                    const rows = [];
                    payloads.forEach((item, index) => {
                        const matched = conflictColumns.length
                            ? tableRows.find((row) => conflictColumns.every((column) => row[column] === item[column]))
                            : null;
                        if (matched) {
                            Object.assign(matched, clone(item), {
                                updated_at: '2026-06-21T12:00:01.000Z'
                            });
                            rows.push(clone(matched));
                            return;
                        }
                        const inserted = {
                            id: item.id || `00000000-0000-4000-8000-00000000000${state.taskSeq + index}`,
                            created_at: now,
                            updated_at: now,
                            ...clone(item)
                        };
                        tableRows.push(inserted);
                        rows.push(clone(inserted));
                    });
                    state.taskSeq += payloads.length;
                    return {
                        data: query.singleMode ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (query.mode === 'update') {
                    const rows = applyFilters(tableRows, query.filters);
                    state.updateCalls.push({
                        table,
                        payload: clone(query.payload),
                        filters: clone(query.filters),
                        matched: rows.length
                    });
                    rows.forEach((row) => {
                        Object.assign(row, clone(query.payload), {
                            updated_at: '2026-06-21T12:00:01.000Z'
                        });
                    });
                    return {
                        data: query.singleMode ? (rows[0] || null) : rows.map(clone),
                        error: query.singleMode && !rows[0] ? { message: 'not found' } : null
                    };
                }

                let rows = applyOrder(applyFilters(tableRows, query.filters), query.order);
                if (query.limit) {
                    rows = rows.slice(0, query.limit);
                }

                if (query.singleMode === 'single' || query.singleMode === 'maybeSingle') {
                    return {
                        data: rows[0] || null,
                        error: null
                    };
                }

                return {
                    data: rows.map(clone),
                    error: null
                };
            });
        }
    };
}

function createHandlers({
    state = {},
    userId = 'user-ai-1',
    body = {},
    env = {},
    fetchImpl,
    uploadImageBuffer,
    requestSecurity
} = {}) {
    const supabase = createSupabaseStub(state);
    const handlers = createAiImageHandlers({
        env: {
            ADMIN_CONFIG_ENCRYPTION_KEY: 'test-ai-image-user-api-key-encryption-secret',
            ...env
        },
        fetchImpl,
        uploadImageBuffer,
        requestSecurity: requestSecurity || {
            resolveClientIp() {
                return '203.0.113.10';
            },
            async takeRateLimitToken({ supabase: rateLimitSupabase, key, limit, windowMs }) {
                const { data } = await rateLimitSupabase.rpc('take_rate_limit_token', {
                    p_key: key,
                    p_limit: limit,
                    p_window_ms: windowMs,
                    p_now: '2026-06-21T12:00:00.000Z'
                });
                const payload = Array.isArray(data) ? data[0] : data;
                return {
                    allowed: payload?.allowed !== false,
                    limit: Number(payload?.limit_value || payload?.limit || limit),
                    remaining: Math.max(0, Number(payload?.remaining || 0)),
                    resetAt: Date.parse(payload?.reset_at || '2026-06-21T12:01:00.000Z'),
                    retryAfterSeconds: Math.max(1, Number(payload?.retry_after_seconds || 1))
                };
            },
            ...(state.batchRateLimitEnabled ? {
                async takeRateLimitTokens({ supabase: rateLimitSupabase, checks = [] }) {
                    const { data } = await rateLimitSupabase.rpc('take_rate_limit_tokens', {
                        p_checks: checks.map((check) => ({
                            scope: check.scope,
                            key: check.key,
                            limit: check.limit,
                            window_ms: check.windowMs
                        })),
                        p_now: '2026-06-21T12:00:00.000Z'
                    });
                    return (Array.isArray(data) ? data : []).map((payload, index) => ({
                        scope: payload.scope || checks[index]?.scope || '',
                        allowed: payload.allowed !== false,
                        limit: Number(payload.limit_value || payload.limit || checks[index]?.limit || 1),
                        remaining: Math.max(0, Number(payload.remaining || 0)),
                        resetAt: Date.parse(payload.reset_at || '2026-06-21T12:01:00.000Z'),
                        retryAfterSeconds: Math.max(1, Number(payload.retry_after_seconds || 1))
                    }));
                }
            } : {}),
            applyRateLimitHeaders(res, result = {}) {
                res.setHeader('X-RateLimit-Limit', String(result.limit || 0));
                res.setHeader('X-RateLimit-Remaining', String(result.remaining || 0));
                if (result.allowed === false) {
                    res.setHeader('Retry-After', String(result.retryAfterSeconds || 1));
                }
            }
        },
        admin: {
            async requireAuthenticatedUser() {
                if (!userId) {
                    const error = new Error('Unauthorized');
                    error.statusCode = 401;
                    throw error;
                }
                return {
                    user: { id: userId },
                    supabase,
                    adminSupabase: supabase
                };
            },
            async parseJsonBody() {
                return body;
            },
            getOptionalSupabaseAdmin() {
                return supabase;
            },
            sendJson
        }
    });

    return {
        handlers,
        supabase,
        state
    };
}

test('ai image mode inference keeps image, reverse, chat, and text flows distinct', () => {
    assert.equal(inferMode({ prompt: '一只银色机器人在月球上写诗' }), 'text');
    assert.equal(inferMode({ prompt: '用相同风格发散', referenceImageUrl: 'https://example.com/a.png' }), 'image');
    assert.equal(inferMode({ prompt: '反推这个图片的提示词', referenceImageUrl: 'https://example.com/a.png' }), 'reverse');
    assert.equal(inferMode({ billingMode: 'api', prompt: '写一段文案' }), 'chat');
    assert.equal(inferMode({ billingMode: 'points', apiModelGroup: 'chat', prompt: '写一段文案' }), 'chat');
    assert.equal(inferMode({ agentSlug: 'background-remover', prompt: '换成海边背景' }), 'agent');
});

test('ai image request infers a unique provider for a configured reverse model', () => {
    const providers = [
        {
            providerId: 'provider-3',
            chatModels: ['gemini-3.5-flash']
        },
        {
            providerId: 'provider-4',
            chatModels: ['claude-opus-4-6']
        }
    ];
    assert.equal(
        inferProviderIdFromPublicModelProviders(providers, { model: 'claude-opus-4-6', mode: 'reverse' }),
        'provider-4'
    );
    assert.equal(
        inferProviderIdFromPublicModelProviders(providers, { model: 'missing-model', mode: 'reverse' }),
        ''
    );
    assert.equal(
        inferProviderIdFromPublicModelProviders([
            { providerId: 'provider-a', chatModels: ['shared-model'] },
            { providerId: 'provider-b', chatModels: ['shared-model'] }
        ], { model: 'shared-model', mode: 'reverse' }),
        ''
    );
});

test('reverse prompt defaults to text vision model and chat model group', () => {
    assert.equal(resolveModel({ body: { model: 'gpt-image' }, mode: 'reverse' }), 'default-vision-model');
    assert.equal(resolveModelGroup({ body: {}, mode: 'reverse' }), 'chat');
    assert.equal(resolveModelGroup({ body: {}, mode: 'chat' }), 'chat');
    assert.equal(resolveModelGroup({ body: {}, mode: 'text' }), 'image');
});

test('ai image allowed API base URLs come from admin-controlled env', () => {
    assert.deepEqual(
        resolveAllowedApiBaseUrls({
            AI_IMAGE_ALLOWED_API_BASE_URLS: 'https://sub2api.fatherkey.com/v1, https://sub2api.zaoyoe.xyz/v1/'
        }),
        ['https://sub2api.fatherkey.com/v1', 'https://sub2api.zaoyoe.xyz/v1']
    );
});

test('ai image pricing config exposes image and chat model groups separately', async () => {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/public/ai-image.js');
    const originalLoad = Module._load;
    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../api/_lib/secrets') {
            return {
                async listStoredAiImageProviderSecrets() {
                    return [
                        {
                            configured: true,
                            isActive: true,
                            providerId: 'image-provider',
                            label: 'Image Provider',
                            vendor: 'openai',
                            protocol: 'openai-compatible',
                            modelGroup: 'image',
                            model: 'gpt-image-2',
                            models: ['gpt-image-2'],
                            imageModels: ['gpt-image-2'],
                            modelDisplayNames: { 'gpt-image-2': 'Nano Banana Pro' },
                            chatModels: []
                        },
                        {
                            configured: true,
                            isActive: true,
                            providerId: 'vision-provider',
                            label: 'Vision Provider',
                            vendor: 'openai',
                            protocol: 'openai-compatible',
                            modelGroup: 'chat',
                            model: 'gpt-4o-mini',
                            models: ['gpt-4o-mini'],
                            imageModels: [],
                            chatModels: ['gpt-4o-mini', 'gpt-4.1'],
                            visionModels: ['gpt-4.1']
                        }
                    ];
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let createHandlersWithMock;
    try {
        createHandlersWithMock = require(handlerPath).createAiImageHandlers;
    } finally {
        Module._load = originalLoad;
    }

    try {
        const state = {};
        const supabase = createSupabaseStub(state);
        const handlers = createHandlersWithMock({
            admin: {
                async requireAuthenticatedUser() {
                    return {
                        user: { id: 'user-ai-1' },
                        supabase,
                        adminSupabase: supabase
                    };
                },
                getOptionalSupabaseAdmin() {
                    return supabase;
                },
                sendJson
            }
        });
        const res = createMockResponse();

        await handlers.pricing({ method: 'GET', url: '/api/public/ai-image/pricing?site=cn' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.deepEqual(payload.image_models.map((item) => item.id), ['gpt-image-2']);
        assert.deepEqual(payload.chat_models.map((item) => item.id), ['gpt-4o-mini', 'gpt-4.1']);
        assert.equal(payload.image_models[0].providerId, 'image-provider');
        assert.equal(payload.image_models[0].label, 'Nano Banana Pro');
        assert.equal(payload.model_providers[0].modelDisplayNames['gpt-image-2'], 'Nano Banana Pro');
        assert.equal(payload.chat_models[0].providerId, 'vision-provider');
        assert.equal(payload.chat_models[0].supportsImageInput, undefined);
        assert.equal(payload.chat_models[1].supportsImageInput, true);
    } finally {
        delete require.cache[handlerPath];
    }
});

test('ai image pricing config respects explicit image provider group when stale chat models exist', async () => {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/public/ai-image.js');
    const originalLoad = Module._load;
    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../api/_lib/secrets') {
            return {
                async listStoredAiImageProviderSecrets() {
                    return [
                        {
                            configured: true,
                            isActive: true,
                            providerId: 'image-provider',
                            label: 'Image Provider',
                            vendor: 'openai',
                            protocol: 'openai-compatible',
                            modelGroup: 'image',
                            model: 'gpt-image-2',
                            models: ['gpt-image-2'],
                            imageModels: ['gpt-image-2'],
                            chatModels: ['gpt-4o-mini']
                        }
                    ];
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let createHandlersWithMock;
    try {
        createHandlersWithMock = require(handlerPath).createAiImageHandlers;
    } finally {
        Module._load = originalLoad;
    }

    try {
        const state = {};
        const supabase = createSupabaseStub(state);
        const handlers = createHandlersWithMock({
            admin: {
                async requireAuthenticatedUser() {
                    return {
                        user: { id: 'user-ai-1' },
                        supabase,
                        adminSupabase: supabase
                    };
                },
                getOptionalSupabaseAdmin() {
                    return supabase;
                },
                sendJson
            }
        });
        const res = createMockResponse();

        await handlers.pricing({ method: 'GET', url: '/api/public/ai-image/pricing?site=cn' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.deepEqual(payload.image_models.map((item) => item.id), ['gpt-image-2']);
        assert.deepEqual(payload.chat_models.map((item) => item.id), []);
        assert.equal(payload.model_providers[0].modelGroup, 'image');
        assert.deepEqual(payload.model_providers[0].chatModels, []);
    } finally {
        delete require.cache[handlerPath];
    }
});

test('ai image pricing config uses public provider metadata without decrypting provider secrets', async () => {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/public/ai-image.js');
    const originalLoad = Module._load;
    let publicMetadataCalls = 0;
    let secretDecryptListCalls = 0;
    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../api/_lib/secrets') {
            return {
                async listStoredAiImageProviderPublicMetadata() {
                    publicMetadataCalls += 1;
                    return [
                        {
                            configured: true,
                            isActive: true,
                            providerId: 'fast-public-provider',
                            label: 'Fast Public Provider',
                            vendor: 'openai',
                            protocol: 'openai-compatible',
                            modelGroup: 'image',
                            model: 'gpt-image-2',
                            models: ['gpt-image-2'],
                            imageModels: ['gpt-image-2'],
                            chatModels: []
                        }
                    ];
                },
                async listStoredAiImageProviderSecrets() {
                    secretDecryptListCalls += 1;
                    throw new Error('public pricing must not decrypt provider secrets');
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let createHandlersWithMock;
    try {
        createHandlersWithMock = require(handlerPath).createAiImageHandlers;
    } finally {
        Module._load = originalLoad;
    }

    try {
        const state = {};
        const supabase = createSupabaseStub(state);
        const handlers = createHandlersWithMock({
            admin: {
                async requireAuthenticatedUser() {
                    return {
                        user: { id: 'user-ai-1' },
                        supabase,
                        adminSupabase: supabase
                    };
                },
                getOptionalSupabaseAdmin() {
                    return supabase;
                },
                sendJson
            }
        });
        const res = createMockResponse();

        await handlers.pricing({ method: 'GET', url: '/api/public/ai-image/pricing?site=cn' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(publicMetadataCalls, 1);
        assert.equal(secretDecryptListCalls, 0);
        assert.deepEqual(payload.image_models.map((item) => item.id), ['gpt-image-2']);
        assert.match(res.headers['server-timing'], /providers;dur=\d+/);
        assert.match(res.headers['server-timing'], /total;dur=\d+/);
    } finally {
        delete require.cache[handlerPath];
    }
});

test('ai image model prices publicly proxy effective Sub2API quotes without exposing provider keys', async () => {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/public/ai-image.js');
    const originalLoad = Module._load;
    const providerKey = 'sk-admin-provider-price-secret-12345678';
    const failedProviderKey = 'sk-admin-provider-failed-secret-87654321';
    const fetchCalls = [];
    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../api/_lib/secrets') {
            return {
                async listStoredAiImageProviderSecrets() {
                    return [
                        {
                            configured: true,
                            isActive: true,
                            providerId: 'chat-provider',
                            label: 'Sub2API Chat',
                            baseUrl: 'https://sub2api.fatherkey.com/v1',
                            apiKey: providerKey,
                            modelGroup: 'chat',
                            chatModels: ['gpt-5.4', 'not-returned']
                        },
                        {
                            configured: true,
                            isActive: true,
                            providerId: 'failed-provider',
                            label: 'Sub2API Backup',
                            baseUrl: 'https://sub2api.zaoyoe.xyz/v1',
                            apiKey: failedProviderKey,
                            modelGroup: 'chat',
                            chatModels: ['claude-sonnet-4']
                        }
                    ];
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let createHandlersWithMock;
    try {
        createHandlersWithMock = require(handlerPath).createAiImageHandlers;
    } finally {
        Module._load = originalLoad;
    }

    try {
        const state = {};
        const supabase = createSupabaseStub(state);
        const handlers = createHandlersWithMock({
            fetchImpl: async (url, options = {}) => {
                fetchCalls.push({ url, options });
                if (url.includes('zaoyoe')) {
                    throw new Error('upstream unavailable');
                }
                return {
                    ok: true,
                    status: 200,
                    async json() {
                        return {
                            object: 'list',
                            data: [
                                {
                                    id: 'gpt-5.4',
                                    billing_model: 'gpt-5.4-2026-07-01',
                                    billing_mode: 'token',
                                    effective_multiplier: 1.5,
                                    available: true,
                                    input_price_per_million: 3.75,
                                    output_price_per_million: 22.5,
                                    cache_read_price_per_million: 0.375
                                },
                                {
                                    id: 'internal-only-model',
                                    billing_mode: 'token',
                                    effective_multiplier: 1.5,
                                    available: true,
                                    input_price_per_million: 1
                                }
                            ]
                        };
                    }
                };
            },
            admin: {
                async requireAuthenticatedUser() {
                    const error = new Error('Unauthorized');
                    error.statusCode = 401;
                    throw error;
                },
                getOptionalSupabaseAdmin() {
                    return supabase;
                },
                sendJson
            }
        });
        const res = createMockResponse();

        await handlers['model-prices']({ method: 'GET', url: '/api/public?scope=ai-image&route=model-prices' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(fetchCalls.length, 2);
        assert.equal(fetchCalls[0].url, 'https://sub2api.fatherkey.com/v1/models/pricing');
        assert.equal(fetchCalls[0].options.headers.Authorization, `Bearer ${providerKey}`);
        assert.deepEqual(payload.text_model_prices.map((item) => item.id), ['gpt-5.4']);
        assert.equal(payload.text_model_prices[0].billing_model, 'gpt-5.4-2026-07-01');
        assert.equal(payload.text_model_prices[0].effective_multiplier, 1.5);
        assert.equal(payload.text_model_prices[0].input_price_per_million, 3.75);
        assert.equal(payload.partial, true);
        assert.equal(payload.provider_statuses.length, 2);
        assert.equal(payload.provider_statuses[1].available, false);
        assert.equal(res.body.includes(providerKey), false);
        assert.equal(res.body.includes(failedProviderKey), false);
        assert.equal(res.body.includes('internal-only-model'), false);
        assert.equal(res.body.includes('channel_id'), false);
        assert.equal(res.body.includes('account_id'), false);
    } finally {
        delete require.cache[handlerPath];
    }
});

test('ai image pricing config is available without login but omits user key status', async () => {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/public/ai-image.js');
    const originalLoad = Module._load;
    let publicMetadataCalls = 0;
    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../api/_lib/secrets') {
            return {
                async listStoredAiImageProviderPublicMetadata() {
                    publicMetadataCalls += 1;
                    return [
                        {
                            configured: true,
                            isActive: true,
                            providerId: 'anonymous-public-provider',
                            label: 'Anonymous Public Provider',
                            vendor: 'openai',
                            protocol: 'openai-compatible',
                            modelGroup: 'image',
                            model: 'gpt-image-2',
                            models: ['gpt-image-2'],
                            imageModels: ['gpt-image-2'],
                            chatModels: []
                        }
                    ];
                },
                async listStoredAiImageProviderSecrets() {
                    throw new Error('anonymous pricing must not decrypt provider secrets');
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let createHandlersWithMock;
    try {
        createHandlersWithMock = require(handlerPath).createAiImageHandlers;
    } finally {
        Module._load = originalLoad;
    }

    try {
        const state = {
            userApiKeys: [
                {
                    id: 'key-should-not-leak',
                    user_id: 'user-ai-1',
                    site: 'cn',
                    api_base_url: 'https://sub2api.fatherkey.com/v1',
                    api_key_tail: 'leak1234',
                    created_at: '2026-06-21T12:00:00.000Z',
                    updated_at: '2026-06-21T12:00:00.000Z',
                    metadata: {}
                }
            ]
        };
        const supabase = createSupabaseStub(state);
        const handlers = createHandlersWithMock({
            admin: {
                async requireAuthenticatedUser() {
                    const error = new Error('Unauthorized');
                    error.statusCode = 401;
                    throw error;
                },
                getOptionalSupabaseAdmin() {
                    return supabase;
                },
                sendJson
            }
        });
        const res = createMockResponse();

        await handlers.pricing({ method: 'GET', url: '/api/public/ai-image/pricing?site=cn' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(publicMetadataCalls, 1);
        assert.deepEqual(payload.image_models.map((item) => item.id), ['gpt-image-2']);
        assert.deepEqual(payload.stored_api_keys, []);
        assert.deepEqual(payload.storedApiKeys, []);
        assert.equal(state.fromCalls.includes('ai_image_user_api_keys'), false);
        assert.match(res.headers['server-timing'], /providers;dur=\d+/);
        assert.match(res.headers['server-timing'], /total;dur=\d+/);
    } finally {
        delete require.cache[handlerPath];
    }
});

test('ai image pricing config exposes the rule revision used for submission checks', async () => {
    const updatedAt = '2026-07-31T10:20:30.000Z';
    const { handlers } = createHandlers({
        state: {
            pricingRules: [{
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                site: 'cn',
                mode: 'text',
                billing_mode: 'points',
                model: '*',
                resolution: '*',
                ratio: '*',
                quantity: 1,
                points: 8,
                priority: 10,
                metadata: {},
                is_active: true,
                updated_at: updatedAt
            }]
        }
    });
    const res = createMockResponse();

    await handlers.pricing({ method: 'GET', url: '/api/public/ai-image/pricing?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.pricing[0].updated_at, updatedAt);
});

test('ai image API model discovery detects upstream models for current user key', async () => {
    const plaintextKey = 'sk-user-model-discovery-only-12345678';
    const fetchCalls = [];
    const { handlers } = createHandlers({
        body: {
            site: 'cn',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                authorization: options.headers?.Authorization || ''
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [
                        { id: 'gpt-4.1', object: 'model' },
                        { id: 'claude-sonnet-4', object: 'model' },
                        { id: 'gpt-image-2', object: 'model' },
                        { id: 'video-ds-2.0-fast', object: 'model' }
                    ]
                })
            };
        }
    });
    const res = createMockResponse();

    await handlers.models({ method: 'POST', url: '/api/public/ai-image/models' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(fetchCalls[0].url, 'https://sub2api.fatherkey.com/v1/models');
    assert.equal(fetchCalls[0].authorization, `Bearer ${plaintextKey}`);
    assert.deepEqual(payload.chat_models.map((item) => item.id), ['gpt-4.1', 'claude-sonnet-4']);
    assert.deepEqual(payload.image_models.map((item) => item.id), ['gpt-image-2']);
    assert.deepEqual(payload.video_models.map((item) => item.id), ['video-ds-2.0-fast']);
    assert.equal(payload.model_providers[0].providerId, 'detected-upstream');
    assert.equal(JSON.stringify(payload).includes(plaintextKey), false);
});

test('ai image API model discovery supports Gemini native model lists', async () => {
    const plaintextKey = 'gemini-user-model-discovery-key';
    const fetchCalls = [];
    const { handlers } = createHandlers({
        state: {
            apiBaseUrls: [{
                id: 'api-base-gemini-cn',
                site: 'cn',
                label: 'Gemini API',
                base_url: 'https://generativelanguage.googleapis.com/v1beta',
                is_active: true,
                display_order: 10,
                metadata: {}
            }]
        },
        body: {
            site: 'cn',
            apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: plaintextKey
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                authorization: options.headers?.Authorization || ''
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    models: [
                        {
                            name: 'models/gemini-2.5-flash',
                            displayName: 'Gemini 2.5 Flash',
                            supportedGenerationMethods: ['generateContent', 'countTokens']
                        },
                        {
                            name: 'models/imagen-4.0-generate-preview-06-06',
                            displayName: 'Imagen 4',
                            supportedGenerationMethods: ['predict']
                        }
                    ]
                })
            };
        }
    });
    const res = createMockResponse();

    await handlers.models({ method: 'POST', url: '/api/public/ai-image/models' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    const requestUrl = new URL(fetchCalls[0].url);
    assert.equal(`${requestUrl.origin}${requestUrl.pathname}`, 'https://generativelanguage.googleapis.com/v1beta/models');
    assert.equal(requestUrl.searchParams.get('key'), plaintextKey);
    assert.equal(fetchCalls[0].authorization, '');
    assert.deepEqual(payload.chat_models.map((item) => item.id), ['gemini-2.5-flash']);
    assert.deepEqual(payload.image_models.map((item) => item.id), ['imagen-4.0-generate-preview-06-06']);
    assert.equal(payload.discovery.endpoint, 'gemini_models');
    assert.equal(payload.model_providers[0].modelGroup, 'both');
    assert.equal(JSON.stringify(payload).includes(plaintextKey), false);
});

test('ai image API model discovery classifies Gemini video models', async () => {
    const plaintextKey = 'gemini-user-video-discovery-key';
    const { handlers } = createHandlers({
        state: {
            apiBaseUrls: [{
                id: 'api-base-gemini-cn',
                site: 'cn',
                label: 'Gemini API',
                base_url: 'https://generativelanguage.googleapis.com/v1beta',
                is_active: true,
                display_order: 10,
                metadata: {}
            }]
        },
        body: {
            site: 'cn',
            apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: plaintextKey
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                models: [{
                    name: 'models/veo-3.0-generate-preview',
                    displayName: 'Veo 3',
                    supportedGenerationMethods: ['generateVideos']
                }]
            })
        })
    });
    const res = createMockResponse();

    await handlers.models({ method: 'POST', url: '/api/public/ai-image/models' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.video_models.map((item) => item.id), ['veo-3.0-generate-preview']);
    assert.deepEqual(payload.image_models.map((item) => item.id), []);
    assert.deepEqual(payload.chat_models.map((item) => item.id), []);
    assert.equal(payload.model_providers[0].modelGroup, 'video');
    assert.equal(JSON.stringify(payload).includes(plaintextKey), false);
});

test('ai image API model discovery keeps unknown upstream models out of grouped dropdowns', async () => {
    const plaintextKey = 'sk-user-generic-model-discovery-12345678';
    const { handlers } = createHandlers({
        body: {
            site: 'cn',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                data: [
                    { id: 'custom-vendor-creative-model', object: 'model' }
                ]
            })
        })
    });
    const res = createMockResponse();

    await handlers.models({ method: 'POST', url: '/api/public/ai-image/models' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.chat_models.map((item) => item.id), []);
    assert.deepEqual(payload.image_models.map((item) => item.id), []);
    assert.deepEqual(payload.discovery.unknownModels, ['custom-vendor-creative-model']);
});

test('ai image API model discovery classifies nano banana models as image-only', async () => {
    const plaintextKey = 'sk-user-nano-banana-model-discovery-12345678';
    const { handlers } = createHandlers({
        body: {
            site: 'cn',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                data: [
                    { id: 'nano-banana-2', object: 'model' },
                    { id: 'nano-banana-pro', object: 'model' }
                ]
            })
        })
    });
    const res = createMockResponse();

    await handlers.models({ method: 'POST', url: '/api/public/ai-image/models' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.chat_models.map((item) => item.id), []);
    assert.deepEqual(payload.image_models.map((item) => item.id), ['nano-banana-2', 'nano-banana-pro']);
});

test('ai image submit requires authenticated user', async () => {
    const { handlers } = createHandlers({
        userId: '',
        body: {
            billingMode: 'points',
            prompt: '生成一张极简海报'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'unauthorized');
});

test('ai image chat stream requires authenticated user', async () => {
    const { handlers } = createHandlers({
        userId: '',
        body: {
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            prompt: '写一段短文',
            model: 'gpt-5.5',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'unauthorized');
});

test('ai image submit requires explicit billing mode before generation', async () => {
    const { handlers } = createHandlers({
        body: {
            prompt: '生成一张极简海报'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'billing_mode_required');
});

test('ai image upload stores reference image before model submission', async () => {
    const uploads = [];
    const { handlers } = createHandlers({
        uploadImageBuffer: async (buffer, context = {}) => {
            uploads.push({
                bytes: buffer.toString('utf8'),
                task: context.task,
                mimeType: context.mimeType
            });
            return {
                image_url: 'https://cdn.example.com/ai-images/reference.png',
                original_image_url: 'https://cdn.example.com/ai-images/reference.png',
                storage_path: 'ai-images/reference.png',
                original_storage_path: 'ai-images/reference.png'
            };
        },
        body: {
            site: 'cn',
            title: 'reference.png',
            imageData: `data:image/png;base64,${Buffer.from('fake-reference-image').toString('base64')}`
        }
    });
    const res = createMockResponse();

    await handlers.upload({ method: 'POST', url: '/api/public/ai-image/upload' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.imageUrl, 'https://cdn.example.com/ai-images/reference.png');
    assert.equal(payload.storagePath, 'ai-images/reference.png');
    assert.equal(payload.mimeType, 'image/png');
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].bytes, 'fake-reference-image');
    assert.equal(uploads[0].task.site, 'cn');
    assert.equal(uploads[0].task.user_id, 'user-ai-1');
});

test('ai image upload rejects unsupported reference image types', async () => {
    const { handlers } = createHandlers({
        body: {
            imageData: `data:image/svg+xml;base64,${Buffer.from('<svg />').toString('base64')}`
        }
    });
    const res = createMockResponse();

    await handlers.upload({ method: 'POST', url: '/api/public/ai-image/upload' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'unsupported_image_type');
});

test('ai image submit rejects inline data URL reference images', async () => {
    const { handlers } = createHandlers({
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '基于这张图继续发散',
            referenceImageUrl: `data:image/png;base64,${Buffer.from('inline-reference').toString('base64')}`
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'reference_image_requires_upload');
});

test('ai image submit rejects blob URL reference images', async () => {
    const { handlers } = createHandlers({
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '基于这张图继续发散',
            referenceImageUrl: 'blob:https://www.fatherkey.com/local-preview'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'reference_image_requires_upload');
});

test('ai image submit applies layered rate limits before creating point tasks', async () => {
    const state = {
        rateLimitHandler(args = {}) {
            if (String(args.p_key || '').includes(':heavy-user:')) {
                return {
                    allowed: false,
                    limit_value: args.p_limit,
                    remaining: 0,
                    reset_at: '2026-06-21T12:02:00.000Z',
                    retry_after_seconds: 60,
                    hit_count: args.p_limit
                };
            }
            return {
                allowed: true,
                limit_value: args.p_limit,
                remaining: Math.max(0, Number(args.p_limit || 1) - 1),
                reset_at: '2026-06-21T12:01:00.000Z',
                retry_after_seconds: 1,
                hit_count: 1
            };
        }
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '生成两张 4k 商业海报',
            model: 'gpt-image-2',
            ratio: '16:9',
            resolution: '4k',
            quantity: 2
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 429);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'rate_limited');
    assert.equal(payload.scope, 'submit:heavy_user');
    assert.equal(payload.retry_after_seconds, 60);
    assert.equal(res.headers['retry-after'], '60');
    assert.equal(state.insertedTasks.length, 0);
    assert.ok(state.rpcCalls.some((call) => String(call.args.p_key).includes('ai-image:submit:global:cn')));
    assert.ok(state.rpcCalls.some((call) => String(call.args.p_key).includes('ai-image:submit:ip:cn:203.0.113.10')));
    assert.ok(state.rpcCalls.some((call) => String(call.args.p_key).includes('ai-image:submit:user:cn:user-ai-1')));
    assert.ok(state.rpcCalls.some((call) => String(call.args.p_key).includes('ai-image:submit:heavy-user:cn:user-ai-1:4k')));
});

test('ai image submit batches layered rate limits into one database request', async () => {
    const state = { batchRateLimitEnabled: true };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '生成一张商品主图',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    const batchCalls = state.rpcCalls.filter((call) => call.name === 'take_rate_limit_tokens');
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].args.p_checks.some((check) => check.scope === 'submit:global'), true);
    assert.equal(batchCalls[0].args.p_checks.some((check) => check.scope === 'submit:user'), true);
    assert.equal(state.rpcCalls.some((call) => call.name === 'take_rate_limit_token'), false);
});

test('ai image submit rejects a stale displayed pricing revision before task creation', async () => {
    const ruleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const state = {
        pricingRules: [{
            id: ruleId,
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 12,
            priority: 10,
            metadata: {},
            is_active: true,
            updated_at: '2026-07-31T12:00:00.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '生成一张商品主图',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            pricingRuleId: ruleId,
            pricingRuleUpdatedAt: '2026-07-31T11:00:00.000Z'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 409);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'pricing_changed');
    assert.equal(state.insertedTasks.length, 0);
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_admit_ai_workbench_task'), false);
});

test('ai image submit accepts the current pricing revision and snapshots it on the task', async () => {
    const ruleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const updatedAt = '2026-07-31T12:00:00.000Z';
    const state = {
        pricingRules: [{
            id: ruleId,
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 12,
            priority: 10,
            metadata: {},
            is_active: true,
            updated_at: updatedAt
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '生成一张商品主图',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            pricingRuleId: ruleId,
            pricingRuleUpdatedAt: updatedAt
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(state.insertedTasks[0].estimated_points, 12);
    assert.equal(state.insertedTasks[0].metadata.pricing.matched_rule.id, ruleId);
    assert.equal(state.insertedTasks[0].metadata.pricing.matched_rule.updated_at, updatedAt);
    assert.equal(state.insertedTasks[0].metadata.pricing.revision, updatedAt);
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_admit_ai_workbench_task'), true);
});

test('ai image submit creates video tasks with video model group and single output', async () => {
    const state = {};
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            mode: 'video',
            output: 'video',
            apiModelGroup: 'video',
            prompt: '一只橘猫在雨夜霓虹街道慢镜头行走',
            model: 'veo-3.0-generate-preview',
            ratio: '9:16',
            resolution: '720p',
            videoSettings: {
                duration: 6,
                generateAudio: true,
                watermark: false,
                cameraFixed: false
            },
            quantity: 4
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(state.insertedTasks.length, 1);
    assert.equal(state.insertedTasks[0].mode, 'video');
    assert.equal(state.insertedTasks[0].api_model_group, 'video');
    assert.equal(state.insertedTasks[0].model, 'veo-3.0-generate-preview');
    assert.equal(state.insertedTasks[0].ratio, '9:16');
    assert.equal(state.insertedTasks[0].resolution, '720p');
    assert.equal(state.insertedTasks[0].quantity, 1);
    assert.equal(state.insertedTasks[0].metadata.output, 'video');
    assert.equal(state.insertedTasks[0].metadata.video_ratio, '9:16');
    assert.equal(state.insertedTasks[0].metadata.video_resolution, '720p');
    assert.equal(state.insertedTasks[0].metadata.duration, 6);
    assert.equal(state.insertedTasks[0].metadata.generate_audio, true);
    assert.equal(state.insertedTasks[0].metadata.watermark, false);
    assert.equal(state.insertedTasks[0].metadata.camera_fixed, false);
});

test('image and video submissions use the same fast admission RPC path', async () => {
    for (const mode of ['text', 'video']) {
        const state = { fastAdmissionEnabled: true };
        const { handlers } = createHandlers({
            state,
            body: {
                site: 'cn',
                billingMode: 'points',
                mode,
                output: mode === 'video' ? 'video' : 'image',
                apiModelGroup: mode === 'video' ? 'video' : 'image',
                prompt: mode === 'video' ? '生成五秒产品展示视频' : '生成一张产品主图',
                model: mode === 'video' ? 'veo-3.0-generate-preview' : 'gpt-image-2',
                ratio: '16:9',
                resolution: mode === 'video' ? '720p' : '1k',
                quantity: 1
            }
        });
        const res = createMockResponse();

        await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

        const payload = res.json();
        const admissionCall = state.rpcCalls.find((call) => call.name === 'fn_admit_ai_workbench_task');
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.ok(admissionCall);
        assert.equal(admissionCall.args.p_task.mode, mode);
        assert.equal(admissionCall.args.p_target_status, 'queued');
        assert.match(res.headers['server-timing'], /preflight;dur=\d+/);
        assert.match(res.headers['server-timing'], /admission;dur=\d+/);
    }
});

test('duplicate media admission returns the existing task without another upstream request', async () => {
    const clientTaskId = 'client-video-idempotency-1';
    const existingTask = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        site: 'cn',
        user_id: 'user-ai-1',
        client_task_id: clientTaskId,
        mode: 'video',
        billing_mode: 'api',
        status: 'running',
        model: 'veo-3.0-generate-preview',
        api_model_group: 'video',
        ratio: '16:9',
        resolution: '720p',
        quantity: 1,
        prompt: '生成五秒产品展示视频',
        estimated_points: 0,
        charged_points: 0,
        metadata: { output: 'video' },
        created_at: '2026-07-31T12:00:00.000Z',
        updated_at: '2026-07-31T12:00:00.000Z'
    };
    let upstreamRequests = 0;
    const state = {
        fastAdmissionEnabled: true,
        tasks: [existingTask]
    };
    const { handlers } = createHandlers({
        state,
        fetchImpl: async () => {
            upstreamRequests += 1;
            throw new Error('duplicate task must not reach upstream');
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-video-idempotency-12345678',
            clientTaskId,
            mode: 'video',
            output: 'video',
            apiModelGroup: 'video',
            prompt: existingTask.prompt,
            model: existingTask.model,
            ratio: existingTask.ratio,
            resolution: existingTask.resolution
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.duplicate, true);
    assert.equal(payload.task.id, existingTask.id);
    assert.equal(payload.task.status, 'running');
    assert.equal(upstreamRequests, 0);
    assert.equal(state.insertedTasks.length, 0);
});

test('ai image submit writes diagnostics for video task enqueue', async () => {
    const state = {};
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => logs.push(args);
    try {
        const { handlers } = createHandlers({
            state,
            body: {
                site: 'cn',
                billingMode: 'points',
                mode: 'video',
                output: 'video',
                apiModelGroup: 'video',
                prompt: '飞龙在天，水墨云海镜头推进',
                model: 'doubao-seedance-2-0-pro-250528',
                ratio: '9:16',
                resolution: '720p',
                videoDuration: '5',
                videoAudio: 'true'
            }
        });
        const res = createMockResponse();

        await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

        assert.equal(res.statusCode, 200);
        const submitLogs = logs
            .filter((entry) => entry[0] === '[ai-image-submit]')
            .map((entry) => JSON.parse(entry[1]));
        assert.ok(submitLogs.some((entry) => entry.event === 'submit_received' && entry.mode === 'video' && entry.modelGroup === 'video'));
        assert.ok(submitLogs.some((entry) => entry.event === 'submit_inserted' && entry.taskId));
    } finally {
        console.info = originalInfo;
    }
});

test('ai image submit uses admin configured guardrails before env defaults', async () => {
    const state = {
        systemConfig: [{
            config_key: 'ai_image_guardrails',
            config_value: {
                __site_scoped: true,
                default: {
                    submit: {
                        global: { limit: 180, windowMs: 60000 },
                        ip: { limit: 30, windowMs: 60000 },
                        user: { limit: 12, windowMs: 60000 },
                        heavyUser: { limit: 4, windowMs: 60000 },
                        model: { limit: 6, windowMs: 60000 }
                    }
                },
                sites: {
                    cn: {
                        submit: {
                            global: { limit: 90, windowMs: 60000 },
                            ip: { limit: 9, windowMs: 60000 },
                            user: { limit: 3, windowMs: 60000 },
                            heavyUser: { limit: 2, windowMs: 60000 },
                            model: { limit: 2, windowMs: 60000 }
                        },
                        tasks: {
                            running: 1,
                            queued: 2,
                            active: 3
                        }
                    }
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '生成一张图',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    const submitUserCall = state.rpcCalls.find((call) => String(call.args.p_key).includes('ai-image:submit:user:cn:user-ai-1'));
    assert.ok(submitUserCall);
    assert.equal(submitUserCall.args.p_limit, 3);
    const submitIpCall = state.rpcCalls.find((call) => String(call.args.p_key).includes('ai-image:submit:ip:cn:203.0.113.10'));
    assert.equal(submitIpCall.args.p_limit, 9);
});

test('ai image submit refuses users with too many queued tasks before inserting another task', async () => {
    const state = {
        tasks: Array.from({ length: 5 }, (_, index) => ({
            id: `queued-task-${index}`,
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '等待中的任务',
            estimated_points: 8,
            charged_points: 0,
            created_at: `2026-06-21T11:00:0${index}.000Z`
        }))
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '再生成一张图',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 429);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'ai_image_user_queue_limit');
    assert.equal(payload.scope, 'task:queued');
    assert.equal(state.insertedTasks.length, 0);
});

test('points chat submit executes immediately and records upstream timing', async () => {
    const requests = [];
    const state = {
        pricingRules: [{
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 8,
            priority: 10,
            is_active: true
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-chat-key',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_CHAT_MODEL: 'kimi-k2.6'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'chatcmpl-points-chat-1',
                    usage: {
                        prompt_tokens: 8,
                        completion_tokens: 90,
                        total_tokens: 98
                    },
                    choices: [{
                        message: {
                            content: '你好！很高兴见到你。有什么我可以帮你的吗？'
                        }
                    }]
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '你好',
            model: 'kimi-k2.6',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.status, 'succeeded');
    assert.equal(payload.task.status, 'succeeded');
    assert.equal(payload.task.billingMode, 'points');
    assert.equal(payload.task.resultPrompt, '你好！很高兴见到你。有什么我可以帮你的吗？');
    assert.equal(payload.task.totalTokens, 98);
    assert.equal(payload.task.estimatedPoints, 8);
    assert.equal(payload.task.chargedPoints, 8);
    assert.equal(payload.task.queuePosition, null);
    assert.equal(typeof payload.task.metadata.timing.upstream_ms, 'number');
    assert.equal(typeof payload.task.metadata.timing.upstream_request_ms, 'number');
    assert.equal(typeof payload.task.metadata.timing.upstream_response_ms, 'number');
    assert.equal(typeof payload.task.metadata.timing.total_run_ms, 'number');
    assert.equal(state.apiUsage.length, 0);
    assert.equal(payload.task.inputTokens, 8);
    assert.equal(payload.task.outputTokens, 90);
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown'), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.example.com/v1/chat/completions');
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[0].body.model, 'kimi-k2.6');
});

test('points chat submit charges Sub2API-compatible token pricing from usage', async () => {
    const requests = [];
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-chat-1',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-chat-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'kimi-k2.6'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
            if (String(url).includes('/usage/requests/')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        mode: 'request',
                        request_id: 'client:fatherkey-chat-cost-1',
                        usage_record: {
                            request_id: 'upstream-chat-cost-1',
                            actual_cost: 0.137502,
                            total_cost: 0.137502,
                            input_cost: 0.0123,
                            output_cost: 0.125202
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name = '') {
                        return String(name).toLowerCase() === 'x-client-request-id'
                            ? 'fatherkey-chat-cost-1'
                            : '';
                    }
                },
                text: async () => JSON.stringify({
                    id: 'chatcmpl-sub2api-chat-1',
                    usage: {
                        prompt_tokens: 2000,
                        completion_tokens: 1000,
                        total_tokens: 3000,
                        prompt_tokens_details: {
                            cached_tokens: 500
                        }
                    },
                    choices: [{
                        message: {
                            content: '已完成 Sub2API 组合计费验证。'
                        }
                    }]
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '验证组合计费',
            model: 'kimi-k2.6',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.status, 'succeeded');
    assert.equal(payload.task.estimatedPoints, 0);
    assert.equal(payload.task.chargedPoints, 0.137502);
    assert.equal(payload.task.tokenUsage.cache_read_tokens, 500);
    const expectedClientRequestId = `fatherkey-aiw-${state.insertedTasks[0].id}`;
    assert.equal(requests.some((request) => request.headers?.['X-Client-Request-ID'] === expectedClientRequestId), true);
    assert.equal(requests.some((request) => request.url === `https://sub2api.fatherkey.com/v1/usage/requests/${encodeURIComponent(`client:${expectedClientRequestId}`)}`), true);
    assert.equal(deductCall.args.p_amount, 0.137502);
    assert.equal(persistedTask.charged_points, 0.137502);
    assert.equal(persistedTask.metadata.pricing_charge.source, 'sub2api_actual_cost');
    assert.equal(persistedTask.metadata.pricing_charge.pricing.actual_cost_usd, 0.137502);
    assert.equal(persistedTask.metadata.pricing_charge.pricing.breakdown.actual, 0.137502);
});

test('points chat submit falls back to Sub2API total cost when actual cost is delayed', async () => {
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-chat-total-cost-fallback',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-chat-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'claude-opus-4-8',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            if (String(url).includes('/usage/requests/')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        usage_record: {
                            request_id: 'different-sub2api-request-id',
                            actual_cost: 0,
                            total_cost: 0.343305,
                            input_cost: 0.12,
                            output_cost: 0.223305
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name = '') {
                        return String(name).toLowerCase() === 'x-client-request-id'
                            ? 'fatherkey-total-cost-fallback'
                            : '';
                    }
                },
                text: async () => JSON.stringify({
                    id: 'chatcmpl-sub2api-chat-total-fallback',
                    usage: {
                        prompt_tokens: 7059,
                        completion_tokens: 127,
                        total_tokens: 7186
                    },
                    choices: [{
                        message: {
                            content: 'Sub2API total cost fallback.'
                        }
                    }]
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '验证 actual_cost 延迟时不会扣 0',
            model: 'claude-opus-4-8',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);

    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.chargedPoints, 0.343305);
    assert.equal(deductCall.args.p_amount, 0.343305);
    assert.equal(persistedTask.charged_points, 0.343305);
    assert.equal(persistedTask.metadata.pricing_charge.source, 'sub2api_actual_cost');
    assert.equal(persistedTask.metadata.pricing_charge.pricing.actual_cost_usd, 0.343305);
});

test('points chat stream uses server provider key, streams deltas, and charges points', async () => {
    const requests = [];
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => logs.push(args);
    const encoder = new TextEncoder();
    try {
        const state = {
            pricingRules: [{
                site: 'cn',
                mode: 'chat',
                billing_mode: 'points',
                model: '*',
                resolution: '*',
                ratio: '*',
                quantity: 1,
                points: 8,
                priority: 10,
                is_active: true
            }]
        };
        const { handlers } = createHandlers({
            state,
            env: {
                AI_IMAGE_API_KEY: 'sk-server-stream-key',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_CHAT_MODEL: 'kimi-k2.6'
            },
            fetchImpl: async (url, options = {}) => {
                requests.push({
                    url,
                    headers: options.headers,
                    body: JSON.parse(options.body)
                });
                return {
                    ok: true,
                    status: 200,
                    body: new ReadableStream({
                        start(controller) {
                            [
                                'data: {"id":"chatcmpl-points-stream-1","model":"kimi-k2.6","choices":[{"delta":{"content":"你好"}}]}\n\n',
                                'data: {"choices":[{"delta":{"content":"，积分流式已开启。"}}]}\n\n',
                                'data: {"usage":{"prompt_tokens":18,"completion_tokens":9,"total_tokens":27},"choices":[{"delta":{}}]}\n\n',
                                'data: [DONE]\n\n'
                            ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                            controller.close();
                        }
                    })
                };
            },
            body: {
                site: 'cn',
                billingMode: 'points',
                prompt: '你好',
                model: 'kimi-k2.6',
                apiModelGroup: 'chat',
                memoryMode: 'model',
                memoryMessageLimit: 80,
                memoryTokenBudget: 48000,
                messages: Array.from({ length: 20 }, (_, index) => ({
                    role: index % 2 ? 'assistant' : 'user',
                    content: `历史消息 ${index + 1}`
                }))
            }
        });
        const res = createMockResponse();

        await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

        assert.equal(res.statusCode, 200);
        assert.match(res.headers['content-type'], /text\/event-stream/);
        assert.match(res.body, /event: delta/);
        assert.match(res.body, /event: content_done/);
        assert.match(res.body, /"terminal_signal":"sse_done"/);
        assert.match(res.body, /积分流式已开启/);
        assert.match(res.body, /event: done/);
        assert.ok(res.flushCount > 0);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'https://api.example.com/v1/chat/completions');
        assert.equal(requests[0].headers.Authorization, 'Bearer sk-server-stream-key');
        assert.equal(requests[0].body.stream, true);
        assert.equal(requests[0].body.model, 'kimi-k2.6');
        assert.equal(requests[0].body.messages.length, 22);
        assert.equal(requests[0].body.messages[1].content, '历史消息 1');
        assert.equal(state.apiUsage.length, 0);
        assert.equal(typeof state.insertedTasks[0].started_at, 'string');
        assert.equal(state.updateCalls.some((call) => call.table === 'ai_image_tasks' && call.payload.status === 'running'), false);
        assert.equal(state.insertedTasks[0].api_key_tail, '');
        const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
        assert.equal(persistedTask.status, 'succeeded');
        assert.equal(persistedTask.result_prompt, '你好，积分流式已开启。');
        assert.equal(persistedTask.total_tokens, 27);
        assert.equal(persistedTask.charged_points, 8);
        assert.equal(persistedTask.metadata.provider_source, 'environment');
        assert.equal(persistedTask.metadata.memory_mode, 'model');
        assert.equal(persistedTask.metadata.memory_message_count, 20);
        assert.equal(typeof persistedTask.metadata.preflight_ms, 'number');
        assert.equal(typeof persistedTask.metadata.config_resolve_ms, 'number');
        assert.equal(typeof persistedTask.metadata.timing.preflight_ms, 'number');
        assert.equal(typeof persistedTask.metadata.timing.config_resolve_ms, 'number');
        assert.equal(typeof persistedTask.metadata.timing.last_visible_ms, 'number');
        assert.equal(typeof persistedTask.metadata.timing.protocol_done_ms, 'number');
        assert.equal(typeof persistedTask.metadata.timing.final_usage_lookup_ms, 'number');
        assert.equal(state.rpcCalls.some((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown'), true);
        assert.equal(JSON.stringify(state).includes('sk-server-stream-key'), false);
        const chatLogs = logs
            .filter((entry) => entry[0] === '[ai-image-chat-stream]')
            .map((entry) => JSON.parse(entry[1]));
        assert.ok(chatLogs.some((entry) => entry.event === 'submit_received' && entry.mode === 'chat' && entry.modelGroup === 'chat'));
        assert.ok(chatLogs.some((entry) => entry.event === 'task_inserted' && entry.task_id === state.insertedTasks[0].id));
    } finally {
        console.info = originalInfo;
    }
});

test('chat stream emits content_done before delayed upstream connection close', { timeout: 1000 }, async () => {
    const encoder = new TextEncoder();
    let controller = null;
    const state = {
        pricingRules: [{
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 1,
            priority: 10,
            is_active: true
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-content-done-key',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_CHAT_MODEL: 'gpt-5.5'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            body: new ReadableStream({
                start(streamController) {
                    controller = streamController;
                    streamController.enqueue(encoder.encode(
                        'data: {"id":"chatcmpl-content-done","choices":[{"delta":{"content":"回答完成。"}}]}\n\n'
                    ));
                    streamController.enqueue(encoder.encode(
                        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
                    ));
                }
            })
        }),
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '验证内容完成事件',
            model: 'gpt-5.5',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();
    const handlerPromise = handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(res.body, /event: content_done/);
    assert.match(res.body, /"terminal_signal":"finish_reason:stop"/);
    assert.doesNotMatch(res.body, /event: done/);

    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
    await handlerPromise;

    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.match(res.body, /event: done/);
    assert.equal(persistedTask.metadata.timing.protocol_done_signal, 'finish_reason:stop');
    assert.equal(typeof persistedTask.metadata.timing.last_visible_ms, 'number');
    assert.equal(typeof persistedTask.metadata.content_completed_at, 'string');
});

test('points chat stream charges Sub2API actual cost after stream closes', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-stream-chat-1',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-stream-sub2api-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'kimi-k2.6',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url).includes('/usage?request_id=')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        usage_record: {
                            request_id: 'client:fatherkey-stream-cost-1',
                            actual_cost: 0.001075,
                            total_cost: 0.001075,
                            input_cost: 0.000179,
                            output_cost: 0.000896
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name = '') {
                        return String(name).toLowerCase() === 'x-client-request-id'
                            ? 'fatherkey-stream-cost-1'
                            : '';
                    }
                },
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-sub2api-stream-1","model":"kimi-k2.6","choices":[{"delta":{"content":"已完成"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"流式计费。"}}]}\n\n',
                            'data: {"usage":{"prompt_tokens":2000,"completion_tokens":1000,"total_tokens":3000},"choices":[{"delta":{}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '验证流式 Sub2API 计费',
            model: 'kimi-k2.6',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: billing/);
    assert.match(res.body, /event: done/);
    assert.match(res.body, /"chargedPoints":0.001075/);
    const expectedClientRequestId = `fatherkey-aiw-${state.insertedTasks[0].id}`;
    assert.equal(requests.some((request) => request.headers?.['X-Client-Request-ID'] === expectedClientRequestId), true);
    assert.equal(requests.some((request) => request.url === `https://sub2api.fatherkey.com/v1/usage/requests/${encodeURIComponent(`client:${expectedClientRequestId}`)}`), true);
    assert.equal(deductCall.args.p_amount, 0.001075);
    assert.equal(persistedTask.status, 'succeeded');
    assert.equal(persistedTask.charged_points, 0.001075);
    assert.equal(persistedTask.metadata.sub2api_client_request_id, expectedClientRequestId);
    assert.equal(persistedTask.metadata.pricing_charge.source, 'sub2api_actual_cost');
    assert.equal(persistedTask.metadata.pricing_charge.pricing.actual_cost_usd, 0.001075);
});

test('points chat stream settles zero-cost Sub2API usage without waiting forever', async () => {
    const encoder = new TextEncoder();
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-stream-zero-cost',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-stream-zero-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'qwen3.7-max',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url) => {
            if (String(url).includes('/usage')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        usage_record: {
                            request_id: 'client:fatherkey-aiw-zero-stream',
                            actual_cost: 0,
                            total_cost: 0,
                            input_cost: 0,
                            output_cost: 0
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-sub2api-zero","model":"qwen3.7-max","choices":[{"delta":{"content":"零成本明细。"}}]}\n\n',
                            'data: {"usage":{"prompt_tokens":352,"completion_tokens":422,"total_tokens":774},"choices":[{"delta":{}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '验证零成本 Sub2API 计费',
            model: 'qwen3.7-max',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: done/);
    assert.match(res.body, /"billingSyncStatus":"settled"/);
    assert.equal(persistedTask.charged_points, 0);
    assert.equal(persistedTask.metadata.sub2api_billing_sync.status, 'settled');
    assert.equal(persistedTask.token_usage.sub2api.actual_cost, 0);
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown'), false);
});

test('points chat stream finalizes after upstream sends content but leaves SSE open', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-stream-chat-idle',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-stream-idle-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'deepseek-v4-flash',
            AI_IMAGE_CHAT_STREAM_IDLE_TIMEOUT_MS: '10',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url).includes('/usage?request_id=')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        usage_record: {
                            request_id: 'client:fatherkey-stream-idle-1',
                            actual_cost: 0.019876,
                            total_cost: 0.019876
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name = '') {
                        return String(name).toLowerCase() === 'x-client-request-id'
                            ? 'fatherkey-stream-idle-1'
                            : '';
                    }
                },
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(
                            'data: {"id":"chatcmpl-sub2api-stream-idle","model":"deepseek-v4-flash","choices":[{"delta":{"content":"你好"}}]}\n\n'
                        ));
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '你好',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    const expectedClientRequestId = `fatherkey-aiw-${state.insertedTasks[0].id}`;

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: billing/);
    assert.match(res.body, /event: done/);
    assert.match(res.body, /你好/);
    assert.match(res.body, /"chargedPoints":0.019876/);
    assert.equal(requests.some((request) => request.headers?.['X-Client-Request-ID'] === expectedClientRequestId), true);
    assert.equal(deductCall.args.p_amount, 0.019876);
    assert.equal(persistedTask.status, 'succeeded');
    assert.equal(persistedTask.charged_points, 0.019876);
    assert.equal(persistedTask.metadata.stream_idle_timed_out, true);
});

test('points chat stream finalizes after visible answer when hidden reasoning keeps streaming', { timeout: 1000 }, async () => {
    const requests = [];
    const encoder = new TextEncoder();
    let hiddenChunksSent = 0;
    let streamCancelled = false;
    let hiddenInterval = null;
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-stream-hidden-reasoning',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-stream-hidden-reasoning-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'deepseek-v4-flash',
            AI_IMAGE_CHAT_STREAM_VISIBLE_IDLE_TIMEOUT_MS: '10',
            AI_IMAGE_CHAT_STREAM_USAGE_READY_GRACE_MS: '0',
            AI_IMAGE_CHAT_STREAM_IDLE_TIMEOUT_MS: '500',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url).includes('/usage?request_id=')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        usage_record: {
                            request_id: 'client:fatherkey-stream-hidden-reasoning-1',
                            actual_cost: 0.000221,
                            total_cost: 0.000221
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name = '') {
                        return String(name).toLowerCase() === 'x-client-request-id'
                            ? 'fatherkey-stream-hidden-reasoning-1'
                            : '';
                    }
                },
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(
                            'data: {"id":"chatcmpl-hidden-reasoning","model":"deepseek-v4-flash","choices":[{"delta":{"content":"你好"}}]}\n\n'
                        ));
                        hiddenInterval = setInterval(() => {
                            hiddenChunksSent += 1;
                            try {
                                controller.enqueue(encoder.encode(
                                    `data: {"choices":[{"delta":{"reasoning_content":"隐藏思考${hiddenChunksSent}"}}]}\n\n`
                                ));
                            } catch (_) {
                                clearInterval(hiddenInterval);
                            }
                        }, 1);
                    },
                    cancel() {
                        streamCancelled = true;
                        if (hiddenInterval) clearInterval(hiddenInterval);
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '你好',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat',
            thinkingMode: 'disabled'
        }
    });
    const res = createMockResponse();
    const startedAt = Date.now();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const elapsedMs = Date.now() - startedAt;
    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    const expectedClientRequestId = `fatherkey-aiw-${state.insertedTasks[0].id}`;

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: billing/);
    assert.match(res.body, /event: done/);
    assert.match(res.body, /你好/);
    assert.match(res.body, /"chargedPoints":0.000221/);
    assert.equal(requests.some((request) => request.headers?.['X-Client-Request-ID'] === expectedClientRequestId), true);
    assert.equal(requests.some((request) => request.url === `https://sub2api.fatherkey.com/v1/usage?request_id=${encodeURIComponent(`client:${expectedClientRequestId}`)}`), true);
    assert.equal(deductCall.args.p_amount, 0.000221);
    assert.equal(persistedTask.status, 'succeeded');
    assert.equal(persistedTask.result_prompt, '你好');
    assert.equal(persistedTask.charged_points, 0.000221);
    assert.equal(persistedTask.metadata.stream_visible_idle_timed_out, true);
    assert.equal(persistedTask.metadata.reasoning_diagnostic.visible_idle_timed_out, true);
    assert.equal(streamCancelled, true);
    assert.equal(hiddenChunksSent > 0, true);
    assert.equal(elapsedMs < 500, true);
});

test('points chat stream does not truncate content after Sub2API usage is ready', { timeout: 1000 }, async () => {
    const requests = [];
    const encoder = new TextEncoder();
    let streamCancelled = false;
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-stream-usage-ready',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-stream-usage-ready-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'deepseek-v4-flash',
            AI_IMAGE_CHAT_STREAM_USAGE_READY_PROBE_MS: '10',
            AI_IMAGE_CHAT_STREAM_USAGE_READY_GRACE_MS: '0',
            AI_IMAGE_CHAT_STREAM_IDLE_TIMEOUT_MS: '500',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url).includes('/usage?request_id=')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        usage_record: {
                            request_id: 'client:fatherkey-stream-usage-ready-1',
                            actual_cost: 0.000273,
                            total_cost: 0.000273
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name = '') {
                        return String(name).toLowerCase() === 'x-client-request-id'
                            ? 'fatherkey-stream-usage-ready-1'
                            : '';
                    }
                },
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(
                            'data: {"id":"chatcmpl-usage-ready","model":"deepseek-v4-flash","choices":[{"delta":{"content":"你好"}}]}\n\n'
                        ));
                        setTimeout(() => {
                            try {
                                controller.enqueue(encoder.encode(
                                    'data: {"choices":[{"delta":{"content":"，我是完整答案。"}}]}\n\n'
                                ));
                                controller.enqueue(encoder.encode(
                                    'data: [DONE]\n\n'
                                ));
                                controller.close();
                            } catch (_) {
                                // Test stream may already be closed if the handler regresses and cancels it.
                            }
                        }, 20);
                    },
                    cancel() {
                        streamCancelled = true;
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '你好',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();
    const startedAt = Date.now();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const elapsedMs = Date.now() - startedAt;
    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: billing/);
    assert.match(res.body, /event: done/);
    assert.match(res.body, /你好，我是完整答案。/);
    assert.match(res.body, /"chargedPoints":0.000273/);
    assert.equal(deductCall.args.p_amount, 0.000273);
    assert.equal(persistedTask.status, 'succeeded');
    assert.equal(persistedTask.result_prompt, '你好，我是完整答案。');
    assert.equal(persistedTask.charged_points, 0.000273);
    assert.equal(persistedTask.metadata.stream_usage_ready_finished, false);
    assert.equal(persistedTask.metadata.reasoning_diagnostic.usage_ready_finished, false);
    assert.equal(streamCancelled, false);
    assert.equal(elapsedMs < 500, true);
});

test('points chat stream does not block each delta on delayed Sub2API usage lookup', { timeout: 1000 }, async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const chunks = Array.from({ length: 40 }, () => 'xy');
    const expectedText = chunks.join('');
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-stream-nonblocking-deltas',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-stream-nonblocking-deltas-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'deepseek-v4-flash',
            AI_IMAGE_CHAT_STREAM_USAGE_READY_PROBE_MS: '100',
            AI_IMAGE_CHAT_STREAM_VISIBLE_IDLE_TIMEOUT_MS: '1000',
            AI_IMAGE_SUB2API_STREAM_LOOKUP_TIMEOUT_MS: '50',
            AI_IMAGE_SUB2API_STREAM_FINAL_LOOKUP_TIMEOUT_MS: '50',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url).includes('/usage?request_id=')) {
                return new Promise(() => {});
            }
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        chunks.forEach((delta, index) => {
                            controller.enqueue(encoder.encode(
                                `data: {"id":"chatcmpl-nonblocking-deltas","model":"deepseek-v4-flash","choices":[{"delta":{"content":"${delta}"}}],"usage":{"prompt_tokens":61,"completion_tokens":${index + 1},"total_tokens":${62 + index}}}\n\n`
                            ));
                        });
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '你好',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();
    const startedAt = Date.now();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const elapsedMs = Date.now() - startedAt;
    const usageRequests = requests.filter((request) => request.url.includes('/usage?request_id='));
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: done/);
    assert.match(res.body, new RegExp(expectedText));
    assert.equal(persistedTask.result_prompt, expectedText);
    assert.equal(usageRequests.length <= 4, true);
    assert.equal(elapsedMs < 500, true);
});

test('chat stream appends missing tail from Responses output_text done events', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"resp-compatible","model":"deepseek-v4-flash","choices":[{"delta":{"content":"你好！我是Father"}}]}\n\n',
                            'data: {"type":"response.output_text.done","text":"你好！我是FatherKey AI 工作台助手，可以继续帮你处理问题。"}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiKey: 'sk-user-key',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            prompt: '你好',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /你好！我是FatherKey AI 工作台助手/);
    assert.equal(persistedTask.result_prompt, '你好！我是FatherKey AI 工作台助手，可以继续帮你处理问题。');
    assert.equal(requests.length, 1);
});

test('points chat stream can resolve Sub2API usage by raw client request id fallback', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const state = {
        pricingRules: [{
            id: 'pricing-sub2api-stream-raw-client-id',
            site: 'cn',
            mode: 'chat',
            billing_mode: 'points',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true,
            metadata: {
                billing_strategy: 'token_sub2api',
                pricing: {
                    unit: 'sub2api_actual_cost_usd',
                    cost_source: 'sub2api_usage_actual_cost',
                    points_per_usd: 1
                }
            }
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-stream-raw-id-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_CHAT_MODEL: 'claude-opus-4-8',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url).includes('/usage?request_id=client%3Afatherkey-stream-raw-id')) {
                return {
                    ok: false,
                    status: 404,
                    text: async () => JSON.stringify({ error: { message: 'not found' } })
                };
            }
            if (String(url).includes('/usage?request_id=fatherkey-stream-raw-id')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        usage_record: {
                            request_id: 'fatherkey-stream-raw-id',
                            actual_cost: 0.017165,
                            total_cost: 0.343305
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name = '') {
                        return String(name).toLowerCase() === 'x-client-request-id'
                            ? 'fatherkey-stream-raw-id'
                            : '';
                    }
                },
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-sub2api-stream-raw-id","model":"claude-opus-4-8","choices":[{"delta":{"content":"你好"}}]}\n\n',
                            'data: {"usage":{"prompt_tokens":7065,"completion_tokens":11,"total_tokens":7076},"choices":[{"delta":{}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '你好',
            model: 'claude-opus-4-8',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /"chargedPoints":0.017165/);
    assert.equal(requests.some((request) => request.headers?.['X-Client-Request-ID'] === `fatherkey-aiw-${state.insertedTasks[0].id}`), true);
    assert.equal(requests.some((request) => request.url === 'https://sub2api.fatherkey.com/v1/usage?request_id=fatherkey-stream-raw-id'), true);
    assert.equal(deductCall.args.p_amount, 0.017165);
    assert.equal(persistedTask.charged_points, 0.017165);
    assert.equal(persistedTask.metadata.pricing_charge.pricing.actual_cost_usd, 0.017165);
});

test('deepseek chat stream forwards official reasoning_content before final answer', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-deepseek-1","model":"deepseek-v4-flash","choices":[{"delta":{"reasoning_content":"先分析问题。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"最终答案。"}}]}\n\n',
                            'data: {"usage":{"prompt_tokens":12,"completion_tokens":6,"total_tokens":18},"choices":[{"delta":{}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-deepseek-key-12345678',
            prompt: '解释一下',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            thinkingMode: 'enabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: reasoning/);
    assert.match(res.body, /先分析问题。/);
    assert.match(res.body, /event: delta/);
    assert.match(res.body, /最终答案。/);
    assert.equal(requests[0].body.thinking.type, 'enabled');
    assert.equal(requests[0].body.reasoning_effort, 'high');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.result_prompt, '最终答案。');
    assert.equal(persistedTask.metadata.reasoning_content, '先分析问题。');
    assert.equal(persistedTask.metadata.thinking_enabled, true);
    assert.equal(persistedTask.metadata.reasoning_effort, 'high');
    assert.equal(persistedTask.metadata.requested_reasoning_effort, 'high');
});

test('deepseek chat stream can hide reasoning when user disables thinking display', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"reasoning_content":"隐藏思考。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"只显示答案。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-deepseek-key-12345678',
            prompt: '解释一下',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat',
            reasoningEffort: 'max',
            thinkingMode: 'disabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.body, /event: reasoning/);
    assert.match(res.body, /只显示答案。/);
    assert.equal(requests[0].body.thinking.type, 'disabled');
    assert.equal(requests[0].body.reasoning_effort, 'max');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.thinking_mode, 'disabled');
    assert.equal(persistedTask.metadata.thinking_type, 'disabled');
    assert.equal(persistedTask.metadata.thinking_enabled, false);
});

test('deepseek chat stream treats auto thinking and reasoning as fast defaults', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-deepseek-fast","model":"deepseek-v4-flash","choices":[{"delta":{"content":"快速回答。"}}]}\n\n',
                            'data: {"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12},"choices":[{"delta":{}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-deepseek-key-12345678',
            prompt: '解释一下',
            model: 'deepseek-v4-flash',
            apiModelGroup: 'chat',
            reasoningEffort: 'auto',
            thinkingMode: 'auto'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(Object.hasOwn(requests[0].body, 'thinking'), false);
    assert.equal(Object.hasOwn(requests[0].body, 'reasoning_effort'), false);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.thinking_mode, 'unset');
    assert.equal(persistedTask.metadata.reasoning_effort, '');
    assert.equal(persistedTask.metadata.requested_reasoning_effort, 'auto');
});

test('kimi chat stream forwards official thinking flag and reasoning content', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-kimi-1","model":"kimi-k2.6","choices":[{"delta":{"reasoning_content":"Kimi 先思考。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"Kimi 最终答案。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-kimi-key-12345678',
            prompt: '解释一下',
            model: 'kimi-k2.6',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            thinkingMode: 'enabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: reasoning/);
    assert.match(res.body, /Kimi 先思考。/);
    assert.match(res.body, /Kimi 最终答案。/);
    assert.deepEqual(requests[0].body.thinking, { type: 'enabled' });
    assert.equal(requests[0].body.max_tokens, 16000);
    assert.equal(Object.hasOwn(requests[0].body, 'reasoning_effort'), false);
    assert.equal(Object.hasOwn(requests[0].body, 'enable_thinking'), false);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.reasoning_content, 'Kimi 先思考。');
    assert.equal(persistedTask.metadata.kimi_thinking_enabled, true);
    assert.equal(persistedTask.metadata.thinking_enabled, true);
});

test('qwen chat stream forwards official enable_thinking flag and reasoning content', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-qwen-1","model":"qwen-max","choices":[{"delta":{"reasoning_content":"Qwen 先思考。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"Qwen 最终答案。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-qwen-key-12345678',
            prompt: '解释一下',
            model: 'qwen-max',
            apiModelGroup: 'chat',
            thinkingMode: 'enabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: reasoning/);
    assert.match(res.body, /Qwen 先思考。/);
    assert.equal(requests[0].body.enable_thinking, true);
    assert.equal(Object.hasOwn(requests[0].body, 'max_tokens'), false);
    assert.equal(Object.hasOwn(requests[0].body, 'thinking'), false);
    assert.equal(Object.hasOwn(requests[0].body, 'reasoning_effort'), false);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.reasoning_content, 'Qwen 先思考。');
    assert.equal(persistedTask.metadata.qwen_enable_thinking, true);
    assert.equal(persistedTask.metadata.thinking_enabled, true);
});

test('grok chat stream forwards official reasoning_effort without thinking flags', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-grok-1","model":"grok-4.3","choices":[{"delta":{"reasoning_content":"Grok 先思考。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"Grok 答案。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-grok-key-12345678',
            prompt: '解释一下',
            model: 'grok-4.3',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            thinkingMode: 'enabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: reasoning/);
    assert.match(res.body, /Grok 先思考。/);
    assert.match(res.body, /Grok 答案。/);
    assert.equal(requests[0].body.reasoning_effort, 'high');
    assert.equal(Object.hasOwn(requests[0].body, 'thinking'), false);
    assert.equal(Object.hasOwn(requests[0].body, 'enable_thinking'), false);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.result_prompt, 'Grok 答案。');
    assert.equal(persistedTask.metadata.reasoning_content, 'Grok 先思考。');
    assert.equal(persistedTask.metadata.thinking_enabled, true);
});

test('thinking chat stream removes an explicit reasoning section repeated in final content', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-grok-duplicate-thinking","model":"grok-4.3","choices":[{"delta":{"reasoning_content":"The user said hello."}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"思"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"考过程"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"：\\n用户发送了“你好”，这是一个简单的中文问候。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"\\n\\n你好！有什么我可以帮您的吗？"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-grok-key-12345678',
            prompt: '你好',
            model: 'grok-4.3',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            thinkingMode: 'enabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(requests[0].body.messages[0].content, /思考摘要已经由界面单独展示/);
    assert.match(res.body, /The user said hello\./);
    assert.match(res.body, /你好！有什么我可以帮您的吗？/);
    assert.doesNotMatch(res.body, /用户发送了“你好”，这是一个简单的中文问候/);
    assert.ok(res.body.indexOf('你好！有什么我可以帮您的吗？') < res.body.indexOf('event: content_done'));
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.result_prompt, '你好！有什么我可以帮您的吗？');
});

test('thinking chat stream preserves a normal answer whose content starts with analysis', async () => {
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            body: new ReadableStream({
                start(controller) {
                    [
                        'data: {"choices":[{"delta":{"reasoning_content":"Review the metrics first."}}]}\n\n',
                        'data: {"choices":[{"delta":{"content":"Analysis: Revenue increased 12% year over year."}}]}\n\n',
                        'data: [DONE]\n\n'
                    ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                    controller.close();
                }
            })
        }),
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-grok-key-12345678',
            prompt: '分析收入数据',
            model: 'grok-4.3',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            thinkingMode: 'enabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.match(res.body, /Analysis: Revenue increased 12% year over year\./);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.result_prompt, 'Analysis: Revenue increased 12% year over year.');
});

test('grok chat stream disables reasoning when thinking mode is off', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-grok-off-1","model":"grok-4.3","choices":[{"delta":{"reasoning_content":"Grok 不应展示。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"Grok 直接回答。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-grok-key-12345678',
            prompt: '解释一下',
            model: 'grok-4.3',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            thinkingMode: 'disabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.body, /event: reasoning/);
    assert.match(res.body, /Grok 直接回答。/);
    assert.equal(requests[0].body.reasoning_effort, 'none');
    assert.match(requests[0].body.messages[0].content, /当前已关闭思考模式/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.reasoning_content, '');
    assert.equal(persistedTask.metadata.thinking_enabled, false);
});

test('grok chat stream drops unsupported reasoning effort values', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-grok-key-12345678',
            prompt: '解释一下',
            model: 'grok-4.3',
            apiModelGroup: 'chat',
            reasoningEffort: 'xhigh'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(Object.hasOwn(requests[0].body, 'reasoning_effort'), false);
});

test('gemini native chat stream uses Interactions API and thinking summaries', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        state: {
            apiBaseUrls: [{
                id: 'api-base-gemini-cn',
                site: 'cn',
                label: 'Gemini API',
                base_url: 'https://generativelanguage.googleapis.com/v1beta',
                is_active: true,
                display_order: 10,
                metadata: {}
            }]
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"event_type":"step.delta","delta":{"type":"thought_summary","content":[{"text":"Gemini 先思考。"}]}}\n\n',
                            'data: {"event_type":"step.delta","delta":{"type":"text","text":"Gemini 最终答案。"},"metadata":{"total_usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18}}}\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: 'gemini-live-key-12345678',
            prompt: '解释一下',
            model: 'gemini-3.5-flash',
            apiModelGroup: 'chat',
            geminiThinkingLevel: 'high'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(requests[0].url, /\/interactions$/);
    assert.equal(requests[0].headers['x-goog-api-key'], 'gemini-live-key-12345678');
    assert.equal(requests[0].body.generation_config.thinking_level, 'high');
    assert.equal(requests[0].body.generation_config.thinking_summaries, 'auto');
    assert.equal(requests[0].body.input.at(-1).type, 'user_input');
    assert.match(requests[0].body.system_instruction, /思考摘要和最终答案都必须使用中文/);
    assert.match(res.body, /event: reasoning/);
    assert.match(res.body, /Gemini 先思考。/);
    assert.match(res.body, /Gemini 最终答案。/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.result_prompt, 'Gemini 最终答案。');
    assert.equal(persistedTask.metadata.executor, 'gemini-native-chat-stream');
    assert.equal(persistedTask.metadata.provider, 'gemini-native');
    assert.equal(persistedTask.metadata.gemini_thinking_level, 'high');
    assert.equal(persistedTask.metadata.reasoning_content, 'Gemini 先思考。');
    assert.equal(persistedTask.total_tokens, 18);
});

test('gemini native chat stream omits thinking configuration when thinking mode is off', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        state: {
            apiBaseUrls: [{
                id: 'api-base-gemini-cn',
                site: 'cn',
                label: 'Gemini API',
                base_url: 'https://generativelanguage.googleapis.com/v1beta',
                is_active: true,
                display_order: 10,
                metadata: {}
            }]
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"event_type":"step.delta","delta":{"type":"thought_summary","content":[{"text":"Gemini 不应展示。"}]}}\n\n',
                            'data: {"event_type":"step.delta","delta":{"type":"text","text":"Gemini 直接回答。"}}\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: 'gemini-live-key-12345678',
            prompt: '解释一下',
            model: 'gemini-3.5-flash',
            apiModelGroup: 'chat',
            geminiThinkingLevel: 'high',
            thinkingMode: 'disabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(Object.hasOwn(requests[0].body.generation_config, 'thinking_level'), false);
    assert.equal(Object.hasOwn(requests[0].body.generation_config, 'thinking_summaries'), false);
    assert.match(requests[0].body.system_instruction, /当前已关闭思考模式/);
    assert.doesNotMatch(res.body, /event: reasoning/);
    assert.match(res.body, /Gemini 直接回答。/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.gemini_thinking_level, '');
    assert.equal(persistedTask.metadata.reasoning_content, '');
    assert.equal(persistedTask.metadata.thinking_enabled, false);
});

test('gemini compatible chat stream sends an explicit disabled reasoning mode', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"reasoning_content":"Gemini 不应展示。"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"Gemini 兼容接口直接回答。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-gemini-key-12345678',
            prompt: '解释一下',
            model: 'gemini-3.5-flash',
            apiModelGroup: 'chat',
            geminiThinkingLevel: 'high',
            thinkingMode: 'disabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests[0].body.reasoning_effort, 'none');
    assert.doesNotMatch(res.body, /event: reasoning/);
    assert.match(res.body, /Gemini 兼容接口直接回答。/);
    assert.match(requests[0].body.messages[0].content, /当前已关闭思考模式/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.reasoning_content, '');
    assert.equal(persistedTask.metadata.thinking_enabled, false);
});

test('gemini compatible chat stream hides English reasoning for a Chinese prompt and disables compression', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ headers: options.headers, body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"reasoning_content":"Interpreting the user inquiry before answering."}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"这是中文最终答案。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-gemini-key-12345678',
            prompt: '请用中文解释',
            model: 'gemini-3.5-flash',
            apiModelGroup: 'chat',
            geminiThinkingLevel: 'minimal',
            thinkingMode: 'enabled'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests[0].headers['Accept-Encoding'], 'identity');
    assert.equal(requests[0].body.reasoning_effort, 'minimal');
    assert.doesNotMatch(res.body, /event: reasoning/);
    assert.match(res.body, /这是中文最终答案。/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.reasoning_content, '');
    assert.equal(persistedTask.metadata.reasoning_language_mismatch, true);
    assert.equal(Object.hasOwn(persistedTask.metadata, 'reasoning_raw_content'), false);
});

test('openai native chat stream uses Responses API reasoning summaries', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        state: {
            apiBaseUrls: [{
                id: 'api-base-openai-cn',
                site: 'cn',
                label: 'OpenAI API',
                base_url: 'https://api.openai.com/v1',
                is_active: true,
                display_order: 10,
                metadata: {}
            }]
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"type":"response.reasoning_summary_text.delta","delta":"OpenAI 先思考。"}\n\n',
                            'data: {"type":"response.output_text.delta","delta":"OpenAI 最终答案。","usage":{"input_tokens":13,"output_tokens":8,"total_tokens":21}}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-live-openai-key-12345678',
            prompt: '解释一下',
            model: 'gpt-5.5',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            serviceTier: 'priority'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(requests[0].url, /\/responses$/);
    assert.equal(requests[0].headers.Authorization, 'Bearer sk-live-openai-key-12345678');
    assert.equal(requests[0].body.reasoning.effort, 'high');
    assert.equal(requests[0].body.reasoning.summary, 'auto');
    assert.equal(requests[0].body.service_tier, 'priority');
    assert.match(res.body, /OpenAI 先思考。/);
    assert.match(res.body, /OpenAI 最终答案。/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.provider, 'openai-native');
    assert.equal(persistedTask.metadata.reasoning_content, 'OpenAI 先思考。');
    assert.equal(persistedTask.total_tokens, 21);
});

test('claude native chat stream uses Messages API extended thinking', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        state: {
            apiBaseUrls: [{
                id: 'api-base-anthropic-cn',
                site: 'cn',
                label: 'Anthropic API',
                base_url: 'https://api.anthropic.com/v1',
                is_active: true,
                display_order: 10,
                metadata: {}
            }]
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Claude 先思考。"}}\n\n',
                            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude 最终答案。"}}\n\n',
                            'data: {"type":"message_delta","usage":{"input_tokens":17,"output_tokens":9}}\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://api.anthropic.com/v1',
            apiKey: 'sk-ant-live-claude-key-12345678',
            prompt: '解释一下',
            model: 'claude-sonnet-4',
            apiModelGroup: 'chat',
            thinkingMode: 'enabled',
            claudeThinkingBudget: '4096'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(requests[0].url, /\/messages$/);
    assert.equal(requests[0].headers['x-api-key'], 'sk-ant-live-claude-key-12345678');
    assert.equal(requests[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(requests[0].body.thinking.type, 'enabled');
    assert.equal(requests[0].body.thinking.budget_tokens, 4096);
    assert.equal(requests[0].body.max_tokens >= 5120, true);
    assert.match(res.body, /Claude 先思考。/);
    assert.match(res.body, /Claude 最终答案。/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.provider, 'claude-native');
    assert.equal(persistedTask.metadata.reasoning_content, 'Claude 先思考。');
    assert.equal(persistedTask.total_tokens, 26);
});

test('non-reasoning openai chat models drop reasoning effort and can attach images', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"content":"看到了图片。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-vision-key-12345678',
            prompt: '描述这张图',
            model: 'gpt-4.1',
            apiModelGroup: 'chat',
            reasoningEffort: 'high',
            imageInputMode: 'auto',
            referenceImageUrl: 'https://cdn.example.com/reference.png'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests[0].body.reasoning_effort, undefined);
    const lastMessage = requests[0].body.messages.at(-1);
    assert.equal(Array.isArray(lastMessage.content), true);
    assert.equal(lastMessage.content[0].type, 'text');
    assert.equal(lastMessage.content[1].type, 'image_url');
    assert.equal(lastMessage.content[1].image_url.url, 'https://cdn.example.com/reference.png');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.image_input_mode, 'auto');
    assert.equal(persistedTask.metadata.attached_image_count, 1);
});

test('api chat stream attaches images when selected model explicitly supports image input', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"content":"已读取图片。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-explicit-vision-key-12345678',
            prompt: '描述图片',
            model: 'deepseek-v4-pro',
            apiModelGroup: 'chat',
            imageInputMode: 'auto',
            supportsImageInput: true,
            referenceImageUrl: 'https://cdn.example.com/deepseek-reference.png'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    const lastMessage = requests[0].body.messages.at(-1);
    assert.equal(Array.isArray(lastMessage.content), true);
    assert.equal(lastMessage.content[1].type, 'image_url');
    assert.equal(lastMessage.content[1].image_url.url, 'https://cdn.example.com/deepseek-reference.png');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.supports_image_input, true);
    assert.equal(persistedTask.metadata.attached_image_count, 1);
});

test('chat stream embeds document and PDF attachment text in the current user message', async () => {
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (_url, options = {}) => {
            requests.push({ body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"content":"已阅读附件。"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: 'sk-live-doc-key-12345678',
            prompt: '总结上传的资料',
            model: 'gpt-4.1',
            apiModelGroup: 'chat',
            chatAttachments: [
                {
                    name: '产品说明.pdf',
                    mimeType: 'application/pdf',
                    size: 2048,
                    text: '这是 PDF 中提取出的关键资料。'
                },
                {
                    name: 'notes.md',
                    mimeType: 'text/markdown',
                    size: 128,
                    text: '补充笔记内容。'
                }
            ]
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    const lastMessage = requests[0].body.messages.at(-1);
    assert.equal(typeof lastMessage.content, 'string');
    assert.match(lastMessage.content, /总结上传的资料/);
    assert.match(lastMessage.content, /\[用户上传的文档\/PDF 文本内容\]/);
    assert.match(lastMessage.content, /附件 1：产品说明\.pdf（application\/pdf）/);
    assert.match(lastMessage.content, /这是 PDF 中提取出的关键资料。/);
    assert.match(lastMessage.content, /附件 2：notes\.md（text\/markdown）/);
    assert.match(lastMessage.content, /补充笔记内容。/);
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.metadata.attached_file_count, 2);
    assert.equal(persistedTask.metadata.attached_files[0].name, '产品说明.pdf');
    assert.equal(persistedTask.metadata.attached_files[0].chars, 17);
    assert.equal(persistedTask.metadata.attached_file_chars, 24);
});

test('api billing mode stores only API key tail and fingerprint, never plaintext key', async () => {
    const plaintextKey = 'sk-live-secret-value-12345678';
    const requests = [];
    const state = {
        pricingRules: [{
            site: 'cn',
            mode: 'chat',
            billing_mode: 'api',
            model: '*',
            resolution: '*',
            ratio: '*',
            quantity: 1,
            points: 0,
            priority: 10,
            is_active: true
        }]
    };
    const { handlers } = createHandlers({
        state,
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'chatcmpl-api-1',
                    usage: {
                        prompt_tokens: 18,
                        completion_tokens: 7,
                        total_tokens: 25
                    },
                    choices: [{
                        message: {
                            content: '一张带有清晨光线的极简产品标题。'
                        }
                    }]
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '帮我写一句图片标题',
            model: 'gpt-5.1',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.billingMode, 'api');
    assert.equal(payload.task.apiKeyTail, '12345678');
    assert.equal(payload.task.apiBaseUrl, 'https://sub2api.fatherkey.com/v1');
    assert.equal(payload.task.status, 'succeeded');
    assert.equal(payload.task.resultPrompt, '一张带有清晨光线的极简产品标题。');
    assert.equal(payload.task.totalTokens, 25);

    const inserted = state.insertedTasks[0];
    assert.ok(inserted);
    assert.equal(JSON.stringify(inserted).includes(plaintextKey), false);
    assert.equal(inserted.api_key_tail, '12345678');
    assert.match(inserted.api_key_fingerprint, /^sha256:[a-f0-9]{24}$/);
    assert.equal(inserted.estimated_points, 0);
    assert.equal(state.apiUsage.length, 1);
    assert.equal(state.apiUsage[0].total_tokens, 25);
    assert.equal(state.apiUsage[0].api_key_tail, '12345678');
    assert.equal(JSON.stringify(state.apiUsage).includes(plaintextKey), false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://sub2api.fatherkey.com/v1/chat/completions');
    assert.equal(requests[0].headers.Authorization, `Bearer ${plaintextKey}`);
    assert.equal(requests[0].body.model, 'gpt-5.1');
});

test('api chat stream forwards context and persists streamed response in one thread', async () => {
    const plaintextKey = 'sk-live-secret-value-87654321';
    const parentTaskId = '11111111-1111-4111-8111-111111111111';
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"id":"chatcmpl-stream-1","model":"gpt-5.5","choices":[{"delta":{"content":"你好"}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"，这是连续回答。"}}]}\n\n',
                            'data: {"usage":{"prompt_tokens":33,"completion_tokens":8,"total_tokens":41,"prompt_tokens_details":{"cached_tokens":24}},"choices":[{"delta":{}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '继续上一条',
            model: 'gpt-5.5',
            modelLabel: 'Default · gpt-5.5',
            apiModelGroup: 'chat',
            parentTaskId,
            messages: [
                { role: 'user', content: '你是谁' },
                { role: 'assistant', content: '我是 FatherKey AI 工作台助手。' }
            ]
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    assert.match(res.body, /event: task/);
    assert.match(res.body, /event: delta/);
    assert.match(res.body, /你好/);
    assert.match(res.body, /这是连续回答/);
    assert.match(res.body, /event: done/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://sub2api.fatherkey.com/v1/chat/completions');
    assert.equal(requests[0].body.model, 'gpt-5.5');
    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].body.service_tier, undefined);
    assert.equal(requests[0].body.reasoning_effort, undefined);
    assert.equal(requests[0].body.stream_options.include_usage, true);
    assert.match(requests[0].body.prompt_cache_key, /^aiw-chat-[a-f0-9]{32}$/);
    assert.equal(requests[0].body.prompt_cache_key.includes(plaintextKey), false);
    assert.equal(Object.hasOwn(requests[0].body, 'instructions'), false);
    assert.deepEqual(requests[0].body.messages.map((message) => message.role), ['system', 'user', 'assistant', 'user']);
    assert.match(requests[0].body.messages[0].content, /model 字段是：gpt-5\.5/);
    assert.match(requests[0].body.messages[0].content, /必须直接回答这个精确值/);
    assert.doesNotMatch(JSON.stringify(requests[0].body.messages), /Default · gpt-5\.5/);
    assert.doesNotMatch(JSON.stringify(requests[0].body.messages), /界面选择的请求模型/);
    assert.equal(state.insertedTasks[0].parent_task_id, parentTaskId);
    assert.equal(state.insertedTasks[0].api_key_tail, '87654321');
    const persistedTask = state.tasks.find((task) => task.id === state.insertedTasks[0].id);
    assert.equal(persistedTask.status, 'succeeded');
    assert.equal(persistedTask.result_prompt, '你好，这是连续回答。');
    assert.equal(persistedTask.metadata.provider_model, 'gpt-5.5');
    assert.equal(persistedTask.metadata.upstream_model, 'gpt-5.5');
    assert.equal(persistedTask.metadata.service_tier, '');
    assert.equal(persistedTask.metadata.requested_service_tier, 'unset');
    assert.equal(persistedTask.metadata.reasoning_effort, '');
    assert.equal(persistedTask.metadata.requested_reasoning_effort, 'auto');
    assert.match(persistedTask.metadata.prompt_cache_key, /^aiw-chat-[a-f0-9]{32}$/);
    assert.equal(persistedTask.total_tokens, 41);
    assert.equal(persistedTask.token_usage.prompt_tokens_details.cached_tokens, 24);
    assert.equal(state.apiUsage[0].total_tokens, 41);
    assert.equal(state.apiUsage[0].raw_usage.prompt_tokens_details.cached_tokens, 24);
    assert.match(res.body, /"cached_tokens":24/);
    assert.equal(JSON.stringify(state).includes(plaintextKey), false);
});

test('api chat stream saves user API key encrypted and reuses it without exposing plaintext', async () => {
    const plaintextKey = 'sk-live-secret-value-persist8765';
    const requests = [];
    const encoder = new TextEncoder();
    const state = {};
    const makeStream = (text) => ({
        ok: true,
        status: 200,
        body: new ReadableStream({
            start(controller) {
                [
                    `data: {"model":"gpt-5.5","choices":[{"delta":{"content":"${text}"}}]}\n\n`,
                    'data: {"usage":{"prompt_tokens":9,"completion_tokens":3,"total_tokens":12},"choices":[{"delta":{}}]}\n\n',
                    'data: [DONE]\n\n'
                ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                controller.close();
            }
        })
    });
    const fetchImpl = async (url, options = {}) => {
        requests.push({
            url,
            headers: options.headers,
            body: JSON.parse(options.body)
        });
        return makeStream(requests.length === 1 ? '首轮' : '续轮');
    };

    const first = createHandlers({
        state,
        fetchImpl,
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '保存我的 Key',
            model: 'gpt-5.5',
            apiModelGroup: 'chat'
        }
    });
    const firstRes = createMockResponse();
    await first.handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, firstRes);

    assert.equal(firstRes.statusCode, 200);
    assert.equal(requests[0].headers.Authorization, `Bearer ${plaintextKey}`);
    assert.equal(state.userApiKeys.length, 1);
    assert.equal(state.userApiKeys[0].user_id, 'user-ai-1');
    assert.equal(state.userApiKeys[0].api_base_url, 'https://sub2api.fatherkey.com/v1');
    assert.equal(state.userApiKeys[0].api_key_tail, 'sist8765');
    assert.match(state.userApiKeys[0].api_key_fingerprint, /^sha256:[a-f0-9]{24}$/);
    assert.equal(JSON.stringify(state.userApiKeys).includes(plaintextKey), false);
    assert.match(firstRes.body, /"storedApiKey"/);
    assert.match(firstRes.body, /"apiKeyTail":"sist8765"/);
    assert.equal(firstRes.body.includes(plaintextKey), false);

    const second = createHandlers({
        state,
        fetchImpl,
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            prompt: '不重新填写 Key',
            model: 'gpt-5.5',
            apiModelGroup: 'chat'
        }
    });
    const secondRes = createMockResponse();
    await second.handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, secondRes);

    assert.equal(secondRes.statusCode, 200);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].headers.Authorization, `Bearer ${plaintextKey}`);
    assert.equal(requests[1].body.prompt_cache_key.includes(plaintextKey), false);
    assert.equal(state.insertedTasks.at(-1).api_key_tail, 'sist8765');
    assert.equal(JSON.stringify(state.tasks).includes(plaintextKey), false);
    assert.equal(secondRes.body.includes(plaintextKey), false);

    const otherUser = createHandlers({
        state,
        userId: 'user-ai-2',
        fetchImpl,
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            prompt: '不该用到别人的 Key',
            model: 'gpt-5.5',
            apiModelGroup: 'chat'
        }
    });
    const otherRes = createMockResponse();
    await otherUser.handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, otherRes);
    const otherPayload = otherRes.json();

    assert.equal(otherRes.statusCode, 400);
    assert.equal(otherPayload.code, 'api_key_required');
    assert.equal(requests.length, 2);
});

test('ai image pricing config returns only stored API key status metadata', async () => {
    const plaintextKey = 'sk-live-secret-status-only1234';
    const encoder = new TextEncoder();
    const state = {};
    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        body: new ReadableStream({
            start(controller) {
                [
                    'data: {"model":"gpt-5.5","choices":[{"delta":{"content":"ok"}}]}\n\n',
                    'data: [DONE]\n\n'
                ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                controller.close();
            }
        })
    });
    const save = createHandlers({
        state,
        fetchImpl,
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '保存 Key',
            model: 'gpt-5.5',
            apiModelGroup: 'chat'
        }
    });
    await save.handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, createMockResponse());

    const pricing = createHandlers({
        state,
        fetchImpl
    });
    const res = createMockResponse();
    await pricing.handlers.pricing({ method: 'GET', url: '/api/public/ai-image/pricing?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.stored_api_keys.length, 1);
    assert.equal(payload.stored_api_keys[0].apiKeyTail, 'only1234');
    assert.equal(payload.stored_api_keys[0].api_base_url, 'https://sub2api.fatherkey.com/v1');
    assert.equal(Object.prototype.hasOwnProperty.call(payload.stored_api_keys[0], 'encrypted_api_key'), false);
    assert.equal(JSON.stringify(payload).includes(plaintextKey), false);
});

test('api chat stream ignores local preview ids before uuid database writes', async () => {
    const plaintextKey = 'sk-live-secret-value-87654321';
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers, state } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '你好',
            model: 'gpt-5.5',
            apiModelGroup: 'chat',
            parentTaskId: 'aiw_mqs4zgv5_6nh09v',
            referenceTaskId: 'aiw_mqs4zgv5_6nh09v',
            referenceResultId: 'aiw_result_preview'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /event: done/);
    assert.equal(state.insertedTasks[0].parent_task_id, null);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.messages.at(-1).content, '你好');
});

test('api chat stream normalizes fast service tier and custom reasoning effort', async () => {
    const plaintextKey = 'sk-live-secret-value-87654321';
    const requests = [];
    const encoder = new TextEncoder();
    const { handlers } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        [
                            'data: {"model":"gpt-5.5","choices":[{"delta":{"content":"ok"}}]}\n\n',
                            'data: {"usage":{"input_tokens":8,"output_tokens":2,"total_tokens":10},"choices":[{"delta":{}}]}\n\n',
                            'data: [DONE]\n\n'
                        ].forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                        controller.close();
                    }
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '你好',
            model: 'gpt-5.5',
            apiModelGroup: 'chat',
            serviceTier: 'fast',
            reasoningEffort: 'medium'
        }
    });
    const res = createMockResponse();

    await handlers.chatStream({ method: 'POST', url: '/api/public/ai-image/chat-stream' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.service_tier, 'priority');
    assert.equal(requests[0].body.reasoning_effort, 'medium');
    assert.equal(requests[0].body.stream_options.include_usage, true);
	assert.equal(requests[0].headers['Accept-Encoding'], 'identity');
});

test('api billing mode can execute image generation immediately and record image usage', async () => {
    const plaintextKey = 'sk-live-secret-value-87654321';
    const requests = [];
    const { handlers, state } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url) === 'https://cdn.example.com/generated-api.png') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'image/png' : ''
                    },
                    arrayBuffer: async () => Buffer.from('generated-api-image-bytes')
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'img-api-1',
                    usage: {
                        input_tokens: 35,
                        output_tokens: 0,
                        total_tokens: 35
                    },
                    data: [{
                        url: 'https://cdn.example.com/generated-api.png',
                        revised_prompt: '高端商业质感产品图'
                    }]
                })
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => ({
            image_url: `https://cdn.example.com/persisted/${context.task.id}-${context.index}.png`,
            original_image_url: `https://cdn.example.com/persisted/${context.task.id}-${context.index}.png`,
            storage_path: `ai-images/${context.task.id}-${context.index}.png`,
            original_storage_path: `ai-images/${context.task.id}-${context.index}.png`,
            bytes: buffer.toString('utf8')
        }),
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '生成一张高端商业质感产品图',
            model: 'gemini-image-api',
            apiModelGroup: 'image',
            output: 'image',
            ratio: '16:9',
            resolution: '2k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.status, 'succeeded');
    assert.equal(payload.task.mode, 'text');
    assert.equal(payload.task.images.length, 1);
    assert.match(payload.task.images[0].imageUrl, /^https:\/\/cdn\.example\.com\/persisted\//);
    assert.match(payload.task.images[0].storagePath, /^ai-images\//);
    assert.equal(payload.task.resolution, '2k');
    assert.equal(payload.task.ratio, '16:9');
    assert.equal(state.results.length, 1);
    assert.equal(state.apiUsage.length, 1);
    assert.equal(state.apiUsage[0].image_count, 1);
    assert.equal(state.apiUsage[0].resolution, '2k');
    assert.equal(JSON.stringify(state.insertedTasks[0]).includes(plaintextKey), false);
    assert.equal(JSON.stringify(state.apiUsage).includes(plaintextKey), false);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://sub2api.fatherkey.com/v1/images/generations');
    assert.equal(requests[0].headers.Authorization, `Bearer ${plaintextKey}`);
    assert.equal(requests[0].body.model, 'gemini-image-api');
    assert.equal(requests[0].body.size, '2048x1152');
    assert.equal(requests[1].url, 'https://cdn.example.com/generated-api.png');
});

test('api billing image generation honors requested quantity with one request per image', async () => {
    const plaintextKey = 'sk-live-secret-value-two-images';
    const generationRequests = [];
    const { handlers, state } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            if (String(url).startsWith('https://cdn.example.com/generated-api-two-')) {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'image/png' : ''
                    },
                    arrayBuffer: async () => Buffer.from(`image-bytes:${url}`)
                };
            }
            generationRequests.push(JSON.parse(options.body));
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: `img-api-two-${generationRequests.length}`,
                    usage: {
                        input_tokens: 20,
                        output_tokens: 0,
                        total_tokens: 20
                    },
                    data: [{
                        url: `https://cdn.example.com/generated-api-two-${generationRequests.length}.png`,
                        revised_prompt: '两张商业图'
                    }]
                })
            };
        },
        uploadImageBuffer: async (_buffer, context = {}) => ({
            image_url: `https://cdn.example.com/persisted/${context.task.id}-${context.index}.webp`,
            original_image_url: `https://cdn.example.com/persisted/${context.task.id}-${context.index}.png`,
            storage_path: `ai-images/${context.task.id}-${context.index}.webp`,
            original_storage_path: `ai-images/${context.task.id}-${context.index}.png`
        }),
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '生成两张高端商业质感产品图',
            model: 'gpt-image-api',
            apiModelGroup: 'image',
            output: 'image',
            ratio: '9:16',
            resolution: '2k',
            quantity: 2
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.quantity, 2);
    assert.equal(payload.task.images.length, 2);
    assert.equal(payload.task.metadata.requested_image_count, 2);
    assert.equal(payload.task.metadata.delivered_image_count, 2);
    assert.equal(payload.task.metadata.delivery.partial, false);
    assert.equal(state.apiUsage.length, 1);
    assert.equal(state.apiUsage[0].image_count, 2);
    assert.equal(state.apiUsage[0].total_tokens, 40);
    assert.equal(generationRequests.length, 2);
    assert.deepEqual(generationRequests.map((request) => request.n), [1, 1]);
});

test('api billing image generation preserves requested 1k resolution in provider size', async () => {
    const plaintextKey = 'sk-live-secret-value-1k123456';
    const requests = [];
    const { handlers, state } = createHandlers({
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                headers: options.headers,
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url) === 'https://cdn.example.com/generated-api-1k.png') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'image/png' : ''
                    },
                    arrayBuffer: async () => Buffer.from('generated-api-1k-image-bytes')
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'img-api-1k',
                    usage: {
                        total_tokens: 12
                    },
                    data: [{
                        url: 'https://cdn.example.com/generated-api-1k.png',
                        revised_prompt: '1k 商业质感产品图'
                    }]
                })
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => ({
            image_url: `https://cdn.example.com/persisted/${context.task.id}-${context.index}.png`,
            original_image_url: `https://cdn.example.com/persisted/${context.task.id}-${context.index}.png`,
            storage_path: `ai-images/${context.task.id}-${context.index}.png`,
            original_storage_path: `ai-images/${context.task.id}-${context.index}.png`,
            bytes: buffer.toString('utf8')
        }),
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '生成一张 1k 高端商业质感产品图',
            model: 'gpt-image-api',
            apiModelGroup: 'image',
            output: 'image',
            ratio: '16:9',
            resolution: '1k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.resolution, '1k');
    assert.equal(payload.task.images[0].width, 1024);
    assert.equal(payload.task.images[0].height, 640);
    assert.equal(state.apiUsage[0].resolution, '1k');
    assert.equal(requests[0].url, 'https://sub2api.fatherkey.com/v1/images/generations');
    assert.equal(requests[0].body.size, '1024x640');
    assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, 'quality'), false);
});

test('api billing mode rejects non-admin-allowed base URLs', async () => {
    const { handlers } = createHandlers({
        body: {
            billingMode: 'api',
            apiBaseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-live-secret-value-12345678',
            prompt: '写一段话'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'api_base_url_not_allowed');
});

test('api billing mode rejects when admin has no enabled API base URLs', async () => {
    const { handlers } = createHandlers({
        state: {
            apiBaseUrls: []
        },
        body: {
            billingMode: 'api',
            apiKey: 'sk-live-secret-value-12345678',
            prompt: '写一段话'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'api_base_url_not_configured');
});

test('api billing mode accepts admin configured Sub2API base URLs', async () => {
    const requests = [];
    const { handlers, state } = createHandlers({
        state: {
            apiBaseUrls: [{
                id: 'api-base-custom',
                site: 'cn',
                label: 'Custom Sub2API',
                base_url: 'https://sub2api.custom.example/v1',
                is_active: true,
                display_order: 1,
                metadata: {}
            }]
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url, body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'chatcmpl-custom-1',
                    usage: { total_tokens: 9 },
                    choices: [{
                        message: { content: '自定义 Sub2API 已响应' }
                    }]
                })
            };
        },
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.custom.example/v1',
            apiKey: 'sk-live-custom-12345678',
            prompt: '写一句标题',
            model: 'custom-chat-model',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.apiBaseUrl, 'https://sub2api.custom.example/v1');
    assert.equal(payload.task.resultPrompt, '自定义 Sub2API 已响应');
    assert.equal(requests[0].url, 'https://sub2api.custom.example/v1/chat/completions');
    assert.equal(state.apiUsage[0].api_base_url, 'https://sub2api.custom.example/v1');
});

test('api billing mode marks upstream failures failed without site point deduction or plaintext key persistence', async () => {
    const plaintextKey = 'sk-live-secret-value-fail1234';
    const { handlers, state } = createHandlers({
        fetchImpl: async () => ({
            ok: false,
            status: 429,
            text: async () => JSON.stringify({
                error: {
                    code: 'rate_limit_exceeded',
                    message: 'Sub2API upstream quota exceeded'
                }
            })
        }),
        body: {
            site: 'cn',
            billingMode: 'api',
            apiBaseUrl: 'https://sub2api.fatherkey.com/v1',
            apiKey: plaintextKey,
            prompt: '帮我写一句标题',
            model: 'gpt-5.1',
            apiModelGroup: 'chat'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, false);
    assert.equal(payload.task.status, 'failed');
    assert.equal(payload.task.errorCode, 'rate_limit_exceeded');
    assert.equal(payload.task.chargedPoints, 0);
    assert.equal(state.apiUsage.length, 0);
    assert.equal(state.results.length, 0);
    assert.equal(JSON.stringify(state.insertedTasks[0]).includes(plaintextKey), false);
    assert.equal(JSON.stringify(state.tasks).includes(plaintextKey), false);
});

test('failed point tasks serialize as zero cost while preserving estimated points', async () => {
    const state = {
        tasks: [{
            id: 'task-failed-points',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'image',
            billing_mode: 'points',
            status: 'failed',
            model: 'gpt-image-1',
            ratio: '21:9',
            resolution: '1k',
            quantity: 1,
            prompt: '失败的续作',
            estimated_points: 10,
            charged_points: 0,
            error_code: 'ai_image_provider_connection_failed',
            error_message: '上游连接失败',
            created_at: '2026-06-21T12:00:00.000Z',
            updated_at: '2026-06-21T12:00:00.000Z'
        }]
    };
    const { handlers } = createHandlers({ state });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].status, 'failed');
    assert.equal(payload.tasks[0].estimatedPoints, 10);
    assert.equal(payload.tasks[0].chargedPoints, 0);
    assert.equal(payload.tasks[0].cost, 0);
});

test('stopped point tasks serialize actual charged points when upstream billed usage', async () => {
    const state = {
        tasks: [{
            id: 'task-cancelled-charged',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'chat',
            billing_mode: 'points',
            status: 'cancelled',
            model: 'claude-opus-4-8',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '写一段文案',
            result_prompt: '已经生成的部分回答',
            estimated_points: 8,
            charged_points: 0.37,
            created_at: '2026-06-21T12:00:00.000Z',
            updated_at: '2026-06-21T12:00:05.000Z'
        }]
    };
    const { handlers } = createHandlers({ state });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].status, 'cancelled');
    assert.equal(payload.tasks[0].estimatedPoints, 8);
    assert.equal(payload.tasks[0].chargedPoints, 0.37);
    assert.equal(payload.tasks[0].cost, 0.37);
    assert.equal(payload.tasks[0].resultPrompt, '已经生成的部分回答');
});

test('task list reconciles delayed Sub2API actual cost and deducts points once', async () => {
    const requests = [];
    const state = {
        tasks: [{
            id: 'task-delayed-sub2api-usage',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'chat',
            billing_mode: 'points',
            status: 'succeeded',
            model: 'deepseek-v4-flash',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '你好',
            result_prompt: '你好！有什么可以帮你的吗？',
            estimated_points: 0,
            charged_points: 0,
            token_usage: {
                input_tokens: 61,
                output_tokens: 87,
                total_tokens: 148
            },
            input_tokens: 61,
            output_tokens: 87,
            total_tokens: 148,
            metadata: {
                sub2api_client_request_id: 'fatherkey-aiw-task-delayed-sub2api-usage',
                pricing: {
                    matched_rule: {
                        id: 'pricing-delayed-sub2api-chat',
                        metadata: {
                            billing_strategy: 'token_sub2api',
                            pricing: {
                                unit: 'sub2api_actual_cost_usd',
                                cost_source: 'sub2api_usage_actual_cost',
                                points_per_usd: 1
                            }
                        }
                    }
                }
            },
            created_at: '2026-06-21T12:00:00.000Z',
            updated_at: '2026-06-21T12:00:03.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-delayed-sub2api-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), headers: options.headers || {} });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    usage_record: {
                        request_id: 'client:fatherkey-aiw-task-delayed-sub2api-usage',
                        actual_cost: 0.0002,
                        total_cost: 0.0002,
                        input_cost: 0.000033,
                        output_cost: 0.000167
                    }
                })
            };
        }
    });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    assert.equal(res.statusCode, 200);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].chargedPoints, 0.0002);
    assert.equal(payload.tasks[0].cost, 0.0002);
    assert.equal(state.tasks[0].charged_points, 0.0002);
    assert.equal(state.tasks[0].metadata.pricing_charge.reconciled, true);
    assert.equal(deductCall.args.p_amount, 0.0002);
    assert.equal(requests.some((request) => request.url === `https://sub2api.fatherkey.com/v1/usage/requests/${encodeURIComponent('client:fatherkey-aiw-task-delayed-sub2api-usage')}`), true);
});

test('task list treats zero-cost Sub2API usage detail as settled billing', async () => {
    const state = {
        tasks: [{
            id: 'task-zero-sub2api-usage',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'chat',
            billing_mode: 'points',
            status: 'succeeded',
            model: 'qwen3.7-max',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '解释一下',
            result_prompt: '半截回答',
            estimated_points: 0,
            charged_points: 0,
            token_usage: {
                input_tokens: 352,
                output_tokens: 422,
                total_tokens: 774
            },
            input_tokens: 352,
            output_tokens: 422,
            total_tokens: 774,
            metadata: {
                sub2api_client_request_id: 'fatherkey-aiw-task-zero-sub2api-usage',
                pricing: {
                    matched_rule: {
                        id: 'pricing-zero-sub2api-chat',
                        metadata: {
                            billing_strategy: 'token_sub2api',
                            pricing: {
                                unit: 'sub2api_actual_cost_usd',
                                cost_source: 'sub2api_usage_actual_cost',
                                points_per_usd: 1
                            }
                        }
                    }
                }
            },
            created_at: '2026-06-21T12:00:00.000Z',
            updated_at: '2026-06-21T12:00:03.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-zero-sub2api-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                usage_record: {
                    request_id: 'client:fatherkey-aiw-task-zero-sub2api-usage',
                    actual_cost: 0,
                    total_cost: 0,
                    input_cost: 0,
                    output_cost: 0
                }
            })
        })
    });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].chargedPoints, 0);
    assert.equal(payload.tasks[0].billingSyncStatus, 'settled');
    assert.equal(payload.tasks[0].billingSyncMessage, '扣费已同步');
    assert.equal(state.tasks[0].metadata.sub2api_billing_sync.status, 'settled');
    assert.equal(state.tasks[0].token_usage.sub2api.actual_cost, 0);
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown'), false);
});

test('task list keeps returning when delayed Sub2API usage lookup hangs', { timeout: 1000 }, async () => {
    const requests = [];
    const state = {
        tasks: [{
            id: 'task-delayed-sub2api-timeout',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'chat',
            billing_mode: 'points',
            status: 'succeeded',
            model: 'deepseek-v4-flash',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '你好',
            result_prompt: '你好',
            estimated_points: 0,
            charged_points: 0,
            token_usage: {
                input_tokens: 61,
                output_tokens: 87,
                total_tokens: 148
            },
            input_tokens: 61,
            output_tokens: 87,
            total_tokens: 148,
            metadata: {
                sub2api_client_request_id: 'fatherkey-aiw-task-delayed-sub2api-timeout',
                pricing: {
                    matched_rule: {
                        id: 'pricing-delayed-sub2api-timeout',
                        metadata: {
                            billing_strategy: 'token_sub2api',
                            pricing: {
                                unit: 'sub2api_actual_cost_usd',
                                cost_source: 'sub2api_usage_actual_cost',
                                points_per_usd: 1
                            }
                        }
                    }
                }
            },
            created_at: '2026-06-21T12:00:00.000Z',
            updated_at: '2026-06-21T12:00:03.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-delayed-sub2api-timeout-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_INTERVAL_MS: '0',
            AI_IMAGE_SUB2API_RECONCILE_TIMEOUT_MS: '50'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), headers: options.headers || {} });
            return new Promise(() => {});
        }
    });
    const res = createMockResponse();
    const startedAt = Date.now();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const elapsedMs = Date.now() - startedAt;
    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].status, 'succeeded');
    assert.equal(payload.tasks[0].chargedPoints, 0);
    assert.equal(state.tasks[0].charged_points, 0);
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown'), false);
    assert.equal(requests.length > 0, true);
    assert.equal(elapsedMs < 500, true);
});

test('task list finalizes old Sub2API billing sync when usage detail is not found', async () => {
    const state = {
        tasks: [{
            id: 'task-old-sub2api-not-found',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'chat',
            billing_mode: 'points',
            status: 'succeeded',
            model: 'deepseek-v4-flash',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '你好',
            result_prompt: '你好',
            estimated_points: 0,
            charged_points: 0,
            token_usage: {
                input_tokens: 61,
                output_tokens: 87,
                total_tokens: 148
            },
            input_tokens: 61,
            output_tokens: 87,
            total_tokens: 148,
            metadata: {
                sub2api_client_request_id: 'fatherkey-aiw-task-old-sub2api-not-found',
                pricing: {
                    matched_rule: {
                        id: 'pricing-old-sub2api-not-found',
                        metadata: {
                            billing_strategy: 'token_sub2api',
                            pricing: {
                                unit: 'sub2api_actual_cost_usd',
                                cost_source: 'sub2api_usage_actual_cost',
                                points_per_usd: 1
                            }
                        }
                    }
                }
            },
            created_at: '2026-06-21T12:00:00.000Z',
            updated_at: '2026-06-21T12:00:03.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-old-sub2api-not-found-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_INTERVAL_MS: '0',
            AI_IMAGE_SUB2API_USAGE_FINALIZE_MISSING_AFTER_MS: '0'
        },
        fetchImpl: async () => ({
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ error: { message: 'not found' } })
        })
    });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].chargedPoints, 0);
    assert.equal(payload.tasks[0].billingSyncStatus, 'not_found');
    assert.equal(payload.tasks[0].billingSyncMessage, '未找到上游扣费明细');
    assert.equal(state.tasks[0].metadata.sub2api_billing_sync.status, 'not_found');
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown'), false);
});

test('task list marks old Sub2API billing sync missing request id when legacy task cannot be traced', async () => {
    const state = {
        tasks: [{
            id: 'task-old-sub2api-missing-request-id',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'chat',
            billing_mode: 'points',
            status: 'succeeded',
            model: 'deepseek-v4-flash',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '你好',
            result_prompt: '你好',
            estimated_points: 0,
            charged_points: 0,
            token_usage: {
                input_tokens: 61,
                output_tokens: 87,
                total_tokens: 148
            },
            input_tokens: 61,
            output_tokens: 87,
            total_tokens: 148,
            metadata: {
                pricing: {
                    matched_rule: {
                        id: 'pricing-old-sub2api-missing-request-id',
                        metadata: {
                            billing_strategy: 'token_sub2api',
                            pricing: {
                                unit: 'sub2api_actual_cost_usd',
                                cost_source: 'sub2api_usage_actual_cost',
                                points_per_usd: 1
                            }
                        }
                    }
                }
            },
            created_at: '2026-06-21T12:00:00.000Z',
            updated_at: '2026-06-21T12:00:03.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_API_KEY: 'sk-server-old-sub2api-missing-request-id-key',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_RECONCILE_LOOKUP_INTERVAL_MS: '0',
            AI_IMAGE_SUB2API_USAGE_FINALIZE_MISSING_AFTER_MS: '0'
        },
        fetchImpl: async () => ({
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ error: { message: 'not found' } })
        })
    });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].chargedPoints, 0);
    assert.equal(payload.tasks[0].billingSyncStatus, 'missing_request_id');
    assert.equal(payload.tasks[0].billingSyncMessage, '旧记录缺少扣费追踪ID');
    assert.equal(state.tasks[0].metadata.sub2api_billing_sync.status, 'missing_request_id');
    assert.equal(state.rpcCalls.some((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown'), false);
});

test('running image tasks expose partial results without marking task succeeded', async () => {
    const state = {
        tasks: [{
            id: 'task-running-partial',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'running',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '2k',
            quantity: 2,
            prompt: '运行中先显示首图',
            estimated_points: 36,
            charged_points: 0,
            created_at: '2026-06-21T11:00:00.000Z',
            started_at: '2026-06-21T11:00:01.000Z',
            updated_at: '2026-06-21T11:00:02.000Z',
            metadata: {}
        }],
        results: [{
            id: 'result-running-partial-0',
            task_id: 'task-running-partial',
            site: 'cn',
            user_id: 'user-ai-1',
            result_index: 0,
            image_url: 'https://cdn.example.com/partial-preview.webp',
            original_image_url: '',
            storage_path: 'ai-images/partial-preview.webp',
            original_storage_path: '',
            mime_type: 'image/webp',
            ratio: '1:1',
            resolution: '2k',
            created_at: '2026-06-21T11:00:20.000Z',
            metadata: {
                original_status: 'pending',
                preview_bytes: 123456
            }
        }]
    };
    const { handlers } = createHandlers({ state });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].status, 'running');
    assert.equal(payload.tasks[0].images.length, 1);
    assert.equal(payload.tasks[0].images[0].imageUrl, 'https://cdn.example.com/partial-preview.webp');
    assert.equal(payload.tasks[0].images[0].originalReady, false);
    assert.equal(payload.tasks[0].images[0].previewBytes, 123456);
    assert.equal(payload.tasks[0].images[0].preview_bytes, 123456);
    assert.equal(payload.tasks[0].images[0].originalBytes, 0);
    assert.equal(state.tasks[0].status, 'running');
    assert.equal(state.tasks[0].charged_points, 0);
});

test('running image tasks with complete stored results recover to succeeded on list', async () => {
    const state = {
        tasks: [{
            id: 'task-running-complete',
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'running',
            model: 'gpt-image-2',
            ratio: '9:16',
            resolution: '1k',
            quantity: 1,
            prompt: '已经生成但状态未收口',
            estimated_points: 8,
            charged_points: 0,
            created_at: '2026-06-21T11:00:00.000Z',
            started_at: '2026-06-21T11:00:01.000Z',
            updated_at: '2026-06-21T11:00:02.000Z',
            metadata: {}
        }],
        results: [{
            id: 'result-running-complete-0',
            task_id: 'task-running-complete',
            site: 'cn',
            user_id: 'user-ai-1',
            result_index: 0,
            image_url: 'https://cdn.example.com/complete-preview.webp',
            original_image_url: 'https://cdn.example.com/complete-original.png',
            storage_path: 'ai-images/complete-preview.webp',
            original_storage_path: 'ai-images/complete-original.png',
            mime_type: 'image/webp',
            ratio: '9:16',
            resolution: '1k',
            prompt: '已经生成但状态未收口',
            revised_prompt: '完整结果',
            created_at: '2026-06-21T11:00:20.000Z',
            metadata: {
                original_status: 'ready',
                preview_bytes: 234567,
                original_bytes: 3456789
            }
        }]
    };
    const { handlers } = createHandlers({ state });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn' }, res);

    const payload = res.json();
    const deductCall = state.rpcCalls.find((call) => call.name === 'fn_deduct_points_admin_site_with_breakdown');
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].status, 'succeeded');
    assert.equal(payload.tasks[0].chargedPoints, 8);
    assert.equal(payload.tasks[0].cost, 8);
    assert.equal(payload.tasks[0].images.length, 1);
    assert.equal(payload.tasks[0].images[0].imageUrl, 'https://cdn.example.com/complete-preview.webp');
    assert.equal(payload.tasks[0].images[0].previewBytes, 234567);
    assert.equal(payload.tasks[0].images[0].originalBytes, 3456789);
    assert.equal(state.tasks[0].status, 'succeeded');
    assert.equal(state.tasks[0].charged_points, 8);
    assert.equal(state.tasks[0].metadata.recovery.previous_status, 'running');
    assert.equal(state.tasks[0].metadata.delivery.delivered_image_count, 1);
    assert.equal(deductCall.args.p_amount, 8);
});

test('points billing mode estimates image cost from active pricing rules', async () => {
    const state = {
        pricingRules: [{
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: 'gpt-image-1',
            resolution: '2k',
            ratio: '16:9',
            quantity: 1,
            points: 18,
            priority: 1,
            is_active: true
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '未来主义产品海报',
            model: 'gpt-image-1',
            ratio: '16:9',
            resolution: '2k',
            quantity: 2
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.mode, 'text');
    assert.equal(payload.task.estimatedPoints, 36);
    assert.equal(payload.task.resolution, '2k');
    assert.equal(payload.task.ratio, '16:9');
    assert.equal(payload.task.quantity, 2);
});

test('points billing mode reuses image generation pricing for image edit tasks', async () => {
    const state = {
        pricingRules: [{
            id: 'pricing-image-generation-shared',
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: 'gpt-image-2',
            resolution: '1k',
            ratio: '1:1',
            quantity: 1,
            points: 12,
            priority: 1,
            is_active: true
        }]
    };
    const { handlers, state: sharedState } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            mode: 'image',
            prompt: '把这张图改成海报风',
            model: 'gpt-image-2',
            apiModelGroup: 'image',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    const insertedTask = sharedState.insertedTasks[0];
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.mode, 'image');
    assert.equal(payload.task.estimatedPoints, 12);
    assert.equal(insertedTask.metadata.pricing.request.mode, 'image');
    assert.equal(insertedTask.metadata.pricing.matched_rule.mode, 'text');
});

test('points billing mode matches pricing rules by concrete upstream provider', async () => {
    const providerPricingId = 'pricing-provider-specific-gpt-image-2';
    const state = {
        pricingRules: [
            {
                id: 'pricing-wildcard-gpt-image-2',
                site: 'cn',
                mode: 'text',
                billing_mode: 'points',
                model: 'gpt-image-2',
                resolution: '1k',
                ratio: '1:1',
                quantity: 1,
                points: 20,
                priority: 1,
                is_active: true,
                metadata: {
                    provider_id: '*'
                }
            },
            {
                id: providerPricingId,
                site: 'cn',
                mode: 'text',
                billing_mode: 'points',
                model: '*',
                resolution: '1k',
                ratio: '1:1',
                quantity: 1,
                points: 7,
                priority: 100,
                is_active: true,
                metadata: {
                    provider_id: 'provider-alpha',
                    provider_label: 'Provider Alpha'
                }
            },
            {
                id: 'pricing-other-provider-gpt-image-2',
                site: 'cn',
                mode: 'text',
                billing_mode: 'points',
                model: 'gpt-image-2',
                resolution: '1k',
                ratio: '1:1',
                quantity: 1,
                points: 99,
                priority: 1,
                is_active: true,
                metadata: {
                    provider_id: 'provider-beta',
                    provider_label: 'Provider Beta'
                }
            }
        ]
    };
    const { handlers, state: sharedState } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '按具体上游计价',
            model: 'gpt-image-2',
            providerId: 'Provider Alpha',
            apiModelGroup: 'image',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    const insertedTask = sharedState.insertedTasks[0];
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.estimatedPoints, 7);
    assert.equal(payload.task.modelProviderId, 'provider-alpha');
    assert.equal(insertedTask.metadata.provider_id, 'provider-alpha');
    assert.equal(insertedTask.metadata.pricing.request.provider_id, 'provider-alpha');
    assert.equal(insertedTask.metadata.pricing.matched_rule.id, providerPricingId);
    assert.equal(insertedTask.metadata.pricing.matched_rule.model, '*');
});

test('ai image submit returns queue position and estimated wait for point tasks', async () => {
    const state = {
        tasks: [
            {
                id: 'queued-light',
                site: 'cn',
                user_id: 'user-ai-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'queued',
                model: 'gpt-image-2',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: '低成本任务',
                estimated_points: 4,
                charged_points: 0,
                created_at: '2026-06-21T11:59:50.000Z'
            },
            {
                id: 'queued-heavy',
                site: 'cn',
                user_id: 'user-ai-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'queued',
                model: 'gpt-image-2',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: '高成本任务',
                estimated_points: 30,
                charged_points: 0,
                created_at: '2026-06-21T11:59:40.000Z'
            }
        ],
        pricingRules: [{
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: 'gpt-image-2',
            resolution: '1k',
            ratio: '1:1',
            quantity: 1,
            points: 8,
            priority: 1,
            is_active: true
        }]
    };
    const { handlers } = createHandlers({
        state,
        env: {
            AI_IMAGE_WORKER_CONCURRENCY: '1'
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '当前任务',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.queue_position, 2);
    assert.equal(payload.estimated_wait_seconds, 90);
    assert.equal(payload.task.queuePosition, 2);
    assert.equal(payload.task.estimatedWaitSeconds, 90);
    assert.equal(payload.task.status, 'queued');
});

test('points billing mode preserves fractional pricing rule and records match metadata', async () => {
    const pricingId = 'pricing-fractional-gpt-image-2';
    const state = {
        pricingRules: [{
            id: pricingId,
            site: 'cn',
            mode: 'text',
            billing_mode: 'points',
            model: 'gpt-image-2',
            resolution: '1k',
            ratio: '1:1',
            quantity: 1,
            points: 0.08,
            priority: 1,
            is_active: true
        }]
    };
    const { handlers, state: sharedState } = createHandlers({
        state,
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '小数定价海报',
            model: 'gpt-image',
            ratio: '1:1',
            resolution: '1k',
            quantity: 2
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.model, 'gpt-image-2');
    assert.equal(payload.task.estimatedPoints, 0.16);
    assert.equal(sharedState.insertedTasks[0].estimated_points, 0.16);
    assert.equal(sharedState.insertedTasks[0].metadata.pricing.source, 'rule');
    assert.equal(sharedState.insertedTasks[0].metadata.pricing.matched_rule.id, pricingId);
    assert.equal(sharedState.insertedTasks[0].metadata.pricing.matched_rule.points, 0.08);
});

test('ai image task list is scoped to authenticated user and site', async () => {
    const state = {
        tasks: [
            {
                id: 'task-owned-cn',
                site: 'cn',
                user_id: 'user-ai-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'succeeded',
                model: 'gpt-image-1',
                api_model_group: 'image',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: 'owned',
                estimated_points: 8,
                charged_points: 8,
                created_at: '2026-06-21T10:00:00.000Z',
                updated_at: '2026-06-21T10:00:00.000Z'
            },
            {
                id: 'task-other-user',
                site: 'cn',
                user_id: 'user-ai-2',
                mode: 'text',
                billing_mode: 'points',
                status: 'succeeded',
                model: 'gpt-image-1',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: 'other',
                estimated_points: 8,
                charged_points: 8,
                created_at: '2026-06-21T11:00:00.000Z',
                updated_at: '2026-06-21T11:00:00.000Z'
            },
            {
                id: 'task-owned-intl',
                site: 'intl',
                user_id: 'user-ai-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'succeeded',
                model: 'gpt-image-1',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: 'intl',
                estimated_points: 8,
                charged_points: 8,
                created_at: '2026-06-21T12:00:00.000Z',
                updated_at: '2026-06-21T12:00:00.000Z'
            }
        ],
        results: [
            {
                id: 'result-owned',
                task_id: 'task-owned-cn',
                site: 'cn',
                user_id: 'user-ai-1',
                result_index: 0,
                image_url: 'https://cdn.example.com/result.png',
                original_image_url: 'https://cdn.example.com/original.png',
                ratio: '1:1',
                resolution: '1k',
                created_at: '2026-06-21T10:00:10.000Z'
            }
        ]
    };
    const { handlers } = createHandlers({ state });
    const res = createMockResponse();

    await handlers.tasks({ method: 'GET', url: '/api/public/ai-image/tasks?site=cn&limit=20' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].id, 'task-owned-cn');
    assert.equal(payload.tasks[0].images.length, 1);
    assert.equal(payload.tasks[0].images[0].originalImageUrl, 'https://cdn.example.com/original.png');
});

test('ai image cancel marks own queued task cancelled without charging', async () => {
    const taskId = '33333333-3333-4333-8333-333333333333';
    const state = {
        tasks: [{
            id: taskId,
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '待取消任务',
            estimated_points: 8,
            charged_points: 0,
            created_at: '2026-06-21T10:00:00.000Z',
            updated_at: '2026-06-21T10:00:00.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            taskId
        }
    });
    const res = createMockResponse();

    await handlers.cancel({ method: 'POST', url: '/api/public/ai-image/cancel' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.status, 'cancelled');
    assert.equal(state.tasks[0].status, 'cancelled');
    assert.equal(state.tasks[0].charged_points, 0);
});

test('ai image cancel refuses running tasks to protect already-started provider cost', async () => {
    const taskId = '44444444-4444-4444-8444-444444444444';
    const state = {
        tasks: [{
            id: taskId,
            site: 'cn',
            user_id: 'user-ai-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'running',
            model: 'gpt-image-1',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '已经开始处理',
            estimated_points: 8,
            charged_points: 0,
            started_at: '2026-06-21T10:00:10.000Z',
            created_at: '2026-06-21T10:00:00.000Z',
            updated_at: '2026-06-21T10:00:10.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            taskId
        }
    });
    const res = createMockResponse();

    await handlers.cancel({ method: 'POST', url: '/api/public/ai-image/cancel' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 409);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'task_not_cancellable');
    assert.equal(payload.message, '任务已进入上游生成阶段，可能已产生扣费，无法取消');
    assert.equal(payload.task.status, 'running');
    assert.equal(state.tasks[0].status, 'running');
});

test('ai image cancel can resolve a queued task by client task id', async () => {
    const state = {
        tasks: [{
            id: '55555555-5555-4555-8555-555555555555',
            site: 'cn',
            user_id: 'user-ai-1',
            client_task_id: 'aiw_local_cancel_1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '本地任务 ID 取消',
            estimated_points: 8,
            charged_points: 0,
            created_at: '2026-06-21T10:00:00.000Z',
            updated_at: '2026-06-21T10:00:00.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            taskId: 'aiw_local_cancel_1'
        }
    });
    const res = createMockResponse();

    await handlers.cancel({ method: 'POST', url: '/api/public/ai-image/cancel' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.status, 'cancelled');
    assert.equal(state.tasks[0].status, 'cancelled');
});

test('ai image download returns own original image URL and records a download event', async () => {
    const state = {
        results: [
            {
                id: 'result-owned-download',
                task_id: 'task-owned-download',
                site: 'cn',
                user_id: 'user-ai-1',
                result_index: 0,
                image_url: 'https://cdn.example.com/preview.png',
                original_image_url: 'https://cdn.example.com/original.png',
                storage_path: 'ai-images/preview.png',
                original_storage_path: 'ai-images/original.png',
                ratio: '1:1',
                resolution: '2k',
                created_at: '2026-06-21T10:00:10.000Z'
            },
            {
                id: 'result-other-download',
                task_id: 'task-other-download',
                site: 'cn',
                user_id: 'user-ai-2',
                result_index: 0,
                image_url: 'https://cdn.example.com/other-preview.png',
                original_image_url: 'https://cdn.example.com/other-original.png',
                storage_path: 'ai-images/other-preview.png',
                original_storage_path: 'ai-images/other-original.png',
                ratio: '1:1',
                resolution: '2k',
                created_at: '2026-06-21T10:00:11.000Z'
            }
        ]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            resultId: 'result-owned-download',
            source: 'result-card'
        }
    });
    const res = createMockResponse();

    await handlers.download({ method: 'POST', url: '/api/public/ai-image/download' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.originalImageUrl, 'https://cdn.example.com/original.png');
    assert.equal(payload.result.id, 'result-owned-download');
    assert.equal(state.downloadEvents.length, 1);
    assert.equal(state.downloadEvents[0].user_id, 'user-ai-1');
    assert.equal(state.downloadEvents[0].result_id, 'result-owned-download');
    assert.equal(state.downloadEvents[0].original_image_url, 'https://cdn.example.com/original.png');
    assert.equal(state.downloadEvents[0].source, 'result-card');
});

test('ai image download applies resource rate limit before writing download event', async () => {
    const state = {
        rateLimitHandler(args = {}) {
            if (String(args.p_key || '').includes('ai-image:download:resource:')) {
                return {
                    allowed: false,
                    limit_value: args.p_limit,
                    remaining: 0,
                    reset_at: '2026-06-21T12:01:30.000Z',
                    retry_after_seconds: 30,
                    hit_count: args.p_limit
                };
            }
            return {
                allowed: true,
                limit_value: args.p_limit,
                remaining: Math.max(0, Number(args.p_limit || 1) - 1),
                reset_at: '2026-06-21T12:01:00.000Z',
                retry_after_seconds: 1,
                hit_count: 1
            };
        },
        results: [
            {
                id: 'result-owned-download-limited',
                task_id: 'task-owned-download-limited',
                site: 'cn',
                user_id: 'user-ai-1',
                result_index: 0,
                image_url: 'https://cdn.example.com/preview.png',
                original_image_url: 'https://cdn.example.com/original.png',
                storage_path: 'ai-images/preview.png',
                original_storage_path: 'ai-images/original.png',
                ratio: '1:1',
                resolution: '2k',
                created_at: '2026-06-21T10:00:10.000Z'
            }
        ]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            resultId: 'result-owned-download-limited',
            source: 'result-card'
        }
    });
    const res = createMockResponse();

    await handlers.download({ method: 'POST', url: '/api/public/ai-image/download' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 429);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'rate_limited');
    assert.equal(payload.scope, 'download:resource');
    assert.equal(payload.retry_after_seconds, 30);
    assert.equal(state.downloadEvents.length, 0);
    assert.ok(state.rpcCalls.some((call) => String(call.args.p_key).includes('ai-image:download:resource:cn:user-ai-1:result-owned-download-limited')));
});

test('ai image download reports pending original without recording a download event', async () => {
    const state = {
        results: [
            {
                id: 'result-pending-download',
                task_id: 'task-pending-download',
                site: 'cn',
                user_id: 'user-ai-1',
                result_index: 0,
                image_url: 'https://cdn.example.com/preview-only.webp',
                original_image_url: '',
                storage_path: 'ai-images/preview-only.webp',
                original_storage_path: '',
                metadata: {
                    preview_status: 'ready',
                    original_status: 'pending'
                },
                ratio: '1:1',
                resolution: '2k',
                created_at: '2026-06-21T10:00:10.000Z'
            }
        ]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            resultId: 'result-pending-download',
            source: 'result-card'
        }
    });
    const res = createMockResponse();

    await handlers.download({ method: 'POST', url: '/api/public/ai-image/download' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 409);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'original_image_pending');
    assert.equal(payload.result.imageUrl, 'https://cdn.example.com/preview-only.webp');
    assert.equal(payload.result.originalImageUrl, '');
    assert.equal(payload.result.originalReady, false);
    assert.equal(payload.result.originalStatus, 'pending');
    assert.equal(state.downloadEvents.length, 0);
});

test('ai image download does not expose another user result', async () => {
    const { handlers } = createHandlers({
        state: {
            results: [
                {
                    id: 'result-other-download',
                    task_id: 'task-other-download',
                    site: 'cn',
                    user_id: 'user-ai-2',
                    result_index: 0,
                    image_url: 'https://cdn.example.com/other-preview.png',
                    original_image_url: 'https://cdn.example.com/other-original.png',
                    ratio: '1:1',
                    resolution: '2k',
                    created_at: '2026-06-21T10:00:11.000Z'
                }
            ]
        },
        body: {
            site: 'cn',
            resultId: 'result-other-download'
        }
    });
    const res = createMockResponse();

    await handlers.download({ method: 'POST', url: '/api/public/ai-image/download' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 404);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'result_not_found');
});

test('ai image usage returns API usage and own download events', async () => {
    const { handlers } = createHandlers({
        state: {
            apiUsage: [
                {
                    id: 'usage-owned',
                    task_id: 'task-api-usage',
                    site: 'cn',
                    user_id: 'user-ai-1',
                    api_base_url: 'https://sub2api.fatherkey.com/v1',
                    api_key_tail: '12345678',
                    model: 'gpt-5.1',
                    model_group: 'chat',
                    request_type: 'chat',
                    input_tokens: 10,
                    output_tokens: 5,
                    total_tokens: 15,
                    image_count: 0,
                    resolution: null,
                    raw_usage: { total_tokens: 15 },
                    created_at: '2026-06-21T10:00:00.000Z'
                }
            ],
            downloadEvents: [
                {
                    id: 'download-owned',
                    task_id: 'task-download-owned',
                    result_id: 'result-download-owned',
                    site: 'cn',
                    user_id: 'user-ai-1',
                    image_url: 'https://cdn.example.com/preview.png',
                    original_image_url: 'https://cdn.example.com/original.png',
                    storage_path: 'ai-images/preview.png',
                    original_storage_path: 'ai-images/original.png',
                    source: 'result-card',
                    created_at: '2026-06-21T10:05:00.000Z'
                },
                {
                    id: 'download-other',
                    task_id: 'task-download-other',
                    result_id: 'result-download-other',
                    site: 'cn',
                    user_id: 'user-ai-2',
                    image_url: 'https://cdn.example.com/other-preview.png',
                    original_image_url: 'https://cdn.example.com/other-original.png',
                    source: 'result-card',
                    created_at: '2026-06-21T10:06:00.000Z'
                }
            ]
        }
    });
    const res = createMockResponse();

    await handlers.usage({ method: 'GET', url: '/api/public/ai-image/usage?site=cn&limit=20' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.apiUsage.length, 1);
    assert.equal(payload.apiUsage[0].total_tokens, 15);
    assert.equal(payload.downloadEvents.length, 1);
    assert.equal(payload.downloadEvents[0].id, 'download-owned');
    assert.equal(payload.downloadEvents[0].originalImageUrl, 'https://cdn.example.com/original.png');
});

test('reverse prompt submissions do not require ratio or resolution', async () => {
    const { handlers, state } = createHandlers({
        body: {
            site: 'cn',
            billingMode: 'points',
            prompt: '反推这个图片的提示词',
            referenceImageUrl: 'https://cdn.example.com/input.png'
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.task.mode, 'reverse');
    assert.equal(payload.task.ratio, '');
    assert.equal(payload.task.resolution, '');
    assert.equal(state.insertedTasks[0].ratio, null);
    assert.equal(state.insertedTasks[0].resolution, null);
});

test('image submissions persist continuation base and extra reference images in metadata', async () => {
    const { handlers, state } = createHandlers({
        body: {
            site: 'cn',
            billingMode: 'points',
            mode: 'image',
            prompt: '保留人物姿态，参考第二张的光影',
            referenceImageUrl: 'https://cdn.example.com/base.png',
            referenceTitle: '续作基底',
            referenceImages: [
                { url: 'https://cdn.example.com/ref-a.png', title: '参考 A' },
                { imageUrl: 'https://cdn.example.com/ref-b.webp', title: '参考 B' },
                { url: 'https://cdn.example.com/base.png', title: '重复基底' }
            ]
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(state.insertedTasks[0].reference_image_url, 'https://cdn.example.com/base.png');
    assert.deepEqual(state.insertedTasks[0].metadata.reference_images, [
        { url: 'https://cdn.example.com/ref-a.png', title: '参考 A', role: 'reference' },
        { url: 'https://cdn.example.com/ref-b.webp', title: '参考 B', role: 'reference' }
    ]);
    assert.equal(state.insertedTasks[0].metadata.reference_image_count, 3);
    assert.equal(payload.task.referenceImages.length, 2);
});

test('image submissions resolve transient continuation preview from persisted result id', async () => {
    const { handlers, state } = createHandlers({
        state: {
            results: [{
                id: '22222222-2222-4222-8222-222222222222',
                task_id: '11111111-1111-4111-8111-111111111111',
                site: 'cn',
                user_id: 'user-ai-1',
                result_index: 0,
                image_url: 'https://cdn.example.com/preview-base.webp',
                original_image_url: 'https://cdn.example.com/original-base.png',
                storage_path: 'ai-images/preview-base.webp',
                original_storage_path: 'ai-images/original-base.png',
                mime_type: 'image/png',
                prompt: '原始生成图',
                metadata: { original_status: 'ready' },
                created_at: '2026-06-21T12:00:00.000Z'
            }]
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            mode: 'image',
            prompt: '基于这张图续作',
            parentTaskId: '11111111-1111-4111-8111-111111111111',
            referenceResultId: '22222222-2222-4222-8222-222222222222',
            referenceImageUrl: `data:image/png;base64,${Buffer.from('temporary-preview').toString('base64')}`,
            referenceImages: [
                { url: 'https://cdn.example.com/ref-a.png', title: '参考 A' }
            ]
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(state.insertedTasks[0].reference_image_url, 'https://cdn.example.com/original-base.png');
    assert.equal(state.insertedTasks[0].reference_image_storage_path, 'ai-images/original-base.png');
    assert.equal(state.insertedTasks[0].metadata.reference_image_count, 2);
});

test('image submissions resolve continuation preview from client task id fallback', async () => {
    const { handlers, state } = createHandlers({
        state: {
            tasks: [{
                id: '11111111-1111-4111-8111-111111111111',
                site: 'cn',
                user_id: 'user-ai-1',
                client_task_id: 'aiw_local_base_task',
                status: 'succeeded',
                mode: 'text',
                prompt: '原始生成图',
                created_at: '2026-06-21T11:58:00.000Z',
                updated_at: '2026-06-21T11:59:00.000Z'
            }],
            results: [{
                id: '22222222-2222-4222-8222-222222222222',
                task_id: '11111111-1111-4111-8111-111111111111',
                site: 'cn',
                user_id: 'user-ai-1',
                result_index: 0,
                image_url: 'https://cdn.example.com/preview-base.webp',
                original_image_url: 'https://cdn.example.com/original-base.png',
                storage_path: 'ai-images/preview-base.webp',
                original_storage_path: 'ai-images/original-base.png',
                mime_type: 'image/png',
                prompt: '原始生成图',
                metadata: { original_status: 'ready' },
                created_at: '2026-06-21T12:00:00.000Z'
            }]
        },
        body: {
            site: 'cn',
            billingMode: 'points',
            mode: 'image',
            prompt: '继续扩展画面',
            referenceTaskId: 'aiw_local_base_task',
            referenceResultIndex: 0,
            referenceImageUrl: `data:image/png;base64,${Buffer.from('temporary-preview').toString('base64')}`
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(state.insertedTasks[0].reference_image_url, 'https://cdn.example.com/original-base.png');
    assert.equal(state.insertedTasks[0].reference_image_storage_path, 'ai-images/original-base.png');
});

test('image submissions reject too many reference image inputs', async () => {
    const { handlers } = createHandlers({
        body: {
            site: 'cn',
            billingMode: 'points',
            mode: 'image',
            prompt: '基于多张参考图创作',
            referenceImageUrl: 'https://cdn.example.com/base.png',
            referenceImages: Array.from({ length: 16 }, (_, index) => ({
                url: `https://cdn.example.com/ref-${index}.png`
            }))
        }
    });
    const res = createMockResponse();

    await handlers.submit({ method: 'POST', url: '/api/public/ai-image/submit' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'reference_image_limit_exceeded');
});

test('ai image task prefs returns own hidden pinned and accent records', async () => {
    const ownedTaskId = '11111111-1111-4111-8111-111111111111';
    const pinnedTaskId = '22222222-2222-4222-8222-222222222222';
    const { handlers } = createHandlers({
        state: {
            taskPrefs: [
                {
                    id: 'pref-hidden',
                    site: 'cn',
                    user_id: 'user-ai-1',
                    task_id: ownedTaskId,
                    hidden_at: '2026-06-24T10:00:00.000Z',
                    pinned_at: null,
                    accent: 'blue',
                    updated_at: '2026-06-24T10:00:00.000Z'
                },
                {
                    id: 'pref-pinned',
                    site: 'cn',
                    user_id: 'user-ai-1',
                    task_id: pinnedTaskId,
                    hidden_at: null,
                    pinned_at: '2026-06-24T10:10:00.000Z',
                    accent: 'rose',
                    updated_at: '2026-06-24T10:10:00.000Z'
                },
                {
                    id: 'pref-other-user',
                    site: 'cn',
                    user_id: 'user-ai-2',
                    task_id: '33333333-3333-4333-8333-333333333333',
                    hidden_at: '2026-06-24T10:20:00.000Z',
                    pinned_at: '2026-06-24T10:20:00.000Z',
                    accent: 'gold',
                    updated_at: '2026-06-24T10:20:00.000Z'
                }
            ]
        }
    });
    const res = createMockResponse();

    await handlers.taskPrefs({ method: 'GET', url: '/api/public/ai-image/task-prefs?site=cn' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.deepEqual(payload.prefs.deletedTaskIds, [ownedTaskId]);
    assert.deepEqual(payload.prefs.pinnedTaskIds, [pinnedTaskId]);
    assert.deepEqual(payload.prefs.taskAccentById, {
        [ownedTaskId]: 'blue',
        [pinnedTaskId]: 'rose'
    });
});

test('ai image task prefs writes only authenticated user owned tasks', async () => {
    const ownedTaskId = '44444444-4444-4444-8444-444444444444';
    const otherTaskId = '55555555-5555-4555-8555-555555555555';
    const { handlers, state } = createHandlers({
        state: {
            tasks: [
                {
                    id: ownedTaskId,
                    site: 'cn',
                    user_id: 'user-ai-1',
                    status: 'succeeded',
                    mode: 'text',
                    billing_mode: 'points',
                    created_at: '2026-06-24T10:00:00.000Z'
                },
                {
                    id: otherTaskId,
                    site: 'cn',
                    user_id: 'user-ai-2',
                    status: 'succeeded',
                    mode: 'text',
                    billing_mode: 'points',
                    created_at: '2026-06-24T10:00:00.000Z'
                }
            ],
            taskPrefs: []
        },
        body: {
            site: 'cn',
            action: 'accent',
            accent: 'gold',
            taskIds: [ownedTaskId, otherTaskId, 'aiw_local_only']
        }
    });
    const res = createMockResponse();

    await handlers.taskPrefs({ method: 'POST', url: '/api/public/ai-image/task-prefs' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(state.taskPrefs.length, 1);
    assert.equal(state.taskPrefs[0].task_id, ownedTaskId);
    assert.equal(state.taskPrefs[0].accent, 'gold');
    assert.deepEqual(payload.prefs.taskAccentById, {
        [ownedTaskId]: 'gold'
    });
});

test('ai image task prefs updates pin hide and clear accent without creating empty rows', async () => {
    const ownedTaskId = '66666666-6666-4666-8666-666666666666';
    const missingTaskId = '77777777-7777-4777-8777-777777777777';
    const state = {
        tasks: [
            {
                id: ownedTaskId,
                site: 'cn',
                user_id: 'user-ai-1',
                status: 'succeeded',
                mode: 'text',
                billing_mode: 'points',
                created_at: '2026-06-24T10:00:00.000Z'
            },
            {
                id: missingTaskId,
                site: 'cn',
                user_id: 'user-ai-1',
                status: 'succeeded',
                mode: 'text',
                billing_mode: 'points',
                created_at: '2026-06-24T10:01:00.000Z'
            }
        ],
        taskPrefs: [{
            id: 'pref-existing',
            site: 'cn',
            user_id: 'user-ai-1',
            task_id: ownedTaskId,
            hidden_at: null,
            pinned_at: '2026-06-24T10:00:00.000Z',
            accent: 'green',
            updated_at: '2026-06-24T10:00:00.000Z'
        }]
    };
    const { handlers } = createHandlers({
        state,
        body: {
            site: 'cn',
            action: 'clear-accent',
            taskIds: [ownedTaskId, missingTaskId]
        }
    });
    const res = createMockResponse();

    await handlers.taskPrefs({ method: 'POST', url: '/api/public/ai-image/task-prefs' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(state.taskPrefs.length, 1);
    assert.equal(state.taskPrefs[0].task_id, ownedTaskId);
    assert.equal(state.taskPrefs[0].accent, null);
    assert.deepEqual(payload.prefs.pinnedTaskIds, [ownedTaskId]);
    assert.deepEqual(payload.prefs.taskAccentById, {});
});
