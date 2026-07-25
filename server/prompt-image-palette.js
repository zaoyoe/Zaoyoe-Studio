const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const sharp = require('sharp');

const PROMPT_IMAGE_PALETTE_VERSION = 3;
const PROMPT_IMAGE_PALETTE_MIN_COLORS = 3;
const PROMPT_IMAGE_PALETTE_MAX_COLORS = 6;
const PROMPT_IMAGE_PALETTE_SAMPLE_SIZE = 128;
const DEFAULT_IMAGE_TIMEOUT_MS = 20000;
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
let avifDecoderPromise = null;

function isAvifBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
        return false;
    }
    const brandLimit = Math.min(buffer.length, 64);
    for (let offset = 8; offset + 4 <= brandLimit; offset += 4) {
        const brand = buffer.toString('ascii', offset, offset + 4);
        if (brand === 'avif' || brand === 'avis') return true;
    }
    return false;
}

async function loadAvifDecoder() {
    if (!avifDecoderPromise) {
        avifDecoderPromise = (async () => {
            const decoderModule = await import('@jsquash/avif/decode.js');
            const packageDirectory = path.dirname(require.resolve('@jsquash/avif/package.json'));
            const wasmBuffer = await fs.promises.readFile(path.join(
                packageDirectory,
                'codec/dec/avif_dec.wasm'
            ));
            await decoderModule.init(new WebAssembly.Module(wasmBuffer));
            return decoderModule.default;
        })().catch((error) => {
            avifDecoderPromise = null;
            throw error;
        });
    }
    return avifDecoderPromise;
}

async function createPaletteImagePipeline(buffer) {
    if (!isAvifBuffer(buffer)) return sharp(buffer, { failOn: 'error' });

    const decodeAvif = await loadAvifDecoder();
    const source = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const decoded = await decodeAvif(source, { bitDepth: 8 });
    const width = Number(decoded?.width) || 0;
    const height = Number(decoded?.height) || 0;
    const expectedLength = width * height * 4;
    if (!width || !height || !decoded?.data || decoded.data.length !== expectedLength) {
        throw new Error('AVIF decoder returned invalid pixel data');
    }

    return sharp(Buffer.from(decoded.data), {
        raw: { width, height, channels: 4 }
    });
}

function normalizePositiveInteger(value, fallback, max = Number.POSITIVE_INFINITY) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

function hashImageBuffer(buffer) {
    return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function rgbToHex(red, green, blue) {
    return `#${[red, green, blue]
        .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
        .join('')}`.toUpperCase();
}

function getColorMetrics(red, green, blue) {
    const normalized = [red, green, blue].map((value) => Math.max(0, Math.min(255, value)) / 255);
    const [safeRed, safeGreen, safeBlue] = normalized;
    const max = Math.max(...normalized);
    const min = Math.min(...normalized);
    const chroma = max - min;
    const lightness = (max + min) / 2;
    const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs((2 * lightness) - 1));
    let hue = 0;
    if (chroma > 0) {
        if (max === safeRed) hue = 60 * (((safeGreen - safeBlue) / chroma) % 6);
        if (max === safeGreen) hue = 60 * (((safeBlue - safeRed) / chroma) + 2);
        if (max === safeBlue) hue = 60 * (((safeRed - safeGreen) / chroma) + 4);
    }
    if (hue < 0) hue += 360;
    return { chroma, hue, lightness, saturation };
}

function getColorDistance(left, right) {
    return Math.sqrt(
        ((left.red - right.red) ** 2)
        + ((left.green - right.green) ** 2)
        + ((left.blue - right.blue) ** 2)
    );
}

function isLikelySkinTone({ hue, lightness, saturation }) {
    return hue >= 8
        && hue <= 55
        && lightness >= 0.35
        && lightness <= 0.9
        && saturation >= 0.18
        && saturation <= 0.78;
}

