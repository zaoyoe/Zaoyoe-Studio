// Shared analytics AI orchestration and export shell.

function getAnalyticsSummaryPayloadSegmentSummary(bundle = null, key = '') {
    const segment = typeof getAnalyticsSummaryPayloadBundleSegment === 'function'
        ? getAnalyticsSummaryPayloadBundleSegment(bundle, key)
        : null;
    return segment?.ok && segment.summary
        ? segment.summary
        : null;
}

function enrichAnalyticsSummaryPayloadSegment(key = '', summary = null, summaryWindowData = null) {
    if (!summary || typeof summary !== 'object') {
        return null;
    }

    switch (String(key || '').trim()) {
        case 'overviewBusinessMix':
            return enrichOverviewBusinessMixSummaryWithEvents(summary, summaryWindowData || {});
        case 'verifyServiceSummary':
            return enrichVerifyServiceSummaryWithEvents(summary, summaryWindowData || {});
        case 'growthSummary':
            return enrichGrowthSummaryWithEvents(summary, summaryWindowData || {});
        default:
            return summary;
    }
}

async function getAnalyticsAIExportSupportBundle(options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const days = Math.max(7, Number(options.days) || getAnalyticsRangeDays(30));
    const summaryWindowOverride = options.summaryWindowData || null;

    const [payloadBundleResult, operationsHealthResult, summaryContextBundleResult] = await Promise.allSettled([
        getAnalyticsSummaryPayloadBundle({
            forceRefresh
        }),
        getOperationsHealthSnapshotData({
            forceRefresh
        }),
        getAnalyticsSummaryContextBundle({
            forceRefresh,
            summaryWindowData: summaryWindowOverride,
            days,
            weeks: getAnalyticsCohortWeeks(days)
        })
    ]);

    const payloadBundle = payloadBundleResult.status === 'fulfilled'
        ? payloadBundleResult.value
        : null;
    const summaryContextBundle = summaryContextBundleResult.status === 'fulfilled' && summaryContextBundleResult.value
        ? summaryContextBundleResult.value
        : {};
    const summaryWindowData = summaryWindowOverride || summaryContextBundle.summaryWindowData || null;

    let overviewBusinessMix = enrichAnalyticsSummaryPayloadSegment(
        'overviewBusinessMix',
        getAnalyticsSummaryPayloadSegmentSummary(payloadBundle, 'overviewBusinessMix'),
        summaryWindowData
    );
    let verifyServiceSummary = enrichAnalyticsSummaryPayloadSegment(
        'verifyServiceSummary',
        getAnalyticsSummaryPayloadSegmentSummary(payloadBundle, 'verifyServiceSummary'),
        summaryWindowData
    );
    let growthSummary = enrichAnalyticsSummaryPayloadSegment(
        'growthSummary',
        getAnalyticsSummaryPayloadSegmentSummary(payloadBundle, 'growthSummary'),
        summaryWindowData
    );
    let operationsHealthSnapshot = operationsHealthResult.status === 'fulfilled'
        ? operationsHealthResult.value
        : null;

    const fallbackTasks = [];

    if (!overviewBusinessMix) {
        fallbackTasks.push(
            getOverviewBusinessMixSummaryData({ forceRefresh }).then((value) => {
                overviewBusinessMix = value;
            }).catch(() => null)
        );
    }

    if (!verifyServiceSummary) {
        fallbackTasks.push(
            getVerifyServiceSummaryData({ forceRefresh }).then((value) => {
                verifyServiceSummary = value;
            }).catch(() => null)
        );
    }

    if (!growthSummary) {
        fallbackTasks.push(
            getGrowthSummaryData({ forceRefresh }).then((value) => {
                growthSummary = value;
            }).catch(() => null)
        );
    }

    if (!operationsHealthSnapshot) {
        fallbackTasks.push(
            getOperationsHealthSnapshotData({ forceRefresh }).then((value) => {
                operationsHealthSnapshot = value;
            }).catch(() => null)
        );
    }

    if (fallbackTasks.length > 0) {
        await Promise.all(fallbackTasks);
    }

    return {
        payloadBundle,
        summaryContextBundle,
        summaryWindowData,
        panelMetricContext: summaryContextBundle.panelMetricContext || {},
        siteComparisonData: summaryContextBundle.siteComparisonData || null,
        overviewBusinessMix,
        verifyServiceSummary,
        growthSummary,
        operationsHealthSnapshot
    };
}

