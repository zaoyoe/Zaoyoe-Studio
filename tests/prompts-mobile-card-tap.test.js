const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts mobile cards open detail on first tap while desktop keeps hover affordances', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsHtml = readRepoFile('prompts.html');

    [
        'const PROMPT_CARD_TOUCH_TAP_MAX_DISTANCE = 10;',
        'const PROMPT_CARD_TOUCH_CLICK_SUPPRESS_MS = 700;',
        'function bindPromptCardActivation(card, promptId) {',
        'String(event?.pointerType || \'\') === \'touch\'',
        'isPromptCardInteractiveTarget(event.target)',
        'suppressPromptCardFollowupClick(card);',
        'openPromptModal(promptId);',
        'bindPromptCardActivation(card, item.id);'
    ].forEach((marker) => {
        assert.equal(promptsSource.includes(marker), true, `prompts-poetry.js should include ${marker}`);
    });

    assert.match(
        promptsSource,
        /card\.addEventListener\('pointerup', \(event\) => \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*suppressPromptCardFollowupClick\(card\);[\s\S]*openPromptModal\(promptId\);/,
        'touch pointerup should open the prompt detail immediately and suppress the follow-up click'
    );

    const hoverMediaStart = promptsStyles.indexOf('@media (hover: hover) and (pointer: fine) {');
    assert.notEqual(hoverMediaStart, -1, 'prompt card hover rules should be scoped to fine-pointer devices');

    const beforeHoverMedia = promptsStyles.slice(0, hoverMediaStart);
    const hoverMediaBlock = promptsStyles.slice(hoverMediaStart, promptsStyles.indexOf('/* --- Modal --- */', hoverMediaStart));

    assert.equal(
        beforeHoverMedia.includes('.prompt-card:hover .card-overlay'),
        false,
        'mobile cards should not reveal title overlay through the base hover rule before click'
    );
    assert.equal(
        beforeHoverMedia.includes('.prompt-card:hover {'),
        false,
        'mobile cards should not enter the desktop hover lift before click'
    );
    assert.equal(
        hoverMediaBlock.includes('.prompt-card:hover .card-overlay'),
        true,
        'desktop hover should still reveal the card title overlay'
    );
    assert.equal(
        hoverMediaBlock.includes('.prompt-card:hover {'),
        true,
        'desktop hover should still keep the existing card lift behavior'
    );
    assert.match(
        promptsStyles,
        /\.prompt-card\s*\{[\s\S]*-webkit-tap-highlight-color: transparent;[\s\S]*touch-action: manipulation;/
    );
    assert.match(
        promptsStyles,
        /\.card-fav-btn\s*\{[\s\S]*pointer-events: none;/
    );
    assert.match(
        hoverMediaBlock,
        /\.prompt-card:hover \.card-fav-btn\s*\{[\s\S]*pointer-events: auto;/
    );

    assert.equal(
        (promptsHtml.match(/mobileCardTap=20260614_PROMPTS_MOBILE_CARD_SINGLE_TAP_1/g) || []).length,
        2,
        'prompts.html should cache-bust both the card tap CSS and runtime changes'
    );
});
