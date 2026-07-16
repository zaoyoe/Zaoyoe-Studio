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
const {
    alignPromptImagePalettes,
    extractPromptImagePalette
} = require('../../../prompt-image-palette');

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
    'video_sources',
    'temp_image_assets',
    'temp_video_assets',
    'final_image_assets',
    'final_video_assets',
    'final_prompt_id',
    'duplicate_of_prompt_id',
    'status',
    'error_summary',
    'error_details',
    'imported_at',
    'cleaned_at',
    'cleanup_after',
    'worker_name',
    'lease_expires_at',
    'processing_attempts',
    'next_attempt_at',
    'pipeline_stage',
    'created_at',
    'updated_at'
].join(', ');
const PROMPT_SELECT = 'id, title, tags, description, prompt_text, images, image_assets, image_palettes, video_assets, source_url, source_author_name, source_author_handle, ai_tags, created_at, updated_at';
const IMPORT_MODES = new Set(['stream', 'crawl_only', 'upload_only', 'review_first']);
const IMPORT_BATCH_STATUSES = new Set(['draft', 'running', 'ready', 'uploading', 'completed', 'needs_attention', 'cancelled']);
const IMPORT_ITEM_STATUSES = new Set(['staged', 'needs_review', 'duplicate', 'queued', 'uploading', 'saving', 'imported', 'failed', 'skipped', 'cleaned']);
const PROMPT_STATUS_VALUES = new Set(['', 'draft', 'review', 'needs-localization', 'homepage-candidate', 'featured', 'ready', 'live', 'archived']);
const DEFAULT_IMPORT_SOURCE = 'meigen';
const DEFAULT_IMPORT_PAGE_SIZE = 20;
const MAX_IMPORT_PAGE_SIZE = 1000;
const MAX_IMPORT_PAGE = 100000;
const DEFAULT_MAX_IMAGE_COUNT = 12;
const MAX_IMAGE_COUNT = 24;
const DEFAULT_IMAGE_TIMEOUT_MS = 20000;
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_VIDEO_COUNT = 4;
const MAX_VIDEO_COUNT = 4;
const DEFAULT_VIDEO_TIMEOUT_MS = 120000;
const DEFAULT_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const PERSISTENT_FAILURE_BATCH_THRESHOLD = 2;

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

function deriveAuthorHandleFromOriginalWorkUrl(value = '') {
    const normalizedUrl = normalizeOptionalUrl(value);
    if (!normalizedUrl) return '';
    try {
        const parsed = new URL(normalizedUrl);
        if (!/(^|\.)(?:x|twitter)\.com$/i.test(parsed.hostname)) return '';
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length < 3 || String(parts[1]).toLowerCase() !== 'status') return '';
        if (!parts[0] || ['i', 'intent', 'share'].includes(String(parts[0]).toLowerCase())) return '';
        return normalizeAuthorHandle(parts[0]);
    } catch (_) {
        return '';
    }
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

function normalizeVideoSourceEntry(entry = {}) {
    const source = typeof entry === 'string' ? { url: entry } : entry;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const url = normalizeOptionalUrl(
        source.url || source.download_url || source.downloadUrl || source.original || source.src || source.href
    );
    if (!url) return null;
    const posterUrl = normalizeOptionalUrl(
        source.poster_url || source.posterUrl || source.poster || source.thumbnail_url || source.thumbnailUrl || source.thumb
    );
    return {
        url,
        ...(posterUrl ? { poster_url: posterUrl } : {}),
        mime_type: normalizeText(source.mime_type || source.mimeType || source.type || '', 120),
        width: normalizeNonNegativeInteger(source.width, 0),
        height: normalizeNonNegativeInteger(source.height, 0),
        duration: Math.max(0, Number(source.duration || source.duration_seconds || source.durationSeconds || 0) || 0)
    };
}

function normalizeVideoSources(value = [], maxCount = DEFAULT_MAX_VIDEO_COUNT) {
    const rawItems = Array.isArray(value) ? value : String(value || '').split(/[\n\r,，]+/);
    const seen = new Set();
    const items = [];
    for (const rawItem of rawItems) {
        const item = normalizeVideoSourceEntry(rawItem);
        if (!item) continue;
        const key = item.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        if (items.length >= maxCount) break;
    }
    return items;
}

function getTweetStatusIdFromUrl(value = '') {
    try {
        const url = new URL(String(value || ''));
        return url.pathname.match(/\/tweets\/(\d{12,25})(?:\/|$)/i)?.[1] || '';
    } catch (_) {
        return '';
    }
}

function getOriginalStatusIdFromUrl(value = '') {
    try {
        const url = new URL(String(value || ''));
        return url.pathname.match(/\/status\/(\d{12,25})(?:\/|$)/i)?.[1] || '';
    } catch (_) {
        return '';
    }
}

function getMeigenPromptIdFromUrl(value = '') {
    try {
        const url = new URL(String(value || ''));
        return url.pathname.match(/\/prompt\/(\d{12,25})(?:\/|$)/i)?.[1] || '';
    } catch (_) {
        return '';
    }
}

function getMeigenVideoStatusIdFromUrl(value = '') {
    try {
        const url = new URL(String(value || ''));
        return url.pathname.match(/\/videos\/(\d{12,25})(?:\/|$)/i)?.[1] || '';
    } catch (_) {
        return '';
    }
}

function getMeigenImportIdentityConflictReason(item = {}) {
    if (normalizeImportSource(item.source || DEFAULT_IMPORT_SOURCE) !== 'meigen') return '';
    const sourceItemId = /^\d{12,25}$/.test(String(item.source_item_id || item.sourceItemId || '').trim())
        ? String(item.source_item_id || item.sourceItemId).trim()
        : '';
    const detailId = getMeigenPromptIdFromUrl(item.source_page_url || item.sourcePageUrl || '');
    const originalId = getOriginalStatusIdFromUrl(item.original_work_url || item.originalWorkUrl || '');
    const imageIds = normalizeImageSources(item.image_sources || item.imageSources || item.images || [], MAX_IMAGE_COUNT)
        .map((entry) => getTweetStatusIdFromUrl(entry.url))
        .filter(Boolean);
    const videoIds = normalizeVideoSources(item.video_sources || item.videoSources || item.videos || [], MAX_VIDEO_COUNT)
        .map((entry) => getMeigenVideoStatusIdFromUrl(entry.url))
        .filter(Boolean);
    const identities = [sourceItemId, detailId, originalId, ...imageIds, ...videoIds].filter(Boolean);
    return new Set(identities).size > 1 ? '作品详情、X 原帖或媒体身份不一致，已拒绝入队' : '';
}

