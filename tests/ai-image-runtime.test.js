const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const {
    buildPlaceholderExecutionResult,
    executeAiImageTask,
    failStaleRunningTasks,
    recoverTaskFromExistingResults,
    runAiImageTaskBatch
} = require('../server/api-handlers/_ai-image-runtime');
const {
    executeOpenAiCompatibleImageGeneration,
    executeGeminiNativeImageGeneration,
    executeOpenAiCompatibleTextVision,
    executeOpenAiCompatibleVideoGeneration,
    buildGeminiNativeImageRequestBody,
    resolveR2Config,
    resolveOpenAiImageSize,
    resolveOpenAiVideoSize,
    resolveAiImageRuntimeConfig,
    resolveResponseBodyTimeoutMs,
    optimizeMp4ForStreaming,
    uploadGeneratedImageBufferPreviewFirst
} = require('../server/api-handlers/_ai-image-models');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function buildImageFetchResponse(bytes = 'reference-image-bytes', mimeType = 'image/png') {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return {
        ok: true,
        status: 200,
        headers: {
            get(name = '') {
                const normalized = String(name).toLowerCase();
                if (normalized === 'content-type') return mimeType;
                if (normalized === 'content-length') return String(buffer.length);
                return '';
            }
        },
        arrayBuffer: async () => buffer
    };
}

function buildMp4Box(type, ...payloads) {
    const body = Buffer.concat(payloads.map((payload) => Buffer.isBuffer(payload) ? payload : Buffer.from(payload || [])));
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + body.length, 0);
    header.write(type, 4, 4, 'latin1');
    return Buffer.concat([header, body]);
}

function buildStcoBox(offsets = []) {
    const payload = Buffer.alloc(8 + offsets.length * 4);
    payload.writeUInt32BE(offsets.length, 4);
    offsets.forEach((offset, index) => payload.writeUInt32BE(offset, 8 + index * 4));
    return buildMp4Box('stco', payload);
}

function findBoxTypeOrder(buffer) {
    const order = [];
    let offset = 0;
    while (offset + 8 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        order.push(buffer.toString('latin1', offset + 4, offset + 8));
        offset += size;
    }
    return order;
}

test('optimizeMp4ForStreaming moves moov before mdat and adjusts stco offsets', () => {
    const ftyp = buildMp4Box('ftyp', Buffer.from('isom0000', 'latin1'));
    const mdat = buildMp4Box('mdat', Buffer.alloc(16, 7));
    const originalChunkOffset = ftyp.length + 8;
    const moov = buildMp4Box('moov',
        buildMp4Box('trak',
            buildMp4Box('mdia',
                buildMp4Box('minf',
                    buildMp4Box('stbl', buildStcoBox([originalChunkOffset]))
                )
            )
        )
    );
    const original = Buffer.concat([ftyp, mdat, moov]);

    const result = optimizeMp4ForStreaming(original, 'video/mp4');

    assert.equal(result.optimized, true);
    assert.equal(result.fastStart, true);
    assert.deepEqual(findBoxTypeOrder(result.buffer), ['ftyp', 'moov', 'mdat']);
    const stcoIndex = result.buffer.indexOf('stco', 0, 'latin1') - 4;
    assert.ok(stcoIndex >= 0);
    const updatedChunkOffset = result.buffer.readUInt32BE(stcoIndex + 16);
    assert.equal(updatedChunkOffset, originalChunkOffset + moov.length);
});

test('optimizeMp4ForStreaming keeps already fast-start MP4 unchanged', () => {
    const ftyp = buildMp4Box('ftyp', Buffer.from('isom0000', 'latin1'));
    const moov = buildMp4Box('moov',
        buildMp4Box('trak',
            buildMp4Box('mdia',
                buildMp4Box('minf',
                    buildMp4Box('stbl', buildStcoBox([64]))
                )
            )
        )
    );
    const mdat = buildMp4Box('mdat', Buffer.alloc(16, 7));
    const original = Buffer.concat([ftyp, moov, mdat]);

    const result = optimizeMp4ForStreaming(original, 'video/mp4');

    assert.equal(result.optimized, false);
    assert.equal(result.fastStart, true);
    assert.equal(result.buffer, original);
});

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        payload: null,
        filters: [],
        order: [],
        limit: null,
        singleMode: ''
    };

    const builder = {
        select() {
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
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        lt(column, value) {
            state.filters.push({ op: 'lt', column, value });
            return builder;
        },
        like(column, value) {
            state.filters.push({ op: 'like', column, value });
            return builder;
        },
        upsert(payload) {
            state.mode = 'upsert';
            state.payload = payload;
            return builder;
        },
        delete() {
            state.mode = 'delete';
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
        if (op === 'lt') {
            const rowTime = Date.parse(String(row[column] || ''));
            const valueTime = Date.parse(String(value || ''));
            if (!Number.isNaN(rowTime) && !Number.isNaN(valueTime)) {
                return rowTime < valueTime;
            }
            return Number(row[column]) < Number(value);
        }
        if (op === 'like') {
            const pattern = String(value || '')
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/%/g, '.*')
                .replace(/_/g, '.');
            return new RegExp(`^${pattern}$`).test(String(row[column] || ''));
        }
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

function createSupabaseStub(state = {}) {
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    state.results = Array.isArray(state.results) ? state.results : [];
    state.apiUsage = Array.isArray(state.apiUsage) ? state.apiUsage : [];
    state.pointsLedger = Array.isArray(state.pointsLedger) ? state.pointsLedger : [];
    state.adminSecrets = Array.isArray(state.adminSecrets) ? state.adminSecrets : [];
    state.rpcCalls = Array.isArray(state.rpcCalls) ? state.rpcCalls : [];
    state.updatedTasks = Array.isArray(state.updatedTasks) ? state.updatedTasks : [];
    state.secretSelectCount = Number(state.secretSelectCount || 0);

    return {
        state,
        rpc(name, args = {}) {
            state.rpcCalls.push({ name, args });
            if (name === 'fn_deduct_points_admin_site_with_breakdown' || name === 'fn_deduct_points_admin_site' || name === 'fn_deduct_points') {
                state.pointsLedger.push({
                    id: `ledger-${state.pointsLedger.length + 1}`,
                    user_id: args.p_target_user_id,
                    amount: -Math.abs(Number(args.p_amount) || 0),
                    reason: args.p_reason,
                    reference_id: args.p_reference_id,
                    site: args.p_site || null,
                    created_at: '2026-06-21T12:00:00.000Z'
                });
                return Promise.resolve({
                    data: { deducted: Number(args.p_amount) || 0 },
                    error: null
                });
            }

            return Promise.resolve({
                data: null,
                error: { message: `Unexpected RPC: ${name}` }
            });
        },
        from(table) {
            return createQueryBuilder(async (query) => {
                const rows = {
                    ai_image_tasks: state.tasks,
                    ai_image_results: state.results,
                    ai_image_api_usage: state.apiUsage,
                    points_ledger: state.pointsLedger,
                    admin_secret_store: state.adminSecrets
                }[table];

                if (!rows) {
                    throw new Error(`Unexpected table: ${table}`);
                }

                if (table === 'admin_secret_store' && query.mode === 'select') {
                    state.secretSelectCount += 1;
                }

                if (query.mode === 'insert') {
                    const payloads = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payloads.map((payload, index) => ({
                        id: `${table}-${rows.length + index + 1}`,
                        created_at: '2026-06-21T12:00:00.000Z',
                        ...clone(payload)
                    }));
                    rows.push(...inserted);
                    return {
                        data: query.singleMode ? inserted[0] : inserted,
                        error: null
                    };
                }

                if (query.mode === 'upsert') {
                    const payloads = Array.isArray(query.payload) ? query.payload : [query.payload];
                    payloads.forEach((payload) => {
                        const existing = rows.find((row) => String(row.secret_key || '') === String(payload.secret_key || ''));
                        if (existing) {
                            Object.assign(existing, clone(payload));
                        } else {
                            rows.push({
                                created_at: '2026-06-21T12:00:00.000Z',
                                ...clone(payload)
                            });
                        }
                    });
                    return {
                        data: null,
                        error: null
                    };
                }

                if (query.mode === 'delete') {
                    const matched = applyFilters(rows, query.filters);
                    for (const row of matched) {
                        const index = rows.indexOf(row);
                        if (index >= 0) {
                            rows.splice(index, 1);
                        }
                    }
                    return {
                        data: null,
                        error: null
                    };
                }

                if (query.mode === 'update') {
                    const matched = applyFilters(rows, query.filters);
                    matched.forEach((row) => {
                        Object.assign(row, clone(query.payload), {
                            updated_at: '2026-06-21T12:00:01.000Z'
                        });
                    });
                    state.updatedTasks.push({ table, payload: clone(query.payload), filters: clone(query.filters) });
                    const first = matched[0] || null;
                    return {
                        data: query.singleMode ? first : matched,
                        error: first ? null : { message: 'not found' }
                    };
                }

                let output = applyOrder(applyFilters(rows, query.filters), query.order);
                if (query.limit) {
                    output = output.slice(0, query.limit);
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

function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFakeR2Client(callback) {
    const originalLoad = Module._load;
    const uploadedObjects = [];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '@aws-sdk/client-s3') {
            return {
                S3Client: class FakeS3Client {
                    async send(command) {
                        uploadedObjects.push(command?.input || {});
                        return {};
                    }
                },
                PutObjectCommand: class FakePutObjectCommand {
                    constructor(input) {
                        this.input = input;
                    }
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return await callback(uploadedObjects);
    } finally {
        Module._load = originalLoad;
    }
}

test('ai image runtime succeeds image task and charges points once on success', async () => {
    const state = {
        tasks: [{
            id: 'task-points-1',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            ratio: '16:9',
            resolution: '2k',
            quantity: 2,
            prompt: '商业海报',
            estimated_points: 18,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({ supabase, task: 'task-points-1' });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.task.charged_points, 18);
    assert.equal(result.results.length, 2);
    assert.equal(state.results.length, 2);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].name, 'fn_deduct_points_admin_site_with_breakdown');
    assert.equal(state.rpcCalls[0].args.p_reference_id, 'task-points-1');
});

test('ai image runtime completes with preview before deferred original upload finishes', async () => {
    const state = {
        tasks: [{
            id: 'task-preview-first',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '2k',
            quantity: 1,
            prompt: '先显示预览',
            estimated_points: 18,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-preview-first',
        executor(task) {
            return {
                status: 'succeeded',
                resultPrompt: task.prompt,
                images: [{
                    image_url: 'https://cdn.example.com/preview.webp',
                    original_image_url: '',
                    storage_path: 'ai-images/preview.webp',
                    original_storage_path: '',
                    result_index: 0,
                    mime_type: 'image/webp',
                    ratio: '1:1',
                    resolution: '2k',
                    prompt: task.prompt,
                    revised_prompt: task.prompt,
                    metadata: {
                        preview_status: 'ready',
                        original_status: 'pending'
                    }
                }],
                deferredOriginalUploads: [{
                    resultIndex: 0,
                    async run() {
                        await sleep(0);
                        return {
                            original_image_url: 'https://cdn.example.com/original.png',
                            original_storage_path: 'ai-images/original.png',
                            metadata: {
                                original_status: 'ready',
                                original_ready_at: '2026-06-21T12:00:02.000Z'
                            }
                        };
                    }
                }],
                tokenUsage: {},
                providerTaskId: 'provider-preview-first',
                metadata: {
                    deferred_original_count: 1
                }
            };
        }
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].image_url, 'https://cdn.example.com/preview.webp');
    assert.equal(result.results[0].original_image_url, '');
    assert.equal(result.task.charged_points, 18);
    assert.equal(state.results[0].original_image_url, '');

    await sleep(20);

    assert.equal(state.results[0].image_url, 'https://cdn.example.com/preview.webp');
    assert.equal(state.results[0].original_image_url, 'https://cdn.example.com/original.png');
    assert.equal(state.results[0].metadata.original_status, 'ready');
});

test('ai video runtime completes with upstream URL before deferred durable copy finishes', async () => {
    const state = {
        tasks: [{
            id: 'task-video-preview-first',
            site: 'cn',
            user_id: 'user-1',
            mode: 'video',
            billing_mode: 'points',
            status: 'queued',
            model: 'seedance-2-0-pro',
            ratio: '16:9',
            resolution: '720p',
            quantity: 1,
            prompt: '海边日落慢镜头',
            estimated_points: 28,
            charged_points: 0,
            metadata: {
                media_type: 'video'
            },
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-video-preview-first',
        executor(task) {
            return {
                status: 'succeeded',
                resultPrompt: task.prompt,
                images: [{
                    image_url: 'https://upstream.example.com/video.mp4',
                    original_image_url: 'https://upstream.example.com/video.mp4',
                    storage_path: '',
                    original_storage_path: '',
                    result_index: 0,
                    mime_type: 'video/mp4',
                    ratio: '16:9',
                    resolution: '720p',
                    prompt: task.prompt,
                    revised_prompt: task.prompt,
                    metadata: {
                        media_type: 'video',
                        preview_status: 'upstream_url',
                        original_status: 'pending',
                        provider_video_url: 'https://upstream.example.com/video.mp4'
                    }
                }],
                deferredOriginalUploads: [{
                    resultIndex: 0,
                    async run() {
                        await sleep(0);
                        return {
                            image_url: 'https://cdn.example.com/ai-videos/video.mp4',
                            original_image_url: 'https://cdn.example.com/ai-videos/video.mp4',
                            storage_path: 'ai-videos/cn/2026/06/user-1/task-video-preview-first-0-original.mp4',
                            original_storage_path: 'ai-videos/cn/2026/06/user-1/task-video-preview-first-0-original.mp4',
                            metadata: {
                                media_type: 'video',
                                preview_status: 'upstream_url',
                                original_status: 'ready',
                                original_ready_at: '2026-06-21T12:00:02.000Z'
                            }
                        };
                    }
                }],
                tokenUsage: {},
                providerTaskId: 'provider-video-preview-first',
                metadata: {
                    media_type: 'video',
                    deferred_original_count: 1
                }
            };
        }
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].image_url, 'https://upstream.example.com/video.mp4');
    assert.equal(result.results[0].original_image_url, 'https://upstream.example.com/video.mp4');
    assert.equal(result.results[0].metadata.original_status, 'pending');
    assert.equal(result.task.charged_points, 28);
    assert.equal(state.results[0].image_url, 'https://upstream.example.com/video.mp4');

    await sleep(20);

    assert.equal(state.results[0].image_url, 'https://cdn.example.com/ai-videos/video.mp4');
    assert.equal(state.results[0].original_image_url, 'https://cdn.example.com/ai-videos/video.mp4');
    assert.equal(state.results[0].storage_path, 'ai-videos/cn/2026/06/user-1/task-video-preview-first-0-original.mp4');
    assert.equal(state.results[0].metadata.media_type, 'video');
    assert.equal(state.results[0].metadata.original_status, 'ready');
});

test('ai image runtime saves partial image results before task completion and avoids duplicate inserts', async () => {
    const state = {
        tasks: [{
            id: 'task-partial-early-save',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '2k',
            quantity: 2,
            prompt: '先存首图',
            estimated_points: 36,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    let releaseSecondUpload = null;
    const holdSecondUpload = new Promise((resolve) => {
        releaseSecondUpload = resolve;
    });

    const executionPromise = executeAiImageTask({
        supabase,
        task: 'task-partial-early-save',
        executor: async (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'url'
            },
            fetchImpl: async (url, options = {}) => {
                if (String(url).startsWith('https://cdn.example.com/')) {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'image/png'
                        },
                        arrayBuffer: async () => Buffer.from(`bytes:${url}`)
                    };
                }
                JSON.parse(options.body);
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'provider-partial-early-save',
                        data: [
                            { url: 'https://cdn.example.com/first.png' },
                            { url: 'https://cdn.example.com/second.png' }
                        ]
                    })
                };
            },
            uploadImageBuffer: async (_buffer, { index }) => {
                if (index === 1) {
                    await holdSecondUpload;
                }
                return {
                    image_url: `https://cdn.example.com/persisted/first-${index}.webp`,
                    original_image_url: `https://cdn.example.com/persisted/first-${index}.png`,
                    storage_path: `ai-images/persisted/first-${index}.webp`,
                    original_storage_path: `ai-images/persisted/first-${index}.png`
                };
            }
        })
    });

    await sleep(20);
    assert.equal(state.results.length, 1);
    assert.equal(state.results[0].result_index, 0);
    assert.equal(state.results[0].image_url, 'https://cdn.example.com/persisted/first-0.webp');

    releaseSecondUpload();
    const result = await executionPromise;

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.results.length, 2);
    assert.equal(state.results.length, 2);
    assert.deepEqual(state.results.map((row) => row.result_index), [0, 1]);
    assert.equal(new Set(state.results.map((row) => row.result_index)).size, 2);
});

test('ai image preview-first path stores thumbnail while task is still running', async () => withFakeR2Client(async (uploadedObjects) => {
    const state = {
        tasks: [{
            id: 'task-preview-first-running',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '2k',
            quantity: 1,
            prompt: '先落缩略图',
            estimated_points: 18,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    let releaseExecutor = null;
    let partialSaved = null;
    const holdExecutor = new Promise((resolve) => {
        releaseExecutor = resolve;
    });
    const waitForPartialSave = new Promise((resolve) => {
        partialSaved = resolve;
    });

    const executionPromise = executeAiImageTask({
        supabase,
        task: 'task-preview-first-running',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'b64_json',
                AI_IMAGE_PREVIEW_FIRST: 'true',
                AI_IMAGE_R2_ENDPOINT: 'https://r2.example.com',
                AI_IMAGE_R2_ACCESS_KEY_ID: 'access-key',
                AI_IMAGE_R2_SECRET_ACCESS_KEY: 'secret-key',
                AI_IMAGE_R2_BUCKET_NAME: 'bucket',
                AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.example.com'
            },
            fetchImpl: async (_url, options = {}) => {
                JSON.parse(options.body);
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        data: [{
                            b64_json: Buffer.from('preview-first-image-bytes').toString('base64')
                        }]
                    })
                };
            },
            uploadImageBuffer: uploadGeneratedImageBufferPreviewFirst,
            onImageResult: async (image, detail) => {
                const saved = await runtimeOptions.onImageResult(image, detail);
                partialSaved(saved);
                await holdExecutor;
                return saved;
            }
        })
    });

    const saved = await waitForPartialSave;

    assert.equal(saved?.task_id, 'task-preview-first-running');
    assert.equal(state.tasks[0].status, 'running');
    assert.equal(state.results.length, 1);
    assert.equal(state.results[0].image_url.startsWith('https://cdn.example.com/'), true);
    assert.equal(state.results[0].original_image_url, '');
    assert.equal(state.results[0].metadata.preview_status, 'ready');
    assert.equal(state.results[0].metadata.original_status, 'pending');
    assert.equal(uploadedObjects.length, 1);
    assert.match(uploadedObjects[0].Key, /-preview\./);

    releaseExecutor();
    const result = await executionPromise;
    await sleep(20);

    assert.equal(result.task.status, 'succeeded');
    assert.equal(state.results[0].metadata.original_status, 'ready');
    assert.equal(state.results[0].original_image_url.startsWith('https://cdn.example.com/'), true);
    assert.equal(uploadedObjects.length, 2);
    assert.match(uploadedObjects[1].Key, /-original\./);
}));

test('ai image runtime calls openai-compatible video generation endpoint and returns video media', async () => {
    const fetchCalls = [];
    const result = await executeOpenAiCompatibleVideoGeneration({
        id: 'task-video-openai-compatible',
        site: 'cn',
        user_id: 'user-1',
        mode: 'video',
        billing_mode: 'points',
        status: 'queued',
        model: 'veo-3.0-generate-preview',
        ratio: '9:16',
        resolution: '720p',
        quantity: 1,
        prompt: '一只橘猫在雨夜霓虹街道慢镜头行走',
        estimated_points: 60,
        charged_points: 0,
        metadata: {
            duration: 6,
            video_ratio: '9:16',
            video_resolution: '720p',
            generate_audio: true,
            watermark: false,
            camera_fixed: false
        },
        created_at: '2026-06-21T11:00:00.000Z'
    }, {
        env: {
            AI_IMAGE_API_KEY: 'sk-video-test',
            AI_IMAGE_API_BASE_URL: 'https://video.example.com/v1',
            AI_IMAGE_MODEL: 'veo-3.0-generate-preview'
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                method: options.method,
                body: JSON.parse(String(options.body || '{}'))
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'provider-video-1',
                    data: [{
                        id: 'video-result-1',
                        url: 'https://cdn.example.com/video-result.mp4',
                        mime_type: 'video/mp4',
                        revised_prompt: '雨夜霓虹街道慢镜头橘猫'
                    }]
                })
            };
        }
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://video.example.com/v1/videos/generations');
    assert.equal(fetchCalls[0].method, 'POST');
    assert.equal(fetchCalls[0].body.model, 'veo-3.0-generate-preview');
    assert.equal(fetchCalls[0].body.resolution, '720p');
    assert.equal(fetchCalls[0].body.ratio, '9:16');
    assert.equal(fetchCalls[0].body.aspect_ratio, '9:16');
    assert.equal(fetchCalls[0].body.duration, 6);
    assert.equal(fetchCalls[0].body.generate_audio, true);
    assert.equal(fetchCalls[0].body.watermark, false);
    assert.equal(fetchCalls[0].body.size, '720x1280');
    assert.equal(Object.prototype.hasOwnProperty.call(fetchCalls[0].body, 'quality'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(fetchCalls[0].body, 'camera_fixed'), false);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.metadata.media_type, 'video');
    assert.equal(result.metadata.executor, 'openai-compatible-videos');
    assert.equal(result.metadata.video_ratio, '9:16');
    assert.equal(result.metadata.video_resolution, '720p');
    assert.equal(result.metadata.video_submit_endpoint, '/videos/generations');
    assert.equal(result.metadata.video_submit_fallback_used, false);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].image_url, 'https://cdn.example.com/video-result.mp4');
    assert.equal(result.images[0].original_image_url, 'https://cdn.example.com/video-result.mp4');
    assert.equal(result.images[0].mime_type, 'video/mp4');
    assert.equal(result.images[0].metadata.media_type, 'video');
    assert.equal(result.images[0].ratio, '9:16');
    assert.equal(result.images[0].resolution, '720p');
    assert.equal(result.images[0].metadata.video_ratio, '9:16');
    assert.equal(result.images[0].metadata.video_resolution, '720p');
});

