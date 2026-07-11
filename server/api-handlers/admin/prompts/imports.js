const crypto = require('node:crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { resolveR2Config } = require('../../_ai-image-models');

const IMPORT_BATCH_SELECT = 'id, source, mode, site, status, settings, stats, created_by, created_at, updated_at, completed_at, cleanup_after';
const IMPORT_ITEM_SELECT = [
    'id',
    'batch_id',
    'source',
    'source_item_id',
    'source_page_url',
    'original_work_url',
    'author_name',
    'author_handle',
    'favorite_count',
    'prompt_text',
    'prompt_hash',
    'image_sources',
    'temp_image_assets',
    'final_image_assets',
    'final_prompt_id',
    'duplicate_of_prompt_id',
    'status',
    'error_summary',
    'error_details',
    'imported_at',
    'cleaned_at',
    'cleanup_after',
    'created_at',
    'updated_at'
].join(', ');
const PROMPT_SELECT = 'id, title, tags, description, prompt_text, images, image_assets, source_url, source_author_name, source_author_handle, ai_tags, created_at, updated_at';
const IMPORT_MODES = new Set(['stream', 'crawl_only', 'upload_only', 'review_first']);
const IMPORT_BATCH_STATUSES = new Set(['draft', 'running', 'ready', 'uploading', 'completed', 'needs_attention', 'cancelled']);
const IMPORT_ITEM_STATUSES = new Set(['staged', 'needs_review', 'duplicate', 'queued', 'uploading', 'saving', 'imported', 'failed', 'skipped', 'cleaned']);
const PROMPT_STATUS_VALUES = new Set(['', 'draft', 'review', 'needs-localization', 'homepage-candidate', 'featured', 'ready', 'live', 'archived']);
const DEFAULT_IMPORT_SOURCE = 'meigen';
const DEFAULT_IMPORT_PAGE_SIZE = 20;
const MAX_IMPORT_PAGE_SIZE = 100;
const DEFAULT_MAX_IMAGE_COUNT = 12;
const MAX_IMAGE_COUNT = 24;
const DEFAULT_IMAGE_TIMEOUT_MS = 20000;
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeText(value, maxLength = 1000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeOptionalUrl(value, maxLength = 2000) {
    const raw = normalizeText(value, maxLength);
    if (!raw) return '';

    try {
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        return url.toString();
    } catch (_) {
        return '';
    }
}

function normalizeAuthorHandle(value = '') {
    const raw = normalizeText(value, 120).replace(/\s+/g, '');
    if (!raw) return '';
    return raw.startsWith('@') ? raw : `@${raw}`;
}

function normalizeImportSource(value = '') {
    return normalizeText(value, 40).toLowerCase() || DEFAULT_IMPORT_SOURCE;
}

function normalizeImportMode(value = '') {
    const mode = normalizeText(value, 40).toLowerCase().replace(/-/g, '_');
    return IMPORT_MODES.has(mode) ? mode : 'review_first';
}

function normalizeImportBatchStatus(value = '', fallback = 'draft') {
    const status = normalizeText(value, 40).toLowerCase();
    return IMPORT_BATCH_STATUSES.has(status) ? status : fallback;
}

function normalizeImportItemStatus(value = '', fallback = 'staged') {
    const status = normalizeText(value, 40).toLowerCase();
    return IMPORT_ITEM_STATUSES.has(status) ? status : fallback;
}

function normalizePromptOpsStatus(value = '', fallback = 'review') {
    const status = normalizeText(value, 40).toLowerCase();
    if (PROMPT_STATUS_VALUES.has(status)) return status;
    return fallback;
}

function normalizePositiveInteger(value, fallback, maxValue = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maxValue);
}

function normalizeNonNegativeInteger(value, fallback = 0) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

function normalizePromptHashText(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();
}

function hashPromptText(value = '') {
    const normalized = normalizePromptHashText(value);
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function normalizeImageSourceEntry(entry = {}) {
    if (typeof entry === 'string') {
        const url = normalizeOptionalUrl(entry);
        return url ? { url } : null;
    }

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }

    const url = normalizeOptionalUrl(
        entry.url
        || entry.download_url
        || entry.downloadUrl
        || entry.original
        || entry.src
        || entry.href
    );
    if (!url) return null;

    return {
        url,
        label: normalizeText(entry.label || entry.name || '', 120),
        width: normalizeNonNegativeInteger(entry.width, 0),
        height: normalizeNonNegativeInteger(entry.height, 0)
    };
}

function normalizeImageSources(value = [], maxCount = DEFAULT_MAX_IMAGE_COUNT) {
    const rawItems = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n\r,，]+/);
    const seen = new Set();
    const items = [];

    for (const rawItem of rawItems) {
        const item = normalizeImageSourceEntry(rawItem);
        if (!item) continue;
        const key = item.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        if (items.length >= maxCount) break;
    }

    return items;
}

