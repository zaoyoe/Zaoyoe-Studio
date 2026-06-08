const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readCssRule(styles, selector) {
    const start = styles.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `missing CSS rule for ${selector}`);
    const bodyStart = styles.indexOf('{', start);
    const bodyEnd = styles.indexOf('}', bodyStart);
    assert.notEqual(bodyStart, -1, `missing opening brace for ${selector}`);
    assert.notEqual(bodyEnd, -1, `missing closing brace for ${selector}`);
    return styles.slice(bodyStart + 1, bodyEnd);
}

test('homepage mobile shell prevents document-level horizontal dragging', () => {
    const styles = readRepoFile('css/framer_home.css');
    const homepage = readRepoFile('index.html');
    const htmlRule = readCssRule(styles, 'html');
    const bodyRule = readCssRule(styles, 'body');
    const mainContentRule = readCssRule(styles, 'body.home-page #main-content');

    assert.match(htmlRule, /overflow-x:\s*hidden;/);
    assert.match(htmlRule, /overscroll-behavior-x:\s*none;/);
    assert.match(bodyRule, /max-width:\s*100%;/);
    assert.match(bodyRule, /overflow-x:\s*hidden;/);
    assert.match(mainContentRule, /max-width:\s*100%;/);
    assert.match(mainContentRule, /overflow-x:\s*hidden;/);
    assert.match(
        homepage,
        /css\/framer_home\.css\?v=20260608_SITE_ENTRY_ICONS_1/,
        'homepage should bust cached framer_home.css after mobile overflow fix'
    );
});

test('homepage prompt mask keeps mobile labels and CTA centered in the viewport', () => {
    const styles = readRepoFile('css/framer_home.css');

    assert.equal(
        styles.includes('20260513_HOME_PROMPT_MASK_CENTER_1'),
        true,
        'homepage prompt mask should carry a dated mobile centering guard'
    );
    assert.match(
        styles,
        /@media \(max-width: 768px\)\s*\{[\s\S]*\.mask-labels-container\s*\{[\s\S]*width:\s*min\(100%, calc\(100vw - 32px\)\);[\s\S]*max-width:\s*calc\(100vw - 32px\);[\s\S]*box-sizing:\s*border-box;[\s\S]*margin-inline:\s*auto;[\s\S]*\.mask-labels-row\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*justify-content:\s*center;[\s\S]*gap:\s*clamp\(12px, 4vw, 24px\);/,
        'mobile prompt mask should center the CTA against a viewport-width label container'
    );
    assert.match(
        styles,
        /@media \(max-width: 480px\)\s*\{[\s\S]*\.mask-labels-container\s*\{[\s\S]*width:\s*min\(100%, calc\(100vw - 24px\)\);[\s\S]*max-width:\s*calc\(100vw - 24px\);[\s\S]*\.mask-labels-row\s*\{[\s\S]*gap:\s*clamp\(10px, 3\.5vw, 18px\);/,
        'small mobile prompt mask should keep narrow viewport labels centered without using the over-wide masonry track'
    );
});
