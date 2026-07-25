const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const {
    buildPromptImportImageVariantKey,
    buildPromptImportImageDerivatives
} = require('../server/api-handlers/admin/prompts/imports')._private;
const { createPaletteImagePipeline } = require('../server/prompt-image-palette');

test('prompt imports place image derivatives beside the import hierarchy', () => {
    const originalKey = 'prompts/imports/cn/2026/07/batch/item-0-deadbeef.jpg';
    assert.equal(
        buildPromptImportImageVariantKey(originalKey, 'card'),
        'prompts/imports/card/cn/2026/07/batch/item-0-deadbeef.webp'
    );
    assert.equal(
        buildPromptImportImageVariantKey(originalKey, 'thumb'),
        'prompts/imports/thumb/cn/2026/07/batch/item-0-deadbeef.webp'
    );
});

test('shared prompt image pipeline remains available for legacy AVIF poster conversion', async () => {
    const source = await sharp({
        create: {
            width: 16,
            height: 12,
            channels: 3,
            background: { r: 1, g: 2, b: 3 }
        }
    }).png().toBuffer();
    const pipeline = await createPaletteImagePipeline(source);
    const metadata = await pipeline.metadata();
    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 16, height: 12 });
});

test('prompt imports synchronously generate card and thumb WebP variants', async () => {
    const source = await sharp({
        create: {
            width: 1200,
            height: 800,
            channels: 3,
            background: { r: 40, g: 120, b: 200 }
        }
    }).jpeg().toBuffer();

    const derivatives = await buildPromptImportImageDerivatives(source);
    const cardMetadata = await sharp(derivatives.variants.card).metadata();
    const thumbMetadata = await sharp(derivatives.variants.thumb).metadata();

    assert.deepEqual({ width: derivatives.width, height: derivatives.height }, { width: 1200, height: 800 });
    assert.deepEqual(
        { format: cardMetadata.format, width: cardMetadata.width, height: cardMetadata.height },
        { format: 'webp', width: 560, height: 373 }
    );
    assert.deepEqual(
        { format: thumbMetadata.format, width: thumbMetadata.width, height: thumbMetadata.height },
        { format: 'webp', width: 800, height: 533 }
    );
});
