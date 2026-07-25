const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const {
    parseArgs,
    getPosterWorkPlan,
    buildPosterFilename,
    buildVariantKey,
    buildVariantBuffers,
    mergeVideoPosterAsset
} = require('../scripts/backfill-prompt-video-posters');

test('video poster backfill is dry-run by default and has an explicit package command', () => {
    assert.equal(parseArgs([]).apply, false);
    assert.equal(parseArgs([]).concurrency, 4);
    assert.equal(parseArgs(['--apply']).apply, true);
    assert.equal(
        packageJson.scripts['backfill:prompt-video-posters'],
        'node scripts/backfill-prompt-video-posters.js'
    );
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/backfill-prompt-video-posters.js'), 'utf8');
    assert.match(source, /select\('id,title,images,image_assets,video_assets'\)/);
    assert.match(source, /update\(\{ video_assets: nextVideos \}\)/);
});

test('video poster backfill plans only missing variants with stable R2 keys', () => {
    const video = {
        original: 'https://cdn.fatherkey.com/prompts/videos/example.mp4',
        poster_asset: {
            original: 'https://cdn.fatherkey.com/prompts/poster.webp',
            card: 'https://cdn.fatherkey.com/prompts/card/poster.webp'
        }
    };
    assert.deepEqual(getPosterWorkPlan(video).variants, ['thumb']);
    assert.deepEqual(getPosterWorkPlan(video, { force: true }).variants, ['card', 'thumb']);

    const legacyVideo = { original: 'https://cdn.fatherkey.com/prompts/videos/legacy.mp4' };
    const fallbackAsset = { original: 'https://cdn.fatherkey.com/prompts/legacy-cover.avif' };
    const fallbackPlan = getPosterWorkPlan(legacyVideo, { fallbackPosterAsset: fallbackAsset });
    assert.equal(fallbackPlan.sourceType, 'image');
    assert.equal(fallbackPlan.sourceUrl, fallbackAsset.original);
    assert.deepEqual(fallbackPlan.variants, ['card', 'thumb']);

    const first = buildPosterFilename('prompt-123', 0, video.poster_asset.original);
    const second = buildPosterFilename('prompt-123', 0, video.poster_asset.original);
    assert.equal(first, second);
    assert.equal(buildVariantKey('card', first), `prompts/card/${first}`);
    assert.equal(buildVariantKey('thumb', first), `prompts/thumb/${first}`);
});

test('video poster backfill generates bounded WebPs and preserves video metadata', async () => {
    const source = await sharp({
        create: {
            width: 1200,
            height: 800,
            channels: 3,
            background: { r: 20, g: 30, b: 40 }
        }
    }).png().toBuffer();
    const { dimensions, buffers } = await buildVariantBuffers(source, ['card', 'thumb']);
    const card = await sharp(buffers.card).metadata();
    const thumb = await sharp(buffers.thumb).metadata();
    assert.deepEqual(dimensions, { width: 1200, height: 800 });
    assert.deepEqual({ format: card.format, width: card.width }, { format: 'webp', width: 560 });
    assert.deepEqual({ format: thumb.format, width: thumb.width }, { format: 'webp', width: 800 });

    const originalVideo = {
        original: 'https://cdn.fatherkey.com/prompts/videos/example.mp4',
        duration: 12.5,
        content_hash: 'sha256:example',
        custom_field: 'preserved'
    };
    const posterAsset = {
        original: 'https://cdn.fatherkey.com/prompts/poster.webp',
        card: 'https://cdn.fatherkey.com/prompts/card/poster.webp',
        thumb: 'https://cdn.fatherkey.com/prompts/thumb/poster.webp'
    };
    const merged = mergeVideoPosterAsset(originalVideo, posterAsset);
    assert.equal(merged.duration, 12.5);
    assert.equal(merged.content_hash, 'sha256:example');
    assert.equal(merged.custom_field, 'preserved');
    assert.equal(merged.poster, posterAsset.original);
    assert.deepEqual(merged.poster_asset, posterAsset);
});
