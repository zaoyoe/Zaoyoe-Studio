function toNumericValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value, digits = 1) {
    const numericValue = toNumericValue(value);
    if (numericValue === null) return null;
    const factor = 10 ** digits;
    return Math.round(numericValue * factor) / factor;
}

function trimTrailingZeros(value) {
    return String(value)
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.0+$/, '');
}

function formatNumber(num) {
    const value = toNumericValue(num);
    if (value === null) return '--';

    const absValue = Math.abs(value);
    if (absValue >= 10000) {
        return `${trimTrailingZeros((value / 10000).toFixed(1))}w`;
    }
    if (absValue >= 1000) {
        return `${trimTrailingZeros((value / 1000).toFixed(1))}k`;
    }
    if (!Number.isInteger(value)) {
        return trimTrailingZeros(value.toFixed(1));
    }
    return String(value);
}

function formatPercent(value) {
    const numericValue = toNumericValue(value);
    if (numericValue === null) return '--';
    return `${trimTrailingZeros(numericValue.toFixed(2))}%`;
}

function truncateAnalyticsSnippet(value, maxLength = 36) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function formatAnalyticsDateTime(value) {
    if (!value) return '--';

    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '--';

    return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function getAnalyticsLedgerReason(row = {}) {
    return String(row?.reason || '').trim().toLowerCase();
}

function getAnalyticsLedgerReference(row = {}) {
    return String(row?.reference_id || '').trim().toUpperCase();
}

function isAnalyticsCheckinRewardEntry(row = {}) {
    return getAnalyticsLedgerReason(row) === 'daily_checkin';
}

function isAnalyticsAffiliateRewardEntry(row = {}) {
    const reference = getAnalyticsLedgerReference(row);
    return reference.startsWith('AFFILIATE_REWARD_') || reference.startsWith('AFF_REW_');
}

function isAnalyticsActivationRewardEntry(row = {}) {
    return getAnalyticsLedgerReference(row).startsWith('REG_REWARD_UNLOCK_');
}

function isAnalyticsRegistrationRewardEntry(row = {}) {
    const reference = getAnalyticsLedgerReference(row);
    return reference.startsWith('REG_REWARD_') && !reference.startsWith('REG_REWARD_UNLOCK_');
}

function sumAnalyticsPositiveAmounts(rows = []) {
    return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
        const amount = toNumericValue(row?.amount) || 0;
        return amount > 0 ? sum + amount : sum;
    }, 0);
}

function getVerifyStatusGroup(status = '') {
    const normalized = String(status || '').trim().toLowerCase();

    if (/success|succeed|completed|complete|verified|done|pass/.test(normalized)) {
        return 'success';
    }

    if (/process|pending|queue|running|retry|progress|active|submitted/.test(normalized)) {
        return 'active';
    }

    if (/fail|error|timeout|unsupported|reject|blocked|conflict|quota|disabled/.test(normalized)) {
        return 'failed';
    }

    return 'other';
}

function getVerifyStatusLabel(statusGroup = 'other') {
    switch (statusGroup) {
        case 'success':
            return '已完成';
        case 'active':
            return '处理中';
        case 'failed':
            return '失败/阻塞';
        default:
            return '其他状态';
    }
}

function getVerifyStatusTone(statusGroup = 'other') {
    switch (statusGroup) {
        case 'success':
            return 'success';
        case 'active':
            return 'warning';
        case 'failed':
            return 'danger';
        default:
            return 'neutral';
    }
}

function getAnalyticsVerificationPayload(row = {}) {
    const rawMessage = row?.message;
    if (rawMessage && typeof rawMessage === 'object' && !Array.isArray(rawMessage)) {
        return rawMessage;
    }

    const normalizedMessage = String(rawMessage || '').trim();
    if (!normalizedMessage || !normalizedMessage.startsWith('{')) {
        return {};
    }

    try {
        const parsed = JSON.parse(normalizedMessage);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch (_) {
        return {};
    }
}

function isGenericAnalyticsVerificationFailureText(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return [
        '任务失败',
        '失败',
        '失败/阻塞',
        'failed',
        'fail',
        'error',
        'task failed',
        'unknown'
    ].includes(normalized);
}

function pickAnalyticsVerificationFailureText(candidates = []) {
    let fallback = '';

    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        if (!value) continue;
        if (!isGenericAnalyticsVerificationFailureText(value)) {
            return value;
        }
        if (!fallback) {
            fallback = value;
        }
    }

    return fallback;
}

function getAnalyticsVerificationSummary(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const statusGroup = getVerifyStatusGroup(row?.status || payload.status || payload.raw_status);
    if (statusGroup === 'failed') {
        const failureReason = getAnalyticsVerificationFailureReason(row);
        if (failureReason) return failureReason;
    }

    const rawMessage = Object.keys(payload).length > 0 ? '' : row.message;
    return String(
        row.summary
        || payload.error_message
        || payload.message
        || rawMessage
        || row.error_message
        || row.stage_label
        || payload.stage_label
        || row.raw_status
        || payload.raw_status
        || ''
    ).trim();
}