function buildQuantizedPoints(raw, channels) {
    const bins = new Map();
    const safeChannels = Math.max(3, Number(channels) || 3);

    for (let offset = 0; offset + 2 < raw.length; offset += safeChannels) {
        const red = raw[offset];
        const green = raw[offset + 1];
        const blue = raw[offset + 2];
        const key = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
        const current = bins.get(key);
        if (current) {
            current.count += 1;
            current.redSum += red;
            current.greenSum += green;
            current.blueSum += blue;
        } else {
            bins.set(key, {
                key,
                count: 1,
                redSum: red,
                greenSum: green,
                blueSum: blue,
                red: red,
                green: green,
                blue: blue
            });
        }
    }

    return [...bins.values()].map((point) => ({
        ...point,
        red: point.redSum / point.count,
        green: point.greenSum / point.count,
        blue: point.blueSum / point.count
    }));
}

function getPaletteTargetColorCount(points) {
    const total = points.reduce((sum, point) => sum + point.count, 0);
    if (!total || !points.length) return 0;

    const entropy = points.reduce((sum, point) => {
        const ratio = point.count / total;
        return sum - (ratio * Math.log(ratio));
    }, 0);
    const effectiveColorCount = Math.exp(entropy);
    const target = effectiveColorCount < 4
        ? 3
        : (effectiveColorCount < 8 ? 4 : (effectiveColorCount < 16 ? 5 : 6));

    return Math.min(
        PROMPT_IMAGE_PALETTE_MAX_COLORS,
        Math.max(PROMPT_IMAGE_PALETTE_MIN_COLORS, target),
        points.length
    );
}

function getBucketStats(points) {
    const stats = points.reduce((result, point) => ({
        count: result.count + point.count,
        redMin: Math.min(result.redMin, point.red),
        redMax: Math.max(result.redMax, point.red),
        greenMin: Math.min(result.greenMin, point.green),
        greenMax: Math.max(result.greenMax, point.green),
        blueMin: Math.min(result.blueMin, point.blue),
        blueMax: Math.max(result.blueMax, point.blue)
    }), {
        count: 0,
        redMin: 255,
        redMax: 0,
        greenMin: 255,
        greenMax: 0,
        blueMin: 255,
        blueMax: 0
    });
    const ranges = {
        red: stats.redMax - stats.redMin,
        green: stats.greenMax - stats.greenMin,
        blue: stats.blueMax - stats.blueMin
    };
    const channel = ['red', 'green', 'blue'].sort((left, right) => (
        ranges[right] - ranges[left] || left.localeCompare(right)
    ))[0];

    return {
        ...stats,
        channel,
        score: stats.count * Math.max(ranges.red, ranges.green, ranges.blue)
    };
}

function splitBucket(points) {
    if (points.length < 2) return null;
    const stats = getBucketStats(points);
    const sorted = [...points].sort((left, right) => (
        left[stats.channel] - right[stats.channel] || left.key - right.key
    ));
    const midpoint = stats.count / 2;
    let runningCount = 0;
    let splitIndex = 1;

    for (let index = 0; index < sorted.length - 1; index += 1) {
        runningCount += sorted[index].count;
        if (runningCount >= midpoint) {
            splitIndex = index + 1;
            break;
        }
    }

    return [sorted.slice(0, splitIndex), sorted.slice(splitIndex)];
}

function quantizePoints(points, targetColorCount) {
    const buckets = [points];

    while (buckets.length < targetColorCount) {
        const candidateIndex = buckets
            .map((bucket, index) => ({ index, ...getBucketStats(bucket), length: bucket.length }))
            .filter((candidate) => candidate.length > 1)
            .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.index;
        if (!Number.isInteger(candidateIndex)) break;

        const split = splitBucket(buckets[candidateIndex]);
        if (!split || !split[0].length || !split[1].length) break;
        buckets.splice(candidateIndex, 1, split[0], split[1]);
    }

    const total = points.reduce((sum, point) => sum + point.count, 0);
    const mergedByHex = new Map();
    for (const bucket of buckets) {
        const sums = bucket.reduce((result, point) => ({
            count: result.count + point.count,
            red: result.red + point.redSum,
            green: result.green + point.greenSum,
            blue: result.blue + point.blueSum
        }), { count: 0, red: 0, green: 0, blue: 0 });
        if (!sums.count) continue;
        const red = sums.red / sums.count;
        const green = sums.green / sums.count;
        const blue = sums.blue / sums.count;
        const hex = rgbToHex(red, green, blue);
        const existing = mergedByHex.get(hex);
        if (existing) {
            existing.count += sums.count;
        } else {
            mergedByHex.set(hex, { hex, count: sums.count, red, green, blue });
        }
    }

    return [...mergedByHex.values()]
        .sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex))
        .map((color) => ({
            ...color,
            ratio: color.count / total,
            ...getColorMetrics(color.red, color.green, color.blue)
        }));
}

