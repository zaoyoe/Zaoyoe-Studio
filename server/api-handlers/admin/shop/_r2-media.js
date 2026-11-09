'use strict';

const crypto = require('node:crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { resolveR2Config } = require('../../_ai-image-models');

const { validateMediaUrl, downloadRemoteMedia } = require('./_remote-media-security');

const DEFAULT_GATEWAY = 'https://xiareng.cc';

function getMediaFileExtension(mimeType = '', url = '', fallback = 'jpg') {
    const normMime = String(mimeType || '').toLowerCase();
    if (normMime.includes('webp')) return 'webp';
    if (normMime.includes('jpeg') || normMime.includes('jpg')) return 'jpg';
    if (normMime.includes('png')) return 'png';
    if (normMime.includes('gif')) return 'gif';
    if (normMime.includes('svg')) return 'svg';
    if (normMime.includes('mp4')) return 'mp4';
    if (normMime.includes('webm')) return 'webm';
    if (normMime.includes('quicktime') || normMime.includes('mov')) return 'mov';

    try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
        if (match && match[1]) return match[1].toLowerCase();
    } catch (_) {}

    return fallback;
}

function resolveFullMediaUrl(rawUrl = '', gateway = DEFAULT_GATEWAY) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const base = String(gateway || DEFAULT_GATEWAY).replace(/\/+$/, '');
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${base}${path}`;
}

async function uploadMediaBufferToR2(buffer, {
    env = process.env,
    mimeType = 'image/jpeg',
    keyPrefix = 'shop/media',
    extension = 'jpg',
    contentAddressed = false,
    signal
} = {}) {
    const config = resolveR2Config(env);
    if (!config.configured) {
        return null;
    }

    const digest = crypto.createHash('sha256').update(buffer || Buffer.alloc(0)).digest('hex').slice(0, 20);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const safePrefix = String(keyPrefix || 'shop/media').replace(/^\/+|\/+$/g, '');
    const key = contentAddressed
        ? `${safePrefix}/${digest}.${extension}`
        : `${safePrefix}/${year}/${month}/${digest}.${extension}`;

    const client = new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        }
    });

    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable'
    }), signal ? { abortSignal: signal } : undefined);

    const publicBase = config.publicUrl.replace(/\/+$/, '');
    const publicUrl = `${publicBase}/${key}`;

    return {
        key,
        publicUrl
    };
}

async function uploadRemoteMediaToR2(rawUrl = '', {
    env = process.env,
    keyPrefix = 'shop/media',
    gateway = DEFAULT_GATEWAY,
    timeoutMs = 15000
} = {}) {
    let resolvedUrl;
    try { resolvedUrl = validateMediaUrl(resolveFullMediaUrl(rawUrl, gateway)).href; }
    catch (_) { return ''; }
    const config = resolveR2Config(env);
    if (!config.configured) return resolvedUrl;

    const controller = new AbortController();
    const duration = Math.max(100, Math.min(30000, Number(timeoutMs) || 15000));
    let timer;
    try {
        // The deadline covers DNS, redirects, body streaming and the R2 upload.
        return await Promise.race([
            (async () => {
                const { buffer, mimeType, extension } = await downloadRemoteMedia(resolvedUrl, { signal: controller.signal });
                const uploaded = await uploadMediaBufferToR2(buffer, { env, mimeType, keyPrefix, extension, signal: controller.signal });
                return uploaded?.publicUrl || '';
            })(),
            new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(''); }, duration); })
        ]);
    } catch (_) { return ''; }
    finally { clearTimeout(timer); }
}

// Attribute text is HTML encoded by the supplier sanitizer. Decode once before URL
// validation/download, then escape the validated URL again on output.
function decodeMediaAttribute(value) {
    return String(value).replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|quot|apos|lt|gt);/gi, (entity, numeric) => {
        if (numeric) {
            const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
        }
        return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
    });
}

async function syncHtmlMediaToR2(rawHtml = '', {
    env = process.env,
    keyPrefix = 'shop/products/description',
    gateway = DEFAULT_GATEWAY
} = {}) {
    if (!rawHtml || typeof rawHtml !== 'string') return '';

    const mediaSrcRegex = /(?<![\w:-])(?:src|poster)\s*=\s*(["'])([\s\S]*?)\1/gi;
    const matches = [];
    let match;

    while ((match = mediaSrcRegex.exec(rawHtml)) !== null) {
        const quote = match[1];
        const src = decodeMediaAttribute(match[2]).trim();
        if (src && !src.startsWith('data:') && !src.startsWith('#')) {
            matches.push({ full: match[0], quote, src });
        }
    }

    if (!matches.length) return rawHtml;

    // Deduplicate unique sources
    const uniqueSrcs = [...new Set(matches.map((m) => m.src))];
    const urlReplacementMap = new Map();

    const deadline = Date.now() + 30000;
    for (const [index, src] of uniqueSrcs.entries()) {
        const remaining = deadline - Date.now();
        // A bounded batch must not leave rejected or unprocessed URLs in attributes.
        const permanentUrl = index < 40 && remaining >= 100
            ? await uploadRemoteMediaToR2(src, { env, keyPrefix, gateway, timeoutMs: Math.min(15000, remaining) })
            : '';
        urlReplacementMap.set(src, permanentUrl);
    }

    return rawHtml.replace(mediaSrcRegex, (attribute, quote, source) => {
        const src = decodeMediaAttribute(source).trim();
        if (!urlReplacementMap.has(src)) return attribute;
        const url = urlReplacementMap.get(src);
        if (!url) return '';
        // Replace only the attribute value, never matching text or other fields.
        const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
        return `${attribute.slice(0, attribute.indexOf('='))}=${quote}${escaped}${quote}`;
    });
}

module.exports = {
    DEFAULT_GATEWAY,
    getMediaFileExtension,
    resolveFullMediaUrl,
    uploadMediaBufferToR2,
    uploadRemoteMediaToR2,
    syncHtmlMediaToR2
};
