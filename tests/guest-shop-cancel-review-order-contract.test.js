const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
    path.resolve(__dirname, '../supabase/migrations/20261004_guest_shop_cancel_review_order.sql'),
    'utf8'
);

test('cancellation supports unpaid guest orders in review state', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_cancel_order\(/i);
    assert.match(migration, /v_order\.payment_status NOT IN \('pending', 'review'\)/i);
    assert.match(migration, /v_payment\.status NOT IN \('pending', 'created', 'review'\)/i);
    assert.match(migration, /guest_shop_release_held_reservations\(v_order\.id, v_reason\)/i);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_cancel_checkout_batch\(/i);
    assert.match(migration, /v_batch\.payment_status NOT IN \('pending', 'review'\)/i);
    assert.match(migration, /v_payment\.status NOT IN \('pending', 'created', 'review'\)/i);
});
