const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    AI_IMAGE_SECRET_KEY,
    buildAiImageProviderSecretKey,
    deleteStoredAdminSecret,
    listStoredAiImageProviderSecrets,
    resolveAiImageRuntimeSecretConfig,
    upsertStoredAdminSecret
} = require('../../../../api/_lib/secrets');
const {
    redactSensitiveText,
    redactSensitiveValue
} = require('../_ai-shared');

const DEFAULT_MODEL_TEST_TIMEOUT_MS = 90000;
const MODEL_PROBE_RESOLUTIONS = Object.freeze(['1k', '2k', '4k']);
const MODEL_PROBE_REMOTE_IMAGE_URL = 'https://www.fatherkey.com/assets/prompts-home/____1_1.webp';
const MODEL_PROBE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAVElEQVR42u3PMQ0AMAgAMOTw4GraeTCBhF18TWqg0VWn8s2pEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD4WRCtuTyrF4HwAAAAAElFTkSuQmCC';
const MODEL_PROBE_DATA_IMAGE_URL = `data:image/png;base64,${MODEL_PROBE_PNG_BASE64}`;
const MODEL_PROBE_SIZE_BY_RESOLUTION = Object.freeze({
    '1k': '1024x1024',
    '2k': '2048x2048',
    '4k': '2880x2880'
});
const MODEL_GROUP_VALUES = Object.freeze(new Set(['image', 'chat', 'video', 'both']));
const PROVIDER_PROTOCOL_VALUES = Object.freeze(new Set(['openai-compatible', 'gemini-native', 'anthropic-native', 'custom']));
const PROVIDER_VENDOR_VALUES = Object.freeze(new Set(['openai', 'gemini', 'anthropic', 'flux', 'sub2api', 'custom']));
const VIDEO_MODEL_HINT_PATTERN = /(?:^|[-_/\s])(video|vid|veo|sora|kling|runway|wan|hailuo|luma|pika|jimeng|seedance|即梦)(?:[-_/\s]|$)|generate-?video/i;
const IMAGE_MODEL_HINT_PATTERN = /(?:^|[-_/\s])(image|img|imagen|nano-?banana|dall-?e|flux|kontext|imagine|stable|sdxl?|midjourney)(?:[-_/\s]|$)|gpt-image/i;
const CHAT_MODEL_HINT_PATTERN = /(?:^|[-_/\s])(gpt|o\d|chat|claude|gemini|qwen|deepseek|grok|llama|mistral|kimi|moonshot|doubao|ernie|glm|yi)(?:[-_/\s]|$)/i;

function normalizePositiveInt(value, fallback = 1, { min = 1, max = 60000 } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
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
        if (!/\/v\d+(?:alpha|beta)?(?:\/.*)?$/i.test(url.pathname)) {
            url.pathname = `${url.pathname}/v1`.replace(/\/{2,}/g, '/');
        }
        return url.toString().replace(/\/+$/, '');
    } catch (_) {
        return raw.replace(/\/+$/, '');
    }
}

function normalizeModel(value = '') {
    const model = String(value || '').trim();
    if (!model || model === 'gpt-image' || model === 'gpt-image-api') return 'gpt-image-2';
    return model.slice(0, 160);
}

function normalizeOptionalModel(value = '') {
    const model = String(value || '').trim();
    if (!model || model === 'gpt-image' || model === 'gpt-image-api') return '';
    return model.slice(0, 160);
}

function normalizeProviderId(value = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return normalized || 'default';
}

function normalizeProviderLabel(value = '', providerId = 'default') {
    return String(value || '').trim().slice(0, 120) || providerId;
}

function normalizeModelsList(value = '', fallbackModel = '') {
    const items = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\n]/);
    const models = [];
    const seen = new Set();
    for (const item of items) {
        const rawModel = String(item || '').trim();
        if (!rawModel) continue;
        const model = normalizeModel(rawModel);
        const key = model.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        models.push(model);
    }
    const fallback = String(fallbackModel || '').trim() ? normalizeModel(fallbackModel) : '';
    if (fallback && !seen.has(fallback.toLowerCase())) {
        models.unshift(fallback);
    }
    return models;
}

function normalizeModelDisplayNames(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const displayNames = {};
    Object.entries(value).forEach(([rawModel, rawDisplayName]) => {
        const model = normalizeOptionalModel(rawModel);
        const displayName = String(rawDisplayName || '').trim().slice(0, 120);
        if (!model || !displayName || displayName === model) return;
        displayNames[model] = displayName;
    });
    return displayNames;
}

function hasModelsListValue(...values) {
    return values.some((value) => {
        if (Array.isArray(value)) {
            return value.some((item) => String(item || '').trim());
        }
        return String(value || '').trim();
    });
}

function firstExplicitModelList(source = {}, keys = []) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return '';
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            return source[key];
        }
    }
    return '';
}

function hasExplicitProperty(source = {}, keys = []) {
    return Boolean(source && typeof source === 'object' && !Array.isArray(source) && keys.some((key) => Object.prototype.hasOwnProperty.call(source, key)));
}

function normalizeModelGroup(value = '', fallback = 'image') {
    const normalized = String(value || '').trim().toLowerCase();
    if (MODEL_GROUP_VALUES.has(normalized)) return normalized;
    return MODEL_GROUP_VALUES.has(fallback) ? fallback : 'image';
}

function hasExplicitModelGroup(value = '') {
    return MODEL_GROUP_VALUES.has(String(value || '').trim().toLowerCase());
}

function inferModelGroup(value = '', imageModels = [], chatModels = [], videoModels = [], fallback = 'image') {
    const normalized = normalizeModelGroup(value, fallback);
    const hasImageModels = normalizeModelsList(imageModels, '').length > 0;
    const hasChatModels = normalizeModelsList(chatModels, '').length > 0;
    const hasVideoModels = normalizeModelsList(videoModels, '').length > 0;
    if (hasVideoModels && !hasImageModels && !hasChatModels) return 'video';
    if (hasImageModels && hasChatModels) return 'both';
    if (hasChatModels && normalized === 'image') return 'chat';
    if (hasImageModels && normalized === 'chat') return 'image';
    if (hasVideoModels && normalized !== 'video') return 'video';
    return normalized;
}

function scopeModelsByModelGroup(modelGroup = 'image', imageModels = [], chatModels = [], videoModels = []) {
    const group = normalizeModelGroup(modelGroup, 'image');
    return {
        modelGroup: group,
        imageModels: group === 'chat' || group === 'video' ? [] : normalizeModelsList(imageModels, ''),
        chatModels: group === 'image' || group === 'video' ? [] : normalizeModelsList(chatModels, ''),
        videoModels: normalizeModelsList(videoModels, '')
    };
}

function normalizeProviderProtocol(value = '', fallback = 'openai-compatible') {
    const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    return PROVIDER_PROTOCOL_VALUES.has(normalized) ? normalized : fallback;
}

function normalizeProviderVendor(value = '', fallback = 'openai') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'other') return 'custom';
    const normalizedFallback = String(fallback || 'openai').trim().toLowerCase();
    const safeFallback = normalizedFallback === 'other' ? 'custom' : normalizedFallback;
    return PROVIDER_VENDOR_VALUES.has(normalized)
        ? normalized
        : (PROVIDER_VENDOR_VALUES.has(safeFallback) ? safeFallback : 'openai');
}

function normalizeProviderVendorLabel(value = '') {
    return String(value || '').trim().slice(0, 80);
}

function normalizeEndpointPath(value = '') {
    const raw = String(value || '').trim().slice(0, 500);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
    return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeEndpoints(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, endpoint]) => [String(key || '').trim(), normalizeEndpointPath(endpoint)])
            .filter(([key, endpoint]) => key && endpoint)
    );
}

function pickEndpointValue(source = {}, keys = [], fallback = '') {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return fallback;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            return source[key];
        }
    }
    return fallback;
}

function providerSupportsModelGroup(provider = {}, group = 'image') {
    const requested = normalizeModelGroup(group, 'image');
    const configured = normalizeModelGroup(provider.modelGroup || provider.model_group, 'image');
    return (requested !== 'video' && configured === 'both') || configured === requested;
}

function normalizeBoolean(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled', 'active'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled', 'inactive'].includes(normalized)) return false;
    return fallback;
}

