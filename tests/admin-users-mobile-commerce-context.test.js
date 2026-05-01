const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('user detail commerce context keeps a stable mobile card layout', () => {
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const html = readRepoFile('admin-studio.html');

    assert.equal(
        styles.includes('20260430_ADMIN_STUDIO_USER_COMMERCE_CONTEXT_MOBILE_LAYOUT_1'),
        true,
        'user commerce context mobile layout should carry a unique marker'
    );
    assert.match(
        styles,
        /#userModalOverlay #userModal\.user-modal \.user-analytics-context\.info-block \{[\s\S]*width: 100% !important;[\s\S]*min-width: 0 !important;[\s\S]*padding: 14px !important;[\s\S]*overflow: hidden !important;/,
        'mobile user commerce context should be a contained full-width card'
    );
    assert.match(
        styles,
        /#userModalOverlay #userModal\.user-modal \.user-analytics-context__header,[\s\S]*#userModalOverlay #userModal\.user-modal \.users-commerce-trace__header \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
        'mobile commerce context headers should stack title and source instead of squeezing them into one row'
    );
    assert.match(
        styles,
        /#userModalOverlay #userModal\.user-modal :is\(\.user-analytics-context__chips, \.users-commerce-trace__chips\) \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
        'mobile commerce context chips should use a stable two-column grid'
    );
    assert.match(
        styles,
        /#userModalOverlay #userModal\.user-modal \.user-analytics-context__chips > \.user-analytics-context__chip:first-child,[\s\S]*grid-column: 1 \/ -1 !important;/,
        'mobile commerce context should let the primary signal chip span the full row'
    );
    assert.match(
        styles,
        /#userModalOverlay #userModal\.user-modal :is\(\.user-analytics-context__actions, \.users-commerce-trace__actions\):has\(> :nth-child\(3\)\) > :first-child \{[\s\S]*grid-column: 1 \/ -1 !important;/,
        'mobile commerce context should put the primary action above the two secondary actions'
    );
    assert.match(
        styles,
        /#userModalOverlay #userModal\.user-modal :is\(\.user-analytics-context__action, \.users-commerce-trace__action\) \{[\s\S]*height: auto !important;[\s\S]*min-height: 44px !important;[\s\S]*white-space: normal !important;/,
        'mobile commerce context actions should grow vertically instead of clipping wrapped labels'
    );
    assert.equal(
        html.includes('userCommerceContextMobile=20260430_ADMIN_STUDIO_USER_COMMERCE_CONTEXT_MOBILE_LAYOUT_1'),
        true,
        'admin studio should cache-bust the user commerce context mobile layout fix'
    );
});