function buildAccentColorCandidates(points) {
    const hueBucketCount = 12;
    const total = points.reduce((sum, point) => sum + point.count, 0);
    const groups = new Map();

    for (const point of points) {
        const metrics = getColorMetrics(point.red, point.green, point.blue);
        if (
            metrics.saturation < 0.18
            || metrics.chroma < 0.08
            || metrics.lightness < 0.04
            || metrics.lightness > 0.96
        ) continue;
        const hueIndex = Math.min(hueBucketCount - 1, Math.floor(metrics.hue / (360 / hueBucketCount)));
        const group = groups.get(hueIndex) || {
            hueIndex,
            count: 0,
            redSum: 0,
            greenSum: 0,
            blueSum: 0,
            chromaSum: 0,
            saturationSum: 0,
            visualWeightSum: 0,
            visualRedSum: 0,
            visualGreenSum: 0,
            visualBlueSum: 0
        };
        const visualWeight = point.count * Math.max(0.01, metrics.chroma ** 2);
        group.count += point.count;
        group.redSum += point.redSum;
        group.greenSum += point.greenSum;
        group.blueSum += point.blueSum;
        group.chromaSum += metrics.chroma * point.count;
        group.saturationSum += metrics.saturation * point.count;
        group.visualWeightSum += visualWeight;
        group.visualRedSum += point.red * visualWeight;
        group.visualGreenSum += point.green * visualWeight;
        group.visualBlueSum += point.blue * visualWeight;
        groups.set(hueIndex, group);
    }

    return [...groups.values()].flatMap((group) => {
        const ratio = group.count / total;
        const chroma = group.chromaSum / group.count;
        if (ratio < 0.003 || chroma < 0.1) return [];
        const red = group.visualRedSum / group.visualWeightSum;
        const green = group.visualGreenSum / group.visualWeightSum;
        const blue = group.visualBlueSum / group.visualWeightSum;
        const visualMetrics = getColorMetrics(red, green, blue);
        if (isLikelySkinTone(visualMetrics)) return [];
        return [{
            hex: rgbToHex(red, green, blue),
            red,
            green,
            blue,
            ratio,
            chroma: visualMetrics.chroma,
            saturation: visualMetrics.saturation,
            hueIndex: group.hueIndex,
            accentScore: Math.sqrt(ratio) * (visualMetrics.chroma ** 1.6)
        }];
    }).sort((left, right) => right.accentScore - left.accentScore || left.hex.localeCompare(right.hex));
}

function getHueBucketDistance(left, right, bucketCount = 12) {
    const distance = Math.abs(left - right);
    return Math.min(distance, bucketCount - distance);
}

