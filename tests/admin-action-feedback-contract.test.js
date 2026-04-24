const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin studio exposes reusable action button feedback and product save uses toast success', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminCssSource = readRepoFile('admin-studio.css');
    const adminHtmlSource = readRepoFile('admin-studio.html');
    const adminShopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const adminTicketsSource = readRepoFile(path.join('js', 'admin-tickets.js'));

    assert.match(
        adminStudioSource,
        /window\.AdminStudioActionFeedback\s*=\s*\{/,
        'admin-studio should expose one reusable action feedback controller'
    );
    assert.match(
        adminCssSource,
        /\.admin-action-feedback__spinner/,
        'admin-studio styles should render a consistent action loading spinner'
    );
    assert.match(
        adminHtmlSource,
        /id="productSaveBtn"[^>]+data-admin-action-feedback="保存中\.\.\."/s,
        'product save button should declare a saving feedback label'
    );
    assert.match(
        adminShopSource,
        /this\.setActionButtonLoading\(saveButton,\s*'保存中\.\.\.'\)/,
        'product save should switch the submit button into a saving state'
    );
    assert.match(
        adminShopSource,
        /const successMessage = '商品已保存'[\s\S]{0,160}this\.showActionToast\(successMessage,\s*'success'\)/,
        'product save should use the Admin Studio toast style for success feedback'
    );
    assert.doesNotMatch(
        adminShopSource,
        /const successMessage = '保存成功'[\s\S]{0,180}alert\(successMessage\)/,
        'product save should not use a blocking browser alert for success'
    );
    assert.match(
        adminTicketsSource,
        /window\.AdminStudioActionFeedback\.setLoading\(btn,\s*\{\s*loadingText:\s*'处理中\.\.\.'\s*\}\)/,
        'other admin studio action buttons should reuse the shared execution feedback controller'
    );
});
