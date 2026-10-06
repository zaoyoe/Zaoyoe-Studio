'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(ROOT, 'supabase/migrations/20260923_guest_shop_refund_state_hardening.sql');
const VERIFY_PATH = path.join(ROOT, 'supabase/migrations/20260923_verify_guest_shop_refund_state_hardening.sql');
const PRIOR_REFUND_SOURCE = path.join(ROOT, 'supabase/migrations/20260918_guest_shop_qualify_update_set_status_columns.sql');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function functionBlock(sql, name) {
    const start = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i'));
    assert.notEqual(start, -1, `missing ${name} definition`);
    const end = sql.indexOf('$$;', start);
    assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
    return sql.slice(start, end + 3);
}

function normalizedRefundBranches(sql) {
    const normalized = sql.toLowerCase().replace(/\s+/g, '');
    const successStart = normalized.indexOf("ifv_status='succeeded'then");
    const failureStart = normalized.indexOf(
        "elseupdatepublic.guest_shop_payment_orderssetstatus=casewhenv_status='manual_review'"
    );
    assert.notEqual(successStart, -1, 'refund success branch should be present');
    assert.ok(failureStart > successStart, 'refund failure branch should follow the success branch');
    return {
        success: normalized.slice(successStart, failureStart),
        failure: normalized.slice(failureStart)
    };
}

function hasRefundReturnOnlyInSuccessBranch(sql) {
    const { success, failure } = normalizedRefundBranches(sql);
    const release = "guest_shop_release_held_reservations(p_order_id,'refund_succeeded')";
    const coupon = "fn_guest_shop_return_discount_reservation(p_order_id,'refund_succeeded')";
    const releaseAt = success.indexOf(release);
    const couponAt = success.indexOf(coupon);
    return releaseAt >= 0
        && couponAt > releaseAt
        && !failure.includes('guest_shop_release_held_reservations(')
        && !failure.includes('fn_guest_shop_return_discount_reservation(');
}

test('refund hardening preserves the current refund RPC and adds idempotent promo return only on success', () => {
    const migration = read(MIGRATION_PATH);
    const prior = read(PRIOR_REFUND_SOURCE);
    const actual = functionBlock(migration, 'fn_guest_shop_record_refund_result');
    const expectedBase = functionBlock(prior, 'fn_guest_shop_record_refund_result');

    const normalizedActual = actual.replace(
        /-- A successful refund reverses the coupon usage[\s\S]*?PERFORM public\.fn_guest_shop_return_discount_reservation\([\s\S]*?\);/,
        ''
    ).replace(/\s+/g, ' ').trim();
    assert.equal(normalizedActual, expectedBase.replace(/\s+/g, ' ').trim());
    assert.equal(hasRefundReturnOnlyInSuccessBranch(actual), true);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_guest_shop_record_refund_result\(UUID, TEXT, TEXT, TEXT, TEXT\)[\s\S]*?FROM PUBLIC, anon, authenticated/u);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_record_refund_result\(UUID, TEXT, TEXT, TEXT, TEXT\)[\s\S]*?TO service_role/u);
});

test('refund verification rejects a return helper moved into the failure branch', () => {
    const actual = functionBlock(read(MIGRATION_PATH), 'fn_guest_shop_record_refund_result');
    const helperCall = actual.match(/\s*PERFORM public\.fn_guest_shop_return_discount_reservation\(\s*p_order_id,\s*'refund_succeeded'\s*\);/iu);
    assert.ok(helperCall, 'success branch should contain the return helper call');

    const withoutSuccessCall = actual.replace(helperCall[0], '');
    const failureBranch = /ELSE\s+UPDATE public\.guest_shop_payment_orders\s+SET status = CASE WHEN v_status = 'manual_review'/iu;
    const failureStart = withoutSuccessCall.search(failureBranch);
    assert.notEqual(failureStart, -1, 'refund failure branch should be present');
    const outerEnd = withoutSuccessCall.lastIndexOf('\n    END IF;');
    assert.ok(outerEnd > failureStart, 'outer refund status branch should be present');
    const movedToFailure = `${withoutSuccessCall.slice(0, outerEnd)}${helperCall[0]}${withoutSuccessCall.slice(outerEnd)}`;

    assert.equal(hasRefundReturnOnlyInSuccessBranch(movedToFailure), false);
});

