// Shared analytics metric-context helpers.

async function getAnalyticsPanelMetricContextData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
        ? Number(options.days)
        : getAnalyticsRangeDays();
    const weeks = Number.isFinite(Number(options.weeks)) && Number(options.weeks) > 0
        ? Number(options.weeks)
        : getAnalyticsCohortWeeks(days);

    return runAnalyticsDerivedRequest(
        'panelMetricContext',
        async () => fetchAnalyticsPanelMetricContext(days, weeks),
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getAnalyticsSummaryContextBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
        ? Number(options.days)
        : getAnalyticsRangeDays();
    const weeks = Number.isFinite(Number(options.weeks)) && Number(options.weeks) > 0
        ? Number(options.weeks)
        : getAnalyticsCohortWeeks(days);

    return runAnalyticsDerivedRequest(
        'summaryContextBundle',
        async () => {
            const summaryWindowData = options.summaryWindowData || await getAnalyticsSummaryWindowData({
                contextKey,
                forceRefresh: options.forceRefresh
            });

            if (summaryWindowData) {
                setAnalyticsDerivedStateValue('summaryWindowData', summaryWindowData, contextKey);
            }

            const [siteComparisonData, panelMetricContext] = await Promise.all([
                getAnalyticsSiteComparisonData({
                    contextKey,
                    forceRefresh: options.forceRefresh,
                    summaryWindowData
                }),
                getAnalyticsPanelMetricContextData({
                    contextKey,
                    forceRefresh: options.forceRefresh,
                    days,
                    weeks
                })
            ]);

            return {
                summaryWindowData: summaryWindowData || null,
                siteComparisonData: siteComparisonData || null,
                panelMetricContext: panelMetricContext || {}
            };
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getAnalyticsMetricMeta(source, fallback = {}) {
    const candidates = Array.isArray(source) ? source : [source];
    const candidate = candidates.find((item) => item && typeof item === 'object' && (
        Object.prototype.hasOwnProperty.call(item, 'is_proxy_metric')
        || Object.prototype.hasOwnProperty.call(item, 'isProxyMetric')
        || Object.prototype.hasOwnProperty.call(item, 'metric_basis')
        || Object.prototype.hasOwnProperty.call(item, 'metricBasis')
        || Object.prototype.hasOwnProperty.call(item, 'metric_label')
        || Object.prototype.hasOwnProperty.call(item, 'metricLabel')
    )) || {};

    return {
        isProxyMetric: Boolean(candidate.is_proxy_metric ?? candidate.isProxyMetric ?? fallback.isProxyMetric),
        metricBasis: String(candidate.metric_basis ?? candidate.metricBasis ?? fallback.metricBasis ?? '').trim(),
        metricLabel: String(candidate.metric_label ?? candidate.metricLabel ?? fallback.metricLabel ?? '').trim()
    };
}

function renderAnalyticsMetricHint(source, options = {}) {
    const meta = getAnalyticsMetricMeta(source, options.fallback || {});
    const label = meta.metricLabel || (
        meta.isProxyMetric
            ? (options.proxyLabel || '代理参考口径')
            : (options.realLabel || '真实事件口径')
    );
    const detail = meta.isProxyMetric
        ? String(options.proxyDetail || '').trim()
        : String(options.realDetail || '').trim();
    const className = meta.isProxyMetric
        ? 'analytics-proxy-hint'
        : 'analytics-proxy-hint analytics-proxy-hint--real';

    if (!label && !detail) {
        return '';
    }

    const parts = [];
    if (label) {
        parts.push(`<strong>${escapeHtml(label)}</strong>`);
    }
    if (detail) {
        parts.push(escapeHtml(detail));
    }

    return `<p class="${className}">${parts.join(' · ')}</p>`;
}

function getAnalyticsMetricTypeLabel(isProxyMetric = false) {
    return isProxyMetric ? '代理参考' : '真实事件';
}

function buildAnalyticsMetricContextRow(panel, label, type, basis, note) {
    return {
        '板块': panel || '未分类',
        '指标口径': label || '-',
        '类型': type || '混合口径',
        '依据': basis || '-',
        '说明': note || ''
    };
}

async function fetchAnalyticsPanelMetricContext(days = getAnalyticsRangeDays(30), weeks = getAnalyticsCohortWeeks(days)) {
    let visualBundle = null;

    try {
        visualBundle = await getAnalyticsVisualPanelBundle({
            days,
            weeks
        });
    } catch (_error) {
        visualBundle = null;
    }

    const activityHeatmapSegment = getAnalyticsVisualPanelBundleSegment(visualBundle, 'activityHeatmap');
    const retentionCohortSegment = getAnalyticsVisualPanelBundleSegment(visualBundle, 'retentionCohort');
    const conversionFunnelSegment = getAnalyticsVisualPanelBundleSegment(visualBundle, 'conversionFunnel');

    const activityHeatmapRows = activityHeatmapSegment?.ok && Array.isArray(activityHeatmapSegment.payload)
        ? activityHeatmapSegment.payload
        : await fetchActivityHeatmapData(days).catch(() => []);
    const retentionCohortRows = retentionCohortSegment?.ok && Array.isArray(retentionCohortSegment.payload)
        ? retentionCohortSegment.payload
        : await fetchRetentionCohortData(weeks, days).catch(() => []);
    const conversionRows = conversionFunnelSegment?.ok && Array.isArray(conversionFunnelSegment.payload)
        ? conversionFunnelSegment.payload
        : await fetchConversionFunnelData(days).then((result) => (
            Array.isArray(result?.rows) ? result.rows : []
        )).catch(() => []);

    const activityHeatmapMeta = getAnalyticsMetricMeta(activityHeatmapRows, {
        isProxyMetric: false,
        metricBasis: 'effective_business_event_heatmap',
        metricLabel: '真实业务事件热度'
    });
    const retentionCohortMeta = getAnalyticsMetricMeta(retentionCohortRows, {
        isProxyMetric: false,
        metricBasis: 'site_attributed_cohort_effective_business_activity',
        metricLabel: '首站点归因 cohort + 真实业务回访'
    });
    const conversionFunnelMeta = getAnalyticsMetricMeta(conversionRows, {
        isProxyMetric: false,
        metricBasis: 'user_events',
        metricLabel: '真实业务事件漏斗'
    });

    return {
        activityHeatmap: {
            ...activityHeatmapMeta,
            detail: activityHeatmapMeta.isProxyMetric
                ? '当前数据库仍在返回旧登录热力图，请执行最新 heatmap migration 后切到真实业务事件热度。'
                : '当前热力图按真实业务事件绘制，适合观察浏览、解锁、验证、充值等行为高峰。'
        },
        conversionFunnel: {
            ...conversionFunnelMeta,
            detail: '当前漏斗按 Prompt 浏览、解锁点击、内容解锁三段真实事件计算。'
        },
        retentionCohort: {
            ...retentionCohortMeta,
            detail: retentionCohortMeta.isProxyMetric
                ? '当前数据库仍在返回旧登录留存，请执行最新 retention migration 后切到真实业务回访留存。'
                : '当前留存按首站点归因 cohort + 真实业务事件回访计算，更接近真实复访质量。'
        }
    };
}

function buildAnalyticsMetricContextRows({ overview = {}, panelMetricContext = {} } = {}) {
    const rows = [];
    const activeUserLabels = getAnalyticsActiveUserLabels();
    const newUsersLabels = getAnalyticsNewUsersLabels();
    const activeUsersBasis = String(overview?.active_users_model || 'effective_business_event').trim();
    const newUsersScope = String(overview?.new_users_scope || 'global_registration').trim();
    const siteAttributionModel = String(overview?.site_attribution_model || '').trim();
    const activityHeatmap = panelMetricContext?.activityHeatmap || {};
    const conversionFunnel = panelMetricContext?.conversionFunnel || {};
    const retentionCohort = panelMetricContext?.retentionCohort || {};

    rows.push(buildAnalyticsMetricContextRow(
        '数据概览',
        `${activeUserLabels.dauLabel} / ${activeUserLabels.mauLabel}`,
        '真实事件',
        activeUsersBasis,
        '默认展示业务活跃，登录活跃仅作参考。'
    ));
    rows.push(buildAnalyticsMetricContextRow(
        '用户增长',
        `${newUsersLabels.todayLabel} / ${newUsersLabels.weekLabel}`,
        '真实事件',
        [newUsersScope, siteAttributionModel].filter(Boolean).join(' + ') || newUsersScope,
        newUsersScope === 'site_first_touch'
            ? '分站视角按首站点归因统计新增。'
            : '全站视角按全局注册统计新增。'
    ));
    rows.push(buildAnalyticsMetricContextRow(
        '活跃时段热力图',
        activityHeatmap.metricLabel || '真实业务事件热度',
        getAnalyticsMetricTypeLabel(activityHeatmap.isProxyMetric === true),
        activityHeatmap.metricBasis || 'effective_business_event_heatmap',
        activityHeatmap.detail || '优先按真实业务事件绘制热度，用于观察浏览、解锁、验证、充值等行为高峰。'
    ));
    rows.push(buildAnalyticsMetricContextRow(
        '转化漏斗',
        conversionFunnel.metricLabel || '真实业务事件漏斗',
        getAnalyticsMetricTypeLabel(Boolean(conversionFunnel.isProxyMetric)),
        conversionFunnel.metricBasis || 'user_events',
        conversionFunnel.detail || '当前漏斗按 Prompt 浏览、解锁点击、内容解锁三段真实事件计算。'
    ));
    rows.push(buildAnalyticsMetricContextRow(
        '用户留存',
        retentionCohort.metricLabel || '首站点归因 cohort + 真实业务回访',
        getAnalyticsMetricTypeLabel(retentionCohort.isProxyMetric === true),
        retentionCohort.metricBasis || 'site_attributed_cohort_effective_business_activity',
        retentionCohort.detail || '优先按首站点归因 cohort + 真实业务事件回访统计留存。'
    ));
    rows.push(buildAnalyticsMetricContextRow(
        '交易事件转化',
        '真实交易事件',
        '真实事件',
        'commerce_event_funnel',
        '基于钱包打开、充值点击、充值成功、商城浏览、商城成交等真实事件。'
    ));
    rows.push(buildAnalyticsMetricContextRow(
        '验证事件转化',
        '真实验证事件',
        '真实事件',
        'verify_event_funnel',
        '基于验证提交、验证成功、验证失败等真实事件。'
    ));
    rows.push(buildAnalyticsMetricContextRow(
        '增长动作',
        '真实增长事件',
        '真实事件',
        'growth_event_funnel',
        '基于留言、推广点击、签到成功等真实增长动作事件。'
    ));

    return rows;
}

function getAnalyticsMetricContextRowsFromData(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const existingRows = sourceData?.metricContextRows || sourceData?.metric_context_rows || null;
    if (Array.isArray(existingRows) && existingRows.length > 0) {
        return existingRows;
    }

    return buildAnalyticsMetricContextRows({
        overview: sourceData?.overview || {},
        panelMetricContext: sourceData?.panel_metric_context || sourceData?.panelMetricContext || {}
    });
}

function getAnalyticsProxyMetricContextRows(data = null) {
    return getAnalyticsMetricContextRowsFromData(data).filter((row) => String(row?.['类型'] || '').trim() === '代理参考');
}

function getAnalyticsMetricContextDestination(metricRow = {}) {
    const panelName = String(metricRow?.['板块'] || '').trim();
    if (panelName === '用户留存') {
        return {
            destination: 'analytics-growth',
            context: { sectionId: 'retentionCohort' }
        };
    }
    if (panelName === '转化漏斗') {
        return {
            destination: 'analytics-content',
            context: { sectionId: 'conversionFunnel' }
        };
    }
    if (panelName === '活跃时段热力图') {
        return {
            destination: 'analytics-content',
            context: { sectionId: 'activityHeatmap' }
        };
    }

    return {
        destination: 'analytics-overview',
        context: null
    };
}

function buildAnalyticsMetricContextObserveItem(data = null) {
    const proxyRows = getAnalyticsProxyMetricContextRows(data);
    if (!proxyRows.length) {
        return null;
    }

    const primaryRow = proxyRows[0] || {};
    const destinationMeta = getAnalyticsMetricContextDestination(primaryRow);
    const panelSummary = proxyRows.map((row) => String(row?.['板块'] || '').trim()).filter(Boolean).join('、');

    return {
        panel: '指标口径',
        tone: 'neutral',
        level: '观察',
        title: '代理参考面板需要结合真实事件复核',
        summary: `${panelSummary || '部分面板'} 当前只适合做趋势观察和排查线索，不能直接当成严格业务因果结论。`,
        actionLabel: '回看代理面板',
        destination: destinationMeta.destination,
        icon: 'fas fa-ruler-combined',
        context: destinationMeta.context,
        sampleLabel: '代理口径',
        sampleItems: proxyRows.slice(0, 3).map((row) => `${row['板块']} · ${row['指标口径']}`)
    };
}

function renderAnalyticsMetricContextNotice(data = null) {
    const proxyRows = getAnalyticsProxyMetricContextRows(data);
    if (!proxyRows.length) {
        return '';
    }

    return `
        <section class="admin-workbench-context-note admin-workbench-context-note--compact">
            <div class="admin-workbench-context-note__eyebrow">Metric Context</div>
            <div class="admin-workbench-context-note__title">当前窗口存在代理参考指标</div>
            <div class="admin-workbench-context-note__summary">以下面板只适合做趋势观察或排查线索，不能直接写成严格业务因果结论；需要下判断时请优先结合真实交易、验证和增长事件面板。</div>
            <div class="admin-workbench-context-note__chips">
                ${proxyRows.map((row) => `
                    <span class="admin-workbench-context-note__chip">${escapeHtml(row['板块'] || '未分类')} · ${escapeHtml(row['指标口径'] || '代理参考口径')}</span>
                `).join('')}
            </div>
        </section>
    `;
}