function formatAnalyticsVerificationUserId(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return normalized.length > 12 ? `用户 ${normalized.slice(0, 8)}…` : `用户 ${normalized}`;
}

function getAnalyticsVerificationSubmitterProfile(row = {}) {
    const candidates = [
        row?.submitter,
        row?.submitter_profile,
        row?.profile,
        row?.profiles
    ];

    return candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) || {};
}

function getAnalyticsVerificationSubmitterEmail(row = {}) {
    const profile = getAnalyticsVerificationSubmitterProfile(row);
    return String(row?.submitter_email || profile.email || row?.user_email || '').trim();
}

function getAnalyticsVerificationSubmitterIdentity(row = {}) {
    const profile = getAnalyticsVerificationSubmitterProfile(row);
    const displayName = String(row?.submitter_display_name || profile.display_name || '').trim();
    const username = String(row?.submitter_username || profile.username || '').trim();
    const submitterEmail = getAnalyticsVerificationSubmitterEmail(row);

    return submitterEmail || displayName || username || '';
}

function getAnalyticsVerificationSubmittedAccount(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    return String(
        row?.submitted_email
        || row?.verification_email
        || row?.target_email
        || payload.email
        || row?.email
        || payload.user_id
        || ''
    ).trim();
}

function getAnalyticsVerificationTaskType(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    return String(row?.task_type || payload.task_type || row?.taskType || payload.taskType || '').trim().toLowerCase();
}

function getAnalyticsVerificationTaskTypeLabel(row = {}) {
    const taskType = getAnalyticsVerificationTaskType(row);
    if (taskType === 'full') return '全流程包绑卡';
    if (taskType === 'extract') return '半流程 / 仅提链';
    return '未记录模式';
}

function getAnalyticsVerificationPassLabel(row = {}) {
    const statusGroup = getVerifyStatusGroup(row?.status);
    if (statusGroup === 'success') return '通过';
    if (statusGroup === 'failed') return '未通过';
    if (statusGroup === 'active') return '处理中';
    return '待确认';
}

function getAnalyticsVerificationFailureReason(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const statusGroup = getVerifyStatusGroup(row?.status || payload.status || payload.raw_status);
    if (statusGroup !== 'failed') return '';

    const rawMessage = Object.keys(payload).length > 0 ? '' : row?.message;
    return pickAnalyticsVerificationFailureText([
        payload.failure_reason,
        row?.failure_reason,
        row?.error_message,
        payload.error_message,
        payload.message,
        rawMessage,
        row?.summary,
        payload.summary,
        payload.reason,
        row?.reason,
        payload.error,
        payload.error_code,
        row?.error_code,
        row?.stage_label,
        payload.stage_label,
        row?.raw_status,
        payload.raw_status
    ]);
}

function getAnalyticsVerificationResultDetail(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const resultUrl = String(payload.offer_url || payload.url || row?.offer_url || row?.url || '').trim();
    const statusGroup = getVerifyStatusGroup(row?.status || payload.status || payload.raw_status);
    if (statusGroup === 'failed') {
        return {
            value: getAnalyticsVerificationFailureReason(row),
            href: ''
        };
    }

    const rawMessage = Object.keys(payload).length > 0 ? '' : row?.message;
    const resultText = String(
        row?.summary
        || payload.summary
        || payload.message
        || rawMessage
        || resultUrl
        || payload.error_message
        || row?.error_message
        || row?.stage_label
        || payload.stage_label
        || ''
    ).trim();
    return {
        value: resultText,
        href: resultUrl
    };
}

function buildAnalyticsVerificationTaskTitle(row = {}) {
    const submitterIdentity = getAnalyticsVerificationSubmitterIdentity(row);
    const payload = getAnalyticsVerificationPayload(row);
    const verificationId = String(row?.verification_id || payload.job_id || payload.task_id || '').trim();
    return submitterIdentity || (verificationId ? `任务 #${verificationId}` : '未记录提交身份');
}

function buildAnalyticsVerificationUserDetailContext(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const userId = String(row?.user_id || payload.user_id || '').trim();
    if (!userId) {
        return null;
    }

    const verificationId = String(row?.verification_id || payload.job_id || payload.task_id || '').trim();
    const userEmail = getAnalyticsVerificationSubmitterEmail(row);
    const submittedAccount = getAnalyticsVerificationSubmittedAccount(row);
    const taskTypeLabel = getAnalyticsVerificationTaskTypeLabel(row);
    const statusLabel = getAnalyticsVerificationPassLabel(row);
    const site = String(row?.site || '').trim().toLowerCase();
    const siteLabel = site ? site.toUpperCase() : '';

    return {
        contextType: 'verification',
        sourceLabel: '验证交接',
        summary: verificationId
            ? `来自最近验证任务 #${verificationId}，进入用户详情后会定位到同一验证流水。`
            : '来自最近验证任务，进入用户详情后会优先查看验证相关流水。',
        signalLabel: '验证记录',
        signalValue: verificationId ? `#${verificationId}` : statusLabel,
        referenceLabel: '验证单号',
        referenceValue: verificationId,
        actionLabel: '回到验证监控',
        destination: 'verify-monitor',
        destinationContext: verificationId ? {
            verificationId,
            targetId: verificationId,
            referenceValue: verificationId
        } : {},
        userId,
        user_id: userId,
        userEmail,
        user_email: userEmail,
        email: userEmail,
        verificationId,
        verification_id: verificationId,
        ledgerReferenceId: verificationId,
        ledger_reference_id: verificationId,
        submittedAccount,
        submitted_account: submittedAccount,
        taskTypeLabel,
        task_type_label: taskTypeLabel,
        statusLabel,
        status_label: statusLabel,
        site,
        siteLabel,
        defaultTab: 'ledger',
        tab: 'ledger',
        autoOpenLedgerDetail: true,
        auto_open_ledger_detail: true
    };
}

