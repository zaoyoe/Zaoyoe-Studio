'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase', 'migrations', '20261113_security_hardening_phase0_phase1.sql');

function readMigration() {
    return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

test('phase 0 + phase 1 migration exists and revokes dangerous public/authenticated table & RPC privileges', () => {
    const sql = readMigration();

    assert.match(sql, /REVOKE ALL ON TABLE public\.rate_limit_buckets FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.shop_cdk_secrets FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /DROP POLICY IF EXISTS "Authenticated users can insert unlocks" ON public\.prompt_unlocks;/);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.prompt_unlocks FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /DROP FUNCTION IF EXISTS public\.unlock_prompt\(BIGINT, INTEGER\);/);

    for (const rpcName of [
        'fn_create_payment_checkout_session',
        'fn_update_payment_checkout_session',
        'fn_create_pending_payment_order_for_checkout_session',
        'fn_claim_shop_webhook_tasks',
        'fn_acquire_shop_delivery_execution_reservation',
        'fn_record_shop_delivery_conflict',
        'fn_deduct_points',
        'fn_deduct_points_admin_site',
        'fn_deduct_points_admin_site_with_breakdown'
    ]) {
        assert.match(sql, new RegExp(`'${rpcName}'`), `migration should lock down ${rpcName}`);
    }
});

test('phase 0 + phase 1 migration hardens unlock_prompt_v2, fn_redeem_code, and fn_deduct_points_admin_site_with_breakdown', () => {
    const sql = readMigration();

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.unlock_prompt_v2\(/);
    assert.match(sql, /WHERE pr\.id::TEXT = v_prompt_id_bigint::TEXT/);
    assert.match(sql, /COALESCE\(pr\.gallery_status, 'published'\) = 'published'/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.unlock_prompt_v2\(TEXT, INTEGER, TEXT\) FROM PUBLIC, anon;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.unlock_prompt_v2\(TEXT, INTEGER, TEXT\) TO authenticated, service_role;/);

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_redeem_code\(/);
    assert.match(sql, /v_effective_code_site <> v_site/);
    assert.match(sql, /'code', 'site_mismatch'/);
    assert.match(sql, /COALESCE\(v_code_record\.status, 'pending'\) <> 'pending'/);

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_deduct_points_admin_site_with_breakdown\(/);
    assert.match(
        sql,
        /PERFORM pg_advisory_xact_lock\(\s*hashtext\('points_wallet:' \|\| p_target_user_id::TEXT \|\| ':' \|\| v_site\)::BIGINT\s*\);/s
    );
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.fn_deduct_points_admin_site_with_breakdown\(UUID, NUMERIC, TEXT, TEXT, VARCHAR\) FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.fn_deduct_points_admin_site_with_breakdown\(UUID, NUMERIC, TEXT, TEXT, VARCHAR\) TO service_role;/);
});

test('phase 0 + phase 1 migration guards guest checkout confirmation, refund state transitions, and discount linkage dedup', () => {
    const sql = readMigration();

    assert.match(
        sql,
        /guest_shop_checkout_batches\.id = v_batch\.id AND guest_shop_checkout_batches\.payment_status <> 'confirmed';/,
        'guest batch payment confirmation must preserve qualified column check expected by reconciliation contract'
    );
    assert.match(sql, /RAISE EXCEPTION 'guest_checkout_batch_not_confirmable';/);

    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_guard_payment_order_refund_state\(\)/);
    assert.match(sql, /CREATE TRIGGER trg_payment_orders_guard_refund_state/);
    assert.match(sql, /RAISE EXCEPTION 'payment_order_already_refunded' USING ERRCODE = '55000';/);
    assert.match(sql, /RAISE EXCEPTION 'payment_refund_already_pending' USING ERRCODE = '55000';/);

    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_user_assets_linkage_batch_unique/);
    assert.match(sql, /ON public\.discount_user_assets \(user_id, discount_id, source_batch_id\)/);
    assert.match(sql, /WHERE source_batch_id IS NOT NULL\s+AND source_type IN \('recharge_linkage', 'checkin_linkage', 'affiliate_linkage'\)/s);
});

test('phase 0 + phase 1 migration has balanced dollar-quote blocks', () => {
    const sql = readMigration();
    for (const delimiter of ['$$', '$fn$', '$body$']) {
        const count = sql.split(delimiter).length - 1;
        assert.equal(count % 2, 0, `${delimiter} occurrences (${count}) must be even`);
    }
});
