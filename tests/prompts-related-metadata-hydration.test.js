const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function getFunctionBlock(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `${functionName} should be declared`);
    const end = source.indexOf('\nfunction ', start + 1);
    assert.notEqual(end, -1, `${functionName} should be followed by another function`);
    return source.slice(start, end);
}

test('same-style matching lazily hydrates AI tags without restoring them to first paint', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');
    const summarySelect = promptsSource.match(/const PROMPTS_SUPABASE_SUMMARY_SELECT = \[([\s\S]*?)\]\.join\(','\);/)?.[1] || '';
    const metadataHydration = getFunctionBlock(promptsSource, 'hydratePromptRelatedMetadata');
    const scheduledRender = getFunctionBlock(promptsSource, 'scheduleRelatedPromptsRender');
    const warmupRender = getFunctionBlock(promptsSource, 'warmRelatedPromptsForModal');
    const detailMerge = getFunctionBlock(promptsSource, 'mergePromptDetailIntoItem');

    assert.equal(summarySelect.includes("'ai_tags'"), false, 'first paint should keep deferring AI tags');
    assert.match(
        promptsSource,
        /const PROMPTS_SUPABASE_RELATED_METADATA_SELECT = \[\s*'id',\s*'ai_tags'\s*\]\.join\(','\);/,
        'same-style metadata should use a compact dedicated projection'
    );
    assert.match(metadataHydration, /fetchPromptRelatedMetadataRows\(batchIds\)/);
    assert.match(metadataHydration, /item\.aiTags = aiTags;/);
    assert.match(metadataHydration, /invalidatePromptRelatedProfile\(item\);/);
    assert.match(detailMerge, /invalidatePromptRelatedProfile\(item\);/);
    assert.match(scheduledRender, /await preparePromptRelatedMatchingData\(item\);/);
    assert.match(warmupRender, /await preparePromptRelatedMatchingData\(item\);/);
    assert.match(promptsSource, /return `\$\{promptId\}:\$\{detailState\}:\$\{promptRelatedMetadataRevision\}`;/);
    assert.equal(
        (promptsHtml.match(/relatedMetadata=20260730_PROMPT_RELATED_METADATA_LAZY_1/g) || []).length,
        2,
        'the prompt runtime and stylesheet should both cache-bust the lazy metadata fix'
    );
});