function normalizeInteger(value, fallback = 0, { min = -9999, max = 9999 } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function isValidHttpUrl(value = '') {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function serializeProvider(provider = {}) {
    const providerId = normalizeProviderId(provider.providerId || provider.provider_id || provider.id);
    const model = normalizeOptionalModel(provider.model);
    const models = normalizeModelsList(provider.models, '');
    const chatModels = normalizeModelsList(provider.chatModels || provider.chat_models || provider.chatModelAliases || provider.chat_model_aliases, '');
    const videoModels = normalizeModelsList(provider.videoModels || provider.video_models || provider.videoModelAliases || provider.video_model_aliases, '');
    const rawModelGroup = provider.modelGroup || provider.model_group;
    const configuredModelGroup = normalizeModelGroup(rawModelGroup, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
    const hasExplicitImageModels = hasModelsListValue(
        provider.imageModels,
        provider.image_models,
        provider.imageModelAliases,
        provider.image_model_aliases
    );
    const imageModels = configuredModelGroup === 'chat' && !hasExplicitImageModels
        ? []
        : normalizeModelsList(firstExplicitModelList(provider, ['imageModels', 'image_models', 'imageModelAliases', 'image_model_aliases', 'models']), '');
    const modelGroup = hasExplicitModelGroup(rawModelGroup)
        ? configuredModelGroup
        : inferModelGroup(configuredModelGroup, imageModels, chatModels, videoModels, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
    const scopedModels = scopeModelsByModelGroup(modelGroup, imageModels, chatModels, videoModels);
    const asyncResult = provider.asyncResult || provider.async_result || provider.polling || null;
    const videoEndpoint = normalizeEndpointPath(provider.videoEndpoint || provider.video_endpoint || provider.videoGenerationEndpoint || provider.video_generation_endpoint);
    const endpoints = normalizeEndpoints(provider.endpoints);
    const rawVendor = provider.vendor || provider.provider;
    const vendor = normalizeProviderVendor(rawVendor, 'openai');
    const vendorLabel = normalizeProviderVendorLabel(
        provider.vendorLabel || provider.vendor_label || provider.vendorName || provider.vendor_name
        || (String(rawVendor || '').trim().toLowerCase() === 'sub2api' ? 'Sub2API' : '')
    );
    const modelDisplayNames = normalizeModelDisplayNames(
        provider.modelDisplayNames ?? provider.model_display_names ?? {}
    );
    const serialized = {
        providerId,
        provider_id: providerId,
        label: normalizeProviderLabel(provider.label, providerId),
        configured: Boolean(provider.configured),
        source: provider.source || 'missing',
        model,
        models: scopedModels.imageModels,
        imageModels: scopedModels.imageModels,
        image_models: scopedModels.imageModels,
        chatModels: scopedModels.chatModels,
        chat_models: scopedModels.chatModels,
        videoModels: scopedModels.videoModels,
        video_models: scopedModels.videoModels,
        modelDisplayNames,
        model_display_names: modelDisplayNames,
        detectedImageModels: normalizeModelsList(
            hasExplicitProperty(provider, ['detectedImageModels', 'detected_image_models', 'discoveredImageModels', 'discovered_image_models'])
                ? firstExplicitModelList(provider, ['detectedImageModels', 'detected_image_models', 'discoveredImageModels', 'discovered_image_models'])
                : scopedModels.imageModels,
            ''
        ),
        detected_image_models: normalizeModelsList(
            hasExplicitProperty(provider, ['detectedImageModels', 'detected_image_models', 'discoveredImageModels', 'discovered_image_models'])
                ? firstExplicitModelList(provider, ['detectedImageModels', 'detected_image_models', 'discoveredImageModels', 'discovered_image_models'])
                : scopedModels.imageModels,
            ''
        ),
        detectedChatModels: normalizeModelsList(
            hasExplicitProperty(provider, ['detectedChatModels', 'detected_chat_models', 'discoveredChatModels', 'discovered_chat_models'])
                ? firstExplicitModelList(provider, ['detectedChatModels', 'detected_chat_models', 'discoveredChatModels', 'discovered_chat_models'])
                : scopedModels.chatModels,
            ''
        ),
        detected_chat_models: normalizeModelsList(
            hasExplicitProperty(provider, ['detectedChatModels', 'detected_chat_models', 'discoveredChatModels', 'discovered_chat_models'])
                ? firstExplicitModelList(provider, ['detectedChatModels', 'detected_chat_models', 'discoveredChatModels', 'discovered_chat_models'])
                : scopedModels.chatModels,
            ''
        ),
        detectedVideoModels: normalizeModelsList(
            hasExplicitProperty(provider, ['detectedVideoModels', 'detected_video_models', 'discoveredVideoModels', 'discovered_video_models'])
                ? firstExplicitModelList(provider, ['detectedVideoModels', 'detected_video_models', 'discoveredVideoModels', 'discovered_video_models'])
                : scopedModels.videoModels,
            ''
        ),
        detected_video_models: normalizeModelsList(
            hasExplicitProperty(provider, ['detectedVideoModels', 'detected_video_models', 'discoveredVideoModels', 'discovered_video_models'])
                ? firstExplicitModelList(provider, ['detectedVideoModels', 'detected_video_models', 'discoveredVideoModels', 'discovered_video_models'])
                : scopedModels.videoModels,
            ''
        ),
        detectedUnknownModels: normalizeModelsList(provider.detectedUnknownModels || provider.detected_unknown_models || provider.discoveredUnknownModels || provider.discovered_unknown_models || provider.unknownModels || provider.unknown_models, ''),
        detected_unknown_models: normalizeModelsList(provider.detectedUnknownModels || provider.detected_unknown_models || provider.discoveredUnknownModels || provider.discovered_unknown_models || provider.unknownModels || provider.unknown_models, ''),
        visionModels: normalizeModelsList(provider.visionModels || provider.vision_models || provider.chatVisionModels || provider.chat_vision_models, ''),
        vision_models: normalizeModelsList(provider.visionModels || provider.vision_models || provider.chatVisionModels || provider.chat_vision_models, ''),
        modelGroup: scopedModels.modelGroup,
        model_group: scopedModels.modelGroup,
        vendor,
        protocol: normalizeProviderProtocol(provider.protocol || provider.adapter),
        provider: String(provider.provider || 'openai-compatible').trim().slice(0, 80) || 'openai-compatible',
        baseUrl: normalizeBaseUrl(provider.baseUrl || provider.base_url),
        isActive: provider.isActive !== false,
        is_active: provider.isActive !== false,
        displayOrder: normalizeInteger(provider.displayOrder ?? provider.display_order, 0),
        display_order: normalizeInteger(provider.displayOrder ?? provider.display_order, 0),
        updatedAt: provider.updatedAt || provider.updated_at || null,
        decryptErrorMessage: provider.decryptErrorMessage || ''
    };
    if (asyncResult) {
        serialized.asyncResult = asyncResult;
        serialized.async_result = asyncResult;
    }
    if (vendorLabel) {
        serialized.vendorLabel = vendorLabel;
        serialized.vendor_label = vendorLabel;
    }
    if (videoEndpoint) {
        serialized.videoEndpoint = videoEndpoint;
        serialized.video_endpoint = videoEndpoint;
    }
    if (Object.keys(endpoints).length) {
        serialized.endpoints = endpoints;
    }
    return serialized;
}

async function listProviders(supabase) {
    if (typeof listStoredAiImageProviderSecrets !== 'function') {
        return [];
    }
    const providers = await listStoredAiImageProviderSecrets(supabase, {
        allowDecryptFailure: true
    }).catch(() => []);
    return providers.map(serializeProvider);
}

function getProviderSecretKey(providerId = 'default') {
    if (providerId === 'default') return AI_IMAGE_SECRET_KEY;
    if (typeof buildAiImageProviderSecretKey === 'function') {
        return buildAiImageProviderSecretKey(providerId);
    }
    return `ai_image_provider__${normalizeProviderId(providerId)}`;
}

function serializeConfig(config = {}, providers = []) {
    const serializedProviders = providers.length ? providers : [];
    const primary = serializedProviders[0] || serializeProvider({
        ...config,
        providerId: config.providerId || 'default',
        label: config.label || '默认上游',
        isActive: true
    });
    return {
        success: true,
        configured: Boolean(config.configured),
        source: config.source || 'missing',
        providerId: primary.providerId,
        provider_id: primary.providerId,
        label: primary.label,
        model: normalizeModel(config.model || primary.model),
        models: primary.models || [],
        imageModels: primary.imageModels || primary.image_models || [],
        image_models: primary.imageModels || primary.image_models || [],
        chatModels: primary.chatModels || primary.chat_models || [],
        chat_models: primary.chatModels || primary.chat_models || [],
        videoModels: primary.videoModels || primary.video_models || [],
        video_models: primary.videoModels || primary.video_models || [],
        modelDisplayNames: primary.modelDisplayNames || primary.model_display_names || {},
        model_display_names: primary.modelDisplayNames || primary.model_display_names || {},
        detectedImageModels: primary.detectedImageModels || primary.detected_image_models || [],
        detected_image_models: primary.detectedImageModels || primary.detected_image_models || [],
        detectedChatModels: primary.detectedChatModels || primary.detected_chat_models || primary.chatModels || primary.chat_models || [],
        detected_chat_models: primary.detectedChatModels || primary.detected_chat_models || primary.chatModels || primary.chat_models || [],
        detectedVideoModels: primary.detectedVideoModels || primary.detected_video_models || primary.videoModels || primary.video_models || [],
        detected_video_models: primary.detectedVideoModels || primary.detected_video_models || primary.videoModels || primary.video_models || [],
        detectedUnknownModels: primary.detectedUnknownModels || primary.detected_unknown_models || [],
        detected_unknown_models: primary.detectedUnknownModels || primary.detected_unknown_models || [],
        visionModels: primary.visionModels || primary.vision_models || [],
        vision_models: primary.visionModels || primary.vision_models || [],
        modelGroup: primary.modelGroup || primary.model_group || 'image',
        model_group: primary.modelGroup || primary.model_group || 'image',
        vendor: primary.vendor || 'openai',
        ...(primary.vendorLabel || primary.vendor_label ? {
            vendorLabel: primary.vendorLabel || primary.vendor_label,
            vendor_label: primary.vendorLabel || primary.vendor_label
        } : {}),
        protocol: primary.protocol || 'openai-compatible',
        baseUrl: normalizeBaseUrl(config.baseUrl || primary.baseUrl),
        providers: serializedProviders,
        updatedAt: config.updatedAt || null,
        decryptErrorMessage: config.decryptErrorMessage || ''
    };
}

async function readUpstreamJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (_) {
        const contentType = readResponseHeader(response, ['content-type']).toLowerCase();
        const isHtml = contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text);
        return {
            message: isHtml
                ? `上游返回非 JSON 网关响应（HTTP ${response?.status || 502}）`
                : text.slice(0, 1000),
            nonJson: true,
            isHtml
        };
    }
}

function hasImageResult(payload = {}) {
    const first = Array.isArray(payload.data) ? payload.data[0] : null;
    return Boolean(first && (first.b64_json || first.url || first.image_url));
}

function getUpstreamErrorMessage(payload = {}, response) {
    if (payload?.isHtml) {
        return `上游返回非 JSON 网关错误（HTTP ${response?.status || 502}）`;
    }
    return String(
        payload?.error?.message
        || payload?.message
        || `上游返回 HTTP ${response?.status || 502}`
    ).slice(0, 1000);
}

function readResponseHeader(response, names = []) {
    if (!response?.headers || typeof response.headers.get !== 'function') return '';
    for (const name of names) {
        const value = String(response.headers.get(name) || '').trim();
        if (value) return value.slice(0, 240);
    }
    return '';
}

function getProbeResponseMeta(response) {
    return {
        statusCode: response?.status || 0,
        requestId: readResponseHeader(response, [
            'x-request-id',
            'x-upstream-request-id',
            'openai-request-id',
            'cf-ray'
        ]),
        channelId: readResponseHeader(response, [
            'x-sub2api-channel-id',
            'x-oneapi-channel-id',
            'x-channel-id',
            'x-upstream-channel-id'
        ]),
        channelName: readResponseHeader(response, [
            'x-sub2api-channel-name',
            'x-oneapi-channel-name',
            'x-channel-name',
            'x-upstream-channel-name'
        ]),
        upstreamProvider: readResponseHeader(response, [
            'x-upstream-provider',
            'x-provider',
            'x-sub2api-provider'
        ]),
        upstreamModel: readResponseHeader(response, [
            'x-upstream-model',
            'x-model',
            'x-sub2api-model'
        ])
    };
}

function normalizeDiscoveredModelId(value = '') {
    return String(value || '').trim().slice(0, 180);
}

function normalizeGeminiModelId(value = '') {
    return normalizeDiscoveredModelId(String(value || '').replace(/^models\//i, ''));
}

function normalizeDiscoveredModelEntry(entry = {}) {
    if (typeof entry === 'string') {
        return {
            id: normalizeDiscoveredModelId(entry),
            ownedBy: '',
            object: '',
            rawType: ''
        };
    }
    const id = normalizeDiscoveredModelId(entry.id || entry.model || entry.name || entry.slug);
    return {
        id,
        ownedBy: String(entry.owned_by || entry.ownedBy || entry.owner || entry.provider || '').slice(0, 120),
        object: String(entry.object || entry.type || '').slice(0, 80),
        rawType: String(entry.type || entry.mode || entry.capability || '').slice(0, 120),
        supportedGenerationMethods: Array.isArray(entry.supportedGenerationMethods)
            ? entry.supportedGenerationMethods.map((method) => String(method || '').trim()).filter(Boolean)
            : []
    };
}

function normalizeGeminiDiscoveredModelEntry(entry = {}) {
    const model = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    const id = normalizeGeminiModelId(model.name || model.id || model.model || model.slug);
    return {
        id,
        ownedBy: 'gemini',
        object: 'model',
        rawType: 'gemini-native',
        displayName: String(model.displayName || model.display_name || id).slice(0, 180),
        supportedGenerationMethods: Array.isArray(model.supportedGenerationMethods)
            ? model.supportedGenerationMethods.map((method) => String(method || '').trim()).filter(Boolean)
            : []
    };
}

function extractDiscoveredModelEntries(payload = {}) {
    const source = Array.isArray(payload?.data)
        ? payload.data
        : (Array.isArray(payload?.models)
            ? payload.models
            : (Array.isArray(payload) ? payload : []));
    const seen = new Set();
    const models = [];
    for (const item of source) {
        const model = normalizeDiscoveredModelEntry(item);
        const key = model.id.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        models.push(model);
    }
    return models.slice(0, 300);
}

function inferDiscoveredModelGroup(model = {}) {
    const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
    const haystack = `${model.id || ''} ${model.object || ''} ${model.rawType || ''} ${model.displayName || ''}`.toLowerCase();
    if (methods.some((method) => /generateVideos|generateVideo|video/i.test(method))) return 'video';
    if (VIDEO_MODEL_HINT_PATTERN.test(haystack)) return 'video';
    // Gemini image models can expose generateContent in /models, so model-name
    // image hints must win before the generic chat/content methods.
    if (IMAGE_MODEL_HINT_PATTERN.test(haystack)) return 'image';
    if (methods.some((method) => /generateImages|predict/i.test(method))) return 'image';
    if (methods.some((method) => /generateContent|streamGenerateContent/i.test(method))) return 'chat';
    if (CHAT_MODEL_HINT_PATTERN.test(haystack)) return 'chat';
    return 'unknown';
}

function summarizeDiscoveredModels(models = []) {
    const imageModels = [];
    const chatModels = [];
    const videoModels = [];
    const unknownModels = [];
    for (const model of models) {
        const group = inferDiscoveredModelGroup(model);
        if (group === 'image') {
            imageModels.push(model.id);
        } else if (group === 'chat') {
            chatModels.push(model.id);
        } else if (group === 'video') {
            videoModels.push(model.id);
        } else {
            unknownModels.push(model.id);
        }
    }
    return {
        models: models.map((model) => ({
            ...model,
            groupHint: inferDiscoveredModelGroup(model)
        })),
        imageModels: imageModels.slice(0, 80),
        chatModels: chatModels.slice(0, 120),
        videoModels: videoModels.slice(0, 80),
        unknownModels: unknownModels.slice(0, 80)
    };
}

function buildModelPresence(requestedModels = [], availableModels = []) {
    const requested = normalizeModelsList(requestedModels, '');
    const available = normalizeModelsList(availableModels, '');
    const availableSet = new Set(available.map((model) => model.toLowerCase()));
    return {
        requested,
        available,
        listed: requested.length > 0 && requested.every((model) => availableSet.has(model.toLowerCase())),
        missing: requested.filter((model) => !availableSet.has(model.toLowerCase()))
    };
}

function isGeminiNativeBaseUrl(baseUrl = '') {
    try {
        const url = new URL(baseUrl);
        return /(^|\.)generativelanguage\.googleapis\.com$/i.test(url.hostname);
    } catch (_) {
        return /generativelanguage\.googleapis\.com/i.test(String(baseUrl || ''));
    }
}

function buildGeminiModelsUrl(baseUrl = '', apiKey = '') {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    const url = new URL(`${normalizedBaseUrl.replace(/\/+$/, '')}/models`);
    url.searchParams.set('key', apiKey);
    return url.toString();
}

async function discoverGeminiNativeModels({
    apiKey,
    baseUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15000
} = {}) {
    const startedAt = Date.now();
    const controller = typeof AbortController === 'function'
        ? new AbortController()
        : null;
    const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const response = await fetchImpl(buildGeminiModelsUrl(baseUrl, apiKey), {
            method: 'GET',
            ...(controller ? { signal: controller.signal } : {})
        });
        const latencyMs = Date.now() - startedAt;
        const upstream = getProbeResponseMeta(response);
        const payload = await readUpstreamJson(response);
        if (!response.ok) {
            return {
                ok: false,
                endpoint: 'gemini_models',
                latencyMs,
                statusCode: response.status,
                upstream,
                code: payload?.error?.code || payload?.code || 'ai_image_gemini_model_discovery_failed',
                message: getUpstreamErrorMessage(payload, response),
                models: [],
                imageModels: [],
                chatModels: [],
                unknownModels: []
            };
        }

        const entries = (Array.isArray(payload?.models) ? payload.models : [])
            .map(normalizeGeminiDiscoveredModelEntry)
            .filter((model) => model.id);
        const summary = summarizeDiscoveredModels(entries);
        return {
            ok: true,
            endpoint: 'gemini_models',
            provider: 'gemini',
            latencyMs,
            statusCode: response.status,
            upstream,
            total: summary.models.length,
            ...summary
        };
    } catch (error) {
        const signal = [
            error.name,
            error.code,
            error.message,
            error.cause?.name,
            error.cause?.code,
            error.cause?.message
        ].filter(Boolean).join(' | ');
        const timeout = /abort|timeout|timed out|und_err_headers_timeout|etimedout/i.test(signal);
        return {
            ok: false,
            endpoint: 'gemini_models',
            provider: 'gemini',
            latencyMs: Date.now() - startedAt,
            statusCode: timeout ? 504 : 502,
            code: timeout ? 'ai_image_gemini_model_discovery_timeout' : (error.code || 'ai_image_gemini_model_discovery_failed'),
            message: timeout
                ? `Gemini 模型列表发现超时（${Math.round(timeoutMs / 1000)} 秒）。`
                : String(error.message || 'Gemini 模型列表发现失败').slice(0, 1000),
            models: [],
            imageModels: [],
            chatModels: [],
            unknownModels: []
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function discoverOpenAiCompatibleModels({
    apiKey,
    baseUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15000
} = {}) {
    const startedAt = Date.now();
    const controller = typeof AbortController === 'function'
        ? new AbortController()
        : null;
    const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const response = await fetchImpl(`${baseUrl}/models`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`
            },
            ...(controller ? { signal: controller.signal } : {})
        });
        const latencyMs = Date.now() - startedAt;
        const upstream = getProbeResponseMeta(response);
        const payload = await readUpstreamJson(response);
        if (!response.ok) {
            return {
                ok: false,
                endpoint: 'models',
                latencyMs,
                statusCode: response.status,
                upstream,
                code: payload?.error?.code || payload?.code || 'ai_image_model_discovery_failed',
                message: getUpstreamErrorMessage(payload, response),
                models: [],
                imageModels: [],
                chatModels: [],
                unknownModels: []
            };
        }

        const summary = summarizeDiscoveredModels(extractDiscoveredModelEntries(payload));
        return {
            ok: true,
            endpoint: 'models',
            latencyMs,
            statusCode: response.status,
            upstream,
            total: summary.models.length,
            ...summary
        };
    } catch (error) {
        const signal = [
            error.name,
            error.code,
            error.message,
            error.cause?.name,
            error.cause?.code,
            error.cause?.message
        ].filter(Boolean).join(' | ');
        const timeout = /abort|timeout|timed out|und_err_headers_timeout|etimedout/i.test(signal);
        return {
            ok: false,
            endpoint: 'models',
            latencyMs: Date.now() - startedAt,
            statusCode: timeout ? 504 : 502,
            code: timeout ? 'ai_image_model_discovery_timeout' : (error.code || 'ai_image_model_discovery_failed'),
            message: timeout
                ? `上游模型列表发现超时（${Math.round(timeoutMs / 1000)} 秒）。`
                : String(error.message || '上游模型列表发现失败').slice(0, 1000),
            models: [],
            imageModels: [],
            chatModels: [],
            unknownModels: []
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function normalizeProbeResolution(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(MODEL_PROBE_SIZE_BY_RESOLUTION, normalized) ? normalized : '1k';
}

function getProbeSize(resolution = '1k') {
    return MODEL_PROBE_SIZE_BY_RESOLUTION[normalizeProbeResolution(resolution)] || MODEL_PROBE_SIZE_BY_RESOLUTION['1k'];
}

function createProbeEditFormData({ model, prompt, size } = {}) {
    if (typeof FormData !== 'function' || typeof Blob !== 'function') {
        const error = new Error('当前 Node 运行时不支持图片编辑自检所需的 FormData/Blob');
        error.statusCode = 503;
        error.code = 'ai_image_model_probe_formdata_unavailable';
        throw error;
    }

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', size);
    form.append('image', new Blob([Buffer.from(MODEL_PROBE_PNG_BASE64, 'base64')], {
        type: 'image/png'
    }), 'probe-reference.png');
    return form;
}

function normalizeProbeModes(value = '') {
    const rawModes = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\s]+/);
    const allowed = new Set(['text', 'image', 'chat', 'vision']);
    const modes = [];
    rawModes.forEach((item) => {
        const mode = String(item || '').trim().toLowerCase();
        if (!allowed.has(mode) || modes.includes(mode)) return;
        modes.push(mode);
    });
    return modes.length ? modes : ['text', 'image'];
}

function normalizeProbeModesForModelGroup(value = '', modelGroup = 'image') {
    const modes = normalizeProbeModes(value);
    if (value || (Array.isArray(value) && value.length)) return modes;
    const group = normalizeModelGroup(modelGroup, 'image');
    if (group === 'chat') return ['chat', 'vision'];
    if (group === 'both') return ['text', 'image', 'chat', 'vision'];
    return ['text', 'image'];
}

function normalizeProbeResolutions(value = '') {
    const rawResolutions = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\s]+/);
    const resolutions = [];
    rawResolutions.forEach((item) => {
        const resolution = String(item || '').trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(MODEL_PROBE_SIZE_BY_RESOLUTION, resolution) || resolutions.includes(resolution)) return;
        resolutions.push(resolution);
    });
    return resolutions.length ? resolutions : MODEL_PROBE_RESOLUTIONS.slice();
}

function normalizeProbeTargets(value = [], { imageModels = [], chatModels = [] } = {}) {
    if (!Array.isArray(value)) return [];
    const imageModelMap = new Map(normalizeModelsList(imageModels, '').map((model) => [model.toLowerCase(), model]));
    const chatModelMap = new Map(normalizeModelsList(chatModels, '').map((model) => [model.toLowerCase(), model]));
    const allowedModes = new Set(['text', 'image', 'chat', 'vision']);
    const targets = [];
    const seen = new Set();

    for (const item of value.slice(0, 200)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const mode = String(item.mode || '').trim().toLowerCase();
        const rawModel = String(item.model || '').trim();
        if (!allowedModes.has(mode) || !rawModel) continue;
        const requestedModel = normalizeModel(rawModel);
        const modelMap = mode === 'chat' || mode === 'vision' ? chatModelMap : imageModelMap;
        const model = modelMap.get(requestedModel.toLowerCase());
        if (!model) continue;
        const resolution = mode === 'chat' || mode === 'vision'
            ? ''
            : normalizeProbeResolution(item.resolution);
        const key = `${model.toLowerCase()}\u0000${mode}\u0000${resolution}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ model, mode, resolution });
    }

    return targets;
}

function getVisionProbeFixture(imageSource = 'remote-url') {
    return imageSource === 'data-url'
        ? {
            imageSource: 'data-url',
            imageUrl: MODEL_PROBE_DATA_IMAGE_URL,
            prompt: '请观察图片，只回答图片左侧和右侧分别是什么颜色，格式为“左X右Y”，并用中文颜色词替换 X 和 Y。',
            expected: 'red-blue'
        }
        : {
            imageSource: 'remote-url',
            imageUrl: MODEL_PROBE_REMOTE_IMAGE_URL,
            prompt: '请观察图片，只回答图片上方气球的颜色，使用一个中文颜色词。',
            expected: 'red-balloon'
        };
}

function buildProbeChatMessages(mode = 'chat', imageSource = 'remote-url') {
    const normalizedMode = String(mode || '').trim().toLowerCase() === 'vision' ? 'vision' : 'chat';
    if (normalizedMode === 'vision') {
        const fixture = getVisionProbeFixture(imageSource);
        return [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: fixture.prompt
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: fixture.imageUrl
                        }
                    }
                ]
            }
        ];
    }
    return [
        {
            role: 'user',
            content: '用一句中文回复：模型可用性自检通过。'
        }
    ];
}

