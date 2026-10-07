'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(__dirname, '../supabase/migrations/20261006_add_shop_supplier_catalog_core.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('supplier schema is provider-neutral and maps accounts/products/SKUs without enabling products', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.shop_supplier_accounts/i);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.shop_supplier_product_mappings/i);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.shop_supplier_availability/i);
    assert.match(migration, /provider_id TEXT NOT NULL/i);
    assert.match(migration, /supplier_account_id UUID NOT NULL/i);
    assert.match(migration, /product_id UUID NOT NULL[\s\S]*REFERENCES public\.shop_products/i);
    assert.match(migration, /sku_id UUID[\s\S]*REFERENCES public\.shop_product_skus/i);
    assert.match(migration, /is_enabled BOOLEAN NOT NULL DEFAULT false/i);
    assert.match(migration, /is_primary BOOLEAN NOT NULL DEFAULT false/i);
    assert.match(migration, /UNIQUE \(supplier_account_id, site, supplier_goods_no\)/i);
    assert.match(migration, /VALUES \('16688', 'default', '16688 默认账号', 'env:SUPPLIER_16688', false\)/i);
});

test('supplier schema keeps credentials out of database values and availability private', () => {
    assert.match(migration, /credential_ref TEXT NOT NULL/i);
    assert.doesNotMatch(migration, /\b(api_secret|app_secret|secret_value|access_token)\b/i);
    assert.match(migration, /REVOKE ALL ON TABLE public\.shop_supplier_availability FROM PUBLIC, anon/i);
    assert.match(migration, /CREATE POLICY "Admins manage shop supplier availability"[\s\S]*USING \(public\.is_admin\(\)\)[\s\S]*WITH CHECK \(public\.is_admin\(\)\)/i);
    assert.match(migration, /exact upstream wallet balances must not be stored or exposed/i);
});

test('supplier availability supports explicit unknown/fail-closed and expires via timestamps', () => {
    assert.match(migration, /availability_status IN \('available', 'unavailable', 'unknown'\)/i);
    assert.match(migration, /checked_at TIMESTAMPTZ/i);
    assert.match(migration, /expires_at TIMESTAMPTZ/i);
    assert.match(migration, /balance_enough BOOLEAN/i);
    assert.match(migration, /available_quantity INT/i);
});
