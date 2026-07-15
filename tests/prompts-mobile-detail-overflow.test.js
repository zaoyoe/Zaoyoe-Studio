const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('mobile prompt details preserve the prompt card and scroll overflowing content', () => {
    const promptsStyles = readRepoFile('prompts-poetry.css');
    const promptsSource = readRepoFile('prompts-poetry.js');
    const promptsHtml = readRepoFile('prompts.html');

    assert.match(
        promptsStyles,
        /@media \(max-width: 768px\) \{[\s\S]*?\.modal-image-col\s*\{[\s\S]*?height:\s*40%;[\s\S]*?\.modal-content-col\s*\{[\s\S]*?height:\s*60%;[\s\S]*?\.modal-inner:not\(\.comment-mode\):not\(\.related-mode\) \.modal-image-col\s*\{[\s\S]*?flex:\s*0 0 40%;[\s\S]*?\.modal-inner:not\(\.comment-mode\):not\(\.related-mode\) \.modal-content-col\s*\{[\s\S]*?flex:\s*0 0 60%;/,
        'mobile image and content columns should honor the intended 40/60 split instead of sharing flex space equally'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner:not\(\.comment-mode\):not\(\.related-mode\) \.modal-content-col\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain;/,
        'ordinary mobile prompt details should scroll when a wrapped title exceeds the available height'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner:not\(\.comment-mode\):not\(\.related-mode\) \.modal-header,[\s\S]*?\.modal-inner:not\(\.comment-mode\):not\(\.related-mode\) \.prompt-area\s*\{[\s\S]*?flex:\s*0 0 auto;/,
        'the title and prompt card should keep their intrinsic height instead of shrinking below their contents'
    );
    assert.match(
        promptsStyles,
        /\.modal-inner \.modal-image-col > \.modal-next-image\s*\{[\s\S]*?inset:\s*0 !important;[\s\S]*?top:\s*0 !important;[\s\S]*?left:\s*0 !important;[\s\S]*?transform:\s*scale\(1\);[\s\S]*?transform-origin:\s*center center !important;/,
        'the incoming mobile image should keep the same top-left geometry when it becomes the active image'
    );
    assert.equal(
        /\.modal-inner \.modal-image-col > \.modal-next-image\s*\{[^}]*translate(?:3d|X|Y)?\(/.test(promptsStyles),
        false,
        'the incoming mobile image should not animate away from percentage-based centering after the cross-fade'
    );
    assert.match(
        promptsSource,
        /const contentCol = document\.querySelector\('\.modal-content-col'\);\s*if \(contentCol\) \{\s*contentCol\.scrollTop = 0;\s*\}/,
        'opening a prompt should reset the newly scrollable content column'
    );
    assert.equal(
        promptsHtml.includes('mobileDetailOverflow=20260714_PROMPT_DETAIL_MOBILE_OVERFLOW_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for the mobile overflow fix'
    );
    assert.equal(
        promptsHtml.includes('imageSwitch=20260715_PROMPT_MODAL_IMAGE_SWITCH_STABLE_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for the stable mobile image switch'
    );
});