test('manual-review trigger only blocks automatic downgrade to pending', () => {
    const migration = read(MIGRATION_PATH);
    const guard = functionBlock(migration, 'guest_shop_preserve_refund_manual_review');

    assert.match(guard, /OLD\.refund_status = 'manual_review'/u);
    assert.match(guard, /NEW\.refund_status = 'pending'/u);
    assert.match(guard, /NEW\.refund_status := 'manual_review'/u);
    assert.match(migration, /BEFORE UPDATE OF refund_status ON public\.guest_shop_orders[\s\S]*?EXECUTE FUNCTION public\.guest_shop_preserve_refund_manual_review\(\)/u);
    assert.doesNotMatch(migration, /allow_guest_purchase\s*=\s*true/iu);
});

test('refund state verification is read-only and checks both database protections', () => {
    const verify = read(VERIFY_PATH);
    assert.match(verify, /SELECT check_name, ok, detail/u);
    assert.match(verify, /refund_returns_promo_reservation/u);
    assert.match(verify, /elseupdatepublic\.guest_shop_payment_orderssetstatus=casewhenv_status=''manual_review''/iu);
    assert.match(verify, /performpublic\.guest_shop_release_held_reservations\(p_order_id,''refund_succeeded''\);/u);
    assert.match(verify, /fn_guest_shop_return_discount_reservation\(p_order_id,''refund_succeeded''\)/u);
    assert.ok(
        verify.indexOf("performpublic.guest_shop_release_held_reservations(p_order_id,''refund_succeeded'');")
            < verify.indexOf("performpublic.fn_guest_shop_return_discount_reservation(p_order_id,''refund_succeeded'');"),
        'verification must require stock release before the coupon return'
    );
    assert.match(verify, /substring\(\s*b\.normalized_definition\s+from\s+b\.success_branch_start\s+for\s+b\.failure_branch_start\s*-\s*b\.success_branch_start\s*\)/iu);
    assert.match(verify, /substring\(\s*b\.normalized_definition\s+from\s+b\.failure_branch_start\s*\)/iu);
    assert.match(verify, /manual_review_guard_function/u);
    assert.match(verify, /manual_review_guard_trigger/u);
    assert.match(verify, /refund_rpc_security/u);
    assert.doesNotMatch(verify, /^(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\s+/imu);
});

const GUARD_MIGRATION_PATH = path.join(ROOT, 'supabase/migrations/20260929_guest_shop_refund_manual_review_guard.sql');

test('20260929 restores the historical manual-review guard without rewriting the refund RPC', () => {
    const historical = functionBlock(read(MIGRATION_PATH), 'guest_shop_preserve_refund_manual_review');
    const restored = functionBlock(read(GUARD_MIGRATION_PATH), 'guest_shop_preserve_refund_manual_review');
    const normalize = (sql) => sql.replace(/\s+/gu, ' ').trim();
    assert.equal(normalize(restored), normalize(historical));

    const migration = read(GUARD_MIGRATION_PATH);
    assert.match(migration, /^BEGIN;/mu);
    assert.match(migration, /^COMMIT;/mu);
    assert.match(migration, /SET search_path = public, pg_temp/u);
    assert.doesNotMatch(migration, /SECURITY DEFINER/u);
    assert.doesNotMatch(migration, /fn_guest_shop_record_refund_result/u);
    assert.doesNotMatch(migration, /shop_products/u);
    assert.doesNotMatch(migration, /^(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/imu);
    assert.match(
        migration,
        /REVOKE ALL ON FUNCTION public\.guest_shop_preserve_refund_manual_review\(\)[\s\S]*?FROM PUBLIC, anon, authenticated/u
    );
    // 20260923 only revoked browser execute. Once this function exists, the
    // promo privilege probe requires a service_role grant or row 10 FAILs.
    assert.match(
        migration,
        /GRANT EXECUTE ON FUNCTION public\.guest_shop_preserve_refund_manual_review\(\)[\s\S]*?TO service_role/u
    );
    assert.match(
        migration,
        /BEFORE UPDATE OF refund_status ON public\.guest_shop_orders[\s\S]*?EXECUTE FUNCTION public\.guest_shop_preserve_refund_manual_review\(\)/u
    );
    assert.match(migration, /Do not rerun/u);
    assert.match(migration, /20260923_guest_shop_refund_state_hardening\.sql/u);
    assert.match(migration, /20260928_guest_shop_promo_return_by_redemption_date\.sql/u);
});
