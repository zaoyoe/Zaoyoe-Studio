// Public, bounded colour grids for gallery photographs that do not expose CORS.
// This is deliberately not a general image proxy.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const GRID_SIZE = 64;
const CACHE_TTL = 24 * 60 * 60 * 1000;

function sampleUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'cdn.fatherkey.com'
            || url.port || url.username || url.password || url.hash
            || !/^\/prompts\/[a-zA-Z0-9_./%-]+\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname)
            || /%(?:2f|5c|2e)/i.test(url.pathname)
            || [...url.searchParams.keys()].some(key => key !== 'v')
            || url.searchParams.getAll('v').length > 1
            || (url.searchParams.get('v') || '').length > 128) return null;
        return url.href;
    } catch { return null; }
}

function failure(code, status = 502) {
    return Object.assign(new Error(code), { code, status });
}

function createGlassImageSampleHandler({ fetchImpl = globalThis.fetch, sharpImpl,
    now = Date.now, timeoutMs = 7000, maxBytes = MAX_BYTES,
    maxPixels = MAX_PIXELS, maxConcurrent = 2, maxEntries = 64 } = {}) {
    const cache = new Map();
    const pending = new Map();
    async function load(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(url, {
                redirect: 'manual', signal: controller.signal,
                headers: { Accept: 'image/jpeg,image/png,image/webp,image/avif' }
            });
            if (response.status !== 200 || !/^image\/(?:jpeg|png|webp|avif)(?:;|$)/i.test(response.headers.get('content-type') || '')) {
                await response.body?.cancel();
                throw failure('image_unavailable');
            }
            if (Number(response.headers.get('content-length')) > maxBytes) {
                await response.body?.cancel();
                throw failure('image_too_large', 413);
            }
            const chunks = []; let size = 0;
            for await (const chunk of response.body) {
                size += chunk.byteLength;
                if (size > maxBytes) { controller.abort(); throw failure('image_too_large', 413); }
                chunks.push(Buffer.from(chunk));
            }
            const sharp = sharpImpl || require('sharp');
            const image = sharp(Buffer.concat(chunks), { limitInputPixels: maxPixels, animated: false });
            const metadata = await image.metadata();
            if (!['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format)
                || !metadata.width || !metadata.height
                || metadata.width * metadata.height > maxPixels) throw failure('invalid_image', 422);
            const rotated = metadata.orientation >= 5 && metadata.orientation <= 8;
            const { data, info } = await image.rotate().resize({
                width: GRID_SIZE, height: GRID_SIZE, fit: 'inside', withoutEnlargement: true
            }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            return {
                width: info.width, height: info.height,
                naturalWidth: rotated ? metadata.height : metadata.width,
                naturalHeight: rotated ? metadata.width : metadata.height,
                pixels: data.toString('base64')
            };
        } catch (error) {
            if (error.status) throw error;
            throw failure(controller.signal.aborted ? 'image_timeout' : 'invalid_image', controller.signal.aborted ? 504 : 422);
        } finally { clearTimeout(timer); }
    }
    return async function glassImageSample(req, res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return res.status(405).json({ error: 'method_not_allowed' });
        }
        const query = new URL(req.url, 'http://local.invalid').searchParams;
        const url = query.getAll('url').length === 1 ? sampleUrl(query.get('url')) : null;
        if (!url) return res.status(400).json({ error: 'invalid_image_url' });
        try {
            let entry = cache.get(url);
            if (entry && entry.expires <= now()) { cache.delete(url); entry = null; }
            if (!entry) {
                let work = pending.get(url);
                if (!work) {
                    if (pending.size >= maxConcurrent) {
                        res.setHeader('Retry-After', '2');
                        return res.status(503).json({ error: 'image_sample_busy' });
                    }
                    work = load(url); pending.set(url, work);
                }
                let value;
                try { value = await work; }
                finally { if (pending.get(url) === work) pending.delete(url); }
                entry = { value, expires: now() + CACHE_TTL };
                cache.set(url, entry);
                while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
            } else { cache.delete(url); cache.set(url, entry); }
            res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400');
            return res.status(200).json(entry.value);
        } catch (error) {
            return res.status(error.status || 502).json({ error: error.code || 'image_unavailable' });
        }
    };
}

module.exports = { createGlassImageSampleHandler, sampleUrl };
