const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompt detail modal omits content tag module while AI tags still power search', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsCss = readRepoFile('prompts-poetry.css');

    const removedHtmlMarkers = [
        'id="modalContentTagsSection"',
        'id="modalContentTags"',
        'class="modal-content-tags-title"'
    ];

    for (const marker of removedHtmlMarkers) {
        assert.equal(promptsHtml.includes(marker), false, `prompts.html should not contain ${marker}`);
    }

    const sourceMarkers = [
        'const PROMPT_HOT_TAG_LIMIT = 10;',
        "const PROMPT_AI_PAIRED_TAG_FIELDS = Object.freeze(['objects', 'scenes', 'styles', 'mood']);",
        'function collectPromptAiHotTags(prompt = {})',
        'function buildPromptHotTags(prompts = [], limit = PROMPT_HOT_TAG_LIMIT)',
        'aiTags.useCase?.platform',
        'aiTags.commercial?.targetAudience',
        'getPromptDifficultyLabel(aiTags.difficulty)'
    ];

    for (const marker of sourceMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    const removedSourceMarkers = [
        'const PROMPT_MODAL_TAG_GROUP_LIMIT = 12;',
        'function buildPromptModalContentTagGroups(item = {})',
        'function renderPromptModalContentTags(item = {})',
        'renderPromptModalContentTags(item);'
    ];

    for (const marker of removedSourceMarkers) {
        assert.equal(promptsSource.includes(marker), false, `prompts-poetry.js should not contain ${marker}`);
    }

    const removedCssMarkers = [
        '.modal-content-tags',
        '.modal-content-tags-grid',
        '.modal-content-tag-group',
        '.modal-content-tag-chip'
    ];

    for (const marker of removedCssMarkers) {
        assert.equal(promptsCss.includes(marker), false, `prompts-poetry.css should not contain ${marker}`);
    }
});