function selectPaletteColors(dominantCandidates, accentCandidates, targetColorCount) {
    const selected = [];
    const selectedHexes = new Set();
    const selectedAccentHueIndexes = [];
    const addCandidate = (candidate) => {
        if (!candidate || selectedHexes.has(candidate.hex)) return false;
        if (selected.some((current) => getColorDistance(current, candidate) < 24)) return false;
        selected.push(candidate);
        selectedHexes.add(candidate.hex);
        return true;
    };

    addCandidate(dominantCandidates[0]);
    const accentSlots = Math.min(2, Math.max(0, targetColorCount - 1));
    for (const candidate of accentCandidates) {
        if (selectedAccentHueIndexes.some((hueIndex) => getHueBucketDistance(hueIndex, candidate.hueIndex) < 2)) {
            continue;
        }
        if (addCandidate(candidate)) {
            selectedAccentHueIndexes.push(candidate.hueIndex);
            if (selectedAccentHueIndexes.length >= accentSlots) break;
        }
    }

    const remainingDominant = dominantCandidates
        .filter((candidate) => !selectedHexes.has(candidate.hex))
        .map((candidate) => {
            const nearestDistance = selected.length
                ? Math.min(...selected.map((current) => getColorDistance(current, candidate)))
                : 441;
            return {
                ...candidate,
                selectionScore: candidate.ratio * (0.55 + (nearestDistance / 441))
            };
        })
        .sort((left, right) => right.selectionScore - left.selectionScore || right.ratio - left.ratio || left.hex.localeCompare(right.hex));
    for (const candidate of remainingDominant) {
        addCandidate(candidate);
        if (selected.length >= targetColorCount) break;
    }

    for (const candidate of [...accentCandidates, ...dominantCandidates]) {
        if (selected.length >= targetColorCount) break;
        if (!selectedHexes.has(candidate.hex)) {
            selected.push(candidate);
            selectedHexes.add(candidate.hex);
        }
    }

    const ordered = selected
        .slice(0, targetColorCount)
        .sort((left, right) => right.ratio - left.ratio || left.hex.localeCompare(right.hex));
    const ratioTotal = ordered.reduce((sum, color) => sum + color.ratio, 0) || 1;
    let assignedRatio = 0;
    return ordered.map((color, index) => {
        const ratio = index === ordered.length - 1
            ? Math.max(0, 1 - assignedRatio)
            : Number((color.ratio / ratioTotal).toFixed(6));
        assignedRatio += ratio;
        return { hex: color.hex, ratio: Number(ratio.toFixed(6)) };
    });
}

