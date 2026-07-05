const crypto = require('crypto');
const {
    normalizeSiteValue,
    SUPPORTED_SITES
} = require('./site');

const SECRET_ALGORITHM = 'aes-256-gcm';
const GEMINI_SECRET_KEY = 'gemini_api_key';
const CODEX_SECRET_KEY = 'codex_api_key';
const AI_IMAGE_SECRET_KEY = 'ai_image_api_key';
const AI_IMAGE_PROVIDER_SECRET_PREFIX = 'ai_image_provider__';
const PAYMENT_CHANNEL_SECRET_KEYS = {
    afdian_token: 'payment_provider_afdian_token',
    hupijiao_api_key: 'payment_provider_hupijiao_api_key',
    hupijiao_secret_key: 'payment_provider_hupijiao_secret_key',
    zpay_pkey: 'payment_provider_zpay_pkey',
    nowpayments_api_key: 'payment_provider_nowpayments_api_key',
    nowpayments_ipn_secret: 'payment_provider_nowpayments_ipn_secret'
};
const OPS_ALERT_SECRET_KEYS = {
    telegram_bot_token: 'ops_alert_telegram_bot_token',
    feishu_webhook_url: 'ops_alert_feishu_webhook_url',
    email_api_key: 'ops_alert_email_api_key'
};
const SUPPORTED_PAYMENT_SECRET_SITES = new Set(SUPPORTED_SITES || ['cn', 'intl']);
const AI_IMAGE_SECRET_CACHE_TTL_MS = 15000;
const AI_IMAGE_SECRET_CACHE_MAX_ENTRIES = 32;
const aiImageRuntimeSecretConfigCache = createTimedCloneCache({
    ttlMs: AI_IMAGE_SECRET_CACHE_TTL_MS,
    maxEntries: AI_IMAGE_SECRET_CACHE_MAX_ENTRIES
});
const aiImageProviderSecretsCache = createTimedCloneCache({
    ttlMs: AI_IMAGE_SECRET_CACHE_TTL_MS,
    maxEntries: AI_IMAGE_SECRET_CACHE_MAX_ENTRIES
});
const aiImageProviderPublicMetadataCache = createTimedCloneCache({
    ttlMs: AI_IMAGE_SECRET_CACHE_TTL_MS,
    maxEntries: AI_IMAGE_SECRET_CACHE_MAX_ENTRIES
});
const aiImageProviderRuntimeConfigCache = createTimedCloneCache({
    ttlMs: AI_IMAGE_SECRET_CACHE_TTL_MS,
    maxEntries: AI_IMAGE_SECRET_CACHE_MAX_ENTRIES
});

function cloneSecretCacheValue(value) {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (_) {
            // Fall through to the JSON clone for simple config payloads.
        }
    }

    return JSON.parse(JSON.stringify(value));
}

function createTimedCloneCache({ ttlMs = 0, maxEntries = 32 } = {}) {
    const entries = new Map();

    function isFresh(entry, nowMs = Date.now()) {
        return Boolean(entry?.hasValue) && ttlMs > 0 && nowMs - Number(entry.cachedAt || 0) <= ttlMs;
    }

    function trim(nowMs = Date.now()) {
        if (entries.size <= maxEntries) return;

        for (const [key, entry] of entries.entries()) {
            if (!entry?.promise && !isFresh(entry, nowMs)) {
                entries.delete(key);
            }
        }

        while (entries.size > maxEntries) {
            const oldestKey = entries.keys().next().value;
            if (!oldestKey) break;
            entries.delete(oldestKey);
        }
    }

    async function getOrLoad(key, loader) {
        const normalizedKey = String(key || '').trim();
        if (!ttlMs || !normalizedKey || typeof loader !== 'function') {
            return {
                status: 'disabled',
                value: await loader()
            };
        }

        const nowMs = Date.now();
        const existing = entries.get(normalizedKey);
        if (isFresh(existing, nowMs)) {
            return {
                status: 'hit',
                value: cloneSecretCacheValue(existing.value)
            };
        }

        if (existing?.promise) {
            return {
                status: 'wait',
                value: cloneSecretCacheValue(await existing.promise)
            };
        }

        const loadPromise = Promise.resolve().then(loader);
        entries.set(normalizedKey, {
            cachedAt: nowMs,
            hasValue: false,
            promise: loadPromise
        });
        trim(nowMs);

        try {
            const value = await loadPromise;
            const cachedValue = cloneSecretCacheValue(value);
            entries.set(normalizedKey, {
                cachedAt: Date.now(),
                hasValue: true,
                value: cachedValue
            });
            trim();

            return {
                status: existing ? 'refresh' : 'miss',
                value: cloneSecretCacheValue(cachedValue)
            };
        } catch (error) {
            if (existing) {
                entries.set(normalizedKey, existing);
            } else {
                entries.delete(normalizedKey);
            }
            throw error;
        }
    }

    function clear() {
        entries.clear();
    }

    return {
        clear,
        getOrLoad
    };
}

const secretCacheObjectIds = new WeakMap();
let nextSecretCacheObjectId = 1;

function getSecretCacheObjectId(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        return '';
    }

    let id = secretCacheObjectIds.get(value);
    if (!id) {
        id = String(nextSecretCacheObjectId += 1);
        secretCacheObjectIds.set(value, id);
    }
    return id;
}

