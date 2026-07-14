const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('gallery manage keeps scrolling surfaces lightweight', () => {
    const runtime = readRepoFile('admin-studio.js');
    const sharedStyles = readRepoFile('admin-studio.css');
    const pageStyles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(runtime.includes("const ADMIN_GALLERY_IMAGE_ROOT_MARGIN = '240px 0px';"), true);
    assert.equal(runtime.includes('new IntersectionObserver((entries) => {'), true);
    assert.equal(runtime.includes('observer.observe(card);'), true);
    assert.equal(runtime.includes("badges.className = 'admin-card-badges admin-card-badges--overlay';"), false);
    assert.equal(runtime.includes("globalBadge.textContent = 'Global Asset';"), false);

    assert.match(
        sharedStyles,
        /\.hover-action-btn\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?border-radius:\s*10px;/m
    );
    assert.equal(sharedStyles.includes('.admin-card-media::after {'), false);
    assert.equal(pageStyles.includes('20260714_ADMIN_GALLERY_MANAGE_SCROLL_PERF_1'), true);
    assert.equal(pageStyles.includes('20260714_ADMIN_GALLERY_HOVER_ACTION_LINE_FIX_1'), true);
    assert.match(
        pageStyles,
        /#module-gallery #view-manage \.admin-card\s*\{[\s\S]*?contain:\s*layout style;[\s\S]*?backdrop-filter:\s*none !important;/m
    );
    assert.equal(
        (html.match(/galleryManagePerf=20260714_ADMIN_GALLERY_MANAGE_SCROLL_PERF_1/g) || []).length,
        3
    );
    assert.equal(html.includes('starry-sky.js?v=20260714_ADMIN_SCROLL_PERF_2'), true);
    assert.equal(html.includes('galleryHoverLine=20260714_ADMIN_GALLERY_HOVER_ACTION_LINE_FIX_1'), true);
});

test('shared starry sky pauses while scrolling and outside dark mode', () => {
    const runtime = readRepoFile('starry-sky.js');

    assert.equal(runtime.includes('const frameIntervalMs = 1000 / 30;'), true);
    assert.equal(
        runtime.includes("if (document.hidden || pageScrolling || document.documentElement.dataset.theme !== 'dark') return;"),
        true
    );
    assert.equal(runtime.includes('pageScrolling = true;'), true);
});
