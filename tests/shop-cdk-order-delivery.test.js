'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('public order delivery decrypts CDK only through the protected delivery RPC', () => {
    const source = read('server/api-handlers/public/shop.js');
    const block = source.slice(source.indexOf('async function loadShopOrderDetail'), source.indexOf('async function loadShopOrderList'));
    assert.match(block, /select\('id, content, inventory_type'\)/);
    assert.match(block, /fn_get_shop_cdk_delivery/);
    assert.match(block, /decryptCdk\(secret/);
    assert.match(block, /inventory_type: inventoryType/);
    assert.match(block, /delivery_mode: isCdkInventoryType/);
    assert.match(block, /if \(isCdkInventoryType\(inventoryType\)\)/);
});

test('admin inventory linkage redacts CDK content', () => {
    const source = read('server/api-handlers/admin/shop/_order-linkage.js');
    assert.match(source, /function isCdkInventoryRecord/);
    assert.match(source, /if \(!isCdkInventoryRecord\(record\)\)/);
    assert.match(source, /content: ''/);
    assert.match(source, /inventory_type/);
});

test('CDK is explicitly blocked from guest reservation paths', () => {
    const migration = read('supabase/migrations/20261007_add_kc_pay_gpt_cdk_inventory.sql');
    assert.match(migration, /trg_guest_shop_reject_cdk_inventory_reservation/);
    assert.match(migration, /inventory_type = 'kc_pay_gpt_cdk'/);
    assert.match(migration, /not eligible for guest purchase/);
});
