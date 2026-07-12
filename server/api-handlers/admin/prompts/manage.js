const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const PROMPT_REQUIRED_SELECT_FIELDS = [
    'id',
    'title',
    'tags',
    'description',
    'prompt_text',
    'images',
    'created_at'
];

const PROMPT_OPTIONAL_SELECT_FIELDS = [
    'dominant_colors',
    'ai_tags',
    'image_assets',
    'video_assets',
    'quality_score',
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url',
    'updated_at'
];

const PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS = [
    'source_url',
    'source_author_name',
    'source_author_handle',
    'source_author_avatar_url'
];

const PROMPT_BILINGUAL_SELECT_FIELDS = [
    'title_en',
    'title_zh',
    'description_en',
    'description_zh',
    'prompt_text_en',
    'prompt_text_zh'
];

const PROMPT_SELECT_FIELDS = [
    ...PROMPT_REQUIRED_SELECT_FIELDS,
    ...PROMPT_OPTIONAL_SELECT_FIELDS,
    ...PROMPT_BILINGUAL_SELECT_FIELDS
].join(', ');

const PROMPT_LEGACY_SELECT_FIELDS = PROMPT_REQUIRED_SELECT_FIELDS.join(', ');
const OPTIONAL_PROMPT_COLUMN_FIELDS = [
    ...PROMPT_OPTIONAL_SELECT_FIELDS,
    ...PROMPT_BILINGUAL_SELECT_FIELDS
];
const OPTIONAL_PROMPT_MUTATION_FIELDS = new Set([
    ...OPTIONAL_PROMPT_COLUMN_FIELDS,
    'updated_at'
]);
const PROMPT_SCHEMA_RELOAD_SQL = "select pg_notify('pgrst', 'reload schema');";
const DEFAULT_PROMPT_PAGE_SIZE = 10;
const MAX_PROMPT_PAGE_SIZE = 100;
const PROMPT_IMAGE_ASSET_KEYS = Object.freeze(['original', 'thumb', 'featured', 'card', 'home']);
const PROMPT_IMAGE_CDN_VARIANT_PATHS = new Set(['thumb', 'featured', 'card', 'home']);
const PROMPT_SORT_VALUES = new Set([
    'updated-desc',
    'created-desc',
    'engagement-desc',
    'status-priority',
    'title-asc'
]);
const PROMPT_ADMIN_STATUS_LABELS = Object.freeze({
    draft: '草稿',
    review: '待复核',
    'needs-localization': '待补双语',
    'homepage-candidate': '首页候选',
    featured: '已上首页',
    ready: '可发布',
    live: '已上线',
    archived: '已归档'
});
const PROMPT_STATUS_PRIORITY = Object.freeze({
    review: 0,
    'homepage-candidate': 1,
    featured: 2,
    live: 3,
    'needs-localization': 4,
    ready: 5,
    draft: 6,
    archived: 7
});

function buildPromptSelectFields(excludedFields = []) {
    const excluded = new Set(
        (Array.isArray(excludedFields) ? excludedFields : [])
            .map((field) => String(field || '').trim())
            .filter(Boolean)
    );

    return [
        ...PROMPT_REQUIRED_SELECT_FIELDS,
        ...PROMPT_OPTIONAL_SELECT_FIELDS.filter((field) => !excluded.has(field)),
        ...PROMPT_BILINGUAL_SELECT_FIELDS.filter((field) => !excluded.has(field))
    ].join(', ');
}

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizePromptId(value) {
    return String(value || '').trim();
}

function normalizePositiveInteger(value, fallback, options = {}) {
    const parsed = Number.parseInt(value, 10);
    const min = Number.isFinite(options.min) ? options.min : 1;
    const max = Number.isFinite(options.max) ? options.max : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(parsed) || parsed < min) {
        return fallback;
    }
    return Math.min(parsed, max);
}

function normalizePromptSortValue(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return PROMPT_SORT_VALUES.has(normalized) ? normalized : 'updated-desc';
}

function normalizePromptListQuery(searchParams) {
    const hasExplicitPagination = searchParams.has('page') || searchParams.has('pageSize');
    const pageSize = normalizePositiveInteger(searchParams.get('pageSize'), DEFAULT_PROMPT_PAGE_SIZE, {
        min: 1,
        max: MAX_PROMPT_PAGE_SIZE
    });
    const page = normalizePositiveInteger(searchParams.get('page'), 1);

    return {
        pagination: {
            enabled: hasExplicitPagination,
            page,
            pageSize,
            start: (page - 1) * pageSize,
            end: (page * pageSize) - 1
        },
        filters: {
            search: String(searchParams.get('search') || searchParams.get('q') || '').trim(),
            category: String(searchParams.get('category') || '').trim(),
            date: String(searchParams.get('date') || '').trim().toLowerCase(),
            language: String(searchParams.get('language') || '').trim().toLowerCase(),
            status: String(searchParams.get('status') || '').trim().toLowerCase(),
            sort: normalizePromptSortValue(searchParams.get('sort'))
        }
    };
}

function normalizePromptSiteContext(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizePromptMetricSite(value) {
    return String(value || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
}

function isMissingOptionalPromptColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;

    return OPTIONAL_PROMPT_COLUMN_FIELDS.some((field) => (
        message.includes(`column ${field}`) ||
        message.includes(`prompts.${field}`) ||
        message.includes(`"${field}"`) ||
        message.includes(`'${field}'`) ||
        message.includes(`column of 'prompts'`) && message.includes(`'${field}'`) ||
        message.includes(`column of "prompts"`) && message.includes(`"${field}"`)
    ));
}

function getMissingOptionalPromptColumnFields(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return [];

    return OPTIONAL_PROMPT_COLUMN_FIELDS.filter((field) => (
        message.includes(`column ${field}`) ||
        message.includes(`prompts.${field}`) ||
        message.includes(`"${field}"`) ||
        message.includes(`'${field}'`) ||
        (message.includes(`column of 'prompts'`) && message.includes(`'${field}'`)) ||
        (message.includes(`column of "prompts"`) && message.includes(`"${field}"`))
    ));
}

function isMissingOptionalPromptMetricSiteError(error, table) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;

    return (
        message.includes('column site') ||
        message.includes(`${table}.site`) ||
        message.includes('"site"')
    );
}

