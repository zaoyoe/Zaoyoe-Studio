const crypto = require('node:crypto');
const {
    resolveAiImageProviderRuntimeConfig,
    resolveAiImageRuntimeSecretConfig,
    resolveCodexRuntimeConfig
} = require('../../api/_lib/secrets');

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_VIDEO_MODEL = 'default-video-model';
const DEFAULT_PROVIDER_TIMEOUT_MS = 120000;
const DEFAULT_REVERSE_MAX_TOKENS = 520;
const DEFAULT_REVERSE_REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REVERSE_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;
const MAX_REVERSE_REFERENCE_REDIRECTS = 3;
const DEFAULT_VIDEO_POLL_INTERVAL_MS = 3000;
const DEFAULT_VIDEO_POLL_MAX_ATTEMPTS = 160;
const MAX_VIDEO_POLL_MAX_ATTEMPTS = 240;
const IMAGE_GENERATION_MODES = Object.freeze(new Set(['text', 'image', 'agent']));
const VIDEO_GENERATION_MODES = Object.freeze(new Set(['video']));
const TEXT_VISION_MODES = Object.freeze(new Set(['reverse', 'chat']));
const PROVIDER_PROTOCOL_VALUES = Object.freeze(new Set(['openai-compatible', 'gemini-native', 'anthropic-native', 'custom']));
const RESOLUTION_TARGET_LONG_EDGE = Object.freeze({
    '1k': 1024,
    '2k': 2048,
    '4k': 3840
});
const RESOLUTION_SQUARE_EDGE = Object.freeze({
    '1k': 1024,
    '2k': 2048,
    '4k': 2880
});
const VIDEO_RESOLUTION_LONG_EDGE = Object.freeze({
    '480p': 854,
    '720p': 1280,
    '1080p': 1920,
    '4k': 3840
});
const SUPPORTED_VIDEO_RATIOS = Object.freeze(new Set([
    'adaptive',
    '1:1',
    '3:4',
    '4:3',
    '9:16',
    '16:9',
    '21:9'
]));
const MAX_GPT_IMAGE_EDGE = 3840;
const MIN_GPT_IMAGE_PIXELS = 655360;
const MAX_GPT_IMAGE_PIXELS = 8294400;
const MAX_REFERENCE_IMAGE_INPUTS = 16;
const SUPPORTED_OPENAI_IMAGE_QUALITIES = Object.freeze(new Set(['low', 'medium', 'high', 'auto']));
const SUPPORTED_GEMINI_IMAGE_ASPECT_RATIOS = Object.freeze(new Set([
    '1:1',
    '1:4',
    '1:8',
    '2:3',
    '3:2',
    '3:4',
    '4:1',
    '4:3',
    '4:5',
    '5:4',
    '8:1',
    '9:16',
    '16:9',
    '21:9'
]));
const URL_RESPONSE_FORMAT_UNSUPPORTED_RE = /response[_ -]?format|b64_json|url|unknown parameter|unsupported|not supported|invalid.*format|invalid.*parameter|unrecognized.*parameter/i;
const GEMINI_IMAGE_URL_BRIDGE_HEADER = 'X-Zaoyoe-Gemini-Image-Url-Bridge';
const GEMINI_IMAGE_URL_BRIDGE_UNAVAILABLE_TTL_MS = 10 * 60 * 1000;
const REVERSE_REFERENCE_IMAGE_MIME_TYPES = Object.freeze(new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
]));
const DEFAULT_TRUSTED_REFERENCE_IMAGE_HOSTS = Object.freeze([
    'cdn.fatherkey.com',
    'cdn.zaoyoe.com',
    'cdn.zaoyoe.xyz'
]);
const geminiImageUrlBridgeUnavailableUntil = new Map();

function normalizeText(value, maxLength = 4000) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, maxLength) : '';
}

function safeObject(value = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePricingBillingStrategy(value = '') {
    const normalized = normalizeText(value, 80).toLowerCase().replace(/-/g, '_');
    return normalized === 'token_sub2api' ? 'token_sub2api' : '';
}

function shouldCaptureTaskSub2ApiBilling(task = {}) {
    if (normalizeText(task.billing_mode || task.billingMode, 40) !== 'points') return false;
    const metadata = safeObject(task.metadata);
    const pricing = safeObject(metadata.pricing);
    const matchedRule = safeObject(pricing.matched_rule || pricing.matchedRule);
    const ruleMetadata = safeObject(matchedRule.metadata);
    const rulePricing = safeObject(ruleMetadata.pricing);
    return normalizePricingBillingStrategy(
        ruleMetadata.billing_strategy
        || ruleMetadata.billingStrategy
        || rulePricing.billing_strategy
        || rulePricing.billingStrategy
    ) === 'token_sub2api';
}

function buildSub2ApiClientRequestId(task = {}) {
    const taskId = normalizeText(task.id, 120).replace(/[^a-z0-9._:-]/gi, '').slice(0, 96);
    return taskId ? `fatherkey-aiw-${taskId}` : '';
}

function normalizeModelsList(value = []) {
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function addTimingMs(timing = null, key = '', value = 0) {
    if (!timing || typeof timing !== 'object' || !key) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    timing[key] = Math.max(0, Math.round(Number(timing[key] || 0) + parsed));
}

function readFirstEnv(env = {}, names = [], fallback = '') {
    for (const name of names) {
        const value = String(env?.[name] || '').trim();
        if (value) return value;
    }
    return fallback;
}

function normalizeBaseUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
        const url = new URL(raw);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/\/+$/, '') || '/v1';
        if (url.pathname === '/') {
            url.pathname = '/v1';
        }
        if (!/\/v\d+(?:\/.*)?$/i.test(url.pathname)) {
            url.pathname = `${url.pathname}/v1`.replace(/\/{2,}/g, '/');
        }
        return url.toString().replace(/\/+$/, '');
    } catch (_) {
        return raw.replace(/\/+$/, '');
    }
}

function normalizePublicAssetBaseUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
        const url = new URL(raw);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/\/+$/, '');
        if (url.pathname === '/') {
            url.pathname = '';
        }
        return url.toString().replace(/\/+$/, '');
    } catch (_) {
        return raw.replace(/\/+$/, '');
    }
}

function normalizeResolution(value = '1k') {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(RESOLUTION_TARGET_LONG_EDGE, normalized) ? normalized : '1k';
}

function normalizeVideoResolution(value = '720p') {
    const normalized = String(value || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(VIDEO_RESOLUTION_LONG_EDGE, normalized)) return normalized;
    const withSuffix = /^\d+$/.test(normalized) ? `${normalized}p` : normalized;
    return Object.prototype.hasOwnProperty.call(VIDEO_RESOLUTION_LONG_EDGE, withSuffix) ? withSuffix : '720p';
}

function normalizeVideoRatio(value = 'adaptive') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'auto') return 'adaptive';
    return SUPPORTED_VIDEO_RATIOS.has(normalized) ? normalized : 'adaptive';
}

function normalizeBooleanOption(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeVideoDuration(value, fallback = 5) {
    const raw = String(value ?? '').trim();
    if (raw === '-1') return -1;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(60, Math.max(1, parsed));
}

function normalizeOpenAiImageQuality(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return SUPPORTED_OPENAI_IMAGE_QUALITIES.has(normalized) ? normalized : '';
}

function normalizeOpenAiImageResponseFormat(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (normalized === 'url' || normalized === 'b64_json' || normalized === 'b64') {
        return normalized === 'b64' ? 'b64_json' : normalized;
    }
    if (['none', 'unset', 'default', 'provider'].includes(normalized)) return '';
    return normalized;
}

function normalizeGeminiImageAspectRatio(value = '') {
    const normalized = normalizeText(value, 20).replace(/\s+/g, '').toLowerCase();
    return SUPPORTED_GEMINI_IMAGE_ASPECT_RATIOS.has(normalized) ? normalized : '1:1';
}

function normalizeGeminiImageSize(value = '') {
    const normalized = normalizeText(value, 20).replace(/\s+/g, '').toUpperCase();
    if (normalized === '512' || normalized === '1K' || normalized === '2K' || normalized === '4K') {
        return normalized;
    }
    return '1K';
}

function describeGeminiAspectRatioInstruction(aspectRatio = '') {
    if (aspectRatio === '9:16' || aspectRatio === '3:4' || aspectRatio === '2:3' || aspectRatio === '1:4' || aspectRatio === '1:8') {
        return 'Use a vertical portrait canvas; the image must be taller than it is wide. Do not produce a horizontal landscape composition.';
    }
    if (aspectRatio === '16:9' || aspectRatio === '4:3' || aspectRatio === '3:2' || aspectRatio === '4:1' || aspectRatio === '8:1' || aspectRatio === '21:9') {
        return 'Use a horizontal landscape canvas; the image must be wider than it is tall. Do not produce a vertical portrait composition.';
    }
    return 'Use a square canvas.';
}

function normalizeProviderProtocol(value = '', fallback = 'openai-compatible') {
    const normalized = normalizeText(value, 80).toLowerCase().replace(/_/g, '-');
    return PROVIDER_PROTOCOL_VALUES.has(normalized) ? normalized : fallback;
}

function normalizeEndpointPath(value = '', fallback = '') {
    const raw = normalizeText(value, 500);
    if (!raw) return fallback;
    if (/^https?:\/\//i.test(raw)) return raw;
    return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeEndpointsConfig(value = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isSub2ApiGatewayBaseUrl(value = '') {
    try {
        const host = new URL(normalizeBaseUrl(value)).hostname.toLowerCase();
        return host.includes('sub2api') || host === 'localhost' || host === '127.0.0.1';
    } catch (_) {
        return false;
    }
}

function resolveVideoSubmitEndpoint(config = {}, fallback = '/videos/generations') {
    const endpoints = normalizeEndpointsConfig(config.endpoints);
    const configuredEndpoint = config.videoEndpoint
        || config.video_endpoint
        || config.videoGenerationEndpoint
        || config.video_generation_endpoint
        || endpoints.video
        || endpoints.videoGeneration
        || endpoints.video_generation
        || endpoints.videos
        || endpoints.submit;
    if (configuredEndpoint) {
        return normalizeEndpointPath(configuredEndpoint, fallback);
    }
    if (isSub2ApiGatewayBaseUrl(config.baseUrl)) {
        return '/videos';
    }
    return normalizeEndpointPath(
        configuredEndpoint,
        fallback
    );
}

function buildProviderEndpointUrl(baseUrl = '', endpoint = '') {
    const normalizedEndpoint = normalizeEndpointPath(endpoint, '');
    if (/^https?:\/\//i.test(normalizedEndpoint)) return normalizedEndpoint;
    const root = normalizeBaseUrl(baseUrl).replace(/\/+$/, '');
    return `${root}${normalizedEndpoint || '/'}`;
}

function isVideoTaskSubmitEndpoint(endpoint = '') {
    const normalized = normalizeEndpointPath(endpoint).replace(/\/+$/, '');
    return normalized === '/videos' || /\/videos$/i.test(normalized);
}

function buildProviderVideoContentEndpoint(providerTaskId = '') {
    const taskId = encodeURIComponent(providerTaskId);
    return `/videos/${taskId}/content`;
}

function buildProviderVideoContentItem(config = {}, providerTaskId = '') {
    const taskId = normalizeText(providerTaskId, 240);
    if (!taskId) return null;
    return {
        id: taskId,
        url: buildProviderEndpointUrl(config.baseUrl, buildProviderVideoContentEndpoint(taskId)),
        mime_type: 'video/mp4',
        provider_auth_required: true,
        provider_auth_headers: {
            Authorization: `Bearer ${config.apiKey}`
        },
        provider_video_content_endpoint: buildProviderVideoContentEndpoint(taskId)
    };
}

function isProviderVideoContentUrl(config = {}, videoUrl = '') {
    try {
        const expected = new URL(buildProviderEndpointUrl(config.baseUrl, buildProviderVideoContentEndpoint('task-id')));
        const actual = new URL(videoUrl);
        return actual.origin === expected.origin && /\/videos\/[^/]+\/content\/?$/i.test(actual.pathname);
    } catch (_) {
        return false;
    }
}

function isRouteNotFoundPayload(response = {}, payload = {}) {
    const httpStatus = Number(response?.status || 0);
    const rawBusinessCode = payload?.error?.code ?? payload?.code ?? '';
    const businessCode = normalizeText(String(rawBusinessCode), 80).toLowerCase();
    if (httpStatus !== 404 && businessCode !== '404' && businessCode !== 'not_found') return false;
    const message = normalizeText(payload?.error?.message || payload?.message, 1000).toLowerCase();
    const hasBusinessNotFoundShape = businessCode === '404' && (
        !message
        || payload?.data == null
        || (Array.isArray(payload?.data) && payload.data.length === 0)
    );
    return !message
        || hasBusinessNotFoundShape
        || message === '404 page not found'
        || message === 'page not found'
        || message === 'route not found'
        || message.includes('invalid url')
        || message.includes('no route')
        || message.includes('cannot post');
}

function isDisabledFlag(value) {
    return ['0', 'false', 'off', 'no'].includes(String(value || '').trim().toLowerCase());
}

function isEnabledFlag(value) {
    return ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function shouldUseGeminiImageUrlBridge(env = {}, config = {}) {
    const explicit = String(env?.AI_IMAGE_GEMINI_URL_BRIDGE || '').trim();
    if (isDisabledFlag(explicit)) return false;
    if (isEnabledFlag(explicit)) return true;
    return isSub2ApiGatewayBaseUrl(config.baseUrl);
}

function getGeminiImageUrlBridgeCacheKey(config = {}) {
    const baseUrl = normalizeBaseUrl(config.baseUrl || '').toLowerCase();
    const model = normalizeText(config.model, 160).toLowerCase();
    return baseUrl && model ? `${baseUrl}|${model}` : '';
}

function getGeminiImageUrlBridgeUnavailableTtlMs(env = {}) {
    return normalizePositiveInt(
        env?.AI_IMAGE_GEMINI_URL_BRIDGE_UNAVAILABLE_TTL_MS,
        GEMINI_IMAGE_URL_BRIDGE_UNAVAILABLE_TTL_MS,
        { min: 1000, max: 60 * 60 * 1000 }
    );
}

function isGeminiImageUrlBridgeMarkedUnavailable(config = {}, now = nowMs()) {
    const key = getGeminiImageUrlBridgeCacheKey(config);
    if (!key) return false;
    const unavailableUntil = Number(geminiImageUrlBridgeUnavailableUntil.get(key) || 0);
    if (!unavailableUntil) return false;
    if (unavailableUntil <= now) {
        geminiImageUrlBridgeUnavailableUntil.delete(key);
        return false;
    }
    return true;
}

function markGeminiImageUrlBridgeUnavailable(config = {}, env = {}, now = nowMs()) {
    const key = getGeminiImageUrlBridgeCacheKey(config);
    if (!key) return;
    geminiImageUrlBridgeUnavailableUntil.set(key, now + getGeminiImageUrlBridgeUnavailableTtlMs(env));
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

function normalizeSub2ApiCost(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 1000000) / 1000000);
}

function pickObjectPath(source = {}, paths = []) {
    for (const path of paths) {
        let current = source;
        for (const key of path) {
            if (!current || typeof current !== 'object' || Array.isArray(current) || !(key in current)) {
                current = undefined;
                break;
            }
            current = current[key];
        }
        if (current !== undefined && current !== null && current !== '') {
            return {
                value: current,
                path: path.join('.')
            };
        }
    }
    return null;
}

function extractSub2ApiActualCost(source = {}) {
    const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const candidate = pickObjectPath(value, [
        ['usage_record', 'actual_cost'],
        ['usageRecord', 'actualCost'],
        ['usage_record', 'total_actual_cost'],
        ['usageRecord', 'totalActualCost'],
        ['usage_record', 'user_cost'],
        ['usageRecord', 'userCost'],
        ['record', 'actual_cost'],
        ['record', 'actualCost'],
        ['record', 'total_actual_cost'],
        ['record', 'totalActualCost'],
        ['record', 'user_cost'],
        ['record', 'userCost'],
        ['data', 'actual_cost'],
        ['data', 'actualCost'],
        ['data', 'total_actual_cost'],
        ['data', 'totalActualCost'],
        ['data', 'user_cost'],
        ['data', 'userCost'],
        ['usage', 'actual_cost'],
        ['usage', 'actualCost'],
        ['usage', 'total_actual_cost'],
        ['usage', 'totalActualCost'],
        ['usage', 'user_cost'],
        ['usage', 'userCost'],
        ['sub2api', 'actual_cost'],
        ['sub2api', 'actualCost'],
        ['sub2api', 'total_actual_cost'],
        ['sub2api', 'totalActualCost'],
        ['sub2api', 'user_cost'],
        ['sub2api', 'userCost'],
        ['sub2api_usage', 'actual_cost'],
        ['sub2apiUsage', 'actualCost'],
        ['sub2api_usage', 'total_actual_cost'],
        ['sub2apiUsage', 'totalActualCost'],
        ['sub2api_usage', 'user_cost'],
        ['sub2apiUsage', 'userCost'],
        ['billing', 'actual_cost'],
        ['billing', 'actualCost'],
        ['billing', 'total_actual_cost'],
        ['billing', 'totalActualCost'],
        ['billing', 'user_cost'],
        ['billing', 'userCost'],
        ['actual_cost'],
        ['actualCost'],
        ['total_actual_cost'],
        ['totalActualCost'],
        ['user_cost'],
        ['userCost'],
        ['actual_cost_usd'],
        ['actualCostUsd'],
        ['sub2api_actual_cost'],
        ['sub2apiActualCost']
    ]);
    if (!candidate) return null;
    const cost = normalizeSub2ApiCost(candidate.value, 0);
    return cost > 0 ? { cost, path: candidate.path } : null;
}

function getSub2ApiResponseBillingHints(payload = {}, response = null) {
    const responseClientRequestId = getResponseHeader(response, 'x-client-request-id');
    const clientRequestId = normalizeText(
        payload?.client_request_id
        || payload?.clientRequestId
        || responseClientRequestId,
        160
    );
    const upstreamRequestId = getResponseHeader(response, 'x-request-id') || getResponseHeader(response, 'request-id');
    const headerCost = normalizeSub2ApiCost(
        getResponseHeader(response, 'x-sub2api-actual-cost')
        || getResponseHeader(response, 'x-sub2api-cost')
        || getResponseHeader(response, 'x-actual-cost'),
        0
    );
    const requestIds = [
        clientRequestId ? `client:${clientRequestId}` : '',
        clientRequestId,
        responseClientRequestId ? `client:${responseClientRequestId}` : '',
        responseClientRequestId,
        upstreamRequestId,
        payload?.client_request_id,
        payload?.clientRequestId,
        payload?.id,
        payload?.request_id,
        payload?.requestId,
        payload?.response?.id,
        payload?.response?.request_id,
        payload?.response?.requestId,
        payload?.task_id,
        payload?.provider_task_id
    ]
        .map((item) => normalizeText(item, 240))
        .filter(Boolean);
    return {
        clientRequestId,
        upstreamRequestId,
        requestIds: [...new Set(requestIds)],
        headerCost
    };
}

function normalizeSub2ApiUsageLookupRecord(payload = {}, requestId = '') {
    const record = payload?.usage_record || payload?.usageRecord || payload?.record || payload?.data || payload;
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const recordRequestId = normalizeText(record.request_id || record.requestId, 260);
    const hasCostField = [
        record.actual_cost,
        record.actualCost,
        record.total_actual_cost,
        record.totalActualCost,
        record.user_cost,
        record.userCost,
        record.total_cost,
        record.totalCost,
        record.cost,
        record.fee,
        record.amount
    ].some((value) => value !== undefined && value !== null && String(value).trim() !== '');
    const actual = extractSub2ApiActualCost({ usage_record: record });
    const fallbackCost = normalizeSub2ApiCost(
        record.total_cost
        ?? record.totalCost
        ?? record.cost
        ?? record.fee
        ?? record.amount,
        0
    );
    const billableCost = actual?.cost || fallbackCost;
    if (billableCost <= 0 && !hasCostField) return null;
    return {
        request_id: recordRequestId || requestId,
        lookup_request_id: requestId,
        actual_cost: billableCost,
        actual_cost_source: actual?.cost > 0 ? 'actual_cost' : (fallbackCost > 0 ? 'fallback_cost' : 'zero_cost'),
        total_cost: normalizeSub2ApiCost(record.total_cost ?? record.totalCost, 0),
        input_cost: normalizeSub2ApiCost(record.input_cost ?? record.inputCost, 0),
        output_cost: normalizeSub2ApiCost(record.output_cost ?? record.outputCost, 0),
        cache_creation_cost: normalizeSub2ApiCost(record.cache_creation_cost ?? record.cacheCreationCost, 0),
        cache_read_cost: normalizeSub2ApiCost(record.cache_read_cost ?? record.cacheReadCost, 0),
        image_output_cost: normalizeSub2ApiCost(record.image_output_cost ?? record.imageOutputCost, 0),
        cost_field: actual?.path || 'usage_record.fallback_cost'
    };
}

function resolveSub2ApiUsageLookupConfig(env = {}) {
    return {
        attempts: normalizePositiveInt(
            readFirstEnv(env, ['AI_IMAGE_SUB2API_USAGE_LOOKUP_ATTEMPTS'], '12'),
            12,
            { min: 1, max: 20 }
        ),
        intervalMs: normalizePositiveInt(
            readFirstEnv(env, ['AI_IMAGE_SUB2API_USAGE_LOOKUP_INTERVAL_MS'], '500'),
            500,
            { min: 0, max: 3000 }
        )
    };
}

async function fetchSub2ApiUsageRecordForResponse({
    config = {},
    payload = {},
    response = null,
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null
} = {}) {
    if (!config?.apiKey || !isSub2ApiGatewayBaseUrl(config.baseUrl) || typeof fetchImpl !== 'function') {
        return null;
    }
    const hints = getSub2ApiResponseBillingHints(payload, response);
    if (hints.headerCost > 0) {
        return {
            request_id: hints.requestIds[0] || '',
            actual_cost: hints.headerCost,
            cost_field: 'response_header'
        };
    }
    if (!hints.requestIds.length) return null;
    const lookup = resolveSub2ApiUsageLookupConfig(env);

    for (let attempt = 0; attempt < lookup.attempts; attempt += 1) {
        for (const requestId of hints.requestIds) {
            const usageUrls = [
                buildProviderEndpointUrl(config.baseUrl, `/usage/requests/${encodeURIComponent(requestId)}`),
                buildProviderEndpointUrl(config.baseUrl, `/usage?request_id=${encodeURIComponent(requestId)}`)
            ];
            for (const usageUrl of usageUrls) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const usageResponse = await fetchProviderResponse(fetchImpl, usageUrl, {
                        method: 'GET',
                        headers: {
                            Authorization: `Bearer ${config.apiKey}`,
                            Accept: 'application/json'
                        },
                        ...(signal ? { signal } : {})
                    }, {
                        env,
                        label: 'Sub2API 使用记录'
                    });
                    if (!usageResponse.ok) continue;
                    const timing = {};
                    // eslint-disable-next-line no-await-in-loop
                    const usagePayload = await readUpstreamPayload(usageResponse, timing, { env, signal, label: 'Sub2API 使用记录响应体' });
                    const record = normalizeSub2ApiUsageLookupRecord(usagePayload, requestId);
                    if (record) return record;
                } catch (_) {
                    // 使用记录回查不能影响主生成链路，拿不到就回退到响应 usage/旧规则。
                }
            }
        }
        if (attempt < lookup.attempts - 1 && lookup.intervalMs > 0) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(lookup.intervalMs);
        }
    }
    return null;
}

function attachSub2ApiBillingToUsage(usage = {}, payload = {}, response = null, record = null) {
    const normalizedUsage = normalizeTokenUsage(usage);
    const directCost = extractSub2ApiActualCost({
        usage: normalizedUsage,
        payload,
        sub2api: payload?.sub2api,
        billing: payload?.billing
    });
    const fallbackCost = normalizeSub2ApiCost(
        payload?.total_cost
        ?? payload?.totalCost
        ?? payload?.cost
        ?? payload?.fee
        ?? payload?.amount
        ?? payload?.usage?.total_cost
        ?? payload?.usage?.totalCost
        ?? payload?.sub2api?.total_cost
        ?? payload?.sub2api?.totalCost,
        0
    );
    const hints = getSub2ApiResponseBillingHints(payload, response);
    const actualCost = record?.actual_cost || directCost?.cost || hints.headerCost || fallbackCost || 0;
    if (actualCost <= 0 && !hints.requestIds.length && !record) return normalizedUsage;
    return {
        ...normalizedUsage,
        actual_cost: actualCost || normalizedUsage.actual_cost,
        actualCost: actualCost || normalizedUsage.actualCost,
        sub2api_actual_cost: actualCost || normalizedUsage.sub2api_actual_cost,
        sub2apiActualCost: actualCost || normalizedUsage.sub2apiActualCost,
        sub2api: {
            ...(normalizedUsage.sub2api && typeof normalizedUsage.sub2api === 'object' ? normalizedUsage.sub2api : {}),
            actual_cost: actualCost || 0,
            actualCost: actualCost || 0,
            request_id: record?.request_id || hints.requestIds[0] || '',
            requestId: record?.request_id || hints.requestIds[0] || '',
            lookup_request_id: record?.lookup_request_id || hints.requestIds[0] || '',
            lookupRequestId: record?.lookup_request_id || hints.requestIds[0] || '',
            client_request_id: hints.clientRequestId || '',
            clientRequestId: hints.clientRequestId || '',
            upstream_request_id: hints.upstreamRequestId || '',
            upstreamRequestId: hints.upstreamRequestId || '',
            cost_source: record?.actual_cost_source || (directCost?.cost > 0 ? 'actual_cost' : (fallbackCost > 0 ? 'fallback_cost' : '')),
            costSource: record?.actual_cost_source || (directCost?.cost > 0 ? 'actual_cost' : (fallbackCost > 0 ? 'fallback_cost' : '')),
            cost_field: record?.cost_field || directCost?.path || (hints.headerCost > 0 ? 'response_header' : (fallbackCost > 0 ? 'payload.fallback_cost' : ''))
        }
    };
}

async function resolveTokenUsageWithSub2ApiBilling({
    usage = {},
    payload = {},
    response = null,
    config = {},
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null
} = {}) {
    const record = await fetchSub2ApiUsageRecordForResponse({
        config,
        payload,
        response,
        fetchImpl,
        env,
        signal
    });
    return attachSub2ApiBillingToUsage(usage, payload, response, record);
}

function isGeminiImageUrlBridgeJsonResponse(response) {
    const bridgeHeader = getResponseHeader(response, GEMINI_IMAGE_URL_BRIDGE_HEADER);
    if (bridgeHeader) return true;
    const contentType = getResponseHeader(response, 'content-type');
    return /application\/json/i.test(contentType);
}

function isGeminiImageUrlBridgeStorageNotConfigured(response, payload = {}) {
    if (Number(response?.status || 0) !== 503) return false;
    const message = normalizeText(payload?.error?.message || payload?.message, 1000).toLowerCase();
    return message.includes('gemini image url bridge storage is not configured');
}

function isGeminiImageUrlBridgeFallbackPayload(payload = {}) {
    const bridge = payload?.zaoyoe_image_url_bridge;
    return Boolean(bridge && typeof bridge === 'object' && bridge.fallback_used === true);
}

function summarizeProviderUrl(value = '') {
    try {
        const url = new URL(String(value || ''));
        return {
            host: url.host,
            pathname: url.pathname
        };
    } catch (_) {
        return {
            host: '',
            pathname: ''
        };
    }
}

function emitExecutorDiagnostic(onDiagnostic, event, detail = {}) {
    if (typeof onDiagnostic !== 'function') return;
    try {
        onDiagnostic(event, detail);
    } catch (_) {
        // Diagnostics must never affect generation.
    }
}

function resolveOpenAiImageResponseFormat(env = {}) {
    const explicit = normalizeOpenAiImageResponseFormat(env.AI_IMAGE_RESPONSE_FORMAT);
    if (explicit) return explicit;
    if (String(env.AI_IMAGE_RESPONSE_FORMAT || '').trim()) return '';
    return 'url';
}

function isUrlResponseFormatUnsupportedError(error = {}) {
    const signal = [
        error.code,
        error.message,
        error.cause?.code,
        error.cause?.message
    ].map((item) => normalizeText(item, 500)).filter(Boolean).join(' ');
    return URL_RESPONSE_FORMAT_UNSUPPORTED_RE.test(signal);
}

function normalizeImageModel(value = '') {
    const model = normalizeText(value, 160);
    if (!model || model === 'gpt-image' || model === 'gpt-image-api') {
        return DEFAULT_IMAGE_MODEL;
    }
    return model;
}

function normalizeChatModel(value = '') {
    const model = normalizeText(value, 160);
    if (!model || model === 'default-chat-model' || model === 'default-vision-model' || /^gpt-image/.test(model)) {
        return DEFAULT_CHAT_MODEL;
    }
    return model;
}

function normalizeVideoModel(value = '') {
    const model = normalizeText(value, 160);
    if (!model || model === 'default-video-model' || model === 'gpt-image' || model === 'gpt-image-api' || /^gpt-image/.test(model)) {
        return DEFAULT_VIDEO_MODEL;
    }
    return model;
}

function normalizeProvidedRuntimeConfig(config = {}, task = {}) {
    const isTextVisionMode = TEXT_VISION_MODES.has(String(task.mode || '').trim());
    const isVideoMode = VIDEO_GENERATION_MODES.has(String(task.mode || '').trim());
    const taskModel = normalizeText(task.model, 160);
    const model = isTextVisionMode
        ? normalizeChatModel(config.model || taskModel)
        : (isVideoMode ? normalizeVideoModel(config.model || taskModel) : normalizeImageModel(config.model || taskModel));

    return {
        configured: Boolean(normalizeText(config.apiKey, 4000) && normalizeBaseUrl(config.baseUrl)),
        apiKey: normalizeText(config.apiKey, 4000),
        baseUrl: normalizeBaseUrl(config.baseUrl),
        model,
        protocol: normalizeProviderProtocol(config.protocol || config.adapter),
        asyncResult: config.asyncResult || config.async_result || null,
        async_result: config.asyncResult || config.async_result || null,
        videoEndpoint: normalizeEndpointPath(config.videoEndpoint || config.video_endpoint || config.videoGenerationEndpoint || config.video_generation_endpoint),
        video_endpoint: normalizeEndpointPath(config.videoEndpoint || config.video_endpoint || config.videoGenerationEndpoint || config.video_generation_endpoint),
        endpoints: normalizeEndpointsConfig(config.endpoints),
        visionModels: normalizeModelsList(config.visionModels || config.vision_models || config.chatVisionModels || config.chat_vision_models),
        videoModels: normalizeModelsList(config.videoModels || config.video_models || config.videoModelAliases || config.video_model_aliases),
        source: normalizeText(config.source, 80) || 'provided'
    };
}

async function resolveExecutorRuntimeConfig({
    supabase,
    task = {},
    env = process.env,
    runtimeConfig
} = {}) {
    if (runtimeConfig && typeof runtimeConfig === 'object') {
        return normalizeProvidedRuntimeConfig(runtimeConfig, task);
    }

    return resolveAiImageRuntimeConfig({ supabase, task, env });
}

function parseRatio(value = '1:1') {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return [1, 1];
    }
    return [width, height];
}

function roundToImageStep(value) {
    const rounded = Math.round(Number(value || 0) / 16) * 16;
    return Math.max(16, rounded);
}

function roundUpToImageStep(value) {
    const rounded = Math.ceil(Number(value || 0) / 16) * 16;
    return Math.max(16, rounded);
}

function resolveOpenAiImageSize({ ratio = '1:1', resolution = '1k' } = {}) {
    const [ratioWidth, ratioHeight] = parseRatio(ratio);
    const normalizedResolution = normalizeResolution(resolution);
    const isSquare = Math.abs(ratioWidth - ratioHeight) < 0.0001;
    const longEdge = isSquare
        ? RESOLUTION_SQUARE_EDGE[normalizedResolution]
        : RESOLUTION_TARGET_LONG_EDGE[normalizedResolution];
    let width = longEdge;
    let height = longEdge;

    if (!isSquare) {
        const ratioLong = Math.max(ratioWidth, ratioHeight);
        const ratioShort = Math.min(ratioWidth, ratioHeight);
        const exactShortEdge = (longEdge * ratioShort) / ratioLong;
        const ratioShortEdge = roundToImageStep(exactShortEdge);
        const minShortEdge = roundUpToImageStep(MIN_GPT_IMAGE_PIXELS / longEdge);
        const shortEdge = Math.max(ratioShortEdge, minShortEdge);
        if (ratioWidth > ratioHeight) {
            width = longEdge;
            height = shortEdge;
        } else {
            width = shortEdge;
            height = longEdge;
        }
    }

    if (width * height < MIN_GPT_IMAGE_PIXELS) {
        const neededShortEdge = roundUpToImageStep(MIN_GPT_IMAGE_PIXELS / longEdge);
        if (ratioWidth > ratioHeight) {
            height = Math.max(height, neededShortEdge);
            width = longEdge;
        } else if (ratioHeight > ratioWidth) {
            width = Math.max(width, neededShortEdge);
            height = longEdge;
        } else {
            width = longEdge;
            height = longEdge;
        }
    }

    return {
        width,
        height,
        size: `${width}x${height}`
    };
}

function resolveOpenAiVideoSize({ ratio = '16:9', resolution = '720p' } = {}) {
    const normalizedRatio = normalizeVideoRatio(ratio);
    const aspectRatio = normalizedRatio === 'adaptive' ? '16:9' : normalizedRatio;
    const [ratioWidth, ratioHeight] = parseRatio(aspectRatio);
    const normalizedResolution = normalizeVideoResolution(resolution);
    const longEdge = VIDEO_RESOLUTION_LONG_EDGE[normalizedResolution] || VIDEO_RESOLUTION_LONG_EDGE['720p'];
    const shortEdge = roundToImageStep((longEdge * Math.min(ratioWidth, ratioHeight)) / Math.max(ratioWidth, ratioHeight));
    const width = ratioWidth >= ratioHeight ? longEdge : shortEdge;
    const height = ratioWidth >= ratioHeight ? shortEdge : longEdge;
    return {
        width,
        height,
        size: `${width}x${height}`,
        resolution: normalizedResolution,
        ratio: normalizedRatio,
        aspectRatio
    };
}

function resolveGeminiNativeBaseUrl(baseUrl = '') {
    const normalized = normalizeBaseUrl(baseUrl || DEFAULT_OPENAI_BASE_URL);
    if (/\/v1(?:alpha|beta)?$/i.test(normalized)) {
        return normalized.replace(/\/v1(?:alpha|beta)?$/i, '/v1beta');
    }
    return `${normalized.replace(/\/+$/, '')}/v1beta`;
}

function buildGeminiNativeGenerateContentUrl(config = {}) {
    const baseUrl = resolveGeminiNativeBaseUrl(config.baseUrl);
    const model = encodeURIComponent(normalizeImageModel(config.model));
    return `${baseUrl}/models/${model}:generateContent`;
}

function buildGeminiNativeStreamGenerateContentUrl(config = {}) {
    const baseUrl = resolveGeminiNativeBaseUrl(config.baseUrl);
    const model = encodeURIComponent(normalizeImageModel(config.model));
    return `${baseUrl}/models/${model}:streamGenerateContent?alt=sse`;
}

function buildGeminiNativeImageConfig(task = {}) {
    return {
        aspectRatio: normalizeGeminiImageAspectRatio(task.ratio || '1:1'),
        imageSize: normalizeGeminiImageSize(task.resolution || '1k')
    };
}

function normalizeGeminiReferenceImageParts(referenceImages = []) {
    const images = Array.isArray(referenceImages) ? referenceImages : [referenceImages];
    return images
        .map((image) => {
            if (!image?.buffer?.length) return null;
            return {
                inlineData: {
                    mimeType: normalizeMimeType(image.mimeType || 'image/png', 'image/png'),
                    data: Buffer.from(image.buffer).toString('base64')
                }
            };
        })
        .filter(Boolean);
}

function buildGeminiNativeImageRequestBody(task = {}, { referenceImages = [] } = {}) {
    const imageConfig = buildGeminiNativeImageConfig(task);
    const parts = [
        { text: buildImagePrompt(task) },
        ...normalizeGeminiReferenceImageParts(referenceImages)
    ];
    return {
        contents: [{
            role: 'user',
            parts
        }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            responseFormat: {
                image: imageConfig
            }
        }
    };
}

function extractGeminiNativeGeneratedImages(payload = {}) {
    const items = [];
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    for (const candidate of candidates) {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        let revisedPrompt = '';
        for (const part of parts) {
            if (typeof part?.text === 'string' && part.text.trim()) {
                revisedPrompt = revisedPrompt || part.text.trim();
            }
            const inlineData = part?.inlineData || part?.inline_data;
            const data = normalizeText(inlineData?.data, 100000000);
            if (!data) continue;
            items.push({
                b64_json: data,
                mime_type: normalizeText(inlineData?.mimeType || inlineData?.mime_type || 'image/png', 120) || 'image/png',
                revised_prompt: revisedPrompt
            });
        }
    }
    return items;
}

function extractGeminiNativeImagesFromSseText(text = '') {
    const items = [];
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/);
    const payloads = [];
    let current = [];

    const flush = () => {
        const joined = current.join('\n').trim();
        current = [];
        if (!joined || joined === '[DONE]') return;
        try {
            payloads.push(JSON.parse(joined));
        } catch (_) {
            // Gemini SSE JSON can be split across chunks; keep parsing best-effort.
        }
    };

    for (const line of lines) {
        if (!line.trim()) {
            flush();
            continue;
        }
        if (line.startsWith('data:')) {
            current.push(line.slice(5).trimStart());
        }
    }
    flush();

    for (const payload of payloads) {
        items.push(...extractGeminiNativeGeneratedImages(payload));
    }
    return items;
}