test('ai video runtime uses Sub2API /v1/videos task protocol by default', async () => withFakeR2Client(async (uploadedObjects) => {
    const fetchCalls = [];
    const result = await executeOpenAiCompatibleVideoGeneration({
        id: 'task-video-sub2api-default-videos-endpoint',
        site: 'cn',
        user_id: 'user-1',
        mode: 'video',
        billing_mode: 'points',
        status: 'queued',
        model: 'video-ds-2.0-fast',
        ratio: '16:9',
        resolution: '720p',
        quantity: 1,
        prompt: '飞龙在天，和麒麟对峙，压迫力十足，上水画卷',
        reference_image_url: 'https://cdn.example.com/reference-dragon.png',
        estimated_points: 0,
        charged_points: 0,
        metadata: {
            duration: 5,
            video_ratio: '16:9',
            video_resolution: '720p',
            pricing: {
                matched_rule: {
                    id: 'video-sub2api-rule',
                    metadata: {
                        billing_strategy: 'token_sub2api',
                        pricing: {
                            points_per_usd: 1
                        }
                    }
                }
            }
        },
        created_at: '2026-06-28T09:00:00.000Z'
    }, {
        env: {
            AI_IMAGE_API_KEY: 'sk-video-test',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_MODEL: 'video-ds-2.0-fast',
            AI_IMAGE_R2_ENDPOINT: 'https://r2.example.com',
            AI_IMAGE_R2_ACCESS_KEY_ID: 'r2-key',
            AI_IMAGE_R2_SECRET_ACCESS_KEY: 'r2-secret',
            AI_IMAGE_R2_BUCKET_NAME: 'zaoyoe-test',
            AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.example.com',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
            AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0'
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                method: options.method,
                headers: options.headers || {},
                body: options.body ? JSON.parse(String(options.body || '{}')) : null
            });
            if (String(url) === 'https://sub2api.fatherkey.com/v1/videos') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'sub2api-video-task-1',
                        status: 'pending'
                    })
                };
            }
            if (String(url) === 'https://sub2api.fatherkey.com/v1/videos/sub2api-video-task-1') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'sub2api-video-task-1',
                        status: 'succeeded'
                    })
                };
            }
            if (String(url) === 'https://sub2api.fatherkey.com/v1/videos/sub2api-video-task-1/content') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'video/mp4' : ''
                    },
                    arrayBuffer: async () => Buffer.from('sub2api-video-bytes').buffer
                };
            }
            if (String(url).startsWith('https://sub2api.fatherkey.com/v1/usage')) {
                return {
                    ok: false,
                    status: 404,
                    text: async () => JSON.stringify({ error: { message: 'not found' } })
                };
            }
            throw new Error(`Unexpected fetch ${url}`);
        }
    });

    const videoCalls = fetchCalls.filter((call) => !call.url.includes('/usage'));
    assert.equal(videoCalls.length, 3);
    assert.equal(videoCalls[0].url, 'https://sub2api.fatherkey.com/v1/videos');
    assert.equal(videoCalls[0].method, 'POST');
    assert.deepEqual(Object.keys(videoCalls[0].body).sort(), ['aspect_ratio', 'model', 'prompt', 'seconds']);
    assert.equal(videoCalls[0].body.model, 'video-ds-2.0-fast');
    assert.equal(videoCalls[0].body.prompt.includes('飞龙在天'), true);
    assert.equal(videoCalls[0].body.seconds, '5');
    assert.equal(videoCalls[0].body.aspect_ratio, '16:9');
    assert.equal(videoCalls[0].headers['X-Client-Request-ID'], 'fatherkey-aiw-task-video-sub2api-default-videos-endpoint');
    assert.equal(Object.prototype.hasOwnProperty.call(videoCalls[0].body, 'duration'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(videoCalls[0].body, 'size'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(videoCalls[0].body, 'width'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(videoCalls[0].body, 'height'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(videoCalls[0].body, 'images'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(videoCalls[0].body, 'model_name'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(videoCalls[0].body, 'req_key'), false);
    assert.equal(videoCalls[1].url, 'https://sub2api.fatherkey.com/v1/videos/sub2api-video-task-1');
    assert.equal(videoCalls[1].method, 'GET');
    assert.equal(videoCalls[2].url, 'https://sub2api.fatherkey.com/v1/videos/sub2api-video-task-1/content');
    assert.equal(videoCalls[2].headers.Authorization, 'Bearer sk-video-test');
    assert.equal(fetchCalls.some((call) => call.url === `https://sub2api.fatherkey.com/v1/usage/requests/${encodeURIComponent('client:fatherkey-aiw-task-video-sub2api-default-videos-endpoint')}`), true);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.images[0].image_url.startsWith('https://cdn.example.com/ai-videos/'), true);
    assert.equal(result.images[0].original_image_url, result.images[0].image_url);
    assert.equal(result.images[0].metadata.provider_auth_required, true);
    assert.equal(result.metadata.video_submit_endpoint, '/videos');
    assert.equal(result.metadata.video_submit_fallback_used, false);
    assert.equal(result.metadata.sub2api_client_request_id, 'fatherkey-aiw-task-video-sub2api-default-videos-endpoint');
    assert.equal(result.metadata.provider_attempt_count, 2);
    assert.equal(result.metadata.video_submit_attempts.length, 1);
    assert.equal(result.metadata.video_submit_attempts[0].route_not_found, false);
    assert.equal(result.metadata.async_poll_attempts, 1);
    assert.equal(result.metadata.async_poll_path, '/videos/sub2api-video-task-1');
    assert.equal(result.deferredOriginalUploads.length, 0);
    assert.equal(uploadedObjects.length, 1);
    assert.match(uploadedObjects[0].Key, /^ai-videos\/cn\/\d{4}\/\d{2}\/user-1\/task-video-sub2api-default-videos-endpoint-0-[a-f0-9]{16}-original\.mp4$/);
    assert.equal(uploadedObjects[0].ContentType, 'video/mp4');
}));

test('ai video runtime downloads Sub2API content when status payload has no video URL', async () => withFakeR2Client(async (uploadedObjects) => {
    const fetchCalls = [];
    const result = await executeOpenAiCompatibleVideoGeneration({
        id: 'task-video-sub2api-content-fallback',
        site: 'cn',
        user_id: 'user-1',
        mode: 'video',
        billing_mode: 'points',
        status: 'queued',
        model: 'video-ds-2.0-fast',
        ratio: '16:9',
        resolution: '720p',
        quantity: 1,
        prompt: '飞龙在天，和麒麟对峙，压迫力十足，上水画卷',
        estimated_points: 0,
        charged_points: 0,
        metadata: {
            duration: 15,
            video_ratio: '16:9',
            video_resolution: '720p'
        },
        created_at: '2026-06-29T18:43:17.000Z'
    }, {
        env: {
            AI_IMAGE_API_KEY: 'sk-video-test',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_MODEL: 'video-ds-2.0-fast',
            AI_IMAGE_R2_ENDPOINT: 'https://r2.example.com',
            AI_IMAGE_R2_ACCESS_KEY_ID: 'r2-key',
            AI_IMAGE_R2_SECRET_ACCESS_KEY: 'r2-secret',
            AI_IMAGE_R2_BUCKET_NAME: 'zaoyoe-test',
            AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.example.com'
        },
        runtimeConfig: {
            apiKey: 'sk-video-test',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'video-ds-2.0-fast',
            source: 'test',
            asyncResult: {
                intervalMs: 1,
                maxAttempts: 2
            }
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                method: options.method,
                headers: options.headers || {},
                body: options.body ? JSON.parse(String(options.body || '{}')) : null
            });
            if (String(url) === 'https://sub2api.fatherkey.com/v1/videos') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'task_content_only_1',
                        status: 'pending'
                    })
                };
            }
            if (String(url) === 'https://sub2api.fatherkey.com/v1/videos/task_content_only_1') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'task_content_only_1',
                        status: 'pending'
                    })
                };
            }
            if (String(url) === 'https://sub2api.fatherkey.com/v1/videos/task_content_only_1/content') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'video/mp4' : ''
                    },
                    arrayBuffer: async () => Buffer.from('content-only-video-bytes').buffer
                };
            }
            throw new Error(`Unexpected fetch ${url}`);
        }
    });

    assert.equal(fetchCalls[0].url, 'https://sub2api.fatherkey.com/v1/videos');
    assert.equal(fetchCalls[0].body.seconds, '15');
    assert.equal(fetchCalls[0].body.aspect_ratio, '16:9');
    assert.equal(Object.prototype.hasOwnProperty.call(fetchCalls[0].body, 'duration'), false);
    assert.equal(fetchCalls[1].url, 'https://sub2api.fatherkey.com/v1/videos/task_content_only_1');
    assert.equal(fetchCalls[2].url, 'https://sub2api.fatherkey.com/v1/videos/task_content_only_1');
    assert.equal(fetchCalls[3].url, 'https://sub2api.fatherkey.com/v1/videos/task_content_only_1/content');
    assert.equal(fetchCalls[3].headers.Authorization, 'Bearer sk-video-test');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].image_url.startsWith('https://cdn.example.com/ai-videos/'), true);
    assert.equal(result.images[0].metadata.provider_video_content_endpoint, '/videos/task_content_only_1/content');
    assert.equal(result.metadata.provider_task_id, 'task_content_only_1');
    assert.equal(result.metadata.async_poll_attempts, 2);
    assert.equal(result.metadata.async_poll_path, '');
    assert.equal(uploadedObjects.length, 1);
    assert.equal(uploadedObjects[0].ContentType, 'video/mp4');
}));

test('ai video runtime does not fallback to image endpoint after business 404 envelope', async () => {
    const fetchCalls = [];
    await assert.rejects(() => executeOpenAiCompatibleVideoGeneration({
        id: 'task-video-sub2api-business-404-fallback',
        site: 'cn',
        user_id: 'user-1',
        mode: 'video',
        billing_mode: 'points',
        status: 'queued',
        model: 'video-ds-2.0-fast',
        ratio: '16:9',
        resolution: '720p',
        quantity: 1,
        prompt: '飞龙在天，和麒麟对峙，压迫力十足，上水画卷',
        estimated_points: 0,
        charged_points: 0,
        metadata: {
            duration: 5,
            video_ratio: '16:9',
            video_resolution: '720p'
        },
        created_at: '2026-06-28T09:00:00.000Z'
    }, {
        env: {
            AI_IMAGE_API_KEY: 'sk-video-test',
            AI_IMAGE_API_BASE_URL: 'https://sub2api.fatherkey.com/v1',
            AI_IMAGE_MODEL: 'video-ds-2.0-fast',
            AI_IMAGE_VIDEO_ENDPOINT: '/videos/generations'
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                method: options.method,
                body: JSON.parse(String(options.body || '{}'))
            });
            if (String(url) === 'https://sub2api.fatherkey.com/v1/videos/generations') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        code: 404,
                        msg: '',
                        data: null
                    })
                };
            }
            throw new Error(`Unexpected fetch ${url}`);
        }
    }), (error) => {
        assert.equal(error.code, '404');
        assert.equal(error.statusCode, 502);
        assert.equal(error.metadata.video_submit_endpoint, '/videos/generations');
        assert.equal(error.metadata.video_submit_fallback_used, false);
        assert.equal(error.metadata.video_submit_attempts.length, 1);
        assert.equal(error.metadata.video_submit_attempts[0].route_not_found, true);
        return true;
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://sub2api.fatherkey.com/v1/videos/generations');
});

test('ai video runtime honors configured video submit endpoint', async () => {
    const fetchCalls = [];
    const result = await executeOpenAiCompatibleVideoGeneration({
        id: 'task-video-configured-endpoint',
        site: 'cn',
        user_id: 'user-1',
        mode: 'video',
        billing_mode: 'points',
        status: 'queued',
        model: 'custom-video-model',
        ratio: '16:9',
        resolution: '720p',
        quantity: 1,
        prompt: '城市夜景延时摄影',
        estimated_points: 0,
        charged_points: 0,
        metadata: {},
        created_at: '2026-06-28T09:10:00.000Z'
    }, {
        runtimeConfig: {
            apiKey: 'sk-user-video-key',
            baseUrl: 'https://gateway.example.com/v1',
            model: 'custom-video-model',
            videoEndpoint: '/images/generations',
            source: 'user-api'
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                method: options.method,
                body: JSON.parse(String(options.body || '{}'))
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [{
                        url: 'https://cdn.example.com/custom-video.mp4',
                        mime_type: 'video/mp4'
                    }]
                })
            };
        }
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://gateway.example.com/v1/images/generations');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.metadata.video_submit_endpoint, '/images/generations');
    assert.equal(result.metadata.video_submit_fallback_used, false);
});

