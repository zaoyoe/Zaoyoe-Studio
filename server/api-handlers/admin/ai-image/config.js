const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    normalizeImageModel,
    resolveAiImageRuntimeConfig,
    resolveR2Config
} = require('../../_ai-image-models');
const {
    AI_IMAGE_GUARDRAILS_CONFIG_KEY,
    normalizeAiImageGuardrails,
    normalizeAiImageGuardrailsForSite
} = require('../../_ai-image-guardrails');
const {
    resolveSiteScopedSystemConfigForRead,
    upsertSiteScopedSystemConfigValue
} = require('../../_site-scoped-system-config');
const {
    normalizeAiImagePricingMetadata
} = require('../../_ai-image-pricing');

const AI_IMAGE_STORAGE_POLICY_CONFIG_KEY = 'ai_image_storage_policy';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const SITE_VALUES = Object.freeze(new Set(['all', 'cn', 'intl']));
const TASK_SITE_VALUES = Object.freeze(new Set(['cn', 'intl']));
const MODE_VALUES = Object.freeze(new Set(['text', 'image', 'video', 'reverse', 'chat', 'agent']));
const BILLING_MODE_VALUES = Object.freeze(new Set(['points', 'api']));
const RESOLUTION_VALUES = Object.freeze(new Set(['*', '1k', '2k', '4k', '480p', '720p', '1080p']));
const RATIO_VALUES = Object.freeze(new Set([
    '*',
    '1:1',
    '2:3',
    '3:2',
    '3:4',
    '4:3',
    '9:16',
    '16:9',
    '21:9',
    '9:21'
]));

const AGENT_SELECT = [
    'id',
    'site',
    'slug',
    'name',
    'name_en',
    'description',
    'description_en',
    'system_prompt',
    'mode',
    'default_model',
    'default_ratio',
    'default_resolution',
    'pricing_override',
    'metadata',
    'is_active',
    'display_order',
    'created_by',
    'updated_by',
    'created_at',
    'updated_at'
].join(', ');

const PRICING_SELECT = [
    'id',
    'site',
    'mode',
    'billing_mode',
    'model',
    'resolution',
    'ratio',
    'quantity',
    'points',
    'priority',
    'is_active',
    'metadata',
    'created_by',
    'updated_by',
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
    'created_by',
    'updated_by',
    'created_at',
    'updated_at'
].join(', ');

const API_BASE_URL_TABLE = 'ai_image_api_base_urls';
const API_BASE_URL_TABLE_MISSING_MESSAGE = '用户 API 白名单表尚未创建，请先执行 AI 图片工作台 Supabase 迁移 20260621_ai_image_workbench_core.sql，并刷新 Supabase/PostgREST schema cache。';

const TASK_STATS_SELECT = [
    'id',
    'site',
    'status',
    'mode',
    'billing_mode',
    'model',
    'resolution',
    'ratio',
    'error_code',
    'error_message',
    'created_at',
    'started_at',
    'completed_at',
    'updated_at'
].join(', ');

const RESULT_STORAGE_SELECT = [
    'id',
    'site',
    'image_url',
    'original_image_url',
    'storage_path',
    'original_storage_path',
    'metadata',
    'created_at'
].join(', ');

const DEFAULT_AI_IMAGE_STORAGE_POLICY = Object.freeze({
    previewRetentionDays: 180,
    originalRetentionDays: 365,
    failedRetentionDays: 30,
    warnStorageGb: 8,
    stopStorageGb: 10,
    lifecycleEnabled: false
});

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function isUuid(value = '') {
    return UUID_PATTERN.test(sanitizeText(value, 160));
}

function isSafeRecordId(value = '') {
    return /^[a-z0-9][a-z0-9_-]{0,159}$/i.test(sanitizeText(value, 160));
}

function normalizeSite(value = 'all', { allowAll = true } = {}) {
    const normalized = sanitizeText(value, 20).toLowerCase();
    const allowed = allowAll ? SITE_VALUES : TASK_SITE_VALUES;
    if (allowed.has(normalized)) return normalized;
    return allowAll ? 'all' : 'cn';
}

function normalizeMode(value = 'text') {
    const normalized = sanitizeText(value, 40).toLowerCase();
    return MODE_VALUES.has(normalized) ? normalized : 'text';
}

function normalizeBillingMode(value = 'points') {
    const normalized = sanitizeText(value, 40).toLowerCase();
    return BILLING_MODE_VALUES.has(normalized) ? normalized : 'points';
}

function normalizeResolution(value = '*') {
    const normalized = sanitizeText(value, 20).toLowerCase() || '*';
    return RESOLUTION_VALUES.has(normalized) ? normalized : '*';
}

function normalizeAgentResolution(value = '1k') {
    const normalized = normalizeResolution(value || '1k');
    return normalized === '*' ? '1k' : normalized;
}

function normalizeRatio(value = '*') {
    const normalized = sanitizeText(value, 20).toLowerCase() || '*';
    return RATIO_VALUES.has(normalized) ? normalized : '*';
}