function createGeminiNativeSseImageParser() {
    let pendingLine = '';
    let currentEventLines = [];
    let totalChars = 0;

    const parseCurrentEvent = () => {
        const joined = currentEventLines.join('\n').trim();
        currentEventLines = [];
        if (!joined || joined === '[DONE]') return [];
        try {
            return extractGeminiNativeGeneratedImages(JSON.parse(joined));
        } catch (_) {
            return [];
        }
    };

    const consumeLine = (line = '') => {
        const trimmed = String(line || '').replace(/\r$/, '');
        if (!trimmed.trim()) {
            return parseCurrentEvent();
        }
        if (trimmed.startsWith('data:')) {
            currentEventLines.push(trimmed.slice(5).trimStart());
        }
        return [];
    };

    return {
        push(chunk = '') {
            const text = String(chunk || '');
            totalChars += text.length;
            const images = [];
            pendingLine += text;
            const lines = pendingLine.split('\n');
            pendingLine = lines.pop() || '';
            for (const line of lines) {
                images.push(...consumeLine(line));
            }
            return images;
        },
        flush() {
            const images = [];
            if (pendingLine) {
                images.push(...consumeLine(pendingLine));
                pendingLine = '';
            }
            images.push(...parseCurrentEvent());
            return images;
        },
        totalChars() {
            return totalChars;
        }
    };
}

async function readGeminiNativeSseUntilImages(response, {
    env = process.env,
    signal = null,
    onDiagnostic,
    diagnosticBase = {},
    timing = null
} = {}) {
    const reader = response?.body?.getReader?.();
    if (!reader) {
        return {
            images: [],
            completed: false,
            text: ''
        };
    }

    const timeoutMs = resolveResponseBodyTimeoutMs(env, DEFAULT_PROVIDER_TIMEOUT_MS);
    const decoder = new TextDecoder();
    const startedAt = nowMs();
    const parser = createGeminiNativeSseImageParser();
    let chunkCount = 0;
    let lastDiagnosticAt = 0;
    let timer = null;
    let abortHandler = null;
    let timedOut = false;

    const clear = () => {
        if (timer) clearTimeout(timer);
        if (signal && abortHandler && typeof signal.removeEventListener === 'function') {
            signal.removeEventListener('abort', abortHandler);
        }
    };

    const resetTimer = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timedOut = true;
            try {
                reader.cancel().catch(() => {});
            } catch (_) {
                // Ignore cancellation failures after timeout.
            }
        }, timeoutMs);
    };

    try {
        if (signal && typeof signal.addEventListener === 'function') {
            abortHandler = () => {
                try {
                    reader.cancel().catch(() => {});
                } catch (_) {
                    // Ignore cancellation failures after task abort.
                }
            };
            if (signal.aborted) {
                abortHandler();
            } else {
                signal.addEventListener('abort', abortHandler, { once: true });
            }
        }
        resetTimer();

        for (;;) {
            // eslint-disable-next-line no-await-in-loop
            const { value, done } = await reader.read();
            if (timedOut) {
                const error = new Error(`Gemini 图片生成上游流式响应超时（${Math.round(timeoutMs / 1000)} 秒）`);
                error.statusCode = 504;
                error.code = 'ai_image_response_body_timeout';
                throw error;
            }
            resetTimer();
            if (done) break;
            const chunk = decoder.decode(value || new Uint8Array(), { stream: true });
            if (!chunk) continue;
            chunkCount += 1;
            const images = parser.push(chunk);
            const streamElapsedMs = elapsedMs(startedAt);
            const shouldLogChunk = images.length || chunkCount === 1 || streamElapsedMs - lastDiagnosticAt >= 5000;
            if (shouldLogChunk) {
                lastDiagnosticAt = streamElapsedMs;
                emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_stream_chunk', {
                    ...diagnosticBase,
                    elapsedMs: streamElapsedMs,
                    chunkChars: chunk.length,
                    totalChars: parser.totalChars(),
                    chunkCount,
                    imageCount: images.length
                });
            }
            if (images.length) {
                try {
                    reader.cancel().catch(() => {});
                } catch (_) {
                    // Ignore cancellation after the needed image payload arrived.
                }
                if (timing && typeof timing === 'object') {
                    timing.response_text_ms = elapsedMs(startedAt);
                    timing.response_body_ms = elapsedMs(startedAt);
                    timing.response_parse_ms = 0;
                }
                return {
                    images,
                    completed: false,
                    text: ''
                };
            }
        }

        const tail = decoder.decode();
        if (tail) {
            chunkCount += 1;
            parser.push(tail);
        }
        const images = parser.flush();
        if (timing && typeof timing === 'object') {
            timing.response_text_ms = elapsedMs(startedAt);
            timing.response_body_ms = elapsedMs(startedAt);
            timing.response_parse_ms = 0;
        }
        return {
            images,
            completed: true,
            text: ''
        };
    } catch (error) {
        if (timing && typeof timing === 'object' && error?.code === 'ai_image_response_body_timeout') {
            timing.response_text_ms_timeout_ms = elapsedMs(startedAt);
        }
        throw error;
    } finally {
        clear();
    }
}

function normalizePositiveInt(value, fallback = 1, { min = 1, max = 8 } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function safeUsageObject(value = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveDefaultVideoPollMaxAttempts({ duration = 15, resolution = '720p' } = {}) {
    const seconds = Math.max(1, Number(duration) || 15);
    let targetSeconds = 480;
    if (seconds > 15) {
        targetSeconds += Math.min(300, Math.ceil((seconds - 15) * 12));
    }
    const normalizedResolution = normalizeVideoResolution(resolution || '720p');
    if (normalizedResolution === '1080p') targetSeconds += 120;
    if (normalizedResolution === '4k') targetSeconds += 300;
    return normalizePositiveInt(
        Math.ceil(targetSeconds / (DEFAULT_VIDEO_POLL_INTERVAL_MS / 1000)),
        DEFAULT_VIDEO_POLL_MAX_ATTEMPTS,
        { min: DEFAULT_VIDEO_POLL_MAX_ATTEMPTS, max: MAX_VIDEO_POLL_MAX_ATTEMPTS }
    );
}

function normalizeTimeoutMs(value, fallback = DEFAULT_PROVIDER_TIMEOUT_MS) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(600000, Math.max(10000, parsed));
}

function normalizeBodyTimeoutMs(value, fallback = DEFAULT_PROVIDER_TIMEOUT_MS) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(600000, Math.max(1000, parsed));
}

function resolveResponseBodyTimeoutMs(env = {}, fallback = DEFAULT_PROVIDER_TIMEOUT_MS) {
    const explicitBodyTimeout = readFirstEnv(env, ['AI_IMAGE_RESPONSE_BODY_TIMEOUT_MS', 'AI_IMAGE_FETCH_BODY_TIMEOUT_MS']);
    if (explicitBodyTimeout) {
        return normalizeBodyTimeoutMs(explicitBodyTimeout, fallback);
    }
    return normalizeBodyTimeoutMs(
        readFirstEnv(env, ['AI_IMAGE_PROVIDER_TIMEOUT_MS', 'AI_IMAGE_FETCH_TIMEOUT_MS']),
        fallback
    );
}

function normalizeTokenUsage(value = {}) {
    const usage = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const inputTokenDetails = safeUsageObject(usage.input_tokens_details || usage.inputTokenDetails || usage.prompt_tokens_details || usage.promptTokenDetails);
    const outputTokenDetails = safeUsageObject(usage.output_tokens_details || usage.outputTokenDetails || usage.completion_tokens_details || usage.completionTokenDetails);
    const cacheCreation = safeUsageObject(usage.cache_creation || usage.cacheCreation);
    const inputTokens = normalizePositiveInt(
        usage.input_tokens || usage.inputTokens || usage.prompt_tokens || usage.promptTokens,
        0,
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const outputTokens = normalizePositiveInt(
        usage.output_tokens || usage.outputTokens || usage.completion_tokens || usage.completionTokens,
        0,
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const totalTokens = normalizePositiveInt(
        usage.total_tokens || usage.totalTokens,
        inputTokens + outputTokens,
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const cacheReadTokens = normalizePositiveInt(
        usage.cache_read_tokens || usage.cacheReadTokens || usage.cache_read_input_tokens || usage.cacheReadInputTokens || inputTokenDetails.cached_tokens || inputTokenDetails.cachedTokens,
        0,
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const cacheWriteTokens = normalizePositiveInt(
        usage.cache_write_tokens || usage.cacheWriteTokens || usage.cache_creation_tokens || usage.cacheCreationTokens || usage.cache_creation_input_tokens || usage.cacheCreationInputTokens,
        normalizePositiveInt(cacheCreation.ephemeral_5m_input_tokens || cacheCreation.ephemeral5mInputTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER })
            + normalizePositiveInt(cacheCreation.ephemeral_1h_input_tokens || cacheCreation.ephemeral1hInputTokens, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );
    const imageOutputTokens = normalizePositiveInt(
        usage.image_output_tokens || usage.imageOutputTokens || outputTokenDetails.image_tokens || outputTokenDetails.imageTokens,
        0,
        { min: 0, max: Number.MAX_SAFE_INTEGER }
    );

    return {
        ...usage,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        inputTokens,
        outputTokens,
        totalTokens,
        cache_read_tokens: cacheReadTokens,
        cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        cacheWriteTokens,
        image_output_tokens: imageOutputTokens,
        imageOutputTokens
    };
}

function addTokenUsage(left = {}, right = {}) {
    const normalizedLeft = normalizeTokenUsage(left);
    const normalizedRight = normalizeTokenUsage(right);
    const leftCost = normalizeSub2ApiCost(normalizedLeft.sub2api_actual_cost ?? normalizedLeft.actual_cost ?? normalizedLeft.sub2api?.actual_cost, 0);
    const rightCost = normalizeSub2ApiCost(normalizedRight.sub2api_actual_cost ?? normalizedRight.actual_cost ?? normalizedRight.sub2api?.actual_cost, 0);
    const actualCost = normalizeSub2ApiCost(leftCost + rightCost, 0);
    return {
        input_tokens: normalizedLeft.input_tokens + normalizedRight.input_tokens,
        output_tokens: normalizedLeft.output_tokens + normalizedRight.output_tokens,
        total_tokens: normalizedLeft.total_tokens + normalizedRight.total_tokens,
        ...(actualCost > 0 ? {
            actual_cost: actualCost,
            actualCost,
            sub2api_actual_cost: actualCost,
            sub2apiActualCost: actualCost,
            sub2api: {
                actual_cost: actualCost,
                actualCost,
                records: [
                    ...(Array.isArray(normalizedLeft.sub2api?.records) ? normalizedLeft.sub2api.records : (normalizedLeft.sub2api?.request_id ? [normalizedLeft.sub2api] : [])),
                    ...(Array.isArray(normalizedRight.sub2api?.records) ? normalizedRight.sub2api.records : (normalizedRight.sub2api?.request_id ? [normalizedRight.sub2api] : []))
                ].filter(Boolean)
            }
        } : {})
    };
}

function resolveR2Config(env = {}) {
    const endpoint = readFirstEnv(env, ['AI_IMAGE_R2_ENDPOINT', 'R2_ENDPOINT']);
    const accessKeyId = readFirstEnv(env, ['AI_IMAGE_R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY']);
    const secretAccessKey = readFirstEnv(env, ['AI_IMAGE_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY', 'R2_SECRET_KEY']);
    const bucket = readFirstEnv(env, ['AI_IMAGE_R2_BUCKET_NAME', 'R2_BUCKET_NAME'], 'zaoyoeimages');
    const publicUrl = normalizePublicAssetBaseUrl(readFirstEnv(env, ['AI_IMAGE_R2_PUBLIC_URL', 'R2_PUBLIC_URL'], 'https://cdn.fatherkey.com'));

    return {
        configured: Boolean(endpoint && accessKeyId && secretAccessKey && bucket && publicUrl),
        endpoint,
        accessKeyId,
        secretAccessKey,
        bucket,
        publicUrl
    };
}

function isInlineDataUrlAllowed(env = {}) {
    return String(env?.AI_IMAGE_ALLOW_INLINE_DATA_URLS || '').trim().toLowerCase() === 'true';
}

function shouldRequireStorageBeforeCall({ model = '', env = {}, responseFormat = '' } = {}) {
    const normalizedModel = String(model || '').trim().toLowerCase();
    if (!/^gpt-image/.test(normalizedModel)) return false;
    if (String(responseFormat || '').trim().toLowerCase() === 'url') return false;
    return !resolveR2Config(env).configured && !isInlineDataUrlAllowed(env);
}

function getMediaFileExtension(mimeType = '', fallback = 'bin') {
    const normalized = normalizeMimeType(mimeType, '').toLowerCase();
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('mp4')) return 'mp4';
    if (normalized.includes('quicktime') || normalized.includes('mov')) return 'mov';
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('mpegurl') || normalized.includes('hls')) return 'm3u8';
    return fallback;
}

function buildStoredImageKey({ task = {}, index = 0, buffer, mimeType = 'image/png' } = {}) {
    const extension = getMediaFileExtension(mimeType, 'png');
    const site = normalizeText(task.site, 20) || 'cn';
    const userId = normalizeText(task.user_id, 120).replace(/[^a-z0-9-]/gi, '') || 'user';
    const taskId = normalizeText(task.id, 120).replace(/[^a-z0-9-]/gi, '') || 'task';
    const digest = crypto.createHash('sha256').update(buffer || Buffer.alloc(0)).digest('hex').slice(0, 16);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    return `ai-images/${site}/${year}/${month}/${userId}/${taskId}-${index}-${digest}.${extension}`;
}

function buildStoredVideoKey({ task = {}, index = 0, buffer, mimeType = 'video/mp4' } = {}) {
    const extension = getMediaFileExtension(mimeType, 'mp4');
    const site = normalizeText(task.site, 20) || 'cn';
    const userId = normalizeText(task.user_id, 120).replace(/[^a-z0-9-]/gi, '') || 'user';
    const taskId = normalizeText(task.id, 120).replace(/[^a-z0-9-]/gi, '') || 'task';
    const digest = crypto.createHash('sha256').update(buffer || Buffer.alloc(0)).digest('hex').slice(0, 16);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    return `ai-videos/${site}/${year}/${month}/${userId}/${taskId}-${index}-${digest}.${extension}`;
}

function shouldUsePreviewFirst(env = {}) {
    return String(env?.AI_IMAGE_PREVIEW_FIRST || env?.AI_IMAGE_PREVIEW_FIRST_ENABLED || 'true')
        .trim()
        .toLowerCase() !== 'false';
}

function normalizePreviewMaxEdge(env = {}) {
    const parsed = Number.parseInt(String(env?.AI_IMAGE_PREVIEW_MAX_EDGE || '').trim(), 10);
    if (!Number.isFinite(parsed)) return 1280;
    return Math.min(1800, Math.max(640, parsed));
}

function normalizePreviewQuality(env = {}) {
    const parsed = Number.parseInt(String(env?.AI_IMAGE_PREVIEW_QUALITY || '').trim(), 10);
    if (!Number.isFinite(parsed)) return 78;
    return Math.min(90, Math.max(48, parsed));
}

function buildStoredImageKeyWithVariant({ task = {}, index = 0, buffer, mimeType = 'image/png', variant = '' } = {}) {
    const baseKey = buildStoredImageKey({ task, index, buffer, mimeType });
    const normalizedVariant = normalizeText(variant, 40).replace(/[^a-z0-9-]/gi, '').toLowerCase();
    if (!normalizedVariant) return baseKey;
    return baseKey.replace(/(\.[a-z0-9]+)$/i, `-${normalizedVariant}$1`);
}

function buildStoredVideoKeyWithVariant({ task = {}, index = 0, buffer, mimeType = 'video/mp4', variant = '' } = {}) {
    const baseKey = buildStoredVideoKey({ task, index, buffer, mimeType });
    const normalizedVariant = normalizeText(variant, 40).replace(/[^a-z0-9-]/gi, '').toLowerCase();
    if (!normalizedVariant) return baseKey;
    return baseKey.replace(/(\.[a-z0-9]+)$/i, `-${normalizedVariant}$1`);
}

async function buildPreviewImageBuffer(buffer, {
    env = process.env,
    mimeType = 'image/png',
    timing = null
} = {}) {
    const startedAt = nowMs();
    try {
        // sharp is already a project dependency; keep it lazy so tests that do not touch
        // real image buffers do not pay the native module load cost.
        const sharp = require('sharp');
        const previewBuffer = await sharp(buffer, { failOn: 'none' })
            .rotate()
            .resize({
                width: normalizePreviewMaxEdge(env),
                height: normalizePreviewMaxEdge(env),
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({
                quality: normalizePreviewQuality(env),
                effort: 4
            })
            .toBuffer();
        if (previewBuffer?.length) {
            addTimingMs(timing, 'preview_build_ms', elapsedMs(startedAt));
            return {
                buffer: previewBuffer,
                mimeType: 'image/webp'
            };
        }
    } catch (_) {
        // Fall back to the original bytes if preview transcoding is unavailable.
    }

    addTimingMs(timing, 'preview_build_ms', elapsedMs(startedAt));
    return {
        buffer,
        mimeType
    };
}

async function uploadImageBufferToR2Object(buffer, {
    env = process.env,
    task = {},
    index = 0,
    mimeType = 'image/png',
    variant = '',
    timing = null,
    timingKey = 'upload_ms'
} = {}) {
    const config = resolveR2Config(env);
    if (!config.configured) {
        if (isInlineDataUrlAllowed(env)) {
            const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
            return {
                image_url: dataUrl,
                original_image_url: dataUrl,
                storage_path: '',
                original_storage_path: ''
            };
        }

        const error = new Error('AI 图片存储未配置，无法保存模型返回的 base64 原图');
        error.statusCode = 503;
        error.code = 'ai_image_storage_not_configured';
        throw error;
    }

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const key = buildStoredImageKeyWithVariant({ task, index, buffer, mimeType, variant });
    const client = new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        }
    });

    const uploadStartedAt = nowMs();
    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable'
    }));
    addTimingMs(timing, timingKey, elapsedMs(uploadStartedAt));

    const url = `${config.publicUrl}/${key}`;
    return {
        url,
        key
    };
}