function normalizeImportSettings(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        favorite_min: normalizeNonNegativeInteger(source.favorite_min ?? source.favoriteMin, 0),
        favorite_max: normalizeNonNegativeInteger(source.favorite_max ?? source.favoriteMax, 0),
        max_items: normalizePositiveInteger(source.max_items ?? source.maxItems, 50, 1000),
        max_images_per_item: normalizePositiveInteger(source.max_images_per_item ?? source.maxImagesPerItem, DEFAULT_MAX_IMAGE_COUNT, MAX_IMAGE_COUNT),
        default_status: normalizePromptOpsStatus(source.default_status ?? source.defaultStatus, 'review'),
        duplicate_policy: normalizeText(source.duplicate_policy ?? source.duplicatePolicy, 40).toLowerCase() || 'skip',
        auto_cleanup: source.auto_cleanup === false || source.autoCleanup === false ? false : true,
        analyze_after_save: source.analyze_after_save === false || source.analyzeAfterSave === false ? false : true
    };
}

function normalizeImportItemPayload(rawItem = {}, settings = {}) {
    const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {};
    const promptText = normalizeText(item.prompt_text || item.promptText || item.prompt || '', 20000);
    const maxImages = normalizePositiveInteger(settings.max_images_per_item, DEFAULT_MAX_IMAGE_COUNT, MAX_IMAGE_COUNT);
    const expectedImageCount = normalizePositiveInteger(
        item.expected_image_count
        ?? item.expectedImageCount
        ?? item.image_count
        ?? item.imageCount,
        0,
        MAX_IMAGE_COUNT
    );
    const imageSources = normalizeImageSources(
        item.image_sources
        || item.imageSources
        || item.images
        || item.image_urls
        || item.imageUrls
        || [],
        maxImages
    );
    const promptHash = hashPromptText(promptText);
    const originalWorkUrl = normalizeOptionalUrl(item.original_work_url || item.originalWorkUrl || item.source_url || item.sourceUrl || item.x_url || item.xUrl || item.twitter_url || item.twitterUrl || '');
    const authorName = normalizeText(item.author_name || item.authorName || item.nickname || item.creator || '', 200);
    const authorHandle = normalizeAuthorHandle(item.author_handle || item.authorHandle || item.author_id || item.authorId || item.handle || '');
    const missingReasons = [];

    if (!promptText) missingReasons.push('没有抓到提示词');
    if (!imageSources.length) missingReasons.push('没有可保存的图片');
    if (!originalWorkUrl) missingReasons.push('缺少 X 原帖链接');
    if (!authorName) missingReasons.push('缺少原作者昵称');
    if (!authorHandle) missingReasons.push('缺少原作者 ID');

    return {
        source: normalizeImportSource(item.source || settings.source || DEFAULT_IMPORT_SOURCE),
        source_item_id: normalizeText(item.source_item_id || item.sourceItemId || item.meigen_id || item.meigenId || item.id || '', 220),
        source_page_url: normalizeOptionalUrl(item.source_page_url || item.sourcePageUrl || item.meigen_url || item.meigenUrl || item.detail_url || item.detailUrl || ''),
        original_work_url: originalWorkUrl,
        author_name: authorName,
        author_handle: authorHandle,
        favorite_count: normalizeNonNegativeInteger(item.favorite_count ?? item.favoriteCount ?? item.likes ?? item.bookmarks, 0),
        prompt_text: promptText,
        prompt_hash: promptHash,
        image_sources: imageSources,
        temp_image_assets: Array.isArray(item.temp_image_assets || item.tempImageAssets) ? (item.temp_image_assets || item.tempImageAssets) : [],
        final_image_assets: [],
        status: missingReasons.length ? 'needs_review' : 'staged',
        error_summary: missingReasons.join('；'),
        error_details: {
            import_image_count: Math.max(expectedImageCount, imageSources.length),
            expected_image_count: expectedImageCount,
            source_image_count: imageSources.length
        }
    };
}

function getItemImageSourceUrls(item = {}) {
    return normalizeImageSources(item.image_sources || [], MAX_IMAGE_COUNT).map((entry) => entry.url);
}

function getImportItemUploadBlockReason(item = {}) {
    const promptText = normalizeText(item.prompt_text || '', 20000);
    const imageSources = getItemImageSourceUrls(item);
    const originalWorkUrl = normalizeOptionalUrl(item.original_work_url || '');
    const authorName = normalizeText(item.author_name || '', 200);
    const authorHandle = normalizeAuthorHandle(item.author_handle || '');
    const reasons = [];

    if (!promptText) reasons.push('没有抓到提示词');
    if (!imageSources.length) reasons.push('没有可保存的图片');
    if (!originalWorkUrl) reasons.push('缺少 X 原帖链接');
    if (!authorName) reasons.push('缺少原作者昵称');
    if (!authorHandle) reasons.push('缺少原作者 ID');

    return reasons.join('；');
}