function normalizeBaseUrl(value = '') {
    const raw = sanitizeText(value, 400).replace(/\/+$/, '');
    if (!raw) return '';

    try {
        const url = new URL(raw);
        url.hash = '';
        url.search = '';
        return url.toString().replace(/\/+$/, '');
    } catch (_) {
        return raw;
    }
}

function inferApiBaseUrlLabel(baseUrl = '') {
    const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
    if (normalized.includes('zaoyoe')) return 'Zaoyoe Sub2API';
    if (normalized.includes('fatherkey')) return 'FatherKey Sub2API';
    return 'Sub2API';
}

function isValidApiBaseUrl(value = '') {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch (_) {
        return false;
    }
}

function normalizeAgentRatio(value = '1:1') {
    const normalized = normalizeRatio(value || '1:1');
    return normalized === '*' ? '1:1' : normalized;
}

function normalizeBoolean(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    const normalized = sanitizeText(value, 20).toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled', 'active'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled', 'inactive'].includes(normalized)) return false;
    return fallback;
}

function normalizeInteger(value, fallback = 0, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizePoints(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed * 100) / 100);
}

function normalizeStorageGb(value, fallback = 0, { min = 0, max = 100000 } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
}

function normalizeRetentionDays(value, fallback = 30, { min = 1, max = 3650 } = {}) {
    return normalizeInteger(value, fallback, { min, max });
}

function normalizeIsoDate(value = '') {
    const raw = sanitizeText(value, 80);
    if (!raw) return '';
    const time = Date.parse(raw);
    return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function normalizeJsonObject(value, fieldName = 'metadata') {
    if (value === undefined || value === null || value === '') return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        const error = new Error(`${fieldName} must be an object`);
        error.statusCode = 400;
        throw error;
    }
    return value;
}

function slugify(value = '', fallback = 'agent') {
    const slug = sanitizeText(value, 160)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100);
    return slug || `${fallback}-${Date.now().toString(36)}`;
}

function normalizeAction(value = '') {
    return sanitizeText(value, 80)
        .toLowerCase()
        .replace(/[_\s]+/g, '-');
}

function buildErrorSearchText(error) {
    return [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .join(' ');
}

function isMissingRelationError(error, relationName = '') {
    const normalizedText = buildErrorSearchText(error);
    if (!normalizedText) return false;

    const code = String(error?.code || '').toUpperCase();
    const normalizedRelation = String(relationName || '').trim().toLowerCase();
    const mentionsRelation = normalizedRelation
        ? normalizedText.includes(normalizedRelation) || normalizedText.includes(`public.${normalizedRelation}`)
        : normalizedText.includes('relation') || normalizedText.includes('table') || normalizedText.includes('schema cache');

    return mentionsRelation && (
        code === '42P01'
        || code === 'PGRST205'
        || code === 'PGRST204'
        || normalizedText.includes('schema cache')
        || normalizedText.includes('does not exist')
        || normalizedText.includes('not exist')
        || normalizedText.includes('could not find')
        || normalizedText.includes('undefined table')
    );
}

function createMissingApiBaseUrlTableError() {
    const error = new Error(API_BASE_URL_TABLE_MISSING_MESSAGE);
    error.statusCode = 503;
    error.code = 'ai_image_api_base_urls_missing';
    return error;
}

function serializeAgent(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        site: normalizeSite(row.site),
        slug: sanitizeText(row.slug, 160),
        name: sanitizeText(row.name, 200),
        name_en: sanitizeText(row.name_en, 200),
        description: sanitizeText(row.description, 1200),
        description_en: sanitizeText(row.description_en, 1200),
        system_prompt: sanitizeText(row.system_prompt, 12000),
        mode: normalizeMode(row.mode || 'agent'),
        default_model: sanitizeText(row.default_model, 160),
        default_ratio: normalizeAgentRatio(row.default_ratio),
        default_resolution: normalizeAgentResolution(row.default_resolution),
        pricing_override: normalizeJsonObject(row.pricing_override),
        metadata: normalizeJsonObject(row.metadata),
        is_active: row.is_active !== false,
        display_order: normalizeInteger(row.display_order, 0, { min: -100000, max: 100000 }),
        created_by: sanitizeText(row.created_by, 160),
        updated_by: sanitizeText(row.updated_by, 160),
        created_at: sanitizeText(row.created_at, 120),
        updated_at: sanitizeText(row.updated_at, 120)
    };
}

function serializePricingRule(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        site: normalizeSite(row.site),
        mode: normalizeMode(row.mode),
        billing_mode: normalizeBillingMode(row.billing_mode),
        model: sanitizeText(row.model || '*', 160) || '*',
        resolution: normalizeResolution(row.resolution),
        ratio: normalizeRatio(row.ratio),
        quantity: normalizeInteger(row.quantity, 1, { min: 1, max: 8 }),
        points: normalizePoints(row.points, 0),
        priority: normalizeInteger(row.priority, 100, { min: 0, max: 100000 }),
        is_active: row.is_active !== false,
        metadata: normalizeAiImagePricingMetadata(normalizeJsonObject(row.metadata)),
        created_by: sanitizeText(row.created_by, 160),
        updated_by: sanitizeText(row.updated_by, 160),
        created_at: sanitizeText(row.created_at, 120),
        updated_at: sanitizeText(row.updated_at, 120)
    };
}