async function uploadVideoBufferToR2Object(buffer, {
    env = process.env,
    task = {},
    index = 0,
    mimeType = 'video/mp4',
    variant = 'original',
    timing = null,
    timingKey = 'deferred_original_upload_ms'
} = {}) {
    const config = resolveR2Config(env);
    if (!config.configured) {
        const error = new Error('AI 视频存储未配置，无法后台保存视频结果');
        error.statusCode = 503;
        error.code = 'ai_video_storage_not_configured';
        throw error;
    }

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const key = buildStoredVideoKeyWithVariant({ task, index, buffer, mimeType, variant });
    const client = new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        }
    });

    const uploadStartedAt = nowMs();
    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable'
    }));
    addTimingMs(timing, timingKey, elapsedMs(uploadStartedAt));

    return {
        url: `${config.publicUrl}/${key}`,
        key
    };
}

async function uploadGeneratedImageBufferToR2(buffer, {
    env = process.env,
    task = {},
    index = 0,
    mimeType = 'image/png',
    timing = null
} = {}) {
    const config = resolveR2Config(env);
    if (!config.configured) {
        if (isInlineDataUrlAllowed(env)) {
            const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
            return {
                image_url: dataUrl,
                original_image_url: dataUrl,
                storage_path: '',
                original_storage_path: ''
            };
        }

        const error = new Error('AI 图片存储未配置，无法保存模型返回的 base64 原图');
        error.statusCode = 503;
        error.code = 'ai_image_storage_not_configured';
        throw error;
    }

    const stored = await uploadImageBufferToR2Object(buffer, {
        env,
        task,
        index,
        mimeType,
        variant: 'original',
        timing,
        timingKey: 'original_upload_ms'
    });

    return {
        image_url: stored.url,
        original_image_url: stored.url,
        storage_path: stored.key,
        original_storage_path: stored.key
    };
}

async function uploadGeneratedImageBufferPreviewFirst(buffer, {
    env = process.env,
    task = {},
    index = 0,
    mimeType = 'image/png',
    timing = null
} = {}) {
    const config = resolveR2Config(env);
    if (!config.configured || !shouldUsePreviewFirst(env)) {
        return {
            stored: await uploadGeneratedImageBufferToR2(buffer, {
                env,
                task,
                index,
                mimeType,
                timing
            }),
            deferredOriginalUpload: null
        };
    }

    const preview = await buildPreviewImageBuffer(buffer, { env, mimeType, timing });
    const previewStored = await uploadImageBufferToR2Object(preview.buffer, {
        env,
        task,
        index,
        mimeType: preview.mimeType,
        variant: 'preview',
        timing,
        timingKey: 'preview_upload_ms'
    });

    return {
        stored: {
            image_url: previewStored.url,
            original_image_url: '',
            storage_path: previewStored.key,
            original_storage_path: '',
            metadata: {
                preview_status: 'ready',
                original_status: 'pending',
                preview_mime_type: preview.mimeType,
                original_mime_type: mimeType,
                preview_bytes: preview.buffer.length,
                original_bytes: buffer.length
            }
        },
        deferredOriginalUpload: {
            resultIndex: index,
            run: async ({ result }) => {
                const originalStored = await uploadImageBufferToR2Object(buffer, {
                    env,
                    task,
                    index,
                    mimeType,
                    variant: 'original',
                    timing,
                    timingKey: 'deferred_original_upload_ms'
                });
                return {
                    resultId: result?.id || '',
                    image_url: previewStored.url,
                    original_image_url: originalStored.url,
                    storage_path: previewStored.key,
                    original_storage_path: originalStored.key,
                    metadata: {
                        preview_status: 'ready',
                        original_status: 'ready',
                        original_ready_at: new Date().toISOString(),
                        preview_mime_type: preview.mimeType,
                        original_mime_type: mimeType,
                        preview_bytes: preview.buffer.length,
                        original_bytes: buffer.length
                    }
                };
            }
        }
    };
}

async function resolveAiImageRuntimeConfig({
    supabase,
    task = {},
    env = process.env
} = {}) {
    const resolveStartedAt = nowMs();
    let providerConfigMs = 0;
    let providerConfigCacheStatus = '';
    let runtimeSecretMs = 0;
    let codexConfigMs = 0;
    let storedAiImageConfig = null;
    let storedCodexConfig = null;
    const envAiImageApiKey = readFirstEnv(env, ['AI_IMAGE_API_KEY']);
    const sharedEnvApiKey = readFirstEnv(env, ['OPENAI_API_KEY', 'CODEX_API_KEY']);

    if (!envAiImageApiKey && supabase?.from) {
        const providerStartedAt = nowMs();
        try {
            const providerConfig = await resolveAiImageProviderRuntimeConfig(supabase, { task, env });
            providerConfigCacheStatus = normalizeText(providerConfig?.cacheStatus || providerConfig?.cache_status, 40);
            if (providerConfig?.apiKey && providerConfig?.baseUrl) {
                storedAiImageConfig = providerConfig;
            }
        } catch (_) {
            storedAiImageConfig = null;
        } finally {
            providerConfigMs = elapsedMs(providerStartedAt);
        }
    }

    if (!envAiImageApiKey && !storedAiImageConfig?.apiKey && supabase?.from) {
        const runtimeSecretStartedAt = nowMs();
        try {
            storedAiImageConfig = await resolveAiImageRuntimeSecretConfig(supabase, { env });
        } catch (_) {
            storedAiImageConfig = null;
        } finally {
            runtimeSecretMs = elapsedMs(runtimeSecretStartedAt);
        }
    }

    if (!envAiImageApiKey && !storedAiImageConfig?.apiKey && !sharedEnvApiKey && supabase?.from) {
        const codexStartedAt = nowMs();
        try {
            storedCodexConfig = await resolveCodexRuntimeConfig(supabase);
        } catch (_) {
            storedCodexConfig = null;
        } finally {
            codexConfigMs = elapsedMs(codexStartedAt);
        }
    }

    const apiKey = envAiImageApiKey || storedAiImageConfig?.apiKey || sharedEnvApiKey || storedCodexConfig?.apiKey || '';
    const envVideoEndpoint = readFirstEnv(env, ['AI_IMAGE_VIDEO_ENDPOINT', 'AI_VIDEO_ENDPOINT', 'AI_IMAGE_VIDEO_GENERATION_ENDPOINT']);
    const baseUrl = normalizeBaseUrl(
        readFirstEnv(env, ['AI_IMAGE_API_BASE_URL'])
        || storedAiImageConfig?.baseUrl
        || readFirstEnv(env, ['OPENAI_API_BASE_URL', 'OPENAI_BASE_URL', 'CODEX_API_BASE_URL'])
        || storedCodexConfig?.baseUrl
        || DEFAULT_OPENAI_BASE_URL
    );
    const defaultModel = readFirstEnv(env, ['AI_IMAGE_MODEL'])
        || storedAiImageConfig?.model
        || readFirstEnv(env, ['OPENAI_IMAGE_MODEL'])
        || DEFAULT_IMAGE_MODEL;
    const taskModel = normalizeText(task.model, 160);
    const isTextVisionMode = TEXT_VISION_MODES.has(String(task.mode || '').trim());
    const model = isTextVisionMode
        ? normalizeChatModel(taskModel || readFirstEnv(env, ['AI_IMAGE_CHAT_MODEL', 'OPENAI_CHAT_MODEL']) || DEFAULT_CHAT_MODEL)
        : normalizeImageModel(
            (!taskModel || taskModel === 'gpt-image' || taskModel === 'gpt-image-api')
                ? (defaultModel || taskModel || DEFAULT_IMAGE_MODEL)
                : taskModel
        );

    return {
        configured: Boolean(apiKey && baseUrl),
        apiKey,
        baseUrl,
        model,
        providerId: storedAiImageConfig?.providerId || '',
        providerLabel: storedAiImageConfig?.label || '',
        protocol: normalizeProviderProtocol(storedAiImageConfig?.protocol || storedAiImageConfig?.adapter),
        asyncResult: storedAiImageConfig?.asyncResult || storedAiImageConfig?.async_result || null,
        async_result: storedAiImageConfig?.asyncResult || storedAiImageConfig?.async_result || null,
        videoEndpoint: normalizeEndpointPath(envVideoEndpoint || storedAiImageConfig?.videoEndpoint || storedAiImageConfig?.video_endpoint || storedAiImageConfig?.videoGenerationEndpoint || storedAiImageConfig?.video_generation_endpoint),
        video_endpoint: normalizeEndpointPath(envVideoEndpoint || storedAiImageConfig?.videoEndpoint || storedAiImageConfig?.video_endpoint || storedAiImageConfig?.videoGenerationEndpoint || storedAiImageConfig?.video_generation_endpoint),
        endpoints: normalizeEndpointsConfig(storedAiImageConfig?.endpoints),
        visionModels: normalizeModelsList(storedAiImageConfig?.visionModels || storedAiImageConfig?.vision_models || storedAiImageConfig?.chatVisionModels || storedAiImageConfig?.chat_vision_models),
        source: envAiImageApiKey
            ? 'environment'
            : (storedAiImageConfig?.source === 'ai-image-provider-stored'
                ? 'ai-image-provider-stored'
                : (storedAiImageConfig?.source === 'stored'
                    ? 'ai-image-stored'
                : (sharedEnvApiKey
                    ? 'shared-environment'
                    : (storedCodexConfig?.source === 'stored' ? 'codex-stored' : 'missing'))))
        ,
        timing: {
            total_ms: elapsedMs(resolveStartedAt),
            provider_config_ms: providerConfigMs,
            provider_config_cache_status: providerConfigCacheStatus,
            runtime_secret_ms: runtimeSecretMs,
            codex_config_ms: codexConfigMs
        }
    };
}

function buildImagePrompt(task = {}) {
    const parts = [normalizeText(task.prompt, 8000)];
    const aspectRatio = normalizeGeminiImageAspectRatio(task.ratio || '1:1');
    const imageSize = normalizeGeminiImageSize(task.resolution || '1k');
    const negativePrompt = normalizeText(task.negative_prompt, 4000);
    const referenceImageUrl = normalizeText(task.reference_image_url, 4000);

    parts.push(`Canvas requirement: aspect ratio ${aspectRatio}, image size ${imageSize}. ${describeGeminiAspectRatioInstruction(aspectRatio)}`);
    if (referenceImageUrl) {
        parts.push(`Reference image URL: ${referenceImageUrl}`);
    }
    if (negativePrompt) {
        parts.push(`Avoid: ${negativePrompt}`);
    }

    return parts.filter(Boolean).join('\n\n').slice(0, 12000);
}

function buildImageEditPrompt(task = {}) {
    const parts = [normalizeText(task.prompt, 8000)];
    const negativePrompt = normalizeText(task.negative_prompt, 4000);

    if (negativePrompt) {
        parts.push(`Avoid: ${negativePrompt}`);
    }

    return parts.filter(Boolean).join('\n\n').slice(0, 12000);
}

function buildReversePromptInstruction(task = {}) {
    const userHint = normalizeText(task.prompt, 4000);
    const title = normalizeText(task.reference_title, 500);
    const parts = [
        '你是专业 AI 图像提示词反推助手。请根据参考图片生成一段可直接用于文生图的高质量提示词。',
        '要求：描述主体、构图、光线、色彩、材质、镜头/风格、商业可用细节；不要声称知道不可见信息；不要输出无关解释。',
        title ? `参考标题：${title}` : '',
        userHint ? `用户补充要求：${userHint}` : ''
    ];
    return parts.filter(Boolean).join('\n');
}

function buildChatPromptInstruction(task = {}) {
    return normalizeText(task.prompt, 8000) || '请继续处理当前 AI 图片工作台对话。';
}

function buildOpenAiChatMessages(task = {}, { referenceImageUrl = '' } = {}) {
    if (task.mode === 'reverse') {
        const content = [{
            type: 'text',
            text: buildReversePromptInstruction(task)
        }];
        const resolvedReferenceImageUrl = referenceImageUrl || normalizeText(task.reference_image_url, 4000);
        if (resolvedReferenceImageUrl) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: resolvedReferenceImageUrl
                }
            });
        }
        return [{
            role: 'user',
            content
        }];
    }

    return [{
        role: 'user',
        content: buildChatPromptInstruction(task)
    }];
}

async function readUpstreamPayload(response, timing = null, {
    env = process.env,
    signal = null,
    label = 'AI 图片上游响应体'
} = {}) {
    const text = await readResponseBodyWithTimeout(response, () => response.text(), {
        env,
        label,
        timing,
        timingKey: 'response_text_ms',
        signal
    });
    let payload = {};
    let parseMs = 0;

    if (text) {
        const parseStart = nowMs();
        try {
            payload = JSON.parse(text);
        } catch (_) {
            payload = { message: text };
        }
        parseMs = elapsedMs(parseStart);
    }

    if (timing && typeof timing === 'object') {
        timing.response_parse_ms = Number(timing.response_parse_ms || 0) + parseMs;
        timing.response_body_ms = Number(timing.response_body_ms || 0) + Number(timing.response_text_ms || 0) + parseMs;
    }

    return payload;
}

function buildUpstreamError(response, payload = {}) {
    const message = normalizeText(
        payload?.error?.message || payload?.message || `AI image provider returned HTTP ${payload?.code || response.status}`,
        1000
    );
    const error = new Error(message);
    error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
    error.code = normalizeText(payload?.error?.code || payload?.code || 'ai_image_provider_error', 120);
    return error;
}

function summarizeUpstreamPayload(payload = {}) {
    const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const data = Array.isArray(safePayload.data) ? safePayload.data : [];
    const first = data[0] && typeof data[0] === 'object' && !Array.isArray(data[0]) ? data[0] : {};
    return {
        top_level_keys: Object.keys(safePayload).slice(0, 30),
        data_is_array: Array.isArray(safePayload.data),
        data_count: data.length,
        first_item_keys: Object.keys(first).slice(0, 30),
        has_error: Boolean(safePayload.error),
        error_code: normalizeText(safePayload.error?.code || safePayload.code, 120),
        error_message: normalizeText(safePayload.error?.message || safePayload.message, 500),
        id: normalizeText(safePayload.id || safePayload.task_id || safePayload.provider_task_id, 240),
        status: normalizeText(safePayload.status || safePayload.state, 80),
        output_keys: safePayload.output && typeof safePayload.output === 'object' && !Array.isArray(safePayload.output)
            ? Object.keys(safePayload.output).slice(0, 30)
            : []
    };
}

function getProviderTaskIdFromPayload(payload = {}) {
    return normalizeText(
        payload?.id
        || payload?.task_id
        || payload?.taskId
        || payload?.provider_task_id
        || payload?.providerTaskId
        || payload?.data?.id
        || payload?.data?.task_id
        || payload?.result?.id
        || payload?.output?.id,
        240
    );
}

function getProviderStatusFromPayload(payload = {}) {
    return normalizeText(
        payload?.status
        || payload?.state
        || payload?.task_status
        || payload?.taskStatus
        || payload?.data?.status
        || payload?.data?.state
        || payload?.result?.status
        || payload?.output?.status,
        80
    ).toLowerCase();
}

function isPendingProviderStatus(status = '') {
    return ['queued', 'pending', 'running', 'processing', 'in_progress', 'submitted', 'created', 'starting'].includes(
        normalizeText(status, 80).toLowerCase()
    );
}

function isSuccessProviderStatus(status = '') {
    return ['succeeded', 'success', 'completed', 'complete', 'done', 'finished', 'finish'].includes(
        normalizeText(status, 80).toLowerCase()
    );
}

function isTerminalFailureProviderStatus(status = '') {
    return ['failed', 'failure', 'error', 'cancelled', 'canceled', 'rejected', 'expired'].includes(
        normalizeText(status, 80).toLowerCase()
    );
}

function normalizeProviderImageItems(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items
        .map((item) => {
            if (!item) return null;
            if (typeof item === 'string') {
                return item.startsWith('http')
                    ? { url: item }
                    : { b64_json: item };
            }
            if (typeof item !== 'object' || Array.isArray(item)) return null;
            const url = item.url || item.image_url || item.imageUrl || item.output_url || item.outputUrl || item.original_url || item.originalUrl;
            const b64Json = item.b64_json || item.b64Json || item.base64 || item.image_base64 || item.imageBase64;
            return {
                ...item,
                ...(url ? { url } : {}),
                ...(b64Json ? { b64_json: b64Json } : {})
            };
        })
        .filter((item) => item && (item.url || item.image_url || item.b64_json));
}

function normalizeProviderVideoItems(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items
        .map((item) => {
            if (!item) return null;
            if (typeof item === 'string') {
                return item.startsWith('http') ? { url: item } : null;
            }
            if (typeof item !== 'object' || Array.isArray(item)) return null;
            const url = item.url
                || item.video_url
                || item.videoUrl
                || item.content_url
                || item.contentUrl
                || item.download_url
                || item.downloadUrl
                || item.output_url
                || item.outputUrl
                || item.result_url
                || item.resultUrl
                || item.original_url
                || item.originalUrl;
            return {
                ...item,
                ...(url ? { url } : {})
            };
        })
        .filter((item) => item && (item.url || item.video_url));
}

function extractProviderImageData(payload = {}) {
    const candidates = [
        payload?.data,
        payload?.images,
        payload?.image,
        payload?.output,
        payload?.output?.images,
        payload?.output?.image,
        payload?.result,
        payload?.result?.images,
        payload?.result?.image,
        payload?.result_url,
        payload?.resultUrl,
        payload?.url,
        payload?.image_url,
        payload?.imageUrl,
        payload?.b64_json
    ];
    for (const candidate of candidates) {
        const images = normalizeProviderImageItems(candidate);
        if (images.length) return images;
    }
    return [];
}

function extractProviderVideoData(payload = {}) {
    const candidates = [
        payload?.data,
        payload?.videos,
        payload?.video,
        payload?.output,
        payload?.output?.videos,
        payload?.output?.video,
        payload?.output?.video_url,
        payload?.output?.videoUrl,
        payload?.output?.content_url,
        payload?.output?.contentUrl,
        payload?.output?.download_url,
        payload?.output?.downloadUrl,
        payload?.result,
        payload?.result?.videos,
        payload?.result?.video,
        payload?.result?.video_url,
        payload?.result?.videoUrl,
        payload?.result?.content_url,
        payload?.result?.contentUrl,
        payload?.result?.download_url,
        payload?.result?.downloadUrl,
        payload?.result_url,
        payload?.resultUrl,
        payload?.content_url,
        payload?.contentUrl,
        payload?.download_url,
        payload?.downloadUrl,
        payload?.url,
        payload?.video_url,
        payload?.videoUrl
    ];
    for (const candidate of candidates) {
        const videos = normalizeProviderVideoItems(candidate);
        if (videos.length) return videos;
    }
    return [];
}

function normalizeAsyncResultConfig(value = {}, defaults = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const defaultIntervalMs = normalizePositiveInt(defaults.intervalMs, 2500, { min: 500, max: 15000 });
    const maxAttemptsMax = normalizePositiveInt(defaults.maxAttemptsMax, 120, { min: 1, max: 240 });
    const defaultMaxAttempts = normalizePositiveInt(defaults.maxAttempts, 8, { min: 1, max: maxAttemptsMax });
    return {
        enabled: source.enabled !== false && source.enable !== false,
        method: normalizeText(source.method || 'GET', 12).toUpperCase() || 'GET',
        path: normalizeText(source.path || source.statusPath || source.status_path || source.resultPath || source.result_path, 500),
        paths: Array.isArray(source.paths) ? source.paths.map((item) => normalizeText(item, 500)).filter(Boolean) : [],
        intervalMs: normalizePositiveInt(source.intervalMs || source.interval_ms, defaultIntervalMs, { min: 500, max: 15000 }),
        maxAttempts: normalizePositiveInt(source.maxAttempts || source.max_attempts, defaultMaxAttempts, { min: 1, max: maxAttemptsMax })
    };
}

function buildAsyncPollPathCandidates(providerTaskId = '', config = {}, mediaType = 'image') {
    const taskId = encodeURIComponent(providerTaskId);
    const explicit = [
        config.path,
        ...(Array.isArray(config.paths) ? config.paths : [])
    ].filter(Boolean);
    const videoDefaults = [
        `/videos/${taskId}`,
        `/videos/generations/${taskId}`,
        `/videos/tasks/${taskId}`,
        `/video/tasks/${taskId}`,
        `/tasks/${taskId}`,
        `/task/${taskId}`
    ];
    const imageDefaults = [
        `/images/generations/${taskId}`,
        `/images/edits/${taskId}`,
        `/images/tasks/${taskId}`,
        `/tasks/${taskId}`,
        `/task/${taskId}`
    ];
    const defaults = mediaType === 'video' ? videoDefaults : imageDefaults;
    return [...explicit, ...defaults]
        .map((path) => String(path || '').replace(/\{(?:id|task_id|taskId)\}/g, taskId))
        .filter(Boolean);
}