function buildProbeResponsesInput(imageSource = 'remote-url') {
    const fixture = getVisionProbeFixture(imageSource);
    return [{
        role: 'user',
        content: [
            {
                type: 'input_text',
                text: fixture.prompt
            },
            {
                type: 'input_image',
                image_url: fixture.imageUrl
            }
        ]
    }];
}

function readProbeResponseText(payload = {}) {
    const directText = payload?.choices?.[0]?.message?.content
        || payload?.choices?.[0]?.text
        || payload?.output_text;
    if (typeof directText === 'string' && directText.trim()) return directText.trim();
    if (Array.isArray(directText)) {
        const contentText = directText
            .map((item) => typeof item === 'string' ? item : (item?.text || item?.content || ''))
            .filter(Boolean)
            .join('\n')
            .trim();
        if (contentText) return contentText;
    }
    return (Array.isArray(payload?.output) ? payload.output : [])
        .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
        .map((item) => typeof item?.text === 'string' ? item.text : (item?.text?.value || ''))
        .filter(Boolean)
        .join('\n')
        .trim();
}

function isVisionProbeAnswerCorrect(text = '', imageSource = 'remote-url') {
    const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    if (getVisionProbeFixture(imageSource).expected === 'red-balloon') {
        return /红|red/i.test(normalized);
    }
    const redIndex = Math.max(normalized.indexOf('红'), normalized.indexOf('red'));
    const blueIndex = Math.max(normalized.indexOf('蓝'), normalized.indexOf('blue'));
    return redIndex >= 0 && blueIndex > redIndex;
}