function serializeApiBaseUrl(row = {}) {
    const baseUrl = normalizeBaseUrl(row.base_url || row.baseUrl);
    return {
        id: sanitizeText(row.id, 160),
        site: normalizeSite(row.site || 'all'),
        label: sanitizeText(row.label, 160) || inferApiBaseUrlLabel(baseUrl),
        base_url: baseUrl,
        baseUrl,
        is_active: row.is_active !== false,
        isActive: row.is_active !== false,
        display_order: normalizeInteger(row.display_order, 0, { min: 0, max: 100000 }),
        displayOrder: normalizeInteger(row.display_order, 0, { min: 0, max: 100000 }),
        metadata: normalizeJsonObject(row.metadata),
        created_by: sanitizeText(row.created_by, 160),
        updated_by: sanitizeText(row.updated_by, 160),
        created_at: sanitizeText(row.created_at, 120),
        updated_at: sanitizeText(row.updated_at, 120)
    };
}

function buildAgentPayload(body = {}, user = {}) {
    const name = sanitizeText(body.name, 200);
    const slug = slugify(body.slug || body.key || name, 'agent');
    if (!name) {
        const error = new Error('智能体名称不能为空');
        error.statusCode = 400;
        throw error;
    }

    return {
        site: normalizeSite(body.site || 'all'),
        slug,
        name,
        name_en: sanitizeText(body.name_en || body.nameEn, 200),
        description: sanitizeText(body.description, 1200),
        description_en: sanitizeText(body.description_en || body.descriptionEn, 1200),
        system_prompt: sanitizeText(body.system_prompt || body.systemPrompt, 12000),
        mode: normalizeMode(body.mode || 'agent'),
        default_model: sanitizeText(body.default_model || body.defaultModel, 160),
        default_ratio: normalizeAgentRatio(body.default_ratio || body.defaultRatio || body.ratio),
        default_resolution: normalizeAgentResolution(body.default_resolution || body.defaultResolution || body.resolution),
        pricing_override: normalizeJsonObject(body.pricing_override || body.pricingOverride, 'pricing_override'),
        metadata: normalizeJsonObject(body.metadata, 'metadata'),
        is_active: normalizeBoolean(body.is_active ?? body.isActive, true),
        display_order: normalizeInteger(body.display_order || body.displayOrder, 0, { min: -100000, max: 100000 }),
        updated_by: user.id || null
    };
}

function buildApiBaseUrlPayload(body = {}, user = {}) {
    const baseUrl = normalizeBaseUrl(body.base_url || body.baseUrl);
    if (!baseUrl || !isValidApiBaseUrl(baseUrl)) {
        const error = new Error('请输入有效的 Sub2API Base URL');
        error.statusCode = 400;
        throw error;
    }

    return {
        site: normalizeSite(body.site || 'all'),
        label: sanitizeText(body.label, 160) || inferApiBaseUrlLabel(baseUrl),
        base_url: baseUrl,
        is_active: normalizeBoolean(body.is_active ?? body.isActive, true),
        display_order: normalizeInteger(body.display_order ?? body.displayOrder, 0, { min: 0, max: 100000 }),
        metadata: normalizeJsonObject(body.metadata, 'metadata'),
        updated_by: user.id || null
    };
}

function buildPricingPayload(body = {}, user = {}) {
    const billingMode = normalizeBillingMode(body.billing_mode || body.billingMode);
    const points = billingMode === 'api'
        ? 0
        : normalizePoints(body.points ?? body.cost ?? body.estimated_points ?? body.estimatedPoints, 0);

    return {
        site: normalizeSite(body.site || 'all'),
        mode: normalizeMode(body.mode || body.taskMode),
        billing_mode: billingMode,
        model: sanitizeText(body.model || '*', 160) || '*',
        resolution: normalizeResolution(body.resolution),
        ratio: normalizeRatio(body.ratio || body.aspect_ratio || body.aspectRatio),
        quantity: normalizeInteger(body.quantity || body.count || body.n, 1, { min: 1, max: 8 }),
        points,
        priority: normalizeInteger(body.priority, 100, { min: 0, max: 100000 }),
        is_active: normalizeBoolean(body.is_active ?? body.isActive, true),
        metadata: normalizeAiImagePricingMetadata(normalizeJsonObject(body.metadata, 'metadata')),
        updated_by: user.id || null
    };
}

function buildGuardrailsPayload(body = {}) {
    const source = body.guardrails && typeof body.guardrails === 'object' && !Array.isArray(body.guardrails)
        ? body.guardrails
        : body;
    return normalizeAiImageGuardrails(source, { env: process.env });
}

