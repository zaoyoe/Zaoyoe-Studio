const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('shop guidance fullscreen and shrink feature contracts', async (t) => {
    const shopHtml = fs.readFileSync(path.join(repoRoot, 'shop.html'), 'utf8');
    const shopCss = fs.readFileSync(path.join(repoRoot, 'css/shop-page.css'), 'utf8');
    const shopJs = fs.readFileSync(path.join(repoRoot, 'js/shop-client.js'), 'utf8');
    const zhLang = JSON.parse(fs.readFileSync(path.join(repoRoot, 'lang/zh.json'), 'utf8'));
    const enLang = JSON.parse(fs.readFileSync(path.join(repoRoot, 'lang/en.json'), 'utf8'));

    await t.test('i18n defines fullscreen, shrink and close labels in zh and en', () => {
        assert.ok(zhLang.shop?.fullscreenPurchaseNotes, 'zh should define shop.fullscreenPurchaseNotes');
        assert.ok(zhLang.shop?.shrinkPurchaseNotes, 'zh should define shop.shrinkPurchaseNotes');
        assert.ok(zhLang.shop?.closePurchaseNotes, 'zh should define shop.closePurchaseNotes');
        assert.equal(zhLang.shop.fullscreenPurchaseNotes, '全窗口展示');
        assert.equal(zhLang.shop.shrinkPurchaseNotes, '缩小窗口');
        assert.equal(zhLang.shop.closePurchaseNotes, '关闭');

        assert.ok(enLang.shop?.fullscreenPurchaseNotes, 'en should define shop.fullscreenPurchaseNotes');
        assert.ok(enLang.shop?.shrinkPurchaseNotes, 'en should define shop.shrinkPurchaseNotes');
        assert.ok(enLang.shop?.closePurchaseNotes, 'en should define shop.closePurchaseNotes');
        assert.equal(enLang.shop.fullscreenPurchaseNotes, 'Full window');
        assert.equal(enLang.shop.shrinkPurchaseNotes, 'Shrink window');
        assert.equal(enLang.shop.closePurchaseNotes, 'Close');
    });

    await t.test('HTML contains fullscreen buttons beside copy buttons and fullscreen overlay card', () => {
        // Purchase Notes card action buttons
        assert.match(
            shopHtml,
            /<button\s+id="purchaseNotesCopyBtn"[\s\S]*?<button\s+id="purchaseNotesFullscreenBtn"[\s\S]*?data-shop-guidance-fullscreen="purchase_notes"/,
            'purchase notes card should contain copy button and fullscreen button in actions container'
        );

        // Purchase Usage card action buttons
        assert.match(
            shopHtml,
            /<button\s+id="purchaseUsageCopyBtn"[\s\S]*?<button\s+id="purchaseUsageFullscreenBtn"[\s\S]*?data-shop-guidance-fullscreen="usage_instructions"/,
            'purchase usage card should contain copy button and fullscreen button in actions container'
        );

        // Fullscreen overlay card inside modal-content
        assert.match(
            shopHtml,
            /<div\s+id="purchaseGuidanceFullscreenCard"\s+class="shop-guidance-fullscreen-card"\s+hidden\s+aria-hidden="true">/,
            'modal-content should contain purchaseGuidanceFullscreenCard'
        );
        assert.match(
            shopHtml,
            /<i\s+id="purchaseGuidanceFullscreenIcon"/,
            'fullscreen card should contain guidance icon'
        );
        assert.match(
            shopHtml,
            /<span\s+id="purchaseGuidanceFullscreenTitle"/,
            'fullscreen card should contain guidance title'
        );
        assert.match(
            shopHtml,
            /<button\s+id="purchaseGuidanceFullscreenCopyBtn"/,
            'fullscreen card should contain copy button'
        );
        assert.match(
            shopHtml,
            /<button\s+id="purchaseGuidanceFullscreenShrinkBtn"[\s\S]*?<i class="fas fa-xmark"/,
            'fullscreen card should contain close button with xmark icon'
        );
        assert.match(
            shopHtml,
            /<div\s+id="purchaseGuidanceFullscreenBody"/,
            'fullscreen card should contain guidance body'
        );
    });

    await t.test('CSS styles action buttons and fullscreen transition container', () => {
        assert.match(
            shopCss,
            /#shopPurchaseModal\s+\.shop-guidance-fullscreen-card\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*z-index:\s*70;[\s\S]*will-change:\s*top,\s*left,\s*width,\s*height,\s*border-radius,\s*opacity;/i,
            'fullscreen card should be positioned absolute with full inset and FLIP transition properties'
        );
        assert.match(
            shopCss,
            /\.shop-guidance-copy-btn,[\s\S]*\.shop-guidance-action-btn,[\s\S]*\.shop-guidance-fullscreen-btn\s*\{/,
            'fullscreen button should share styling with guidance copy button'
        );
        assert.match(
            shopCss,
            /html:not\(\[data-theme="dark"\]\)\s+body\.shop-page\s+#shopPurchaseModal\s+\.shop-guidance-fullscreen-card\s*\{/i,
            'fullscreen card should provide light theme support'
        );
    });

    await t.test('shop-client.js implements container transform lifecycle and keyboard bindings', () => {
        assert.match(
            shopJs,
            /openPurchaseGuidanceFullscreen:\s*function\s*\(kind\s*=\s*'purchase_notes'\)/,
            'shop-client.js should define openPurchaseGuidanceFullscreen'
        );
        assert.match(
            shopJs,
            /closePurchaseGuidanceFullscreen:\s*function\s*\(immediate\s*=\s*false\)/,
            'shop-client.js should define closePurchaseGuidanceFullscreen'
        );
        assert.match(
            shopJs,
            /this\.bindShopMobileTapFallback\(document\.getElementById\('purchaseNotesFullscreenBtn'\)/,
            'shop-client.js should bind mobile tap for purchaseNotesFullscreenBtn'
        );
        assert.match(
            shopJs,
            /this\.bindShopMobileTapFallback\(document\.getElementById\('purchaseUsageFullscreenBtn'\)/,
            'shop-client.js should bind mobile tap for purchaseUsageFullscreenBtn'
        );
        assert.match(
            shopJs,
            /this\.bindShopMobileTapFallback\(document\.getElementById\('purchaseGuidanceFullscreenShrinkBtn'\)/,
            'shop-client.js should bind mobile tap for purchaseGuidanceFullscreenShrinkBtn'
        );
        assert.match(
            shopJs,
            /if\s*\(this\.purchaseGuidanceFullscreenActive\)\s*\{\s*this\.closePurchaseGuidanceFullscreen\(\);\s*return;\s*\}/,
            'Escape key handler should close fullscreen guidance before closing parent modal'
        );
    });
});