async function updateProviderTaskHandle(supabase, task = {}, providerTaskId = '', metadata = {}) {
    if (!supabase?.from || !task?.id || !providerTaskId) return null;
    const currentMetadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : {};
    const sub2ApiClientRequestId = normalizeText(metadata.sub2api_client_request_id || metadata.sub2ApiClientRequestId, 160);
    const nextMetadata = {
        ...currentMetadata,
        provider_task_id: providerTaskId,
        providerTaskId: providerTaskId,
        ...(sub2ApiClientRequestId ? {
            sub2api_client_request_id: sub2ApiClientRequestId,
            sub2apiClientRequestId: sub2ApiClientRequestId
        } : {}),
        provider_async: {
            ...(currentMetadata.provider_async && typeof currentMetadata.provider_async === 'object' && !Array.isArray(currentMetadata.provider_async) ? currentMetadata.provider_async : {}),
            ...metadata,
            provider_task_id: providerTaskId,
            saved_at: new Date().toISOString()
        }
    };
    try {
        const { data } = await supabase
            .from('ai_image_tasks')
            .update({
                provider_task_id: providerTaskId,
                metadata: nextMetadata
            })
            .eq('id', task.id)
            .eq('status', 'running')
            .select('id, provider_task_id, metadata')
            .maybeSingle();
        if (data?.metadata) {
            task.metadata = data.metadata;
        }
        if (data?.provider_task_id) {
            task.provider_task_id = data.provider_task_id;
        }
        return data || null;
    } catch (_) {
        return null;
    }
}

function buildAsyncPollUrl(baseUrl = '', path = '') {
    if (/^https?:\/\//i.test(path)) return path;
    const root = normalizeBaseUrl(baseUrl).replace(/\/+$/, '');
    const suffix = String(path || '').startsWith('/') ? path : `/${path}`;
    return `${root}${suffix}`;
}

async function pollOpenAiCompatibleImageResult({
    task = {},
    config = {},
    providerTaskId = '',
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null,
    timing = null
} = {}) {
    const asyncConfig = normalizeAsyncResultConfig(config.asyncResult || config.async_result || {});
    if (!asyncConfig.enabled || !providerTaskId || typeof fetchImpl !== 'function') {
        return null;
    }

    const paths = buildAsyncPollPathCandidates(providerTaskId, asyncConfig);
    let lastPayload = null;
    let lastStatus = '';
    let attempts = 0;

    for (let attempt = 1; attempt <= asyncConfig.maxAttempts; attempt += 1) {
        attempts = attempt;
        if (attempt > 1) {
            await sleep(asyncConfig.intervalMs);
        }

        for (const path of paths) {
            const pollStart = nowMs();
            const response = await fetchProviderResponse(fetchImpl, buildAsyncPollUrl(config.baseUrl, path), {
                method: asyncConfig.method || 'GET',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                ...(signal ? { signal } : {})
            }, {
                env,
                label: 'AI 图片结果查询上游'
            });
            const requestMs = elapsedMs(pollStart);
            const payloadTiming = {};
            const payload = await readUpstreamPayload(response, payloadTiming, { env, signal });
            const responseMs = Number(payloadTiming.response_body_ms || 0) || 0;
            addTimingMs(timing, 'async_poll_request_ms', requestMs);
            addTimingMs(timing, 'async_poll_response_ms', responseMs);
            addTimingMs(timing, 'async_poll_ms', requestMs + responseMs);
            lastPayload = payload;
            lastStatus = getProviderStatusFromPayload(payload);

            if (!response.ok) {
                if (response.status === 404) continue;
                throw buildUpstreamError(response, payload);
            }

            const images = extractProviderImageData(payload);
            if (images.length) {
                return {
                    data: images,
                    payload,
                    status: lastStatus,
                    attempts,
                    path
                };
            }

            if (isTerminalFailureProviderStatus(lastStatus)) {
                const error = new Error(normalizeText(payload?.error?.message || payload?.message || 'AI 图片上游任务失败', 1000));
                error.statusCode = 502;
                error.code = normalizeText(payload?.error?.code || payload?.code || 'ai_image_provider_task_failed', 120);
                throw error;
            }

            if (isPendingProviderStatus(lastStatus)) {
                break;
            }
        }
    }

    return {
        data: [],
        payload: lastPayload,
        status: lastStatus,
        attempts,
        path: ''
    };
}

async function pollOpenAiCompatibleVideoResult({
    task = {},
    config = {},
    providerTaskId = '',
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null,
    timing = null
} = {}) {
    const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata) ? task.metadata : {};
    const videoResolution = normalizeVideoResolution(metadata.video_resolution || metadata.resolution || task.resolution || '720p');
    const duration = normalizeVideoDuration(metadata.duration ?? metadata.video_duration ?? env.AI_VIDEO_DURATION_SECONDS, 15);
    const asyncConfig = normalizeAsyncResultConfig(config.asyncResult || config.async_result || {}, {
        intervalMs: DEFAULT_VIDEO_POLL_INTERVAL_MS,
        maxAttempts: resolveDefaultVideoPollMaxAttempts({
            duration,
            resolution: videoResolution
        }),
        maxAttemptsMax: MAX_VIDEO_POLL_MAX_ATTEMPTS
    });
    if (!asyncConfig.enabled || !providerTaskId || typeof fetchImpl !== 'function') {
        return null;
    }

    const paths = buildAsyncPollPathCandidates(providerTaskId, asyncConfig, 'video');
    let lastPayload = null;
    let lastStatus = '';
    let attempts = 0;

    for (let attempt = 1; attempt <= asyncConfig.maxAttempts; attempt += 1) {
        attempts = attempt;
        if (attempt > 1) {
            await sleep(asyncConfig.intervalMs);
        }

        for (const path of paths) {
            const pollStart = nowMs();
            const response = await fetchProviderResponse(fetchImpl, buildAsyncPollUrl(config.baseUrl, path), {
                method: asyncConfig.method || 'GET',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                ...(signal ? { signal } : {})
            }, {
                env,
                label: 'AI 视频结果查询上游'
            });
            const requestMs = elapsedMs(pollStart);
            const payloadTiming = {};
            const payload = await readUpstreamPayload(response, payloadTiming, { env, signal });
            const responseMs = Number(payloadTiming.response_body_ms || 0) || 0;
            addTimingMs(timing, 'async_poll_request_ms', requestMs);
            addTimingMs(timing, 'async_poll_response_ms', responseMs);
            addTimingMs(timing, 'async_poll_ms', requestMs + responseMs);
            lastPayload = payload;
            lastStatus = getProviderStatusFromPayload(payload);

            if (!response.ok) {
                if (response.status === 404) continue;
                throw buildUpstreamError(response, payload);
            }

            const videos = extractProviderVideoData(payload);
            if (videos.length) {
                return {
                    data: videos,
                    payload,
                    status: lastStatus,
                    attempts,
                    path
                };
            }

            if (isSuccessProviderStatus(lastStatus)) {
                const contentItem = buildProviderVideoContentItem(config, getProviderTaskIdFromPayload(payload) || providerTaskId);
                if (contentItem) {
                    return {
                        data: [contentItem],
                        payload,
                        status: lastStatus,
                        attempts,
                        path
                    };
                }
            }

            if (isTerminalFailureProviderStatus(lastStatus)) {
                const error = new Error(normalizeText(payload?.error?.message || payload?.message || 'AI 视频上游任务失败', 1000));
                error.statusCode = 502;
                error.code = normalizeText(payload?.error?.code || payload?.code || 'ai_video_provider_task_failed', 120);
                throw error;
            }

            if (isPendingProviderStatus(lastStatus)) {
                break;
            }
        }
    }

    return {
        data: [],
        payload: lastPayload,
        status: lastStatus,
        attempts,
        path: ''
    };
}

function extractFetchErrorSignal(error = {}) {
    return [
        error.name,
        error.code,
        error.message,
        error.cause?.name,
        error.cause?.code,
        error.cause?.message
    ].map((item) => normalizeText(item, 240)).filter(Boolean).join(' | ');
}

function buildProviderFetchError(error = {}, {
    timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    timeoutFired = false,
    label = 'AI 图片上游'
} = {}) {
    const signal = extractFetchErrorSignal(error);
    const normalizedSignal = signal.toLowerCase();
    const timeout = timeoutFired
        || normalizedSignal.includes('abort')
        || normalizedSignal.includes('timeout')
        || normalizedSignal.includes('timed out')
        || normalizedSignal.includes('und_err_connect_timeout')
        || normalizedSignal.includes('etimedout');
    const dns = normalizedSignal.includes('enotfound')
        || normalizedSignal.includes('eai_again')
        || normalizedSignal.includes('dns');
    const tls = normalizedSignal.includes('cert')
        || normalizedSignal.includes('tls')
        || normalizedSignal.includes('ssl');
    const connection = normalizedSignal.includes('econnrefused')
        || normalizedSignal.includes('econnreset')
        || normalizedSignal.includes('ehostunreach')
        || normalizedSignal.includes('enetunreach')
        || normalizedSignal.includes('und_err_socket')
        || normalizedSignal.includes('socket');

    const code = timeout
        ? 'ai_image_provider_timeout'
        : (dns
            ? 'ai_image_provider_dns_failed'
            : (tls
                ? 'ai_image_provider_tls_failed'
                : (connection ? 'ai_image_provider_connection_failed' : 'ai_image_provider_network_failed')));
    const summary = signal ? `（${normalizeText(signal, 180)}）` : '';
    const message = timeout
        ? `${label}请求超时（${Math.round(timeoutMs / 1000)} 秒），请稍后重试，或降低分辨率/张数后再试。${summary}`
        : (dns
            ? `${label}域名解析失败，请检查模型 Base URL 是否可访问。${summary}`
            : (tls
                ? `${label}TLS/证书校验失败，请检查 Base URL 证书配置。${summary}`
                : (connection
                    ? `${label}连接失败，请检查上游服务状态和网络连通性。${summary}`
                    : `${label}网络请求失败，请检查上游服务、代理网络或参考图片 URL 是否可访问。${summary}`)));

    const nextError = new Error(message);
    nextError.statusCode = timeout ? 504 : 502;
    nextError.code = code;
    nextError.cause = error;
    return nextError;
}

function normalizeMimeType(value = '', fallback = 'image/png') {
    const normalized = normalizeText(value, 120).toLowerCase();
    if (!normalized) return fallback;
    return normalized.split(';')[0].trim() || fallback;
}

async function fetchProviderResponse(fetchImpl, url, options = {}, {
    env = process.env,
    label = 'AI 图片上游'
} = {}) {
    const timeoutMs = normalizeTimeoutMs(
        env.AI_IMAGE_PROVIDER_TIMEOUT_MS || env.AI_IMAGE_FETCH_TIMEOUT_MS,
        DEFAULT_PROVIDER_TIMEOUT_MS
    );
    const externalSignal = options.signal || null;
    const controller = typeof AbortController === 'function'
        ? new AbortController()
        : null;
    let externalAbortHandler = null;
    const signals = [
        externalSignal,
        controller?.signal
    ].filter(Boolean);
    const signal = signals.length > 1 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
        ? AbortSignal.any(signals)
        : (controller?.signal || externalSignal || null);
    let timeoutFired = false;
    const timer = controller
        ? setTimeout(() => {
            timeoutFired = true;
            controller.abort();
        }, timeoutMs)
        : null;

    try {
        if (externalSignal && controller && signal === controller.signal) {
            externalAbortHandler = () => controller.abort();
            if (externalSignal.aborted) {
                controller.abort();
            } else if (typeof externalSignal.addEventListener === 'function') {
                externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
            }
        }
        const { signal: _ignoredSignal, ...fetchOptions } = options;
        return await fetchImpl(url, {
            ...fetchOptions,
            ...(signal ? { signal } : {})
        });
    } catch (error) {
        throw buildProviderFetchError(error, {
            timeoutMs,
            timeoutFired,
            label
        });
    } finally {
        if (timer) clearTimeout(timer);
        if (externalSignal && externalAbortHandler && typeof externalSignal.removeEventListener === 'function') {
            externalSignal.removeEventListener('abort', externalAbortHandler);
        }
    }
}

function abortResponseBody(response = {}) {
    try {
        if (typeof response?.body?.cancel === 'function') {
            response.body.cancel().catch(() => {});
        }
    } catch (_) {
        // Ignore cleanup failures after a timeout.
    }
}

async function withTimeout(promiseOrFactory, timeoutMs, {
    label = 'AI 图片操作',
    code = 'ai_image_timeout',
    statusCode = 504,
    onTimeout = null
} = {}) {
    const operation = typeof promiseOrFactory === 'function'
        ? Promise.resolve().then(() => promiseOrFactory())
        : Promise.resolve(promiseOrFactory);
    let timer = null;
    try {
        return await Promise.race([
            operation,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new Error(`${label}超时（${Math.round(timeoutMs / 1000)} 秒）`);
                    error.code = code;
                    error.statusCode = statusCode;
                    if (typeof onTimeout === 'function') {
                        try {
                            onTimeout(error);
                        } catch (_) {
                            // Ignore cleanup failures after a timeout.
                        }
                    }
                    reject(error);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function readResponseBodyWithTimeout(response, reader, {
    env = process.env,
    label = 'AI 图片响应体',
    timing = null,
    timingKey = '',
    fallbackTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    signal = null
} = {}) {
    const timeoutMs = resolveResponseBodyTimeoutMs(env, fallbackTimeoutMs);
    const startedAt = nowMs();
    let abortHandler = null;
    try {
        if (signal && typeof signal.addEventListener === 'function') {
            abortHandler = () => abortResponseBody(response);
            if (signal.aborted) {
                abortHandler();
            } else {
                signal.addEventListener('abort', abortHandler, { once: true });
            }
        }
        const result = await withTimeout(
            () => reader(),
            timeoutMs,
            {
                label,
                code: 'ai_image_response_body_timeout',
                statusCode: 504,
                onTimeout: () => abortResponseBody(response)
            }
        );
        if (timing && timingKey) {
            addTimingMs(timing, timingKey, elapsedMs(startedAt));
        }
        return result;
    } catch (error) {
        if (timing && timingKey && error?.code === 'ai_image_response_body_timeout') {
            addTimingMs(timing, `${timingKey}_timeout_ms`, elapsedMs(startedAt));
        }
        throw error;
    } finally {
        if (signal && abortHandler && typeof signal.removeEventListener === 'function') {
            signal.removeEventListener('abort', abortHandler);
        }
    }
}

async function persistProviderImageUrl(imageUrl, {
    env,
    task,
    index,
    mimeType = 'image/png',
    fetchImpl = globalThis.fetch,
    uploadImageBuffer = uploadGeneratedImageBufferToR2,
    timing = null
} = {}) {
    if (uploadImageBuffer === uploadGeneratedImageBufferPreviewFirst && shouldUsePreviewFirst(env) && resolveR2Config(env).configured) {
        return {
            stored: {
                image_url: imageUrl,
                original_image_url: '',
                storage_path: '',
                original_storage_path: '',
                metadata: {
                    preview_status: 'upstream_url',
                    original_status: 'pending',
                    provider_image_url: imageUrl
                }
            },
            deferredOriginalUpload: {
                resultIndex: index,
                run: async ({ result }) => {
                    const providerImage = await fetchProviderImageBuffer(imageUrl, {
                        env,
                        mimeType,
                        fetchImpl,
                        timing
                    });
                    const preview = await buildPreviewImageBuffer(providerImage.buffer, {
                        env,
                        mimeType: providerImage.mimeType,
                        timing
                    });
                    const previewStored = await uploadImageBufferToR2Object(preview.buffer, {
                        env,
                        task,
                        index,
                        mimeType: preview.mimeType,
                        variant: 'preview',
                        timing,
                        timingKey: 'preview_upload_ms'
                    });
                    const originalStored = await uploadImageBufferToR2Object(providerImage.buffer, {
                        env,
                        task,
                        index,
                        mimeType: providerImage.mimeType,
                        variant: 'original',
                        timing,
                        timingKey: 'deferred_original_upload_ms'
                    });

                    return {
                        resultId: result?.id || '',
                        image_url: previewStored.url,
                        original_image_url: originalStored.url,
                        storage_path: previewStored.key,
                        original_storage_path: originalStored.key,
                        metadata: {
                            preview_status: 'ready',
                            original_status: 'ready',
                            original_ready_at: new Date().toISOString(),
                            provider_image_url: imageUrl,
                            preview_mime_type: preview.mimeType,
                            original_mime_type: providerImage.mimeType,
                            preview_bytes: preview.buffer.length,
                            original_bytes: providerImage.buffer.length
                        }
                    };
                }
            }
        };
    }

    const providerImage = await fetchProviderImageBuffer(imageUrl, {
        env,
        mimeType,
        fetchImpl,
        timing
    });

    return uploadImageBuffer(providerImage.buffer, {
        env,
        task,
        index,
        mimeType: providerImage.mimeType,
        timing
    });
}

async function fetchProviderImageBuffer(imageUrl, {
    env,
    mimeType = 'image/png',
    fetchImpl = globalThis.fetch,
    timing = null
} = {}) {
    if (typeof fetchImpl !== 'function') {
        const error = new Error('Fetch runtime is unavailable');
        error.statusCode = 503;
        error.code = 'ai_image_fetch_unavailable';
        throw error;
    }

    const requestStartedAt = nowMs();
    const response = await fetchProviderResponse(fetchImpl, imageUrl, {
        method: 'GET'
    }, {
        env,
        label: 'AI 图片结果下载'
    });
    addTimingMs(timing, 'result_download_request_ms', elapsedMs(requestStartedAt));
    if (!response.ok) {
        throw buildUpstreamError(response, {
            code: 'ai_image_result_url_unavailable',
            message: `AI 图片结果 URL 不可访问，HTTP ${response.status}`
        });
    }

    const responseMimeType = normalizeMimeType(
        response.headers?.get?.('content-type') || mimeType,
        mimeType
    );
    if (!responseMimeType.startsWith('image/')) {
        const error = new Error(`AI 图片结果 URL 返回的不是图片内容：${responseMimeType}`);
        error.statusCode = 502;
        error.code = 'ai_image_result_url_not_image';
        throw error;
    }

    const arrayBuffer = await readResponseBodyWithTimeout(response, () => response.arrayBuffer(), {
        env,
        label: 'AI 图片结果下载响应体',
        timing,
        timingKey: 'result_download_body_ms'
    });
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
        const error = new Error('AI 图片结果 URL 返回空图片内容');
        error.statusCode = 502;
        error.code = 'ai_image_result_url_empty';
        throw error;
    }

    return {
        buffer,
        mimeType: responseMimeType
    };
}

function getImageFileExtension(mimeType = '') {
    return getMediaFileExtension(mimeType, 'png');
}

function inferVideoMimeType(value = '', fallback = 'video/mp4', sourceUrl = '') {
    const normalized = normalizeMimeType(value, '').toLowerCase();
    if (normalized.startsWith('video/')) return normalized;
    if (normalized.includes('mp4')) return 'video/mp4';
    if (normalized.includes('quicktime') || normalized.includes('mov')) return 'video/quicktime';
    if (normalized.includes('webm')) return 'video/webm';
    const pathname = (() => {
        try {
            return new URL(sourceUrl).pathname.toLowerCase();
        } catch (_) {
            return String(sourceUrl || '').toLowerCase();
        }
    })();
    if (/\.webm(?:$|\?)/i.test(pathname)) return 'video/webm';
    if (/\.(?:mov|qt)(?:$|\?)/i.test(pathname)) return 'video/quicktime';
    if (/\.m3u8(?:$|\?)/i.test(pathname)) return 'application/vnd.apple.mpegurl';
    if (/\.mp4(?:$|\?)/i.test(pathname)) return 'video/mp4';
    return fallback;
}

function readMp4Uint64AsNumber(buffer, offset) {
    if (!Buffer.isBuffer(buffer) || offset < 0 || offset + 8 > buffer.length) return null;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    const value = high * 0x100000000 + low;
    return Number.isSafeInteger(value) ? value : null;
}

function readMp4BoxHeader(buffer, offset = 0, end = buffer?.length || 0) {
    if (!Buffer.isBuffer(buffer) || offset < 0 || offset + 8 > end) return null;
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    let size = size32;
    let headerSize = 8;
    if (size32 === 1) {
        const size64 = readMp4Uint64AsNumber(buffer, offset + 8);
        if (!size64) return null;
        size = size64;
        headerSize = 16;
    } else if (size32 === 0) {
        size = end - offset;
    }
    if (!size || size < headerSize || offset + size > end) return null;
    return {
        type,
        start: offset,
        end: offset + size,
        size,
        headerSize
    };
}

function parseTopLevelMp4Boxes(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
    const boxes = [];
    let offset = 0;
    while (offset < buffer.length) {
        const box = readMp4BoxHeader(buffer, offset, buffer.length);
        if (!box) return null;
        boxes.push(box);
        offset = box.end;
    }
    return offset === buffer.length ? boxes : null;
}

const MP4_CONTAINER_BOX_TYPES = new Set([
    'moov',
    'trak',
    'mdia',
    'minf',
    'stbl',
    'edts',
    'dinf',
    'udta',
    'mvex',
    'moof',
    'traf',
    'mfra'
]);

function adjustStcoOffsets(buffer, box, delta) {
    const payloadStart = box.start + box.headerSize;
    if (payloadStart + 8 > box.end) return { ok: false, updated: 0 };
    const entryCount = buffer.readUInt32BE(payloadStart + 4);
    const entriesStart = payloadStart + 8;
    if (entriesStart + entryCount * 4 > box.end) return { ok: false, updated: 0 };
    for (let index = 0; index < entryCount; index += 1) {
        const offset = entriesStart + index * 4;
        const nextValue = buffer.readUInt32BE(offset) + delta;
        if (nextValue > 0xffffffff) return { ok: false, updated: 0 };
        buffer.writeUInt32BE(nextValue, offset);
    }
    return { ok: true, updated: entryCount };
}

function adjustCo64Offsets(buffer, box, delta) {
    const payloadStart = box.start + box.headerSize;
    if (payloadStart + 8 > box.end) return { ok: false, updated: 0 };
    const entryCount = buffer.readUInt32BE(payloadStart + 4);
    const entriesStart = payloadStart + 8;
    if (entriesStart + entryCount * 8 > box.end) return { ok: false, updated: 0 };
    const deltaBig = BigInt(delta);
    for (let index = 0; index < entryCount; index += 1) {
        const offset = entriesStart + index * 8;
        buffer.writeBigUInt64BE(buffer.readBigUInt64BE(offset) + deltaBig, offset);
    }
    return { ok: true, updated: entryCount };
}

function adjustMp4ChunkOffsets(buffer, delta, start = 0, end = buffer?.length || 0) {
    let offset = start;
    let updated = 0;
    while (offset < end) {
        const box = readMp4BoxHeader(buffer, offset, end);
        if (!box) return { ok: false, updated };
        if (box.type === 'stco') {
            const result = adjustStcoOffsets(buffer, box, delta);
            if (!result.ok) return { ok: false, updated };
            updated += result.updated;
        } else if (box.type === 'co64') {
            const result = adjustCo64Offsets(buffer, box, delta);
            if (!result.ok) return { ok: false, updated };
            updated += result.updated;
        } else if (MP4_CONTAINER_BOX_TYPES.has(box.type)) {
            const result = adjustMp4ChunkOffsets(buffer, delta, box.start + box.headerSize, box.end);
            if (!result.ok) return { ok: false, updated };
            updated += result.updated;
        }
        offset = box.end;
    }
    return { ok: offset === end, updated };
}

function optimizeMp4ForStreaming(buffer, mimeType = 'video/mp4') {
    if (!Buffer.isBuffer(buffer) || !buffer.length || inferVideoMimeType(mimeType, '').toLowerCase() !== 'video/mp4') {
        return { buffer, optimized: false, fastStart: false, reason: 'not_mp4' };
    }
    const boxes = parseTopLevelMp4Boxes(buffer);
    if (!boxes?.length) return { buffer, optimized: false, fastStart: false, reason: 'parse_failed' };
    const moovIndex = boxes.findIndex((box) => box.type === 'moov');
    const firstMdatIndex = boxes.findIndex((box) => box.type === 'mdat');
    if (moovIndex < 0 || firstMdatIndex < 0) {
        return { buffer, optimized: false, fastStart: false, reason: 'missing_boxes' };
    }
    if (moovIndex < firstMdatIndex) {
        return { buffer, optimized: false, fastStart: true, reason: 'already_fast_start' };
    }

    const moov = boxes[moovIndex];
    const moovBuffer = Buffer.from(buffer.subarray(moov.start, moov.end));
    const adjusted = adjustMp4ChunkOffsets(moovBuffer, moov.size, moov.headerSize, moovBuffer.length);
    if (!adjusted.ok || adjusted.updated <= 0) {
        return { buffer, optimized: false, fastStart: false, reason: adjusted.ok ? 'no_chunk_offsets' : 'offset_adjust_failed' };
    }

    const ftypIndex = boxes.findIndex((box) => box.type === 'ftyp');
    const insertIndex = ftypIndex >= 0 ? ftypIndex + 1 : firstMdatIndex;
    const parts = [];
    boxes.forEach((box, index) => {
        if (index === insertIndex) parts.push(moovBuffer);
        if (index !== moovIndex) parts.push(buffer.subarray(box.start, box.end));
    });
    if (insertIndex >= boxes.length) parts.push(moovBuffer);

    return {
        buffer: Buffer.concat(parts),
        optimized: true,
        fastStart: true,
        reason: 'optimized',
        updatedChunkOffsets: adjusted.updated,
        originalMoovOffset: moov.start,
        originalMdatOffset: boxes[firstMdatIndex].start
    };
}

async function fetchProviderVideoBuffer(videoUrl, {
    env,
    mimeType = 'video/mp4',
    fetchImpl = globalThis.fetch,
    timing = null,
    headers = {}
} = {}) {
    if (typeof fetchImpl !== 'function') {
        const error = new Error('Fetch runtime is unavailable');
        error.statusCode = 503;
        error.code = 'ai_image_fetch_unavailable';
        throw error;
    }

    const requestStartedAt = nowMs();
    const response = await fetchProviderResponse(fetchImpl, videoUrl, {
        method: 'GET',
        headers
    }, {
        env,
        label: 'AI 视频结果下载'
    });
    addTimingMs(timing, 'video_download_request_ms', elapsedMs(requestStartedAt));
    if (!response.ok) {
        throw buildUpstreamError(response, {
            code: 'ai_video_result_url_unavailable',
            message: `AI 视频结果 URL 不可访问，HTTP ${response.status}`
        });
    }

    const responseMimeType = inferVideoMimeType(
        response.headers?.get?.('content-type') || mimeType,
        mimeType,
        videoUrl
    );
    if (!responseMimeType.startsWith('video/') && responseMimeType !== 'application/vnd.apple.mpegurl') {
        const error = new Error(`AI 视频结果 URL 返回的不是视频内容：${responseMimeType}`);
        error.statusCode = 502;
        error.code = 'ai_video_result_url_not_video';
        throw error;
    }

    const arrayBuffer = await readResponseBodyWithTimeout(response, () => response.arrayBuffer(), {
        env,
        label: 'AI 视频结果下载响应体',
        timing,
        timingKey: 'video_download_body_ms'
    });
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
        const error = new Error('AI 视频结果 URL 返回空视频内容');
        error.statusCode = 502;
        error.code = 'ai_video_result_url_empty';
        throw error;
    }

    const fastStartStartedAt = nowMs();
    const streamingVideo = optimizeMp4ForStreaming(buffer, responseMimeType);
    addTimingMs(timing, 'video_fast_start_ms', elapsedMs(fastStartStartedAt));

    return {
        buffer: streamingVideo.buffer,
        mimeType: responseMimeType,
        sourceBytes: buffer.length,
        mp4FastStart: Boolean(streamingVideo.fastStart),
        mp4FastStartOptimized: Boolean(streamingVideo.optimized),
        mp4FastStartReason: streamingVideo.reason || ''
    };
}

function persistProviderVideoUrl(videoUrl, {
    env,
    task,
    index,
    mimeType = 'video/mp4',
    fetchImpl = globalThis.fetch,
    timing = null,
    authHeaders = {},
    requireServerCopy = false
} = {}) {
    const normalizedMimeType = inferVideoMimeType(mimeType, 'video/mp4', videoUrl);
    const canDeferUpload = Boolean(videoUrl && resolveR2Config(env).configured);
    const providerAuthHeaders = authHeaders && typeof authHeaders === 'object' && !Array.isArray(authHeaders)
        ? authHeaders
        : {};
    const hasProviderAuthHeaders = Object.keys(providerAuthHeaders).length > 0;
    const shouldHideProviderUrl = Boolean(requireServerCopy || hasProviderAuthHeaders);
    return {
        stored: {
            image_url: shouldHideProviderUrl ? '' : videoUrl,
            original_image_url: shouldHideProviderUrl ? '' : videoUrl,
            storage_path: '',
            original_storage_path: '',
            metadata: {
                preview_status: shouldHideProviderUrl ? 'pending' : 'upstream_url',
                original_status: canDeferUpload ? 'pending' : (shouldHideProviderUrl ? 'pending' : 'upstream_url'),
                provider_video_url: videoUrl,
                provider_auth_required: shouldHideProviderUrl,
                original_mime_type: normalizedMimeType
            }
        },
        deferredOriginalUpload: canDeferUpload ? {
            resultIndex: index,
            run: async ({ result }) => {
                const deferredTiming = {};
                const providerVideo = await fetchProviderVideoBuffer(videoUrl, {
                    env,
                    mimeType: normalizedMimeType,
                    fetchImpl,
                    timing: deferredTiming,
                    headers: providerAuthHeaders
                });
                const originalStored = await uploadVideoBufferToR2Object(providerVideo.buffer, {
                    env,
                    task,
                    index,
                    mimeType: providerVideo.mimeType,
                    variant: 'original',
                    timing: deferredTiming,
                    timingKey: 'deferred_original_upload_ms'
                });

                return {
                    resultId: result?.id || '',
                    image_url: originalStored.url,
                    original_image_url: originalStored.url,
                    storage_path: originalStored.key,
                    original_storage_path: originalStored.key,
                    metadata: {
                        preview_status: 'ready',
                        original_status: 'ready',
                        original_ready_at: new Date().toISOString(),
                        provider_video_url: videoUrl,
                        original_mime_type: providerVideo.mimeType,
                        original_bytes: providerVideo.buffer.length,
                        source_video_bytes: providerVideo.sourceBytes || providerVideo.buffer.length,
                        mp4_fast_start: Boolean(providerVideo.mp4FastStart),
                        mp4_fast_start_optimized: Boolean(providerVideo.mp4FastStartOptimized),
                        mp4_fast_start_reason: providerVideo.mp4FastStartReason || '',
                        video_download_request_ms: Number(deferredTiming.video_download_request_ms || 0) || 0,
                        video_download_body_ms: Number(deferredTiming.video_download_body_ms || 0) || 0,
                        video_fast_start_ms: Number(deferredTiming.video_fast_start_ms || 0) || 0,
                        deferred_original_upload_ms: Number(deferredTiming.deferred_original_upload_ms || 0) || 0,
                        media_type: 'video'
                    }
                };
            }
        } : null
    };
}

async function fetchReferenceImageForEdit(referenceImageUrl, {
    env,
    fetchImpl = globalThis.fetch,
    index = 0
} = {}) {
    const normalizedUrl = normalizeText(referenceImageUrl, 4000);
    if (!normalizedUrl) {
        const error = new Error('图片续作需要可访问的参考图片 URL');
        error.statusCode = 400;
        error.code = 'reference_image_required';
        throw error;
    }

    const response = await fetchProviderResponse(fetchImpl, normalizedUrl, {
        method: 'GET'
    }, {
        env,
        label: 'AI 图片参考图下载'
    });
    if (!response.ok) {
        throw buildUpstreamError(response, {
            code: 'ai_image_reference_url_unavailable',
            message: `AI 图片参考图不可访问，HTTP ${response.status}`
        });
    }

    const mimeType = normalizeMimeType(response.headers?.get?.('content-type') || 'image/png', 'image/png');
    if (!mimeType.startsWith('image/')) {
        const error = new Error(`AI 图片参考图返回的不是图片内容：${mimeType}`);
        error.statusCode = 400;
        error.code = 'ai_image_reference_url_not_image';
        throw error;
    }

    const buffer = Buffer.from(await readResponseBodyWithTimeout(response, () => response.arrayBuffer(), {
        env,
        label: 'AI 图片参考图下载响应体'
    }));
    if (!buffer.length) {
        const error = new Error('AI 图片参考图为空，请重新上传参考图');
        error.statusCode = 400;
        error.code = 'ai_image_reference_url_empty';
        throw error;
    }

    return {
        buffer,
        mimeType,
        filename: `reference-${index + 1}.${getImageFileExtension(mimeType)}`
    };
}

function getTaskReferenceImageUrls(task = {}) {
    const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : {};
    const extras = Array.isArray(metadata.reference_images)
        ? metadata.reference_images
        : (Array.isArray(metadata.referenceImages) ? metadata.referenceImages : []);
    const urls = [
        normalizeText(task.reference_image_url, 4000),
        ...extras.map((item) => normalizeText(item?.url || item?.imageUrl || item?.image_url || item?.image, 4000))
    ];
    const seen = new Set();
    return urls.filter((url) => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
    }).slice(0, MAX_REFERENCE_IMAGE_INPUTS);
}

function normalizeReferenceMediaUrl(item) {
    return normalizeText(
        item?.url
        || item?.imageUrl
        || item?.image_url
        || item?.image
        || item?.videoUrl
        || item?.video_url
        || item?.video
        || item?.audioUrl
        || item?.audio_url
        || item?.audio
        || item,
        4000
    );
}

function getTaskReferenceVideoUrls(task = {}) {
    const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : {};
    const extras = [
        ...(Array.isArray(metadata.reference_videos) ? metadata.reference_videos : []),
        ...(Array.isArray(metadata.referenceVideos) ? metadata.referenceVideos : []),
        ...(Array.isArray(metadata.videos) ? metadata.videos : [])
    ];
    const urls = [
        normalizeText(task.reference_video_url || metadata.reference_video_url || metadata.video_url || metadata.videoUrl, 4000),
        ...extras.map(normalizeReferenceMediaUrl)
    ];
    const seen = new Set();
    return urls.filter((url) => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
    }).slice(0, 8);
}

