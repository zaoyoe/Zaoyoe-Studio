const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    detectImageMimeFromMagic,
    fetchWithPinnedSsrfGuard,
    validatePublicHttpUrl
} = require('../../../../api/_lib/remote-http-security');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif'
]);

function normalizeText(value = '', maxLength = 2000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePositiveInteger(value, fallback, maxValue = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maxValue);
}

function normalizeImageUrl(value = '') {
    const raw = normalizeText(value);
    if (!raw) return '';
    try {
        return validatePublicHttpUrl(raw, { allowCustomPorts: false }).toString();
    } catch (_) {
        return '';
    }
}

function resolveValidatedImageMimeType(response, buffer = Buffer.alloc(0)) {
    const headerType = String(response?.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    const detectedMime = detectImageMimeFromMagic(buffer);

    if (!detectedMime) {
        return '';
    }

    if (headerType && headerType !== 'application/octet-stream' && headerType !== 'binary/octet-stream') {
        if (!ALLOWED_IMAGE_MIME_TYPES.has(headerType)) {
            return '';
        }
    }

    return ALLOWED_IMAGE_MIME_TYPES.has(detectedMime) ? detectedMime : '';
}

async function fetchRemoteImageBuffer(url, {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    fetcher = fetchWithPinnedSsrfGuard,
    acceptHeader = 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
    userAgent = 'ZaoyoeAdminImageAnalysis/1.0'
} = {}) {
    const imageUrl = normalizeImageUrl(url);
    if (!imageUrl) {
        const error = new Error('图片地址不可用');
        error.statusCode = 400;
        throw error;
    }

    const response = await fetcher(imageUrl, {
        method: 'GET',
        timeoutMs,
        maxBytes,
        maxRedirects: 3,
        allowCustomPorts: false,
        headers: {
            Accept: acceptHeader,
            'User-Agent': userAgent
        }
    });

    if (!response.ok) {
        const error = new Error(`图片读取失败 (${response.status})`);
        error.statusCode = response.status || 502;
        throw error;
    }

    const buffer = Buffer.isBuffer(response.buffer) ? response.buffer : Buffer.from(response.buffer || '');
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

    const mimeType = resolveValidatedImageMimeType(response, buffer);
    if (!mimeType) {
        const error = new Error('读取到的内容不是图片');
        error.statusCode = 415;
        throw error;
    }

    return {
        buffer,
        mimeType,
        byteSize: buffer.length
    };
}

async function fetchImageAsBase64(url, options = {}) {
    const { buffer, mimeType, byteSize } = await fetchRemoteImageBuffer(url, options);
    return {
        mime_type: mimeType,
        base64: buffer.toString('base64'),
        byte_size: byteSize
    };
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
    resolveValidatedImageMimeType,
    fetchRemoteImageBuffer,
    fetchImageAsBase64
};
