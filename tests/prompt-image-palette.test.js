const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {
    PROMPT_IMAGE_PALETTE_VERSION,
    extractPromptImagePalette,
    hasCurrentPromptImagePalettes,
    resolvePromptImagePalettes
} = require('../server/prompt-image-palette');

async function createColorBandImage() {
    const colors = [
        [18, 28, 48],
        [197, 72, 64],
        [238, 181, 70],
        [63, 137, 112],
        [75, 103, 173],
        [219, 205, 183]
    ];
    const width = 120;
    const height = 72;
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const color = colors[Math.min(colors.length - 1, Math.floor(x / (width / colors.length)))];
            const offset = (y * width + x) * channels;
            raw[offset] = color[0];
            raw[offset + 1] = color[1];
            raw[offset + 2] = color[2];
        }
    }
    return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

async function createNeutralImageWithColorAccents() {
    const width = 100;
    const height = 100;
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let index = 0; index < width * height; index += 1) {
        const color = index < 7800
            ? [225, 218, 210]
            : (index < 9500 ? [12, 126, 91] : [224, 35, 53]);
        const offset = index * channels;
        raw[offset] = color[0];
        raw[offset + 1] = color[1];
        raw[offset + 2] = color[2];
    }
    return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

function hexToRgb(hex) {
    return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function colorDistance(hex, target) {
    const rgb = hexToRgb(hex);
    return Math.sqrt(rgb.reduce((sum, value, index) => sum + ((value - target[index]) ** 2), 0));
}

let avifEncoderPromise = null;

async function createTenBitAvifImage() {
    if (!avifEncoderPromise) {
        avifEncoderPromise = (async () => {
            const encoderModule = await import('@jsquash/avif/encode.js');
            const packageDirectory = path.dirname(require.resolve('@jsquash/avif/package.json'));
            const wasmBuffer = fs.readFileSync(path.join(packageDirectory, 'codec/enc/avif_enc.wasm'));
            await encoderModule.init(new WebAssembly.Module(wasmBuffer));
            return encoderModule.default;
        })();
    }

    const encodeAvif = await avifEncoderPromise;
    const width = 48;
    const height = 24;
    const data = new Uint16Array(width * height * 4);
    const colors = [
        [1023, 1023, 1023],
        [0, 0, 0],
        [800, 20, 30],
        [300, 300, 300]
    ];
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const color = colors[Math.min(colors.length - 1, Math.floor(x / (width / colors.length)))];
            const offset = (y * width + x) * 4;
            data[offset] = color[0];
            data[offset + 1] = color[1];
            data[offset + 2] = color[2];
            data[offset + 3] = 1023;
        }
    }
    const encoded = await encodeAvif({ data, width, height }, {
        bitDepth: 10,
        quality: 100,
        speed: 8,
        subsample: 3
    });
    return Buffer.from(encoded);
}

