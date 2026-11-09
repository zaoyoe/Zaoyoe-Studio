const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('sitewide label-input (LBI) parity: shop modal, guest orders, verify page, and profile modal', () => {
    const labelInputJs = readRepoFile(path.join('js', 'label-input.js'));
    const labelInputCss = readRepoFile(path.join('css', 'label-input.css'));
    const shopPageCss = readRepoFile(path.join('css', 'shop-page.css'));
    const guestOrdersCss = readRepoFile(path.join('css', 'guest-orders.css'));
    const verifyWidgetCss = readRepoFile('verify-widget.css');
    const verifyPageCss = readRepoFile(path.join('css', 'verify-page.css'));

    // 1. Theme variables parity with login modal
    assert.ok(
        labelInputCss.includes('--lbi-border-focus: rgba(15, 23, 42, 0.45);'),
        'light theme must define graphite dark grey focus border rgba(15, 23, 42, 0.45)'
    );
    assert.ok(
        labelInputCss.includes('--lbi-border-focus: rgba(255, 255, 255, 0.42);'),
        'dark theme must define soft white focus border rgba(255, 255, 255, 0.42)'
    );

    // 2. js/label-input.js contracts
    assert.ok(
        labelInputJs.includes("input.setAttribute('data-lbi-placeholder', input.placeholder);"),
        'js/label-input.js must store native placeholder in data-lbi-placeholder'
    );
    assert.ok(
        labelInputJs.includes("input.removeAttribute('placeholder');"),
        'js/label-input.js must strip native placeholder to prevent text overlap'
    );
    assert.ok(
        labelInputJs.includes("input.closest('.guest-orders-field, .guest-shop-modal__field, .verify-form-field, .guest-orders-ticket-field, label');"),
        'js/label-input.js enhanceInput must tag closest field container with lbi-hide-external-label'
    );

    // 3. Shop page CSS contracts
    assert.ok(
        shopPageCss.includes('.guest-shop-modal__field input:not(.lbi-field)'),
        'shop page CSS must exempt .lbi-field from legacy solid background rule'
    );
    assert.ok(
        shopPageCss.includes('.guest-shop-modal__field input:not(.lbi-field):focus'),
        'shop page CSS must exempt .lbi-field from legacy blue focus border'
    );
    assert.ok(
        shopPageCss.includes('.guest-shop-modal__field input:not(.lbi-field)::placeholder'),
        'shop page CSS must exempt .lbi-field from visible placeholder rule'
    );
    assert.ok(
        shopPageCss.includes('#purchaseDiscountCode.shop-purchase-discount__input:not(.lbi-field)::placeholder'),
        'shop purchase modal discount input must exempt .lbi-field from visible placeholder'
    );

    // 4. Guest orders page CSS contracts
    assert.ok(
        guestOrdersCss.includes('.guest-orders-field input:not(.lbi-field)'),
        'guest orders CSS must exempt .lbi-field from legacy border and background'
    );
    assert.ok(
        guestOrdersCss.includes('.guest-orders-field input:not(.lbi-field)::placeholder'),
        'guest orders CSS must exempt .lbi-field from legacy placeholder styling'
    );
    assert.ok(
        guestOrdersCss.includes('.guest-orders-field input:not(.lbi-field):focus'),
        'guest orders CSS must exempt .lbi-field from legacy blue focus border'
    );
    assert.ok(
        guestOrdersCss.includes('input#ticketModalEmail:not(.lbi-field):focus'),
        'guest orders ticket modal email must exempt .lbi-field from native focus border'
    );

    // 5. Verify widget and page CSS contracts
    assert.ok(
        verifyWidgetCss.includes('input.verify-input:not(.lbi-field):focus'),
        'verify-widget.css must exempt .lbi-field from legacy blue focus border and glow shadow'
    );
    assert.ok(
        verifyWidgetCss.includes('.verify-input:not(.lbi-field)::placeholder'),
        'verify-widget.css must exempt .lbi-field from legacy visible placeholder'
    );
    assert.ok(
        verifyPageCss.includes('input.verify-input:not(.lbi-field):focus'),
        'css/verify-page.css must exempt .lbi-field from dark mode focus border and glow shadow'
    );
    assert.ok(
        verifyPageCss.includes('.verify-input:not(.lbi-field)::placeholder'),
        'css/verify-page.css must exempt .lbi-field from dark mode visible placeholder'
    );

    // 6. Universal label-input.css overrides
    assert.ok(
        labelInputCss.includes('.guest-shop-modal__field .lbi-box input') &&
        labelInputCss.includes('.guest-orders-field .lbi-box input') &&
        labelInputCss.includes('.verify-widget .lbi-box input'),
        'css/label-input.css must provide explicit overrides for shop modal, guest orders, and verify widget'
    );
    assert.ok(
        labelInputCss.includes('background: transparent !important;') &&
        labelInputCss.includes('border: none !important;') &&
        labelInputCss.includes('box-shadow: none !important;'),
        'css/label-input.css must guarantee transparent background, no border, and no box-shadow'
    );

    // 7. Verify batch task textarea placeholder light-mode adaptation
    assert.ok(
        verifyPageCss.includes('.verify-widget .verify-batch-textarea:not(.lbi-field)::placeholder'),
        'css/verify-page.css must provide explicit light mode batch textarea placeholder styling'
    );
    assert.ok(
        verifyWidgetCss.includes('html:not([data-theme="dark"]) .verify-batch-textarea::placeholder'),
        'verify-widget.css must adapt batch textarea placeholder for light theme'
    );

    // 8. Verify textarea focus does not show outer halo/glow
    assert.ok(
        !/\.verify-widget textarea\.verify-input:focus[\s\S]*?\{[^}]*0 0 0 4px/.test(verifyPageCss),
        'css/verify-page.css must not add an outer halo box-shadow ring on textarea focus'
    );
    assert.ok(
        !/\.verify-widget textarea\.verify-input:focus[\s\S]*?\{[^}]*0 0 0 4px/.test(verifyWidgetCss),
        'verify-widget.css must not add an outer halo box-shadow ring on textarea focus'
    );
});
