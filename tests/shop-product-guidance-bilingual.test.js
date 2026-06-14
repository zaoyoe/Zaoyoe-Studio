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
        /Translate the following English product information to Simplified Chinese[\s\S]*"purchase_notes", and "usage_instructions"/,
        'intl product saves should reverse-translate product fields and guidance to Chinese'
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
        /buildProductGuidancePayloadPatch\('purchase_notes'[\s\S]*translatedZh: purchase_notes_zh/,
        'intl purchase notes should preserve a generated Chinese copy when reverse translation succeeds'
    );
    assert.match(
        adminShopSource,
        /buildProductGuidancePayloadPatch\('purchase_notes'[\s\S]*sourceLanguage: productInputLanguage\.purchase_notes/,
        'intl purchase notes should choose payload fields from the detected source language'
    );
    assert.match(
        adminShopSource,
        /buildProductGuidancePayloadPatch\('usage_instructions'[\s\S]*sourceLanguage: productInputLanguage\.usage_instructions/,
        'intl usage instructions should choose payload fields from the detected source language'
    );
    assert.match(
        adminShopSource,
        /hasChineseProductText\(value\)[\s\S]*\\u3400-\\u9fff/,
        'intl product saves should detect Chinese input before choosing translation direction'
    );
    assert.match(
        adminShopSource,
        /const productInputLanguage = editSite === 'intl'[\s\S]*name: this\.hasChineseProductText\(persistedProductTextValues\.name\) \? 'zh' : 'en'[\s\S]*usage_instructions: this\.hasChineseProductText\(persistedProductTextValues\.usage_instructions\) \? 'zh' : 'en'/,
        'intl product saves should detect source language for title, description, purchase notes, and usage instructions'
    );
    assert.match(
        adminShopSource,
        /this\.translateToEnglish\(\s*productInputLanguage\.name === 'zh' \? name : ''[\s\S]*purchaseNotes: productInputLanguage\.purchase_notes === 'zh'[\s\S]*usageInstructions: productInputLanguage\.usage_instructions === 'zh'/,
        'intl product saves should translate Chinese source fields to English'
    );
    assert.match(
        adminShopSource,
        /this\.translateToChinese\(\s*productInputLanguage\.name === 'en' \? name : ''[\s\S]*purchaseNotes: productInputLanguage\.purchase_notes === 'en'[\s\S]*usageInstructions: productInputLanguage\.usage_instructions === 'en'/,
        'intl product saves should translate English source fields back to Chinese'
    );
    assert.match(
        adminShopSource,
        /if \(editSite === 'intl'\) \{[\s\S]*payload\.name_intl = productInputLanguage\.name === 'zh'[\s\S]*payload\.name_intl_zh = productInputLanguage\.name === 'zh'[\s\S]*payload\.description_intl = productInputLanguage\.description === 'zh'[\s\S]*payload\.description_intl_zh = productInputLanguage\.description === 'zh'[\s\S]*delete payload\.name;[\s\S]*delete payload\.description;/,
        'intl title and description input should save site-scoped bilingual fields without overwriting CN copy'
    );
    assert.match(
        adminShopSource,
        /payload\.name_intl = productInputLanguage\.name === 'zh'[\s\S]*\? \(name_en[\s\S]*: name;[\s\S]*payload\.name_intl_zh = productInputLanguage\.name === 'zh'[\s\S]*\? name[\s\S]*: \(name_zh[\s\S]*payload\.description_intl = productInputLanguage\.description === 'zh'[\s\S]*\? \(description_en[\s\S]*: description;[\s\S]*payload\.description_intl_zh = productInputLanguage\.description === 'zh'[\s\S]*\? description[\s\S]*: \(description_zh/,
        'intl English and Chinese title/description input should stay within the INTL field set'
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
        /当前 AI 翻译服务未配置，请先在后台配置 Gemini \/ Codex Relay/,
        'product auto-translation should tell admins when the AI service is not configured instead of silently returning empty translations'
    );
    assert.match(
        adminShopSource,
        /generationConfig: \{ temperature: 0\.1, maxOutputTokens: 900 \}[\s\S]*tier: 'balanced'[\s\S]*maxInputChars: 9000[\s\S]*maxOutputTokens: 900/,
        'product guidance translations should use enough budget for longer purchase notes and usage instructions'
    );
    assert.match(
        adminShopSource,
        /AI 翻译没有返回可解析的 JSON，已跳过英文同步/,
        'product auto-translation should surface malformed AI output as a specific soft failure'
    );
    assert.match(
        adminShopSource,
        /productTranslationDetailMessage = productTranslationErrorMessage \|\| productTranslationWarningMessage/,
        'product save feedback should include the concrete translation failure reason when guidance English text is missing'
    );
    assert.match(
        adminShopSource,
        /missingTranslationWarnings\.push\(`英文翻译未完成：\$\{missingEnglishTranslations\.join\('、'\)\}`\)[\s\S]*missingTranslationWarnings\.push\(`中文翻译未完成：\$\{missingChineseTranslations\.join\('、'\)\}`\)[\s\S]*商品已保存（\$\{missingTranslationWarnings\.join\('；'\)\}）/,
        'product save success feedback should warn in each missing translation direction'
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
        /getGuidanceSiteForCurrentLanguage: function \(\) \{\s+return this\.getCurrentShopSite\(\);\s+\}/,
        'storefront should request product guidance for the active business site'
    );
    assert.match(
        shopClientSource,
        /fetch\('\/api\/shop\/product-guidance'[\s\S]*site: this\.getGuidanceSiteForCurrentLanguage\(\),[\s\S]*language: this\.isEnglishShopLocale\(\) \? 'en' : 'zh'/,
        'product guidance refreshes should pass both business site and UI language to the public API'
    );
    assert.match(
        shopClientSource,
        /getMissingProductGuidanceTranslationText: function \(baseField\)/,
        'storefront should keep guidance controls visible with an English missing-translation placeholder'
    );
    assert.match(
        shopHandlerSource,
        /resolveLocalizedGuidanceText\(product = \{\}, baseField = '', guidanceSite = 'cn', language = ''\)/,
        'public shop APIs should localize guidance from site-scoped bilingual fields'
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