test('ai video runtime exposes upstream URL immediately and defers R2 video copy', async () => withFakeR2Client(async (uploadedObjects) => {
    const fetchCalls = [];
    const result = await executeOpenAiCompatibleVideoGeneration({
        id: 'task-video-deferred-copy',
        site: 'cn',
        user_id: 'user-1',
        mode: 'video',
        billing_mode: 'points',
        status: 'queued',
        model: 'seedance-2-0-pro',
        ratio: '16:9',
        resolution: '720p',
        quantity: 1,
        prompt: '海边日落的慢镜头航拍',
        metadata: {
            duration: 5,
            video_ratio: '16:9',
            video_resolution: '720p'
        },
        created_at: '2026-06-21T11:00:00.000Z'
    }, {
        env: {
            AI_IMAGE_API_KEY: 'sk-video-test',
            AI_IMAGE_API_BASE_URL: 'https://video.example.com/v1',
            AI_IMAGE_MODEL: 'seedance-2-0-pro',
            AI_IMAGE_R2_ENDPOINT: 'https://r2.example.com',
            AI_IMAGE_R2_ACCESS_KEY_ID: 'r2-key',
            AI_IMAGE_R2_SECRET_ACCESS_KEY: 'r2-secret',
            AI_IMAGE_R2_BUCKET_NAME: 'zaoyoe-test',
            AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.example.com'
        },
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url: String(url),
                method: options.method,
                body: options.body ? JSON.parse(String(options.body || '{}')) : null
            });
            if (String(url) === 'https://video.example.com/v1/videos/generations') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'provider-video-deferred',
                        data: [{
                            id: 'video-result-deferred',
                            video_url: 'https://upstream.example.com/video-result.mp4',
                            mime_type: 'video/mp4'
                        }]
                    })
                };
            }
            if (String(url) === 'https://upstream.example.com/video-result.mp4') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'video/mp4' : ''
                    },
                    arrayBuffer: async () => Buffer.from('video-bytes').buffer
                };
            }
            throw new Error(`Unexpected fetch ${url}`);
        }
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].method, 'POST');
    assert.equal(result.images[0].image_url, 'https://upstream.example.com/video-result.mp4');
    assert.equal(result.images[0].original_image_url, 'https://upstream.example.com/video-result.mp4');
    assert.equal(result.images[0].metadata.preview_status, 'upstream_url');
    assert.equal(result.images[0].metadata.original_status, 'pending');
    assert.equal(result.deferredOriginalUploads.length, 1);
    assert.equal(uploadedObjects.length, 0);

    const payload = await result.deferredOriginalUploads[0].run({
        result: { id: 'result-video-deferred' }
    });

    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[1].url, 'https://upstream.example.com/video-result.mp4');
    assert.equal(uploadedObjects.length, 1);
    assert.match(uploadedObjects[0].Key, /^ai-videos\/cn\/\d{4}\/\d{2}\/user-1\/task-video-deferred-copy-0-[a-f0-9]{16}-original\.mp4$/);
    assert.equal(uploadedObjects[0].ContentType, 'video/mp4');
    assert.equal(Buffer.from(uploadedObjects[0].Body).toString('utf8').includes('video-bytes'), true);
    assert.equal(payload.image_url.startsWith('https://cdn.example.com/ai-videos/'), true);
    assert.equal(payload.original_image_url, payload.image_url);
    assert.equal(payload.metadata.original_status, 'ready');
    assert.equal(payload.metadata.media_type, 'video');
}));

test('openai compatible video executor maps only official video ratios and resolutions', () => {
    assert.deepEqual(resolveOpenAiVideoSize({ ratio: '21:9', resolution: '4k' }), {
        width: 3840,
        height: 1648,
        size: '3840x1648',
        resolution: '4k',
        ratio: '21:9',
        aspectRatio: '21:9'
    });
    assert.deepEqual(resolveOpenAiVideoSize({ ratio: '9:21', resolution: '1k' }), {
        width: 1280,
        height: 720,
        size: '1280x720',
        resolution: '720p',
        ratio: 'adaptive',
        aspectRatio: '16:9'
    });
});

test('ai image runtime prorates points when provider delivers fewer images than requested', async () => {
    const state = {
        tasks: [{
            id: 'task-partial-delivery',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '9:16',
            resolution: '2k',
            quantity: 2,
            prompt: '两张国风舞蹈海报',
            estimated_points: 36,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-partial-delivery',
        executor(task) {
            return {
                status: 'succeeded',
                resultPrompt: task.prompt,
                images: [{
                    image_url: 'https://cdn.example.com/one.webp',
                    original_image_url: 'https://cdn.example.com/one.png',
                    result_index: 0,
                    mime_type: 'image/webp',
                    ratio: task.ratio,
                    resolution: task.resolution,
                    prompt: task.prompt,
                    revised_prompt: task.prompt
                }],
                tokenUsage: {},
                providerTaskId: 'partial-provider',
                metadata: {
                    requested_image_count: 2,
                    delivered_image_count: 1
                }
            };
        }
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.results.length, 1);
    assert.equal(result.task.charged_points, 18);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].args.p_amount, 18);
    assert.deepEqual(result.task.metadata.delivery, {
        requested_image_count: 2,
        delivered_image_count: 1,
        partial: true,
        charge_quantity: 1
    });
});

test('ai image runtime keeps R2 public URLs as asset origins without appending API version paths', () => {
    assert.equal(
        resolveR2Config({
            AI_IMAGE_R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
            AI_IMAGE_R2_ACCESS_KEY_ID: 'access-key',
            AI_IMAGE_R2_SECRET_ACCESS_KEY: 'secret-key',
            AI_IMAGE_R2_BUCKET_NAME: 'zaoyoeimages',
            AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.fatherkey.com/'
        }).publicUrl,
        'https://cdn.fatherkey.com'
    );

    assert.equal(
        resolveR2Config({
            AI_IMAGE_R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
            AI_IMAGE_R2_ACCESS_KEY_ID: 'access-key',
            AI_IMAGE_R2_SECRET_ACCESS_KEY: 'secret-key',
            AI_IMAGE_R2_BUCKET_NAME: 'zaoyoeimages',
            AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.fatherkey.com/assets/'
        }).publicUrl,
        'https://cdn.fatherkey.com/assets'
    );
});