function filterImageSourcesForImportIdentity(imageSources = [], item = {}) {
    const source = normalizeImportSource(item.source || DEFAULT_IMPORT_SOURCE);
    const originalWorkUrl = item.original_work_url || item.originalWorkUrl || item.source_url || item.sourceUrl || '';
    const expectedStatusId = getOriginalStatusIdFromUrl(originalWorkUrl);
    if (source !== 'meigen' || !expectedStatusId) return imageSources;
    const statusBoundImages = imageSources.filter((entry) => getTweetStatusIdFromUrl(entry?.url || ''));
    if (!statusBoundImages.length) return imageSources;
    return statusBoundImages.filter((entry) => getTweetStatusIdFromUrl(entry?.url || '') === expectedStatusId);
}

function normalizeImportSettings(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        favorite_min: normalizeNonNegativeInteger(source.favorite_min ?? source.favoriteMin, 0),
        favorite_max: normalizeNonNegativeInteger(source.favorite_max ?? source.favoriteMax, 0),
        max_items: normalizePositiveInteger(source.max_items ?? source.maxItems, 50, 1000),
        max_images_per_item: normalizePositiveInteger(source.max_images_per_item ?? source.maxImagesPerItem, DEFAULT_MAX_IMAGE_COUNT, MAX_IMAGE_COUNT),
        max_videos_per_item: normalizePositiveInteger(source.max_videos_per_item ?? source.maxVideosPerItem, DEFAULT_MAX_VIDEO_COUNT, MAX_VIDEO_COUNT),
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
    const requestedImageCount = normalizePositiveInteger(
        item.expected_image_count
        ?? item.expectedImageCount
        ?? item.image_count
        ?? item.imageCount,
        0,
        MAX_IMAGE_COUNT
    );
    const normalizedImageSources = normalizeImageSources(
        item.image_sources
        || item.imageSources
        || item.images
        || item.image_urls
        || item.imageUrls
        || [],
        maxImages
    );
    const imageSources = filterImageSourcesForImportIdentity(normalizedImageSources, item);
    const videoSources = normalizeVideoSources(
        item.video_sources || item.videoSources || item.videos || item.video_urls || item.videoUrls || [],
        normalizePositiveInteger(settings.max_videos_per_item, DEFAULT_MAX_VIDEO_COUNT, MAX_VIDEO_COUNT)
    );
    const originalStatusId = getOriginalStatusIdFromUrl(
        item.original_work_url || item.originalWorkUrl || item.source_url || item.sourceUrl || ''
    );
    const hasStatusBoundMeigenImages = normalizeImportSource(item.source || DEFAULT_IMPORT_SOURCE) === 'meigen'
        && Boolean(originalStatusId)
        && normalizedImageSources.some((entry) => getTweetStatusIdFromUrl(entry?.url || ''));
    const expectedImageCount = hasStatusBoundMeigenImages
        ? (imageSources.length ? Math.min(requestedImageCount || imageSources.length, imageSources.length) : 0)
        : requestedImageCount;
    const promptHash = hashPromptText(promptText);
    const originalWorkUrl = normalizeOptionalUrl(item.original_work_url || item.originalWorkUrl || item.source_url || item.sourceUrl || item.x_url || item.xUrl || item.twitter_url || item.twitterUrl || '');
    const authorName = normalizeText(item.author_name || item.authorName || item.nickname || item.creator || '', 200);
    const authorHandle = normalizeAuthorHandle(item.author_handle || item.authorHandle || item.author_id || item.authorId || item.handle || '')
        || deriveAuthorHandleFromOriginalWorkUrl(originalWorkUrl);
    const missingReasons = [];

    if (!promptText) missingReasons.push('没有抓到提示词');
    if (!imageSources.length && !videoSources.length) missingReasons.push('没有可保存的媒体');
    if (!originalWorkUrl) missingReasons.push('缺少 X 原帖链接');
    if (!authorName) missingReasons.push('缺少原作者昵称');
    if (!authorHandle) missingReasons.push('缺少原作者 ID');
    if (item.stream_pending_detail === true || item.streamPendingDetail === true) missingReasons.push('等待详情补全');

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
        video_sources: videoSources,
        temp_image_assets: Array.isArray(item.temp_image_assets || item.tempImageAssets) ? (item.temp_image_assets || item.tempImageAssets) : [],
        temp_video_assets: Array.isArray(item.temp_video_assets || item.tempVideoAssets) ? (item.temp_video_assets || item.tempVideoAssets) : [],
        final_image_assets: [],
        final_video_assets: [],
        status: missingReasons.length ? 'needs_review' : 'staged',
        error_summary: missingReasons.join('；'),
        error_details: {
            import_image_count: Math.max(expectedImageCount, imageSources.length),
            expected_image_count: expectedImageCount,
            source_image_count: imageSources.length,
            source_video_count: videoSources.length
        }
    };
}

function getItemImageSourceUrls(item = {}) {
    return normalizeImageSources(item.image_sources || [], MAX_IMAGE_COUNT).map((entry) => entry.url);
}

function getItemVideoSources(item = {}) {
    return normalizeVideoSources(item.video_sources || [], MAX_VIDEO_COUNT);
}

function getImportItemUploadBlockReason(item = {}) {
    const promptText = normalizeText(item.prompt_text || '', 20000);
    const imageSources = getItemImageSourceUrls(item);
    const videoSources = getItemVideoSources(item);
    const originalWorkUrl = normalizeOptionalUrl(item.original_work_url || '');
    const authorName = normalizeText(item.author_name || '', 200);
    const authorHandle = normalizeAuthorHandle(item.author_handle || '')
        || deriveAuthorHandleFromOriginalWorkUrl(originalWorkUrl);
    const reasons = [];

    if (!promptText) reasons.push('没有抓到提示词');
    if (!imageSources.length && !videoSources.length) reasons.push('没有可保存的媒体');
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
    const pageSize = normalizePositiveInteger(
        searchParams.get('pageSize') || searchParams.get('page_size') || searchParams.get('limit'),
        DEFAULT_IMPORT_PAGE_SIZE,
        MAX_IMPORT_PAGE_SIZE
    );
    return {
        batchId: normalizeText(searchParams.get('batchId') || searchParams.get('batch_id'), 120),
        status: normalizeImportItemStatus(searchParams.get('status') || '', ''),
        includeCleaned: searchParams.get('includeCleaned') === 'true' || searchParams.get('include_cleaned') === 'true',
        page: normalizePositiveInteger(searchParams.get('page'), 1, MAX_IMPORT_PAGE),
        pageSize
    };
}

