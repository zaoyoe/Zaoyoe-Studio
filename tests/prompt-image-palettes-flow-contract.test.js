const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');

test('prompt palette data is wired through schema, admin saves, Meigen imports, and backfill', () => {
    const migration = read('supabase/migrations/20260716_add_prompt_image_palettes.sql');
    const manage = read('server/api-handlers/admin/prompts/manage.js');
    const imports = read('server/api-handlers/admin/prompts/imports.js');
    const backfill = read('scripts/backfill-prompt-image-palettes.js');
    const packageJson = JSON.parse(read('package.json'));

    assert.match(migration, /image_palettes JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    assert.match(manage, /resolvePromptImagePalettes/);
    assert.match(manage, /image_palettes: result\.palettes/);
    assert.match(imports, /extractPromptImagePalette\(downloaded\.buffer/);
    assert.match(imports, /image_palettes: alignPromptImagePalettes/);
    assert.match(backfill, /concurrency: 4/);
    assert.match(backfill, /hasCurrentPromptImagePalettes/);
    assert.equal(packageJson.scripts['backfill:prompt-palettes'], 'node scripts/backfill-prompt-image-palettes.js');
});

test('prompt detail loads the persisted palette and copies hex colors', () => {
    const html = read('prompts.html');
    const script = read('prompts-poetry.js');
    const styles = read('prompts-poetry.css');

    assert.match(html, /id="modalImagePalette"/);
    assert.match(script, /'image_palettes'/);
    assert.match(script, /function renderModalImagePalette/);
    assert.match(script, /writePromptShareTextToClipboard\(hex\)/);
    assert.match(script, /currentModalImageIndex/);
    assert.match(styles, /\.prompt-image-palette-color/);
    const paletteColorRule = styles.match(/\.prompt-image-palette-color\s*\{[\s\S]*?\}/)?.[0] || '';
    assert.match(paletteColorRule, /box-shadow:\s*none/);
    assert.doesNotMatch(paletteColorRule, /inset\s+0/);
    const toastRule = styles.match(/\.gallery-toast\s*\{[\s\S]*?\}/)?.[0] || '';
    assert.match(toastRule, /z-index:\s*30000/);
    assert.match(toastRule, /background:\s*#ffffff/);
    assert.match(toastRule, /backdrop-filter:\s*none/);
    const compactToastRule = styles.match(/\.gallery-toast--compact\s*\{[\s\S]*?\}/)?.[0] || '';
    assert.match(compactToastRule, /padding:\s*9px 14px/);
    assert.match(compactToastRule, /border-radius:\s*12px/);
    assert.match(compactToastRule, /transform 200ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    assert.doesNotMatch(compactToastRule, /1\.56/);
    assert.match(script, /gallery-toast--compact/);
    assert.match(script, /1600,\s*true/);
    const promptHeaderRule = styles.match(/\.prompt-content-header\s*\{[\s\S]*?\}/)?.[0] || '';
    assert.match(promptHeaderRule, /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
    const paletteRule = styles.match(/\.prompt-image-palette\s*\{[\s\S]*?\}/)?.[0] || '';
    const headerActionsRule = styles.match(/\.prompt-header-actions\s*\{[\s\S]*?\}/)?.[0] || '';
    assert.match(paletteRule, /grid-column:\s*2/);
    assert.match(headerActionsRule, /grid-column:\s*3/);
});
