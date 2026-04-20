// Shared analytics insight card, pulse, and recommendation helpers.

function collectAnalyticsActionRecommendations(data = null) {
    const baseRecommendations = [
        { panel: '总览', items: data?.overview_business_mix?.recommendations || data?.overviewBusinessMix?.recommendations || [] },
        { panel: '验证服务', items: data?.verify_service_summary?.recommendations || data?.verifyServiceSummary?.recommendations || [] },
        { panel: '社区与裂变', items: data?.growth_summary?.recommendations || data?.growthSummary?.recommendations || [] }
    ].flatMap((group) => (
        (Array.isArray(group.items) ? group.items : []).map((item) => ({
            panel: group.panel,
            tone: item.tone || 'neutral',
            level: item.level || '观察',
            title: item.title || '待处理项',
            summary: item.summary || '',
            actionLabel: item.actionLabel || '',
            destination: item.destination || '',
            icon: item.icon || '',
            context: item.context || item.destinationContext || null,
            sampleLabel: item.sampleLabel || '',
            sampleItems: Array.isArray(item.sampleItems) ? item.sampleItems : []
        }))
    ));

    const metricContextRecommendation = buildAnalyticsMetricContextObserveItem(data);
    const userValueOverviewInsight = buildAnalyticsUserValueOverviewInsight(data);
    const contentUserValueOverviewInsight = buildAnalyticsContentUserValueOverviewInsight(data);

    return [
        ...baseRecommendations,
        ...buildAnalyticsEventDrivenRecommendations(data),
        ...(contentUserValueOverviewInsight?.actionRecommendation ? [contentUserValueOverviewInsight.actionRecommendation] : []),
        ...(userValueOverviewInsight?.actionRecommendation ? [userValueOverviewInsight.actionRecommendation] : []),
        ...(metricContextRecommendation ? [metricContextRecommendation] : [])
    ];
}

function getAnalyticsActionGroupMeta(level = '') {
    const priority = getAnalyticsActionPriority(level);

    if (priority <= 1) {
        return {
            key: 'urgent',
            title: '优先处理',
            description: '优先处理会影响验证、付费或主链路转化的问题'
        };
    }

    if (priority <= 3) {
        return {
            key: 'followup',
            title: '建议跟进',
            description: '建议本轮顺手复核承接、评论和消费转化'
        };
    }

    return {
        key: 'observe',
        title: '持续观察',
        description: '作为经营驾驶舱观察项持续看趋势即可'
    };
}

function buildAnalyticsEventDrivenRecommendations(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const summarySource = sourceData?.summaryWindowData || sourceData || {};
    const siteComparisonData = sourceData?.site_comparison || sourceData?.siteComparisonData || null;
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const commerce = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const growth = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const recommendations = [];

    const walletOpenUsers = normalizeAnalyticsCountValue(commerce.wallet_open_users ?? eventOverview.wallet_open_users);
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerce.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerce.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerce.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewUsers = normalizeAnalyticsCountValue(commerce.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerce.shop_purchase_users ?? eventOverview.shop_purchase_users);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerce.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);
    const businessActiveUsers = normalizeAnalyticsCountValue(eventOverview.business_active_users);
    const guestbookPostUsers = normalizeAnalyticsCountValue(growth.guestbook_post_users ?? eventOverview.guestbook_post_users);
    const inviteClickUsers = normalizeAnalyticsCountValue(growth.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growth.checkin_success_users ?? eventOverview.checkin_success_users);
    const inviteCoverageRate = getAnalyticsPercentRate(inviteClickUsers, businessActiveUsers);
    const checkinCoverageRate = getAnalyticsPercentRate(checkinSuccessUsers, businessActiveUsers);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);
    const commerceView = buildCommerceEventFunnelViewData(summarySource);
    const growthView = buildGrowthEventFunnelViewData(summarySource);

    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        recommendations.push({
            panel: '积分与交易',
            tone: rechargeSuccessRate < 40 ? 'danger' : 'warning',
            level: rechargeSuccessRate < 40 ? '优先处理' : '建议复核',
            title: '真实事件显示充值成功率偏低',
            summary: `当前窗口钱包打开 ${formatNumber(walletOpenUsers)} 人、充值点击 ${formatNumber(rechargeClickUsers)} 人，但最终只有 ${formatNumber(rechargeSuccessUsers)} 人完成充值，建议优先检查支付链路。`,
            actionLabel: '去支付排查',
            destination: 'payments-queue',
            icon: 'fas fa-credit-card',
            context: {
                focusQueue: true,
                sectionId: 'paymentsOpsAlertQueuePanel'
            },
            sampleLabel: '交易转化线索',
            sampleItems: buildAnalyticsEventSampleItems(commerceView)
        });
    }

    if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        recommendations.push({
            panel: '积分与交易',
            tone: shopPurchaseRate < 10 ? 'warning' : 'accent',
            level: shopPurchaseRate < 10 ? '建议跟进' : '持续观察',
            title: '商城浏览已形成但成交承接偏弱',
            summary: `当前窗口商城浏览 ${formatNumber(shopViewUsers)} 人，但成交只有 ${formatNumber(shopPurchaseUsers)} 人，建议回到积分与交易排查套餐、权益和价格承接。`,
            actionLabel: '看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-wallet',
            context: {
                sectionId: 'commerceEventFunnel'
            },
            sampleLabel: '交易转化线索',
            sampleItems: buildAnalyticsEventSampleItems(commerceView)
        });
    }

    if (businessActiveUsers >= 10 && referralRewardPoints > 0 && inviteClickUsers === 0) {
        recommendations.push({
            panel: '社区与裂变',
            tone: 'warning',
            level: '建议复核',
            title: '返佣奖励已投放但邀请点击仍未起量',
            summary: `当前窗口返佣/拉新奖励 ${formatNumber(referralRewardPoints)} 积分，但还没有看到真实邀请点击，建议先复核推广入口和文案。`,
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: 'commission_rate_shop'
            },
            sampleLabel: '增长动作线索',
            sampleItems: buildAnalyticsEventSampleItems(growthView)
        });
    }

    if (guestbookPostUsers >= 3 && inviteCoverageRate < 3 && checkinCoverageRate < 8 && checkinRewardPoints > 0) {
        recommendations.push({
            panel: '社区与裂变',
            tone: 'accent',
            level: '持续观察',
            title: '社区反馈有量，但裂变与签到承接偏弱',
            summary: `当前窗口留言发布 ${formatNumber(guestbookPostUsers)} 人、签到成功 ${formatNumber(checkinSuccessUsers)} 人、邀请点击 ${formatNumber(inviteClickUsers)} 人，建议回看增长动作是否形成连续承接。`,
            actionLabel: '查看社区与裂变',
            destination: 'analytics-growth',
            icon: 'fas fa-bullhorn',
            context: {
                sectionId: 'growthEventFunnel'
            },
            sampleLabel: '增长动作线索',
            sampleItems: buildAnalyticsEventSampleItems(growthView)
        });
    }

    if (siteComparisonData?.mode === 'compare') {
        const cnSnapshot = siteComparisonData.snapshots?.find((item) => item.site === 'cn') || null;
        const intlSnapshot = siteComparisonData.snapshots?.find((item) => item.site === 'intl') || null;
        if (cnSnapshot && intlSnapshot) {
            const verifyGap = roundTo((cnSnapshot.metrics.verifySuccessRate || 0) - (intlSnapshot.metrics.verifySuccessRate || 0), 1) || 0;
            const rechargeGap = roundTo((cnSnapshot.metrics.rechargeSuccessRate || 0) - (intlSnapshot.metrics.rechargeSuccessRate || 0), 1) || 0;
            const weakerVerifySite = verifyGap === 0 ? '' : (verifyGap > 0 ? 'intl' : 'cn');
            const weakerRechargeSite = rechargeGap === 0 ? '' : (rechargeGap > 0 ? 'intl' : 'cn');

            if (Math.abs(verifyGap) >= 12 && weakerVerifySite) {
                recommendations.push({
                    panel: '站点差异',
                    tone: Math.abs(verifyGap) >= 20 ? 'warning' : 'accent',
                    level: Math.abs(verifyGap) >= 20 ? '建议复核' : '持续观察',
                    title: `${getAnalyticsSiteLabel(weakerVerifySite)} 验证成功率明显落后`,
                    summary: `当前窗口 CN 验证成功率 ${formatPercent(cnSnapshot.metrics.verifySuccessRate)}，INTL 为 ${formatPercent(intlSnapshot.metrics.verifySuccessRate)}，建议优先复核更弱站点的验证链路。`,
                    actionLabel: '看验证服务',
                    destination: 'analytics-verify',
                    icon: 'fas fa-globe',
                    context: {
                        site: weakerVerifySite,
                        sectionId: 'verifyEventFunnel'
                    },
                    sampleLabel: '站点差异',
                    sampleItems: siteComparisonData.insights?.slice(0, 2) || []
                });
            }

            if (Math.abs(rechargeGap) >= 15 && weakerRechargeSite) {
                recommendations.push({
                    panel: '站点差异',
                    tone: Math.abs(rechargeGap) >= 25 ? 'warning' : 'accent',
                    level: Math.abs(rechargeGap) >= 25 ? '建议跟进' : '持续观察',
                    title: `${getAnalyticsSiteLabel(weakerRechargeSite)} 充值成功率低于另一侧`,
                    summary: `当前窗口 CN 充值成功率 ${formatPercent(cnSnapshot.metrics.rechargeSuccessRate)}，INTL 为 ${formatPercent(intlSnapshot.metrics.rechargeSuccessRate)}，建议优先排查更弱站点的支付承接。`,
                    actionLabel: '看积分与交易',
                    destination: 'analytics-monetization',
                    icon: 'fas fa-wallet',
                    context: {
                        site: weakerRechargeSite,
                        sectionId: 'commerceEventFunnel'
                    },
                    sampleLabel: '站点差异',
                    sampleItems: siteComparisonData.insights?.slice(0, 2) || []
                });
            }
        }
    }

    return recommendations;
}

function getAnalyticsProductBundleSegmentPayload(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const segments = bundle?.segments && typeof bundle.segments === 'object'
        ? bundle.segments
        : {};
    const segment = normalizedKey ? segments[normalizedKey] : null;
    if (!segment || typeof segment !== 'object' || segment.ok !== true) {
        return null;
    }
    return Object.prototype.hasOwnProperty.call(segment, 'payload') ? segment.payload : null;
}

