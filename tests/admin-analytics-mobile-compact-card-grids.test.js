const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('analytics compact data cards keep two mobile columns', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260429_ADMIN_STUDIO_ANALYTICS_COMPACT_DATA_MOBILE_2UP_1'),
        true,
        'analytics compact mobile data card fix should carry a unique marker'
    );
    assert.match(
        styles,
        /#geoBreakdownList,[\s\S]*#overviewBusinessMix,[\s\S]*#commerceEventFunnel,[\s\S]*#verifyStatusList,[\s\S]*#verifyEventFunnel,[\s\S]*#growthBreakdownList,[\s\S]*#growthEventFunnel[\s\S]*> \.analytics-compact-stack \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'geo, overview, verify status, event funnel, and growth compact stacks should be two-up on phones'
    );
    assert.match(
        styles,
        /\.analytics-compact-item__top \{[\s\S]*flex-direction: column !important;[\s\S]*align-items: flex-start !important;/,
        'compact card top rows should stack inside narrow two-column cards'
    );
    assert.match(
        styles,
        /\.analytics-compact-item__title,[\s\S]*\.analytics-compact-item__meta,[\s\S]*\.analytics-compact-item__summary,[\s\S]*\.analytics-compact-item__value[\s\S]*\) \{[\s\S]*overflow-wrap: anywhere !important;/,
        'compact card text should wrap safely inside two-column phone cards'
    );
    assert.equal(
        html.includes('analyticsCompactDataMobile=20260429_ADMIN_STUDIO_ANALYTICS_COMPACT_DATA_MOBILE_2UP_1'),
        true,
        'admin studio should cache-bust the analytics compact mobile data card fix'
    );
});

test('analytics distribution detail cards keep normal desktop card layout', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const panelLoaders = readRepoFile(path.join('js', 'admin-analytics-panel-loaders.js'));

    assert.equal(
        styles.includes('20260429_ADMIN_STUDIO_ANALYTICS_DISTRIBUTION_DETAIL_DESKTOP_FIX_7'),
        true,
        'analytics distribution desktop detail fix should carry a unique marker'
    );
    assert.match(
        styles,
        /#geoBreakdownList,[\s\S]*#channelBreakdownList[\s\S]*\.analytics-compact-item > \.analytics-compact-item__top,[\s\S]*\.analytics-compact-item \.analytics-compact-item__heading,[\s\S]*\.analytics-recommendation-item > \.analytics-recommendation-item__top[\s\S]*\) \{[\s\S]*margin: 0 !important;[\s\S]*padding: 0 !important;[\s\S]*background: transparent !important;/,
        'geo and channel detail card headers should opt out of the light-theme titlebar treatment'
    );
    assert.match(
        styles,
        /#geoBreakdownList, #channelBreakdownList\) \.analytics-compact-item > \.analytics-compact-item__top \{[\s\S]*display: flex !important;[\s\S]*justify-content: space-between !important;/,
        'desktop distribution compact item top rows should stay as data rows'
    );
    assert.match(
        styles,
        /#geoBreakdownList, #channelBreakdownList\) \.analytics-compact-item \{[\s\S]*flex: 0 0 auto !important;[\s\S]*overflow: hidden !important;[\s\S]*background-clip: padding-box !important;[\s\S]*border-left-width: 2px !important;[\s\S]*border-left-style: solid !important;[\s\S]*border-left-color: var\(--analytics-distribution-indicator,/,
        'geo distribution cards should color the actual left border rail so rounded corners inherit the segment color'
    );
    assert.match(
        styles,
        /#channelBreakdownList \.analytics-recommendation-item \{[\s\S]*flex: 0 0 auto !important;[\s\S]*overflow: hidden !important;[\s\S]*background-clip: padding-box !important;[\s\S]*border-left-width: 2px !important;[\s\S]*border-left-style: solid !important;[\s\S]*border-left-color: var\(--analytics-distribution-indicator,/,
        'channel distribution recommendation cards should not shrink and should color the actual left border rail'
    );
    assert.match(
        styles,
        /#geoBreakdownList, #channelBreakdownList\) :is\([\s\S]*\.analytics-compact-item,[\s\S]*\.analytics-recommendation-item[\s\S]*\)::before \{[\s\S]*content: none !important;[\s\S]*display: none !important;/,
        'distribution detail indicator strips should avoid an extra pseudo rail that makes the border look thick'
    );
    assert.match(
        panelLoaders,
        /class="analytics-compact-item analytics-geo-item" style="--analytics-distribution-indicator:\$\{escapeHtml\(color\)\};"/,
        'geo detail cards should pass the chart segment color into the left indicator'
    );
    assert.match(
        panelLoaders,
        /class="analytics-recommendation-item" style="--analytics-distribution-indicator:\$\{escapeHtml\(indicatorColor\)\};"/,
        'channel detail cards should pass the chart segment color into the left indicator'
    );
    assert.match(
        styles,
        /#channelBreakdownList \.analytics-recommendation-item__summary \{[\s\S]*display: block !important;[\s\S]*white-space: normal !important;/,
        'channel distribution recommendation summaries should remain visible on desktop'
    );
    assert.match(
        styles,
        /#geoBreakdownList \.analytics-compact-item__meta \{[\s\S]*display: block !important;[\s\S]*margin-top: 4px !important;/,
        'geo detail percentage meta should remain visible on desktop'
    );
    assert.equal(
        html.includes('analyticsDistributionDetailDesktop=20260429_ADMIN_STUDIO_ANALYTICS_DISTRIBUTION_DETAIL_DESKTOP_FIX_7'),
        true,
        'admin studio should cache-bust the analytics distribution desktop detail fix'
    );
});
