const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const imageBase64Handler = require('./image-base64');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_WIDTH = 440;
const MAX_WIDTH = 800;

const { normalizeImageUrl } = imageBase64Handler._private;
let sharpRuntime = null;

function getSharpRuntime() {
    if (!sharpRuntime) {
        sharpRuntime = require('sharp');
    }
    return sharpRuntime;
}

function normalizePositiveInteger(value, fallback, maxValue) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maxValue);
}

async function fetchImageBuffer(url, {
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
                Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
                'User-Agent': 'ZaoyoeAdminImageThumbnail/1.0'
            }
        });
        if (!response.ok) {
            const error = new Error(`图片读取失败 (${response.status})`);
            error.statusCode = response.status;
            throw error;
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.startsWith('image/')) {
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
        if (!buffer.length || buffer.length > maxBytes) {
            const error = new Error(buffer.length ? '图片超过大小限制' : '图片为空');
            error.statusCode = buffer.length ? 413 : 422;
            throw error;
        }
        return buffer;
    } finally {
        clearTimeout(timer);
    }
}

async function createThumbnailBuffer(buffer, width = DEFAULT_WIDTH) {
    const safeWidth = normalizePositiveInteger(width, DEFAULT_WIDTH, MAX_WIDTH);
    return getSharpRuntime()(buffer, { failOn: 'none', limitInputPixels: 80_000_000 })
        .rotate()
        .resize({
            width: safeWidth,
            height: Math.round(safeWidth * 0.75),
            fit: 'cover',
            position: 'centre',
            withoutEnlargement: true
        })
        .webp({ quality: 72, effort: 2 })
        .toBuffer();
}

module.exports = async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        await requireAdmin(req, { permission: 'prompts.manage' });
        const url = new URL(req.url || '', 'http://localhost');
        const imageUrl = url.searchParams.get('image_url') || url.searchParams.get('url') || '';
        const sourceBuffer = await fetchImageBuffer(imageUrl, {
            timeoutMs: normalizePositiveInteger(process.env.ADMIN_IMAGE_THUMBNAIL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60000),
            maxBytes: normalizePositiveInteger(process.env.ADMIN_IMAGE_THUMBNAIL_MAX_BYTES, DEFAULT_MAX_BYTES, 40 * 1024 * 1024)
        });
        const thumbnail = await createThumbnailBuffer(sourceBuffer, url.searchParams.get('width'));

        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Length', String(thumbnail.length));
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        return res.end(thumbnail);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '缩略图生成失败'
        });
    }
};

module.exports._private = {
    normalizePositiveInteger,
    fetchImageBuffer,
    createThumbnailBuffer,
    getSharpRuntime
};
