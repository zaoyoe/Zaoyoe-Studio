const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260415_add_public_claim_discount_rpc.sql'
);

test('public claim RPC serializes user claims before inserting coupon assets', () => {
    const source = fs.readFileSync(migrationPath, 'utf8');

    assert.match(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_claim_public_discount\(/,
        'migration should add the atomic public-claim RPC'
    );
    assert.match(
        source,
        /pg_advisory_xact_lock\(60425,\s*hashtext\(v_lock_name\)\)/,
        'claim RPC should serialize requests per user and discount'
    );
    assert.match(
        source,
        /SELECT COUNT\(\*\)::INT[\s\S]*FROM public\.discount_user_assets[\s\S]*a\.user_id = v_effective_user_id[\s\S]*a\.discount_id = v_discount\.id/,
        'claim RPC should enforce the per-user claim limit inside the same transaction'
    );
    assert.match(
        source,
        /你已达到该优惠券的领取上限/,
        'claim RPC should keep the existing over-limit message'
    );
});