function buildImportStats(items = []) {
    const rows = Array.isArray(items) ? items : [];
    const counts = rows.reduce((acc, item) => {
        const status = normalizeImportItemStatus(item?.status || 'staged');
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    return {
        total: rows.length,
        staged: counts.staged || 0,
        needs_review: counts.needs_review || 0,
        duplicate: counts.duplicate || 0,
        queued: counts.queued || 0,
        uploading: counts.uploading || 0,
        saving: counts.saving || 0,
        imported: counts.imported || 0,
        failed: counts.failed || 0,
        skipped: counts.skipped || 0,
        cleaned: counts.cleaned || 0
    };
}

function getImportPageQuery(searchParams) {
    return {
        batchId: normalizeText(searchParams.get('batchId') || searchParams.get('batch_id'), 120),
        status: normalizeImportItemStatus(searchParams.get('status') || '', ''),
        limit: normalizePositiveInteger(searchParams.get('limit'), DEFAULT_IMPORT_PAGE_SIZE, MAX_IMPORT_PAGE_SIZE)
    };
}

function isBlockedImportHostname(hostname = '') {
    const host = String(hostname || '').trim().toLowerCase();
    return !host
        || host === 'localhost'
        || host.endsWith('.localhost')
        || host === '0.0.0.0'
        || host.startsWith('127.')
        || host.startsWith('10.')
        || host.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
        || host === '169.254.169.254';
}

function assertRemoteImageUrlAllowed(rawUrl = '') {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        const error = new Error('图片地址不支持');
        error.statusCode = 400;
        throw error;
    }
    if (isBlockedImportHostname(url.hostname)) {
        const error = new Error('图片地址不允许访问');
        error.statusCode = 400;
        throw error;
    }
    return url;
}

function getImageMimeType(response, url) {
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType.startsWith('image/')) return contentType;

    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (pathname.endsWith('.png')) return 'image/png';
    return 'image/jpeg';
}

function getImageExtension(mimeType = 'image/jpeg') {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('avif')) return 'avif';
    return 'jpg';
}

async function downloadRemoteImage(url, {
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_IMAGE_BYTES
} = {}) {
    assertRemoteImageUrlAllowed(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
                'User-Agent': 'ZaoyoeGalleryImport/1.0'
            }
        });
        if (!response.ok) {
            throw new Error(`图片下载失败 (${response.status})`);
        }

        const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            throw new Error('图片超过大小限制');
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) {
            throw new Error('图片为空');
        }
        if (buffer.length > maxBytes) {
            throw new Error('图片超过大小限制');
        }

        return {
            buffer,
            mimeType: getImageMimeType(response, url)
        };
    } finally {
        clearTimeout(timer);
    }
}

function createR2Client(config) {
    return new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        }
    });
}

function buildPromptImportImageKey({
    site = 'cn',
    batchId = '',
    itemId = '',
    index = 0,
    buffer = Buffer.alloc(0),
    mimeType = 'image/jpeg'
} = {}) {
    const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const safeSite = normalizeAdminSite(site, { defaultValue: 'cn' }) === 'intl' ? 'intl' : 'cn';
    const safeBatch = normalizeText(batchId, 100).replace(/[^a-z0-9-]/gi, '') || 'batch';
    const safeItem = normalizeText(itemId, 100).replace(/[^a-z0-9-]/gi, '') || 'item';
    const extension = getImageExtension(mimeType);

    return `prompts/imports/${safeSite}/${year}/${month}/${safeBatch}/${safeItem}-${index}-${digest}.${extension}`;
}

async function uploadImportImageBufferToR2(buffer, {
    site,
    batchId,
    itemId,
    index,
    mimeType
} = {}) {
    const config = resolveR2Config(process.env);
    if (!config.configured) {
        const error = new Error('图片存储未配置，无法保存到 Gallery');
        error.statusCode = 503;
        error.code = 'prompt_import_storage_not_configured';
        throw error;
    }

    const key = buildPromptImportImageKey({ site, batchId, itemId, index, buffer, mimeType });
    const client = createR2Client(config);
    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable'
    }));

    return {
        original: `${config.publicUrl}/${key}`,
        storage_path: key
    };
}

