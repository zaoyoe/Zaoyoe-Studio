const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunctionBlock(source, marker) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `expected to find ${marker}`);

    const nextMarker = source.indexOf('\n    },', start);
    assert.notEqual(nextMarker, -1, `expected ${marker} block to end`);
    return source.slice(start, nextMarker);
}

test('admin shop product save errors show friendly upstream timeout copy', () => {
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const networkErrorBlock = extractFunctionBlock(shopSource, 'isTransientShopSaveNetworkError: function');
    const saveErrorBlock = extractFunctionBlock(shopSource, 'getFriendlySaveErrorMessage: function');

    assert.match(
        networkErrorBlock,
        /shop_upstream_connect_timeout[\s\S]*fetch failed[\s\S]*und_err_connect_timeout[\s\S]*connect timeout/,
        'save errors should recognize Supabase/undici timeout signals'
    );
    assert.match(
        saveErrorBlock,
        /isTransientShopSaveNetworkError\(err\)[\s\S]*保存失败：连接 Supabase 超时，请稍后重试/,
        'save errors should translate upstream timeouts into concise Chinese copy'
    );
    assert.match(
        saveErrorBlock,
        /return `保存失败：\$\{details \|\| '未知错误'\}`;/,
        'generic save errors should use Chinese fallback text'
    );
    assert.equal(
        saveErrorBlock.includes('Save failed:'),
        false,
        'product save errors should not surface the old English fallback'
    );
});
