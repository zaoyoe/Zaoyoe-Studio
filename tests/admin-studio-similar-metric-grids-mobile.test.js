const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('similar admin studio metric grids keep two mobile columns where practical', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const marker = '20260430_ADMIN_STUDIO_SIMILAR_METRIC_GRIDS_2UP_1';
    const markerIndex = styles.indexOf(marker);

    assert.notEqual(markerIndex, -1, 'similar mobile metric grid fix should carry a unique marker');

    const block = styles.slice(markerIndex);

    assert.match(
        block,
        /@media \(min-width: 361px\) and \(max-width: 768px\)/,
        'the two-up metric grid override should avoid the smallest phone widths'
    );
    assert.equal(
        block.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;'),
        true,
        'similar metric grids should explicitly use two equal mobile columns'
    );

    [
        '#module-business-overview',
        '#module-users',
        '#module-tickets .admin-ticket-overview-grid',
        '#userModalOverlay .user-overview-grid',
        '.kpi-cards-row',
        '.analytics-duty-stats',
        '.user-overview-grid',
        '.affiliate-admin-stats',
        '.affiliate-admin-member-grid',
        '.affiliate-admin-metrics-row',
        '.affiliate-admin-reward-grid',
        '.admin-discount-history-summary-grid'
    ].forEach((selector) => {
        assert.equal(block.includes(selector), true, `${selector} should be covered by the two-up mobile grid fix`);
    });

    assert.match(
        block,
        /\.kpi-icon \{[\s\S]*width: 32px !important;[\s\S]*height: 32px !important;/,
        'KPI icons should shrink enough to fit inside two-column phone cards'
    );
    assert.match(
        block,
        /\.kpi-value \{[\s\S]*font-size: clamp\(1rem, 5\.5vw, 1\.24rem\) !important;/,
        'KPI values should use a bounded mobile size inside two-column cards'
    );
    assert.match(
        block,
        /\.kpi-value-row \{[\s\S]*flex-wrap: wrap !important;/,
        'KPI trend rows should be allowed to wrap inside narrow two-column cards'
    );
    assert.match(
        block,
        /#module-tickets :is\([\s\S]*\.admin-ticket-overview-card__eyebrow,[\s\S]*\.admin-ticket-overview-card__hint[\s\S]*\)/,
        'ticket overview card labels and hints should wrap safely in the denser grid'
    );
    assert.match(
        block,
        /admin-discount-history-summary-grid :is\(span, small\) \{[\s\S]*overflow-wrap: anywhere !important;/,
        'discount history summary text should wrap inside two-column cards'
    );
    assert.equal(
        block.includes('admin-ticket-overview-panels'),
        false,
        'larger ticket overview panels should not be forced into the compact metric grid'
    );
});
