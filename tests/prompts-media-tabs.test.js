const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const mediaTabs = require('../js/prompt-media-tabs');

function readRepoFile(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('prompt media tabs split image and video prompts into independent variants', () => {
    const prompt = [
        '[IMAGE · 1]',
        'Create a cinematic still of a cyclist on a quiet residential street.',
        '',
        '[VIDEO · 2]',
        'Track backward while the cyclist moves through soft natural light.'
    ].join('\n');
    const result = mediaTabs.buildPromptMediaVariants(prompt, '');

    assert.deepEqual(result.variants.map((variant) => variant.type), ['image', 'video']);
    assert.equal(result.variants[0].text, 'Create a cinematic still of a cyclist on a quiet residential street.');
    assert.equal(result.variants[1].text, 'Track backward while the cyclist moves through soft natural light.');
});

test('prompt media tabs fall back to canonical source sections when translation loses headers', () => {
    const sourcePrompt = '[IMAGE · 1]\nImage source prompt.\n\n[VIDEO · 2]\nVideo source prompt.';
    const result = mediaTabs.buildPromptMediaVariants('合并后丢失分段的翻译文本', sourcePrompt);

    assert.deepEqual(result.variants.map((variant) => variant.text), [
        'Image source prompt.',
        'Video source prompt.'
    ]);
});

test('prompt media tabs fall back when a localized prompt is only a short summary', () => {
    const sourcePrompt = `[IMAGE · 1]\n${'Detailed image instruction. '.repeat(20)}\n[VIDEO · 2]\n${'Detailed video instruction. '.repeat(20)}`;
    const localizedPrompt = '[IMAGE · 1]\n简短图片摘要。\n[VIDEO · 2]\n简短视频摘要。';

    assert.equal(mediaTabs.shouldUseFallbackPromptText(localizedPrompt, sourcePrompt), true);
    const result = mediaTabs.buildPromptMediaVariants(localizedPrompt, sourcePrompt);
    assert.match(result.variants.find((variant) => variant.type === 'image').text, /Detailed image instruction/);
    assert.match(result.variants.find((variant) => variant.type === 'video').text, /Detailed video instruction/);
});

test('prompt media tabs preserve numbered headers when one media type has multiple prompts', () => {
    const prompt = '[IMAGE · 1]\nFirst image prompt.\n\n[IMAGE · 2]\nSecond image prompt.\n\n[VIDEO · 3]\nVideo prompt.';
    const result = mediaTabs.buildPromptMediaVariants(prompt, '');

    assert.equal(result.variants[0].text, '[IMAGE · 1]\nFirst image prompt.\n\n[IMAGE · 2]\nSecond image prompt.');
    assert.equal(result.variants[1].text, 'Video prompt.');
});

test('prompt detail modal wires accessible media tabs before the prompt text', () => {
    const html = readRepoFile('prompts.html');
    const runtime = readRepoFile('prompts-poetry.js');
    const styles = readRepoFile('prompts-poetry.css');
    const worker = readRepoFile('server/workers/prompt-import-runtime.js');

    assert.match(html, /id="promptMediaTabs"[^>]*role="tablist"[\s\S]*data-prompt-media-type="image"[^>]*aria-controls="modalPromptText"[\s\S]*data-prompt-media-type="video"[^>]*aria-controls="modalPromptText"[\s\S]*id="modalPromptText"/);
    assert.ok(html.indexOf('prompt-media-tabs.js') < html.indexOf('prompts-poetry.js'));
    assert.match(runtime, /function selectPromptMediaType/);
    assert.match(runtime, /currentPromptMediaVariants\.length === 1/);
    assert.match(runtime, /defaultLabel\.textContent = getPromptMediaTabLabel\(onlyVariant\.type\)/);
    assert.match(runtime, /setPromptDetailTextState\(promptText, variant\.text\)/);
    assert.match(runtime, /button\.onkeydown = \(event\) => handlePromptMediaTabKeydown/);
    assert.match(runtime, /shouldUseFallbackPromptText\?\.\(item\[localizedKey\], canonicalValue\)/);
    assert.match(runtime, /document\.getElementById\('modalPromptText'\)\.textContent/);
    assert.match(styles, /\.prompt-media-tab\[aria-selected="true"\]/);
    assert.match(styles, /\.prompt-label\[hidden\]\s*{\s*display:\s*none/);
    assert.match(styles, /white-space:\s*pre-wrap/);
    assert.match(worker, /MUST preserve every header exactly and in the same order/);
    assert.match(html, /mediaPromptTabs=20260723_PROMPT_MEDIA_TABS_3/);
    assert.match(html, /js\/i18n\.js\?v=20260730_PROMPT_SOURCE_POST_LABEL_1/);
});
