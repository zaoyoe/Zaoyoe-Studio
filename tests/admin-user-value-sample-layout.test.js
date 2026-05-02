const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('user value cockpit buyer samples render as rectangular rows', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const analyticsSource = readRepoFile(path.join('js', 'admin-analytics-panel-loaders.js'));

    assert.equal(
        styles.includes('20260430_ADMIN_STUDIO_USER_VALUE_SAMPLE_RECT_LAYOUT_1'),
        true,
        'user value sample rectangle layout should carry a unique marker'
    );
    assert.match(
        styles,
        /\.analytics-user-value-cockpit__samples \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'user value sample lists should use a stable single-column grid'
    );
    assert.match(
        styles,
        /\.analytics-user-value-cockpit__sample \{[\s\S]*display: grid !important;[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto !important;[\s\S]*border-radius: 12px !important;/,
        'user value samples should be rectangular rows with a fixed metric column'
    );
    assert.match(
        styles,
        /@media \(max-width: 640px\) \{[\s\S]*\.analytics-user-value-cockpit__sample \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'mobile user value samples should stack the metric below the user label'
    );
    assert.equal(
        analyticsSource.includes('const displayUserLabel = buildAnalyticsUserFallbackLabel(userId);'),
        true,
        'user value samples should derive a compact display label from the user id'
    );
    assert.equal(
        analyticsSource.includes('<strong>用户 ${escapeHtml(displayUserLabel)}</strong>'),
        true,
        'user value samples should label the compact id as a user'
    );
    assert.equal(
        html.includes('userValueSampleLayout=20260430_ADMIN_STUDIO_USER_VALUE_SAMPLE_RECT_LAYOUT_1'),
        true,
        'admin studio should cache-bust the user value sample rectangle layout'
    );
});

test('user value priority review cards stack safely on mobile', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const baseStyles = readRepoFile('admin-studio.css');
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260502_ADMIN_STUDIO_USER_VALUE_PRIORITY_MOBILE_STACK_1'),
        true,
        'user value priority mobile stack should carry a unique marker'
    );
    assert.match(
        baseStyles,
        /\.analytics-user-value-cockpit \.analytics-writeback-priority__list \{[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 280px\), 1fr\)\);/,
        'base user value priority cards should auto-fit instead of staying in a fixed 3-column grid'
    );
    assert.match(
        styles,
        /#module-growth-center[\s\S]*\.analytics-user-value-cockpit \.analytics-writeback-priority__list \{[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 280px\), 1fr\)\) !important;/,
        'growth center user value priority cards should inherit the adaptive grid override'
    );
    assert.match(
        styles,
        /@media \(max-width: 640px\) \{[\s\S]*\.analytics-user-value-cockpit \.analytics-writeback-priority__list \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'mobile user value priority cards should collapse to one full-width column'
    );
    assert.match(
        styles,
        /@media \(max-width: 640px\) \{[\s\S]*\.analytics-user-value-cockpit \.analytics-writeback-priority__item \{[\s\S]*width: 100% !important;[\s\S]*min-width: 0 !important;/,
        'mobile user value priority cards should keep card width inside the available rail'
    );
    assert.equal(
        html.includes('userValuePriorityMobile=20260502_ADMIN_STUDIO_USER_VALUE_PRIORITY_MOBILE_STACK_1'),
        true,
        'admin studio should cache-bust the mobile user value priority stack fix'
    );
});
