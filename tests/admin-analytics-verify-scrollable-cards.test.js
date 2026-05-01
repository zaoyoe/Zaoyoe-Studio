const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('analytics verify handoff cards keep touch scrolling enabled', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');
    const marker = '20260430_ADMIN_STUDIO_VERIFY_HANDOFF_SCROLL_CARDS_1';
    const markerIndex = styles.indexOf(marker);

    assert.notEqual(markerIndex, -1, 'verify scrollable card fix should carry a unique marker');

    const block = styles.slice(markerIndex);

    [
        '#verifyStatusList',
        '#verifyRecentList',
        '#verifyFailureList',
        '#verifyEventFunnel',
        '#verifyActionRecommendations'
    ].forEach((selector) => {
        assert.equal(block.includes(selector), true, `${selector} should be covered by the verify scroll fix`);
    });

    assert.match(
        block,
        /#verifyStatusList,[\s\S]*#verifyRecentList,[\s\S]*#verifyFailureList[\s\S]*\.chart-body\.analytics-compact-list > \.analytics-compact-stack \{[\s\S]*overflow-y: auto !important;[\s\S]*-webkit-overflow-scrolling: touch !important;/,
        'fixed-height verify compact lists should restore vertical scrolling on the stack itself'
    );
    assert.match(
        block,
        /@media \(max-width: 768px\) \{[\s\S]*#verifyActionRecommendations,[\s\S]*#verifyStatusList,[\s\S]*#verifyRecentList,[\s\S]*#verifyFailureList,[\s\S]*#verifyEventFunnel[\s\S]*max-height: min\(420px, 68vh\) !important;[\s\S]*overflow: hidden !important;/,
        'mobile verify panels should stay bounded so inner cards can be swiped through'
    );
    assert.match(
        block,
        /chart-body\.analytics-compact-list > :is\(\.analytics-compact-stack, \.analytics-recommendation-stack\) \{[\s\S]*max-height: min\(360px, 58vh\) !important;[\s\S]*overflow-y: auto !important;[\s\S]*touch-action: pan-y !important;/,
        'mobile verify stacks should own touch panning instead of clipping content'
    );
    assert.equal(
        html.includes('verifyHandoffScrollCards=20260430_ADMIN_STUDIO_VERIFY_HANDOFF_SCROLL_CARDS_1'),
        true,
        'admin studio should cache-bust the verify scrollable card fix'
    );
});
