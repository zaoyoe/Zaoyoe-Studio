const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompt detail modal renders full AI content tag groups', () => {
    const promptsHtml = readRepoFile('prompts.html');
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsCss = readRepoFile('prompts-poetry.css');

    const htmlMarkers = [
        'id="modalContentTagsSection"',
        'id="modalContentTags"',
        'class="modal-content-tags-title"'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(promptsHtml.includes(marker), true, `prompts.html should contain ${marker}`);
    }

    const sourceMarkers = [
        'const PROMPT_MODAL_TAG_GROUP_LIMIT = 12;',
        'const PROMPT_HOT_TAG_LIMIT = 10;',
        "const PROMPT_AI_PAIRED_TAG_FIELDS = Object.freeze(['objects', 'scenes', 'styles', 'mood']);",
        'function buildPromptModalContentTagGroups(item = {})',
        'function renderPromptModalContentTags(item = {})',
        'function collectPromptAiHotTags(prompt = {})',
        'function buildPromptHotTags(prompts = [], limit = PROMPT_HOT_TAG_LIMIT)',
        'renderPromptModalContentTags(item);',
        'aiTags.useCase?.platform',
        'aiTags.commercial?.targetAudience',
        'getPromptDifficultyLabel(aiTags.difficulty)'
    ];

    for (const marker of sourceMarkers) {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }

    const cssMarkers = [
        '.modal-content-tags',
        '.modal-content-tags-grid',
        '.modal-content-tag-group',
        '.modal-content-tag-chip'
    ];

    for (const marker of cssMarkers) {
        assert.equal(promptsCss.includes(marker), true, `prompts-poetry.css should contain ${marker}`);
    }
});