function normalizeChatProbeError(error, timeoutMs, startedAt) {
    if (error?.isUpstreamHttp) return error;
    const signal = [
        error?.name,
        error?.code,
        error?.message,
        error?.cause?.name,
        error?.cause?.code,
        error?.cause?.message
    ].filter(Boolean).join(' | ');
    const timeout = /abort|timeout|timed out|und_err_headers_timeout|etimedout/i.test(signal);
    const nextError = new Error(timeout
        ? `对话/视觉模型自检超时（${Math.round(timeoutMs / 1000)} 秒），上游未及时返回文本结果。`
        : (error?.message || '对话/视觉模型自检失败'));
    nextError.statusCode = timeout ? 504 : (error?.statusCode || 502);
    nextError.code = timeout ? 'ai_image_chat_model_probe_timeout' : (error?.code || 'ai_image_chat_model_probe_failed');
    nextError.latencyMs = error?.latencyMs || (Date.now() - startedAt);
    nextError.upstream = error?.upstream || null;
    nextError.endpoint = error?.endpoint || '';
    nextError.imageSource = error?.imageSource || '';
    nextError.details = signal;
    return nextError;
}

function isExplicitVisionUnsupported(error = {}) {
    const signal = `${error.code || ''} ${error.message || ''}`.toLowerCase();
    return /(?:image|vision|图片|图像).{0,50}(?:does? not support|not support(?:ed)?|unsupported|不支持|无法处理)|(?:does? not support|not support(?:ed)?|unsupported|不支持).{0,50}(?:image|vision|图片|图像)/i.test(signal);
}