async function extractPaletteColors(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw new TypeError('Image palette extraction requires a non-empty Buffer');
    }

    const imagePipeline = await createPaletteImagePipeline(buffer);
    const { data, info } = await imagePipeline
        .rotate()
        .flatten({ background: '#ffffff' })
        .toColorspace('srgb')
        .resize({
            width: PROMPT_IMAGE_PALETTE_SAMPLE_SIZE,
            height: PROMPT_IMAGE_PALETTE_SAMPLE_SIZE,
            fit: 'inside',
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .removeAlpha()
        .raw({ depth: 'uchar' })
        .toBuffer({ resolveWithObject: true });
    const points = buildQuantizedPoints(data, info.channels);
    const targetColorCount = getPaletteTargetColorCount(points);
    if (!targetColorCount) return [];
    const dominantCandidateCount = Math.min(points.length, Math.max(8, targetColorCount * 2));
    const dominantCandidates = quantizePoints(points, dominantCandidateCount);
    const accentCandidates = buildAccentColorCandidates(points);
    return selectPaletteColors(dominantCandidates, accentCandidates, targetColorCount);
}

async function extractPromptImagePalette(buffer, {
    imageIndex = 0,
    imageUrl = '',
    paletteCache = null
} = {}) {
    const imageHash = hashImageBuffer(buffer);
    let colors = paletteCache instanceof Map ? paletteCache.get(imageHash) : null;
    if (!Array.isArray(colors)) {
        colors = await extractPaletteColors(buffer);
        if (paletteCache instanceof Map) {
            paletteCache.set(imageHash, colors.map((color) => ({ ...color })));
        }
    }

    return {
        image_index: Math.max(0, Number.parseInt(imageIndex, 10) || 0),
        image_url: String(imageUrl || '').trim(),
        image_hash: imageHash,
        version: PROMPT_IMAGE_PALETTE_VERSION,
        colors: colors.map((color) => ({ ...color }))
    };
}

function normalizePromptImagePaletteEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const colors = (Array.isArray(value.colors) ? value.colors : []).flatMap((color) => {
        const hex = String(color?.hex || '').trim().toUpperCase();
        if (!/^#[0-9A-F]{6}$/.test(hex)) return [];
        const ratio = Number(color?.ratio);
        return [{ hex, ratio: Number.isFinite(ratio) && ratio >= 0 ? ratio : 0 }];
    }).slice(0, PROMPT_IMAGE_PALETTE_MAX_COLORS);
    if (!colors.length) return null;

    return {
        image_index: Math.max(0, Number.parseInt(value.image_index ?? value.imageIndex, 10) || 0),
        image_url: String(value.image_url || value.imageUrl || '').trim(),
        image_hash: String(value.image_hash || value.imageHash || '').trim(),
        version: Number.parseInt(value.version, 10) || 0,
        colors
    };
}

function normalizePromptImagePalettes(value) {
    return (Array.isArray(value) ? value : [])
        .map(normalizePromptImagePaletteEntry)
        .filter(Boolean);
}

function alignPromptImagePalettes(imageUrls = [], palettes = []) {
    const normalizedPalettes = normalizePromptImagePalettes(palettes);
    const byUrl = new Map(normalizedPalettes.map((palette) => [palette.image_url, palette]));
    const used = new Set();

    return imageUrls.flatMap((imageUrl, imageIndex) => {
        const normalizedUrl = String(imageUrl || '').trim();
        let palette = byUrl.get(normalizedUrl);
        if (!palette) {
            palette = normalizedPalettes.find((candidate, candidateIndex) => (
                !used.has(candidateIndex) && candidate.image_index === imageIndex
            ));
        }
        if (!palette) return [];
        const paletteIndex = normalizedPalettes.indexOf(palette);
        if (paletteIndex >= 0) used.add(paletteIndex);
        return [{ ...palette, image_index: imageIndex, image_url: normalizedUrl }];
    });
}

function getPromptImageUrlsFromRecord(record = {}) {
    const imageAssets = Array.isArray(record?.image_assets)
        ? record.image_assets
        : (Array.isArray(record?.imageAssets) ? record.imageAssets : []);
    const images = Array.isArray(record?.images) ? record.images : [];
    const seen = new Set();

    return [...imageAssets, ...images].flatMap((value) => {
        const imageUrl = typeof value === 'string'
            ? value
            : (value?.original || value?.url || value?.src || '');
        const normalizedUrl = String(imageUrl || '').trim();
        const key = normalizedUrl.toLowerCase();
        if (!normalizedUrl || seen.has(key)) return [];
        seen.add(key);
        return [normalizedUrl];
    });
}

function isCurrentPromptImagePaletteEntry(entry) {
    return Boolean(
        entry
        && entry.version === PROMPT_IMAGE_PALETTE_VERSION
        && entry.image_hash.startsWith('sha256:')
        && entry.colors.length > 0
    );
}

function canUpgradePromptImagePaletteWithoutExtraction(entry) {
    if (!entry || entry.version !== 2 || !entry.image_hash.startsWith('sha256:') || !entry.colors.length) {
        return false;
    }
    const pathname = String(entry.image_url || '').split(/[?#]/, 1)[0];
    return /\.(?:bmp|gif|jpe?g|png|tiff?|webp)$/i.test(pathname);
}

function hasCurrentPromptImagePalettes(imageUrls = [], palettes = []) {
    if (!imageUrls.length) return normalizePromptImagePalettes(palettes).length === 0;
    const aligned = alignPromptImagePalettes(imageUrls, palettes);
    return aligned.length === imageUrls.length && aligned.every(isCurrentPromptImagePaletteEntry);
}

function isBlockedImageHostname(hostname = '') {
    const normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!normalized) return true;
    if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
    const ipVersion = net.isIP(normalized);
    if (!ipVersion) return false;
    if (ipVersion === 6) {
        return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
    }
    const parts = normalized.split('.').map(Number);
    return parts[0] === 10
        || parts[0] === 127
        || parts[0] === 0
        || (parts[0] === 169 && parts[1] === 254)
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168);
}

async function downloadImageBuffer(imageUrl, {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_IMAGE_BYTES
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Image download requires fetch');
    const parsed = new URL(String(imageUrl || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedImageHostname(parsed.hostname)) {
        throw new Error('Unsupported image URL');
    }

    const safeTimeoutMs = normalizePositiveInteger(timeoutMs, DEFAULT_IMAGE_TIMEOUT_MS, 60000);
    const safeMaxBytes = normalizePositiveInteger(maxBytes, DEFAULT_MAX_IMAGE_BYTES, 80 * 1024 * 1024);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), safeTimeoutMs);

    try {
        const response = await fetchImpl(parsed.toString(), {
            signal: controller.signal,
            redirect: 'follow',
            headers: { accept: 'image/*' }
        });
        if (!response.ok) throw new Error(`Image download failed (${response.status})`);
        const contentLength = Number(response.headers?.get?.('content-length') || 0);
        if (contentLength > safeMaxBytes) throw new Error('Image exceeds palette size limit');

        if (!response.body?.getReader) {
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > safeMaxBytes) throw new Error('Image exceeds palette size limit');
            return buffer;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > safeMaxBytes) {
                await reader.cancel();
                throw new Error('Image exceeds palette size limit');
            }
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks, totalBytes);
    } finally {
        clearTimeout(timeout);
    }
}

