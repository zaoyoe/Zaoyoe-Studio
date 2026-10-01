'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const shopClient = read('js/shop-client.js');
const guestClient = read('js/guest-shop-client.js');
const handler = read('server/api-handlers/public/guest-shop.js');
const migration = read('supabase/migrations/20260926_guest_shop_cart_checkout_batch.sql');
const ambiguityFix = read('supabase/migrations/20260927_guest_shop_cart_checkout_batch_ambiguity_fix.sql');
const returningAmbiguityFix = read('supabase/migrations/20260927_guest_shop_cart_checkout_batch_returning_ambiguity_fix.sql');
const batchCancelMigration = read('supabase/migrations/20261001_guest_shop_checkout_batch_cancel_and_expiry.sql');
const batchCancelInventoryColumnFix = read('supabase/migrations/20261002_guest_shop_checkout_batch_cancel_inventory_column_fix.sql');
const fulfillmentReconcileMigration = read('supabase/migrations/20260929_guest_shop_checkout_batch_fulfillment_reconcile.sql');
const worker = read('server/guest-shop-worker.js');

function functionBlock(source, name) {
    const start = source.indexOf(name);
    assert.ok(start >= 0, `missing ${name}`);
    const end = source.indexOf('\n    }', start);
    assert.ok(end > start, `${name} should have a body`);
    return source.slice(start, end + 6);
}

