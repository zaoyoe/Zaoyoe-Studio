const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('storefront product card titles clamp to 2 lines with ellipsis and hover tooltip', () => {
    const shopCss = readRepoFile('css/shop-page.css');
    const shopListCss = readRepoFile('css/shop-list-layout.css');
    const shopClientJs = readRepoFile('js/shop-client.js');

    // 1. css/shop-page.css card title line clamp
    assert.match(
        shopCss,
        /\.shop-card-title\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*line-clamp:\s*2;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
        'shop-card-title in shop-page.css must clamp to 2 lines with ellipsis'
    );

    // 2. css/shop-list-layout.css grid card title line clamp
    assert.match(
        shopListCss,
        /\.shop-main\.shop-layout--grid \.shop-card-title\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*line-clamp:\s*2;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
        'shop-main grid shop-card-title in shop-list-layout.css must clamp to 2 lines with ellipsis'
    );

    // 3. js/shop-client.js sets title attribute on card title
    assert.match(
        shopClientJs,
        /<h3 class="shop-card-title" title="\$\{this\.escapeAttribute\(displayName\)\}">/,
        'shop-card-title must carry title attribute for hover tooltip'
    );
});

test('detail modal product title clamps to 2 lines and sets title attribute for hover tooltip', () => {
    const shopCss = readRepoFile('css/shop-page.css');
    const shopClientJs = readRepoFile('js/shop-client.js');

    // 1. Base detail title line-clamp
    assert.match(
        shopCss,
        /#shopPurchaseModal #purchaseStageTitle\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*line-clamp:\s*2;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
        'purchase modal product title must clamp to 2 lines with ellipsis'
    );

    // 2. Responsive detail title line-clamp in desktop media query
    assert.match(
        shopCss,
        /@media \(min-width: 901px\)[\s\S]*?#shopPurchaseModal #purchaseStageTitle\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*line-clamp:\s*2;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
        'purchase modal product title in desktop media query must maintain 2-line clamp'
    );

    // 3. renderModalProductName sets title attribute on stageTitle
    assert.match(
        shopClientJs,
        /renderModalProductName:\s*function[\s\S]*?stageTitle\.setAttribute\('title',\s*displayName \|\| ''\);/,
        'renderModalProductName must set title attribute on stageTitle for hover tooltip'
    );

    // 4. setPurchaseStage sets title attribute on stageTitle
    assert.match(
        shopClientJs,
        /setPurchaseStage:\s*function[\s\S]*?stageTitle\.setAttribute\('title',\s*this\.getCurrentPurchaseDisplayName\(\)\);/,
        'setPurchaseStage must update title attribute on stageTitle'
    );
});

test('detail modal SKU option capsules have bounded max-width, ellipsis, and hover tooltips', () => {
    const shopCss = readRepoFile('css/shop-page.css');
    const shopClientJs = readRepoFile('js/shop-client.js');

    // 1. Bounded max-width for pills & spec buttons
    assert.match(
        shopCss,
        /#shopPurchaseModal \.shop-sku-option--pill,\s*#shopPurchaseModal \.shop-sku-spec-option\s*\{[^}]*max-width:\s*min\(100%,\s*280px\);/s,
        'SKU option pills and spec options must limit max-width to min(100%, 280px)'
    );

    // 2. Name truncation
    assert.match(
        shopCss,
        /#shopPurchaseModal \.shop-sku-option--pill \.shop-sku-option__name,\s*#shopPurchaseModal \.shop-sku-spec-option \.shop-sku-spec-option__name,\s*#shopPurchaseModal \.shop-sku-spec-option\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
        'SKU option pill names and spec options must truncate with ellipsis'
    );

    // 3. renderPurchaseSkuPills sets title attribute
    assert.match(
        shopClientJs,
        /renderPurchaseSkuPills:\s*function[\s\S]*?class="shop-sku-option shop-sku-option--pill[\s\S]*?title="\$\{this\.escapeAttribute\(name\)\}"/s,
        'renderPurchaseSkuPills must set title attribute on option button'
    );

    // 4. renderPurchaseSkuSpecGroups sets title attribute
    assert.match(
        shopClientJs,
        /renderPurchaseSkuSpecGroups:\s*function[\s\S]*?class="shop-sku-spec-option[\s\S]*?title="\$\{this\.escapeAttribute\(value\)\}"/s,
        'renderPurchaseSkuSpecGroups must set title attribute on option button'
    );
});

test('detail modal purchase configuration panel and guidance rows prevent horizontal overflow from long SKU names or content', () => {
    const shopCss = readRepoFile('css/shop-page.css');

    // 1. config-panel grid column constraint
    assert.match(
        shopCss,
        /#shopPurchaseModal \.shop-purchase-config-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s,
        'shop-purchase-config-panel must constrain its single column to minmax(0, 1fr) with min-width 0 and max-width 100%'
    );

    // 2. Desktop config-panel override preserves column constraint
    assert.match(
        shopCss,
        /@media \(min-width: 901px\)[\s\S]*?#shopPurchaseModal \.shop-purchase-config-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
        'desktop shop-purchase-config-panel must retain grid-template-columns: minmax(0, 1fr)'
    );

    // 3. scroll container min-width constraint
    assert.match(
        shopCss,
        /#shopPurchaseModal \.shop-purchase-scroll\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s,
        'shop-purchase-scroll must constrain min-width: 0 and max-width: 100%'
    );

    // 4. sku selector header min-width constraint
    assert.match(
        shopCss,
        /#shopPurchaseModal \.shop-sku-selector__header\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s,
        'shop-sku-selector__header must constrain min-width: 0 and max-width: 100%'
    );

    // 5. spec-group grid columns and label wrap
    assert.match(
        shopCss,
        /#shopPurchaseModal \.shop-sku-spec-group\s*\{[^}]*grid-template-columns:\s*minmax\(56px,\s*auto\)\s*minmax\(0,\s*1fr\);/s,
        'shop-sku-spec-group must use minmax(56px, auto) for group label column'
    );

    // 6. guidance cards and content wrap defensively
    assert.match(
        shopCss,
        /#shopPurchaseModal #purchaseNotesContent,\s*#shopPurchaseModal #purchaseUsageContent\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s,
        'purchase notes and usage content must break overflowing words/urls'
    );
});