function buildAnalyticsVerificationTaskAction(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const verificationId = String(row?.verification_id || payload.job_id || payload.task_id || '').trim();
    const userDetailContext = buildAnalyticsVerificationUserDetailContext(row);
    if (userDetailContext) {
        return {
            action: 'analytics-open-user-detail',
            actionLabel: '查看用户详情',
            icon: 'fas fa-user',
            userId: userDetailContext.userId,
            userEmail: userDetailContext.userEmail,
            context: userDetailContext
        };
    }

    return {
        actionLabel: verificationId ? '打开任务' : '打开 Verify Monitor',
        destination: 'verify-monitor',
        icon: 'fas fa-wave-square',
        context: verificationId ? {
            verificationId,
            targetId: verificationId,
            referenceValue: verificationId
        } : null
    };
}

function buildAnalyticsVerificationTaskMeta(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const verificationId = String(row?.verification_id || payload.job_id || payload.task_id || '').trim();
    const siteLabel = String(row?.site || 'all').toUpperCase();
    return [
        verificationId ? `任务 #${verificationId}` : '',
        getAnalyticsVerificationTaskTypeLabel(row),
        siteLabel,
        getAnalyticsVerificationPassLabel(row)
    ].filter(Boolean).join(' · ');
}

function buildAnalyticsVerificationSubmittedContent(row = {}) {
    const submittedAccount = getAnalyticsVerificationSubmittedAccount(row);
    return [
        submittedAccount ? `账号 ${submittedAccount}` : '未记录账号',
        getAnalyticsVerificationTaskTypeLabel(row)
    ].filter(Boolean).join(' · ');
}

function buildAnalyticsVerificationTaskDetails(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const verificationId = String(row?.verification_id || payload.job_id || payload.task_id || '').trim();
    const submitterIdentity = getAnalyticsVerificationSubmitterIdentity(row);
    const siteLabel = String(row?.site || 'all').toUpperCase();
    const resultDetail = getAnalyticsVerificationResultDetail(row);
    const failureReason = getAnalyticsVerificationFailureReason(row);
    const queuePosition = Number(payload.queue_position ?? row?.queue_position);
    const waitSeconds = Number(payload.estimated_wait_seconds ?? row?.estimated_wait_seconds);
    const points = toNumericValue(row?.points_deducted ?? payload.points_deducted);
    const submitterContext = buildAnalyticsVerificationUserDetailContext(row);
    const details = [
        submitterContext && submitterIdentity
            ? {
                label: '提交人',
                value: submitterIdentity,
                action: 'analytics-open-user-detail',
                userId: submitterContext.userId,
                userEmail: submitterContext.userEmail,
                context: {
                    ...submitterContext,
                    autoOpenLedgerDetail: true,
                    auto_open_ledger_detail: true
                }
            }
            : { label: '提交人', value: submitterIdentity || '未记录提交人' },
        { label: '提交内容', value: buildAnalyticsVerificationSubmittedContent(row) },
        { label: '是否通过', value: getAnalyticsVerificationPassLabel(row) }
    ];

    if (getVerifyStatusGroup(row?.status || payload.status || payload.raw_status) === 'failed') {
        details.push({ label: '失败原因', value: failureReason || '未记录失败原因' });
    }

    details.push(
        { label: '提交模式', value: getAnalyticsVerificationTaskTypeLabel(row) },
        { label: '任务号', value: verificationId || '未记录' },
        { label: '站点', value: siteLabel },
        { label: '提交时间', value: formatAnalyticsDateTime(row?.created_at) }
    );

    if (Number.isFinite(points) && points > 0) {
        details.push({ label: '扣积分', value: `${formatNumber(points)} 积分` });
    }
    if (Number.isFinite(queuePosition) && queuePosition >= 0) {
        details.push({ label: '队列位置', value: `#${queuePosition}` });
    }
    if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
        details.push({ label: '预计等待', value: `${formatNumber(waitSeconds)} 秒` });
    }
    if (resultDetail.value && resultDetail.value !== failureReason) {
        details.push({ label: '返回内容', value: resultDetail.value, href: resultDetail.href });
    }

    return details;
}

