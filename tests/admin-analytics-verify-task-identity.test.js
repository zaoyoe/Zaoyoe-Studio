const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('analytics verify task cards lead with submitter identity and expose expandable submission details', () => {
    const source = readRepoFile('admin-analytics.js');
    const html = readRepoFile('admin-studio.html');
    const styles = readRepoFile(path.join('css', 'admin-studio-page.css'));
    const baseStyles = readRepoFile('admin-studio.css');
    const adminStudioSource = readRepoFile('admin-studio.js');
    const usersSource = readRepoFile('admin-users.js');
    const workbenchSource = readRepoFile(path.join('js', 'admin-workbench.js'));
    const serverBuilder = readRepoFile(path.join('server', 'api-handlers', 'admin', 'analytics', '_summary-row-builders.js'));
    const serverPayloadBundle = readRepoFile(path.join('server', 'api-handlers', 'admin', 'analytics', 'summary-payload-bundle.js'));

    assert.equal(
        source.includes('function getAnalyticsVerificationSubmitterIdentity(row = {})'),
        true,
        'verify summary should centralize the website submitter identity'
    );
    assert.equal(
        source.includes('function getAnalyticsVerificationSubmitterEmail(row = {})'),
        true,
        'verify summary should prefer the website user email as the primary submitter label'
    );
    assert.equal(
        source.includes('function getAnalyticsVerificationSubmittedAccount(row = {})'),
        true,
        'verify summary should keep the submitted verification email separate from the submitter'
    );
    assert.match(
        source,
        /function buildAnalyticsVerificationTaskTitle\(row = \{\}\) \{[\s\S]*const submitterIdentity = getAnalyticsVerificationSubmitterIdentity\(row\);[\s\S]*return submitterIdentity \|\| \(verificationId \? `任务 #\$\{verificationId\}` : '未记录提交身份'\);[\s\S]*\}/,
        'verify task title should prefer the website submitter before falling back to the task number'
    );
    const submitterIdentityBlock = source.slice(
        source.indexOf('function getAnalyticsVerificationSubmitterIdentity(row = {})'),
        source.indexOf('function getAnalyticsVerificationSubmittedAccount(row = {})')
    );
    assert.equal(
        submitterIdentityBlock.includes('payload.email'),
        false,
        'website submitter identity should not read the submitted verification email from the message payload'
    );
    assert.equal(
        submitterIdentityBlock.includes('formatAnalyticsVerificationUserId(row?.user_id)'),
        false,
        'website submitter identity should not fall back to a shortened UUID in the card title'
    );
    assert.match(
        source,
        /function buildAnalyticsVerificationTaskMeta\(row = \{\}\) \{[\s\S]*verificationId \? `任务 #\$\{verificationId\}` : '',[\s\S]*taskTypeLabel,[\s\S]*siteLabel,[\s\S]*statusLabel[\s\S]*\.filter\(Boolean\)\.join\(' · '\);[\s\S]*\}/,
        'verify task meta should keep task number, mode, site, and pass state available as secondary detail'
    );
    assert.equal(
        source.includes('function buildAnalyticsVerificationTaskDetails(row = {})'),
        true,
        'verify task cards should build a detail payload for expansion'
    );
    assert.equal(
        source.includes('function getAnalyticsVerificationFailureReason(row = {})'),
        true,
        'failed verify task cards should extract a readable failure reason'
    );
    assert.equal(
        source.includes('item.hideSummary === true || !item.summary'),
        true,
        'compact renderer should allow verify task cards to move terminal result text into expanded details'
    );
    assert.equal(
        source.includes('function shouldHideAnalyticsVerificationCollapsedSummary(row = {})'),
        true,
        'verify terminal task cards should centralize collapsed summary hiding'
    );
    ['提交人', '提交内容', '是否通过', '失败原因', '提交模式', '任务号'].forEach((label) => {
        assert.equal(source.includes(`label: '${label}'`), true, `${label} should be exposed in the expanded details`);
    });
    assert.match(
        source,
        /if \(getVerifyStatusGroup\(row\?\.status \|\| payload\.status \|\| payload\.raw_status\) === 'failed'\) \{[\s\S]*label: '失败原因'[\s\S]*failureReason \|\| '未记录失败原因'/,
        'failure reason should only be added to failed verify tasks'
    );
    assert.equal(
        source.includes("if (taskType === 'full') return '全流程包绑卡';"),
        true,
        'full submissions should be labeled as full-flow'
    );
    assert.equal(
        source.includes("if (taskType === 'extract') return '半流程 / 仅提链';"),
        true,
        'extract submissions should be labeled as the half/extract mode'
    );
    assert.equal(
        source.includes('title: buildAnalyticsVerificationTaskTitle(row),'),
        true,
        'recent and focus verify cards should use the readable task title helper'
    );
    assert.equal(
        source.includes('meta: buildAnalyticsVerificationTaskMeta(row),'),
        true,
        'recent and focus verify cards should use the readable task meta helper'
    );
    assert.equal(
        source.includes('title: row?.verification_id || identity'),
        false,
        'recent verify cards should not lead with the raw verification id when submitter identity exists'
    );
    assert.equal(
        source.includes('<details class="analytics-compact-item analytics-compact-item--expandable">'),
        true,
        'compact renderer should render detail-enabled cards as native expandable cards'
    );
    assert.equal(
        source.includes('function buildAnalyticsVerificationUserDetailContext(row = {})'),
        true,
        'verify task cards should build a user-detail context with the verification reference'
    );
    assert.equal(
        source.includes("action: 'analytics-open-user-detail'"),
        true,
        'verify task cards should expose a user-detail action when a website user id exists'
    );
    assert.equal(
        source.includes('data-user-email="${escapeHtml(userEmail)}"'),
        true,
        'verify task card actions should carry the website user email'
    );
    assert.equal(
        source.includes('class="analytics-compact-item__detail-link"'),
        true,
        'the submitter detail value should render as a clickable inline link'
    );
    assert.equal(
        source.includes("defaultTab: 'ledger'"),
        true,
        'verify task user-detail context should open the ledger tab'
    );
    assert.equal(
        source.includes('ledgerReferenceId: verificationId'),
        true,
        'verify task user-detail context should carry the verification id as the ledger focus reference'
    );
    assert.equal(
        styles.includes('20260430_ADMIN_ANALYTICS_VERIFY_TASK_EXPAND_DETAILS_2'),
        true,
        'admin studio CSS should style expandable verify task cards'
    );
    assert.equal(
        styles.includes('flex: 0 0 auto !important;'),
        true,
        'expanded verify cards should not shrink and squeeze following cards in the scroll list'
    );
    assert.equal(
        styles.includes('max-height: none !important;'),
        true,
        'expanded verify card details should not be clipped by inherited max-height rules'
    );
    assert.equal(
        styles.includes('overflow-y: auto !important;'),
        true,
        'the verify task list should scroll instead of compressing cards after expansion'
    );
    assert.equal(
        html.includes('verifyTaskExpandDetails=20260430_ADMIN_ANALYTICS_VERIFY_TASK_EXPAND_DETAILS_2'),
        true,
        'admin studio should cache-bust the verify task detail update'
    );
    assert.equal(
        html.includes('verifyTaskFailureReason=20260430_ADMIN_ANALYTICS_VERIFY_TASK_FAILURE_REASON_2'),
        true,
        'admin studio should cache-bust the verify task failure reason update'
    );
    assert.equal(
        html.includes('verifyTaskCollapsedSummary=20260430_ADMIN_ANALYTICS_VERIFY_TASK_COLLAPSED_SUMMARY_1'),
        true,
        'admin studio should cache-bust the verify task collapsed summary update'
    );
    assert.equal(
        html.includes('verifyTaskSubmitterIdentity=20260430_ADMIN_ANALYTICS_VERIFY_TASK_SUBMITTER_IDENTITY_1'),
        true,
        'admin studio should cache-bust the verify task submitter identity update'
    );
    assert.equal(
        html.includes('verifyTaskUserDetailLink=20260430_ADMIN_ANALYTICS_VERIFY_TASK_USER_DETAIL_LINK_1'),
        true,
        'admin studio should cache-bust the verify task user detail link update'
    );
    assert.equal(
        serverBuilder.includes('detailItems: buildAnalyticsVerificationTaskDetails(row),'),
        true,
        'server-built verify summary payloads should preserve expandable details'
    );
    assert.equal(
        serverBuilder.includes('function getAnalyticsVerificationFailureReason(row = {})'),
        true,
        'server-built verify summary payloads should include the same failure reason helper'
    );
    assert.equal(
        serverBuilder.includes('function getAnalyticsVerificationSubmitterIdentity(row = {})'),
        true,
        'server-built verify summary payloads should use the website submitter helper'
    );
    assert.equal(
        serverBuilder.includes('function buildAnalyticsVerificationUserDetailContext(row = {})'),
        true,
        'server-built verify summary payloads should include the same user-detail context'
    );
    assert.equal(
        serverBuilder.includes("action: 'analytics-open-user-detail'"),
        true,
        'server-built verify summary cards should be clickable into the website user detail'
    );
    assert.equal(
        serverPayloadBundle.includes(".from('profiles')"),
        true,
        'summary payload bundle should enrich verification rows from website profiles by user_id'
    );
    assert.equal(
        serverPayloadBundle.includes('enrichVerificationRowsWithSubmitters'),
        true,
        'summary payload bundle should attach profile data before building verify task cards'
    );
    assert.equal(
        serverPayloadBundle.includes('supabase.auth.admin.getUserById'),
        true,
        'summary payload bundle should fall back to auth users when profile email is missing'
    );
    assert.equal(
        adminStudioSource.includes("case 'analytics-open-user-detail':"),
        true,
        'admin studio should handle verify task user-detail actions'
    );
    assert.equal(
        adminStudioSource.includes('ledgerReferenceId'),
        true,
        'admin studio should pass the verification reference through to the users module'
    );
    assert.equal(
        workbenchSource.includes('...(analyticsContext ? { analyticsContext } : {})'),
        true,
        'admin workbench user-detail fallback should preserve the verification analytics context'
    );
    assert.equal(
        usersSource.includes('function getUserModalLedgerFocusReferenceId'),
        true,
        'user detail should resolve the ledger focus reference from analytics context'
    );
    assert.equal(
        usersSource.includes('target.scrollIntoView({ block: \'center\', behavior: \'smooth\' });'),
        true,
        'user detail should scroll the focused verification ledger record into view'
    );
    assert.equal(
        usersSource.includes('users-ledger-focus-pill'),
        true,
        'user detail should label the focused verification ledger record'
    );
    assert.equal(
        styles.includes('20260430_ADMIN_ANALYTICS_VERIFY_TASK_USER_DETAIL_LINK_1'),
        true,
        'admin studio light CSS should style the focused verification ledger record'
    );
    assert.equal(
        styles.includes('20260430_ADMIN_ANALYTICS_VERIFY_SUBMITTER_DEEP_LINK_1'),
        true,
        'admin studio CSS should style the clickable verification submitter email'
    );
    assert.equal(
        baseStyles.includes('.admin-ledger-item.is-focused'),
        true,
        'base admin CSS should highlight the focused verification ledger record'
    );
    assert.equal(
        html.includes('verifySubmitterDeepLink=20260430_ADMIN_ANALYTICS_VERIFY_SUBMITTER_DEEP_LINK_1'),
        true,
        'admin studio should cache-bust the submitter deep-link update'
    );
    assert.equal(
        usersSource.includes("setUserModalTabFilterState('ledger', createDefaultUserModalTabFilterState('ledger'));"),
        true,
        'opening a verification context should reset the ledger filter so the target record is visible'
    );
    assert.equal(
        usersSource.includes('window.openAdminLedgerDetail?.(ledgerId);'),
        true,
        'user detail should automatically open the focused verification ledger detail when requested'
    );
    assert.equal(
        usersSource.includes(".eq('reference_id', focusReferenceId)"),
        true,
        'user detail should fetch the focused verification ledger row even when it is older than the recent list'
    );
    ['提交用户', '验证账号', '是否通过', '提交模式', '失败原因', '队列位置', '预计等待', '处理耗时'].forEach((label) => {
        assert.equal(usersSource.includes(`label: '${label}'`), true, `ledger detail modal should include ${label}`);
    });
    ['验证返回摘要', '上游原始记录'].forEach((title) => {
        assert.equal(usersSource.includes(`title: '${title}'`), true, `ledger detail modal should include ${title}`);
    });
    assert.equal(
        usersSource.includes('function buildAdminVerifyLedgerDetail(detail, verifyLog = null)'),
        true,
        'verify ledger detail should have a fallback builder that can render even when the log lookup misses'
    );
    assert.equal(
        usersSource.includes("const verifyLogColumns = 'verification_id, user_id, site, status, summary, message, points_deducted, created_at';"),
        true,
        'verify ledger detail lookup should only request stable verification log columns'
    );
    assert.equal(
        usersSource.includes("select('verification_id, user_id, site, status, summary, message, error_message, stage_label, raw_status, points_deducted, created_at')"),
        false,
        'verify ledger detail lookup should not fail when optional expanded columns are absent'
    );
    assert.equal(
        usersSource.includes(".ilike('message', `%${detail.referenceId}%`)"),
        true,
        'verify ledger detail lookup should recover old logs where the job id only lives in the message payload'
    );
    assert.equal(
        usersSource.includes('detail.verify = buildAdminVerifyLedgerDetail(detail, null);'),
        true,
        'verify ledger detail modal should still render a fallback section when the log lookup errors'
    );
    assert.equal(
        html.includes('verifyLedgerDetailFallback=20260430_ADMIN_VERIFY_LEDGER_DETAIL_FALLBACK_1'),
        true,
        'admin studio should cache-bust the verification ledger detail fallback update'
    );
});

test('analytics verify task cards use website email and link to the matching user ledger record', () => {
    const { buildVerifyServiceSummaryFromRows } = require('../server/api-handlers/admin/analytics/_summary-row-builders');
    const userId = '2e69a374-1111-4111-8111-111111111111';
    const summary = buildVerifyServiceSummaryFromRows([
        {
            verification_id: 'verify-cn-26576',
            user_id: userId,
            submitter_email: 'site-owner@example.com',
            submitter_display_name: '站内用户',
            email: 'verenasheridan@gmail.com',
            site: 'cn',
            status: 'success',
            points_deducted: 2,
            message: JSON.stringify({
                kind: 'google_one_job',
                job_id: 'verify-cn-26576',
                email: 'verenasheridan@gmail.com',
                task_type: 'extract'
            }),
            created_at: '2026-04-30T02:32:00.000Z'
        }
    ]);
    const item = summary.recentItems[0];

    assert.equal(item.title, 'site-owner@example.com');
    assert.equal(item.title.includes(userId.slice(0, 8)), false);
    assert.equal(item.action, 'analytics-open-user-detail');
    assert.equal(item.actionLabel, '查看用户详情');
    assert.equal(item.userId, userId);
    assert.equal(item.userEmail, 'site-owner@example.com');
    const [submitterDetail, submittedContentDetail, passDetail] = item.detailItems;
    assert.equal(submitterDetail.label, '提交人');
    assert.equal(submitterDetail.value, 'site-owner@example.com');
    assert.equal(submitterDetail.action, 'analytics-open-user-detail');
    assert.equal(submitterDetail.userId, userId);
    assert.equal(submitterDetail.userEmail, 'site-owner@example.com');
    assert.equal(submitterDetail.context.autoOpenLedgerDetail, true);
    assert.deepEqual(submittedContentDetail, { label: '提交内容', value: '账号 verenasheridan@gmail.com · 半流程 / 仅提链' });
    assert.deepEqual(passDetail, { label: '是否通过', value: '通过' });
    assert.deepEqual(
        {
            defaultTab: item.context.defaultTab,
            contextType: item.context.contextType,
            userId: item.context.userId,
            userEmail: item.context.userEmail,
            verificationId: item.context.verificationId,
            ledgerReferenceId: item.context.ledgerReferenceId,
            autoOpenLedgerDetail: item.context.autoOpenLedgerDetail
        },
        {
            defaultTab: 'ledger',
            contextType: 'verification',
            userId,
            userEmail: 'site-owner@example.com',
            verificationId: 'verify-cn-26576',
            ledgerReferenceId: 'verify-cn-26576',
            autoOpenLedgerDetail: true
        }
    );
});

test('analytics verify failed cards prefer actionable guidance over generic task failure', () => {
    const { buildVerifyServiceSummaryFromRows } = require('../server/api-handlers/admin/analytics/_summary-row-builders');
    const guidance = '请删除或者关闭付款资料后重试';
    const summary = buildVerifyServiceSummaryFromRows([
        {
            verification_id: 'job-payment-profile',
            email: 'member@example.com',
            status: 'failed',
            summary: '任务失败',
            message: JSON.stringify({
                kind: 'google_one_job',
                job_id: 'job-payment-profile',
                email: 'member@example.com',
                task_type: 'full',
                error_message: '任务失败',
                message: guidance,
                error_code: 'payment_profile_conflict'
            }),
            created_at: '2026-04-30T04:00:00.000Z'
        }
    ]);

    assert.equal(summary.recentItems[0].summary, guidance);
    assert.equal(summary.recentItems[0].hideSummary, true);
    assert.equal(summary.focusItems[0].summary, guidance);
    assert.equal(summary.focusItems[0].hideSummary, true);
    assert.deepEqual(
        summary.recentItems[0].detailItems.find((item) => item.label === '失败原因'),
        { label: '失败原因', value: guidance }
    );
    assert.equal(summary.recommendations[0].sampleItems[0].includes(guidance), true);
});

test('analytics verify completed cards keep success result only inside expanded details', () => {
    const { buildVerifyServiceSummaryFromRows } = require('../server/api-handlers/admin/analytics/_summary-row-builders');
    const offerUrl = 'https://one.google.com/offer/DLUUN6994MKQ7DP5PYE';
    const resultText = `提取成功：${offerUrl}`;
    const summary = buildVerifyServiceSummaryFromRows([
        {
            verification_id: 'verify-cn-26576',
            email: 'verenasheridan@gmail.com',
            status: 'success',
            summary: resultText,
            message: JSON.stringify({
                kind: 'google_one_job',
                job_id: 'verify-cn-26576',
                email: 'verenasheridan@gmail.com',
                task_type: 'extract',
                url: offerUrl,
                message: resultText
            }),
            created_at: '2026-04-30T02:32:00.000Z'
        }
    ]);
    const resultDetail = summary.recentItems[0].detailItems.find((item) => item.label === '返回内容');

    assert.equal(summary.recentItems[0].summary, resultText);
    assert.equal(summary.recentItems[0].hideSummary, true);
    assert.deepEqual(resultDetail, {
        label: '返回内容',
        value: resultText,
        href: offerUrl
    });
});