test('guest cash cart checkout blocks item discounts before opening a payment flow', () => {
    const helper = functionBlock(shopClient, 'getGuestCashBatchDiscountEntry');
    assert.match(helper, /appliedDiscount/);
    assert.match(helper, /discountAmount/);
    assert.match(shopClient, /getGuestCashBatchDiscountEntry\(entries\)[\s\S]*?guestCashDiscountUnsupportedToast/);
    assert.match(shopClient, /guestCashDiscountUnsupportedToast:\s*['"][^'"]+游客现金|guestCashDiscountUnsupportedToast:\s*['"][^'"]+Guest cash/);
});

test('guest batch preview quotes every item from the server and then uses committed total_amount', () => {
    const start = guestClient.indexOf('async function startGuestBatchCheckout');
    const create = guestClient.indexOf('async function createBatchOrder');
    assert.ok(start >= 0 && create > start, 'batch checkout functions must remain ordered');
    const startBlock = guestClient.slice(start, create);
    assert.match(startBlock, /Promise\.all\(normalized\.map/);
    assert.match(startBlock, /requestJson\(`\$\{PREVIEW_ENDPOINT\}\?\$\{query\.toString\(\)\}`/);
    assert.match(startBlock, /quote\?\.price\?\.subtotal/);
    assert.doesNotMatch(startBlock, /entry\?\.subtotal/);
    assert.doesNotMatch(startBlock, /entry\?\.finalTotal/);
    assert.match(guestClient, /applyBatchPaymentPricing\(batch\)/);
    assert.match(guestClient, /payment_pricing/);
});

test('guest batch checkout rejects incomplete product or SKU rows instead of silently dropping them', () => {
    const normalizer = functionBlock(guestClient, 'function normalizeBatchEntries');
    assert.doesNotMatch(normalizer, /\.filter\(/);
    assert.match(guestClient, /function hasInvalidBatchEntry\(entries\)[\s\S]*?!entry\.productId \|\| !entry\.skuId/);
    assert.match(guestClient, /if \(hasInvalidBatchEntry\(normalized\)\) return \{ started: false, reason: 'invalid_item' \}/);
    assert.match(guestClient, /!entries\.length \|\| hasInvalidBatchEntry\(entries\)/);
    assert.match(shopClient, /reason === 'invalid_item'\) return copy\.guestCashCartItemInvalidToast/);
});

test('batch endpoint rejects client supplied discount amounts and never treats them as payment input', () => {
    assert.match(handler, /guest_checkout_discount_unsupported/);
    assert.match(handler, /discountAmount[\s\S]*finalTotal[\s\S]*appliedDiscount/);
    assert.match(handler, /keys\.some\(\(key\) => discountKeys\.has\(key\)\)/);
    assert.doesNotMatch(handler, /items:\s*items\.map\([\s\S]*finalTotal/);
});

test('batch checkout persists one server-owned payable amount including the channel surcharge', () => {
    assert.match(handler, /const persisted = await persistCheckoutBatchPayableAmounts\([\s\S]*?batch,[\s\S]*?payment,[\s\S]*?paymentProviderSummaries[\s\S]*?\);/);
    assert.match(handler, /expected_amount: targetAmount/);
    assert.match(handler, /total_amount: targetAmount/);
    assert.match(handler, /paymentPricing\.payable_amount/);
    assert.match(handler, /payment_pricing: paymentPricing/);
});

test('batch provider references are unique for non-null provider order numbers', () => {
    assert.match(
        migration,
        /CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_checkout_payments_provider_ref[\s\S]*?ON public\.guest_shop_checkout_payments\(provider, provider_order_no\)[\s\S]*?WHERE provider_order_no IS NOT NULL/i
    );
});

test('checkout handler maps known batch RPC rejections to actionable client errors', () => {
    assert.match(handler, /guest_delivery_mode_unsupported:[\s\S]*?guest_checkout_batch_invalid_item:[\s\S]*?guest_credit_price_unavailable:[\s\S]*?guest_idempotency_conflict:/);
});

test('legacy batch checkout migration qualifies the SKU lookup table columns', () => {
    assert.match(migration, /SELECT \* INTO v_sku FROM public\.shop_product_skus WHERE id = v_sku_id AND product_id = v_product_id FOR UPDATE;/);
    assert.match(ambiguityFix, /fn_guest_shop_create_checkout_batch\(text, jsonb, text, text, text, text, text, integer\)/);
    assert.match(ambiguityFix, /sku[.]id = v_sku_id AND sku[.]product_id = v_product_id FOR UPDATE/);
    assert.match(ambiguityFix, /guest_checkout_batch_sku_lookup_patch_target_not_found/);
    assert.match(ambiguityFix, /guest_checkout_batch_sku_lookup_patch_verification_failed/);
});

test('batch checkout migration qualifies INSERT RETURNING batch_no against the output variable', () => {
    assert.match(migration, /RETURNS TABLE \([\s\S]*?batch_no TEXT[\s\S]*?\)[\s\S]*?RETURNING id, batch_no INTO v_batch_id, v_batch_no;/);
    assert.match(returningAmbiguityFix, /RETURNING[\s\S]*?id[\s\S]*?batch_no[\s\S]*?INTO[\s\S]*?v_batch_id[\s\S]*?v_batch_no/);
    assert.match(returningAmbiguityFix, /RETURNING guest_shop_checkout_batches[.]id, guest_shop_checkout_batches[.]batch_no INTO v_batch_id, v_batch_no;/);
    assert.match(returningAmbiguityFix, /guest_checkout_batch_returning_patch_target_not_found/);
    assert.match(returningAmbiguityFix, /guest_checkout_batch_returning_patch_verification_failed/);
});

test('batch cancellation locks payment before batch and releases all held inventory atomically', () => {
    assert.match(batchCancelMigration, /FUNCTION public\.fn_guest_shop_cancel_checkout_batch\(/i);
    assert.match(batchCancelMigration, /FROM public\.guest_shop_checkout_payments[\s\S]*?FOR UPDATE;[\s\S]*?FROM public\.guest_shop_checkout_batches[\s\S]*?FOR UPDATE;/i);
    assert.match(batchCancelMigration, /guest_shop_release_checkout_batch_reservations\(v_batch\.id, v_reason\)/i);
    assert.match(batchCancelMigration, /v_payment\.status NOT IN \('pending', 'created'\)/i);
    assert.match(batchCancelMigration, /r\.status = 'consumed'/i);
    assert.match(batchCancelMigration, /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_cancel_checkout_batch\(UUID, TEXT\) TO service_role/i);
    assert.match(worker, /fn_guest_shop_expire_checkout_batches/);
});

test('batch cancellation releases inventory without touching the absent shop_inventory.updated_at column', () => {
    assert.match(batchCancelInventoryColumnFix, /CREATE OR REPLACE FUNCTION public\.guest_shop_release_checkout_batch_reservations\(/i);
    assert.match(batchCancelInventoryColumnFix, /UPDATE public\.shop_inventory[\s\S]*SET status = 'available'/i);
    assert.doesNotMatch(batchCancelInventoryColumnFix, /SET status = 'available'\s*,\s*updated_at\s*=/i);
    assert.match(batchCancelInventoryColumnFix, /GRANT EXECUTE ON FUNCTION public\.guest_shop_release_checkout_batch_reservations\(UUID, TEXT\) TO service_role/i);
});

test('batch claim reconciles consumed reservations before returning idempotent contents', () => {
    assert.match(fulfillmentReconcileMigration, /v_consumed\s*=\s*v_count[\s\S]*?UPDATE public\.guest_shop_checkout_items[\s\S]*?fulfillment_status\s*=\s*'delivered'/i);
    assert.match(fulfillmentReconcileMigration, /v_consumed\s*=\s*v_count[\s\S]*?UPDATE public\.guest_shop_checkout_batches[\s\S]*?fulfillment_status\s*=\s*'delivered'/i);
    assert.match(fulfillmentReconcileMigration, /last_error_code\s*=\s*NULL[\s\S]*?last_error_message\s*=\s*NULL/i);
    assert.match(fulfillmentReconcileMigration, /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_claim_checkout_batch\(UUID\) TO service_role/i);
});
