const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const promptsSource = fs.readFileSync(path.resolve(__dirname, '..', 'prompts-poetry.js'), 'utf8');
const promptsHtml = fs.readFileSync(path.resolve(__dirname, '..', 'prompts.html'), 'utf8');

test('same-style panel resets its reused scroll container before every open', () => {
    assert.match(
        promptsSource,
        /function resetRelatedPromptScrollPosition\(\) \{[\s\S]*?document\.getElementById\('relatedPromptGrid'\);[\s\S]*?relatedGrid\.scrollTop = 0;[\s\S]*?\}/,
        'the related prompt grid should expose an explicit scroll reset'
    );
    assert.match(
        promptsSource,
        /function openPromptDetailSideMode\(mode\) \{[\s\S]*?if \(isCommentMode\) \{[\s\S]*?\} else \{\s*resetRelatedPromptScrollPosition\(\);\s*renderRelatedPromptsForActiveMode\(/,
        'opening same-style mode should reset the scroll position before rendering its cards'
    );
    assert.equal(
        promptsHtml.includes('relatedScrollReset=20260716_PROMPT_RELATED_SCROLL_RESET_1'),
        true,
        'the prompt script should be cache-busted for the related scroll reset'
    );
});
