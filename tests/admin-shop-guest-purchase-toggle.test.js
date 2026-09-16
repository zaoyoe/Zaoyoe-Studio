const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('admin product editor exposes a guest purchase toggle in the existing settings style', () => {
    const html = readRepoFile('admin-studio.html');
    const css = readRepoFile('css/admin-studio-page.css');
    const start = html.indexOf('id="prodAllowGuestPurchase"');
    const notesStart = html.indexOf('id="prodShowPurchaseNotes"');
    assert.notEqual(start, -1);
    assert.notEqual(notesStart, -1);
    assert.equal(start < notesStart, true, 'guest purchase toggle should sit with delivery settings before purchase notes');

    const section = html.slice(html.lastIndexOf('<div class="modern-form-group">', start), notesStart);
    assert.match(section, /允许游客购买/);
    assert.match(section, /toggle-switch/);
    assert.match(section, /id="guestPurchaseWrapper"/);
    assert.doesNotMatch(section, /id="prodGuestCashPriceCny"/);
    assert.doesNotMatch(section, /id="prodGuestCashPriceIntl"/);
    assert.match(section, /id="prodGuestChannelZpay"/);
    assert.match(section, /id="prodGuestChannelNowpayments"/);
    assert.match(section, /ZPay（人民币）/);
    assert.match(section, /NOWPayments USDT-BEP20/);
    assert.match(section, /shop-product-sku-row__toggle/);
    assert.match(section, /form-hint/);
    assert.doesNotMatch(section, /eyebrow|Guest checkout|cta-primary/i);
    assert.match(css, /\.shop-guest-purchase-settings/);
    assert.match(css, /\.shop-guest-purchase-channels/);
});

test('admin product editor saves guest purchase only on the product payload', () => {
    const adminSource = readRepoFile('js/admin-shop.js');
    const mutateSource = readRepoFile('server/api-handlers/admin/shop/mutate.js');
    const productsSource = readRepoFile('server/api-handlers/admin/shop/products.js');

    assert.match(
        adminSource,
        /collectGuestPurchasePayload: function[\s\S]*allow_guest_purchase:[\s\S]*guest_cash_price_cny:[\s\S]*guest_payment_channels:/,
        'the product modal should serialize guest purchase settings from the existing form controls'
    );
    assert.match(
        adminSource,
        /getGuestPurchaseFormError: function[\s\S]*游客购买仅支持卡密自动发货[\s\S]*游客购买不支持人工发货/,
        'the product modal should block API and manual-delivery guest purchase locally'
    );
    assert.match(
        adminSource,
        /\.\.\.guestPurchasePayload/,
        'saving the product should include the guest purchase payload'
    );
    assert.match(
        adminSource,
        /collectProductSkuEditorRows: function[\s\S]*manual_delivery: read\('manual_delivery'\)\?\.checked === true[\s\S]*sort_order: index/,
        'SKU editor rows should not serialize guest purchase fields'
    );
    assert.doesNotMatch(
        adminSource.slice(
            adminSource.indexOf('collectProductSkuEditorRows: function'),
            adminSource.indexOf('collectProductSkuEditorRows: function') + 1800
        ),
        /allow_guest_purchase/
    );
    assert.match(
        mutateSource,
        /PRODUCT_SCHEMA_COMPATIBILITY_FIELDS[\s\S]*allow_guest_purchase[\s\S]*guest_cash_price_cny[\s\S]*guest_payment_channels/,
        'admin mutations should treat guest purchase columns as optional schema fields'
    );
    assert.match(
        mutateSource,
        /allow_guest_purchase: savedProduct\.allow_guest_purchase === true/,
        'admin mutations should audit the guest purchase switch'
    );
    assert.match(
        mutateSource,
        /const basePayload = \{[\s\S]*manual_delivery: draft\.manual_delivery === true[\s\S]*sort_order: draft\.sort_order\n        \}/,
        'SKU upsert payload should keep excluding guest purchase fields'
    );
    assert.doesNotMatch(
        mutateSource.slice(
            mutateSource.indexOf('const basePayload = {'),
            mutateSource.indexOf('const basePayload = {') + 700
        ),
        /allow_guest_purchase|guest_cash_price|guest_payment_channels/
    );
    assert.match(
        productsSource,
        /getFullSelectAttempts[\s\S]*allow_guest_purchase[\s\S]*guest_cash_price_cny[\s\S]*guest_payment_channels/,
        'admin product reads should include guest purchase fields in the explicit fallback select'
    );
});