test('ai image runtime does not double charge when points ledger already has task reference', async () => {
    const state = {
        tasks: [{
            id: 'task-points-dedup',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '头像',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }],
        pointsLedger: [{
            id: 'ledger-existing',
            user_id: 'user-1',
            amount: -8,
            reference_id: 'task-points-dedup',
            site: 'cn',
            created_at: '2026-06-21T11:00:01.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({ supabase, task: 'task-points-dedup' });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.task.charged_points, 8);
    assert.equal(state.rpcCalls.length, 0);
});

test('ai image runtime does not execute a task that another worker already claimed', async () => {
    const state = {
        tasks: [{
            id: 'task-claim-conflict',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '头像',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    state.tasks[0].status = 'running';
    let executorCalled = false;

    await assert.rejects(
        executeAiImageTask({
            supabase,
            task: {
                ...state.tasks[0],
                status: 'queued'
            },
            executor() {
                executorCalled = true;
                return buildPlaceholderExecutionResult(state.tasks[0]);
            }
        }),
        /already claimed/
    );

    assert.equal(executorCalled, false);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.results.length, 0);
});

test('ai image runtime does not complete or charge a task cancelled before final write', async () => {
    const state = {
        tasks: [{
            id: 'task-cancel-before-complete',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '取消中的图片',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-cancel-before-complete',
        executor() {
            state.tasks[0].status = 'cancelled';
            return {
                status: 'succeeded',
                resultPrompt: '不应写入',
                images: [{
                    image_url: 'https://cdn.example.com/should-not-exist.png',
                    original_image_url: 'https://cdn.example.com/should-not-exist.png'
                }],
                tokenUsage: {},
                providerTaskId: 'provider-after-cancel'
            };
        }
    });

    assert.equal(result.cancelled, true);
    assert.equal(result.task.status, 'cancelled');
    assert.equal(result.chargedPoints, 0);
    assert.equal(state.results.length, 0);
    assert.equal(state.rpcCalls.length, 0);
});

test('ai image runtime does not complete or charge a task already failed before final write', async () => {
    const state = {
        tasks: [{
            id: 'task-failed-before-complete',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '超时后的迟到结果',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z',
            updated_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-failed-before-complete',
        executor() {
            state.tasks[0].status = 'failed';
            state.tasks[0].error_code = 'ai_image_worker_stale_running';
            return {
                status: 'succeeded',
                resultPrompt: '不应写入',
                images: [{
                    image_url: 'https://cdn.example.com/late.png',
                    original_image_url: 'https://cdn.example.com/late.png'
                }],
                tokenUsage: {},
                providerTaskId: 'provider-late'
            };
        }
    });

    assert.equal(result.skipped, true);
    assert.equal(result.task.status, 'failed');
    assert.equal(result.chargedPoints, 0);
    assert.equal(state.results.length, 0);
    assert.equal(state.rpcCalls.length, 0);
});

test('ai image runtime fails stale running tasks without charging points', async () => {
    const staleUpdatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const freshUpdatedAt = new Date().toISOString();
    const state = {
        tasks: [
            {
                id: 'task-stale-running',
                site: 'cn',
                user_id: 'user-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'running',
                model: 'gpt-image-1',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: '卡死任务',
                estimated_points: 8,
                charged_points: 0,
                metadata: {},
                created_at: staleUpdatedAt,
                updated_at: staleUpdatedAt
            },
            {
                id: 'task-fresh-running',
                site: 'cn',
                user_id: 'user-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'running',
                model: 'gpt-image-1',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: '仍在运行',
                estimated_points: 8,
                charged_points: 0,
                metadata: {},
                created_at: freshUpdatedAt,
                updated_at: freshUpdatedAt
            }
        ]
    };
    const supabase = createSupabaseStub(state);

    const results = await failStaleRunningTasks(supabase, {
        site: 'cn',
        limit: 5,
        staleAfterMs: 12 * 60 * 1000
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].task.id, 'task-stale-running');
    assert.equal(results[0].task.status, 'failed');
    assert.equal(results[0].task.error_code, 'ai_image_worker_stale_running');
    assert.equal(state.tasks.find((task) => task.id === 'task-fresh-running').status, 'running');
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.results.length, 0);
});

test('ai image runtime recovers stale running tasks that already have stored results', async () => {
    const staleUpdatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const state = {
        tasks: [{
            id: 'task-stale-with-result',
            site: 'cn',
            user_id: 'user-1',
            mode: 'image',
            billing_mode: 'points',
            status: 'running',
            model: 'gpt-image-2',
            ratio: '9:16',
            resolution: '2k',
            quantity: 1,
            prompt: '红色衣服续作',
            estimated_points: 22.5,
            charged_points: 0,
            metadata: {},
            created_at: staleUpdatedAt,
            updated_at: staleUpdatedAt
        }],
        results: [{
            id: 'result-stale-1',
            task_id: 'task-stale-with-result',
            site: 'cn',
            user_id: 'user-1',
            result_index: 0,
            image_url: 'https://cdn.example.com/preview.webp',
            original_image_url: 'https://cdn.example.com/original.png',
            width: 1152,
            height: 2048,
            ratio: '9:16',
            resolution: '2k',
            prompt: '红色衣服续作',
            revised_prompt: '红色衣服续作',
            metadata: {},
            created_at: '2026-06-22T03:01:30.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const results = await failStaleRunningTasks(supabase, {
        site: 'cn',
        limit: 5,
        staleAfterMs: 12 * 60 * 1000
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].task.id, 'task-stale-with-result');
    assert.equal(results[0].task.status, 'succeeded');
    assert.equal(results[0].task.charged_points, 22.5);
    assert.equal(results[0].recovered, true);
    assert.equal(results[0].results.length, 1);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].args.p_amount, 22.5);
    assert.equal(state.pointsLedger[0].reference_id, 'task-stale-with-result');
    assert.equal(state.tasks[0].metadata.recovery.recovered_from_results, true);
    assert.equal(state.tasks[0].metadata.recovery.previous_status, 'running');
});

test('ai image runtime can recover failed AI image tasks when result rows exist', async () => {
    const state = {
        tasks: [{
            id: 'task-failed-with-result',
            site: 'cn',
            user_id: 'user-1',
            mode: 'image',
            billing_mode: 'points',
            status: 'failed',
            model: 'gpt-image-2',
            ratio: '9:16',
            resolution: '2k',
            quantity: 1,
            prompt: '已生成但状态失败',
            estimated_points: 22.5,
            charged_points: 0,
            error_code: 'ai_image_worker_stale_running',
            error_message: 'stale',
            metadata: {},
            created_at: '2026-06-22T02:53:09.000Z',
            updated_at: '2026-06-22T03:08:29.000Z'
        }],
        results: [{
            id: 'result-failed-1',
            task_id: 'task-failed-with-result',
            site: 'cn',
            user_id: 'user-1',
            result_index: 0,
            image_url: 'https://cdn.example.com/preview.webp',
            original_image_url: 'https://cdn.example.com/original.png',
            width: 1152,
            height: 2048,
            ratio: '9:16',
            resolution: '2k',
            prompt: '已生成但状态失败',
            revised_prompt: '已生成但状态失败',
            metadata: {},
            created_at: '2026-06-22T03:01:30.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await recoverTaskFromExistingResults(supabase, state.tasks[0], {
        results: state.results,
        errorCode: 'ai_image_worker_stale_running'
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.task.charged_points, 22.5);
    assert.equal(result.results.length, 1);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].args.p_amount, 22.5);
    assert.equal(state.tasks[0].metadata.recovery.previous_status, 'failed');
    assert.equal(state.tasks[0].error_code, '');
    assert.equal(state.tasks[0].error_message, '');
});

test('ai image runtime records API usage and does not deduct site points in api mode', async () => {
    const state = {
        tasks: [{
            id: 'task-api-1',
            site: 'cn',
            user_id: 'user-2',
            mode: 'chat',
            billing_mode: 'api',
            status: 'queued',
            model: 'gpt-5.1',
            api_model_group: 'chat',
            api_base_url: 'https://sub2api.fatherkey.com/v1',
            api_key_tail: '12345678',
            prompt: '写一句标题',
            estimated_points: 0,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-api-1',
        executor(task) {
            return {
                status: 'succeeded',
                resultPrompt: '标题已生成',
                images: [],
                tokenUsage: {
                    input_tokens: 12,
                    output_tokens: 5,
                    total_tokens: 17
                },
                providerTaskId: `api-${task.id}`,
                metadata: { executor: 'test' }
            };
        }
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.task.charged_points, 0);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.apiUsage.length, 1);
    assert.equal(state.apiUsage[0].total_tokens, 17);
    assert.equal(state.apiUsage[0].api_key_tail, '12345678');
});

test('ai image runtime batch claims queued tasks by site', async () => {
    const state = {
        tasks: [
            {
                id: 'task-cn-1',
                site: 'cn',
                user_id: 'user-1',
                mode: 'reverse',
                billing_mode: 'points',
                status: 'queued',
                model: 'gpt-image-1',
                prompt: '反推提示词',
                reference_image_url: 'https://cdn.example.com/a.png',
                estimated_points: 3,
                charged_points: 0,
                metadata: {},
                created_at: '2026-06-21T11:00:00.000Z'
            },
            {
                id: 'task-intl-1',
                site: 'intl',
                user_id: 'user-1',
                mode: 'reverse',
                billing_mode: 'points',
                status: 'queued',
                model: 'gpt-image-1',
                prompt: 'reverse prompt',
                reference_image_url: 'https://cdn.example.com/b.png',
                estimated_points: 3,
                charged_points: 0,
                metadata: {},
                created_at: '2026-06-21T11:00:00.000Z'
            }
        ]
    };
    const supabase = createSupabaseStub(state);

    const result = await runAiImageTaskBatch({
        supabase,
        site: 'cn',
        limit: 5
    });

    assert.equal(result.processed, 1);
    assert.equal(state.tasks.find((task) => task.id === 'task-cn-1').status, 'succeeded');
    assert.equal(state.tasks.find((task) => task.id === 'task-intl-1').status, 'queued');
});

test('ai image runtime batch prioritizes lighter queued tasks before older expensive tasks', async () => {
    const state = {
        tasks: [
            {
                id: 'task-expensive-old',
                site: 'cn',
                user_id: 'user-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'queued',
                model: 'gpt-image-2',
                ratio: '1:1',
                resolution: '4k',
                quantity: 2,
                prompt: '高成本旧任务',
                estimated_points: 64,
                charged_points: 0,
                metadata: {},
                created_at: '2026-06-21T10:00:00.000Z'
            },
            {
                id: 'task-light-new',
                site: 'cn',
                user_id: 'user-1',
                mode: 'text',
                billing_mode: 'points',
                status: 'queued',
                model: 'gpt-image-2',
                ratio: '1:1',
                resolution: '1k',
                quantity: 1,
                prompt: '低成本新任务',
                estimated_points: 8,
                charged_points: 0,
                metadata: {},
                created_at: '2026-06-21T11:00:00.000Z'
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const started = [];

    const result = await runAiImageTaskBatch({
        supabase,
        site: 'cn',
        limit: 1,
        executor(task) {
            started.push(task.id);
            return buildPlaceholderExecutionResult(task);
        }
    });

    assert.equal(result.processed, 1);
    assert.deepEqual(started, ['task-light-new']);
    assert.equal(state.tasks.find((task) => task.id === 'task-light-new').status, 'succeeded');
    assert.equal(state.tasks.find((task) => task.id === 'task-expensive-old').status, 'queued');
});

test('ai image runtime batch processes queued tasks with bounded concurrency', async () => {
    const state = {
        tasks: [1, 2, 3].map((index) => ({
            id: `task-concurrent-${index}`,
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: `并发测试 ${index}`,
            estimated_points: 0,
            charged_points: 0,
            metadata: {},
            created_at: `2026-06-21T11:00:0${index}.000Z`
        }))
    };
    const supabase = createSupabaseStub(state);
    const started = [];
    let resolveFirstWave;
    let releaseExecutors;
    const firstWaveStarted = new Promise((resolve) => {
        resolveFirstWave = resolve;
    });
    const executorHold = new Promise((resolve) => {
        releaseExecutors = resolve;
    });

    const batchPromise = runAiImageTaskBatch({
        supabase,
        limit: 3,
        concurrency: 2,
        async executor(task) {
            started.push(task.id);
            if (started.length === 2) {
                resolveFirstWave();
            }
            await executorHold;
            return {
                images: [{
                    image_url: `https://cdn.example.com/${task.id}.png`,
                    original_image_url: `https://cdn.example.com/${task.id}-original.png`,
                    width: 1024,
                    height: 1024,
                    ratio: task.ratio,
                    resolution: task.resolution,
                    prompt: task.prompt
                }],
                metadata: {}
            };
        }
    });

    await Promise.race([
        firstWaveStarted,
        sleep(120).then(() => {
            throw new Error('expected two queued tasks to start concurrently');
        })
    ]);
    await sleep(10);
    assert.equal(started.length, 2);

    releaseExecutors();
    const result = await batchPromise;

    assert.equal(result.processed, 3);
    assert.equal(started.length, 3);
    assert.equal(state.tasks.filter((task) => task.status === 'succeeded').length, 3);
    assert.equal(state.results.length, 3);
});

test('ai image runtime batch records task-level exceptions without aborting worker batch', async () => {
    const state = {
        tasks: [{
            id: 'task-batch-error',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-1',
            prompt: '测试异常',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await runAiImageTaskBatch({
        supabase,
        limit: 1,
        executor() {
            throw Object.assign(new TypeError('fetch failed'), {
                code: 'ai_image_provider_network_failed'
            });
        }
    });

    assert.equal(result.processed, 1);
    assert.equal(result.results[0].task.status, 'failed');
    assert.equal(result.results[0].error.code, 'ai_image_provider_network_failed');
    assert.equal(state.tasks[0].charged_points, 0);
    assert.equal(state.results.length, 0);
});

test('ai image runtime fails stuck tasks at task timeout and aborts executor signal', async () => {
    const state = {
        tasks: [{
            id: 'task-timeout-hard-stop',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '模拟上游连接卡住',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    let aborted = false;

    const result = await runAiImageTaskBatch({
        supabase,
        limit: 1,
        taskTimeoutMs: 60,
        executor(_task, runtimeOptions = {}) {
            runtimeOptions.signal?.addEventListener('abort', () => {
                aborted = true;
            });
            return new Promise(() => {});
        }
    });

    assert.equal(result.processed, 1);
    assert.equal(result.results[0].task.status, 'failed');
    assert.equal(result.results[0].error.code, 'ai_image_task_timeout');
    assert.equal(state.tasks[0].status, 'failed');
    assert.equal(state.tasks[0].error_code, 'ai_image_task_timeout');
    assert.equal(state.tasks[0].charged_points, 0);
    assert.equal(state.tasks[0].metadata.timeout_stage, 'task');
    assert.equal(state.tasks[0].metadata.timing.task_timeout_ms, 60);
    assert.equal(aborted, true);
});

test('ai image runtime uses video task timeout and avoids unpaid copy after provider accepts', async () => {
    const state = {
        tasks: [{
            id: 'task-video-timeout-provider-accepted',
            site: 'cn',
            user_id: 'user-1',
            mode: 'video',
            billing_mode: 'points',
            status: 'queued',
            model: 'video-ds-2.0',
            ratio: 'adaptive',
            resolution: '720p',
            quantity: 1,
            prompt: '视频任务已经进入上游生成阶段',
            estimated_points: 5,
            charged_points: 0,
            provider_task_id: 'provider-video-task-accepted',
            metadata: {
                output: 'video',
                provider_task_id: 'provider-video-task-accepted'
            },
            created_at: '2026-07-06T04:56:45.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    let aborted = false;

    const result = await runAiImageTaskBatch({
        supabase,
        limit: 1,
        taskTimeoutMs: 60,
        videoTaskTimeoutMs: 90,
        executor(_task, runtimeOptions = {}) {
            runtimeOptions.signal?.addEventListener('abort', () => {
                aborted = true;
            });
            return new Promise(() => {});
        }
    });

    assert.equal(result.processed, 1);
    assert.equal(result.results[0].task.status, 'failed');
    assert.equal(result.results[0].error.code, 'ai_video_task_timeout_after_provider_accept');
    assert.equal(state.tasks[0].error_code, 'ai_video_task_timeout_after_provider_accept');
    assert.match(state.tasks[0].error_message, /可能已产生扣费/);
    assert.doesNotMatch(state.tasks[0].error_message, /未扣费/);
    assert.equal(state.tasks[0].metadata.timeout_stage, 'task');
    assert.equal(state.tasks[0].metadata.media_type, 'video');
    assert.equal(state.tasks[0].metadata.provider_task_id, 'provider-video-task-accepted');
    assert.equal(state.tasks[0].metadata.charge_may_have_occurred, true);
    assert.equal(state.tasks[0].metadata.timing.task_timeout_ms, 90);
    assert.equal(aborted, true);
});

test('openai compatible image executor maps product ratios and resolutions to legal image sizes', () => {
    assert.deepEqual(resolveOpenAiImageSize({ ratio: '16:9', resolution: '1k' }), {
        width: 1024,
        height: 640,
        size: '1024x640'
    });
    assert.deepEqual(resolveOpenAiImageSize({ ratio: '9:16', resolution: '1k' }), {
        width: 640,
        height: 1024,
        size: '640x1024'
    });
    assert.deepEqual(resolveOpenAiImageSize({ ratio: '16:9', resolution: '4k' }), {
        width: 3840,
        height: 2160,
        size: '3840x2160'
    });
    assert.deepEqual(resolveOpenAiImageSize({ ratio: '9:16', resolution: '4k' }), {
        width: 2160,
        height: 3840,
        size: '2160x3840'
    });
    assert.deepEqual(resolveOpenAiImageSize({ ratio: '1:1', resolution: '4k' }), {
        width: 2880,
        height: 2880,
        size: '2880x2880'
    });
});

test('openai compatible image executor calls images API and normalizes URL results', async () => {
    const requests = [];
    const uploaded = [];
    const task = {
        id: 'task-real-url',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image',
        ratio: '16:9',
        resolution: '2k',
        quantity: 1,
        prompt: '未来感商业海报',
        negative_prompt: '低清晰度',
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_RESPONSE_FORMAT: 'url'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                method: options.method || 'GET',
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url) === 'https://cdn.example.com/generated.png') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'image/png' : ''
                    },
                    arrayBuffer: async () => Buffer.from('provider-url-image-bytes')
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'provider-task-1',
                    usage: {
                        input_tokens: 10,
                        output_tokens: 0,
                        total_tokens: 10
                    },
                    data: [{
                        url: 'https://cdn.example.com/generated.png',
                        revised_prompt: '未来感商业海报，精修商业质感'
                    }]
                })
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => {
            uploaded.push({
                bytes: buffer.toString('utf8'),
                taskId: context.task.id,
                index: context.index,
                mimeType: context.mimeType
            });
            return {
                image_url: 'https://cdn.example.com/persisted/generated.png',
                original_image_url: 'https://cdn.example.com/persisted/generated.png',
                storage_path: 'ai-images/persisted/generated.png',
                original_storage_path: 'ai-images/persisted/generated.png'
            };
        }
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://api.example.com/v1/images/generations');
    assert.equal(requests[1].url, 'https://cdn.example.com/generated.png');
    assert.equal(requests[0].body.model, 'gpt-image-2');
    assert.equal(requests[0].body.size, '2048x1152');
    assert.match(requests[0].body.prompt, /未来感商业海报/);
    assert.match(requests[0].body.prompt, /Avoid: 低清晰度/);
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].bytes, 'provider-url-image-bytes');
    assert.equal(uploaded[0].mimeType, 'image/png');
    assert.equal(execution.images.length, 1);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/generated.png');
    assert.equal(execution.images[0].storage_path, 'ai-images/persisted/generated.png');
    assert.equal(execution.images[0].width, 2048);
    assert.equal(execution.images[0].height, 1152);
    assert.equal(execution.tokenUsage.total_tokens, 10);
    assert.equal(execution.metadata.provider_model, 'gpt-image-2');
});

test('gemini native image request body carries official aspect ratio and image size config', () => {
    const body = buildGeminiNativeImageRequestBody({
        prompt: '竖版商业海报',
        ratio: '9:16',
        resolution: '1k'
    });

    assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
    assert.equal(body.generationConfig.responseFormat.image.aspectRatio, '9:16');
    assert.equal(body.generationConfig.responseFormat.image.imageSize, '1K');
    assert.match(body.contents[0].parts[0].text, /aspect ratio 9:16/);
    assert.match(body.contents[0].parts[0].text, /vertical portrait canvas/);
});

test('gemini native image request body includes reference images as inline data', () => {
    const body = buildGeminiNativeImageRequestBody({
        prompt: '把孩子抠出来',
        ratio: '9:16',
        resolution: '1k',
        reference_image_url: 'https://cdn.example.com/source.png'
    }, {
        referenceImages: [{
            buffer: Buffer.from('reference-image-bytes'),
            mimeType: 'image/png'
        }]
    });

    assert.equal(body.contents[0].parts.length, 2);
    assert.match(body.contents[0].parts[0].text, /Reference image URL/);
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/png');
    assert.equal(body.contents[0].parts[1].inlineData.data, Buffer.from('reference-image-bytes').toString('base64'));
});

test('gemini native image executor streams and saves as soon as inline image arrives', async () => {
    const requests = [];
    const uploaded = [];
    const partial = [];
    const task = {
        id: 'task-gemini-image',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gemini-3.1-flash-image',
        ratio: '1:1',
        resolution: '1k',
        quantity: 4,
        prompt: '一只拿着钥匙的橙色小猫',
        metadata: {}
    };

    const execution = await executeGeminiNativeImageGeneration(task, {
        env: {
            AI_IMAGE_GEMINI_URL_BRIDGE: 'false'
        },
        runtimeConfig: {
            apiKey: 'sk-sub2api',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'gemini-3.1-flash-image',
            protocol: 'gemini-native',
            source: 'ai-image-provider-stored'
        },
        fetchImpl: async (url, options = {}) => {
            const requestIndex = requests.length;
            requests.push({
                url: String(url),
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [
                                        { text: '已生成一只拿钥匙的橙色小猫。' },
                                        {
                                            inlineData: {
                                                mimeType: 'image/png',
                                                data: Buffer.from(`gemini-image-bytes-${requestIndex}`).toString('base64')
                                            }
                                        }
                                    ]
                                }
                            }]
                        })}\n\n`));
                    },
                    cancel() {}
                }),
                text: async () => {
                    throw new Error('stream path should not read full text body');
                }
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => {
            uploaded.push({
                bytes: buffer.toString('utf8'),
                taskId: context.task.id,
                index: context.index,
                mimeType: context.mimeType
            });
            return {
                stored: {
                    image_url: `https://cdn.example.com/persisted/gemini-${context.index}.png`,
                    original_image_url: '',
                    storage_path: `generated/gemini-preview-${context.index}.png`,
                    original_storage_path: '',
                    metadata: {
                        preview_status: 'ready',
                        original_status: 'pending'
                    }
                },
                deferredOriginalUpload: {
                    resultIndex: context.index,
                    run: async () => ({
                        original_image_url: `https://cdn.example.com/persisted/gemini-original-${context.index}.png`,
                        original_storage_path: `generated/gemini-original-${context.index}.png`
                    })
                }
            };
        },
        onImageResult: async (image, detail) => {
            partial.push({ image, detail });
        }
    });

    assert.equal(requests.length, 4);
    assert.equal(requests[0].url, 'https://sub2api.fatherkey.com/v1beta/models/gemini-3.1-flash-image:streamGenerateContent?alt=sse');
    assert.equal(requests.every((request) => request.url === requests[0].url), true);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].headers.Authorization, 'Bearer sk-sub2api');
    assert.deepEqual(requests[0].body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
    assert.equal(requests[0].body.contents[0].parts[0].text.includes(task.prompt), true);
    assert.deepEqual(uploaded.map((item) => item.bytes), [
        'gemini-image-bytes-0',
        'gemini-image-bytes-1',
        'gemini-image-bytes-2',
        'gemini-image-bytes-3'
    ]);
    assert.deepEqual(uploaded.map((item) => item.index), [0, 1, 2, 3]);
    assert.equal(uploaded.every((item) => item.mimeType === 'image/png'), true);
    assert.equal(partial.length, 4);
    assert.deepEqual(partial.map((item) => item.image.image_url), [
        'https://cdn.example.com/persisted/gemini-0.png',
        'https://cdn.example.com/persisted/gemini-1.png',
        'https://cdn.example.com/persisted/gemini-2.png',
        'https://cdn.example.com/persisted/gemini-3.png'
    ]);
    assert.deepEqual(partial.map((item) => item.detail.index), [0, 1, 2, 3]);
    assert.equal(partial[0].detail.requestedCount, 4);
    assert.equal(execution.status, 'succeeded');
    assert.equal(execution.metadata.executor, 'gemini-native-images-stream-batch');
    assert.equal(execution.metadata.provider, 'gemini-native');
    assert.equal(execution.metadata.requested_image_count, 4);
    assert.equal(execution.metadata.delivered_image_count, 4);
    assert.equal(execution.metadata.provider_attempt_count, 4);
    assert.deepEqual(execution.images.map((image) => image.result_index), [0, 1, 2, 3]);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/gemini-0.png');
    assert.equal(execution.deferredOriginalUploads.length, 4);
    assert.deepEqual(execution.deferredOriginalUploads.map((item) => item.resultIndex), [0, 1, 2, 3]);
    assert.equal(typeof execution.deferredOriginalUploads[0].run, 'function');
});

test('gemini native image executor retries missing multi-image slots', async () => {
    const requests = [];
    const uploaded = [];
    const partial = [];
    const task = {
        id: 'task-gemini-image-retry',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gemini-3.1-flash-image',
        ratio: '1:1',
        resolution: '1k',
        quantity: 4,
        prompt: '四张不同角度的产品图',
        metadata: {}
    };

    const execution = await executeGeminiNativeImageGeneration(task, {
        env: {
            AI_IMAGE_GEMINI_URL_BRIDGE: 'false',
            AI_IMAGE_MULTI_IMAGE_SLOT_RETRY_ATTEMPTS: '1'
        },
        runtimeConfig: {
            apiKey: 'sk-sub2api',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'gemini-3.1-flash-image',
            protocol: 'gemini-native',
            source: 'ai-image-provider-stored'
        },
        fetchImpl: async (url, options = {}) => {
            const requestIndex = requests.length;
            requests.push({
                url: String(url),
                body: options.body ? JSON.parse(options.body) : null
            });
            if (requestIndex === 3) {
                const error = new Error('slot 4 upstream timeout');
                error.code = 'slot_timeout';
                throw error;
            }
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [
                                        { text: '已生成产品图。' },
                                        {
                                            inlineData: {
                                                mimeType: 'image/png',
                                                data: Buffer.from(`gemini-retry-image-bytes-${requestIndex}`).toString('base64')
                                            }
                                        }
                                    ]
                                }
                            }]
                        })}\n\n`));
                        controller.close();
                    },
                    cancel() {}
                }),
                text: async () => {
                    throw new Error('stream path should not read full text body');
                }
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => {
            uploaded.push({
                bytes: buffer.toString('utf8'),
                index: context.index
            });
            return {
                stored: {
                    image_url: `https://cdn.example.com/persisted/gemini-retry-${context.index}.png`,
                    original_image_url: '',
                    storage_path: `generated/gemini-retry-preview-${context.index}.png`,
                    original_storage_path: '',
                    metadata: {
                        preview_status: 'ready',
                        original_status: 'pending'
                    }
                },
                deferredOriginalUpload: {
                    resultIndex: context.index,
                    run: async () => ({})
                }
            };
        },
        onImageResult: async (image, detail) => {
            partial.push({ image, detail });
        }
    });

    assert.equal(requests.length, 5);
    assert.deepEqual(uploaded.map((item) => item.index).sort((a, b) => a - b), [0, 1, 2, 3]);
    assert.equal(uploaded.find((item) => item.index === 3)?.bytes, 'gemini-retry-image-bytes-4');
    assert.equal(partial.length, 4);
    assert.deepEqual(partial.map((item) => item.detail.index).sort((a, b) => a - b), [0, 1, 2, 3]);
    assert.equal(execution.status, 'succeeded');
    assert.deepEqual(execution.images.map((image) => image.result_index), [0, 1, 2, 3]);
    assert.equal(execution.metadata.requested_image_count, 4);
    assert.equal(execution.metadata.delivered_image_count, 4);
    assert.equal(execution.metadata.provider_attempt_count, 5);
    assert.equal(execution.metadata.batched_requests, 5);
    assert.equal(execution.metadata.partial_error, null);
});

