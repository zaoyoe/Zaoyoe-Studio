const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function readCssRuleBlock(source, selector) {
    const start = source.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `admin-studio.css should contain ${selector}`);
    const end = source.indexOf('\n}', start);
    assert.notEqual(end, -1, `admin-studio.css should close ${selector}`);
    return source.slice(start, end);
}

test('gallery manage loading keeps top chrome live and limits skeletons to cards', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminStudioCss = readRepoFile('admin-studio.css');

    const requiredJsMarkers = [
        'function setAdminGalleryLoadingChrome() {',
        "const skeleton = document.getElementById('adminManageChromeSkeleton');",
        'skeleton.remove();',
        'function getAdminGallerySkeletonCardProfile(index = 0)',
        'admin-card-title admin-card-title--skeleton admin-card-skeleton-copy',
        'admin-card-context-actions admin-card-context-actions--skeleton',
        'admin-card-context-btn--skeleton-primary',
        "opsNote.classList.add('admin-card-ops-note--placeholder');"
    ];

    for (const marker of requiredJsMarkers) {
        assert.equal(adminStudioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    const forbiddenJsMarkers = [
        'function ensureAdminGalleryLoadingChromeElement()',
        'function buildAdminGalleryToolbarSkeletonSelect',
        'gallery-site-context-banner--skeleton',
        'manage-toolbar--skeleton',
        'setAdminGalleryLoadingChrome(true);'
    ];

    for (const marker of forbiddenJsMarkers) {
        assert.equal(adminStudioSource.includes(marker), false, `admin-studio.js should not contain ${marker}`);
    }

    const requiredCssMarkers = [
        '.admin-card-skeleton-copy',
        '.admin-card-context-actions--skeleton',
        '.admin-card-context-btn--skeleton-primary',
        '.admin-card-title--skeleton {',
        'min-height: calc(1.35em * 2);',
        '.admin-card-subtitle--skeleton {',
        'min-height: calc(1.6em * 2);'
    ];

    for (const marker of requiredCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const forbiddenCssMarkers = [
        '.admin-manage-chrome-skeleton',
        '.manage-toolbar--skeleton',
        '.gallery-site-context-banner--skeleton',
        '.gallery-ops-overview--skeleton'
    ];

    for (const marker of forbiddenCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), false, `admin-studio.css should not contain ${marker}`);
    }

    const mediaSkeletonBlock = readCssRuleBlock(adminStudioCss, '.admin-card-media-skeleton');
    assert.equal(
        mediaSkeletonBlock.includes('background: #1f2941;'),
        true,
        'gallery manage card media skeleton should use a solid color background'
    );
    assert.equal(
        /(?:linear|radial)-gradient/.test(mediaSkeletonBlock),
        false,
        'gallery manage card media skeleton background should not use gradients'
    );
});
