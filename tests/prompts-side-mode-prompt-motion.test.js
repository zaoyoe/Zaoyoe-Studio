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

test('desktop comment prompt card uses symmetric horizontal-only motion', () => {
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsHtml = readRepoFile('prompts.html');
    const motionBlock = getFunctionBlock(promptsSource, 'animatePromptAreaHorizontalSettle');
    const enterBlock = getFunctionBlock(promptsSource, 'animatePromptAreaToDock');
    const returnBlock = getFunctionBlock(promptsSource, 'animatePromptAreaFromDock');

    assert.equal(promptsSource.includes('const PROMPT_DESKTOP_SIDE_MODE_PROMPT_OFFSET_PX = 24;'), true);
    assert.equal(promptsSource.includes('const PROMPT_DESKTOP_SIDE_MODE_PROMPT_MOTION_MS = 500;'), true);
    assert.match(motionBlock, /animation:\s*'none'/);
    assert.match(motionBlock, /transition:\s*'none'/);
    assert.match(motionBlock, /transform:\s*`translate3d\(\$\{offsetX\}px, 0, 0\)`/);
    assert.match(motionBlock, /void promptArea\.offsetWidth/);
    assert.match(motionBlock, /transition:\s*`transform \$\{durationMs\}ms cubic-bezier\(0\.16, 1, 0\.3, 1\)`/);
    assert.match(motionBlock, /transform:\s*'translate3d\(0, 0, 0\)'/);
    assert.equal(motionBlock.includes('delayMs'), false, 'prompt motion should not pause before accelerating');
    assert.equal(motionBlock.includes('translateY'), false, 'prompt motion should not introduce vertical travel');
    assert.equal(motionBlock.includes('scale('), false, 'prompt motion should not resize while moving');

    assert.match(enterBlock, /offsetX:\s*PROMPT_DESKTOP_SIDE_MODE_PROMPT_OFFSET_PX/);
    assert.match(enterBlock, /durationMs:\s*PROMPT_DESKTOP_SIDE_MODE_PROMPT_MOTION_MS/);
    assert.equal(enterBlock.includes('getBoundingClientRect'), false, 'enter motion should not preserve the full cross-column distance');
    assert.match(returnBlock, /offsetX:\s*-PROMPT_DESKTOP_SIDE_MODE_PROMPT_OFFSET_PX/);
    assert.match(returnBlock, /durationMs:\s*PROMPT_DESKTOP_SIDE_MODE_PROMPT_MOTION_MS/);

    assert.equal(promptsStyles.includes('@keyframes promptDockIn'), false);
    assert.equal(promptsStyles.includes('@keyframes promptReturn'), false);
    assert.equal(promptsStyles.includes('.prompt-area.returning'), false);
    assert.equal(
        /\.modal-inner\.comment-mode-returning \.prompt-area\s*\{[^}]*max-height 500ms/.test(promptsStyles),
        false
    );
    assert.equal(
        (promptsHtml.match(/promptHorizontalMotion=20260716_PROMPT_HORIZONTAL_MOTION_1/g) || []).length,
        2,
        'both prompt assets should be cache-busted for horizontal-only motion'
    );
});
