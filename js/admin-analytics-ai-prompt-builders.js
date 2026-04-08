// Shared analytics AI prompt and summary-data builders.

function buildAnalyticsAISummaryData(data = null, supportBundle = {}) {
    return {
        ...(data && typeof data === 'object' ? data : {}),
        overview_business_mix: supportBundle.overviewBusinessMix || null,
        verify_service_summary: supportBundle.verifyServiceSummary || null,
        growth_summary: supportBundle.growthSummary || null,
        operations_health_snapshot: supportBundle.operationsHealthSnapshot || null,
        site_comparison: supportBundle.siteComparisonData || null,
        panel_metric_context: supportBundle.panelMetricContext || {}
    };
}

function buildAnalyticsAIPromptContext(aiSummaryData = null) {
    const summaryData = aiSummaryData && typeof aiSummaryData === 'object'
        ? aiSummaryData
        : {};
    const overview = summaryData.overview || {};
    const dau = overview.dau ?? 0;
    const mau = overview.mau ?? 0;
    const activeUserLabels = getAnalyticsActiveUserLabels();
    const newUsers = overview.new_users_week ?? 0;
    const newUsersLabel = getAnalyticsNewUsersLabels().weekLabel;
    const totalPoints = overview.total_points ?? 0;
    const totalComments = overview.total_comments ?? 0;
    const eventOverview = summaryData.event_overview || {};
    const eventFunnels = summaryData.event_funnels || {};
    const commerceEventFunnel = buildCommerceEventFunnelViewData(summaryData);
    const verifyEventFunnel = buildVerifyEventFunnelViewData(summaryData);
    const growthEventFunnel = buildGrowthEventFunnelViewData(summaryData);
    const overviewBusinessMix = summaryData.overview_business_mix?.metrics || {};
    const verifyService = summaryData.verify_service_summary?.metrics || {};
    const growthSummary = summaryData.growth_summary?.metrics || {};
    const operationsHealth = summaryData.operations_health_snapshot?.metrics || {};
    const siteComparison = summaryData.site_comparison || {};
    const panelMetricContext = summaryData.panel_metric_context || {};
    const metricContextRows = buildAnalyticsMetricContextRows({
        overview,
        panelMetricContext
    });
    const actionRecommendations = collectAnalyticsActionRecommendations(summaryData).slice(0, 6);
    const businessAnomalyCards = buildAnalyticsBusinessAnomalyCardsData(summaryData, 4);

    return {
        overview,
        dau,
        mau,
        activeUserLabels,
        newUsers,
        newUsersLabel,
        totalPoints,
        totalComments,
        eventOverview,
        eventFunnels,
        commerceEventFunnel,
        verifyEventFunnel,
        growthEventFunnel,
        overviewBusinessMix,
        verifyService,
        growthSummary,
        operationsHealth,
        siteComparison,
        panelMetricContext,
        metricContextRows,
        actionRecommendations,
        businessAnomalyCards
    };
}

function buildAnalyticsInsightPrompt(aiSummaryData = null, options = {}) {
    const rangeLabel = String(options.rangeLabel || '').trim() || '最近 30 天';
    const promptContext = buildAnalyticsAIPromptContext(aiSummaryData);

    return `你是一位专业的数据分析师。请基于以下平台数据，生成一份简洁的运营洞察报告（使用中文）：

分析范围：${rangeLabel}

数据概览：
- ${promptContext.activeUserLabels.promptDauLabel}: ${promptContext.dau}
- ${promptContext.activeUserLabels.promptMauLabel}: ${promptContext.mau}
- ${promptContext.newUsersLabel}: ${promptContext.newUsers}
- 积分流通总量: ${promptContext.totalPoints}
- 总评论数: ${promptContext.totalComments}

用户趋势（当前窗口）：
${JSON.stringify(aiSummaryData?.user_trend || [], null, 2)}

渠道表现：
${JSON.stringify(aiSummaryData?.channel_breakdown || [], null, 2)}

真实行为摘要：
${JSON.stringify(promptContext.eventOverview, null, 2)}

真实行为漏斗：
${JSON.stringify(promptContext.eventFunnels, null, 2)}

交易事件转化：
${JSON.stringify(promptContext.commerceEventFunnel.exportRows || [], null, 2)}

验证事件转化：
${JSON.stringify(promptContext.verifyEventFunnel.exportRows || [], null, 2)}

增长动作：
${JSON.stringify(promptContext.growthEventFunnel.exportRows || [], null, 2)}

指标口径说明（请严格区分真实事件和代理参考；凡标记为“代理参考”的内容，只能用于趋势/时段判断，不能写成严格业务因果结论）：
${JSON.stringify(promptContext.metricContextRows, null, 2)}

站点对比：
${JSON.stringify(promptContext.siteComparison, null, 2)}

经营主线摘要：
${JSON.stringify(promptContext.overviewBusinessMix, null, 2)}

验证服务摘要：
${JSON.stringify(promptContext.verifyService, null, 2)}

验证关注任务：
${JSON.stringify(aiSummaryData?.verify_service_summary?.focusRows || aiSummaryData?.verify_service_summary?.recentRows || [], null, 2)}

社区与裂变摘要：
${JSON.stringify(promptContext.growthSummary, null, 2)}

运营健康快照：
${JSON.stringify(promptContext.operationsHealth, null, 2)}

经营异常卡片：
${JSON.stringify(promptContext.businessAnomalyCards, null, 2)}

建议动作候选：
${JSON.stringify(promptContext.actionRecommendations, null, 2)}

请输出：
1. 数据亮点（2-3条）
2. 潜在风险（1-2条）
3. 运营建议（2-3条）
4. 建议优先查看的后台入口（1-2条，格式“入口：原因”）

请用简洁的要点形式，每条不超过一行。`;
}

function buildAnalyticsPredictionPrompt(trendSeries = [], days = 30) {
    return `基于以下 ${days} 天的用户数据趋势，预测未来7天的走势（每天一个数字）。
只返回JSON数组格式，例如: [15, 18, 20, 22, 19, 21, 25]

数据：${JSON.stringify(Array.isArray(trendSeries) ? trendSeries : [])}`;
}

window.AdminAnalyticsAIPromptBuilders = Object.assign({}, window.AdminAnalyticsAIPromptBuilders || {}, {
    buildAnalyticsAISummaryData,
    buildAnalyticsAIPromptContext,
    buildAnalyticsInsightPrompt,
    buildAnalyticsPredictionPrompt
});
