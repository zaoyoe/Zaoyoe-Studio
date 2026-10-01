'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const AUDIT_PATH = path.join(
    __dirname,
    '..',
    'supabase',
    'sandbox',
    'guest_shop_refund_redemption_audit_readonly.sql'
);

function readAudit() {
    return fs.readFileSync(AUDIT_PATH, 'utf8');
}

test('refund redemption audit is read-only and covers all successful-refund state markers', () => {
    const sql = readAudit();

    assert.match(sql, /WITH sites\(site\) AS/u);
    assert.match(sql, /r\.returned_at IS NULL/u);
    assert.match(sql, /o\.refund_status = 'succeeded'/u);
    assert.match(sql, /o\.payment_status = 'refunded'/u);
    assert.match(sql, /p\.status = 'refunded'/u);
    assert.match(sql, /LEFT JOIN public\.guest_shop_payment_orders/u);
    assert.match(sql, /refund_state_disagreement_rows/u);
    assert.match(sql, /unreturned_discount_amount_total/u);
    assert.match(sql, /'no_unreturned_refund_candidates'/u);
    assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|CALL|DO)\b/imu);
});

test('refund redemption audit emits aggregates only and avoids identifying data', () => {
    const sql = readAudit();

    assert.match(sql, /COUNT\(DISTINCT c\.order_id\)/u);
    assert.match(sql, /GROUP BY c\.site/u);
    assert.match(sql, /VALUES \('cn'::TEXT\), \('intl'::TEXT\)/u);
    const commentText = sql.replace(/^--\s?/gmu, '');
    assert.match(commentText, /no order IDs,[\s\S]*order numbers,[\s\S]*buyer data/u);
    assert.doesNotMatch(sql, /buyer_contact_hash|request_ip_hash|request_device_hash|provider_order_no|claim_secret_hash/u);
    assert.doesNotMatch(sql, /SELECT\s+(?:r\.)?(?:order_id|code|buyer_id)\b/iu);
});