function shouldHideAnalyticsVerificationCollapsedSummary(row = {}) {
    const payload = getAnalyticsVerificationPayload(row);
    const statusGroup = getVerifyStatusGroup(row?.status || payload.status || payload.raw_status);
    return statusGroup === 'success' || statusGroup === 'failed';
}

function formatAnalyticsVerificationSample(row = {}) {
    const id = buildAnalyticsVerificationTaskTitle(row);
    const status = getVerifyStatusLabel(getVerifyStatusGroup(row?.status));
    const summary = truncateAnalyticsSnippet(getAnalyticsVerificationSummary(row), 30);
    return [id, status, summary].filter(Boolean).join(' · ');
}

function getAnalyticsRewardLabel(row = {}) {
    if (isAnalyticsAffiliateRewardEntry(row)) return '返佣';
    if (isAnalyticsActivationRewardEntry(row)) return '首单激活';
    if (isAnalyticsRegistrationRewardEntry(row)) return '注册奖励';
    if (isAnalyticsCheckinRewardEntry(row)) return '签到';
    return '系统奖励';
}

function formatAnalyticsRewardSample(row = {}) {
    const label = getAnalyticsRewardLabel(row);
    const amount = toNumericValue(row?.amount) || 0;
    const reference = truncateAnalyticsSnippet(String(row?.reference_id || ''), 20);
    return [label, `${formatNumber(amount)} 积分`, reference].filter(Boolean).join(' · ');
}

function formatAnalyticsGuestbookMessageSample(row = {}) {
    const content = truncateAnalyticsSnippet(row?.content || row?.message || '未填写留言内容', 26);
    const timeLabel = formatAnalyticsDateTime(row?.created_at);
    return [timeLabel, content].filter(Boolean).join(' · ');
}

function buildOverviewBusinessMixSummaryFromRows({
    unlockRows = [],
    verifyRows = [],
    guestbookMessages = [],
    guestbookComments = [],
    guestbookLikes = [],
    promptComments = [],
    rewardRows = []
} = {}) {
    const successCount = verifyRows.filter((row) => getVerifyStatusGroup(row?.status) === 'success').length;
    const successRate = verifyRows.length > 0 ? (successCount / verifyRows.length) * 100 : 0;
    const communityCount = guestbookMessages.length + guestbookComments.length + guestbookLikes.length + promptComments.length;
    const failedVerifyRows = verifyRows
        .filter((row) => getVerifyStatusGroup(row?.status) === 'failed')
        .slice(0, 2);
    const rewardEligibleRows = rewardRows.filter((row) => (
        isAnalyticsAffiliateRewardEntry(row)
        || isAnalyticsRegistrationRewardEntry(row)
        || isAnalyticsActivationRewardEntry(row)
        || isAnalyticsCheckinRewardEntry(row)
    ));
    const rewardFocusRows = rewardEligibleRows.slice(0, 3);
    const rewardPoints = roundTo(sumAnalyticsPositiveAmounts(rewardEligibleRows), 1) || 0;

    const items = [
        {
            title: '内容解锁',
            value: formatNumber(unlockRows.length),
            meta: 'Prompt 权益释放次数',
            badgeLabel: '内容',
            badgeTone: 'accent',
            summary: '反映提示词卡片和资源包的内容消费深度',
            actionLabel: '查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-fire',
            context: {
                sectionId: 'topContentList'
            }
        },
        {
            title: '验证请求',
            value: formatNumber(verifyRows.length),
            meta: `完成 ${successCount} / ${verifyRows.length || 0}`,
            badgeLabel: '验证',
            badgeTone: 'warning',
            summary: `当前窗口完成率 ${formatPercent(successRate)}`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square'
        },
        {
            title: '社区互动',
            value: formatNumber(communityCount),
            meta: `留言 ${guestbookMessages.length} / 评论 ${guestbookComments.length + promptComments.length} / 点赞 ${guestbookLikes.length}`,
            badgeLabel: '社区',
            badgeTone: 'neutral',
            summary: '覆盖留言板、Prompt 评论和点赞反馈',
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: {
                view: 'guestbook',
                status: 'unreplied'
            }
        },
        {
            title: '激励投放',
            value: formatNumber(rewardPoints),
            meta: '签到、返佣与拉新奖励积分',
            badgeLabel: '激励',
            badgeTone: 'success',
            summary: '帮助判断积分增长是否由运营激励驱动',
            actionLabel: '查看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-coins',
            context: {
                sectionId: 'pointsFlow'
            }
        }
    ];

    const recommendations = [];

    if (verifyRows.length > 0 && successRate < 85) {
        const failedFocusRow = failedVerifyRows[0] || verifyRows.find((row) => getVerifyStatusGroup(row?.status) !== 'success') || null;
        recommendations.push({
            tone: 'danger',
            level: '优先处理',
            title: '验证成功率偏低',
            summary: `当前窗口验证完成率只有 ${formatPercent(successRate)}，建议先检查失败/阻塞任务和额度状态。`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: failedFocusRow?.verification_id ? {
                verificationId: failedFocusRow.verification_id,
                targetId: failedFocusRow.verification_id,
                referenceValue: failedFocusRow.verification_id
            } : null,
            sampleLabel: '最近失败样本',
            sampleItems: failedVerifyRows.map((row) => formatAnalyticsVerificationSample(row))
        });
    }

    if (rewardPoints > 0) {
        recommendations.push({
            tone: 'warning',
            level: '建议复核',
            title: '激励投放正在影响积分结构',
            summary: `当前窗口已发放 ${formatNumber(rewardPoints)} 积分激励，建议结合积分与交易查看是否真正带来消费承接。`,
            actionLabel: '查看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-coins',
            context: {
                sectionId: 'pointsFlow'
            },
            sampleLabel: '最近放量样本',
            sampleItems: rewardFocusRows.map((row) => formatAnalyticsRewardSample(row))
        });
    }

    if (unlockRows.length > 0 && communityCount < unlockRows.length) {
        recommendations.push({
            tone: 'neutral',
            level: '可跟进',
            title: '内容消费已发生，社区反馈偏少',
            summary: `本窗口内容解锁 ${formatNumber(unlockRows.length)} 次，但社区互动只有 ${formatNumber(communityCount)} 次，可以检查留言治理和内容评论承接。`,
            actionLabel: '查看社区与裂变',
            destination: 'analytics-growth',
            icon: 'fas fa-comments'
        });
    }

    if (!recommendations.length) {
        recommendations.push({
            tone: 'success',
            level: '状态良好',
            title: '当前经营主线没有明显异常',
            summary: '建议继续观察内容消费、验证完成率和激励成本的联动变化。',
            actionLabel: '继续查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-chart-line'
        });
    }

    return {
        metrics: {
            unlockCount: unlockRows.length,
            verifyRequestCount: verifyRows.length,
            verifySuccessCount: successCount,
            verifySuccessRate: roundTo(successRate, 2) || 0,
            communityInteractionCount: communityCount,
            guestbookMessageCount: guestbookMessages.length,
            guestbookCommentCount: guestbookComments.length,
            guestbookLikeCount: guestbookLikes.length,
            promptCommentCount: promptComments.length,
            rewardPoints
        },
        items,
        recommendations,
        exportRows: [
            { '指标': '内容解锁', '数值': unlockRows.length, '说明': 'Prompt 权益释放次数' },
            { '指标': '验证请求', '数值': verifyRows.length, '说明': `已完成 ${successCount}，完成率 ${formatPercent(successRate)}` },
            { '指标': '社区互动', '数值': communityCount, '说明': `留言 ${guestbookMessages.length} / 评论 ${guestbookComments.length + promptComments.length} / 点赞 ${guestbookLikes.length}` },
            { '指标': '激励投放积分', '数值': rewardPoints, '说明': '签到、返佣与拉新奖励积分发放' }
        ]
    };
}

