const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260503_sync_shop_stock_count_from_inventory.sql'
);

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop stock-count migration derives card inventory from available delivery rows', () => {
    const source = fs.readFileSync(MIGRATION_PATH, 'utf8');

    const requiredMarkers = [
        'CREATE OR REPLACE FUNCTION public.fn_sync_shop_product_stock_count(p_product_id UUID)',
        "LOWER(BTRIM(COALESCE(status, ''))) = 'available'",
        'UPDATE public.shop_products',
        'SET stock_count = v_stock_count',
        'CREATE OR REPLACE FUNCTION public.fn_trigger_update_stock_count()',
        'DROP TRIGGER IF EXISTS tr_shop_inventory_stock ON public.shop_inventory;',
        'CREATE TRIGGER tr_shop_inventory_stock',
        'AFTER INSERT OR UPDATE OR DELETE ON public.shop_inventory',
        "WHERE LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'",
        'REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM authenticated;'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `migration should contain ${marker}`);
    }

    assert.equal(
        /SET\s+stock_count\s*=\s*stock_count\s*[-+]/i.test(source),
        false,
        'stock sync should recalculate from shop_inventory instead of incrementing/decrementing a stale counter'
    );
});

test('shop frontend refreshes catalog state after inventory exhaustion errors', () => {
    const source = readRepoFile(path.join('js', 'shop-client.js'));

    assert.match(
        source,
        /isInventoryStockErrorMessage: function \(message = ''\) \{[\s\S]*库存不足[\s\S]*out\\s\*of\\s\*stock[\s\S]*\}/,
        'shop-client.js should classify inventory exhaustion separately from payment errors'
    );
    assert.match(
        source,
        /refreshProductsAfterInventoryFailure: async function \(\) \{[\s\S]*await this\.loadProducts\(\{ forceRefresh: true \}\);[\s\S]*this\.sanitizeCartState\(\);[\s\S]*this\.renderCart\(\);[\s\S]*this\.renderCartCheckoutModal\(\);[\s\S]*\}/,
        'shop-client.js should force-refresh product and cart state after stock exhaustion'
    );
    assert.match(
        source,
        /else if \(this\.isInventoryStockErrorMessage\(errMsg\)\) \{[\s\S]*this\.closePurchaseModal\(\);[\s\S]*void this\.refreshProductsAfterInventoryFailure\(\);/,
        'single-product redeem failures caused by stock exhaustion should close stale checkout UI and refresh stock'
    );
    assert.match(
        source,
        /if \(this\.isInventoryStockErrorMessage\(errorMessage\)\) \{[\s\S]*void this\.refreshProductsAfterInventoryFailure\(\);[\s\S]*\}\s*this\.showShopToast\(`❌ \$\{errorMessage\}`/,
        'cart checkout stock failures should refresh stock before leaving the toast visible'
    );
});