function buildAnalyticsProductOverviewInsight(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const summary = getAnalyticsProductBundleSegmentPayload(sourceData?.productSummaryBundle, 'summary') || {};
    const refundRiskRows = getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'refundRiskProducts') || [];
    const deliveryRiskRows = getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'deliveryRiskProducts') || [];
    const lowStockRows = getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'lowStockProducts') || [];
    const soldOutRows = getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'soldOutProducts') || [];
    const highExposureRows = getAnalyticsProductBundleSegmentPayload(sourceData?.productRankBundle, 'highExposureLowConversion') || [];
    const contentDrivenRows = getAnalyticsProductBundleSegmentPayload(sourceData?.productRankBundle, 'contentDrivenTop') || [];

    const orderCount = normalizeAnalyticsCountValue(summary.order_count);
    const buyerCount = normalizeAnalyticsCountValue(summary.unique_buyer_count);
    const gmvPoints = normalizeAnalyticsNumber(summary.gmv_points);
    const viewUsers = normalizeAnalyticsCountValue(summary.view_user_count);
    const detailUsers = normalizeAnalyticsCountValue(summary.detail_view_user_count);
    const purchaseIntentUsers = normalizeAnalyticsCountValue(summary.purchase_click_user_count);
    const lowStockCount = normalizeAnalyticsCountValue(summary.low_stock_product_count);
    const soldOutCount = normalizeAnalyticsCountValue(summary.sold_out_product_count);
    const topRefundRisk = Array.isArray(refundRiskRows) ? refundRiskRows[0] || null : null;
    const topDeliveryRisk = Array.isArray(deliveryRiskRows) ? deliveryRiskRows[0] || null : null;
    const topLowStock = (Array.isArray(lowStockRows) ? lowStockRows[0] : null) || (Array.isArray(soldOutRows) ? soldOutRows[0] : null) || null;
    const topExposureGap = Array.isArray(highExposureRows) ? highExposureRows[0] || null : null;
    const topContentDriven = Array.isArray(contentDrivenRows) ? contentDrivenRows[0] || null : null;

    const hasSignal = Boolean(
        orderCount > 0
        || buyerCount > 0
        || gmvPoints > 0
        || viewUsers > 0
        || detailUsers > 0
        || purchaseIntentUsers > 0
        || lowStockCount > 0
        || soldOutCount > 0
        || topRefundRisk
        || topDeliveryRisk
        || topLowStock
        || topExposureGap
        || topContentDriven
    );
    if (!hasSignal) {
        return null;
    }

    let tone = 'neutral';
    let stateLabel = '观察中';
    let detail = '当前窗口商品经营信号还偏轻，继续观察浏览、意图和成交承接。';
    let anomalyCard = null;

    if (topRefundRisk) {
        tone = 'danger';
        stateLabel = '仍异常';
        detail = `${topRefundRisk.product_name || '头部商品'} 退款率 ${formatPercent(topRefundRisk.refund_rate || 0)}，建议优先复查售后与退款处理结果。`;
        anomalyCard = {
            tone,
            level: '优先处理',
            panel: '商品经营',
            title: '商品退款风险仍未完全收口',
            metricLabel: '商品状态',
            metricValue: stateLabel,
            meta: `退款 ${formatNumber(topRefundRisk.refunded_order_count || 0)} / 总单 ${formatNumber((topRefundRisk.order_count || 0) + (topRefundRisk.refunded_order_count || 0))}`,
            summary: detail,
            actionLabel: '看商品售后风险',
            destination: 'analytics-product',
            icon: 'fas fa-rotate-left',
            context: {
                productId: topRefundRisk.product_id,
                productName: topRefundRisk.product_name,
                detailFocus: 'refund-risk',
                focusTargetId: 'productRiskBreakdownSection'
            },
            sampleLabel: '商品风险',
            sampleItems: [
                `${topRefundRisk.product_name || '未命名商品'} · 退款 ${formatNumber(topRefundRisk.refunded_order_count || 0)} 单`,
                `退款率 ${formatPercent(topRefundRisk.refund_rate || 0)}`
            ]
        };
    } else if (topDeliveryRisk) {
        tone = 'warning';
        stateLabel = '仍异常';
        detail = `${topDeliveryRisk.product_name || '头部商品'} 还有 ${formatNumber(topDeliveryRisk.delivery_risk_count || 0)} 笔履约风险，建议优先复查履约处理是否真正收口。`;
        anomalyCard = {
            tone,
            level: '建议复核',
            panel: '商品经营',
            title: '商品履约风险仍在影响经营承接',
            metricLabel: '商品状态',
            metricValue: stateLabel,
            meta: `风险 ${formatNumber(topDeliveryRisk.delivery_risk_count || 0)} / 支付 ${formatNumber(topDeliveryRisk.order_count || 0)}`,
            summary: detail,
            actionLabel: '看商品履约风险',
            destination: 'analytics-product',
            icon: 'fas fa-truck-fast',
            context: {
                productId: topDeliveryRisk.product_id,
                productName: topDeliveryRisk.product_name,
                detailFocus: 'delivery-risk',
                focusTargetId: 'productRiskBreakdownSection'
            },
            sampleLabel: '商品风险',
            sampleItems: [
                `${topDeliveryRisk.product_name || '未命名商品'} · 风险 ${formatNumber(topDeliveryRisk.delivery_risk_count || 0)} 单`,
                `履约异常率 ${formatPercent(topDeliveryRisk.delivery_risk_rate || 0)}`
            ]
        };
    } else if (topExposureGap) {
        tone = 'warning';
        stateLabel = '待复查';
        detail = `${topExposureGap.product_name || '头部商品'} 浏览 ${formatNumber(topExposureGap.view_user_count || 0)} 但转化只有 ${formatPercent(topExposureGap.conversion_rate || 0)}，建议优先复查详情到支付承接。`;
        anomalyCard = {
            tone,
            level: '建议跟进',
            panel: '商品经营',
            title: '高曝光低转化商品需要继续复查',
            metricLabel: '商品状态',
            metricValue: stateLabel,
            meta: `浏览 ${formatNumber(topExposureGap.view_user_count || 0)} / 订单 ${formatNumber(topExposureGap.order_count || 0)}`,
            summary: detail,
            actionLabel: '看商品漏斗',
            destination: 'analytics-product',
            icon: 'fas fa-filter-circle-dollar',
            context: {
                productId: topExposureGap.product_id,
                productName: topExposureGap.product_name,
                focusTargetId: 'productFunnelSection'
            },
            sampleLabel: '商品断点',
            sampleItems: [
                `${topExposureGap.product_name || '未命名商品'} · 浏览 ${formatNumber(topExposureGap.view_user_count || 0)}`,
                `转化 ${formatPercent(topExposureGap.conversion_rate || 0)}`
            ]
        };
    } else if (orderCount <= 0 && (purchaseIntentUsers > 0 || detailUsers > 0 || viewUsers > 0)) {
        tone = purchaseIntentUsers > 0 ? 'warning' : 'accent';
        stateLabel = '待复查';
        detail = purchaseIntentUsers > 0
            ? `当前窗口已有 ${formatNumber(purchaseIntentUsers)} 个购买意图，但还没形成成交，建议先复查支付承接。`
            : `当前窗口商品浏览 ${formatNumber(viewUsers)}、详情触达 ${formatNumber(detailUsers)}，建议继续观察是否形成购买意图。`;
        anomalyCard = {
            tone,
            level: purchaseIntentUsers > 0 ? '建议复核' : '持续观察',
            panel: '商品经营',
            title: '商品链路已经起量，但成交尚未形成',
            metricLabel: '商品状态',
            metricValue: stateLabel,
            meta: `浏览 ${formatNumber(viewUsers)} / 详情 ${formatNumber(detailUsers)} / 意图 ${formatNumber(purchaseIntentUsers)}`,
            summary: detail,
            actionLabel: '查看商品经营',
            destination: 'analytics-product',
            icon: 'fas fa-box-open',
            context: {
                focusTargetId: 'productFunnelSection'
            },
            sampleLabel: '商品断点',
            sampleItems: [
                `浏览 ${formatNumber(viewUsers)} 人`,
                `详情 ${formatNumber(detailUsers)} 人`,
                `意图 ${formatNumber(purchaseIntentUsers)} 人`
            ]
        };
    } else if (topLowStock) {
        tone = soldOutCount > 0 ? 'warning' : 'accent';
        stateLabel = '待复查';
        detail = `${topLowStock.product_name || '头部商品'} 当前库存 ${formatNumber(topLowStock.stock_count || 0)}，建议结合销量和履约状态决定是否补货。`;
    } else if (topContentDriven || orderCount > 0 || gmvPoints > 0) {
        tone = 'success';
        stateLabel = '放量中';
        detail = topContentDriven
            ? `${topContentDriven.product_name || '头部商品'} 已形成内容带货，当前归因 GMV ${formatNumber(topContentDriven.content_assisted_gmv_points || 0)}。`
            : `当前窗口商品成交 ${formatNumber(orderCount)} 单、GMV ${formatNumber(gmvPoints)}，可继续观察放量质量。`;
    }

    return {
        pulseItem: {
            label: '商品经营',
            value: stateLabel,
            detail,
            tone
        },
        anomalyCard
    };
}

