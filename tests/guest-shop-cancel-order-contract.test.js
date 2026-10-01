const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
    path.resolve(__dirname, '../supabase/migrations/20260930_guest_shop_cancel_order.sql'),
    'utf8'
);

test('guest cancellation is a service-role atomic RPC with an unpaid gate', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_guest_shop_cancel_order\(/i);
    assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/i);
    assert.match(migration, /PERFORM public\.guest_shop_require_service_role\(\)/i);
    assert.match(migration, /SELECT \* INTO v_order[\s\S]*FROM public\.guest_shop_orders[\s\S]*FOR UPDATE/i);
    assert.match(migration, /SELECT \* INTO v_payment[\s\S]*FROM public\.guest_shop_payment_orders[\s\S]*FOR UPDATE/i);
    assert.match(migration, /v_order\.payment_status <> 'pending'/i);
    assert.match(migration, /v_payment\.status NOT IN \('pending', 'created'\)/i);
    assert.match(migration, /guest_shop_release_held_reservations\(v_order\.id, v_reason\)/i);
    assert.match(migration, /SET status = 'expired'/i);
    assert.match(migration, /SET payment_status = 'expired'/i);
    assert.match(migration, /guest_order_cancelled/i);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_guest_shop_cancel_order\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/i);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_cancel_order\(UUID, TEXT\) TO service_role/i);
});

test('cancellation keeps late-payment compensation on the existing paid-unfulfillable path', () => {
    assert.match(migration, /provider callback that arrives after cancellation/i);
    assert.doesNotMatch(migration, /fn_guest_shop_confirm_payment[\s\S]*v_payment\.status IN \('expired'/i);
});
