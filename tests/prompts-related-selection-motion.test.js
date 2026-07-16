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

test('desktop same-style selection settles the prompt card downward with cancellable transform motion', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');
    const cancelMotionBlock = getFunctionBlock(promptsSource, 'cancelPromptAreaMotion');
    const prepareBlock = getFunctionBlock(promptsSource, 'prepareDesktopRelatedSelectionPromptArea');
    const animateBlock = getFunctionBlock(promptsSource, 'animateDesktopRelatedSelectionPromptArea');

    assert.match(cancelMotionBlock, /cancelAnimationFrame\(promptAreaMotionFrameId\)/);
    assert.match(cancelMotionBlock, /clearTimeout\(promptAreaMotionTimerId\)/);
    assert.match(prepareBlock, /promptArea\?\.classList\.contains\('docked'\)/);
    assert.match(prepareBlock, /animation:\s*'none'/);
    assert.match(prepareBlock, /transition:\s*'none'/);
    assert.equal(prepareBlock.includes('getBoundingClientRect'), false, 'the prompt card should not preserve cross-column geometry');
    assert.equal(prepareBlock.includes('style.top'), false, 'the prompt-card preparation should not animate top');

    assert.match(animateBlock, /translate3d\(0, -\$\{PROMPT_DESKTOP_RELATED_SELECTION_OFFSET_PX\}px, 0\)/);
    assert.match(animateBlock, /requestAnimationFrame\(\(\) =>/);
    assert.match(animateBlock, /transition:\s*`transform \$\{PROMPT_DESKTOP_RELATED_SELECTION_MOTION_MS\}ms cubic-bezier\(0\.16, 1, 0\.3, 1\)`/);
    assert.match(animateBlock, /transform:\s*'translate3d\(0, 0, 0\)'/);
    assert.equal(animateBlock.includes('deltaX'), false, 'the prompt card should not travel horizontally between columns');
    assert.equal(animateBlock.includes('filter'), false, 'prompt-card motion should not alter image blur');

    assert.match(
        promptsSource,
        /const shouldAnimateDesktopRelatedSelection = options\.animateRelatedSelection === true\s*&& !isPromptModalMobileLayout\(\)[\s\S]*?const desktopRelatedSelectionPromptPrepared = shouldAnimateDesktopRelatedSelection\s*\? prepareDesktopRelatedSelectionPromptArea\(promptArea\)/
    );
    assert.match(
        promptsSource,
        /promptArea\.classList\.remove\('docked'\);[\s\S]*?contentCol\.insertBefore\(promptArea, commentSection\);[\s\S]*?setPromptModalPromptContent\(promptText, item\);[\s\S]*?animateDesktopRelatedSelectionPromptArea\(promptArea, desktopRelatedSelectionPromptPrepared\);/
    );
    assert.equal(
        promptsHtml.includes('relatedSelectionMotion=20260716_PROMPT_RELATED_SELECTION_MOTION_2'),
        true,
        'the prompt script should be cache-busted for desktop related-selection motion'
    );
});
