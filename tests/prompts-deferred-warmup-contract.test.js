const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const promptsSource = fs.readFileSync(path.resolve(__dirname, '..', 'prompts-poetry.js'), 'utf8');
const promptsHtml = fs.readFileSync(path.resolve(__dirname, '..', 'prompts.html'), 'utf8');

test('prompt deferred warmups yield between small work chunks', () => {
    [
        'const PROMPT_IDLE_CHUNK_BUDGET_MS = 8;',
        'const PROMPT_SEARCH_INDEX_CHUNK_SIZE = 6;',
        'const PROMPT_RELATED_PROFILE_CHUNK_SIZE = 2;',
        'function waitForPromptIdleChunk(timeoutMs = 120) {',
        'window.requestIdleCallback(resolve, { timeout: timeoutMs });',
        'function buildSearchIndexIncrementally() {',
        'async function warmPromptRelatedProfiles() {'
    ].forEach((marker) => {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });

    assert.match(
        promptsSource,
        /async function warmPromptRelatedProfiles\(\)\s*\{[\s\S]*?await warmPromptSearchIndex\(\);[\s\S]*?await waitForPromptIdleChunk\(\);[\s\S]*?PROMPT_RELATED_PROFILE_CHUNK_SIZE/,
        'related profile warmup should run after search warmup and yield between bounded chunks'
    );
    assert.match(
        promptsSource,
        /function buildSearchIndexIncrementally\(\)\s*\{[\s\S]*?await waitForPromptIdleChunk\(\);[\s\S]*?PROMPT_SEARCH_INDEX_CHUNK_SIZE[\s\S]*?SEARCH_INDEX = nextIndex;/,
        'search warmup should build privately in chunks and publish the complete index atomically'
    );
    assert.match(
        promptsSource,
        /async function filterBySearch\(query\)\s*\{[\s\S]*?await warmPromptSearchIndex\(\);[\s\S]*?if \(!isPromptSearchRequestCurrent\(searchRequestId, normalizedQuery\)\)/,
        'interactive search should await the chunked index without falling back to a blocking synchronous build'
    );
    assert.equal(
        (promptsHtml.match(/deferredWarmup=20260719_PROMPTS_DEFERRED_WARMUP_CHUNKED_1/g) || []).length,
        1,
        'prompts.html should cache-bust the chunked deferred warmup runtime'
    );
});