function isBlockedImportHostname(hostname = '') {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return !host
        || host === 'localhost'
        || host.endsWith('.localhost')
        || host.endsWith('.local')
        || host === '::1'
        || host === '::'
        || /^f[cd][0-9a-f]{0,2}:/.test(host)
        || /^fe[89ab][0-9a-f]:/.test(host)
        || host.startsWith('::ffff:127.')
        || host.startsWith('::ffff:10.')
        || host.startsWith('::ffff:192.168.')
        || host === 'metadata.google.internal'
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

function isSupportedImageBuffer(buffer = Buffer.alloc(0)) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
    const header = buffer.subarray(0, 16);
    return (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
        || header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        || header.subarray(0, 6).toString('ascii') === 'GIF87a'
        || header.subarray(0, 6).toString('ascii') === 'GIF89a'
        || (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP')
        || header.subarray(4, 12).toString('ascii').includes('ftypavif')
        || header.subarray(4, 12).toString('ascii').includes('ftypavis');
}

function getVideoMimeType(response, url) {
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType.startsWith('video/')) return contentType;
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.webm')) return 'video/webm';
    if (pathname.endsWith('.mov')) return 'video/quicktime';
    if (pathname.endsWith('.m4v')) return 'video/x-m4v';
    return 'video/mp4';
}

function getVideoExtension(mimeType = 'video/mp4') {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('quicktime')) return 'mov';
    if (normalized.includes('m4v')) return 'm4v';
    return 'mp4';
}

function isSupportedVideoBuffer(buffer = Buffer.alloc(0)) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
    const header = buffer.subarray(0, 16);
    return header.subarray(4, 8).toString('ascii') === 'ftyp'
        || header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

async function downloadRemoteVideo(url, {
    timeoutMs = DEFAULT_VIDEO_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_VIDEO_BYTES
} = {}) {
    assertRemoteImageUrlAllowed(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let currentUrl = assertRemoteImageUrlAllowed(url).toString();
        let response = null;
        for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
            response = await fetch(currentUrl, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                    Accept: 'video/mp4,video/webm,video/quicktime,video/*;q=0.9,*/*;q=0.5',
                    Referer: 'https://www.meigen.ai/',
                    'User-Agent': 'ZaoyoeGalleryImport/1.0'
                }
            });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('location');
            if (!location || redirectCount === 3) throw new Error('视频跳转次数过多');
            currentUrl = assertRemoteImageUrlAllowed(new URL(location, currentUrl).toString()).toString();
        }
        if (!response.ok) throw new Error(`视频下载失败 (${response.status})`);
        const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('视频超过大小限制');
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new Error('视频为空');
        if (buffer.length > maxBytes) throw new Error('视频超过大小限制');
        if (!isSupportedVideoBuffer(buffer)) throw new Error('视频地址返回的不是受支持的视频文件');
        return { buffer, mimeType: getVideoMimeType(response, currentUrl) };
    } finally {
        clearTimeout(timer);
    }
}

async function downloadRemoteImage(url, {
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_IMAGE_BYTES
} = {}) {
    assertRemoteImageUrlAllowed(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        let currentUrl = assertRemoteImageUrlAllowed(url).toString();
        let response = null;
        for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
            response = await fetch(currentUrl, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                    Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
                    Referer: 'https://www.meigen.ai/',
                    'User-Agent': 'ZaoyoeGalleryImport/1.0'
                }
            });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('location');
            if (!location || redirectCount === 3) {
                throw new Error('图片跳转次数过多');
            }
            currentUrl = assertRemoteImageUrlAllowed(new URL(location, currentUrl).toString()).toString();
        }
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
        if (!isSupportedImageBuffer(buffer)) {
            throw new Error('图片地址返回的不是受支持的图片文件');
        }

        return {
            buffer,
            mimeType: getImageMimeType(response, currentUrl)
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

function buildPromptImportVideoKey({
    site = 'cn',
    batchId = '',
    itemId = '',
    index = 0,
    buffer = Buffer.alloc(0),
    mimeType = 'video/mp4'
} = {}) {
    const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const safeSite = normalizeAdminSite(site, { defaultValue: 'cn' }) === 'intl' ? 'intl' : 'cn';
    const safeBatch = normalizeText(batchId, 100).replace(/[^a-z0-9-]/gi, '') || 'batch';
    const safeItem = normalizeText(itemId, 100).replace(/[^a-z0-9-]/gi, '') || 'item';
    return `prompts/videos/${safeSite}/${year}/${month}/${safeBatch}/${safeItem}-${index}-${digest}.${getVideoExtension(mimeType)}`;
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

async function uploadImportVideoBufferToR2(buffer, {
    site,
    batchId,
    itemId,
    index,
    mimeType
} = {}) {
    const config = resolveR2Config(process.env);
    if (!config.configured) {
        const error = new Error('媒体存储未配置，无法保存到 Gallery');
        error.statusCode = 503;
        error.code = 'prompt_import_storage_not_configured';
        throw error;
    }
    const key = buildPromptImportVideoKey({ site, batchId, itemId, index, buffer, mimeType });
    const client = createR2Client(config);
    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable'
    }));
    return { original: `${config.publicUrl}/${key}`, storage_path: key, mime_type: mimeType };
}

async function uploadImportItemImages(item, { site = 'cn' } = {}) {
    const sourceUrls = getItemImageSourceUrls(item);
    if (!sourceUrls.length) {
        return {
            assets: [],
            urls: [],
            palettes: [],
            failures: [],
            paletteFailures: [],
            sourceAssetMap: new Map(),
            paletteByImageUrl: new Map()
        };
    }

    const assets = [];
    const palettes = [];
    const sourceAssetMap = new Map();
    const paletteByImageUrl = new Map();
    const failures = [];
    const paletteFailures = [];
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
            sourceAssetMap.set(url, stored);
            try {
                const palette = await extractPromptImagePalette(downloaded.buffer, {
                    imageIndex: assets.length - 1,
                    imageUrl: stored.original
                });
                palettes.push(palette);
                paletteByImageUrl.set(stored.original, palette);
            } catch (paletteError) {
                paletteFailures.push({
                    url,
                    image_url: stored.original,
                    message: paletteError.message || '色卡提取失败'
                });
            }
        } catch (error) {
            failures.push({
                url,
                message: error.message || '图片保存失败'
            });
        }
    }

    if (!assets.length && !getItemVideoSources(item).length) {
        const error = new Error('图片保存失败');
        error.statusCode = 502;
        error.details = { failures };
        throw error;
    }

    return {
        assets,
        urls: assets.map((asset) => asset.original).filter(Boolean),
        palettes,
        failures,
        paletteFailures,
        sourceAssetMap,
        paletteByImageUrl
    };
}

