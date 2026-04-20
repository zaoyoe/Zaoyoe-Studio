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
    assert.equal(
        homepageSource.includes('保存草稿中...'),
        true,
        'admin-homepage.js should expose save-state copy for homepage draft saves'
    );
    assert.equal(
        homepageSource.includes('翻译中...'),
        false,
        'admin-homepage.js should not label homepage draft saves as translation work'
    );
    assert.equal(
        homepageSource.includes('autoTranslatePair('),
        false,
        'admin-homepage.js should no longer auto-translate homepage draft fields during save'
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
        "this.requireWritableSite({ action: 'discounts-submit-generate' })",
        "buildAdminDiscountsUrl('discounts/mutate')"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(discountsSource.includes(marker), true, `admin-discounts.js should contain ${marker}`);
    }

    assert.equal(
        discountsSource.includes(".from('discount_codes')"),
        false,
        'admin-discounts.js should no longer mutate discount_codes directly from the browser'
    );
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
        "window.AdminSiteFilter?.requireWritableSite?.({",
        "批量加入首页精选",
        "gallery-batch-localize",
        "buildAdminPromptsUrl(params = {})",
        "/api/admin/prompts/manage"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(studioSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }

    assert.equal(
        studioSource.includes("const HOMEPAGE_PROMPT_POOL_LAST_UPDATED_KEY = 'homepage_prompt_pool_last_updated_at';"),
        true,
        'admin-studio.js should mark homepage prompt-pool caches stale after prompt saves'
    );
    assert.equal(
        studioSource.includes('markHomepagePromptPoolUpdated();'),
        true,
        'admin-studio.js should invalidate homepage prompt-pool freshness after prompt saves'
    );

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
        "this.requireWritableSite({ label: '导入库存（弹窗）' })",
        "this.requireWritableSite({ label: '导入库存（工作台）' })",
        "this.requireWritableSite({ label: '批量删除库存' })",
        "this.requireWritableSite({ label: '删除库存项' })",
        "this.requireWritableSite({ label: freeze ? '冻结库存项' : '解冻库存项' })",
        "this.requireWritableSite({ label: '重新上架库存项' })",
        "this.requireWritableSite({ label: '标记库存故障' })",
        "this.requireWritableSite({ label: '批量释放储备库存' })",
        "this.requireWritableSite({ label: '批量删除商品' })",
        "this.requireWritableSite({ label: '创建商品分类' })",
        "this.requireWritableSite({ label: '重命名商品分类' })",
        "this.requireWritableSite({ label: '设置商品分类颜色' })",
        "this.requireWritableSite({ label: '删除商品分类' })",
        "this.requireWritableSite({ label: '移动商品分类' })",
        "this.requireWritableSite({ label: '调整商品排序' })"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    assert.equal(
        shopSource.includes("buildAdminRouteUrl('payments/shop-refund')"),
        true,
        'js/admin-shop.js should route refunds through the admin refund handler'
    );
    assert.equal(
        shopSource.includes("supabaseClient.rpc('fn_admin_refund_order'"),
        false,
        'js/admin-shop.js should no longer call the refund rpc directly from the browser'
    );
    assert.equal(
        shopSource.includes("supabaseClient.rpc('fn_import_inventory'"),
        false,
        'js/admin-shop.js should no longer call the inventory import rpc directly from the browser'
    );
    assert.equal(
        shopSource.includes("supabaseClient.rpc('fn_admin_release_reserve'"),
        false,
        'js/admin-shop.js should no longer call the reserve release rpc directly from the browser'
    );
    assert.equal(
        shopSource.includes("supabaseClient.rpc('fn_admin_list_inventory'"),
        false,
        'js/admin-shop.js should no longer call the inventory list rpc directly from the browser'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/inventory'"),
        true,
        'js/admin-shop.js should route inventory reads through the admin inventory handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/inventory-detail'"),
        true,
        'js/admin-shop.js should route inventory detail through the admin inventory detail handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/products'"),
        true,
        'js/admin-shop.js should route product reads through the admin products handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/categories'"),
        true,
        'js/admin-shop.js should route category reads through the admin categories handler'
    );
    assert.equal(
        shopSource.includes("buildAdminShopUrl('shop/orders'"),
        true,
        'js/admin-shop.js should route order reads through the admin orders handler'
    );
    assert.equal(
        shopSource.includes(".from('shop_orders')"),
        false,
        'js/admin-shop.js should no longer read shop_orders directly from the browser'
    );
    assert.equal(
        shopSource.includes(".from('profiles')"),
        false,
        'js/admin-shop.js should no longer read profiles directly from the browser for shop workflows'
    );
    assert.equal(
        shopSource.includes(".from('shop_inventory')"),
        false,
        'js/admin-shop.js should no longer read shop_inventory directly from the browser for inventory detail flows'
    );
    assert.equal(
        shopSource.includes(".from('shop_products')"),
        false,
        'js/admin-shop.js should no longer touch shop_products directly from the browser'
    );
    assert.equal(
        shopSource.includes(".from('shop_categories')"),
        false,
        'js/admin-shop.js should no longer touch shop_categories directly from the browser'
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
