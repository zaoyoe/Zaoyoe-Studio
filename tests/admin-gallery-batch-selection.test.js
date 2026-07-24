const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminSource = fs.readFileSync(path.resolve(__dirname, '..', 'admin-studio.js'), 'utf8');

function extractFunction(name) {
    const marker = `function ${name}`;
    const start = adminSource.indexOf(marker);
    assert.notEqual(start, -1, `missing ${marker}`);
    const signatureEnd = adminSource.indexOf(') {', start);
    assert.notEqual(signatureEnd, -1, `missing body for ${marker}`);
    const bodyStart = signatureEnd + 2;
    let depth = 0;
    for (let index = bodyStart; index < adminSource.length; index += 1) {
        if (adminSource[index] === '{') depth += 1;
        if (adminSource[index] === '}') depth -= 1;
        if (depth === 0) return adminSource.slice(start, index + 1);
    }
    throw new Error(`unterminated ${marker}`);
}

function loadMediaSelectionHelpers() {
    const context = {};
    vm.runInNewContext([
        extractFunction('getPromptVideoAssetsForSelection'),
        extractFunction('promptMatchesGalleryMediaSelection'),
        'globalThis.selectionHelpers = { getPromptVideoAssetsForSelection, promptMatchesGalleryMediaSelection };'
    ].join('\n'), context);
    return context.selectionHelpers;
}

test('gallery batch media selection keeps video prompts out of the image-only group', () => {
    const { promptMatchesGalleryMediaSelection } = loadMediaSelectionHelpers();
    const videoPrompt = {
        images: ['https://cdn.example.com/poster.jpg'],
        video_assets: [{ original: 'https://cdn.example.com/clip.mp4' }]
    };
    const imagePrompt = {
        image_assets: [{ original: 'https://cdn.example.com/image.jpg' }],
        video_assets: []
    };

    assert.equal(promptMatchesGalleryMediaSelection(videoPrompt, 'video'), true);
    assert.equal(promptMatchesGalleryMediaSelection(videoPrompt, 'image'), false);
    assert.equal(promptMatchesGalleryMediaSelection(imagePrompt, 'image'), true);
    assert.equal(promptMatchesGalleryMediaSelection(imagePrompt, 'video'), false);
});

test('gallery batch media selection ignores empty or malformed media assets', () => {
    const { promptMatchesGalleryMediaSelection } = loadMediaSelectionHelpers();

    assert.equal(promptMatchesGalleryMediaSelection({
        images: [''],
        image_assets: [{}],
        video_assets: [{ url: '' }, null]
    }, 'image'), false);
    assert.equal(promptMatchesGalleryMediaSelection({
        images: ['https://cdn.example.com/image.jpg'],
        videoAssets: ['https://cdn.example.com/clip.mp4']
    }, 'video'), true);
});

test('gallery batch selection retains full off-page records for later actions', () => {
    const context = {};
    vm.runInNewContext([
        'var allPrompts = [{ id: "page-1", title: "Current page" }];',
        'var selectedPrompts = new Set();',
        'var selectedPromptRecords = new Map();',
        extractFunction('getPromptSelectionRecordById'),
        extractFunction('setPromptSelected'),
        extractFunction('getSelectedPromptsData'),
        'globalThis.selectionState = { setPromptSelected, getSelectedPromptsData };'
    ].join('\n'), context);

    context.selectionState.setPromptSelected('page-2', true, {
        id: 'page-2',
        title: 'Off-page video',
        prompt_text: 'Complete source prompt'
    });
    const selected = context.selectionState.getSelectedPromptsData();

    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 'page-2');
    assert.equal(selected[0].prompt_text, 'Complete source prompt');
});

test('gallery cross-page selection fetches every filtered page and caches full records', () => {
    for (const marker of [
        'const pageSize = 100;',
        'const listParams = getAdminGalleryListParams({ page: 1, pageSize });',
        'for (let startPage = 2; startPage <= totalPages; startPage += concurrency)',
        'matchedRows.forEach((prompt) => setPromptSelected(prompt?.id, true, prompt));',
        '.map((promptId) => getPromptSelectionRecordById(promptId))',
        "document.querySelectorAll('.admin-card.is-batch-pending')"
    ]) {
        assert.equal(adminSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }
});
