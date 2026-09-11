'use strict';

const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;
const DEFAULT_BUCKET_NAME = 'zaoyoe-images';
const DEFAULT_PUBLIC_URL = 'https://cdn.fatherkey.com';
const ALLOWED_CONTENT_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
]);

function normalizeContentType(value) {
    const normalized = String(value || '').split(';')[0].trim().toLowerCase();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function detectImageContentType(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 4) return '';

    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }

    if (
        bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    ) {
        return 'image/png';
    }

    const ascii = bytes.subarray(0, Math.min(bytes.length, 12)).toString('ascii');
    if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) {
        return 'image/gif';
    }

    if (bytes.length >= 12 && ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP') {
        return 'image/webp';
    }

    return '';
}

function parseImageDataUrl(imageData) {
    const raw = String(imageData || '').trim();
    const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
        throw new Error('Invalid image data URL');
    }

    const declaredContentType = normalizeContentType(match[1]);
    if (!ALLOWED_CONTENT_TYPES.has(declaredContentType)) {
        throw new Error('Image type is not allowed');
    }

    let bytes;
    try {
        bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    } catch (_) {
        throw new Error('Invalid image data URL');
    }

    if (!bytes.length) {
        throw new Error('Invalid image data URL');
    }
    if (bytes.length > MAX_CHAT_IMAGE_BYTES) {
        throw new Error('Image size exceeds 3MB limit');
    }

    const detected = detectImageContentType(bytes);
    if (!detected) {
        throw new Error('Image bytes do not match a supported image format');
    }
    if (detected !== declaredContentType) {
        throw new Error('Image content type does not match file bytes');
    }

    return {
        contentType: detected,
        bytes
    };
}

function sanitizeR2KeySegment(value) {
    const sanitized = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized || 'chat';
}

function defaultRandomKey() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function getImageExtension(contentType) {
    const normalized = normalizeContentType(contentType);
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/gif') return 'gif';
    return 'jpg';
}

function getR2PublicUrlBase(env = process.env) {
    const configured = String(env?.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    if (!configured) return DEFAULT_PUBLIC_URL;

    try {
        const parsed = new URL(configured);
        if (parsed.hostname.toLowerCase().endsWith('.r2.dev')) {
            return DEFAULT_PUBLIC_URL;
        }
        return parsed.toString().replace(/\/+$/, '');
    } catch (_) {
        return DEFAULT_PUBLIC_URL;
    }
}

function getR2Endpoint(env = process.env) {
    const configured = String(env?.R2_ENDPOINT || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    const accountId = String(env?.R2_ACCOUNT_ID || '').trim();
    if (!accountId) return '';
    return `https://${accountId}.r2.cloudflarestorage.com`;
}

function getR2Credentials(env = process.env) {
    return {
        accessKeyId: String(env?.R2_ACCESS_KEY_ID || env?.R2_ACCESS_KEY || '').trim(),
        secretAccessKey: String(env?.R2_SECRET_ACCESS_KEY || env?.R2_SECRET_KEY || '').trim(),
        bucketName: String(env?.R2_BUCKET_NAME || DEFAULT_BUCKET_NAME).trim() || DEFAULT_BUCKET_NAME,
        endpoint: getR2Endpoint(env)
    };
}

async function putObjectWithAwsSdk(env, commandInput) {
    const credentials = getR2Credentials(env);
    if (!credentials.endpoint || !credentials.accessKeyId || !credentials.secretAccessKey) {
        throw new Error('R2 is not configured');
    }

    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
        region: 'auto',
        endpoint: credentials.endpoint,
        credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey
        }
    });
    await client.send(new PutObjectCommand(commandInput));
}

async function uploadChatImage({ imageData, sessionId } = {}, options = {}) {
    const env = options.env || process.env;
    const now = typeof options.now === 'function' ? options.now() : (options.now || Date.now());
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const randomKey = typeof options.randomKey === 'function'
        ? options.randomKey()
        : defaultRandomKey();
    const parsed = parseImageDataUrl(imageData);
    const key = `chat/${sanitizeR2KeySegment(sessionId)}/${timestamp}_${sanitizeR2KeySegment(randomKey)}.${getImageExtension(parsed.contentType)}`;
    const credentials = getR2Credentials(env);
    const commandInput = {
        Bucket: credentials.bucketName,
        Key: key,
        Body: parsed.bytes,
        ContentType: parsed.contentType,
        CacheControl: 'public, max-age=31536000, immutable'
    };

    if (typeof options.putObject === 'function') {
        await options.putObject(commandInput);
    } else {
        await putObjectWithAwsSdk(env, commandInput);
    }

    return `${getR2PublicUrlBase(env)}/${key}`;
}

module.exports = {
    MAX_CHAT_IMAGE_BYTES,
    detectImageContentType,
    getR2PublicUrlBase,
    parseImageDataUrl,
    sanitizeR2KeySegment,
    uploadChatImage
};