async function uploadImportItemImages(item, { site = 'cn' } = {}) {
    const sourceUrls = getItemImageSourceUrls(item);
    if (!sourceUrls.length) {
        const error = new Error('没有可保存的图片');
        error.statusCode = 400;
        throw error;
    }

    const assets = [];
    const failures = [];
    for (let index = 0; index < sourceUrls.length; index += 1) {
        const url = sourceUrls[index];
    try {
            const downloaded = await downloadRemoteImage(url, {
                timeoutMs: normalizePositiveInteger(process.env.PROMPT_IMPORT_IMAGE_TIMEOUT_MS, DEFAULT_IMAGE_TIMEOUT_MS, 60000),
                maxBytes: normalizePositiveInteger(process.env.PROMPT_IMPORT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES, 80 * 1024 * 1024)
            });
            const stored = await uploadImportImageBufferToR2(downloaded.buffer, {
                site,
                batchId: item.batch_id,
                itemId: item.id,
                index,
                mimeType: downloaded.mimeType
            });
            assets.push(stored);
        } catch (error) {
            failures.push({
                url,
                message: error.message || '图片保存失败'
            });
        }
    }

    if (!assets.length) {
        const error = new Error('图片保存失败');
        error.statusCode = 502;
        error.details = { failures };
        throw error;
    }

    return {
        assets,
        urls: assets.map((asset) => asset.original).filter(Boolean),
        failures
    };
}

function buildPromptTitleFromItem(item = {}) {
    return normalizeText(item.title || item.prompt_title || item.promptTitle || '', 120);
}

function normalizePromptReferenceId(value) {
    const text = normalizeText(value, 120);
    return text || null;
}

function buildPromptPayloadFromImportItem(item, {
    imageAssets = [],
    defaultStatus = 'review'
} = {}) {
    const promptText = normalizeText(item.prompt_text || '', 20000);
    if (!promptText) {
        const error = new Error('没有抓到提示词');
        error.statusCode = 400;
        throw error;
    }
    if (!imageAssets.length) {
        const error = new Error('没有可保存的图片');
        error.statusCode = 400;
        throw error;
    }

    const requestedStatus = normalizePromptOpsStatus(defaultStatus, 'review');
    const status = requestedStatus === 'live' ? 'review' : requestedStatus;
    const aiTags = status
        ? {
            admin: {
                status,
                note: 'Meigen 导入助手保存',
                source: 'prompt_import'
            }
        }
        : {};

    return {
        title: buildPromptTitleFromItem(item),
        tags: ['Creative'],
        description: '',
        prompt_text: promptText,
        prompt_text_en: /[\u3400-\u9fff\uf900-\ufaff]/.test(promptText) ? '' : promptText,
        prompt_text_zh: '',
        images: imageAssets.map((asset) => asset.original).filter(Boolean),
        image_assets: imageAssets,
        source_url: normalizeOptionalUrl(item.original_work_url || ''),
        source_author_name: normalizeText(item.author_name || '', 200),
        source_author_handle: normalizeAuthorHandle(item.author_handle || ''),
        ai_tags: aiTags,
        updated_at: new Date().toISOString()
    };
}

function buildCleanedImportedItemPayload({ finalPromptId, finalImageAssets = [], cleanupAfter = null } = {}) {
    return {
        status: 'imported',
        prompt_text: '',
        image_sources: [],
        temp_image_assets: [],
        final_image_assets: finalImageAssets,
        final_prompt_id: normalizePromptReferenceId(finalPromptId),
        error_summary: '',
        error_details: {},
        imported_at: new Date().toISOString(),
        cleaned_at: new Date().toISOString(),
        cleanup_after: cleanupAfter,
        updated_at: new Date().toISOString()
    };
}

function buildDeferredImportedItemPayload({ finalPromptId, finalImageAssets = [], cleanupAfter = null } = {}) {
    return {
        status: 'imported',
        final_image_assets: finalImageAssets,
        final_prompt_id: normalizePromptReferenceId(finalPromptId),
        error_summary: '',
        error_details: {},
        imported_at: new Date().toISOString(),
        cleanup_after: cleanupAfter,
        updated_at: new Date().toISOString()
    };
}

async function updateBatchStats(supabase, batchId) {
    const { data, error } = await supabase
        .from('prompt_import_items')
        .select('status')
        .eq('batch_id', batchId);
    if (error) throw error;

    const stats = buildImportStats(data || []);
    const nextStatus = stats.failed || stats.needs_review || stats.duplicate
        ? 'needs_attention'
        : (stats.total > 0 && stats.imported + stats.cleaned + stats.skipped === stats.total ? 'completed' : 'ready');

    const { data: batch, error: updateError } = await supabase
        .from('prompt_import_batches')
        .update({
            stats,
            status: nextStatus,
            completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
        })
        .eq('id', batchId)
        .select(IMPORT_BATCH_SELECT)
        .single();
    if (updateError) throw updateError;
    return batch;
}

async function loadImportBatch(supabase, batchId) {
    const { data, error } = await supabase
        .from('prompt_import_batches')
        .select(IMPORT_BATCH_SELECT)
        .eq('id', batchId)
        .single();
    if (error) throw error;
    return data;
}

