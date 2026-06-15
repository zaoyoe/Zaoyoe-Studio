const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('shop product copy migration adds independent bilingual INTL copy and visibility fields', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260614_add_site_scoped_shop_copy.sql');

    [
        'name_intl',
        'name_intl_zh',
        'description_intl',
        'description_intl_zh',
        'show_product_description_intl',
        'purchase_notes_intl',
        'purchase_notes_intl_zh',
        'show_purchase_notes_intl',
        'usage_instructions_intl',
        'usage_instructions_intl_zh',
        'show_usage_instructions_intl'
    ].forEach((field) => {
        assert.match(
            migrationSource,
            new RegExp(`ADD COLUMN IF NOT EXISTS ${field}`),
            `migration should add ${field}`
        );
    });

    [
        ['name_intl', 'name_en'],
        ['name_intl_zh', 'name'],
        ['description_intl', 'description_en'],
        ['description_intl_zh', 'description'],
        ['purchase_notes_intl', 'purchase_notes_en'],
        ['purchase_notes_intl_zh', 'purchase_notes_zh'],
        ['usage_instructions_intl', 'usage_instructions_en'],
        ['usage_instructions_intl_zh', 'usage_instructions_zh']
    ].forEach(([targetField, sourceField]) => {
        assert.match(
            migrationSource,
            new RegExp(`${targetField} = COALESCE\\(NULLIF\\(${targetField}, ''\\), NULLIF\\(${sourceField}, ''\\)`),
            `migration should backfill ${targetField} from ${sourceField}`
        );
    });
});