async function uploadImportItemVideos(item, imageUploadResult, { site = 'cn' } = {}) {
    const sources = getItemVideoSources(item);
    const assets = [];
    const posterAssets = [];
    const posterPalettes = [];
    const failures = [];
    const paletteFailures = [];
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        try {
            let posterAsset = source.poster_url
                ? imageUploadResult.sourceAssetMap.get(source.poster_url)
                : null;
            if (!posterAsset && source.poster_url) {
                const poster = await downloadRemoteImage(source.poster_url, {
                    timeoutMs: normalizePositiveInteger(process.env.PROMPT_IMPORT_IMAGE_TIMEOUT_MS, DEFAULT_IMAGE_TIMEOUT_MS, 60000),
                    maxBytes: normalizePositiveInteger(process.env.PROMPT_IMPORT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES, 80 * 1024 * 1024)
                });
                posterAsset = await uploadImportImageBufferToR2(poster.buffer, {
                    site,
                    batchId: item.batch_id,
                    itemId: item.id,
                    index: getItemImageSourceUrls(item).length + index,
                    mimeType: poster.mimeType
                });
                imageUploadResult.sourceAssetMap.set(source.poster_url, posterAsset);
                posterAssets.push(posterAsset);
                try {
                    const palette = await extractPromptImagePalette(poster.buffer, {
                        imageIndex: posterAssets.length - 1,
                        imageUrl: posterAsset.original
                    });
                    posterPalettes.push(palette);
                    imageUploadResult.paletteByImageUrl.set(posterAsset.original, palette);
                } catch (paletteError) {
                    paletteFailures.push({
                        url: source.poster_url,
                        image_url: posterAsset.original,
                        message: paletteError.message || '视频封面色卡提取失败'
                    });
                }
            }
            const downloaded = await downloadRemoteVideo(source.url, {
                timeoutMs: normalizePositiveInteger(process.env.PROMPT_IMPORT_VIDEO_TIMEOUT_MS, DEFAULT_VIDEO_TIMEOUT_MS, 300000),
                maxBytes: normalizePositiveInteger(process.env.PROMPT_IMPORT_MAX_VIDEO_BYTES, DEFAULT_MAX_VIDEO_BYTES, 500 * 1024 * 1024)
            });
            const stored = await uploadImportVideoBufferToR2(downloaded.buffer, {
                site,
                batchId: item.batch_id,
                itemId: item.id,
                index,
                mimeType: downloaded.mimeType
            });
            assets.push({
                ...stored,
                ...(posterAsset?.original ? { poster: posterAsset.original, poster_asset: posterAsset } : {}),
                ...(source.width ? { width: source.width } : {}),
                ...(source.height ? { height: source.height } : {}),
                ...(source.duration ? { duration: source.duration } : {})
            });
        } catch (error) {
            failures.push({ url: source.url, message: error.message || '视频保存失败' });
        }
    }
    if (sources.length && !assets.length) {
        const error = new Error('视频保存失败');
        error.statusCode = 502;
        error.details = { failures };
        throw error;
    }
    return { assets, posterAssets, posterPalettes, failures, paletteFailures };
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
    imagePalettes = [],
    videoAssets = [],
    defaultStatus = 'review'
} = {}) {
    const promptText = normalizeText(item.prompt_text || '', 20000);
    if (!promptText) {
        const error = new Error('没有抓到提示词');
        error.statusCode = 400;
        throw error;
    }
    if (!imageAssets.length && !videoAssets.length) {
        const error = new Error('没有可保存的媒体');
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

    const images = imageAssets.map((asset) => asset.original).filter(Boolean);
    return {
        title: buildPromptTitleFromItem(item),
        tags: ['Creative'],
        description: '',
        prompt_text: promptText,
        prompt_text_en: /[\u3400-\u9fff\uf900-\ufaff]/.test(promptText) ? '' : promptText,
        prompt_text_zh: '',
        images,
        image_assets: imageAssets,
        image_palettes: alignPromptImagePalettes(images, imagePalettes),
        video_assets: videoAssets,
        source_url: normalizeOptionalUrl(item.original_work_url || ''),
        source_author_name: normalizeText(item.author_name || '', 200),
        source_author_handle: normalizeAuthorHandle(item.author_handle || '')
            || deriveAuthorHandleFromOriginalWorkUrl(item.original_work_url || ''),
        ai_tags: aiTags,
        updated_at: new Date().toISOString()
    };
}

function buildCleanedImportedItemPayload({
    finalPromptId,
    finalImageAssets = [],
    finalVideoAssets = [],
    cleanupAfter = null
} = {}) {
    return {
        status: 'imported',
        prompt_text: '',
        image_sources: [],
        video_sources: [],
        temp_image_assets: [],
        temp_video_assets: [],
        final_image_assets: finalImageAssets,
        final_video_assets: finalVideoAssets,
        final_prompt_id: normalizePromptReferenceId(finalPromptId),
        error_summary: '',
        error_details: {},
        imported_at: new Date().toISOString(),
        cleaned_at: new Date().toISOString(),
        cleanup_after: cleanupAfter,
        updated_at: new Date().toISOString()
    };
}

function buildDeferredImportedItemPayload({
    finalPromptId,
    finalImageAssets = [],
    finalVideoAssets = [],
    cleanupAfter = null
} = {}) {
    return {
        status: 'imported',
        final_image_assets: finalImageAssets,
        final_video_assets: finalVideoAssets,
        final_prompt_id: normalizePromptReferenceId(finalPromptId),
        error_summary: '',
        error_details: {},
        imported_at: new Date().toISOString(),
        cleanup_after: cleanupAfter,
        updated_at: new Date().toISOString()
    };
}

async function updateBatchStats(supabase, batchId) {
    const { data: currentBatch, error: currentBatchError } = await supabase
        .from('prompt_import_batches')
        .select('stats')
        .eq('id', batchId)
        .single();
    if (currentBatchError) throw currentBatchError;
    const { data, error } = await supabase
        .from('prompt_import_items')
        .select('status')
        .eq('batch_id', batchId);
    if (error) throw error;

    const itemStats = buildImportStats(data || []);
    const previousStats = currentBatch?.stats && typeof currentBatch.stats === 'object' ? currentBatch.stats : {};
    const stats = {
        ...itemStats,
        attempted: Math.max(0, Number(previousStats.attempted || 0)),
        accepted: Math.max(0, Number(previousStats.accepted || 0)),
        skipped_duplicates: Math.max(0, Number(previousStats.skipped_duplicates || 0)),
        rejected: Math.max(0, Number(previousStats.rejected || 0))
    };
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

async function findExistingPromptDuplicates(supabase, rows = [], { sourceIdentityOnly = false } = {}) {
    const sourceUrls = [...new Set(
        rows
            .map((row) => normalizeOptionalUrl(row.original_work_url || ''))
            .filter(Boolean)
    )];
    const promptRows = sourceIdentityOnly
        ? rows.filter((row) => !normalizeOptionalUrl(row.original_work_url || ''))
        : rows;
    const promptTexts = [...new Set(
        promptRows
            .map((row) => normalizeText(row.prompt_text || '', 20000))
            .filter(Boolean)
    )];

    const duplicatesBySourceUrl = new Map();
    const duplicatesByPromptHash = new Map();
    const sourceUrlSet = new Set(sourceUrls);
    const promptHashSet = new Set(promptTexts.map(hashPromptText).filter(Boolean));
    const matchedSourceUrls = new Set();
    const matchedPromptHashes = new Set();

    const recordPrompts = (prompts = []) => {
        prompts.forEach((prompt) => {
            const sourceUrl = normalizeOptionalUrl(prompt.source_url || '');
            if (sourceUrl && sourceUrlSet.has(sourceUrl)) {
                duplicatesBySourceUrl.set(sourceUrl, prompt.id);
                matchedSourceUrls.add(sourceUrl);
            }
            [prompt.prompt_text, prompt.prompt_text_en, prompt.prompt_text_zh].forEach((text) => {
                const promptHash = hashPromptText(text || '');
                if (promptHash && promptHashSet.has(promptHash)) {
                    duplicatesByPromptHash.set(promptHash, prompt.id);
                    matchedPromptHashes.add(promptHash);
                }
            });
        });
    };
    if (sourceIdentityOnly && sourceUrls.length) {
        const chunkSize = 40;
        for (let index = 0; index < sourceUrls.length; index += chunkSize) {
            const { data, error } = await supabase
                .from('prompts')
                .select('id, source_url, prompt_text, prompt_text_en, prompt_text_zh')
                .in('source_url', sourceUrls.slice(index, index + chunkSize));
            if (error) throw error;
            recordPrompts(data || []);
        }
    }
    if (!promptHashSet.size) {
        return {
            bySourceUrl: duplicatesBySourceUrl,
            byPromptHash: duplicatesByPromptHash
        };
    }
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
            .from('prompts')
            .select('id, source_url, prompt_text, prompt_text_en, prompt_text_zh')
            .order('id', { ascending: true })
            .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = data || [];
        recordPrompts(page);
        if (
            page.length < pageSize
            || (matchedSourceUrls.size === sourceUrlSet.size && matchedPromptHashes.size === promptHashSet.size)
        ) {
            break;
        }
    }

    return {
        bySourceUrl: duplicatesBySourceUrl,
        byPromptHash: duplicatesByPromptHash
    };
}

function getPersistentFailureSourceItemIds(historyRows = [], threshold = PERSISTENT_FAILURE_BATCH_THRESHOLD) {
    const batchesBySourceItemId = new Map();
    (Array.isArray(historyRows) ? historyRows : []).forEach((row) => {
        const sourceItemId = normalizeText(row?.source_item_id, 220);
        const batchId = normalizeText(row?.batch_id, 120);
        if (!sourceItemId || !batchId || String(row?.status || '') !== 'cleaned' || row?.final_prompt_id) return;
        if (!batchesBySourceItemId.has(sourceItemId)) batchesBySourceItemId.set(sourceItemId, new Set());
        batchesBySourceItemId.get(sourceItemId).add(batchId);
    });
    return [...batchesBySourceItemId.entries()]
        .filter(([, batchIds]) => batchIds.size >= threshold)
        .map(([sourceItemId]) => sourceItemId);
}

async function findPersistentFailureSourceItemIds(supabase, rows = [], { excludeBatchId = '' } = {}) {
    const sourceItemIds = [...new Set((Array.isArray(rows) ? rows : [])
        .map((row) => normalizeText(row?.source_item_id, 220))
        .filter(Boolean))];
    if (!sourceItemIds.length) return [];
    let request = supabase
        .from('prompt_import_items')
        .select('batch_id, source_item_id, status, final_prompt_id')
        .in('source_item_id', sourceItemIds)
        .eq('status', 'cleaned')
        .is('final_prompt_id', null);
    if (excludeBatchId) request = request.neq('batch_id', excludeBatchId);
    const { data, error } = await request;
    if (error) throw error;
    return getPersistentFailureSourceItemIds(data || []);
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

    if (promptText && promptText.length <= 500) {
        for (const field of ['prompt_text', 'prompt_text_en', 'prompt_text_zh']) {
            const { data, error } = await supabase
                .from('prompts')
                .select(PROMPT_SELECT)
                .eq(field, promptText)
                .limit(1);
            if (error) throw error;
            if (Array.isArray(data) && data[0]) {
                return data[0];
            }
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
    const duplicateIndexes = new Set();
    const rejectedIdentityIndexes = new Set();
    const persistentFailureIndexes = new Set();
    const rows = rawItems.map((rawItem, index) => {
        const row = normalizeImportItemPayload(rawItem, settings);
        const identityConflictReason = getMeigenImportIdentityConflictReason(rawItem);
        if (identityConflictReason) {
            row.status = 'skipped';
            row.error_summary = identityConflictReason;
            rejectedIdentityIndexes.add(index);
        }
        if (row.prompt_hash && seenPromptHashes.has(row.prompt_hash)) {
            row.status = 'duplicate';
            row.error_summary = '疑似重复';
            duplicateIndexes.add(index);
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

    let existingBySourceItemId = new Map();
    if (batchId) {
        const sourceItemIds = rows.map((row) => row.source_item_id).filter(Boolean);
        const { data: existingRows, error: existingError } = sourceItemIds.length
            ? await supabase.from('prompt_import_items').select('id, source_item_id, status, final_prompt_id').eq('batch_id', batch.id).in('source_item_id', sourceItemIds)
            : { data: [], error: null };
        if (existingError) throw existingError;
        existingBySourceItemId = new Map((existingRows || []).map((row) => [String(row.source_item_id || ''), row]));
    }

    const repositoryRows = rows.filter((row, index) => (
        !rejectedIdentityIndexes.has(index)
        && !existingBySourceItemId.has(String(row.source_item_id || ''))
    ));

    let existingDuplicates;
    try {
        existingDuplicates = await findExistingPromptDuplicates(supabase, repositoryRows, {
            sourceIdentityOnly: settings.source === 'meigen'
        });
    } catch (error) {
        const wrappedError = new Error(`提示词仓库去重检查失败：${error.message || '数据库查询失败'}`);
        wrappedError.statusCode = 502;
        throw wrappedError;
    }
    rows.forEach((row, index) => {
        if (existingBySourceItemId.has(String(row.source_item_id || ''))) return;
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
            row.error_summary = '提示词库已有重复内容，已跳过';
            duplicateIndexes.add(index);
        }
    });

    const persistentFailureSourceItemIds = new Set(await findPersistentFailureSourceItemIds(
        supabase,
        repositoryRows,
        { excludeBatchId: batch.id }
    ));
    rows.forEach((row, index) => {
        if (persistentFailureSourceItemIds.has(row.source_item_id)) persistentFailureIndexes.add(index);
    });

    let rowEntriesToInsert = rows.map((row, index) => ({ row, index })).filter(({ index }) => (
        !duplicateIndexes.has(index)
        && !rejectedIdentityIndexes.has(index)
        && !persistentFailureIndexes.has(index)
    ));
    let data = [];
    const ignoredExistingIndexes = new Set();
    if (batchId && rowEntriesToInsert.length) {
        const newRows = [];
        for (const entry of rowEntriesToInsert) {
            const { row, index } = entry;
            const existing = existingBySourceItemId.get(String(row.source_item_id || ''));
            if (!existing) {
                newRows.push(entry);
                continue;
            }
            const existingStatus = String(existing.status || '');
            const canRestoreCleanedPlaceholder = existingStatus === 'cleaned'
                && !existing.final_prompt_id
                && row.status === 'staged';
            if (!['staged', 'needs_review', 'failed'].includes(existingStatus) && !canRestoreCleanedPlaceholder) {
                ignoredExistingIndexes.add(index);
                continue;
            }
            const { batch_id: _batchId, ...updatePayload } = row;
            const updateResult = await supabase.from('prompt_import_items').update({
                ...updatePayload,
                cleaned_at: null,
                worker_name: null,
                lease_expires_at: null,
                next_attempt_at: null,
                pipeline_stage: 'staged',
                processing_attempts: 0
            }).eq('id', existing.id).select(IMPORT_ITEM_SELECT).single();
            if (updateResult.error) throw updateResult.error;
            if (updateResult.data) data.push(updateResult.data);
        }
        rowEntriesToInsert = newRows;
    }
    const rowsToInsert = rowEntriesToInsert.map(({ row }) => row);
    if (rowsToInsert.length) {
        const result = await supabase
            .from('prompt_import_items')
            .insert(rowsToInsert)
            .select(IMPORT_ITEM_SELECT);
        if (result.error) throw result.error;
        data.push(...(result.data || []));
    }

    let updatedBatch = await updateBatchStats(supabase, batch.id);
    const previousIngressStats = batch.stats && typeof batch.stats === 'object' ? batch.stats : {};
    const rejectedCount = Math.max(0, rows.length - data.length - duplicateIndexes.size - ignoredExistingIndexes.size);
    const ingressStats = {
        ...(updatedBatch.stats || {}),
        attempted: Math.max(0, Number(previousIngressStats.attempted || 0)) + rows.length,
        accepted: Math.max(0, Number(previousIngressStats.accepted || 0)) + data.length,
        skipped_duplicates: Math.max(0, Number(previousIngressStats.skipped_duplicates || 0)) + duplicateIndexes.size,
        rejected: Math.max(0, Number(previousIngressStats.rejected || 0)) + rejectedCount
    };
    const ingressUpdate = await supabase
        .from('prompt_import_batches')
        .update({ stats: ingressStats, updated_at: new Date().toISOString() })
        .eq('id', batch.id)
        .select(IMPORT_BATCH_SELECT)
        .single();
    if (ingressUpdate.error) throw ingressUpdate.error;
    updatedBatch = ingressUpdate.data || { ...updatedBatch, stats: ingressStats };
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'prompts',
        site: batch.site,
        actionType: 'prompt_import.stage',
        details: {
            batch_id: batch.id,
            attempted_count: rows.length,
            staged_count: data.length,
            skipped_duplicate_count: duplicateIndexes.size,
            source: batch.source
        }
    });

    return {
        batch: updatedBatch,
        items: data,
        attemptedCount: rows.length,
        stagedCount: data.length,
        skippedDuplicateCount: duplicateIndexes.size,
        ignoredExistingCount: ignoredExistingIndexes.size,
        rejectedIdentityCount: rejectedIdentityIndexes.size,
        persistentFailureCount: persistentFailureIndexes.size,
        persistentFailureSourceItemIds: rawItems
            .filter((_item, index) => persistentFailureIndexes.has(index))
            .map((item) => normalizeText(item.source_item_id || item.sourceItemId || '', 220))
            .filter(Boolean),
        rejectedIdentitySourceItemIds: rawItems
            .filter((_item, index) => rejectedIdentityIndexes.has(index))
            .map((item) => normalizeText(item.source_item_id || item.sourceItemId || '', 220))
            .filter(Boolean)
    };
}

async function checkImportItemDuplicates(supabase, body) {
    const settings = normalizeImportSettings(body.settings || {});
    const maxItems = normalizePositiveInteger(settings.max_items, 50, 1000);
    const rows = (Array.isArray(body.items) ? body.items : [])
        .slice(0, maxItems)
        .map((item) => normalizeImportItemPayload(item, settings));
    if (!rows.length) {
        return { checkedCount: 0, duplicateCount: 0, duplicateSourceItemIds: [] };
    }

    const source = normalizeImportSource(body.source || body.settings?.source || DEFAULT_IMPORT_SOURCE);
    const duplicates = await findExistingPromptDuplicates(supabase, rows, {
        sourceIdentityOnly: source === 'meigen'
    });
    const persistentFailureSourceItemIds = await findPersistentFailureSourceItemIds(supabase, rows);
    const rawItems = (Array.isArray(body.items) ? body.items : []).slice(0, maxItems);
    const rejectedIdentitySourceItemIds = rawItems
        .filter((item) => getMeigenImportIdentityConflictReason(item))
        .map((item) => normalizeText(item.source_item_id || item.sourceItemId || '', 220))
        .filter(Boolean);
    const seenPromptHashes = new Set();
    const duplicateSourceItemIds = rows.flatMap((row) => {
        const duplicateId = (row.original_work_url && duplicates.bySourceUrl.get(row.original_work_url))
            || (row.prompt_hash && duplicates.byPromptHash.get(row.prompt_hash))
            || '';
        const repeatsCandidate = Boolean(row.prompt_hash && seenPromptHashes.has(row.prompt_hash));
        if (row.prompt_hash) seenPromptHashes.add(row.prompt_hash);
        return (duplicateId || repeatsCandidate) && row.source_item_id ? [row.source_item_id] : [];
    });
    return {
        checkedCount: rows.length,
        duplicateCount: duplicateSourceItemIds.length,
        duplicateSourceItemIds,
        persistentFailureCount: persistentFailureSourceItemIds.length,
        persistentFailureSourceItemIds,
        rejectedIdentityCount: rejectedIdentitySourceItemIds.length,
        rejectedIdentitySourceItemIds
    };
}

async function insertPromptRow(supabase, payload) {
    let { data, error } = await supabase
        .from('prompts')
        .insert(payload)
        .select(PROMPT_SELECT)
        .single();
    if (error && String(error.message || '').toLowerCase().includes('image_palettes')) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.image_palettes;
        const fallbackResult = await supabase
            .from('prompts')
            .insert(fallbackPayload)
            .select(PROMPT_SELECT.replace(', image_palettes', ''))
            .single();
        data = fallbackResult.data;
        error = fallbackResult.error;
    }
    if (error) throw error;
    return data;
}

async function importSingleItem(supabase, user, itemId, options = {}) {
    const item = await loadImportItem(supabase, itemId);
    if (String(item.status || '') === 'cleaned') {
        return { item, cancelled: true, error: '' };
    }
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
            .neq('status', 'cleaned')
            .select(IMPORT_ITEM_SELECT)
            .maybeSingle();
        if (skipError) throw skipError;
        if (!skippedItem) return { batch, item, cancelled: true, error: '' };
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
        .eq('id', item.id)
        .neq('status', 'cleaned');

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
                .neq('status', 'cleaned')
                .select(IMPORT_ITEM_SELECT)
                .maybeSingle();
            if (updateError) throw updateError;
            if (!updatedItem) return { batch, item, cancelled: true, error: '' };

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

        const imageUploadResult = await uploadImportItemImages(item, { site });
        const videoUploadResult = await uploadImportItemVideos(item, imageUploadResult, { site });
        const finalImageAssets = [...imageUploadResult.assets, ...videoUploadResult.posterAssets];
        const finalImagePalettes = alignPromptImagePalettes(
            finalImageAssets.map((asset) => asset.original).filter(Boolean),
            [...imageUploadResult.palettes, ...videoUploadResult.posterPalettes]
        );
        const { data: currentItem, error: currentItemError } = await supabase
            .from('prompt_import_items')
            .select(IMPORT_ITEM_SELECT)
            .eq('id', item.id)
            .single();
        if (currentItemError) throw currentItemError;
        if (String(currentItem?.status || '') === 'cleaned') {
            return { batch, item: currentItem, cancelled: true, error: '' };
        }
        const { data: savingItem, error: savingError } = await supabase
            .from('prompt_import_items')
            .update({
                status: 'saving',
                final_image_assets: finalImageAssets,
                final_video_assets: videoUploadResult.assets,
                error_details: {
                    ...(imageUploadResult.failures.length ? { image_failures: imageUploadResult.failures } : {}),
                    ...(videoUploadResult.failures.length ? { video_failures: videoUploadResult.failures } : {}),
                    ...(
                        imageUploadResult.paletteFailures.length || videoUploadResult.paletteFailures.length
                            ? { palette_failures: [...imageUploadResult.paletteFailures, ...videoUploadResult.paletteFailures] }
                            : {}
                    )
                },
                updated_at: new Date().toISOString()
            })
            .eq('id', item.id)
            .neq('status', 'cleaned')
            .select(IMPORT_ITEM_SELECT)
            .maybeSingle();
        if (savingError) throw savingError;
        if (!savingItem) {
            return { batch, item: currentItem, cancelled: true, error: '' };
        }

        const promptPayload = buildPromptPayloadFromImportItem(item, {
            imageAssets: finalImageAssets,
            imagePalettes: finalImagePalettes,
            videoAssets: videoUploadResult.assets,
            defaultStatus
        });
        const prompt = await insertPromptRow(supabase, promptPayload);
        const cleanupAfter = cleanupOnSave
            ? null
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const cleanedPayload = cleanupOnSave
            ? buildCleanedImportedItemPayload({
                finalPromptId: prompt.id,
                finalImageAssets,
                finalVideoAssets: videoUploadResult.assets,
                cleanupAfter
            })
            : buildDeferredImportedItemPayload({
                finalPromptId: prompt.id,
                finalImageAssets,
                finalVideoAssets: videoUploadResult.assets,
                cleanupAfter
            });
        const { data: updatedItem, error: updateError } = await supabase
            .from('prompt_import_items')
            .update(cleanedPayload)
            .eq('id', item.id)
            .neq('status', 'cleaned')
            .select(IMPORT_ITEM_SELECT)
            .maybeSingle();
        if (updateError) throw updateError;
        if (!updatedItem) return { batch, item, prompt, cancelled: true, error: '' };

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
                image_count: finalImageAssets.length,
                video_count: videoUploadResult.assets.length,
                source: item.source
            }
        });

        return {
            batch: updatedBatch,
            item: updatedItem,
            prompt,
            imageFailures: imageUploadResult.failures,
            videoFailures: videoUploadResult.failures
        };
    } catch (error) {
        const latestItem = await loadImportItem(supabase, item.id).catch(() => null);
        if (String(latestItem?.status || '') === 'cleaned') {
            return { batch, item: latestItem, cancelled: true, error: '' };
        }
        const { data: failedItem } = await supabase
            .from('prompt_import_items')
            .update({
                status: 'failed',
                error_summary: error.message || '导入失败',
                error_details: error.details || {},
                updated_at: new Date().toISOString()
            })
            .eq('id', item.id)
            .neq('status', 'cleaned')
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
            video_sources: [],
            temp_image_assets: [],
            temp_video_assets: [],
            status: 'cleaned',
            worker_name: null,
            lease_expires_at: null,
            processing_attempts: 3,
            next_attempt_at: null,
            pipeline_stage: 'cancelled',
            error_summary: '',
            error_details: {},
            cleaned_at: new Date().toISOString(),
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
        actionType: 'prompt_import.cleanup',
        details: {
            item_ids: itemIds,
            cleaned_count: data?.length || 0
        }
    });

    return {
        items: data || [],
        cleanedCount: data?.length || 0,
        batch: batches[batches.length - 1] || null
    };
}