async function generateAIInsight() {
    const { button: btn, content } = getAnalyticsAIInsightElements();
    let aiSummaryData = null;
    const { days, startDate, endDate } = getAnalyticsRangeState();
    const rangeLabel = buildAnalyticsRangeLabel({ days, startDate, endDate });
    const currentCacheKey = getAnalyticsAIContextKey();

    if (!btn || !content) return;

    if (isAnalyticsInsightDebouncing()) {
        renderAnalyticsInsightDebounceMessage(content);
        return;
    }

    const now = Date.now();
    syncAnalyticsInsightCacheContext(currentCacheKey);

    if (renderAnalyticsCachedInsight(content, currentCacheKey, now)) {
        return;
    }

    if (!await ensureAnalyticsAIReady({ content })) {
        return;
    }

    if (!beginAnalyticsInsightDebounce()) {
        renderAnalyticsInsightDebounceMessage(content);
        return;
    }

    setAnalyticsInsightLoadingState(btn, content, true);

    try {
        let data = null;
        const summaryRangeParams = buildAnalyticsRangeRpcParams({}, { days });
        try {
            data = await callAnalyticsRpcWithFallback('get_ai_summary_data_v2', [
                summaryRangeParams,
                buildAnalyticsLegacyRpcParams(summaryRangeParams),
                buildAnalyticsLegacyRpcParams(summaryRangeParams, { excludeSite: true }),
                {}
            ]);
        } catch (_error) {
            data = await callAnalyticsRpcWithFallback('get_ai_summary_data', [
                summaryRangeParams,
                buildAnalyticsLegacyRpcParams(summaryRangeParams),
                buildAnalyticsLegacyRpcParams(summaryRangeParams, { excludeSite: true }),
                {}
            ]);
        }
        if (!data || !data.overview) throw new Error('数据获取失败');

        const supportBundle = await getAnalyticsAIExportSupportBundle({
            forceRefresh: true,
            days,
            summaryWindowData: data
        });
        const summaryContextBundle = supportBundle.summaryContextBundle || {};

        aiSummaryData = buildAnalyticsAISummaryData(data, supportBundle);

        console.log('[Analytics] AI Summary Data:', aiSummaryData);
        const prompt = buildAnalyticsInsightPrompt(aiSummaryData, { rangeLabel });

        const text = await window.AdminAI.generateText(prompt, {
            model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024
            }
        });

        const cachedInsight = writeAnalyticsInsightCache(text || '分析失败，请重试', aiSummaryData, currentCacheKey);
        renderAnalyticsInsightResult(content, cachedInsight.report, {
            summaryData: aiSummaryData
        });
    } catch (err) {
        console.error('[Analytics] AI insight error:', err);
        if (isGeminiQuotaError(err)) {
            const cachedInsight = writeAnalyticsInsightCache(buildLocalAnalyticsInsight(aiSummaryData || {}), aiSummaryData || null, currentCacheKey);
            renderAnalyticsInsightResult(content, cachedInsight.report, {
                summaryData: cachedInsight.summaryData,
                hintHtml: buildQuotaFallbackHint('已切换为本地规则洞察')
            });
        } else {
            renderAnalyticsInsightError(content, err);
        }
    } finally {
        setAnalyticsInsightLoadingState(btn, content, false);
    }
}

async function loadAIPrediction() {
    const container = getAnalyticsAIPredictionContainer();
    if (!container) return;
    let trendSeries = [];
    const days = Math.max(7, getAnalyticsRangeDays(30));

    if (!await ensureAnalyticsAIReady({ content: container })) {
        return;
    }

    setAnalyticsPredictionLoadingState(container, true);

    try {
        const data = await fetchUserTrendData(days);
        trendSeries = Array.isArray(data) ? data.map((item) => item?.new_users) : [];

        const prompt = buildAnalyticsPredictionPrompt(trendSeries, days);

        const text = await window.AdminAI.generateText(prompt, {
            model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 256
            }
        });

        const match = (text || '[]').match(/\[[\d,\s]+\]/);
        if (match) {
            const predictions = JSON.parse(match[0]);
            container.innerHTML = renderPredictionMarkup(predictions);
        } else {
            container.innerHTML = '<p class="ai-error">预测解析失败</p>';
        }
    } catch (err) {
        console.error('[Analytics] AI prediction error:', err);
        if (isGeminiQuotaError(err)) {
            const fallbackPredictions = buildLocalPrediction(trendSeries, 7);
            container.innerHTML = renderPredictionMarkup(fallbackPredictions, '已切换为本地趋势估算');
        } else {
            renderAnalyticsPredictionError(container, err);
        }
    }
}

