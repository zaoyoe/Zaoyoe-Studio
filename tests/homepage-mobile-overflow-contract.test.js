const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('homepage mobile shell prevents document-level horizontal dragging', () => {
    const styles = readRepoFile('css/framer_home.css');
    const homepage = readRepoFile('index.html');

    assert.match(styles, /html\s*\{[\s\S]*overflow-x:\s*hidden;/);
    assert.match(styles, /html\s*\{[\s\S]*overscroll-behavior-x:\s*none;/);
    assert.match(styles, /body\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*hidden;/);
    assert.match(styles, /body\.home-page #main-content\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*hidden;/);
    assert.match(
        homepage,
        /css\/framer_home\.css\?v=20260502_NAV_LOGO_TAP_HIGHLIGHT_1/,
        'homepage should bust cached framer_home.css after mobile overflow fix'
    );
});
