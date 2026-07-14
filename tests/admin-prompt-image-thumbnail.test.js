const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const handler = require('../server/api-handlers/admin/prompts/image-thumbnail');

test('admin prompt thumbnail creates a bounded webp preview', async () => {
    const source = await sharp({
        create: {
            width: 1800,
            height: 1200,
            channels: 3,
            background: '#769dca'
        }
    }).png().toBuffer();

    const thumbnail = await handler._private.createThumbnailBuffer(source, 440);
    const metadata = await sharp(thumbnail).metadata();

    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 440);
    assert.equal(metadata.height, 330);
    assert.ok(thumbnail.length < source.length);
});

test('admin prompt thumbnail clamps requested dimensions', () => {
    assert.equal(handler._private.normalizePositiveInteger('1200', 440, 800), 800);
    assert.equal(handler._private.normalizePositiveInteger('0', 440, 800), 440);
});