function normalizeAiImageSecretCacheEnv(env = process.env) {
    return {
        adminConfigEncryptionKey: String(env?.ADMIN_CONFIG_ENCRYPTION_KEY || '').trim(),
        aiImageApiKey: String(env?.AI_IMAGE_API_KEY || '').trim(),
        aiImageApiBaseUrl: String(env?.AI_IMAGE_API_BASE_URL || env?.OPENAI_IMAGE_API_BASE_URL || '').trim(),
        aiImageModel: String(env?.AI_IMAGE_MODEL || env?.OPENAI_IMAGE_MODEL || '').trim()
    };
}

function buildAiImageSecretCacheKey(kind, supabase, env = process.env, extra = {}) {
    return crypto.createHash('sha256').update(JSON.stringify({
        kind,
        supabase: getSecretCacheObjectId(supabase),
        env: normalizeAiImageSecretCacheEnv(env),
        extra
    })).digest('hex');
}

function clearAiImageSecretCaches() {
    aiImageRuntimeSecretConfigCache.clear();
    aiImageProviderSecretsCache.clear();
    aiImageProviderPublicMetadataCache.clear();
    aiImageProviderRuntimeConfigCache.clear();
}

function wrapSecretStoreError(error, fallbackMessage) {
    const message = error?.message || fallbackMessage || 'Admin secret store failed';
    if (message.includes('admin_secret_store')) {
        return new Error('后台密钥仓未初始化，请先执行 20260319_admin_secret_store.sql');
    }
    return new Error(message);
}

function isSecretDecryptAuthenticationError(error) {
    return String(error?.message || '').trim() === 'Unsupported state or unable to authenticate data';
}

function buildSecretDecryptFailureMessage(secretKey = '') {
    const label = secretKey === GEMINI_SECRET_KEY
        ? 'Gemini Key'
        : (secretKey === CODEX_SECRET_KEY
            ? 'Codex API Key'
            : (secretKey === AI_IMAGE_SECRET_KEY ? 'AI 图片 API Key' : '后台密钥'));
    return `${label} 无法解密。通常是 ADMIN_CONFIG_ENCRYPTION_KEY 已轮换，请重新录入该密钥。`;
}

function readIndependentSecret(secretValue, label, env = process.env) {
    const normalizedSecret = String(secretValue || '').trim();
    if (!normalizedSecret) return '';

    const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (serviceRoleKey && normalizedSecret === serviceRoleKey) {
        throw new Error(`${label} 不能复用 SUPABASE_SERVICE_ROLE_KEY，请配置独立密钥`);
    }

    return normalizedSecret;
}

function getEncryptionSeed(env = process.env) {
    return readIndependentSecret(
        env?.ADMIN_CONFIG_ENCRYPTION_KEY,
        'ADMIN_CONFIG_ENCRYPTION_KEY'
    );
}

function getEncryptionKey(env = process.env) {
    const seed = getEncryptionSeed(env);
    if (!seed) {
        throw new Error('请先配置独立的 ADMIN_CONFIG_ENCRYPTION_KEY，用于加密后台密钥存储');
    }

    return crypto.createHash('sha256').update(seed).digest();
}

function encryptSecretValue(value, env = process.env) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error('Secret value is required');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(SECRET_ALGORITHM, getEncryptionKey(env), iv);
    const ciphertext = Buffer.concat([
        cipher.update(normalized, 'utf8'),
        cipher.final()
    ]);

    return {
        version: 1,
        algorithm: SECRET_ALGORITHM,
        iv: iv.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
    };
}

function decryptSecretValue(payload, env = process.env) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Stored secret payload is invalid');
    }

    if (payload.algorithm !== SECRET_ALGORITHM) {
        throw new Error('Unsupported secret encryption algorithm');
    }

    const decipher = crypto.createDecipheriv(
        SECRET_ALGORITHM,
        getEncryptionKey(env),
        Buffer.from(String(payload.iv || ''), 'base64')
    );
    decipher.setAuthTag(Buffer.from(String(payload.tag || ''), 'base64'));

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(String(payload.ciphertext || ''), 'base64')),
        decipher.final()
    ]);

    return plaintext.toString('utf8');
}

