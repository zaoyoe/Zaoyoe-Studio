const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('prompt gallery exposes image and video media filters with image selected by default', () => {
    const html = read('prompts.html');
    const runtime = read('prompts-poetry.js');
    const styles = read('prompts-poetry.css');
    const en = JSON.parse(read('lang/en.json'));
    const zh = JSON.parse(read('lang/zh.json'));

    assert.match(html, /class="prompt-media-filter" role="group"/);
    assert.match(html, /class="prompt-sort-filter" role="group"/);
    for (const filter of ['image', 'video']) {
        assert.match(html, new RegExp(`data-media-filter="${filter}"`));
    }
    assert.doesNotMatch(html, /data-media-filter="all"/);
    assert.match(html, /class="prompt-media-filter__button is-active"[^>]*data-media-filter="image"[^>]*aria-pressed="true"/);
    assert.match(runtime, /let currentPromptMediaFilter = 'image';/);
    assert.match(runtime, /function promptMatchesMediaFilter/);
    assert.match(runtime, /const hasVideo = getPromptVideoAssets\(item\)\.length > 0;/);
    assert.match(runtime, /return !hasVideo && getPromptImageAssets\(item\)\.length > 0;/);
    assert.match(runtime, /allFilteredItems = applyPromptGalleryFiltersAndSort\(\);/);
    assert.match(
        runtime,
        /function setPromptMediaFilter[\s\S]*?renderCurrentPage\(\{ preserveScroll: true \}\);/
    );
    assert.match(runtime, /function setupPromptMediaFilters/);
    assert.match(styles, /\.prompt-media-filter-bar\s*\{[\s\S]*?max-width:\s*1600px;[\s\S]*?padding:\s*0 10px 8px;/);
    assert.match(styles, /\.prompt-media-filter-bar\s*\{[\s\S]*?justify-content:\s*space-between;/);
    assert.equal(en.gallery.mediaAll, undefined);
    assert.equal(en.gallery.mediaImage, 'Images');
    assert.equal(en.gallery.mediaVideo, 'Videos');
    assert.equal(en.gallery.sortRandom, 'Random');
    assert.equal(en.gallery.sortHot, 'Popular');
    assert.equal(zh.gallery.mediaAll, undefined);
    assert.equal(zh.gallery.mediaImage, '图片');
    assert.equal(zh.gallery.mediaVideo, '视频');
    assert.equal(zh.gallery.sortRandom, '随机');
    assert.equal(zh.gallery.sortHot, '热度');
});
