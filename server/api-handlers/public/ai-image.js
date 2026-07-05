const crypto = require('node:crypto');
const {
    completeTask,
    executeAiImageTask,
    recoverTaskFromExistingResults
} = require('../_ai-image-runtime');
const {
    createOpenAiCompatibleApiExecutor,
    createOpenAiCompatibleImageExecutor,
    resolveExecutorRuntimeConfig,
    uploadGeneratedImageBufferToR2
} = require('../_ai-image-models');
const {
    decryptSecretValue,
    encryptSecretValue,
    listStoredAiImageProviderSecrets,
    isSecretDecryptAuthenticationError
} = require('../../../api/_lib/secrets');
const {
    deductPointsForService
} = require('../../../api/_lib/payments/rpc');
const {
    loadAiImageGuardrailsFromSystemConfig
} = require('../_ai-image-guardrails');
const {
    estimateAiImageRulePoints,
    calculateAiImageRuleChargePoints,
    getAiImagePricingProviderId,
    getAiImagePricingStrategy,
    normalizeProviderId,
    normalizeAiImagePricingMetadata
} = require('../_ai-image-pricing');
const {
    discoverGeminiNativeModels,
    discoverOpenAiCompatibleModels,
    isGeminiNativeBaseUrl
} = require('../admin/ai-image/model-config');

const DEFAULT_ALLOWED_API_BASE_URLS = Object.freeze([
    'https://sub2api.fatherkey.com/v1',
    'https://sub2api.zaoyoe.xyz/v1'
]);
const SUPPORTED_MODES = Object.freeze(new Set(['text', 'image', 'video', 'reverse', 'chat', 'agent']));
const IMAGE_MODES = Object.freeze(new Set(['text', 'image', 'agent']));
const VIDEO_MODES = Object.freeze(new Set(['video']));
const TEXT_VISION_MODES = Object.freeze(new Set(['reverse', 'chat']));
const PRICING_MODE_ALIASES = Object.freeze({
    image: 'text',
    agent: 'text',
    reverse: 'chat'
});
const SUPPORTED_BILLING_MODES = Object.freeze(new Set(['points', 'api']));
const SUPPORTED_RESOLUTIONS = Object.freeze(new Set(['1k', '2k', '4k']));
const SUPPORTED_VIDEO_RESOLUTIONS = Object.freeze(new Set(['480p', '720p', '1080p', '4k']));
const MAX_REFERENCE_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_INPUTS = 16;
const MAX_CHAT_ATTACHMENT_COUNT = 8;
const MAX_CHAT_ATTACHMENT_TEXT_CHARS = 50000;
const MAX_CHAT_ATTACHMENT_TOTAL_CHARS = 120000;
const SUPPORTED_REFERENCE_IMAGE_MIME_TYPES = Object.freeze(new Set([
    'image/jpeg',
    'image/png',
    'image/webp'
]));
const SUPPORTED_RATIOS = Object.freeze(new Set([
    '1:1',
    '2:3',
    '3:2',
    '3:4',
    '4:3',
    '9:16',
    '16:9',
    '21:9'
]));
const SUPPORTED_VIDEO_RATIOS = Object.freeze(new Set([
    'adaptive',
    '1:1',
    '3:4',
    '4:3',
    '9:16',
    '16:9',
    '21:9'
]));
const DEFAULT_RATE_LIMIT_HEADERS = Object.freeze({
    limit: 0,
    remaining: 0,
    resetAt: Date.now(),
    retryAfterSeconds: 1,
    allowed: true
});
const DEFAULT_QUEUE_ESTIMATE_SECONDS = 90;
const DEFAULT_QUEUE_WORKER_CONCURRENCY = 4;
const DEFAULT_MODEL_DISCOVERY_TIMEOUT_MS = 15000;
const CHAT_MEMORY_MODE_LIMITS = Object.freeze({
    fast: { messages: 4, tokens: 4000 },
    recent: { messages: 16, tokens: 16000 },
    model: { messages: 80, tokens: 48000 }
});
const CHAT_REASONING_EFFORTS = Object.freeze(new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']));
const CHAT_SERVICE_TIERS = Object.freeze(new Set(['priority', 'flex', 'auto', 'default', 'scale']));
const CHAT_THINKING_MODES = Object.freeze(new Set(['enabled', 'disabled', 'unset']));
const CHAT_IMAGE_INPUT_MODES = Object.freeze(new Set(['auto', 'on', 'off']));
const GEMINI_THINKING_LEVELS = Object.freeze(new Set(['minimal', 'low', 'medium', 'high']));
const GEMINI_THINKING_LEVEL_CAPABLE_PATTERN = /(?:^|[-_/])gemini[-_/]?(?:2\.5|2-5|2_5|3|3\.|3-|3_)/i;
const CLAUDE_THINKING_BUDGETS = Object.freeze(new Set(['1024', '4096', '16000']));

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

const TASK_PREF_SELECT = [
    'id',
    'site',
    'user_id',
    'task_id',
    'hidden_at',
    'pinned_at',
    'accent',
    'metadata',
    'created_at',
    'updated_at'
].join(', ');

const API_BASE_URL_SELECT = [
    'id',
    'site',
    'label',
    'base_url',
    'is_active',
    'display_order',
    'metadata',
    'created_at',
    'updated_at'
].join(', ');

const USER_API_KEY_SELECT = [
    'id',
    'site',
    'user_id',
    'api_base_url',
    'api_key_tail',
    'api_key_fingerprint',
    'encrypted_api_key',
    'metadata',
    'created_at',
    'updated_at'
].join(', ');

const USER_API_KEY_STATUS_SELECT = [
    'id',
    'site',
    'user_id',
    'api_base_url',
    'api_key_tail',
    'api_key_fingerprint',
    'metadata',
    'created_at',
    'updated_at'
].join(', ');

const TASK_PREF_ACCENTS = Object.freeze(new Set(['blue', 'green', 'gold', 'rose']));

function normalizeText(value, maxLength = 2000) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizeSite(value = 'cn') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'intl' || normalized === 'en' ? 'intl' : 'cn';
}

function normalizeApiBaseUrlSite(value = 'all') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'intl' || normalized === 'en') return 'intl';
    if (normalized === 'cn') return 'cn';
    return 'all';
}

function normalizePositiveInt(value, fallback = 1, { min = 1, max = 8 } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeInteger(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 100) / 100);
}

function normalizeBillablePoints(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 1000000) / 1000000);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 0) {
    const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
    if (!normalizedTimeoutMs) {
        return fetchImpl(url, options);
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId = null;
    const request = Promise.resolve().then(() => fetchImpl(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {})
    }));
    request.catch(() => {});

    try {
        return await Promise.race([
            request,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    if (controller) controller.abort();
                    const error = new Error('Sub2API usage lookup timeout');
                    error.code = 'sub2api_usage_lookup_timeout';
                    reject(error);
                }, normalizedTimeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function getResponseHeader(response, name = '') {
    const normalizedName = String(name || '').toLowerCase();
    const headers = response?.headers;
    if (!headers || !normalizedName) return '';
    if (typeof headers.get === 'function') {
        return normalizeText(headers.get(name) || headers.get(normalizedName), 1000);
    }
    if (typeof headers === 'object') {
        return normalizeText(headers[name] || headers[normalizedName], 1000);
    }
    return '';
}

function isSub2ApiGatewayBaseUrl(value = '') {
    try {
        const host = new URL(normalizeApiBaseUrl(value)).hostname.toLowerCase();
        return host.includes('sub2api') || host === 'localhost' || host === '127.0.0.1';
    } catch (_) {
        return false;
    }
}

function normalizeSub2ApiCost(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 1000000) / 1000000);
}

function buildSub2ApiClientRequestId(task = {}) {
    const taskId = normalizeText(task.id, 120).replace(/[^a-z0-9._:-]/gi, '').slice(0, 96);
    return taskId ? `fatherkey-aiw-${taskId}` : '';
}

function getSub2ApiUsageRequestIds(response = null, payload = {}) {
    const responseClientRequestId = getResponseHeader(response, 'x-client-request-id');
    const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};
    const pricingCharge = payload?.pricing_charge && typeof payload.pricing_charge === 'object' && !Array.isArray(payload.pricing_charge)
        ? payload.pricing_charge
        : (payload?.pricingCharge && typeof payload.pricingCharge === 'object' && !Array.isArray(payload.pricingCharge) ? payload.pricingCharge : {});
    const sub2api = payload?.sub2api && typeof payload.sub2api === 'object' && !Array.isArray(payload.sub2api)
        ? payload.sub2api
        : {};
    const clientRequestId = normalizeText(
        payload?.client_request_id
        || payload?.clientRequestId
        || payload?.sub2api_client_request_id
        || payload?.sub2apiClientRequestId
        || metadata.sub2api_client_request_id
        || metadata.sub2apiClientRequestId
        || pricingCharge.client_request_id
        || pricingCharge.clientRequestId
        || sub2api.client_request_id
        || sub2api.clientRequestId
        || responseClientRequestId,
        160
    );
    const upstreamRequestId = getResponseHeader(response, 'x-request-id') || getResponseHeader(response, 'request-id');
    return {
        clientRequestId,
        upstreamRequestId,
        requestIds: [...new Set([
            clientRequestId ? `client:${clientRequestId}` : '',
            clientRequestId,
            responseClientRequestId ? `client:${responseClientRequestId}` : '',
            responseClientRequestId,
            upstreamRequestId,
            payload?.id,
            payload?.request_id,
            payload?.requestId,
            payload?.lookup_request_id,
            payload?.lookupRequestId,
            pricingCharge.request_id,
            pricingCharge.requestId,
            pricingCharge.lookup_request_id,
            pricingCharge.lookupRequestId,
            sub2api.request_id,
            sub2api.requestId,
            sub2api.lookup_request_id,
            sub2api.lookupRequestId
        ].map((item) => normalizeText(item, 240)).filter(Boolean))]
    };
}

function normalizeSub2ApiUsageLookupRecord(payload = {}, requestId = '') {
    const record = payload?.usage_record || payload?.usageRecord || payload?.record || payload?.data || payload;
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const recordRequestId = normalizeText(record.request_id || record.requestId, 260);
    const actualCost = normalizeSub2ApiCost(
        record.actual_cost
        ?? record.actualCost
        ?? record.total_actual_cost
        ?? record.totalActualCost
        ?? record.user_cost
        ?? record.userCost,
        0
    );
    const fallbackCost = normalizeSub2ApiCost(
        record.total_cost
        ?? record.totalCost
        ?? record.cost
        ?? record.fee
        ?? record.amount,
        0
    );
    const billableCost = actualCost > 0 ? actualCost : fallbackCost;
    if (billableCost <= 0) return null;
    return {
        request_id: recordRequestId || requestId,
        lookup_request_id: requestId,
        actual_cost: billableCost,
        actual_cost_source: actualCost > 0 ? 'actual_cost' : 'fallback_cost',
        total_cost: normalizeSub2ApiCost(record.total_cost ?? record.totalCost, 0),
        input_cost: normalizeSub2ApiCost(record.input_cost ?? record.inputCost, 0),
        output_cost: normalizeSub2ApiCost(record.output_cost ?? record.outputCost, 0),
        cache_creation_cost: normalizeSub2ApiCost(record.cache_creation_cost ?? record.cacheCreationCost, 0),
        cache_read_cost: normalizeSub2ApiCost(record.cache_read_cost ?? record.cacheReadCost, 0),
        image_output_cost: normalizeSub2ApiCost(record.image_output_cost ?? record.imageOutputCost, 0)
    };
}

async function readJsonPayloadFromResponse(response = null) {
    if (!response) return {};
    if (typeof response.json === 'function') {
        try {
            const payload = await response.json();
            return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        } catch (_) {
            // Fall through to text parsing for lightweight test doubles and non-standard fetch implementations.
        }
    }
    if (typeof response.text !== 'function') return {};
    const text = await response.text().catch(() => '');
    if (!text) return {};
    try {
        const payload = JSON.parse(text);
        return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    } catch (_) {
        return {};
    }
}

async function fetchSub2ApiUsageRecord({
    baseUrl = '',
    apiKey = '',
    response = null,
    payload = {},
    fetchImpl = globalThis.fetch,
    env = process.env,
    returnLookupResult = false
} = {}) {
    const finish = (record = null, status = 'not_found', extra = {}) => (
        returnLookupResult
            ? {
                record,
                status,
                ...extra
            }
            : record
    );
    if (!apiKey || !isSub2ApiGatewayBaseUrl(baseUrl) || typeof fetchImpl !== 'function') {
        return finish(null, 'unavailable');
    }
    const headerCost = normalizeSub2ApiCost(
        getResponseHeader(response, 'x-sub2api-actual-cost')
        || getResponseHeader(response, 'x-sub2api-cost')
        || getResponseHeader(response, 'x-actual-cost'),
        0
    );
    const hints = getSub2ApiUsageRequestIds(response, payload);
    if (headerCost > 0) {
        return finish({
            request_id: hints.requestIds[0] || '',
            actual_cost: headerCost
        }, 'found', { requestIds: hints.requestIds });
    }
    if (!hints.requestIds.length) return finish(null, 'no_request_id', { requestIds: [] });
    const attempts = readPositiveIntEnv(env, ['AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS'], 12, { min: 1, max: 20 });
    const intervalMs = readPositiveIntEnv(env, ['AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS'], 500, { min: 0, max: 3000 });
    const timeoutMs = readPositiveIntEnv(env, [
        'AI_IMAGE_SUB2API_USAGE_LOOKUP_TIMEOUT_MS',
        'AI_IMAGE_SUB2API_USAGE_FETCH_TIMEOUT_MS'
    ], 1200, { min: 50, max: 30000 });
    const root = normalizeApiBaseUrl(baseUrl).replace(/\/+$/, '');
    let sawLookupError = false;
    let sawLookupTimeout = false;
    let sawLookupUnavailable = false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        for (const requestId of hints.requestIds) {
            const usageLookupUrls = [
                `${root}/usage/requests/${encodeURIComponent(requestId)}`,
                `${root}/usage?request_id=${encodeURIComponent(requestId)}`
            ];
            for (const usageLookupUrl of usageLookupUrls) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const usageResponse = await fetchWithTimeout(fetchImpl, usageLookupUrl, {
                        method: 'GET',
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            Accept: 'application/json'
                        }
                    }, timeoutMs);
                    if (!usageResponse?.ok) {
                        if (Number(usageResponse?.status || 0) !== 404) {
                            sawLookupUnavailable = true;
                        }
                        continue;
                    }
                    // eslint-disable-next-line no-await-in-loop
                    const usagePayload = await readJsonPayloadFromResponse(usageResponse);
                    const record = normalizeSub2ApiUsageLookupRecord(usagePayload, requestId);
                    if (record) return finish(record, 'found', { requestIds: hints.requestIds });
                } catch (error) {
                    if (error?.code === 'sub2api_usage_lookup_timeout') {
                        sawLookupTimeout = true;
                    } else {
                        sawLookupError = true;
                    }
                    // 使用记录回查失败时保持旧 token usage 计费路径。
                }
            }
        }
        if (attempt < attempts - 1 && intervalMs > 0) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(intervalMs);
        }
    }
    if (sawLookupTimeout) return finish(null, 'timeout', { requestIds: hints.requestIds });
    if (sawLookupError || sawLookupUnavailable) return finish(null, 'unavailable', { requestIds: hints.requestIds });
    return finish(null, 'not_found', { requestIds: hints.requestIds });
}

function attachSub2ApiBillingToUsage(usage = {}, record = null, response = null, payload = {}) {
    const source = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {};
    const directCost = normalizeSub2ApiCost(
        source.actual_cost
        ?? source.actualCost
        ?? source.total_actual_cost
        ?? source.totalActualCost
        ?? source.user_cost
        ?? source.userCost
        ?? source.sub2api_actual_cost
        ?? source.sub2apiActualCost
        ?? source.sub2api?.actual_cost
        ?? source.sub2api?.actualCost
        ?? payload?.actual_cost
        ?? payload?.actualCost,
        0
    );
    const fallbackCost = normalizeSub2ApiCost(
        source.total_cost
        ?? source.totalCost
        ?? source.cost
        ?? source.fee
        ?? source.amount
        ?? source.sub2api?.total_cost
        ?? source.sub2api?.totalCost
        ?? payload?.total_cost
        ?? payload?.totalCost
        ?? payload?.cost,
        0
    );
    const hints = getSub2ApiUsageRequestIds(response, payload);
    const actualCost = record?.actual_cost || directCost || fallbackCost;
    if (actualCost <= 0 && !record) return source;
    return {
        ...source,
        actual_cost: actualCost,
        actualCost: actualCost,
        sub2api_actual_cost: actualCost,
        sub2apiActualCost: actualCost,
        sub2api: {
            ...(source.sub2api && typeof source.sub2api === 'object' ? source.sub2api : {}),
            actual_cost: actualCost,
            actualCost: actualCost,
            request_id: record?.request_id || hints.requestIds[0] || '',
            requestId: record?.request_id || hints.requestIds[0] || '',
            lookup_request_id: record?.lookup_request_id || hints.requestIds[0] || '',
            lookupRequestId: record?.lookup_request_id || hints.requestIds[0] || '',
            cost_source: record?.actual_cost_source || (directCost > 0 ? 'actual_cost' : 'fallback_cost'),
            costSource: record?.actual_cost_source || (directCost > 0 ? 'actual_cost' : 'fallback_cost'),
            client_request_id: hints.clientRequestId || '',
            clientRequestId: hints.clientRequestId || '',
            upstream_request_id: hints.upstreamRequestId || '',
            upstreamRequestId: hints.upstreamRequestId || ''
        }
    };
}

function normalizeOptionalQueueNumber(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
}

function readPositiveIntEnv(env = {}, names = [], fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    for (const name of names) {
        const parsed = Number.parseInt(String(env?.[name] || '').trim(), 10);
        if (Number.isFinite(parsed)) {
            return Math.min(max, Math.max(min, parsed));
        }
    }
    return Math.min(max, Math.max(min, fallback));
}

function normalizeResolution(value, fallback = '1k') {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_RESOLUTIONS.has(normalized) ? normalized : fallback;
}

function normalizeVideoResolution(value, fallback = '720p') {
    const normalized = String(value || '').trim().toLowerCase();
    if (SUPPORTED_VIDEO_RESOLUTIONS.has(normalized)) return normalized;
    const withSuffix = /^\d+$/.test(normalized) ? `${normalized}p` : normalized;
    return SUPPORTED_VIDEO_RESOLUTIONS.has(withSuffix) ? withSuffix : fallback;
}

function normalizeRatio(value, fallback = '1:1') {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_RATIOS.has(normalized) ? normalized : fallback;
}

function normalizeVideoRatio(value, fallback = 'adaptive') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'auto') return 'adaptive';
    return SUPPORTED_VIDEO_RATIOS.has(normalized) ? normalized : fallback;
}

function normalizeVideoDuration(value, fallback = 5) {
    const raw = String(value ?? '').trim();
    if (raw === '-1') return -1;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(15, Math.max(4, parsed));
}