async function loadImportItem(supabase, itemId) {
    const { data, error } = await supabase
        .from('prompt_import_items')
        .select(IMPORT_ITEM_SELECT)
        .eq('id', itemId)
        .single();
    if (error) throw error;
    return data;
}

async function createImportBatch(supabase, user, body) {
    const site = requireWritableAdminSite(body.site || 'cn', { fieldName: 'site' });
    const settings = normalizeImportSettings(body.settings || body);
    const payload = {
        source: normalizeImportSource(body.source || DEFAULT_IMPORT_SOURCE),
        mode: normalizeImportMode(body.mode || settings.mode),
        site,
        status: normalizeImportBatchStatus(body.status, 'draft'),
        settings,
        stats: buildImportStats([]),
        created_by: user?.id || null,
        updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase
        .from('prompt_import_batches')
        .insert(payload)
        .select(IMPORT_BATCH_SELECT)
        .single();
    if (error) throw error;
    return data;
}

async function findExistingPromptDuplicates(supabase, rows = []) {
    const sourceUrls = [...new Set(
        rows
            .map((row) => normalizeOptionalUrl(row.original_work_url || ''))
            .filter(Boolean)
    )].slice(0, 100);
    const promptTexts = [...new Set(
        rows
            .map((row) => normalizeText(row.prompt_text || '', 20000))
            .filter(Boolean)
    )].slice(0, 100);

    const duplicatesBySourceUrl = new Map();
    const duplicatesByPromptHash = new Map();

    if (sourceUrls.length) {
        const { data, error } = await supabase
            .from('prompts')
            .select('id, source_url, prompt_text')
            .in('source_url', sourceUrls);
        if (!error) {
            (data || []).forEach((prompt) => {
                const sourceUrl = normalizeOptionalUrl(prompt.source_url || '');
                if (sourceUrl) {
                    duplicatesBySourceUrl.set(sourceUrl, prompt.id);
                }
                const promptHash = hashPromptText(prompt.prompt_text || '');
                if (promptHash) {
                    duplicatesByPromptHash.set(promptHash, prompt.id);
                }
            });
        }
    }

    if (promptTexts.length) {
        const { data, error } = await supabase
            .from('prompts')
            .select('id, source_url, prompt_text')
            .in('prompt_text', promptTexts);
        if (!error) {
            (data || []).forEach((prompt) => {
                const promptHash = hashPromptText(prompt.prompt_text || '');
                if (promptHash) {
                    duplicatesByPromptHash.set(promptHash, prompt.id);
                }
                const sourceUrl = normalizeOptionalUrl(prompt.source_url || '');
                if (sourceUrl) {
                    duplicatesBySourceUrl.set(sourceUrl, prompt.id);
                }
            });
        }
    }

    return {
        bySourceUrl: duplicatesBySourceUrl,
        byPromptHash: duplicatesByPromptHash
    };
}

function normalizePromptImageAssetsFromRow(prompt = {}) {
    if (Array.isArray(prompt.image_assets) && prompt.image_assets.length) {
        return prompt.image_assets;
    }
    if (Array.isArray(prompt.images)) {
        return prompt.images
            .map((url) => normalizeOptionalUrl(url))
            .filter(Boolean)
            .map((url) => ({ original: url }));
    }
    return [];
}

async function findExistingPromptForImportItem(supabase, item = {}) {
    const sourceUrl = normalizeOptionalUrl(item.original_work_url || '');
    const promptText = normalizeText(item.prompt_text || '', 20000);

    if (sourceUrl) {
        const { data, error } = await supabase
            .from('prompts')
            .select(PROMPT_SELECT)
            .eq('source_url', sourceUrl)
            .limit(1);
        if (!error && Array.isArray(data) && data[0]) {
            return data[0];
        }
    }

    if (promptText) {
        const { data, error } = await supabase
            .from('prompts')
            .select(PROMPT_SELECT)
            .eq('prompt_text', promptText)
            .limit(1);
        if (!error && Array.isArray(data) && data[0]) {
            return data[0];
        }
    }

    return null;
}

async function stageImportItems(supabase, user, body) {
    const batchId = normalizeText(body.batch_id || body.batchId, 120);
    const batch = batchId ? await loadImportBatch(supabase, batchId) : await createImportBatch(supabase, user, body);
    const settings = {
        ...normalizeImportSettings(batch.settings || {}),
        source: batch.source
    };
    const maxItems = normalizePositiveInteger(settings.max_items, 50, 1000);
    const rawItems = (Array.isArray(body.items) ? body.items : []).slice(0, maxItems);
    const seenPromptHashes = new Set();
    const rows = rawItems.map((rawItem) => {
        const row = normalizeImportItemPayload(rawItem, settings);
        if (row.prompt_hash && seenPromptHashes.has(row.prompt_hash)) {
            row.status = 'duplicate';
            row.error_summary = '疑似重复';
        }
        if (row.prompt_hash) {
            seenPromptHashes.add(row.prompt_hash);
        }
        return {
            ...row,
            batch_id: batch.id,
            updated_at: new Date().toISOString()
        };
    });

    if (!rows.length) {
        const error = new Error('没有可导入的内容');
        error.statusCode = 400;
        throw error;
    }

    const existingDuplicates = await findExistingPromptDuplicates(supabase, rows);
    rows.forEach((row) => {
        const sourceDuplicateId = row.original_work_url
            ? existingDuplicates.bySourceUrl.get(row.original_work_url)
            : '';
        const promptDuplicateId = row.prompt_hash
            ? existingDuplicates.byPromptHash.get(row.prompt_hash)
            : '';
        const duplicateId = sourceDuplicateId || promptDuplicateId || '';
        if (duplicateId) {
            row.status = 'duplicate';
            row.duplicate_of_prompt_id = normalizePromptReferenceId(duplicateId);
            row.error_summary = '疑似重复';
        }
    });

    const { data, error } = await supabase
        .from('prompt_import_items')
        .insert(rows)
        .select(IMPORT_ITEM_SELECT);
    if (error) throw error;

    const updatedBatch = await updateBatchStats(supabase, batch.id);
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'prompts',
        site: batch.site,
        actionType: 'prompt_import.stage',
        details: {
            batch_id: batch.id,
            staged_count: data?.length || 0,
            source: batch.source
        }
    });

    return {
        batch: updatedBatch,
        items: data || []
    };
}