test('prompt image palette extraction is deterministic and versioned', async () => {
    const buffer = await createColorBandImage();
    const first = await extractPromptImagePalette(buffer, {
        imageIndex: 2,
        imageUrl: 'https://cdn.fatherkey.com/prompts/palette.png'
    });
    const second = await extractPromptImagePalette(buffer, {
        imageIndex: 2,
        imageUrl: 'https://cdn.fatherkey.com/prompts/palette.png'
    });

    assert.deepEqual(second, first);
    assert.equal(PROMPT_IMAGE_PALETTE_VERSION, 3);
    assert.equal(first.version, PROMPT_IMAGE_PALETTE_VERSION);
    assert.equal(first.image_index, 2);
    assert.match(first.image_hash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(first.colors.length >= 3 && first.colors.length <= 6);
    first.colors.forEach((color) => {
        assert.match(color.hex, /^#[0-9A-F]{6}$/);
        assert.ok(color.ratio > 0 && color.ratio <= 1);
    });
    const ratioTotal = first.colors.reduce((sum, color) => sum + color.ratio, 0);
    assert.ok(Math.abs(ratioTotal - 1) < 0.00001);
});

test('10-bit AVIF palettes are decoded without synthetic neon colors', async () => {
    const buffer = await createTenBitAvifImage();
    const palette = await extractPromptImagePalette(buffer, {
        imageUrl: 'https://cdn.fatherkey.com/prompts/high-depth.avif'
    });

    assert.ok(palette.colors.some((color) => colorDistance(color.hex, [199, 5, 7]) < 45));
    assert.ok(palette.colors.some((color) => colorDistance(color.hex, [255, 255, 255]) < 30));
    assert.ok(palette.colors.some((color) => colorDistance(color.hex, [0, 0, 0]) < 30));
    assert.equal(palette.colors.some((color) => {
        const [red, green, blue] = hexToRgb(color.hex);
        return green > 180 && green > red + 70 && green > blue + 70;
    }), false);
    assert.equal(palette.colors.some((color) => {
        const [red, green, blue] = hexToRgb(color.hex);
        return blue > 180 && blue > red + 70 && blue > green + 70;
    }), false);
});

test('palette resolution reuses current persisted entries without downloading', async () => {
    const existing = [{
        image_index: 0,
        image_url: 'https://cdn.fatherkey.com/prompts/existing.png',
        image_hash: `sha256:${'a'.repeat(64)}`,
        version: PROMPT_IMAGE_PALETTE_VERSION,
        colors: [{ hex: '#123456', ratio: 1 }]
    }];
    let downloadCount = 0;
    const result = await resolvePromptImagePalettes([existing[0].image_url], {
        existingPalettes: existing,
        async loadImageBuffer() {
            downloadCount += 1;
            throw new Error('should not download');
        }
    });

    assert.equal(downloadCount, 0);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.palettes, existing);
    assert.equal(hasCurrentPromptImagePalettes([existing[0].image_url], result.palettes), true);
});

test('version 2 non-AVIF palettes upgrade without downloading while AVIF is re-extracted', async () => {
    const imageHash = `sha256:${'b'.repeat(64)}`;
    const colors = [{ hex: '#123456', ratio: 1 }];
    let downloadCount = 0;
    const webpUrl = 'https://cdn.fatherkey.com/prompts/existing.webp';
    const avifUrl = 'https://cdn.fatherkey.com/prompts/existing.avif';
    const result = await resolvePromptImagePalettes([webpUrl, avifUrl], {
        existingPalettes: [
            { image_index: 0, image_url: webpUrl, image_hash: imageHash, version: 2, colors },
            { image_index: 1, image_url: avifUrl, image_hash: imageHash, version: 2, colors }
        ],
        async loadImageBuffer() {
            downloadCount += 1;
            return createColorBandImage();
        }
    });

    assert.equal(downloadCount, 1);
    assert.equal(result.palettes[0].version, PROMPT_IMAGE_PALETTE_VERSION);
    assert.deepEqual(result.palettes[0].colors, colors);
    assert.notDeepEqual(result.palettes[1].colors, colors);
});

test('palette extraction preserves vivid accent colors beside large neutral areas', async () => {
    const buffer = await createNeutralImageWithColorAccents();
    const palette = await extractPromptImagePalette(buffer, {
        imageUrl: 'https://cdn.fatherkey.com/prompts/accents.png'
    });

    assert.ok(palette.colors.some((color) => colorDistance(color.hex, [12, 126, 91]) < 55));
    assert.ok(palette.colors.some((color) => colorDistance(color.hex, [224, 35, 53]) < 55));
});

test('palette resolution reuses extracted colors by image hash', async () => {
    const buffer = await createColorBandImage();
    const paletteCache = new Map();
    const result = await resolvePromptImagePalettes([
        'https://cdn.fatherkey.com/prompts/one.png',
        'https://cdn.fatherkey.com/prompts/two.png'
    ], {
        concurrency: 1,
        paletteCache,
        async loadImageBuffer() {
            return buffer;
        }
    });

    assert.equal(result.failures.length, 0);
    assert.equal(result.palettes.length, 2);
    assert.equal(result.palettes[0].image_hash, result.palettes[1].image_hash);
    assert.deepEqual(result.palettes[0].colors, result.palettes[1].colors);
    assert.equal(paletteCache.size, 1);
});