test('gemini native image executor sends continuation reference image bytes upstream', async () => {
    const requests = [];
    const task = {
        id: 'task-gemini-continuation',
        site: 'cn',
        user_id: 'user-1',
        mode: 'image',
        billing_mode: 'points',
        status: 'running',
        model: 'gemini-3.1-flash-image',
        ratio: '9:16',
        resolution: '1k',
        quantity: 1,
        prompt: '把孩子抠出来',
        reference_image_url: 'https://cdn.example.com/source-child.png',
        metadata: {}
    };

    const execution = await executeGeminiNativeImageGeneration(task, {
        env: {
            AI_IMAGE_GEMINI_URL_BRIDGE: 'false'
        },
        runtimeConfig: {
            apiKey: 'sk-sub2api',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'gemini-3.1-flash-image',
            protocol: 'gemini-native',
            source: 'ai-image-provider-stored'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url) === task.reference_image_url) {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'image/png' : ''
                    },
                    arrayBuffer: async () => Buffer.from('source-child-image-bytes')
                };
            }
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{
                                        inlineData: {
                                            mimeType: 'image/png',
                                            data: Buffer.from('cutout-image-bytes').toString('base64')
                                        }
                                    }]
                                }
                            }]
                        })}\n\n`));
                    },
                    cancel() {}
                })
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => {
            assert.equal(buffer.toString('utf8'), 'cutout-image-bytes');
            assert.equal(context.task.id, task.id);
            return {
                image_url: 'https://cdn.example.com/persisted/cutout.png',
                original_image_url: 'https://cdn.example.com/persisted/cutout.png',
                storage_path: 'generated/cutout.png',
                original_storage_path: 'generated/cutout.png'
            };
        }
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, task.reference_image_url);
    assert.equal(requests[1].url, 'https://sub2api.fatherkey.com/v1beta/models/gemini-3.1-flash-image:streamGenerateContent?alt=sse');
    assert.equal(requests[1].body.contents[0].parts.length, 2);
    assert.equal(requests[1].body.contents[0].parts[1].inlineData.mimeType, 'image/png');
    assert.equal(requests[1].body.contents[0].parts[1].inlineData.data, Buffer.from('source-child-image-bytes').toString('base64'));
    assert.equal(execution.status, 'succeeded');
    assert.equal(execution.metadata.reference_image_count, 1);
    assert.equal(execution.metadata.executor, 'gemini-native-images-stream');
});

test('gemini native image executor uses Sub2API URL bridge when available', async () => {
    const requests = [];
    const partial = [];
    const task = {
        id: 'task-gemini-url-bridge',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gemini-3.1-flash-image',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '一只拿着钥匙的橙色小猫',
        metadata: {}
    };

    const execution = await executeGeminiNativeImageGeneration(task, {
        env: {
            AI_IMAGE_R2_ENDPOINT: 'https://r2.example.com',
            AI_IMAGE_R2_ACCESS_KEY_ID: 'test-access',
            AI_IMAGE_R2_SECRET_ACCESS_KEY: 'test-secret',
            AI_IMAGE_R2_BUCKET_NAME: 'zaoyoeimages',
            AI_IMAGE_R2_PUBLIC_URL: 'https://cdn.fatherkey.com'
        },
        runtimeConfig: {
            apiKey: 'sk-sub2api',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'gemini-3.1-flash-image',
            protocol: 'gemini-native',
            source: 'ai-image-provider-stored'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            return {
                ok: true,
                status: 200,
                headers: {
                    get: (name) => {
                        const normalized = String(name || '').toLowerCase();
                        if (normalized === 'content-type') return 'application/json';
                        if (normalized === 'x-zaoyoe-gemini-image-url-bridge') return '1';
                        return '';
                    }
                },
                text: async () => JSON.stringify({
                    object: 'gemini.image_url_bridge',
                    model: 'gemini-3.1-flash-image',
                    data: [{
                        url: 'https://cdn.fatherkey.com/ai-images/gemini-bridge/generated.png',
                        mime_type: 'image/png',
                        revised_prompt: '已生成一只拿钥匙的橙色小猫。'
                    }],
                    usage: {
                        input_tokens: 10,
                        output_tokens: 2,
                        total_tokens: 12
                    }
                })
            };
        },
        onImageResult: async (image, detail) => {
            partial.push({ image, detail });
        }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://sub2api.fatherkey.com/v1beta/models/gemini-3.1-flash-image:streamGenerateContent?alt=sse');
    assert.equal(requests[0].headers['X-Zaoyoe-Gemini-Image-Url-Bridge'], '1');
    assert.equal(requests[0].body.generationConfig.responseModalities.includes('IMAGE'), true);
    assert.equal(partial.length, 1);
    assert.equal(partial[0].image.image_url, 'https://cdn.fatherkey.com/ai-images/gemini-bridge/generated.png');
    assert.equal(execution.status, 'succeeded');
    assert.equal(execution.metadata.executor, 'gemini-native-images-url-bridge');
    assert.equal(execution.metadata.url_bridge, true);
    assert.equal(execution.metadata.bridge_fallback_used, false);
    assert.equal(execution.images[0].image_url, 'https://cdn.fatherkey.com/ai-images/gemini-bridge/generated.png');
    assert.equal(execution.images[0].metadata.preview_status, 'upstream_url');
    assert.equal(execution.deferredOriginalUploads.length, 1);
});

test('gemini native image executor falls back before model spend when URL bridge storage is missing', async () => {
    const requests = [];
    const uploaded = [];
    const cachedRequests = [];
    const cachedDiagnostics = [];
    const task = {
        id: 'task-gemini-url-bridge-unconfigured',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gemini-3.1-flash-image',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '一只拿着钥匙的橙色小猫',
        metadata: {}
    };

    const execution = await executeGeminiNativeImageGeneration(task, {
        runtimeConfig: {
            apiKey: 'sk-sub2api',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'gemini-3.1-flash-image',
            protocol: 'gemini-native',
            source: 'ai-image-provider-stored'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            if (requests.length === 1) {
                return {
                    ok: false,
                    status: 503,
                    headers: {
                        get: (name) => String(name || '').toLowerCase() === 'content-type' ? 'application/json' : ''
                    },
                    text: async () => JSON.stringify({
                        error: {
                            message: 'Gemini image URL bridge storage is not configured'
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{
                                        inlineData: {
                                            mimeType: 'image/png',
                                            data: Buffer.from('gemini-image-bytes').toString('base64')
                                        }
                                    }]
                                }
                            }]
                        })}\n\n`));
                        controller.close();
                    }
                }),
                text: async () => {
                    throw new Error('fallback stream path should not read full text body');
                }
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => {
            uploaded.push({
                bytes: buffer.toString('utf8'),
                taskId: context.task.id,
                index: context.index,
                mimeType: context.mimeType
            });
            return {
                image_url: 'https://cdn.example.com/persisted/gemini.png',
                original_image_url: 'https://cdn.example.com/persisted/gemini.png',
                storage_path: 'generated/gemini.png',
                original_storage_path: 'generated/gemini.png'
            };
        }
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers['X-Zaoyoe-Gemini-Image-Url-Bridge'], '1');
    assert.equal(requests[1].headers['X-Zaoyoe-Gemini-Image-Url-Bridge'], undefined);
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].bytes, 'gemini-image-bytes');
    assert.equal(execution.status, 'succeeded');
    assert.equal(execution.metadata.executor, 'gemini-native-images-stream');
    assert.equal(execution.metadata.url_bridge, false);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/gemini.png');

    const cachedExecution = await executeGeminiNativeImageGeneration({
        ...task,
        id: 'task-gemini-url-bridge-unconfigured-cached'
    }, {
        runtimeConfig: {
            apiKey: 'sk-sub2api',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'gemini-3.1-flash-image',
            protocol: 'gemini-native',
            source: 'ai-image-provider-stored'
        },
        fetchImpl: async (url, options = {}) => {
            cachedRequests.push({
                url: String(url),
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body ? JSON.parse(options.body) : null
            });
            return {
                ok: true,
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{
                                        inlineData: {
                                            mimeType: 'image/png',
                                            data: Buffer.from('gemini-cached-image-bytes').toString('base64')
                                        }
                                    }]
                                }
                            }]
                        })}\n\n`));
                        controller.close();
                    }
                }),
                text: async () => {
                    throw new Error('cached bridge skip should keep using the stream path');
                }
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => ({
            image_url: `https://cdn.example.com/persisted/${context.task.id}.png`,
            original_image_url: `https://cdn.example.com/persisted/${context.task.id}.png`,
            storage_path: `generated/${context.task.id}.png`,
            original_storage_path: `generated/${context.task.id}.png`
        }),
        onDiagnostic: (event, detail) => cachedDiagnostics.push({ event, detail })
    });

    assert.equal(cachedRequests.length, 1);
    assert.equal(cachedRequests[0].headers['X-Zaoyoe-Gemini-Image-Url-Bridge'], undefined);
    assert.equal(cachedExecution.status, 'succeeded');
    assert.equal(cachedExecution.metadata.url_bridge, false);
    assert.equal(cachedDiagnostics.some((item) => item.event === 'ai_image_gemini_native_request_start' && item.detail.urlBridgeSkippedByCache === true), true);
});

test('gemini native image executor can use non-stream generateContent fallback', async () => {
    const requests = [];
    const task = {
        id: 'task-gemini-image-non-stream',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gemini-3.1-flash-image',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '一只拿着钥匙的橙色小猫',
        metadata: {}
    };

    const execution = await executeGeminiNativeImageGeneration(task, {
        env: {
            AI_IMAGE_GEMINI_STREAM: 'false',
            AI_IMAGE_GEMINI_URL_BRIDGE: 'false'
        },
        runtimeConfig: {
            apiKey: 'sk-sub2api',
            baseUrl: 'https://sub2api.fatherkey.com/v1',
            model: 'gemini-3.1-flash-image',
            protocol: 'gemini-native',
            source: 'ai-image-provider-stored'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push(String(url));
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    candidates: [{
                        content: {
                            parts: [
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: Buffer.from('gemini-image-bytes').toString('base64')
                                    }
                                }
                            ]
                        }
                    }]
                })
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => {
            assert.equal(buffer.toString('utf8'), 'gemini-image-bytes');
            assert.equal(context.task.id, task.id);
            return {
                image_url: 'https://cdn.example.com/persisted/gemini.png',
                original_image_url: 'https://cdn.example.com/persisted/gemini.png',
                storage_path: 'generated/gemini.png',
                original_storage_path: 'generated/gemini.png'
            };
        }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0], 'https://sub2api.fatherkey.com/v1beta/models/gemini-3.1-flash-image:generateContent');
    assert.equal(execution.status, 'succeeded');
    assert.equal(execution.metadata.executor, 'gemini-native-images');
    assert.equal(execution.metadata.provider, 'gemini-native');
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/gemini.png');
});

test('gemini native image executor annotates response body timeout diagnostics', async () => {
    const diagnostics = [];
    const task = {
        id: 'task-gemini-body-timeout',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gemini-3.1-flash-image',
        ratio: '9:16',
        resolution: '1k',
        quantity: 1,
        prompt: '一张纵向海报',
        metadata: {}
    };

    await assert.rejects(
        executeGeminiNativeImageGeneration(task, {
            env: {
                AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS: '20',
                AI_IMAGE_GEMINI_STREAM: 'false',
                AI_IMAGE_GEMINI_URL_BRIDGE: 'false'
            },
            runtimeConfig: {
                apiKey: 'sk-sub2api',
                baseUrl: 'https://sub2api.fatherkey.com/v1',
                model: 'gemini-3.1-flash-image',
                protocol: 'gemini-native',
                source: 'ai-image-provider-stored'
            },
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                text: () => new Promise(() => {})
            }),
            onDiagnostic: (event, detail) => {
                diagnostics.push({ event, detail });
            }
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_response_body_timeout');
            assert.equal(error.metadata.executor, 'gemini-native-images');
            assert.equal(error.metadata.provider, 'gemini-native');
            assert.equal(error.metadata.provider_model, 'gemini-3.1-flash-image');
            assert.equal(error.metadata.upstream_host, 'sub2api.fatherkey.com');
            assert.equal(error.metadata.upstream_pathname, '/v1beta/models/gemini-3.1-flash-image:generateContent');
            assert.equal(Number.isFinite(error.metadata.timing.upstream_request_ms), true);
            assert.equal(Number.isFinite(error.metadata.timing.upstream_response_ms), true);
            return true;
        }
    );

    assert.equal(diagnostics.some((item) => item.event === 'ai_image_gemini_native_response_headers'), true);
    assert.equal(diagnostics.some((item) => item.event === 'ai_image_gemini_native_response_body_start'), true);
    assert.equal(diagnostics.some((item) => item.event === 'ai_image_gemini_native_response_body_failed'), true);
});

test('openai compatible image executor only forwards supported quality values', async () => {
    const requests = [];
    const task = {
        id: 'task-quality-normalize',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '产品主视觉',
        metadata: {
            quality: '2k'
        }
    };

    await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_QUALITY: '4k'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                body: options.body ? JSON.parse(options.body) : null
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [{
                        b64_json: Buffer.from('fake-png-bytes').toString('base64')
                    }]
                })
            };
        },
        uploadImageBuffer: async () => ({
            image_url: 'https://cdn.example.com/ai-images/task-quality-normalize.png',
            original_image_url: 'https://cdn.example.com/ai-images/task-quality-normalize.png',
            storage_path: 'ai-images/task-quality-normalize.png',
            original_storage_path: 'ai-images/task-quality-normalize.png'
        })
    });

    assert.equal(requests[0].url, 'https://api.example.com/v1/images/generations');
    assert.equal(Object.prototype.hasOwnProperty.call(requests[0].body, 'quality'), false);

    requests.length = 0;
    await executeOpenAiCompatibleImageGeneration({
        ...task,
        metadata: {
            quality: 'high'
        }
    }, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                body: options.body ? JSON.parse(options.body) : null
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [{
                        b64_json: Buffer.from('fake-png-bytes').toString('base64')
                    }]
                })
            };
        },
        uploadImageBuffer: async () => ({
            image_url: 'https://cdn.example.com/ai-images/task-quality-high.png',
            original_image_url: 'https://cdn.example.com/ai-images/task-quality-high.png',
            storage_path: 'ai-images/task-quality-high.png',
            original_storage_path: 'ai-images/task-quality-high.png'
        })
    });

    assert.equal(requests[0].body.quality, 'high');
});

test('openai compatible image executor requests URL image payloads by default to avoid slow base64 bodies', async () => {
    const requests = [];
    const task = {
        id: 'task-default-url-response',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '商业海报',
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url) === 'https://cdn.example.com/default-url.png') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: () => 'image/png'
                    },
                    arrayBuffer: async () => Buffer.from('default-url-image-bytes')
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [{
                        url: 'https://cdn.example.com/default-url.png'
                    }]
                })
            };
        },
        uploadImageBuffer: async () => ({
            image_url: 'https://cdn.example.com/persisted/default-url.webp',
            original_image_url: 'https://cdn.example.com/persisted/default-url.png',
            storage_path: 'ai-images/default-url.webp',
            original_storage_path: 'ai-images/default-url.png'
        })
    });

    assert.equal(requests[0].url, 'https://api.example.com/v1/images/generations');
    assert.equal(requests[0].body.response_format, 'url');
    assert.equal(execution.metadata.response_format, 'url');
    assert.equal(execution.metadata.response_format_fallback_used, false);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/default-url.webp');
});

test('openai compatible image executor stores provider task id and polls async result', async () => {
    const requests = [];
    const task = {
        id: 'task-provider-async-poll',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '异步生成一张商业海报',
        metadata: {}
    };
    const state = {
        tasks: [clone(task)]
    };
    const supabase = createSupabaseStub(state);

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        supabase,
        runtimeConfig: {
            apiKey: 'sk-test',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-image-2',
            asyncResult: {
                path: '/images/tasks/{id}',
                intervalMs: 1,
                maxAttempts: 2
            }
        },
        env: {
            AI_IMAGE_RESPONSE_FORMAT: 'url'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url: String(url),
                method: options.method || 'GET',
                body: options.body ? JSON.parse(options.body) : null
            });
            if (String(url) === 'https://cdn.example.com/generated-async.png') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: () => 'image/png'
                    },
                    arrayBuffer: async () => Buffer.from('async-provider-image-bytes')
                };
            }
            if (String(url) === 'https://api.example.com/v1/images/tasks/provider-async-1') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'provider-async-1',
                        status: 'succeeded',
                        data: [{
                            url: 'https://cdn.example.com/generated-async.png'
                        }]
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'provider-async-1',
                    status: 'processing',
                    data: []
                })
            };
        },
        uploadImageBuffer: async (buffer, context = {}) => ({
            image_url: `https://cdn.example.com/persisted/${buffer.toString('utf8')}.webp`,
            original_image_url: `https://cdn.example.com/persisted/${buffer.toString('utf8')}.png`,
            storage_path: `ai-images/${context.task.id}-${context.index}.webp`,
            original_storage_path: `ai-images/${context.task.id}-${context.index}.png`
        })
    });

    assert.equal(execution.status, 'succeeded');
    assert.equal(execution.providerTaskId, 'provider-async-1');
    assert.equal(execution.images.length, 1);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/async-provider-image-bytes.webp');
    assert.equal(state.tasks[0].provider_task_id, 'provider-async-1');
    assert.equal(state.tasks[0].metadata.provider_async.provider_task_id, 'provider-async-1');
    assert.equal(state.tasks[0].metadata.provider_async.status, 'processing');
    assert.equal(state.updatedTasks.some((item) => item.payload.provider_task_id === 'provider-async-1'), true);
    assert.equal(requests[0].url, 'https://api.example.com/v1/images/generations');
    assert.equal(requests[1].url, 'https://api.example.com/v1/images/tasks/provider-async-1');
    assert.equal(requests[2].url, 'https://cdn.example.com/generated-async.png');
    assert.equal(execution.metadata.async_poll_attempts, 1);
    assert.equal(execution.metadata.async_poll_path, '/images/tasks/provider-async-1');
    assert.equal(typeof execution.metadata.async_poll_ms, 'number');
    assert.equal(execution.metadata.provider_attempt_count, 2);
});