async function insertPromptRow(supabase, payload) {
    const { data, error } = await supabase
        .from('prompts')
        .insert(payload)
        .select(PROMPT_SELECT)
        .single();
    if (error) throw error;
    return data;
}

async function importSingleItem(supabase, user, itemId, options = {}) {
    const item = await loadImportItem(supabase, itemId);
    const batch = await loadImportBatch(supabase, item.batch_id);
    const site = requireWritableAdminSite(options.site || batch.site, { fieldName: 'site' });
    const settings = normalizeImportSettings(batch.settings || {});
    const defaultStatus = normalizePromptOpsStatus(options.default_status || options.defaultStatus || settings.default_status, 'review');
    const cleanupOnSave = options.cleanup_after_pipeline === true || options.cleanupAfterPipeline === true
        ? false
        : settings.auto_cleanup;
    const preflightReason = getImportItemUploadBlockReason(item);

    if (preflightReason) {
        const { data: skippedItem, error: skipError } = await supabase
            .from('prompt_import_items')
            .update({
                status: 'skipped',
                error_summary: preflightReason,
                updated_at: new Date().toISOString()
            })
            .eq('id', item.id)
            .select(IMPORT_ITEM_SELECT)
            .single();
        if (skipError) throw skipError;
        const updatedBatch = await updateBatchStats(supabase, batch.id);
        return {
            batch: updatedBatch,
            item: skippedItem || item,
            skipped: true,
            error: preflightReason
        };
    }

    await supabase
        .from('prompt_import_items')
        .update({
            status: 'uploading',
            error_summary: '',
            error_details: {},
            updated_at: new Date().toISOString()
        })
        .eq('id', item.id);

    try {
        const existingPrompt = await findExistingPromptForImportItem(supabase, item);
        if (existingPrompt?.id) {
            const { data: updatedItem, error: updateError } = await supabase
                .from('prompt_import_items')
                .update({
                    status: 'skipped',
                    duplicate_of_prompt_id: normalizePromptReferenceId(existingPrompt.id),
                    error_summary: '提示词库已有重复内容，已跳过',
                    updated_at: new Date().toISOString()
                })
                .eq('id', item.id)
                .select(IMPORT_ITEM_SELECT)
                .single();
            if (updateError) throw updateError;

            const updatedBatch = await updateBatchStats(supabase, batch.id);
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'prompts',
                site,
                actionType: 'prompt_import.skip_duplicate',
                details: {
                    batch_id: batch.id,
                    item_id: item.id,
                    prompt_id: normalizePromptReferenceId(existingPrompt.id),
                    source: item.source
                }
            });

            return {
                batch: updatedBatch,
                item: updatedItem,
                skipped: true,
                duplicateOfPromptId: normalizePromptReferenceId(existingPrompt.id),
                error: '提示词库已有重复内容，已跳过'
            };
        }

        const uploadResult = await uploadImportItemImages(item, { site });
        await supabase
            .from('prompt_import_items')
            .update({
                status: 'saving',
                final_image_assets: uploadResult.assets,
                error_details: uploadResult.failures.length ? { image_failures: uploadResult.failures } : {},
                updated_at: new Date().toISOString()
            })
            .eq('id', item.id);

        const promptPayload = buildPromptPayloadFromImportItem(item, {
            imageAssets: uploadResult.assets,
            defaultStatus
        });
        const prompt = await insertPromptRow(supabase, promptPayload);
        const cleanupAfter = cleanupOnSave
            ? null
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const cleanedPayload = cleanupOnSave
            ? buildCleanedImportedItemPayload({
                finalPromptId: prompt.id,
                finalImageAssets: uploadResult.assets,
                cleanupAfter
            })
            : buildDeferredImportedItemPayload({
                finalPromptId: prompt.id,
                finalImageAssets: uploadResult.assets,
                cleanupAfter
            });
        const { data: updatedItem, error: updateError } = await supabase
            .from('prompt_import_items')
            .update(cleanedPayload)
            .eq('id', item.id)
            .select(IMPORT_ITEM_SELECT)
            .single();
        if (updateError) throw updateError;

        const updatedBatch = await updateBatchStats(supabase, batch.id);
        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'prompts',
            site,
            actionType: 'prompt_import.save_to_gallery',
            details: {
                batch_id: batch.id,
                item_id: item.id,
                prompt_id: prompt.id,
                image_count: uploadResult.assets.length,
                source: item.source
            }
        });

        return {
            batch: updatedBatch,
            item: updatedItem,
            prompt,
            imageFailures: uploadResult.failures
        };
    } catch (error) {
        const { data: failedItem } = await supabase
            .from('prompt_import_items')
            .update({
                status: 'failed',
                error_summary: error.message || '导入失败',
                error_details: error.details || {},
                updated_at: new Date().toISOString()
            })
            .eq('id', item.id)
            .select(IMPORT_ITEM_SELECT)
            .single();
        const updatedBatch = await updateBatchStats(supabase, batch.id);
        return {
            batch: updatedBatch,
            item: failedItem || item,
            error: error.message || '导入失败'
        };
    }
}