async function exportAnalyticsData(format) {
    console.log(`[Analytics] Exporting data as ${format}`);

    try {
        const { days, startDate, endDate } = getAnalyticsRangeState();
        const dateRangeLabel = buildAnalyticsRangeLabel({ days, startDate, endDate });
        const sp = getAnalyticsSiteParam();
        const [
            overviewData,
            userTrendData,
            contentTrendData,
            revenueTrendData,
            channelData,
            communityData,
            topContentData,
            pointsDist,
            pointsLead,
            funnelData,
            supportBundle
        ] = await Promise.all([
            callAnalyticsRpcWithFallback('get_overview_stats', [
                { p_site: sp },
                {}
            ]),
            fetchUserTrendData(days),
            fetchContentTrendData(days),
            fetchRevenueTrendData(days),
            fetchChannelBreakdownData(days),
            fetchCommunityStatsData(days),
            fetchTopContentData(100, days),
            fetchPointsDistributionData(),
            fetchPointsLeaderboardData(100),
            fetchRedemptionFunnelData(days),
            getAnalyticsAIExportSupportBundle({
                forceRefresh: true,
                days
            })
        ]);
        const overviewBusinessMix = supportBundle.overviewBusinessMix || null;
        const verifyServiceSummary = supportBundle.verifyServiceSummary || null;
        const growthSummary = supportBundle.growthSummary || null;
        const operationsHealthSnapshot = supportBundle.operationsHealthSnapshot || null;
        const summaryContextBundle = supportBundle.summaryContextBundle || {};
        const summaryWindowData = supportBundle.summaryWindowData || null;
        const panelMetricContext = supportBundle.panelMetricContext || {};
        const commerceEventFunnel = buildCommerceEventFunnelViewData(summaryWindowData);
        const verifyEventFunnel = buildVerifyEventFunnelViewData(summaryWindowData);
        const growthEventFunnel = buildGrowthEventFunnelViewData(summaryWindowData);
        const metricContextRows = buildAnalyticsMetricContextRows({
            overview: overviewData,
            panelMetricContext
        });

        const summaryBundle = {
            overview: overviewData,
            overviewBusinessMix,
            verifyServiceSummary,
            growthSummary,
            operationsHealthSnapshot,
            summaryWindowData,
            siteComparisonData: summaryContextBundle.siteComparisonData || null,
            panelMetricContext,
            metricContextRows
        };
        const businessAnomalyCards = buildAnalyticsBusinessAnomalyCardsData(summaryBundle, 6);

        const actionRecommendations = [
            ...buildAnalyticsRecommendationExportRows('总览', overviewBusinessMix?.recommendations || []),
            ...buildAnalyticsRecommendationExportRows('验证服务', verifyServiceSummary?.recommendations || []),
            ...buildAnalyticsRecommendationExportRows('社区与裂变', growthSummary?.recommendations || [])
        ];
        const businessAnomalies = buildAnalyticsBusinessAnomalyExportRows(businessAnomalyCards);

        const exportData = {
            overview: overviewData,
            overviewBusinessMix,
            verifyServiceSummary,
            growthSummary,
            operationsHealthSnapshot,
            userTrend: userTrendData || [],
            contentTrend: contentTrendData || [],
            revenueTrend: revenueTrendData || [],
            channelBreakdown: channelData || [],
            communityStats: communityData || [],
            topContent: topContentData || [],
            pointsDistribution: pointsDist || [],
            pointsLeaderboard: pointsLead || [],
            redemptionFunnel: funnelData || [],
            commerceEventFunnel,
            verifyEventFunnel,
            growthEventFunnel,
            metricContextRows,
            businessAnomalies,
            actionRecommendations,
            exportDate: new Date().toISOString(),
            dateRange: days,
            dateRangeLabel,
            startDate,
            endDate
        };

        if (format === 'csv') {
            if (typeof window.exportAsCSV !== 'function') {
                throw new Error('CSV 导出组件未加载');
            }
            window.exportAsCSV(exportData);
        } else if (format === 'excel') {
            if (typeof window.exportAsExcel !== 'function') {
                throw new Error('Excel 导出组件未加载');
            }
            window.exportAsExcel(exportData);
        }

        if (typeof showToast === 'function') {
            showToast(`${format.toUpperCase()} 导出成功！`, 'success');
        }
    } catch (err) {
        console.error('[Analytics] Export error:', err);
        alert('导出失败: ' + err.message);
    }
}

window.loadAIPrediction = loadAIPrediction;
window.exportAnalyticsData = exportAnalyticsData;