function buildVerifyServiceSummaryFromRows(rows = []) {
    const sortedRows = [...rows].sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime());
    const successRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'success');
    const activeRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'active');
    const failedRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'failed');
    const otherRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'other');
    const totalPoints = roundTo(sortedRows.reduce((sum, row) => sum + (toNumericValue(row?.points_deducted) || 0), 0), 1) || 0;
    const successRate = sortedRows.length > 0 ? (successRows.length / sortedRows.length) * 100 : 0;
    const avgPointsCostPerSuccess = successRows.length > 0
        ? roundTo(totalPoints / successRows.length, 1)
        : null;

    const statusItems = [
        {
            title: '已完成',
            value: formatNumber(successRows.length),
            meta: `占总请求 ${formatPercent(successRate)}`,
            badgeLabel: '健康',
            badgeTone: 'success',
            summary: '说明当前验证主链路的完成产能'
        },
        {
            title: '处理中',
            value: formatNumber(activeRows.length),
            meta: '排队、重试或运行中的任务',
            badgeLabel: '队列',
            badgeTone: 'warning',
            summary: '适合结合验证队列和告警工作区持续观察'
        },
        {
            title: '失败 / 阻塞',
            value: formatNumber(failedRows.length),
            meta: '超时、错误、限制或人工介入',
            badgeLabel: '风险',
            badgeTone: 'danger',
            summary: '建议和失败类型、错误码一起排查'
        },
        {
            title: '其他状态',
            value: formatNumber(otherRows.length),
            meta: '未归类到成功/处理中/失败',
            badgeLabel: '观察',
            badgeTone: 'neutral',
            summary: '用于发现新增状态或状态流转不一致'
        }
    ];

    const recentItems = sortedRows.slice(0, 5).map((row) => {
        const statusGroup = getVerifyStatusGroup(row?.status);
        return {
            title: buildAnalyticsVerificationTaskTitle(row),
            value: formatAnalyticsDateTime(row?.created_at),
            meta: buildAnalyticsVerificationTaskMeta(row),
            badgeLabel: getVerifyStatusLabel(statusGroup),
            badgeTone: getVerifyStatusTone(statusGroup),
            summary: getAnalyticsVerificationSummary(row) || '暂无额外摘要',
            hideSummary: shouldHideAnalyticsVerificationCollapsedSummary(row),
            detailItems: buildAnalyticsVerificationTaskDetails(row),
            ...buildAnalyticsVerificationTaskAction(row)
        };
    });

    const focusTaskRows = sortedRows
        .filter((row) => ['failed', 'active'].includes(getVerifyStatusGroup(row?.status)))
        .slice(0, 6);

    const focusItems = focusTaskRows.map((row) => {
        const statusGroup = getVerifyStatusGroup(row?.status);
        return {
            title: buildAnalyticsVerificationTaskTitle(row),
            value: formatAnalyticsDateTime(row?.created_at),
            meta: buildAnalyticsVerificationTaskMeta(row),
            badgeLabel: getVerifyStatusLabel(statusGroup),
            badgeTone: getVerifyStatusTone(statusGroup),
            summary: getAnalyticsVerificationSummary(row) || '暂无失败摘要',
            hideSummary: shouldHideAnalyticsVerificationCollapsedSummary(row),
            detailItems: buildAnalyticsVerificationTaskDetails(row),
            ...buildAnalyticsVerificationTaskAction(row)
        };
    });

    const recommendations = [];

    if (failedRows.length > 0) {
        const failedFocusRow = failedRows[0] || null;
        recommendations.push({
            tone: 'danger',
            level: '优先处理',
            title: '存在失败或阻塞任务',
            summary: `当前窗口有 ${formatNumber(failedRows.length)} 条失败/阻塞任务，建议先进入 Verify Monitor 看高频失败原因和待收口告警。`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: failedFocusRow?.verification_id ? {
                verificationId: failedFocusRow.verification_id,
                targetId: failedFocusRow.verification_id,
                referenceValue: failedFocusRow.verification_id
            } : null,
            sampleLabel: '最近异常',
            sampleItems: failedRows.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row))
        });
    }

    if (activeRows.length > 0) {
        const activeFocusRow = activeRows[0] || null;
        recommendations.push({
            tone: 'warning',
            level: '建议复核',
            title: '验证队列仍有处理中任务',
            summary: `当前仍有 ${formatNumber(activeRows.length)} 条处理中任务，建议检查 Google One API 配置、额度和队列状态。`,
            actionLabel: '检查验证配置',
            destination: 'settings-google-one',
            icon: 'fas fa-sliders',
            context: activeFocusRow?.verification_id ? {
                verificationId: activeFocusRow.verification_id,
                targetId: activeFocusRow.verification_id,
                referenceValue: activeFocusRow.verification_id
            } : null,
            sampleLabel: '排队样本',
            sampleItems: activeRows.slice(0, 2).map((row) => formatAnalyticsVerificationSample(row))
        });
    }

    if (avgPointsCostPerSuccess !== null && avgPointsCostPerSuccess > 0) {
        recommendations.push({
            tone: 'neutral',
            level: '持续观察',
            title: '跟踪验证成功成本',
            summary: `当前窗口单次成功平均消耗约 ${formatNumber(avgPointsCostPerSuccess)} 积分，建议结合积分与交易看验证业务是否仍然划算。`,
            actionLabel: '查看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-wallet',
            context: {
                sectionId: 'pointsFlow'
            }
        });
    }

    if (!recommendations.length) {
        recommendations.push({
            tone: 'success',
            level: '状态良好',
            title: '验证链路暂时平稳',
            summary: '当前窗口没有明显失败或堆积，可以继续观察完成率和成本的变化。',
            actionLabel: '查看验证配置',
            destination: 'settings-google-one',
            icon: 'fas fa-shield-halved'
        });
    }

    return {
        metrics: {
            requestCount: sortedRows.length,
            successCount: successRows.length,
            activeCount: activeRows.length,
            failedCount: failedRows.length,
            otherCount: otherRows.length,
            successRate: roundTo(successRate, 2) || 0,
            totalPointsCost: totalPoints,
            avgPointsCostPerSuccess: avgPointsCostPerSuccess ?? 0
        },
        statusItems,
        recentItems,
        focusItems,
        recentRows: sortedRows.slice(0, 8).map((row) => ({
            '验证单号': row?.verification_id || '',
            '用户': getAnalyticsVerificationSubmitterIdentity(row) || '匿名用户',
            '站点': String(row?.site || 'all').toUpperCase(),
            '状态': getVerifyStatusLabel(getVerifyStatusGroup(row?.status)),
            '积分消耗': toNumericValue(row?.points_deducted) || 0,
            '时间': formatAnalyticsDateTime(row?.created_at),
            '摘要': getAnalyticsVerificationSummary(row) || ''
        })),
        focusRows: focusTaskRows.map((row) => ({
            '验证单号': row?.verification_id || '',
            '用户': getAnalyticsVerificationSubmitterIdentity(row) || '匿名用户',
            '站点': String(row?.site || 'all').toUpperCase(),
            '状态': getVerifyStatusLabel(getVerifyStatusGroup(row?.status)),
            '时间': formatAnalyticsDateTime(row?.created_at),
            '摘要': getAnalyticsVerificationSummary(row) || ''
        })),
        samples: {
            focusTasks: focusTaskRows.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row)),
            recentTasks: sortedRows.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row))
        },
        recommendations
    };
}