test('openai compatible image executor falls back when URL response format is unsupported', async () => {
    const requests = [];
    const task = {
        id: 'task-url-response-fallback',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '商业海报',
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
        },
        fetchImpl: async (_url, options = {}) => {
            const body = options.body ? JSON.parse(options.body) : null;
            requests.push(body);
            if (body?.response_format === 'url') {
                return {
                    ok: false,
                    status: 400,
                    text: async () => JSON.stringify({
                        error: {
                            code: 'invalid_parameter',
                            message: 'response_format url is not supported'
                        }
                    })
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [{
                        b64_json: Buffer.from('fallback-b64-image-bytes').toString('base64')
                    }]
                })
            };
        },
        uploadImageBuffer: async (buffer) => ({
            image_url: `https://cdn.example.com/persisted/${buffer.toString('utf8')}.png`,
            original_image_url: `https://cdn.example.com/persisted/${buffer.toString('utf8')}.png`,
            storage_path: 'ai-images/fallback.png',
            original_storage_path: 'ai-images/fallback.png'
        })
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].response_format, 'url');
    assert.equal(Object.prototype.hasOwnProperty.call(requests[1], 'response_format'), false);
    assert.equal(execution.metadata.response_format, 'url');
    assert.equal(execution.metadata.response_format_fallback_used, true);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/fallback-b64-image-bytes.png');
});

test('openai compatible image executor uploads base64 image results through injected storage', async () => {
    const uploaded = [];
    const task = {
        id: 'task-real-b64',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '产品主视觉',
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                data: [{
                    b64_json: Buffer.from('fake-png-bytes').toString('base64')
                }]
            })
        }),
        uploadImageBuffer: async (buffer, context = {}) => {
            uploaded.push({
                bytes: buffer.toString('utf8'),
                taskId: context.task.id,
                index: context.index
            });
            return {
                image_url: 'https://cdn.example.com/ai-images/task-real-b64.png',
                original_image_url: 'https://cdn.example.com/ai-images/task-real-b64.png',
                storage_path: 'ai-images/task-real-b64.png',
                original_storage_path: 'ai-images/task-real-b64.png'
            };
        }
    });

    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].bytes, 'fake-png-bytes');
    assert.equal(execution.images[0].storage_path, 'ai-images/task-real-b64.png');
    assert.equal(execution.images[0].width, 1024);
    assert.equal(execution.images[0].height, 1024);
});

test('openai compatible image executor uses edits API with reference image for image mode', async () => {
    const requests = [];
    const task = {
        id: 'task-image-edit-real',
        site: 'cn',
        user_id: 'user-1',
        mode: 'image',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '21:9',
        resolution: '1k',
        quantity: 1,
        prompt: '移除怪兽',
        reference_image_url: 'https://cdn.example.com/reference.png',
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), options });
            if (String(url) === 'https://cdn.example.com/reference.png') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: () => 'image/png'
                    },
                    arrayBuffer: async () => Buffer.from('reference-image-bytes')
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [{
                        b64_json: Buffer.from('edited-image-bytes').toString('base64'),
                        revised_prompt: '移除怪兽后的奥特曼城市战斗图'
                    }],
                    usage: {
                        total_tokens: 66
                    }
                })
            };
        },
        uploadImageBuffer: async (buffer, options = {}) => ({
            image_url: `https://cdn.example.com/${options.task.id}-${options.index}.png`,
            original_image_url: `https://cdn.example.com/${options.task.id}-${options.index}.png`,
            storage_path: `ai-images/${options.task.id}-${options.index}.png`,
            original_storage_path: `ai-images/${options.task.id}-${options.index}.png`
        })
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://cdn.example.com/reference.png');
    assert.equal(requests[1].url, 'https://api.example.com/v1/images/edits');
    assert.equal(requests[1].options.method, 'POST');
    assert.equal(requests[1].options.headers['Content-Type'], undefined);
    assert.equal(requests[1].options.body instanceof FormData, true);
    assert.equal(execution.metadata.executor, 'openai-compatible-image-edits');
    assert.equal(typeof execution.metadata.upstream_ms, 'number');
    assert.equal(typeof execution.metadata.postprocess_ms, 'number');
    assert.equal(execution.images.length, 1);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/task-image-edit-real-0.png');
    assert.equal(execution.tokenUsage.total_tokens, 66);
});

test('openai compatible image executor passes continuation base and extra references to edits API', async () => {
    const requests = [];
    const task = {
        id: 'task-image-edit-multi-reference',
        site: 'cn',
        user_id: 'user-1',
        mode: 'image',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '基于基底图续作，并参考另一张图的色彩',
        reference_image_url: 'https://cdn.example.com/base.png',
        metadata: {
            reference_images: [
                { url: 'https://cdn.example.com/ref-a.png', title: '参考 A' }
            ]
        }
    };

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), options });
            if (String(url).startsWith('https://cdn.example.com/')) {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: () => 'image/png'
                    },
                    arrayBuffer: async () => Buffer.from(`bytes:${url}`)
                };
            }
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [{
                        b64_json: Buffer.from('edited-image-bytes').toString('base64'),
                        revised_prompt: '多参考图续作结果'
                    }]
                })
            };
        },
        uploadImageBuffer: async (buffer, options = {}) => ({
            image_url: `https://cdn.example.com/${options.task.id}-${options.index}.png`,
            original_image_url: `https://cdn.example.com/${options.task.id}-${options.index}.png`,
            storage_path: `ai-images/${options.task.id}-${options.index}.png`,
            original_storage_path: `ai-images/${options.task.id}-${options.index}.png`
        })
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, 'https://cdn.example.com/base.png');
    assert.equal(requests[1].url, 'https://cdn.example.com/ref-a.png');
    assert.equal(requests[2].url, 'https://api.example.com/v1/images/edits');
    assert.equal(requests[2].options.body instanceof FormData, true);
    assert.equal(execution.metadata.reference_image_count, 2);
    assert.equal(execution.images.length, 1);
});

test('openai compatible image executor rejects provider URL results that are not images', async () => {
    const task = {
        id: 'task-provider-url-not-image',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '产品主视觉',
        metadata: {}
    };

    await assert.rejects(
        executeOpenAiCompatibleImageGeneration(task, {
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'url'
            },
            fetchImpl: async (url) => {
                if (String(url) === 'https://cdn.example.com/broken.png') {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'text/html'
                        },
                        arrayBuffer: async () => Buffer.from('<html>not found</html>')
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        data: [{
                            url: 'https://cdn.example.com/broken.png'
                        }]
                    })
                };
            },
            uploadImageBuffer: async () => {
                throw new Error('should not upload non-image response');
            }
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_result_url_not_image');
            assert.match(error.message, /不是图片内容/);
            return true;
        }
    );
});

test('openai compatible image executor times out when provider response body stalls', async () => {
    const task = {
        id: 'task-provider-body-timeout',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '商业海报',
        metadata: {}
    };

    await assert.rejects(
        executeOpenAiCompatibleImageGeneration(task, {
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_PROVIDER_TIMEOUT_MS: '10000',
                AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS: '50'
            },
            fetchImpl: async (url) => {
                if (String(url) === 'https://api.example.com/v1/images/generations') {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'application/json'
                        },
                        text: () => new Promise(() => {})
                    };
                }
                throw new Error(`Unexpected URL: ${url}`);
            },
            uploadImageBuffer: async () => ({})
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_response_body_timeout');
            assert.equal(error.statusCode, 504);
            assert.match(error.message, /超时/);
            return true;
        }
    );
});

test('ai image response body timeout inherits provider timeout unless explicitly overridden', () => {
    assert.equal(resolveResponseBodyTimeoutMs({
        AI_IMAGE_PROVIDER_TIMEOUT_MS: '360000'
    }), 360000);
    assert.equal(resolveResponseBodyTimeoutMs({
        AI_IMAGE_PROVIDER_TIMEOUT_MS: '360000',
        AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS: '180000'
    }), 180000);
    assert.equal(resolveResponseBodyTimeoutMs({
        AI_IMAGE_FETCH_TIMEOUT_MS: '240000'
    }), 240000);
});

test('openai compatible image executor lets response body use provider timeout by default', async () => {
    const task = {
        id: 'task-provider-body-provider-timeout',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '商业海报',
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleImageGeneration(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_PROVIDER_TIMEOUT_MS: '250',
            AI_IMAGE_RESPONSE_FORMAT: 'url'
        },
        fetchImpl: async (url) => {
            if (String(url) === 'https://api.example.com/v1/images/generations') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: () => 'application/json'
                    },
                    text: async () => {
                        await sleep(180);
                        return JSON.stringify({
                            data: [{
                                url: 'https://cdn.example.com/generated-slow-body.png'
                            }]
                        });
                    }
                };
            }
            if (String(url) === 'https://cdn.example.com/generated-slow-body.png') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: () => 'image/png'
                    },
                    arrayBuffer: async () => Buffer.from('generated-slow-body')
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        },
        uploadImageBuffer: async () => ({
            image_url: 'https://cdn.example.com/persisted/generated-slow-body.webp',
            original_image_url: 'https://cdn.example.com/persisted/generated-slow-body.png',
            storage_path: 'ai-images/generated-slow-body.webp',
            original_storage_path: 'ai-images/generated-slow-body.png'
        })
    });

    assert.equal(execution.images.length, 1);
    assert.equal(execution.metadata.timing.upstream_response_text_ms >= 175, true);
    assert.equal(execution.images[0].image_url, 'https://cdn.example.com/persisted/generated-slow-body.webp');
});

test('openai compatible image executor times out when result image body stalls', async () => {
    const task = {
        id: 'task-result-body-timeout',
        site: 'cn',
        user_id: 'user-1',
        mode: 'text',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '1:1',
        resolution: '1k',
        quantity: 1,
        prompt: '商业海报',
        metadata: {}
    };

    await assert.rejects(
        executeOpenAiCompatibleImageGeneration(task, {
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'url',
                AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS: '50'
            },
            fetchImpl: async (url, options = {}) => {
                if (String(url) === 'https://api.example.com/v1/images/generations') {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'application/json'
                        },
                        text: async () => JSON.stringify({
                            data: [{
                                url: 'https://cdn.example.com/generated-stall.png'
                            }]
                        })
                    };
                }
                if (String(url) === 'https://cdn.example.com/generated-stall.png') {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'image/png'
                        },
                        arrayBuffer: () => new Promise(() => {})
                    };
                }
                throw new Error(`Unexpected URL: ${url}`);
            },
            uploadImageBuffer: async () => ({})
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_response_body_timeout');
            assert.equal(error.statusCode, 504);
            assert.match(error.message, /超时/);
            return true;
        }
    );
});

test('openai compatible image executor classifies provider network failures', async () => {
    const task = {
        id: 'task-provider-network-fail',
        site: 'cn',
        user_id: 'user-1',
        mode: 'image',
        billing_mode: 'points',
        status: 'running',
        model: 'gpt-image-2',
        ratio: '21:9',
        resolution: '1k',
        quantity: 1,
        prompt: '图片里添加一个逗猫棒',
        reference_image_url: 'https://cdn.example.com/reference.png',
        metadata: {}
    };
    const cause = new Error('connect ETIMEDOUT 203.0.113.1:443');
    cause.code = 'ETIMEDOUT';
    const fetchError = new TypeError('fetch failed');
    fetchError.cause = cause;

    await assert.rejects(
        executeOpenAiCompatibleImageGeneration(task, {
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_PROVIDER_TIMEOUT_MS: '10000'
            },
            fetchImpl: async () => {
                throw fetchError;
            },
            uploadImageBuffer: async () => ({})
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_provider_timeout');
            assert.equal(error.statusCode, 504);
            assert.match(error.message, /请求超时/);
            assert.match(error.message, /ETIMEDOUT/i);
            return true;
        }
    );
});

test('openai compatible text vision executor classifies provider dns failures', async () => {
    const task = {
        id: 'task-provider-dns-fail',
        site: 'cn',
        user_id: 'user-1',
        mode: 'reverse',
        billing_mode: 'points',
        status: 'running',
        model: 'default-vision-model',
        prompt: '反推提示词',
        reference_image_url: 'https://cdn.example.com/reference.png',
        metadata: {}
    };
    const cause = new Error('getaddrinfo ENOTFOUND api.example.com');
    cause.code = 'ENOTFOUND';
    const fetchError = new TypeError('fetch failed');
    fetchError.cause = cause;

    await assert.rejects(
        executeOpenAiCompatibleTextVision(task, {
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_REFERENCE_IMAGE_HOSTS: 'cdn.example.com'
            },
            fetchImpl: async (url) => {
                if (String(url) === task.reference_image_url) {
                    return buildImageFetchResponse();
                }
                throw fetchError;
            }
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_provider_dns_failed');
            assert.equal(error.statusCode, 502);
            assert.match(error.message, /域名解析失败/);
            assert.match(error.message, /ENOTFOUND/i);
            return true;
        }
    );
});

test('openai compatible text vision executor reverses an image prompt through chat completions', async () => {
    const requests = [];
    const task = {
        id: 'task-reverse-real',
        site: 'cn',
        user_id: 'user-1',
        mode: 'reverse',
        billing_mode: 'points',
        status: 'running',
        model: 'default-vision-model',
        prompt: '请反推适合商业海报的提示词',
        reference_image_url: 'https://cdn.example.com/reference.png',
        reference_title: '霓虹城市',
        estimated_points: 3,
        charged_points: 0,
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleTextVision(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_CHAT_MODEL: 'gpt-4o-mini',
            AI_IMAGE_REFERENCE_IMAGE_HOSTS: 'cdn.example.com'
        },
        fetchImpl: async (url, options = {}) => {
            if (String(url) === task.reference_image_url) {
                requests.push({ url: String(url), method: options.method });
                return buildImageFetchResponse('reference-image-bytes', 'image/png');
            }
            requests.push({
                url,
                headers: options.headers,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'chatcmpl-reverse-1',
                    usage: {
                        prompt_tokens: 120,
                        completion_tokens: 80,
                        total_tokens: 200
                    },
                    choices: [{
                        message: {
                            content: 'A cinematic neon city poster, reflective rain street, bold commercial composition.'
                        }
                    }]
                })
            };
        }
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, task.reference_image_url);
    assert.equal(requests[1].url, 'https://api.example.com/v1/chat/completions');
    assert.equal(requests[1].body.model, 'gpt-4o-mini');
    assert.equal(requests[1].body.messages[0].content[0].type, 'text');
    assert.equal(requests[1].body.messages[0].content[1].type, 'image_url');
    assert.equal(
        requests[1].body.messages[0].content[1].image_url.url,
        `data:image/png;base64,${Buffer.from('reference-image-bytes').toString('base64')}`
    );
    assert.match(requests[1].body.messages[0].content[0].text, /反推/);
    assert.equal(requests[1].body.max_tokens, 520);
    assert.equal(execution.resultPrompt, 'A cinematic neon city poster, reflective rain street, bold commercial composition.');
    assert.equal(execution.images.length, 0);
    assert.equal(execution.tokenUsage.total_tokens, 200);
    assert.equal(execution.metadata.executor, 'openai-compatible-chat');
    assert.equal(execution.metadata.request_type, 'reverse');
    assert.equal(execution.metadata.reference_image_bytes, Buffer.byteLength('reference-image-bytes'));
    assert.equal(execution.metadata.reference_image_mime_type, 'image/png');
    assert.equal(execution.metadata.reference_image_transport, 'data_uri');
});