function isMissingPromptMetricTableError(error, table) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;

    return (
        message.includes(`relation "${table}" does not exist`) ||
        message.includes(`relation '${table}' does not exist`) ||
        message.includes(`${table} does not exist`) ||
        message.includes(`could not find the table '${table}'`) ||
        message.includes(`could not find the table "${table}"`)
    );
}

function toUniqueStringArray(value) {
    const values = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim() ? [value] : []);

    return [...new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    )];
}

function normalizeOptionalText(value) {
    if (value === undefined) return undefined;
    if (value === null) return '';
    return String(value);
}

function normalizeOptionalStringArray(value, fieldName) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        const error = new Error(`${fieldName} must be an array`);
        error.statusCode = 400;
        throw error;
    }

    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function normalizeOptionalObject(value, fieldName) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        const error = new Error(`${fieldName} must be an object`);
        error.statusCode = 400;
        throw error;
    }
    return value;
}

function getPromptImageCdnVariantInfo(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) {
        return { original: '', variant: '' };
    }

    try {
        const parsed = new URL(trimmed);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isPromptCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)
            || parsed.hostname.endsWith('.r2.dev');

        if (
            isPromptCdnHost
            && parts.length === 3
            && parts[0] === 'prompts'
            && PROMPT_IMAGE_CDN_VARIANT_PATHS.has(parts[1])
        ) {
            parsed.pathname = `/prompts/${parts[2]}`;
            parsed.search = '';
            parsed.hash = '';
            return {
                original: parsed.toString(),
                variant: parts[1]
            };
        }
    } catch (error) {
        return { original: trimmed, variant: '' };
    }

    return { original: trimmed, variant: '' };
}

function getPromptImageCanonicalOriginalUrl(url) {
    return getPromptImageCdnVariantInfo(url).original;
}

function getPromptImageCanonicalDedupeKey(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    try {
        const parsed = new URL(trimmed);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isPromptCdnHost = ['cdn.fatherkey.com', 'cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)
            || parsed.hostname.endsWith('.r2.dev');
        if (isPromptCdnHost && parts[0] === 'prompts') {
            const filename = parts.length === 3 && PROMPT_IMAGE_CDN_VARIANT_PATHS.has(parts[1])
                ? parts[2]
                : (parts.length === 2 ? parts[1] : '');
            if (filename) {
                return `prompts/${decodeURIComponent(filename)}`;
            }
        }
    } catch (error) {
        return trimmed;
    }

    return getPromptImageCanonicalOriginalUrl(trimmed) || trimmed;
}

function assignPromptImageAssetUrl(asset, key, url) {
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return;

    const variantInfo = getPromptImageCdnVariantInfo(safeUrl);
    const normalizedKey = PROMPT_IMAGE_ASSET_KEYS.includes(key) ? key : 'original';
    const impliedVariant = variantInfo.variant || '';

    if (normalizedKey === 'original' && impliedVariant) {
        asset[impliedVariant] = asset[impliedVariant] || safeUrl;
    } else {
        asset[normalizedKey] = safeUrl;
    }

    if (!asset.original && variantInfo.original) {
        asset.original = variantInfo.original;
    }
}

function normalizePromptImageAsset(value) {
    if (typeof value === 'string') {
        const asset = {};
        assignPromptImageAssetUrl(asset, 'original', value);
        return asset.original ? asset : null;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
        ? value.variants
        : {};
    const asset = {};

    for (const key of PROMPT_IMAGE_ASSET_KEYS) {
        assignPromptImageAssetUrl(asset, key, value[key] || variants[key]);
    }

    const fallbackOriginal = value.url || value.src || value.image;
    if (!asset.original && fallbackOriginal) {
        assignPromptImageAssetUrl(asset, 'original', fallbackOriginal);
    }

    return asset.original || asset.thumb || asset.featured || asset.card || asset.home ? asset : null;
}

function dedupePromptImageAssets(assets = []) {
    const seen = new Map();
    return (Array.isArray(assets) ? assets : [])
        .map(normalizePromptImageAsset)
        .filter((asset) => {
            if (!asset) return false;
            const key = getPromptImageCanonicalDedupeKey(asset.original || asset.featured || asset.card || asset.home || asset.thumb || '');
            if (!key) return false;
            if (seen.has(key)) {
                const existing = seen.get(key);
                existing.original = asset.original || existing.original;
                for (const assetKey of PROMPT_IMAGE_ASSET_KEYS) {
                    if (!existing[assetKey] && asset[assetKey]) {
                        existing[assetKey] = asset[assetKey];
                    }
                }
                return false;
            }
            seen.set(key, asset);
            return true;
        });
}

function normalizePromptImagePayload(images, imageAssets) {
    const assets = dedupePromptImageAssets([
        ...(Array.isArray(imageAssets) ? imageAssets : []),
        ...(Array.isArray(images) ? images : [])
    ]);

    return {
        images: assets.map((asset) => asset.original).filter(Boolean),
        image_assets: assets
    };
}

function normalizeOptionalImageAssets(value, fieldName) {
    if (value === undefined) return undefined;

    const values = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? [value] : []);
    if (!Array.isArray(value) && !(value && typeof value === 'object')) {
        const error = new Error(`${fieldName} must be an array`);
        error.statusCode = 400;
        throw error;
    }

    return dedupePromptImageAssets(values);
}

function normalizeOptionalVideoAssets(value, fieldName = 'video_assets') {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        const error = new Error(`${fieldName} must be an array`);
        error.statusCode = 400;
        throw error;
    }
    const seen = new Set();
    return value.flatMap((entry) => {
        const source = typeof entry === 'string' ? { original: entry } : entry;
        if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
        const original = String(source.original || source.url || source.src || '').trim();
        if (!original || seen.has(original.toLowerCase())) return [];
        seen.add(original.toLowerCase());
        return [{
            ...source,
            original,
            poster: String(source.poster || source.poster_url || source.posterUrl || '').trim(),
            mime_type: String(source.mime_type || source.mimeType || source.type || '').trim()
        }];
    });
}