function normalizeStoragePolicy(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        previewRetentionDays: normalizeRetentionDays(
            source.previewRetentionDays ?? source.preview_retention_days,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.previewRetentionDays,
            { min: 7, max: 3650 }
        ),
        originalRetentionDays: normalizeRetentionDays(
            source.originalRetentionDays ?? source.original_retention_days,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.originalRetentionDays,
            { min: 7, max: 3650 }
        ),
        failedRetentionDays: normalizeRetentionDays(
            source.failedRetentionDays ?? source.failed_retention_days,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.failedRetentionDays,
            { min: 1, max: 3650 }
        ),
        warnStorageGb: normalizeStorageGb(
            source.warnStorageGb ?? source.warn_storage_gb,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.warnStorageGb,
            { min: 0.1, max: 100000 }
        ),
        stopStorageGb: normalizeStorageGb(
            source.stopStorageGb ?? source.stop_storage_gb,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.stopStorageGb,
            { min: 0.1, max: 100000 }
        ),
        lifecycleEnabled: normalizeBoolean(
            source.lifecycleEnabled ?? source.lifecycle_enabled,
            DEFAULT_AI_IMAGE_STORAGE_POLICY.lifecycleEnabled
        )
    };
}

function buildStoragePolicyPayload(body = {}) {
    const source = body.storage_policy && typeof body.storage_policy === 'object' && !Array.isArray(body.storage_policy)
        ? body.storage_policy
        : body;
    const payload = normalizeStoragePolicy(source);
    if (payload.warnStorageGb > payload.stopStorageGb) {
        payload.stopStorageGb = payload.warnStorageGb;
    }
    return payload;
}

function resolveSiteFilter(searchParams) {
    const site = normalizeSite(searchParams.get('site') || 'all');
    if (site === 'all') return null;
    return [site, 'all'];
}

function getApiKeyTail(value = '') {
    const normalized = sanitizeText(value, 400);
    return normalized ? normalized.slice(-4) : '';
}

function getConfiguredEnvName(env = process.env, names = []) {
    return names.find((name) => sanitizeText(env?.[name], 400)) || '';
}

function getModelConfigSource(runtime = {}, env = process.env) {
    if (getConfiguredEnvName(env, ['AI_IMAGE_API_KEY'])) return 'ai-image-env';
    if (runtime.source === 'ai-image-stored' || runtime.source === 'ai-image-provider-stored') return 'ai-image-stored';
    if (getConfiguredEnvName(env, ['OPENAI_API_KEY', 'CODEX_API_KEY'])) return 'shared-env';
    if (runtime.source === 'shared-environment') return 'shared-env';
    if (runtime.source === 'stored') return 'codex-stored';
    if (runtime.source === 'environment') return 'shared-env';
    if (runtime.source === 'codex-stored') return 'codex-stored';
    return 'missing';
}

function getModelSourceLabel(source = '') {
    const labels = {
        'ai-image-env': 'AI_IMAGE 环境变量',
        'ai-image-stored': 'AI 图片后台安全配置',
        'shared-env': '共享 OpenAI/Codex 环境变量',
        'codex-stored': '后台 Codex 安全配置',
        missing: '未配置'
    };
    return labels[source] || labels.missing;
}

function buildStorageSummary(env = process.env) {
    const r2 = resolveR2Config(env);
    const inlineAllowed = sanitizeText(env?.AI_IMAGE_ALLOW_INLINE_DATA_URLS, 20).toLowerCase() === 'true';
    const missing = [];
    if (!r2.endpoint) missing.push('endpoint');
    if (!r2.accessKeyId) missing.push('access_key_id');
    if (!r2.secretAccessKey) missing.push('secret_access_key');
    if (!r2.bucket) missing.push('bucket');
    if (!r2.publicUrl) missing.push('public_url');

    return {
        configured: r2.configured,
        inline_data_urls_allowed: inlineAllowed,
        status: r2.configured ? 'ready' : (inlineAllowed ? 'dev-inline' : 'missing'),
        bucket: r2.configured ? sanitizeText(r2.bucket, 160) : '',
        public_url: r2.configured ? sanitizeText(r2.publicUrl, 400) : '',
        missing
    };
}

async function buildModelSummary(supabase) {
    const runtime = await resolveAiImageRuntimeConfig({
        supabase,
        task: {},
        env: process.env
    }).catch((error) => ({
        configured: false,
        model: normalizeImageModel(process.env.AI_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL),
        source: 'missing',
        error
    }));
    const source = getModelConfigSource(runtime);

    return {
        configured: Boolean(runtime.configured),
        model: normalizeImageModel(runtime.model),
        base_url_configured: Boolean(runtime.baseUrl),
        api_key_configured: Boolean(runtime.apiKey),
        api_key_tail: getApiKeyTail(runtime.apiKey),
        source,
        source_label: getModelSourceLabel(source),
        warning: source === 'shared-env' || source === 'codex-stored'
            ? '当前复用 OpenAI/Codex 配置，建议商用前配置独立 AI_IMAGE_API_KEY'
            : '',
        error_message: sanitizeText(runtime.error?.message, 300)
    };
}

function emptyQueueStats(site = 'all') {
    return {
        site,
        counts: {
            queued: 0,
            running: 0,
            succeeded: 0,
            failed: 0,
            cancelled: 0,
            refunded: 0
        },
        total_active: 0,
        oldest_queued_at: '',
        oldest_queued_minutes: 0,
        recent_failed_at: '',
        recent_failure: null,
        sampled_at: new Date().toISOString()
    };
}