function createVisionProbeFailure(errors = [], startedAt = Date.now()) {
    const attempts = errors.filter(Boolean).map((error) => ({
        endpoint: error.endpoint || '',
        imageSource: error.imageSource || '',
        code: error.code || 'ai_image_chat_model_probe_failed',
        message: String(error.message || '视觉自检失败').slice(0, 300),
        statusCode: error.statusCode || 502,
        upstream: error.upstream || null
    }));
    const explicitlyUnsupported = attempts.length > 0 && errors.filter(Boolean).every(isExplicitVisionUnsupported);
    const error = new Error(explicitlyUnsupported
        ? '上游已明确拒绝该模型的图片输入，当前渠道不支持使用此模型读图。'
        : `视觉自检链路未完成：${attempts.map((item) => `${item.endpoint || '上游'}：${item.message}`).join('；')}。这不能据此判定模型不支持读图。`);
    error.statusCode = explicitlyUnsupported ? 422 : 502;
    error.code = explicitlyUnsupported
        ? 'ai_image_vision_input_unsupported'
        : 'ai_image_vision_probe_unverified';
    error.verificationStatus = explicitlyUnsupported ? 'unsupported' : 'unverified';
    error.latencyMs = Date.now() - startedAt;
    error.endpoint = attempts.map((item) => item.endpoint).filter(Boolean).join(' → ');
    error.upstream = attempts.at(-1)?.upstream || null;
    error.attempts = attempts;
    return error;
}