function applyPromptFieldFallbacks(row = {}) {
    const safeRow = row && typeof row === 'object' ? { ...row } : {};

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'dominant_colors')) {
        safeRow.dominant_colors = [];
    }

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'ai_tags')) {
        safeRow.ai_tags = {};
    }

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'quality_score')) {
        safeRow.quality_score = null;
    }

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'image_assets')) {
        safeRow.image_assets = [];
    }

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'video_assets')) {
        safeRow.video_assets = [];
    }

    for (const fieldName of ['source_url', 'source_author_name', 'source_author_handle', 'source_author_avatar_url']) {
        if (!Object.prototype.hasOwnProperty.call(safeRow, fieldName)) {
            safeRow[fieldName] = '';
        }
    }

    for (const fieldName of PROMPT_BILINGUAL_SELECT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(safeRow, fieldName)) {
            safeRow[fieldName] = '';
        }
    }

    return safeRow;
}

function payloadHasVisiblePromptFields(payload = {}, fieldNames = []) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    return (Array.isArray(fieldNames) ? fieldNames : []).some((fieldName) => String(safePayload[fieldName] || '').trim());
}

function payloadHasVisibleBilingualFields(payload = {}, fieldNames = PROMPT_BILINGUAL_SELECT_FIELDS) {
    return payloadHasVisiblePromptFields(payload, fieldNames);
}

function stripUnsupportedPromptPayloadFields(payload = {}, fieldsToStrip = OPTIONAL_PROMPT_MUTATION_FIELDS) {
    const safePayload = payload && typeof payload === 'object' ? { ...payload } : {};
    let removed = false;
    const stripSet = fieldsToStrip instanceof Set
        ? fieldsToStrip
        : new Set(
            (Array.isArray(fieldsToStrip) ? fieldsToStrip : [fieldsToStrip])
                .map((field) => String(field || '').trim())
                .filter(Boolean)
        );

    for (const fieldName of stripSet) {
        if (Object.prototype.hasOwnProperty.call(safePayload, fieldName)) {
            delete safePayload[fieldName];
            removed = true;
        }
    }

    return {
        payload: safePayload,
        removed
    };
}

function buildPromptMutationPayload(body, { action = 'create' } = {}) {
    const payload = {};
    const normalizedAction = String(action || 'create').trim().toLowerCase();
    const partial = normalizedAction === 'patch';

    if (Object.prototype.hasOwnProperty.call(body, 'title') || !partial) {
        const title = normalizeOptionalText(body.title);
        if (!partial && !String(title || '').trim()) {
            const error = new Error('title is required');
            error.statusCode = 400;
            throw error;
        }
        if (title !== undefined) payload.title = title || '';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'tags') || Object.prototype.hasOwnProperty.call(body, 'category') || !partial) {
        const rawTags = Object.prototype.hasOwnProperty.call(body, 'tags')
            ? body.tags
            : (body.category ? [body.category] : []);
        const tags = toUniqueStringArray(rawTags);
        if (!partial && !tags.length) {
            const error = new Error('tags are required');
            error.statusCode = 400;
            throw error;
        }
        payload.tags = tags;
    }

    const textFields = [
        'description',
        'prompt_text',
        'title_en',
        'title_zh',
        'description_en',
        'description_zh',
        'prompt_text_en',
        'prompt_text_zh',
        'source_url',
        'source_author_name',
        'source_author_handle',
        'source_author_avatar_url'
    ];

    for (const fieldName of textFields) {
        if (!Object.prototype.hasOwnProperty.call(body, fieldName)) continue;
        payload[fieldName] = normalizeOptionalText(body[fieldName]) || '';
    }

    const hasImages = Object.prototype.hasOwnProperty.call(body, 'images');
    const hasImageAssets = Object.prototype.hasOwnProperty.call(body, 'image_assets')
        || Object.prototype.hasOwnProperty.call(body, 'imageAssets');
    const images = normalizeOptionalStringArray(body.images, 'images');
    const imageAssets = normalizeOptionalImageAssets(body.image_assets ?? body.imageAssets, 'image_assets');
    if (hasImages || hasImageAssets) {
        const normalizedImages = normalizePromptImagePayload(images || [], imageAssets || []);
        payload.images = normalizedImages.images;
        payload.image_assets = normalizedImages.image_assets;
    }

    const videoAssets = normalizeOptionalVideoAssets(body.video_assets ?? body.videoAssets, 'video_assets');
    if (videoAssets !== undefined) payload.video_assets = videoAssets;

    const dominantColors = normalizeOptionalStringArray(body.dominant_colors ?? body.dominantColors, 'dominant_colors');
    if (dominantColors !== undefined) payload.dominant_colors = dominantColors;

    const aiTags = normalizeOptionalObject(body.ai_tags ?? body.aiTags, 'ai_tags');
    if (aiTags !== undefined) payload.ai_tags = aiTags;

    if (Object.prototype.hasOwnProperty.call(body, 'quality_score')) {
        if (body.quality_score === null || body.quality_score === '') {
            payload.quality_score = null;
        } else {
            const parsedScore = Number(body.quality_score);
            if (!Number.isFinite(parsedScore)) {
                const error = new Error('quality_score must be a number');
                error.statusCode = 400;
                throw error;
            }
            payload.quality_score = parsedScore;
        }
    }

    if (!Object.keys(payload).length) {
        const error = new Error('No prompt fields to save');
        error.statusCode = 400;
        throw error;
    }

    if (normalizedAction === 'update' || normalizedAction === 'patch') {
        payload.updated_at = new Date().toISOString();
    }

    return payload;
}