test('openai compatible text vision executor retries transient CDN DNS and transcodes AVIF references', async () => {
    const sharp = require('sharp');
    const avif = await sharp({
        create: {
            width: 2,
            height: 2,
            channels: 3,
            background: { r: 20, g: 80, b: 180 }
        }
    }).avif().toBuffer();
    const task = {
        id: 'task-reverse-avif',
        site: 'cn',
        user_id: 'user-1',
        mode: 'reverse',
        billing_mode: 'points',
        status: 'running',
        model: 'claude-opus-4-6',
        prompt: '请反推图片提示词',
        reference_image_url: 'https://cdn.example.com/reference.avif',
        metadata: {}
    };
    let referenceFetches = 0;
    let upstreamRequest = null;
    const execution = await executeOpenAiCompatibleTextVision(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_REFERENCE_IMAGE_HOSTS: 'cdn.example.com'
        },
        fetchImpl: async (url, options = {}) => {
            if (String(url) === task.reference_image_url) {
                referenceFetches += 1;
                if (referenceFetches === 1) {
                    const cause = new Error('getaddrinfo EAI_AGAIN cdn.example.com');
                    cause.code = 'EAI_AGAIN';
                    const fetchError = new TypeError('fetch failed');
                    fetchError.cause = cause;
                    throw fetchError;
                }
                return buildImageFetchResponse(avif, 'image/avif');
            }
            upstreamRequest = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'chatcmpl-reverse-avif',
                    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                    choices: [{ message: { content: 'AVIF converted prompt.' } }]
                })
            };
        }
    });

    assert.equal(referenceFetches, 2);
    assert.ok(upstreamRequest);
    const imageUrl = upstreamRequest.messages[0].content[1].image_url.url;
    assert.match(imageUrl, /^data:image\/jpeg;base64,/);
    assert.equal(execution.resultPrompt, 'AVIF converted prompt.');
    assert.equal(execution.metadata.reference_image_mime_type, 'image/jpeg');
    assert.equal(execution.metadata.reference_image_source_mime_type, 'image/avif');
});

test('openai compatible text vision executor rejects untrusted reverse image URLs before calling the model', async () => {
    let fetchCalls = 0;
    await assert.rejects(
        executeOpenAiCompatibleTextVision({
            id: 'task-reverse-untrusted',
            mode: 'reverse',
            billing_mode: 'points',
            model: 'claude-opus-4-6',
            reference_image_url: 'https://untrusted.example.net/reference.png'
        }, {
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
            },
            fetchImpl: async () => {
                fetchCalls += 1;
                return buildImageFetchResponse();
            }
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_reference_url_not_trusted');
            assert.equal(error.statusCode, 400);
            return true;
        }
    );
    assert.equal(fetchCalls, 0);
});

test('openai compatible text vision executor rejects non-image and oversized reverse references before model spend', async () => {
    const task = {
        id: 'task-reverse-invalid-image',
        mode: 'reverse',
        billing_mode: 'points',
        model: 'claude-opus-4-6',
        reference_image_url: 'https://cdn.example.com/reference.png'
    };
    const baseOptions = {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_REFERENCE_IMAGE_HOSTS: 'cdn.example.com'
        }
    };

    await assert.rejects(
        executeOpenAiCompatibleTextVision(task, {
            ...baseOptions,
            fetchImpl: async () => buildImageFetchResponse('<html>not an image</html>', 'text/html')
        }),
        (error) => error.code === 'ai_image_reference_url_not_image' && error.statusCode === 415
    );

    await assert.rejects(
        executeOpenAiCompatibleTextVision(task, {
            ...baseOptions,
            env: {
                ...baseOptions.env,
                AI_IMAGE_REVERSE_REFERENCE_MAX_BYTES: '1024'
            },
            fetchImpl: async () => buildImageFetchResponse(Buffer.alloc(1025), 'image/png')
        }),
        (error) => error.code === 'ai_image_reference_too_large' && error.statusCode === 413
    );
});

test('openai compatible text vision executor rejects models outside an explicit vision model list', async () => {
    let fetchCalls = 0;
    await assert.rejects(
        executeOpenAiCompatibleTextVision({
            id: 'task-reverse-text-only',
            mode: 'reverse',
            billing_mode: 'points',
            model: 'deepseek-chat',
            reference_image_url: 'https://cdn.example.com/reference.png'
        }, {
            runtimeConfig: {
                apiKey: 'sk-test',
                baseUrl: 'https://api.example.com/v1',
                model: 'deepseek-chat',
                visionModels: ['claude-opus-4-6']
            },
            env: {
                AI_IMAGE_REFERENCE_IMAGE_HOSTS: 'cdn.example.com'
            },
            fetchImpl: async () => {
                fetchCalls += 1;
                return buildImageFetchResponse();
            }
        }),
        (error) => {
            assert.equal(error.code, 'ai_image_model_vision_not_supported');
            assert.equal(error.statusCode, 409);
            return true;
        }
    );
    assert.equal(fetchCalls, 0);
});

test('openai compatible text vision executor handles chat mode without image output', async () => {
    const requests = [];
    const task = {
        id: 'task-chat-real',
        site: 'cn',
        user_id: 'user-1',
        mode: 'chat',
        billing_mode: 'points',
        status: 'running',
        model: 'default-chat-model',
        prompt: '帮我把这段提示词改得更商业化',
        estimated_points: 1,
        charged_points: 0,
        metadata: {}
    };

    const execution = await executeOpenAiCompatibleTextVision(task, {
        env: {
            AI_IMAGE_API_KEY: 'sk-test',
            AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
            AI_IMAGE_CHAT_MODEL: 'gpt-4o-mini'
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({
                url,
                body: JSON.parse(options.body)
            });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    id: 'chatcmpl-chat-1',
                    usage: {
                        input_tokens: 30,
                        output_tokens: 20,
                        total_tokens: 50
                    },
                    choices: [{
                        message: {
                            content: '已优化：高端商业摄影质感，清晰主体，柔和棚拍光。'
                        }
                    }]
                })
            };
        }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.example.com/v1/chat/completions');
    assert.equal(requests[0].body.model, 'gpt-4o-mini');
    assert.equal(requests[0].body.messages[0].content, '帮我把这段提示词改得更商业化');
    assert.equal(Object.hasOwn(requests[0].body, 'max_tokens'), false);
    assert.equal(execution.resultPrompt, '已优化：高端商业摄影质感，清晰主体，柔和棚拍光。');
    assert.equal(execution.images.length, 0);
    assert.equal(execution.tokenUsage.total_tokens, 50);
    assert.equal(typeof execution.metadata.upstream_ms, 'number');
    assert.equal(typeof execution.metadata.upstream_request_ms, 'number');
    assert.equal(typeof execution.metadata.upstream_response_ms, 'number');
    assert.equal(typeof execution.metadata.upstream_response_text_ms, 'number');
    assert.equal(typeof execution.metadata.upstream_response_parse_ms, 'number');
    assert.equal(typeof execution.metadata.timing.upstream_ms, 'number');
});

test('real image executor failure marks task failed and does not charge points', async () => {
    const state = {
        tasks: [{
            id: 'task-real-missing-config',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '1:1',
            resolution: '1k',
            quantity: 1,
            prompt: '商业海报',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-real-missing-config',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {}
        })
    });

    assert.equal(result.task.status, 'failed');
    assert.equal(result.task.error_code, 'ai_image_model_not_configured');
    assert.equal(result.task.charged_points, 0);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.results.length, 0);
});

test('ai image runtime records upstream empty-result summary when provider returns no image data', async () => {
    const state = {
        tasks: [{
            id: 'task-real-empty-upstream',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image-2',
            ratio: '9:16',
            resolution: '4k',
            quantity: 1,
            prompt: '商业海报',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    let requestCount = 0;

    const result = await executeAiImageTask({
        supabase,
        task: 'task-real-empty-upstream',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'url'
            },
            fetchImpl: async (url) => {
                requestCount += 1;
                assert.equal(String(url), 'https://api.example.com/v1/images/generations');
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: () => 'application/json'
                    },
                    text: async () => JSON.stringify({
                        id: `provider-empty-${requestCount}`,
                        status: 'succeeded',
                        data: [],
                        output: {
                            images: []
                        },
                        usage: {
                            prompt_tokens: 12,
                            total_tokens: 12
                        }
                    })
                };
            },
            uploadImageBuffer: async () => {
                throw new Error('should not upload empty upstream results');
            }
        })
    });

    assert.equal(result.task.status, 'failed');
    assert.equal(result.task.error_code, 'ai_image_empty_result');
    assert.equal(result.task.charged_points, 0);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.results.length, 0);
    assert.equal(requestCount, 2);

    const metadata = result.task.metadata;
    assert.equal(metadata.provider_model, 'gpt-image-2');
    assert.equal(metadata.requested_image_count, 1);
    assert.equal(metadata.delivered_image_count, 0);
    assert.equal(metadata.provider_attempt_count, 2);
    assert.equal(metadata.upstream_empty_result.status, 'succeeded');
    assert.equal(metadata.upstream_empty_result.id, 'provider-empty-2');
    assert.equal(metadata.upstream_empty_result.data_is_array, true);
    assert.equal(metadata.upstream_empty_result.data_count, 0);
    assert.ok(metadata.upstream_empty_result.top_level_keys.includes('data'));
    assert.ok(metadata.upstream_empty_result.top_level_keys.includes('output'));
    assert.ok(metadata.upstream_empty_result.output_keys.includes('images'));
    assert.equal(metadata.failure.error_code, 'ai_image_empty_result');

    for (const key of ['upstream_ms', 'upstream_request_ms', 'upstream_response_ms', 'executor_ms', 'total_run_ms', 'runtime_unaccounted_ms']) {
        assert.equal(typeof metadata.timing[key], 'number', `${key} should be recorded as a number`);
    }
});

test('ai image runtime can complete reverse prompt with real text vision executor and charge after success', async () => {
    const state = {
        tasks: [{
            id: 'task-reverse-success',
            site: 'cn',
            user_id: 'user-1',
            mode: 'reverse',
            billing_mode: 'points',
            status: 'queued',
            model: 'default-vision-model',
            prompt: '反推提示词',
            reference_image_url: 'https://cdn.example.com/reference.png',
            estimated_points: 3,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-reverse-success',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleTextVision(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_REFERENCE_IMAGE_HOSTS: 'cdn.example.com'
            },
            fetchImpl: async (url) => String(url) === 'https://cdn.example.com/reference.png'
                ? buildImageFetchResponse()
                : ({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    data: [],
                    choices: [{
                        message: {
                            content: 'A polished commercial prompt from the uploaded image.'
                        }
                    }],
                    usage: {
                        total_tokens: 42
                    }
                })
            })
        })
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.task.result_prompt, 'A polished commercial prompt from the uploaded image.');
    assert.equal(result.task.charged_points, 3);
    assert.equal(result.results.length, 0);
    assert.equal(result.task.metadata.executor, 'openai-compatible-chat');
    assert.equal(state.rpcCalls.length, 1);
});

test('ai image runtime can complete with real image executor URL result and charge after success', async () => {
    const state = {
        tasks: [{
            id: 'task-real-success',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image',
            ratio: '3:2',
            resolution: '1k',
            quantity: 1,
            prompt: '电商产品海报',
            estimated_points: 8,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-real-success',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'url'
            },
            fetchImpl: async (url) => {
                if (String(url) === 'https://cdn.example.com/real-success.png') {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'image/png'
                        },
                        arrayBuffer: async () => Buffer.from('real-success-image-bytes')
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        data: [{
                            url: 'https://cdn.example.com/real-success.png'
                        }]
                    })
                };
            },
            uploadImageBuffer: async () => ({
                image_url: 'https://cdn.example.com/persisted/real-success.png',
                original_image_url: 'https://cdn.example.com/persisted/real-success.png',
                storage_path: 'ai-images/persisted/real-success.png',
                original_storage_path: 'ai-images/persisted/real-success.png'
            })
        })
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.task.charged_points, 8);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].image_url, 'https://cdn.example.com/persisted/real-success.png');
    assert.equal(result.results[0].storage_path, 'ai-images/persisted/real-success.png');
    assert.equal(result.task.metadata.executor, 'openai-compatible-images');
    assert.equal(typeof result.task.metadata.timing.preflight_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.config_resolve_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.queue_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.upstream_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.postprocess_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.insert_results_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.charge_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.update_task_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.total_complete_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.executor_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.total_run_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.runtime_accounted_ms, 'number');
    assert.equal(typeof result.task.metadata.timing.runtime_unaccounted_ms, 'number');
    assert.ok(result.task.metadata.timing.total_run_ms >= result.task.metadata.timing.executor_ms);
    assert.ok(result.task.metadata.timing.runtime_unaccounted_ms >= 0);
    assert.equal(state.rpcCalls.length, 1);
});

test('ai image openai-compatible executor sends one upstream request per requested image', async () => {
    const state = {
        tasks: [{
            id: 'task-real-two-images',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image',
            ratio: '9:16',
            resolution: '1k',
            quantity: 2,
            prompt: '两张国风舞蹈海报',
            estimated_points: 16,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    const generationRequests = [];

    const result = await executeAiImageTask({
        supabase,
        task: 'task-real-two-images',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'url'
            },
            fetchImpl: async (url, options = {}) => {
                if (String(url).startsWith('https://cdn.example.com/')) {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'image/png'
                        },
                        arrayBuffer: async () => Buffer.from(`bytes:${url}`)
                    };
                }
                generationRequests.push(JSON.parse(options.body));
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: `provider-${generationRequests.length}`,
                        usage: {
                            prompt_tokens: 10,
                            completion_tokens: 0,
                            total_tokens: 10
                        },
                        data: [{
                            url: `https://cdn.example.com/generated-${generationRequests.length}.png`
                        }]
                    })
                };
            },
            uploadImageBuffer: async (_buffer, { index }) => ({
                image_url: `https://cdn.example.com/persisted/generated-${index}.webp`,
                original_image_url: `https://cdn.example.com/persisted/generated-${index}.png`,
                storage_path: `ai-images/persisted/generated-${index}.webp`,
                original_storage_path: `ai-images/persisted/generated-${index}.png`
            })
        })
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.results.length, 2);
    assert.equal(result.task.charged_points, 16);
    assert.equal(generationRequests.length, 2);
    assert.deepEqual(generationRequests.map((request) => request.n), [1, 1]);
    assert.equal(result.task.metadata.provider_attempt_count, 2);
    assert.equal(result.task.metadata.requested_image_count, 2);
    assert.equal(result.task.metadata.delivered_image_count, 2);
    assert.equal(result.task.metadata.delivery.partial, false);
});

test('ai image openai-compatible executor keeps partial image when missing-image retry fails', async () => {
    const state = {
        tasks: [{
            id: 'task-real-partial-retry-failed',
            site: 'cn',
            user_id: 'user-1',
            mode: 'text',
            billing_mode: 'points',
            status: 'queued',
            model: 'gpt-image',
            ratio: '9:16',
            resolution: '1k',
            quantity: 2,
            prompt: '两张舞蹈海报',
            estimated_points: 16,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);
    let generationRequestCount = 0;

    const result = await executeAiImageTask({
        supabase,
        task: 'task-real-partial-retry-failed',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'sk-test',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1',
                AI_IMAGE_RESPONSE_FORMAT: 'url'
            },
            fetchImpl: async (url) => {
                if (String(url).startsWith('https://cdn.example.com/')) {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            get: () => 'image/png'
                        },
                        arrayBuffer: async () => Buffer.from(`bytes:${url}`)
                    };
                }
                generationRequestCount += 1;
                if (generationRequestCount > 1) {
                    return {
                        ok: false,
                        status: 502,
                        text: async () => JSON.stringify({
                            error: {
                                code: 'provider_retry_failed',
                                message: '补发失败'
                            }
                        })
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 'provider-partial-1',
                        data: [{
                            url: 'https://cdn.example.com/generated-partial-1.png'
                        }]
                    })
                };
            },
            uploadImageBuffer: async (_buffer, { index }) => ({
                image_url: `https://cdn.example.com/persisted/generated-partial-${index}.webp`,
                original_image_url: `https://cdn.example.com/persisted/generated-partial-${index}.png`,
                storage_path: `ai-images/persisted/generated-partial-${index}.webp`,
                original_storage_path: `ai-images/persisted/generated-partial-${index}.png`
            })
        })
    });

    assert.equal(result.task.status, 'succeeded');
    assert.equal(result.results.length, 1);
    assert.equal(result.task.charged_points, 8);
    assert.equal(result.task.metadata.requested_image_count, 2);
    assert.equal(result.task.metadata.delivered_image_count, 1);
    assert.equal(result.task.metadata.delivery.partial, true);
    assert.equal(result.task.metadata.delivery.charge_quantity, 1);
    assert.equal(result.task.metadata.partial_error.code, 'provider_retry_failed');
});

test('ai image runtime keeps API mode from using site image executor without transient key', async () => {
    const state = {
        tasks: [{
            id: 'task-api-image-real',
            site: 'cn',
            user_id: 'user-2',
            mode: 'text',
            billing_mode: 'api',
            status: 'queued',
            model: 'gpt-image-2',
            api_model_group: 'image',
            api_base_url: 'https://sub2api.fatherkey.com/v1',
            api_key_tail: '12345678',
            prompt: '生成一张图',
            estimated_points: 0,
            charged_points: 0,
            metadata: {},
            created_at: '2026-06-21T11:00:00.000Z'
        }]
    };
    const supabase = createSupabaseStub(state);

    const result = await executeAiImageTask({
        supabase,
        task: 'task-api-image-real',
        executor: (task, runtimeOptions) => executeOpenAiCompatibleImageGeneration(task, {
            ...runtimeOptions,
            env: {
                AI_IMAGE_API_KEY: 'site-key',
                AI_IMAGE_API_BASE_URL: 'https://api.example.com/v1'
            }
        })
    });

    assert.equal(result.task.status, 'failed');
    assert.equal(result.task.error_code, 'ai_image_api_mode_requires_transient_key');
    assert.equal(result.task.charged_points, 0);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.apiUsage.length, 0);
});