async function requestChatProbe({
    apiKey,
    baseUrl,
    model,
    mode,
    endpoint,
    imageSource = 'remote-url',
    fetchImpl,
    signal
}) {
    const requestStartedAt = Date.now();
    const usesResponses = endpoint === 'responses';
    const response = await fetchImpl(`${baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(usesResponses ? {
            model,
            input: buildProbeResponsesInput(imageSource),
            stream: false,
            max_output_tokens: 512
        } : {
            model,
            messages: buildProbeChatMessages(mode, imageSource),
            stream: false,
            max_tokens: 80
        }),
        ...(signal ? { signal } : {})
    });
    const latencyMs = Date.now() - requestStartedAt;
    const upstream = getProbeResponseMeta(response);
    const payload = await readUpstreamJson(response);
    if (!response.ok) {
        const error = new Error(getUpstreamErrorMessage(payload, response));
        error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
        error.code = payload?.error?.code || payload?.code || 'ai_image_chat_model_probe_failed';
        error.latencyMs = latencyMs;
        error.endpoint = endpoint;
        error.imageSource = imageSource;
        error.upstream = upstream;
        error.isUpstreamHttp = true;
        throw error;
    }

    const text = readProbeResponseText(payload);
    if (!text) {
        const error = new Error('上游响应成功，但没有返回文本内容');
        error.statusCode = 502;
        error.code = 'ai_image_chat_model_probe_empty_result';
        error.latencyMs = latencyMs;
        error.endpoint = endpoint;
        error.imageSource = imageSource;
        error.upstream = upstream;
        throw error;
    }
    if (mode === 'vision' && !isVisionProbeAnswerCorrect(text, imageSource)) {
        const expectedDescription = getVisionProbeFixture(imageSource).expected === 'red-balloon'
            ? '探测图上方的红色气球'
            : '探测图的左红右蓝';
        const error = new Error(`模型返回了文本，但未能正确识别${expectedDescription}，读图能力尚未验证。`);
        error.statusCode = 422;
        error.code = 'ai_image_vision_probe_answer_mismatch';
        error.latencyMs = latencyMs;
        error.endpoint = endpoint;
        error.imageSource = imageSource;
        error.upstream = upstream;
        throw error;
    }

    return {
        ok: true,
        latencyMs,
        mode,
        endpoint,
        imageSource: mode === 'vision' ? imageSource : '',
        upstream,
        resultType: 'text',
        providerTaskId: String(payload.id || payload.task_id || '').slice(0, 160),
        message: text.slice(0, 500)
    };
}

async function runChatAvailabilityCheck({
    apiKey,
    baseUrl,
    model,
    mode = 'chat',
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_MODEL_TEST_TIMEOUT_MS
} = {}) {
    const startedAt = Date.now();
    const controller = typeof AbortController === 'function'
        ? new AbortController()
        : null;
    const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const normalizedMode = String(mode || '').trim().toLowerCase() === 'vision' ? 'vision' : 'chat';
        if (normalizedMode !== 'vision') {
            return await requestChatProbe({
                apiKey,
                baseUrl,
                model,
                mode: normalizedMode,
                endpoint: 'chat/completions',
                fetchImpl,
                signal: controller?.signal
            });
        }

        const attempts = [];
        const strategies = [
            { imageSource: 'remote-url', endpoint: 'chat/completions' },
            { imageSource: 'remote-url', endpoint: 'responses' },
            { imageSource: 'data-url', endpoint: 'chat/completions' },
            { imageSource: 'data-url', endpoint: 'responses' }
        ];
        for (const strategy of strategies) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const check = await requestChatProbe({
                    apiKey,
                    baseUrl,
                    model,
                    mode: normalizedMode,
                    endpoint: strategy.endpoint,
                    imageSource: strategy.imageSource,
                    fetchImpl,
                    signal: controller?.signal
                });
                return {
                    ...check,
                    latencyMs: Date.now() - startedAt,
                    fallbackFrom: attempts.length
                        ? (strategy.imageSource === 'data-url'
                            ? '公网图片 URL'
                            : 'chat/completions')
                        : ''
                };
            } catch (error) {
                attempts.push(normalizeChatProbeError(error, timeoutMs, startedAt));
            }
        }
        throw createVisionProbeFailure(attempts, startedAt);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function runModelAvailabilityCheck({
    apiKey,
    baseUrl,
    model,
    mode = 'text',
    resolution = '1k',
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_MODEL_TEST_TIMEOUT_MS
} = {}) {
    const startedAt = Date.now();
    const probeMode = String(mode || '').trim().toLowerCase();
    if (probeMode === 'chat' || probeMode === 'vision') {
        return runChatAvailabilityCheck({
            apiKey,
            baseUrl,
            model,
            mode: probeMode,
            fetchImpl,
            timeoutMs
        });
    }
    const controller = typeof AbortController === 'function'
        ? new AbortController()
        : null;
    const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const normalizedMode = String(mode || '').trim().toLowerCase() === 'image' ? 'image' : 'text';
        const normalizedResolution = normalizeProbeResolution(resolution);
        const size = getProbeSize(normalizedResolution);
        const endpoint = normalizedMode === 'image' ? 'edits' : 'generations';
        const requestOptions = normalizedMode === 'image'
            ? {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`
                },
                body: createProbeEditFormData({
                    model,
                    prompt: '将参考图改成一枚简洁的蓝色圆形图标',
                    size
                }),
                ...(controller ? { signal: controller.signal } : {})
            }
            : {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    prompt: '一枚简洁的蓝色圆形图标',
                    n: 1,
                    size
                }),
                ...(controller ? { signal: controller.signal } : {})
            };
        const response = await fetchImpl(`${baseUrl}/images/${endpoint}`, requestOptions);
        const latencyMs = Date.now() - startedAt;
        const upstream = getProbeResponseMeta(response);
        const payload = await readUpstreamJson(response);
        if (!response.ok) {
            const error = new Error(getUpstreamErrorMessage(payload, response));
            error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
            error.code = payload?.error?.code || payload?.code || 'ai_image_model_probe_failed';
            error.latencyMs = latencyMs;
            error.upstream = upstream;
            error.isUpstreamHttp = true;
            throw error;
        }

        if (!hasImageResult(payload)) {
            const error = new Error('上游响应成功，但没有返回图片数据');
            error.statusCode = 502;
            error.code = 'ai_image_model_probe_empty_result';
            error.latencyMs = latencyMs;
            throw error;
        }

        const first = Array.isArray(payload.data) ? payload.data[0] : {};
        return {
            ok: true,
            latencyMs,
            hasImage: true,
            mode: normalizedMode,
            resolution: normalizedResolution,
            endpoint: `images/${endpoint}`,
            upstream,
            size,
            resultType: first.b64_json ? 'base64' : 'url',
            providerTaskId: String(payload.id || payload.task_id || '').slice(0, 160),
            revisedPrompt: String(first.revised_prompt || '').slice(0, 500)
        };
    } catch (error) {
        if (error.isUpstreamHttp) {
            throw error;
        }
        const signal = [
            error.name,
            error.code,
            error.message,
            error.cause?.name,
            error.cause?.code,
            error.cause?.message
        ].filter(Boolean).join(' | ');
        const timeout = /abort|timeout|timed out|und_err_headers_timeout|etimedout/i.test(signal);
        const nextError = new Error(timeout
            ? `模型可用性自检超时（${Math.round(timeoutMs / 1000)} 秒），上游未及时返回图片结果。`
            : (error.message || '模型可用性自检失败'));
        nextError.statusCode = timeout ? 504 : (error.statusCode || 502);
        nextError.code = timeout ? 'ai_image_model_probe_timeout' : (error.code || 'ai_image_model_probe_failed');
        nextError.latencyMs = error.latencyMs || (Date.now() - startedAt);
        nextError.details = signal;
        throw nextError;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function runModelAvailabilityMatrix({
    apiKey,
    baseUrl,
    model,
    chatModel,
    imageModel,
    chatModels = [],
    imageModels = [],
    modelGroup = 'image',
    modes,
    resolutions,
    probeTargets = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_MODEL_TEST_TIMEOUT_MS
} = {}) {
    const requestedModes = normalizeProbeModesForModelGroup(modes, modelGroup);
    const requestedResolutions = normalizeProbeResolutions(resolutions);
    const checks = [];
    const requestedChatModels = normalizeModelsList(chatModels, chatModel || model);
    const requestedImageModels = normalizeModelsList(imageModels, imageModel || model);
    const normalizedTargets = Array.isArray(probeTargets)
        ? normalizeProbeTargets(probeTargets, {
            imageModels: requestedImageModels,
            chatModels: requestedChatModels
        })
        : null;
    const targets = normalizedTargets || requestedModes.flatMap((mode) => {
        if (mode === 'chat' || mode === 'vision') {
            return requestedChatModels.map((currentModel) => ({
                model: currentModel,
                mode,
                resolution: ''
            }));
        }
        return requestedImageModels.flatMap((currentModel) => requestedResolutions.map((resolution) => ({
            model: currentModel,
            mode,
            resolution
        })));
    });

    for (const target of targets) {
        const { mode, model: currentModel, resolution } = target;
        const isChatMode = mode === 'chat' || mode === 'vision';
        try {
            // Keep requests sequential to avoid a self-test stampede against the paid upstream.
            // eslint-disable-next-line no-await-in-loop
            const check = await runModelAvailabilityCheck({
                apiKey,
                baseUrl,
                model: currentModel,
                mode,
                ...(isChatMode ? {} : { resolution }),
                fetchImpl,
                timeoutMs
            });
            checks.push(isChatMode ? {
                ok: true,
                mode,
                model: currentModel,
                resolution: '',
                endpoint: check.endpoint,
                fallbackFrom: check.fallbackFrom || '',
                imageSource: check.imageSource || '',
                verificationStatus: 'verified',
                upstream: check.upstream || null,
                size: '',
                latencyMs: check.latencyMs,
                resultType: check.resultType,
                providerTaskId: check.providerTaskId,
                revisedPrompt: '',
                message: check.message,
                code: ''
            } : {
                ok: true,
                mode,
                model: currentModel,
                resolution,
                endpoint: check.endpoint,
                upstream: check.upstream || null,
                size: check.size,
                latencyMs: check.latencyMs,
                resultType: check.resultType,
                providerTaskId: check.providerTaskId,
                revisedPrompt: check.revisedPrompt,
                code: '',
                message: ''
            });
        } catch (error) {
            checks.push(isChatMode ? {
                ok: false,
                mode,
                model: currentModel,
                resolution: '',
                endpoint: error.endpoint || 'chat/completions',
                fallbackFrom: '',
                verificationStatus: error.verificationStatus || 'failed',
                upstream: error.upstream || null,
                size: '',
                latencyMs: error.latencyMs || 0,
                resultType: '',
                providerTaskId: '',
                revisedPrompt: '',
                code: error.code || 'ai_image_chat_model_probe_failed',
                message: String(error.message || '对话/视觉模型自检失败').slice(0, 1000),
                statusCode: error.statusCode || 502,
                attempts: Array.isArray(error.attempts) ? error.attempts : []
            } : {
                ok: false,
                mode,
                model: currentModel,
                resolution,
                endpoint: mode === 'image' ? 'images/edits' : 'images/generations',
                upstream: error.upstream || null,
                size: getProbeSize(resolution),
                latencyMs: error.latencyMs || 0,
                resultType: '',
                providerTaskId: '',
                revisedPrompt: '',
                code: error.code || 'ai_image_model_probe_failed',
                message: String(error.message || '模型自检失败').slice(0, 1000),
                statusCode: error.statusCode || 502
            });
        }
    }

    const passed = checks.filter((item) => item.ok).length;
    const failed = checks.length - passed;
    const unverified = checks.filter((item) => item.verificationStatus === 'unverified').length;
    const unsupported = checks.filter((item) => item.verificationStatus === 'unsupported').length;
    return {
        ok: failed === 0,
        passed,
        failed,
        unverified,
        unsupported,
        total: checks.length,
        checks
    };
}

async function handleModelAvailabilityCheck({ body, currentConfig, sendJson, res, env = process.env, fetchImpl = globalThis.fetch }) {
    const providers = Array.isArray(currentConfig.providers) ? currentConfig.providers : [];
    const providerId = normalizeProviderId(body.providerId || body.provider_id || currentConfig.providerId || 'default');
    const selectedProvider = providers.find((provider) => normalizeProviderId(provider.providerId || provider.provider_id) === providerId) || null;
    const apiKey = String(body.apiKey || '').trim() || String(selectedProvider?.apiKey || currentConfig.apiKey || '').trim();
    const baseUrl = normalizeBaseUrl(body.baseUrl || selectedProvider?.baseUrl || currentConfig.baseUrl || 'https://api.openai.com/v1');
    const model = normalizeModel(body.model || selectedProvider?.model || currentConfig.model || 'gpt-image-2');
    const draftChatModels = normalizeModelsList(body.chatModels || body.chat_models || selectedProvider?.chatModels || selectedProvider?.chat_models, '');
    const requestedModelGroup = normalizeModelGroup(body.modelGroup || body.model_group || selectedProvider?.modelGroup || selectedProvider?.model_group, draftChatModels.length ? 'both' : 'image');
    const hasExplicitImageModels = hasModelsListValue(body.imageModels, body.image_models, selectedProvider?.imageModels, selectedProvider?.image_models);
    let draftImageModels = requestedModelGroup === 'chat' && !hasExplicitImageModels
        ? []
        : normalizeModelsList(body.imageModels || body.image_models || selectedProvider?.imageModels || selectedProvider?.image_models || selectedProvider?.models, model);
    let { imageModels, chatModels } = scopeModelsByModelGroup(requestedModelGroup, draftImageModels, draftChatModels);
    const timeoutMs = normalizePositiveInt(
        body.timeoutMs || body.timeout_ms || env.AI_IMAGE_MODEL_PROBE_TIMEOUT_MS,
        DEFAULT_MODEL_TEST_TIMEOUT_MS,
        { min: 5000, max: 120000 }
    );

    if (apiKey.length < 10) {
        return sendJson(res, 400, {
            success: false,
            message: '请先录入有效的 AI 图片 API Key 后再自检',
            code: 'ai_image_model_probe_key_required'
        });
    }

    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        return sendJson(res, 400, {
            success: false,
            message: '请输入有效的 AI 图片 API Base URL',
            code: 'ai_image_model_probe_base_url_invalid'
        });
    }

    const shouldDiscoverModels = body.discoverModels === true
        || body.discover_models === true
        || String(body.discoverModels || body.discover_models || '').trim().toLowerCase() === 'true';
    const discoveryTimeoutMs = normalizePositiveInt(
        body.discoveryTimeoutMs || body.discovery_timeout_ms || env.AI_IMAGE_MODEL_DISCOVERY_TIMEOUT_MS,
        Math.min(15000, timeoutMs),
        { min: 3000, max: 30000 }
    );
    const discovery = shouldDiscoverModels
        ? await discoverOpenAiCompatibleModels({
            apiKey,
            baseUrl,
            fetchImpl,
            timeoutMs: discoveryTimeoutMs
        })
        : null;

    if (requestedModelGroup !== 'image' && !chatModels.length && discovery?.ok && discovery.chatModels.length) {
        chatModels = discovery.chatModels.slice(0, 12);
    }
    if (requestedModelGroup !== 'chat' && !imageModels.length && discovery?.ok && discovery.imageModels.length) {
        imageModels = discovery.imageModels.slice(0, 12);
    }

    const modelGroup = requestedModelGroup;
    const imageModel = imageModels[0] || model;
    const chatModel = chatModels[0] || model;

    const wantsMatrix = body.matrix === true || String(body.matrix || '').trim().toLowerCase() === 'true';

    if (wantsMatrix) {
        const hasExplicitProbeTargets = Object.prototype.hasOwnProperty.call(body, 'probeTargets')
            || Object.prototype.hasOwnProperty.call(body, 'probe_targets');
        const probeTargets = hasExplicitProbeTargets
            ? normalizeProbeTargets(body.probeTargets || body.probe_targets, { imageModels, chatModels })
            : null;
        if (hasExplicitProbeTargets && !probeTargets.length) {
            return sendJson(res, 400, {
                success: false,
                message: '没有可重检的故障模型项目，请刷新配置后重试。',
                code: 'ai_image_model_probe_targets_invalid'
            });
        }
        const matrix = await runModelAvailabilityMatrix({
            apiKey,
            baseUrl,
            model,
            imageModel,
            chatModel,
            imageModels,
            chatModels,
            modelGroup,
            modes: body.modes || body.mode,
            resolutions: body.resolutions || body.resolution,
            probeTargets,
            fetchImpl,
            timeoutMs
        });
        const visionModels = normalizeModelsList(
            matrix.checks
                .filter((item) => item.ok && item.mode === 'vision')
                .map((item) => item.model),
            ''
        );
        const status = matrix.ok ? 200 : 207;
        const failureSummary = [
            matrix.unverified ? `${matrix.unverified} 项未验证` : '',
            matrix.unsupported ? `${matrix.unsupported} 项明确不支持` : '',
            matrix.failed - matrix.unverified - matrix.unsupported > 0
                ? `${matrix.failed - matrix.unverified - matrix.unsupported} 项失败`
                : ''
        ].filter(Boolean).join('，');
        return sendJson(res, status, {
            success: matrix.ok,
            message: matrix.ok
                ? `模型矩阵自检通过：${matrix.passed}/${matrix.total} 项可用。`
                : `模型矩阵自检完成：${matrix.passed}/${matrix.total} 项通过，${failureSummary || `${matrix.failed} 项失败`}。`,
            check: {
                ok: matrix.ok,
                providerId,
                baseUrl,
                model,
                imageModel,
                chatModel,
                modelGroup,
                timeoutMs,
                discovery,
                visionModels,
                vision_models: visionModels,
                modelPresence: discovery?.ok ? {
                    image: buildModelPresence(imageModels, discovery.imageModels),
                    chat: buildModelPresence(chatModels, discovery.chatModels)
                } : null,
                passed: matrix.passed,
                failed: matrix.failed,
                unverified: matrix.unverified,
                unsupported: matrix.unsupported,
                total: matrix.total,
                checks: matrix.checks
            }
        });
    }

    const check = await runModelAvailabilityCheck({
        apiKey,
        baseUrl,
        model: body.mode === 'chat' || body.mode === 'vision' ? chatModel : imageModel,
        mode: body.mode,
        resolution: body.resolution,
        fetchImpl,
        timeoutMs
    });
    const visionModels = check.mode === 'vision' && check.ok
        ? normalizeModelsList([chatModel], '')
        : [];

    return sendJson(res, 200, {
        success: true,
        message: `模型可用性自检通过，${(check.latencyMs / 1000).toFixed(1)} 秒返回结果。`,
        check: {
            ok: true,
            providerId,
            baseUrl,
            model: check.mode === 'chat' || check.mode === 'vision' ? chatModel : imageModel,
            imageModel,
            chatModel,
            modelGroup,
            timeoutMs,
            discovery,
            visionModels,
            vision_models: visionModels,
            modelPresence: discovery?.ok ? {
                image: buildModelPresence(imageModels, discovery.imageModels),
                chat: buildModelPresence(chatModels, discovery.chatModels)
            } : null,
            mode: check.mode,
            resolution: check.resolution,
            endpoint: check.endpoint,
            upstream: check.upstream || null,
            size: check.size,
            latencyMs: check.latencyMs,
            resultType: check.resultType,
            providerTaskId: check.providerTaskId,
            revisedPrompt: check.revisedPrompt
        }
    });
}