function buildGrowthSummaryFromRows({
    guestbookMessages = [],
    guestbookComments = [],
    guestbookLikes = [],
    promptComments = [],
    ledgerRows = []
} = {}) {
    const interactionCount = guestbookComments.length + guestbookLikes.length + promptComments.length;
    const repliedMessageIds = new Set(
        guestbookComments
            .map((row) => String(row?.message_id || '').trim())
            .filter(Boolean)
    );
    const unrepliedMessages = guestbookMessages
        .filter((row) => !repliedMessageIds.has(String(row?.id || '').trim()))
        .slice(0, 3);
    const affiliateRewardRows = ledgerRows.filter((row) => isAnalyticsAffiliateRewardEntry(row));
    const registrationRewardRows = ledgerRows.filter((row) => isAnalyticsRegistrationRewardEntry(row));
    const activationRewardRows = ledgerRows.filter((row) => isAnalyticsActivationRewardEntry(row));
    const checkinRewardRows = ledgerRows.filter((row) => isAnalyticsCheckinRewardEntry(row));
    const guestbookReplyRate = guestbookMessages.length > 0
        ? (guestbookComments.length / guestbookMessages.length) * 100
        : 0;

    const affiliateRewardPoints = roundTo(sumAnalyticsPositiveAmounts(affiliateRewardRows), 1) || 0;
    const registrationRewardPoints = roundTo(sumAnalyticsPositiveAmounts(registrationRewardRows), 1) || 0;
    const activationRewardPoints = roundTo(sumAnalyticsPositiveAmounts(activationRewardRows), 1) || 0;
    const referralRewardPoints = roundTo(sumAnalyticsPositiveAmounts([
        ...affiliateRewardRows,
        ...registrationRewardRows,
        ...activationRewardRows
    ]), 1) || 0;
    const checkinRewardPoints = roundTo(sumAnalyticsPositiveAmounts(checkinRewardRows), 1) || 0;
    const referralConfigField = affiliateRewardPoints >= (registrationRewardPoints + activationRewardPoints)
        ? 'commission_rate_shop'
        : 'registration_reward_points';
    const referralFocusRow = referralConfigField === 'commission_rate_shop'
        ? (affiliateRewardRows[0] || registrationRewardRows[0] || activationRewardRows[0] || null)
        : (registrationRewardRows[0] || activationRewardRows[0] || affiliateRewardRows[0] || null);
    const checkinFocusRow = checkinRewardRows[0] || null;

    const breakdownItems = [
        {
            title: '留言板互动',
            value: formatNumber(guestbookMessages.length + guestbookComments.length + guestbookLikes.length),
            meta: `发帖 ${guestbookMessages.length} / 评论 ${guestbookComments.length} / 点赞 ${guestbookLikes.length}`,
            badgeLabel: '社区',
            badgeTone: 'accent',
            summary: '最能反映站内公开讨论和反馈热度',
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: {
                view: 'guestbook',
                status: 'unreplied'
            }
        },
        {
            title: 'Prompt 评论',
            value: formatNumber(promptComments.length),
            meta: '内容页评论参与',
            badgeLabel: '内容',
            badgeTone: 'neutral',
            summary: '能帮助判断内容讨论是否转化为二次互动',
            actionLabel: '回看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-fire',
            context: {
                sectionId: 'topContentList'
            }
        },
        {
            title: '分销返佣',
            value: formatNumber(affiliateRewardPoints),
            meta: `${affiliateRewardRows.length} 笔奖励`,
            badgeLabel: '返佣',
            badgeTone: 'success',
            summary: '对应商城或充值带来的分销奖励发放',
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: 'commission_rate_shop'
            }
        },
        {
            title: '拉新激活',
            value: formatNumber(roundTo(registrationRewardPoints + activationRewardPoints, 1) || 0),
            meta: `注册 ${registrationRewardRows.length} / 首单 ${activationRewardRows.length}`,
            badgeLabel: '拉新',
            badgeTone: 'warning',
            summary: '观察邀请注册与首单激活是否真正形成闭环',
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: 'registration_reward_points'
            }
        },
        {
            title: '签到奖励',
            value: formatNumber(checkinRewardPoints),
            meta: `${checkinRewardRows.length} 笔发放`,
            badgeLabel: '签到',
            badgeTone: 'accent',
            summary: '帮助判断日常活跃维护是否依赖签到补贴',
            actionLabel: '查看积分流水',
            destination: 'points',
            icon: 'fas fa-calendar-check',
            context: checkinFocusRow ? {
                view: 'lookup',
                lookupValue: String(checkinFocusRow.id || '').trim(),
                ledgerId: String(checkinFocusRow.id || '').trim(),
                referenceId: String(checkinFocusRow.reference_id || '').trim()
            } : {
                view: 'batches',
                quick: 'today'
            }
        }
    ];

    const recommendations = [];

    if (guestbookMessages.length > 0 && guestbookReplyRate < 80) {
        const focusMessage = unrepliedMessages[0] || guestbookMessages[0] || null;
        recommendations.push({
            tone: 'warning',
            level: '建议跟进',
            title: '留言板回复率还有提升空间',
            summary: `当前窗口发帖 ${formatNumber(guestbookMessages.length)} 条，留言板回复率约 ${formatPercent(guestbookReplyRate)}，建议进入留言治理补承接。`,
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: focusMessage?.id ? {
                view: 'guestbook',
                commentId: focusMessage.id,
                focusCommentId: focusMessage.id,
                status: 'unreplied',
                search: truncateAnalyticsSnippet(focusMessage.content || '', 16)
            } : {
                view: 'guestbook',
                status: 'unreplied'
            },
            sampleLabel: '待承接留言',
            sampleItems: unrepliedMessages.map((row) => formatAnalyticsGuestbookMessageSample(row))
        });
    }

    if (referralRewardPoints > 0) {
        recommendations.push({
            tone: 'neutral',
            level: '持续观察',
            title: '返佣与拉新奖励已开始放量',
            summary: `当前窗口裂变相关奖励发放 ${formatNumber(referralRewardPoints)} 积分，建议复核推广配置和返佣 ROI。`,
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: referralConfigField,
                referenceId: String(referralFocusRow?.reference_id || '').trim(),
                rewardType: getAnalyticsRewardLabel(referralFocusRow || {})
            },
            sampleLabel: '最近奖励样本',
            sampleItems: [...affiliateRewardRows, ...registrationRewardRows, ...activationRewardRows]
                .slice(0, 3)
                .map((row) => formatAnalyticsRewardSample(row))
        });
    }

    if (checkinRewardPoints > 0) {
        recommendations.push({
            tone: 'accent',
            level: '运营观察',
            title: '签到奖励正在维持活跃',
            summary: `当前窗口签到奖励发放 ${formatNumber(checkinRewardPoints)} 积分，建议结合积分与交易判断签到补贴是否转化成消费。`,
            actionLabel: '查看积分流水',
            destination: 'points',
            icon: 'fas fa-calendar-check',
            context: checkinFocusRow ? {
                view: 'lookup',
                lookupValue: String(checkinFocusRow.id || '').trim(),
                ledgerId: String(checkinFocusRow.id || '').trim(),
                referenceId: String(checkinFocusRow.reference_id || '').trim()
            } : {
                view: 'batches',
                quick: 'today'
            },
            sampleLabel: '最近签到流水',
            sampleItems: checkinRewardRows.slice(0, 3).map((row) => formatAnalyticsRewardSample(row))
        });
    }

    if (!recommendations.length) {
        recommendations.push({
            tone: 'success',
            level: '状态良好',
            title: '社区与裂变链路暂时平稳',
            summary: '建议继续观察留言回复、邀请转化和签到奖励的联动变化。',
            actionLabel: '查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-fire'
        });
    }

    return {
        metrics: {
            guestbookMessageCount: guestbookMessages.length,
            guestbookCommentCount: guestbookComments.length,
            guestbookLikeCount: guestbookLikes.length,
            promptCommentCount: promptComments.length,
            interactionCount,
            guestbookReplyRate: roundTo(guestbookReplyRate, 2) || 0,
            affiliateRewardPoints,
            registrationRewardPoints,
            activationRewardPoints,
            referralRewardPoints,
            checkinRewardPoints
        },
        samples: {
            unrepliedMessages: unrepliedMessages.map((row) => formatAnalyticsGuestbookMessageSample(row)),
            referralRewards: [...affiliateRewardRows, ...registrationRewardRows, ...activationRewardRows]
                .slice(0, 3)
                .map((row) => formatAnalyticsRewardSample(row)),
            checkinRewards: checkinRewardRows.slice(0, 3).map((row) => formatAnalyticsRewardSample(row))
        },
        breakdownItems,
        recommendations,
        exportRows: [
            { '指标': '留言板发帖', '数值': guestbookMessages.length, '说明': `回复率 ${formatPercent(guestbookReplyRate)}` },
            { '指标': '留言板评论', '数值': guestbookComments.length, '说明': '留言治理承接量' },
            { '指标': '留言板点赞', '数值': guestbookLikes.length, '说明': '用户轻互动反馈' },
            { '指标': 'Prompt 评论', '数值': promptComments.length, '说明': '内容页评论参与' },
            { '指标': '分销返佣积分', '数值': affiliateRewardPoints, '说明': `${affiliateRewardRows.length} 笔奖励` },
            { '指标': '拉新注册积分', '数值': registrationRewardPoints, '说明': `${registrationRewardRows.length} 笔奖励` },
            { '指标': '首单激活积分', '数值': activationRewardPoints, '说明': `${activationRewardRows.length} 笔奖励` },
            { '指标': '签到奖励积分', '数值': checkinRewardPoints, '说明': `${checkinRewardRows.length} 笔发放` }
        ]
    };
}

module.exports = {
    buildOverviewBusinessMixSummaryFromRows,
    buildVerifyServiceSummaryFromRows,
    buildGrowthSummaryFromRows
};
