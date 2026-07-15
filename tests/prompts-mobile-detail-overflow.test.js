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
        promptsSource,
        /const contentCol = document\.querySelector\('\.modal-content-col'\);\s*if \(contentCol\) \{\s*contentCol\.scrollTop = 0;\s*\}/,
        'opening a prompt should reset the newly scrollable content column'
    );
    assert.equal(
        promptsHtml.includes('mobileDetailOverflow=20260714_PROMPT_DETAIL_MOBILE_OVERFLOW_1'),
        true,
        'the prompt detail stylesheet should be cache-busted for the mobile overflow fix'
    );
});