async function getStoredAdminSecret(supabase, secretKey, options = {}) {
    const { data, error } = await supabase
        .from('admin_secret_store')
        .select('secret_key, encrypted_value, metadata, description, updated_at, updated_by')
        .eq('secret_key', secretKey);

    if (error) {
        throw wrapSecretStoreError(error, 'Failed to load admin secret');
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    try {
        return {
            ...row,
            value: decryptSecretValue(row.encrypted_value),
            decryptErrorMessage: ''
        };
    } catch (error) {
        if (options.allowDecryptFailure === true && isSecretDecryptAuthenticationError(error)) {
            return {
                ...row,
                value: '',
                decryptErrorMessage: buildSecretDecryptFailureMessage(secretKey)
            };
        }
        throw error;
    }
}

async function upsertStoredAdminSecret({
    supabase,
    secretKey,
    secretValue,
    adminId,
    description = '',
    metadata = {}
}) {
    const payload = {
        secret_key: secretKey,
        encrypted_value: encryptSecretValue(secretValue),
        metadata,
        description: description || null,
        updated_by: adminId,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('admin_secret_store')
        .upsert(payload, { onConflict: 'secret_key' });

    if (error) {
        throw wrapSecretStoreError(error, 'Failed to save admin secret');
    }

    clearAiImageSecretCaches();
}

async function deleteStoredAdminSecret(supabase, secretKey) {
    const { error } = await supabase
        .from('admin_secret_store')
        .delete()
        .eq('secret_key', secretKey);

    if (error) {
        throw wrapSecretStoreError(error, 'Failed to delete admin secret');
    }

    clearAiImageSecretCaches();
}

function normalizePaymentSecretSite(value, options = {}) {
    const allowEmpty = options.allowEmpty === true;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return allowEmpty ? '' : 'cn';
    }
    return normalizeSiteValue(normalized, { fallback: allowEmpty ? '' : 'cn' });
}

function buildPaymentSiteSecretKey(secretName, site = 'cn') {
    const baseSecretKey = PAYMENT_CHANNEL_SECRET_KEYS[secretName];
    if (!baseSecretKey) {
        return '';
    }
    const normalizedSite = normalizePaymentSecretSite(site, { allowEmpty: false });
    return `${baseSecretKey}__${normalizedSite}`;
}

function getPaymentSecretLookupKeys(secretName, site = '') {
    const baseSecretKey = PAYMENT_CHANNEL_SECRET_KEYS[secretName];
    if (!baseSecretKey) {
        return [];
    }

    const normalizedSite = normalizePaymentSecretSite(site, { allowEmpty: true });
    const keys = [];
    if (SUPPORTED_PAYMENT_SECRET_SITES.has(normalizedSite)) {
        keys.push(buildPaymentSiteSecretKey(secretName, normalizedSite));
    }
    keys.push(baseSecretKey);
    return Array.from(new Set(keys.filter(Boolean)));
}

async function resolveStoredPaymentSecret(supabase, secretName, options = {}) {
    const lookupKeys = getPaymentSecretLookupKeys(secretName, options.site);

    for (const candidateKey of lookupKeys) {
        const storedSecret = await getStoredAdminSecret(supabase, candidateKey).catch(() => null);
        if (!storedSecret?.value) {
            continue;
        }

        const scopedSite = candidateKey === PAYMENT_CHANNEL_SECRET_KEYS[secretName]
            ? ''
            : normalizePaymentSecretSite(candidateKey.split('__').slice(-1)[0], { allowEmpty: true });

        return {
            ...storedSecret,
            secret_name: secretName,
            secret_key: candidateKey,
            site: scopedSite || null,
            scope: scopedSite ? 'site' : 'global'
        };
    }

    return null;
}

async function resolveGeminiRuntimeConfig(supabase) {
    let storedSecret = null;

    try {
        storedSecret = await getStoredAdminSecret(supabase, GEMINI_SECRET_KEY, {
            allowDecryptFailure: true
        });
    } catch (error) {
        if (!process.env.GEMINI_API_KEY) {
            throw error;
        }
    }

    const envApiKey = String(process.env.GEMINI_API_KEY || '').trim();
    const apiKey = storedSecret?.value || envApiKey || '';
    const source = storedSecret?.value
        ? 'stored'
        : (envApiKey ? 'environment' : 'missing');
    const configured = Boolean(apiKey);
    const storedModel = typeof storedSecret?.metadata?.model === 'string'
        ? storedSecret.metadata.model.trim()
        : '';
    const model = storedModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    return {
        configured,
        source,
        model,
        apiKey,
        updatedAt: storedSecret?.updated_at || null,
        updatedBy: storedSecret?.updated_by || null,
        decryptErrorMessage: storedSecret?.decryptErrorMessage || ''
    };
}

function normalizeOptionalUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeAiImageProviderId(value = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return normalized || 'default';
}

function buildAiImageProviderSecretKey(providerId = 'default') {
    return `${AI_IMAGE_PROVIDER_SECRET_PREFIX}${normalizeAiImageProviderId(providerId)}`;
}

function parseDelimitedList(value = '') {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeAiImageModelsList(...values) {
    const models = [];
    const seen = new Set();
    for (const value of values) {
        for (const model of parseDelimitedList(value)) {
            const key = model.toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            models.push(model.slice(0, 160));
        }
    }
    return models;
}

function hasAiImageModelsListValue(...values) {
    return values.some((value) => parseDelimitedList(value).length > 0);
}

function normalizeAiImageModelGroup(value = '', fallback = 'image') {
    const normalized = String(value || '').trim().toLowerCase();
    if (['image', 'chat', 'video', 'both'].includes(normalized)) return normalized;
    return ['image', 'chat', 'video', 'both'].includes(fallback) ? fallback : 'image';
}

function hasExplicitAiImageModelGroup(value = '') {
    return ['image', 'chat', 'video', 'both'].includes(String(value || '').trim().toLowerCase());
}

function inferAiImageModelGroup(value = '', imageModels = [], chatModels = [], videoModels = [], fallback = 'image') {
    const normalized = normalizeAiImageModelGroup(value, fallback);
    const hasImageModels = normalizeAiImageModelsList(imageModels).length > 0;
    const hasChatModels = normalizeAiImageModelsList(chatModels).length > 0;
    const hasVideoModels = normalizeAiImageModelsList(videoModels).length > 0;
    if (hasVideoModels && !hasImageModels && !hasChatModels) return 'video';
    if (hasImageModels && hasChatModels) return 'both';
    if (hasChatModels && normalized === 'image') return 'chat';
    if (hasImageModels && normalized === 'chat') return 'image';
    if (hasVideoModels && normalized !== 'video') return 'video';
    return normalized;
}

function scopeAiImageModelsByModelGroup(modelGroup = 'image', imageModels = [], chatModels = [], videoModels = []) {
    const group = normalizeAiImageModelGroup(modelGroup, 'image');
    return {
        modelGroup: group,
        imageModels: group === 'chat' || group === 'video' ? [] : normalizeAiImageModelsList(imageModels),
        chatModels: group === 'image' || group === 'video' ? [] : normalizeAiImageModelsList(chatModels),
        videoModels: normalizeAiImageModelsList(videoModels)
    };
}

function normalizeAiImageProviderProtocol(value = '', fallback = 'openai-compatible') {
    const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (['openai-compatible', 'gemini-native', 'anthropic-native', 'custom'].includes(normalized)) {
        return normalized;
    }
    return fallback;
}

function normalizeAiImageEndpointPath(value = '') {
    const raw = String(value || '').trim().slice(0, 500);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
    return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeAiImageEndpoints(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, endpoint]) => [String(key || '').trim(), normalizeAiImageEndpointPath(endpoint)])
            .filter(([key, endpoint]) => key && endpoint)
    );
}