function normalizeTaskStatsRow(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        site: normalizeSite(row.site, { allowAll: false }),
        status: sanitizeText(row.status, 40).toLowerCase(),
        mode: normalizeMode(row.mode),
        billing_mode: normalizeBillingMode(row.billing_mode),
        model: sanitizeText(row.model, 160),
        resolution: sanitizeText(row.resolution, 40),
        ratio: sanitizeText(row.ratio, 40),
        error_code: sanitizeText(row.error_code, 120),
        error_message: sanitizeText(row.error_message, 500),
        created_at: normalizeIsoDate(row.created_at),
        started_at: normalizeIsoDate(row.started_at),
        completed_at: normalizeIsoDate(row.completed_at),
        updated_at: normalizeIsoDate(row.updated_at)
    };
}

function getTaskSiteValues(siteFilter = null) {
    const siteValues = Array.isArray(siteFilter)
        ? siteFilter.filter((site) => site === 'cn' || site === 'intl')
        : [];
    return Array.from(new Set(siteValues));
}

function applyTaskSiteFilter(query, siteValues = []) {
    if (siteValues.length) {
        return query.in('site', siteValues);
    }
    return query;
}

async function countTasksByStatus(supabase, status, siteValues = []) {
    let query = supabase
        .from('ai_image_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
    query = applyTaskSiteFilter(query, siteValues);

    const { count, error } = await query;
    if (error) throw error;
    return Math.max(0, Number(count || 0) || 0);
}

async function loadOldestQueuedTask(supabase, siteValues = []) {
    let query = supabase
        .from('ai_image_tasks')
        .select(TASK_STATS_SELECT)
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);
    query = applyTaskSiteFilter(query, siteValues);

    const { data, error } = await query;
    if (error) throw error;
    return normalizeTaskStatsRow(Array.isArray(data) ? data[0] : data);
}

async function loadRecentFailedTask(supabase, siteValues = []) {
    let query = supabase
        .from('ai_image_tasks')
        .select(TASK_STATS_SELECT)
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(1);
    query = applyTaskSiteFilter(query, siteValues);

    const { data, error } = await query;
    if (error) throw error;
    return normalizeTaskStatsRow(Array.isArray(data) ? data[0] : data);
}

async function buildQueueStats(supabase, siteFilter = null) {
    const siteValues = getTaskSiteValues(siteFilter);
    const statuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'refunded'];
    const [statusCounts, oldestQueued, recentFailed] = await Promise.all([
        Promise.all(statuses.map(async (status) => [status, await countTasksByStatus(supabase, status, siteValues)])),
        loadOldestQueuedTask(supabase, siteValues),
        loadRecentFailedTask(supabase, siteValues)
    ]);

    const stats = emptyQueueStats(siteValues.length === 1 ? siteValues[0] : 'all');
    const nowMs = Date.now();

    statusCounts.forEach(([status, count]) => {
        stats.counts[status] = count;
    });

    stats.total_active = stats.counts.queued + stats.counts.running;
    if (oldestQueued?.created_at) {
        stats.oldest_queued_at = oldestQueued.created_at;
        stats.oldest_queued_minutes = Math.max(0, Math.round((nowMs - Date.parse(stats.oldest_queued_at)) / 60000));
    }
    if (recentFailed?.id) {
        const failedAt = recentFailed.completed_at || recentFailed.updated_at || recentFailed.created_at;
        stats.recent_failed_at = failedAt || '';
        stats.recent_failure = {
            task_id: recentFailed.id,
            mode: recentFailed.mode,
            billing_mode: recentFailed.billing_mode,
            model: recentFailed.model,
            resolution: recentFailed.resolution,
            ratio: recentFailed.ratio,
            error_code: recentFailed.error_code,
            error_message: recentFailed.error_message,
            failed_at: failedAt || ''
        };
    }

    return stats;
}

function normalizeByteCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
}

function summarizeStorageResultRow(row = {}) {
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    const previewBytes = normalizeByteCount(metadata.preview_bytes ?? metadata.previewBytes);
    const originalBytes = normalizeByteCount(metadata.original_bytes ?? metadata.originalBytes);
    const hasPreviewPath = Boolean(sanitizeText(row.storage_path || row.image_url, 4000));
    const hasOriginalPath = Boolean(sanitizeText(row.original_storage_path || row.original_image_url, 4000));
    const originalStatus = sanitizeText(metadata.original_status || metadata.originalStatus, 40).toLowerCase();
    return {
        previewBytes,
        originalBytes,
        previewObjectCount: hasPreviewPath ? 1 : 0,
        originalObjectCount: hasOriginalPath ? 1 : 0,
        unknownPreviewCount: hasPreviewPath && !previewBytes ? 1 : 0,
        unknownOriginalCount: hasOriginalPath && !originalBytes ? 1 : 0,
        pendingOriginalCount: originalStatus === 'pending' ? 1 : 0,
        failedOriginalCount: originalStatus === 'failed' ? 1 : 0
    };
}

function formatStorageUsageTone(totalBytes = 0, policy = {}) {
    const totalGb = totalBytes / (1024 ** 3);
    if (policy.stopStorageGb && totalGb >= Number(policy.stopStorageGb)) return 'danger';
    if (policy.warnStorageGb && totalGb >= Number(policy.warnStorageGb)) return 'warning';
    return 'ready';
}