function normalizeBooleanOption(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function getVideoSettingsInput(body = {}) {
    const settings = body.videoSettings || body.video_settings;
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

function normalizeVideoSettings(body = {}) {
    const settings = getVideoSettingsInput(body);
    const ratio = normalizeVideoRatio(
        settings.ratio
        || settings.aspectRatio
        || settings.aspect_ratio
        || body.videoRatio
        || body.video_ratio
        || body.ratio
        || body.aspectRatio
        || body.aspect_ratio,
        'adaptive'
    );
    const resolution = normalizeVideoResolution(
        settings.resolution
        || body.videoResolution
        || body.video_resolution
        || body.resolution
        || body.size,
        '720p'
    );
    const duration = normalizeVideoDuration(
        settings.duration
        || body.videoDuration
        || body.video_duration
        || body.duration,
        5
    );
    const generateAudio = normalizeBooleanOption(
        settings.generateAudio
        ?? settings.generate_audio
        ?? settings.audio
        ?? body.generateAudio
        ?? body.generate_audio
        ?? body.videoAudio
        ?? body.video_audio,
        true
    );
    const watermark = normalizeBooleanOption(
        settings.watermark
        ?? body.watermark
        ?? body.videoWatermark
        ?? body.video_watermark,
        false
    );
    const cameraFixed = normalizeBooleanOption(
        settings.cameraFixed
        ?? settings.camera_fixed
        ?? body.cameraFixed
        ?? body.camera_fixed
        ?? body.videoCameraFixed
        ?? body.video_camera_fixed,
        false
    );
    return {
        ratio,
        resolution,
        duration,
        generateAudio,
        watermark,
        cameraFixed
    };
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = String(error?.message || '').trim().toLowerCase();
    const normalizedRelation = String(relationName || '').trim().toLowerCase();
    if (!normalizedMessage) return false;
    const mentionsRelation = normalizedRelation
        ? normalizedMessage.includes(normalizedRelation)
        : normalizedMessage.includes('relation') || normalizedMessage.includes('table');
    return mentionsRelation && (
        normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('not exist')
        || normalizedMessage.includes('could not find')
        || normalizedMessage.includes('undefined table')
    );
}

function normalizeApiBaseUrl(value = '') {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    try {
        const url = new URL(trimmed);
        url.hash = '';
        url.search = '';
        if (url.pathname === '/') url.pathname = '';
        return url.toString().replace(/\/+$/, '');
    } catch (_) {
        return trimmed.replace(/\/+$/, '');
    }
}

function resolveAllowedApiBaseUrls(env = {}) {
    const configured = String(
        env.AI_IMAGE_ALLOWED_API_BASE_URLS
        || env.SUB2API_ALLOWED_BASE_URLS
        || ''
    )
        .split(',')
        .map((item) => normalizeApiBaseUrl(item))
        .filter(Boolean);

    const values = configured.length
        ? configured
        : DEFAULT_ALLOWED_API_BASE_URLS;

    return [...new Set(values.map((item) => normalizeApiBaseUrl(item)).filter(Boolean))];
}

function resolveDefaultApiBaseUrl({ site = 'cn', env = {} } = {}) {
    const allowed = resolveAllowedApiBaseUrls(env);
    if (!allowed.length) return '';
    if (site === 'intl') {
        return allowed.find((item) => item.includes('zaoyoe')) || allowed[0];
    }
    return allowed.find((item) => item.includes('fatherkey')) || allowed[0];
}

function resolveApiBaseUrl(inputValue, { site = 'cn', env = {} } = {}) {
    const allowed = resolveAllowedApiBaseUrls(env);
    const normalizedInput = normalizeApiBaseUrl(inputValue);
    if (!normalizedInput) {
        return resolveDefaultApiBaseUrl({ site, env });
    }

    if (allowed.includes(normalizedInput)) {
        return normalizedInput;
    }

    const error = new Error('API Base URL 不在管理员允许范围内');
    error.statusCode = 400;
    error.code = 'api_base_url_not_allowed';
    throw error;
}

function inferApiBaseUrlLabel(baseUrl = '') {
    const normalized = normalizeApiBaseUrl(baseUrl).toLowerCase();
    if (normalized.includes('zaoyoe')) return 'Zaoyoe Sub2API';
    if (normalized.includes('fatherkey')) return 'FatherKey Sub2API';
    return 'Sub2API';
}

function serializeApiBaseUrl(row = {}) {
    const baseUrl = normalizeApiBaseUrl(row.base_url || row.baseUrl);
    return {
        id: normalizeText(row.id, 160),
        site: normalizeApiBaseUrlSite(row.site || 'all'),
        label: normalizeText(row.label, 160) || inferApiBaseUrlLabel(baseUrl),
        baseUrl,
        base_url: baseUrl,
        isActive: row.is_active !== false,
        is_active: row.is_active !== false,
        displayOrder: normalizePositiveInt(row.display_order, 0, { min: 0, max: 100000 }),
        display_order: normalizePositiveInt(row.display_order, 0, { min: 0, max: 100000 }),
        metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {},
        createdAt: normalizeText(row.created_at, 120),
        created_at: normalizeText(row.created_at, 120),
        updatedAt: normalizeText(row.updated_at, 120),
        updated_at: normalizeText(row.updated_at, 120)
    };
}

function normalizePublicModelGroup(value = '', fallback = 'image') {
    const normalized = String(value || '').trim().toLowerCase();
    if (['image', 'chat', 'video', 'both'].includes(normalized)) return normalized;
    return ['image', 'chat', 'video', 'both'].includes(fallback) ? fallback : 'image';
}

function hasExplicitPublicModelGroup(value = '') {
    return ['image', 'chat', 'video', 'both'].includes(String(value || '').trim().toLowerCase());
}

function normalizePublicModelsList(value = []) {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
    const models = [];
    const seen = new Set();
    raw.forEach((item) => {
        const model = normalizeText(item, 160);
        const key = model.toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        models.push(model);
    });
    return models;
}

function serializePublicModelProvider(provider = {}) {
    const providerId = normalizeText(provider.providerId || provider.provider_id || provider.id, 80) || 'default';
    const model = normalizeText(provider.model, 160);
    const models = normalizePublicModelsList(provider.models || (model ? [model] : []));
    const rawModelGroup = provider.modelGroup || provider.model_group;
    const configuredModelGroup = normalizePublicModelGroup(rawModelGroup, 'image');
    const imageModels = normalizePublicModelsList(
        configuredModelGroup === 'chat'
            ? (provider.imageModels || provider.image_models || [])
            : (provider.imageModels || provider.image_models || models)
    );
    const chatModels = normalizePublicModelsList(provider.chatModels || provider.chat_models || []);
    const videoModels = normalizePublicModelsList(provider.videoModels || provider.video_models || []);
    const visionModels = normalizePublicModelsList(provider.visionModels || provider.vision_models || provider.chatVisionModels || provider.chat_vision_models || []);
    const modelGroup = hasExplicitPublicModelGroup(rawModelGroup)
        ? configuredModelGroup
        : normalizePublicModelGroup(rawModelGroup, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
    const scopedImageModels = modelGroup === 'chat' || modelGroup === 'video' ? [] : imageModels;
    const scopedChatModels = modelGroup === 'image' || modelGroup === 'video' ? [] : chatModels;
    const scopedVideoModels = videoModels;
    return {
        providerId,
        provider_id: providerId,
        label: normalizeText(provider.label || provider.name || providerId, 120) || providerId,
        vendor: normalizeText(provider.vendor || provider.provider || 'openai', 80).toLowerCase() || 'openai',
        vendorLabel: normalizeText(provider.vendorLabel || provider.vendor_label || provider.vendorName || provider.vendor_name, 80),
        vendor_label: normalizeText(provider.vendorLabel || provider.vendor_label || provider.vendorName || provider.vendor_name, 80),
        protocol: normalizeText(provider.protocol || provider.adapter || 'openai-compatible', 80).toLowerCase() || 'openai-compatible',
        modelGroup,
        model_group: modelGroup,
        model,
        models: scopedImageModels,
        imageModels: scopedImageModels,
        image_models: scopedImageModels,
        chatModels: scopedChatModels,
        chat_models: scopedChatModels,
        videoModels: scopedVideoModels,
        video_models: scopedVideoModels,
        visionModels,
        vision_models: visionModels,
        isActive: provider.isActive !== false && provider.is_active !== false,
        is_active: provider.isActive !== false && provider.is_active !== false,
        displayOrder: normalizePositiveInt(provider.displayOrder ?? provider.display_order, 0, { min: 0, max: 100000 }),
        display_order: normalizePositiveInt(provider.displayOrder ?? provider.display_order, 0, { min: 0, max: 100000 })
    };
}

function providerSupportsPublicModelGroup(provider = {}, group = 'image') {
    const requestedGroup = normalizePublicModelGroup(group, 'image');
    const providerGroup = normalizePublicModelGroup(provider.modelGroup || provider.model_group, 'image');
    return (requestedGroup !== 'video' && providerGroup === 'both') || providerGroup === requestedGroup;
}

function serializeDiscoveredRuntimeModel(model = '', group = 'chat') {
    const id = normalizeText(model, 180);
    if (!id) return null;
    return {
        id,
        label: id,
        providerId: 'detected-upstream',
        providerLabel: '检测到的上游模型',
        vendor: 'detected',
        protocol: 'openai-compatible',
        source: 'upstream_discovery',
        modelGroup: group,
        model_group: group
    };
}

function serializeDiscoveredModelList(models = [], group = 'chat') {
    const seen = new Set();
    return (Array.isArray(models) ? models : [])
        .map((model) => serializeDiscoveredRuntimeModel(model, group))
        .filter((model) => {
            const key = String(model?.id || '').toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function buildDiscoveredModelsPayload(discovery = {}, { apiBaseUrl = '', source = 'stored' } = {}) {
    const rawChatModels = Array.isArray(discovery.chatModels) ? discovery.chatModels : [];
    const rawImageModels = Array.isArray(discovery.imageModels) ? discovery.imageModels : [];
    const rawVideoModels = Array.isArray(discovery.videoModels) ? discovery.videoModels : [];
    const chatModels = serializeDiscoveredModelList(rawChatModels, 'chat');
    const imageModels = serializeDiscoveredModelList(rawImageModels, 'image');
    const videoModels = serializeDiscoveredModelList(rawVideoModels, 'video');
    const availableModelCount = chatModels.length + imageModels.length + videoModels.length;
    const provider = {
        providerId: 'detected-upstream',
        provider_id: 'detected-upstream',
        label: '检测到的上游模型',
        vendor: 'detected',
        protocol: 'openai-compatible',
        modelGroup: videoModels.length && !imageModels.length && !chatModels.length ? 'video' : (imageModels.length && chatModels.length ? 'both' : (imageModels.length ? 'image' : 'chat')),
        model_group: videoModels.length && !imageModels.length && !chatModels.length ? 'video' : (imageModels.length && chatModels.length ? 'both' : (imageModels.length ? 'image' : 'chat')),
        baseUrl: apiBaseUrl,
        base_url: apiBaseUrl,
        imageModels: imageModels.map((model) => model.id),
        image_models: imageModels.map((model) => model.id),
        chatModels: chatModels.map((model) => model.id),
        chat_models: chatModels.map((model) => model.id),
        videoModels: videoModels.map((model) => model.id),
        video_models: videoModels.map((model) => model.id),
        isActive: true,
        is_active: true,
        source: 'upstream_discovery'
    };

    return {
        success: true,
        message: availableModelCount
            ? `模型检测完成：发现 ${availableModelCount} 个可分类上游模型。`
            : '模型检测完成，但没有发现可分类的可用模型。',
        apiBaseUrl,
        api_base_url: apiBaseUrl,
        keySource: source,
        key_source: source,
        discovery,
        model_providers: [provider],
        image_model_providers: [provider],
        image_models: imageModels,
        chat_models: chatModels,
        video_models: videoModels
    };
}

async function loadPublicModelProviders(supabase, { env = {} } = {}) {
    const providers = typeof listStoredAiImageProviderSecrets === 'function'
        ? await listStoredAiImageProviderSecrets(supabase, {
            env,
            allowDecryptFailure: true
        }).catch(() => [])
        : [];
    return (Array.isArray(providers) ? providers : [])
        .filter((provider) => provider?.isActive !== false && provider?.configured)
        .map(serializePublicModelProvider)
        .filter((provider) => provider.model || provider.imageModels.length || provider.chatModels.length || provider.videoModels.length);
}

function buildFallbackApiBaseUrlRows({ site = 'cn', env = {} } = {}) {
    return resolveAllowedApiBaseUrls(env).map((baseUrl, index) => {
        const normalized = normalizeApiBaseUrl(baseUrl);
        const inferredSite = normalized.includes('zaoyoe')
            ? 'intl'
            : (normalized.includes('fatherkey') ? 'cn' : 'all');
        return serializeApiBaseUrl({
            id: `fallback-${index + 1}`,
            site: inferredSite === site ? inferredSite : (inferredSite === 'all' ? 'all' : inferredSite),
            label: inferApiBaseUrlLabel(normalized),
            base_url: normalized,
            is_active: true,
            display_order: (index + 1) * 10,
            metadata: { source: 'fallback' }
        });
    });
}

async function loadAllowedApiBaseUrls(supabase, { site = 'cn', env = {} } = {}) {
    if (supabase?.from) {
        try {
            const { data, error } = await supabase
                .from('ai_image_api_base_urls')
                .select(API_BASE_URL_SELECT)
                .in('site', [site, 'all'])
                .eq('is_active', true)
                .order('display_order', { ascending: true })
                .order('created_at', { ascending: true })
                .limit(50);
            if (error) throw error;
            const rows = (Array.isArray(data) ? data : [])
                .map(serializeApiBaseUrl)
                .filter((row) => row.baseUrl);
            return rows;
        } catch (error) {
            if (!isMissingRelationError(error, 'ai_image_api_base_urls')) {
                throw error;
            }
        }
    }

    return buildFallbackApiBaseUrlRows({ site, env });
}

function parseImageDataUrl(value = '') {
    const raw = String(value || '').trim();
    const match = raw.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) {
        const error = new Error('请上传有效的图片文件');
        error.statusCode = 400;
        error.code = 'invalid_image_payload';
        throw error;
    }

    return {
        mimeType: normalizeText(match[1], 120).toLowerCase(),
        base64: String(match[2] || '').replace(/\s+/g, '')
    };
}

function parseReferenceImageUploadBody(body = {}) {
    const dataUrl = normalizeText(body.imageData || body.image_data || body.dataUrl || body.data_url, 20 * 1024 * 1024);
    const mimeTypeInput = normalizeText(body.mimeType || body.mime_type, 120).toLowerCase();
    const base64Input = normalizeText(body.base64 || body.imageBase64 || body.image_base64, 20 * 1024 * 1024).replace(/\s+/g, '');
    let mimeType = mimeTypeInput;
    let base64 = base64Input;

    if (dataUrl) {
        const parsed = parseImageDataUrl(dataUrl);
        mimeType = parsed.mimeType;
        base64 = parsed.base64;
    }

    if (!mimeType || !base64) {
        const error = new Error('请上传有效的图片文件');
        error.statusCode = 400;
        error.code = 'invalid_image_payload';
        throw error;
    }

    if (!SUPPORTED_REFERENCE_IMAGE_MIME_TYPES.has(mimeType)) {
        const error = new Error('仅支持 JPG、PNG、WebP 图片');
        error.statusCode = 400;
        error.code = 'unsupported_image_type';
        throw error;
    }

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > MAX_REFERENCE_UPLOAD_BYTES) {
        const error = new Error('图片大小超出限制，请上传 12MB 以内的图片');
        error.statusCode = 400;
        error.code = 'image_too_large';
        throw error;
    }

    return {
        buffer,
        mimeType,
        title: normalizeText(body.title || body.fileName || body.file_name || '参考图片', 500)
    };
}

function pickDefaultApiBaseUrl(rows = [], { site = 'cn' } = {}) {
    const candidates = Array.isArray(rows) ? rows.filter((row) => row?.baseUrl) : [];
    if (!candidates.length) return '';
    const siteSpecific = candidates.find((row) => row.site === site);
    if (siteSpecific) return siteSpecific.baseUrl;
    if (site === 'intl') {
        return candidates.find((row) => row.baseUrl.includes('zaoyoe'))?.baseUrl || candidates[0].baseUrl;
    }
    return candidates.find((row) => row.baseUrl.includes('fatherkey'))?.baseUrl || candidates[0].baseUrl;
}

async function resolveApiBaseUrlFromAdminConfig(supabase, inputValue, { site = 'cn', env = {} } = {}) {
    const rows = await loadAllowedApiBaseUrls(supabase, { site, env });
    const allowed = rows.map((row) => row.baseUrl).filter(Boolean);
    const normalizedInput = normalizeApiBaseUrl(inputValue);
    if (!normalizedInput) {
        const defaultBaseUrl = pickDefaultApiBaseUrl(rows, { site });
        if (defaultBaseUrl) return defaultBaseUrl;

        const error = new Error('管理员尚未启用可用的 API Base URL');
        error.statusCode = 400;
        error.code = 'api_base_url_not_configured';
        throw error;
    }

    if (allowed.includes(normalizedInput)) {
        return normalizedInput;
    }

    const error = new Error('API Base URL 不在管理员允许范围内');
    error.statusCode = 400;
    error.code = 'api_base_url_not_allowed';
    throw error;
}

function getApiKeyTail(apiKey = '') {
    const normalized = String(apiKey || '').trim();
    if (!normalized) return '';
    return normalized.slice(-8);
}

function getApiKeyFingerprint(apiKey = '') {
    const normalized = String(apiKey || '').trim();
    if (!normalized) return '';
    return `sha256:${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

function serializeStoredUserApiKey(row = {}, { includeDecryptionStatus = false } = {}) {
    const configured = Boolean(row?.api_key_tail || row?.apiKeyTail);
    const payload = {
        configured,
        apiKeyConfigured: configured,
        api_key_configured: configured,
        apiBaseUrl: normalizeApiBaseUrl(row?.api_base_url || row?.apiBaseUrl),
        api_base_url: normalizeApiBaseUrl(row?.api_base_url || row?.apiBaseUrl),
        apiKeyTail: normalizeText(row?.api_key_tail || row?.apiKeyTail, 16),
        api_key_tail: normalizeText(row?.api_key_tail || row?.apiKeyTail, 16),
        apiKeyFingerprint: normalizeText(row?.api_key_fingerprint || row?.apiKeyFingerprint, 80),
        api_key_fingerprint: normalizeText(row?.api_key_fingerprint || row?.apiKeyFingerprint, 80),
        updatedAt: normalizeText(row?.updated_at || row?.updatedAt, 120),
        updated_at: normalizeText(row?.updated_at || row?.updatedAt, 120)
    };
    if (includeDecryptionStatus) {
        payload.decryptError = normalizeText(row?.decryptErrorMessage || row?.decrypt_error_message, 500);
        payload.decrypt_error = payload.decryptError;
    }
    return payload;
}

function buildMissingApiKeyError() {
    const error = new Error('API 模式需要填写 API Key');
    error.statusCode = 400;
    error.code = 'api_key_required';
    return error;
}

function wrapUserApiKeyStoreError(error) {
    if (isMissingRelationError(error, 'ai_image_user_api_keys')) {
        const wrapped = new Error('AI 工作台用户 API Key 密钥仓未初始化，请先执行 20260625_ai_image_user_api_keys.sql');
        wrapped.statusCode = 500;
        wrapped.code = 'api_key_store_uninitialized';
        return wrapped;
    }
    return error;
}

async function loadStoredUserApiKey(supabase, {
    userId = '',
    site = 'cn',
    apiBaseUrl = '',
    allowDecryptFailure = false,
    env = process.env
} = {}) {
    if (!supabase?.from || !userId || !apiBaseUrl) return null;
    try {
        const { data, error } = await supabase
            .from('ai_image_user_api_keys')
            .select(USER_API_KEY_SELECT)
            .eq('user_id', userId)
            .eq('site', site)
            .eq('api_base_url', apiBaseUrl)
            .maybeSingle();
        if (error) throw error;
        if (!data) return null;

        try {
            return {
                ...data,
                apiKey: decryptSecretValue(data.encrypted_api_key, env),
                decryptErrorMessage: ''
            };
        } catch (error) {
            if (allowDecryptFailure && typeof isSecretDecryptAuthenticationError === 'function' && isSecretDecryptAuthenticationError(error)) {
                return {
                    ...data,
                    apiKey: '',
                    decryptErrorMessage: '用户 API Key 无法解密，请重新保存 Key。'
                };
            }
            throw error;
        }
    } catch (error) {
        throw wrapUserApiKeyStoreError(error);
    }
}

async function saveStoredUserApiKey(supabase, {
    userId = '',
    site = 'cn',
    apiBaseUrl = '',
    apiKey = '',
    env = process.env
} = {}) {
    const normalizedApiKey = normalizeText(apiKey, 4000);
    if (!supabase?.from || !userId || !apiBaseUrl || !normalizedApiKey) {
        throw buildMissingApiKeyError();
    }

    const payload = {
        site,
        user_id: userId,
        api_base_url: apiBaseUrl,
        api_key_tail: getApiKeyTail(normalizedApiKey),
        api_key_fingerprint: getApiKeyFingerprint(normalizedApiKey),
        encrypted_api_key: encryptSecretValue(normalizedApiKey, env),
        metadata: {
            saved_via: 'ai-image-workbench',
            plaintext_returned: false
        },
        updated_at: new Date().toISOString()
    };

    try {
        const { data, error } = await supabase
            .from('ai_image_user_api_keys')
            .upsert(payload, { onConflict: 'user_id,site,api_base_url' })
            .select(USER_API_KEY_SELECT)
            .single();
        if (error) throw error;
        return {
            ...(data || payload),
            apiKey: normalizedApiKey,
            decryptErrorMessage: ''
        };
    } catch (error) {
        throw wrapUserApiKeyStoreError(error);
    }
}

async function resolveUserApiKeyForRequest(supabase, {
    userId = '',
    site = 'cn',
    apiBaseUrl = '',
    apiKeyInput = '',
    required = true,
    env = process.env
} = {}) {
    const normalizedInput = normalizeText(apiKeyInput, 4000);
    if (normalizedInput) {
        const stored = await saveStoredUserApiKey(supabase, {
            userId,
            site,
            apiBaseUrl,
            apiKey: normalizedInput,
            env
        });
        return {
            apiKey: normalizedInput,
            apiKeyTail: stored.api_key_tail || getApiKeyTail(normalizedInput),
            apiKeyFingerprint: stored.api_key_fingerprint || getApiKeyFingerprint(normalizedInput),
            storedApiKey: serializeStoredUserApiKey(stored),
            source: 'request_saved'
        };
    }

    const stored = await loadStoredUserApiKey(supabase, {
        userId,
        site,
        apiBaseUrl,
        env,
        allowDecryptFailure: true
    });
    if (stored?.decryptErrorMessage) {
        const error = new Error('已保存的 API Key 无法解密，请重新保存一次新的 Key');
        error.statusCode = 400;
        error.code = 'api_key_decrypt_failed';
        throw error;
    }
    if (stored?.apiKey) {
        return {
            apiKey: stored.apiKey,
            apiKeyTail: stored.api_key_tail || getApiKeyTail(stored.apiKey),
            apiKeyFingerprint: stored.api_key_fingerprint || getApiKeyFingerprint(stored.apiKey),
            storedApiKey: serializeStoredUserApiKey(stored),
            source: 'stored'
        };
    }

    if (!required) {
        return {
            apiKey: '',
            apiKeyTail: '',
            apiKeyFingerprint: '',
            storedApiKey: stored ? serializeStoredUserApiKey(stored, { includeDecryptionStatus: true }) : serializeStoredUserApiKey({ api_base_url: apiBaseUrl }),
            source: 'missing'
        };
    }

    throw buildMissingApiKeyError();
}

async function loadStoredUserApiKeyStatuses(supabase, {
    userId = '',
    site = 'cn',
    apiBaseUrls = []
} = {}) {
    if (!supabase?.from || !userId) return [];
    try {
        let query = supabase
            .from('ai_image_user_api_keys')
            .select(USER_API_KEY_STATUS_SELECT)
            .eq('user_id', userId)
            .eq('site', site);
        const normalizedBaseUrls = (Array.isArray(apiBaseUrls) ? apiBaseUrls : [])
            .map((item) => normalizeApiBaseUrl(item))
            .filter(Boolean);
        if (normalizedBaseUrls.length) {
            query = query.in('api_base_url', normalizedBaseUrls);
        }
        const { data, error } = await query.order('updated_at', { ascending: false }).limit(50);
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map(serializeStoredUserApiKey);
    } catch (error) {
        if (isMissingRelationError(error, 'ai_image_user_api_keys')) {
            return [];
        }
        throw error;
    }
}

function normalizeReferenceImages(body = {}) {
    const rawList = body.referenceImages || body.reference_images || body.references || body.extraReferenceImages || body.extra_reference_images || [];
    const list = Array.isArray(rawList) ? rawList : [rawList];
    const seen = new Set();
    return list
        .map((item) => {
            const value = item && typeof item === 'object' ? item : { url: item };
            const url = normalizeText(value.url || value.imageUrl || value.image_url || value.image || value.referenceImageUrl || value.reference_image_url, 4000);
            if (!url || seen.has(url)) return null;
            seen.add(url);
            return {
                url,
                title: normalizeText(value.title || value.name || value.referenceTitle || value.reference_title, 500),
                role: normalizeText(value.role || 'reference', 40) || 'reference'
            };
        })
        .filter(Boolean);
}

function hasReferenceImage(body = {}) {
    const referenceImage = body.referenceImage || body.reference_image || {};
    return Boolean(
        normalizeText(body.referenceImageUrl || body.reference_image_url || referenceImage.url || referenceImage.imageUrl || '', 4000)
        || normalizeText(body.referenceImageStoragePath || body.reference_image_storage_path || referenceImage.storagePath || '', 4000)
        || normalizeReferenceImages(body).length
    );
}

function normalizeDownloadSource(value = '') {
    const normalized = normalizeText(value, 80).toLowerCase();
    if (!normalized) return 'workbench';
    return normalized.replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'workbench';
}

function looksLikeReversePrompt(prompt = '') {
    return /反推|提示词|prompt|describe|描述|逆向|还原/i.test(String(prompt || ''));
}

function wantsImageGeneration(body = {}) {
    if (body.generateImage === true || body.generate_image === true || body.createImage === true) {
        return true;
    }
    if (body.generateImage === false || body.generate_image === false || body.createImage === false) {
        return false;
    }

    const output = normalizeText(body.output || body.outputMode || body.output_mode, 40).toLowerCase();
    return output === 'image' || output === 'images';
}

function wantsVideoGeneration(body = {}) {
    if (body.generateVideo === true || body.generate_video === true || body.createVideo === true) {
        return true;
    }
    if (body.generateVideo === false || body.generate_video === false || body.createVideo === false) {
        return false;
    }

    const output = normalizeText(body.output || body.outputMode || body.output_mode, 40).toLowerCase();
    return output === 'video' || output === 'videos';
}

function inferMode(body = {}) {
    const rawMode = normalizeText(body.mode || body.taskMode || body.task_mode, 40).toLowerCase();
    if (SUPPORTED_MODES.has(rawMode)) {
        return rawMode;
    }

    if (normalizeText(body.agentId || body.agent_id || body.agentSlug || body.agent_slug, 160)) {
        return 'agent';
    }

    if (wantsVideoGeneration(body)) {
        return 'video';
    }

    const prompt = normalizeText(body.prompt || body.message || body.input, 4000);
    const referencePresent = hasReferenceImage(body);
    if (referencePresent && looksLikeReversePrompt(prompt)) {
        return 'reverse';
    }

    if (referencePresent) {
        return 'image';
    }

    const modelGroup = normalizeText(body.apiModelGroup || body.api_model_group || body.modelGroup || body.model_group, 80).toLowerCase();
    if (modelGroup === 'chat' && !wantsImageGeneration(body)) {
        return 'chat';
    }

    if (normalizeText(body.parentTaskId || body.parent_task_id, 160)) {
        return 'image';
    }

    if (normalizeText(body.billingMode || body.billing_mode, 40).toLowerCase() === 'api' && !wantsImageGeneration(body)) {
        return 'chat';
    }

    return 'text';
}

function normalizeBillingMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_BILLING_MODES.has(normalized) ? normalized : '';
}

function normalizeRateLimitKeyPart(value = '', fallback = 'unknown') {
    const normalized = String(value || '').trim().toLowerCase()
        .replace(/[^a-z0-9_.:@-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 180);
    return normalized || fallback;
}

function isHeavyImageRequest({ mode = 'text', resolution = '1k', quantity = 1 } = {}) {
    if (VIDEO_MODES.has(mode)) return true;
    if (!IMAGE_MODES.has(mode)) return false;
    return resolution === '4k' || Number(quantity || 1) > 1;
}

function buildRateLimitedError(scope = '', result = {}) {
    const error = new Error('请求过于频繁，请稍后再试');
    error.statusCode = 429;
    error.code = 'rate_limited';
    error.scope = scope || 'ai_image';
    error.rateLimit = result && typeof result === 'object' ? result : DEFAULT_RATE_LIMIT_HEADERS;
    return error;
}

function applyOptionalRateLimitHeaders(applyRateLimitHeaders, res, result = {}) {
    if (typeof applyRateLimitHeaders === 'function') {
        applyRateLimitHeaders(res, result);
        return;
    }

    if (!res || typeof res.setHeader !== 'function') return;
    res.setHeader('X-RateLimit-Limit', String(result.limit || 0));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining || 0));
    res.setHeader('X-RateLimit-Reset', String(Math.floor((result.resetAt || Date.now()) / 1000)));
    if (result.allowed === false) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds || 1));
    }
}

function resolveModel({ body = {}, mode = 'text' } = {}) {
    const model = normalizeText(body.model || body.imageModel || body.image_model || body.apiModel || body.api_model, 120);
    if (TEXT_VISION_MODES.has(mode) && (!model || model === 'gpt-image' || model === 'gpt-image-api' || /^gpt-image/i.test(model))) {
        return mode === 'chat' ? 'default-chat-model' : 'default-vision-model';
    }
    if (model === 'gpt-image' || model === 'gpt-image-api') return 'gpt-image-2';
    if (model) return model;
    if (mode === 'chat') return 'default-chat-model';
    if (mode === 'reverse') return 'default-vision-model';
    if (mode === 'video') return 'default-video-model';
    return 'gpt-image-2';
}

function resolveModelGroup({ body = {}, mode = 'text' } = {}) {
    const group = normalizeText(body.apiModelGroup || body.api_model_group || body.modelGroup || body.model_group, 80).toLowerCase();
    if (group) return group.slice(0, 80);
    if (VIDEO_MODES.has(mode)) return 'video';
    return TEXT_VISION_MODES.has(mode) ? 'chat' : 'image';
}

function getAiImagePricingRuleModes(mode = 'text') {
    const normalizedMode = normalizeText(mode, 40).toLowerCase();
    const canonicalMode = PRICING_MODE_ALIASES[normalizedMode] || normalizedMode;
    return [...new Set([normalizedMode, canonicalMode].filter(Boolean))];
}

function normalizeTokenUsage(value = {}) {
    const usage = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const inputTokens = normalizePositiveInt(usage.input_tokens || usage.inputTokens || usage.prompt_tokens || usage.promptTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const outputTokens = normalizePositiveInt(usage.output_tokens || usage.outputTokens || usage.completion_tokens || usage.completionTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const totalTokens = normalizePositiveInt(usage.total_tokens || usage.totalTokens, inputTokens + outputTokens, { min: 0, max: Number.MAX_SAFE_INTEGER });
    return {
        raw: usage,
        inputTokens,
        outputTokens,
        totalTokens
    };
}

function buildFallbackEstimatedPoints({ mode = 'text', resolution = '1k', quantity = 1 } = {}) {
    if (mode === 'chat') return 0;
    if (mode === 'reverse') return 3;
    if (mode === 'video') {
        const videoBaseByResolution = {
            '480p': 40,
            '720p': 60,
            '1080p': 120,
            '4k': 260,
            '1k': 60,
            '2k': 120
        };
        return normalizeBillablePoints(videoBaseByResolution[resolution] || videoBaseByResolution['720p']);
    }

    const baseByResolution = {
        '1k': 8,
        '2k': 18,
        '4k': 48
    };
    const base = baseByResolution[resolution] || baseByResolution['1k'];
    const modeMultiplier = mode === 'image' ? 1.25 : 1;
    return normalizeBillablePoints(base * modeMultiplier * quantity);
}

function buildPricingEstimatePayload({
    estimatedPoints = 0,
    source = 'fallback',
    site = 'cn',
    mode = 'text',
    billingMode = 'points',
    model = '',
    providerId = '',
    resolution = '1k',
    ratio = '1:1',
    quantity = 1,
    matchedRule = null
} = {}) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const normalizedMatchedRule = matchedRule && typeof matchedRule === 'object' ? {
        id: normalizeText(matchedRule.id, 160),
        site: normalizeText(matchedRule.site || 'all', 20),
        mode: normalizeText(matchedRule.mode || mode, 40),
        billing_mode: normalizeText(matchedRule.billing_mode || billingMode, 40),
        model: normalizeText(matchedRule.model || '*', 120) || '*',
        resolution: normalizeText(matchedRule.resolution || '*', 20).toLowerCase() || '*',
        ratio: normalizeText(matchedRule.ratio || '*', 20).toLowerCase() || '*',
        quantity: normalizePositiveInt(matchedRule.quantity, 1, { min: 1, max: 8 }),
        points: normalizeNumber(matchedRule.points, 0),
        priority: Number(matchedRule.priority || 100),
        metadata: normalizeAiImagePricingMetadata(matchedRule.metadata || {})
    } : null;

    return {
        estimatedPoints: normalizeBillablePoints(estimatedPoints, 0),
        pricing: {
            source,
            request: {
                site,
                mode,
                billing_mode: billingMode,
                model,
                provider_id: normalizedProviderId,
                providerId: normalizedProviderId,
                resolution,
                ratio,
                quantity: normalizePositiveInt(quantity, 1, { min: 1, max: 8 })
            },
            matched_rule: normalizedMatchedRule
        }
    };
}

function pricingRuleScore(rule = {}, { site, mode, model, providerId = '', resolution, ratio, quantity } = {}) {
    let score = 0;
    const normalizedProviderId = normalizeProviderId(providerId);
    if (rule.mode === mode) score += 64;
    if (rule.site === site) score += 32;
    if (rule.model === model) score += 16;
    const ruleProviderId = getAiImagePricingProviderId(rule);
    if (ruleProviderId && ruleProviderId !== '*' && ruleProviderId === normalizedProviderId) score += 24;
    if (rule.resolution === resolution) score += 8;
    if (rule.ratio === ratio) score += 4;
    if (Number(rule.quantity) === Number(quantity)) score += 2;
    score += Math.max(0, 1000 - Number(rule.priority || 100)) / 1000;
    return score;
}

async function estimatePointsFromRules(supabase, {
    site,
    mode,
    billingMode,
    model,
    providerId = '',
    resolution,
    ratio,
    quantity
} = {}) {
    if (!supabase?.from || billingMode !== 'points') {
        return buildPricingEstimatePayload({
            estimatedPoints: buildFallbackEstimatedPoints({ mode, resolution, quantity }),
            source: billingMode === 'points' ? 'fallback' : 'not_points_billing',
            site,
            mode,
            billingMode,
            model,
            providerId,
            resolution,
            ratio,
            quantity
        });
    }

    try {
        const pricingRuleModes = getAiImagePricingRuleModes(mode);
        const { data, error } = await supabase
            .from('ai_image_pricing_rules')
            .select('id, site, mode, billing_mode, model, resolution, ratio, quantity, points, priority, metadata, is_active')
            .in('site', [site, 'all'])
            .in('mode', pricingRuleModes)
            .eq('billing_mode', billingMode)
            .eq('is_active', true)
            .order('priority', { ascending: true })
            .limit(50);

        if (error) throw error;

        const candidates = (Array.isArray(data) ? data : []).filter((rule) => {
            const ruleModel = normalizeText(rule.model || '*', 120);
            const ruleProviderId = getAiImagePricingProviderId(rule);
            const ruleResolution = normalizeText(rule.resolution || '*', 20).toLowerCase();
            const ruleRatio = normalizeText(rule.ratio || '*', 20).toLowerCase();
            const ruleQuantity = Number(rule.quantity || 1);
            const normalizedProviderId = normalizeProviderId(providerId);
            const providerMatches = !ruleProviderId
                || ruleProviderId === '*'
                || (normalizedProviderId && ruleProviderId === normalizedProviderId);
            return (ruleModel === '*' || ruleModel === model)
                && providerMatches
                && (ruleResolution === '*' || ruleResolution === resolution)
                && (ruleRatio === '*' || ruleRatio === ratio)
                && (ruleQuantity === 1 || ruleQuantity === Number(quantity));
        });

        const matched = candidates
            .sort((left, right) => pricingRuleScore(right, { site, mode, model, providerId, resolution, ratio, quantity }) - pricingRuleScore(left, { site, mode, model, providerId, resolution, ratio, quantity }))[0];

        if (matched) {
            const ruleEstimate = estimateAiImageRulePoints(matched, quantity);
            return buildPricingEstimatePayload({
                estimatedPoints: ruleEstimate.estimatedPoints,
                source: 'rule',
                site,
                mode,
                billingMode,
                model,
                providerId,
                resolution,
                ratio,
                quantity,
                matchedRule: matched
            });
        }
    } catch (error) {
        if (!isMissingRelationError(error, 'ai_image_pricing_rules')) {
            throw error;
        }
    }

    return buildPricingEstimatePayload({
        estimatedPoints: buildFallbackEstimatedPoints({ mode, resolution, quantity }),
        source: 'fallback',
        site,
        mode,
        billingMode,
        model,
        providerId,
        resolution,
        ratio,
        quantity
    });
}

function assertReferenceImageIsStorable(value = '') {
    const normalized = normalizeText(value, 4000);
    if (!normalized) return;

    if (isReferenceImageTransient(normalized)) {
        const error = new Error('请先上传参考图片，再提交生成任务');
        error.statusCode = 400;
        error.code = 'reference_image_requires_upload';
        throw error;
    }
}

function isReferenceImageTransient(value = '') {
    return /^data:/i.test(String(value || '').trim()) || /^blob:/i.test(String(value || '').trim());
}

function assertReferenceImageListIsStorable(referenceImages = []) {
    referenceImages.forEach((item) => assertReferenceImageIsStorable(item?.url || ''));
}

function buildTaskPayload({
    body,
    userId,
    site,
    mode,
    billingMode,
    model,
    modelGroup,
    apiBaseUrl,
    apiKeyTail,
    apiKeyFingerprint,
    providerId = '',
    estimatedPoints,
    pricing = null
}) {
    const referenceImage = body.referenceImage || body.reference_image || {};
    const parentTaskInput = normalizeText(body.parentTaskId || body.parent_task_id, 160);
    const conversationInput = normalizeText(body.conversationId || body.conversation_id, 160);
    const videoSettings = VIDEO_MODES.has(mode) ? normalizeVideoSettings(body) : null;
    const ratio = VIDEO_MODES.has(mode)
        ? videoSettings.ratio
        : (IMAGE_MODES.has(mode) ? normalizeRatio(body.ratio || body.aspectRatio || body.aspect_ratio, '1:1') : null);
    const resolution = VIDEO_MODES.has(mode)
        ? videoSettings.resolution
        : (IMAGE_MODES.has(mode) ? normalizeResolution(body.resolution || body.size, '1k') : null);
    const quantity = VIDEO_MODES.has(mode)
        ? 1
        : (IMAGE_MODES.has(mode)
        ? normalizePositiveInt(body.quantity || body.count || body.n, 1, { min: 1, max: 8 })
        : 1);
    const referenceImageUrl = normalizeText(body.referenceImageUrl || body.reference_image_url || referenceImage.url || referenceImage.imageUrl, 4000);
    const referenceImageStoragePath = normalizeText(body.referenceImageStoragePath || body.reference_image_storage_path || referenceImage.storagePath, 4000);
    const referenceImages = normalizeReferenceImages(body)
        .filter((item) => item.url !== referenceImageUrl);
    const modelProviderId = normalizeProviderId(
        providerId
        || body.providerId
        || body.provider_id
        || body.modelProviderId
        || body.model_provider_id
    );
    const referenceImageCount = (referenceImageUrl ? 1 : 0) + referenceImages.length;
    if (referenceImageCount > MAX_REFERENCE_IMAGE_INPUTS) {
        const error = new Error(`参考图最多 ${MAX_REFERENCE_IMAGE_INPUTS} 张（包含续作基底图）`);
        error.statusCode = 400;
        error.code = 'reference_image_limit_exceeded';
        throw error;
    }

    assertReferenceImageIsStorable(referenceImageUrl);
    assertReferenceImageListIsStorable(referenceImages);

    return {
        site,
        user_id: userId,
        parent_task_id: isUuid(parentTaskInput) ? parentTaskInput : null,
        conversation_id: isUuid(conversationInput) ? conversationInput : null,
        client_task_id: normalizeText(body.clientTaskId || body.client_task_id, 160),
        source_prompt_id: normalizeText(body.sourcePromptId || body.source_prompt_id || body.promptId || body.prompt_id, 160),
        mode,
        agent_id: isUuid(body.agentId || body.agent_id) ? String(body.agentId || body.agent_id).trim() : null,
        agent_slug: normalizeText(body.agentSlug || body.agent_slug, 120),
        billing_mode: billingMode,
        status: 'queued',
        model,
        api_model_group: modelGroup,
        ratio,
        resolution,
        quantity,
        prompt: normalizeText(body.prompt || body.message || body.input, 8000),
        negative_prompt: normalizeText(body.negativePrompt || body.negative_prompt, 4000),
        reference_image_url: referenceImageUrl,
        reference_image_storage_path: referenceImageStoragePath,
        reference_title: normalizeText(body.referenceTitle || body.reference_title || referenceImage.title, 500),
        result_prompt: '',
        estimated_points: estimatedPoints,
        charged_points: 0,
        points_ledger_reference_id: '',
        api_base_url: billingMode === 'api' ? apiBaseUrl : '',
        api_key_tail: billingMode === 'api' ? apiKeyTail : '',
        api_key_fingerprint: billingMode === 'api' ? apiKeyFingerprint : '',
        token_usage: {},
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        provider_task_id: '',
        error_code: '',
        error_message: '',
        metadata: {
            parentClientTaskId: isUuid(parentTaskInput) ? '' : parentTaskInput,
            rawMode: normalizeText(body.mode || body.taskMode || body.task_mode, 40),
            output: VIDEO_MODES.has(mode) ? 'video' : normalizeText(body.output || body.outputMode || body.output_mode, 40),
            provider_id: modelProviderId,
            providerId: modelProviderId,
            model_provider_id: modelProviderId,
            modelProviderId,
            ...(VIDEO_MODES.has(mode) ? {
                video_ratio: videoSettings.ratio,
                video_resolution: videoSettings.resolution,
                duration: videoSettings.duration,
                video_duration: videoSettings.duration,
                generate_audio: videoSettings.generateAudio,
                video_audio: videoSettings.generateAudio,
                watermark: videoSettings.watermark,
                video_watermark: videoSettings.watermark,
                camera_fixed: videoSettings.cameraFixed,
                video_camera_fixed: videoSettings.cameraFixed
            } : {}),
            reference_images: referenceImages,
            reference_image_count: referenceImageCount,
            pricing: pricing && typeof pricing === 'object' && !Array.isArray(pricing) ? pricing : {}
        }
    };
}

async function resolveContinuationReferenceFromResult(supabase, {
    body = {},
    userId = '',
    site = ''
} = {}) {
    if (!supabase?.from || !userId) return null;
    const rawResultId = normalizeText(body.referenceResultId || body.reference_result_id || body.resultId || body.result_id, 160);
    const rawTaskId = normalizeText(body.referenceTaskId || body.reference_task_id || body.parentTaskId || body.parent_task_id || body.taskId || body.task_id, 160);
    const resultId = isUuid(rawResultId) ? rawResultId : '';
    let taskId = isUuid(rawTaskId) ? rawTaskId : '';
    const resultIndex = normalizePositiveInt(body.referenceResultIndex ?? body.reference_result_index ?? body.resultIndex ?? body.result_index, 0, { min: 0, max: 99 });
    if (!resultId && !taskId && rawTaskId) {
        const { data: task, error: taskError } = await supabase
            .from('ai_image_tasks')
            .select('id')
            .eq('user_id', userId)
            .eq('site', site)
            .eq('client_task_id', rawTaskId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (taskError) throw taskError;
        taskId = isUuid(task?.id) ? task.id : '';
    }
    if (!resultId && !taskId) return null;

    let query = supabase
        .from('ai_image_results')
        .select(RESULT_SELECT)
        .eq('user_id', userId)
        .eq('site', site);
    query = resultId
        ? query.eq('id', resultId)
        : query.eq('task_id', taskId).eq('result_index', resultIndex);

    const { data: result, error } = await query.maybeSingle();
    if (error) throw error;
    if (!result) return null;

    const originalStatus = getResultOriginalStatus(result);
    const preferredUrl = normalizeText(
        originalStatus === 'ready' ? result.original_image_url : result.image_url,
        4000
    );
    if (!preferredUrl) return null;

    return {
        url: preferredUrl,
        storagePath: originalStatus === 'ready'
            ? normalizeText(result.original_storage_path || result.storage_path, 1000)
            : normalizeText(result.storage_path, 1000),
        title: normalizeText(body.referenceTitle || body.reference_title || result.prompt || result.revised_prompt || '续作图片', 500)
    };
}

async function normalizeSubmitBodyReferences(supabase, {
    body = {},
    userId = '',
    site = ''
} = {}) {
    const normalizedBody = {
        ...body,
        referenceImages: normalizeReferenceImages(body)
    };
    const referenceImage = body.referenceImage || body.reference_image || {};
    const explicitReferenceUrl = normalizeText(
        body.referenceImageUrl || body.reference_image_url || referenceImage.url || referenceImage.imageUrl,
        4000
    );
    const explicitReferenceStoragePath = normalizeText(
        body.referenceImageStoragePath || body.reference_image_storage_path || referenceImage.storagePath,
        4000
    );
    const resolved = await resolveContinuationReferenceFromResult(supabase, {
        body,
        userId,
        site
    });

    if (resolved?.url && (!explicitReferenceUrl || isReferenceImageTransient(explicitReferenceUrl))) {
        normalizedBody.referenceImageUrl = resolved.url;
        normalizedBody.reference_image_url = resolved.url;
        normalizedBody.referenceImageStoragePath = resolved.storagePath;
        normalizedBody.reference_image_storage_path = resolved.storagePath;
        normalizedBody.referenceTitle = normalizeText(body.referenceTitle || body.reference_title || resolved.title, 500);
        normalizedBody.reference_title = normalizedBody.referenceTitle;
        normalizedBody.referenceImage = {
            ...(referenceImage && typeof referenceImage === 'object' && !Array.isArray(referenceImage) ? referenceImage : {}),
            url: resolved.url,
            imageUrl: resolved.url,
            storagePath: resolved.storagePath,
            title: normalizedBody.referenceTitle
        };
    } else {
        normalizedBody.referenceImageUrl = explicitReferenceUrl;
        normalizedBody.reference_image_url = explicitReferenceUrl;
        normalizedBody.referenceImageStoragePath = explicitReferenceStoragePath;
        normalizedBody.reference_image_storage_path = explicitReferenceStoragePath;
    }

    return normalizedBody;
}

function validateTaskPayload(payload = {}) {
    if (payload.mode === 'reverse' && !payload.reference_image_url && !payload.reference_image_storage_path) {
        const error = new Error('反推提示词需要先上传参考图片');
        error.statusCode = 400;
        error.code = 'reference_image_required';
        throw error;
    }

    if (payload.mode === 'image' && !payload.prompt) {
        const error = new Error('图片拓展需要输入提示词');
        error.statusCode = 400;
        error.code = 'prompt_required';
        throw error;
    }

    if ((payload.mode === 'text' || payload.mode === 'chat' || payload.mode === 'video') && !payload.prompt) {
        const error = new Error('请输入提示词');
        error.statusCode = 400;
        error.code = 'prompt_required';
        throw error;
    }
}

function getResultOriginalStatus(row = {}) {
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    const status = normalizeText(metadata.original_status || metadata.originalStatus, 40).toLowerCase();
    if (status) return status;
    return normalizeText(row.original_image_url, 4000) ? 'ready' : 'pending';
}

function serializeResult(row = {}) {
    const originalStatus = getResultOriginalStatus(row);
    const originalReady = originalStatus === 'ready' && Boolean(normalizeText(row.original_image_url, 4000));
    return {
        id: row.id || '',
        taskId: row.task_id || '',
        task_id: row.task_id || '',
        site: row.site || 'cn',
        resultIndex: Number(row.result_index || 0),
        result_index: Number(row.result_index || 0),
        imageUrl: row.image_url || '',
        image_url: row.image_url || '',
        originalImageUrl: originalReady ? row.original_image_url : '',
        original_image_url: originalReady ? row.original_image_url : '',
        storagePath: row.storage_path || '',
        storage_path: row.storage_path || '',
        originalStoragePath: originalReady ? row.original_storage_path || '' : '',
        original_storage_path: originalReady ? row.original_storage_path || '' : '',
        originalStatus,
        original_status: originalStatus,
        originalReady,
        original_ready: originalReady,
        previewReady: Boolean(row.image_url),
        preview_ready: Boolean(row.image_url),
        mimeType: row.mime_type || 'image/png',
        mime_type: row.mime_type || 'image/png',
        width: row.width ?? null,
        height: row.height ?? null,
        ratio: row.ratio || '',
        resolution: row.resolution || '',
        prompt: row.prompt || '',
        revisedPrompt: row.revised_prompt || '',
        revised_prompt: row.revised_prompt || '',
        seed: row.seed || '',
        metadata: row.metadata || {},
        createdAt: row.created_at || '',
        created_at: row.created_at || ''
    };
}

function serializeTask(row = {}, results = [], { env = process.env } = {}) {
    const serializedResults = (Array.isArray(results) ? results : []).map(serializeResult);
    const status = row.status || 'queued';
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    const referenceImages = Array.isArray(metadata.reference_images) ? metadata.reference_images : [];
    const estimatedPoints = normalizeBillablePoints(row.estimated_points, 0);
    const chargedPoints = normalizeBillablePoints(row.charged_points, 0);
    const queuePosition = normalizeOptionalQueueNumber(
        row.queue_position ?? metadata.queue_position ?? metadata.queuePosition,
        null
    );
    const estimatedWaitSeconds = normalizeOptionalQueueNumber(
        row.estimated_wait_seconds
            ?? row.queue_eta_seconds
            ?? metadata.estimated_wait_seconds
            ?? metadata.estimatedWaitSeconds
            ?? metadata.queue_eta_seconds
            ?? metadata.queueEtaSeconds,
        null
    );
    const cost = ['failed', 'cancelled', 'refunded'].includes(status)
        ? Math.max(0, chargedPoints)
        : (status === 'succeeded' ? chargedPoints : estimatedPoints);
    const serializedProviderId = normalizeProviderId(metadata.provider_id || metadata.providerId || metadata.model_provider_id || metadata.modelProviderId);
    const billingSync = getSub2ApiBillingSyncState(row, env);
    return {
        id: row.id || '',
        taskId: row.id || '',
        task_id: row.id || '',
        site: row.site || 'cn',
        userId: row.user_id || '',
        user_id: row.user_id || '',
        parentTaskId: row.parent_task_id || '',
        parent_task_id: row.parent_task_id || '',
        conversationId: row.conversation_id || '',
        conversation_id: row.conversation_id || '',
        clientTaskId: row.client_task_id || '',
        client_task_id: row.client_task_id || '',
        sourcePromptId: row.source_prompt_id || '',
        source_prompt_id: row.source_prompt_id || '',
        mode: row.mode || 'text',
        agentId: row.agent_id || '',
        agent_id: row.agent_id || '',
        agentSlug: row.agent_slug || '',
        agent_slug: row.agent_slug || '',
        billingMode: row.billing_mode || 'points',
        billing_mode: row.billing_mode || 'points',
        status,
        model: row.model || '',
        apiModelGroup: row.api_model_group || '',
        api_model_group: row.api_model_group || '',
        modelProviderId: serializedProviderId,
        model_provider_id: serializedProviderId,
        providerId: serializedProviderId,
        provider_id: serializedProviderId,
        ratio: row.ratio || '',
        resolution: row.resolution || '',
        quantity: Number(row.quantity || 1),
        prompt: row.prompt || '',
        negativePrompt: row.negative_prompt || '',
        negative_prompt: row.negative_prompt || '',
        referenceImageUrl: row.reference_image_url || '',
        reference_image_url: row.reference_image_url || '',
        referenceImageStoragePath: row.reference_image_storage_path || '',
        reference_image_storage_path: row.reference_image_storage_path || '',
        referenceTitle: row.reference_title || '',
        reference_title: row.reference_title || '',
        referenceImages,
        reference_images: referenceImages,
        resultPrompt: row.result_prompt || '',
        result_prompt: row.result_prompt || '',
        estimatedPoints,
        estimated_points: estimatedPoints,
        chargedPoints,
        charged_points: chargedPoints,
        billingSyncStatus: billingSync.status || '',
        billing_sync_status: billingSync.status || '',
        billingSyncMessage: billingSync.message || '',
        billing_sync_message: billingSync.message || '',
        billingSyncCheckedAt: billingSync.checkedAt || '',
        billing_sync_checked_at: billingSync.checkedAt || '',
        queuePosition,
        queue_position: queuePosition,
        estimatedWaitSeconds,
        estimated_wait_seconds: estimatedWaitSeconds,
        queueEtaSeconds: estimatedWaitSeconds,
        queue_eta_seconds: estimatedWaitSeconds,
        cost,
        apiBaseUrl: row.api_base_url || '',
        api_base_url: row.api_base_url || '',
        apiKeyTail: row.api_key_tail || '',
        api_key_tail: row.api_key_tail || '',
        tokenUsage: row.token_usage || {},
        token_usage: row.token_usage || {},
        inputTokens: Number(row.input_tokens || 0),
        input_tokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        output_tokens: Number(row.output_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
        total_tokens: Number(row.total_tokens || 0),
        providerTaskId: row.provider_task_id || '',
        provider_task_id: row.provider_task_id || '',
        errorCode: row.error_code || '',
        error_code: row.error_code || '',
        errorMessage: row.error_message || '',
        error_message: row.error_message || '',
        metadata,
        startedAt: row.started_at || '',
        started_at: row.started_at || '',
        completedAt: row.completed_at || '',
        completed_at: row.completed_at || '',
        createdAt: row.created_at || '',
        created_at: row.created_at || '',
        updatedAt: row.updated_at || '',
        updated_at: row.updated_at || '',
        images: serializedResults,
        results: serializedResults
    };
}

function getExpectedRecoverableResultCount(task = {}) {
    const mode = normalizeText(task.mode, 40).toLowerCase();
    if (mode === 'video') return 1;
    if (!['text', 'image', 'agent'].includes(mode)) return 0;
    return normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
}

function shouldRecoverRunningTaskWithResults(task = {}, results = []) {
    const status = normalizeText(task.status, 40).toLowerCase();
    if (status !== 'running' || !Array.isArray(results) || !results.length) return false;
    const expectedCount = getExpectedRecoverableResultCount(task);
    return expectedCount > 0 && results.length >= expectedCount;
}

async function maybeRecoverTaskWithResults(supabase, task = {}, results = []) {
    const status = normalizeText(task.status, 40).toLowerCase();
    const recoverableStatus = shouldRecoverRunningTaskWithResults(task, results)
        || (status === 'failed' && normalizeText(task.error_code, 160).startsWith('ai_image_'));
    if (!recoverableStatus || !Array.isArray(results) || !results.length) {
        return task;
    }

    try {
        const recovered = await recoverTaskFromExistingResults(supabase, task, {
            results,
            errorCode: task.error_code || (status === 'running'
                ? 'ai_image_public_running_result_recovery'
                : 'ai_image_public_result_recovery'),
            failOnRecoveryError: false
        });
        return recovered?.task || task;
    } catch (_) {
        return task;
    }
}

function normalizeQueueEstimateTask(row = {}) {
    return {
        id: normalizeText(row.id, 160),
        createdAt: Date.parse(row.created_at || row.createdAt || '') || 0,
        estimatedPoints: normalizeBillablePoints(row.estimated_points ?? row.estimatedPoints, 0)
    };
}

function compareQueueEstimatePriority(left = {}, right = {}) {
    const leftTask = normalizeQueueEstimateTask(left);
    const rightTask = normalizeQueueEstimateTask(right);
    if (leftTask.estimatedPoints !== rightTask.estimatedPoints) {
        return leftTask.estimatedPoints - rightTask.estimatedPoints;
    }
    if (leftTask.createdAt !== rightTask.createdAt) {
        return leftTask.createdAt - rightTask.createdAt;
    }
    return leftTask.id.localeCompare(rightTask.id);
}

function estimateQueueRuntimeSeconds(task = {}) {
    if (TEXT_VISION_MODES.has(String(task.mode || '').trim())) {
        return 20;
    }

    const resolutionMultiplier = {
        '4k': 2.6,
        '2k': 1.6,
        '1k': 1
    }[String(task.resolution || '').trim().toLowerCase()] || 1;
    const modeMultiplier = String(task.mode || '').trim() === 'image' ? 1.15 : 1;
    const quantity = normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
    return Math.round(DEFAULT_QUEUE_ESTIMATE_SECONDS * resolutionMultiplier * modeMultiplier * quantity);
}

function getQueueWorkerConcurrency(env = {}) {
    return readPositiveIntEnv(env, ['AI_IMAGE_WORKER_CONCURRENCY'], DEFAULT_QUEUE_WORKER_CONCURRENCY, {
        min: 1,
        max: 8
    });
}

function buildQueueEstimate(queuePosition, task = {}, { env = {} } = {}) {
    const normalizedPosition = normalizeOptionalQueueNumber(queuePosition, null);
    if (normalizedPosition === null) {
        return {
            queue_position: null,
            estimated_wait_seconds: null,
            queue_eta_seconds: null
        };
    }
    const estimatedWaitSeconds = Math.max(
        0,
        Math.ceil(Math.max(0, normalizedPosition - 1) / getQueueWorkerConcurrency(env)) * estimateQueueRuntimeSeconds(task)
    );
    return {
        queue_position: normalizedPosition,
        estimated_wait_seconds: estimatedWaitSeconds,
        queue_eta_seconds: estimatedWaitSeconds
    };
}

function attachQueueEstimateToTask(task = {}, estimate = {}) {
    if (!task || typeof task !== 'object') return task;
    const status = normalizeText(task.status, 40).toLowerCase();
    if (!['queued', 'running'].includes(status)) return task;

    const queuePosition = normalizeOptionalQueueNumber(estimate.queue_position ?? estimate.queuePosition, status === 'running' ? 0 : null);
    const estimatedWaitSeconds = normalizeOptionalQueueNumber(
        estimate.estimated_wait_seconds ?? estimate.estimatedWaitSeconds ?? estimate.queue_eta_seconds ?? estimate.queueEtaSeconds,
        status === 'running' ? 0 : null
    );
    if (queuePosition === null && estimatedWaitSeconds === null) return task;

    const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : {};
    return {
        ...task,
        queue_position: queuePosition,
        estimated_wait_seconds: estimatedWaitSeconds,
        queue_eta_seconds: estimatedWaitSeconds,
        metadata: {
            ...metadata,
            queue_position: queuePosition,
            estimated_wait_seconds: estimatedWaitSeconds,
            queue_eta_seconds: estimatedWaitSeconds
        }
    };
}

async function estimateQueueForTask(supabase, task = {}, { site = 'cn', env = {} } = {}) {
    const status = normalizeText(task.status, 40).toLowerCase();
    if (!task?.id || !['queued', 'running'].includes(status)) {
        return buildQueueEstimate(null, task, { env });
    }
    if (status === 'running') {
        return buildQueueEstimate(0, task, { env });
    }

    try {
        const { data, error } = await supabase
            .from('ai_image_tasks')
            .select('id, site, status, estimated_points, created_at')
            .eq('site', site || task.site || 'cn')
            .eq('status', 'queued')
            .order('estimated_points', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(200);
        if (error) throw error;
        const queued = (Array.isArray(data) ? data : [])
            .slice()
            .sort(compareQueueEstimatePriority);
        const index = queued.findIndex((row) => row.id === task.id);
        return buildQueueEstimate(index >= 0 ? index + 1 : queued.length + 1, task, { env });
    } catch (error) {
        if (!isMissingRelationError(error, 'ai_image_tasks')) {
            throw error;
        }
        return buildQueueEstimate(1, task, { env });
    }
}

async function estimateQueueForTasks(supabase, tasks = [], { site = 'cn', env = {} } = {}) {
    const rows = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
    const estimates = new Map();
    rows.forEach((task) => {
        if (normalizeText(task.status, 40).toLowerCase() === 'running') {
            estimates.set(task.id, buildQueueEstimate(0, task, { env }));
        }
    });

    const queuedTasks = rows.filter((task) => normalizeText(task.status, 40).toLowerCase() === 'queued');
    if (!queuedTasks.length) return estimates;

    try {
        const { data, error } = await supabase
            .from('ai_image_tasks')
            .select('id, site, status, estimated_points, created_at')
            .eq('site', site)
            .eq('status', 'queued')
            .order('estimated_points', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(200);
        if (error) throw error;
        const queued = (Array.isArray(data) ? data : [])
            .slice()
            .sort(compareQueueEstimatePriority);
        const indexById = new Map(queued.map((task, index) => [task.id, index]));
        queuedTasks.forEach((task) => {
            const index = indexById.has(task.id) ? indexById.get(task.id) : queued.length;
            estimates.set(task.id, buildQueueEstimate(Number(index) + 1, task, { env }));
        });
    } catch (error) {
        if (!isMissingRelationError(error, 'ai_image_tasks')) {
            throw error;
        }
        queuedTasks.forEach((task, index) => {
            estimates.set(task.id, buildQueueEstimate(index + 1, task, { env }));
        });
    }

    return estimates;
}

function serializeDownloadEvent(row = {}) {
    return {
        id: row.id || '',
        taskId: row.task_id || '',
        task_id: row.task_id || '',
        resultId: row.result_id || '',
        result_id: row.result_id || '',
        site: row.site || 'cn',
        imageUrl: row.image_url || '',
        image_url: row.image_url || '',
        originalImageUrl: row.original_image_url || row.image_url || '',
        original_image_url: row.original_image_url || row.image_url || '',
        storagePath: row.storage_path || '',
        storage_path: row.storage_path || '',
        originalStoragePath: row.original_storage_path || '',
        original_storage_path: row.original_storage_path || '',
        source: row.source || 'workbench',
        createdAt: row.created_at || '',
        created_at: row.created_at || ''
    };
}

function serializeTaskPrefs(rows = []) {
    const prefs = {
        deletedTaskIds: [],
        deleted_task_ids: [],
        pinnedTaskIds: [],
        pinned_task_ids: [],
        taskAccentById: {},
        task_accent_by_id: {}
    };
    const hiddenSet = new Set();
    const pinnedRows = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const taskId = normalizeText(row.task_id || row.taskId, 160);
        if (!taskId) return;
        if (row.hidden_at || row.hiddenAt) {
            hiddenSet.add(taskId);
        }
        if (row.pinned_at || row.pinnedAt) {
            pinnedRows.push({
                taskId,
                pinnedAt: normalizeText(row.pinned_at || row.pinnedAt, 120)
            });
        }
        const accent = normalizeText(row.accent, 40).toLowerCase();
        if (TASK_PREF_ACCENTS.has(accent)) {
            prefs.taskAccentById[taskId] = accent;
            prefs.task_accent_by_id[taskId] = accent;
        }
    });

    prefs.deletedTaskIds = Array.from(hiddenSet);
    prefs.deleted_task_ids = prefs.deletedTaskIds.slice();
    prefs.pinnedTaskIds = pinnedRows
        .sort((left, right) => String(right.pinnedAt || '').localeCompare(String(left.pinnedAt || '')))
        .map((row) => row.taskId);
    prefs.pinned_task_ids = prefs.pinnedTaskIds.slice();
    return prefs;
}

function normalizeTaskPrefAction(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase().replace(/_/g, '-');
    if (['hide', 'pin', 'unpin', 'accent', 'clear-accent'].includes(normalized)) return normalized;
    return '';
}

function normalizeTaskPrefIds(value = []) {
    const raw = Array.isArray(value) ? value : [value];
    const seen = new Set();
    return raw
        .map((item) => normalizeText(item, 160))
        .filter((item) => {
            if (!isUuid(item) || seen.has(item)) return false;
            seen.add(item);
            return true;
        })
        .slice(0, 100);
}

function sendError(sendJson, res, error) {
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode === 429 && error?.rateLimit) {
        const retryAfterSeconds = Number(error.rateLimit.retryAfterSeconds || 1);
        if (res && typeof res.setHeader === 'function') {
            res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
        }
    }
    return sendJson(res, statusCode, {
        success: false,
        message: error?.message || 'AI 图片工作台服务暂不可用',
        code: error?.code || (statusCode === 401 ? 'unauthorized' : 'ai_image_error'),
        retry_after_seconds: statusCode === 429 ? Math.max(1, Number(error?.rateLimit?.retryAfterSeconds || 1)) : undefined,
        scope: statusCode === 429 ? normalizeText(error?.scope || 'ai_image', 80) : undefined
    });
}

function serializeDiagnosticError(error = {}) {
    return {
        name: normalizeText(error?.name, 80),
        code: normalizeText(error?.code, 120),
        message: normalizeText(error?.message, 1000),
        details: normalizeText(error?.details, 1000),
        hint: normalizeText(error?.hint, 1000),
        statusCode: Number(error?.statusCode || error?.status || 0) || undefined
    };
}

function safeObject(value = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function shouldCaptureSub2ApiBillingForTask(task = {}) {
    if (normalizeText(task.billing_mode || task.billingMode, 40) !== 'points') return false;
    const pricing = safeObject(safeObject(task.metadata).pricing);
    const matchedRule = safeObject(pricing.matched_rule || pricing.matchedRule);
    return getAiImagePricingStrategy(matchedRule) === 'token_sub2api';
}

function buildSub2ApiUsageLookupPayloadFromTask(task = {}) {
    const metadata = safeObject(task.metadata);
    const pricingCharge = safeObject(metadata.pricing_charge || metadata.pricingCharge);
    const sub2api = safeObject(pricingCharge.sub2api || metadata.sub2api);
    const clientRequestId = normalizeText(
        metadata.sub2api_client_request_id
        || metadata.sub2apiClientRequestId
        || pricingCharge.client_request_id
        || pricingCharge.clientRequestId
        || sub2api.client_request_id
        || sub2api.clientRequestId
        || buildSub2ApiClientRequestId(task),
        160
    );
    return {
        id: normalizeText(task.provider_task_id || task.providerTaskId || metadata.provider_task_id || metadata.providerTaskId, 240),
        request_id: pricingCharge.request_id || pricingCharge.requestId || sub2api.request_id || sub2api.requestId || '',
        requestId: pricingCharge.request_id || pricingCharge.requestId || sub2api.request_id || sub2api.requestId || '',
        lookup_request_id: pricingCharge.lookup_request_id || pricingCharge.lookupRequestId || sub2api.lookup_request_id || sub2api.lookupRequestId || '',
        lookupRequestId: pricingCharge.lookup_request_id || pricingCharge.lookupRequestId || sub2api.lookup_request_id || sub2api.lookupRequestId || '',
        client_request_id: clientRequestId,
        clientRequestId: clientRequestId,
        sub2api_client_request_id: clientRequestId,
        sub2apiClientRequestId: clientRequestId,
        metadata,
        pricing_charge: pricingCharge,
        pricingCharge,
        sub2api
    };
}

function getExplicitSub2ApiClientRequestId(task = {}) {
    const metadata = safeObject(task.metadata);
    const pricingCharge = safeObject(metadata.pricing_charge || metadata.pricingCharge);
    const sub2api = safeObject(pricingCharge.sub2api || metadata.sub2api);
    return normalizeText(
        metadata.sub2api_client_request_id
        || metadata.sub2apiClientRequestId
        || pricingCharge.client_request_id
        || pricingCharge.clientRequestId
        || sub2api.client_request_id
        || sub2api.clientRequestId,
        160
    );
}

function getSub2ApiBillingSyncMetadata(task = {}) {
    const metadata = safeObject(task.metadata);
    const pricingCharge = safeObject(metadata.pricing_charge || metadata.pricingCharge);
    return safeObject(
        metadata.sub2api_billing_sync
        || metadata.sub2apiBillingSync
        || pricingCharge.sub2api_billing_sync
        || pricingCharge.sub2apiBillingSync
    );
}

function getTaskReferenceTimestampMs(task = {}) {
    const candidates = [
        task.completed_at,
        task.completedAt,
        task.updated_at,
        task.updatedAt,
        task.created_at,
        task.createdAt
    ];
    for (const candidate of candidates) {
        const parsed = Date.parse(candidate || '');
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

function getSub2ApiMissingUsageFinalizeMs(env = process.env) {
    return readPositiveIntEnv(env, [
        'AI_IMAGE_SUB2API_USAGE_FINALIZE_MISSING_AFTER_MS',
        'AI_IMAGE_SUB2API_BILLING_SYNC_FINALIZE_AFTER_MS'
    ], 5 * 60 * 1000, { min: 0, max: 24 * 60 * 60 * 1000 });
}

function shouldFinalizeMissingSub2ApiBilling(task = {}, env = process.env) {
    const referenceMs = getTaskReferenceTimestampMs(task);
    if (!referenceMs) return false;
    const finalizeAfterMs = getSub2ApiMissingUsageFinalizeMs(env);
    return Date.now() - referenceMs >= finalizeAfterMs;
}

function getSub2ApiBillingSyncMessage(status = '') {
    const normalized = normalizeText(status, 80).toLowerCase();
    if (normalized === 'not_found') return '未找到上游扣费明细';
    if (normalized === 'missing_request_id' || normalized === 'no_request_id') return '旧记录缺少扣费追踪ID';
    if (normalized === 'timeout' || normalized === 'unavailable') return '扣费暂未同步';
    if (normalized === 'settled') return '扣费已同步';
    return '扣费同步中';
}

function getSub2ApiBillingSyncState(task = {}, env = process.env) {
    if (!shouldCaptureSub2ApiBillingForTask(task)) {
        return {
            status: '',
            message: ''
        };
    }
    const chargedPoints = normalizeBillablePoints(task.charged_points ?? task.chargedPoints, 0);
    if (chargedPoints > 0) {
        return {
            status: 'settled',
            message: getSub2ApiBillingSyncMessage('settled')
        };
    }
    const taskStatus = normalizeText(task.status, 40).toLowerCase();
    if (['queued', 'running', 'processing'].includes(taskStatus)) {
        return {
            status: 'pending',
            message: getSub2ApiBillingSyncMessage('pending')
        };
    }
    const syncMetadata = getSub2ApiBillingSyncMetadata(task);
    const metadataStatus = normalizeText(syncMetadata.status || syncMetadata.reason, 80).toLowerCase();
    if (metadataStatus) {
        return {
            status: metadataStatus,
            message: normalizeText(syncMetadata.message, 200) || getSub2ApiBillingSyncMessage(metadataStatus),
            checkedAt: syncMetadata.checked_at || syncMetadata.checkedAt || ''
        };
    }
    if (!getExplicitSub2ApiClientRequestId(task) && shouldFinalizeMissingSub2ApiBilling(task, env)) {
        return {
            status: 'missing_request_id',
            message: getSub2ApiBillingSyncMessage('missing_request_id')
        };
    }
    return {
        status: 'pending',
        message: getSub2ApiBillingSyncMessage('pending')
    };
}

async function markSub2ApiBillingSyncUnresolved(supabase, task = {}, lookupPayload = {}, lookupResult = {}, {
    env = process.env
} = {}) {
    if (!supabase?.from || !task?.id) return task;
    const lookupStatus = normalizeText(lookupResult?.status, 80).toLowerCase();
    if (!['not_found', 'no_request_id'].includes(lookupStatus)) return task;
    if (!shouldFinalizeMissingSub2ApiBilling(task, env)) return task;

    const explicitClientRequestId = getExplicitSub2ApiClientRequestId(task);
    const status = explicitClientRequestId ? 'not_found' : 'missing_request_id';
    const syncMetadata = {
        status,
        reason: lookupStatus,
        message: getSub2ApiBillingSyncMessage(status),
        checked_at: new Date().toISOString(),
        client_request_id: explicitClientRequestId || lookupPayload.client_request_id || '',
        lookup_request_id: lookupPayload.lookup_request_id || lookupPayload.request_id || ''
    };
    const metadata = {
        ...safeObject(task.metadata),
        sub2api_billing_sync: syncMetadata
    };

    try {
        const { data, error } = await supabase
            .from('ai_image_tasks')
            .update({ metadata })
            .eq('id', task.id)
            .select(TASK_SELECT)
            .maybeSingle();
        if (error) return {
            ...task,
            metadata
        };
        return data || {
            ...task,
            metadata
        };
    } catch (_) {
        return {
            ...task,
            metadata
        };
    }
}

async function findExistingTaskPointDeduction(supabase, task = {}) {
    if (!supabase?.from || !task?.id || !task?.user_id) return 0;
    try {
        const { data, error } = await supabase
            .from('points_ledger')
            .select('amount')
            .eq('user_id', task.user_id)
            .eq('reference_id', task.id)
            .lt('amount', 0)
            .order('created_at', { ascending: false })
            .limit(1);
        if (error) return 0;
        const amount = Number(data?.[0]?.amount);
        return Number.isFinite(amount) ? Math.abs(amount) : 0;
    } catch (_) {
        return 0;
    }
}

async function deductReconciledTaskPoints(supabase, task = {}, amount = 0) {
    const normalizedAmount = normalizeBillablePoints(amount, 0);
    if (!supabase?.from || normalizedAmount <= 0 || !task?.id || !task?.user_id) {
        return {
            chargedPoints: 0,
            referenceId: ''
        };
    }
    const existingDeduction = await findExistingTaskPointDeduction(supabase, task);
    if (existingDeduction > 0) {
        return {
            chargedPoints: existingDeduction,
            referenceId: task.points_ledger_reference_id || task.id
        };
    }
    const { data, error } = await deductPointsForService({
        supabase,
        userId: task.user_id,
        amount: normalizedAmount,
        reason: 'AI 图片生成',
        referenceId: task.id,
        site: task.site || 'cn'
    });
    if (error) throw error;
    return {
        chargedPoints: normalizeBillablePoints(data?.deducted, normalizedAmount) || normalizedAmount,
        referenceId: task.id
    };
}

async function maybeReconcileSub2ApiActualCostTask(supabase, task = {}, {
    env = process.env,
    fetchImpl = globalThis.fetch
} = {}) {
    if (!supabase?.from || !task?.id) return task;
    if (!shouldCaptureSub2ApiBillingForTask(task)) return task;
    if (normalizeBillablePoints(task.charged_points ?? task.chargedPoints, 0) > 0) return task;
    const status = normalizeText(task.status, 40).toLowerCase();
    if (['queued', 'running', 'processing'].includes(status)) return task;

    let runtimeConfig = null;
    try {
        runtimeConfig = await resolveExecutorRuntimeConfig({ supabase, task, env });
    } catch (_) {
        return task;
    }
    if (!runtimeConfig?.configured) return task;

    const lookupPayload = buildSub2ApiUsageLookupPayloadFromTask(task);
    const reconcileLookupEnv = {
        ...env,
        AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: env.AI_IMAGE_SUB2API_RECONCILE_LOOKUP_ATTEMPTS
            || env.AI_IMAGE_SUB2API_USAGE_RECONCILE_ATTEMPTS
            || '1',
        AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: env.AI_IMAGE_SUB2API_RECONCILE_LOOKUP_INTERVAL_MS
            || env.AI_IMAGE_SUB2API_USAGE_RECONCILE_INTERVAL_MS
            || '0',
        AI_IMAGE_SUB2API_USAGE_LOOKUP_TIMEOUT_MS: env.AI_IMAGE_SUB2API_RECONCILE_TIMEOUT_MS
            || env.AI_IMAGE_SUB2API_USAGE_RECONCILE_TIMEOUT_MS
            || env.AI_IMAGE_SUB2API_USAGE_LOOKUP_TIMEOUT_MS
            || '300'
    };
    const usageLookupResult = await fetchSub2ApiUsageRecord({
        baseUrl: runtimeConfig.baseUrl,
        apiKey: runtimeConfig.apiKey,
        payload: lookupPayload,
        fetchImpl,
        env: reconcileLookupEnv,
        returnLookupResult: true
    });
    const usageRecord = usageLookupResult?.record || null;
    if (!usageRecord?.actual_cost) {
        return markSub2ApiBillingSyncUnresolved(supabase, task, lookupPayload, usageLookupResult, { env });
    }

    const usageWithBilling = attachSub2ApiBillingToUsage(task.token_usage || {}, usageRecord, null, lookupPayload);
    const chargeEstimate = calculateAiImageRuleChargePoints(task, usageWithBilling);
    const expectedPoints = normalizeBillablePoints(chargeEstimate.points, 0);
    if (expectedPoints <= 0) return task;
    const deduction = await deductReconciledTaskPoints(supabase, task, expectedPoints);
    const chargedPoints = normalizeBillablePoints(deduction.chargedPoints || expectedPoints, expectedPoints);
    if (chargedPoints <= 0) return task;

    const metadata = {
        ...safeObject(task.metadata),
        pricing_charge: {
            ...safeObject(chargeEstimate.pricing),
            reconciled: true,
            reconciled_at: new Date().toISOString(),
            sub2api: {
                ...safeObject(usageWithBilling.sub2api),
                request_id: usageRecord.request_id || usageWithBilling.sub2api?.request_id || '',
                lookup_request_id: usageRecord.lookup_request_id || usageWithBilling.sub2api?.lookup_request_id || ''
            }
        }
    };

    const { data, error } = await supabase
        .from('ai_image_tasks')
        .update({
            charged_points: chargedPoints,
            points_ledger_reference_id: deduction.referenceId || task.points_ledger_reference_id || task.id,
            token_usage: usageWithBilling,
            input_tokens: normalizePositiveInt(usageWithBilling.input_tokens || usageWithBilling.inputTokens || task.input_tokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
            output_tokens: normalizePositiveInt(usageWithBilling.output_tokens || usageWithBilling.outputTokens || task.output_tokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
            total_tokens: normalizePositiveInt(usageWithBilling.total_tokens || usageWithBilling.totalTokens || task.total_tokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
            metadata
        })
        .eq('id', task.id)
        .select(TASK_SELECT)
        .maybeSingle();
    if (error || !data) return task;
    return data;
}

function estimateTextTokens(value = '') {
    const normalized = normalizeText(value, 12000);
    if (!normalized) return 0;
    return Math.max(1, Math.ceil(normalized.length / 2.6));
}

function getChatMessageContentText(content = '') {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (!part || typeof part !== 'object') return '';
            return part.text || part.input_text || part.image_url?.url || part.imageUrl?.url || part.image_url || '';
        }).filter(Boolean).join('\n');
    }
    return '';
}

function normalizeChatMessages(value = []) {
    const rawMessages = Array.isArray(value) ? value : [];
    return rawMessages
        .map((message) => {
            const role = normalizeText(message?.role, 40).toLowerCase();
            if (!['user', 'assistant'].includes(role)) return null;
            const content = normalizeText(getChatMessageContentText(message?.content) || message?.text, 8000);
            if (!content) return null;
            const normalized = { role, content };
            const reasoningContent = normalizeText(message?.reasoning_content || message?.reasoningContent, 12000);
            if (role === 'assistant' && reasoningContent) {
                normalized.reasoning_content = reasoningContent;
            }
            return normalized;
        })
        .filter(Boolean);
}

function normalizeChatMemoryMode(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'model' || normalized === 'full' || normalized === 'context') return 'model';
    if (normalized === 'recent' || normalized === 'custom') return 'recent';
    return 'fast';
}

function estimateChatMessageTokens(message = {}) {
    return estimateTextTokens(`${message.role || ''}\n${getChatMessageContentText(message.content)}`) + 4;
}

function getChatMemoryLimits(body = {}, mode = 'fast') {
    const defaults = CHAT_MEMORY_MODE_LIMITS[mode] || CHAT_MEMORY_MODE_LIMITS.fast;
    const requestedMessages = normalizeInteger(body.memoryMessageLimit ?? body.memory_message_limit, defaults.messages, {
        min: 0,
        max: CHAT_MEMORY_MODE_LIMITS.model.messages
    });
    const requestedTokens = normalizePositiveInt(body.memoryTokenBudget || body.memory_token_budget, defaults.tokens, {
        min: 1000,
        max: CHAT_MEMORY_MODE_LIMITS.model.tokens
    });
    if (mode === 'recent') {
        return {
            messages: Math.min(CHAT_MEMORY_MODE_LIMITS.recent.messages, requestedMessages || defaults.messages),
            tokens: Math.min(CHAT_MEMORY_MODE_LIMITS.recent.tokens, requestedTokens || defaults.tokens)
        };
    }
    if (mode === 'model') {
        return {
            messages: Math.min(CHAT_MEMORY_MODE_LIMITS.model.messages, requestedMessages || defaults.messages),
            tokens: Math.min(CHAT_MEMORY_MODE_LIMITS.model.tokens, requestedTokens || defaults.tokens)
        };
    }
    return defaults;
}

function trimChatHistoryMessages(messages = [], {
    messageLimit = CHAT_MEMORY_MODE_LIMITS.fast.messages,
    tokenBudget = CHAT_MEMORY_MODE_LIMITS.fast.tokens
} = {}) {
    const limit = normalizeInteger(messageLimit, CHAT_MEMORY_MODE_LIMITS.fast.messages, {
        min: 0,
        max: CHAT_MEMORY_MODE_LIMITS.model.messages
    });
    const budget = normalizePositiveInt(tokenBudget, CHAT_MEMORY_MODE_LIMITS.fast.tokens, {
        min: 1000,
        max: CHAT_MEMORY_MODE_LIMITS.model.tokens
    });
    if (!limit) return [];

    const selected = [];
    let usedTokens = 0;
    const candidates = messages.slice(-limit);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const message = candidates[index];
        const messageTokens = estimateChatMessageTokens(message);
        if (selected.length && usedTokens + messageTokens > budget) break;
        selected.unshift(message);
        usedTokens += messageTokens;
    }
    return selected;
}

function buildWorkbenchChatSystemPrompt({ site = 'cn', model = '' } = {}) {
    const brand = site === 'intl' ? 'Zaoyoe' : 'FatherKey';
    const requestedModel = normalizeText(model, 120);
    return [
        `你是 ${brand} AI 工作台的文本对话助手。`,
        requestedModel ? `本次请求传给上游的 model 字段是：${requestedModel}。如果用户询问你使用的是什么模型、当前模型、模型名称或模型 ID，必须直接回答这个精确值，不要改写、泛化为供应商名称，也不要根据训练身份推测。` : '',
        '不要声称自己运行在 Codex CLI、终端式编码助手或任何与当前 FatherKey/Zaoyoe 工作台无关的环境中。',
        '保持上下文连续，优先直接回答用户问题。'
    ].filter(Boolean).join('\n');
}

function normalizeChatImageInputMode(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return CHAT_IMAGE_INPUT_MODES.has(normalized) ? normalized : 'auto';
}

function modelLikelySupportsChatImageInput(model = '', baseUrl = '') {
    return /gpt-4o|gpt-4\.1|gpt-5|o\d|gemini|claude|qwen-vl|vision|multimodal/i.test(`${model} ${baseUrl}`);
}

function normalizeOptionalBoolean(value) {
    if (value === true || value === false) return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return null;
}

function modelsListIncludesModel(models = [], model = '') {
    const key = normalizeText(model, 180).toLowerCase();
    if (!key) return false;
    return normalizePublicModelsList(models).some((item) => item.toLowerCase() === key);
}

function resolveChatSupportsImageInput({ billingMode = 'api', runtimeConfig = null, body = {}, model = '' } = {}) {
    if (billingMode === 'points') {
        return modelsListIncludesModel(runtimeConfig?.visionModels || runtimeConfig?.vision_models || [], model)
            ? true
            : null;
    }
    return normalizeOptionalBoolean(body.supportsImageInput ?? body.supports_image_input ?? null);
}

function shouldAttachChatImages({ imageInputMode = 'auto', model = '', baseUrl = '', supportsImageInput = null } = {}) {
    const normalized = normalizeChatImageInputMode(imageInputMode);
    if (normalized === 'off') return false;
    if (normalized === 'on') return true;
    const explicitSupport = normalizeOptionalBoolean(supportsImageInput);
    if (explicitSupport !== null) return explicitSupport;
    return modelLikelySupportsChatImageInput(model, baseUrl);
}

function normalizeChatImageReferences(body = {}) {
    const primaryUrl = normalizeText(body.referenceImageUrl || body.reference_image_url, 4000);
	    const references = normalizeReferenceImages(body)
	        .map((item) => normalizeText(item.url || item.imageUrl || item.image, 4000))
	        .filter(Boolean);
	    return Array.from(new Set([primaryUrl, ...references].filter(Boolean))).slice(0, MAX_REFERENCE_IMAGE_INPUTS);
	}

function normalizeChatAttachments(value = []) {
    const rawList = Array.isArray(value) ? value : [];
    const normalized = [];
    let totalChars = 0;
    for (const item of rawList) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const text = normalizeText(item.text || item.content || item.extractedText || item.extracted_text, MAX_CHAT_ATTACHMENT_TEXT_CHARS);
        if (!text) continue;
        const remainingChars = MAX_CHAT_ATTACHMENT_TOTAL_CHARS - totalChars;
        if (remainingChars <= 0) break;
        const clippedText = text.slice(0, remainingChars);
        normalized.push({
            name: normalizeText(item.name || item.fileName || item.file_name || '附件', 180) || '附件',
            mimeType: normalizeText(item.mimeType || item.mime_type || item.type, 120),
            size: normalizePositiveInt(item.size || item.bytes, 0, { min: 0, max: 80 * 1024 * 1024 }),
            text: clippedText
        });
        totalChars += clippedText.length;
        if (normalized.length >= MAX_CHAT_ATTACHMENT_COUNT) break;
    }
    return normalized;
}

function summarizeChatAttachments(attachments = []) {
    return normalizeChatAttachments(attachments).map((item) => ({
        name: item.name,
        mime_type: item.mimeType,
        size: item.size,
        chars: item.text.length
    }));
}

function buildChatAttachmentText(attachments = []) {
    const normalized = normalizeChatAttachments(attachments);
    if (!normalized.length) return '';
    return normalized.map((item, index) => [
        `附件 ${index + 1}：${item.name}${item.mimeType ? `（${item.mimeType}）` : ''}`,
        item.text
    ].join('\n')).join('\n\n---\n\n');
}

function buildChatUserContent({ prompt = '', imageUrls = [], attachments = [] } = {}) {
    const baseText = normalizeText(prompt, 8000);
    const attachmentText = buildChatAttachmentText(attachments);
    const text = attachmentText
        ? `${baseText || '请阅读以下附件。'}\n\n[用户上传的文档/PDF 文本内容]\n${attachmentText}`
        : baseText;
    const urls = (Array.isArray(imageUrls) ? imageUrls : [])
        .map((url) => normalizeText(url, 4000))
        .filter(Boolean)
        .slice(0, MAX_REFERENCE_IMAGE_INPUTS);
    if (!urls.length) return text;
    return [
        { type: 'text', text },
        ...urls.map((url) => ({
            type: 'image_url',
            image_url: { url }
        }))
    ];
}

function buildChatStreamMessages({ body = {}, prompt = '', model = '', baseUrl = '', site = 'cn', supportsImageInput = null } = {}) {
    const memoryMode = normalizeChatMemoryMode(body.memoryMode || body.memory_mode);
    const memoryLimits = getChatMemoryLimits(body, memoryMode);
    const historyMessages = trimChatHistoryMessages(
        normalizeChatMessages(body.messages || body.chatMessages || body.chat_messages || body.history),
        {
            messageLimit: memoryLimits.messages,
            tokenBudget: memoryLimits.tokens
        }
    );
    const currentPrompt = normalizeText(prompt || body.prompt || body.message || body.input, 8000);
    const systemPrompt = buildWorkbenchChatSystemPrompt({ site, model });
    const imageInputMode = normalizeChatImageInputMode(body.imageInputMode || body.image_input_mode);
    const imageUrls = shouldAttachChatImages({ imageInputMode, model, baseUrl, supportsImageInput })
        ? normalizeChatImageReferences(body)
        : [];
    const attachments = normalizeChatAttachments(body.chatAttachments || body.chat_attachments || body.attachments || body.files);
    const dedupedHistoryMessages = historyMessages.slice();
    const lastHistoryMessage = dedupedHistoryMessages[dedupedHistoryMessages.length - 1];
    if (lastHistoryMessage?.role === 'user' && lastHistoryMessage.content === currentPrompt) {
        dedupedHistoryMessages.pop();
    }
    return [
        {
            role: 'system',
            content: systemPrompt
        },
        ...dedupedHistoryMessages,
        {
            role: 'user',
            content: buildChatUserContent({ prompt: currentPrompt, imageUrls, attachments })
        }
    ];
}

function chatContentToGeminiParts(content = '') {
    if (typeof content === 'string') {
        return [{ text: content }];
    }
    if (!Array.isArray(content)) return [{ text: getChatMessageContentText(content) }];
    const parts = [];
    content.forEach((part) => {
        if (!part || typeof part !== 'object') return;
        const text = normalizeText(part.text || part.input_text, 8000);
        if (text) {
            parts.push({ text });
            return;
        }
        const imageUrl = normalizeText(part.image_url?.url || part.imageUrl?.url || part.image_url || part.url, 4000);
        if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
            parts.push({
                fileData: {
                    mimeType: 'image/png',
                    fileUri: imageUrl
                }
            });
        }
    });
    return parts.length ? parts : [{ text: getChatMessageContentText(content) }];
}

function chatContentToGeminiInteractionContent(content = '') {
    if (typeof content === 'string') {
        const text = normalizeText(content, 12000);
        return text ? [{ type: 'text', text }] : [];
    }
    if (!Array.isArray(content)) {
        const text = normalizeText(getChatMessageContentText(content), 12000);
        return text ? [{ type: 'text', text }] : [];
    }
    const blocks = [];
    content.forEach((part) => {
        if (!part || typeof part !== 'object') return;
        const text = normalizeText(part.text || part.input_text, 12000);
        if (text) {
            blocks.push({ type: 'text', text });
            return;
        }
        const imageUrl = normalizeText(part.image_url?.url || part.imageUrl?.url || part.image_url || part.url, 4000);
        if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
            blocks.push({
                type: 'image',
                uri: imageUrl,
                mime_type: 'image/png'
            });
        }
    });
    if (!blocks.length) {
        const text = normalizeText(getChatMessageContentText(content), 12000);
        if (text) blocks.push({ type: 'text', text });
    }
    return blocks;
}

function buildGeminiNativeChatRequest({ messages = [], thinkingLevel = '', includeThoughts = false, maxTokens = 420, model = '' } = {}) {
    const systemMessages = messages.filter((message) => message.role === 'system');
    const chatMessages = messages.filter((message) => message.role !== 'system');
    const input = chatMessages.map((message) => ({
        type: message.role === 'assistant' ? 'model_output' : 'user_input',
        content: chatContentToGeminiInteractionContent(message.content)
    })).filter((message) => message.content.length);
    const generationConfig = {
        max_output_tokens: maxTokens
    };
    if (thinkingLevel && supportsGeminiThinkingLevel(model)) {
        generationConfig.thinking_level = thinkingLevel;
        if (includeThoughts) generationConfig.thinking_summaries = 'auto';
    }
    return {
        model: normalizeText(model, 180).replace(/^models\//, ''),
        input,
        system_instruction: systemMessages.length
            ? systemMessages.map((message) => getChatMessageContentText(message.content)).filter(Boolean).join('\n\n')
            : undefined,
        generation_config: generationConfig,
        stream: true
    };
}

function buildGeminiNativeStreamUrl(baseUrl = '', model = '', apiKey = '') {
    const root = normalizeApiBaseUrl(baseUrl).replace(/\/+$/, '');
    const url = new URL(`${root}/interactions`);
    return url.toString();
}

function chatContentToOpenAiResponseContent(content = '', { assistant = false } = {}) {
    if (typeof content === 'string') {
        const text = normalizeText(content, 12000);
        return text ? [{ type: assistant ? 'output_text' : 'input_text', text }] : [];
    }
    if (!Array.isArray(content)) {
        const text = normalizeText(getChatMessageContentText(content), 12000);
        return text ? [{ type: assistant ? 'output_text' : 'input_text', text }] : [];
    }
    const blocks = [];
    content.forEach((part) => {
        if (!part || typeof part !== 'object') return;
        const text = normalizeText(part.text || part.input_text, 12000);
        if (text) {
            blocks.push({ type: assistant ? 'output_text' : 'input_text', text });
            return;
        }
        const imageUrl = normalizeText(part.image_url?.url || part.imageUrl?.url || part.image_url || part.url, 4000);
        if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
            blocks.push({ type: 'input_image', image_url: imageUrl });
        }
    });
    if (!blocks.length) {
        const text = normalizeText(getChatMessageContentText(content), 12000);
        if (text) blocks.push({ type: assistant ? 'output_text' : 'input_text', text });
    }
    return blocks;
}

function buildOpenAiResponsesRequest({ messages = [], reasoningEffort = '', serviceTier = '', maxTokens = 420, model = '' } = {}) {
    const input = messages.map((message) => {
        const role = message.role === 'assistant' ? 'assistant' : (message.role === 'system' ? 'system' : 'user');
        return {
            role,
            content: chatContentToOpenAiResponseContent(message.content, { assistant: role === 'assistant' })
        };
    }).filter((message) => message.content.length);
    const body = {
        model,
        input,
        stream: true,
        max_output_tokens: maxTokens
    };
    if (reasoningEffort) {
        body.reasoning = {
            effort: reasoningEffort,
            summary: 'auto'
        };
    }
    if (serviceTier) body.service_tier = serviceTier;
    return body;
}

function buildClaudeMessagesRequest({ messages = [], thinkingEnabled = false, thinkingBudget = 1024, maxTokens = 420, model = '' } = {}) {
    const systemMessages = messages.filter((message) => message.role === 'system');
    const chatMessages = messages.filter((message) => message.role !== 'system');
    const normalizedBudget = Math.max(1024, normalizePositiveInt(thinkingBudget, 1024, { min: 1024, max: 128000 }));
    const body = {
        model,
        max_tokens: thinkingEnabled ? Math.max(maxTokens, normalizedBudget + 1024) : maxTokens,
        messages: chatMessages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: getChatMessageContentText(message.content)
        })).filter((message) => message.content)
    };
    const systemText = systemMessages.map((message) => getChatMessageContentText(message.content)).filter(Boolean).join('\n\n');
    if (systemText) body.system = systemText;
    if (thinkingEnabled) {
        body.thinking = {
            type: 'enabled',
            budget_tokens: normalizedBudget
        };
    }
    return body;
}

function normalizeChatServiceTier(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'unset' || normalized === 'not_set' || normalized === 'none') return '';
    if (normalized === 'fast' || normalized === 'priority') return 'priority';
    if (CHAT_SERVICE_TIERS.has(normalized)) return normalized;
    return '';
}

function normalizeChatReasoningEffort(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'auto' || normalized === 'default' || normalized === 'unset' || normalized === 'not_set') return '';
    if (CHAT_REASONING_EFFORTS.has(normalized)) return normalized;
    return '';
}

function normalizeChatThinkingMode(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'show') return 'enabled';
    if (normalized === 'auto' || normalized === 'default') return 'unset';
    if (normalized === 'hide') return 'unset';
    return CHAT_THINKING_MODES.has(normalized) ? normalized : 'unset';
}

function normalizeGeminiThinkingLevel(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'standard') return 'medium';
    if (normalized === 'extended' || normalized === 'max') return 'high';
    return GEMINI_THINKING_LEVELS.has(normalized) ? normalized : '';
}

function supportsGeminiThinkingLevel(model = '') {
    return GEMINI_THINKING_LEVEL_CAPABLE_PATTERN.test(normalizeText(model, 180));
}

function normalizeClaudeThinkingBudget(value = '') {
    const normalized = String(value || '').replace(/[^\d]/g, '');
    return CLAUDE_THINKING_BUDGETS.has(normalized) ? Number(normalized) : 1024;
}

function buildChatPromptCacheKey({ userId = '', site = 'cn', model = '', apiKeyTail = '' } = {}) {
    const seed = [
        'ai-workbench-chat',
        normalizeText(site, 20) || 'cn',
        normalizeText(userId, 160) || 'anonymous',
        normalizeText(model, 120) || 'model',
        normalizeText(apiKeyTail, 16) || 'key'
    ].join(':');
    return `aiw-chat-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function normalizeStreamUsage(value = {}, { messages = [], output = '' } = {}) {
    const usage = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const inputTokens = normalizePositiveInt(
        usage.input_tokens || usage.inputTokens || usage.prompt_tokens || usage.promptTokens || usage.promptTokenCount
            || usage.total_input_tokens || usage.totalInputTokens,
        estimateTextTokens(messages.map((message) => getChatMessageContentText(message.content)).join('\n')),
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const outputTokens = normalizePositiveInt(
        usage.output_tokens || usage.outputTokens || usage.completion_tokens || usage.completionTokens || usage.candidatesTokenCount
            || usage.total_output_tokens || usage.totalOutputTokens,
        estimateTextTokens(output),
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const totalTokens = normalizePositiveInt(
        usage.total_tokens || usage.totalTokens || usage.totalTokenCount,
        inputTokens + outputTokens,
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const inputTokenDetails = safeObject(usage.input_tokens_details || usage.inputTokenDetails || usage.prompt_tokens_details || usage.promptTokenDetails);
    const cachedTokens = normalizePositiveInt(
        inputTokenDetails.cached_tokens || inputTokenDetails.cachedTokens,
        0,
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );

    const raw = {
        ...usage,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        inputTokens,
        outputTokens,
        totalTokens
    };

    return {
        raw,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cached_tokens: cachedTokens
    };
}

function extractChatDelta(payload = {}) {
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.delta === 'string') return payload.delta;
    if (typeof payload.text === 'string' && payload.type && /delta/i.test(String(payload.type))) return payload.text;
    if (typeof payload.output_text === 'string') return payload.output_text;

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    return choices.map((choice) => (
        choice?.delta?.content
        || choice?.delta?.text
        || choice?.message?.content
        || choice?.text
        || ''
    )).filter(Boolean).join('');
}

function extractChatFullOutputText(payload = {}) {
    if (!payload || typeof payload !== 'object') return '';
    const type = normalizeText(payload.type || payload.event_type, 120);
    if (!/(?:done|completed|message)$|\.done$|\.completed$/.test(type)) return '';
    const directText = normalizeText(payload.text || payload.output_text || payload.response?.output_text, 120000);
    if (directText) return directText;

    const collectContentText = (content) => {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return '';
        return content.map((part) => normalizeText(
            part?.text
            || part?.output_text
            || part?.content
            || '',
            120000
        )).filter(Boolean).join('');
    };
    const outputItems = Array.isArray(payload.output)
        ? payload.output
        : (Array.isArray(payload.response?.output) ? payload.response.output : []);
    const outputText = outputItems.map((item) => collectContentText(item?.content)).filter(Boolean).join('');
    if (outputText) return outputText;
    return collectContentText(payload.item?.content || payload.message?.content);
}

function extractGeminiTextDelta(payload = {}, { thoughts = false } = {}) {
    if (!payload || typeof payload !== 'object') return '';
    if (payload.event_type === 'step.delta') {
        const delta = payload.delta && typeof payload.delta === 'object' && !Array.isArray(payload.delta) ? payload.delta : {};
        if (thoughts && delta.type === 'thought_summary') {
            const content = Array.isArray(delta.content) ? delta.content : (delta.content ? [delta.content] : []);
            return content.map((part) => normalizeText(part?.text, 12000)).filter(Boolean).join('');
        }
        if (!thoughts && delta.type === 'text') return normalizeText(delta.text, 12000);
    }
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    return candidates.flatMap((candidate) => {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        return parts
            .filter((part) => Boolean(part?.thought) === Boolean(thoughts))
            .map((part) => normalizeText(part?.text, 12000))
            .filter(Boolean);
    }).join('');
}

function extractOpenAiResponsesDelta(payload = {}, { thoughts = false } = {}) {
    if (!payload || typeof payload !== 'object') return '';
    const type = normalizeText(payload.type || payload.event_type, 120);
    if (thoughts) {
        if (/reasoning.*(?:summary|text).*delta|summary.*delta/.test(type)) {
            return normalizeText(payload.delta || payload.text || payload.summary?.delta, 12000);
        }
        if (/reasoning/.test(type) && typeof payload.delta === 'string') return normalizeText(payload.delta, 12000);
        return '';
    }
    if (/output_text\.delta|text\.delta|message\.delta/.test(type)) {
        return normalizeText(payload.delta || payload.text, 12000);
    }
    return '';
}

function extractClaudeMessagesDelta(payload = {}, { thoughts = false } = {}) {
    if (!payload || typeof payload !== 'object') return '';
    if (payload.type === 'content_block_start') {
        const block = safeObject(payload.content_block);
        if (thoughts && block.type === 'thinking') return normalizeText(block.thinking, 12000);
        if (!thoughts && block.type === 'text') return normalizeText(block.text, 12000);
    }
    if (payload.type !== 'content_block_delta') return '';
    const delta = safeObject(payload.delta);
    if (thoughts && delta.type === 'thinking_delta') return normalizeText(delta.thinking, 12000);
    if (!thoughts && delta.type === 'text_delta') return normalizeText(delta.text, 12000);
    return '';
}

function extractChatReasoningDelta(payload = {}) {
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.reasoning_content === 'string') return payload.reasoning_content;
    if (typeof payload.reasoningContent === 'string') return payload.reasoningContent;

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    return choices.map((choice) => (
        choice?.delta?.reasoning_content
        || choice?.delta?.reasoningContent
        || choice?.delta?.reasoning
        || choice?.delta?.thinking
        || choice?.message?.reasoning_content
        || choice?.message?.reasoningContent
        || choice?.message?.reasoning
        || choice?.message?.thinking
        || choice?.reasoning_content
        || choice?.reasoning
        || choice?.thinking
        || ''
    )).filter(Boolean).join('');
}

function shouldEnableDeepSeekThinking(model = '', baseUrl = '') {
    return /deepseek/i.test(`${model} ${baseUrl}`);
}

function shouldEnableKimiThinking(model = '', baseUrl = '') {
    return /kimi|moonshot/i.test(`${model} ${baseUrl}`);
}

function shouldEnableQwenThinking(model = '', baseUrl = '') {
    return /qwen|dashscope|aliyuncs/i.test(`${model} ${baseUrl}`);
}

function shouldEnableGrokReasoning(model = '', baseUrl = '') {
    return /grok|xai|x\.ai/i.test(`${model} ${baseUrl}`);
}

function isOpenAiNativeBaseUrl(baseUrl = '') {
    try {
        return /(^|\.)api\.openai\.com$/i.test(new URL(normalizeApiBaseUrl(baseUrl)).host);
    } catch (_) {
        return false;
    }
}

function isClaudeNativeBaseUrl(baseUrl = '') {
    try {
        return /(^|\.)api\.anthropic\.com$/i.test(new URL(normalizeApiBaseUrl(baseUrl)).host);
    } catch (_) {
        return false;
    }
}

function shouldEnableOpenAiReasoning(model = '', baseUrl = '') {
    const normalizedModel = normalizeText(model, 160).toLowerCase();
    if (!/(openai|chatgpt|gpt|o\d)/i.test(`${model} ${baseUrl}`)) return false;
    return /(?:^|[-_/])o\d(?:[-_/]|$)/i.test(normalizedModel)
        || /^gpt-5(?:[.\-_]|$)/i.test(normalizedModel);
}

function normalizeDeepSeekReasoningEffort(value = '') {
    const normalized = normalizeChatReasoningEffort(value);
    if (normalized === 'xhigh') return 'max';
    if (normalized === 'max' || normalized === 'high') return normalized;
    return '';
}

function normalizeXaiReasoningEffort(value = '') {
    const normalized = normalizeChatReasoningEffort(value);
    return ['none', 'low', 'medium', 'high'].includes(normalized) ? normalized : '';
}

function normalizeOpenAiResponsesReasoningEffort(value = '') {
    const normalized = normalizeChatReasoningEffort(value);
    return ['minimal', 'low', 'medium', 'high'].includes(normalized) ? normalized : '';
}

function extractUpstreamErrorMessage(payload = {}, fallback = '上游对话模型返回错误') {
    if (!payload || typeof payload !== 'object') return fallback;
    return normalizeText(
        payload.error?.message
        || payload.message
        || payload.error
        || fallback,
        1000
    ) || fallback;
}

function writeSse(res, event, data = {}) {
    if (!res || typeof res.write !== 'function') return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getChatStreamIdleTimeoutMs(env = {}) {
    return normalizePositiveInt(env.AI_IMAGE_CHAT_STREAM_IDLE_TIMEOUT_MS, 15000, {
        min: 10,
        max: 120000
    });
}

function getChatStreamVisibleIdleTimeoutMs(env = {}) {
    return normalizePositiveInt(env.AI_IMAGE_CHAT_STREAM_VISIBLE_IDLE_TIMEOUT_MS, 1000, {
        min: 10,
        max: 30000
    });
}

function getChatStreamUsageReadyProbeMs(env = {}) {
    return normalizePositiveInt(env.AI_IMAGE_CHAT_STREAM_USAGE_READY_PROBE_MS, 1000, {
        min: 100,
        max: 10000
    });
}

function getChatStreamUsageReadyGraceMs(env = {}) {
    return normalizePositiveInt(env.AI_IMAGE_CHAT_STREAM_USAGE_READY_GRACE_MS, 1200, {
        min: 0,
        max: 30000
    });
}

async function readChatStreamChunk(reader, {
    idleTimeoutMs = 15000,
    enableIdleTimeout = false
} = {}) {
    if (!enableIdleTimeout || idleTimeoutMs <= 0) {
        return {
            chunk: await reader.read(),
            idleTimedOut: false
        };
    }

    let timeoutId = null;
    try {
        return await Promise.race([
            reader.read().then((chunk) => ({
                chunk,
                idleTimedOut: false
            })),
            new Promise((resolve) => {
                timeoutId = setTimeout(() => {
                    resolve({
                        chunk: null,
                        idleTimedOut: true
                    });
                }, idleTimeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function writeSseError(res, error, task = null) {
    writeSse(res, 'error', {
        success: false,
        code: error?.code || 'chat_stream_error',
        message: error?.message || '对话生成失败，请稍后重试',
        task: task ? serializeTask(task, []) : undefined
    });
}

function logChatStreamDiagnostic(event, payload = {}) {
    const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    try {
        console.info('[ai-image-chat-stream]', JSON.stringify({
            event,
            at: new Date().toISOString(),
            ...safePayload
        }));
    } catch (_) {
        // Diagnostics must never break user-facing streaming.
    }
}

function logSubmitDiagnostic(event, payload = {}) {
    const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    try {
        console.info('[ai-image-submit]', JSON.stringify({
            event,
            at: new Date().toISOString(),
            ...safePayload
        }));
    } catch (_) {
        // Diagnostics must never break task submission.
    }
}

function setSseHeaders(res) {
    if (!res || typeof res.setHeader !== 'function') return;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }
}

async function loadTaskResults(supabase, task = {}) {
    if (!task?.id) return [];

    const { data, error } = await supabase
        .from('ai_image_results')
        .select(RESULT_SELECT)
        .eq('task_id', task.id)
        .eq('user_id', task.user_id)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

function createAiImageHandlers({
    admin,
    env = process.env,
    fetchImpl = globalThis.fetch,
    uploadImageBuffer,
    requestSecurity = {}
} = {}) {
    const {
        getOptionalSupabaseAdmin,
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin || {};
    const {
        applyRateLimitHeaders,
        resolveClientIp,
        takeRateLimitToken
    } = requestSecurity || {};

    async function resolveAuthenticatedContext(req) {
        if (typeof requireAuthenticatedUser !== 'function') {
            const error = new Error('AI 图片工作台服务暂不可用');
            error.statusCode = 503;
            throw error;
        }

        const auth = await requireAuthenticatedUser(req);
        const supabase = auth?.adminSupabase
            || auth?.supabase
            || (typeof getOptionalSupabaseAdmin === 'function' ? getOptionalSupabaseAdmin() : null);

        if (!auth?.user?.id || !supabase?.from) {
            const error = new Error('AI 图片工作台服务暂不可用');
            error.statusCode = 503;
            throw error;
        }

        return {
            user: auth.user,
            supabase
        };
    }

    async function resolveOptionalSupabase() {
        const supabase = typeof getOptionalSupabaseAdmin === 'function'
            ? getOptionalSupabaseAdmin()
            : null;
        if (!supabase?.from) {
            const error = new Error('AI 图片工作台服务暂不可用');
            error.statusCode = 503;
            throw error;
        }
        return supabase;
    }

    function getClientIp(req) {
        if (typeof resolveClientIp === 'function') {
            return resolveClientIp(req, { env }) || 'unknown';
        }
        const forwarded = normalizeText(req?.headers?.['x-forwarded-for'] || req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress, 160);
        return forwarded.split(',')[0]?.trim() || 'unknown';
    }

    async function consumeRateLimit({ supabase, key, limit, windowMs, scope, res }) {
        if (typeof takeRateLimitToken !== 'function') {
            return DEFAULT_RATE_LIMIT_HEADERS;
        }

        const result = await takeRateLimitToken({
            supabase,
            env,
            key,
            limit,
            windowMs
        });
        applyOptionalRateLimitHeaders(applyRateLimitHeaders, res, result);
        if (result?.allowed === false) {
            throw buildRateLimitedError(scope, result);
        }
        return result;
    }

    async function consumeAiImageRateLimits({
        req,
        res,
        supabase,
        userId = '',
        site = 'cn',
        action = 'submit',
        mode = '',
        billingMode = '',
        model = '',
        resolution = '',
        quantity = 1,
        resourceId = ''
    } = {}) {
        const rateLimitConfig = await loadAiImageGuardrailsFromSystemConfig(supabase, {
            site,
            env
        });
        const config = rateLimitConfig[action] || {};
        const clientIp = normalizeRateLimitKeyPart(getClientIp(req));
        const normalizedSite = normalizeRateLimitKeyPart(site, 'cn');
        const normalizedUser = normalizeRateLimitKeyPart(userId);
        const normalizedMode = normalizeRateLimitKeyPart(mode || action);
        const normalizedBillingMode = normalizeRateLimitKeyPart(billingMode || 'none');
        const normalizedModel = normalizeRateLimitKeyPart(model || 'default');
        const normalizedResolution = normalizeRateLimitKeyPart(resolution || 'none');
        const normalizedResource = normalizeRateLimitKeyPart(resourceId || 'none');
        const checks = [];

        if (config.global) {
            checks.push({
                scope: `${action}:global`,
                key: `ai-image:${action}:global:${normalizedSite}`,
                ...config.global
            });
        }
        if (config.ip) {
            checks.push({
                scope: `${action}:ip`,
                key: `ai-image:${action}:ip:${normalizedSite}:${clientIp}`,
                ...config.ip
            });
        }
        if (config.user) {
            checks.push({
                scope: `${action}:user`,
                key: `ai-image:${action}:user:${normalizedSite}:${normalizedUser}`,
                ...config.user
            });
        }
        if (action === 'submit' && config.heavyUser && isHeavyImageRequest({ mode, resolution, quantity })) {
            checks.push({
                scope: `${action}:heavy_user`,
                key: `ai-image:${action}:heavy-user:${normalizedSite}:${normalizedUser}:${normalizedResolution}`,
                ...config.heavyUser
            });
        }
        if (action === 'submit' && config.model) {
            checks.push({
                scope: `${action}:model`,
                key: `ai-image:${action}:model:${normalizedSite}:${normalizedUser}:${normalizedBillingMode}:${normalizedMode}:${normalizedModel}:${normalizedResolution}`,
                ...config.model
            });
        }
        if (action === 'download' && config.resource && resourceId) {
            checks.push({
                scope: `${action}:resource`,
                key: `ai-image:${action}:resource:${normalizedSite}:${normalizedUser}:${normalizedResource}`,
                ...config.resource
            });
        }

        for (const check of checks) {
            // eslint-disable-next-line no-await-in-loop
            await consumeRateLimit({
                supabase,
                key: check.key,
                limit: check.limit,
                windowMs: check.windowMs,
                scope: check.scope,
                res
            });
        }
    }

    async function countUserTasksByStatus(supabase, {
        userId,
        site,
        status,
        limit
    } = {}) {
        const { data, error } = await supabase
            .from('ai_image_tasks')
            .select('id')
            .eq('user_id', userId)
            .eq('site', site)
            .eq('status', status)
            .limit(Math.max(1, Number(limit || 1)));
        if (error) throw error;
        return Array.isArray(data) ? data.length : 0;
    }

    async function assertUserTaskCapacity(supabase, { userId, site } = {}) {
        const rateLimitConfig = await loadAiImageGuardrailsFromSystemConfig(supabase, {
            site,
            env
        });
        const limits = rateLimitConfig.tasks;
        const [runningCount, queuedCount] = await Promise.all([
            countUserTasksByStatus(supabase, {
                userId,
                site,
                status: 'running',
                limit: limits.running
            }),
            countUserTasksByStatus(supabase, {
                userId,
                site,
                status: 'queued',
                limit: limits.queued
            })
        ]);
        if (runningCount >= limits.running) {
            const error = new Error('当前已有任务正在生成，请等待其中一个完成后再提交');
            error.statusCode = 429;
            error.code = 'ai_image_user_running_limit';
            error.scope = 'task:running';
            error.rateLimit = {
                ...DEFAULT_RATE_LIMIT_HEADERS,
                allowed: false,
                limit: limits.running,
                remaining: 0,
                retryAfterSeconds: 15,
                resetAt: Date.now() + 15_000
            };
            throw error;
        }

        if (queuedCount >= limits.queued) {
            const error = new Error('当前排队任务较多，请先等待或取消部分任务');
            error.statusCode = 429;
            error.code = 'ai_image_user_queue_limit';
            error.scope = 'task:queued';
            error.rateLimit = {
                ...DEFAULT_RATE_LIMIT_HEADERS,
                allowed: false,
                limit: limits.queued,
                remaining: 0,
                retryAfterSeconds: 20,
                resetAt: Date.now() + 20_000
            };
            throw error;
        }

        if (runningCount + queuedCount >= limits.active) {
            const error = new Error('当前未完成任务较多，请稍后再提交');
            error.statusCode = 429;
            error.code = 'ai_image_user_active_limit';
            error.scope = 'task:active';
            error.rateLimit = {
                ...DEFAULT_RATE_LIMIT_HEADERS,
                allowed: false,
                limit: limits.active,
                remaining: 0,
                retryAfterSeconds: 20,
                resetAt: Date.now() + 20_000
            };
            throw error;
        }
    }

    async function submitHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const submitDiagnostics = {
            route: 'submit'
        };
        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const rawBody = typeof parseJsonBody === 'function'
                ? await parseJsonBody(req)
                : (req.body && typeof req.body === 'object' ? req.body : {});
            const site = normalizeSite(rawBody.site);
            Object.assign(submitDiagnostics, {
                userId: user.id,
                site,
                requestedMode: normalizeText(rawBody.mode || rawBody.taskMode || rawBody.task_mode, 40),
                requestedOutput: normalizeText(rawBody.output || rawBody.outputMode || rawBody.output_mode, 40),
                requestedModel: normalizeText(rawBody.model || rawBody.imageModel || rawBody.image_model || rawBody.apiModel || rawBody.api_model, 120),
                requestedModelGroup: normalizeText(rawBody.apiModelGroup || rawBody.api_model_group || rawBody.modelGroup || rawBody.model_group, 80),
                clientTaskId: normalizeText(rawBody.clientTaskId || rawBody.client_task_id, 160)
            });
            const body = await normalizeSubmitBodyReferences(supabase, {
                body: rawBody,
                userId: user.id,
                site
            });
            const billingMode = normalizeBillingMode(body.billingMode || body.billing_mode);
            submitDiagnostics.billingMode = billingMode || normalizeText(body.billingMode || body.billing_mode, 40);
            if (!billingMode) {
                logSubmitDiagnostic('submit_rejected', {
                    ...submitDiagnostics,
                    code: 'billing_mode_required',
                    message: '请选择计费方式'
                });
                return sendJson(res, 400, {
                    success: false,
                    message: '请选择计费方式',
                    code: 'billing_mode_required'
                });
            }

            const mode = inferMode(body);
            const model = resolveModel({ body, mode });
            const modelGroup = resolveModelGroup({ body, mode });
            const providerId = normalizeProviderId(body.providerId || body.provider_id || body.modelProviderId || body.model_provider_id);
            Object.assign(submitDiagnostics, {
                mode,
                model,
                modelGroup,
                providerId,
                ratio: normalizeText(body.ratio || body.aspectRatio || body.aspect_ratio || body.videoSettings?.ratio || body.videoSettings?.aspectRatio, 20),
                resolution: normalizeText(body.resolution || body.size || body.videoSettings?.resolution, 20)
            });
            logSubmitDiagnostic('submit_received', submitDiagnostics);
            const apiBaseUrl = billingMode === 'api'
                ? await resolveApiBaseUrlFromAdminConfig(supabase, body.apiBaseUrl || body.api_base_url, { site, env })
                : '';
            const resolvedUserApiKey = billingMode === 'api'
                ? await resolveUserApiKeyForRequest(supabase, {
                    userId: user.id,
                    site,
                    apiBaseUrl,
                    apiKeyInput: body.apiKey || body.api_key,
                    env
                })
                : {
                    apiKey: '',
                    apiKeyTail: '',
                    apiKeyFingerprint: '',
                    storedApiKey: null
                };
            const apiKey = resolvedUserApiKey.apiKey;

            const previewPayload = buildTaskPayload({
                body,
                userId: user.id,
                site,
                mode,
                billingMode,
                model,
                modelGroup,
                apiBaseUrl,
                apiKeyTail: resolvedUserApiKey.apiKeyTail,
                apiKeyFingerprint: resolvedUserApiKey.apiKeyFingerprint,
                providerId,
                estimatedPoints: 0
            });
            validateTaskPayload(previewPayload);
            await consumeAiImageRateLimits({
                req,
                res,
                supabase,
                userId: user.id,
                site,
                action: 'submit',
                mode,
                billingMode,
                model,
                resolution: previewPayload.resolution || '',
                quantity: previewPayload.quantity || 1
            });
            await assertUserTaskCapacity(supabase, {
                userId: user.id,
                site
            });

            const pricingEstimate = billingMode === 'points'
                ? await estimatePointsFromRules(supabase, {
                    site,
                    mode,
                    billingMode,
                    model,
                    providerId,
                    resolution: previewPayload.resolution || '1k',
                    ratio: previewPayload.ratio || '1:1',
                    quantity: previewPayload.quantity || 1
                })
                : buildPricingEstimatePayload({
                    estimatedPoints: 0,
                    source: 'not_points_billing',
                    site,
                    mode,
                    billingMode,
                    model,
                    providerId,
                    resolution: previewPayload.resolution || '1k',
                    ratio: previewPayload.ratio || '1:1',
                    quantity: previewPayload.quantity || 1
                });
            const estimatedPoints = pricingEstimate.estimatedPoints;
            const taskPayload = buildTaskPayload({
                body,
                userId: user.id,
                site,
                mode,
                billingMode,
                model,
                modelGroup,
                apiBaseUrl,
                apiKeyTail: resolvedUserApiKey.apiKeyTail,
                apiKeyFingerprint: resolvedUserApiKey.apiKeyFingerprint,
                providerId,
                estimatedPoints,
                pricing: pricingEstimate.pricing
            });
            Object.assign(submitDiagnostics, {
                normalizedRatio: taskPayload.ratio || '',
                normalizedResolution: taskPayload.resolution || '',
                normalizedQuantity: taskPayload.quantity || 1,
                referenceImageCount: Number(taskPayload.metadata?.reference_image_count || 0),
                videoDuration: taskPayload.metadata?.video_duration || '',
                videoAudio: taskPayload.metadata?.video_audio ?? '',
                videoWatermark: taskPayload.metadata?.video_watermark ?? '',
                videoCameraFixed: taskPayload.metadata?.video_camera_fixed ?? ''
            });

            const { data, error } = await supabase
                .from('ai_image_tasks')
                .insert(taskPayload)
                .select(TASK_SELECT)
                .single();

            if (error || !data) {
                const dbError = new Error(error?.message || '创建生成任务失败');
                dbError.statusCode = 500;
                dbError.code = error?.code || 'ai_image_task_insert_failed';
                dbError.details = error?.details || '';
                dbError.hint = error?.hint || '';
                throw dbError;
            }
            logSubmitDiagnostic('submit_inserted', {
                ...submitDiagnostics,
                taskId: data.id,
                status: data.status,
                estimatedPoints: data.estimated_points
            });

            if (billingMode === 'api') {
                const executorOptions = {
                    apiKey,
                    baseUrl: apiBaseUrl,
                    model,
                    fetchImpl,
                    env
                };
                if (typeof uploadImageBuffer === 'function') {
                    executorOptions.uploadImageBuffer = uploadImageBuffer;
                }

                const execution = await executeAiImageTask({
                    supabase,
                    task: data,
                    executor: createOpenAiCompatibleApiExecutor(executorOptions)
                });
                const results = execution.results?.length
                    ? execution.results
                    : await loadTaskResults(supabase, execution.task);

                return sendJson(res, 200, {
                    success: execution.task?.status === 'succeeded',
                    task: serializeTask(execution.task, results),
                    task_id: execution.task?.id || data.id,
                    status: execution.task?.status || data.status,
                    estimated_points: normalizeBillablePoints(execution.task?.estimated_points ?? data.estimated_points, 0),
                    storedApiKey: resolvedUserApiKey.storedApiKey,
                    stored_api_key: resolvedUserApiKey.storedApiKey,
                    error: execution.error || null
                });
            }

            if (billingMode === 'points' && mode === 'chat') {
                const execution = await executeAiImageTask({
                    supabase,
                    task: data,
                    executor: createOpenAiCompatibleImageExecutor({ supabase, fetchImpl, env })
                });

                return sendJson(res, 200, {
                    success: execution.task?.status === 'succeeded',
                    task: serializeTask(execution.task, []),
                    task_id: execution.task?.id || data.id,
                    status: execution.task?.status || data.status,
                    estimated_points: normalizeBillablePoints(execution.task?.estimated_points ?? data.estimated_points, 0),
                    error: execution.error || null
                });
            }

            const queueEstimate = await estimateQueueForTask(supabase, data, { site, env });
            const estimatedTask = attachQueueEstimateToTask(data, queueEstimate);

            return sendJson(res, 200, {
                success: true,
                task: serializeTask(estimatedTask, []),
                task_id: data.id,
                status: data.status,
                estimated_points: normalizeBillablePoints(data.estimated_points, 0),
                queue_position: queueEstimate.queue_position,
                estimated_wait_seconds: queueEstimate.estimated_wait_seconds,
                queue_eta_seconds: queueEstimate.queue_eta_seconds
            });
        } catch (error) {
            logSubmitDiagnostic('submit_failed_before_response', {
                ...submitDiagnostics,
                statusCode: Number(error?.statusCode) || 500,
                code: error?.code || '',
                message: error?.message || 'AI 图片工作台服务暂不可用',
                error: serializeDiagnosticError(error)
            });
            return sendError(sendJson, res, error);
        }
    }

    async function chatStreamHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        let task = null;
        let streamStarted = false;
        let streamSupabase = null;
        const chatDiagnostics = {
            route: 'chat-stream'
        };
        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            streamSupabase = supabase;
            const rawBody = typeof parseJsonBody === 'function'
                ? await parseJsonBody(req)
                : (req.body && typeof req.body === 'object' ? req.body : {});
            const site = normalizeSite(rawBody.site);
            Object.assign(chatDiagnostics, {
                userId: user.id,
                site,
                requestedMode: normalizeText(rawBody.mode || rawBody.taskMode || rawBody.task_mode, 40),
                requestedOutput: normalizeText(rawBody.output || rawBody.outputMode || rawBody.output_mode, 40),
                requestedModel: normalizeText(rawBody.model || rawBody.chatModel || rawBody.chat_model || rawBody.apiModel || rawBody.api_model, 120),
                requestedModelGroup: normalizeText(rawBody.apiModelGroup || rawBody.api_model_group || rawBody.modelGroup || rawBody.model_group, 80),
                clientTaskId: normalizeText(rawBody.clientTaskId || rawBody.client_task_id, 160),
                promptChars: normalizeText(rawBody.prompt || rawBody.message || rawBody.input, 8000).length,
                messageCount: Array.isArray(rawBody.messages) ? rawBody.messages.length : 0
            });
            const body = await normalizeSubmitBodyReferences(supabase, {
                body: rawBody,
                userId: user.id,
                site
            });
            const billingMode = normalizeBillingMode(body.billingMode || body.billing_mode);
            chatDiagnostics.billingMode = billingMode || normalizeText(body.billingMode || body.billing_mode, 40);
            if (!billingMode) {
                logChatStreamDiagnostic('submit_rejected', {
                    ...chatDiagnostics,
                    code: 'billing_mode_required',
                    message: '请选择计费方式'
                });
                const error = new Error('请选择计费方式');
                error.statusCode = 400;
                error.code = 'billing_mode_required';
                throw error;
            }

            const mode = 'chat';
            const model = resolveModel({ body, mode });
            const modelGroup = resolveModelGroup({ body, mode });
            const providerId = normalizeProviderId(body.providerId || body.provider_id || body.modelProviderId || body.model_provider_id);
            Object.assign(chatDiagnostics, {
                mode,
                model,
                modelGroup,
                providerId
            });
            logChatStreamDiagnostic('submit_received', chatDiagnostics);
            const apiBaseUrl = billingMode === 'api'
                ? await resolveApiBaseUrlFromAdminConfig(supabase, body.apiBaseUrl || body.api_base_url, { site, env })
                : '';
            const resolvedUserApiKey = billingMode === 'api'
                ? await resolveUserApiKeyForRequest(supabase, {
                    userId: user.id,
                    site,
                    apiBaseUrl,
                    apiKeyInput: body.apiKey || body.api_key,
                    env
                })
                : {
                    apiKey: '',
                    apiKeyTail: '',
                    apiKeyFingerprint: '',
                    storedApiKey: null
                };
            const apiKey = resolvedUserApiKey.apiKey;
            const pricingEstimate = billingMode === 'points'
                ? await estimatePointsFromRules(supabase, {
                    site,
                    mode,
                    billingMode,
                    model,
                    providerId,
                    resolution: '1k',
                    ratio: '1:1',
                    quantity: 1
                })
                : buildPricingEstimatePayload({
                    estimatedPoints: 0,
                    source: 'not_points_billing',
                    site,
                    mode,
                    billingMode,
                    model,
                    providerId,
                    resolution: '1k',
                    ratio: '1:1',
                    quantity: 1
                });

            const startedAt = new Date().toISOString();
            const previewPayload = {
                ...buildTaskPayload({
                    body,
                    userId: user.id,
                    site,
                    mode,
                    billingMode,
                    model,
                    modelGroup,
                    apiBaseUrl,
                    apiKeyTail: resolvedUserApiKey.apiKeyTail,
                    apiKeyFingerprint: resolvedUserApiKey.apiKeyFingerprint,
                    providerId,
                    estimatedPoints: pricingEstimate.estimatedPoints,
                    pricing: pricingEstimate.pricing
                }),
                status: 'running',
                started_at: startedAt,
                error_code: '',
                error_message: ''
            };
            validateTaskPayload(previewPayload);
            await consumeAiImageRateLimits({
                req,
                res,
                supabase,
                userId: user.id,
                site,
                action: 'submit',
                mode,
                billingMode,
                model,
                resolution: '',
                quantity: 1
            });
            await assertUserTaskCapacity(supabase, {
                userId: user.id,
                site
            });

            const { data, error } = await supabase
                .from('ai_image_tasks')
                .insert(previewPayload)
                .select(TASK_SELECT)
                .single();
            if (error || !data) {
                const dbError = new Error(error?.message || '创建对话任务失败');
                dbError.statusCode = 500;
                throw dbError;
            }

            task = data;
            logChatStreamDiagnostic('task_inserted', {
                ...chatDiagnostics,
                task_id: task.id,
                status: task.status,
                estimatedPoints: task.estimated_points
            });

            setSseHeaders(res);
            streamStarted = true;
            writeSse(res, 'task', {
                success: true,
                task: serializeTask(task, []),
                task_id: task.id,
                status: 'running',
                storedApiKey: resolvedUserApiKey.storedApiKey,
                stored_api_key: resolvedUserApiKey.storedApiKey
            });

	            const prompt = normalizeText(body.prompt || body.message || body.input, 8000);
	            const requestedServiceTier = normalizeText(body.serviceTier || body.service_tier || env.AI_IMAGE_CHAT_SERVICE_TIER || '', 40).toLowerCase() || 'unset';
	            const serviceTier = normalizeChatServiceTier(body.serviceTier || body.service_tier || env.AI_IMAGE_CHAT_SERVICE_TIER || '');
	            const rawReasoningEffort = normalizeText(body.reasoningEffort || body.reasoning_effort, 40).toLowerCase();
	            const envReasoningEffort = normalizeText(env.AI_IMAGE_CHAT_REASONING_EFFORT, 40).toLowerCase();
	            const requestedReasoningEffort = rawReasoningEffort || envReasoningEffort || 'auto';
	            const reasoningEffort = normalizeChatReasoningEffort(rawReasoningEffort || envReasoningEffort);
	            const requestedGeminiThinkingLevel = normalizeText(body.geminiThinkingLevel || body.gemini_thinking_level || env.AI_IMAGE_CHAT_GEMINI_THINKING_LEVEL || '', 40).toLowerCase() || 'medium';
	            const geminiThinkingLevel = normalizeGeminiThinkingLevel(requestedGeminiThinkingLevel);
	            const requestedClaudeThinkingBudget = normalizeText(body.claudeThinkingBudget || body.claude_thinking_budget || env.AI_IMAGE_CHAT_CLAUDE_THINKING_BUDGET || '', 40) || '1024';
	            const claudeThinkingBudget = normalizeClaudeThinkingBudget(requestedClaudeThinkingBudget);
	            const thinkingMode = normalizeChatThinkingMode(body.thinkingMode || body.thinking_mode);
	            const imageInputMode = normalizeChatImageInputMode(body.imageInputMode || body.image_input_mode);
	            const runtimeConfig = billingMode === 'points'
	                ? await resolveExecutorRuntimeConfig({ supabase, task, env })
	                : null;
            if (billingMode === 'points' && !runtimeConfig?.configured) {
                const error = new Error('AI 图片文本/视觉模型 API Key 或 Base URL 未配置');
                error.statusCode = 503;
                error.code = 'ai_image_model_not_configured';
                throw error;
            }
	            const upstreamBaseUrl = billingMode === 'points' ? runtimeConfig.baseUrl : apiBaseUrl;
	            const upstreamApiKey = billingMode === 'points' ? runtimeConfig.apiKey : apiKey;
	            const upstreamRequestModel = billingMode === 'points' ? runtimeConfig.model : model;
	            const providerSource = billingMode === 'points' ? runtimeConfig.source : 'user-api';
	            const supportsImageInput = resolveChatSupportsImageInput({
	                billingMode,
	                runtimeConfig,
	                body,
	                model: upstreamRequestModel
	            });
	            const deepSeekCapable = shouldEnableDeepSeekThinking(upstreamRequestModel, upstreamBaseUrl);
	            const kimiThinkingCapable = shouldEnableKimiThinking(upstreamRequestModel, upstreamBaseUrl);
	            const qwenThinkingCapable = shouldEnableQwenThinking(upstreamRequestModel, upstreamBaseUrl);
	            const grokReasoningCapable = shouldEnableGrokReasoning(upstreamRequestModel, upstreamBaseUrl);
	            const openAiReasoningCapable = shouldEnableOpenAiReasoning(upstreamRequestModel, upstreamBaseUrl);
	            const geminiNativeCapable = isGeminiNativeBaseUrl(upstreamBaseUrl);
	            const openAiNativeCapable = isOpenAiNativeBaseUrl(upstreamBaseUrl);
	            const claudeNativeCapable = isClaudeNativeBaseUrl(upstreamBaseUrl);
	            const upstreamProvider = geminiNativeCapable
	                ? 'gemini-native'
	                : (openAiNativeCapable ? 'openai-native' : (claudeNativeCapable ? 'claude-native' : 'openai-compatible'));
	            const deepSeekThinkingType = deepSeekCapable && ['enabled', 'disabled'].includes(thinkingMode) ? thinkingMode : '';
	            const kimiThinkingEnabled = kimiThinkingCapable && ['enabled', 'disabled'].includes(thinkingMode) ? thinkingMode === 'enabled' : null;
	            const qwenThinkingEnabled = qwenThinkingCapable && ['enabled', 'disabled'].includes(thinkingMode) ? thinkingMode === 'enabled' : null;
	            const geminiThinkingLevelCapable = geminiNativeCapable && supportsGeminiThinkingLevel(upstreamRequestModel);
	            const geminiThoughtsEnabled = geminiThinkingLevelCapable && Boolean(geminiThinkingLevel);
	            const claudeThinkingEnabled = claudeNativeCapable && thinkingMode === 'enabled';
	            const thinkingReasoningEnabled = deepSeekThinkingType === 'enabled' || kimiThinkingEnabled === true || qwenThinkingEnabled === true || geminiThoughtsEnabled || claudeThinkingEnabled || (openAiNativeCapable && Boolean(normalizeOpenAiResponsesReasoningEffort(reasoningEffort)));
	            const upstreamReasoningEffort = deepSeekCapable && reasoningEffort
	                ? normalizeDeepSeekReasoningEffort(reasoningEffort)
	                : (grokReasoningCapable ? normalizeXaiReasoningEffort(reasoningEffort) : (openAiReasoningCapable ? (openAiNativeCapable ? normalizeOpenAiResponsesReasoningEffort(reasoningEffort) : reasoningEffort) : ''));
	            const messages = buildChatStreamMessages({ body, prompt, model: upstreamRequestModel, baseUrl: upstreamBaseUrl, site, supportsImageInput });
	            const attachedImageCount = Array.isArray(messages[messages.length - 1]?.content)
	                ? messages[messages.length - 1].content.filter((part) => part?.type === 'image_url').length
	                : 0;
	            const chatAttachmentSummary = summarizeChatAttachments(body.chatAttachments || body.chat_attachments || body.attachments || body.files);
	            const chatAttachmentChars = chatAttachmentSummary.reduce((sum, item) => sum + (Number(item.chars || 0) || 0), 0);
            const promptCacheKey = buildChatPromptCacheKey({
                userId: user.id,
                site,
                model: upstreamRequestModel,
                apiKeyTail: task.api_key_tail || getApiKeyTail(upstreamApiKey)
            });
            const sub2ApiClientRequestId = isSub2ApiGatewayBaseUrl(upstreamBaseUrl)
                ? buildSub2ApiClientRequestId(task)
                : '';
            const sub2ApiClientRequestHeaders = sub2ApiClientRequestId
                ? { 'X-Client-Request-ID': sub2ApiClientRequestId }
                : {};
            const upstreamStartedAt = Date.now();
	            const maxTokens = normalizePositiveInt(env.AI_IMAGE_CHAT_MAX_TOKENS, 420, {
	                min: 64,
	                max: kimiThinkingEnabled === true ? 64000 : 2000
	            });
            const requestBody = {
                model: upstreamRequestModel,
		                messages,
		                stream: true,
		                prompt_cache_key: promptCacheKey,
	                stream_options: {
	                    include_usage: true
	                },
	                max_tokens: kimiThinkingEnabled === true && maxTokens < 16000 ? 16000 : maxTokens
	            };
		            if (upstreamReasoningEffort) {
		                requestBody.reasoning_effort = upstreamReasoningEffort;
		            }
	            if (serviceTier) {
	                requestBody.service_tier = serviceTier;
	            }
		            if (deepSeekThinkingType) {
		                requestBody.thinking = { type: deepSeekThinkingType };
		            }
		            if (kimiThinkingEnabled !== null) {
		                requestBody.thinking = { type: kimiThinkingEnabled ? 'enabled' : 'disabled' };
		            }
		            if (qwenThinkingEnabled !== null) {
		                requestBody.enable_thinking = qwenThinkingEnabled;
		            }
	            const upstreamRequest = (() => {
	                if (geminiNativeCapable) {
	                    return {
	                        body: buildGeminiNativeChatRequest({
	                            messages,
	                            thinkingLevel: geminiThinkingLevel,
	                            includeThoughts: geminiThoughtsEnabled,
	                            maxTokens: requestBody.max_tokens,
	                            model: upstreamRequestModel
	                        }),
	                        url: buildGeminiNativeStreamUrl(upstreamBaseUrl, upstreamRequestModel, upstreamApiKey),
	                        headers: {
	                            'Content-Type': 'application/json',
	                            Accept: 'text/event-stream',
	                            'x-goog-api-key': upstreamApiKey,
	                            ...sub2ApiClientRequestHeaders
	                        }
	                    };
	                }
	                if (openAiNativeCapable) {
	                    return {
	                        body: buildOpenAiResponsesRequest({
	                            messages,
	                            reasoningEffort: upstreamReasoningEffort,
	                            serviceTier,
	                            maxTokens: requestBody.max_tokens,
	                            model: upstreamRequestModel
	                        }),
	                        url: `${normalizeApiBaseUrl(upstreamBaseUrl).replace(/\/+$/, '')}/responses`,
	                        headers: {
	                            Authorization: `Bearer ${upstreamApiKey}`,
	                            'Content-Type': 'application/json',
	                            Accept: 'text/event-stream',
	                            ...sub2ApiClientRequestHeaders
	                        }
	                    };
	                }
	                if (claudeNativeCapable) {
	                    return {
	                        body: buildClaudeMessagesRequest({
	                            messages,
	                            thinkingEnabled: claudeThinkingEnabled,
	                            thinkingBudget: claudeThinkingBudget,
	                            maxTokens: requestBody.max_tokens,
	                            model: upstreamRequestModel
	                        }),
	                        url: `${normalizeApiBaseUrl(upstreamBaseUrl).replace(/\/+$/, '')}/messages`,
	                        headers: {
	                            'x-api-key': upstreamApiKey,
	                            'anthropic-version': env.ANTHROPIC_VERSION || '2023-06-01',
	                            'Content-Type': 'application/json',
	                            Accept: 'text/event-stream',
	                            ...sub2ApiClientRequestHeaders
	                        }
	                    };
	                }
	                return {
	                    body: requestBody,
	                    url: `${upstreamBaseUrl}/chat/completions`,
	                    headers: {
	                        Authorization: `Bearer ${upstreamApiKey}`,
	                        'Content-Type': 'application/json',
	                        Accept: 'text/event-stream',
	                        ...sub2ApiClientRequestHeaders
	                    }
	                };
	            })();
	            logChatStreamDiagnostic('upstream_request', {
                task_id: task.id,
                billing_mode: billingMode,
                provider_source: providerSource,
                provider_model: upstreamRequestModel,
                base_host: (() => {
                    try {
                        return new URL(upstreamBaseUrl).host;
                    } catch (_) {
                        return '';
                    }
                })(),
                thinking_mode: thinkingMode,
                thinking_request_type: requestBody.thinking?.type || '',
	                enable_thinking: requestBody.enable_thinking ?? null,
	                reasoning_effort: requestBody.reasoning_effort || '',
	                upstream_provider: upstreamProvider,
	                openai_native: openAiNativeCapable,
	                claude_native: claudeNativeCapable,
	                claude_thinking_enabled: claudeThinkingEnabled,
	                claude_thinking_budget: claudeThinkingBudget,
	                gemini_native: geminiNativeCapable,
	                gemini_thinking_level_capable: geminiThinkingLevelCapable,
	                gemini_thinking_level: geminiThinkingLevel,
	                service_tier: requestBody.service_tier || '',
                max_tokens: requestBody.max_tokens,
                message_count: messages.length,
                memory_message_count: Math.max(0, messages.length - 2),
	                attached_image_count: attachedImageCount,
                attached_file_count: chatAttachmentSummary.length,
                attached_file_chars: chatAttachmentChars,
                sub2api_client_request_id: sub2ApiClientRequestId
            });
	            const upstreamResponse = await fetchImpl(upstreamRequest.url, {
	                method: 'POST',
	                headers: upstreamRequest.headers,
	                body: JSON.stringify(upstreamRequest.body)
	            });
            const upstreamFirstResponseMs = Date.now() - upstreamStartedAt;

            if (!upstreamResponse.ok) {
                const errorPayload = await upstreamResponse.json().catch(async () => ({
                    message: await upstreamResponse.text().catch(() => '')
                }));
                const upstreamError = new Error(extractUpstreamErrorMessage(errorPayload, `上游对话模型返回 HTTP ${upstreamResponse.status}`));
                upstreamError.statusCode = upstreamResponse.status || 502;
                upstreamError.code = 'chat_stream_upstream_error';
                throw upstreamError;
            }

            const decoder = new TextDecoder();
            const reader = upstreamResponse.body?.getReader ? upstreamResponse.body.getReader() : null;
            if (!reader) {
                const error = new Error('上游对话模型没有返回可读取的流');
                error.statusCode = 502;
                error.code = 'chat_stream_unreadable';
                throw error;
            }

            let buffer = '';
            let outputText = '';
            let reasoningText = '';
            let providerTaskId = '';
            let upstreamModel = '';
            let usage = {};
            let firstTokenMs = 0;
            let upstreamSseDataLines = 0;
            let upstreamReasoningPayloads = 0;
            let upstreamReasoningChars = 0;
            let upstreamContentPayloads = 0;
            let upstreamContentChars = 0;
            let firstReasoningMs = 0;
            const streamIdleTimeoutMs = getChatStreamIdleTimeoutMs(env);
            const streamVisibleIdleTimeoutMs = getChatStreamVisibleIdleTimeoutMs(env);
            const streamUsageReadyProbeMs = getChatStreamUsageReadyProbeMs(env);
            const streamUsageReadyGraceMs = getChatStreamUsageReadyGraceMs(env);
            let streamIdleTimedOut = false;
            let streamVisibleIdleTimedOut = false;
            let streamUsageReadyFinished = false;
            let lastUserVisibleAt = 0;
            let sub2apiUsageProbeAt = 0;
            let sub2apiUsageReadyAt = 0;
            let sub2apiUsageLookupMissLogged = false;
            const captureSub2ApiBilling = shouldCaptureSub2ApiBillingForTask(task);
            let sub2apiUsageRecord = null;
            const visibleIdleLookupEnv = {
                ...env,
                AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: '1',
                AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: '0',
                AI_IMAGE_SUB2API_USAGE_LOOKUP_TIMEOUT_MS: env.AI_IMAGE_SUB2API_STREAM_LOOKUP_TIMEOUT_MS
                    || env.AI_IMAGE_SUB2API_USAGE_LOOKUP_TIMEOUT_MS
                    || '300'
            };
            const finalUsageLookupEnv = {
                ...env,
                AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS: env.AI_IMAGE_SUB2API_STREAM_FINAL_LOOKUP_ATTEMPTS
                    || env.AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS
                    || '1',
                AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS: env.AI_IMAGE_SUB2API_STREAM_FINAL_LOOKUP_INTERVAL_MS
                    || env.AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS
                    || '0',
                AI_IMAGE_SUB2API_USAGE_LOOKUP_TIMEOUT_MS: env.AI_IMAGE_SUB2API_STREAM_FINAL_LOOKUP_TIMEOUT_MS
                    || env.AI_IMAGE_SUB2API_STREAM_LOOKUP_TIMEOUT_MS
                    || env.AI_IMAGE_SUB2API_USAGE_LOOKUP_TIMEOUT_MS
                    || '700'
            };
            const upstreamDeltaKeySamples = [];
            const processLine = (line = '') => {
                const trimmed = String(line || '').trim();
                if (!trimmed || trimmed.startsWith(':')) return false;
                if (!trimmed.startsWith('data:')) return false;
                const dataText = trimmed.slice(5).trim();
                if (!dataText) return false;
                if (dataText === '[DONE]') return true;
                upstreamSseDataLines += 1;
                let payload = null;
                try {
                    payload = JSON.parse(dataText);
                } catch (_) {
                    return false;
                }
                if (payload?.error) {
                    const upstreamError = new Error(extractUpstreamErrorMessage(payload));
                    upstreamError.statusCode = 502;
                    upstreamError.code = 'chat_stream_upstream_error';
                    throw upstreamError;
                }
                providerTaskId = normalizeText(payload.id || providerTaskId, 240);
	                upstreamModel = normalizeText(
	                    payload.model
	                    || payload.response?.model
	                    || payload.choices?.[0]?.model
	                    || (geminiNativeCapable || openAiNativeCapable || claudeNativeCapable ? upstreamRequestModel : '')
	                    || upstreamModel,
	                    160
	                );
	                if (payload.usage || payload.usageMetadata || payload.metadata?.total_usage || payload.message?.usage) {
	                    usage = payload.usage || payload.usageMetadata || payload.metadata?.total_usage || payload.message?.usage;
	                }
	                if (upstreamDeltaKeySamples.length < 8 && geminiNativeCapable && Array.isArray(payload.candidates)) {
	                    payload.candidates.forEach((candidate) => {
	                        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
	                        const keys = parts.flatMap((part) => Object.keys(part || {})).sort();
	                        if (keys.length) upstreamDeltaKeySamples.push(keys);
	                    });
	                }
	                if (upstreamDeltaKeySamples.length < 8 && Array.isArray(payload.choices)) {
	                    payload.choices.forEach((choice) => {
                        const deltaPayload = choice?.delta || choice?.message || choice || {};
                        if (!deltaPayload || typeof deltaPayload !== 'object' || Array.isArray(deltaPayload)) return;
                        const keys = Object.keys(deltaPayload).sort();
                        if (keys.length) upstreamDeltaKeySamples.push(keys);
                    });
                }
			                const upstreamReasoningDelta = geminiNativeCapable
			                    ? extractGeminiTextDelta(payload, { thoughts: true })
			                    : (openAiNativeCapable
			                        ? extractOpenAiResponsesDelta(payload, { thoughts: true })
			                        : (claudeNativeCapable
			                            ? extractClaudeMessagesDelta(payload, { thoughts: true })
			                            : extractChatReasoningDelta(payload)));
                if (upstreamReasoningDelta) {
                    upstreamReasoningPayloads += 1;
                    upstreamReasoningChars += upstreamReasoningDelta.length;
                    if (!firstReasoningMs) firstReasoningMs = Date.now() - upstreamStartedAt;
                }
                if (thinkingReasoningEnabled && upstreamReasoningDelta) {
                    reasoningText += upstreamReasoningDelta;
                    lastUserVisibleAt = Date.now();
                    writeSse(res, 'reasoning', {
                        delta: upstreamReasoningDelta,
                        task_id: task.id
                    });
                }
	                let delta = geminiNativeCapable
	                    ? extractGeminiTextDelta(payload, { thoughts: false })
	                    : (openAiNativeCapable
	                        ? extractOpenAiResponsesDelta(payload, { thoughts: false })
	                        : (claudeNativeCapable
	                            ? extractClaudeMessagesDelta(payload, { thoughts: false })
	                            : extractChatDelta(payload)));
                if (!delta) {
                    const fullOutputText = extractChatFullOutputText(payload);
                    if (fullOutputText && fullOutputText !== outputText) {
                        delta = fullOutputText.startsWith(outputText)
                            ? fullOutputText.slice(outputText.length)
                            : (outputText ? '' : fullOutputText);
                    }
                }
                if (delta) {
                    upstreamContentPayloads += 1;
                    upstreamContentChars += delta.length;
                    if (!firstTokenMs) firstTokenMs = Date.now() - upstreamStartedAt;
                    outputText += delta;
                    lastUserVisibleAt = Date.now();
                    writeSse(res, 'delta', {
                        delta,
                        task_id: task.id
                    });
                }
                return false;
            };
            const lookupSub2ApiUsageOnce = async () => {
                if (captureSub2ApiBilling && !sub2apiUsageRecord) {
                    sub2apiUsageRecord = await fetchSub2ApiUsageRecord({
                        baseUrl: upstreamBaseUrl,
                        apiKey: upstreamApiKey,
                        response: upstreamResponse,
                        payload: {
                            id: providerTaskId,
                            client_request_id: sub2ApiClientRequestId,
                            clientRequestId: sub2ApiClientRequestId
                        },
                        fetchImpl,
                        env: visibleIdleLookupEnv
                    });
                    if (sub2apiUsageRecord?.actual_cost && !sub2apiUsageReadyAt) {
                        sub2apiUsageReadyAt = Date.now();
                    }
                }
                return sub2apiUsageRecord;
            };
            const logSub2ApiUsageLookupMiss = () => {
                if (sub2apiUsageLookupMissLogged || !captureSub2ApiBilling) return;
                sub2apiUsageLookupMissLogged = true;
                const hints = getSub2ApiUsageRequestIds(upstreamResponse, {
                    id: providerTaskId,
                    client_request_id: sub2ApiClientRequestId,
                    clientRequestId: sub2ApiClientRequestId
                });
                logChatStreamDiagnostic('sub2api_usage_lookup_miss', {
                    task_id: task.id,
                    provider_model: upstreamRequestModel,
                    provider_task_id: providerTaskId,
                    client_request_id: sub2ApiClientRequestId,
                    candidate_request_ids: hints.requestIds.slice(0, 12),
                    response_x_request_id: getResponseHeader(upstreamResponse, 'x-request-id') || getResponseHeader(upstreamResponse, 'X-Request-Id'),
                    response_request_id: getResponseHeader(upstreamResponse, 'request-id'),
                    response_x_client_request_id: getResponseHeader(upstreamResponse, 'x-client-request-id')
                });
            };
            const maybeFinishAfterVisibleIdle = async () => {
                if (!outputText || !lastUserVisibleAt) return false;
                const visibleIdleMs = Date.now() - lastUserVisibleAt;
                if (visibleIdleMs < streamVisibleIdleTimeoutMs) return false;
                if (visibleIdleMs >= streamIdleTimeoutMs) {
                    streamIdleTimedOut = true;
                    streamVisibleIdleTimedOut = true;
                    return true;
                }

                if (sub2apiUsageRecord?.actual_cost) {
                    if (streamUsageReadyGraceMs > 0 && Date.now() - sub2apiUsageReadyAt < streamUsageReadyGraceMs) {
                        return false;
                    }
                    streamIdleTimedOut = true;
                    streamVisibleIdleTimedOut = true;
                    streamUsageReadyFinished = true;
                    return true;
                }

                if (captureSub2ApiBilling && !sub2apiUsageRecord) {
                    const now = Date.now();
                    if (!sub2apiUsageProbeAt || now - sub2apiUsageProbeAt >= streamVisibleIdleTimeoutMs) {
                        sub2apiUsageProbeAt = now;
                        // eslint-disable-next-line no-await-in-loop
                        await lookupSub2ApiUsageOnce();
                    }
                    if (sub2apiUsageRecord?.actual_cost) {
                        if (streamUsageReadyGraceMs > 0 && Date.now() - sub2apiUsageReadyAt < streamUsageReadyGraceMs) {
                            return false;
                        }
                        streamIdleTimedOut = true;
                        streamVisibleIdleTimedOut = true;
                        streamUsageReadyFinished = true;
                        return true;
                    }
                }

                return false;
            };

            let done = false;
            while (!done) {
                // eslint-disable-next-line no-await-in-loop
                const readResult = await readChatStreamChunk(reader, {
                    idleTimeoutMs: streamIdleTimeoutMs,
                    enableIdleTimeout: upstreamContentPayloads > 0 || Boolean(outputText)
                });
                if (readResult.idleTimedOut) {
                    streamIdleTimedOut = true;
                    break;
                }
                const chunk = readResult.chunk;
                if (chunk.done) break;
                buffer += decoder.decode(chunk.value, { stream: true });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (processLine(line)) {
                        done = true;
                        break;
                    }
                    // eslint-disable-next-line no-await-in-loop
                    if (await maybeFinishAfterVisibleIdle()) {
                        done = true;
                        break;
                    }
                }
                if (!done) {
                    // eslint-disable-next-line no-await-in-loop
                    if (await maybeFinishAfterVisibleIdle()) {
                        done = true;
                    }
                }
            }
            if (buffer.trim()) {
                processLine(buffer);
            }
            if (streamIdleTimedOut || streamVisibleIdleTimedOut) {
                await reader.cancel().catch(() => {});
            }

            if (captureSub2ApiBilling && !sub2apiUsageRecord) {
                sub2apiUsageRecord = await fetchSub2ApiUsageRecord({
                    baseUrl: upstreamBaseUrl,
                    apiKey: upstreamApiKey,
                    response: upstreamResponse,
                    payload: {
                        id: providerTaskId,
                        client_request_id: sub2ApiClientRequestId,
                        clientRequestId: sub2ApiClientRequestId
                    },
                    fetchImpl,
                    env: finalUsageLookupEnv
                });
                if (!sub2apiUsageRecord) logSub2ApiUsageLookupMiss();
            }
            const usageWithBilling = captureSub2ApiBilling
                ? attachSub2ApiBillingToUsage(usage, sub2apiUsageRecord, upstreamResponse, {
                    id: providerTaskId,
                    client_request_id: sub2ApiClientRequestId,
                    clientRequestId: sub2ApiClientRequestId
                })
                : usage;
            const normalizedUsage = normalizeStreamUsage(usageWithBilling, { messages, output: outputText });
            const existingMetadata = safeObject(task.metadata);
            const upstreamTotalMs = Math.max(0, Date.now() - upstreamStartedAt);
            const upstreamFirstResponseSafeMs = Math.max(0, upstreamFirstResponseMs);
            const reasoningDiagnostic = {
                expected: thinkingReasoningEnabled,
	                request_thinking_type: requestBody.thinking?.type || '',
	                request_enable_thinking: requestBody.enable_thinking ?? null,
	                request_reasoning_effort: requestBody.reasoning_effort || '',
	                request_gemini_thinking_level: geminiThinkingLevel,
	                gemini_thinking_level_capable: geminiThinkingLevelCapable,
	                sse_data_lines: upstreamSseDataLines,
                reasoning_payloads: upstreamReasoningPayloads,
                reasoning_chars: upstreamReasoningChars,
                content_payloads: upstreamContentPayloads,
                content_chars: upstreamContentChars,
                first_reasoning_ms: Math.max(0, firstReasoningMs),
                first_content_ms: Math.max(0, firstTokenMs),
                visible_idle_timed_out: streamVisibleIdleTimedOut,
                visible_idle_timeout_ms: streamVisibleIdleTimeoutMs,
                usage_ready_finished: streamUsageReadyFinished,
                usage_ready_probe_ms: streamUsageReadyProbeMs,
                usage_ready_grace_ms: streamUsageReadyGraceMs,
                delta_key_samples: upstreamDeltaKeySamples.slice(0, 8)
            };
            logChatStreamDiagnostic('upstream_response', {
                task_id: task.id,
                provider_model: upstreamRequestModel,
                provider_response_model: upstreamModel,
                thinking_enabled: thinkingReasoningEnabled,
                reasoning_payloads: upstreamReasoningPayloads,
                reasoning_chars: upstreamReasoningChars,
                content_payloads: upstreamContentPayloads,
                content_chars: upstreamContentChars,
                sse_data_lines: upstreamSseDataLines,
                upstream_ms: upstreamTotalMs,
                first_reasoning_ms: Math.max(0, firstReasoningMs),
                first_content_ms: Math.max(0, firstTokenMs),
                stream_idle_timed_out: streamIdleTimedOut,
                stream_idle_timeout_ms: streamIdleTimeoutMs,
                stream_visible_idle_timed_out: streamVisibleIdleTimedOut,
                stream_visible_idle_timeout_ms: streamVisibleIdleTimeoutMs,
                stream_usage_ready_finished: streamUsageReadyFinished,
                stream_usage_ready_probe_ms: streamUsageReadyProbeMs,
                stream_usage_ready_grace_ms: streamUsageReadyGraceMs,
                sub2api_usage_found: Boolean(sub2apiUsageRecord?.actual_cost),
                delta_key_samples: upstreamDeltaKeySamples.slice(0, 8)
            });
            const streamMetadata = {
	                executor: `${upstreamProvider}-chat-stream`,
	                provider: upstreamProvider,
                provider_model: upstreamRequestModel,
                provider_response_model: upstreamModel,
                upstream_model: upstreamModel,
	                provider_source: providerSource,
                sub2api_client_request_id: sub2ApiClientRequestId,
                sub2apiClientRequestId: sub2ApiClientRequestId,
	                request_type: 'chat',
	                service_tier: serviceTier,
	                requested_service_tier: requestedServiceTier,
	                reasoning_effort: upstreamReasoningEffort,
	                requested_reasoning_effort: requestedReasoningEffort,
	                thinking_mode: thinkingMode,
	                thinking_type: deepSeekThinkingType,
		                thinking_enabled: thinkingReasoningEnabled,
		                kimi_thinking_enabled: kimiThinkingEnabled,
		                qwen_enable_thinking: qwenThinkingEnabled,
		                openai_native: openAiNativeCapable,
		                claude_native: claudeNativeCapable,
		                claude_thinking_enabled: claudeThinkingEnabled,
		                claude_thinking_budget: claudeThinkingBudget,
		                requested_claude_thinking_budget: requestedClaudeThinkingBudget,
		                gemini_native: geminiNativeCapable,
		                gemini_thinking_level_capable: geminiThinkingLevelCapable,
		                gemini_thinking_level: geminiThinkingLevel,
		                requested_gemini_thinking_level: requestedGeminiThinkingLevel,
			                image_input_mode: imageInputMode,
		                supports_image_input: supportsImageInput,
		                attached_image_count: attachedImageCount,
	                attached_file_count: chatAttachmentSummary.length,
	                attached_file_chars: chatAttachmentChars,
	                attached_files: chatAttachmentSummary,
	                prompt_cache_key: promptCacheKey,
	                memory_mode: normalizeChatMemoryMode(body.memoryMode || body.memory_mode),
	                memory_message_count: Math.max(0, messages.length - 2),
	                memory_token_estimate: estimateTextTokens(messages.map((message) => getChatMessageContentText(message.content)).join('\n')),
                reasoning_content: normalizeText(reasoningText, 12000),
                reasoning_tokens_estimate: estimateTextTokens(reasoningText),
                reasoning_diagnostic: reasoningDiagnostic,
                preflight_ms: 0,
                config_resolve_ms: 0,
                upstream_ms: upstreamTotalMs,
                upstream_request_ms: upstreamFirstResponseSafeMs,
	                upstream_response_ms: 0,
	                upstream_response_body_ms: 0,
	                upstream_response_text_ms: 0,
	                upstream_response_parse_ms: 0,
	                postprocess_ms: 0,
	                executor_ms: upstreamTotalMs,
	                stream_idle_timed_out: streamIdleTimedOut,
	                stream_idle_timeout_ms: streamIdleTimeoutMs,
	                stream_visible_idle_timed_out: streamVisibleIdleTimedOut,
	                stream_visible_idle_timeout_ms: streamVisibleIdleTimeoutMs,
	                stream_usage_ready_finished: streamUsageReadyFinished,
	                stream_usage_ready_probe_ms: streamUsageReadyProbeMs,
	                stream_usage_ready_grace_ms: streamUsageReadyGraceMs,
                timing: {
                    ...safeObject(existingMetadata.timing),
                    executor_ms: upstreamTotalMs,
                    upstream_request_ms: upstreamFirstResponseSafeMs,
                    first_token_ms: Math.max(0, firstTokenMs),
                    upstream_ms: upstreamTotalMs,
                    stream_idle_timed_out: streamIdleTimedOut,
                    stream_idle_timeout_ms: streamIdleTimeoutMs,
                    stream_visible_idle_timed_out: streamVisibleIdleTimedOut,
                    stream_visible_idle_timeout_ms: streamVisibleIdleTimeoutMs,
                    stream_usage_ready_finished: streamUsageReadyFinished,
                    stream_usage_ready_probe_ms: streamUsageReadyProbeMs,
                    stream_usage_ready_grace_ms: streamUsageReadyGraceMs
                }
            };

            const completion = await completeTask(supabase, task, {
                status: 'succeeded',
                resultPrompt: outputText,
                images: [],
                tokenUsage: normalizedUsage.raw,
                providerTaskId,
                metadata: streamMetadata
            });
            const updatedTask = completion.task;
            const pricingCharge = safeObject(safeObject(updatedTask.metadata).pricing_charge);
            const chargedPoints = normalizeBillablePoints(updatedTask.charged_points, 0);

            writeSse(res, 'billing', {
                success: true,
                task_id: updatedTask.id,
                taskId: updatedTask.id,
                charged_points: chargedPoints,
                chargedPoints,
                pricing_charge: pricingCharge,
                pricingCharge,
                token_usage: {
                    input_tokens: normalizedUsage.input_tokens,
                    output_tokens: normalizedUsage.output_tokens,
                    total_tokens: normalizedUsage.total_tokens,
                    cached_tokens: normalizedUsage.cached_tokens
                }
            });

            writeSse(res, 'done', {
                success: true,
                task: serializeTask(updatedTask, []),
                task_id: updatedTask.id,
                charged_points: chargedPoints,
                chargedPoints,
                pricing_charge: pricingCharge,
                pricingCharge,
                text: outputText,
                storedApiKey: resolvedUserApiKey.storedApiKey,
                stored_api_key: resolvedUserApiKey.storedApiKey,
                token_usage: {
                    input_tokens: normalizedUsage.input_tokens,
                    output_tokens: normalizedUsage.output_tokens,
                    total_tokens: normalizedUsage.total_tokens,
                    cached_tokens: normalizedUsage.cached_tokens
                }
            });
            res.end();
        } catch (error) {
            logChatStreamDiagnostic('stream_failed', {
                ...chatDiagnostics,
                task_id: task?.id || '',
                streamStarted,
                statusCode: Number(error?.statusCode) || 500,
                code: error?.code || '',
                message: error?.message || '对话生成失败，请稍后重试'
            });
            if (task?.id && streamSupabase?.from) {
                try {
                    const { data: failedTask } = await streamSupabase
                        .from('ai_image_tasks')
                        .update({
                            status: 'failed',
                            error_code: normalizeText(error?.code || 'chat_stream_error', 120),
                            error_message: normalizeText(error?.message || error, 1000),
                            completed_at: new Date().toISOString()
                        })
                        .eq('id', task.id)
                        .select(TASK_SELECT)
                        .maybeSingle();
                    task = failedTask || task;
                } catch (_) {
                    // Keep the original error path if failure persistence fails.
                }
            }
            if (streamStarted) {
                writeSseError(res, error, task);
                return res.end();
            }
            return sendError(sendJson, res, error);
        }
    }

    async function uploadHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const body = typeof parseJsonBody === 'function'
                ? await parseJsonBody(req)
                : (req.body && typeof req.body === 'object' ? req.body : {});
            const site = normalizeSite(body.site);
            await consumeAiImageRateLimits({
                req,
                res,
                supabase,
                userId: user.id,
                site,
                action: 'upload'
            });
            const upload = parseReferenceImageUploadBody(body);
            const uploader = typeof uploadImageBuffer === 'function'
                ? uploadImageBuffer
                : uploadGeneratedImageBufferToR2;
            const stored = await uploader(upload.buffer, {
                env,
                task: {
                    id: `reference-${Date.now().toString(36)}`,
                    site,
                    user_id: user.id
                },
                index: 0,
                mimeType: upload.mimeType
            });

            return sendJson(res, 200, {
                success: true,
                imageUrl: stored.image_url || '',
                image_url: stored.image_url || '',
                originalImageUrl: stored.original_image_url || stored.image_url || '',
                original_image_url: stored.original_image_url || stored.image_url || '',
                storagePath: stored.storage_path || '',
                storage_path: stored.storage_path || '',
                originalStoragePath: stored.original_storage_path || stored.storage_path || '',
                original_storage_path: stored.original_storage_path || stored.storage_path || '',
                mimeType: upload.mimeType,
                mime_type: upload.mimeType,
                title: upload.title
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function downloadHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const body = typeof parseJsonBody === 'function'
                ? await parseJsonBody(req)
                : (req.body && typeof req.body === 'object' ? req.body : {});
            const site = normalizeSite(body.site);
            const resultId = normalizeText(body.resultId || body.result_id, 160);
            const taskId = normalizeText(body.taskId || body.task_id, 160);
            const resultIndex = normalizePositiveInt(body.resultIndex || body.result_index, 0, { min: 0, max: 99 });

            if (!resultId && !taskId) {
                return sendJson(res, 400, {
                    success: false,
                    message: '缺少图片结果 ID',
                    code: 'result_id_required'
                });
            }
            await consumeAiImageRateLimits({
                req,
                res,
                supabase,
                userId: user.id,
                site,
                action: 'download',
                resourceId: resultId || `${taskId}:${resultIndex}`
            });

            let query = supabase
                .from('ai_image_results')
                .select(RESULT_SELECT)
                .eq('user_id', user.id)
                .eq('site', site);

            query = resultId
                ? query.eq('id', resultId)
                : query.eq('task_id', taskId).eq('result_index', resultIndex);

            const { data: result, error: resultError } = await query.maybeSingle();
            if (resultError) throw resultError;
            if (!result) {
                return sendJson(res, 404, {
                    success: false,
                    message: '图片结果不存在',
                    code: 'result_not_found'
                });
            }

            const originalStatus = getResultOriginalStatus(result);
            const originalUrl = originalStatus === 'ready' ? normalizeText(result.original_image_url, 4000) : '';
            if (!originalUrl) {
                return sendJson(res, 409, {
                    success: false,
                    message: originalStatus === 'failed'
                        ? '原图转存失败，请重新生成或联系管理员'
                        : '原图仍在转存，请稍后再试',
                    code: originalStatus === 'failed' ? 'original_image_failed' : 'original_image_pending',
                    result: serializeResult(result)
                });
            }

            const eventPayload = {
                task_id: result.task_id,
                result_id: result.id,
                site,
                user_id: user.id,
                image_url: result.image_url || '',
                original_image_url: originalUrl,
                storage_path: result.storage_path || '',
                original_storage_path: result.original_storage_path || '',
                source: normalizeDownloadSource(body.source || body.downloadSource || body.download_source),
                metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
                    ? body.metadata
                    : {}
            };

            let event = null;
            try {
                const { data: eventRow, error: eventError } = await supabase
                    .from('ai_image_download_events')
                    .insert(eventPayload)
                    .select('id, task_id, result_id, site, image_url, original_image_url, storage_path, original_storage_path, source, created_at')
                    .single();
                if (eventError) throw eventError;
                event = eventRow || null;
            } catch (eventError) {
                if (!isMissingRelationError(eventError, 'ai_image_download_events')) {
                    throw eventError;
                }
            }

            return sendJson(res, 200, {
                success: true,
                imageUrl: originalUrl,
                image_url: originalUrl,
                originalImageUrl: originalUrl,
                original_image_url: originalUrl,
                result: serializeResult(result),
                event: event ? serializeDownloadEvent(event) : null
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function listTasksHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeSite(url.searchParams.get('site') || req.query?.site);
            const limit = normalizePositiveInt(url.searchParams.get('limit') || req.query?.limit, 30, { min: 1, max: 100 });
            const status = normalizeText(url.searchParams.get('status') || req.query?.status, 40).toLowerCase();
            const mode = normalizeText(url.searchParams.get('mode') || req.query?.mode, 40).toLowerCase();

            let query = supabase
                .from('ai_image_tasks')
                .select(TASK_SELECT)
                .eq('user_id', user.id)
                .eq('site', site);

            if (status) {
                query = query.eq('status', status);
            }
            if (mode && SUPPORTED_MODES.has(mode)) {
                query = query.eq('mode', mode);
            }

            const { data, error } = await query
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            const rows = Array.isArray(data) ? data : [];
            const taskIds = rows.map((row) => row.id).filter(Boolean);
            let resultRows = [];
            if (taskIds.length) {
                const { data: resultsData, error: resultsError } = await supabase
                    .from('ai_image_results')
                    .select(RESULT_SELECT)
                    .in('task_id', taskIds)
                    .order('created_at', { ascending: true });
                if (resultsError) throw resultsError;
                resultRows = Array.isArray(resultsData) ? resultsData : [];
            }

            const resultsByTaskId = resultRows.reduce((accumulator, row) => {
                const taskId = row.task_id || '';
                if (!taskId) return accumulator;
                if (!accumulator[taskId]) accumulator[taskId] = [];
                accumulator[taskId].push(row);
                return accumulator;
            }, {});
            const serializedRows = [];
            const recoveredRows = [];
            for (const row of rows) {
                const rowResults = resultsByTaskId[row.id] || [];
                // eslint-disable-next-line no-await-in-loop
                const recoveredRow = await maybeRecoverTaskWithResults(supabase, row, rowResults);
                // eslint-disable-next-line no-await-in-loop
                const reconciledRow = await maybeReconcileSub2ApiActualCostTask(supabase, recoveredRow, { env, fetchImpl });
                recoveredRows.push({ row: reconciledRow, results: rowResults });
            }
            const queueEstimates = await estimateQueueForTasks(supabase, recoveredRows.map((item) => item.row), { site, env });
            for (const item of recoveredRows) {
                serializedRows.push(serializeTask(
                    attachQueueEstimateToTask(item.row, queueEstimates.get(item.row.id) || {}),
                    item.results,
                    { env }
                ));
            }

            return sendJson(res, 200, {
                success: true,
                tasks: serializedRows,
                records: serializedRows
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function getTaskHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeSite(url.searchParams.get('site') || req.query?.site);
            const taskId = normalizeText(url.searchParams.get('id') || url.searchParams.get('taskId') || req.query?.id || req.query?.taskId, 160);
            const clientTaskId = normalizeText(url.searchParams.get('clientTaskId') || req.query?.clientTaskId, 160);
            if (!taskId && !clientTaskId) {
                return sendJson(res, 400, {
                    success: false,
                    message: '缺少任务 ID',
                    code: 'task_id_required'
                });
            }

            let query = supabase
                .from('ai_image_tasks')
                .select(TASK_SELECT)
                .eq('user_id', user.id)
                .eq('site', site);

            query = taskId
                ? query.eq('id', taskId)
                : query.eq('client_task_id', clientTaskId);

            const { data, error } = await query.maybeSingle();
            if (error) throw error;
            if (!data) {
                return sendJson(res, 404, {
                    success: false,
                    message: '任务不存在',
                    code: 'task_not_found'
                });
            }

            const { data: resultRows, error: resultsError } = await supabase
                .from('ai_image_results')
                .select(RESULT_SELECT)
                .eq('task_id', data.id)
                .eq('user_id', user.id)
                .order('created_at', { ascending: true });
            if (resultsError) throw resultsError;
            const normalizedResultRows = Array.isArray(resultRows) ? resultRows : [];
            const recoveredTask = await maybeRecoverTaskWithResults(supabase, data, normalizedResultRows);
            const reconciledTask = await maybeReconcileSub2ApiActualCostTask(supabase, recoveredTask, { env, fetchImpl });
            const queueEstimate = await estimateQueueForTask(supabase, reconciledTask, { site, env });

            return sendJson(res, 200, {
                success: true,
                task: serializeTask(attachQueueEstimateToTask(reconciledTask, queueEstimate), normalizedResultRows, { env })
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function cancelTaskHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const body = typeof parseJsonBody === 'function'
                ? await parseJsonBody(req)
                : (req.body && typeof req.body === 'object' ? req.body : {});
            const site = normalizeSite(body.site);
            const rawTaskId = normalizeText(body.taskId || body.task_id || body.id, 160);
            const taskId = isUuid(rawTaskId) ? rawTaskId : '';
            const clientTaskId = normalizeText(body.clientTaskId || body.client_task_id || (taskId ? '' : rawTaskId), 160);

            if (!taskId && !clientTaskId) {
                return sendJson(res, 400, {
                    success: false,
                    message: '缺少任务 ID',
                    code: 'task_id_required'
                });
            }

            let query = supabase
                .from('ai_image_tasks')
                .select(TASK_SELECT)
                .eq('user_id', user.id)
                .eq('site', site);

            query = taskId
                ? query.eq('id', taskId)
                : query.eq('client_task_id', clientTaskId);

            const { data: task, error: loadError } = await query.maybeSingle();
            if (loadError) throw loadError;
            if (!task) {
                return sendJson(res, 404, {
                    success: false,
                    message: '任务不存在',
                    code: 'task_not_found'
                });
            }

            if (task.status === 'cancelled') {
                return sendJson(res, 200, {
                    success: true,
                    task: serializeTask(task, []),
                    status: 'cancelled'
                });
            }

            if (task.status !== 'queued') {
                return sendJson(res, 409, {
                    success: false,
                    message: task.status === 'running'
                        ? '任务已开始调用模型，无法取消'
                        : '当前任务状态无法取消',
                    code: 'task_not_cancellable',
                    task: serializeTask(task, [])
                });
            }

            const { data: cancelledTask, error: cancelError } = await supabase
                .from('ai_image_tasks')
                .update({
                    status: 'cancelled',
                    error_code: 'user_cancelled',
                    error_message: '用户取消生成',
                    completed_at: new Date().toISOString()
                })
                .eq('id', task.id)
                .eq('user_id', user.id)
                .eq('site', site)
                .eq('status', 'queued')
                .select(TASK_SELECT)
                .maybeSingle();

            if (cancelError) throw cancelError;
            if (!cancelledTask) {
                return sendJson(res, 409, {
                    success: false,
                    message: '任务已开始处理，无法取消',
                    code: 'task_not_cancellable',
                    task: serializeTask(task, [])
                });
            }

            return sendJson(res, 200, {
                success: true,
                task: serializeTask(cancelledTask, []),
                status: 'cancelled'
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function loadTaskPrefs(supabase, { userId, site } = {}) {
        try {
            const { data, error } = await supabase
                .from('ai_image_task_user_prefs')
                .select(TASK_PREF_SELECT)
                .eq('user_id', userId)
                .eq('site', site)
                .order('pinned_at', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(500);
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            if (isMissingRelationError(error, 'ai_image_task_user_prefs')) {
                return null;
            }
            throw error;
        }
    }

    function sendTaskPrefsPayload(res, rows, extra = {}) {
        const prefs = serializeTaskPrefs(rows || []);
        return sendJson(res, 200, {
            success: true,
            ...(rows === null ? { unavailable: true } : {}),
            ...extra,
            prefs,
            historyPrefs: prefs,
            history_prefs: prefs
        });
    }

    async function taskPrefsHandler(req, res) {
        if (!['GET', 'POST'].includes(req.method)) {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const url = new URL(req.url || '', 'http://localhost');

            if (req.method === 'GET') {
                const site = normalizeSite(url.searchParams.get('site') || req.query?.site);
                const rows = await loadTaskPrefs(supabase, {
                    userId: user.id,
                    site
                });
                return sendTaskPrefsPayload(res, rows);
            }

            const body = typeof parseJsonBody === 'function'
                ? await parseJsonBody(req)
                : (req.body && typeof req.body === 'object' ? req.body : {});
            const site = normalizeSite(body.site);
            const action = normalizeTaskPrefAction(body.action || body.type);
            const taskIds = normalizeTaskPrefIds(body.taskIds || body.task_ids || body.ids || body.taskId || body.task_id);
            const accent = normalizeText(body.accent, 40).toLowerCase();

            if (!action) {
                return sendJson(res, 400, {
                    success: false,
                    message: '缺少有效的记录操作',
                    code: 'task_pref_action_required'
                });
            }
            if (!taskIds.length) {
                const rows = await loadTaskPrefs(supabase, {
                    userId: user.id,
                    site
                });
                return sendTaskPrefsPayload(res, rows, { ignored: true });
            }
            if (action === 'accent' && !TASK_PREF_ACCENTS.has(accent)) {
                return sendJson(res, 400, {
                    success: false,
                    message: '不支持的记录标色',
                    code: 'task_pref_accent_invalid'
                });
            }

            const { data: ownedTasks, error: ownedError } = await supabase
                .from('ai_image_tasks')
                .select('id')
                .eq('user_id', user.id)
                .eq('site', site)
                .in('id', taskIds)
                .limit(taskIds.length);
            if (ownedError) throw ownedError;
            const ownedTaskIds = (Array.isArray(ownedTasks) ? ownedTasks : [])
                .map((row) => normalizeText(row.id, 160))
                .filter(Boolean);
            if (!ownedTaskIds.length) {
                const rows = await loadTaskPrefs(supabase, {
                    userId: user.id,
                    site
                });
                return sendTaskPrefsPayload(res, rows, { ignored: true });
            }

            const now = new Date().toISOString();
            const patch = {};
            if (action === 'hide') {
                patch.hidden_at = now;
            } else if (action === 'pin') {
                patch.pinned_at = now;
                patch.hidden_at = null;
            } else if (action === 'unpin') {
                patch.pinned_at = null;
            } else if (action === 'accent') {
                patch.accent = accent;
                patch.hidden_at = null;
            } else if (action === 'clear-accent') {
                patch.accent = null;
            }

            if (['unpin', 'clear-accent'].includes(action)) {
                const { error: updateError } = await supabase
                    .from('ai_image_task_user_prefs')
                    .update(patch)
                    .eq('user_id', user.id)
                    .eq('site', site)
                    .in('task_id', ownedTaskIds)
                    .select('id');
                if (updateError) throw updateError;
            } else {
                const upsertRows = ownedTaskIds.map((taskId) => ({
                    site,
                    user_id: user.id,
                    task_id: taskId,
                    ...patch,
                    metadata: {}
                }));
                const { error: upsertError } = await supabase
                    .from('ai_image_task_user_prefs')
                    .upsert(upsertRows, { onConflict: 'user_id,site,task_id' })
                    .select('id');
                if (upsertError) throw upsertError;
            }

            const rows = await loadTaskPrefs(supabase, {
                userId: user.id,
                site
            });
            return sendTaskPrefsPayload(res, rows);
        } catch (error) {
            if (isMissingRelationError(error, 'ai_image_task_user_prefs')) {
                return sendTaskPrefsPayload(res, null, { unavailable: true });
            }
            return sendError(sendJson, res, error);
        }
    }

    async function agentsHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const supabase = await resolveOptionalSupabase();
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeSite(url.searchParams.get('site') || req.query?.site);

            const { data, error } = await supabase
                .from('ai_image_agents')
                .select('id, site, slug, name, name_en, description, description_en, mode, default_model, default_ratio, default_resolution, metadata, display_order')
                .in('site', [site, 'all'])
                .eq('is_active', true)
                .order('display_order', { ascending: true })
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            return sendJson(res, 200, {
                success: true,
                agents: Array.isArray(data) ? data : []
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function pricingHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeSite(url.searchParams.get('site') || req.query?.site);

            const { data, error } = await supabase
                .from('ai_image_pricing_rules')
                .select('id, site, mode, billing_mode, model, resolution, ratio, quantity, points, priority, metadata')
                .in('site', [site, 'all'])
                .eq('is_active', true)
                .order('priority', { ascending: true })
                .limit(200);

            if (error) throw error;
            const apiBaseUrls = await loadAllowedApiBaseUrls(supabase, { site, env });
            const modelProviders = await loadPublicModelProviders(supabase, { env });
            const storedApiKeys = await loadStoredUserApiKeyStatuses(supabase, {
                userId: user.id,
                site,
                apiBaseUrls: apiBaseUrls.map((row) => row.baseUrl)
            });

            return sendJson(res, 200, {
                success: true,
                pricing: (Array.isArray(data) ? data : []).map((rule) => ({
                    ...rule,
                    metadata: normalizeAiImagePricingMetadata(rule.metadata || {})
                })),
                api_base_urls: apiBaseUrls,
                allowed_api_base_urls: apiBaseUrls.map((row) => row.baseUrl),
                storedApiKeys,
                stored_api_keys: storedApiKeys,
                model_providers: modelProviders,
                image_model_providers: modelProviders,
                image_models: modelProviders
                    .filter((provider) => providerSupportsPublicModelGroup(provider, 'image'))
                    .flatMap((provider) => provider.imageModels.map((model) => ({
                        id: model,
                        label: model,
                        providerId: provider.providerId,
                        providerLabel: provider.label,
                        vendorLabel: provider.vendorLabel || provider.vendor_label || '',
                        vendor_label: provider.vendorLabel || provider.vendor_label || '',
                        vendor: provider.vendor,
                        protocol: provider.protocol
                    }))),
                chat_models: modelProviders
                    .filter((provider) => providerSupportsPublicModelGroup(provider, 'chat'))
                    .flatMap((provider) => provider.chatModels.map((model) => ({
                        id: model,
                        label: model,
                        providerId: provider.providerId,
                        providerLabel: provider.label,
                        vendorLabel: provider.vendorLabel || provider.vendor_label || '',
                        vendor_label: provider.vendorLabel || provider.vendor_label || '',
                        vendor: provider.vendor,
                        protocol: provider.protocol,
                        ...(modelsListIncludesModel(provider.visionModels, model)
                            ? {
                                supportsImageInput: true,
                                supports_image_input: true
                            }
                            : {})
                    }))),
                video_models: modelProviders
                    .filter((provider) => providerSupportsPublicModelGroup(provider, 'video'))
                    .flatMap((provider) => provider.videoModels.map((model) => ({
                        id: model,
                        label: model,
                        providerId: provider.providerId,
                        providerLabel: provider.label,
                        vendorLabel: provider.vendorLabel || provider.vendor_label || '',
                        vendor_label: provider.vendorLabel || provider.vendor_label || '',
                        vendor: provider.vendor,
                        protocol: provider.protocol
                    })))
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function modelsHandler(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const body = typeof parseJsonBody === 'function'
                ? await parseJsonBody(req)
                : (req.body && typeof req.body === 'object' ? req.body : {});
            const site = normalizeSite(body.site);
            const apiBaseUrl = await resolveApiBaseUrlFromAdminConfig(supabase, body.apiBaseUrl || body.api_base_url, { site, env });
            const typedApiKey = normalizeText(body.apiKey || body.api_key, 4000);
            let resolvedUserApiKey = null;

            if (typedApiKey) {
                resolvedUserApiKey = {
                    apiKey: typedApiKey,
                    apiKeyTail: getApiKeyTail(typedApiKey),
                    apiKeyFingerprint: getApiKeyFingerprint(typedApiKey),
                    storedApiKey: null,
                    source: 'request'
                };
            } else {
                resolvedUserApiKey = await resolveUserApiKeyForRequest(supabase, {
                    userId: user.id,
                    site,
                    apiBaseUrl,
                    apiKeyInput: '',
                    env
                });
            }

            await consumeAiImageRateLimits({
                req,
                res,
                supabase,
                userId: user.id,
                site,
                action: 'models',
                mode: 'chat',
                billingMode: 'api',
                model: 'upstream-discovery',
                resolution: '',
                quantity: 1
            });

            const timeoutMs = normalizePositiveInt(
                body.timeoutMs || body.timeout_ms || env.AI_IMAGE_MODEL_DISCOVERY_TIMEOUT_MS,
                DEFAULT_MODEL_DISCOVERY_TIMEOUT_MS,
                { min: 3000, max: 30000 }
            );
            const discovery = isGeminiNativeBaseUrl(apiBaseUrl)
                ? await discoverGeminiNativeModels({
                    apiKey: resolvedUserApiKey.apiKey,
                    baseUrl: apiBaseUrl,
                    fetchImpl,
                    timeoutMs
                })
                : await discoverOpenAiCompatibleModels({
                    apiKey: resolvedUserApiKey.apiKey,
                    baseUrl: apiBaseUrl,
                    fetchImpl,
                    timeoutMs
                });

            if (!discovery?.ok) {
                return sendJson(res, discovery.statusCode || 502, {
                    success: false,
                    message: discovery.message || '上游模型检测失败，请确认 API Key 和 Base URL 可用。',
                    code: discovery.code || 'ai_image_user_model_discovery_failed',
                    discovery: {
                        ...discovery,
                        models: []
                    },
                    apiBaseUrl,
                    api_base_url: apiBaseUrl
                });
            }

            return sendJson(res, 200, buildDiscoveredModelsPayload(discovery, {
                apiBaseUrl,
                source: resolvedUserApiKey.source
            }));
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    async function usageHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        try {
            const { user, supabase } = await resolveAuthenticatedContext(req);
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeSite(url.searchParams.get('site') || req.query?.site);
            const limit = normalizePositiveInt(url.searchParams.get('limit') || req.query?.limit, 30, { min: 1, max: 100 });

            const { data, error } = await supabase
                .from('ai_image_api_usage')
                .select('id, task_id, site, api_base_url, api_key_tail, model, model_group, request_type, input_tokens, output_tokens, total_tokens, image_count, resolution, raw_usage, created_at')
                .eq('user_id', user.id)
                .eq('site', site)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            let downloads = [];
            try {
                const { data: downloadRows, error: downloadError } = await supabase
                    .from('ai_image_download_events')
                    .select('id, task_id, result_id, site, image_url, original_image_url, storage_path, original_storage_path, source, created_at')
                    .eq('user_id', user.id)
                    .eq('site', site)
                    .order('created_at', { ascending: false })
                    .limit(limit);
                if (downloadError) throw downloadError;
                downloads = Array.isArray(downloadRows) ? downloadRows.map(serializeDownloadEvent) : [];
            } catch (downloadError) {
                if (!isMissingRelationError(downloadError, 'ai_image_download_events')) {
                    throw downloadError;
                }
            }

            return sendJson(res, 200, {
                success: true,
                usage: Array.isArray(data) ? data : [],
                apiUsage: Array.isArray(data) ? data : [],
                api_usage: Array.isArray(data) ? data : [],
                downloads,
                downloadEvents: downloads,
                download_events: downloads
            });
        } catch (error) {
            return sendError(sendJson, res, error);
        }
    }

    return {
        submit: submitHandler,
        chatStream: chatStreamHandler,
        'chat-stream': chatStreamHandler,
        upload: uploadHandler,
        download: downloadHandler,
        cancel: cancelTaskHandler,
        tasks: listTasksHandler,
        records: listTasksHandler,
        task: getTaskHandler,
        taskPrefs: taskPrefsHandler,
        'task-prefs': taskPrefsHandler,
        agents: agentsHandler,
        pricing: pricingHandler,
        models: modelsHandler,
        usage: usageHandler
    };
}

module.exports = {
    createAiImageHandlers,
    inferMode,
    normalizeApiBaseUrl,
    resolveModel,
    resolveModelGroup,
    resolveAllowedApiBaseUrls,
    serializeTask
};