async function executePromptSelectWithFallback(executor) {
    const excludedFields = new Set();

    while (true) {
        const selectFields = buildPromptSelectFields([...excludedFields]);
        const result = await executor(selectFields, [...excludedFields]);
        if (!result?.error) {
            return result;
        }

        const missingFields = getMissingOptionalPromptColumnFields(result.error)
            .filter((field) => !excludedFields.has(field));
        if (!missingFields.length) {
            return result;
        }

        missingFields.forEach((field) => excludedFields.add(field));
    }
}

function promptHasVisibleCopy(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function getPromptLanguageCoverage(row = {}) {
    return {
        zh: promptHasVisibleCopy(row.title_zh)
            || promptHasVisibleCopy(row.description_zh)
            || promptHasVisibleCopy(row.prompt_text_zh),
        en: promptHasVisibleCopy(row.title_en)
            || promptHasVisibleCopy(row.description_en)
            || promptHasVisibleCopy(row.prompt_text_en)
    };
}

function normalizePromptAdminOpsData(value = {}) {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalizedStatus = String(data.status || '').trim().toLowerCase();
    return {
        status: Object.prototype.hasOwnProperty.call(PROMPT_ADMIN_STATUS_LABELS, normalizedStatus) ? normalizedStatus : '',
        note: String(data.note || '').trim()
    };
}

function getPromptAdminOpsData(row = {}) {
    const aiTags = row?.ai_tags && typeof row.ai_tags === 'object' && !Array.isArray(row.ai_tags)
        ? row.ai_tags
        : {};
    return normalizePromptAdminOpsData(aiTags.admin || aiTags.ops || {});
}

function normalizeMetricValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizePromptSiteMetrics(row = {}) {
    const rawMetrics = row && typeof row.site_metrics === 'object' && row.site_metrics ? row.site_metrics : {};
    const normalizeSiteMetric = (value = {}) => ({
        unlock_count: normalizeMetricValue(value.unlock_count),
        comment_count: normalizeMetricValue(value.comment_count)
    });
    return {
        cn: normalizeSiteMetric(rawMetrics.cn),
        intl: normalizeSiteMetric(rawMetrics.intl),
        total: normalizeSiteMetric(rawMetrics.total)
    };
}

function getPromptLifecycleState(row = {}) {
    const opsData = getPromptAdminOpsData(row);
    const coverage = getPromptLanguageCoverage(row);
    const metrics = normalizePromptSiteMetrics(row).total;
    const hasBaseTitle = promptHasVisibleCopy(row.title);
    const hasPromptText = promptHasVisibleCopy(row.prompt_text);
    const hasImages = Array.isArray(row.images) && row.images.some((value) => promptHasVisibleCopy(value));

    if (opsData.status === 'archived') return 'archived';
    if (opsData.status === 'draft') return 'draft';
    if (!hasBaseTitle || !hasPromptText || !hasImages) return 'draft';
    if (opsData.status === 'review') return 'review';
    if (!coverage.zh || !coverage.en) return 'needs-localization';
    if (opsData.status === 'homepage-candidate') return 'homepage-candidate';
    if (opsData.status === 'featured') return 'featured';
    if (metrics.unlock_count > 0 || metrics.comment_count > 0) return 'live';
    return opsData.status === 'live' ? 'live' : 'ready';
}

function getPromptEngagementScore(row = {}, site = 'all') {
    const metrics = normalizePromptSiteMetrics(row);
    const normalizedSite = normalizePromptSiteContext(site);
    const selectedMetrics = normalizedSite === 'cn' || normalizedSite === 'intl'
        ? metrics[normalizedSite]
        : metrics.total;
    return (Number(selectedMetrics.unlock_count || 0) * 3) + Number(selectedMetrics.comment_count || 0);
}

function getPromptSortTimestamp(row = {}, fieldName = 'updated_at') {
    const timestamp = new Date(row?.[fieldName] || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function comparePromptRows(left = {}, right = {}, { sort = 'updated-desc', site = 'all' } = {}) {
    const normalizedSort = normalizePromptSortValue(sort);
    const leftTitle = String(left.title || left.title_zh || left.title_en || '').trim();
    const rightTitle = String(right.title || right.title_zh || right.title_en || '').trim();

    if (normalizedSort === 'title-asc') {
        return leftTitle.localeCompare(rightTitle, 'zh-CN', { sensitivity: 'base' });
    }

    if (normalizedSort === 'created-desc') {
        const createdDelta = getPromptSortTimestamp(right, 'created_at') - getPromptSortTimestamp(left, 'created_at');
        return createdDelta || leftTitle.localeCompare(rightTitle, 'zh-CN', { sensitivity: 'base' });
    }

    if (normalizedSort === 'engagement-desc') {
        const scoreDelta = getPromptEngagementScore(right, site) - getPromptEngagementScore(left, site);
        if (scoreDelta) return scoreDelta;
    }

    if (normalizedSort === 'status-priority') {
        const leftPriority = PROMPT_STATUS_PRIORITY[getPromptLifecycleState(left)] ?? 99;
        const rightPriority = PROMPT_STATUS_PRIORITY[getPromptLifecycleState(right)] ?? 99;
        const priorityDelta = leftPriority - rightPriority;
        if (priorityDelta) return priorityDelta;
    }

    const updatedDelta = getPromptSortTimestamp(right, 'updated_at') - getPromptSortTimestamp(left, 'updated_at');
    if (updatedDelta) return updatedDelta;

    const createdDelta = getPromptSortTimestamp(right, 'created_at') - getPromptSortTimestamp(left, 'created_at');
    if (createdDelta) return createdDelta;

    return leftTitle.localeCompare(rightTitle, 'zh-CN', { sensitivity: 'base' });
}

function matchesPromptDateFilter(row = {}, dateValue = '') {
    const normalizedDate = String(dateValue || '').trim().toLowerCase();
    if (!normalizedDate) return true;

    const createdAt = new Date(row.created_at || 0);
    if (Number.isNaN(createdAt.getTime())) return false;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(todayStart);
    monthStart.setMonth(monthStart.getMonth() - 1);

    if (normalizedDate === 'today') return createdAt >= todayStart;
    if (normalizedDate === 'week') return createdAt >= weekStart;
    if (normalizedDate === 'month') return createdAt >= monthStart;
    return true;
}

function matchesPromptLanguageFilter(row = {}, languageValue = '') {
    const normalizedLanguage = String(languageValue || '').trim().toLowerCase();
    if (!normalizedLanguage) return true;

    const coverage = getPromptLanguageCoverage(row);
    if (normalizedLanguage === 'bilingual-ready') return coverage.zh && coverage.en;
    if (normalizedLanguage === 'zh-ready') return coverage.zh;
    if (normalizedLanguage === 'en-ready') return coverage.en;
    if (normalizedLanguage === 'needs-translation') return !(coverage.zh && coverage.en);
    return true;
}

function matchesPromptSearchFilter(row = {}, search = '') {
    const normalizedSearch = String(search || '').trim().toLowerCase();
    if (!normalizedSearch) return true;

    const terms = normalizedSearch.split(/\s+/).filter(Boolean);
    if (!terms.length) return true;

    const aiTags = row?.ai_tags && typeof row.ai_tags === 'object' && !Array.isArray(row.ai_tags) ? row.ai_tags : {};
    const aiTagText = ['objects', 'scenes', 'styles', 'mood']
        .flatMap((key) => {
            const value = aiTags[key] || {};
            return [
                ...(Array.isArray(value.en) ? value.en : []),
                ...(Array.isArray(value.zh) ? value.zh : [])
            ];
        })
        .join(' ');

    const searchableText = [
        row.id,
        row.title,
        row.title_zh,
        row.title_en,
        row.description,
        row.description_zh,
        row.description_en,
        row.prompt_text,
        row.prompt_text_zh,
        row.prompt_text_en,
        Array.isArray(row.tags) ? row.tags.join(' ') : '',
        Array.isArray(row.dominant_colors) ? row.dominant_colors.join(' ') : '',
        aiTagText
    ].join(' ').toLowerCase();

    return terms.every((term) => searchableText.includes(term));
}

function filterPromptRows(rows = [], filters = {}) {
    const category = String(filters.category || '').trim().toLowerCase();
    const status = String(filters.status || '').trim().toLowerCase();

    return (Array.isArray(rows) ? rows : []).filter((row) => {
        if (!row) return false;

        if (category) {
            const tags = Array.isArray(row.tags) ? row.tags : [];
            if (!tags.some((tag) => String(tag || '').trim().toLowerCase() === category)) {
                return false;
            }
        }

        if (!matchesPromptDateFilter(row, filters.date)) return false;
        if (!matchesPromptLanguageFilter(row, filters.language)) return false;
        if (status && getPromptLifecycleState(row) !== status) return false;
        if (!matchesPromptSearchFilter(row, filters.search)) return false;

        return true;
    });
}

function paginatePromptRows(rows = [], pagination = {}) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!pagination.enabled) {
        return {
            rows: safeRows,
            pagination: null
        };
    }

    const totalItems = safeRows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
    const page = Math.min(Math.max(1, pagination.page), totalPages);
    const start = (page - 1) * pagination.pageSize;
    const pageRows = safeRows.slice(start, start + pagination.pageSize);

    return {
        rows: pageRows,
        pagination: buildPromptPaginationPayload(totalItems, {
            ...pagination,
            page
        }, pageRows.length)
    };
}

function buildPromptPaginationPayload(totalItems, pagination = {}, returnedItems = 0) {
    if (!pagination.enabled) return null;

    const pageSize = normalizePositiveInteger(pagination.pageSize, DEFAULT_PROMPT_PAGE_SIZE, {
        min: 1,
        max: MAX_PROMPT_PAGE_SIZE
    });
    const total = Math.max(0, Number(totalItems) || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, normalizePositiveInteger(pagination.page, 1)), totalPages);

    return {
        page,
        pageSize,
        totalItems: total,
        totalPages,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
        returnedItems: Math.max(0, Number(returnedItems) || 0)
    };
}