async function deleteImportBatch(supabase, user, body) {
    const batchId = normalizeText(body.batch_id || body.batchId, 120);
    if (!batchId) {
        const error = new Error('batchId is required');
        error.statusCode = 400;
        throw error;
    }

    const batch = await loadImportBatch(supabase, batchId);
    const { data: activeItems, error: activeItemsError } = await supabase
        .from('prompt_import_items')
        .select('id, status')
        .eq('batch_id', batchId)
        .in('status', ['queued', 'uploading', 'saving']);
    if (activeItemsError) throw activeItemsError;
    if (activeItems?.length) {
        const error = new Error('当前批次仍有 Worker 正在上传或保存，请等待处理停止后再删除');
        error.statusCode = 409;
        error.code = 'prompt_import_batch_busy';
        throw error;
    }

    const { data: deletedBatch, error: deleteError } = await supabase
        .from('prompt_import_batches')
        .delete()
        .eq('id', batchId)
        .select(IMPORT_BATCH_SELECT)
        .single();
    if (deleteError) throw deleteError;

    const deletedItemCount = Math.max(0, Number(batch?.stats?.total || 0));
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'prompts',
        site: batch.site,
        actionType: 'prompt_import.delete_batch',
        details: {
            batch_id: batchId,
            deleted_item_count: deletedItemCount,
            source: batch.source,
            status: batch.status
        }
    });

    return {
        batch: deletedBatch || batch,
        deletedBatchId: batchId,
        deletedItemCount
    };
}

