const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('homepage module routes save and visibility writes through writable site guard', () => {
    const homepageSource = readRepoFile('admin-homepage.js');

    assert.equal(
        homepageSource.includes("requireWritableHomepageSite({ action: 'homepage-save-section' })"),
        true,
        'admin-homepage.js should guard homepage section saves with the shared writable site helper'
    );
    assert.equal(
        homepageSource.includes("requireWritableHomepageSite({ label: '调整首页分栏显示' })"),
        true,
        'admin-homepage.js should guard inline visibility toggles with the shared writable site helper'
    );
    assert.equal(
        homepageSource.includes("/api/admin/homepage/config"),
        true,
        'admin-homepage.js should route homepage reads and writes through the admin homepage handler'
    );
    assert.equal(
        homepageSource.includes(".from('homepage_config')"),
        false,
        'admin-homepage.js should no longer mutate homepage_config directly from the browser'
    );
});

test('points module routes mutation entry points through writable site guard', () => {
    const pointsSource = readRepoFile('admin-points.js');

    const requiredMarkers = [
        "requireWritablePointsSite({ formId: 'generateCodesForm' })",
        "requireWritablePointsSite({ action: 'points-batch-delete' })",
        "requireWritablePointsSite({ action: 'points-batch-invalidate' })",
        "requireWritablePointsSite({ label: '保存兑换码批次' })",
        "requireWritablePointsSite({ label: '禁用兑换码' })",
        "requireWritablePointsSite({ label: '启用兑换码' })",
        "requireWritablePointsSite({ label: '设置兑换码有效期' })",
        "requireWritablePointsSite({ label: '撤销兑换码' })",
        "const writableSite = requireWritablePointsSite({ label });",
        "label: isCreate ? '创建套餐' : '保存套餐'",
        "label: '删除套餐'",
        "buildAdminPointsUrl('points/manage'",
        "buildAdminPointsUrl('points/packages'"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }

    const removedMarkers = [
        ".rpc('fn_generate_custom_codes'",
        ".rpc('fn_generate_codes'",
        ".rpc('fn_revoke_code'"
    ];

    for (const marker of removedMarkers) {
        assert.equal(pointsSource.includes(marker), false, `admin-points.js should not contain ${marker}`);
    }
});

test('discounts module routes mutation entry points through writable site guard', () => {
    const discountsSource = readRepoFile('admin-discounts.js');

    const requiredMarkers = [
        "this.requireWritableSite({ label: newState ? '启用折扣码' : '停用折扣码' })",
        "this.requireWritableSite({ action: 'discounts-delete-code' })",
        "this.requireWritableSite({ action: 'discounts-submit-generate' })"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(discountsSource.includes(marker), true, `admin-discounts.js should contain ${marker}`);
    }
});

test('gallery module routes prompt mutations through writable site guard', () => {
    const studioSource = readRepoFile('admin-studio.js');

    const requiredMarkers = [
        "window.AdminSiteFilter.requireWritableSite({ action })",
        "window.AdminSiteFilter.requireWritableSite({ formId })",
        "window.AdminSiteFilter?.requireWritableSite?.({ label: '删除 Prompt' })",
        "window.AdminSiteFilter?.requireWritableSite?.({ formId: 'promptForm' })",
        "window.AdminSiteFilter?.requireWritableSite?.({ label: '批量删除 Prompt' })",
        "window.AdminSiteFilter?.requireWritableSite?.({ label: '批量重分析 Prompt' })",
        "window.AdminSiteFilter?.requireWritableSite?.({ label: '分析无标签 Prompt' })",
        "buildAdminPromptsUrl(params = {})",
        "/api/admin/prompts/manage"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(studioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    assert.equal(
        studioSource.includes(".from('prompts')"),
        false,
        'admin-studio.js should no longer mutate prompts directly from the browser'
    );
});

test('shop module routes core write actions through writable site guard', () => {
    const shopSource = readRepoFile('js/admin-shop.js');

    const requiredMarkers = [
        "requireWritableSite(options = {}) {",
        "this.requireWritableSite({ label: '保存商品' })",
        "this.requireWritableSite({ label: '删除商品' })",
        "this.requireWritableSite({ label: newStatus ? '上架商品' : '下架商品' })",
        "this.requireWritableSite({ label: '执行订单退款' })",
        "this.requireWritableSite({ label: '导入库存' })",
        "this.requireWritableSite({ label: '批量删除库存' })",
        "this.requireWritableSite({ label: '删除库存项' })",
        "this.requireWritableSite({ label: freeze ? '冻结库存项' : '解冻库存项' })",
        "this.requireWritableSite({ label: '重新上架库存项' })",
        "this.requireWritableSite({ label: '标记库存故障' })"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    assert.equal(
        shopSource.includes("/api/admin/payments/shop-refund"),
        true,
        'js/admin-shop.js should route refunds through the admin refund handler'
    );
    assert.equal(
        shopSource.includes("supabaseClient.rpc('fn_admin_refund_order'"),
        false,
        'js/admin-shop.js should no longer call the refund rpc directly from the browser'
    );
});

test('comments module routes moderation and pin writes through writable site guard', () => {
    const commentsSource = readRepoFile('admin-comments.js');

    const requiredMarkers = [
        "requireWritableCommentsSite({ action: 'comments-batch-delete' })",
        "label: recordType === 'message' ? '删除留言主贴' : '删除评论'",
        "requireWritableCommentsSite({ label: currentStatus ? '取消评论置顶' : '置顶评论' })",
        "buildAdminCommentsUrl('comments/blocks'",
        "buildAdminCommentsUrl('comments/list'",
        "buildAdminCommentsUrl('comments/summary'",
        "/api/admin/comments/moderate",
        "action: 'toggle_pin'",
        "requireWritableCommentsSite({ label: `${scopeStr}用户封禁` })",
        "requireWritableCommentsSite({ label: `${scopeLabel}用户解封` })"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(commentsSource.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }

    const removedMarkers = [
        ".from('guestbook_messages')",
        ".from('guestbook_comments')",
        ".from('prompt_comments')",
        ".from('blocked_users')"
    ];

    for (const marker of removedMarkers) {
        assert.equal(commentsSource.includes(marker), false, `admin-comments.js should not contain ${marker}`);
    }
});