function buildAnalyticsUserValueOverviewInsight(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    if (typeof buildAnalyticsUserValueOverviewState !== 'function') {
        return null;
    }

    const summaryWindow = sourceData?.summaryWindowData || sourceData || {};
    const productSummary = getAnalyticsProductBundleSegmentPayload(sourceData?.productSummaryBundle, 'summary') || {};
    const overviewState = buildAnalyticsUserValueOverviewState({
        summaryWindow,
        productSummary
    });
    const summary = overviewState?.summary || {};
    if (!summary?.hasSignal) {
        return null;
    }

    const feedbackEntries = Array.isArray(overviewState?.feedbackEntries) ? overviewState.feedbackEntries : [];
    const prioritySummary = overviewState?.prioritySummary || null;
    const verificationState = overviewState?.verificationState || null;
    const digest = overviewState?.digest || null;
    const statusSummary = overviewState?.statusSummary || {};
    const latestEntry = overviewState?.latestEntry || null;
    const buyerUsers = normalizeAnalyticsCountValue(summary.buyerUsers);
    const repeatBuyers = normalizeAnalyticsCountValue(summary.repeatBuyers);
    const crossProductBuyers = normalizeAnalyticsCountValue(summary.crossProductBuyers);
    const refundRiskBuyers = normalizeAnalyticsCountValue(summary.refundRiskBuyers);
    const purchaseIntentUsers = normalizeAnalyticsCountValue(summary.purchaseIntentUsers);
    const detailViewUsers = normalizeAnalyticsCountValue(summary.detailViewUsers);
    const viewUsers = normalizeAnalyticsCountValue(summary.viewUsers);
    const normalizedTone = String(prioritySummary?.tone || digest?.tone || verificationState?.tone || summary.stateTone || 'accent').trim().toLowerCase();
    const tone = normalizedTone === 'danger'
        ? 'danger'
        : ((normalizedTone === 'success') ? 'success' : 'warning');
    const stateLabel = String(
        feedbackEntries.length
            ? (digest?.label || verificationState?.label || '')
            : ''
    ).trim() || (
        tone === 'danger'
            ? '仍异常'
            : ((repeatBuyers > 0 || crossProductBuyers > 0) ? '放量中' : '待复查')
    );
    const detail = String(prioritySummary?.summary || digest?.summary || summary.headline || summary.summary || '').trim()
        || '当前窗口暂无更高优先级的用户价值异常，继续观察成交与复购承接即可。';
    const sampleItems = [
        digest?.label ? String(digest.label).trim() : '',
        prioritySummary?.topItem?.meta ? String(prioritySummary.topItem.meta).trim() : '',
        Number(statusSummary.review || 0) > 0 ? `待复查 ${formatNumber(statusSummary.review || 0)}` : '',
        Number(statusSummary.abnormal || 0) > 0 ? `仍异常 ${formatNumber(statusSummary.abnormal || 0)}` : '',
        buyerUsers > 0 ? `成交 ${formatNumber(buyerUsers)}` : '',
        repeatBuyers > 0 ? `复购 ${formatNumber(repeatBuyers)}` : '',
        crossProductBuyers > 0 ? `跨商品 ${formatNumber(crossProductBuyers)}` : '',
        refundRiskBuyers > 0 ? `退款风险 ${formatNumber(refundRiskBuyers)}` : '',
        latestEntry?.createdAt ? `最近回写 ${formatAnalyticsResolutionFeedbackRelativeTime(latestEntry.createdAt)}` : ''
    ].filter(Boolean).slice(0, 4);

    const primaryAction = Array.isArray(prioritySummary?.actions) ? prioritySummary.actions[0] || null : null;
    const baseAction = {
        destination: primaryAction?.destination || 'analytics-growth',
        icon: primaryAction?.icon || 'fas fa-user-group',
        context: primaryAction?.context || {
            sectionId: 'userTrendPanel',
            focusTargetId: 'userValueCockpit'
        },
        sampleLabel: '价值层线索',
        sampleItems
    };

    let anomalyCard = null;
    let actionRecommendation = null;

    if (refundRiskBuyers > 0 || tone === 'danger') {
        const summaryText = prioritySummary?.summary || detail || '当前用户价值层仍有退款风险或异常回写，说明承接链还没有真正收口。';
        anomalyCard = {
            tone: 'danger',
            level: '优先处理',
            panel: '用户增长',
            title: prioritySummary?.title || '用户价值层已有退款风险仍待收口',
            metricLabel: '用户状态',
            metricValue: stateLabel,
            meta: `成交 ${formatNumber(buyerUsers)} / 退款风险 ${formatNumber(refundRiskBuyers)}`,
            summary: summaryText,
            actionLabel: primaryAction?.label || '看用户价值',
            ...baseAction
        };
        actionRecommendation = {
            panel: '用户增长',
            tone: 'danger',
            level: '优先处理',
            title: prioritySummary?.title || '用户价值层已有退款风险仍待收口',
            summary: summaryText,
            actionLabel: primaryAction?.label || '看用户价值',
            ...baseAction
        };
    } else if (buyerUsers > 0 && repeatBuyers <= 0 && crossProductBuyers <= 0) {
        const summaryText = prioritySummary?.summary || detail || '当前已经形成首单成交，但复购和跨商品购买仍偏薄，适合继续确认承接链。';
        anomalyCard = {
            tone: 'warning',
            level: '建议复核',
            panel: '用户增长',
            title: prioritySummary?.title || '用户已经形成首单成交，但复购层仍偏薄',
            metricLabel: '用户状态',
            metricValue: stateLabel,
            meta: `首单 ${formatNumber(buyerUsers)} / 复购 ${formatNumber(repeatBuyers)} / 跨商品 ${formatNumber(crossProductBuyers)}`,
            summary: summaryText,
            actionLabel: primaryAction?.label || '看用户价值',
            ...baseAction
        };
        actionRecommendation = {
            panel: '用户增长',
            tone: 'warning',
            level: '建议复核',
            title: prioritySummary?.title || '用户已经形成首单成交，但复购层仍偏薄',
            summary: summaryText,
            actionLabel: primaryAction?.label || '看用户价值',
            ...baseAction
        };
    } else if (buyerUsers <= 0 && (purchaseIntentUsers > 0 || detailViewUsers > 0 || viewUsers > 0)) {
        const summaryText = prioritySummary?.summary || detail || '当前商品影响用户层已起量，但用户价值层仍停留在浏览或购买意图前段。';
        anomalyCard = {
            tone: purchaseIntentUsers > 0 ? 'warning' : 'accent',
            level: purchaseIntentUsers > 0 ? '建议跟进' : '持续观察',
            panel: '用户增长',
            title: prioritySummary?.title || '商品影响用户层已起量，用户价值层仍停在前段',
            metricLabel: '用户状态',
            metricValue: stateLabel,
            meta: `浏览 ${formatNumber(viewUsers)} / 详情 ${formatNumber(detailViewUsers)} / 意图 ${formatNumber(purchaseIntentUsers)}`,
            summary: summaryText,
            actionLabel: primaryAction?.label || '看用户价值',
            ...baseAction
        };
        actionRecommendation = {
            panel: '用户增长',
            tone: purchaseIntentUsers > 0 ? 'warning' : 'accent',
            level: purchaseIntentUsers > 0 ? '建议跟进' : '持续观察',
            title: prioritySummary?.title || '商品影响用户层已起量，用户价值层仍停在前段',
            summary: summaryText,
            actionLabel: primaryAction?.label || '看用户价值',
            ...baseAction
        };
    } else if (repeatBuyers > 0 || crossProductBuyers > 0) {
        actionRecommendation = {
            panel: '用户增长',
            tone: 'success',
            level: '持续观察',
            title: '用户价值层已开始形成复购承接',
            summary: detail,
            actionLabel: primaryAction?.label || '看用户价值',
            ...baseAction
        };
    }

    return {
        pulseItem: {
            label: '用户价值',
            value: stateLabel,
            detail,
            tone
        },
        anomalyCard,
        actionRecommendation
    };
}

