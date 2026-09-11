'use strict';

const crypto = require('node:crypto');

const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;
const DEFAULT_BUCKET_NAME = 'zaoyoeimages';
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

    // The declared MIME is only a client hint. Safari's canvas.toBlob('image/webp')
    // often yields PNG or JPEG bytes while the data URL is still labeled webp.
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
    if (!detected || !ALLOWED_CONTENT_TYPES.has(detected)) {
        throw new Error('Image bytes do not match a supported image format');
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

function readFirstEnv(env, keys, fallback = '') {
    for (const key of keys) {
        const value = String(env?.[key] || '').trim();
        if (value) return value;
    }
    return fallback;
}

function getR2PublicUrlBase(env = process.env) {
    const configured = readFirstEnv(env, ['AI_IMAGE_R2_PUBLIC_URL', 'R2_PUBLIC_URL']).replace(/\/+$/, '');
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
    const configured = readFirstEnv(env, ['AI_IMAGE_R2_ENDPOINT', 'R2_ENDPOINT']).replace(/\/+$/, '');
    if (configured) return configured;
    const accountId = readFirstEnv(env, ['AI_IMAGE_R2_ACCOUNT_ID', 'R2_ACCOUNT_ID']);
    if (!accountId) return '';
    return `https://${accountId}.r2.cloudflarestorage.com`;
}

function getR2Credentials(env = process.env) {
    return {
        accessKeyId: readFirstEnv(env, ['AI_IMAGE_R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY']),
        secretAccessKey: readFirstEnv(env, ['AI_IMAGE_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY', 'R2_SECRET_KEY']),
        bucketName: readFirstEnv(env, ['AI_IMAGE_R2_BUCKET_NAME', 'R2_BUCKET_NAME'], DEFAULT_BUCKET_NAME) || DEFAULT_BUCKET_NAME,
        endpoint: getR2Endpoint(env)
    };
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
    return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeS3Path(key) {
    return String(key)
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => (
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        )))
        .join('/');
}

function toAmzDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildSignedR2PutRequest(env, commandInput, signedAt) {
    const credentials = getR2Credentials(env);
    if (!credentials.endpoint || !credentials.accessKeyId || !credentials.secretAccessKey) {
        throw new Error('R2 is not configured');
    }

    const endpoint = new URL(credentials.endpoint);
    const host = `${credentials.bucketName}.${endpoint.host}`;
    const canonicalUri = `/${encodeS3Path(commandInput.Key)}`;
    const contentType = commandInput.ContentType || 'application/octet-stream';
    const cacheControl = String(commandInput.CacheControl || '').trim();
    const payloadHash = sha256Hex(commandInput.Body);
    const amzDate = toAmzDate(signedAt);
    const dateStamp = amzDate.slice(0, 8);
    const region = 'auto';
    const service = 's3';
    const headerMap = {
        'content-type': contentType,
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate
    };
    if (cacheControl) headerMap['cache-control'] = cacheControl;

    const signedHeaderNames = Object.keys(headerMap).sort();
    const canonicalHeaders = signedHeaderNames
        .map((name) => `${name}:${headerMap[name]}\n`)
        .join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
        'PUT',
        canonicalUri,
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest)
    ].join('\n');
    const signingKey = hmac(
        hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), region), service),
        'aws4_request'
    );
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    return {
        url: `${endpoint.protocol}//${host}${canonicalUri}`,
        headers: {
            Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
            'Content-Type': contentType,
            ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate
        },
        body: commandInput.Body
    };
}

async function putObjectWithSignedRequest(env, commandInput, options = {}) {
    const request = buildSignedR2PutRequest(env, commandInput, options.signedAt || new Date());
    const fetchImpl = options.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('Unable to upload image');
    }

    const response = await fetchImpl(request.url, {
        method: 'PUT',
        headers: request.headers,
        body: request.body
    });
    const status = Number(response?.status);
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
        throw new Error('Unable to upload image');
    }
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
        await putObjectWithSignedRequest(env, commandInput, {
            fetch: options.fetch,
            signedAt: new Date(timestamp)
        });
    }

    return `${getR2PublicUrlBase(env)}/${key}`;
}

module.exports = {
    MAX_CHAT_IMAGE_BYTES,
    buildSignedR2PutRequest,
    detectImageContentType,
    getR2Credentials,
    getR2PublicUrlBase,
    parseImageDataUrl,
    sanitizeR2KeySegment,
    uploadChatImage
};