function getTaskReferenceAudioUrls(task = {}) {
    const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : {};
    const extras = [
        ...(Array.isArray(metadata.reference_audios) ? metadata.reference_audios : []),
        ...(Array.isArray(metadata.referenceAudios) ? metadata.referenceAudios : []),
        ...(Array.isArray(metadata.audios) ? metadata.audios : [])
    ];
    const urls = [
        normalizeText(task.reference_audio_url || metadata.reference_audio_url || metadata.audio_url || metadata.audioUrl, 4000),
        ...extras.map(normalizeReferenceMediaUrl)
    ];
    const seen = new Set();
    return urls.filter((url) => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
    }).slice(0, 8);
}

async function fetchReferenceImagesForEdit(referenceImageUrls = [], {
    env,
    fetchImpl = globalThis.fetch
} = {}) {
    const urls = Array.isArray(referenceImageUrls) ? referenceImageUrls : [referenceImageUrls];
    if (!urls.length) {
        return fetchReferenceImageForEdit('', { env, fetchImpl });
    }
    const images = [];
    for (const [index, url] of urls.entries()) {
        images.push(await fetchReferenceImageForEdit(url, {
            env,
            fetchImpl,
            index
        }));
    }
    return images;
}

function normalizeReferenceImageMimeType(value = '', sourceUrl = '') {
    const normalized = normalizeMimeType(value, '').toLowerCase();
    const aliases = {
        'image/jpg': 'image/jpeg',
        'image/x-png': 'image/png'
    };
    const direct = aliases[normalized] || normalized;
    if (REVERSE_REFERENCE_IMAGE_MIME_TYPES.has(direct)) return direct;
    if (direct && !['application/octet-stream', 'binary/octet-stream'].includes(direct)) return '';

    let pathname = '';
    try {
        pathname = new URL(sourceUrl).pathname.toLowerCase();
    } catch (_) {
        pathname = '';
    }
    if (/\.jpe?g$/.test(pathname)) return 'image/jpeg';
    if (/\.png$/.test(pathname)) return 'image/png';
    if (/\.gif$/.test(pathname)) return 'image/gif';
    if (/\.webp$/.test(pathname)) return 'image/webp';
    return '';
}

function addReferenceImageHost(hosts, value = '') {
    const raw = normalizeText(value, 1000);
    if (!raw) return;
    try {
        const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname) hosts.add(hostname);
    } catch (_) {
        // Invalid optional host configuration is ignored.
    }
}

function getTrustedReferenceImageHosts(env = {}) {
    const hosts = new Set(DEFAULT_TRUSTED_REFERENCE_IMAGE_HOSTS);
    [
        env.AI_IMAGE_R2_PUBLIC_URL,
        env.R2_PUBLIC_URL,
        env.SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.PUBLIC_SUPABASE_URL
    ].forEach((value) => addReferenceImageHost(hosts, value));
    String(env.AI_IMAGE_REFERENCE_IMAGE_HOSTS || env.AI_IMAGE_TRUSTED_REFERENCE_HOSTS || '')
        .split(/[,\s]+/)
        .forEach((value) => addReferenceImageHost(hosts, value));
    return hosts;
}

function isBlockedReferenceImageHostname(value = '') {
    const hostname = normalizeText(value, 500).toLowerCase().replace(/^\[|\]$/g, '');
    return !hostname
        || hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname.endsWith('.local')
        || hostname === 'metadata.google.internal'
        || hostname === '::1'
        || hostname === '::'
        || /^f[cd][0-9a-f]{0,2}:/.test(hostname)
        || /^fe[89ab][0-9a-f]:/.test(hostname)
        || hostname.startsWith('::ffff:127.')
        || hostname.startsWith('::ffff:10.')
        || hostname.startsWith('::ffff:192.168.')
        || hostname === '0.0.0.0'
        || hostname.startsWith('127.')
        || hostname.startsWith('10.')
        || hostname.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
        || hostname === '169.254.169.254';
}

function assertTrustedReferenceImageUrl(value = '', env = {}) {
    let parsed;
    try {
        parsed = new URL(normalizeText(value, 4000));
    } catch (_) {
        parsed = null;
    }
    const trustedHosts = getTrustedReferenceImageHosts(env);
    if (
        !parsed
        || parsed.protocol !== 'https:'
        || parsed.username
        || parsed.password
        || isBlockedReferenceImageHostname(parsed.hostname)
        || !trustedHosts.has(parsed.hostname.toLowerCase())
    ) {
        const error = new Error('反推参考图片地址不在受信任的图片存储域名中，请重新上传图片');
        error.statusCode = 400;
        error.code = 'ai_image_reference_url_not_trusted';
        throw error;
    }
    return parsed;
}

function buildReferenceImageSizeError(maxBytes) {
    const error = new Error(`反推参考图片超过 ${Math.max(1, Math.floor(maxBytes / 1024 / 1024))} MiB 限制，请压缩后重试`);
    error.statusCode = 413;
    error.code = 'ai_image_reference_too_large';
    return error;
}

async function readLimitedReferenceImageBuffer(response, {
    env = process.env,
    maxBytes = DEFAULT_REVERSE_REFERENCE_MAX_BYTES,
    signal = null
} = {}) {
    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        abortResponseBody(response);
        throw buildReferenceImageSizeError(maxBytes);
    }

    const readBuffer = async () => {
        const reader = response.body?.getReader?.();
        if (!reader) {
            return Buffer.from(await response.arrayBuffer());
        }
        const chunks = [];
        let totalBytes = 0;
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            totalBytes += value?.byteLength || 0;
            if (totalBytes > maxBytes) {
                await reader.cancel().catch(() => {});
                throw buildReferenceImageSizeError(maxBytes);
            }
            chunks.push(Buffer.from(value || []));
        }
        return Buffer.concat(chunks, totalBytes);
    };

    const buffer = await readResponseBodyWithTimeout(response, readBuffer, {
        env,
        label: 'AI 图片反推参考图下载响应体',
        signal
    });
    if (buffer.length > maxBytes) throw buildReferenceImageSizeError(maxBytes);
    if (!buffer.length) {
        const error = new Error('反推参考图片为空，请重新上传图片');
        error.statusCode = 400;
        error.code = 'ai_image_reference_url_empty';
        throw error;
    }
    return buffer;
}

async function fetchReverseReferenceImage(referenceImageUrl, {
    env = process.env,
    fetchImpl = globalThis.fetch,
    signal = null
} = {}) {
    const maxBytes = normalizePositiveInt(
        env.AI_IMAGE_REVERSE_REFERENCE_MAX_BYTES || env.AI_IMAGE_REFERENCE_MAX_BYTES,
        DEFAULT_REVERSE_REFERENCE_MAX_BYTES,
        { min: 1024, max: MAX_REVERSE_REFERENCE_MAX_BYTES }
    );
    let currentUrl = assertTrustedReferenceImageUrl(referenceImageUrl, env);
    let response = null;

    for (let redirectCount = 0; redirectCount <= MAX_REVERSE_REFERENCE_REDIRECTS; redirectCount += 1) {
        response = await fetchProviderResponse(fetchImpl, currentUrl.toString(), {
            method: 'GET',
            redirect: 'manual',
            headers: {
                Accept: 'image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8'
            },
            ...(signal ? { signal } : {})
        }, {
            env,
            label: 'AI 图片反推参考图下载'
        });
        if (![301, 302, 303, 307, 308].includes(Number(response.status || 0))) break;
        const location = response.headers?.get?.('location') || '';
        abortResponseBody(response);
        if (!location || redirectCount === MAX_REVERSE_REFERENCE_REDIRECTS) {
            const error = new Error('反推参考图片跳转次数过多，请重新上传图片');
            error.statusCode = 400;
            error.code = 'ai_image_reference_redirect_limit';
            throw error;
        }
        currentUrl = assertTrustedReferenceImageUrl(new URL(location, currentUrl).toString(), env);
    }

    if (!response?.ok) {
        throw buildUpstreamError(response || { status: 502 }, {
            code: 'ai_image_reference_url_unavailable',
            message: `反推参考图片不可访问，HTTP ${response?.status || 502}`
        });
    }
    const mimeType = normalizeReferenceImageMimeType(
        response.headers?.get?.('content-type') || '',
        currentUrl.toString()
    );
    if (!mimeType) {
        abortResponseBody(response);
        const error = new Error('反推参考图片格式不受支持，请使用 JPEG、PNG、GIF 或 WebP');
        error.statusCode = 415;
        error.code = 'ai_image_reference_url_not_image';
        throw error;
    }
    const buffer = await readLimitedReferenceImageBuffer(response, { env, maxBytes, signal });
    return {
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
        mimeType,
        bytes: buffer.length
    };
}

function buildImageEditFormData({
    task = {},
    config = {},
    size = {},
    quantity = 1,
    responseFormat = '',
    quality = '',
    referenceImages = []
} = {}) {
    if (typeof FormData !== 'function' || typeof Blob !== 'function') {
        const error = new Error('当前 Node 运行时不支持图片编辑所需的 FormData/Blob');
        error.statusCode = 503;
        error.code = 'ai_image_formdata_unavailable';
        throw error;
    }

    const form = new FormData();
    form.append('model', config.model);
    form.append('prompt', buildImageEditPrompt(task));
    form.append('n', String(quantity));
    form.append('size', size.size);
    if (quality) {
        form.append('quality', quality);
    }
    if (responseFormat) {
        form.append('response_format', responseFormat);
    }
    const images = Array.isArray(referenceImages) ? referenceImages : [referenceImages];
    images.forEach((referenceImage, index) => {
        form.append('image', new Blob([referenceImage.buffer], {
            type: referenceImage.mimeType || 'image/png'
        }), referenceImage.filename || `reference-${index + 1}.png`);
    });

    return form;
}

async function requestOpenAiCompatibleImageBatch({
    task = {},
    config = {},
    size = {},
    quantity = 1,
    responseFormat = '',
    quality = '',
    isImageEdit = false,
    referenceImages = [],
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null,
    onProviderTask = null
} = {}) {
    if (isImageEdit) {
        const form = buildImageEditFormData({
            task,
            config,
            size,
            quantity,
            responseFormat,
            quality,
            referenceImages
        });
        return fetchProviderResponse(fetchImpl, `${config.baseUrl}/images/edits`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`
            },
            body: form,
            ...(signal ? { signal } : {})
        }, {
            env,
            label: 'AI 图片编辑上游'
        });
    }

    const requestBody = {
        model: config.model,
        prompt: buildImagePrompt(task),
        n: quantity,
        size: size.size
    };
    if (quality) {
        requestBody.quality = quality;
    }
    if (responseFormat) {
        requestBody.response_format = responseFormat;
    }

    return fetchProviderResponse(fetchImpl, `${config.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {})
    }, {
        env,
        label: 'AI 图片生成上游'
    });
}

async function requestOpenAiCompatibleImages({
    task = {},
    config = {},
    size = {},
    quantity = 1,
    responseFormat = '',
    quality = '',
    isImageEdit = false,
    referenceImages = [],
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null,
    onProviderTask = null
} = {}) {
    const requestedCount = normalizePositiveInt(quantity, 1, { min: 1, max: 8 });
    const payloads = [];
    const providerTaskIds = [];
    let revisedPrompt = '';
    let tokenUsage = {};
    let upstreamMs = 0;
    let upstreamRequestMs = 0;
    let upstreamResponseMs = 0;
    let upstreamResponseTextMs = 0;
    let upstreamResponseParseMs = 0;
    let asyncPollMs = 0;
    let asyncPollRequestMs = 0;
    let asyncPollResponseMs = 0;
    let asyncPollAttempts = 0;
    let asyncPollPath = '';
    let attempts = 0;
    let partialError = null;
    let lastPayloadSummary = null;
    let responseFormatFallbackUsed = false;
    const captureSub2ApiBilling = shouldCaptureTaskSub2ApiBilling(task);

    const runBatch = async (batchQuantity, { resultIndexOffset = payloads.length } = {}) => {
        attempts += 1;
        const batchStart = nowMs();
        const requestBatch = (nextResponseFormat = responseFormat) => requestOpenAiCompatibleImageBatch({
            task,
            config,
            size,
            quantity: batchQuantity,
            responseFormat: nextResponseFormat,
            quality,
            isImageEdit,
            referenceImages,
            fetchImpl,
            env,
            signal
        });
        let response = await requestBatch(responseFormat);
        const batchRequestMs = elapsedMs(batchStart);
        upstreamRequestMs += batchRequestMs;
        const payloadTiming = {};
        let payload = await readUpstreamPayload(response, payloadTiming, { env, signal });
        const batchResponseMs = Number(payloadTiming.response_body_ms || 0) || 0;
        upstreamResponseMs += batchResponseMs;
        upstreamResponseTextMs += Number(payloadTiming.response_text_ms || 0) || 0;
        upstreamResponseParseMs += Number(payloadTiming.response_parse_ms || 0) || 0;
        upstreamMs += batchRequestMs + batchResponseMs;

        if (!response.ok) {
            const upstreamError = buildUpstreamError(response, payload);
            if (responseFormat === 'url' && !responseFormatFallbackUsed && isUrlResponseFormatUnsupportedError(upstreamError)) {
                responseFormatFallbackUsed = true;
                const fallbackStart = nowMs();
                response = await requestBatch('');
                const fallbackRequestMs = elapsedMs(fallbackStart);
                upstreamRequestMs += fallbackRequestMs;
                const fallbackPayloadTiming = {};
                payload = await readUpstreamPayload(response, fallbackPayloadTiming, { env, signal });
                const fallbackResponseMs = Number(fallbackPayloadTiming.response_body_ms || 0) || 0;
                upstreamResponseMs += fallbackResponseMs;
                upstreamResponseTextMs += Number(fallbackPayloadTiming.response_text_ms || 0) || 0;
                upstreamResponseParseMs += Number(fallbackPayloadTiming.response_parse_ms || 0) || 0;
                upstreamMs += fallbackRequestMs + fallbackResponseMs;
                if (!response.ok) {
                    throw buildUpstreamError(response, payload);
                }
            } else {
                throw upstreamError;
            }
        }

        const providerTaskId = getProviderTaskIdFromPayload(payload);
        const providerStatus = getProviderStatusFromPayload(payload);
        if (providerTaskId) {
            providerTaskIds.push(providerTaskId);
            if (typeof onProviderTask === 'function') {
                await onProviderTask({
                    providerTaskId,
                    status: providerStatus,
                    payloadSummary: summarizeUpstreamPayload(payload)
                });
            }
        }
        let batchData = extractProviderImageData(payload);
        if (!batchData.length && providerTaskId && isPendingProviderStatus(providerStatus)) {
            const pollTiming = {};
            const pollResult = await pollOpenAiCompatibleImageResult({
                task,
                config,
                providerTaskId,
                fetchImpl,
                env,
                signal,
                timing: pollTiming
            });
            asyncPollMs += Number(pollTiming.async_poll_ms || 0) || 0;
            asyncPollRequestMs += Number(pollTiming.async_poll_request_ms || 0) || 0;
            asyncPollResponseMs += Number(pollTiming.async_poll_response_ms || 0) || 0;
            upstreamMs += Number(pollTiming.async_poll_ms || 0) || 0;
            upstreamRequestMs += Number(pollTiming.async_poll_request_ms || 0) || 0;
            upstreamResponseMs += Number(pollTiming.async_poll_response_ms || 0) || 0;
            if (pollResult?.payload) {
                lastPayloadSummary = summarizeUpstreamPayload(pollResult.payload);
                const nextProviderTaskId = getProviderTaskIdFromPayload(pollResult.payload) || providerTaskId;
                if (nextProviderTaskId && !providerTaskIds.includes(nextProviderTaskId)) {
                    providerTaskIds.push(nextProviderTaskId);
                }
            }
            if (pollResult?.data?.length) {
                batchData = pollResult.data;
            }
            asyncPollAttempts += Math.max(0, Number(pollResult?.attempts || 0));
            asyncPollPath = pollResult?.path || asyncPollPath;
            attempts += Math.max(0, Number(pollResult?.attempts || 0));
        }
        batchData = batchData
            .slice(0, Math.max(1, Number(batchQuantity) || 1))
            .map((item, index) => ({
                ...(item && typeof item === 'object' && !Array.isArray(item) ? item : { url: item }),
                result_index: resultIndexOffset + index
            }));
        lastPayloadSummary = summarizeUpstreamPayload(payload);
        if (payload.revised_prompt && !revisedPrompt) {
            revisedPrompt = normalizeText(payload.revised_prompt, 8000);
        }
        if (payload.usage || (captureSub2ApiBilling && isSub2ApiGatewayBaseUrl(config.baseUrl))) {
            const batchUsage = captureSub2ApiBilling
                ? await resolveTokenUsageWithSub2ApiBilling({
                    usage: payload.usage || {},
                    payload,
                    response,
                    config,
                    fetchImpl,
                    env,
                    signal
                })
                : normalizeTokenUsage(payload.usage || {});
            tokenUsage = addTokenUsage(tokenUsage, batchUsage);
        }
        payloads.push(...batchData);
        return batchData.length;
    };

    if (requestedCount > 1) {
        const settled = await Promise.allSettled(Array.from({ length: requestedCount }, (_, index) => (
            runBatch(1, { resultIndexOffset: index })
        )));
        const firstRejected = settled.find((item) => item.status === 'rejected');
        if (!payloads.length && firstRejected?.status === 'rejected') {
            throw firstRejected.reason;
        }
        if (firstRejected) {
            partialError = {
                code: normalizeText(firstRejected.reason?.code || 'ai_image_partial_generation_failed', 120),
                message: normalizeText(firstRejected.reason?.message || '部分图片补发失败', 500)
            };
        }
    } else {
        await runBatch(requestedCount);
    }

    while (payloads.length < requestedCount) {
        const deliveredIndexes = new Set(payloads.map((item) => Number(item?.result_index)).filter((value) => Number.isFinite(value)));
        const missingIndex = Array.from({ length: requestedCount }, (_, index) => index).find((index) => !deliveredIndexes.has(index));
        const remaining = missingIndex === undefined ? requestedCount - payloads.length : 1;
        let delivered = 0;
        try {
            delivered = await runBatch(remaining, {
                resultIndexOffset: missingIndex === undefined ? payloads.length : missingIndex
            });
        } catch (error) {
            if (!payloads.length) throw error;
            partialError = {
                code: normalizeText(error?.code || 'ai_image_partial_generation_failed', 120),
                message: normalizeText(error?.message || '部分图片补发失败', 500)
            };
            break;
        }
        if (delivered <= 0) break;
    }

    return {
        data: payloads
            .slice()
            .sort((left, right) => {
                const leftIndex = Number.isFinite(Number(left?.result_index)) ? Number(left.result_index) : 0;
                const rightIndex = Number.isFinite(Number(right?.result_index)) ? Number(right.result_index) : 0;
                return leftIndex - rightIndex;
            })
            .slice(0, requestedCount),
        requestedCount,
        deliveredCount: Math.min(payloads.length, requestedCount),
        attempts,
        upstreamMs,
        upstreamRequestMs,
        upstreamResponseMs,
        upstreamResponseTextMs,
        upstreamResponseParseMs,
        asyncPollMs,
        asyncPollRequestMs,
        asyncPollResponseMs,
        asyncPollAttempts,
        asyncPollPath,
        partialError,
        emptyResultSummary: !payloads.length ? lastPayloadSummary : null,
        revisedPrompt,
        tokenUsage,
        providerTaskId: [...new Set(providerTaskIds.filter(Boolean))].join(','),
        responseFormat,
        responseFormatFallbackUsed
    };
}