function normalizePromptPaginationPayload(value = {}, fallbackPagination = {}, returnedItems = 0) {
    const safeValue = value && typeof value === 'object' ? value : {};
    return buildPromptPaginationPayload(
        Number.isFinite(Number(safeValue.totalItems)) ? Number(safeValue.totalItems) : returnedItems,
        {
            enabled: true,
            page: Number.isFinite(Number(safeValue.page)) ? Number(safeValue.page) : fallbackPagination.page,
            pageSize: Number.isFinite(Number(safeValue.pageSize)) ? Number(safeValue.pageSize) : fallbackPagination.pageSize
        },
        Number.isFinite(Number(safeValue.returnedItems)) ? Number(safeValue.returnedItems) : returnedItems
    );
}

function resolvePromptPaginationTotal(count, rows = [], pagination = {}) {
    const parsedCount = Number(count);
    if (Number.isFinite(parsedCount) && parsedCount >= 0) {
        return parsedCount;
    }

    const returnedItems = Array.isArray(rows) ? rows.length : 0;
    if (!pagination.enabled) {
        return returnedItems;
    }

    const minimumSeenItems = Math.max(0, Number(pagination.start) || 0) + returnedItems;
    return returnedItems >= pagination.pageSize ? minimumSeenItems + 1 : minimumSeenItems;
}