function buildAnalyticsContentUserValueOverviewInsight(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    if (
        typeof buildAnalyticsContentCommerceSummary !== 'function'
        || typeof buildAnalyticsUserValueCockpitSummary !== 'function'
    ) {
        return null;
    }

    const summaryWindow = sourceData?.summaryWindowData || sourceData || {};
    const topContentRows = Array.isArray(summaryWindow?.top_content) ? summaryWindow.top_content : [];
    const contentCommerce = buildAnalyticsContentCommerceSummary(topContentRows);
    const contentSummary = contentCommerce?.summary && typeof contentCommerce.summary === 'object'
        ? contentCommerce.summary
        : {};
    const promptRows = Array.isArray(contentCommerce?.promptRows) ? contentCommerce.promptRows : [];
    const topPrompt = promptRows[0] || null;
    const productSummary = getAnalyticsProductBundleSegmentPayload(sourceData?.productSummaryBundle, 'summary') || {};
    const userTrendRows = Array.isArray(summaryWindow?.user_trend) ? summaryWindow.user_trend : [];
    const userValueSummary = buildAnalyticsUserValueCockpitSummary(productSummary, userTrendRows);
    const promptCount = normalizeAnalyticsCountValue(contentSummary.prompt_count);
    const detailViewCount = normalizeAnalyticsCountValue(contentSummary.detail_view_count);
    const purchaseClickCount = normalizeAnalyticsCountValue(contentSummary.purchase_click_count);
    const purchaseSuccessCount = normalizeAnalyticsCountValue(contentSummary.purchase_success_count);
    const gmvPoints = normalizeAnalyticsNumber(contentSummary.gmv_points);
    const buyerUsers = normalizeAnalyticsCountValue(userValueSummary.buyerUsers);
    const repeatBuyers = normalizeAnalyticsCountValue(userValueSummary.repeatBuyers);
    const crossProductBuyers = normalizeAnalyticsCountValue(userValueSummary.crossProductBuyers);
    const refundRiskBuyers = normalizeAnalyticsCountValue(userValueSummary.refundRiskBuyers);

    const hasSignal = promptCount > 0 || detailViewCount > 0 || purchaseClickCount > 0 || purchaseSuccessCount > 0 || userValueSummary.hasSignal;
    if (!hasSignal) {
        return null;
    }

    const promptLabel = topPrompt ? buildAnalyticsTopContentCommerceLabel(topPrompt) : '';
    const destinationContext = {
        promptId: topPrompt?.prompt_id || '',
        promptTitle: promptLabel,
        sectionId: promptLabel ? 'contentCommerceDetailSection' : 'topContentList',
        focusTargetId: promptLabel ? 'contentCommerceDetailSection' : 'topContentList'
    };
    const sampleItems = [
        promptCount > 0 ? `带货 Prompt ${formatNumber(promptCount)}` : '',
        purchaseSuccessCount > 0 ? `归因支付 ${formatNumber(purchaseSuccessCount)}` : '',
        gmvPoints > 0 ? `归因 GMV ${formatNumber(gmvPoints)}` : '',
        repeatBuyers > 0 ? `复购 ${formatNumber(repeatBuyers)}` : '',
        crossProductBuyers > 0 ? `跨商品 ${formatNumber(crossProductBuyers)}` : '',
        refundRiskBuyers > 0 ? `退款风险 ${formatNumber(refundRiskBuyers)}` : ''
    ].filter(Boolean).slice(0, 4);

    let tone = 'neutral';
    let stateLabel = '观察中';
    let detail = promptLabel
        ? `${promptLabel} 正在把内容消费承接到商品链路。`
        : '当前窗口已有内容带货样本，适合继续确认是否真的转成用户价值。';
    let anomalyCard = null;
    let actionRecommendation = null;

    if (purchaseSuccessCount > 0 && refundRiskBuyers > 0) {
        tone = 'danger';
        stateLabel = '仍异常';
        detail = `${promptLabel || '当前带货内容'} 已带来 ${formatNumber(purchaseSuccessCount)} 单归因支付，但用户价值层里还有 ${formatNumber(refundRiskBuyers)} 位退款风险样本，说明成交还没真正沉淀成稳定价值。`;
        anomalyCard = {
            tone,
            level: '优先处理',
            panel: '提示词内容',
            title: '内容已带来成交，但用户价值层已有退款风险',
            metricLabel: '内容状态',
            metricValue: stateLabel,
            meta: `支付 ${formatNumber(purchaseSuccessCount)} / 退款风险 ${formatNumber(refundRiskBuyers)}`,
            summary: detail,
            actionLabel: '看内容带货',
            destination: 'analytics-content',
            icon: 'fas fa-store',
            context: destinationContext,
            sampleLabel: '带货承接',
            sampleItems
        };
        actionRecommendation = {
            panel: '提示词内容',
            tone,
            level: '优先处理',
            title: '内容已带来成交，但用户价值层已有退款风险',
            summary: detail,
            actionLabel: '看内容带货',
            destination: 'analytics-content',
            icon: 'fas fa-store',
            context: destinationContext,
            sampleLabel: '带货承接',
            sampleItems
        };
    } else if (purchaseSuccessCount > 0 && (repeatBuyers > 0 || crossProductBuyers > 0)) {
        tone = 'success';
        stateLabel = '放量中';
        detail = `${promptLabel || '当前带货内容'} 已带来 ${formatNumber(purchaseSuccessCount)} 单归因支付，用户价值层里也开始出现 ${formatNumber(Math.max(repeatBuyers, crossProductBuyers))} 位复购或跨商品用户。`;
        actionRecommendation = {
            panel: '提示词内容',
            tone,
            level: '持续观察',
            title: '内容带货已经开始沉淀用户价值',
            summary: detail,
            actionLabel: '看内容带货',
            destination: 'analytics-content',
            icon: 'fas fa-chart-column',
            context: destinationContext,
            sampleLabel: '带货承接',
            sampleItems
        };
    } else if (purchaseSuccessCount > 0) {
        tone = 'warning';
        stateLabel = '待复查';
        detail = `${promptLabel || '当前带货内容'} 已带来 ${formatNumber(purchaseSuccessCount)} 单归因支付，但用户价值层当前仍更像首单阶段，复购和跨商品承接还偏薄。`;
        anomalyCard = {
            tone,
            level: '建议复核',
            panel: '提示词内容',
            title: '内容已带来成交，但用户价值仍停在首单层',
            metricLabel: '内容状态',
            metricValue: stateLabel,
            meta: `支付 ${formatNumber(purchaseSuccessCount)} / 成交用户 ${formatNumber(buyerUsers)}`,
            summary: detail,
            actionLabel: '看内容带货',
            destination: 'analytics-content',
            icon: 'fas fa-store',
            context: destinationContext,
            sampleLabel: '带货承接',
            sampleItems
        };
        actionRecommendation = {
            panel: '提示词内容',
            tone,
            level: '建议复核',
            title: '内容已带来成交，但用户价值仍停在首单层',
            summary: detail,
            actionLabel: '看内容带货',
            destination: 'analytics-content',
            icon: 'fas fa-store',
            context: destinationContext,
            sampleLabel: '带货承接',
            sampleItems
        };
    } else if (purchaseClickCount > 0 || detailViewCount > 0) {
        tone = purchaseClickCount > 0 ? 'warning' : 'accent';
        stateLabel = '待转化';
        detail = purchaseClickCount > 0
            ? `${promptLabel || '当前带货内容'} 已带来 ${formatNumber(purchaseClickCount)} 个购买意图，但还没继续转成稳定成交用户。`
            : `${promptLabel || '当前带货内容'} 已带来 ${formatNumber(detailViewCount)} 次详情触达，但用户价值层仍停在前段。`;
        anomalyCard = {
            tone,
            level: purchaseClickCount > 0 ? '建议跟进' : '持续观察',
            panel: '提示词内容',
            title: purchaseClickCount > 0 ? '内容已带来商品意图，尚未继续转成用户价值' : '内容已带来详情触达，用户价值仍停在前段',
            metricLabel: '内容状态',
            metricValue: stateLabel,
            meta: `详情 ${formatNumber(detailViewCount)} / 意图 ${formatNumber(purchaseClickCount)} / 支付 ${formatNumber(purchaseSuccessCount)}`,
            summary: detail,
            actionLabel: '看内容带货',
            destination: 'analytics-content',
            icon: 'fas fa-chart-column',
            context: destinationContext,
            sampleLabel: '带货承接',
            sampleItems
        };
        actionRecommendation = {
            panel: '提示词内容',
            tone,
            level: purchaseClickCount > 0 ? '建议跟进' : '持续观察',
            title: purchaseClickCount > 0 ? '内容已带来商品意图，尚未继续转成用户价值' : '内容已带来详情触达，用户价值仍停在前段',
            summary: detail,
            actionLabel: '看内容带货',
            destination: 'analytics-content',
            icon: 'fas fa-chart-column',
            context: destinationContext,
            sampleLabel: '带货承接',
            sampleItems
        };
    }

    return {
        pulseItem: {
            label: '内容→用户',
            value: stateLabel,
            detail,
            tone
        },
        anomalyCard,
        actionRecommendation
    };
}

function buildAnalyticsOpsOverviewInsight(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const operationsHealthSnapshot = sourceData?.operations_health_snapshot || sourceData?.operationsHealthSnapshot || null;
    const verifySummary = sourceData?.verify_service_summary || sourceData?.verifyServiceSummary || null;
    const opsAlertHealth = sourceData?.ops_alert_health || sourceData?.opsAlertHealth || {};
    const productSummary = getAnalyticsProductBundleSegmentPayload(sourceData?.productSummaryBundle, 'summary') || {};
    const productHealthPayloads = {
        lowStockProducts: getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'lowStockProducts') || [],
        soldOutProducts: getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'soldOutProducts') || [],
        deliveryRiskProducts: getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'deliveryRiskProducts') || [],
        refundRiskProducts: getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'refundRiskProducts') || [],
        inventoryTurnoverHints: getAnalyticsProductBundleSegmentPayload(sourceData?.productHealthBundle, 'inventoryTurnoverHints') || []
    };

    if (typeof buildAnalyticsOpsCockpitOverviewState !== 'function') {
        return null;
    }

    const hasSignal = Boolean(
        operationsHealthSnapshot
        || verifySummary
        || (productSummary && Object.keys(productSummary).length > 0)
        || (opsAlertHealth && Object.keys(opsAlertHealth).length > 0)
    );
    if (!hasSignal) {
        return null;
    }

    const overviewState = buildAnalyticsOpsCockpitOverviewState({
        operationsHealthSnapshot,
        verifySummary,
        productSummary,
        productHealthPayloads,
        opsAlertHealth
    });
    const paymentsState = typeof buildAnalyticsOpsPaymentsState === 'function'
        ? buildAnalyticsOpsPaymentsState(operationsHealthSnapshot)
        : {};
    const ticketsState = typeof buildAnalyticsOpsTicketsState === 'function'
        ? buildAnalyticsOpsTicketsState(operationsHealthSnapshot)
        : {};
    const fulfillmentState = typeof buildAnalyticsOpsFulfillmentState === 'function'
        ? buildAnalyticsOpsFulfillmentState(productSummary, productHealthPayloads)
        : {};
    const verifyState = typeof buildAnalyticsOpsVerifyState === 'function'
        ? buildAnalyticsOpsVerifyState(verifySummary)
        : {};
    const alertsState = typeof buildAnalyticsOpsAlertsState === 'function'
        ? buildAnalyticsOpsAlertsState(opsAlertHealth)
        : {};
    const entityStates = {
        payments: paymentsState,
        tickets: ticketsState,
        fulfillment: fulfillmentState,
        verify: verifyState,
        alerts: alertsState
    };
    const feedbackEntries = typeof getAnalyticsResolutionFeedbackEntriesForOps === 'function'
        ? getAnalyticsResolutionFeedbackEntriesForOps({ limit: 12 })
        : [];
    const feedbackState = typeof buildAnalyticsOpsFeedbackOverviewState === 'function'
        ? buildAnalyticsOpsFeedbackOverviewState(feedbackEntries, entityStates)
        : { reviewRows: [] };
    const conclusionRecord = typeof buildAnalyticsOpsConclusionRecords === 'function'
        ? (buildAnalyticsOpsConclusionRecords(feedbackEntries, entityStates, { limit: 1 })[0] || null)
        : null;
    const topReviewRow = Array.isArray(feedbackState?.reviewRows) ? feedbackState.reviewRows[0] || null : null;

    const normalizedTone = String(conclusionRecord?.tone || overviewState?.tone || 'neutral').trim().toLowerCase();
    const tone = normalizedTone === 'danger'
        ? 'danger'
        : ((normalizedTone === 'warning' || normalizedTone === 'accent') ? 'warning' : 'success');
    const stateLabel = tone === 'danger' ? '仍异常' : (tone === 'warning' ? '待复查' : '已收口');
    const detail = String(conclusionRecord?.summary || topReviewRow?.summary || overviewState?.summary || '').trim()
        || '当前运营保障信号平稳，继续按处理页和告警队列巡检即可。';

    let anomalyCard = null;
    if (tone !== 'success') {
        const primaryAction = Array.isArray(topReviewRow?.actions) && topReviewRow.actions.length > 0
            ? topReviewRow.actions[0]
            : ((Array.isArray(overviewState?.actions) && overviewState.actions.length > 0) ? overviewState.actions[0] : null);
        const statusSummary = feedbackState?.statusSummary || {};
        anomalyCard = {
            tone,
            level: tone === 'danger' ? '优先处理' : '建议复核',
            panel: '运营保障',
            title: tone === 'danger' ? '运营保障当前仍有关键问题未收口' : '运营保障当前仍需要继续复查',
            metricLabel: '运营状态',
            metricValue: stateLabel,
            meta: `已处理 ${formatNumber(statusSummary.resolved || 0)} / 待复查 ${formatNumber(statusSummary.review || 0)} / 仍异常 ${formatNumber(statusSummary.abnormal || 0)}`,
            summary: String(conclusionRecord?.evidence || topReviewRow?.reason || detail).trim() || detail,
            actionLabel: primaryAction?.label || '查看运营保障',
            destination: primaryAction?.destination || 'analytics-ops',
            icon: primaryAction?.icon || 'fas fa-shield-halved',
            context: primaryAction?.context || {
                sectionId: 'opsCockpitOverviewSection',
                focusTargetId: 'opsCockpitOverviewSection'
            },
            sampleLabel: '复查重点',
            sampleItems: [
                String(conclusionRecord?.evidence || '').trim(),
                String(topReviewRow?.nextStep || '').trim(),
                String(topReviewRow?.verify || '').trim()
            ].filter(Boolean).slice(0, 3)
        };
    }

    return {
        pulseItem: {
            label: '运营保障',
            value: stateLabel,
            detail,
            tone
        },
        anomalyCard
    };
}