async function resolvePromptImagePalettes(imageUrls = [], {
    existingPalettes = [],
    concurrency = 2,
    paletteCache = null,
    loadImageBuffer = downloadImageBuffer,
    downloadAttempts = 3,
    timeoutMs,
    maxBytes
} = {}) {
    const urls = imageUrls.map((value) => String(value || '').trim()).filter(Boolean);
    const existingByUrl = new Map(
        normalizePromptImagePalettes(existingPalettes)
            .filter((palette) => (
                isCurrentPromptImagePaletteEntry(palette)
                || canUpgradePromptImagePaletteWithoutExtraction(palette)
            ))
            .map((palette) => [palette.image_url, palette])
    );
    const results = new Array(urls.length);
    const failures = [];
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < urls.length) {
            const imageIndex = nextIndex;
            nextIndex += 1;
            const imageUrl = urls[imageIndex];
            const existing = existingByUrl.get(imageUrl);
            if (existing) {
                results[imageIndex] = {
                    ...existing,
                    version: PROMPT_IMAGE_PALETTE_VERSION,
                    image_index: imageIndex,
                    image_url: imageUrl
                };
                continue;
            }

            try {
                let buffer = null;
                let downloadError = null;
                const maxDownloadAttempts = normalizePositiveInteger(downloadAttempts, 3, 5);
                for (let attempt = 1; attempt <= maxDownloadAttempts; attempt += 1) {
                    try {
                        buffer = await loadImageBuffer(imageUrl, { timeoutMs, maxBytes });
                        break;
                    } catch (error) {
                        downloadError = error;
                        if (attempt < maxDownloadAttempts) {
                            await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
                        }
                    }
                }
                if (!buffer) throw downloadError || new Error('Image download failed');
                results[imageIndex] = await extractPromptImagePalette(buffer, {
                    imageIndex,
                    imageUrl,
                    paletteCache
                });
            } catch (error) {
                failures.push({
                    image_index: imageIndex,
                    image_url: imageUrl,
                    message: error?.message || 'Palette extraction failed'
                });
            }
        }
    }

    const workerCount = Math.min(urls.length, normalizePositiveInteger(concurrency, 2, 8));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return {
        palettes: results.filter(Boolean),
        failures: failures.sort((left, right) => left.image_index - right.image_index)
    };
}

module.exports = {
    PROMPT_IMAGE_PALETTE_VERSION,
    PROMPT_IMAGE_PALETTE_MIN_COLORS,
    PROMPT_IMAGE_PALETTE_MAX_COLORS,
    alignPromptImagePalettes,
    createPaletteImagePipeline,
    downloadImageBuffer,
    extractPaletteColors,
    extractPromptImagePalette,
    getPromptImageUrlsFromRecord,
    hasCurrentPromptImagePalettes,
    hashImageBuffer,
    normalizePromptImagePalettes,
    resolvePromptImagePalettes,
    _private: {
        buildAccentColorCandidates,
        buildQuantizedPoints,
        getPaletteTargetColorCount,
        quantizePoints,
        selectPaletteColors
    }
};