async function handleModelDiscoveryOnly({ body, currentConfig, sendJson, res, env = process.env, fetchImpl = globalThis.fetch }) {
    const providers = Array.isArray(currentConfig.providers) ? currentConfig.providers : [];
    const providerId = normalizeProviderId(body.providerId || body.provider_id || currentConfig.providerId || 'default');
    const selectedProvider = providers.find((provider) => normalizeProviderId(provider.providerId || provider.provider_id) === providerId) || null;
    const apiKey = String(body.apiKey || '').trim() || String(selectedProvider?.apiKey || currentConfig.apiKey || '').trim();
    const baseUrl = normalizeBaseUrl(body.baseUrl || selectedProvider?.baseUrl || currentConfig.baseUrl || 'https://api.openai.com/v1');
    const timeoutMs = normalizePositiveInt(
        body.timeoutMs || body.timeout_ms || env.AI_IMAGE_MODEL_DISCOVERY_TIMEOUT_MS,
        15000,
        { min: 3000, max: 30000 }
    );

    if (apiKey.length < 10) {
        return sendJson(res, 400, {
            success: false,
            message: '请先录入有效的 AI 图片 API Key 后再检测上游模型',
            code: 'ai_image_model_discovery_key_required'
        });
    }

    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        return sendJson(res, 400, {
            success: false,
            message: '请输入有效的 AI 图片 API Base URL',
            code: 'ai_image_model_discovery_base_url_invalid'
        });
    }

    const discovery = isGeminiNativeBaseUrl(baseUrl)
        ? await discoverGeminiNativeModels({
            apiKey,
            baseUrl,
            fetchImpl,
            timeoutMs
        })
        : await discoverOpenAiCompatibleModels({
            apiKey,
            baseUrl,
            fetchImpl,
            timeoutMs
        });

    if (!discovery?.ok) {
        return sendJson(res, discovery.statusCode || 502, {
            success: false,
            message: discovery.message || '上游模型检测失败，请确认 API Key 和 Base URL 可用。',
            code: discovery.code || 'ai_image_model_discovery_failed',
            discovery: {
                ...discovery,
                models: []
            },
            providerId,
            baseUrl
        });
    }

    const detectedCount = Number(discovery.imageModels?.length || 0)
        + Number(discovery.chatModels?.length || 0)
        + Number(discovery.videoModels?.length || 0)
        + Number(discovery.unknownModels?.length || 0);
    return sendJson(res, 200, {
        success: true,
        message: detectedCount
            ? `上游模型检测完成：发现 ${detectedCount} 个模型。`
            : '上游模型检测完成，但没有发现可分类模型。',
        providerId,
        baseUrl,
        discovery
    });
}

