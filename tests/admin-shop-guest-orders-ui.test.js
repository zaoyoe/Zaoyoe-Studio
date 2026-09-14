const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
const script = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');

function guestExceptionViewHtml() {
    const start = html.indexOf('id="shop-view-guest-exceptions"');
    assert.notEqual(start, -1);
    const end = html.indexOf('id="shop-view-fulfillment"', start);
    assert.notEqual(end, -1);
    return html.slice(start, end);
}

function guestOpsModalSource() {
    const start = script.indexOf('openGuestExceptionOpsModal');
    const end = script.indexOf('submitGuestExceptionWrite');
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return script.slice(start, end);
}

test('shop admin exposes a guest exception tab with an operations column', () => {
    const view = guestExceptionViewHtml();
    assert.match(html, /data-shop-tab="guest-exceptions"/);
    assert.match(view, /id="guestExceptionsTableBody"/);
    assert.match(view, /id="guestExceptionFilter"/);
    assert.match(view, /<th>操作<\/th>/);
    assert.doesNotMatch(view, /<th>定位<\/th>/);
    assert.match(script, /SHOP_TAB_IDS:\s*\[[\s\S]*?['"]guest-exceptions['"]/);
    assert.match(script, /buildAdminShopUrl\('shop\/guest-orders'/);
});

test('guest exception UI keeps secrets out of rendering and uses the existing confirm modal', () => {
    const modal = guestOpsModalSource();
    assert.doesNotMatch(script, /row\.(?:claim_secret_hash|content|raw_payload)/);
    assert.match(script, /loadGuestOrdersViaAdminApi[\s\S]*?credentials:\s*'include'/);
    assert.match(script, /scanTruncated/);
    assert.match(script, /guest-exception-copy-order/);
    assert.match(script, /guest-exception-write/);
    assert.match(script, /request_refund/);
    assert.match(script, /manual_fulfill/);
    assert.match(script, /unlock_dead_letter/);
    assert.match(script, /confirm:\s*true/);
    assert.match(modal, /shop-refund-modal/);
    assert.match(modal, /refund-btn-cancel/);
    assert.match(modal, /refund-btn-confirm/);
    assert.match(modal, /guestExceptionOpsReason/);
    assert.match(modal, /至少 8 个字/);
    assert.doesNotMatch(modal, /shop-refund-status-grid/);
    assert.doesNotMatch(modal, /Guest checkout|eyebrow/i);
    assert.doesNotMatch(script, /shop-guest-exception-readonly/);
});
