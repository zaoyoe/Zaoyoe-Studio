// Shared analytics AI insight and fallback helpers.

function hasAdminAI() {
    return Boolean(window.AdminAI?.configured);
}

function isGeminiQuotaError(error) {
    const message = String(error?.message || '');
    return Boolean(
        error?.isRateLimited
        || error?.status === 429
        || /resource exhausted|quota|429/i.test(message)
    );
}

function buildQuotaFallbackHint(label = '已切换为本地估算') {
    return `<p class="ai-cache-hint">Gemini 配额暂时不足，${escapeHtml(label)}。</p>`;
}

function getAnalyticsInsightCacheReport(cacheValue = getAnalyticsInsightCacheValue()) {
    if (cacheValue && typeof cacheValue === 'object') {
        return String(cacheValue.report || '').trim();
    }

    return String(cacheValue || '').trim();
}

function getAnalyticsInsightCacheSummary(cacheValue = getAnalyticsInsightCacheValue()) {
    return cacheValue && typeof cacheValue === 'object'
        ? cacheValue.summaryData || null
        : null;
}

function renderAIInsightMarkup(reportText, options = {}) {
    const {
        hintHtml = '',
        summaryData = null
    } = options;
    const normalizedReport = String(reportText || '').trim();
    const actionData = buildAnalyticsAIActionCardsData(summaryData);
    const anomalyCards = buildAnalyticsBusinessAnomalyCardsData(summaryData);
    const pulseMarkup = renderAnalyticsAIPulseSummary(actionData.pulseSummary);
    const siteComparisonMarkup = renderAnalyticsAISiteComparison(summaryData?.site_comparison || summaryData?.siteComparisonData || null);
    const metricContextMarkup = renderAnalyticsMetricContextNotice(summaryData);
    const anomalyMarkup = renderAnalyticsBusinessAnomalyCards(anomalyCards);
    const cardsMarkup = renderAnalyticsAIActionCards(actionData);

    return `
        <div class="ai-insight-layout">
            ${normalizedReport ? `<div class="ai-report">${formatAIResponse(normalizedReport)}</div>` : ''}
            ${metricContextMarkup}
            ${pulseMarkup}
            ${siteComparisonMarkup}
            ${anomalyMarkup}
            ${cardsMarkup}
            ${hintHtml}
        </div>
    `;
}

