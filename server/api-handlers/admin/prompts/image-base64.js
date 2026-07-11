const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function normalizeText(value = '', maxLength = 2000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePositiveInteger(value, fallback, maxValue = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maxValue);
}

function isBlockedImageHostname(hostname = '') {
    const normalized = String(hostname || '').toLowerCase();
    return normalized === 'localhost'
        || normalized === '127.0.0.1'
        || normalized === '0.0.0.0'
        || normalized === '::1'
        || normalized.endsWith('.localhost')
        || /^10\./.test(normalized)
        || /^192\.168\./.test(normalized)
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
        || /^169\.254\./.test(normalized);
}

function normalizeImageUrl(value = '') {
    const raw = normalizeText(value);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        if (isBlockedImageHostname(url.hostname)) return '';
        return url.toString();
    } catch (_) {
        return '';
    }
}

function getImageMimeType(response, url = '') {
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType.startsWith('image/')) return contentType;
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        if (pathname.endsWith('.png')) return 'image/png';
        if (pathname.endsWith('.webp')) return 'image/webp';
        if (pathname.endsWith('.gif')) return 'image/gif';
        if (pathname.endsWith('.avif')) return 'image/avif';
    } catch (_) {
        // Fall back below.
    }
    return 'image/jpeg';
}

async function fetchImageAsBase64(url, {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES
} = {}) {
    const imageUrl = normalizeImageUrl(url);
    if (!imageUrl) {
        const error = new Error('图片地址不可用');
        error.statusCode = 400;
        throw error;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(imageUrl, {
            signal: controller.signal,
            headers: {
                Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
                'User-Agent': 'ZaoyoeAdminImageAnalysis/1.0'
            }
        });
        if (!response.ok) {
            const error = new Error(`图片读取失败 (${response.status})`);
            error.statusCode = response.status;
            throw error;
        }

        const mimeType = getImageMimeType(response, imageUrl);
        if (!mimeType.startsWith('image/')) {
            const error = new Error('读取到的内容不是图片');
            error.statusCode = 415;
            throw error;
        }

        const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            const error = new Error('图片超过大小限制');
            error.statusCode = 413;
            throw error;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) {
            const error = new Error('图片为空');
            error.statusCode = 422;
            throw error;
        }
        if (buffer.length > maxBytes) {
            const error = new Error('图片超过大小限制');
            error.statusCode = 413;
            throw error;
        }

        return {
            mime_type: mimeType,
            base64: buffer.toString('base64'),
            byte_size: buffer.length
        };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        await requireAdmin(req, { permission: 'prompts.manage' });
        const body = await parseJsonBody(req);
        const imageUrl = body.image_url || body.imageUrl || body.url || '';
        const result = await fetchImageAsBase64(imageUrl, {
            timeoutMs: normalizePositiveInteger(process.env.ADMIN_IMAGE_ANALYSIS_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60000),
            maxBytes: normalizePositiveInteger(process.env.ADMIN_IMAGE_ANALYSIS_MAX_BYTES, DEFAULT_MAX_BYTES, 60 * 1024 * 1024)
        });
        return sendJson(res, 200, { success: true, ...result });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '图片读取失败'
        });
    }
};

module.exports._private = {
    normalizeImageUrl,
    fetchImageAsBase64
};
