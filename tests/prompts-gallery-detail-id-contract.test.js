const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompt gallery detail opens by stable Supabase id instead of page/index id', () => {
    const source = readRepoFile('prompts-poetry.js');

    [
        'function getPromptStableOpenId(item = {})',
        'card.dataset.promptId = promptOpenId;',
        'bindPromptCardActivation(card, promptOpenId);',
        'openPromptModal(getPromptStableOpenId(prompt));',
        'openPromptModal(getPromptStableOpenId(relatedPrompt));'
    ].forEach((marker) => {
        assert.equal(source.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });

    const finderStart = source.indexOf('function findPromptForModalOpen(id)');
    assert.notEqual(finderStart, -1, 'findPromptForModalOpen should exist');

    const finderEnd = source.indexOf('function openPromptModal(id)', finderStart);
    assert.notEqual(finderEnd, -1, 'openPromptModal should follow findPromptForModalOpen');

    const finderBody = source.slice(finderStart, finderEnd);
    const supabaseMatchIndex = finderBody.indexOf("String(prompt?.supabaseId ?? prompt?.supabase_id ?? '').trim() === normalizedId");
    const localIndexMatchIndex = finderBody.indexOf("String(prompt?.id ?? '').trim() === normalizedId");

    assert.notEqual(supabaseMatchIndex, -1, 'modal lookup should match persistent Supabase ids');
    assert.notEqual(localIndexMatchIndex, -1, 'modal lookup should keep local id fallback for legacy links');
    assert.equal(
        supabaseMatchIndex < localIndexMatchIndex,
        true,
        'persistent Supabase id lookup must be attempted before local/index id fallback'
    );
});