async function upsertProvider({ supabase, user, body, currentConfig }) {
    const providerId = normalizeProviderId(body.providerId || body.provider_id || body.id || 'default');
    const secretKey = getProviderSecretKey(providerId);
    const existingProvider = Array.isArray(currentConfig.providers)
        ? currentConfig.providers.find((provider) => normalizeProviderId(provider.providerId || provider.provider_id) === providerId)
        : null;
    const apiKey = String(body.apiKey || '').trim();
    const resolvedApiKey = apiKey || (
        providerId === 'default' && currentConfig.source === 'stored'
            ? String(currentConfig.apiKey || '').trim()
            : String(existingProvider?.apiKey || '').trim()
    );
    const baseUrl = normalizeBaseUrl(body.baseUrl || body.base_url || existingProvider?.baseUrl || currentConfig.baseUrl || 'https://api.openai.com/v1');
    const explicitModel = Object.prototype.hasOwnProperty.call(body, 'model')
        || Object.prototype.hasOwnProperty.call(body, 'model_name');
    const model = normalizeOptionalModel(explicitModel ? (body.model || body.model_name) : (existingProvider?.model || currentConfig.model || ''));
    const modelListKeys = ['models', 'modelAliases', 'model_aliases'];
    const imageModelListKeys = ['imageModels', 'image_models', 'imageModelAliases', 'image_model_aliases'];
    const videoModelListKeys = ['videoModels', 'video_models', 'videoModelAliases', 'video_model_aliases'];
    const detectedImageModelListKeys = ['detectedImageModels', 'detected_image_models', 'discoveredImageModels', 'discovered_image_models'];
    const detectedChatModelListKeys = ['detectedChatModels', 'detected_chat_models', 'discoveredChatModels', 'discovered_chat_models'];
    const detectedVideoModelListKeys = ['detectedVideoModels', 'detected_video_models', 'discoveredVideoModels', 'discovered_video_models'];
    const explicitModelList = hasExplicitProperty(body, modelListKeys)
        ? firstExplicitModelList(body, modelListKeys)
        : (existingProvider?.models || '');
    const models = normalizeModelsList(explicitModelList, '');
    const draftChatModels = normalizeModelsList(body.chatModels || body.chat_models || body.chatModelAliases || body.chat_model_aliases || existingProvider?.chatModels || existingProvider?.chat_models, '');
    const draftVideoModels = normalizeModelsList(body.videoModels || body.video_models || body.videoModelAliases || body.video_model_aliases || existingProvider?.videoModels || existingProvider?.video_models, '');
    const requestedModelGroup = normalizeModelGroup(
        body.modelGroup || body.model_group || existingProvider?.modelGroup || existingProvider?.model_group,
        draftVideoModels.length && !draftChatModels.length ? 'video' : (draftChatModels.length ? 'both' : 'image')
    );
    const hasExplicitImageModels = hasModelsListValue(
        body.imageModels,
        body.image_models,
        body.imageModelAliases,
        body.image_model_aliases,
        existingProvider?.imageModels,
        existingProvider?.image_models
    );
    const explicitImageModelList = hasExplicitProperty(body, imageModelListKeys)
        ? firstExplicitModelList(body, imageModelListKeys)
        : (hasExplicitProperty(body, modelListKeys)
            ? explicitModelList
            : (existingProvider?.imageModels || existingProvider?.image_models || existingProvider?.models || ''));
    const draftImageModels = requestedModelGroup === 'chat' && !hasExplicitImageModels
        ? []
        : normalizeModelsList(explicitImageModelList, '');
    const explicitVideoModelList = hasExplicitProperty(body, videoModelListKeys)
        ? firstExplicitModelList(body, videoModelListKeys)
        : (existingProvider?.videoModels || existingProvider?.video_models || '');
    const {
        modelGroup,
        imageModels,
        chatModels,
        videoModels
    } = scopeModelsByModelGroup(requestedModelGroup, draftImageModels, draftChatModels, explicitVideoModelList || draftVideoModels);
    const detectedImageSource = hasExplicitProperty(body, detectedImageModelListKeys)
        ? firstExplicitModelList(body, detectedImageModelListKeys)
        : (existingProvider?.detectedImageModels || existingProvider?.detected_image_models || imageModels);
    const detectedChatSource = hasExplicitProperty(body, detectedChatModelListKeys)
        ? firstExplicitModelList(body, detectedChatModelListKeys)
        : (existingProvider?.detectedChatModels || existingProvider?.detected_chat_models || chatModels);
    const detectedVideoSource = hasExplicitProperty(body, detectedVideoModelListKeys)
        ? firstExplicitModelList(body, detectedVideoModelListKeys)
        : (existingProvider?.detectedVideoModels || existingProvider?.detected_video_models || videoModels);
    const detectedImageModels = normalizeModelsList(detectedImageSource, '');
    const detectedChatModels = normalizeModelsList(detectedChatSource, '');
    const detectedVideoModels = normalizeModelsList(detectedVideoSource, '');
    const detectedUnknownModels = normalizeModelsList(
        body.detectedUnknownModels || body.detected_unknown_models || body.discoveredUnknownModels || body.discovered_unknown_models || existingProvider?.detectedUnknownModels || existingProvider?.detected_unknown_models,
        ''
    );
    const visionModels = normalizeModelsList(
        body.visionModels || body.vision_models || body.chatVisionModels || body.chat_vision_models || existingProvider?.visionModels || existingProvider?.vision_models,
        ''
    );
    const modelDisplayNameKeys = ['modelDisplayNames', 'model_display_names'];
    const modelDisplayNames = normalizeModelDisplayNames(
        hasExplicitProperty(body, modelDisplayNameKeys)
            ? (body.modelDisplayNames ?? body.model_display_names)
            : (existingProvider?.modelDisplayNames ?? existingProvider?.model_display_names ?? {})
    );
    const vendor = normalizeProviderVendor(body.vendor || existingProvider?.vendor || existingProvider?.provider, 'openai');
    const vendorLabel = normalizeProviderVendorLabel(
        body.vendorLabel || body.vendor_label || body.vendorName || body.vendor_name
        || existingProvider?.vendorLabel || existingProvider?.vendor_label
        || (String(existingProvider?.vendor || existingProvider?.provider || '').trim().toLowerCase() === 'sub2api' ? 'Sub2API' : '')
    );
    const protocol = normalizeProviderProtocol(body.protocol || body.adapter || existingProvider?.protocol || existingProvider?.adapter);
    const asyncResult = body.asyncResult || body.async_result || body.polling || existingProvider?.asyncResult || existingProvider?.async_result || null;
    const videoEndpoint = normalizeEndpointPath(pickEndpointValue(
        body,
        ['videoEndpoint', 'video_endpoint', 'videoGenerationEndpoint', 'video_generation_endpoint'],
        existingProvider?.videoEndpoint || existingProvider?.video_endpoint || existingProvider?.videoGenerationEndpoint || existingProvider?.video_generation_endpoint
    ));
    const endpoints = normalizeEndpoints(
        Object.prototype.hasOwnProperty.call(body, 'endpoints')
            ? body.endpoints
            : (existingProvider?.endpoints || {})
    );

    if (resolvedApiKey.length < 10) {
        const error = new Error('请先录入有效的 AI 图片 API Key');
        error.statusCode = 400;
        throw error;
    }

    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        const error = new Error('请输入有效的 AI 图片 API Base URL');
        error.statusCode = 400;
        throw error;
    }

    if (vendor === 'custom' && !vendorLabel) {
        const error = new Error('请输入自定义模型厂商名称');
        error.statusCode = 400;
        throw error;
    }

    const metadata = {
        providerId,
        label: normalizeProviderLabel(body.label || existingProvider?.label, providerId),
        provider: 'openai-compatible',
        vendor,
        protocol,
        modelGroup,
        model_group: modelGroup,
        baseUrl,
        model,
        models: imageModels,
        imageModels,
        image_models: imageModels,
        chatModels,
        chat_models: chatModels,
        videoModels,
        video_models: videoModels,
        detectedImageModels,
        detected_image_models: detectedImageModels,
        detectedChatModels,
        detected_chat_models: detectedChatModels,
        detectedVideoModels,
        detected_video_models: detectedVideoModels,
        detectedUnknownModels,
        detected_unknown_models: detectedUnknownModels,
        visionModels,
        vision_models: visionModels,
        isActive: normalizeBoolean(body.isActive ?? body.is_active ?? existingProvider?.isActive, true),
        displayOrder: normalizeInteger(body.displayOrder ?? body.display_order ?? existingProvider?.displayOrder, 0),
        saved_via: 'admin_studio'
    };
    if (Object.keys(modelDisplayNames).length) {
        metadata.modelDisplayNames = modelDisplayNames;
        metadata.model_display_names = modelDisplayNames;
    }
    if (vendorLabel) {
        metadata.vendorLabel = vendorLabel;
        metadata.vendor_label = vendorLabel;
    }
    if (asyncResult) {
        metadata.asyncResult = asyncResult;
        metadata.async_result = asyncResult;
    }
    if (videoEndpoint) {
        metadata.videoEndpoint = videoEndpoint;
        metadata.video_endpoint = videoEndpoint;
    }
    if (Object.keys(endpoints).length) {
        metadata.endpoints = endpoints;
    }

    await upsertStoredAdminSecret({
        supabase,
        secretKey,
        secretValue: resolvedApiKey,
        adminId: user.id,
        description: providerId === 'default'
            ? 'AI image default model API key managed from Admin Studio'
            : `AI image provider ${providerId} API key managed from Admin Studio`,
        metadata
    });

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        actionType: 'admin.ai_image_model_provider.upsert',
        details: {
            providerId,
            baseUrl,
            model,
            models,
            imageModels,
            chatModels,
            videoModels,
            modelDisplayNames,
            detectedImageModels,
            detectedChatModels,
            detectedVideoModels,
            detectedUnknownModels,
            visionModels,
            modelGroup,
            vendor,
            vendorLabel,
            protocol
        }
    });
}

module.exports = async function aiImageModelConfigHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method === 'GET') {
            const config = await resolveAiImageRuntimeSecretConfig(supabase);
            const providers = await listProviders(supabase);
            return sendJson(res, 200, serializeConfig(config, providers));
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const apiKey = String(body.apiKey || '').trim();
            const currentConfig = await resolveAiImageRuntimeSecretConfig(supabase);
            currentConfig.providers = typeof listStoredAiImageProviderSecrets === 'function'
                ? await listStoredAiImageProviderSecrets(supabase, {
                    allowDecryptFailure: true
                }).catch(() => [])
                : [];
            const action = String(body.action || '').trim().toLowerCase();

            if (['test-model', 'test', 'probe', 'probe-model'].includes(action)) {
                return await handleModelAvailabilityCheck({
                    body,
                    currentConfig,
                    sendJson,
                    res
                });
            }

            if (['discover-models', 'discover', 'list-models'].includes(action)) {
                return await handleModelDiscoveryOnly({
                    body,
                    currentConfig,
                    sendJson,
                    res
                });
            }

            await upsertProvider({
                supabase,
                user,
                body: {
                    ...body,
                    apiKey
                },
                currentConfig
            });

            const config = await resolveAiImageRuntimeSecretConfig(supabase);
            const providers = await listProviders(supabase);
            return sendJson(res, 200, {
                ...serializeConfig(config, providers),
                message: 'AI 图片模型供应商配置已安全保存到服务端。'
            });
        }

        if (req.method === 'DELETE') {
            const providerId = normalizeProviderId(req.query?.providerId || req.query?.provider_id || 'default');
            const secretKey = getProviderSecretKey(providerId);
            const currentConfig = await resolveAiImageRuntimeSecretConfig(supabase);
            const providers = typeof listStoredAiImageProviderSecrets === 'function'
                ? await listStoredAiImageProviderSecrets(supabase, {
                    allowDecryptFailure: true
                }).catch(() => [])
                : [];
            const hasStoredProvider = providerId === 'default'
                ? currentConfig.source === 'stored'
                : providers.some((provider) => normalizeProviderId(provider.providerId || provider.provider_id) === providerId);
            if (!hasStoredProvider) {
                return sendJson(res, 400, {
                    success: false,
                    message: '当前没有可删除的后台存储 AI 图片模型供应商配置'
                });
            }

            await deleteStoredAdminSecret(supabase, secretKey);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'ai-image',
                actionType: 'admin.ai_image_model_provider.delete',
                details: {
                    providerId,
                    secretKey
                }
            });

            const nextConfig = await resolveAiImageRuntimeSecretConfig(supabase);
            const nextProviders = await listProviders(supabase);
            return sendJson(res, 200, {
                ...serializeConfig(nextConfig, nextProviders),
                message: nextConfig.source === 'environment'
                    ? '已删除后台存储 AI 图片模型供应商配置，当前回退到环境变量。'
                    : '已删除后台存储 AI 图片模型供应商配置。'
            });
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: redactSensitiveText(error.message || 'AI image model config management failed'),
            code: error.code || 'ai_image_model_config_error',
            check: error.latencyMs ? {
                ok: false,
                latencyMs: error.latencyMs
            } : undefined,
            error: redactSensitiveValue(error.details || null)
        });
    }
};

module.exports._test = {
    runModelAvailabilityCheck,
    discoverOpenAiCompatibleModels,
    discoverGeminiNativeModels
};
module.exports.discoverOpenAiCompatibleModels = discoverOpenAiCompatibleModels;
module.exports.discoverGeminiNativeModels = discoverGeminiNativeModels;
module.exports.isGeminiNativeBaseUrl = isGeminiNativeBaseUrl;
module.exports.runModelAvailabilityCheck = runModelAvailabilityCheck;