test('ai image model config resolves environment image key before stored codex key', async () => {
    const config = await resolveAiImageRuntimeConfig({
        task: { model: 'gpt-image' },
        env: {
            AI_IMAGE_API_KEY: 'image-key',
            AI_IMAGE_API_BASE_URL: 'https://image.example.com/v1'
        }
    });

    assert.equal(config.configured, true);
    assert.equal(config.apiKey, 'image-key');
    assert.equal(config.baseUrl, 'https://image.example.com/v1');
    assert.equal(config.model, 'gpt-image-2');
});

test('ai image model config normalizes bare environment base URL to v1', async () => {
    const config = await resolveAiImageRuntimeConfig({
        task: { model: 'gpt-image' },
        env: {
            AI_IMAGE_API_KEY: 'image-key',
            AI_IMAGE_API_BASE_URL: 'https://image.example.com'
        }
    });

    assert.equal(config.configured, true);
    assert.equal(config.baseUrl, 'https://image.example.com/v1');
});

test('ai image model config uses stored image key before shared environment key', async () => {
    const state = {
        adminSecrets: [{
            secret_key: 'ai_image_api_key',
            encrypted_value: {},
            metadata: {
                baseUrl: 'https://stored-image.example.com/v1',
                model: 'gpt-image-3'
            },
            updated_at: '2026-06-21T10:00:00.000Z',
            updated_by: 'admin-1',
            value: 'stored-image-key'
        }]
    };
    const supabase = createSupabaseStub(state);

    const originalLoad = require('node:module')._load;
    const secretsPath = require.resolve('../api/_lib/secrets');
    const modelsPath = require.resolve('../server/api-handlers/_ai-image-models');
    const originalSecretsExports = require.cache[secretsPath]?.exports;

    require.cache[secretsPath].exports = {
        ...originalSecretsExports,
        async resolveAiImageRuntimeSecretConfig() {
            return {
                configured: true,
                source: 'stored',
                apiKey: 'stored-image-key',
                baseUrl: 'https://stored-image.example.com/v1',
                model: 'gpt-image-3'
            };
        },
        async resolveCodexRuntimeConfig() {
            return {
                configured: true,
                source: 'stored',
                apiKey: 'stored-codex-key',
                baseUrl: 'https://codex.example.com/v1',
                model: 'gpt-5.4'
            };
        }
    };
    delete require.cache[modelsPath];

    try {
        const { resolveAiImageRuntimeConfig: resolveRuntimeConfig } = require('../server/api-handlers/_ai-image-models');
        const config = await resolveRuntimeConfig({
            supabase,
            task: { model: 'gpt-image' },
            env: {
                OPENAI_API_KEY: 'shared-openai-key',
                OPENAI_API_BASE_URL: 'https://shared.example.com/v1'
            }
        });

        assert.equal(config.configured, true);
        assert.equal(config.apiKey, 'stored-image-key');
        assert.equal(config.baseUrl, 'https://stored-image.example.com/v1');
        assert.equal(config.model, 'gpt-image-3');
        assert.equal(config.source, 'ai-image-stored');
    } finally {
        require.cache[secretsPath].exports = originalSecretsExports;
        delete require.cache[modelsPath];
        require('node:module')._load = originalLoad;
    }
});

test('ai image runtime resolves provider by requested model alias', async () => {
    const originalLoad = require('node:module')._load;
    const secretsPath = require.resolve('../api/_lib/secrets');
    const modelsPath = require.resolve('../server/api-handlers/_ai-image-models');
    const originalSecretsExports = require.cache[secretsPath]?.exports;

    require.cache[secretsPath].exports = {
        ...originalSecretsExports,
        async resolveAiImageProviderRuntimeConfig() {
            return {
                configured: true,
                source: 'ai-image-provider-stored',
                providerId: 'flux',
                label: 'FLUX 上游',
                apiKey: 'stored-flux-key',
                baseUrl: 'https://flux.example.com/v1',
                model: 'flux-pro',
                models: ['flux-pro', 'flux-kontext']
            };
        },
        async resolveAiImageRuntimeSecretConfig() {
            return {
                configured: true,
                source: 'stored',
                providerId: 'default',
                apiKey: 'stored-default-key',
                baseUrl: 'https://default.example.com/v1',
                model: 'gpt-image-2',
                models: ['gpt-image-2']
            };
        },
        async resolveCodexRuntimeConfig() {
            return {
                configured: false,
                source: 'missing',
                apiKey: '',
                baseUrl: '',
                model: ''
            };
        }
    };
    delete require.cache[modelsPath];

    try {
        const { resolveAiImageRuntimeConfig: resolveRuntimeConfig } = require('../server/api-handlers/_ai-image-models');
        const config = await resolveRuntimeConfig({
            supabase: { from() {} },
            task: { model: 'flux-pro' },
            env: {}
        });

        assert.equal(config.configured, true);
        assert.equal(config.apiKey, 'stored-flux-key');
        assert.equal(config.baseUrl, 'https://flux.example.com/v1');
        assert.equal(config.model, 'flux-pro');
        assert.equal(config.providerId, 'flux');
        assert.equal(config.source, 'ai-image-provider-stored');
    } finally {
        require.cache[secretsPath].exports = originalSecretsExports;
        delete require.cache[modelsPath];
        require('node:module')._load = originalLoad;
    }
});

test('ai image runtime resolves chat provider by model group without default provider id stealing match', async () => {
    const {
        buildAiImageProviderSecretKey,
        resolveAiImageProviderRuntimeConfig,
        upsertStoredAdminSecret
    } = require('../api/_lib/secrets');
    const supabase = createSupabaseStub({ adminSecrets: [] });
    const previousAdminKey = process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
    const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ADMIN_CONFIG_ENCRYPTION_KEY = 'ai-image-runtime-provider-route-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';

    try {
        await upsertStoredAdminSecret({
            supabase,
            secretKey: buildAiImageProviderSecretKey('default'),
            secretValue: 'sk-default-image-provider-1234567890',
            adminId: 'admin-1',
            metadata: {
                providerId: 'default',
                label: 'Default Image',
                baseUrl: 'https://image.example.com/v1',
                model: 'gpt-image-2',
                models: ['gpt-image-2'],
                imageModels: ['gpt-image-2'],
                modelGroup: 'image',
                isActive: true
            }
        });
        await upsertStoredAdminSecret({
            supabase,
            secretKey: buildAiImageProviderSecretKey('vision-chat'),
            secretValue: 'sk-chat-provider-1234567890',
            adminId: 'admin-1',
            metadata: {
                providerId: 'vision-chat',
                label: 'Vision Chat',
                baseUrl: 'https://chat.example.com/v1',
                model: 'gpt-4o-mini',
                chatModels: ['gpt-4o-mini', 'gpt-4.1'],
                modelGroup: 'chat',
                isActive: true,
                displayOrder: 20
            }
        });

        const config = await resolveAiImageProviderRuntimeConfig(supabase, {
            task: {
                mode: 'reverse',
                model: 'gpt-4.1',
                api_model_group: 'chat'
            },
            env: {}
        });

        assert.equal(config.configured, true);
        assert.equal(config.providerId, 'vision-chat');
        assert.equal(config.apiKey, 'sk-chat-provider-1234567890');
        assert.equal(config.baseUrl, 'https://chat.example.com/v1');
        assert.equal(config.model, 'gpt-4.1');
    } finally {
        if (previousAdminKey === undefined) {
            delete process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
        } else {
            process.env.ADMIN_CONFIG_ENCRYPTION_KEY = previousAdminKey;
        }
        if (previousServiceKey === undefined) {
            delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
            process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
        }
    }
});

test('ai image runtime respects explicit default provider image group and drops stale chat models', async () => {
    const {
        AI_IMAGE_SECRET_KEY,
        listStoredAiImageProviderSecrets,
        upsertStoredAdminSecret
    } = require('../api/_lib/secrets');
    const supabase = createSupabaseStub({ adminSecrets: [] });
    const previousAdminKey = process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
    const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ADMIN_CONFIG_ENCRYPTION_KEY = 'ai-image-runtime-provider-route-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';

    try {
        await upsertStoredAdminSecret({
            supabase,
            secretKey: AI_IMAGE_SECRET_KEY,
            secretValue: 'sk-default-mixed-provider-1234567890',
            adminId: 'admin-1',
            metadata: {
                providerId: 'default',
                label: 'Default',
                baseUrl: 'https://sub2api.fatherkey.com/v1',
                model: 'gpt-image-2',
                imageModels: ['gpt-image-2'],
                chatModels: ['gpt-4o-mini', 'gpt-4.1'],
                modelGroup: 'image'
            }
        });

        const providers = await listStoredAiImageProviderSecrets(supabase, { env: {} });
        const defaultProvider = providers.find((provider) => provider.providerId === 'default');

        assert.equal(defaultProvider.configured, true);
        assert.equal(defaultProvider.modelGroup, 'image');
        assert.deepEqual(defaultProvider.imageModels, ['gpt-image-2']);
        assert.deepEqual(defaultProvider.chatModels, []);
    } finally {
        if (previousAdminKey === undefined) {
            delete process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
        } else {
            process.env.ADMIN_CONFIG_ENCRYPTION_KEY = previousAdminKey;
        }
        if (previousServiceKey === undefined) {
            delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
            process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
        }
    }
});

test('ai image public provider metadata includes legacy default with provider rows without decrypting', async () => {
    const {
        AI_IMAGE_SECRET_KEY,
        buildAiImageProviderSecretKey,
        listStoredAiImageProviderPublicMetadata,
        upsertStoredAdminSecret
    } = require('../api/_lib/secrets');
    const supabase = createSupabaseStub({ adminSecrets: [] });
    const previousAdminKey = process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
    const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ADMIN_CONFIG_ENCRYPTION_KEY = 'ai-image-public-metadata-source-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';

    try {
        await upsertStoredAdminSecret({
            supabase,
            secretKey: AI_IMAGE_SECRET_KEY,
            secretValue: 'sk-legacy-public-image-provider-1234567890',
            adminId: 'admin-1',
            metadata: {
                providerId: 'image',
                label: 'image',
                baseUrl: 'https://www.geek2api.com/v1',
                model: 'gpt-image-2',
                imageModels: ['gpt-image-2'],
                modelGroup: 'image',
                vendor: 'openai',
                protocol: 'openai-compatible',
                isActive: true
            }
        });
        await upsertStoredAdminSecret({
            supabase,
            secretKey: buildAiImageProviderSecretKey('banana-2'),
            secretValue: 'sk-banana-public-provider-1234567890',
            adminId: 'admin-1',
            metadata: {
                providerId: 'banana-2',
                label: 'Banana 2',
                baseUrl: 'https://sub2api.fatherkey.com/v1',
                model: 'gemini-3.1-flash-image',
                imageModels: ['gemini-3.1-flash-image'],
                modelGroup: 'image',
                vendor: 'gemini',
                protocol: 'gemini-native',
                isActive: true,
                displayOrder: 10
            }
        });

        const providers = await listStoredAiImageProviderPublicMetadata(supabase, {
            env: {
                ADMIN_CONFIG_ENCRYPTION_KEY: 'wrong-key-for-public-metadata'
            }
        });
        const legacyProvider = providers.find((provider) => provider.providerId === 'image');
        const bananaProvider = providers.find((provider) => provider.providerId === 'banana-2');

        assert.equal(legacyProvider?.configured, true);
        assert.equal(legacyProvider.apiKey, '');
        assert.equal(legacyProvider.label, 'image');
        assert.equal(legacyProvider.baseUrl, 'https://www.geek2api.com/v1');
        assert.equal(legacyProvider.modelGroup, 'image');
        assert.deepEqual(legacyProvider.imageModels, ['gpt-image-2']);
        assert.equal(bananaProvider?.configured, true);
        assert.deepEqual(bananaProvider.imageModels, ['gemini-3.1-flash-image']);
    } finally {
        if (previousAdminKey === undefined) {
            delete process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
        } else {
            process.env.ADMIN_CONFIG_ENCRYPTION_KEY = previousAdminKey;
        }
        if (previousServiceKey === undefined) {
            delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
            process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
        }
    }
});

test('ai image secret resolution caches the provider chain and invalidates after secret updates', async () => {
    const {
        AI_IMAGE_SECRET_KEY,
        resolveAiImageProviderRuntimeConfig,
        upsertStoredAdminSecret,
        deleteStoredAdminSecret
    } = require('../api/_lib/secrets');
    const supabase = createSupabaseStub({ adminSecrets: [] });
    const previousAdminKey = process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
    const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ADMIN_CONFIG_ENCRYPTION_KEY = 'ai-image-runtime-cache-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';

    try {
        await upsertStoredAdminSecret({
            supabase,
            secretKey: AI_IMAGE_SECRET_KEY,
            secretValue: 'sk-default-cache-provider-1234567890',
            adminId: 'admin-1',
            metadata: {
                providerId: 'default',
                label: 'Default Cache',
                baseUrl: 'https://cache.example.com/v1',
                model: 'gpt-image-2',
                imageModels: ['gpt-image-2'],
                modelGroup: 'image',
                isActive: true
            }
        });

        const first = await resolveAiImageProviderRuntimeConfig(supabase, {
            task: { mode: 'text', model: 'gpt-image-2' },
            env: {}
        });
        const afterFirstResolveCount = supabase.state.secretSelectCount;
        const second = await resolveAiImageProviderRuntimeConfig(supabase, {
            task: { mode: 'text', model: 'gpt-image-2' },
            env: {}
        });
        const afterSecondResolveCount = supabase.state.secretSelectCount;

        assert.equal(first.apiKey, 'sk-default-cache-provider-1234567890');
        assert.equal(second.apiKey, 'sk-default-cache-provider-1234567890');
        assert.equal(afterFirstResolveCount, 2);
        assert.equal(afterSecondResolveCount, afterFirstResolveCount);

        await upsertStoredAdminSecret({
            supabase,
            secretKey: AI_IMAGE_SECRET_KEY,
            secretValue: 'sk-default-cache-provider-9999999999',
            adminId: 'admin-2',
            metadata: {
                providerId: 'default',
                label: 'Default Cache Updated',
                baseUrl: 'https://cache.example.com/v1',
                model: 'gpt-image-2',
                imageModels: ['gpt-image-2'],
                modelGroup: 'image',
                isActive: true
            }
        });

        const refreshed = await resolveAiImageProviderRuntimeConfig(supabase, {
            task: { mode: 'text', model: 'gpt-image-2' },
            env: {}
        });
        const afterRefreshCount = supabase.state.secretSelectCount;

        assert.equal(refreshed.apiKey, 'sk-default-cache-provider-9999999999');
        assert.equal(refreshed.label, 'Default Cache Updated');
        assert.equal(afterRefreshCount, afterSecondResolveCount + 2);

        await deleteStoredAdminSecret(supabase, AI_IMAGE_SECRET_KEY);
        const missing = await resolveAiImageProviderRuntimeConfig(supabase, {
            task: { mode: 'text', model: 'gpt-image-2' },
            env: {}
        });
        const afterDeleteCount = supabase.state.secretSelectCount;

        assert.equal(missing.configured, false);
        assert.equal(afterDeleteCount, afterRefreshCount + 2);
    } finally {
        if (previousAdminKey === undefined) {
            delete process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
        } else {
            process.env.ADMIN_CONFIG_ENCRYPTION_KEY = previousAdminKey;
        }
        if (previousServiceKey === undefined) {
            delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
            process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
        }
    }
});

test('timed clone cache serves stale values immediately while one refresh runs in background', async () => {
    const { createTimedCloneCache } = require('../api/_lib/secrets').__testUtils;
    let nowMs = 0;
    let loadCount = 0;
    let releaseRefresh;
    const cache = createTimedCloneCache({
        ttlMs: 10,
        staleTtlMs: 100,
        now: () => nowMs
    });
    const loader = async () => {
        loadCount += 1;
        if (loadCount === 1) return { version: 1 };
        return new Promise((resolve) => {
            releaseRefresh = () => resolve({ version: 2 });
        });
    };

    const first = await cache.getOrLoad('provider-1', loader);
    assert.equal(first.status, 'miss');
    assert.deepEqual(first.value, { version: 1 });

    nowMs = 20;
    const stale = await cache.getOrLoad('provider-1', loader);
    const concurrent = await cache.getOrLoad('provider-1', loader);
    assert.equal(stale.status, 'stale-refresh');
    assert.equal(concurrent.status, 'stale-wait');
    assert.deepEqual(stale.value, { version: 1 });
    assert.deepEqual(concurrent.value, { version: 1 });
    assert.equal(loadCount, 2);

    releaseRefresh();
    await new Promise((resolve) => setImmediate(resolve));
    const refreshed = await cache.getOrLoad('provider-1', loader);
    assert.equal(refreshed.status, 'hit');
    assert.deepEqual(refreshed.value, { version: 2 });
    assert.equal(loadCount, 2);
});

test('timed clone cache stops serving stale values after the stale window', async () => {
    const { createTimedCloneCache } = require('../api/_lib/secrets').__testUtils;
    let nowMs = 0;
    let loadCount = 0;
    const cache = createTimedCloneCache({
        ttlMs: 10,
        staleTtlMs: 100,
        now: () => nowMs
    });

    await cache.getOrLoad('provider-2', async () => ({ version: ++loadCount }));
    nowMs = 101;
    const refreshed = await cache.getOrLoad('provider-2', async () => ({ version: ++loadCount }));

    assert.equal(refreshed.status, 'refresh');
    assert.deepEqual(refreshed.value, { version: 2 });
});