async function importManyItems(supabase, user, body) {
    const itemIds = [...new Set(
        (Array.isArray(body.item_ids) ? body.item_ids : (Array.isArray(body.itemIds) ? body.itemIds : []))
            .map((value) => normalizeText(value, 120))
            .filter(Boolean)
    )];
    if (!itemIds.length) {
        const error = new Error('请选择要上传的内容');
        error.statusCode = 400;
        throw error;
    }

    const results = [];
    for (const itemId of itemIds) {
        results.push(await importSingleItem(supabase, user, itemId, body));
    }

    return {
        results,
        successCount: results.filter((result) => result.prompt).length,
        failedCount: results.filter((result) => result.error).length
    };
}

async function cleanupImportItems(supabase, user, body) {
    const itemIds = [...new Set(
        (Array.isArray(body.item_ids) ? body.item_ids : (Array.isArray(body.itemIds) ? body.itemIds : []))
            .map((value) => normalizeText(value, 120))
            .filter(Boolean)
    )];
    if (!itemIds.length) {
        const error = new Error('请选择要清理的内容');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('prompt_import_items')
        .update({
            prompt_text: '',
            image_sources: [],
            temp_image_assets: [],
            status: 'cleaned',
            cleaned_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .in('id', itemIds)
        .select(IMPORT_ITEM_SELECT);
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'prompts',
        site: normalizeAdminSite(body.site || 'cn', { defaultValue: 'cn' }),
        actionType: 'prompt_import.cleanup',
        details: {
            item_ids: itemIds,
            cleaned_count: data?.length || 0
        }
    });

    return {
        items: data || [],
        cleanedCount: data?.length || 0
    };
}

async function skipImportItems(supabase, user, body) {
    const itemIds = [...new Set(
        (Array.isArray(body.item_ids) ? body.item_ids : (Array.isArray(body.itemIds) ? body.itemIds : []))
            .map((value) => normalizeText(value, 120))
            .filter(Boolean)
    )];
    if (!itemIds.length) {
        const error = new Error('请选择要跳过的内容');
        error.statusCode = 400;
        throw error;
    }

    const reason = normalizeText(body.reason || body.error_summary || body.errorSummary || '信息不完整，已跳过', 500);
    const { data, error } = await supabase
        .from('prompt_import_items')
        .update({
            status: 'skipped',
            error_summary: reason,
            updated_at: new Date().toISOString()
        })
        .in('id', itemIds)
        .select(IMPORT_ITEM_SELECT);
    if (error) throw error;

    const batchIds = [...new Set((data || []).map((item) => item.batch_id).filter(Boolean))];
    const batches = [];
    for (const batchId of batchIds) {
        batches.push(await updateBatchStats(supabase, batchId));
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'prompts',
        site: normalizeAdminSite(body.site || 'cn', { defaultValue: 'cn' }),
        actionType: 'prompt_import.skip',
        details: {
            item_ids: itemIds,
            skipped_count: data?.length || 0,
            reason
        }
    });

    return {
        items: data || [],
        skippedCount: data?.length || 0,
        batch: batches[batches.length - 1] || null
    };
}

