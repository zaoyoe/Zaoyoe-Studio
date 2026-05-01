const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin product saves upload purchase guidance as bilingual fields', () => {
    const adminShopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const migrationSource = readRepoFile(path.join('supabase', 'migrations', '20260430_add_bilingual_shop_guidance.sql'));

    assert.match(
        adminShopSource,
        /Translate the following Chinese product information to English[\s\S]*"purchase_notes", and "usage_instructions"/,
        'product auto-translation should cover purchase notes and usage instructions'
    );
    assert.match(
        adminShopSource,
        /buildProductGuidancePayloadPatch\('purchase_notes'[\s\S]*translatedEn: purchase_notes_en/,
        'purchase notes should be converted into localized payload fields before save'
    );
    assert.match(
        adminShopSource,
        /buildProductGuidancePayloadPatch\('usage_instructions'[\s\S]*translatedEn: usage_instructions_en/,
        'usage instructions should be converted into localized payload fields before save'
    );
    assert.match(
        adminShopSource,
        /buildLegacyProductGuidanceFallbackPayload: function \(payload = \{\}, \{ editSite = 'cn' \} = \{\}\)/,
        'product save should be able to retry with legacy guidance fields when bilingual columns are not migrated yet'
    );
    assert.match(
        adminShopSource,
        /Bilingual product guidance columns are missing; retrying with legacy guidance fields only/,
        'product save should not fail the whole product when only bilingual guidance columns are missing'
    );
    assert.match(
        adminShopSource,
        /getProductTranslationTimeoutMs: function \(\) \{[\s\S]*return preferredService === 'codex' \? 30000 : 12000;/,
        'Codex Relay product translations should get a longer save-time budget than the old short timeout'
    );
    assert.match(
        adminShopSource,
        /商品已保存（英文翻译未完成：/,
        'product save success feedback should warn when enabled guidance was saved without usable English text'
    );
    assert.match(
        migrationSource,
        /ADD COLUMN IF NOT EXISTS purchase_notes_zh TEXT,[\s\S]*ADD COLUMN IF NOT EXISTS usage_instructions_en TEXT;/,
        'database migration should add bilingual guidance columns'
    );
});

test('shop and wallet guidance readers resolve bilingual fields by site', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopHandlerSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'shop.js'));
    const walletHandlerSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'wallet.js'));
    const pointsServiceSource = readRepoFile(path.join('js', 'services', 'PointsService.js'));

    assert.match(
        shopClientSource,
        /getLocalizedProductGuidanceText: function \(product, baseField\)/,
        'storefront should localize product guidance from bilingual fields'
    );
    assert.match(
        shopClientSource,
        /getGuidanceSiteForCurrentLanguage: function \(\) \{\s+return this\.isEnglishShopLocale\(\) \? 'intl' : 'cn';\s+\}/,
        'storefront should request product guidance with the current UI language instead of the business site'
    );
    assert.match(
        shopClientSource,
        /fetch\('\/api\/shop\/product-guidance'[\s\S]*site: this\.getGuidanceSiteForCurrentLanguage\(\)/,
        'product guidance refreshes should pass the UI-language site to the public API'
    );
    assert.match(
        shopClientSource,
        /getMissingProductGuidanceTranslationText: function \(baseField\)/,
        'storefront should keep guidance controls visible with an English missing-translation placeholder'
    );
    assert.match(
        shopHandlerSource,
        /resolveLocalizedGuidanceText\(product = \{\}, baseField = '', guidanceSite = 'cn'\)/,
        'public shop APIs should localize guidance from bilingual fields'
    );
    assert.match(
        shopHandlerSource,
        /purchase_notes_needs_translation: showPurchaseNotes && !purchaseNotes && hasProductGuidanceSourceText\(product, 'purchase_notes'\)/,
        'public shop APIs should report configured guidance even when the English translation is not available yet'
    );
    assert.match(
        walletHandlerSource,
        /resolveLocalizedGuidanceText\(product = \{\}, baseField = '', guidanceSite = 'cn'\)/,
        'wallet order details should localize guidance from bilingual fields'
    );
    assert.match(
        pointsServiceSource,
        /orderId: normalizedOrderId,\s*site: currentSite/,
        'wallet order-detail requests should include site so cached guidance stays language-specific'
    );
});
