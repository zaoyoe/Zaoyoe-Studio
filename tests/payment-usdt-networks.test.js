'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const networks = require('../api/_lib/payments/usdt-networks');

test('USDT registry validates incoming addresses and refuses unsupported assets and conflicting Memo fields', () => {
    assert.deepEqual(networks.NETWORKS.map(item => item.currency), ['usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20']);
    for (const value of ['usdterc20', 'ton', 'trx', 'USDTBSC', null, '']) assert.throws(() => networks.requireNetwork(value));
    assert.equal(networks.requireNetwork().currency, 'usdtbsc');
    for (const [currency, address] of [['usdtbsc', '0x' + 'a'.repeat(40)], ['usdtmatic', '0x' + 'a'.repeat(40)],
        ['usdttrc20', 'T' + 'a'.repeat(33)], ['usdtton', 'EQ' + 'a'.repeat(46)], ['usdtton', '-12:' + 'a'.repeat(64)]]) {
        assert.equal(networks.validAddress(currency, address), true);
        assert.equal(networks.validAddress(currency, address + '!'), false);
    }
    assert.equal(networks.validAddress('usdtton', '0x' + 'a'.repeat(40)), false);
    assert.equal(networks.paymentMemo({ extra_id: '123' }), '123');
    assert.equal(networks.paymentMemo({ payin_extra_id: '123', extra_id: '123' }), '123');
    assert.equal(networks.paymentMemo({ payin_extra_id: '123', extra_id: '456' }), null);
    assert.equal(networks.paymentMemo({ extra_id: '123\n456' }), null);
});

test('network migration keeps settlement, cancellation, expiry and lease protections with service-only immutable bindings', () => {
    const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261016_payment_usdt_network_selection.sql'), 'utf8');
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /COMMIT;\s*$/);
    for (const { currency } of networks.NETWORKS) assert.ok(sql.includes(`'${currency}'`));
    for (const name of ['fn_tg_purchase_network_quote', 'fn_tg_bind_purchase_network_quote']) {
        assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}`));
    }
    assert.match(sql, /FOR UPDATE/);
    assert.match(sql, /BEFORE UPDATE OR DELETE/);
    assert.match(sql, /Cannot bind network after order creation/);
    assert.match(sql, /payment_network_mismatch/);
    assert.match(sql, /checkout_lease_token IS DISTINCT FROM p_lease_token/);
    assert.match(sql, /actually_paid'\)::NUMERIC < \(v_order\.crypto_checkout->>'pay_amount/);
    assert.match(sql, /payment_received_after_cancellation/);
    assert.match(sql, /payment_received_after_expiry/);
    assert.match(sql, /coalesce\(p_verified_payload->>'payin_extra_id', ''\) IS DISTINCT FROM coalesce\(v_order\.crypto_checkout->>'payin_extra_id', ''\)/);
    assert.match(sql, /FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /TO service_role;/);
});
