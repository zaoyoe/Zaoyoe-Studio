const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('admin studio exposes the customer engagement module shell', () => {
    const html = readRepoFile('admin-studio.html');
    const bootstrap = readRepoFile('js/admin-studio-bootstrap.js');
    const shell = readRepoFile('js/admin-shell.js');
    const adminApi = readRepoFile('api/admin.js');

    assert.match(html, /data-module="engagement"/);
    assert.match(html, /id="module-engagement"/);
    assert.match(html, /js\/admin-engagement\.js\?v=20260504_ENGAGEMENT_PUBLISH_STATUS_SYNC_1/);
    assert.match(html, /css\/admin-engagement\.css\?v=20260504_ENGAGEMENT_PUBLISH_STATUS_SYNC_1/);
    assert.match(bootstrap, /engagement:\s*\{\s*label:\s*'客服系统'/);
    assert.match(bootstrap, /modules:\s*\['chat', 'engagement'\]/);
    assert.match(shell, /handleAdminEngagementSiteChange/);
    assert.match(adminApi, /'engagement\/rules': engagementRulesHandler/);
});

test('engagement admin form uses custom studio controls instead of native selects and checkboxes', () => {
    const engagementJs = readRepoFile('js/admin-engagement.js');
    const engagementCss = readRepoFile('css/admin-engagement.css');
    const engagementRulesHandler = readRepoFile('server/api-handlers/admin/engagement/rules.js');

    assert.doesNotMatch(engagementJs, /<select\b/);
    assert.doesNotMatch(engagementJs, /type="checkbox"/);
    assert.doesNotMatch(engagementJs, /type="submit"/);
    assert.match(engagementJs, /renderCustomSelect/);
    assert.match(engagementJs, /renderPagePicker/);
    assert.match(engagementJs, /renderCustomSwitch/);
    assert.match(engagementJs, /engagementAdminFetch/);
    assert.match(engagementJs, /authMode:\s*'bearer'/);
    assert.match(engagementJs, /forceBearerToken:\s*true/);
    assert.match(engagementJs, /data-engagement-managed-form/);
    assert.match(engagementJs, /data-engagement-action="submit-rule"/);
    assert.match(engagementJs, /handleEngagementRuleFormSubmit/);
    assert.match(engagementJs, /getRuleFormValidationMessage/);
    assert.match(engagementJs, /setRuleFormError/);
    assert.match(engagementJs, /upsertRuleInPayload/);
    assert.match(engagementJs, /bindEngagementDirectHandlers/);
    assert.match(engagementJs, /submitRuleFromActionElement/);
    assert.match(engagementJs, /submitCurrentRule/);
    assert.match(engagementJs, /pointerup/);
    assert.match(engagementJs, /handleEngagementSubmitIntentEvent/);
    assert.match(engagementJs, /SAVE_LOCK_STALE_MS/);
    assert.match(engagementJs, /__adminEngagementRuntimeVersion/);
    assert.match(engagementJs, /form\.getAttribute\('id'\) !== 'engagementRuleForm'/);
    assert.doesNotMatch(engagementJs, /form\.id !== 'engagementRuleForm'/);
    assert.match(engagementJs, /if \(enabled && status !== 'published'\)/);
    assert.match(engagementRulesHandler, /if \(enabled && status !== 'published'\)/);
    assert.match(engagementRulesHandler, /status = 'published'/);
    assert.match(engagementJs, /stopImmediatePropagation/);
    assert.match(engagementJs, /data-engagement-select-trigger/);
    assert.match(engagementJs, /data-engagement-page-toggle/);
    assert.match(engagementJs, /data-engagement-switch/);
    assert.match(engagementJs, /engagement-hero-grid/);

    assert.match(engagementCss, /\.engagement-select__trigger/);
    assert.match(engagementCss, /\.engagement-page-choice/);
    assert.match(engagementCss, /\.engagement-switch/);
    assert.match(engagementCss, /\.engagement-form-error/);
    assert.match(engagementCss, /\.engagement-form-error\[data-tone="info"\]/);
    assert.match(engagementCss, /\.engagement-form-error\[data-tone="success"\]/);
    assert.match(engagementCss, /\.engagement-hero-grid/);
    assert.match(engagementCss, /html\[data-theme="dark"\] \.engagement-select__menu/);
});

test('public robot engagement feed is routed and consumed by ChatWidget', () => {
    const publicApi = readRepoFile('api/public.js');
    const vercelConfig = readRepoFile('vercel.json');
    const chatWidget = readRepoFile('js/components/ChatWidget.js');
    const chatWidgetCss = readRepoFile('css/chat-widget.css');
    const chatWidgetLoader = readRepoFile('js/chat-widget-loader.js');
    const indexHtml = readRepoFile('index.html');
    const promptsHtml = readRepoFile('prompts.html');
    const publicHandler = readRepoFile('server/api-handlers/public/engagement.js');

    assert.match(publicApi, /case 'engagement'/);
    assert.match(vercelConfig, /"source": "\/api\/engagement\/:path\*"/);
    assert.match(chatWidget, /window\.ZaoyoeEngagement/);
    assert.match(chatWidget, /\/api\/engagement\/\$\{encodeURIComponent\(normalizedRoute\)\}/);
    assert.match(chatWidget, /getEngagementApiUrls\('feed', params\)/);
    assert.match(chatWidget, /getEngagementApiUrls\('event'\)/);
    assert.match(chatWidget, /getEngagementApiUrls/);
    assert.match(chatWidget, /\/api\/public\?\$\{fallbackParams\.toString\(\)\}/);
    assert.match(chatWidget, /if \(normalized && options\.passive !== true\) \{[\s\S]*?this\.suppressEngagementItem\(normalized\)/);
    assert.match(chatWidget, /this\.initEngagementRuntime\(\);\s*\n\s*\}/);
    assert.doesNotMatch(chatWidget, /initEngagementRuntime\(\) \{\s*if \(this\.isAdmin\) return;/);
    assert.doesNotMatch(chatWidget, /if \(this\.isAdmin \|\| this\.isOpen\) return;/);
    assert.match(chatWidgetLoader, /20260504_ENGAGEMENT_ROUTE_LINKS_1/);
    assert.match(chatWidgetLoader, /ChatWidget\.js\?v=20260504_ENGAGEMENT_ROUTE_LINKS_1/);
    assert.match(chatWidgetLoader, /scheduleEngagementRuntimeWarm/);
    assert.match(chatWidgetLoader, /ensureChatWidgetReady\(\{ open: false \}\)/);
    assert.match(indexHtml, /chat-widget-loader\.js\?v=20260504_ENGAGEMENT_ROUTE_LINKS_1/);
    assert.match(promptsHtml, /chat-widget-loader\.js\?v=20260504_ENGAGEMENT_ROUTE_LINKS_1/);
    assert.match(chatWidget, /renderEngagementContentHtml/);
    assert.match(chatWidget, /engagement-preview__path-link/);
    assert.match(chatWidget, /ZaoyoeWalletModalBootstrap\?\.open/);
    assert.match(chatWidget, /wallet:\/\/\$\{walletView\}/);
    assert.match(chatWidgetCss, /\.engagement-preview__path-link/);
    assert.match(chatWidgetCss, /width:\s*fit-content/);
    assert.match(chatWidgetCss, /min-width:\s*min\(220px,\s*calc\(100vw - 48px\)\)/);
    assert.match(chatWidgetCss, /max-width:\s*min\(420px,\s*calc\(100vw - 48px\)\)/);
    assert.match(chatWidgetCss, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(chatWidgetCss, /min-width:\s*min\(360px,\s*calc\(100vw - 48px\)\);\s*max-width:\s*min\(360px/s);
    assert.match(publicHandler, /VALID_PAGES.*home.*prompts.*gongyi.*shop.*verify.*guestbook/s);
    assert.match(publicHandler, /\.eq\('enabled', true\)/);
    assert.match(publicHandler, /\.eq\('status', 'published'\)/);
    assert.match(publicHandler, /'reply-notify': replyNotifyHandler/);
});

test('engagement migration creates commercial robot touchpoint primitives', () => {
    const migration = readRepoFile('supabase/migrations/20260504_engagement_robot_touchpoints.sql');

    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.engagement_templates/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.engagement_rules/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.engagement_events/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS action_url TEXT/);
    assert.match(migration, /'points_insufficient'/);
    assert.match(migration, /'comment_replied'/);
    assert.match(migration, /'coupon_available'/);
    assert.match(migration, /'permission_changed'/);
});

test('business notifications carry robot bubble routing metadata', () => {
    const notifications = readRepoFile('api/_lib/admin-notifications.js');
    const usersManage = readRepoFile('server/api-handlers/admin/users/manage.js');
    const discountsAssets = readRepoFile('server/api-handlers/admin/discounts/assets.js');
    const shopPublic = readRepoFile('server/api-handlers/public/shop.js');

    assert.match(notifications, /action_url/);
    assert.match(notifications, /source_event_id/);
    assert.match(usersManage, /category:\s*'points_adjusted'/);
    assert.match(usersManage, /category:\s*'permission_changed'/);
    assert.match(discountsAssets, /event_type:\s*'coupon_available'/);
    assert.match(discountsAssets, /action_path_label:\s*'我的钱包 > 卡券'/);
    assert.match(discountsAssets, /wallet_view:\s*'cards'/);
    assert.match(shopPublic, /event_type:\s*'coupon_available'/);
    assert.match(shopPublic, /action_path_url:\s*'wallet:\/\/cards'/);
    assert.match(shopPublic, /wallet_view:\s*'cards'/);
});

test('community replies create robot-readable personal notifications', () => {
    const publicHandler = readRepoFile('server/api-handlers/public/engagement.js');
    const prompts = readRepoFile('prompts-poetry.js');
    const guestbook = readRepoFile('supabase-guestbook-functions.js');
    const promptsHtml = readRepoFile('prompts.html');
    const guestbookHtml = readRepoFile('guestbook.html');

    assert.match(publicHandler, /source === 'prompt_comment'/);
    assert.match(publicHandler, /guestbook_message_reply:\$\{commentId\}/);
    assert.match(publicHandler, /guestbook_comment_reply:\$\{commentId\}/);
    assert.match(publicHandler, /category:\s*eventType/);
    assert.match(publicHandler, /page_id:\s*'guestbook'/);
    assert.match(publicHandler, /page_id:\s*'prompts'/);
    assert.match(publicHandler, /notifyUsers\(supabase/);

    assert.match(prompts, /\/api\/engagement\/reply-notify/);
    assert.match(prompts, /source:\s*'prompt_comment'/);
    assert.match(publicHandler, /comments:\s*'1'/);

    assert.match(guestbook, /\/api\/engagement\/reply-notify/);
    assert.match(guestbook, /source:\s*'guestbook_comment'/);
    assert.match(guestbook, /parentCommentId/);

    assert.match(promptsHtml, /20260504_ENGAGEMENT_REPLY_NOTIFY_1/);
    assert.match(guestbookHtml, /20260504_ENGAGEMENT_REPLY_NOTIFY_1/);
});

test('shop discount assets can surface as robot engagement bubbles', () => {
    const shopClient = readRepoFile('js/shop-client.js');
    const shopHtml = readRepoFile('shop.html');
    const publicShopHandler = readRepoFile('server/api-handlers/public/shop.js');

    assert.match(publicShopHandler, /'available-discounts': async function availableDiscountsHandler/);
    assert.match(shopClient, /maybeShowShopDiscountEngagement/);
    assert.match(shopClient, /selectShopDiscountEngagementOffer/);
    assert.match(shopClient, /window\.ZaoyoeEngagement\?\.show/);
    assert.match(shopClient, /event_type:\s*offer\.type === 'claimable' \? 'coupon_available' : 'product_discount_available'/);
    assert.match(shopClient, /shop_product_discount_assets/);
    assert.match(shopClient, /\/shop\.html\?productId=/);
    assert.match(shopClient, /this\.maybeShowShopDiscountEngagement\(\)/);
    assert.match(shopHtml, /20260504_SHOP_DISCOUNT_ENGAGEMENT_1/);
});