async function cleanupRejectedImportItems(supabase, user, body) {
    const batchId = normalizeText(body.batch_id || body.batchId, 120);
    if (!batchId) {
        const error = new Error('batchId is required');
        error.statusCode = 400;
        throw error;
    }
    await loadImportBatch(supabase, batchId);
    const { data, error } = await supabase
        .from('prompt_import_items')
        .select(IMPORT_ITEM_SELECT)
        .eq('batch_id', batchId)
        .in('status', ['needs_review', 'skipped', 'duplicate', 'failed']);
    if (error) throw error;
    const cleanupIds = getRejectedImportCleanupIds(data || []);
    if (!cleanupIds.length) {
        return { items: [], cleanedCount: 0, batch: await updateBatchStats(supabase, batchId) };
    }
    return cleanupImportItems(supabase, user, { ...body, item_ids: cleanupIds });
}

async function cleanupPendingDetailItems(supabase, user, body) {
    const batchId = normalizeText(body.batch_id || body.batchId, 120);
    if (!batchId) {
        const error = new Error('batchId is required');
        error.statusCode = 400;
        throw error;
    }
    await loadImportBatch(supabase, batchId);
    const { data, error } = await supabase
        .from('prompt_import_items')
        .select(IMPORT_ITEM_SELECT)
        .eq('batch_id', batchId)
        .eq('status', 'needs_review');
    if (error) throw error;
    const cleanupIds = getPendingDetailCleanupIds(data || []);
    if (!cleanupIds.length) {
        return { items: [], cleanedCount: 0, batch: await updateBatchStats(supabase, batchId) };
    }
    return cleanupImportItems(supabase, user, { ...body, item_ids: cleanupIds });
}