function emptyStorageUsageStats(patch = {}) {
    return {
        sample_limit: 5000,
        sampled_results: 0,
        preview_objects: 0,
        original_objects: 0,
        preview_bytes: 0,
        original_bytes: 0,
        total_bytes: 0,
        estimated_total_gb: 0,
        unknown_preview_objects: 0,
        unknown_original_objects: 0,
        pending_originals: 0,
        failed_originals: 0,
        tone: 'ready',
        sampled_at: new Date().toISOString(),
        ...patch
    };
}

async function buildStorageUsageStats(supabase, siteFilter = null, policy = DEFAULT_AI_IMAGE_STORAGE_POLICY) {
    let query = supabase
        .from('ai_image_results')
        .select(RESULT_STORAGE_SELECT);

    if (Array.isArray(siteFilter)) {
        query = query.in('site', siteFilter.filter((site) => site === 'cn' || site === 'intl'));
    }

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(5000);
    if (error) throw error;

    const summary = emptyStorageUsageStats();

    (Array.isArray(data) ? data : []).forEach((row) => {
        const item = summarizeStorageResultRow(row);
        summary.sampled_results += 1;
        summary.preview_objects += item.previewObjectCount;
        summary.original_objects += item.originalObjectCount;
        summary.preview_bytes += item.previewBytes;
        summary.original_bytes += item.originalBytes;
        summary.unknown_preview_objects += item.unknownPreviewCount;
        summary.unknown_original_objects += item.unknownOriginalCount;
        summary.pending_originals += item.pendingOriginalCount;
        summary.failed_originals += item.failedOriginalCount;
    });

    summary.total_bytes = summary.preview_bytes + summary.original_bytes;
    summary.estimated_total_gb = Math.round((summary.total_bytes / (1024 ** 3)) * 10000) / 10000;
    summary.tone = formatStorageUsageTone(summary.total_bytes, policy);
    return summary;
}

async function loadStoragePolicyConfig(supabase, site = 'all') {
    try {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', AI_IMAGE_STORAGE_POLICY_CONFIG_KEY)
            .maybeSingle();
        if (error) throw error;
        return normalizeStoragePolicy(resolveSiteScopedSystemConfigForRead(
            AI_IMAGE_STORAGE_POLICY_CONFIG_KEY,
            data?.config_value || {},
            site
        ) || {});
    } catch (_) {
        return normalizeStoragePolicy({});
    }
}

async function buildRuntimeStatus(supabase, siteFilter = null) {
    const [model, queue] = await Promise.all([
        buildModelSummary(supabase),
        buildQueueStats(supabase, siteFilter).catch((error) => ({
            ...emptyQueueStats('all'),
            error_message: sanitizeText(error.message, 300)
        }))
    ]);

    return {
        model,
        storage: buildStorageSummary(process.env),
        queue,
        worker: {
            command: 'npm run ai-image:worker',
            once_command: 'npm run ai-image:worker -- --once --limit 3'
        }
    };
}

async function listAgents(supabase, siteFilter = null) {
    let query = supabase
        .from('ai_image_agents')
        .select(AGENT_SELECT);

    if (Array.isArray(siteFilter)) {
        query = query.in('site', siteFilter);
    }

    const { data, error } = await query
        .order('display_order', { ascending: true })
        .order('updated_at', { ascending: false })
        .limit(200);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(serializeAgent);
}

async function listPricingRules(supabase, siteFilter = null) {
    let query = supabase
        .from('ai_image_pricing_rules')
        .select(PRICING_SELECT);

    if (Array.isArray(siteFilter)) {
        query = query.in('site', siteFilter);
    }

    const { data, error } = await query
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false })
        .limit(500);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(serializePricingRule);
}

async function listApiBaseUrls(supabase, siteFilter = null, loadStatus = null) {
    let query = supabase
        .from(API_BASE_URL_TABLE)
        .select(API_BASE_URL_SELECT);

    if (Array.isArray(siteFilter)) {
        query = query.in('site', siteFilter);
    }

    const { data, error } = await query
        .order('display_order', { ascending: true })
        .order('updated_at', { ascending: false })
        .limit(100);
    if (error) {
        if (isMissingRelationError(error, API_BASE_URL_TABLE)) {
            if (loadStatus && typeof loadStatus === 'object') {
                loadStatus.apiBaseUrlsMissing = true;
            }
            return [];
        }
        throw error;
    }
    return (Array.isArray(data) ? data : []).map(serializeApiBaseUrl);
}

async function loadGuardrailsConfig(supabase, site = 'all') {
    try {
        const { data, error } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', AI_IMAGE_GUARDRAILS_CONFIG_KEY)
            .maybeSingle();
        if (error) throw error;
        return normalizeAiImageGuardrailsForSite(data?.config_value || {}, {
            site,
            env: process.env
        });
    } catch (_) {
        return normalizeAiImageGuardrails({}, { env: process.env });
    }
}

