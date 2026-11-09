'use strict';

const sharp = require('sharp');
const { resolveR2Config } = require('../../_ai-image-models');
const { resolveFullMediaUrl, uploadMediaBufferToR2 } = require('./_r2-media');

const { validateMediaUrl, downloadRemoteMedia } = require('./_remote-media-security');

const PRODUCT_IMAGE_VARIANTS = Object.freeze({
    original: { width: 1200, height: 1200, fit: 'inside', quality: 80 },
    card: { width: 480, height: 320, fit: 'cover', quality: 78 },
    thumb: { width: 160, height: 160, fit: 'cover', quality: 78 }
});
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_ANIMATED_PIXELS = 200_000_000;
const MAX_ANIMATED_FRAMES = 250;

async function buildAnimatedProductImageVariants(buffer, metadata) {
    const frames = metadata.pages || 1;
    const pixels = metadata.width * (metadata.pageHeight || metadata.height) * frames;
    // Bound the decoded frame stack; oversized sources retain their original animation.
    if (frames > MAX_ANIMATED_FRAMES || !Number.isSafeInteger(pixels) || pixels > MAX_ANIMATED_PIXELS) return null;
    const images = {};
    // Process serially so bulk imports do not decode three large frame stacks at once.
    for (const [name, variant] of Object.entries(PRODUCT_IMAGE_VARIANTS)) {
        const width = name === 'original' ? Math.min(variant.width, 720) : variant.width;
        const height = name === 'original' ? Math.min(variant.height, 720) : variant.height;
        const resized = sharp(buffer, { animated: true, limitInputPixels: MAX_ANIMATED_PIXELS })
            .resize(width, height, { fit: variant.fit, position: 'centre', withoutEnlargement: true });
        if (metadata.format === 'gif') {
            // Retain the GIF palette/transparency before lossless WebP encoding. Direct lossy
            // WebP of resized transparent icons can be much larger. Both stages retain timing.
            const palette = await resized.gif({ colours: 256, dither: 0, effort: 7 }).toBuffer();
            images[name] = await sharp(palette, { animated: true, limitInputPixels: MAX_ANIMATED_PIXELS })
                .webp({ lossless: true, effort: 5, minSize: true }).toBuffer();
        } else {
            images[name] = await resized.webp({ quality: variant.quality, effort: 5, minSize: true, mixed: true }).toBuffer();
        }
    }
    return images;
}

async function buildProductImageVariants(buffer) {
    if (!buffer?.length || buffer.length > MAX_SOURCE_BYTES) throw new Error('Product image exceeds size limit');
    // Read frame metadata without loading the entire animation as a tall image.
    const metadata = await sharp(buffer, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
    if ((metadata.pages || 1) > 1) return buildAnimatedProductImageVariants(buffer, metadata);
    const entries = await Promise.all(Object.entries(PRODUCT_IMAGE_VARIANTS).map(async ([name, variant]) => [
        name,
        await sharp(buffer, { limitInputPixels: MAX_SOURCE_PIXELS })
            .rotate()
            .resize(variant.width, variant.height, { fit: variant.fit, position: 'centre', withoutEnlargement: true })
            .webp({ quality: variant.quality, effort: 5 })
            .toBuffer()
    ]));
    return Object.fromEntries(entries);
}

// A bounded cache shares both in-flight processing and successful results during bulk imports.
function createProductImageImporter({ downloadImage = downloadRemoteMedia, upload = uploadMediaBufferToR2, now = Date.now } = {}) {
    const cache = new Map();
    return async function uploadProductImageAssets(rawUrl, { env = process.env, gateway, timeoutMs = 15000 } = {}) {
        let source;
        try { source = validateMediaUrl(resolveFullMediaUrl(rawUrl, gateway)).href; }
        catch (_) { return null; }
        const fallback = { original: source };
        const config = resolveR2Config(env);
        if (!config.configured) return fallback;
        const key = JSON.stringify([config.endpoint, config.bucket, config.publicUrl, config.accessKeyId, source]);
        const cached = cache.get(key);
        if (cached && cached.expires > now()) return cached.promise;
        if (cache.size >= 128) cache.delete(cache.keys().next().value);
        const entry = { expires: now() + 300000, promise: null };
        entry.promise = (async () => {
            const controller = new AbortController();
            const duration = Math.max(100, Math.min(30000, Number(timeoutMs) || 15000));
            let timer;
            const work = async () => {
                const { buffer, mimeType, extension } = await downloadImage(source, {
                    signal: controller.signal, maxBytes: MAX_SOURCE_BYTES
                });
                controller.signal.throwIfAborted();
                if (!String(mimeType).startsWith('image/')) throw new Error('Product source must be an image');
                const variants = await buildProductImageVariants(buffer);
                controller.signal.throwIfAborted();
                const sources = variants || { original: buffer };
                const asset = {};
                for (const [name, bytes] of Object.entries(sources)) {
                    controller.signal.throwIfAborted();
                    const uploaded = await upload(bytes, {
                        env,
                        keyPrefix: `shop/products/cover/v1/${name}`,
                        extension: variants ? 'webp' : extension,
                        mimeType: variants ? 'image/webp' : mimeType,
                        contentAddressed: true,
                        signal: controller.signal
                    });
                    if (!uploaded?.publicUrl) throw new Error('Product image upload failed');
                    asset[name] = uploaded.publicUrl;
                }
                return Object.freeze(asset);
            };
            try {
                return await Promise.race([
                    work(),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => { controller.abort(); reject(new Error('Product image deadline exceeded')); }, duration);
                    })
                ]);
            } catch (_) {
                if (cache.get(key) === entry) cache.delete(key);
                return null;
            } finally {
                clearTimeout(timer);
            }
        })();
        cache.set(key, entry);
        return entry.promise;
    };
}

module.exports = { PRODUCT_IMAGE_VARIANTS, buildProductImageVariants, createProductImageImporter, uploadProductImageAssets: createProductImageImporter() };
