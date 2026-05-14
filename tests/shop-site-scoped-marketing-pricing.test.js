const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('admin product editor saves tier and flash pricing into the active site only', () => {
    const source = readRepoFile('js/admin-shop.js');

    assert.match(
        source,
        /SITE_MARKETING_FIELD_MAP:[\s\S]*cn:[\s\S]*quantityRules: 'quantity_rules'[\s\S]*intl:[\s\S]*quantityRules: 'quantity_rules_intl'/,
        'admin shop editor should map marketing pricing fields by site'
    );
    assert.match(
        source,
        /fillProductModalFromData: function[\s\S]*const marketingFields = this\.getMarketingFieldMap\(\);[\s\S]*const quantityRules = data\?\.\[marketingFields\.quantityRules\]/,
        'editing a product should hydrate tiered pricing from the current site field'
    );
    assert.match(
        source,
        /const marketingFields = this\.getMarketingFieldMap\(editSite\);[\s\S]*\[marketingFields\.quantityRules\]: null,[\s\S]*\[marketingFields\.flashSalePrice\]: null,[\s\S]*\[marketingFields\.flashSaleEnd\]: null/,
        'saving a product should initialize only the current site marketing fields'
    );
    assert.match(
        source,
        /payload\[marketingFields\.quantityRules\] = quantityRulesRaw;[\s\S]*payload\[marketingFields\.flashSalePrice\] = parseInt\(flashPriceRaw\);[\s\S]*payload\[marketingFields\.flashSaleEnd\] = new Date\(flashEndRaw\)\.toISOString\(\);/,
        'saving tier and flash pricing should write through the site-scoped field map'
    );
});

test('public shop catalog normalizes marketing pricing for the requested site', () => {
    const handlerSource = readRepoFile('server/api-handlers/public/shop.js');
    const shopSource = readRepoFile('js/shop-client.js');
    const mutateSource = readRepoFile('server/api-handlers/admin/shop/mutate.js');

    assert.match(
        handlerSource,
        /quantity_rules_intl[\s\S]*flash_sale_price_intl[\s\S]*flash_sale_end_intl/,
        'public catalog should select INTL marketing pricing columns'
    );
    assert.match(
        handlerSource,
        /function getSiteScopedShopMarketingValue[\s\S]*Object\.prototype\.hasOwnProperty\.call\(product, intlField\)[\s\S]*return product\[intlField\]/,
        'public catalog should treat an existing NULL INTL field as an intentional empty value'
    );
    assert.match(
        handlerSource,
        /normalizeShopCatalogProductForSite[\s\S]*quantity_rules: quantityRules \?\? null,[\s\S]*flash_sale_price: flashSalePrice \?\? null,[\s\S]*flash_sale_end: flashSaleEnd \|\| null/,
        'public catalog should expose normalized marketing fields to the storefront'
    );
    assert.match(
        shopSource,
        /getProductSiteScopedMarketingValue: function[\s\S]*Object\.prototype\.hasOwnProperty\.call\(product, intlField\)[\s\S]*return product\[intlField\]/,
        'direct storefront fallback should use the same site-scoped marketing fallback rule'
    );
    assert.match(
        mutateSource,
        /PRODUCT_SCHEMA_COMPATIBILITY_FIELDS[\s\S]*quantity_rules_intl[\s\S]*flash_sale_price_intl[\s\S]*flash_sale_end_intl/,
        'admin mutation fallback should understand the new site-scoped marketing columns'
    );
});

test('database migration splits shop marketing pricing and RPC pricing by site', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260513_split_shop_marketing_pricing_by_site.sql');

    assert.match(
        migrationSource,
        /ADD COLUMN IF NOT EXISTS quantity_rules_intl JSONB[\s\S]*ADD COLUMN IF NOT EXISTS flash_sale_price_intl NUMERIC\(12,2\)[\s\S]*ADD COLUMN IF NOT EXISTS flash_sale_end_intl TIMESTAMPTZ/,
        'migration should add independent INTL tier and flash pricing columns'
    );
    assert.match(
        migrationSource,
        /CREATE OR REPLACE FUNCTION public\.fn_validate_discount_code\([\s\S]*v_effective_quantity_rules JSONB := NULL;[\s\S]*v_effective_flash_sale_end TIMESTAMPTZ := NULL;[\s\S]*v_effective_flash_sale_price NUMERIC\(12,2\) := NULL;[\s\S]*v_effective_quantity_rules := v_product\.quantity_rules_intl;[\s\S]*v_effective_flash_sale_price := v_product\.flash_sale_price_intl;[\s\S]*jsonb_array_elements\(v_effective_quantity_rules\)/,
        'discount preview RPC should price against site-scoped tier and flash fields'
    );
    assert.match(
        migrationSource,
        /CREATE OR REPLACE FUNCTION public\.fn_purchase_shop_item\([\s\S]*v_effective_quantity_rules JSONB := NULL;[\s\S]*v_effective_flash_sale_end TIMESTAMPTZ := NULL;[\s\S]*v_effective_flash_sale_price NUMERIC\(12,2\) := NULL;[\s\S]*v_effective_quantity_rules := v_product\.quantity_rules_intl;[\s\S]*v_effective_flash_sale_price := v_product\.flash_sale_price_intl;[\s\S]*jsonb_array_elements\(v_effective_quantity_rules\)/,
        'purchase RPC should price against site-scoped tier and flash fields'
    );
    assert.match(
        migrationSource,
        /ALTER TABLE public\.agent_prices[\s\S]*ADD COLUMN IF NOT EXISTS site VARCHAR\(16\) DEFAULT 'cn' NOT NULL[\s\S]*ADD CONSTRAINT agent_prices_pkey PRIMARY KEY \(agent_id, product_id, site\)/,
        'migration should scope agent storefront prices by site'
    );
    assert.match(
        migrationSource,
        /FROM public\.agent_prices[\s\S]*AND product_id = p_product_id[\s\S]*AND COALESCE\(NULLIF\(BTRIM\(LOWER\(site\)\), ''\), 'cn'\) = v_site/,
        'purchase and preview RPCs should only use agent prices for the active site'
    );
});

test('storefront loads agent prices for the current site only', () => {
    const shopSource = readRepoFile('js/shop-client.js');

    assert.match(
        shopSource,
        /select\('product_id, custom_price, site'\)[\s\S]*\.eq\('agent_id', this\.currentAgentId\)[\s\S]*\.eq\('site', currentSite\)/,
        'agent storefront lookup should include the current shop site'
    );
    assert.match(
        shopSource,
        /agentPricesCacheSite === currentSite/,
        'agent price cache should be keyed by site'
    );
});