function buildLocalAnalyticsInsight(data) {
    const overview = data?.overview || {};
    const summarySource = data?.summaryWindowData || data || {};
    const proxyMetricRows = getAnalyticsProxyMetricContextRows(data);
    const proxyPanelSummary = proxyMetricRows
        .map((row) => String(row?.['板块'] || '').trim())
        .filter(Boolean)
        .join('、');
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const dau = normalizeAnalyticsNumber(overview.dau);
    const mau = normalizeAnalyticsNumber(overview.mau);
    const newUsers = normalizeAnalyticsNumber(overview.new_users_week);
    const totalPoints = normalizeAnalyticsNumber(overview.total_points);
    const totalComments = normalizeAnalyticsNumber(overview.total_comments);
    const dauMauRatio = mau > 0 ? (dau / mau) * 100 : 0;
    const overviewBusinessMix = data?.overview_business_mix || data?.overviewBusinessMix || {};
    const verifyServiceSummary = data?.verify_service_summary || data?.verifyServiceSummary || {};
    const growthSummary = data?.growth_summary || data?.growthSummary || {};
    const operationsHealthSnapshot = data?.operations_health_snapshot || data?.operationsHealthSnapshot || {};
    const overviewMetrics = overviewBusinessMix.metrics || {};
    const verifyMetrics = verifyServiceSummary.metrics || {};
    const growthMetrics = growthSummary.metrics || {};
    const operationsMetrics = operationsHealthSnapshot.metrics || {};
    const siteComparisonData = data?.site_comparison || data?.siteComparisonData || null;
    const commerceFunnel = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const growthFunnel = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};
    const unlockCount = normalizeAnalyticsNumber(overviewMetrics.unlockCount);
    const verifyRequestCount = normalizeAnalyticsNumber(overviewMetrics.verifyRequestCount || verifyMetrics.requestCount);
    const verifySuccessRate = normalizeAnalyticsNumber(overviewMetrics.verifySuccessRate || verifyMetrics.successRate);
    const rewardPoints = normalizeAnalyticsNumber(overviewMetrics.rewardPoints);
    const communityInteractionCount = normalizeAnalyticsNumber(overviewMetrics.communityInteractionCount);
    const verifyFailedCount = normalizeAnalyticsNumber(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsNumber(verifyMetrics.activeCount);
    const verifyAvgPointsCost = normalizeAnalyticsNumber(verifyMetrics.avgPointsCostPerSuccess);
    const guestbookReplyRate = normalizeAnalyticsNumber(growthMetrics.guestbookReplyRate);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerceFunnel.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_purchase_users ?? eventOverview.shop_purchase_users);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerceFunnel.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);
    const inviteClickUsers = normalizeAnalyticsCountValue(growthFunnel.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growthFunnel.checkin_success_users ?? eventOverview.checkin_success_users);
    const paymentAlertTotal = normalizeAnalyticsCountValue(operationsMetrics.paymentAlertTotal);
    const paymentDeadLetterCount = normalizeAnalyticsCountValue(operationsMetrics.paymentDeadLetterCount);
    const ticketOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketOverdueCount);
    const ticketCriticalOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketCriticalOverdueCount);
    const ticketOldestWaitMinutes = normalizeAnalyticsCountValue(operationsMetrics.ticketOldestWaitMinutes);
    const actionRecommendations = collectAnalyticsActionRecommendations(data);
    const anomalyCards = buildAnalyticsBusinessAnomalyCardsData(data, 4);

    const trendRows = Array.isArray(data?.user_trend) ? data.user_trend : [];
    const trendValues = trendRows
        .map((item) => normalizeAnalyticsNumber(item?.new_users ?? item?.dau ?? item?.user_count ?? item?.value))
        .filter((value) => Number.isFinite(value));
    const recentWindow = trendValues.slice(-3);
    const previousWindow = trendValues.slice(-6, -3);
    const recentAvg = averageAnalyticsValues(recentWindow);
    const previousAvg = averageAnalyticsValues(previousWindow);
    const trendDelta = recentAvg - previousAvg;

    const channels = (Array.isArray(data?.channel_breakdown) ? data.channel_breakdown : [])
        .map((item) => {
            const numericKeys = ['user_count', 'count', 'orders', 'value', 'total', 'total_amount'];
            const volume = numericKeys
                .map((key) => normalizeAnalyticsNumber(item?.[key]))
                .find((value) => value > 0) || 0;
            return {
                name: String(item?.channel || item?.name || item?.source || '未知渠道'),
                volume
            };
        })
        .sort((left, right) => right.volume - left.volume);

    const channelTotal = channels.reduce((sum, item) => sum + item.volume, 0);
    const topChannel = channels[0] || null;
    const topChannelShare = topChannel && channelTotal > 0
        ? (topChannel.volume / channelTotal) * 100
        : 0;

    const highlights = [];
    if (dauMauRatio >= 20) {
        highlights.push(`- 业务 DAU/MAU 约 ${dauMauRatio.toFixed(1)}%，近期真实活跃度表现稳健。`);
    } else if (dau > 0 || mau > 0) {
        highlights.push(`- 当前业务 DAU ${dau}、业务 MAU ${mau}，真实活跃基础仍在持续累积。`);
    }
    if (newUsers > 0) {
        highlights.push(`- 最近 7 天新增用户 ${newUsers} 人，仍有持续拉新能力。`);
    }
    if (trendValues.length >= 6) {
        const trendText = trendDelta >= 0
            ? `近 3 天均值较前一阶段提升约 ${Math.abs(trendDelta).toFixed(1)}`
            : `近 3 天均值较前一阶段回落约 ${Math.abs(trendDelta).toFixed(1)}`;
        highlights.push(`- 用户趋势显示 ${trendText}。`);
    }
    if (topChannel && topChannel.volume > 0) {
        highlights.push(`- 当前主要渠道为 ${topChannel.name}，占样本约 ${topChannelShare.toFixed(1)}%。`);
    }
    if (unlockCount > 0 || verifyRequestCount > 0) {
        highlights.push(`- 当前窗口内容解锁 ${unlockCount} 次、验证请求 ${verifyRequestCount} 次，核心经营链路已有真实消费样本。`);
    }
    if (rechargeClickUsers > 0) {
        highlights.push(`- 真实交易链路中充值成功率约 ${rechargeSuccessRate.toFixed(1)}%，商城成交率约 ${shopPurchaseRate.toFixed(1)}%。`);
    }
    if (verifyRequestCount > 0 && verifySuccessRate >= 85) {
        highlights.push(`- 验证成功率约 ${verifySuccessRate.toFixed(1)}%，验证服务主链路整体稳定。`);
    }
    if (communityInteractionCount > 0 || referralRewardPoints > 0 || inviteClickUsers > 0 || checkinSuccessUsers > 0) {
        highlights.push(`- 社区互动 ${communityInteractionCount} 次，邀请点击 ${inviteClickUsers} 次，签到成功 ${checkinSuccessUsers} 次，增长动作已经开始形成真实承接。`);
    }
    if (siteComparisonData?.mode === 'compare' && Array.isArray(siteComparisonData.insights) && siteComparisonData.insights.length > 0) {
        highlights.push(`- 分站对比显示当前更值得优先关注 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.focusSite)}，主要差异在 ${siteComparisonData.insights[0] || '核心转化链路'}。`);
    }
    if (siteComparisonData?.focusSnapshot?.topChannel?.name || siteComparisonData?.focusSnapshot?.topCategory?.name) {
        highlights.push(`- ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.focusSite)} 当前主要入口是 ${siteComparisonData.focusSnapshot?.topChannel?.name || '待补充'}，内容热度更集中在 ${siteComparisonData.focusSnapshot?.topCategory?.name || '待补充'}。`);
    }
    if (paymentAlertTotal === 0 && ticketOverdueCount === 0 && ticketCriticalOverdueCount === 0) {
        highlights.push('- 支付异常和工单超时当前都比较平稳，运营侧暂时没有明显堆积。');
    }
    if (proxyMetricRows.length > 0) {
        highlights.unshift(`- 口径提醒：${proxyPanelSummary || '部分面板'} 当前仍为代理参考口径，只适合做趋势观察和排查线索。`);
    }
    if (!highlights.length) {
        highlights.push('- 当前统计样本较少，建议继续观察近 7 天的真实行为数据。');
    }

    const risks = [];
    if (mau > 0 && dauMauRatio < 12) {
        risks.push('- 业务 DAU/MAU 偏低，短期真实活跃留存还有提升空间。');
    }
    if (trendValues.length >= 6 && trendDelta < 0) {
        risks.push('- 最近 3 天新增/活跃趋势走弱，需要关注拉新效率是否下滑。');
    }
    if (topChannelShare >= 65) {
        risks.push(`- 渠道流量过度依赖 ${topChannel?.name}，波动风险偏高。`);
    }
    if (totalComments <= 0) {
        risks.push('- 评论互动偏少，社区反馈数据不足。');
    }
    if (verifyRequestCount > 0 && verifySuccessRate < 85) {
        risks.push(`- 验证成功率只有 ${verifySuccessRate.toFixed(1)}%，需要优先排查失败任务、额度或接口稳定性。`);
    }
    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        risks.push(`- 充值点击 ${rechargeClickUsers} 人但成功只有 ${rechargeSuccessUsers} 人，交易链路转化仍偏低。`);
    }
    if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        risks.push(`- 商城浏览 ${shopViewUsers} 人但成交率约 ${shopPurchaseRate.toFixed(1)}%，消费承接还有明显流失。`);
    }
    if (verifyActiveCount > 0 || verifyFailedCount > 0) {
        risks.push(`- 当前仍有 ${verifyActiveCount + verifyFailedCount} 条处理中/失败验证任务，可能影响付费体验。`);
    }
    if (rewardPoints > 0 && unlockCount <= 0) {
        risks.push('- 激励积分已经投放，但内容消费承接偏弱，需要警惕只发补贴不转化。');
    }
    if (growthMetrics.guestbookMessageCount > 0 && guestbookReplyRate < 80) {
        risks.push(`- 留言板回复率约 ${guestbookReplyRate.toFixed(1)}%，社区承接仍有缺口。`);
    }
    if (paymentDeadLetterCount > 0 || paymentAlertTotal > 0) {
        risks.push(`- 支付侧当前仍有 ${paymentAlertTotal} 条告警，死信 ${paymentDeadLetterCount} 条，需要尽快收口。`);
    }
    if (ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0) {
        risks.push(`- 工单侧已有 ${ticketOverdueCount} 单超时、critical ${ticketCriticalOverdueCount} 单，最老等待约 ${formatAnalyticsMinutesWindow(ticketOldestWaitMinutes)}。`);
    }
    if (siteComparisonData?.mode === 'compare' && siteComparisonData.topGap?.focusSite && Math.abs(normalizeAnalyticsNumber(siteComparisonData.topGap.diff)) >= 12) {
        risks.push(`- 分站差异明显，${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.topGap.focusSite)} 在 ${siteComparisonData.topGap.label} 上落后约 ${trimTrailingZeros(Math.abs(siteComparisonData.topGap.diff).toFixed(1))} 个百分点。`);
    }
    if (!risks.length) {
        risks.push('- 当前未发现明显异常，建议继续监控流量结构和留存波动。');
    }

    const suggestions = [];
    if (topChannelShare >= 65) {
        suggestions.push('- 增加第二增长渠道投放，降低单一渠道依赖。');
    } else {
        suggestions.push('- 对表现最好的渠道继续做素材复盘，放大稳定来源。');
    }
    if (dauMauRatio < 20) {
        suggestions.push('- 针对近 7 天新增用户做签到、提醒或权益触达，提升次日留存。');
    } else {
        suggestions.push('- 可以把活跃用户转化到评论、签到或积分任务，提升复访深度。');
    }
    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        suggestions.push('- 优先检查支付告警队列和充值成功链路，把真实点击后的支付损耗先收口。');
    } else if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        suggestions.push('- 重点复核商城套餐、权益和积分承接，让充值后的用户更顺滑地完成成交。');
    }
    if (totalPoints > 0) {
        suggestions.push('- 联动积分消费与内容解锁活动，提升积分流通和转化。');
    } else {
        suggestions.push('- 先补齐积分或互动活动数据，后续 AI 分析会更稳定。');
    }
    if (verifyRequestCount > 0 && verifySuccessRate < 85) {
        suggestions.push('- 优先查看 Verify Monitor 和 Google One 配置，先把验证成功率拉回稳定区间。');
    }
    if (referralRewardPoints > 0 || checkinRewardPoints > 0) {
        suggestions.push('- 把返佣、拉新、签到奖励和后续消费联动分析，确认补贴是否真正带来解锁或验证转化。');
    }
    if (verifyAvgPointsCost > 0) {
        suggestions.push(`- 继续跟踪验证单次成功成本，目前约 ${verifyAvgPointsCost.toFixed(1)} 积分，避免服务成本侵蚀利润。`);
    }
    if (paymentAlertTotal > 0) {
        suggestions.push('- 支付告警队列先做一轮清队，优先处理死信和重复重试，避免订单异常长期挂起。');
    }
    if (ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0) {
        suggestions.push('- 工单队列建议优先处理超时与 critical 项，再复核未指派和高优先任务。');
    }
    if (siteComparisonData?.mode === 'compare' && siteComparisonData.topGap?.focusSite && Math.abs(normalizeAnalyticsNumber(siteComparisonData.topGap.diff)) >= 12) {
        suggestions.push(`- 把 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.topGap.focusSite)} 站点作为本轮优先收口对象，先修复 ${siteComparisonData.topGap.label} 这条落后链路。`);
    }
    if (siteComparisonData?.focusSnapshot?.topChannel?.name || siteComparisonData?.focusSnapshot?.topContent?.title) {
        suggestions.push(`- 优先复盘 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.focusSite)} 的 ${siteComparisonData.focusSnapshot?.topChannel?.name || '主要入口'} 和《${siteComparisonData.focusSnapshot?.topContent?.title || '当前热门 Prompt'}》承接，确认入口和内容是否匹配。`);
    }
    if (proxyMetricRows.length > 0) {
        suggestions.push(`- 需要做严格结论时，先看真实交易、验证和增长事件面板，再结合${proxyPanelSummary || '代理参考面板'}做辅助判断。`);
    }

    const priorityActions = anomalyCards.length > 0
        ? anomalyCards
            .slice(0, 2)
            .map((item) => `- ${item.actionLabel || item.title}：${item.summary || '建议优先排查。'}`)
        : (actionRecommendations.length > 0
            ? actionRecommendations
                .slice(0, 2)
                .map((item) => `- ${item.actionLabel || item.title}：${item.summary || '建议优先排查。'}`)
            : ['- Analytics 总览：继续观察经营主线、验证和社区裂变的联动变化。']);

    return [
        '1. 数据亮点',
        ...highlights.slice(0, 3),
        '',
        '2. 潜在风险',
        ...risks.slice(0, 2),
        '',
        '3. 运营建议',
        ...suggestions.slice(0, 3),
        '',
        '4. 建议优先查看的后台入口',
        ...priorityActions
    ].join('\n');
}

