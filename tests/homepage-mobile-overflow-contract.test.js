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
        /css\/framer_home\.css\?v=20260512_NAV_AUTH_SESSION_MATCH_1/,
        'homepage should bust cached framer_home.css after mobile overflow fix'
    );
});
