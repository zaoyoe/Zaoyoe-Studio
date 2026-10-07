'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../server/api-handlers/admin/shop/mutate.js'), 'utf8');

test('admin import handler requires an explicit inventory type and fails closed for invalid values', () => {
    assert.match(source, /body\.inventoryType \|\| body\.inventory_type \|\| 'standard'/);
    assert.match(source, /!\['standard', 'kc_pay_gpt_cdk'\]\.includes\(inventoryType\)/);
    assert.match(source, /库存类型无效，请明确选择普通库存或 KC-PAY-GPT CDK/);
    assert.match(source, /const reusableDelivery = isCdkInventoryType\(inventoryType\)\s*\? false/);
});

test('admin CDK import encrypts before the service-role RPC and never inserts plaintext content', () => {
    const importBlock = source.slice(source.indexOf("if (action === 'import_inventory')"), source.indexOf("if (action === 'update_procurement_quality')"));
    assert.match(importBlock, /normalizeCdk\(line\)/);
    assert.match(importBlock, /encryptCdk\(normalizedCdk/);
    assert.match(importBlock, /fingerprintCdk\(normalizedCdk\)/);
    assert.match(importBlock, /fn_admin_import_shop_cdk_inventory/);
    assert.match(importBlock, /const inserts = isCdkInventoryType\(inventoryType\)\s*\? \[\]\s*:/);
    assert.doesNotMatch(importBlock, /content:\s*normalizedCdk/);
    assert.match(importBlock, /inventoryType\n\s*\}\);/);
});

test('admin CDK import uses service-role client and logs only safe metadata', () => {
    const importBlock = source.slice(source.indexOf("if (action === 'import_inventory')"), source.indexOf("if (action === 'update_procurement_quality')"));
    assert.match(importBlock, /adminSupabase\.rpc\(/);
    assert.match(importBlock, /inventory_type: inventoryType/);
    assert.match(importBlock, /count: importedCount/);
    const auditDetails = importBlock.slice(importBlock.indexOf('details: {'), importBlock.indexOf('            return sendJson', importBlock.indexOf('details: {')));
    assert.doesNotMatch(auditDetails, /lines|cdkItems|ciphertext|secret/i);
});