function extractChatCompletionText(payload = {}) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
        return normalizeText(content, 12000);
    }
    if (Array.isArray(content)) {
        return normalizeText(content.map((part) => {
            if (typeof part === 'string') return part;
            return part?.text || part?.output_text || '';
        }).filter(Boolean).join('\n'), 12000);
    }
    return '';
}

async function requestOpenAiCompatibleVideos({
    task = {},
    config = {},
    size = {},
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null,
    onProviderTask = null
} = {}) {
    const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata) ? task.metadata : {};
    const videoRatio = normalizeVideoRatio(metadata.video_ratio || metadata.ratio || task.ratio || size.ratio || 'adaptive');
    const videoResolution = normalizeVideoResolution(metadata.video_resolution || metadata.resolution || task.resolution || size.resolution || '720p');
    const duration = normalizeVideoDuration(metadata.duration ?? metadata.video_duration ?? env.AI_VIDEO_DURATION_SECONDS, 5);
    const generateAudio = normalizeBooleanOption(metadata.generate_audio ?? metadata.video_audio ?? env.AI_VIDEO_GENERATE_AUDIO, true);
    const watermark = normalizeBooleanOption(metadata.watermark ?? metadata.video_watermark ?? env.AI_VIDEO_WATERMARK, false);
    const cameraFixed = normalizeBooleanOption(metadata.camera_fixed ?? metadata.video_camera_fixed ?? env.AI_VIDEO_CAMERA_FIXED, false);
    const referenceUrls = getTaskReferenceImageUrls(task);
    const referenceVideoUrls = getTaskReferenceVideoUrls(task);
    const referenceAudioUrls = getTaskReferenceAudioUrls(task);
    const aspectRatio = videoRatio === 'adaptive' ? '16:9' : videoRatio;
    const submitEndpoint = resolveVideoSubmitEndpoint(config);
    const usesTaskVideoEndpoint = isVideoTaskSubmitEndpoint(submitEndpoint);
    const strictVideoSeconds = String(duration > 0 ? duration : 5);
    const requestBody = usesTaskVideoEndpoint
        ? {
            model: config.model,
            prompt: buildImagePrompt(task),
            seconds: strictVideoSeconds,
            aspect_ratio: aspectRatio
        }
        : {
            model: config.model,
            prompt: buildImagePrompt(task),
            size: size.size,
            resolution: videoResolution,
            ratio: videoRatio,
            aspect_ratio: aspectRatio,
            seconds: duration,
            duration,
            generate_audio: generateAudio,
            watermark
        };
    if (!usesTaskVideoEndpoint) {
        if (cameraFixed) requestBody.camera_fixed = true;
        if (referenceUrls.length) requestBody.images = referenceUrls;
        if (referenceVideoUrls.length) requestBody.videos = referenceVideoUrls;
        if (referenceAudioUrls.length) requestBody.audios = referenceAudioUrls;
        if (referenceUrls[0]) requestBody.image = referenceUrls[0];
        if (referenceUrls.length > 1) requestBody.reference_images = referenceUrls.slice(1, 5);
    }
    const providerTaskIds = [];
    let upstreamMs = 0;
    let upstreamRequestMs = 0;
    let upstreamResponseMs = 0;
    let upstreamResponseTextMs = 0;
    let upstreamResponseParseMs = 0;
    let asyncPollMs = 0;
    let asyncPollRequestMs = 0;
    let asyncPollResponseMs = 0;
    let asyncPollAttempts = 0;
    let asyncPollPath = '';
    let attempts = 1;
    let lastPayloadSummary = null;
    let tokenUsage = {};
    const submitAttempts = [];
    let submitEndpointPath = submitEndpoint;
    const submitFallbackUsed = false;
    const captureSub2ApiBilling = shouldCaptureTaskSub2ApiBilling(task);
    const sub2ApiClientRequestId = captureSub2ApiBilling && isSub2ApiGatewayBaseUrl(config.baseUrl)
        ? buildSub2ApiClientRequestId(task)
        : '';
    const sub2ApiClientRequestHeaders = sub2ApiClientRequestId
        ? { 'X-Client-Request-ID': sub2ApiClientRequestId }
        : {};

    const submitVideoRequest = async (endpointPath) => {
        const requestStart = nowMs();
        const endpoint = normalizeEndpointPath(endpointPath);
        const response = await fetchProviderResponse(fetchImpl, buildProviderEndpointUrl(config.baseUrl, endpoint), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                ...sub2ApiClientRequestHeaders
            },
            body: JSON.stringify(requestBody),
            ...(signal ? { signal } : {})
        }, {
            env,
            label: 'AI 视频生成上游'
        });
        const requestMs = elapsedMs(requestStart);
        upstreamRequestMs += requestMs;
        const payloadTiming = {};
        const payload = await readUpstreamPayload(response, payloadTiming, { env, signal });
        const responseMs = Number(payloadTiming.response_body_ms || 0) || 0;
        upstreamResponseMs += responseMs;
        upstreamResponseTextMs += Number(payloadTiming.response_text_ms || 0) || 0;
        upstreamResponseParseMs += Number(payloadTiming.response_parse_ms || 0) || 0;
        upstreamMs += requestMs + responseMs;
        submitAttempts.push({
            endpoint,
            status: response.status,
            ok: Boolean(response.ok),
            request_ms: requestMs,
            response_ms: responseMs,
            route_not_found: isRouteNotFoundPayload(response, payload)
        });
        return {
            response,
            payload,
            endpoint
        };
    };

    const submitResult = await submitVideoRequest(submitEndpoint);

    const { response, payload } = submitResult;

    if (!response.ok || isRouteNotFoundPayload(response, payload)) {
        const error = buildUpstreamError(response, payload);
        error.metadata = {
            executor: 'openai-compatible-videos',
            provider: 'openai-compatible',
            provider_model: config.model,
            provider_source: config.source,
            video_submit_endpoint: submitEndpointPath,
            video_submit_fallback_used: submitFallbackUsed,
            video_submit_attempts: submitAttempts,
            timing: {
                upstream_ms: upstreamMs,
                upstream_request_ms: upstreamRequestMs,
                upstream_response_ms: upstreamResponseMs,
                upstream_response_text_ms: upstreamResponseTextMs,
                upstream_response_parse_ms: upstreamResponseParseMs
            }
        };
        throw error;
    }

    const providerTaskId = getProviderTaskIdFromPayload(payload);
    const providerStatus = getProviderStatusFromPayload(payload);
    if (providerTaskId) {
        providerTaskIds.push(providerTaskId);
        if (typeof onProviderTask === 'function') {
            await onProviderTask({
                providerTaskId,
                status: providerStatus,
                payloadSummary: summarizeUpstreamPayload(payload),
                sub2ApiClientRequestId
            });
        }
    }

    let data = extractProviderVideoData(payload);
    if (!data.length && providerTaskId && !isTerminalFailureProviderStatus(providerStatus)) {
        const pollTiming = {};
        const pollResult = await pollOpenAiCompatibleVideoResult({
            task,
            config,
            providerTaskId,
            fetchImpl,
            env,
            signal,
            timing: pollTiming
        });
        asyncPollMs += Number(pollTiming.async_poll_ms || 0) || 0;
        asyncPollRequestMs += Number(pollTiming.async_poll_request_ms || 0) || 0;
        asyncPollResponseMs += Number(pollTiming.async_poll_response_ms || 0) || 0;
        upstreamMs += Number(pollTiming.async_poll_ms || 0) || 0;
        upstreamRequestMs += Number(pollTiming.async_poll_request_ms || 0) || 0;
        upstreamResponseMs += Number(pollTiming.async_poll_response_ms || 0) || 0;
        asyncPollAttempts += Math.max(0, Number(pollResult?.attempts || 0));
        asyncPollPath = pollResult?.path || '';
        attempts += Math.max(0, Number(pollResult?.attempts || 0));
        if (pollResult?.payload) {
            lastPayloadSummary = summarizeUpstreamPayload(pollResult.payload);
            const nextProviderTaskId = getProviderTaskIdFromPayload(pollResult.payload) || providerTaskId;
            if (nextProviderTaskId && !providerTaskIds.includes(nextProviderTaskId)) {
                providerTaskIds.push(nextProviderTaskId);
            }
        }
        if (pollResult?.data?.length) {
            data = pollResult.data;
        }
    }

    if (!data.length && providerTaskId && !isTerminalFailureProviderStatus(providerStatus) && isVideoTaskSubmitEndpoint(submitEndpointPath)) {
        const contentItem = buildProviderVideoContentItem(config, providerTaskId);
        if (contentItem) data = [contentItem];
    }

    lastPayloadSummary = lastPayloadSummary || summarizeUpstreamPayload(payload);
    if (payload.usage || (captureSub2ApiBilling && isSub2ApiGatewayBaseUrl(config.baseUrl))) {
        const resolvedUsage = captureSub2ApiBilling
            ? await resolveTokenUsageWithSub2ApiBilling({
                usage: payload.usage || {},
                payload: {
                    ...payload,
                    client_request_id: sub2ApiClientRequestId,
                    clientRequestId: sub2ApiClientRequestId
                },
                response,
                config,
                fetchImpl,
                env,
                signal
            })
            : normalizeTokenUsage(payload.usage || {});
        tokenUsage = addTokenUsage(tokenUsage, resolvedUsage);
    }

    return {
        data: data.slice(0, 1),
        requestedCount: 1,
        deliveredCount: data.length ? 1 : 0,
        attempts,
        upstreamMs,
        upstreamRequestMs,
        upstreamResponseMs,
        upstreamResponseTextMs,
        upstreamResponseParseMs,
        asyncPollMs,
        asyncPollRequestMs,
        asyncPollResponseMs,
        asyncPollAttempts,
        asyncPollPath,
        emptyResultSummary: !data.length ? lastPayloadSummary : null,
        revisedPrompt: normalizeText(payload.revised_prompt || payload.revisedPrompt || payload.prompt || task.prompt, 8000),
        tokenUsage,
        providerTaskId: [...new Set(providerTaskIds.filter(Boolean))].join(','),
        sub2ApiClientRequestId,
        submitEndpoint: submitEndpointPath,
        submitFallbackUsed,
        submitAttempts
    };
}

async function normalizeGeneratedImageItem(item = {}, {
    env,
    task,
    index,
    size,
    fetchImpl,
    uploadImageBuffer,
    timing = null
} = {}) {
    const mimeType = normalizeText(item.mime_type || item.mimeType || 'image/png', 120) || 'image/png';
    const providerImageUrl = normalizeText(item.url || item.image_url, 4000);
    let stored = {
        image_url: '',
        original_image_url: '',
        storage_path: '',
        original_storage_path: ''
    };
    let deferredOriginalUpload = null;

    if (providerImageUrl) {
        const uploadResult = await persistProviderImageUrl(providerImageUrl, {
            env,
            task,
            index,
            mimeType,
            fetchImpl,
            uploadImageBuffer,
            timing
        });
        if (uploadResult?.stored) {
            stored = uploadResult.stored;
            deferredOriginalUpload = uploadResult.deferredOriginalUpload || null;
        } else {
            stored = uploadResult || stored;
        }
    } else if (item.b64_json) {
        const buffer = Buffer.from(String(item.b64_json || ''), 'base64');
        const uploadResult = await uploadImageBuffer(buffer, {
            env,
            task,
            index,
            mimeType,
            timing
        });
        if (uploadResult?.stored) {
            stored = uploadResult.stored;
            deferredOriginalUpload = uploadResult.deferredOriginalUpload || null;
        } else {
            stored = uploadResult || stored;
        }
    }

    if (!stored.image_url) {
        const error = new Error('AI 图片模型没有返回可保存的图片');
        error.statusCode = 502;
        error.code = 'ai_image_empty_result';
        throw error;
    }

    return {
        ...stored,
        result_index: index,
        mime_type: mimeType,
        width: size.width,
        height: size.height,
        ratio: task.ratio || '1:1',
        resolution: task.resolution || '720p',
        prompt: task.prompt || '',
        revised_prompt: normalizeText(item.revised_prompt || item.revisedPrompt || task.prompt, 8000),
        seed: normalizeText(item.seed || item.id, 120),
        deferredOriginalUpload,
        metadata: {
            ...(stored.metadata && typeof stored.metadata === 'object' && !Array.isArray(stored.metadata) ? stored.metadata : {}),
            provider: 'openai-compatible',
            provider_item_id: normalizeText(item.id, 160),
            size: size.size
        }
    };
}

async function normalizeGeneratedVideoItem(item = {}, {
    env,
    task,
    index,
    size,
    fetchImpl,
    config = {},
    timing = null
} = {}) {
    const mimeType = inferVideoMimeType(item.mime_type || item.mimeType || item.type || 'video/mp4', 'video/mp4', item.url || item.video_url || item.videoUrl);
    const providerVideoUrl = normalizeText(item.url || item.video_url || item.videoUrl, 4000);
    const rawProviderAuthHeaders = item.provider_auth_headers && typeof item.provider_auth_headers === 'object' && !Array.isArray(item.provider_auth_headers)
        ? item.provider_auth_headers
        : {};
    const providerAuthRequired = Boolean(item.provider_auth_required || Object.keys(rawProviderAuthHeaders).length > 0 || isProviderVideoContentUrl(config, providerVideoUrl));
    const providerAuthHeaders = providerAuthRequired && !rawProviderAuthHeaders.Authorization && !rawProviderAuthHeaders.authorization && config.apiKey
        ? { ...rawProviderAuthHeaders, Authorization: `Bearer ${config.apiKey}` }
        : rawProviderAuthHeaders;
    if (!providerVideoUrl) {
        const error = new Error('AI 视频模型没有返回可展示的视频');
        error.statusCode = 502;
        error.code = 'ai_video_empty_result';
        throw error;
    }
    if (providerAuthRequired && !resolveR2Config(env).configured) {
        const error = new Error('AI 视频存储未配置，无法保存需要鉴权下载的视频结果');
        error.statusCode = 503;
        error.code = 'ai_video_storage_not_configured';
        throw error;
    }
    const persisted = persistProviderVideoUrl(providerVideoUrl, {
        env,
        task,
        index,
        mimeType,
        fetchImpl,
        timing,
        authHeaders: providerAuthHeaders,
        requireServerCopy: providerAuthRequired
    });
    let stored = persisted.stored || {};
    let deferredOriginalUpload = persisted.deferredOriginalUpload || null;

    if (providerAuthRequired && deferredOriginalUpload && typeof deferredOriginalUpload.run === 'function') {
        const uploaded = await deferredOriginalUpload.run({ result: null, task });
        stored = {
            image_url: uploaded.image_url || '',
            original_image_url: uploaded.original_image_url || uploaded.image_url || '',
            storage_path: uploaded.storage_path || '',
            original_storage_path: uploaded.original_storage_path || uploaded.storage_path || '',
            metadata: {
                ...(stored.metadata && typeof stored.metadata === 'object' && !Array.isArray(stored.metadata) ? stored.metadata : {}),
                ...(uploaded.metadata && typeof uploaded.metadata === 'object' && !Array.isArray(uploaded.metadata) ? uploaded.metadata : {}),
                preview_status: 'ready',
                original_status: 'ready'
            }
        };
        deferredOriginalUpload = null;
    }

    return {
        image_url: stored.image_url || providerVideoUrl,
        original_image_url: stored.original_image_url || providerVideoUrl,
        storage_path: stored.storage_path || '',
        original_storage_path: stored.original_storage_path || '',
        result_index: index,
        mime_type: mimeType,
        width: size.width,
        height: size.height,
        ratio: task.ratio || '16:9',
        resolution: task.resolution || '1k',
        prompt: task.prompt || '',
        revised_prompt: normalizeText(item.revised_prompt || item.revisedPrompt || task.prompt, 8000),
        seed: normalizeText(item.seed || item.id, 120),
        deferredOriginalUpload,
        metadata: {
            ...(stored.metadata && typeof stored.metadata === 'object' && !Array.isArray(stored.metadata) ? stored.metadata : {}),
            provider: 'openai-compatible',
            provider_item_id: normalizeText(item.id, 160),
            provider_video_url: providerVideoUrl,
            provider_video_content_endpoint: normalizeText(item.provider_video_content_endpoint, 500),
            provider_auth_required: providerAuthRequired,
            media_type: 'video',
            size: size.size,
            video_ratio: task.ratio || size.ratio || 'adaptive',
            video_resolution: task.resolution || size.resolution || '720p'
        }
    };
}

async function executeOpenAiCompatibleVideoGeneration(task = {}, {
    supabase,
    env = process.env,
    fetchImpl = globalThis.fetch,
    runtimeConfig,
    onImageResult,
    signal = null
} = {}) {
    if (task.billing_mode === 'api' && !runtimeConfig) {
        const error = new Error('API 模式需要使用用户 Key 的即时执行通道，当前后台队列不会读取或保存明文 Key');
        error.statusCode = 409;
        error.code = 'ai_image_api_mode_requires_transient_key';
        throw error;
    }

    if (!VIDEO_GENERATION_MODES.has(String(task.mode || '').trim())) {
        const error = new Error('该 AI 视频任务模式尚未接入真实模型执行器');
        error.statusCode = 409;
        error.code = 'ai_video_mode_not_supported';
        throw error;
    }

    if (typeof fetchImpl !== 'function') {
        const error = new Error('Fetch runtime is unavailable');
        error.statusCode = 503;
        error.code = 'ai_image_fetch_unavailable';
        throw error;
    }

    const preflightStart = nowMs();
    const config = await resolveExecutorRuntimeConfig({
        supabase,
        task,
        env,
        runtimeConfig
    });
    const configResolveMs = elapsedMs(preflightStart);
    if (!config.configured) {
        const error = new Error('AI 视频模型 API Key 或 Base URL 未配置');
        error.statusCode = 503;
        error.code = 'ai_video_model_not_configured';
        throw error;
    }

    const size = resolveOpenAiVideoSize({
        ratio: task.ratio || 'adaptive',
        resolution: task.resolution || '720p'
    });
    const preflightMs = elapsedMs(preflightStart);
    const upstream = await requestOpenAiCompatibleVideos({
        task,
        config,
        size,
        fetchImpl,
        env,
        signal,
        onProviderTask: async ({ providerTaskId, status, payloadSummary, sub2ApiClientRequestId } = {}) => {
            await updateProviderTaskHandle(supabase, task, providerTaskId, {
                status,
                payload_summary: payloadSummary,
                sub2api_client_request_id: normalizeText(sub2ApiClientRequestId, 160),
                source: 'openai-compatible-videos'
            });
        }
    });

    const data = Array.isArray(upstream.data) ? upstream.data : [];
    if (!data.length) {
        const error = new Error('AI 视频模型返回为空');
        error.statusCode = 502;
        error.code = 'ai_video_empty_result';
        error.metadata = {
            timing: {
                preflight_ms: preflightMs,
                config_resolve_ms: configResolveMs,
                upstream_ms: upstream.upstreamMs,
                upstream_request_ms: upstream.upstreamRequestMs,
                upstream_response_ms: upstream.upstreamResponseMs,
                upstream_response_text_ms: upstream.upstreamResponseTextMs,
                upstream_response_parse_ms: upstream.upstreamResponseParseMs,
                async_poll_ms: upstream.asyncPollMs,
                async_poll_request_ms: upstream.asyncPollRequestMs,
                async_poll_response_ms: upstream.asyncPollResponseMs
            },
            executor: 'openai-compatible-videos',
            provider: 'openai-compatible',
            provider_model: config.model,
            provider_source: config.source,
            provider_size: size.size,
            video_ratio: task.ratio || size.ratio || 'adaptive',
            video_resolution: task.resolution || size.resolution || '720p',
            requested_video_count: upstream.requestedCount,
            delivered_video_count: 0,
            sub2api_client_request_id: upstream.sub2ApiClientRequestId || '',
            provider_attempt_count: upstream.attempts,
            video_submit_endpoint: upstream.submitEndpoint,
            video_submit_fallback_used: upstream.submitFallbackUsed,
            video_submit_attempts: upstream.submitAttempts,
            async_poll_attempts: upstream.asyncPollAttempts,
            async_poll_path: upstream.asyncPollPath,
            upstream_empty_result: upstream.emptyResultSummary || null
        };
        throw error;
    }

    const postprocessStart = nowMs();
    const postprocessTiming = {};
    const images = await Promise.all(data.map((item, index) => normalizeGeneratedVideoItem(item, {
        env,
        task,
        index,
        size,
        fetchImpl,
        config,
        timing: postprocessTiming
    })));
    if (typeof onImageResult === 'function') {
        for (let index = 0; index < images.length; index += 1) {
            const { deferredOriginalUpload, ...outputImage } = images[index];
            // eslint-disable-next-line no-await-in-loop
            await onImageResult(outputImage, {
                index,
                requestedCount: 1
            });
        }
    }
    const postprocessMs = elapsedMs(postprocessStart);
    const timing = {
        preflight_ms: preflightMs,
        config_resolve_ms: configResolveMs,
        upstream_ms: upstream.upstreamMs,
        upstream_request_ms: upstream.upstreamRequestMs,
        upstream_response_ms: upstream.upstreamResponseMs,
        upstream_response_text_ms: upstream.upstreamResponseTextMs,
        upstream_response_parse_ms: upstream.upstreamResponseParseMs,
        async_poll_ms: upstream.asyncPollMs,
        async_poll_request_ms: upstream.asyncPollRequestMs,
        async_poll_response_ms: upstream.asyncPollResponseMs,
        video_download_request_ms: Number(postprocessTiming.video_download_request_ms || 0) || 0,
        video_download_body_ms: Number(postprocessTiming.video_download_body_ms || 0) || 0,
        video_fast_start_ms: Number(postprocessTiming.video_fast_start_ms || 0) || 0,
        video_upload_ms: Number(postprocessTiming.deferred_original_upload_ms || 0) || 0,
        postprocess_ms: postprocessMs
    };
    timing.executor_ms = Number(timing.preflight_ms || 0) + Number(timing.upstream_ms || 0) + Number(timing.postprocess_ms || 0);
    timing.executor_unaccounted_ms = 0;
    const deferredOriginalUploads = images
        .map((image, index) => {
            if (!image?.deferredOriginalUpload) return null;
            return {
                resultIndex: Number.isFinite(Number(image.deferredOriginalUpload.resultIndex))
                    ? Number(image.deferredOriginalUpload.resultIndex)
                    : index,
                run: image.deferredOriginalUpload.run
            };
        })
        .filter((item) => item && typeof item.run === 'function');
    const outputImages = images.map(({ deferredOriginalUpload, ...image }) => image);

    return {
        status: 'succeeded',
        resultPrompt: normalizeText(upstream.revisedPrompt || data[0]?.revised_prompt || task.prompt, 8000),
        images: outputImages,
        deferredOriginalUploads,
        tokenUsage: normalizeTokenUsage(upstream.tokenUsage),
        providerTaskId: normalizeText(upstream.providerTaskId, 240),
        metadata: {
            timing,
            preflight_ms: preflightMs,
            config_resolve_ms: configResolveMs,
            upstream_ms: upstream.upstreamMs,
            upstream_request_ms: upstream.upstreamRequestMs,
            upstream_response_ms: upstream.upstreamResponseMs,
            upstream_response_text_ms: upstream.upstreamResponseTextMs,
            upstream_response_parse_ms: upstream.upstreamResponseParseMs,
            async_poll_ms: upstream.asyncPollMs,
            async_poll_request_ms: upstream.asyncPollRequestMs,
            async_poll_response_ms: upstream.asyncPollResponseMs,
            video_download_request_ms: Number(postprocessTiming.video_download_request_ms || 0) || 0,
            video_download_body_ms: Number(postprocessTiming.video_download_body_ms || 0) || 0,
            video_fast_start_ms: Number(postprocessTiming.video_fast_start_ms || 0) || 0,
            video_upload_ms: Number(postprocessTiming.deferred_original_upload_ms || 0) || 0,
            postprocess_ms: postprocessMs,
            executor_ms: timing.executor_ms,
            executor_unaccounted_ms: 0,
            executor: 'openai-compatible-videos',
            provider: 'openai-compatible',
            provider_model: config.model,
            provider_source: config.source,
            provider_size: size.size,
            video_ratio: task.ratio || size.ratio || 'adaptive',
            video_resolution: task.resolution || size.resolution || '720p',
            media_type: 'video',
            requested_video_count: upstream.requestedCount,
            delivered_video_count: outputImages.length,
            deferred_original_count: deferredOriginalUploads.length,
            provider_task_id: normalizeText(upstream.providerTaskId, 240),
            sub2api_client_request_id: upstream.sub2ApiClientRequestId || '',
            provider_attempt_count: upstream.attempts,
            video_submit_endpoint: upstream.submitEndpoint,
            video_submit_fallback_used: upstream.submitFallbackUsed,
            video_submit_attempts: upstream.submitAttempts,
            async_poll_attempts: upstream.asyncPollAttempts,
            async_poll_path: upstream.asyncPollPath
        }
    };
}

