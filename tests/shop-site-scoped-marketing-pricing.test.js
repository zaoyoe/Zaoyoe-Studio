const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('admin product editor keeps product-level tier pricing out of the modal and saves flash pricing into the active site only', () => {
    const source = readRepoFile('js/admin-shop.js');

    assert.match(
        source,
        /SITE_MARKETING_FIELD_MAP:[\s\S]*cn:[\s\S]*quantityRules: 'quantity_rules'[\s\S]*intl:[\s\S]*quantityRules: 'quantity_rules_intl'/,
        'admin shop editor should map marketing pricing fields by site'
    );
    assert.match(
        source,
        /fillProductModalFromData: function[\s\S]*const marketingFields = this\.getMarketingFieldMap\(\);[\s\S]*this\.renderProductSkuEditor\(this\.buildProductSkusForEditor\(data\)/,
        'editing a product should hydrate tiered pricing through the SKU editor'
    );
    assert.match(
        source,
        /const marketingFields = this\.getMarketingFieldMap\(editSite\);[\s\S]*\[marketingFields\.quantityRules\]: null,[\s\S]*\[marketingFields\.flashSalePrice\]: null,[\s\S]*\[marketingFields\.flashSaleEnd\]: null/,
        'saving a product should clear the legacy product-level tier field for the current site'
    );
    assert.doesNotMatch(
        source,
        /quantityRulesRaw|prodQuantityRulesContainer|product-add-tiered-pricing/,
        'admin product editor should no longer write product-level tier pricing from a separate modal builder'
    );
    assert.match(
        source,
        /payload\[marketingFields\.flashSalePrice\] = parseInt\(flashPriceRaw\);[\s\S]*payload\[marketingFields\.flashSaleEnd\] = new Date\(flashEndRaw\)\.toISOString\(\);/,
        'saving flash pricing should still write through the site-scoped field map'
    );
    assert.match(
        source,
        /if \(nameLabel\) nameLabel\.textContent = isCN \? '商品名称' : '商品名称（英文）';[\s\S]*if \(descLabel\) descLabel\.textContent = isCN \? '商品描述' : '商品描述（英文）';/,
        'intl product fields should stay localized for Chinese admin operators'
    );
    assert.match(
        source,
        /if \(editSite === 'intl'\) \{[\s\S]*if \(productInputLanguage\.name === 'zh'\) \{[\s\S]*payload\.name = name;[\s\S]*\} else \{[\s\S]*else if \(!id && !payload\.name\) \{[\s\S]*payload\.name = name;/,
        'creating an intl product should still backfill the base required name field'
    );
    assert.doesNotMatch(
        source,
        /editSite === 'intl'[\s\S]{0,160}payload\.price_points = normalizedPrice/,
        'creating an intl product should not mirror the intl price into the CN price field'
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
        handlerSource,
        /const inventorySkus = rawSkus[\s\S]*const skus = inventorySkus[\s\S]*inventory_skus: inventorySkus,[\s\S]*skus/,
        'public catalog should keep all active inventory SKUs while exposing only current-site purchasable SKUs'
    );
    assert.match(
        shopSource,
        /getProductSiteScopedMarketingValue: function[\s\S]*Object\.prototype\.hasOwnProperty\.call\(product, intlField\)[\s\S]*return product\[intlField\]/,
        'direct storefront fallback should use the same site-scoped marketing fallback rule'
    );
    assert.match(
        shopSource,
        /normalizeProductMarketingForCurrentSite: function[\s\S]*const inventorySkus = rawInventorySkus[\s\S]*inventory_skus: inventorySkus,[\s\S]*skus/,
        'storefront direct normalization should keep inventory SKUs available for aggregate stock math'
    );
    assert.match(
        mutateSource,
        /PRODUCT_SCHEMA_COMPATIBILITY_FIELDS[\s\S]*quantity_rules_intl[\s\S]*flash_sale_price_intl[\s\S]*flash_sale_end_intl/,
        'admin mutation fallback should understand the new site-scoped marketing columns'
    );
});

test('SKU prices are site-scoped sale switches and never inherit from another site', () => {
    const handlerSource = readRepoFile('server/api-handlers/public/shop.js');
    const shopSource = readRepoFile('js/shop-client.js');
    const skuMigrationSource = readRepoFile('supabase/migrations/20260523_add_shop_product_skus.sql');
    const patchMigrationSource = readRepoFile('supabase/migrations/20260604_enforce_site_scoped_sku_prices.sql');

    assert.match(
        handlerSource,
        /const skuPriceField = currentSite === 'intl' \? 'price_points_intl' : 'price_points';[\s\S]*normalizeShopSitePriceValue\(sku\?\.\[skuPriceField\]\)/,
        'public catalog should read only the requested site SKU price field'
    );
    assert.match(
        shopSource,
        /getSkuPriceFieldForCurrentSite: function[\s\S]*price_points_intl[\s\S]*price_points[\s\S]*getProductSkuPriceForCurrentSite: function[\s\S]*normalizeShopSitePriceValue\(sku\?\.\[priceField\]\)/,
        'storefront purchase UI should read only the current site SKU price field'
    );
    assert.doesNotMatch(
        `${handlerSource}\n${shopSource}`,
        /price_points_intl\s*\?\?\s*sku\.price_points|sku\?\.price_points_intl\s*\?\?\s*sku\?\.price_points/,
        'frontend SKU pricing should not fall back to the other SKU site price or product price'
    );
    assert.match(
        skuMigrationSource,
        /WHEN v_site = 'intl' THEN v_sku\.price_points_intl[\s\S]*ELSE v_sku\.price_points/,
        'purchase and marketplace SQL should price SKUs from the requested site field only'
    );
    assert.doesNotMatch(
        skuMigrationSource,
        /COALESCE\(v_sku\.price_points_intl,\s*v_product\.price_points_intl,\s*v_sku\.price_points,\s*v_product\.price_points\)|COALESCE\(v_sku\.price_points,\s*v_product\.price_points\)/,
        'base SKU migration should not retain SKU price fallback chains'
    );
    assert.match(
        patchMigrationSource,
        /failed to remove intl SKU price fallback[\s\S]*failed to remove cn SKU price fallback/,
        'incremental migration should remove deployed SKU price fallback chains'
    );
});

test('product base prices are nullable site sale switches', () => {
    const schemaSource = readRepoFile('shop_schema.sql');
    const migrationSource = readRepoFile('supabase/migrations/20260611_allow_site_scoped_shop_product_prices.sql');
    const adminSource = readRepoFile('js/admin-shop.js');

    assert.match(
        schemaSource,
        /price_points INT CHECK \(price_points >= 0\)/,
        'base schema should allow CN price_points to be NULL for non-CN products'
    );
    assert.doesNotMatch(
        schemaSource,
        /price_points INT NOT NULL/,
        'base schema should not force every product to be sold on CN'
    );
    assert.match(
        migrationSource,
        /ALTER TABLE public\.shop_products[\s\S]*ALTER COLUMN price_points DROP NOT NULL/,
        'migration should drop the legacy CN price NOT NULL constraint'
    );
    assert.match(
        migrationSource,
        /NULL means the product is not sold on the CN shop/,
        'migration should document the site-scoped sale-switch meaning'
    );
    assert.match(
        adminSource,
        /20260611_allow_site_scoped_shop_product_prices\.sql/,
        'admin save errors should point operators to the schema migration when EN-only creation hits an old database'
    );
});

test('SKU tier pricing is selected and persisted independently from product tier pricing', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const shopSource = readRepoFile('js/shop-client.js');
    const adminSource = readRepoFile('js/admin-shop.js');
    const adminStyles = readRepoFile('admin-studio.css');
    const pageStyles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const publicHandlerSource = readRepoFile('server/api-handlers/public/shop.js');
    const mutateSource = readRepoFile('server/api-handlers/admin/shop/mutate.js');
    const migrationSource = readRepoFile('supabase/migrations/20260523_add_shop_sku_quantity_rules.sql');
    const sharedInventoryMigrationSource = readRepoFile('supabase/migrations/20260604_add_shop_sku_shared_inventory_source.sql');

    assert.match(
        shopSource,
        /resolveQuantityPricingRulesForSku: function[\s\S]*normalizedSku\.quantity_rules[\s\S]*normalizedSku\.is_default !== true[\s\S]*return \[\]/,
        'storefront should use SKU tier rules first and avoid product fallback for non-default SKUs'
    );
    assert.match(
        shopSource,
        /selectPurchaseSku: function[\s\S]*this\.currentPurchase\.rules = this\.resolveQuantityPricingRulesForSku\(product, sku\)/,
        'changing purchase SKU should swap the active tier rules'
    );
    assert.match(
        adminSource,
        /getSkuSiteFieldMap: function[\s\S]*price_points_intl[\s\S]*quantity_rules_intl/,
        'admin SKU editor should map price and tier inputs to the active site'
    );
    assert.match(
        adminSource,
        /data-product-sku-site-field="price"[\s\S]*data-product-sku-site-field="quantity_rules"/,
        'admin SKU editor should expose only the active site price and tier fields'
    );
    assert.match(
        adminSource,
        /data-product-sku-field="price_points_intl"[\s\S]*data-product-sku-field="quantity_rules_intl"/,
        'admin SKU editor should preserve inactive-site SKU values in hidden fields'
    );
    assert.doesNotMatch(
        adminSource,
        /data-product-sku-field="price_points_intl"[^>]*class="modern-input/,
        'admin SKU editor should not show a second visible INTL price field while editing CN'
    );
    assert.match(
        adminSource,
        /shop-product-sku-row__main[\s\S]*shop-product-sku-row__tier-toggle[\s\S]*shop-product-sku-row__actions[\s\S]*shop-product-sku-row__tier-panel/,
        'admin SKU editor should keep the tier summary in the compact SKU row and expand only the input panel'
    );
    assert.doesNotMatch(
        adminHtml,
        /productBaseTierPricingSection|默认规格阶梯价|prodQuantityRulesContainer/,
        'product-level default-SKU tier pricing should not appear as a separate modal section'
    );
    assert.equal(
        adminHtml.includes('skuDarkTheme=20260531_ADMIN_STUDIO_PRODUCT_SKU_DARK_THEME_1'),
        true,
        'admin studio should cache-bust the SKU dark-theme stylesheet fix'
    );
    assert.equal(
        adminHtml.includes('sharedSkuInventory=20260604_SHARED_SKU_INVENTORY_POOL_LINK_1'),
        true,
        'admin studio should cache-bust shared SKU inventory editor custom-select assets'
    );
    assert.doesNotMatch(
        adminSource,
        /syncProductBaseTierPricingVisibility|shop-product-sku-editor__rows--single/,
        'admin should not keep visibility logic for the removed product-level tier editor'
    );
    assert.match(
        adminSource,
        /data-shop-action="product-toggle-sku-tier-editor"[\s\S]*data-product-sku-tier-summary[\s\S]*data-shop-input="product-sku-tier-input"/,
        'SKU tier pricing should default to a compact summary with explicit edit expansion'
    );
    assert.match(
        adminSource,
        /buildProductSkuInventorySourceOptions: function[\s\S]*data-product-sku-field="inventory_sku_id"[\s\S]*collectProductSkuEditorRows: function[\s\S]*inventory_sku_id:/,
        'admin SKU editor should expose and persist shared inventory source choices'
    );
    for (const marker of [
        'shop-sku-inventory-link',
        'shop-sku-inventory-link__swatch',
        'data-sku-inventory-pool-tone',
        'data-shop-custom-select-pool-tone',
        'data-shop-sku-inventory-tone',
        'shop-product-sku-row--shared-inventory',
        'shop-product-sku-row--inventory-source',
        'shop-product-sku-row--inventory-alias',
        'data-sku-inventory-pool'
    ]) {
        assert.equal(adminSource.includes(marker), true, `admin SKU editor should render shared inventory marker ${marker}`);
    }
    assert.match(
        adminSource,
        /getSkuInventoryPoolMeta: function[\s\S]*color: this\.getSkuInventoryPoolColor[\s\S]*tone: this\.getSkuInventoryPoolTone[\s\S]*isSharedAlias[\s\S]*isPoolSource[\s\S]*isLinked: isSharedAlias \|\| isPoolSource/,
        'admin SKU editor should derive one shared inventory pool tone for source and alias rows'
    );
    assert.match(
        adminSource,
        /refreshProductSkuInventorySourceOptions: function[\s\S]*this\.syncShopCustomSelect\(select\)[\s\S]*renderProductSkuEditor: function[\s\S]*this\.enhanceShopCustomSelects\(container\)[\s\S]*data-product-sku-field="inventory_sku_id"[^>]*data-shop-custom-select="true"[\s\S]*addProductSkuEditorRow: function[\s\S]*this\.enhanceShopCustomSelects\(row\)/,
        'admin SKU inventory source should render through the local custom-select menu instead of a native browser popup'
    );
    assert.match(
        adminSource,
        /buildProductSkusForEditor[\s\S]*productTierRules[\s\S]*nextSku\[field\] = productTierRules\[field\]/,
        'legacy product-level tier pricing should be migrated into the default SKU editor when SKU rules are empty'
    );
    assert.match(
        adminSource,
        /removeProductSkuEditorRow: function[\s\S]*openProductSkuDeleteGuardModal[\s\S]*exportProductSkuInventory: async function[\s\S]*skuId/,
        'removing an existing SKU should prompt operators to export that SKU inventory first'
    );
    assert.match(
        adminSource,
        /openProductSkuDeleteGuardModal: function[\s\S]*this\.bindOverlayDismiss\(overlay,[\s\S]*this\.closeDynamicModal\(modalId\)/,
        'SKU delete guard should close by clicking outside the modal'
    );
    assert.doesNotMatch(
        adminSource,
        /shop-sku-delete-guard-modal__close/,
        'SKU delete guard should not render a redundant top-right close button'
    );
    assert.match(
        adminStyles,
        /shop-product-sku-editor[\s\S]*container-type: inline-size;[\s\S]*shop-product-sku-row__main[\s\S]*minmax\(150px, 1\.25fr\)[\s\S]*shop-product-sku-row__tier-toggle\[aria-expanded="true"\][\s\S]*var\(--admin-studio-save-btn-bg, var\(--admin-studio-ui-blue, #769dca\)\)[\s\S]*shop-product-sku-row__tier-panel\[hidden\][\s\S]*shop-product-sku-row__inventory-source[\s\S]*shop-sku-delete-guard-modal/,
        'admin SKU editor should use a compact grid with shared inventory source and save-blue active controls'
    );
    assert.match(
        adminStyles,
        /\.shop-product-sku-row__inventory-source\.shop-custom-select \.shop-custom-select__trigger[\s\S]*min-height: 36px;[\s\S]*\.shop-product-sku-row__inventory-source\.shop-custom-select \.shop-custom-select__menu[\s\S]*width: max\(100%, min\(280px, calc\(100vw - 48px\)\)\);[\s\S]*\.shop-product-sku-row__inventory-source\.shop-custom-select \.shop-custom-select__option[\s\S]*min-height: 34px;/,
        'admin SKU inventory source custom-select should use compact local trigger/menu/option styling'
    );
    for (const marker of [
        '.shop-product-sku-row--shared-inventory',
        '.shop-sku-inventory-link',
        '.shop-sku-inventory-link__swatch',
        '.shop-sku-inventory-link__copy'
    ]) {
        assert.equal(adminStyles.includes(marker), true, `admin SKU editor styles should include shared inventory marker ${marker}`);
    }
    assert.match(
        adminStyles,
        /shop-product-sku-editor__header[\s\S]*margin-bottom: 10px;[\s\S]*shop-product-sku-editor__add[\s\S]*color: var\(--admin-studio-save-btn-bg, var\(--admin-studio-ui-blue, #769dca\)\)[\s\S]*shop-product-sku-row__toggle input[\s\S]*appearance: none;[\s\S]*shop-product-sku-row__toggle input:checked[\s\S]*border-color: var\(--admin-studio-save-btn-bg, var\(--admin-studio-ui-blue, #769dca\)\)/,
        'admin SKU add button should breathe away from rows and toggles should use custom save-blue controls'
    );
    assert.match(
        adminStyles,
        /20260531_ADMIN_STUDIO_PRODUCT_SKU_DARK_THEME_1[\s\S]*--shop-product-sku-row-bg: rgba\(15, 23, 42, 0\.48\);[\s\S]*\.shop-product-sku-row\s*\{[\s\S]*background: var\(--shop-product-sku-row-bg\);[\s\S]*\.shop-product-sku-row__toggle input\s*\{[\s\S]*background: var\(--shop-product-sku-check-bg\);/,
        'admin SKU editor should default to dark-theme row and toggle surfaces'
    );
    assert.doesNotMatch(
        adminStyles,
        /\.shop-product-sku-row\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.72\)/,
        'admin SKU rows should not default to a light card surface in dark theme'
    );
    assert.match(
        pageStyles,
        /#productModal \.shop-product-sku-row__inventory-source[\s\S]*#productModal \.shop-product-sku-row__tier-toggle\[aria-expanded="true"\][\s\S]*color: var\(--admin-studio-save-btn-bg, var\(--admin-studio-ui-blue, #769dca\)\) !important;[\s\S]*#productModal \.shop-product-sku-row__toggle input:checked[\s\S]*border-color: var\(--admin-studio-save-btn-bg, var\(--admin-studio-ui-blue, #769dca\)\) !important;/,
        'product modal light-theme overrides should keep SKU blue controls aligned with save-button color'
    );
    for (const marker of [
        '#productModal .shop-product-sku-row--shared-inventory',
        '#productModal .shop-sku-inventory-link',
        '#productModal .shop-sku-inventory-link__swatch'
    ]) {
        assert.equal(pageStyles.includes(marker), true, `product modal light theme should include shared inventory marker ${marker}`);
    }
    assert.doesNotMatch(
        adminStyles,
        /shop-product-sku-editor__rows--single|shop-product-sku-row__tiers/,
        'admin SKU styles should not keep duplicate single-SKU tier hiding rules'
    );
    assert.match(
        mutateSource,
        /inventorySourceSkuIds = normalizeInventorySourceSkuIds[\s\S]*inventory_sku_id: getCompatibilityInventorySkuId\(inventorySourceSkuIds, id\)[\s\S]*inventory_source_sku_ids: inventorySourceSkuIds[\s\S]*quantity_rules: normalizeSkuQuantityPricingRules\(source\.quantity_rules \?\? source\.quantityRules\)[\s\S]*quantity_rules_intl: normalizeSkuQuantityPricingRules/,
        'admin mutation should persist prioritized SKU inventory sources and tier rules'
    );
    assert.match(
        publicHandlerSource,
        /selectAttempts = \[[\s\S]*inventory_sku_id, inventory_source_sku_ids, manual_delivery, price_points, price_points_intl, quantity_rules, quantity_rules_intl[\s\S]*spec_values, inventory_sku_id, manual_delivery, price_points[\s\S]*spec_values, manual_delivery, price_points/,
        'public catalog should include SKU prioritized inventory sources, manual delivery, and tier pricing columns'
    );
    assert.match(
        migrationSource,
        /ADD COLUMN IF NOT EXISTS quantity_rules JSONB[\s\S]*fn_purchase_shop_item_core[\s\S]*v_sku\.quantity_rules[\s\S]*WHEN v_sku_is_default THEN v_product\.quantity_rules/,
        'incremental migration should add SKU tier fields and update purchase pricing fallback'
    );
    assert.match(
        sharedInventoryMigrationSource,
        /ADD COLUMN IF NOT EXISTS inventory_sku_id UUID[\s\S]*fn_sync_shop_product_sku_stock_counts[\s\S]*COALESCE\(s\.inventory_sku_id, s\.id\)[\s\S]*v_inventory_sku_id UUID := NULL[\s\S]*sku_id = v_inventory_sku_id[\s\S]*sku_id = COALESCE\(sku_id, v_inventory_sku_id\)/,
        'shared inventory migration should add the SKU source field and patch stock sync plus purchase inventory locking'
    );
});

test('coupon scope can target a concrete product SKU', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminDiscountsSource = readRepoFile('admin-discounts.js');
    const mutateSource = readRepoFile('server/api-handlers/admin/discounts/mutate.js');
    const publicHandlerSource = readRepoFile('server/api-handlers/public/shop.js');
    const shopSource = readRepoFile('js/shop-client.js');
    const migrationSource = readRepoFile('supabase/migrations/20260523_add_discount_scope_product_sku.sql');

    assert.match(
        adminHtml,
        /id="discountScopeProductSku"[\s\S]*data-discount-generate-select-trigger="scope-product-sku"/,
        'discount modal should expose an optional product SKU scope selector'
    );
    assert.match(
        adminDiscountsSource,
        /scope-product-sku[\s\S]*buildScopeProductSkuOptions[\s\S]*scope_product_sku_id: scopeProductSkuId/,
        'admin discount form should load SKU options and persist the selected SKU scope'
    );
    assert.match(
        mutateSource,
        /scopeProductSkuId[\s\S]*scope_product_sku_id: scopeType === 'product' \? scopeProductSkuId : null/,
        'admin discount mutation should normalize and save SKU scope'
    );
    assert.match(
        publicHandlerSource,
        /scope_product_sku_id[\s\S]*resolveScopeProductSkuSummary[\s\S]*formatScopeLabel\(discount, productById, skuById\)/,
        'public coupon payload should include SKU scope summaries'
    );
    assert.match(
        shopSource,
        /targetSkuId[\s\S]*this\.currentPurchase\.productSkuId[\s\S]*return targetSkuId === currentSkuId/,
        'storefront should filter SKU-scoped coupons against the selected SKU'
    );
    assert.match(
        migrationSource,
        /ADD COLUMN IF NOT EXISTS scope_product_sku_id UUID[\s\S]*该优惠码仅适用于指定商品规格/,
        'migration should add SKU scope and patch purchase/preview validation'
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
