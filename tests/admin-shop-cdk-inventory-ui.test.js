'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractBlock(source, marker, endMarker = '\n    },') {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `expected ${marker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `expected ${marker} to end`);
    return source.slice(start, end);
}

test('CDK inventory type is explicit in every admin import surface', () => {
    const html = read('admin-studio.html');
    const source = read('js/admin-shop.js');

    for (const [id, scope] of [
        ['importViewInventoryType', 'importView'],
        ['inventoryInventoryType', 'legacy'],
        ['importModalInventoryType', 'importModal']
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
        assert.match(html, new RegExp(`data-inventory-scope="${scope}"`));
        assert.match(html, new RegExp(`id="${id}"[\\s\\S]*value="kc_pay_gpt_cdk"`));
    }

    assert.match(source, /getInventoryImportType: function/);
    assert.match(source, /value === 'kc_pay_gpt_cdk' \? 'kc_pay_gpt_cdk' : 'standard'/);
    assert.match(source, /本站只售卖卡密，不自动充值；用户付款后在本站查看卡密，再前往 KC-PAY-GPT 自行兑换/);

    for (const marker of [
        'importInventory: async function',
        'doImport: async function',
        'doImportFromView: async function'
    ]) {
        const block = extractBlock(source, marker);
        assert.match(block, /getInventoryImportType/);
        assert.match(block, /inventoryType/);
        assert.match(block, /inventoryType === 'kc_pay_gpt_cdk' \? '条 CDK'/);
    }
});

test('CDK import disables reusable delivery and never exposes plaintext in admin UI', () => {
    const html = read('admin-studio.html');
    const source = read('js/admin-shop.js');

    for (const id of [
        'importViewReusableDelivery',
        'inventoryReusableDelivery',
        'importModalReusableDelivery'
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }

    const controls = extractBlock(source, 'syncInventoryImportTypeControls: function');
    assert.match(controls, /const isCdk = type === 'kc_pay_gpt_cdk'/);
    assert.match(controls, /reusableElement\.checked = false/);
    assert.match(controls, /reusableElement\.disabled = isCdk/);
    assert.match(controls, /系统会加密保存，后台不显示明文/);

    assert.match(source, /成功导入 \$\{imported\} \$\{inventoryType === 'kc_pay_gpt_cdk' \? '条 CDK' : '条库存'\}/);
    assert.match(source, /成功导入 \$\{imported\} \$\{inventoryType === 'kc_pay_gpt_cdk' \? '条 CDK' : '个账号'\}/);
});