function buildAnalyticsBusinessAnomalyCardsData(data = null, limit = 4) {
    const sourceData = getAnalyticsAISourceData(data);
    const productOverviewInsight = buildAnalyticsProductOverviewInsight(sourceData);
    const contentUserValueOverviewInsight = buildAnalyticsContentUserValueOverviewInsight(sourceData);
    const userValueOverviewInsight = buildAnalyticsUserValueOverviewInsight(sourceData);
    const opsOverviewInsight = buildAnalyticsOpsOverviewInsight(sourceData);
    const proxyMetricRows = getAnalyticsProxyMetricContextRows(sourceData);
    const overviewMetrics = sourceData?.overview_business_mix?.metrics || sourceData?.overviewBusinessMix?.metrics || {};
    const verifyMetrics = sourceData?.verify_service_summary?.metrics || sourceData?.verifyServiceSummary?.metrics || {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const operationsHealth = sourceData?.operations_health_snapshot || sourceData?.operationsHealthSnapshot || {};
    const summarySource = sourceData?.summaryWindowData || sourceData || {};
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const commerceFunnel = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const siteComparisonData = sourceData?.site_comparison || sourceData?.siteComparisonData || null;
    const operationsMetrics = operationsHealth?.metrics || {};
    const paymentSummary = operationsHealth?.payments?.summary || {};
    const ticketSummary = operationsHealth?.tickets?.backlog || {};
    const paymentFocusRow = operationsHealth?.payments?.focusAlert || null;
    const ticketFocusRow = operationsHealth?.tickets?.focusOverdue || null;
    const verifyFailedCount = normalizeAnalyticsCountValue(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsCountValue(verifyMetrics.activeCount);
    const verifySuccessRate = normalizeAnalyticsNumber(verifyMetrics.successRate || overviewMetrics.verifySuccessRate);
    const verifyRequestCount = normalizeAnalyticsCountValue(verifyMetrics.requestCount || overviewMetrics.verifyRequestCount);
    const unlockCount = normalizeAnalyticsCountValue(overviewMetrics.unlockCount);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);
    const rewardPressure = roundTo(referralRewardPoints + checkinRewardPoints, 1) || 0;
    const rewardPerCoreAction = rewardPressure > 0
        ? rewardPressure / Math.max(1, unlockCount + verifyRequestCount)
        : 0;
    const anomalyCards = [];
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerceFunnel.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_purchase_users ?? eventOverview.shop_purchase_users);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerceFunnel.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);
    const commerceEventView = buildCommerceEventFunnelViewData(summarySource);

    if (opsOverviewInsight?.anomalyCard) {
        anomalyCards.push(opsOverviewInsight.anomalyCard);
    }

    if (productOverviewInsight?.anomalyCard) {
        anomalyCards.push(productOverviewInsight.anomalyCard);
    }

    if (contentUserValueOverviewInsight?.anomalyCard) {
        anomalyCards.push(contentUserValueOverviewInsight.anomalyCard);
    }

    if (userValueOverviewInsight?.anomalyCard) {
        anomalyCards.push(userValueOverviewInsight.anomalyCard);
    }

    if (
        normalizeAnalyticsCountValue(operationsMetrics.paymentAlertTotal) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.paymentDeadLetterCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.paymentRetryCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.paymentAnomalyCount) > 0
    ) {
        const deadLetterCount = normalizeAnalyticsCountValue(paymentSummary.deadLetterCount);
        const retryCount = normalizeAnalyticsCountValue(paymentSummary.retryCount);
        const alertTotal = normalizeAnalyticsCountValue(paymentSummary.alertTotal);
        const tone = deadLetterCount > 0 ? 'danger' : (retryCount > 0 || alertTotal >= 3 ? 'warning' : 'accent');
        anomalyCards.push({
            tone,
            level: deadLetterCount > 0 ? '优先处理' : '建议复核',
            panel: '支付异常',
            title: deadLetterCount > 0 ? '支付告警队列出现死信' : '支付异常队列仍在堆积',
            metricLabel: deadLetterCount > 0 ? '待处理死信' : '站外支付告警',
            metricValue: `${formatNumber(deadLetterCount || alertTotal)} 条`,
            meta: `重试 ${formatNumber(retryCount)} / 专题 ${formatNumber(paymentSummary.exceptionTopicCount)}`,
            summary: deadLetterCount > 0
                ? '支付侧已经出现死信任务，建议优先进入支付告警队列收口，避免真实订单反馈继续堆积。'
                : '支付侧当前还有重试或未处理告警，建议继续查看队列、专题异常和近期支付波动。',
            actionLabel: '去支付排查',
            destination: 'payments-queue',
            icon: 'fas fa-tower-broadcast',
            context: paymentFocusRow?.order_id || paymentFocusRow?.payment_order_id || paymentFocusRow?.provider_order_no
                ? {
                    paymentOrderId: String(
                        paymentFocusRow.order_id
                        || paymentFocusRow.payment_order_id
                        || paymentFocusRow.provider_order_no
                    ).trim(),
                    focusQueue: true,
                    sectionId: 'paymentsOpsAlertQueuePanel'
                }
                : {
                    focusQueue: true,
                    sectionId: 'paymentsOpsAlertQueuePanel'
                },
            sampleLabel: '最近支付异常',
            sampleItems: Array.isArray(operationsHealth?.samples?.paymentAlerts) ? operationsHealth.samples.paymentAlerts.slice(0, 3) : []
        });
    }

    if (siteComparisonData?.mode === 'compare' && Array.isArray(siteComparisonData.comparisons) && siteComparisonData.topGap?.focusSite) {
        const topGap = siteComparisonData.topGap;
        const gapMagnitude = Math.abs(normalizeAnalyticsNumber(topGap.diff));
        if (gapMagnitude >= 12) {
            anomalyCards.push({
                tone: gapMagnitude >= 20 ? 'warning' : 'accent',
                level: gapMagnitude >= 20 ? '建议复核' : '持续观察',
                panel: '站点差异',
                title: `${siteComparisonData.focusLabel || getAnalyticsSiteLabel(topGap.focusSite)} 在 ${topGap.label} 上明显落后`,
                metricLabel: topGap.label,
                metricValue: `${formatPercent(topGap.focusSite === 'intl' ? topGap.intlValue : topGap.cnValue)}`,
                meta: `CN ${formatPercent(topGap.cnValue)} / INTL ${formatPercent(topGap.intlValue)}`,
                summary: `当前窗口 ${topGap.label} 的站点差异约 ${trimTrailingZeros(gapMagnitude.toFixed(1))} 个百分点，建议优先复核 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(topGap.focusSite)} 对应链路。`,
                actionLabel: /验证/.test(topGap.label) ? '看验证服务' : '看积分与交易',
                destination: /验证/.test(topGap.label) ? 'analytics-verify' : 'analytics-monetization',
                icon: 'fas fa-globe',
                context: {
                    site: topGap.focusSite,
                    sectionId: /验证/.test(topGap.label) ? 'verifyEventFunnel' : 'commerceEventFunnel'
                },
                sampleLabel: '站点差异',
                sampleItems: siteComparisonData.insights?.slice(0, 3) || []
            });
        }
    }

    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        anomalyCards.push({
            tone: rechargeSuccessRate < 40 ? 'danger' : 'warning',
            level: rechargeSuccessRate < 40 ? '优先处理' : '建议复核',
            panel: '交易转化',
            title: rechargeSuccessRate < 40 ? '充值点击后成功转化明显偏低' : '充值成功率仍低于稳定区间',
            metricLabel: '充值成功率',
            metricValue: formatPercent(rechargeSuccessRate),
            meta: `点击 ${formatNumber(rechargeClickUsers)} / 成功 ${formatNumber(rechargeSuccessUsers)} / 商城成交 ${formatNumber(shopPurchaseUsers)}`,
            summary: rechargeSuccessRate < 40
                ? '真实交易事件显示点击后成功转化明显偏低，建议优先联动支付告警和交易看板排查链路问题。'
                : '真实交易事件显示充值点击已有需求，但支付成功仍偏低，建议继续检查支付异常和配置一致性。',
            actionLabel: '去支付排查',
            destination: 'payments-queue',
            icon: 'fas fa-credit-card',
            context: {
                focusQueue: true,
                sectionId: 'paymentsOpsAlertQueuePanel'
            },
            sampleLabel: '真实交易转化',
            sampleItems: buildAnalyticsEventSampleItems(commerceEventView)
        });
    } else if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        anomalyCards.push({
            tone: shopPurchaseRate < 10 ? 'warning' : 'accent',
            level: shopPurchaseRate < 10 ? '建议跟进' : '持续观察',
            panel: '交易转化',
            title: '商城浏览和成交之间仍有明显流失',
            metricLabel: '商城成交率',
            metricValue: formatPercent(shopPurchaseRate),
            meta: `浏览 ${formatNumber(shopViewUsers)} / 成交 ${formatNumber(shopPurchaseUsers)} / 充值成功 ${formatNumber(rechargeSuccessUsers)}`,
            summary: '真实交易事件显示用户已经进入商城，但成交承接偏弱，建议回看积分与交易里的套餐、权益和消费路径。',
            actionLabel: '看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-wallet',
            context: {
                sectionId: 'commerceEventFunnel'
            },
            sampleLabel: '真实交易转化',
            sampleItems: buildAnalyticsEventSampleItems(commerceEventView)
        });
    }

    if (
        normalizeAnalyticsCountValue(operationsMetrics.ticketOverdueCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.ticketCriticalOverdueCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.ticketPendingCount) >= 6
        || normalizeAnalyticsCountValue(operationsMetrics.ticketReminderDeadLetterCount) > 0
    ) {
        const overdueCount = normalizeAnalyticsCountValue(ticketSummary.overdueCount);
        const criticalOverdueCount = normalizeAnalyticsCountValue(ticketSummary.criticalOverdueCount);
        const pendingCount = normalizeAnalyticsCountValue(ticketSummary.pendingCount);
        const oldestWaitMinutes = normalizeAnalyticsCountValue(ticketSummary.oldestWaitMinutes);
        const reminderDeadLetterCount = normalizeAnalyticsCountValue(ticketSummary.reminderDeadLetterCount);
        const tone = criticalOverdueCount > 0 || reminderDeadLetterCount > 0
            ? 'danger'
            : (overdueCount > 0 || pendingCount >= 10 ? 'warning' : 'accent');
        anomalyCards.push({
            tone,
            level: criticalOverdueCount > 0 || reminderDeadLetterCount > 0 ? '优先处理' : '建议跟进',
            panel: '工单队列',
            title: criticalOverdueCount > 0 ? '工单队列已有 critical 超时' : '工单队列出现待处理堆积',
            metricLabel: overdueCount > 0 ? '超时工单' : '待处理工单',
            metricValue: `${formatNumber(overdueCount || pendingCount)} 单`,
            meta: `critical ${formatNumber(criticalOverdueCount)} / 最老 ${formatAnalyticsMinutesWindow(oldestWaitMinutes)}`,
            summary: criticalOverdueCount > 0 || reminderDeadLetterCount > 0
                ? '当前工单提醒或超时任务已经进入高优先级区间，建议尽快进入工单队列确认负责人与响应进度。'
                : '工单待处理量正在抬升，建议检查未指派、高优先和超时队列是否需要重新分配。',
            actionLabel: '进入工单队列',
            destination: overdueCount > 0 || criticalOverdueCount > 0 ? 'tickets-overdue' : 'tickets-pending',
            icon: 'fas fa-life-ring',
            context: ticketFocusRow?.ticket_id
                ? {
                    ticketId: String(ticketFocusRow.ticket_id).trim(),
                    targetId: String(ticketFocusRow.ticket_id).trim(),
                    workspace: 'queue',
                    quickFilter: overdueCount > 0 || criticalOverdueCount > 0 ? 'overdue' : '',
                    status: 'pending'
                }
                : {
                    workspace: 'queue',
                    quickFilter: overdueCount > 0 || criticalOverdueCount > 0 ? 'overdue' : '',
                    status: 'pending'
                },
            sampleLabel: '最近队列样本',
            sampleItems: Array.isArray(operationsHealth?.samples?.ticketIssues) ? operationsHealth.samples.ticketIssues.slice(0, 3) : []
        });
    }

    if (verifyRequestCount > 0 && (verifyFailedCount > 0 || verifyActiveCount >= 3 || verifySuccessRate < 85)) {
        const tone = verifyFailedCount > 0 || verifySuccessRate < 70 ? 'danger' : 'warning';
        const verifyRows = sourceData?.verify_service_summary?.focusRows || sourceData?.verifyServiceSummary?.focusRows || [];
        const focusRow = Array.isArray(verifyRows) ? verifyRows[0] : null;
        anomalyCards.push({
            tone,
            level: tone === 'danger' ? '优先处理' : '建议复核',
            panel: '验证服务',
            title: verifyFailedCount > 0 ? '验证服务出现失败/阻塞任务' : '验证队列仍有处理中任务',
            metricLabel: verifyFailedCount > 0 ? '失败/阻塞验证' : '处理中验证',
            metricValue: `${formatNumber(verifyFailedCount || verifyActiveCount)} 条`,
            meta: `成功率 ${formatPercent(verifySuccessRate)} / 请求 ${formatNumber(verifyRequestCount)}`,
            summary: verifyFailedCount > 0
                ? '验证主链路已有失败或阻塞样本，建议优先进入 Verify Monitor 处理失败任务和配置问题。'
                : '验证队列仍在积压，建议继续检查额度、接口状态和重试情况。',
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: focusRow?.['验证单号'] ? {
                verificationId: String(focusRow['验证单号']).trim(),
                targetId: String(focusRow['验证单号']).trim(),
                referenceValue: String(focusRow['验证单号']).trim()
            } : null,
            sampleLabel: '最近验证异常',
            sampleItems: Array.isArray(sourceData?.verify_service_summary?.samples?.focusTasks || sourceData?.verifyServiceSummary?.samples?.focusTasks)
                ? (sourceData.verify_service_summary?.samples?.focusTasks || sourceData.verifyServiceSummary?.samples?.focusTasks).slice(0, 3)
                : []
        });
    }

    if (rewardPressure > 0 && (rewardPressure >= 120 || rewardPerCoreAction >= 30 || unlockCount === 0)) {
        const growthSamples = sourceData?.growth_summary?.samples || sourceData?.growthSummary?.samples || {};
        const tone = rewardPerCoreAction >= 30 || unlockCount === 0 ? 'warning' : 'accent';
        anomalyCards.push({
            tone,
            level: tone === 'warning' ? '建议复核' : '持续观察',
            panel: '裂变与激励',
            title: referralRewardPoints > 0 ? '返佣与拉新奖励正在放量' : '签到补贴正在抬升',
            metricLabel: '激励积分',
            metricValue: `${formatNumber(rewardPressure)} 积分`,
            meta: `返佣/拉新 ${formatNumber(referralRewardPoints)} / 签到 ${formatNumber(checkinRewardPoints)}`,
            summary: unlockCount === 0
                ? '当前窗口激励积分已经投放，但还没有看到足够的内容解锁或验证承接，建议先复核投放策略。'
                : '激励投放已经明显抬升，建议结合推广配置、返佣 ROI 和消费承接一起看，避免只放量不转化。',
            actionLabel: referralRewardPoints > 0 ? '查看推广配置' : '查看积分流水',
            destination: referralRewardPoints > 0 ? 'settings-affiliate' : 'points',
            icon: referralRewardPoints > 0 ? 'fas fa-share-nodes' : 'fas fa-calendar-check',
            context: referralRewardPoints > 0
                ? {
                    field: referralRewardPoints >= checkinRewardPoints ? 'commission_rate_shop' : 'registration_reward_points'
                }
                : {
                    view: 'lookup',
                    quick: 'today'
                },
            sampleLabel: '最近激励样本',
            sampleItems: referralRewardPoints > 0
                ? (Array.isArray(growthSamples.referralRewards) ? growthSamples.referralRewards.slice(0, 3) : [])
                : (Array.isArray(growthSamples.checkinRewards) ? growthSamples.checkinRewards.slice(0, 3) : [])
        });
    }

    if (proxyMetricRows.length > 0 && anomalyCards.length < Math.max(limit, 1)) {
        const primaryProxyRow = proxyMetricRows[0] || {};
        const destinationMeta = getAnalyticsMetricContextDestination(primaryProxyRow);
        anomalyCards.push({
            tone: 'neutral',
            level: '观察',
            panel: '指标口径',
            title: '部分分析面板仍是代理参考口径',
            metricLabel: '代理面板',
            metricValue: `${formatNumber(proxyMetricRows.length)} 项`,
            meta: proxyMetricRows.map((row) => row['板块']).filter(Boolean).join(' / '),
            summary: '热力图、留存等代理面板更适合做趋势观察和排查线索；需要下严格结论时请优先结合真实事件面板。',
            actionLabel: '回看代理面板',
            destination: destinationMeta.destination,
            icon: 'fas fa-ruler-combined',
            context: destinationMeta.context,
            sampleLabel: '代理口径',
            sampleItems: proxyMetricRows.slice(0, 3).map((row) => `${row['板块']} · ${row['指标口径']}`)
        });
    }

    const normalizedCards = anomalyCards
        .sort((left, right) => getAnalyticsAnomalyTonePriority(left.tone) - getAnalyticsAnomalyTonePriority(right.tone))
        .slice(0, limit);

    if (normalizedCards.length > 0) {
        return normalizedCards;
    }

    return [{
        tone: 'success',
        level: '状态良好',
        panel: '运营健康',
        title: '当前窗口未发现明显经营异常',
        metricLabel: '健康状态',
        metricValue: '稳定',
        meta: '支付、工单、验证和激励链路暂时平稳',
        summary: '可以继续结合内容消费、验证成功率和社区承接看更细的经营变化。',
        actionLabel: '回到经营总览',
        destination: 'analytics-overview',
        icon: 'fas fa-compass-drafting',
        sampleLabel: '',
        sampleItems: []
    }];
}

