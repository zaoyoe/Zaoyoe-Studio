'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(__dirname, '../supabase/migrations/20261007_add_kc_pay_gpt_cdk_inventory.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('CDK migration keeps explicit type, encrypted secret storage and service-role boundaries', () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS inventory_type TEXT NOT NULL DEFAULT 'standard'/i);
    assert.match(migration, /CHECK \(inventory_type IN \('standard', 'kc_pay_gpt_cdk'\)\)/i);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.shop_cdk_secrets/i);
    assert.match(migration, /content TEXT NOT NULL|content,\s*status/i);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_cdk_secrets_fingerprint/i);
    assert.match(migration, /ALTER TABLE public\.shop_cdk_secrets ENABLE ROW LEVEL SECURITY/i);
    assert.match(migration, /REVOKE ALL ON TABLE public\.shop_cdk_secrets FROM PUBLIC, anon, authenticated/i);
    assert.match(migration, /GRANT ALL ON TABLE public\.shop_cdk_secrets TO service_role/i);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_admin_import_shop_cdk_inventory/i);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_admin_import_shop_cdk_inventory[^;]+TO service_role/i);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_get_shop_cdk_delivery/i);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_get_shop_cdk_delivery[^;]+TO service_role/i);
});

test('CDK migration never stores plaintext in content and preserves procurement linkage', () => {
    assert.match(migration, /content,\s*\n\s*status,\s*\n\s*batch_id,\s*\n\s*is_shared,\s*\n\s*inventory_type,\s*\n\s*source_batch_id/i);
    assert.match(migration, /p_sku_id,\s*\n\s*'',\s*\n\s*v_status,\s*\n\s*NULLIF\(BTRIM\(COALESCE\(p_batch_id/i);
    assert.match(migration, /shop_procurement_batches/i);
    assert.match(migration, /purchase_unit_cost_cny/i);
    assert.match(migration, /encryption_version/i);
    assert.match(migration, /invalid_text_representation/i);
    assert.match(migration, /shop_cdk_reuse_guard/i);
    assert.match(migration, /NEW\.status := 'fault'/i);
    assert.match(migration, /已绑定订单，退款后不可重新销售/i);
});

test('CDK migration rejects guest reservation and isolates supplier site selection', () => {
    assert.match(migration, /guest_shop_reject_cdk_inventory_reservation/i);
    assert.match(migration, /KC-PAY-GPT CDK inventory is not eligible for guest purchase/i);
    assert.match(migration, /fn_lock_shop_sku_inventory\(uuid,uuid,integer,text\)/i);
    assert.match(migration, /COALESCE\(i\.inventory_type, ''standard''\) <> ''kc_pay_gpt_cdk''/i);
    assert.match(migration, /cdk_site\.inventory_id = i\.id/i);
    assert.match(migration, /cdk_site\.site = v_site/i);
    assert.match(migration, /failed to patch fn_lock_shop_sku_inventory/i);
});
