const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin studio split analytics modules share a mobile overflow guard', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_ANALYTICS_SPLIT_MOBILE_OVERFLOW_GUARD_1'),
        true,
        'split analytics mobile overflow guard should be present in the loaded page stylesheet'
    );
    assert.equal(
        adminStudioSource.includes('analyticsSplitMobile=20260428_ADMIN_STUDIO_ANALYTICS_SPLIT_MOBILE_OVERFLOW_GUARD_1'),
        true,
        'admin studio should cache-bust the split analytics mobile overflow guard'
    );
    assert.match(
        stylesSource,
        /:is\(#module-analytics, #module-business-overview, #module-growth-center, #module-commerce-center\) :is\([\s\S]*\.analytics-business-center-shell__watch-list,[\s\S]*\.analytics-overview-navigator__grid,[\s\S]*\.analytics-duty-hero,/,
        'mobile guard should cover the split business, navigator, and duty board surfaces'
    );
    assert.match(
        stylesSource,
        /\.analytics-business-center-shell__watch-list \{[\s\S]*grid-auto-flow: row !important;[\s\S]*overflow-x: hidden !important;[\s\S]*scroll-snap-type: none !important;/,
        'mobile watch lists should stack inside the card instead of clipping horizontally'
    );
    assert.match(
        stylesSource,
        /\.chart-card\.glass-panel > \.chart-header,[\s\S]*margin: calc\(var\(--admin-studio-card-pad-y, 14px\) \* -1\) calc\(var\(--admin-studio-card-pad-x, 14px\) \* -1\) 12px !important;/,
        'mobile chart titlebars should keep their full-bleed negative margins'
    );
    assert.match(
        stylesSource,
        /\.chart-card\.glass-panel > \.chart-header:has\(> \.analytics-panel-note\) \{[\s\S]*grid-template-columns: max-content minmax\(0, 1fr\) !important;[\s\S]*grid-template-rows: auto auto !important;/,
        'mobile chart headers with meta pills should reserve title width and let notes adapt to remaining space'
    );
    assert.match(
        stylesSource,
        /\.analytics-duty-hero__sample-pill,[\s\S]*\.marketing-asset-center__workflow-due,[\s\S]*white-space: normal !important;/,
        'shared mobile chips should be allowed to wrap inside their containers'
    );
});

test('admin studio split analytics titlebars keep titles on one line with adaptive meta pills', () => {
    const stylesSource = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const adminStudioSource = readRepoFile('admin-studio.html');

    assert.equal(
        stylesSource.includes('20260428_ADMIN_STUDIO_ANALYTICS_MOBILE_TITLE_NOTE_PIN_2'),
        true,
        'mobile titlebar note pinning layer should be present'
    );
    assert.equal(
        adminStudioSource.includes('analyticsTitleNote=20260428_ADMIN_STUDIO_ANALYTICS_MOBILE_TITLE_NOTE_PIN_2'),
        true,
        'admin studio should cache-bust the mobile titlebar note pinning layer'
    );
    assert.match(
        stylesSource,
        /\.analytics-business-center-shell__header,[\s\S]*\.analytics-operating-focus__header,[\s\S]*\.analytics-section-navigator__header,[\s\S]*grid-template-columns: max-content minmax\(0, 1fr\) !important;/,
        'split analytics titlebars should keep title width and reserve adaptive note space'
    );
    assert.match(
        stylesSource,
        /\.analytics-business-center-shell__copy h3,[\s\S]*\.analytics-operating-focus__copy h3,[\s\S]*white-space: nowrap !important;[\s\S]*word-break: keep-all !important;/,
        'split analytics section titles should stay on one line on mobile'
    );
    assert.match(
        stylesSource,
        /\) > \.analytics-panel-note \{[\s\S]*grid-column: 2 !important;[\s\S]*grid-row: 2 !important;[\s\S]*max-width: min\(100%, 64vw, 520px\) !important;[\s\S]*text-overflow: ellipsis !important;[\s\S]*white-space: nowrap !important;/,
        'titlebar meta pills should sit in the lower-right corner and adapt to available width'
    );
    assert.match(
        stylesSource,
        /@media \(max-width: 390px\) \{[\s\S]*\) > \.analytics-panel-note \{[\s\S]*max-width: min\(100%, 62vw, 320px\) !important;/,
        'very narrow mobile titlebar notes should shrink with viewport width instead of using a fixed tiny cap'
    );
});