function normalizePromptManageListRpcPayload(data, fallbackPagination = {}) {
    let rawPayload = data;
    if (typeof rawPayload === 'string') {
        try {
            rawPayload = JSON.parse(rawPayload);
        } catch {
            return null;
        }
    }

    const payload = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const rows = Array.isArray(payload.rows)
        ? payload.rows.map((row) => {
            const normalizedRow = applyPromptFieldFallbacks(row);
            return {
                ...normalizedRow,
                site_metrics: normalizePromptSiteMetrics(normalizedRow)
            };
        })
        : [];

    return {
        rows,
        pagination: normalizePromptPaginationPayload(payload.pagination, fallbackPagination, rows.length)
    };
}

function buildPromptManageListRpcArgs({ site = 'all', filters = {}, pagination = {} } = {}) {
    return {
        p_site: normalizePromptSiteContext(site),
        p_page: normalizePositiveInteger(pagination.page, 1),
        p_page_size: normalizePositiveInteger(pagination.pageSize, DEFAULT_PROMPT_PAGE_SIZE, {
            min: 1,
            max: MAX_PROMPT_PAGE_SIZE
        }),
        p_search: String(filters.search || '').trim(),
        p_category: String(filters.category || '').trim(),
        p_date_filter: String(filters.date || '').trim().toLowerCase(),
        p_language_filter: String(filters.language || '').trim().toLowerCase(),
        p_status_filter: String(filters.status || '').trim().toLowerCase(),
        p_sort: normalizePromptSortValue(filters.sort)
    };
}

async function loadPromptListViaRpc(supabase, options = {}) {
    const pagination = options.pagination || { enabled: false };
    if (!pagination.enabled || typeof supabase?.rpc !== 'function') {
        return null;
    }

    try {
        const result = await supabase.rpc(
            'fn_admin_gallery_prompt_manage_list',
            buildPromptManageListRpcArgs(options)
        );

        if (result?.error) {
            console.warn('[PromptsManage] Gallery manage RPC unavailable, falling back to query path:', result.error.message || result.error);
            return null;
        }

        return normalizePromptManageListRpcPayload(result?.data, pagination);
    } catch (error) {
        console.warn('[PromptsManage] Gallery manage RPC failed, falling back to query path:', error?.message || error);
        return null;
    }
}

function shouldUseInMemoryPromptList(filters = {}) {
    return Boolean(
        filters.search
        || filters.language
        || filters.status
        || filters.sort === 'engagement-desc'
        || filters.sort === 'status-priority'
    );
}

function sanitizePostgrestOrTerm(value = '') {
    return String(value || '').replace(/[(),]/g, ' ').replace(/\*/g, '').trim();
}

function applyPromptDbFilters(query, filters = {}) {
    let nextQuery = query;
    const category = String(filters.category || '').trim();
    const searchTerms = String(filters.search || '')
        .split(/\s+/)
        .map(sanitizePostgrestOrTerm)
        .filter(Boolean)
        .slice(0, 5);
    const dateValue = String(filters.date || '').trim().toLowerCase();

    if (category && typeof nextQuery?.contains === 'function') {
        nextQuery = nextQuery.contains('tags', [category]);
    }

    if (dateValue && typeof nextQuery?.gte === 'function') {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (dateValue === 'week') start.setDate(start.getDate() - 7);
        if (dateValue === 'month') start.setMonth(start.getMonth() - 1);
        if (dateValue === 'today' || dateValue === 'week' || dateValue === 'month') {
            nextQuery = nextQuery.gte('created_at', start.toISOString());
        }
    }

    if (searchTerms.length && typeof nextQuery?.or === 'function') {
        const searchFields = [
            'title',
            'title_zh',
            'title_en',
            'description',
            'description_zh',
            'description_en',
            'prompt_text',
            'prompt_text_zh',
            'prompt_text_en'
        ];
        for (const searchTerm of searchTerms) {
            nextQuery = nextQuery.or(searchFields.map((field) => `${field}.ilike.*${searchTerm}*`).join(','));
        }
    }

    return nextQuery;
}

function applyPromptDbSort(query, sort = 'updated-desc', excludedFields = []) {
    const normalizedSort = normalizePromptSortValue(sort);
    const excluded = new Set(Array.isArray(excludedFields) ? excludedFields : []);
    let nextQuery = query;

    if (normalizedSort === 'title-asc' && typeof nextQuery?.order === 'function') {
        nextQuery = nextQuery.order('title', { ascending: true });
        return typeof nextQuery?.order === 'function'
            ? nextQuery.order('created_at', { ascending: false })
            : nextQuery;
    }

    if (normalizedSort === 'created-desc' && typeof nextQuery?.order === 'function') {
        return nextQuery.order('created_at', { ascending: false });
    }

    if (typeof nextQuery?.order === 'function') {
        const primaryField = excluded.has('updated_at') ? 'created_at' : 'updated_at';
        nextQuery = nextQuery.order(primaryField, { ascending: false });
        if (primaryField !== 'created_at' && typeof nextQuery?.order === 'function') {
            nextQuery = nextQuery.order('created_at', { ascending: false });
        }
    }

    return nextQuery;
}