async function markImportItemsFailed(supabase, user, body) {
    const itemIds = [...new Set(
        (Array.isArray(body.item_ids) ? body.item_ids : (Array.isArray(body.itemIds) ? body.itemIds : []))
            .map((value) => normalizeText(value, 120))
            .filter(Boolean)
    )];
    if (!itemIds.length) {
        const error = new Error('请选择要标记失败的内容');
        error.statusCode = 400;
        throw error;
    }

    const reason = normalizeText(body.reason || body.error_summary || body.errorSummary || '已保存，但发布流程未完成', 500);
    const { data, error } = await supabase
        .from('prompt_import_items')
        .update({
            status: 'failed',
            error_summary: reason,
            updated_at: new Date().toISOString()
        })
        .in('id', itemIds)
        .select(IMPORT_ITEM_SELECT);
    if (error) throw error;

    const batchIds = [...new Set((data || []).map((item) => item.batch_id).filter(Boolean))];
    const batches = [];
    for (const batchId of batchIds) {
        batches.push(await updateBatchStats(supabase, batchId));
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'prompts',
        site: normalizeAdminSite(body.site || 'cn', { defaultValue: 'cn' }),
        actionType: 'prompt_import.fail',
        details: {
            item_ids: itemIds,
            failed_count: data?.length || 0,
            reason
        }
    });

    return {
        items: data || [],
        failedCount: data?.length || 0,
        batch: batches[batches.length - 1] || null
    };
}

async function listImportBatches(supabase, searchParams) {
    const limit = normalizePositiveInteger(searchParams.get('limit'), 20, MAX_IMPORT_PAGE_SIZE);
    const { data, error } = await supabase
        .from('prompt_import_batches')
        .select(IMPORT_BATCH_SELECT)
        .order('updated_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function listImportItems(supabase, query) {
    if (!query.batchId) {
        const error = new Error('batchId is required');
        error.statusCode = 400;
        throw error;
    }
    let request = supabase
        .from('prompt_import_items')
        .select(IMPORT_ITEM_SELECT)
        .eq('batch_id', query.batchId);
    if (query.status) {
        request = request.eq('status', query.status);
    }

    const { data, error } = await request
        .order('updated_at', { ascending: false })
        .limit(query.limit);
    if (error) throw error;
    return data || [];
}

module.exports = async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'prompts.manage' });
        const searchParams = getSearchParams(req);

        if (method === 'GET') {
            const query = getImportPageQuery(searchParams);
            if (query.batchId) {
                const [batch, items] = await Promise.all([
                    loadImportBatch(supabase, query.batchId),
                    listImportItems(supabase, query)
                ]);
                return sendJson(res, 200, {
                    success: true,
                    batch,
                    items
                });
            }

            const batches = await listImportBatches(supabase, searchParams);
            return sendJson(res, 200, {
                success: true,
                batches
            });
        }

        const body = await parseJsonBody(req);
        const action = normalizeText(body.action, 60).toLowerCase();
        if (action === 'create_batch') {
            const batch = await createImportBatch(supabase, user, body);
            return sendJson(res, 200, { success: true, batch });
        }
        if (action === 'stage_items') {
            const result = await stageImportItems(supabase, user, body);
            return sendJson(res, 200, { success: true, ...result });
        }
        if (action === 'upload_item') {
            const itemId = normalizeText(body.item_id || body.itemId, 120);
            if (!itemId) {
                return sendJson(res, 400, { success: false, message: 'itemId is required' });
            }
            const result = await importSingleItem(supabase, user, itemId, body);
            return sendJson(res, result.error ? 207 : 200, { success: !result.error, ...result });
        }
        if (action === 'upload_items') {
            const result = await importManyItems(supabase, user, body);
            return sendJson(res, result.failedCount ? 207 : 200, {
                success: result.failedCount === 0,
                ...result
            });
        }
        if (action === 'cleanup_items') {
            const result = await cleanupImportItems(supabase, user, body);
            return sendJson(res, 200, { success: true, ...result });
        }
        if (action === 'skip_items') {
            const result = await skipImportItems(supabase, user, body);
            return sendJson(res, 200, { success: true, ...result });
        }
        if (action === 'fail_items') {
            const result = await markImportItemsFailed(supabase, user, body);
            return sendJson(res, 200, { success: true, ...result });
        }

        return sendJson(res, 400, { success: false, message: 'Unsupported prompt import action' });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Prompt import request failed',
            code: error.code || undefined
        });
    }
};

module.exports._private = {
    hashPromptText,
    normalizeImageSources,
    normalizeImportItemPayload,
    buildPromptPayloadFromImportItem,
    buildCleanedImportedItemPayload,
    buildImportStats,
    buildPromptImportImageKey
};
