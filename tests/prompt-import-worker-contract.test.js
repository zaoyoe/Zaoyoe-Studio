const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require('../server/workers/prompt-import-runtime');

test('prompt import worker builds published bilingual analysis patch', () => {
    const patch = runtime.buildPromptPatch({ ai_tags: { existing: true } }, {
        title: 'Herbal Energy',
        title_zh: '草本能量',
        description: 'A vivid commercial poster.',
        description_zh: '一张鲜明的商业海报。',
        prompt_text_en: 'Create a vivid poster.',
        prompt_text_zh: '创作一张鲜明海报。',
        category: 'Illustration',
        objects: { en: ['package'], zh: ['包装'] },
        dominantColors: ['red', 'gold']
    });
    assert.equal(patch.title, 'Herbal Energy');
    assert.equal(patch.title_zh, '草本能量');
    assert.equal(patch.prompt_text_zh, '创作一张鲜明海报。');
    assert.equal(patch.ai_tags.admin.status, 'live');
    assert.equal(patch.ai_tags.existing, true);
});

test('prompt import worker rejects incomplete bilingual analysis', () => {
    assert.throws(() => runtime.validateAnalysisResult({ title_en: 'Only English' }), /分析结果不完整/);
});

test('prompt import worker prioritizes original compatible images before saved avif assets', () => {
    const originalUrl = 'https://images.meigen.ai/tweets/123/0.jpg';
    const savedUrl = 'https://cdn.fatherkey.com/prompts/imports/item.avif';
    const urls = runtime.getAnalysisImageUrls({
        images: [savedUrl],
        image_assets: [{ original: savedUrl }]
    }, [{
        image_sources: [{ url: originalUrl }],
        final_image_assets: [{ original: savedUrl }]
    }]);
    assert.deepEqual(urls, [originalUrl, savedUrl]);
});

test('prompt import worker falls back when a saved avif image cannot be decoded', async () => {
    const originalUrl = 'https://images.meigen.ai/tweets/123/0.jpg';
    const savedUrl = 'https://cdn.fatherkey.com/prompts/imports/item.avif';
    const attempts = [];
    const image = await runtime.loadAnalysisImages([originalUrl, savedUrl], {
        fetchImage: async (url) => {
            attempts.push(url);
            if (url.endsWith('.avif')) {
                const error = new Error('Image decode failed: Bitstream not supported by this decoder');
                error.retryable = false;
                throw error;
            }
            return Buffer.from('readable-image');
        }
    });
    assert.equal(image.length, 1);
    assert.equal(image[0].toString(), 'readable-image');
    assert.deepEqual(attempts, [originalUrl, savedUrl]);
});

test('prompt import worker does not retry deterministic image decode failures', async () => {
    await assert.rejects(
        runtime.loadAnalysisImages(['https://cdn.fatherkey.com/item.avif'], {
            fetchImage: async () => {
                const error = new Error('Image decode failed: bad seek');
                error.retryable = false;
                throw error;
            }
        }),
        (error) => {
            assert.equal(error.retryable, false);
            assert.match(error.message, /Image decode failed: bad seek/);
            assert.deepEqual(error.details.image_failures, ['Image decode failed: bad seek']);
            return true;
        }
    );
});

test('prompt import worker deployment uses durable leased queue', () => {
    const migration = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20260711_prompt_gallery_import_worker.sql'), 'utf8');
    const compose = fs.readFileSync(path.join(repoRoot, 'deploy/kvm4/docker-compose.verify-server.yml'), 'utf8');
    const deploy = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-kvm4-verify-server.sh'), 'utf8');
    const worker = fs.readFileSync(path.join(repoRoot, 'scripts/prompt-import-worker.js'), 'utf8');
    const runtimeSource = fs.readFileSync(path.join(repoRoot, 'server/workers/prompt-import-runtime.js'), 'utf8');
    const importsHandler = fs.readFileSync(path.join(repoRoot, 'server/api-handlers/admin/prompts/imports.js'), 'utf8');
    assert.match(migration, /FOR UPDATE SKIP LOCKED/);
    assert.match(migration, /lease_expires_at/);
    assert.match(migration, /processing_attempts < 3/);
    assert.match(compose, /prompt-import-worker:/);
    assert.match(compose, /zaoyoe-prompt-import-worker/);
    assert.match(deploy, /prompt-import-worker/);
    assert.match(worker, /let adaptiveLimit = Math\.min\(6, concurrencyCeiling\)/);
    assert.match(worker, /adaptiveLimit = Math\.max\(1, Math\.floor\(adaptiveLimit \/ 2\)\)/);
    assert.match(worker, /adaptiveLimit \+= 1/);
    assert.match(worker, /entry\.reason\?\.retryable === true/);
    assert.match(runtimeSource, /cleanup_after_pipeline: false/);
    assert.match(runtimeSource, /processing_attempts: retryable \? item\.processing_attempts : 3/);
    assert.match(runtimeSource, /isPromptImportItemCancelled/);
    assert.match(runtimeSource, /neq\('status', 'cleaned'\)/);
    assert.match(importsHandler, /pipeline_stage: 'cancelled'/);
    assert.match(importsHandler, /worker_name: null,[\s\S]*lease_expires_at: null,[\s\S]*processing_attempts: 3/);
    assert.match(importsHandler, /processing_attempts: 0,[\s\S]*next_attempt_at: retryAt/);
});
