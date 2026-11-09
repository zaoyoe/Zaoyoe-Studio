const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('homepage hero hides time scale module and 5 scrollable subpage entries across all window sizes', () => {
    const criticalStyles = readRepoFile('css/framer_home_critical.css');
    const framerStyles = readRepoFile('css/framer_home.css');
    const indexSource = readRepoFile('index.html');

    // Both critical and full stylesheets hide .hero-progress and .hero-carousel unconditionally
    assert.match(
        criticalStyles,
        /\.hero-progress,\s*\.hero-carousel\s*\{[\s\S]*display:\s*none\s*!important;/,
        'critical CSS should hide .hero-progress and .hero-carousel'
    );

    assert.match(
        framerStyles,
        /\.hero-progress,\s*\.hero-carousel\s*\{[\s\S]*display:\s*none\s*!important;/,
        'full homepage CSS should hide .hero-progress and .hero-carousel'
    );

    // Verify all 5 entry cards are preserved in HTML structure
    const expectedEntries = ['prompts', 'gongyi', 'shop', 'verify', 'guestbook'];
    expectedEntries.forEach((id) => {
        assert.ok(
            indexSource.includes(`data-home-entry-id="${id}"`),
            `index.html should preserve entry card for ${id}`
        );
    });
});
