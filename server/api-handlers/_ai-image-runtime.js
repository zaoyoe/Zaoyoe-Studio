const {
    deductPointsForService
} = require('../../api/_lib/payments/rpc');
const {
    calculateAiImageRuleChargePoints
} = require('./_ai-image-pricing');
const {
    isAiWorkbenchBillingError,
    releaseAiWorkbenchPoints,
    settleAiWorkbenchPoints
} = require('../../api/_lib/payments/ai-workbench-billing');

const DEMO_RESULT_IMAGES = Object.freeze([
    'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1495567720989-cebdbdd97913?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=90',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1600&q=90'
]);

const DEFAULT_TASK_TIMEOUT_MS = 150000;
const DEFAULT_VIDEO_TASK_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const VIDEO_STALE_RUNNING_GRACE_MS = 2 * 60 * 1000;

const TASK_SELECT = [
    'id',
    'site',
    'user_id',
    'parent_task_id',
    'conversation_id',
    'client_task_id',
    'source_prompt_id',
    'mode',
    'agent_id',
    'agent_slug',
    'billing_mode',
    'status',
    'model',
    'api_model_group',
    'ratio',
    'resolution',
    'quantity',
    'prompt',
    'negative_prompt',
    'reference_image_url',
    'reference_image_storage_path',
    'reference_title',
    'result_prompt',
    'estimated_points',
    'charged_points',
    'points_ledger_reference_id',
    'api_base_url',
    'api_key_tail',
    'token_usage',
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'provider_task_id',
    'error_code',
    'error_message',
    'metadata',
    'started_at',
    'completed_at',
    'created_at',
    'updated_at'
].join(', ');

const RESULT_SELECT = [
    'id',
    'task_id',
    'site',
    'user_id',
    'result_index',
    'image_url',
    'original_image_url',
    'storage_path',
    'original_storage_path',
    'mime_type',
    'width',
    'height',
    'ratio',
    'resolution',
    'prompt',
    'revised_prompt',
    'seed',
    'metadata',
    'created_at'
].join(', ');

function normalizeText(value, maxLength = 2000) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 1000000) / 1000000);
}

function normalizeBillablePoints(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 1000000) / 1000000);
}