function buildLocalPrediction(values, horizon = 7) {
    const series = (Array.isArray(values) ? values : [])
        .map((value) => Math.max(0, Math.round(normalizeAnalyticsNumber(value))))
        .filter((value) => Number.isFinite(value));

    if (!series.length) {
        return Array.from({ length: horizon }, () => 0);
    }

    const recentWindow = series.slice(-7);
    const base = recentWindow[recentWindow.length - 1] * 0.55 + averageAnalyticsValues(recentWindow) * 0.45;
    const earlierWindow = recentWindow.slice(0, Math.max(1, Math.floor(recentWindow.length / 2)));
    const laterWindow = recentWindow.slice(Math.max(1, Math.floor(recentWindow.length / 2)));
    const rawSlope = averageAnalyticsValues(laterWindow) - averageAnalyticsValues(earlierWindow);
    const normalizedSlope = Math.abs(rawSlope) > base ? Math.sign(rawSlope) * Math.max(1, Math.round(base * 0.18)) : rawSlope;

    return Array.from({ length: horizon }, (_, index) => {
        const drift = normalizedSlope * ((index + 1) / Math.max(2, recentWindow.length));
        return Math.max(0, Math.round(base + drift));
    });
}

function renderPredictionMarkup(predictions, note = '') {
    return `
        <div class="prediction-result">
            <p><strong>未来7天预测:</strong></p>
            <div class="prediction-values">
                ${predictions.map((value, index) => `<span class="pred-day">D${index + 1}: ${value}</span>`).join('')}
            </div>
            ${note ? buildQuotaFallbackHint(note) : ''}
        </div>
    `;
}

function formatAIResponse(text) {
    const escaped = escapeHtml(text || '');
    return escaped
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>')
        .replace(/^(\d+)\./gm, '<span class="ai-number">$1.</span>');
}

window.AdminAnalyticsAIHelpers = Object.assign({}, window.AdminAnalyticsAIHelpers || {}, {
    hasAdminAI,
    isGeminiQuotaError,
    buildQuotaFallbackHint,
    getAnalyticsInsightCacheReport,
    getAnalyticsInsightCacheSummary,
    renderAIInsightMarkup,
    buildLocalAnalyticsInsight,
    buildLocalPrediction,
    renderPredictionMarkup,
    formatAIResponse
});
