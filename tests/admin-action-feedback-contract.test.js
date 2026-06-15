const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin studio exposes reusable action button feedback and product save uses toast success', () => {
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminConfigSource = readRepoFile('admin-config.js');
    const adminCssSource = readRepoFile('admin-studio.css');
    const adminHtmlSource = readRepoFile('admin-studio.html');
    const adminShopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const adminTicketsSource = readRepoFile(path.join('js', 'admin-tickets.js'));
    const adminPaymentsSource = readRepoFile(path.join('js', 'admin-payments.js'));
    const adminAnalyticsExportSource = readRepoFile(path.join('js', 'admin-analytics-ai-export.js'));
    const adminAnalyticsRuntimeSource = readRepoFile(path.join('js', 'admin-analytics-runtime-controls.js'));
    const adminAnalyticsLifecycleSource = readRepoFile(path.join('js', 'admin-analytics-lifecycle.js'));
    const adminDiscountsSource = readRepoFile('admin-discounts.js');

    assert.match(
        adminStudioSource,
        /window\.AdminStudioActionFeedback\s*=\s*\{/,
        'admin-studio should expose one reusable action feedback controller'
    );
    assert.match(
        adminStudioSource,
        /hideIcon:\s*options\?\.hideIcon === true/,
        'action feedback should support text-only success states'
    );
    assert.match(
        adminCssSource,
        /\.admin-action-feedback__spinner/,
        'admin-studio styles should render a consistent action loading spinner'
    );
    assert.match(
        adminStudioSource,
        /compact:\s*normalizedOptions\.compact === true/,
        'shared action feedback should support compact icon-only buttons'
    );
    assert.match(
        adminCssSource,
        /\.admin-action-feedback__sr/,
        'compact action feedback should keep text available to assistive tech'
    );
    assert.match(
        adminHtmlSource,
        /id="productSaveBtn"[^>]+data-admin-action-feedback="保存中\.\.\."/s,
        'product save button should declare a saving feedback label'
    );
    assert.match(
        adminHtmlSource,
        /id="productCompleteTranslationBtn"[^>]+data-shop-action="product-complete-translation"[^>]+disabled/s,
        'product modal should expose a disabled-by-default translation completion button next to save'
    );
    assert.match(
        adminHtmlSource,
        /data-admin-action="settings-save-announcement"[^>]+data-admin-action-feedback="发布中\.\.\."/s,
        'announcement publish button should declare a publishing feedback label'
    );
    assert.match(
        adminStudioSource,
        /window\.saveAnnouncement\?\.\(actionEl\)/,
        'announcement save should receive the clicked button for inline feedback'
    );
    assert.match(
        adminConfigSource,
        /feedback\.setLoading\(saveBtn,\s*\{\s*loadingText:\s*text\s*\}\)/,
        'announcement save should switch the publish button into a loading state'
    );
    assert.match(
        adminConfigSource,
        /feedback\.finish\(saveBtn,\s*\{\s*successText:\s*text,\s*hideIcon:\s*true\s*\}\)/,
        'announcement published state should show text without a success icon'
    );
    assert.match(
        adminConfigSource,
        /const loadingMessage = config\.announcement_enabled \? '发布中\.\.\.' : '保存中\.\.\.'/,
        'announcement save should show publishing text while the request is in flight'
    );
    assert.match(
        adminStudioSource,
        /function runAdminStudioActionFeedback\(actionEl,\s*runner,\s*options = \{\}\)/,
        'admin-studio should provide a delegated feedback wrapper for request buttons'
    );
    assert.match(
        adminStudioSource,
        /case 'settings-save-ops-alerts':[\s\S]{0,220}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.saveOpsAlertSettings\?\.\(\)/,
        'ops alert save should use inline button feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'settings-delete-ops-alert-secret':[\s\S]{0,260}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.deleteOpsAlertSecret\?\.\(actionEl\.dataset\.secretName\)/,
        'ops alert secret deletion should use inline button feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'settings-send-ops-alert-telegram-test':[\s\S]{0,160}runAdminStudioOpsAlertSampleAction\(actionEl,\s*\(\) => window\.sendOpsAlertTelegramTest\?\.\(\)\)/,
        'ops alert sample sends should show inline sending feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'settings-delete-codex-config':[\s\S]{0,240}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.deleteCodexConfig\?\.\(\)/,
        'Codex config deletion should use inline button feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'settings-delete-api-key':[\s\S]{0,220}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.deleteApiKey\?\.\(\)/,
        'Gemini key deletion should use inline button feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'settings-delete-channel':[\s\S]{0,320}runAdminStudioActionFeedback\(actionEl,[\s\S]{0,160}window\.deleteChannel\?\.\(index\)/,
        'channel deletion should use inline button feedback'
    );
    assert.match(
        adminConfigSource,
        /function setAnnouncementWorkflowActionButtonFeedback\(triggerEl,\s*action,\s*state = 'loading'\)/,
        'announcement workflow buttons should expose local progress feedback'
    );
    assert.match(
        adminConfigSource,
        /ANNOUNCEMENT_WORKFLOW_ACTION_FEEDBACK_LABELS[\s\S]{0,220}submit_review:\s*\{\s*loading:\s*'提交中\.\.\.'/,
        'announcement workflow feedback should include action-specific loading labels'
    );
    assert.match(
        adminStudioSource,
        /case 'settings-save-login-security':[\s\S]{0,220}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.saveLoginSecuritySettings\?\.\(\)/,
        'login security save should use inline button feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'payments-save-channel-settings':[\s\S]{0,220}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.savePaymentChannelSettings\?\.\(\)/,
        'payment channel save should use inline button feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'payments-export':[\s\S]{0,260}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.AdminPayments\?\.exportData\?\.\(actionEl\.dataset\.exportFormat\)[\s\S]{0,160}compact:\s*true/,
        'payment exports should show compact toolbar feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'analytics-refresh-data':[\s\S]{0,260}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.refreshAllAnalytics\?\.\(\)[\s\S]{0,160}compact:\s*true/,
        'analytics refresh should show compact toolbar feedback'
    );
    assert.match(
        adminPaymentsSource,
        /async function exportData\(format\)[\s\S]{0,700}return true;[\s\S]{0,260}return false;/,
        'payment export should report success or failure to the shared feedback wrapper'
    );
    assert.match(
        adminAnalyticsExportSource,
        /async function exportAnalyticsData\(format\)[\s\S]+return true;[\s\S]+return false;/,
        'analytics export should report success or failure to the shared feedback wrapper'
    );
    assert.match(
        adminAnalyticsRuntimeSource,
        /async function refreshAllAnalytics\(options = \{\}\)[\s\S]{0,1200}return refreshCompleted !== false;[\s\S]{0,300}return false;/,
        'analytics refresh should report success or failure to the shared feedback wrapper'
    );
    assert.match(
        adminAnalyticsLifecycleSource,
        /const result = await originalAnalyticsRefresh\(\.\.\.args\);[\s\S]{0,120}return result;/,
        'analytics lifecycle wrapper should preserve refresh result for button feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'comments-export':[\s\S]{0,120}window\.exportData\?\.\(actionEl\.dataset\.exportFormat,\s*actionEl\)/,
        'comments export should receive the clicked menu item for progress feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'discounts-assign-assets':[\s\S]{0,260}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.AdminDiscounts\?\.assignAssetsFromDetail\?\.\(actionEl\.dataset\.discountId \|\| ''\)/,
        'discount asset assignment should use inline action feedback'
    );
    assert.match(
        adminStudioSource,
        /case 'discounts-delete-code':[\s\S]{0,260}runAdminStudioActionFeedback\(actionEl,\s*\(\) => window\.AdminDiscounts\?\.deleteCode\?\.\(/,
        'discount deletion should use inline action feedback'
    );
    assert.match(
        adminDiscountsSource,
        /deleteCode: async function \(id,\s*code\)[\s\S]{0,700}return true;[\s\S]{0,220}return false;/,
        'discount deletion should report success or failure to the shared feedback wrapper'
    );
    assert.match(
        adminDiscountsSource,
        /assignAssetsFromDetail: async function \(id = ''\)[\s\S]+return true;[\s\S]+return false;/,
        'discount asset assignment should report success or failure to the shared feedback wrapper'
    );
    assert.match(
        adminStudioSource,
        /case 'tickets-bulk-assign-self':[\s\S]{0,120}submitBulkAssignment\?\.\('assign_self',\s*actionEl\)/,
        'ticket bulk assignment should receive the clicked menu item for progress feedback'
    );
    assert.match(
        adminTicketsSource,
        /beginTicketBatchMenuActionFeedback: function \(actionEl,\s*options = \{\}\)/,
        'ticket bulk menu should keep the clicked item in a pending state while requests run'
    );
    assert.match(
        adminShopSource,
        /this\.setActionButtonLoading\(saveButton,\s*'保存中\.\.\.'\)/,
        'product save should switch the submit button into a saving state'
    );
    assert.match(
        adminShopSource,
        /const saveToastType = savedWithLegacyGuidanceFallback \|\| savedWithTranslationWarning \? 'warning' : 'success'[\s\S]{0,420}this\.showActionToast\(successMessage,\s*saveToastType/,
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