async function executeOpenAiCompatibleImageGeneration(task = {}, {
    supabase,
    env = process.env,
    fetchImpl = globalThis.fetch,
    uploadImageBuffer = uploadGeneratedImageBufferPreviewFirst,
    runtimeConfig,
    onImageResult,
    signal = null
} = {}) {
    if (task.billing_mode === 'api' && !runtimeConfig) {
        const error = new Error('API 模式需要使用用户 Key 的即时执行通道，当前后台队列不会读取或保存明文 Key');
        error.statusCode = 409;
        error.code = 'ai_image_api_mode_requires_transient_key';
        throw error;
    }

    if (!IMAGE_GENERATION_MODES.has(String(task.mode || '').trim())) {
        const error = new Error('该 AI 图片任务模式尚未接入真实模型执行器');
        error.statusCode = 409;
        error.code = 'ai_image_mode_not_supported';
        throw error;
    }

    if (typeof fetchImpl !== 'function') {
        const error = new Error('Fetch runtime is unavailable');
        error.statusCode = 503;
        error.code = 'ai_image_fetch_unavailable';
        throw error;
    }

    const preflightStart = nowMs();
    const config = await resolveExecutorRuntimeConfig({
        supabase,
        task,
        env,
        runtimeConfig
    });
    const configResolveMs = elapsedMs(preflightStart);
    if (!config.configured) {
        const error = new Error('AI 图片模型 API Key 或 Base URL 未配置');
        error.statusCode = 503;
        error.code = 'ai_image_model_not_configured';
        throw error;
    }

    const responseFormat = resolveOpenAiImageResponseFormat(env);
    if ((uploadImageBuffer === uploadGeneratedImageBufferToR2 || uploadImageBuffer === uploadGeneratedImageBufferPreviewFirst) && shouldRequireStorageBeforeCall({
        model: config.model,
        env,
        responseFormat
    })) {
        const error = new Error('AI 图片模型会返回 base64 原图，请先配置 R2 图片存储');
        error.statusCode = 503;
        error.code = 'ai_image_storage_not_configured';
        throw error;
    }

    const size = resolveOpenAiImageSize({
        ratio: task.ratio || '1:1',
        resolution: task.resolution || '1k'
    });
    const requestedCount = normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
    const quantity = normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
    const quality = normalizeOpenAiImageQuality(task.metadata?.quality || env.AI_IMAGE_QUALITY);
    const isImageEdit = String(task.mode || '').trim() === 'image';
    const executorTiming = {};
    let referenceImages = [];
    let referenceFetchMs = 0;

    if (isImageEdit) {
        const referenceFetchStart = nowMs();
        const referenceImageUrls = getTaskReferenceImageUrls(task);
        referenceImages = await fetchReferenceImagesForEdit(referenceImageUrls, {
            env,
            fetchImpl
        });
        referenceFetchMs = elapsedMs(referenceFetchStart);
        task.metadata = {
            ...(task.metadata || {}),
            reference_image_count: referenceImages.length
        };
    }

    const preflightMs = elapsedMs(preflightStart);
    const upstream = await requestOpenAiCompatibleImages({
        task,
        config,
        size,
        quantity,
        responseFormat,
        quality,
        isImageEdit,
        referenceImages,
        fetchImpl,
        env,
        signal,
        onProviderTask: async ({ providerTaskId, status, payloadSummary } = {}) => {
            await updateProviderTaskHandle(supabase, task, providerTaskId, {
                status,
                payload_summary: payloadSummary,
                source: 'openai-compatible-images'
            });
        }
    });

    const data = Array.isArray(upstream.data) ? upstream.data : [];
    if (!data.length) {
        const error = new Error('AI 图片模型返回为空');
        error.statusCode = 502;
        error.code = 'ai_image_empty_result';
        error.metadata = {
            timing: {
                preflight_ms: preflightMs,
                config_resolve_ms: configResolveMs,
                reference_fetch_ms: referenceFetchMs,
                upstream_ms: upstream.upstreamMs,
                upstream_request_ms: upstream.upstreamRequestMs,
                upstream_response_ms: upstream.upstreamResponseMs,
                upstream_response_text_ms: upstream.upstreamResponseTextMs,
                upstream_response_parse_ms: upstream.upstreamResponseParseMs,
                async_poll_ms: upstream.asyncPollMs,
                async_poll_request_ms: upstream.asyncPollRequestMs,
                async_poll_response_ms: upstream.asyncPollResponseMs
            },
            executor: isImageEdit ? 'openai-compatible-image-edits' : 'openai-compatible-images',
            provider: 'openai-compatible',
            provider_model: config.model,
            provider_source: config.source,
            provider_size: size.size,
            response_format: upstream.responseFormat,
            response_format_fallback_used: upstream.responseFormatFallbackUsed,
            requested_image_count: upstream.requestedCount,
            delivered_image_count: 0,
            provider_attempt_count: upstream.attempts,
            async_poll_attempts: upstream.asyncPollAttempts,
            async_poll_path: upstream.asyncPollPath,
            upstream_empty_result: upstream.emptyResultSummary || null
        };
        throw error;
    }

    const images = [];
    const postprocessStart = nowMs();
    for (let index = 0; index < data.length; index += 1) {
        const resultIndex = Number.isFinite(Number(data[index]?.result_index))
            ? Number(data[index].result_index)
            : index;
        // Keep upload order deterministic so result_index matches upstream order.
        const imageNormalizeStart = nowMs();
        // eslint-disable-next-line no-await-in-loop
        const image = await normalizeGeneratedImageItem(data[index], {
            env,
            task,
            index: resultIndex,
            size,
            fetchImpl,
            uploadImageBuffer,
            timing: executorTiming
        });
        addTimingMs(executorTiming, 'image_normalize_ms', elapsedMs(imageNormalizeStart));
        images.push(image);
        if (typeof onImageResult === 'function') {
            const { deferredOriginalUpload, ...outputImage } = image;
            const partialSaveStart = nowMs();
            // eslint-disable-next-line no-await-in-loop
            await onImageResult(outputImage, {
                index: resultIndex,
                requestedCount: upstream.requestedCount || quantity
            });
            addTimingMs(executorTiming, 'partial_result_save_ms', elapsedMs(partialSaveStart));
        }
    }
    const postprocessMs = elapsedMs(postprocessStart);
    addTimingMs(executorTiming, 'postprocess_ms', postprocessMs);
    addTimingMs(executorTiming, 'total_executor_ms', postprocessMs);
    executorTiming.executor_ms = Math.max(
        Number(executorTiming.executor_ms || 0),
        Number(executorTiming.preflight_ms || 0)
            + Number(executorTiming.upstream_ms || 0)
            + Number(executorTiming.postprocess_ms || 0)
    );
    executorTiming.executor_unaccounted_ms = Math.max(0, Number(executorTiming.executor_ms || 0) - (
        Number(executorTiming.preflight_ms || 0)
        + Number(executorTiming.upstream_ms || 0)
        + Number(executorTiming.postprocess_ms || 0)
    ));
    const timing = {
        ...executorTiming,
        preflight_ms: preflightMs,
        config_resolve_ms: configResolveMs,
        reference_fetch_ms: referenceFetchMs,
        upstream_ms: upstream.upstreamMs,
        upstream_request_ms: upstream.upstreamRequestMs,
        upstream_response_ms: upstream.upstreamResponseMs,
        upstream_response_text_ms: upstream.upstreamResponseTextMs,
        upstream_response_parse_ms: upstream.upstreamResponseParseMs,
        async_poll_ms: upstream.asyncPollMs,
        async_poll_request_ms: upstream.asyncPollRequestMs,
        async_poll_response_ms: upstream.asyncPollResponseMs,
        postprocess_ms: postprocessMs
    };
    const executorMs = Math.max(
        Number(timing.executor_ms || 0),
        Number(timing.preflight_ms || 0) + Number(timing.upstream_ms || 0) + Number(timing.postprocess_ms || 0)
    );
    timing.executor_ms = executorMs;
    timing.executor_unaccounted_ms = Math.max(
        0,
        executorMs - (
            Number(timing.preflight_ms || 0)
            + Number(timing.upstream_ms || 0)
            + Number(timing.postprocess_ms || 0)
        )
    );
    const deferredOriginalUploads = images
        .map((image, index) => {
            if (!image?.deferredOriginalUpload) return null;
            return {
                resultIndex: Number.isFinite(Number(image.deferredOriginalUpload.resultIndex))
                    ? Number(image.deferredOriginalUpload.resultIndex)
                    : index,
                run: image.deferredOriginalUpload.run
            };
        })
        .filter((item) => item && typeof item.run === 'function');
    const outputImages = images.map(({ deferredOriginalUpload, ...image }) => image);

    return {
        status: 'succeeded',
        resultPrompt: normalizeText(upstream.revisedPrompt || data[0]?.revised_prompt || task.prompt, 8000),
        images: outputImages,
        deferredOriginalUploads,
        tokenUsage: normalizeTokenUsage(upstream.tokenUsage),
        providerTaskId: normalizeText(upstream.providerTaskId, 240),
        metadata: {
            timing,
            preflight_ms: preflightMs,
            config_resolve_ms: configResolveMs,
            reference_fetch_ms: referenceFetchMs,
            upstream_ms: upstream.upstreamMs,
            upstream_request_ms: upstream.upstreamRequestMs,
            upstream_response_ms: upstream.upstreamResponseMs,
            upstream_response_text_ms: upstream.upstreamResponseTextMs,
            upstream_response_parse_ms: upstream.upstreamResponseParseMs,
            async_poll_ms: upstream.asyncPollMs,
            async_poll_request_ms: upstream.asyncPollRequestMs,
            async_poll_response_ms: upstream.asyncPollResponseMs,
            postprocess_ms: postprocessMs,
            executor_ms: executorMs,
            executor_unaccounted_ms: timing.executor_unaccounted_ms,
            executor: isImageEdit ? 'openai-compatible-image-edits' : 'openai-compatible-images',
            provider: 'openai-compatible',
            provider_model: config.model,
            provider_source: config.source,
            provider_size: size.size,
            response_format: upstream.responseFormat,
            response_format_fallback_used: upstream.responseFormatFallbackUsed,
            reference_image_count: task.metadata?.reference_image_count || 0,
            requested_image_count: upstream.requestedCount,
            delivered_image_count: outputImages.length,
            provider_attempt_count: upstream.attempts,
            async_poll_attempts: upstream.asyncPollAttempts,
            async_poll_path: upstream.asyncPollPath,
            partial_error: upstream.partialError || null,
            deferred_original_count: deferredOriginalUploads.length
        }
    };
}

async function finalizeGeminiNativeImages({
    task = {},
    config = {},
    data = [],
    payload = {},
    size = {},
    env = process.env,
    fetchImpl = globalThis.fetch,
    uploadImageBuffer = uploadGeneratedImageBufferPreviewFirst,
    onImageResult,
    preflightMs = 0,
    configResolveMs = 0,
    referenceFetchMs = 0,
    referenceImageCount = 0,
    upstreamMs = 0,
    upstreamRequestMs = 0,
    upstreamResponseMs = 0,
    upstreamResponseTextMs = 0,
    upstreamResponseParseMs = 0,
    stream = false,
    urlBridge = false,
    bridgeFallback = false,
    requestedCountOverride = null,
    resultIndexOffset = 0,
    maxImages = null
} = {}) {
    const images = [];
    const executorTiming = {};
    const deferredOriginalUploads = [];
    const requestedCount = normalizePositiveInt(requestedCountOverride ?? task.quantity, 1, { min: 1, max: 8 });
    const normalizedResultIndexOffset = normalizePositiveInt(resultIndexOffset, 0, { min: 0, max: 8 });
    const dataItems = Array.isArray(data) ? data.slice(0, maxImages ? normalizePositiveInt(maxImages, 1, { min: 1, max: 8 }) : data.length) : [];
    const postprocessStart = nowMs();
    for (let index = 0; index < dataItems.length; index += 1) {
        const resultIndex = normalizedResultIndexOffset + index;
        const imageNormalizeStart = nowMs();
        // eslint-disable-next-line no-await-in-loop
        const image = await normalizeGeneratedImageItem(dataItems[index], {
            env,
            task,
            index: resultIndex,
            size,
            fetchImpl,
            uploadImageBuffer,
            timing: executorTiming
        });
        addTimingMs(executorTiming, 'image_normalize_ms', elapsedMs(imageNormalizeStart));
        if (image?.deferredOriginalUpload && typeof image.deferredOriginalUpload.run === 'function') {
            deferredOriginalUploads.push({
                ...image.deferredOriginalUpload,
                resultIndex
            });
        }
        images.push(image);
        if (typeof onImageResult === 'function') {
            const { deferredOriginalUpload, ...outputImage } = image;
            const partialSaveStart = nowMs();
            // eslint-disable-next-line no-await-in-loop
            await onImageResult({
                ...outputImage,
                metadata: {
                    ...(outputImage.metadata || {}),
                    provider: 'gemini-native'
                }
            }, {
                index: resultIndex,
                requestedCount
            });
            addTimingMs(executorTiming, 'partial_result_save_ms', elapsedMs(partialSaveStart));
        }
    }
    const postprocessMs = elapsedMs(postprocessStart);
    const timingOutput = {
        ...executorTiming,
        preflight_ms: preflightMs,
        config_resolve_ms: configResolveMs,
        reference_fetch_ms: referenceFetchMs,
        upstream_ms: upstreamMs,
        upstream_request_ms: upstreamRequestMs,
        upstream_response_ms: upstreamResponseMs,
        upstream_response_text_ms: upstreamResponseTextMs,
        upstream_response_parse_ms: upstreamResponseParseMs,
        postprocess_ms: postprocessMs
    };
    timingOutput.executor_ms = Number(timingOutput.preflight_ms || 0) + Number(timingOutput.upstream_ms || 0) + Number(timingOutput.postprocess_ms || 0);
    timingOutput.executor_unaccounted_ms = 0;
    const outputImages = images.map(({ deferredOriginalUpload, ...image }) => ({
        ...image,
        metadata: {
            ...(image.metadata || {}),
            provider: 'gemini-native'
        }
    }));

    return {
        status: 'succeeded',
        resultPrompt: normalizeText(dataItems[0]?.revised_prompt || task.prompt, 8000),
        images: outputImages,
        deferredOriginalUploads,
        tokenUsage: normalizeTokenUsage(payload.usageMetadata || payload.usage_metadata || payload.usage),
        providerTaskId: normalizeText(payload.responseId || payload.response_id || '', 240),
        metadata: {
            timing: timingOutput,
            ...timingOutput,
            executor: urlBridge
                ? (bridgeFallback ? 'gemini-native-images-url-bridge-fallback' : 'gemini-native-images-url-bridge')
                : (stream ? 'gemini-native-images-stream' : 'gemini-native-images'),
            provider: 'gemini-native',
            provider_model: config.model,
            provider_source: config.source,
            provider_size: size.size,
            reference_image_count: referenceImageCount,
            requested_image_count: requestedCount,
            delivered_image_count: outputImages.length,
            stream: stream === true,
            url_bridge: urlBridge === true,
            bridge_fallback_used: bridgeFallback === true
        }
    };
}

function aggregateGeminiNativeImageExecutions({
    task = {},
    config = {},
    executions = [],
    requestedCount = 1,
    attemptedCount = executions.length,
    partialError = null
} = {}) {
    const outputImagesByIndex = new Map();
    const deferredOriginalUploadsByIndex = new Map();
    const providerTaskIds = [];
    const executorNames = new Set();
    let tokenUsage = {};
    let resultPrompt = '';
    const timing = {};
    const timingKeys = [
        'preflight_ms',
        'config_resolve_ms',
        'reference_fetch_ms',
        'upstream_ms',
        'upstream_request_ms',
        'upstream_response_ms',
        'upstream_response_text_ms',
        'upstream_response_parse_ms',
        'postprocess_ms',
        'image_normalize_ms',
        'partial_result_save_ms',
        'preview_build_ms',
        'preview_upload_ms',
        'original_upload_ms',
        'executor_ms'
    ];

    executions.forEach((execution) => {
        const metadata = safeObject(execution?.metadata);
        const executionTiming = safeObject(metadata.timing);
        (Array.isArray(execution?.images) ? execution.images : []).forEach((image) => {
            const resultIndex = Number(image?.result_index ?? image?.resultIndex);
            const normalizedIndex = Number.isFinite(resultIndex) ? resultIndex : outputImagesByIndex.size;
            if (!outputImagesByIndex.has(normalizedIndex)) {
                outputImagesByIndex.set(normalizedIndex, image);
            }
        });
        (Array.isArray(execution?.deferredOriginalUploads) ? execution.deferredOriginalUploads : []).forEach((upload) => {
            const resultIndex = Number(upload?.resultIndex ?? upload?.result_index);
            const normalizedIndex = Number.isFinite(resultIndex) ? resultIndex : deferredOriginalUploadsByIndex.size;
            if (!deferredOriginalUploadsByIndex.has(normalizedIndex)) {
                deferredOriginalUploadsByIndex.set(normalizedIndex, upload);
            }
        });
        tokenUsage = addTokenUsage(tokenUsage, execution?.tokenUsage || {});
        if (!resultPrompt && execution?.resultPrompt) {
            resultPrompt = normalizeText(execution.resultPrompt, 8000);
        }
        if (execution?.providerTaskId) {
            providerTaskIds.push(...String(execution.providerTaskId).split(',').map((item) => normalizeText(item, 240)).filter(Boolean));
        }
        if (metadata.executor) {
            executorNames.add(normalizeText(metadata.executor, 120));
        }
        timingKeys.forEach((key) => {
            const value = metadata[key] ?? executionTiming[key];
            timing[key] = normalizeTimingMs(timing[key]) + normalizeTimingMs(value);
        });
    });

    timing.executor_unaccounted_ms = Math.max(0, normalizeTimingMs(timing.executor_ms) - (
        normalizeTimingMs(timing.preflight_ms)
        + normalizeTimingMs(timing.upstream_ms)
        + normalizeTimingMs(timing.postprocess_ms)
    ));

    const sortedOutputImages = [...outputImagesByIndex.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([, image]) => image)
        .slice(0, requestedCount);
    const sortedDeferredOriginalUploads = [...deferredOriginalUploadsByIndex.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([, upload]) => upload)
        .slice(0, requestedCount);
    const deliveredCount = Math.min(sortedOutputImages.length, requestedCount);
    const executor = executorNames.size === 1
        ? `${[...executorNames][0]}-batch`
        : 'gemini-native-images-batch';
    const firstMetadata = safeObject(executions[0]?.metadata);

    return {
        status: 'succeeded',
        resultPrompt: resultPrompt || normalizeText(task.prompt, 8000),
        images: sortedOutputImages,
        deferredOriginalUploads: sortedDeferredOriginalUploads,
        tokenUsage: normalizeTokenUsage(tokenUsage),
        providerTaskId: [...new Set(providerTaskIds)].join(','),
        metadata: {
            timing,
            ...timing,
            executor,
            provider: 'gemini-native',
            provider_model: firstMetadata.provider_model || config.model || task.model || '',
            provider_source: firstMetadata.provider_source || config.source || '',
            provider_size: firstMetadata.provider_size || '',
            requested_image_count: requestedCount,
            delivered_image_count: deliveredCount,
            provider_attempt_count: attemptedCount,
            partial_error: partialError,
            batched_requests: attemptedCount,
            batch_delivery_complete: deliveredCount >= requestedCount
        }
    };
}

async function executeGeminiNativeImageGenerationMulti(task = {}, options = {}) {
    const requestedCount = normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
    const env = options.env || process.env;
    const retryRounds = normalizePositiveInt(readFirstEnv(env, ['AI_IMAGE_MULTI_IMAGE_SLOT_RETRY_ATTEMPTS'], '1'), 1, { min: 0, max: 3 });
    const runSlot = (resultIndexOffset) => (
        executeGeminiNativeImageGeneration(task, {
            ...options,
            geminiBatch: {
                requestedCount,
                resultIndexOffset,
                maxImages: 1
            }
        })
    );
    const executions = [];
    const failures = [];
    const successfulIndexes = new Set();
    let attemptedCount = 0;
    const collectSettled = (settled = []) => {
        attemptedCount += settled.length;
        settled.forEach((item) => {
            if (item.status === 'fulfilled' && Array.isArray(item.value?.images) && item.value.images.length) {
                executions.push(item.value);
                item.value.images.forEach((image) => {
                    const resultIndex = Number(image?.result_index ?? image?.resultIndex);
                    if (Number.isFinite(resultIndex)) successfulIndexes.add(resultIndex);
                });
                return;
            }
            failures.push(item);
        });
    };
    const getMissingIndexes = () => Array.from({ length: requestedCount }, (_, index) => index)
        .filter((index) => !successfulIndexes.has(index));

    collectSettled(await Promise.allSettled(Array.from({ length: requestedCount }, (_, resultIndexOffset) => runSlot(resultIndexOffset))));

    for (let round = 0; round < retryRounds; round += 1) {
        const missingIndexes = getMissingIndexes();
        if (!missingIndexes.length) break;
        // eslint-disable-next-line no-await-in-loop
        collectSettled(await Promise.allSettled(missingIndexes.map((resultIndexOffset) => runSlot(resultIndexOffset))));
    }
    const failed = failures.find((item) => item.status === 'rejected')
        || failures.find((item) => item.status === 'fulfilled' && (!Array.isArray(item.value?.images) || !item.value.images.length));

    if (!executions.length) {
        if (failed?.status === 'rejected') throw failed.reason;
        const error = new Error('Gemini 图片模型返回为空');
        error.statusCode = 502;
        error.code = 'ai_image_empty_result';
        throw error;
    }

    const partialError = successfulIndexes.size < requestedCount
        ? {
            code: normalizeText(failed?.reason?.code || 'ai_image_gemini_partial_generation_failed', 120),
            message: normalizeText(failed?.reason?.message || 'Gemini 部分图片补发失败', 500)
        }
        : null;

    return aggregateGeminiNativeImageExecutions({
        task,
        config: options.runtimeConfig || {},
        executions,
        requestedCount,
        attemptedCount,
        partialError
    });
}

