const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop purchase guidance flow refreshes latest notes and versions prefetched product snapshots', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const homeBootstrapSource = readRepoFile(path.join('js', 'index-home-bootstrap.js'));
    const shopHandlerSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'shop.js'));
    const shopGuidanceApiSource = readRepoFile(path.join('api', 'shop', 'product-guidance.js'));
    const walletModalSource = readRepoFile(path.join('js', 'components', 'WalletModal.js'));

    assert.match(
        shopClientSource,
        /const SHOP_PREFETCH_SCHEMA_VERSION = '20260413_PURCHASE_GUIDANCE_2';/,
        'shop-client.js should define a dedicated schema version for prefetched shop payloads'
    );
    assert.match(
        shopClientSource,
        /this\.openPurchaseModal\(productId, productName, productNameEn, price, rules, quantityCap, purchaseNotes, usageInstructions, \{\s+category: productCategory,\s+sourceContext\s+\}\);\s+void this\.refreshCurrentPurchaseGuidance\(productId\);\s+void this\.syncPurchaseAccessAfterOpen\(productId, quantityCap\);/s,
        'shop purchase clicks should open the modal immediately, refresh the latest product guidance, and sync purchase access in the background'
    );
    assert.doesNotMatch(
        shopClientSource,
        /buyProduct: async function[\s\S]*?supabaseClient\.auth\.getSession\(\)[\s\S]*?openPurchaseModal/s,
        'shop purchase clicks should no longer block the modal behind an upfront getSession() login check'
    );
    assert.match(
        shopClientSource,
        /confirmPurchase: async function \(\) \{\s+const token = await this\.getAccessToken\(\);\s+if \(!token\) \{\s+this\.promptLoginForPurchase/s,
        'confirmPurchase should prompt login only when the user actually tries to submit the order'
    );
    assert.match(
        shopClientSource,
        /const prefetchVersionMatches = prefetch\?\.version === SHOP_PREFETCH_SCHEMA_VERSION;/,
        'shop-client.js should reject stale shop_prefetch payloads from older schemas'
    );
    assert.match(
        shopClientSource,
        /revalidatePrefetchedShopData: async function \(\)/,
        'shop-client.js should expose a background revalidation path for prefetched shop data'
    );
    assert.match(
        shopClientSource,
        /if \(usedPrefetch\) \{\s+void this\.revalidatePrefetchedShopData\(\);\s+\}/s,
        'shop init should revalidate prefetched shop data after the instant first paint'
    );
    assert.match(
        shopClientSource,
        /loadCategoryFilters: async function \(\{ forceRefresh = false \} = \{\}\)/,
        'shop category loading should support force-refresh so prefetched categories can be revalidated'
    );
    assert.match(
        shopClientSource,
        /sessionStorage\.setItem\('shop_prefetch', JSON\.stringify\(\{\s+version: SHOP_PREFETCH_SCHEMA_VERSION,/s,
        'shop-client.js should persist shop_prefetch with an explicit schema version'
    );
    assert.match(
        homeBootstrapSource,
        /const SHOP_PREFETCH_SCHEMA_VERSION = '20260413_PURCHASE_GUIDANCE_2';/,
        'homepage shop prefetch should use the same guidance-aware schema version'
    );
    assert.match(
        homeBootstrapSource,
        /sessionStorage\.setItem\('shop_prefetch', JSON\.stringify\(\{\s+version: SHOP_PREFETCH_SCHEMA_VERSION,/s,
        'homepage shop prefetch should stamp the schema version into sessionStorage'
    );
    assert.match(
        shopClientSource,
        /fetch\('\/api\/shop\/product-guidance'/,
        'shop-client.js should load latest purchase guidance through the dedicated server route'
    );
    assert.match(
        shopClientSource,
        /\.from\('shop_products'\)\s*\.select\('show_purchase_notes, purchase_notes, show_usage_instructions, usage_instructions'\)/s,
        'shop-client.js should keep a direct product guidance fallback for local and static preview environments'
    );
    assert.match(
        shopHandlerSource,
        /'product-guidance': async function productGuidanceHandler/,
        'shared shop handlers should expose a product-guidance route'
    );
    assert.doesNotMatch(
        shopHandlerSource,
        /shop-product-guidance:user:/,
        'product guidance route should no longer depend on an authenticated user rate-limit bucket'
    );
    assert.match(
        shopHandlerSource,
        /usage_instructions: normalizeGuidanceText\(responseData\.usage_instructions\) \|\| guidanceData\?\.usage_instructions \|\| null/,
        'purchase responses should fall back to the server-side product guidance when the RPC omits usage instructions'
    );
    assert.match(
        shopHandlerSource,
        /guidance:\s*\{\s*usage_instructions: usageInstructions \|\| null,\s*has_usage_instructions: usageInstructions\.length > 0\s*\}/s,
        'order detail responses should carry guidance metadata so wallet order details can show usage instructions'
    );
    assert.match(
        shopGuidanceApiSource,
        /\}\)\['product-guidance'\];/,
        'standalone product-guidance API route should delegate to the shared shop handlers'
    );
    assert.match(
        walletModalSource,
        /detail\?\.guidance\?\.usage_instructions/,
        'wallet order detail modal should read usage instructions from the server-side order detail payload'
    );
    assert.match(
        walletModalSource,
        /renderStoredWalletOrderRichText\(usageInstructions\)/,
        'wallet order detail modal should render usage instructions with rich-text fallback support'
    );
});