function renderAnalyticsAnomalyCardGrid(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return renderHintState('fas fa-triangle-exclamation', '当前窗口暂无待排查异常');
    }

    return `
        <div class="ai-anomaly-grid">
            ${items.map((item) => `
                <button
                    type="button"
                    class="ai-anomaly-card ai-anomaly-card--${escapeHtml(item.tone || 'neutral')}"
                    data-admin-action="analytics-open-destination"
                    data-analytics-destination="${escapeHtml(item.destination || '')}"
                    data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item.context || null))}"
                >
                    <div class="ai-anomaly-card__top">
                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone || 'neutral')}">${escapeHtml(item.level || '观察')}</span>
                        <span class="ai-anomaly-card__panel">${escapeHtml(item.panel || '经营异常')}</span>
                    </div>
                    <div class="ai-anomaly-card__metric-row">
                        <div>
                            <span class="ai-anomaly-card__metric-label">${escapeHtml(item.metricLabel || '异常指标')}</span>
                            <strong class="ai-anomaly-card__metric">${escapeHtml(item.metricValue || '--')}</strong>
                        </div>
                        <i class="${escapeHtml(item.icon || 'fas fa-triangle-exclamation')}"></i>
                    </div>
                    <strong class="ai-anomaly-card__title">${escapeHtml(item.title || '经营异常')}</strong>
                    ${item.meta ? `<div class="ai-anomaly-card__meta">${escapeHtml(item.meta)}</div>` : ''}
                    <div class="ai-anomaly-card__summary">${escapeHtml(item.summary || '建议打开对应模块继续处理')}</div>
                    ${Array.isArray(item.sampleItems) && item.sampleItems.length ? `
                        <div class="ai-anomaly-card__samples">
                            <span class="ai-anomaly-card__sample-label">${escapeHtml(item.sampleLabel || '样本线索')}</span>
                            <div class="ai-anomaly-card__sample-list">
                                ${item.sampleItems.slice(0, 3).map((sample) => `
                                    <span class="ai-anomaly-card__sample-pill">${escapeHtml(sample)}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <span class="ai-anomaly-card__cta">${escapeHtml(item.actionLabel || '打开对应模块')}<i class="fas fa-arrow-right"></i></span>
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsDutyQueue(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return renderHintState('fas fa-triangle-exclamation', '当前窗口暂无待排查异常');
    }

    const [primaryItem, ...secondaryItems] = items;
    const primarySamples = Array.isArray(primaryItem?.sampleItems) ? primaryItem.sampleItems.slice(0, 2) : [];
    const primaryMetric = splitAnalyticsDutyDisplayValue(primaryItem?.metricValue || '--');
    const primaryMetricIsStatus = !primaryMetric.secondary
        && primaryMetric.primary !== '--'
        && !/[0-9]/.test(primaryMetric.primary);
    const primaryMetricClass = primaryMetricIsStatus ? ' analytics-duty-hero__metric--status' : '';

    return `
        <div class="analytics-duty-queue${secondaryItems.length ? '' : ' analytics-duty-queue--single'}">
            <article class="analytics-duty-hero analytics-duty-hero--${escapeHtml(primaryItem?.tone || 'neutral')}">
                <div class="analytics-duty-hero__top">
                    <div class="analytics-duty-hero__badge-row">
                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(primaryItem?.tone || 'neutral')}">${escapeHtml(primaryItem?.level || '观察')}</span>
                        <span class="analytics-duty-hero__panel">${escapeHtml(primaryItem?.panel || '经营异常')}</span>
                    </div>
                </div>
                <div class="analytics-duty-hero__body">
                    <div class="analytics-duty-hero__content">
                        <strong class="analytics-duty-hero__title">${escapeHtml(primaryItem?.title || '经营异常')}</strong>
                        ${(primaryItem?.meta || primaryItem?.summary) ? `
                            <div class="analytics-duty-hero__summary">${escapeHtml(primaryItem?.meta || primaryItem?.summary || '')}</div>
                        ` : ''}
                        ${primarySamples.length ? `
                            <div class="analytics-duty-hero__samples">
                                ${primarySamples.map((sample) => `
                                    <span class="analytics-duty-hero__sample-pill">${escapeHtml(sample)}</span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="analytics-duty-hero__metric-card">
                        <div class="analytics-duty-hero__metric-stack">
                            <strong class="analytics-duty-hero__metric${primaryMetricClass}">${escapeHtml(primaryMetric.primary)}</strong>
                            ${primaryMetric.secondary ? `<span class="analytics-duty-hero__metric-unit">${escapeHtml(primaryMetric.secondary)}</span>` : ''}
                        </div>
                        <span class="analytics-duty-hero__metric-label">${escapeHtml(primaryItem?.metricLabel || '异常指标')}</span>
                    </div>
                    <div class="analytics-duty-hero__aside">
                        <div class="analytics-duty-hero__footer">
                            <button
                                type="button"
                                class="analytics-duty-hero__cta"
                                data-admin-action="analytics-open-destination"
                                data-analytics-destination="${escapeHtml(primaryItem?.destination || '')}"
                                data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(primaryItem?.context || null))}"
                            >${escapeHtml(primaryItem?.actionLabel || '打开对应模块')}</button>
                        </div>
                    </div>
                </div>
            </article>
            ${secondaryItems.length ? `
                <div class="analytics-duty-list" role="list" aria-label="待处理队列">
                    ${secondaryItems.map((item) => `
                        <article
                            class="analytics-duty-list-item analytics-duty-list-item--${escapeHtml(item?.tone || 'neutral')}"
                            role="listitem"
                        >
                            <div class="analytics-duty-list-item__top">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item?.tone || 'neutral')}">${escapeHtml(item?.level || '观察')}</span>
                                <span class="analytics-duty-list-item__panel">${escapeHtml(item?.panel || '经营异常')}</span>
                                <strong class="analytics-duty-list-item__metric">${escapeHtml(item?.metricValue || '--')}</strong>
                            </div>
                            <strong class="analytics-duty-list-item__title">${escapeHtml(item?.title || '经营异常')}</strong>
                            <div class="analytics-duty-list-item__summary">${escapeHtml(item?.meta || item?.summary || '建议打开对应模块继续处理')}</div>
                            <button
                                type="button"
                                class="analytics-duty-list-item__cta"
                                data-admin-action="analytics-open-destination"
                                data-analytics-destination="${escapeHtml(item?.destination || '')}"
                                data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item?.context || null))}"
                            >${escapeHtml(item?.actionLabel || '去处理')}<i class="fas fa-arrow-right"></i></button>
                        </article>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function splitAnalyticsDutyDisplayValue(rawValue = '--') {
    const value = String(rawValue ?? '--').trim();
    if (!value) {
        return { primary: '--', secondary: '' };
    }

    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
        return { primary: value, secondary: '' };
    }

    return {
        primary: parts.slice(0, -1).join(' '),
        secondary: parts[parts.length - 1]
    };
}

function renderAnalyticsBusinessAnomalyCards(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }

    return `
        <section class="ai-anomaly-board">
            <div class="ai-anomaly-board__header">
                <div>
                    <p class="ai-anomaly-board__eyebrow">经营异常</p>
                    <h4 class="ai-anomaly-board__title">当前窗口最值得先排查的业务风险</h4>
                </div>
                <span class="ai-anomaly-board__meta">${items.length} 个异常卡片</span>
            </div>
            ${renderAnalyticsAnomalyCardGrid(items)}
        </section>
    `;
}

function buildAnalyticsDutyBoardData(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const verifyMetrics = sourceData?.verify_service_summary?.metrics || sourceData?.verifyServiceSummary?.metrics || {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const operationsHealth = sourceData?.operations_health_snapshot || sourceData?.operationsHealthSnapshot || {};
    const operationsMetrics = operationsHealth?.metrics || {};
    const verifyFailedCount = normalizeAnalyticsCountValue(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsCountValue(verifyMetrics.activeCount);
    const verifyRequestCount = normalizeAnalyticsCountValue(verifyMetrics.requestCount);
    const verifySuccessRate = normalizeAnalyticsNumber(verifyMetrics.successRate);
    const paymentAlertTotal = normalizeAnalyticsCountValue(operationsMetrics.paymentAlertTotal);
    const paymentDeadLetterCount = normalizeAnalyticsCountValue(operationsMetrics.paymentDeadLetterCount);
    const paymentRetryCount = normalizeAnalyticsCountValue(operationsMetrics.paymentRetryCount);
    const ticketPendingCount = normalizeAnalyticsCountValue(operationsMetrics.ticketPendingCount);
    const ticketOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketOverdueCount);
    const ticketCriticalOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketCriticalOverdueCount);
    const ticketOldestWaitMinutes = normalizeAnalyticsCountValue(operationsMetrics.ticketOldestWaitMinutes);
    const guestbookMessageCount = normalizeAnalyticsCountValue(growthMetrics.guestbookMessageCount);
    const guestbookCommentCount = normalizeAnalyticsCountValue(growthMetrics.guestbookCommentCount);
    const guestbookReplyRate = normalizeAnalyticsNumber(growthMetrics.guestbookReplyRate);
    const verifyOpenCount = verifyFailedCount + verifyActiveCount;
    const guestbookPendingCount = Math.max(0, guestbookMessageCount - guestbookCommentCount);
    const stats = [
        {
            label: '验证待处理',
            value: `${formatNumber(verifyOpenCount)} 条`,
            detail: verifyRequestCount > 0
                ? `失败 ${formatNumber(verifyFailedCount)} / 处理中 ${formatNumber(verifyActiveCount)} / 完成率 ${formatPercent(verifySuccessRate)}`
                : '当前窗口暂无验证样本',
            tone: verifyOpenCount > 0
                ? getAnalyticsAIMetricTone(verifySuccessRate, { dangerBelow: 70, warningBelow: 85 })
                : (verifyRequestCount > 0 ? 'success' : 'neutral')
        },
        {
            label: '支付告警',
            value: `${formatNumber(paymentAlertTotal)} 条`,
            detail: paymentAlertTotal > 0 || paymentDeadLetterCount > 0 || paymentRetryCount > 0
                ? `死信 ${formatNumber(paymentDeadLetterCount)} / 重试 ${formatNumber(paymentRetryCount)}`
                : '当前窗口支付链路平稳',
            tone: paymentDeadLetterCount > 0 ? 'danger' : (paymentAlertTotal > 0 || paymentRetryCount > 0 ? 'warning' : 'success')
        },
        {
            label: ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0 ? '超时工单' : '待处理工单',
            value: `${formatNumber(ticketOverdueCount || ticketPendingCount)} 单`,
            detail: ticketPendingCount > 0 || ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0
                ? `待处理 ${formatNumber(ticketPendingCount)} / critical ${formatNumber(ticketCriticalOverdueCount)} / 最老 ${formatAnalyticsMinutesWindow(ticketOldestWaitMinutes)}`
                : '当前窗口暂无工单堆积',
            tone: ticketCriticalOverdueCount > 0 ? 'danger' : (ticketOverdueCount > 0 || ticketPendingCount >= 6 ? 'warning' : (ticketPendingCount > 0 ? 'accent' : 'success'))
        },
        {
            label: '社区待回',
            value: `${formatNumber(guestbookPendingCount)} 条`,
            detail: guestbookMessageCount > 0
                ? `发帖 ${formatNumber(guestbookMessageCount)} / 回复 ${formatNumber(guestbookCommentCount)} / 回复率 ${formatPercent(guestbookReplyRate)}`
                : '当前窗口暂无留言样本',
            tone: guestbookMessageCount > 0
                ? getAnalyticsAIMetricTone(guestbookReplyRate, { dangerBelow: 50, warningBelow: 80 })
                : 'neutral'
        }
    ];

    return {
        stats,
        items: buildAnalyticsBusinessAnomalyCardsData(sourceData, 4)
    };
}

function renderAnalyticsDutyBoard(view = {}) {
    const stats = Array.isArray(view?.stats) ? view.stats : [];
    const items = Array.isArray(view?.items) ? view.items : [];
    if (!stats.length && !items.length) {
        return renderHintState('fas fa-clipboard-list', '当前窗口暂无待处理数据');
    }

    const actionableCount = items.filter((item) => item?.tone !== 'success').length;

    return `
        <div class="analytics-duty-board">
            <div class="analytics-duty-board__summary">
                <div class="analytics-duty-stats">
                    ${stats.map((item) => `
                        ${(() => {
                            const valueParts = splitAnalyticsDutyDisplayValue(item.value || '--');
                            return `
                        <article class="analytics-duty-stat analytics-duty-stat--${escapeHtml(item.tone || 'neutral')}">
                            <div class="analytics-duty-stat__head">
                                <span class="analytics-duty-stat__label">${escapeHtml(item.label || '待处理项')}</span>
                            </div>
                            <div class="analytics-duty-stat__value-wrap">
                                <strong class="analytics-duty-stat__value">${escapeHtml(valueParts.primary)}</strong>
                                ${valueParts.secondary ? `<span class="analytics-duty-stat__unit">${escapeHtml(valueParts.secondary)}</span>` : ''}
                            </div>
                            <div class="analytics-duty-stat__detail">${escapeHtml(item.detail || '当前窗口暂无说明')}</div>
                        </article>
                    `;
                        })()}
                    `).join('')}
                </div>
            </div>
            <div class="analytics-duty-board__queue">
                <div class="analytics-duty-board__section">
                    <div class="analytics-duty-board__section-head">
                        <div>
                            <strong>优先排查队列</strong>
                            <p>${actionableCount > 0 ? `当前最值得先处理的 ${actionableCount} 项异常` : '当前窗口没有更高优先级异常，继续观察即可'}</p>
                        </div>
                        <span class="analytics-duty-board__section-meta">${items.length} 项</span>
                    </div>
                    ${renderAnalyticsDutyQueue(items)}
                </div>
            </div>
        </div>
    `;
}

function buildAnalyticsAIPulseSummaryData(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const productOverviewInsight = buildAnalyticsProductOverviewInsight(sourceData);
    const contentUserValueOverviewInsight = buildAnalyticsContentUserValueOverviewInsight(sourceData);
    const userValueOverviewInsight = buildAnalyticsUserValueOverviewInsight(sourceData);
    const opsOverviewInsight = buildAnalyticsOpsOverviewInsight(sourceData);
    const summarySource = sourceData?.summaryWindowData || sourceData || {};
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const overviewMetrics = sourceData?.overview_business_mix?.metrics || sourceData?.overviewBusinessMix?.metrics || {};
    const verifyMetrics = sourceData?.verify_service_summary?.metrics || sourceData?.verifyServiceSummary?.metrics || {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const commerceFunnel = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const growthFunnel = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};
    const unlockCount = normalizeAnalyticsNumber(overviewMetrics.unlockCount);
    const verifyRequestCount = normalizeAnalyticsNumber(overviewMetrics.verifyRequestCount || verifyMetrics.requestCount);
    const verifySuccessRate = normalizeAnalyticsNumber(overviewMetrics.verifySuccessRate || verifyMetrics.successRate);
    const verifyFailedCount = normalizeAnalyticsNumber(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsNumber(verifyMetrics.activeCount);
    const guestbookMessageCount = normalizeAnalyticsNumber(growthMetrics.guestbookMessageCount);
    const guestbookCommentCount = normalizeAnalyticsNumber(growthMetrics.guestbookCommentCount);
    const guestbookReplyRate = normalizeAnalyticsNumber(growthMetrics.guestbookReplyRate);
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerceFunnel.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const inviteClickUsers = normalizeAnalyticsCountValue(growthFunnel.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growthFunnel.checkin_success_users ?? eventOverview.checkin_success_users);
    const rewardPoints = normalizeAnalyticsNumber(overviewMetrics.rewardPoints);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);

    const items = [
        {
            label: '内容解锁',
            value: formatNumber(unlockCount),
            detail: unlockCount > 0 ? '当前窗口内容消费样本' : '当前窗口暂无内容消费样本',
            tone: unlockCount > 0 ? 'accent' : 'neutral'
        },
        {
            label: '验证成功率',
            value: verifyRequestCount > 0 ? formatPercent(verifySuccessRate) : '--',
            detail: verifyRequestCount > 0
                ? `失败 ${formatNumber(verifyFailedCount)} / 处理中 ${formatNumber(verifyActiveCount)}`
                : '当前窗口暂无验证样本',
            tone: verifyRequestCount > 0
                ? getAnalyticsAIMetricTone(verifySuccessRate, { dangerBelow: 70, warningBelow: 85 })
                : 'neutral'
        },
        {
            label: '充值成功率',
            value: rechargeClickUsers > 0 ? formatPercent(rechargeSuccessRate) : '--',
            detail: rechargeClickUsers > 0
                ? `点击 ${formatNumber(rechargeClickUsers)} / 成功 ${formatNumber(rechargeSuccessUsers)}`
                : '当前窗口暂无充值链路样本',
            tone: rechargeClickUsers > 0
                ? getAnalyticsAIMetricTone(rechargeSuccessRate, { dangerBelow: 40, warningBelow: 60 })
                : 'neutral'
        },
        {
            label: '留言回复率',
            value: guestbookMessageCount > 0 ? formatPercent(guestbookReplyRate) : '--',
            detail: guestbookMessageCount > 0
                ? `发帖 ${formatNumber(guestbookMessageCount)} / 回复 ${formatNumber(guestbookCommentCount)}`
                : '当前窗口暂无留言样本',
            tone: guestbookMessageCount > 0
                ? getAnalyticsAIMetricTone(guestbookReplyRate, { dangerBelow: 50, warningBelow: 80 })
                : 'neutral'
        },
        {
            label: '激励投放',
            value: formatNumber(rewardPoints || (referralRewardPoints + checkinRewardPoints)),
            detail: `返佣/拉新 ${formatNumber(referralRewardPoints)} / 邀请 ${formatNumber(inviteClickUsers)} / 签到 ${formatNumber(checkinSuccessUsers)}`,
            tone: rewardPoints > 0 || referralRewardPoints > 0 || checkinRewardPoints > 0
                ? 'warning'
                : 'neutral'
        }
    ];

    if (productOverviewInsight?.pulseItem) {
        items.splice(Math.min(4, items.length), 0, productOverviewInsight.pulseItem);
    }

    if (opsOverviewInsight?.pulseItem) {
        items.splice(Math.min(2, items.length), 0, opsOverviewInsight.pulseItem);
    }

    if (contentUserValueOverviewInsight?.pulseItem) {
        items.splice(Math.min(3, items.length), 0, contentUserValueOverviewInsight.pulseItem);
    }

    if (userValueOverviewInsight?.pulseItem) {
        items.splice(Math.min(4, items.length), 0, userValueOverviewInsight.pulseItem);
    }

    return items;
}

function buildAnalyticsAIActionCardsData(data = null, limit = 6) {
    const sourceData = getAnalyticsAISourceData(data);

    const deduped = [];
    const seen = new Set();
    const rawItems = collectAnalyticsActionRecommendations(sourceData)
        .filter((item) => item.destination || item.actionLabel || item.title)
        .sort((left, right) => getAnalyticsActionPriority(left.level) - getAnalyticsActionPriority(right.level));

    rawItems.forEach((item) => {
        const dedupeKey = [item.destination || '', item.actionLabel || '', item.title || ''].join('::');
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        deduped.push(item);
    });

    const normalizedItems = deduped.slice(0, limit).map((item) => {
        const destinationMeta = getAnalyticsDestinationMeta(item.destination, item.panel);
        const groupMeta = getAnalyticsActionGroupMeta(item.level);
        return {
            ...item,
            groupKey: groupMeta.key,
            groupTitle: groupMeta.title,
            groupDescription: groupMeta.description,
            icon: item.icon || destinationMeta.icon,
            ctaLabel: item.actionLabel || destinationMeta.ctaLabel,
            context: parseAnalyticsActionContext(item.context || item.destinationContext || null)
        };
    });

    const fallbackItems = normalizedItems.length > 0 ? normalizedItems : [{
        panel: '总览',
        tone: 'success',
        level: '继续观察',
        title: '回到经营总览',
        summary: '当前没有更高优先级的异常，可以继续查看内容消费、验证和激励链路的联动变化。',
        actionLabel: '查看总览',
        destination: 'analytics-overview',
        icon: 'fas fa-compass-drafting',
        ctaLabel: '打开经营总览',
        groupKey: 'observe',
        groupTitle: '持续观察',
        groupDescription: '作为经营驾驶舱观察项持续看趋势即可'
    }];

    const groups = ['urgent', 'followup', 'observe'].map((key) => {
        const items = fallbackItems.filter((item) => item.groupKey === key);
        if (!items.length) return null;

        return {
            key,
            title: items[0].groupTitle,
            description: items[0].groupDescription,
            items
        };
    }).filter(Boolean);

    return {
        items: fallbackItems,
        groups,
        pulseSummary: buildAnalyticsAIPulseSummaryData(sourceData)
    };
}

function renderAnalyticsAIPulseSummary(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }

    return `
        <section class="ai-pulse-board">
            <div class="ai-pulse-board__header">
                <div>
                    <p class="ai-pulse-board__eyebrow">经营快照</p>
                    <h4 class="ai-pulse-board__title">当前窗口最值得先看的关键指标</h4>
                </div>
            </div>
            <div class="ai-pulse-grid">
                ${items.map((item) => `
                    <article class="ai-pulse-card ai-pulse-card--${escapeHtml(item.tone || 'neutral')}">
                        <span class="ai-pulse-card__label">${escapeHtml(item.label || '指标')}</span>
                        <strong class="ai-pulse-card__value">${escapeHtml(item.value || '--')}</strong>
                        <span class="ai-pulse-card__detail">${escapeHtml(item.detail || '暂无补充说明')}</span>
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function renderAnalyticsAIActionCards(actionData = {}) {
    const groups = Array.isArray(actionData?.groups) ? actionData.groups : [];
    const flatItems = Array.isArray(actionData?.items) ? actionData.items : [];
    if (!groups.length && !flatItems.length) {
        return '';
    }

    return `
        <section class="ai-action-rail">
            <div class="ai-action-rail__header">
                <div>
                    <p class="ai-action-rail__eyebrow">建议动作</p>
                    <h4 class="ai-action-rail__title">按优先级排序的后台处理入口</h4>
                </div>
                <span class="ai-action-rail__meta">${flatItems.length} 个高相关入口</span>
            </div>
            <div class="ai-action-group-list">
                ${groups.map((group) => `
                    <section class="ai-action-group ai-action-group--${escapeHtml(group.key || 'observe')}">
                        <div class="ai-action-group__header">
                            <div>
                                <h5 class="ai-action-group__title">${escapeHtml(group.title || '建议动作')}</h5>
                                <p class="ai-action-group__desc">${escapeHtml(group.description || '建议进入对应模块继续处理')}</p>
                            </div>
                            <span class="ai-action-group__count">${group.items.length} 项</span>
                        </div>
                        <div class="ai-action-card-grid">
                            ${group.items.map((item) => `
                                <button
                                    type="button"
                                    class="ai-action-card"
                                    data-admin-action="analytics-open-destination"
                                    data-analytics-destination="${escapeHtml(item.destination || '')}"
                                    data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item.context || null))}"
                                >
                                    <div class="ai-action-card__top">
                                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone || 'neutral')}">${escapeHtml(item.level || '观察')}</span>
                                        <span class="ai-action-card__panel">${escapeHtml(item.panel || '总览')}</span>
                                    </div>
                                    <div class="ai-action-card__headline">
                                        <i class="${escapeHtml(item.icon || 'fas fa-arrow-right')}"></i>
                                        <strong>${escapeHtml(item.actionLabel || item.title || '打开模块')}</strong>
                                    </div>
                                    <div class="ai-action-card__summary">${escapeHtml(item.summary || '建议进入对应模块继续处理。')}</div>
                                    ${Array.isArray(item.sampleItems) && item.sampleItems.length ? `
                                        <div class="ai-action-card__samples">
                                            <span class="ai-action-card__sample-label">${escapeHtml(item.sampleLabel || '样本线索')}</span>
                                            <div class="ai-action-card__sample-list">
                                                ${item.sampleItems.slice(0, 3).map((sample) => `
                                                    <span class="ai-action-card__sample-pill">${escapeHtml(sample)}</span>
                                                `).join('')}
                                            </div>
                                        </div>
                                    ` : ''}
                                    <span class="ai-action-card__cta">${escapeHtml(item.ctaLabel || '打开对应模块')}<i class="fas fa-arrow-right"></i></span>
                                </button>
                            `).join('')}
                        </div>
                    </section>
                `).join('')}
            </div>
        </section>
    `;
}