async function executeGeminiNativeImageGeneration(task = {}, {
    supabase,
    env = process.env,
    fetchImpl = globalThis.fetch,
    uploadImageBuffer = uploadGeneratedImageBufferPreviewFirst,
    runtimeConfig,
    onImageResult,
    onDiagnostic,
    signal = null,
    geminiBatch = null
} = {}) {
    const requestedCount = normalizePositiveInt(task.quantity, 1, { min: 1, max: 8 });
    if (!geminiBatch && requestedCount > 1) {
        return executeGeminiNativeImageGenerationMulti(task, {
            supabase,
            env,
            fetchImpl,
            uploadImageBuffer,
            runtimeConfig,
            onImageResult,
            onDiagnostic,
            signal
        });
    }

    if (task.billing_mode === 'api' && !runtimeConfig) {
        const error = new Error('API 模式需要使用用户 Key 的即时执行通道，当前后台队列不会读取或保存明文 Key');
        error.statusCode = 409;
        error.code = 'ai_image_api_mode_requires_transient_key';
        throw error;
    }

    if (!IMAGE_GENERATION_MODES.has(String(task.mode || '').trim())) {
        const error = new Error('该 Gemini 图片任务模式尚未接入真实模型执行器');
        error.statusCode = 409;
        error.code = 'ai_image_mode_not_supported';
        throw error;
    }

    if (typeof fetchImpl !== 'function') {
        const error = new Error('Fetch runtime is unavailable');
        error.statusCode = 503;
        error.code = 'ai_image_fetch_unavailable';
        throw error;
    }

    const preflightStart = nowMs();
    const config = await resolveExecutorRuntimeConfig({
        supabase,
        task,
        env,
        runtimeConfig
    });
    const configResolveMs = elapsedMs(preflightStart);
    if (!config.configured) {
        const error = new Error('Gemini 图片模型 API Key 或 Base URL 未配置');
        error.statusCode = 503;
        error.code = 'ai_image_model_not_configured';
        throw error;
    }

    const size = resolveOpenAiImageSize({
        ratio: task.ratio || '1:1',
        resolution: task.resolution || '1k'
    });
    const isImageEdit = String(task.mode || '').trim() === 'image';
    let referenceImages = [];
    let referenceFetchMs = 0;
    if (isImageEdit) {
        const referenceFetchStart = nowMs();
        const referenceImageUrls = getTaskReferenceImageUrls(task);
        referenceImages = await fetchReferenceImagesForEdit(referenceImageUrls, {
            env,
            fetchImpl
        });
        referenceFetchMs = elapsedMs(referenceFetchStart);
        task.metadata = {
            ...(task.metadata || {}),
            reference_image_count: referenceImages.length
        };
    }
    const preflightMs = elapsedMs(preflightStart);
    const timing = {};
    const upstreamStartedAt = nowMs();
    const preferStream = String(env.AI_IMAGE_GEMINI_STREAM || '').trim().toLowerCase() !== 'false';
    const forceUrlBridge = isEnabledFlag(env.AI_IMAGE_GEMINI_URL_BRIDGE);
    const requestedUrlBridge = shouldUseGeminiImageUrlBridge(env, config);
    const urlBridgeSkippedByCache = requestedUrlBridge && !forceUrlBridge && isGeminiImageUrlBridgeMarkedUnavailable(config, upstreamStartedAt);
    const preferUrlBridge = requestedUrlBridge && !urlBridgeSkippedByCache;
    const upstreamUrl = preferStream
        ? buildGeminiNativeStreamGenerateContentUrl(config)
        : buildGeminiNativeGenerateContentUrl(config);
    const upstreamUrlSummary = summarizeProviderUrl(upstreamUrl);
    const requestBody = buildGeminiNativeImageRequestBody(task, { referenceImages });
    const requestImageConfig = requestBody?.generationConfig?.responseFormat?.image || {};
    const requestParts = Array.isArray(requestBody?.contents?.[0]?.parts) ? requestBody.contents[0].parts : [];
    emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_request_start', {
        taskId: task.id || '',
        provider: 'gemini-native',
        providerModel: config.model,
        providerSource: config.source,
        host: upstreamUrlSummary.host,
        pathname: upstreamUrlSummary.pathname,
        stream: preferStream,
        urlBridge: preferUrlBridge,
        urlBridgeSkippedByCache,
        mode: task.mode || '',
        resolution: task.resolution || '',
        ratio: task.ratio || '',
        requestAspectRatio: requestImageConfig.aspectRatio || '',
        requestImageSize: requestImageConfig.imageSize || '',
        requestHasImageConfig: Boolean(requestImageConfig.aspectRatio || requestImageConfig.imageSize),
        referenceImageCount: referenceImages.length,
        requestInlineImageCount: requestParts.filter((part) => part?.inlineData || part?.inline_data).length,
        referenceFetchMs
    });
    let response;
    try {
        response = await fetchProviderResponse(fetchImpl, upstreamUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                ...(preferUrlBridge ? { [GEMINI_IMAGE_URL_BRIDGE_HEADER]: '1' } : {})
            },
            body: JSON.stringify(requestBody),
            ...(signal ? { signal } : {})
        }, {
            env,
            label: 'Gemini 图片生成上游'
        });
    } catch (error) {
        const upstreamRequestMs = elapsedMs(upstreamStartedAt);
        error.metadata = {
            ...(error.metadata || {}),
            executor: 'gemini-native-images',
            provider: 'gemini-native',
            provider_model: config.model,
            provider_source: config.source,
            upstream_host: upstreamUrlSummary.host,
            upstream_pathname: upstreamUrlSummary.pathname,
            timing: {
                ...((error.metadata && typeof error.metadata === 'object' && !Array.isArray(error.metadata)) ? (error.metadata.timing || {}) : {}),
                preflight_ms: preflightMs,
                config_resolve_ms: configResolveMs,
                reference_fetch_ms: referenceFetchMs,
                upstream_request_ms: upstreamRequestMs
            }
        };
        emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_request_failed', {
            taskId: task.id || '',
            provider: 'gemini-native',
            providerModel: config.model,
            providerSource: config.source,
            host: upstreamUrlSummary.host,
            pathname: upstreamUrlSummary.pathname,
            elapsedMs: upstreamRequestMs,
            code: normalizeText(error.code || 'ai_image_gemini_native_request_failed', 120),
            message: normalizeText(error.message || error, 500)
        });
        throw error;
    }
    const upstreamRequestMs = elapsedMs(upstreamStartedAt);
    emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_response_headers', {
        taskId: task.id || '',
        provider: 'gemini-native',
        providerModel: config.model,
        providerSource: config.source,
        host: upstreamUrlSummary.host,
        pathname: upstreamUrlSummary.pathname,
        stream: preferStream,
        urlBridge: preferUrlBridge,
        referenceImageCount: referenceImages.length,
        status: response.status,
        ok: response.ok === true,
        elapsedMs: upstreamRequestMs
    });
    if (preferStream && response.ok && !isGeminiImageUrlBridgeJsonResponse(response)) {
        emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_stream_start', {
            taskId: task.id || '',
            provider: 'gemini-native',
            providerModel: config.model,
            providerSource: config.source,
            host: upstreamUrlSummary.host,
            pathname: upstreamUrlSummary.pathname,
            status: response.status,
            elapsedMs: upstreamRequestMs
        });
        let streamResult;
        try {
            streamResult = await readGeminiNativeSseUntilImages(response, {
                env,
                signal,
                onDiagnostic,
                diagnosticBase: {
                    taskId: task.id || '',
                    provider: 'gemini-native',
                    providerModel: config.model,
                    providerSource: config.source,
                    host: upstreamUrlSummary.host,
                    pathname: upstreamUrlSummary.pathname,
                    status: response.status
                },
                timing
            });
        } catch (error) {
            const streamResponseMs = Number(timing.response_text_ms_timeout_ms || timing.response_body_ms || 0) || elapsedMs(upstreamStartedAt) - upstreamRequestMs;
            error.metadata = {
                ...(error.metadata || {}),
                executor: 'gemini-native-images-stream',
                provider: 'gemini-native',
                provider_model: config.model,
                provider_source: config.source,
                upstream_host: upstreamUrlSummary.host,
                upstream_pathname: upstreamUrlSummary.pathname,
                timing: {
                    ...((error.metadata && typeof error.metadata === 'object' && !Array.isArray(error.metadata)) ? (error.metadata.timing || {}) : {}),
                    preflight_ms: preflightMs,
                    config_resolve_ms: configResolveMs,
                    reference_fetch_ms: referenceFetchMs,
                    upstream_request_ms: upstreamRequestMs,
                    upstream_response_ms: Math.max(0, streamResponseMs),
                    upstream_ms: upstreamRequestMs + Math.max(0, streamResponseMs)
                }
            };
            emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_stream_failed', {
                taskId: task.id || '',
                provider: 'gemini-native',
                providerModel: config.model,
                providerSource: config.source,
                host: upstreamUrlSummary.host,
                pathname: upstreamUrlSummary.pathname,
                status: response.status,
                elapsedMs: elapsedMs(upstreamStartedAt),
                code: normalizeText(error.code || 'ai_image_gemini_native_stream_failed', 120),
                message: normalizeText(error.message || error, 500)
            });
            throw error;
        }
        const streamImages = Array.isArray(streamResult?.images) ? streamResult.images : [];
        if (streamImages.length) {
            const upstreamResponseMs = Number(timing.response_body_ms || timing.response_text_ms || 0) || Math.max(0, elapsedMs(upstreamStartedAt) - upstreamRequestMs);
            const upstreamMs = upstreamRequestMs + upstreamResponseMs;
            emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_stream_image_ready', {
                taskId: task.id || '',
                provider: 'gemini-native',
                providerModel: config.model,
                providerSource: config.source,
                host: upstreamUrlSummary.host,
                pathname: upstreamUrlSummary.pathname,
                status: response.status,
                elapsedMs: upstreamMs,
                imageCount: streamImages.length
            });
            return finalizeGeminiNativeImages({
                task,
                config,
                data: streamImages,
                payload: {},
                size,
                env,
                fetchImpl,
                uploadImageBuffer,
                onImageResult,
                preflightMs,
                configResolveMs,
                referenceFetchMs,
                referenceImageCount: referenceImages.length,
                upstreamMs,
                upstreamRequestMs,
                upstreamResponseMs,
                upstreamResponseTextMs: Number(timing.response_text_ms || 0) || upstreamResponseMs,
                upstreamResponseParseMs: Number(timing.response_parse_ms || 0) || 0,
                stream: true,
                requestedCountOverride: geminiBatch?.requestedCount,
                resultIndexOffset: geminiBatch?.resultIndexOffset || 0,
                maxImages: geminiBatch?.maxImages || null
            });
        }
        emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_stream_no_image_fallback', {
            taskId: task.id || '',
            provider: 'gemini-native',
            providerModel: config.model,
            providerSource: config.source,
            host: upstreamUrlSummary.host,
            pathname: upstreamUrlSummary.pathname,
            status: response.status,
            elapsedMs: elapsedMs(upstreamStartedAt)
        });
        // Fall through to non-streaming only when the stream ended cleanly without an image.
        return executeGeminiNativeImageGeneration(task, {
            supabase,
            env: {
                ...env,
                AI_IMAGE_GEMINI_STREAM: 'false'
            },
            fetchImpl,
            uploadImageBuffer,
            runtimeConfig: config,
            onImageResult,
            onDiagnostic,
            signal,
            geminiBatch
        });
    }
    emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_response_body_start', {
        taskId: task.id || '',
        provider: 'gemini-native',
        providerModel: config.model,
        providerSource: config.source,
        host: upstreamUrlSummary.host,
        pathname: upstreamUrlSummary.pathname,
        status: response.status,
        elapsedMs: upstreamRequestMs
    });
    let payload;
    try {
        payload = await readUpstreamPayload(response, timing, {
            env,
            signal,
            label: 'Gemini 图片生成上游响应体'
        });
    } catch (error) {
        const upstreamResponseMs = Number(timing.response_text_ms_timeout_ms || timing.response_text_ms || 0) || elapsedMs(upstreamStartedAt) - upstreamRequestMs;
        error.metadata = {
            ...(error.metadata || {}),
            executor: 'gemini-native-images',
            provider: 'gemini-native',
            provider_model: config.model,
            provider_source: config.source,
            upstream_host: upstreamUrlSummary.host,
            upstream_pathname: upstreamUrlSummary.pathname,
            timing: {
                ...((error.metadata && typeof error.metadata === 'object' && !Array.isArray(error.metadata)) ? (error.metadata.timing || {}) : {}),
                preflight_ms: preflightMs,
                config_resolve_ms: configResolveMs,
                reference_fetch_ms: referenceFetchMs,
                upstream_request_ms: upstreamRequestMs,
                upstream_response_ms: Math.max(0, upstreamResponseMs),
                upstream_ms: upstreamRequestMs + Math.max(0, upstreamResponseMs)
            }
        };
        emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_response_body_failed', {
            taskId: task.id || '',
            provider: 'gemini-native',
            providerModel: config.model,
            providerSource: config.source,
            host: upstreamUrlSummary.host,
            pathname: upstreamUrlSummary.pathname,
            status: response.status,
            elapsedMs: elapsedMs(upstreamStartedAt),
            code: normalizeText(error.code || 'ai_image_gemini_native_response_body_failed', 120),
            message: normalizeText(error.message || error, 500)
        });
        throw error;
    }
    const upstreamResponseMs = Number(timing.response_body_ms || 0) || 0;
    const upstreamResponseTextMs = Number(timing.response_text_ms || 0) || 0;
    const upstreamResponseParseMs = Number(timing.response_parse_ms || 0) || 0;
    const upstreamMs = upstreamRequestMs + upstreamResponseMs;
    const bridgeFallback = isGeminiImageUrlBridgeFallbackPayload(payload);
    const urlBridgePayload = bridgeFallback
        || normalizeText(payload?.object, 120) === 'gemini.image_url_bridge'
        || Boolean(getResponseHeader(response, GEMINI_IMAGE_URL_BRIDGE_HEADER));
    emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_response_body_complete', {
        taskId: task.id || '',
        provider: 'gemini-native',
        providerModel: config.model,
        providerSource: config.source,
        host: upstreamUrlSummary.host,
        pathname: upstreamUrlSummary.pathname,
        status: response.status,
        elapsedMs: upstreamMs,
        responseBodyMs: upstreamResponseMs,
        candidateCount: Array.isArray(payload?.candidates) ? payload.candidates.length : 0,
        dataCount: Array.isArray(payload?.data) ? payload.data.length : 0,
        urlBridge: urlBridgePayload,
        bridgeFallback
    });

    if (!response.ok) {
        if (preferUrlBridge && isGeminiImageUrlBridgeStorageNotConfigured(response, payload)) {
            markGeminiImageUrlBridgeUnavailable(config, env);
            emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_url_bridge_unavailable_fallback', {
                taskId: task.id || '',
                provider: 'gemini-native',
                providerModel: config.model,
                providerSource: config.source,
                host: upstreamUrlSummary.host,
                pathname: upstreamUrlSummary.pathname,
                status: response.status,
                elapsedMs: upstreamMs
            });
            return executeGeminiNativeImageGeneration(task, {
                supabase,
                env: {
                    ...env,
                    AI_IMAGE_GEMINI_URL_BRIDGE: 'false'
                },
                fetchImpl,
                uploadImageBuffer,
                runtimeConfig: config,
                onImageResult,
                onDiagnostic,
                signal,
                geminiBatch
            });
        }
        emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_response_error', {
            taskId: task.id || '',
            provider: 'gemini-native',
            providerModel: config.model,
            providerSource: config.source,
            host: upstreamUrlSummary.host,
            pathname: upstreamUrlSummary.pathname,
            status: response.status,
            elapsedMs: upstreamMs,
            code: normalizeText(payload?.error?.code || payload?.code || 'ai_image_gemini_native_upstream_error', 120),
            message: normalizeText(payload?.error?.message || payload?.message || '', 500)
        });
        throw buildUpstreamError(response, payload);
    }

    const bridgeData = urlBridgePayload ? extractProviderImageData(payload) : [];
    const data = bridgeData.length ? bridgeData : extractGeminiNativeGeneratedImages(payload);
    if (!data.length) {
        const error = new Error('Gemini 图片模型返回为空');
        error.statusCode = 502;
        error.code = 'ai_image_empty_result';
        error.metadata = {
            timing: {
                preflight_ms: preflightMs,
                config_resolve_ms: configResolveMs,
                reference_fetch_ms: referenceFetchMs,
                upstream_ms: upstreamMs,
                upstream_request_ms: upstreamRequestMs,
                upstream_response_ms: upstreamResponseMs,
                upstream_response_text_ms: upstreamResponseTextMs,
                upstream_response_parse_ms: upstreamResponseParseMs
            },
            executor: 'gemini-native-images',
            provider: 'gemini-native',
            provider_model: config.model,
            provider_source: config.source,
            requested_image_count: requestedCount,
            delivered_image_count: 0,
            url_bridge: urlBridgePayload,
            bridge_fallback_used: bridgeFallback
        };
        emitExecutorDiagnostic(onDiagnostic, 'ai_image_gemini_native_empty_result', {
            taskId: task.id || '',
            provider: 'gemini-native',
            providerModel: config.model,
            providerSource: config.source,
            host: upstreamUrlSummary.host,
            pathname: upstreamUrlSummary.pathname,
            status: response.status,
            elapsedMs: upstreamMs,
            candidateCount: Array.isArray(payload?.candidates) ? payload.candidates.length : 0,
            dataCount: Array.isArray(payload?.data) ? payload.data.length : 0,
            urlBridge: urlBridgePayload,
            bridgeFallback
        });
        throw error;
    }

    return finalizeGeminiNativeImages({
        task,
        config,
        data,
        payload,
        size,
        env,
        fetchImpl,
        uploadImageBuffer,
        onImageResult,
        preflightMs,
        configResolveMs,
        referenceFetchMs,
        referenceImageCount: referenceImages.length,
        upstreamMs,
        upstreamRequestMs,
        upstreamResponseMs,
        upstreamResponseTextMs,
        upstreamResponseParseMs,
        stream: false,
        urlBridge: urlBridgePayload,
        bridgeFallback,
        requestedCountOverride: geminiBatch?.requestedCount,
        resultIndexOffset: geminiBatch?.resultIndexOffset || 0,
        maxImages: geminiBatch?.maxImages || null
    });
}

async function executeOpenAiCompatibleTextVision(task = {}, {
    supabase,
    env = process.env,
    fetchImpl = globalThis.fetch,
    runtimeConfig,
    signal = null
} = {}) {
    if (task.billing_mode === 'api' && !runtimeConfig) {
        const error = new Error('API 模式需要使用用户 Key 的即时执行通道，当前后台队列不会读取或保存明文 Key');
        error.statusCode = 409;
        error.code = 'ai_image_api_mode_requires_transient_key';
        throw error;
    }

    if (!TEXT_VISION_MODES.has(String(task.mode || '').trim())) {
        const error = new Error('该 AI 图片任务模式尚未接入文本/视觉执行器');
        error.statusCode = 409;
        error.code = 'ai_image_mode_not_supported';
        throw error;
    }

    if (task.mode === 'reverse' && !task.reference_image_url) {
        const error = new Error('反推提示词需要可访问的参考图片 URL');
        error.statusCode = 400;
        error.code = 'reference_image_required';
        throw error;
    }

    if (typeof fetchImpl !== 'function') {
        const error = new Error('Fetch runtime is unavailable');
        error.statusCode = 503;
        error.code = 'ai_image_fetch_unavailable';
        throw error;
    }

    const preflightStart = nowMs();
    const config = await resolveExecutorRuntimeConfig({
        supabase,
        task,
        env,
        runtimeConfig
    });
    const configResolveMs = elapsedMs(preflightStart);
    if (!config.configured) {
        const error = new Error('AI 图片文本/视觉模型 API Key 或 Base URL 未配置');
        error.statusCode = 503;
        error.code = 'ai_image_model_not_configured';
        throw error;
    }

    if (
        task.mode === 'reverse'
        && config.visionModels.length
        && !config.visionModels.some((model) => model.toLowerCase() === config.model.toLowerCase())
    ) {
        const error = new Error(`模型 ${config.model} 未配置视觉输入能力，请选择支持图片的模型`);
        error.statusCode = 409;
        error.code = 'ai_image_model_vision_not_supported';
        throw error;
    }

    let reverseReferenceImage = null;
    let referenceFetchMs = 0;
    if (task.mode === 'reverse') {
        const referenceFetchStartedAt = nowMs();
        reverseReferenceImage = await fetchReverseReferenceImage(task.reference_image_url, {
            env,
            fetchImpl,
            signal
        });
        referenceFetchMs = elapsedMs(referenceFetchStartedAt);
    }

    const maxTokens = task.mode === 'reverse'
        ? normalizePositiveInt(env.AI_IMAGE_CHAT_MAX_TOKENS, DEFAULT_REVERSE_MAX_TOKENS, {
            min: 64,
            max: 16000
        })
        : normalizePositiveInt(env.AI_IMAGE_CHAT_MAX_TOKENS, 0, {
            min: 64,
            max: 64000
        });
    const requestBody = {
        model: config.model,
        messages: buildOpenAiChatMessages(task, {
            referenceImageUrl: reverseReferenceImage?.dataUrl || ''
        }),
        stream: false
    };
    if (maxTokens > 0) {
        requestBody.max_tokens = maxTokens;
    }
    const preflightMs = elapsedMs(preflightStart);

    const sub2ApiClientRequestId = isSub2ApiGatewayBaseUrl(config.baseUrl)
        ? buildSub2ApiClientRequestId(task)
        : '';
    const sub2ApiClientRequestHeaders = sub2ApiClientRequestId
        ? { 'X-Client-Request-ID': sub2ApiClientRequestId }
        : {};
    const timing = {};
    const upstreamStartedAt = nowMs();
    const response = await fetchProviderResponse(fetchImpl, `${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            ...sub2ApiClientRequestHeaders
        },
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {})
    }, {
        env,
        label: 'AI 图片文本/视觉上游'
    });
    const upstreamRequestMs = elapsedMs(upstreamStartedAt);
    const payload = await readUpstreamPayload(response, timing, { env, signal });
    const upstreamResponseMs = Number(timing.response_body_ms || 0) || 0;
    const upstreamResponseTextMs = Number(timing.response_text_ms || 0) || 0;
    const upstreamResponseParseMs = Number(timing.response_parse_ms || 0) || 0;
    const upstreamMs = upstreamRequestMs + upstreamResponseMs;

    if (!response.ok) {
        throw buildUpstreamError(response, payload);
    }

    const text = extractChatCompletionText(payload);
    if (!text) {
        const error = new Error('AI 图片文本/视觉模型返回为空');
        error.statusCode = 502;
        error.code = 'ai_image_empty_text_result';
        throw error;
    }

    const tokenUsage = shouldCaptureTaskSub2ApiBilling(task)
        ? await resolveTokenUsageWithSub2ApiBilling({
            usage: payload.usage,
            payload: {
                ...payload,
                client_request_id: sub2ApiClientRequestId,
                clientRequestId: sub2ApiClientRequestId
            },
            response,
            config,
            fetchImpl,
            env,
            signal
        })
        : normalizeTokenUsage(payload.usage || {});

    return {
        status: 'succeeded',
        resultPrompt: text,
        images: [],
        tokenUsage,
        providerTaskId: normalizeText(payload.id || payload.task_id || payload.provider_task_id, 240),
        metadata: {
            executor: 'openai-compatible-chat',
            provider: 'openai-compatible',
            provider_model: config.model,
            provider_source: config.source,
            request_type: task.mode,
            preflight_ms: preflightMs,
            config_resolve_ms: configResolveMs,
            reference_fetch_ms: referenceFetchMs,
            reference_image_bytes: reverseReferenceImage?.bytes || 0,
            reference_image_mime_type: reverseReferenceImage?.mimeType || '',
            reference_image_transport: reverseReferenceImage ? 'data_uri' : '',
            upstream_ms: upstreamMs,
            upstream_request_ms: upstreamRequestMs,
            upstream_response_ms: upstreamResponseMs,
            upstream_response_body_ms: upstreamResponseMs,
            upstream_response_text_ms: upstreamResponseTextMs,
            upstream_response_parse_ms: upstreamResponseParseMs,
            sub2api_client_request_id: sub2ApiClientRequestId,
            timing: {
                preflight_ms: preflightMs,
                config_resolve_ms: configResolveMs,
                reference_fetch_ms: referenceFetchMs,
                upstream_ms: upstreamMs,
                upstream_request_ms: upstreamRequestMs,
                upstream_response_ms: upstreamResponseMs,
                upstream_response_body_ms: upstreamResponseMs,
                upstream_response_text_ms: upstreamResponseTextMs,
                upstream_response_parse_ms: upstreamResponseParseMs
            }
        }
    };
}

async function executeOpenAiCompatibleAiImageTask(task = {}, options = {}) {
    if (TEXT_VISION_MODES.has(String(task.mode || '').trim())) {
        return executeOpenAiCompatibleTextVision(task, options);
    }
    if (VIDEO_GENERATION_MODES.has(String(task.mode || '').trim())) {
        return executeOpenAiCompatibleVideoGeneration(task, options);
    }
    const config = await resolveExecutorRuntimeConfig({
        supabase: options.supabase,
        task,
        env: options.env || process.env,
        runtimeConfig: options.runtimeConfig
    });
    if (normalizeProviderProtocol(config.protocol) === 'gemini-native') {
        return executeGeminiNativeImageGeneration(task, {
            ...options,
            runtimeConfig: config
        });
    }
    return executeOpenAiCompatibleImageGeneration(task, options);
}

function createOpenAiCompatibleImageExecutor(options = {}) {
    return (task, runtimeOptions = {}) => executeOpenAiCompatibleAiImageTask(task, {
        ...options,
        ...runtimeOptions
    });
}

function createOpenAiCompatibleApiExecutor({
    apiKey = '',
    baseUrl = '',
    model = '',
    protocol = 'openai-compatible',
    source = 'user-api',
    ...options
} = {}) {
    return (task, runtimeOptions = {}) => executeOpenAiCompatibleAiImageTask(task, {
        ...options,
        ...runtimeOptions,
        runtimeConfig: {
            apiKey,
            baseUrl,
            model: model || task?.model || '',
            protocol,
            source
        }
    });
}

module.exports = {
    IMAGE_GENERATION_MODES,
    VIDEO_GENERATION_MODES,
    buildImagePrompt,
    buildGeminiNativeImageRequestBody,
    buildOpenAiChatMessages,
    createOpenAiCompatibleApiExecutor,
    createOpenAiCompatibleImageExecutor,
    executeOpenAiCompatibleAiImageTask,
    executeGeminiNativeImageGeneration,
    executeOpenAiCompatibleImageGeneration,
    executeOpenAiCompatibleTextVision,
    executeOpenAiCompatibleVideoGeneration,
    normalizeChatModel,
    normalizeImageModel,
    normalizeVideoModel,
    optimizeMp4ForStreaming,
    resolveAiImageRuntimeConfig,
    resolveExecutorRuntimeConfig,
    resolveOpenAiImageSize,
    resolveOpenAiVideoSize,
    resolveResponseBodyTimeoutMs,
    resolveR2Config,
    uploadGeneratedImageBufferPreviewFirst,
    uploadGeneratedImageBufferToR2
};
