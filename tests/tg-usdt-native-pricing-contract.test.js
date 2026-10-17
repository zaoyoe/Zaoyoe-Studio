'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');
const migration = read('20261016_tg_purchase_usdt_native_pricing.sql');
const verify = read('20261016_verify_tg_purchase_usdt_native_pricing.sql');
function definition(sql, name) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0); const end = sql.indexOf('\n$$;', start); assert.ok(end > start);
    return sql.slice(start, end + 4);
}
test('native-pricing migration changes only currency binding in the latest cancelled/expired settlement function', () => {
    const original = definition(read('20261016_tg_purchase_cancellation_expiry.sql'), 'fn_tg_confirm_purchase_payment');
    const expected = original.replace("p_verified_payload->>'price_currency' IS DISTINCT FROM 'usd'", "p_verified_payload->>'price_currency' IS DISTINCT FROM v_order.crypto_checkout->>'price_currency'");
    assert.notEqual(expected, original);
    assert.equal(definition(migration, 'fn_tg_confirm_purchase_payment'), expected);
    assert.doesNotMatch(migration, /UPDATE public\.tg_purchase_orders SET crypto_checkout|UPDATE public\.system_config|DROP TABLE/);
});
test('native-pricing validator retains legacy USD and requires exact equality between USDT price and payable amounts', () => {
    const original = definition(read('20261015_tg_purchase_usdt_payments.sql'), 'tg_valid_purchase_crypto_checkout');
    const expected = original.replace("OR p_checkout->>'price_currency' IS DISTINCT FROM 'usd'", "OR coalesce(p_checkout->>'price_currency', '') NOT IN ('usd', 'usdtbsc')")
        .replace("RETURN (p_checkout->>'pay_amount')::NUMERIC > 0", "RETURN (p_checkout->>'pay_amount')::NUMERIC > 0\n        AND (p_checkout->>'price_currency' = 'usd' OR (p_checkout->>'pay_amount')::NUMERIC * 100 = (p_checkout->>'price_amount_minor')::BIGINT)");
    assert.equal(definition(migration, 'tg_valid_purchase_crypto_checkout'), expected);
});
test('native pricing has a service-only readiness contract and read-only operator verification', () => {
    assert.match(migration, /Apply TG cancellation\/expiry migration first/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_tg_usdt_pricing_contract\(\) FROM PUBLIC, anon, authenticated/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_tg_usdt_pricing_contract\(\) TO service_role/);
    assert.match(verify, /BEGIN READ ONLY/);
    for (const fragment of ['10.860000000000000001', '10.859999999999999999', 'Legacy USD checkout compatibility', 'payment_received_after_cancellation', 'payment_received_after_expiry', 'has_function_privilege', 'TG crypto quote is immutable']) assert.ok(verify.includes(fragment), fragment);
    assert.doesNotMatch(verify, /^\s*(?:INSERT INTO|UPDATE public|DELETE FROM)/m);
});