function normalizePositiveInt(value, fallback = 1, { min = 1, max = 8 } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeTimeoutMs(value, fallback, { min = 60000, max = 60 * 60 * 1000 } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeTaskStatus(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (['running', 'processing'].includes(normalized)) return 'running';
    if (['succeeded', 'success', 'completed'].includes(normalized)) return 'succeeded';
    if (['failed', 'cancelled', 'refunded'].includes(normalized)) return normalized;
    return 'queued';
}

function getAiWorkbenchLedgerReason(task = {}) {
    const mode = normalizeText(task.mode, 40).toLowerCase();
    if (mode === 'chat') return 'AI 文本对话';
    if (mode === 'reverse') return 'AI 提示词反推';
    if (mode === 'video') return 'AI 视频生成';
    return 'AI 图片生成';
}

function getAiWorkbenchBillingV2Metadata(task = {}) {
    return safeObject(safeObject(task.metadata).billing_v2);
}

function isAiWorkbenchBillingV2Task(task = {}) {
    return task.billing_mode === 'points' && getAiWorkbenchBillingV2Metadata(task).enabled === true;
}

async function releaseTaskAuthorizationIfNeeded(supabase, task = {}, reason = 'AI 工作台任务未完成，释放预授权') {
    if (!isAiWorkbenchBillingV2Task(task)) return null;
    return releaseAiWorkbenchPoints({
        supabase,
        task,
        reason
    });
}

function isVideoTask(task = {}) {
    return String(task.mode || task.api_model_group || task.output || '').trim().toLowerCase() === 'video'
        || String(safeObject(task.metadata).output || '').trim().toLowerCase() === 'video';
}

function getTaskProviderTaskId(task = {}) {
    const metadata = safeObject(task.metadata);
    const providerAsync = safeObject(metadata.provider_async || metadata.providerAsync);
    return normalizeText(
        task.provider_task_id
        || task.providerTaskId
        || metadata.provider_task_id
        || metadata.providerTaskId
        || providerAsync.provider_task_id
        || providerAsync.providerTaskId,
        240
    );
}

function formatTimeoutDuration(timeoutMs = 0) {
    const seconds = Math.max(1, Math.ceil(Number(timeoutMs || 0) / 1000));
    if (seconds >= 60 && seconds % 60 === 0) {
        return `${seconds / 60} 分钟`;
    }
    return `${seconds} 秒`;
}

function resolveTaskTimeoutMs(task = {}, {
    taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    videoTaskTimeoutMs = DEFAULT_VIDEO_TASK_TIMEOUT_MS
} = {}) {
    const video = isVideoTask(task);
    return normalizeTimeoutMs(
        video ? videoTaskTimeoutMs : taskTimeoutMs,
        video ? DEFAULT_VIDEO_TASK_TIMEOUT_MS : DEFAULT_TASK_TIMEOUT_MS,
        {
            min: 10,
            max: MAX_TASK_TIMEOUT_MS
        }
    );
}

function resolveVideoStaleRunningTimeoutMs(staleRunningTimeoutMs, videoTaskTimeoutMs, explicitVideoStaleRunningTimeoutMs) {
    const normalizedVideoTaskTimeoutMs = normalizeTimeoutMs(videoTaskTimeoutMs, DEFAULT_VIDEO_TASK_TIMEOUT_MS, {
        min: 10,
        max: MAX_TASK_TIMEOUT_MS
    });
    const fallback = Math.max(
        normalizeTimeoutMs(staleRunningTimeoutMs, 3 * 60 * 1000),
        normalizedVideoTaskTimeoutMs + VIDEO_STALE_RUNNING_GRACE_MS
    );
    return normalizeTimeoutMs(explicitVideoStaleRunningTimeoutMs, fallback, {
        min: 60 * 1000,
        max: MAX_TASK_TIMEOUT_MS + 10 * 60 * 1000
    });
}

function getTaskUpdatedAtMs(task = {}) {
    const candidates = [
        task.updated_at,
        task.updatedAt,
        task.started_at,
        task.startedAt,
        task.created_at,
        task.createdAt
    ];
    for (const candidate of candidates) {
        const parsed = Date.parse(candidate || '');
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

function isRunningTaskStale(task = {}, {
    staleAfterMs = 3 * 60 * 1000,
    videoStaleAfterMs = DEFAULT_VIDEO_TASK_TIMEOUT_MS + VIDEO_STALE_RUNNING_GRACE_MS
} = {}) {
    if (normalizeTaskStatus(task.status) !== 'running') return false;
    const updatedAtMs = getTaskUpdatedAtMs(task);
    if (!updatedAtMs) return true;
    const timeoutMs = isVideoTask(task)
        ? normalizeTimeoutMs(videoStaleAfterMs, DEFAULT_VIDEO_TASK_TIMEOUT_MS + VIDEO_STALE_RUNNING_GRACE_MS)
        : normalizeTimeoutMs(staleAfterMs, 3 * 60 * 1000);
    return Date.now() - updatedAtMs >= timeoutMs;
}

function compareQueuedTaskPriority(left = {}, right = {}) {
    const leftPoints = normalizeBillablePoints(left.estimated_points, 0);
    const rightPoints = normalizeBillablePoints(right.estimated_points, 0);
    if (leftPoints !== rightPoints) return leftPoints - rightPoints;

    const leftCreatedAt = Date.parse(left.created_at || left.createdAt || '') || 0;
    const rightCreatedAt = Date.parse(right.created_at || right.createdAt || '') || 0;
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;

    const leftUpdatedAt = Date.parse(left.updated_at || left.updatedAt || '') || 0;
    const rightUpdatedAt = Date.parse(right.updated_at || right.updatedAt || '') || 0;
    if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt - rightUpdatedAt;

    return String(left.id || '').localeCompare(String(right.id || ''));
}

function nowMs() {
    return Date.now();
}

function elapsedMs(startedAt) {
    return Math.max(0, Date.now() - Number(startedAt || Date.now()));
}

function normalizeTimingMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
}

function logWorkerTiming(event, detail = {}) {
    if (process.env.AI_IMAGE_WORKER_TIMING_LOGS === 'false') return;
    const payload = {
        at: new Date().toISOString(),
        event,
        ...detail
    };
    console.log(JSON.stringify(payload));
}

function buildExecutorDiagnosticLogger(task = {}) {
    const diagnostics = [];
    const emit = (event, detail = {}) => {
        const item = {
            at: new Date().toISOString(),
            event: normalizeText(event, 120),
            ...safeObject(detail)
        };
        diagnostics.push(item);
        if (diagnostics.length > 12) diagnostics.shift();
        logWorkerTiming(item.event || 'ai_image_executor_diagnostic', {
            taskId: task.id || item.taskId || '',
            ...item
        });
    };
    emit.getSummary = () => diagnostics.slice(-6).map((item) => ({
        at: item.at,
        event: item.event,
        provider: normalizeText(item.provider, 80),
        providerModel: normalizeText(item.providerModel, 160),
        providerSource: normalizeText(item.providerSource, 80),
        host: normalizeText(item.host, 240),
        pathname: normalizeText(item.pathname, 500),
        status: item.status,
        ok: item.ok,
        elapsedMs: normalizeTimingMs(item.elapsedMs),
        code: normalizeText(item.code, 120),
        message: normalizeText(item.message, 500)
    }));
    emit.getLast = () => diagnostics[diagnostics.length - 1] || null;
    return emit;
}

function safeObject(value = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildSeed(value = '') {
    return String(value || '')
        .split('')
        .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function pickDemoImage(index, task = {}) {
    if (task.reference_image_url) return task.reference_image_url;
    const seed = buildSeed(`${task.id}:${task.prompt}:${task.model}`);
    return DEMO_RESULT_IMAGES[(seed + index) % DEMO_RESULT_IMAGES.length];
}

function buildReversePrompt(task = {}) {
    const name = normalizeText(task.reference_title, 120) || 'reference image';
    return `A polished commercial image inspired by ${name}, clear subject separation, balanced composition, natural cinematic lighting, refined color grading, realistic texture, and rich visual detail suitable for an AI prompt gallery.`;
}

function buildChatResponse(task = {}) {
    const prompt = normalizeText(task.prompt, 180) || '你的创作指令';
    const model = normalizeText(task.model, 120) || 'API 模型';
    return `已记录通过 ${model} 处理的文本指令：“${prompt}”。真实模型执行器接入后，这里会写入上游返回的文本内容和 token usage。`;
}

function estimateTokenUsage(task = {}) {
    const promptLength = normalizeText(task.prompt, 8000).length;
    const isImage = ['text', 'image', 'agent'].includes(task.mode);
    const inputTokens = Math.max(32, Math.ceil(promptLength / 2.6) + (task.reference_image_url ? 180 : 0));
    const outputTokens = task.mode === 'chat'
        ? Math.max(32, Math.ceil(promptLength / 4))
        : (isImage ? 0 : 96);
    return {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
    };
}

function buildPlaceholderExecutionResult(task = {}) {
    if (task.mode === 'chat') {
        const usage = estimateTokenUsage(task);
        return {
            status: 'succeeded',
            resultPrompt: buildChatResponse(task),
            images: [],
            tokenUsage: usage,
            providerTaskId: `preview-chat-${task.id}`,
            metadata: {
                executor: 'placeholder',
                warning: 'real_model_executor_not_configured'
            }
        };
    }

    if (task.mode === 'reverse') {
        const usage = estimateTokenUsage(task);
        return {
            status: 'succeeded',
            resultPrompt: buildReversePrompt(task),
            images: [],
            tokenUsage: usage,
            providerTaskId: `preview-reverse-${task.id}`,
            metadata: {
                executor: 'placeholder',
                warning: 'real_model_executor_not_configured'
            }
        };
    }

    const quantity = normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
    const images = Array.from({ length: quantity }, (_, index) => ({
        image_url: pickDemoImage(index, task),
        original_image_url: pickDemoImage(index, task),
        result_index: index,
        mime_type: 'image/jpeg',
        ratio: task.ratio || '1:1',
        resolution: task.resolution || '1k',
        prompt: task.prompt || '',
        revised_prompt: task.prompt || '',
        seed: `${buildSeed(`${task.id}:${index}`)}`
    }));

    return {
        status: 'succeeded',
        resultPrompt: task.prompt || '',
        images,
        tokenUsage: estimateTokenUsage(task),
        providerTaskId: `preview-image-${task.id}`,
        metadata: {
            executor: 'placeholder',
            warning: 'real_model_executor_not_configured'
        }
    };
}

async function loadTaskById(supabase, taskId) {
    const { data, error } = await supabase
        .from('ai_image_tasks')
        .select(TASK_SELECT)
        .eq('id', taskId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function loadQueuedTasks(supabase, { site = '', limit = 5 } = {}) {
    const normalizedLimit = normalizePositiveInt(limit, 5, { min: 1, max: 20 });
    const candidateLimit = Math.min(100, Math.max(normalizedLimit * 5, normalizedLimit));
    let query = supabase
        .from('ai_image_tasks')
        .select(TASK_SELECT)
        .eq('status', 'queued')
        .order('estimated_points', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(candidateLimit);

    if (site) {
        query = query.eq('site', site);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (Array.isArray(data) ? data : [])
        .slice()
        .sort(compareQueuedTaskPriority)
        .slice(0, normalizedLimit);
}

async function loadStaleRunningTasks(supabase, { site = '', limit = 5, staleAfterMs = 3 * 60 * 1000 } = {}) {
    const cutoff = new Date(Date.now() - normalizeTimeoutMs(staleAfterMs, 3 * 60 * 1000)).toISOString();
    let query = supabase
        .from('ai_image_tasks')
        .select(TASK_SELECT)
        .eq('status', 'running')
        .lt('updated_at', cutoff)
        .order('updated_at', { ascending: true })
        .limit(normalizePositiveInt(limit, 5, { min: 1, max: 20 }));

    if (site) {
        query = query.eq('site', site);
    }

    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function updateTask(supabase, taskId, payload = {}) {
    const { data, error } = await supabase
        .from('ai_image_tasks')
        .update(payload)
        .eq('id', taskId)
        .select(TASK_SELECT)
        .single();
    if (error) throw error;
    return data;
}

async function markTaskRunning(supabase, task = {}) {
    const currentStatus = normalizeTaskStatus(task.status);
    if (currentStatus !== 'queued') {
        const error = new Error(`Task ${task.id} is not queued`);
        error.statusCode = 409;
        error.code = 'task_not_queued';
        throw error;
    }

    const { data, error } = await supabase
        .from('ai_image_tasks')
        .update({
            status: 'running',
            started_at: task.started_at || new Date().toISOString(),
            error_code: '',
            error_message: ''
        })
        .eq('id', task.id)
        .eq('status', 'queued')
        .select(TASK_SELECT)
        .maybeSingle();

    if (error || !data) {
        const claimError = new Error(`Task ${task.id} was already claimed`);
        claimError.statusCode = 409;
        claimError.code = 'task_claim_conflict';
        throw claimError;
    }

    return data;
}

function getResultIndex(image = {}, fallbackIndex = 0) {
    return Number.isFinite(Number(image.result_index)) ? Number(image.result_index) : fallbackIndex;
}

function sortTaskResults(results = []) {
    return (Array.isArray(results) ? results : [])
        .slice()
        .sort((left, right) => {
            const leftIndex = Number.isFinite(Number(left?.result_index)) ? Number(left.result_index) : 0;
            const rightIndex = Number.isFinite(Number(right?.result_index)) ? Number(right.result_index) : 0;
            if (leftIndex !== rightIndex) return leftIndex - rightIndex;
            return String(left?.created_at || '').localeCompare(String(right?.created_at || ''));
        });
}

function hasPersistableImagePayload(image = {}) {
    return Boolean(
        normalizeText(image.image_url, 4000)
        || normalizeText(image.original_image_url, 4000)
        || normalizeText(image.storage_path, 1000)
        || normalizeText(image.original_storage_path, 1000)
    );
}

function buildTaskResultPayload(task = {}, image = {}, index = 0) {
    return {
        task_id: task.id,
        site: task.site || 'cn',
        user_id: task.user_id,
        result_index: getResultIndex(image, index),
        image_url: normalizeText(image.image_url, 4000),
        original_image_url: normalizeText(image.original_image_url, 4000),
        storage_path: normalizeText(image.storage_path, 1000),
        original_storage_path: normalizeText(image.original_storage_path, 1000),
        mime_type: normalizeText(image.mime_type || 'image/png', 120),
        width: image.width || null,
        height: image.height || null,
        ratio: normalizeText(image.ratio || task.ratio, 20),
        resolution: normalizeText(image.resolution || task.resolution, 20) || null,
        prompt: normalizeText(image.prompt || task.prompt, 8000),
        revised_prompt: normalizeText(image.revised_prompt || image.prompt || task.prompt, 8000),
        seed: normalizeText(image.seed, 120),
        metadata: image.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata)
            ? image.metadata
            : {}
    };
}

async function insertTaskResults(supabase, task = {}, images = []) {
    if (!Array.isArray(images) || !images.length) return [];

    const payloads = images
        .filter(hasPersistableImagePayload)
        .map((image, index) => buildTaskResultPayload(task, image, index));
    if (!payloads.length) return [];

    const { data, error } = await supabase
        .from('ai_image_results')
        .insert(payloads)
        .select(RESULT_SELECT);
    if (error) throw error;
    return sortTaskResults(Array.isArray(data) ? data : []);
}

async function loadTaskResults(supabase, task = {}) {
    if (!task?.id || !supabase?.from) return [];
    const { data, error } = await supabase
        .from('ai_image_results')
        .select(RESULT_SELECT)
        .eq('task_id', task.id)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return sortTaskResults(Array.isArray(data) ? data : []);
}

async function insertTaskResultsIfMissing(supabase, task = {}, images = [], {
    existingResults = null
} = {}) {
    if (!Array.isArray(images) || !images.length) {
        return Array.isArray(existingResults) ? sortTaskResults(existingResults) : [];
    }

    const existing = Array.isArray(existingResults)
        ? sortTaskResults(existingResults)
        : await loadTaskResults(supabase, task);
    const seenIndexes = new Set(existing.map((row) => Number(row.result_index || 0)));
    const missingImages = [];

    images.forEach((image, index) => {
        if (!hasPersistableImagePayload(image)) return;
        const resultIndex = getResultIndex(image, index);
        if (seenIndexes.has(resultIndex)) return;
        seenIndexes.add(resultIndex);
        missingImages.push({
            ...image,
            result_index: resultIndex
        });
    });

    if (!missingImages.length) return existing;
    const inserted = await insertTaskResults(supabase, task, missingImages);
    return sortTaskResults([...existing, ...inserted]);
}

async function insertTaskResultIfMissing(supabase, task = {}, image = {}, index = 0) {
    if (!task?.id || !supabase?.from || !hasPersistableImagePayload(image)) return null;

    const latestTask = await loadTaskById(supabase, task.id);
    if (normalizeTaskStatus(latestTask?.status) !== 'running') return null;

    const resultIndex = getResultIndex(image, index);
    const existingResults = await loadTaskResults(supabase, latestTask);
    const existing = existingResults.find((row) => Number(row.result_index || 0) === resultIndex);
    if (existing) return existing;

    const inserted = await insertTaskResults(supabase, latestTask, [{
        ...image,
        result_index: resultIndex
    }]);
    return inserted.find((row) => Number(row.result_index || 0) === resultIndex) || inserted[0] || null;
}

function mergeResultMetadata(currentMetadata = {}, patchMetadata = {}) {
    return {
        ...safeObject(currentMetadata),
        ...safeObject(patchMetadata)
    };
}

async function updateDeferredOriginalResult(supabase, result = {}, payload = {}) {
    if (!result?.id || !supabase?.from) return null;
    const metadata = mergeResultMetadata(result.metadata, payload.metadata);
    const updatePayload = {
        original_image_url: normalizeText(payload.original_image_url, 4000),
        original_storage_path: normalizeText(payload.original_storage_path, 1000),
        metadata
    };

    if (payload.image_url) {
        updatePayload.image_url = normalizeText(payload.image_url, 4000);
    }
    if (payload.storage_path) {
        updatePayload.storage_path = normalizeText(payload.storage_path, 1000);
    }

    const { data, error } = await supabase
        .from('ai_image_results')
        .update(updatePayload)
        .eq('id', result.id)
        .select(RESULT_SELECT)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function markDeferredOriginalFailed(supabase, result = {}, error = {}) {
    if (!result?.id || !supabase?.from) return null;
    const metadata = mergeResultMetadata(result.metadata, {
        original_status: 'failed',
        original_error_code: normalizeText(error?.code || 'ai_image_original_upload_failed', 120),
        original_error: normalizeText(error?.message || '原图后台转存失败', 500),
        original_failed_at: new Date().toISOString()
    });
    const { data, error: updateError } = await supabase
        .from('ai_image_results')
        .update({ metadata })
        .eq('id', result.id)
        .select(RESULT_SELECT)
        .maybeSingle();
    if (updateError) throw updateError;
    return data || null;
}

function runDeferredOriginalUploads(supabase, task = {}, execution = {}, results = []) {
    const deferredOriginalUploads = Array.isArray(execution.deferredOriginalUploads)
        ? execution.deferredOriginalUploads.filter((item) => item && typeof item.run === 'function')
        : [];
    if (!deferredOriginalUploads.length || !supabase?.from || !results.length) {
        return;
    }

    const startedAt = nowMs();
    logWorkerTiming('ai_image_original_deferred_start', {
        taskId: task.id,
        count: deferredOriginalUploads.length
    });

    const run = async () => {
        let succeeded = 0;
        let failed = 0;
        for (const item of deferredOriginalUploads) {
            const resultIndex = Number.isFinite(Number(item.resultIndex)) ? Number(item.resultIndex) : 0;
            const result = results.find((row) => Number(row.result_index || 0) === resultIndex)
                || results[resultIndex]
                || null;
            if (!result?.id) {
                failed += 1;
                continue;
            }

            try {
                // Keep original uploads serial to avoid saturating R2/network after a multi-image task completes.
                // eslint-disable-next-line no-await-in-loop
                const payload = await item.run({ result, task });
                // eslint-disable-next-line no-await-in-loop
                await updateDeferredOriginalResult(supabase, result, payload);
                succeeded += 1;
            } catch (error) {
                failed += 1;
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await markDeferredOriginalFailed(supabase, result, error);
                } catch (updateError) {
                    logWorkerTiming('ai_image_original_deferred_mark_failed_error', {
                        taskId: task.id,
                        resultId: result.id,
                        code: normalizeText(updateError?.code || 'mark_failed_error', 120),
                        message: normalizeText(updateError?.message || updateError, 500)
                    });
                }
                logWorkerTiming('ai_image_original_deferred_item_failed', {
                    taskId: task.id,
                    resultId: result.id,
                    code: normalizeText(error?.code || 'ai_image_original_upload_failed', 120),
                    message: normalizeText(error?.message || error, 500)
                });
            }
        }

        logWorkerTiming('ai_image_original_deferred_complete', {
            taskId: task.id,
            count: deferredOriginalUploads.length,
            succeeded,
            failed,
            elapsedMs: elapsedMs(startedAt)
        });
    };

    Promise.resolve()
        .then(run)
        .catch((error) => {
            logWorkerTiming('ai_image_original_deferred_fatal', {
                taskId: task.id,
                code: normalizeText(error?.code || 'ai_image_original_deferred_fatal', 120),
                message: normalizeText(error?.message || error, 500),
                elapsedMs: elapsedMs(startedAt)
            });
        });
}

async function findExistingDeduction(supabase, task = {}) {
    if (!task?.id || !task?.user_id) return 0;

    const { data, error } = await supabase
        .from('points_ledger')
        .select('amount')
        .eq('user_id', task.user_id)
        .eq('reference_id', task.id)
        .lt('amount', 0)
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        return 0;
    }

    const amount = Number(data?.[0]?.amount);
    return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

async function chargeTaskIfNeeded(supabase, task = {}, execution = {}) {
    if (task.billing_mode !== 'points') {
        return {
            chargedPoints: 0,
            referenceId: ''
        };
    }

    const chargeEstimate = calculateAiImageRuleChargePoints(task, execution.tokenUsage || task.token_usage || {});
    const expectedAmount = normalizeBillablePoints(chargeEstimate.points ?? task.estimated_points, 0);
    const billingV2 = getAiWorkbenchBillingV2Metadata(task);
    if (billingV2.enabled === true) {
        const syncStatus = normalizeText(
            safeObject(execution.metadata).sub2api_billing_sync?.status
            || safeObject(execution.metadata).sub2apiBillingSync?.status,
            40
        ).toLowerCase();
        const dynamicBillingPending = billingV2.dynamic === true
            && chargeEstimate.source !== 'sub2api_actual_cost'
            && syncStatus !== 'settled';
        if (dynamicBillingPending) {
            return {
                chargedPoints: 0,
                referenceId: '',
                pricing: chargeEstimate,
                authorizationPending: true
            };
        }
        if (billingV2.authorization_required === false) {
            return {
                chargedPoints: 0,
                referenceId: '',
                pricing: chargeEstimate
            };
        }
        const settlement = await settleAiWorkbenchPoints({
            supabase,
            task,
            amount: expectedAmount,
            reason: getAiWorkbenchLedgerReason(task)
        });
        const settledAmount = normalizeBillablePoints(settlement.deducted, 0);
        if (Math.abs(settledAmount - expectedAmount) > 0.000001) {
            const error = new Error('AI 工作台积分结算金额不一致');
            error.code = 'ai_billing_settlement_mismatch';
            error.statusCode = 503;
            error.billing = {
                expected: expectedAmount,
                settled: settledAmount,
                task_id: task.id
            };
            throw error;
        }
        return {
            chargedPoints: settledAmount,
            referenceId: expectedAmount > 0 ? task.id : '',
            pricing: chargeEstimate,
            settlement
        };
    }
    if (expectedAmount <= 0) {
        return {
            chargedPoints: 0,
            referenceId: ''
        };
    }

    const existingCharged = normalizeBillablePoints(task.charged_points, 0);
    if (existingCharged > 0) {
        return {
            chargedPoints: existingCharged,
            referenceId: task.points_ledger_reference_id || task.id,
            pricing: chargeEstimate
        };
    }

    const existingDeduction = await findExistingDeduction(supabase, task);
    if (existingDeduction > 0) {
        return {
            chargedPoints: existingDeduction,
            referenceId: task.id,
            pricing: chargeEstimate
        };
    }

    const { data, error } = await deductPointsForService({
        supabase,
        userId: task.user_id,
        amount: expectedAmount,
        reason: getAiWorkbenchLedgerReason(task),
        referenceId: task.id,
        site: task.site || 'cn'
    });
    if (error) throw error;

    return {
        chargedPoints: normalizeBillablePoints(data?.deducted, expectedAmount) || expectedAmount,
        referenceId: task.id,
        pricing: chargeEstimate
    };
}

function getExpectedImageCount(task = {}) {
    if (String(task.mode || '').trim() === 'video') return 1;
    if (!['text', 'image', 'agent'].includes(String(task.mode || '').trim())) return 0;
    return normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
}

function getDeliveredImageCount(executionOrResults = {}) {
    const images = Array.isArray(executionOrResults)
        ? executionOrResults
        : (Array.isArray(executionOrResults.images) ? executionOrResults.images : []);
    return images.length;
}

function getTaskChargeQuantity(task = {}, deliveredCount = 0) {
    const expectedCount = getExpectedImageCount(task);
    if (!expectedCount) return 1;
    return Math.min(expectedCount, Math.max(0, normalizePositiveInt(deliveredCount, 0, { min: 0, max: 8 })));
}

function buildChargeTaskForDeliveredResults(task = {}, deliveredCount = 0) {
    const expectedCount = getExpectedImageCount(task);
    const chargeQuantity = getTaskChargeQuantity(task, deliveredCount);
    if (!expectedCount || chargeQuantity >= expectedCount) return task;
    const estimatedPoints = normalizeBillablePoints(task.estimated_points, 0);
    const adjustedEstimatedPoints = estimatedPoints > 0
        ? normalizeBillablePoints((estimatedPoints / expectedCount) * chargeQuantity, 0)
        : 0;
    return {
        ...task,
        estimated_points: adjustedEstimatedPoints,
        metadata: {
            ...(task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata) ? task.metadata : {}),
            delivery: {
                ...(task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata) && task.metadata.delivery && typeof task.metadata.delivery === 'object' && !Array.isArray(task.metadata.delivery) ? task.metadata.delivery : {}),
                charge_quantity: chargeQuantity
            }
        }
    };
}

async function completeTaskFromExistingResults(supabase, task = {}, results = [], {
    resultPrompt = '',
    errorCode = ''
} = {}) {
    const sortedResults = sortTaskResults(results);
    const currentStatus = normalizeTaskStatus(task.status);
    const recoverableStatus = currentStatus === 'running'
        || (currentStatus === 'failed' && normalizeText(task.error_code, 160).startsWith('ai_image_'));
    if (!task?.id || !recoverableStatus || !sortedResults.length) {
        return null;
    }

    const completedAt = new Date().toISOString();
    const chargeStart = nowMs();
    const chargeTask = buildChargeTaskForDeliveredResults(task, sortedResults.length);
    const charge = await chargeTaskIfNeeded(supabase, chargeTask);
    const chargeMs = elapsedMs(chargeStart);
    const metadata = safeObject(task.metadata);
    const nextMetadata = {
        ...metadata,
        ...(isAiWorkbenchBillingV2Task(task) ? {
            billing_v2: {
                ...getAiWorkbenchBillingV2Metadata(task),
                status: charge.authorizationPending ? 'settlement_pending' : 'settled',
                settled_points: charge.chargedPoints,
                settled_at: charge.authorizationPending ? '' : completedAt
            }
        } : {}),
        recovery: {
            ...(safeObject(metadata.recovery)),
            recovered_from_results: true,
            recovered_at: completedAt,
            previous_status: currentStatus,
            result_count: sortedResults.length,
            error_code: normalizeText(errorCode, 120)
        },
        pricing_charge: charge.pricing || {},
        delivery: {
            ...(safeObject(metadata.delivery)),
            requested_image_count: getExpectedImageCount(task),
            delivered_image_count: sortedResults.length,
            partial: Boolean(getExpectedImageCount(task) && sortedResults.length < getExpectedImageCount(task)),
            charge_quantity: getTaskChargeQuantity(task, sortedResults.length)
        },
        timing: {
            ...(safeObject(metadata.timing)),
            recovery_charge_ms: chargeMs
        }
    };
    const updatedTask = await updateTask(supabase, task.id, {
        status: 'succeeded',
        result_prompt: normalizeText(resultPrompt || task.result_prompt || sortedResults[0]?.revised_prompt || sortedResults[0]?.prompt || task.prompt, 8000),
        charged_points: charge.chargedPoints,
        points_ledger_reference_id: charge.referenceId,
        error_code: '',
        error_message: '',
        metadata: nextMetadata,
        completed_at: task.completed_at || completedAt
    });

    logWorkerTiming('ai_image_task_recovered_from_results', {
        taskId: task.id,
        mode: task.mode,
        model: task.model,
        resolution: task.resolution,
        resultCount: sortedResults.length,
        chargeMs,
        chargedPoints: charge.chargedPoints,
        errorCode: normalizeText(errorCode, 120)
    });

    return {
        task: updatedTask,
        results: sortedResults,
        chargedPoints: charge.chargedPoints,
        recovered: true
    };
}

async function recordApiUsage(supabase, task = {}, execution = {}) {
    if (task.billing_mode !== 'api') return null;
    const usage = execution.tokenUsage || {};
    const totalTokens = normalizePositiveInt(usage.total_tokens || usage.totalTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const inputTokens = normalizePositiveInt(usage.input_tokens || usage.inputTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const outputTokens = normalizePositiveInt(usage.output_tokens || usage.outputTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });

    const { data, error } = await supabase
        .from('ai_image_api_usage')
        .insert({
            task_id: task.id,
            site: task.site || 'cn',
            user_id: task.user_id,
            api_base_url: task.api_base_url || '',
            api_key_tail: task.api_key_tail || '',
            model: task.model || '',
            model_group: task.api_model_group || '',
            request_type: task.mode || 'chat',
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: totalTokens,
            image_count: Array.isArray(execution.images) ? execution.images.length : 0,
            resolution: task.resolution || null,
            raw_usage: usage
        })
        .select('id, task_id, total_tokens, created_at')
        .single();
    if (error) throw error;
    return data || null;
}

async function completeTask(supabase, task = {}, execution = {}) {
    const completeStart = nowMs();
    const latestTask = await loadTaskById(supabase, task.id);
    const latestStatus = normalizeTaskStatus(latestTask?.status);
    if (latestStatus === 'cancelled') {
        return {
            task: latestTask,
            results: [],
            chargedPoints: 0,
            cancelled: true
        };
    }
    if (latestStatus !== 'running') {
        return {
            task: latestTask,
            results: [],
            chargedPoints: 0,
            skipped: true
        };
    }

    const completedAt = new Date().toISOString();
    const createdAtMs = Date.parse(task.created_at || task.createdAt || completedAt);
    const startedAtMs = Date.parse(task.started_at || task.startedAt || completedAt);
    const queueMs = Number.isFinite(createdAtMs) && Number.isFinite(startedAtMs)
        ? Math.max(0, startedAtMs - createdAtMs)
        : 0;
    const runMs = Number.isFinite(startedAtMs) && Number.isFinite(Date.parse(completedAt))
        ? Math.max(0, Date.parse(completedAt) - startedAtMs)
        : 0;
    const insertStart = nowMs();
    const results = await insertTaskResultsIfMissing(supabase, task, execution.images || []);
    const insertResultsMs = elapsedMs(insertStart);
    const chargeStart = nowMs();
    const deliveredImageCount = getDeliveredImageCount(results);
    const chargeTask = buildChargeTaskForDeliveredResults(task, deliveredImageCount);
    const charge = await chargeTaskIfNeeded(supabase, chargeTask, execution);
    const chargeMs = elapsedMs(chargeStart);
    const usageStart = nowMs();
    await recordApiUsage(supabase, task, {
        ...execution,
        images: results
    });
    const usageMs = elapsedMs(usageStart);

    const usage = execution.tokenUsage || {};
    const inputTokens = normalizePositiveInt(usage.input_tokens || usage.inputTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const outputTokens = normalizePositiveInt(usage.output_tokens || usage.outputTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const totalTokens = normalizePositiveInt(usage.total_tokens || usage.totalTokens, inputTokens + outputTokens, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const updateStart = nowMs();
    const executionMetadata = safeObject(execution.metadata);
    const baseMetadata = {
        ...(task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata) ? task.metadata : {}),
        ...executionMetadata
    };
    const baseTiming = safeObject(baseMetadata.timing);
    const markRunningMs = normalizeTimingMs(executionMetadata.mark_running_ms || baseTiming.mark_running_ms);
    const executorMs = normalizeTimingMs(executionMetadata.executor_ms || baseTiming.executor_ms);
    const preflightMs = normalizeTimingMs(executionMetadata.preflight_ms || baseTiming.preflight_ms || baseMetadata.preflight_ms);
    const configResolveMs = normalizeTimingMs(executionMetadata.config_resolve_ms || baseTiming.config_resolve_ms || baseMetadata.config_resolve_ms);
    const referenceFetchMs = normalizeTimingMs(executionMetadata.reference_fetch_ms || baseTiming.reference_fetch_ms || baseMetadata.reference_fetch_ms);
    const upstreamMs = normalizeTimingMs(executionMetadata.upstream_ms || baseTiming.upstream_ms || baseMetadata.upstream_ms);
    const upstreamRequestMs = normalizeTimingMs(executionMetadata.upstream_request_ms || baseTiming.upstream_request_ms || baseMetadata.upstream_request_ms);
    const upstreamResponseMs = normalizeTimingMs(executionMetadata.upstream_response_ms || baseTiming.upstream_response_ms || baseMetadata.upstream_response_ms);
    const upstreamResponseTextMs = normalizeTimingMs(executionMetadata.upstream_response_text_ms || baseTiming.upstream_response_text_ms || baseMetadata.upstream_response_text_ms);
    const upstreamResponseParseMs = normalizeTimingMs(executionMetadata.upstream_response_parse_ms || baseTiming.upstream_response_parse_ms || baseMetadata.upstream_response_parse_ms);
    const upstreamResponseBodyMs = normalizeTimingMs(executionMetadata.upstream_response_body_ms || baseTiming.upstream_response_body_ms || baseMetadata.upstream_response_body_ms);
    const postprocessMs = normalizeTimingMs(executionMetadata.postprocess_ms || baseTiming.postprocess_ms || baseMetadata.postprocess_ms);
    const imageNormalizeMs = normalizeTimingMs(executionMetadata.image_normalize_ms || baseTiming.image_normalize_ms || baseMetadata.image_normalize_ms);
    const partialResultSaveMs = normalizeTimingMs(executionMetadata.partial_result_save_ms || baseTiming.partial_result_save_ms || baseMetadata.partial_result_save_ms);
    const previewBuildMs = normalizeTimingMs(executionMetadata.preview_build_ms || baseTiming.preview_build_ms || baseMetadata.preview_build_ms);
    const previewUploadMs = normalizeTimingMs(executionMetadata.preview_upload_ms || baseTiming.preview_upload_ms || baseMetadata.preview_upload_ms);
    const originalUploadMs = normalizeTimingMs(executionMetadata.original_upload_ms || baseTiming.original_upload_ms || baseMetadata.original_upload_ms);
    const deferredOriginalUploadMs = normalizeTimingMs(executionMetadata.deferred_original_upload_ms || baseTiming.deferred_original_upload_ms || baseMetadata.deferred_original_upload_ms);
    const executorAccountedMs = preflightMs + upstreamMs + postprocessMs;
    const nextMetadata = {
        ...baseMetadata,
        ...(isAiWorkbenchBillingV2Task(task) ? {
            billing_v2: {
                ...getAiWorkbenchBillingV2Metadata(task),
                status: charge.authorizationPending ? 'settlement_pending' : 'settled',
                settled_points: charge.chargedPoints,
                settled_at: charge.authorizationPending ? '' : completedAt
            }
        } : {}),
        delivery: {
            ...(baseMetadata.delivery && typeof baseMetadata.delivery === 'object' && !Array.isArray(baseMetadata.delivery) ? baseMetadata.delivery : {}),
            requested_image_count: getExpectedImageCount(task),
            delivered_image_count: deliveredImageCount,
            partial: Boolean(getExpectedImageCount(task) && deliveredImageCount < getExpectedImageCount(task)),
            charge_quantity: getTaskChargeQuantity(task, deliveredImageCount)
        },
        pricing_charge: charge.pricing || {},
        timing: {
            ...baseTiming,
            queue_ms: queueMs,
            mark_running_ms: markRunningMs,
            executor_ms: executorMs,
            executor_accounted_ms: executorAccountedMs,
            executor_unaccounted_ms: Math.max(0, executorMs - executorAccountedMs),
            preflight_ms: preflightMs,
            config_resolve_ms: configResolveMs,
            reference_fetch_ms: referenceFetchMs,
            insert_results_ms: insertResultsMs,
            charge_ms: chargeMs,
            usage_ms: usageMs,
            update_task_ms: 0,
            total_complete_ms: 0,
            total_run_ms: runMs,
            runtime_accounted_ms: executorMs,
            runtime_unaccounted_ms: Math.max(0, runMs - executorMs),
            upstream_ms: upstreamMs,
            upstream_request_ms: upstreamRequestMs,
            upstream_response_ms: upstreamResponseMs,
            upstream_response_body_ms: upstreamResponseBodyMs || upstreamResponseMs,
            upstream_response_text_ms: upstreamResponseTextMs,
            upstream_response_parse_ms: upstreamResponseParseMs,
            postprocess_ms: postprocessMs,
            image_normalize_ms: imageNormalizeMs,
            partial_result_save_ms: partialResultSaveMs,
            preview_build_ms: previewBuildMs,
            preview_upload_ms: previewUploadMs,
            original_upload_ms: originalUploadMs,
            deferred_original_upload_ms: deferredOriginalUploadMs
        }
    };
    const updatedTask = await updateTask(supabase, task.id, {
        status: 'succeeded',
        result_prompt: normalizeText(execution.resultPrompt, 8000),
        charged_points: charge.chargedPoints,
        points_ledger_reference_id: charge.referenceId,
        token_usage: usage,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        provider_task_id: normalizeText(execution.providerTaskId, 240),
        error_code: '',
        error_message: '',
        metadata: nextMetadata,
        completed_at: completedAt
    });
    const updateTaskMs = elapsedMs(updateStart);
    const totalCompleteMs = elapsedMs(completeStart);
    nextMetadata.timing.update_task_ms = updateTaskMs;
    nextMetadata.timing.total_complete_ms = totalCompleteMs;
    nextMetadata.timing.total_run_ms = runMs;
    nextMetadata.timing.runtime_accounted_ms = executorMs + totalCompleteMs;
    nextMetadata.timing.runtime_unaccounted_ms = Math.max(0, runMs - executorMs - totalCompleteMs);

    try {
        await updateTask(supabase, task.id, {
            metadata: nextMetadata
        });
    } catch (error) {
        logWorkerTiming('ai_image_task_complete_metadata_update_failed', {
            taskId: task.id,
            code: normalizeText(error?.code || 'metadata_update_failed', 120),
            message: normalizeText(error?.message || error, 500)
        });
    }

    logWorkerTiming('ai_image_task_complete_timing', {
        taskId: task.id,
        status: updatedTask.status,
        mode: task.mode,
        model: task.model,
        resolution: task.resolution,
        resultCount: results.length,
        originalDeferredCount: Array.isArray(execution.deferredOriginalUploads) ? execution.deferredOriginalUploads.length : 0,
        markRunningMs,
        executorMs,
        executorUnaccountedMs: nextMetadata.timing.executor_unaccounted_ms,
        runtimeUnaccountedMs: nextMetadata.timing.runtime_unaccounted_ms,
        insertResultsMs,
        chargeMs,
        usageMs,
        updateTaskMs,
        totalCompleteMs,
        preflightMs,
        configResolveMs,
        referenceFetchMs,
        upstreamMs,
        upstreamRequestMs,
        upstreamResponseMs,
        upstreamResponseBodyMs: upstreamResponseBodyMs || upstreamResponseMs,
        upstreamResponseTextMs,
        upstreamResponseParseMs,
        postprocessMs,
        imageNormalizeMs,
        partialResultSaveMs,
        previewBuildMs,
        previewUploadMs,
        originalUploadMs,
        deferredOriginalUploadMs
    });
    runDeferredOriginalUploads(supabase, task, execution, results);

    return {
        task: {
            ...updatedTask,
            metadata: nextMetadata
        },
        results,
        chargedPoints: charge.chargedPoints
    };
}

async function failTask(supabase, task = {}, error = {}) {
    const message = normalizeText(error?.message || 'AI image task failed', 1000);
    const code = normalizeText(error?.code || 'ai_image_execution_failed', 120);
    const completedAt = new Date().toISOString();
    const startedAtMs = Date.parse(task.started_at || task.startedAt || task.created_at || completedAt);
    const runMs = Number.isFinite(startedAtMs) && Number.isFinite(Date.parse(completedAt))
        ? Math.max(0, Date.parse(completedAt) - startedAtMs)
        : 0;
    const baseMetadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : {};
    const errorMetadata = safeObject(error?.metadata);
    const errorTiming = safeObject(errorMetadata.timing);
    const baseTiming = safeObject(baseMetadata.timing);
    const executorMs = normalizeTimingMs(errorMetadata.executor_ms || errorTiming.executor_ms || baseTiming.executor_ms);
    const release = await releaseTaskAuthorizationIfNeeded(
        supabase,
        task,
        `AI 工作台任务失败释放：${code}`
    );
    if (release?.status === 'settled' && normalizeBillablePoints(release.deducted, 0) > 0) {
        const settlementError = new Error('任务积分已结算，等待任务状态收口');
        settlementError.code = 'ai_billing_task_completion_pending';
        settlementError.statusCode = 503;
        settlementError.billing = release;
        throw settlementError;
    }
    const nextMetadata = {
        ...baseMetadata,
        ...errorMetadata,
        billing_v2: {
            ...getAiWorkbenchBillingV2Metadata(task),
            ...(release ? {
                release_status: release.status || '',
                released_points: normalizeBillablePoints(release.released, 0),
                released_at: completedAt
            } : {})
        },
        failure: {
            ...(safeObject(baseMetadata.failure)),
            failed_at: completedAt,
            error_code: code,
            error_message: message
        },
        timing: {
            ...baseTiming,
            ...errorTiming,
            executor_ms: executorMs,
            total_run_ms: runMs,
            runtime_accounted_ms: executorMs,
            runtime_unaccounted_ms: Math.max(0, runMs - executorMs)
        }
    };
    const updatedTask = await updateTask(supabase, task.id, {
        status: 'failed',
        error_code: code,
        error_message: message,
        metadata: nextMetadata,
        completed_at: completedAt
    });
    return {
        task: {
            ...updatedTask,
            metadata: nextMetadata
        },
        error: {
            code,
            message
        }
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTaskTimeoutError(task = {}, timeoutMs = DEFAULT_TASK_TIMEOUT_MS, executorMs = 0) {
    const video = isVideoTask(task);
    const providerTaskId = getTaskProviderTaskId(task);
    const duration = formatTimeoutDuration(timeoutMs);
    const label = video ? 'AI 视频任务' : 'AI 图片任务';
    const message = video
        ? (providerTaskId
            ? `${label}等待上游结果超时（${duration}），上游任务已受理，可能已产生扣费；请稍后刷新生成记录，系统会按上游明细同步扣费。`
            : `${label}处理超时（${duration}），未确认上游生成结果，请稍后重试或查看上游明细。`)
        : `${label}处理超时（${duration}），已自动停止且未扣费。请重新提交生成。`;
    const error = new Error(message);
    error.statusCode = 504;
    error.code = video
        ? (providerTaskId ? 'ai_video_task_timeout_after_provider_accept' : 'ai_video_task_timeout')
        : 'ai_image_task_timeout';
    error.metadata = {
        timeout_ms: timeoutMs,
        timeout_stage: 'task',
        media_type: video ? 'video' : 'image',
        provider_task_id: providerTaskId,
        charge_may_have_occurred: Boolean(video && providerTaskId),
        provider_model: normalizeText(task.model, 160),
        executor_ms: normalizeTimingMs(executorMs),
        timing: {
            task_timeout_ms: timeoutMs,
            executor_ms: normalizeTimingMs(executorMs)
        }
    };
    return error;
}

async function runTaskOperationWithTimeout(operation, {
    task = {},
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    getExecutorMs = () => 0
} = {}) {
    const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs, DEFAULT_TASK_TIMEOUT_MS, {
        min: 10,
        max: MAX_TASK_TIMEOUT_MS
    });
    const controller = typeof AbortController === 'function'
        ? new AbortController()
        : null;
    let timer = null;
    let timeoutFired = false;
    const taskSignal = controller?.signal || null;
    const taskOperation = Promise.resolve()
        .then(() => operation({ signal: taskSignal }));
    taskOperation.catch(() => {});

    try {
        return await Promise.race([
            taskOperation,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    timeoutFired = true;
                    if (controller) controller.abort();
                    reject(buildTaskTimeoutError(task, normalizedTimeoutMs, getExecutorMs()));
                }, normalizedTimeoutMs);
            })
        ]);
    } catch (error) {
        if (timeoutFired) {
            throw error;
        }
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function failTaskWithRetry(supabase, task = {}, error = {}, {
    attempts = 2,
    baseDelayMs = 700
} = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await failTask(supabase, task, error);
        } catch (nextError) {
            lastError = nextError;
            if (attempt >= attempts) break;
            await sleep(baseDelayMs * attempt);
        }
    }
    throw lastError || error;
}

async function recoverTaskFromExistingResults(supabase, task = {}, {
    results = null,
    errorCode = '',
    failOnRecoveryError = false
} = {}) {
    const existingResults = Array.isArray(results) ? results : await loadTaskResults(supabase, task);
    const currentStatus = normalizeTaskStatus(task.status);
    const recoverableStatus = currentStatus === 'running'
        || (currentStatus === 'failed' && normalizeText(task.error_code, 160).startsWith('ai_image_'));
    if (!existingResults.length || !recoverableStatus) {
        return null;
    }

    try {
        return await completeTaskFromExistingResults(supabase, task, existingResults, { errorCode });
    } catch (error) {
        logWorkerTiming('ai_image_task_recovery_failed', {
            taskId: task.id,
            code: normalizeText(error?.code || 'ai_image_result_recovery_failed', 120),
            message: normalizeText(error?.message || error, 500),
            resultCount: existingResults.length
        });

        if (!failOnRecoveryError) {
            throw error;
        }

        return failTaskWithRetry(supabase, task, {
            code: 'ai_image_result_recovery_failed',
            message: '生成结果已返回，但任务扣费或状态收口失败，已停止本次任务。'
        });
    }
}

async function failStaleRunningTasks(supabase, {
    site = '',
    limit = 5,
    staleAfterMs = 3 * 60 * 1000,
    videoStaleAfterMs = DEFAULT_VIDEO_TASK_TIMEOUT_MS + VIDEO_STALE_RUNNING_GRACE_MS
} = {}) {
    const staleTasks = await loadStaleRunningTasks(supabase, { site, limit, staleAfterMs });
    const results = [];
    for (const task of staleTasks) {
        if (!isRunningTaskStale(task, { staleAfterMs, videoStaleAfterMs })) {
            continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const recovered = await recoverTaskFromExistingResults(supabase, task, {
            errorCode: 'ai_image_worker_stale_running',
            failOnRecoveryError: true
        });
        if (recovered) {
            results.push(recovered);
            continue;
        }

        await releaseTaskAuthorizationIfNeeded(
            supabase,
            task,
            'AI 工作台超时任务释放预授权'
        );

        const { data, error } = await supabase
            .from('ai_image_tasks')
            .update({
                status: 'failed',
                error_code: 'ai_image_worker_stale_running',
                error_message: 'AI 图片任务长时间未完成，已自动停止。请重新提交生成。',
                completed_at: new Date().toISOString()
            })
            .eq('id', task.id)
            .eq('status', 'running')
            .select(TASK_SELECT)
            .maybeSingle();
        if (error) throw error;
        if (data) {
            results.push({
                task: data,
                error: {
                    code: 'ai_image_worker_stale_running',
                    message: 'AI 图片任务长时间未完成，已自动停止。请重新提交生成。'
                },
                stale: true
            });
        }
    }
    return results;
}

async function executeAiImageTask({
    supabase,
    task,
    executor = buildPlaceholderExecutionResult,
    taskTimeoutMs = normalizeTimeoutMs(process.env.AI_IMAGE_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS, {
        min: 10,
        max: MAX_TASK_TIMEOUT_MS
    }),
    videoTaskTimeoutMs = normalizeTimeoutMs(
        process.env.AI_IMAGE_VIDEO_TASK_TIMEOUT_MS || process.env.AI_VIDEO_TASK_TIMEOUT_MS,
        DEFAULT_VIDEO_TASK_TIMEOUT_MS,
        {
            min: 10,
            max: MAX_TASK_TIMEOUT_MS
        }
    )
} = {}) {
    if (!supabase?.from) {
        const error = new Error('Supabase client is required');
        error.statusCode = 503;
        throw error;
    }

    const loadedTask = typeof task === 'string'
        ? await loadTaskById(supabase, task)
        : task;
    if (!loadedTask?.id) {
        const error = new Error('AI image task not found');
        error.statusCode = 404;
        error.code = 'task_not_found';
        throw error;
    }

    let runningTask = null;
    let executorStart = 0;
    let diagnosticLogger = null;
    try {
        const taskStart = nowMs();
        runningTask = await markTaskRunning(supabase, loadedTask);
        diagnosticLogger = buildExecutorDiagnosticLogger(runningTask);
        const markRunningMs = elapsedMs(taskStart);
        executorStart = nowMs();
        const effectiveTaskTimeoutMs = resolveTaskTimeoutMs(runningTask, {
            taskTimeoutMs,
            videoTaskTimeoutMs
        });
        const execution = await runTaskOperationWithTimeout(({ signal } = {}) => executor(runningTask, {
            supabase,
            signal,
            onDiagnostic: diagnosticLogger,
            onImageResult: async (image = {}, detail = {}) => {
                const resultIndex = Number.isFinite(Number(detail.index))
                    ? Number(detail.index)
                    : getResultIndex(image, 0);
                try {
                    const result = await insertTaskResultIfMissing(supabase, runningTask, image, resultIndex);
                    if (result?.id) {
                        logWorkerTiming('ai_image_task_partial_result_saved', {
                            taskId: runningTask.id,
                            resultId: result.id,
                            resultIndex: Number(result.result_index || resultIndex),
                            requestedCount: Number(detail.requestedCount || 0) || 0
                        });
                    }
                    return result;
                } catch (partialError) {
                    logWorkerTiming('ai_image_task_partial_result_save_failed', {
                        taskId: runningTask.id,
                        resultIndex,
                        code: normalizeText(partialError?.code || 'partial_result_save_failed', 120),
                        message: normalizeText(partialError?.message || partialError, 500)
                    });
                    return null;
                }
            }
        }), {
            task: runningTask,
            timeoutMs: effectiveTaskTimeoutMs,
            getExecutorMs: () => elapsedMs(executorStart)
        });
        const executorMs = elapsedMs(executorStart);
        if (execution && typeof execution === 'object') {
            execution.metadata = {
                ...safeObject(execution.metadata),
                mark_running_ms: markRunningMs,
                executor_ms: executorMs
            };
        }
        logWorkerTiming('ai_image_task_executor_timing', {
            taskId: runningTask.id,
            mode: runningTask.mode,
            model: runningTask.model,
            resolution: runningTask.resolution,
            markRunningMs,
            executorMs,
            upstreamMs: Number(execution?.metadata?.upstream_ms || 0) || 0,
            postprocessMs: Number(execution?.metadata?.postprocess_ms || 0) || 0,
            resultCount: Array.isArray(execution?.images) ? execution.images.length : 0
        });
        const completion = await completeTask(supabase, runningTask, execution);
        const completionTiming = safeObject(completion?.task?.metadata?.timing);
        const totalRunMs = Number.isFinite(Date.parse(completion?.task?.completed_at))
            ? Math.max(0, Date.parse(completion.task.completed_at) - Date.parse(runningTask.started_at || runningTask.created_at || completion.task.completed_at))
            : 0;
        if (completionTiming && totalRunMs) {
            completionTiming.mark_running_ms = normalizeTimingMs(completionTiming.mark_running_ms || markRunningMs);
            completionTiming.executor_ms = normalizeTimingMs(completionTiming.executor_ms || executorMs);
            completionTiming.total_run_ms = totalRunMs;
            completionTiming.runtime_accounted_ms = normalizeTimingMs(completionTiming.executor_ms + normalizeTimingMs(completionTiming.total_complete_ms));
            completionTiming.runtime_unaccounted_ms = Math.max(0, totalRunMs - completionTiming.runtime_accounted_ms);
        }
        return completion;
    } catch (error) {
        if (runningTask?.id) {
            const executorMs = executorStart ? elapsedMs(executorStart) : 0;
            error.metadata = {
                ...safeObject(error?.metadata),
                mark_running_ms: normalizeTimingMs(error?.metadata?.mark_running_ms),
                executor_ms: executorMs,
                executor_diagnostics: diagnosticLogger?.getSummary?.() || [],
                executor_last_event: diagnosticLogger?.getLast?.()?.event || '',
                timing: {
                    ...safeObject(error?.metadata?.timing),
                    executor_ms: executorMs
                }
            };
            try {
                const recovered = await recoverTaskFromExistingResults(supabase, runningTask, {
                    errorCode: error?.code || 'ai_image_execution_interrupted_after_result',
                    failOnRecoveryError: true
                });
                if (recovered) return recovered;
            } catch (recoveryError) {
                logWorkerTiming('ai_image_task_execute_recovery_failed', {
                    taskId: runningTask.id,
                    code: normalizeText(recoveryError?.code || 'ai_image_execute_recovery_failed', 120),
                    message: normalizeText(recoveryError?.message || recoveryError, 500)
                });
            }
            if (isAiWorkbenchBillingError(error)) {
                throw error;
            }
            return failTaskWithRetry(supabase, runningTask, error);
        }
        throw error;
    }
}

async function runTasksWithConcurrency(tasks = [], concurrency = 1, handler = null) {
    const taskItems = Array.isArray(tasks) ? tasks : [];
    if (!taskItems.length || typeof handler !== 'function') return [];

    const workerCount = Math.min(
        taskItems.length,
        normalizePositiveInt(concurrency, 1, { min: 1, max: 20 })
    );
    const results = new Array(taskItems.length);
    let nextIndex = 0;

    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < taskItems.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await handler(taskItems[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
}

async function runAiImageTaskBatch({
    supabase,
    taskId = '',
    site = '',
    limit = 5,
    concurrency = 1,
    executor = buildPlaceholderExecutionResult,
    staleRunningTimeoutMs = normalizeTimeoutMs(process.env.AI_IMAGE_STALE_RUNNING_TIMEOUT_MS, 3 * 60 * 1000),
    taskTimeoutMs = normalizeTimeoutMs(process.env.AI_IMAGE_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS, {
        min: 10,
        max: MAX_TASK_TIMEOUT_MS
    }),
    videoTaskTimeoutMs = normalizeTimeoutMs(
        process.env.AI_IMAGE_VIDEO_TASK_TIMEOUT_MS || process.env.AI_VIDEO_TASK_TIMEOUT_MS,
        DEFAULT_VIDEO_TASK_TIMEOUT_MS,
        {
            min: 10,
            max: MAX_TASK_TIMEOUT_MS
        }
    ),
    videoStaleRunningTimeoutMs = resolveVideoStaleRunningTimeoutMs(
        staleRunningTimeoutMs,
        videoTaskTimeoutMs,
        process.env.AI_IMAGE_VIDEO_STALE_RUNNING_TIMEOUT_MS || process.env.AI_VIDEO_STALE_RUNNING_TIMEOUT_MS
    )
} = {}) {
    const staleResults = taskId
        ? []
        : await failStaleRunningTasks(supabase, {
            site,
            limit,
            staleAfterMs: staleRunningTimeoutMs,
            videoStaleAfterMs: videoStaleRunningTimeoutMs
        });
    const tasks = taskId
        ? [await loadTaskById(supabase, taskId)].filter(Boolean)
        : await loadQueuedTasks(supabase, { site, limit });
    const results = staleResults.slice();

    const taskResults = await runTasksWithConcurrency(tasks, concurrency, async (task) => {
        try {
            return await executeAiImageTask({
                supabase,
                task,
                executor,
                taskTimeoutMs,
                videoTaskTimeoutMs
            });
        } catch (error) {
            return {
                task,
                error: {
                    code: normalizeText(error?.code || 'ai_image_worker_task_failed', 120),
                    message: normalizeText(error?.message || 'AI image worker task failed', 1000)
                },
                skipped: true
            };
        }
    });
    results.push(...taskResults);

    return {
        processed: results.length,
        results
    };
}

module.exports = {
    TASK_SELECT,
    RESULT_SELECT,
    buildPlaceholderExecutionResult,
    completeTask,
    executeAiImageTask,
    failStaleRunningTasks,
    getAiWorkbenchLedgerReason,
    recoverTaskFromExistingResults,
    runAiImageTaskBatch
};