function applyPromptDbPagination(query, pagination = {}) {
    if (!pagination.enabled || typeof query?.range !== 'function') {
        return query;
    }
    return query.range(pagination.start, pagination.end);
}

async function executePromptMutationWithFallback(executor, payload = {}) {
    const excludedFields = new Set();
    const attemptedPayload = payload && typeof payload === 'object' ? { ...payload } : {};

    while (true) {
        const { payload: nextPayload } = stripUnsupportedPromptPayloadFields(payload, excludedFields);
        const selectFields = buildPromptSelectFields([...excludedFields]);
        const result = await executor(nextPayload, selectFields);

        if (!result?.error) {
            return result;
        }

        const missingFields = getMissingOptionalPromptColumnFields(result.error)
            .filter((field) => !excludedFields.has(field));
        if (!missingFields.length) {
            return result;
        }

        const missingBilingualFields = missingFields.filter((field) => PROMPT_BILINGUAL_SELECT_FIELDS.includes(field));
        if (missingBilingualFields.length > 0 && payloadHasVisibleBilingualFields(attemptedPayload, missingBilingualFields)) {
            const error = new Error(`Prompt 双语字段尚未被 API schema cache 识别。若你已执行加列 SQL，请再执行 ${PROMPT_SCHEMA_RELOAD_SQL}`);
            error.statusCode = 409;
            return { data: null, error };
        }

        const missingSourceFields = missingFields.filter((field) => PROMPT_SOURCE_ATTRIBUTION_FIELD_KEYS.includes(field));
        if (missingSourceFields.length > 0 && payloadHasVisiblePromptFields(attemptedPayload, missingSourceFields)) {
            const error = new Error(`Prompt 引用原作者字段尚未被 API schema cache 识别。若你已执行 supabase/migrations/20260619_add_prompt_source_attribution.sql，请再执行 ${PROMPT_SCHEMA_RELOAD_SQL}`);
            error.statusCode = 409;
            return { data: null, error };
        }

        missingFields.forEach((field) => excludedFields.add(field));
    }
}

async function loadPromptList(supabase, options = {}) {
    const filters = options.filters || {};
    const pagination = options.pagination || { enabled: false };
    const site = options.site || 'all';

    const rpcResult = await loadPromptListViaRpc(supabase, {
        site,
        filters,
        pagination
    });
    if (rpcResult) {
        return rpcResult;
    }

    if (pagination.enabled && !shouldUseInMemoryPromptList(filters)) {
        const result = await executePromptSelectWithFallback((selectFields, excludedFields) => {
            let query = supabase
                .from('prompts')
                .select(selectFields, { count: 'planned' });

            query = applyPromptDbFilters(query, filters);
            query = applyPromptDbSort(query, filters.sort, excludedFields);
            return applyPromptDbPagination(query, pagination);
        });

        if (result.error) throw result.error;

        const rows = await attachPromptSiteMetrics(
            supabase,
            (result.data || []).map((row) => applyPromptFieldFallbacks(row))
        );
        return {
            rows,
            pagination: buildPromptPaginationPayload(
                resolvePromptPaginationTotal(result.count, rows, pagination),
                pagination,
                rows.length
            )
        };
    }

    const result = await executePromptSelectWithFallback((selectFields) => (
        supabase
            .from('prompts')
            .select(selectFields)
            .order('created_at', { ascending: false })
    ));

    if (result.error) throw result.error;

    const rows = await attachPromptSiteMetrics(
        supabase,
        (result.data || []).map((row) => applyPromptFieldFallbacks(row))
    );
    const filteredRows = filterPromptRows(rows, filters)
        .sort((left, right) => comparePromptRows(left, right, {
            sort: filters.sort,
            site
        }));
    const pagedResult = paginatePromptRows(filteredRows, pagination);

    return {
        rows: pagedResult.rows,
        pagination: pagedResult.pagination
    };
}

async function loadPromptById(supabase, id) {
    const result = await executePromptSelectWithFallback((selectFields) => (
        supabase
            .from('prompts')
            .select(selectFields)
            .eq('id', id)
            .single()
    ));

    if (!result?.error) {
        return applyPromptFieldFallbacks(result.data);
    }

    if (result.error.code === 'PGRST116') {
        const notFoundError = new Error('Prompt not found');
        notFoundError.statusCode = 404;
        throw notFoundError;
    }

    throw result.error;
}

function createEmptyPromptSiteMetrics() {
    return {
        cn: { unlock_count: 0, comment_count: 0 },
        intl: { unlock_count: 0, comment_count: 0 },
        total: { unlock_count: 0, comment_count: 0 }
    };
}

async function loadPromptMetricRows(supabase, table, promptIds) {
    if (!promptIds.length) return [];

    const primaryResult = await supabase
        .from(table)
        .select('prompt_id, site')
        .in('prompt_id', promptIds);

    if (!primaryResult?.error) {
        return primaryResult.data || [];
    }

    if (isMissingPromptMetricTableError(primaryResult.error, table)) {
        return [];
    }

    if (!isMissingOptionalPromptMetricSiteError(primaryResult.error, table)) {
        throw primaryResult.error;
    }

    const fallbackResult = await supabase
        .from(table)
        .select('prompt_id')
        .in('prompt_id', promptIds);

    if (fallbackResult.error) {
        if (isMissingPromptMetricTableError(fallbackResult.error, table)) {
            return [];
        }
        throw fallbackResult.error;
    }

    return (fallbackResult.data || []).map((row) => ({
        ...row,
        site: 'cn'
    }));
}