async function saveAgent({ supabase, user, body }) {
    const rawId = sanitizeText(body.id || body.agent_id || body.agentId, 160);
    const id = isUuid(rawId) ? rawId : '';
    const payload = buildAgentPayload(body, user);
    if (!id) {
        payload.created_by = user.id || null;
    }

    const query = id
        ? supabase.from('ai_image_agents').update(payload).eq('id', id)
        : supabase.from('ai_image_agents').insert(payload);
    const { data, error } = await query.select(AGENT_SELECT).single();
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site: payload.site,
        actionType: id ? 'ai_image.agent.update' : 'ai_image.agent.create',
        details: {
            agent_id: data?.id || id,
            slug: payload.slug,
            name: payload.name,
            mode: payload.mode,
            is_active: payload.is_active
        }
    });

    return serializeAgent(data);
}

async function savePricingRule({ supabase, user, body }) {
    const rawId = sanitizeText(body.id || body.pricing_id || body.pricingId, 160);
    const id = isUuid(rawId) ? rawId : '';
    const payload = buildPricingPayload(body, user);
    if (!id) {
        payload.created_by = user.id || null;
    }

    const query = id
        ? supabase.from('ai_image_pricing_rules').update(payload).eq('id', id)
        : supabase.from('ai_image_pricing_rules').insert(payload);
    const { data, error } = await query.select(PRICING_SELECT).single();
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site: payload.site,
        actionType: id ? 'ai_image.pricing.update' : 'ai_image.pricing.create',
        details: {
            pricing_id: data?.id || id,
            mode: payload.mode,
            billing_mode: payload.billing_mode,
            model: payload.model,
            resolution: payload.resolution,
            ratio: payload.ratio,
            quantity: payload.quantity,
            points: payload.points,
            is_active: payload.is_active
        }
    });

    return serializePricingRule(data);
}

async function saveApiBaseUrl({ supabase, user, body }) {
    const rawId = sanitizeText(body.id || body.api_base_url_id || body.apiBaseUrlId, 160);
    const id = isUuid(rawId) ? rawId : '';
    const payload = buildApiBaseUrlPayload(body, user);
    if (!id) {
        payload.created_by = user.id || null;
    }

    const query = id
        ? supabase.from(API_BASE_URL_TABLE).update(payload).eq('id', id)
        : supabase.from(API_BASE_URL_TABLE).insert(payload);
    const { data, error } = await query.select(API_BASE_URL_SELECT).single();
    if (error) {
        if (isMissingRelationError(error, API_BASE_URL_TABLE)) {
            throw createMissingApiBaseUrlTableError();
        }
        throw error;
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site: payload.site,
        actionType: id ? 'ai_image.api_base_url.update' : 'ai_image.api_base_url.create',
        details: {
            api_base_url_id: data?.id || id,
            label: payload.label,
            base_url: payload.base_url,
            is_active: payload.is_active
        }
    });

    return serializeApiBaseUrl(data);
}

async function saveGuardrails({ supabase, user, body }) {
    const site = normalizeSite(body.site || 'all');
    const payload = buildGuardrailsPayload(body);
    const { data: currentRow, error: loadError } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', AI_IMAGE_GUARDRAILS_CONFIG_KEY)
        .maybeSingle();
    if (loadError) throw loadError;

    const currentValue = currentRow?.config_value || {};
    const storedValue = site === 'all'
        ? {
            __site_scoped: true,
            default: payload,
            sites: currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) && currentValue.sites
                ? currentValue.sites
                : {}
        }
        : upsertSiteScopedSystemConfigValue(currentValue, site, payload);

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: AI_IMAGE_GUARDRAILS_CONFIG_KEY,
            config_value: storedValue,
            updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site,
        actionType: 'ai_image.guardrails.update',
        details: {
            site,
            guardrails: payload
        }
    });

    return payload;
}

async function saveStoragePolicy({ supabase, user, body }) {
    const site = normalizeSite(body.site || 'all');
    const payload = buildStoragePolicyPayload(body);
    const { data: currentRow, error: loadError } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', AI_IMAGE_STORAGE_POLICY_CONFIG_KEY)
        .maybeSingle();
    if (loadError) throw loadError;

    const currentValue = currentRow?.config_value || {};
    const storedValue = site === 'all'
        ? {
            __site_scoped: true,
            default: payload,
            sites: currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) && currentValue.sites
                ? currentValue.sites
                : {}
        }
        : upsertSiteScopedSystemConfigValue(currentValue, site, payload);

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: AI_IMAGE_STORAGE_POLICY_CONFIG_KEY,
            config_value: storedValue,
            updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site,
        actionType: 'ai_image.storage_policy.update',
        details: {
            site,
            storage_policy: payload
        }
    });

    return payload;
}

async function softDeleteAgent({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.agent_id || body.agentId, 160);
    if (!isSafeRecordId(id)) {
        const error = new Error('agent id is required');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('ai_image_agents')
        .update({
            is_active: false,
            updated_by: user.id || null
        })
        .eq('id', id)
        .select(AGENT_SELECT)
        .single();
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site: data?.site,
        actionType: 'ai_image.agent.disable',
        details: {
            agent_id: id,
            slug: data?.slug,
            name: data?.name
        }
    });

    return serializeAgent(data);
}