function getPendingDetailCleanupIds(items = []) {
    return (Array.isArray(items) ? items : [])
        .filter((item) => String(item?.status || '') === 'needs_review'
            && /等待详情补全/.test(String(item?.error_summary || '')))
        .map((item) => item?.id)
        .filter(Boolean);
}

function getRejectedImportCleanupIds(items = []) {
    return (Array.isArray(items) ? items : [])
        .filter((item) => {
            const status = String(item?.status || '');
            const waitingForDetail = /等待详情补全/.test(String(item?.error_summary || ''));
            if (waitingForDetail) return false;
            return status === 'skipped'
                || status === 'duplicate'
                || Boolean(getImportItemUploadBlockReason(item));
        })
        .map((item) => item?.id)
        .filter(Boolean);
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
        .neq('status', 'cleaned')
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
    const retryAt = new Date().toISOString();
    const { data, error } = await supabase
        .from('prompt_import_items')
        .update({
            status: 'failed',
            error_summary: reason,
            worker_name: null,
            lease_expires_at: null,
            processing_attempts: 0,
            next_attempt_at: retryAt,
            updated_at: new Date().toISOString()
        })
        .in('id', itemIds)
        .neq('status', 'cleaned')
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
    const site = normalizeText(searchParams.get('site'), 20);
    let request = supabase
        .from('prompt_import_batches')
        .select(IMPORT_BATCH_SELECT);
    if (site) {
        request = request.eq('site', normalizeAdminSite(site, { defaultValue: 'cn' }));
    }
    const { data, error } = await request
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
        .select(IMPORT_ITEM_SELECT, { count: 'exact' })
        .eq('batch_id', query.batchId);
    if (query.status) {
        request = request.eq('status', query.status);
    } else if (!query.includeCleaned) {
        request = request.neq('status', 'cleaned');
    }

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.pageSize) || DEFAULT_IMPORT_PAGE_SIZE);
    const pageStart = (page - 1) * pageSize;
    const { data, error, count } = await request
        .order('updated_at', { ascending: false })
        .range(pageStart, pageStart + pageSize - 1);
    if (error) throw error;
    const total = Math.max(0, Number(count) || 0);
    return {
        items: data || [],
        pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize))
        }
    };
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
                const [batch, itemPage] = await Promise.all([
                    loadImportBatch(supabase, query.batchId),
                    listImportItems(supabase, query)
                ]);
                return sendJson(res, 200, {
                    success: true,
                    batch,
                    items: itemPage.items,
                    pagination: itemPage.pagination
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
            return sendJson(res, 200, {
                success: true,
                ...result,
                items: body.compact_response === true ? [] : result.items
            });
        }
        if (action === 'check_duplicates') {
            const result = await checkImportItemDuplicates(supabase, body);
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
        if (action === 'delete_batch') {
            const result = await deleteImportBatch(supabase, user, body);
            return sendJson(res, 200, { success: true, ...result });
        }
        if (action === 'cleanup_rejected_items') {
            const result = await cleanupRejectedImportItems(supabase, user, body);
            return sendJson(res, 200, { success: true, ...result });
        }
        if (action === 'cleanup_pending_detail_items') {
            const result = await cleanupPendingDetailItems(supabase, user, body);
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
    normalizeVideoSources,
    filterImageSourcesForImportIdentity,
    getMeigenImportIdentityConflictReason,
    deriveAuthorHandleFromOriginalWorkUrl,
    normalizeImportItemPayload,
    importSingleItem,
    loadImportBatch,
    updateBatchStats,
    buildPromptPayloadFromImportItem,
    buildCleanedImportedItemPayload,
    buildImportStats,
    buildPromptImportImageKey,
    buildPromptImportVideoKey,
    findExistingPromptDuplicates,
    getPersistentFailureSourceItemIds,
    findPersistentFailureSourceItemIds,
    checkImportItemDuplicates,
    getRejectedImportCleanupIds,
    getPendingDetailCleanupIds,
    deleteImportBatch,
    isBlockedImportHostname,
    isSupportedImageBuffer,
    isSupportedVideoBuffer,
    getImportPageQuery,
    listImportItems
};