async function attachPromptSiteMetrics(supabase, rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const promptIds = [...new Set(
        safeRows
            .map((row) => normalizePromptId(row?.id))
            .filter(Boolean)
    )];

    if (!promptIds.length) return safeRows;

    const metricsById = new Map(
        promptIds.map((id) => [id, createEmptyPromptSiteMetrics()])
    );

    const [unlockRows, commentRows] = await Promise.all([
        loadPromptMetricRows(supabase, 'prompt_unlocks', promptIds),
        loadPromptMetricRows(supabase, 'prompt_comments', promptIds)
    ]);

    for (const row of unlockRows) {
        const promptId = normalizePromptId(row?.prompt_id);
        const metrics = metricsById.get(promptId);
        if (!metrics) continue;
        const site = normalizePromptMetricSite(row?.site);
        metrics[site].unlock_count += 1;
        metrics.total.unlock_count += 1;
    }

    for (const row of commentRows) {
        const promptId = normalizePromptId(row?.prompt_id);
        const metrics = metricsById.get(promptId);
        if (!metrics) continue;
        const site = normalizePromptMetricSite(row?.site);
        metrics[site].comment_count += 1;
        metrics.total.comment_count += 1;
    }

    return safeRows.map((row) => ({
        ...row,
        site_metrics: metricsById.get(normalizePromptId(row?.id)) || createEmptyPromptSiteMetrics()
    }));
}

async function insertPromptRow(supabase, payload) {
    const result = await executePromptMutationWithFallback((nextPayload, selectFields) => (
        supabase
            .from('prompts')
            .insert(nextPayload)
            .select(selectFields)
            .single()
    ), payload);

    if (result.error) {
        throw result.error;
    }

    return applyPromptFieldFallbacks(result.data);
}

async function updatePromptRow(supabase, id, payload) {
    const result = await executePromptMutationWithFallback((nextPayload, selectFields) => (
        supabase
            .from('prompts')
            .update(nextPayload)
            .eq('id', id)
            .select(selectFields)
            .single()
    ), payload);

    if (result.error) {
        throw result.error;
    }

    return applyPromptFieldFallbacks(result.data);
}

module.exports = async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();

    if (!['GET', 'POST', 'DELETE'].includes(method)) {
        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const accessOptions = method === 'GET'
            ? { anyOf: ['prompts.manage', 'content.moderate'] }
            : { permission: 'prompts.manage' };
        const { supabase, user } = await requireAdmin(req, accessOptions);
        const searchParams = getSearchParams(req);
        const readSite = normalizePromptSiteContext(searchParams.get('site') || req.adminSite);
        const listQuery = normalizePromptListQuery(searchParams);

        if (method === 'GET') {
            const id = normalizePromptId(searchParams.get('id'));
            if (id) {
                const [rowWithMetrics] = await attachPromptSiteMetrics(supabase, [
                    await loadPromptById(supabase, id)
                ]);
                return sendJson(res, 200, {
                    success: true,
                    siteContext: readSite,
                    row: rowWithMetrics
                });
            }

            const listResult = await loadPromptList(supabase, {
                site: readSite,
                ...listQuery
            });
            return sendJson(res, 200, {
                success: true,
                siteContext: readSite,
                rows: listResult.rows,
                pagination: listResult.pagination,
                filters: listQuery.filters
            });
        }

        const body = await parseJsonBody(req);
        const site = requireWritableAdminSite(body.site || req.adminSite || searchParams.get('site'), { fieldName: 'site' });

        if (method === 'DELETE') {
            const ids = toUniqueStringArray([
                ...(Array.isArray(body.ids) ? body.ids : (body.ids ? [body.ids] : [])),
                body.id,
                ...searchParams.getAll('ids'),
                searchParams.get('id')
            ]);
            if (!ids.length) {
                return sendJson(res, 400, { success: false, message: 'id or ids is required' });
            }

            const { data, error } = await supabase
                .from('prompts')
                .delete()
                .in('id', ids)
                .select('id, title');

            if (error) throw error;

            const deletedRows = data || [];
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'prompts',
                site,
                actionType: ids.length > 1 ? 'prompt.delete_many' : 'prompt.delete',
                details: {
                    prompt_ids: deletedRows.map((row) => row.id),
                    prompt_titles: deletedRows.map((row) => row.title).filter(Boolean),
                    deleted_count: deletedRows.length
                }
            });

            return sendJson(res, 200, {
                success: true,
                site,
                deletedCount: deletedRows.length,
                ids: deletedRows.map((row) => row.id)
            });
        }

        const action = String(body.action || (body.id ? 'update' : 'create')).trim().toLowerCase();
        if (!['create', 'update', 'patch'].includes(action)) {
            return sendJson(res, 400, { success: false, message: 'Unsupported prompt action' });
        }

        const payload = buildPromptMutationPayload(body, { action });

        if (action === 'create') {
            const data = await insertPromptRow(supabase, payload);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'prompts',
                site,
                actionType: 'prompt.create',
                details: {
                    prompt_id: data.id,
                    title: data.title,
                    tags: data.tags || []
                }
            });

            return sendJson(res, 200, {
                success: true,
                site,
                row: data
            });
        }

        const id = normalizePromptId(body.id);
        if (!id) {
            return sendJson(res, 400, { success: false, message: 'id is required' });
        }

        let data;
        try {
            data = await updatePromptRow(supabase, id, payload);
        } catch (error) {
            if (error.code === 'PGRST116') {
                return sendJson(res, 404, { success: false, message: 'Prompt not found' });
            }
            throw error;
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'prompts',
            site,
            actionType: action === 'patch' ? 'prompt.patch' : 'prompt.update',
            details: {
                prompt_id: data.id,
                title: data.title,
                tags: data.tags || [],
                updated_fields: Object.keys(payload).filter((field) => field !== 'updated_at')
            }
        });

        return sendJson(res, 200, {
            success: true,
            site,
            row: data
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Prompt manage request failed'
        });
    }
};