function providerSupportsModelGroup(provider = {}, group = 'image') {
    const requested = normalizeAiImageModelGroup(group, 'image');
    const configured = normalizeAiImageModelGroup(provider.modelGroup || provider.model_group, 'image');
    return (requested !== 'video' && configured === 'both') || configured === requested;
}

function normalizeAiImageProviderMetadata(metadata = {}, fallback = {}) {
    const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const providerId = normalizeAiImageProviderId(source.providerId || source.provider_id || fallback.providerId || fallback.provider_id || source.id);
    const model = String(source.model || fallback.model || '').trim().slice(0, 160);
    const models = normalizeAiImageModelsList(source.models, source.model_aliases, source.modelAliases, model ? [model] : []);
    const chatModels = normalizeAiImageModelsList(source.chatModels, source.chat_models, source.chat_model_aliases, source.chatModelAliases);
    const videoModels = normalizeAiImageModelsList(source.videoModels, source.video_models, source.video_model_aliases, source.videoModelAliases);
    const rawModelGroup = source.modelGroup || source.model_group || fallback.modelGroup || fallback.model_group;
    const configuredModelGroup = normalizeAiImageModelGroup(rawModelGroup, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
    const hasExplicitImageModels = hasAiImageModelsListValue(
        source.imageModels,
        source.image_models,
        source.image_model_aliases,
        source.imageModelAliases
    );
    const imageModels = configuredModelGroup === 'chat' && !hasExplicitImageModels
        ? []
        : normalizeAiImageModelsList(source.imageModels, source.image_models, source.image_model_aliases, source.imageModelAliases, source.models, source.model_aliases, source.modelAliases, model ? [model] : []);
    const modelGroup = hasExplicitAiImageModelGroup(rawModelGroup)
        ? configuredModelGroup
        : inferAiImageModelGroup(configuredModelGroup, imageModels, chatModels, videoModels, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
    const scopedModels = scopeAiImageModelsByModelGroup(modelGroup, imageModels, chatModels, videoModels);
    const detectedImageModels = normalizeAiImageModelsList(
        source.detectedImageModels,
        source.detected_image_models,
        source.discoveredImageModels,
        source.discovered_image_models,
        scopedModels.imageModels
    );
    const detectedChatModels = normalizeAiImageModelsList(
        source.detectedChatModels,
        source.detected_chat_models,
        source.discoveredChatModels,
        source.discovered_chat_models,
        scopedModels.chatModels
    );
    const detectedVideoModels = normalizeAiImageModelsList(
        source.detectedVideoModels,
        source.detected_video_models,
        source.discoveredVideoModels,
        source.discovered_video_models,
        scopedModels.videoModels
    );
    const detectedUnknownModels = normalizeAiImageModelsList(
        source.detectedUnknownModels,
        source.detected_unknown_models,
        source.discoveredUnknownModels,
        source.discovered_unknown_models,
        source.unknownModels,
        source.unknown_models
    );
    const videoEndpoint = normalizeAiImageEndpointPath(
        source.videoEndpoint
        || source.video_endpoint
        || source.videoGenerationEndpoint
        || source.video_generation_endpoint
        || fallback.videoEndpoint
        || fallback.video_endpoint
        || fallback.videoGenerationEndpoint
        || fallback.video_generation_endpoint
    );
    const endpoints = normalizeAiImageEndpoints(source.endpoints || fallback.endpoints);
    return {
        providerId,
        label: String(source.label || fallback.label || providerId).trim().slice(0, 120) || providerId,
        baseUrl: normalizeOptionalUrl(source.baseUrl || source.base_url || fallback.baseUrl || fallback.base_url || 'https://api.openai.com/v1'),
        model,
        models: scopedModels.imageModels.length ? scopedModels.imageModels : (scopedModels.modelGroup === 'chat' ? [] : models),
        imageModels: scopedModels.imageModels,
        chatModels: scopedModels.chatModels,
        videoModels: scopedModels.videoModels,
        detectedImageModels,
        detected_image_models: detectedImageModels,
        detectedChatModels,
        detected_chat_models: detectedChatModels,
        detectedVideoModels,
        detected_video_models: detectedVideoModels,
        detectedUnknownModels,
        detected_unknown_models: detectedUnknownModels,
        modelGroup: scopedModels.modelGroup,
        model_group: scopedModels.modelGroup,
        vendor: String(source.vendor || fallback.vendor || source.provider || fallback.provider || 'openai').trim().toLowerCase().slice(0, 80) || 'openai',
        protocol: normalizeAiImageProviderProtocol(source.protocol || source.adapter || fallback.protocol || fallback.adapter),
        provider: String(source.provider || fallback.provider || 'openai-compatible').trim().slice(0, 80) || 'openai-compatible',
        asyncResult: source.asyncResult || source.async_result || source.polling || fallback.asyncResult || fallback.async_result || fallback.polling || null,
        async_result: source.asyncResult || source.async_result || source.polling || fallback.asyncResult || fallback.async_result || fallback.polling || null,
        videoEndpoint,
        video_endpoint: videoEndpoint,
        endpoints,
        isActive: source.isActive === false || source.is_active === false ? false : true,
        displayOrder: Number.isFinite(Number(source.displayOrder ?? source.display_order ?? fallback.displayOrder ?? fallback.display_order))
            ? Number(source.displayOrder ?? source.display_order ?? fallback.displayOrder ?? fallback.display_order)
            : 0,
        saved_via: source.saved_via || fallback.saved_via || ''
    };
}

function normalizeCodexApiFormat(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'responses' ? 'responses' : 'chat.completions';
}

async function resolveCodexRuntimeConfig(supabase) {
    let storedSecret = null;

    try {
        storedSecret = await getStoredAdminSecret(supabase, CODEX_SECRET_KEY, {
            allowDecryptFailure: true
        });
    } catch (error) {
        if (!process.env.CODEX_API_KEY) {
            throw error;
        }
    }

    const envApiKey = String(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    const envBaseUrl = normalizeOptionalUrl(
        process.env.CODEX_API_BASE_URL
        || process.env.OPENAI_API_BASE_URL
        || process.env.OPENAI_BASE_URL
    );
    const envModel = String(process.env.CODEX_MODEL || process.env.OPENAI_MODEL || '').trim();
    const envApiFormat = normalizeCodexApiFormat(
        process.env.CODEX_API_FORMAT
        || process.env.OPENAI_API_FORMAT
        || process.env.OPENAI_WIRE_API
        || 'responses'
    );
    const metadata = storedSecret?.metadata && typeof storedSecret.metadata === 'object'
        ? storedSecret.metadata
        : {};
    const apiKey = storedSecret?.value || envApiKey || '';
    const baseUrl = normalizeOptionalUrl(metadata.baseUrl || metadata.base_url || envBaseUrl);
    const source = storedSecret?.value
        ? 'stored'
        : (envApiKey ? 'environment' : 'missing');
    const configured = Boolean(apiKey && baseUrl);
    const model = String(metadata.model || envModel || 'gpt-5.4').trim() || 'gpt-5.4';
    const apiFormat = normalizeCodexApiFormat(metadata.apiFormat || metadata.api_format || envApiFormat || 'responses');

    return {
        configured,
        source,
        model,
        apiKey,
        baseUrl,
        apiFormat,
        updatedAt: storedSecret?.updated_at || null,
        updatedBy: storedSecret?.updated_by || null,
        decryptErrorMessage: storedSecret?.decryptErrorMessage || ''
    };
}

async function resolveAiImageRuntimeSecretConfig(supabase, options = {}) {
    const env = options.env || process.env;
    const cacheKey = buildAiImageSecretCacheKey('runtime-secret', supabase, env, {
        allowDecryptFailure: options.allowDecryptFailure === true
    });

    const cached = await aiImageRuntimeSecretConfigCache.getOrLoad(cacheKey, async () => {
        let storedSecret = null;

        try {
            storedSecret = await getStoredAdminSecret(supabase, AI_IMAGE_SECRET_KEY, {
                allowDecryptFailure: true
            });
        } catch (error) {
            if (!env.AI_IMAGE_API_KEY) {
                throw error;
            }
        }

        const metadata = storedSecret?.metadata && typeof storedSecret.metadata === 'object'
            ? storedSecret.metadata
            : {};
        const envApiKey = String(env.AI_IMAGE_API_KEY || '').trim();
        const envBaseUrl = normalizeOptionalUrl(
            env.AI_IMAGE_API_BASE_URL
            || env.OPENAI_IMAGE_API_BASE_URL
        );
        const envModel = String(env.AI_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL || '').trim();
        const apiKey = envApiKey || storedSecret?.value || '';
        const source = envApiKey
            ? 'environment'
            : (storedSecret?.value ? 'stored' : 'missing');
        const baseUrl = source === 'environment'
            ? normalizeOptionalUrl(envBaseUrl || 'https://api.openai.com/v1')
            : normalizeOptionalUrl(metadata.baseUrl || metadata.base_url || 'https://api.openai.com/v1');
        const model = String(
            source === 'environment'
                ? (envModel || 'gpt-image-2')
                : (metadata.model || 'gpt-image-2')
        ).trim() || 'gpt-image-2';
        const imageModels = normalizeAiImageModelsList(metadata.imageModels, metadata.image_models, metadata.image_model_aliases, metadata.imageModelAliases, metadata.models, metadata.model_aliases, model);
        const chatModels = normalizeAiImageModelsList(metadata.chatModels, metadata.chat_models, metadata.chat_model_aliases, metadata.chatModelAliases);
        const videoModels = normalizeAiImageModelsList(metadata.videoModels, metadata.video_models, metadata.video_model_aliases, metadata.videoModelAliases);
        const rawModelGroup = metadata.modelGroup || metadata.model_group;
        const configuredModelGroup = normalizeAiImageModelGroup(rawModelGroup, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
        const modelGroup = hasExplicitAiImageModelGroup(rawModelGroup)
            ? configuredModelGroup
            : inferAiImageModelGroup(configuredModelGroup, imageModels, chatModels, videoModels, videoModels.length && !chatModels.length ? 'video' : (chatModels.length ? 'both' : 'image'));
        const scopedModels = scopeAiImageModelsByModelGroup(modelGroup, imageModels, chatModels, videoModels);

        return {
            configured: Boolean(apiKey && baseUrl),
            source,
            providerId: metadata.providerId || metadata.provider_id || 'default',
            label: metadata.label || 'Default',
            models: scopedModels.imageModels.length
                ? scopedModels.imageModels
                : (scopedModels.modelGroup === 'chat' ? [] : normalizeAiImageModelsList(metadata.models, metadata.model_aliases, model)),
            imageModels: scopedModels.imageModels,
            image_models: scopedModels.imageModels,
            chatModels: scopedModels.chatModels,
            chat_models: scopedModels.chatModels,
            videoModels: scopedModels.videoModels,
            video_models: scopedModels.videoModels,
            modelGroup: scopedModels.modelGroup,
            model_group: scopedModels.modelGroup,
            model,
            apiKey,
            baseUrl,
            videoEndpoint: normalizeAiImageEndpointPath(metadata.videoEndpoint || metadata.video_endpoint || metadata.videoGenerationEndpoint || metadata.video_generation_endpoint),
            video_endpoint: normalizeAiImageEndpointPath(metadata.videoEndpoint || metadata.video_endpoint || metadata.videoGenerationEndpoint || metadata.video_generation_endpoint),
            endpoints: normalizeAiImageEndpoints(metadata.endpoints),
            updatedAt: storedSecret?.updated_at || null,
            updatedBy: storedSecret?.updated_by || null,
            decryptErrorMessage: storedSecret?.decryptErrorMessage || ''
        };
    });

    return cached.value;
}

function serializeAiImageProviderSecret(row = {}, options = {}) {
    const providerId = String(row.secret_key || '').startsWith(AI_IMAGE_PROVIDER_SECRET_PREFIX)
        ? row.secret_key.slice(AI_IMAGE_PROVIDER_SECRET_PREFIX.length)
        : (row.metadata?.providerId || row.metadata?.provider_id || options.providerId || 'default');
    const metadata = normalizeAiImageProviderMetadata(row.metadata, { providerId });
    return {
        configured: Boolean(row.value && metadata.baseUrl),
        source: 'stored',
        secretKey: row.secret_key || buildAiImageProviderSecretKey(metadata.providerId),
        providerId: metadata.providerId,
        label: metadata.label,
        baseUrl: metadata.baseUrl,
        model: metadata.model,
        models: metadata.models,
        imageModels: metadata.imageModels,
        image_models: metadata.imageModels,
        chatModels: metadata.chatModels,
        chat_models: metadata.chatModels,
        videoModels: metadata.videoModels,
        video_models: metadata.videoModels,
        detectedImageModels: metadata.detectedImageModels,
        detected_image_models: metadata.detectedImageModels,
        detectedChatModels: metadata.detectedChatModels,
        detected_chat_models: metadata.detectedChatModels,
        detectedVideoModels: metadata.detectedVideoModels,
        detected_video_models: metadata.detectedVideoModels,
        detectedUnknownModels: metadata.detectedUnknownModels,
        detected_unknown_models: metadata.detectedUnknownModels,
        modelGroup: metadata.modelGroup,
        model_group: metadata.modelGroup,
        vendor: metadata.vendor,
        protocol: metadata.protocol,
        provider: metadata.provider,
        asyncResult: metadata.asyncResult,
        async_result: metadata.asyncResult,
        videoEndpoint: metadata.videoEndpoint,
        video_endpoint: metadata.videoEndpoint,
        endpoints: metadata.endpoints,
        isActive: metadata.isActive,
        displayOrder: metadata.displayOrder,
        apiKey: row.value || '',
        updatedAt: row.updated_at || null,
        updatedBy: row.updated_by || null,
        decryptErrorMessage: row.decryptErrorMessage || ''
    };
}

async function listStoredAiImageProviderSecrets(supabase, options = {}) {
    const env = options.env || process.env;
    const cacheKey = buildAiImageSecretCacheKey('provider-secrets', supabase, env, {
        allowDecryptFailure: options.allowDecryptFailure === true
    });

    const cached = await aiImageProviderSecretsCache.getOrLoad(cacheKey, async () => {
        const rows = [];

        if (supabase?.from) {
            const { data, error } = await supabase
                .from('admin_secret_store')
                .select('secret_key, encrypted_value, metadata, description, updated_at, updated_by')
                .like('secret_key', `${AI_IMAGE_PROVIDER_SECRET_PREFIX}%`);

            if (error) {
                throw wrapSecretStoreError(error, 'Failed to load AI image provider secrets');
            }

            for (const row of (Array.isArray(data) ? data : [])) {
                try {
                    rows.push({
                        ...row,
                        value: decryptSecretValue(row.encrypted_value),
                        decryptErrorMessage: ''
                    });
                } catch (error) {
                    if (options.allowDecryptFailure === true && isSecretDecryptAuthenticationError(error)) {
                        rows.push({
                            ...row,
                            value: '',
                            decryptErrorMessage: buildSecretDecryptFailureMessage(row.secret_key)
                        });
                        continue;
                    }
                    throw error;
                }
            }
        }

        const providers = rows
            .map((row) => serializeAiImageProviderSecret(row))
            .sort((left, right) => {
                const order = Number(left.displayOrder || 0) - Number(right.displayOrder || 0);
                if (order) return order;
                return String(left.label || left.providerId).localeCompare(String(right.label || right.providerId));
            });

        const legacy = await resolveAiImageRuntimeSecretConfig(supabase, { env }).catch(() => null);
        if (legacy?.configured) {
            const legacyProvider = {
                ...legacy,
                source: legacy.source === 'stored' ? 'stored' : legacy.source,
                secretKey: legacy.source === 'stored' ? AI_IMAGE_SECRET_KEY : '',
                providerId: legacy.providerId || 'default',
                label: legacy.label || (legacy.source === 'environment' ? '环境变量默认上游' : '默认上游'),
                models: normalizeAiImageModelsList(legacy.models, legacy.model),
                isActive: true,
                displayOrder: -100
            };
            if (!providers.some((provider) => provider.providerId === legacyProvider.providerId)) {
                providers.unshift(legacyProvider);
            }
        }

        return providers.sort((left, right) => {
            const order = Number(left.displayOrder || 0) - Number(right.displayOrder || 0);
            if (order) return order;
            return String(left.label || left.providerId).localeCompare(String(right.label || right.providerId));
        });
    });

    return Array.isArray(cached.value) ? cached.value : [];
}

async function listStoredAiImageProviderPublicMetadata(supabase, options = {}) {
    const env = options.env || process.env;
    const cacheKey = buildAiImageSecretCacheKey('provider-public-metadata', supabase, env);

    const cached = await aiImageProviderPublicMetadataCache.getOrLoad(cacheKey, async () => {
        const rows = [];

        if (supabase?.from) {
            const { data, error } = await supabase
                .from('admin_secret_store')
                .select('secret_key, metadata, description, updated_at, updated_by')
                .like('secret_key', `${AI_IMAGE_PROVIDER_SECRET_PREFIX}%`);

            if (error) {
                throw wrapSecretStoreError(error, 'Failed to load AI image provider metadata');
            }

            rows.push(...(Array.isArray(data) ? data : []).map((row) => ({
                ...row,
                value: 'configured',
                decryptErrorMessage: ''
            })));
        }

        const providers = rows
            .map((row) => serializeAiImageProviderSecret(row))
            .sort((left, right) => {
                const order = Number(left.displayOrder || 0) - Number(right.displayOrder || 0);
                if (order) return order;
                return String(left.label || left.providerId).localeCompare(String(right.label || right.providerId));
            });

        const legacy = providers.length
            ? null
            : await resolveAiImageRuntimeSecretConfig(supabase, { env }).catch(() => null);
        if (legacy?.configured) {
            const legacyProvider = {
                ...legacy,
                apiKey: '',
                source: legacy.source === 'stored' ? 'stored' : legacy.source,
                secretKey: legacy.source === 'stored' ? AI_IMAGE_SECRET_KEY : '',
                providerId: legacy.providerId || 'default',
                label: legacy.label || (legacy.source === 'environment' ? '环境变量默认上游' : '默认上游'),
                models: normalizeAiImageModelsList(legacy.models, legacy.model),
                isActive: true,
                displayOrder: -100
            };
            if (!providers.some((provider) => provider.providerId === legacyProvider.providerId)) {
                providers.unshift(legacyProvider);
            }
        }

        return providers.sort((left, right) => {
            const order = Number(left.displayOrder || 0) - Number(right.displayOrder || 0);
            if (order) return order;
            return String(left.label || left.providerId).localeCompare(String(right.label || right.providerId));
        });
    });

    return Array.isArray(cached.value) ? cached.value : [];
}

async function resolveAiImageProviderRuntimeConfig(supabase, options = {}) {
    const env = options.env || process.env;
    const task = options.task || {};
    const requestedProviderInput = String(
        options.providerId
        || task.provider_id
        || task.providerId
        || task.metadata?.provider_id
        || task.metadata?.providerId
        || ''
    ).trim();
    const requestedProviderId = requestedProviderInput
        ? normalizeAiImageProviderId(requestedProviderInput)
        : '';
    const requestedModel = String(options.model || task.model || '').trim();
    const requestedGroup = normalizeAiImageModelGroup(
        options.modelGroup
        || options.model_group
        || task.api_model_group
        || task.apiModelGroup
        || task.metadata?.model_group
        || task.metadata?.modelGroup
        || (['reverse', 'chat'].includes(String(task.mode || '').trim()) ? 'chat' : 'image'),
        'image'
    );
    const cacheKey = buildAiImageSecretCacheKey('provider-runtime', supabase, env, {
        providerId: requestedProviderId,
        model: requestedModel,
        modelGroup: requestedGroup
    });

    const cached = await aiImageProviderRuntimeConfigCache.getOrLoad(cacheKey, async () => {
        const envConfig = await resolveAiImageRuntimeSecretConfig(supabase, { env }).catch(() => null);
        if (envConfig?.source === 'environment' && envConfig.configured) {
            return envConfig;
        }

        const providers = await listStoredAiImageProviderSecrets(supabase, {
            env,
            allowDecryptFailure: true
        }).catch(() => []);
        const activeProviders = providers.filter((provider) => provider.isActive !== false && provider.configured);
        const groupedProviders = activeProviders.filter((provider) => providerSupportsModelGroup(provider, requestedGroup));
        const candidates = groupedProviders.length ? groupedProviders : activeProviders;
        const byProviderId = requestedProviderId
            ? candidates.find((provider) => provider.providerId === requestedProviderId)
            : null;
        const normalizedRequestedModel = requestedModel.toLowerCase();
        const byModel = normalizedRequestedModel
            ? candidates.find((provider) => (
                String(provider.model || '').toLowerCase() === normalizedRequestedModel
                || (provider.models || []).some((model) => String(model || '').toLowerCase() === normalizedRequestedModel)
                || (provider.imageModels || provider.image_models || []).some((model) => String(model || '').toLowerCase() === normalizedRequestedModel)
                || (provider.chatModels || provider.chat_models || []).some((model) => String(model || '').toLowerCase() === normalizedRequestedModel)
                || (provider.videoModels || provider.video_models || []).some((model) => String(model || '').toLowerCase() === normalizedRequestedModel)
            ))
            : null;
        const selected = byProviderId || byModel || candidates[0] || envConfig;
        if (!selected) {
            return {
                configured: false,
                source: 'missing',
                providerId: requestedProviderId || 'default',
                label: '',
                model: requestedModel || 'gpt-image-2',
                models: [],
                apiKey: '',
                baseUrl: '',
                updatedAt: null,
                updatedBy: null,
                decryptErrorMessage: ''
            };
        }

        const selectedImageModels = normalizeAiImageModelsList(selected.imageModels || selected.image_models || selected.models);
        const selectedChatModels = normalizeAiImageModelsList(selected.chatModels || selected.chat_models);
        const selectedVideoModels = normalizeAiImageModelsList(selected.videoModels || selected.video_models);
        const fallbackModel = requestedGroup === 'chat'
            ? (selectedChatModels[0] || selected.model || 'gpt-4o-mini')
            : (requestedGroup === 'video'
                ? (selectedVideoModels[0] || selected.model || 'default-video-model')
                : (selectedImageModels[0] || selected.model || 'gpt-image-2'));
        const resolvedModel = requestedModel && !['default-chat-model', 'default-vision-model', 'gpt-image', 'gpt-image-api'].includes(requestedModel)
            ? requestedModel
            : fallbackModel;

        return {
            ...selected,
            model: resolvedModel,
            source: selected.source === 'stored' ? 'ai-image-provider-stored' : selected.source
        };
    });

    return cached.value;
}

module.exports = {
    __testUtils: {
        getEncryptionKey,
        isSecretDecryptAuthenticationError,
        readIndependentSecret
    },
    AI_IMAGE_SECRET_KEY,
    AI_IMAGE_PROVIDER_SECRET_PREFIX,
    CODEX_SECRET_KEY,
    GEMINI_SECRET_KEY,
    OPS_ALERT_SECRET_KEYS,
    PAYMENT_CHANNEL_SECRET_KEYS,
    buildAiImageProviderSecretKey,
    buildPaymentSiteSecretKey,
    deleteStoredAdminSecret,
    decryptSecretValue,
    encryptSecretValue,
    isSecretDecryptAuthenticationError,
    getPaymentSecretLookupKeys,
    getStoredAdminSecret,
    getEncryptionKey,
    normalizePaymentSecretSite,
    resolveCodexRuntimeConfig,
    resolveAiImageRuntimeSecretConfig,
    resolveAiImageProviderRuntimeConfig,
    resolveGeminiRuntimeConfig,
    listStoredAiImageProviderPublicMetadata,
    listStoredAiImageProviderSecrets,
    resolveStoredPaymentSecret,
    upsertStoredAdminSecret
};