async function softDeletePricingRule({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.pricing_id || body.pricingId, 160);
    if (!isSafeRecordId(id)) {
        const error = new Error('pricing id is required');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('ai_image_pricing_rules')
        .update({
            is_active: false,
            updated_by: user.id || null
        })
        .eq('id', id)
        .select(PRICING_SELECT)
        .single();
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site: data?.site,
        actionType: 'ai_image.pricing.disable',
        details: {
            pricing_id: id,
            mode: data?.mode,
            billing_mode: data?.billing_mode,
            model: data?.model,
            points: data?.points
        }
    });

    return serializePricingRule(data);
}

async function softDeleteApiBaseUrl({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.api_base_url_id || body.apiBaseUrlId, 160);
    if (!isSafeRecordId(id)) {
        const error = new Error('api base url id is required');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from(API_BASE_URL_TABLE)
        .update({
            is_active: false,
            updated_by: user.id || null
        })
        .eq('id', id)
        .select(API_BASE_URL_SELECT)
        .single();
    if (error) {
        if (isMissingRelationError(error, API_BASE_URL_TABLE)) {
            throw createMissingApiBaseUrlTableError();
        }
        throw error;
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'ai-image',
        site: data?.site,
        actionType: 'ai_image.api_base_url.disable',
        details: {
            api_base_url_id: id,
            label: data?.label,
            base_url: data?.base_url
        }
    });

    return serializeApiBaseUrl(data);
}

module.exports = async function aiImageConfigHandler(req, res) {
    try {
        const adminContext = await requireAdmin(req, {
            anyOf: ['settings.manage', 'prompts.manage']
        });
        const { supabase, user } = adminContext;

        if (req.method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const site = normalizeSite(url.searchParams.get('site') || 'all');
            const siteFilter = resolveSiteFilter(url.searchParams);
            const loadStatus = {};
            const [agents, pricing, apiBaseUrls, runtime, guardrails, storagePolicy] = await Promise.all([
                listAgents(supabase, siteFilter),
                listPricingRules(supabase, siteFilter),
                listApiBaseUrls(supabase, siteFilter, loadStatus),
                buildRuntimeStatus(supabase, siteFilter),
                loadGuardrailsConfig(supabase, site),
                loadStoragePolicyConfig(supabase, site)
            ]);
            const storageUsage = await buildStorageUsageStats(supabase, siteFilter, storagePolicy)
                .catch((error) => emptyStorageUsageStats({
                    error_message: sanitizeText(error.message, 300),
                    tone: 'warning'
                }));
            return sendJson(res, 200, {
                success: true,
                agents,
                pricing,
                api_base_urls: apiBaseUrls,
                guardrails,
                storage_policy: storagePolicy,
                storage_usage: storageUsage,
                warnings: loadStatus.apiBaseUrlsMissing
                    ? { api_base_urls: API_BASE_URL_TABLE_MISSING_MESSAGE }
                    : {},
                runtime
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const action = normalizeAction(body.action || 'save-pricing');
        if (['save-agent', 'upsert-agent', 'agent-save'].includes(action)) {
            const agent = await saveAgent({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                agent
            });
        }

        if (['delete-agent', 'disable-agent', 'agent-delete'].includes(action)) {
            const agent = await softDeleteAgent({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                agent
            });
        }

        if (['save-pricing', 'save-pricing-rule', 'upsert-pricing', 'pricing-save'].includes(action)) {
            const pricingRule = await savePricingRule({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                pricing: pricingRule
            });
        }

        if (['save-api-base-url', 'save-api-base', 'upsert-api-base-url', 'api-base-url-save'].includes(action)) {
            const apiBaseUrl = await saveApiBaseUrl({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                api_base_url: apiBaseUrl,
                apiBaseUrl
            });
        }

        if (['save-guardrails', 'save-rate-limits', 'guardrails-save'].includes(action)) {
            const guardrails = await saveGuardrails({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                guardrails
            });
        }

        if (['save-storage-policy', 'save-r2-policy', 'storage-policy-save'].includes(action)) {
            const storagePolicy = await saveStoragePolicy({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                storage_policy: storagePolicy,
                storagePolicy
            });
        }

        if (['delete-pricing', 'disable-pricing', 'delete-pricing-rule', 'pricing-delete'].includes(action)) {
            const pricingRule = await softDeletePricingRule({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                pricing: pricingRule
            });
        }

        if (['delete-api-base-url', 'disable-api-base-url', 'api-base-url-delete'].includes(action)) {
            const apiBaseUrl = await softDeleteApiBaseUrl({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                api_base_url: apiBaseUrl,
                apiBaseUrl
            });
        }

        return sendJson(res, 400, {
            success: false,
            message: 'Unsupported AI image config action'
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'AI image config request failed'
        });
    }
};

module.exports._private = {
    buildRuntimeStatus,
    buildQueueStats,
    buildAgentPayload,
    buildApiBaseUrlPayload,
    buildGuardrailsPayload,
    buildPricingPayload,
    buildStoragePolicyPayload,
    buildStorageUsageStats,
    isMissingRelationError,
    loadGuardrailsConfig,
    loadStoragePolicyConfig,
    normalizeAction,
    normalizeStoragePolicy,
    serializeAgent,
    serializeApiBaseUrl,
    serializePricingRule
};
