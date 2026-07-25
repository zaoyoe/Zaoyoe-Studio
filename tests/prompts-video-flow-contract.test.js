const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('public prompt gallery renders R2-backed videos with poster cards and modal playback', () => {
    const runtime = read('prompts-poetry.js');
    const styles = read('prompts-poetry.css');
    const migration = read('supabase/migrations/20260712_prompt_gallery_video_assets.sql');
    const imports = read('server/api-handlers/admin/prompts/imports.js');

    assert.match(runtime, /'video_assets'/);
    assert.match(runtime, /function getPromptVideoAssets/);
    assert.match(runtime, /source\.poster_asset/);
    assert.match(runtime, /posterAsset/);
    assert.match(runtime, /videoAsset\?\.posterAsset/);
    assert.match(runtime, /videoAssets\[0\]\?\.posterAsset/);
    assert.match(runtime, /const videoPosterKey = getPromptImageCanonicalDedupeKey/);
    assert.match(runtime, /const primaryImageAsset = imageAssets\[0\] \|\| null/);
    assert.match(runtime, /prompt-card-video-badge/);
    assert.match(runtime, /document\.createElement\('video'\)/);
    assert.match(runtime, /newMedia\.controls = true/);
    assert.match(styles, /\.prompt-modal-video/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS video_assets JSONB/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS video_sources JSONB/);
    assert.match(imports, /prompts\/videos\//);
    assert.match(imports, /poster_asset: posterAsset/);
    assert.match(imports, /PROMPT_IMPORT_IMAGE_VARIANTS/);
    assert.match(imports, /PutObjectCommand/);
    assert.doesNotMatch(imports, /supabase\.storage/i);
});