test('admin product editor writes bilingual copy and switches only for the active site', () => {
    const adminSource = readRepoFile('js/admin-shop.js');
    const adminHtmlSource = readRepoFile('admin-studio.html');
    const mutateSource = readRepoFile('server/api-handlers/admin/shop/mutate.js');
    const productsSource = readRepoFile('server/api-handlers/admin/shop/products.js');

    assert.match(
        adminSource,
        /intl: \{ price: 'price_points_intl', name: 'name_intl', desc: 'description_intl' \}/,
        'INTL product name and description should use INTL fields, not CN or legacy translation fields'
    );
    assert.match(
        adminSource,
        /getSiteScopedProductSwitchForEdit\(data, baseField[\s\S]*const intlField = `\$\{baseField\}_intl`[\s\S]*return data\[intlField\] === true/,
        'admin editor should hydrate INTL visibility switches from *_intl switch fields'
    );
    assert.match(
        adminHtmlSource,
        /id="productCopyLanguageGroup"[\s\S]*data-copy-language="zh"[\s\S]*data-copy-language="en"/,
        'admin product editor should expose an explicit INTL copy-language switch'
    );
    assert.match(
        adminSource,
        /getProductCopyLanguageForEdit\(\)[\s\S]*return 'zh';[\s\S]*prodCopyLanguage[\s\S]*this\.productCopyLanguage \|\| 'zh'/,
        'admin product editor should default INTL copy editing to Chinese'
    );
    assert.match(
        adminSource,
        /getSiteScopedProductTextForEdit\(data, baseField, language = this\.getProductCopyLanguageForEdit\(\)\)[\s\S]*const intlZhField[\s\S]*normalizeProductCopyLanguage\(language\) === 'en'[\s\S]*return String\(data\?\.\[intlZhField\] \|\| data\?\.\[intlField\]/,
        'admin product editor should load INTL Chinese copy unless EN is explicitly selected'
    );
    assert.match(
        adminSource,
        /getProductGuidanceTextForEdit\(data, baseField, language = this\.getProductCopyLanguageForEdit\(\)\)[\s\S]*const intlZhText[\s\S]*normalizeProductCopyLanguage\(language\) === 'en'[\s\S]*: \(intlZhText \|\| intlText \|\| enText \|\| ''\)/,
        'admin product guidance editor should load INTL Chinese guidance unless EN is explicitly selected'
    );
    assert.match(
        adminSource,
        /buildProductGuidancePayloadPatch[\s\S]*if \(editSite === 'intl'\)[\s\S]*patch\[`\$\{baseField\}_intl`\][\s\S]*patch\[`\$\{baseField\}_intl_zh`\][\s\S]*patch\[`show_\$\{baseField\}_intl`\][\s\S]*patch\[baseField\][\s\S]*patch\[`\$\{baseField\}_zh`\][\s\S]*patch\[`\$\{baseField\}_en`\]/,
        'guidance save patch should keep INTL bilingual fields separate from CN bilingual fields'
    );
    assert.match(
        adminSource,
        /if \(editSite === 'intl'\) \{[\s\S]*payload\.name_intl = productInputLanguage\.name === 'zh'[\s\S]*payload\.name_intl_zh = productInputLanguage\.name === 'zh'[\s\S]*payload\.description_intl = productInputLanguage\.description === 'zh'[\s\S]*payload\.description_intl_zh = productInputLanguage\.description === 'zh'[\s\S]*delete payload\.name;[\s\S]*delete payload\.description;/,
        'INTL product save should write INTL bilingual copy without overwriting CN name or description fields'
    );
    assert.match(
        adminSource,
        /editSite === 'intl'[\s\S]*this\.translateToEnglish[\s\S]*this\.translateToChinese/,
        'INTL product saves should auto-translate within the INTL field set in both directions'
    );
    assert.match(
        mutateSource,
        /PRODUCT_SCHEMA_COMPATIBILITY_FIELDS[\s\S]*name_intl[\s\S]*name_intl_zh[\s\S]*description_intl[\s\S]*description_intl_zh[\s\S]*purchase_notes_intl[\s\S]*purchase_notes_intl_zh[\s\S]*usage_instructions_intl[\s\S]*usage_instructions_intl_zh/,
        'admin mutation compatibility fallback should know the site-scoped bilingual copy fields'
    );
    assert.match(
        productsSource,
        /name_intl[\s\S]*name_intl_zh[\s\S]*description_intl[\s\S]*description_intl_zh[\s\S]*show_purchase_notes_intl[\s\S]*purchase_notes_intl[\s\S]*purchase_notes_intl_zh[\s\S]*usage_instructions_intl[\s\S]*usage_instructions_intl_zh/,
        'admin product reads should select the site-scoped bilingual copy fields'
    );
});

test('storefront resolves product copy by current site and current UI language', () => {
    const shopSource = readRepoFile('js/shop-client.js');
    const homeBootstrapSource = readRepoFile('js/index-home-bootstrap.js');
    const publicHandlerSource = readRepoFile('server/api-handlers/public/shop.js');

    assert.match(
        shopSource,
        /getGuidanceSiteForCurrentLanguage: function \(\) \{[\s\S]*return this\.getCurrentShopSite\(\);/,
        'storefront guidance requests should use the active site, not infer site from UI language'
    );
    assert.match(
        shopSource,
        /getShopProductSiteNamePair: function[\s\S]*product\.name_intl_zh[\s\S]*product\.name_intl[\s\S]*product\.name_en/,
        'storefront product names should keep the current site bilingual name pair'
    );
    assert.match(
        shopSource,
        /getLocalizedProductDescription: function[\s\S]*product\.description_intl_zh \|\| product\.description_intl \|\| product\.description_en[\s\S]*return String\(product\.description \|\| product\.description_en/,
        'storefront descriptions should resolve the active site copy and its translation'
    );
    assert.match(
        shopSource,
        /getLocalizedProductGuidanceText: function[\s\S]*const intlZhText = String\(product\?\.\[`\$\{baseField\}_intl_zh`\][\s\S]*return intlZhText \|\| intlText \|\| enText[\s\S]*return zhText \|\| legacyText \|\| enText/,
        'storefront guidance should resolve the active site bilingual guidance fields'
    );
    assert.match(
        shopSource,
        /buildCartProductSnapshot: function[\s\S]*name_intl_zh[\s\S]*description_intl_zh[\s\S]*purchase_notes_intl_zh[\s\S]*usage_instructions_intl_zh/,
        'cart snapshots should preserve INTL bilingual fields for later localized display'
    );
    assert.match(
        shopSource,
        /product-guidance[\s\S]*site: this\.getGuidanceSiteForCurrentLanguage\(\)[\s\S]*language: this\.isEnglishShopLocale\(\) \? 'en' : 'zh'/,
        'storefront guidance API requests should send both site and UI language'
    );
    assert.match(
        publicHandlerSource,
        /function buildShopCatalogCacheKey\(\{[\s\S]*language = 'zh'[\s\S]*String\(language \|\| 'zh'\)\.trim\(\)\.toLowerCase\(\)/,
        'public catalog cache should be split by requested UI language'
    );
    assert.match(
        publicHandlerSource,
        /currentLanguage = resolveGuidanceLanguage\([\s\S]*requestUrl\.searchParams\.get\('language'\)[\s\S]*requestUrl\.searchParams\.get\('lang'\)[\s\S]*requestUrl\.searchParams\.get\('locale'\)[\s\S]*language: currentLanguage/,
        'public catalog should honor explicit UI language request parameters'
    );
    assert.match(
        publicHandlerSource,
        /function resolveGuidanceLanguage[\s\S]*if \(normalizedValue\) \{[\s\S]*return normalizeGuidanceLanguage\(normalizedValue\);[\s\S]*return 'zh';/,
        'public API should default missing language to Chinese for every site'
    );
    assert.match(
        publicHandlerSource,
        /function resolveLocalizedGuidanceText[\s\S]*const intlZhText = normalizeGuidanceText\(product\?\.\[`\$\{baseField\}_intl_zh`\]\);[\s\S]*return intlZhText \|\| intlText \|\| enText;[\s\S]*return zhText \|\| legacyText;/,
        'public API guidance should resolve site-scoped bilingual text'
    );
    assert.match(
        shopSource,
        /getShopCatalogBrowserCacheKey: function \(\{ site = 'cn', category = 'all', language = 'zh' \} = \{\}\)[\s\S]*normalizedLanguage[\s\S]*SHOP_PREFETCH_SCHEMA_VERSION[\s\S]*normalizedLanguage/,
        'storefront browser catalog cache should be keyed by active UI language'
    );
    assert.match(
        shopSource,
        /prefetch\.language === currentLanguage/,
        'storefront should reject prefetched catalog data from a different UI language'
    );
    assert.match(
        homeBootstrapSource,
        /const language = \(\) =>[\s\S]*\? 'en' : 'zh';[\s\S]*fetchShopCatalogPayload\(currentSite, currentLanguage\)[\s\S]*language: currentLanguage/,
        'homepage shop prefetch should persist the UI language used for catalog data'
    );
});

test('purchase and order guidance reloads site-scoped localized usage instructions', () => {
    const publicHandlerSource = readRepoFile('server/api-handlers/public/shop.js');
    const marketplaceSource = readRepoFile('api/_lib/marketplace-orders.js');

    assert.match(
        publicHandlerSource,
        /const \{ data: productGuidanceRow \} = await loadProductGuidanceRow\(systemSupabase, payload\.productId\);[\s\S]*const guidancePayload = buildProductGuidancePayload\(productGuidanceRow, payload\.site, payload\.language\);[\s\S]*responseUsageInstructions = normalizeGuidanceText\(guidancePayload\.usage_instructions\)/,
        'purchase response should refresh usage instructions from site-scoped localized product guidance'
    );
    assert.match(
        publicHandlerSource,
        /async function loadShopOrderDetail\(dataSupabase, \{ orderId = '', userId = '', site = 'cn', language = '' \} = \{\}\)[\s\S]*const guidanceLanguage = resolveGuidanceLanguage\(language, site\);[\s\S]*buildProductGuidancePayload\(productGuidanceRow \|\| \{\}, site, guidanceLanguage\)/,
        'order-detail responses should reload guidance with both site and requested language'
    );
    assert.match(
        marketplaceSource,
        /const usageInstructionsIntl = sanitizeText\(product\?\.usage_instructions_intl, 4000\);[\s\S]*const usageInstructionsIntlZh = sanitizeText\(product\?\.usage_instructions_intl_zh, 4000\);[\s\S]*product\.show_usage_instructions_intl === true[\s\S]*return usageInstructionsIntlZh \|\| usageInstructionsIntl \|\| usageInstructionsEn;[\s\S]*return usageInstructionsZh \|\| usageInstructions;/,
        'marketplace order enrichment should resolve usage instructions by site default'
    );
});
