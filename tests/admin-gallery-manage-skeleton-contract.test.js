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
    const adminStudioPageCss = readRepoFile('css/admin-studio-page.css');

    const requiredJsMarkers = [
        'function setAdminGalleryLoadingChrome() {',
        "const skeleton = document.getElementById('adminManageChromeSkeleton');",
        'skeleton.remove();',
        'function getAdminGallerySkeletonCardProfile(index = 0)',
        'admin-card-title admin-card-title--skeleton admin-card-skeleton-copy',
        'admin-card-status admin-card-status--skeleton" style="width:${profile.status}px"',
        'admin-card-context-actions admin-card-context-actions--skeleton',
        'admin-card-context-btn--skeleton-primary',
        'admin-card-context-btn admin-card-context-btn--skeleton"></span>',
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
        'min-height: calc(1.28em * 2);',
        '.admin-card .admin-card-title--skeleton {',
        'flex: 1 1 auto;',
        '.admin-card--skeleton .admin-card-media {',
        'aspect-ratio: 16 / 10;',
        'margin-top: auto;',
        '.admin-card-status--skeleton::after,',
        '.admin-card-context-btn--skeleton::after {'
    ];

    for (const marker of requiredCssMarkers) {
        assert.equal(adminStudioCss.includes(marker), true, `admin-studio.css should contain ${marker}`);
    }

    const forbiddenCssMarkers = [
        '.admin-manage-chrome-skeleton',
        '.manage-toolbar--skeleton',
        '.gallery-site-context-banner--skeleton',
        '.gallery-ops-overview--skeleton',
        '.admin-card-badges--skeleton',
        '.admin-card-status--skeleton .admin-skeleton-block',
        '.admin-card-context-btn--skeleton .admin-skeleton-block'
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

    assert.equal(
        adminStudioSource.includes('admin-card-subtitle admin-card-subtitle--skeleton'),
        false,
        'gallery manage loading card skeleton should not render the removed subtitle row'
    );
    assert.equal(
        adminStudioSource.includes('admin-card-badges--skeleton'),
        false,
        'gallery manage loading card skeleton should not render badge pills over the media area'
    );
    assert.equal(
        adminStudioSource.includes('admin-card-ops-note admin-card-ops-note--skeleton'),
        false,
        'gallery manage loading card skeleton should not render a dedicated ops note row'
    );
    assert.equal(
        adminStudioSource.includes('<span class="admin-skeleton-block admin-skeleton-block--pill" style="width:${profile.status}px"></span>'),
        false,
        'gallery manage loading card status skeleton should be a single layer'
    );
    assert.equal(
        /admin-card-context-btn--skeleton[^`]*admin-skeleton-block--line/.test(adminStudioSource),
        false,
        'gallery manage loading action skeletons should not nest text bars inside button silhouettes'
    );
    assert.equal(
        adminStudioPageCss.includes('html[data-theme="light"] #module-gallery .admin-card-status--skeleton'),
        true,
        'gallery manage light theme should style the single-layer status skeleton'
    );
});
