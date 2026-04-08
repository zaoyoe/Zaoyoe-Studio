// Shared analytics export builders.

function hasEventChannelBreakdownData(rows = []) {
    return (Array.isArray(rows) ? rows : []).some((row) => (
        row?.event_count !== undefined
        || row?.user_count !== undefined
        || row?.share_rate !== undefined
        || row?.source_kind !== undefined
    ));
}

function hasEventTopContentData(rows = []) {
    return (Array.isArray(rows) ? rows : []).some((row) => (
        row?.view_count !== undefined
        || row?.category !== undefined
    ));
}

function exportAsCSV(data) {
    let csv = '';
    const activeUserLabels = getAnalyticsActiveUserLabels();
    const newUsersLabels = getAnalyticsNewUsersLabels();

    csv += '=== 数据概览 ===\n';
    csv += `导出时间,${data.exportDate}\n`;
    csv += `日期范围,${data.dateRangeLabel || `${data.dateRange} 天`}\n`;
    if (data.overview) {
        csv += `${activeUserLabels.dauLabel},${data.overview.dau || 0}\n`;
        csv += `${activeUserLabels.mauLabel},${data.overview.mau || 0}\n`;
        csv += `登录日活参考,${data.overview.login_dau || 0}\n`;
        csv += `登录月活参考,${data.overview.login_mau || 0}\n`;
        csv += `${newUsersLabels.todayLabel},${data.overview.new_users_today || 0}\n`;
        csv += `${newUsersLabels.weekLabel},${data.overview.new_users_week || 0}\n`;
        csv += `今日已归因新增,${data.overview.site_attributed_new_users_today || 0}\n`;
        csv += `近 7 天待归因注册,${data.overview.unattributed_new_users_week || 0}\n`;
        csv += `积分流通总量,${data.overview.total_points || 0}\n`;
        csv += `总评论数,${data.overview.total_comments || 0}\n`;
    }
    csv += '\n';

    csv += '=== 指标口径 ===\n';
    csv += '板块,指标口径,类型,依据,说明\n';
    if (data.metricContextRows?.length > 0) {
        data.metricContextRows.forEach((row) => {
            csv += `${String(row['板块'] || '-').replace(/,/g, '，')},${String(row['指标口径'] || '-').replace(/,/g, '，')},${String(row['类型'] || '-').replace(/,/g, '，')},${String(row['依据'] || '-').replace(/,/g, '，')},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 经营主线 ===\n';
    csv += '指标,数值,说明\n';
    if (data.overviewBusinessMix?.exportRows?.length > 0) {
        data.overviewBusinessMix.exportRows.forEach((row) => {
            csv += `${row['指标'] || '-'},${row['数值'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 验证服务摘要 ===\n';
    csv += '指标,数值\n';
    if (data.verifyServiceSummary?.metrics) {
        csv += `请求总数,${data.verifyServiceSummary.metrics.requestCount || 0}\n`;
        csv += `成功数,${data.verifyServiceSummary.metrics.successCount || 0}\n`;
        csv += `处理中,${data.verifyServiceSummary.metrics.activeCount || 0}\n`;
        csv += `失败/阻塞,${data.verifyServiceSummary.metrics.failedCount || 0}\n`;
        csv += `成功率(%),${data.verifyServiceSummary.metrics.successRate || 0}\n`;
        csv += `积分消耗总计,${data.verifyServiceSummary.metrics.totalPointsCost || 0}\n`;
        csv += `单次成功平均成本,${data.verifyServiceSummary.metrics.avgPointsCostPerSuccess || 0}\n`;
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 验证关注任务 ===\n';
    csv += '验证单号,用户,站点,状态,时间,摘要\n';
    if (data.verifyServiceSummary?.focusRows?.length > 0) {
        data.verifyServiceSummary.focusRows.forEach((row) => {
            csv += `${row['验证单号'] || '-'},${String(row['用户'] || '').replace(/,/g, '，')},${row['站点'] || '-'},${row['状态'] || '-'},${row['时间'] || '-'},${String(row['摘要'] || '').replace(/,/g, '，')}\n`;
        });
    } else if (data.verifyServiceSummary?.recentRows?.length > 0) {
        data.verifyServiceSummary.recentRows.forEach((row) => {
            csv += `${row['验证单号'] || '-'},${String(row['用户'] || '').replace(/,/g, '，')},${row['站点'] || '-'},${row['状态'] || '-'},${row['时间'] || '-'},${String(row['摘要'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 验证事件转化 ===\n';
    csv += '阶段,用户数,事件数,比率(%),说明\n';
    if (data.verifyEventFunnel?.exportRows?.length > 0) {
        data.verifyEventFunnel.exportRows.forEach((row) => {
            csv += `${row['阶段'] || '-'},${row['用户数'] || 0},${row['事件数'] || 0},${row['比率(%)'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 社区与裂变 ===\n';
    csv += '指标,数值,说明\n';
    if (data.growthSummary?.exportRows?.length > 0) {
        data.growthSummary.exportRows.forEach((row) => {
            csv += `${row['指标'] || '-'},${row['数值'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 增长动作 ===\n';
    csv += '动作,用户数,事件数,覆盖率(%),说明\n';
    if (data.growthEventFunnel?.exportRows?.length > 0) {
        data.growthEventFunnel.exportRows.forEach((row) => {
            csv += `${row['动作'] || '-'},${row['用户数'] || 0},${row['事件数'] || 0},${row['覆盖率(%)'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 运营健康 ===\n';
    csv += '指标,数值,说明\n';
    if (data.operationsHealthSnapshot?.exportRows?.length > 0) {
        data.operationsHealthSnapshot.exportRows.forEach((row) => {
            csv += `${row['指标'] || '-'},${row['数值'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 经营异常 ===\n';
    csv += '板块,优先级,标题,核心指标,摘要,建议动作,跳转目标,样本线索\n';
    if (data.businessAnomalies?.length > 0) {
        data.businessAnomalies.forEach((row) => {
            csv += `${row['板块'] || '-'},${row['优先级'] || '-'},${String(row['标题'] || '').replace(/,/g, '，')},${String(row['核心指标'] || '').replace(/,/g, '，')},${String(row['摘要'] || '').replace(/,/g, '，')},${String(row['建议动作'] || '').replace(/,/g, '，')},${row['跳转目标'] || '-'},${String(row['样本线索'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 建议动作 ===\n';
    csv += '板块,优先级,标题,摘要,建议动作,跳转目标,样本线索\n';
    if (data.actionRecommendations?.length > 0) {
        data.actionRecommendations.forEach((row) => {
            csv += `${row['板块'] || '-'},${row['优先级'] || '-'},${String(row['标题'] || '').replace(/,/g, '，')},${String(row['摘要'] || '').replace(/,/g, '，')},${String(row['建议动作'] || '').replace(/,/g, '，')},${row['跳转目标'] || '-'},${String(row['样本线索'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += `=== 用户趋势 ===\n`;
    csv += `日期,${newUsersLabels.seriesLabel},${activeUserLabels.seriesLabel},登录活跃用户\n`;
    if (data.userTrend && data.userTrend.length > 0) {
        data.userTrend.forEach((row) => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.new_users || 0},${row.active_users || 0},${row.login_active_users || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 内容趋势 ===\n';
    csv += '日期,评论数,解锁数,点赞数\n';
    if (data.contentTrend && data.contentTrend.length > 0) {
        data.contentTrend.forEach((row) => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.comments || 0},${row.unlocks || 0},${row.likes || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 积分趋势 ===\n';
    csv += '日期,积分收入,积分支出,兑换次数\n';
    if (data.revenueTrend && data.revenueTrend.length > 0) {
        data.revenueTrend.forEach((row) => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.points_in || 0},${row.points_out || 0},${row.redemptions || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 社区互动 ===\n';
    csv += '日期,留言数,评论数,点赞数\n';
    if (data.communityStats && data.communityStats.length > 0) {
        data.communityStats.forEach((row) => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.messages || 0},${row.comments || 0},${row.likes || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 渠道分析 ===\n';
    const channelUsesEventSchema = hasEventChannelBreakdownData(data.channelBreakdown);
    csv += channelUsesEventSchema
        ? '渠道,事件数,覆盖用户,内容解锁,验证提交,充值成功,商城成交,占比(%),来源类型\n'
        : '渠道,批次数,总码数,已使用,总积分,使用率(%)\n';
    if (data.channelBreakdown && data.channelBreakdown.length > 0) {
        data.channelBreakdown.forEach((row) => {
            if (channelUsesEventSchema) {
                csv += `${row.channel || '未分类'},${row.event_count || 0},${row.user_count || 0},${row.unlock_success_count || 0},${row.verify_submit_count || 0},${row.recharge_success_count || 0},${row.shop_purchase_count || 0},${row.share_rate || 0},${row.source_kind || '业务入口'}\n`;
            } else {
                csv += `${row.channel || '未分类'},${row.batch_count || 0},${row.total_codes || 0},${row.used_codes || 0},${row.total_points || 0},${row.redemption_rate || 0}\n`;
            }
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 热门内容 Top 100 ===\n';
    const topContentUsesEventSchema = hasEventTopContentData(data.topContent);
    csv += topContentUsesEventSchema
        ? '排名,Prompt ID,标题,浏览数,解锁数,评论数,热度分,分类\n'
        : '排名,Prompt ID,标题,解锁数,评论数,热度分\n';
    if (data.topContent && data.topContent.length > 0) {
        data.topContent.forEach((row, index) => {
            const title = (row.title || '').replace(/,/g, '，');
            if (topContentUsesEventSchema) {
                csv += `${index + 1},${row.prompt_id || '-'},${title},${row.view_count || 0},${row.unlock_count || 0},${row.comment_count || 0},${row.score || 0},${(row.category || '未分类').replace(/,/g, '，')}\n`;
            } else {
                csv += `${index + 1},${row.prompt_id || '-'},${title},${row.unlock_count || 0},${row.comment_count || 0},${row.score || 0}\n`;
            }
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 交易事件转化 ===\n';
    csv += '阶段,用户数,事件数,比率(%),说明\n';
    if (data.commerceEventFunnel?.exportRows?.length > 0) {
        data.commerceEventFunnel.exportRows.forEach((row) => {
            csv += `${row['阶段'] || '-'},${row['用户数'] || 0},${row['事件数'] || 0},${row['比率(%)'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 积分分布 ===\n';
    csv += '持有区间,用户数\n';
    if (data.pointsDistribution && data.pointsDistribution.length > 0) {
        data.pointsDistribution.forEach((row) => {
            csv += `${row.range_label},${row.user_count}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 积分富豪榜 ===\n';
    csv += '排名,用户名,余额,总消费\n';
    if (data.pointsLeaderboard && data.pointsLeaderboard.length > 0) {
        data.pointsLeaderboard.forEach((row, index) => {
            csv += `${index + 1},${row.username || '匿名'},${row.balance},${row.total_spent}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    csv += '=== 兑换漏斗 ===\n';
    csv += '步骤,数量,转化率(%)\n';
    if (data.redemptionFunnel && data.redemptionFunnel.length > 0) {
        data.redemptionFunnel.forEach((row) => {
            csv += `${row.step},${row.count},${row.conversion_rate}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `analytics_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function exportAsExcel(data) {
    if (typeof XLSX === 'undefined') {
        alert('Excel 导出组件未加载，请刷新页面重试');
        return;
    }

    const wb = XLSX.utils.book_new();
    const activeUserLabels = getAnalyticsActiveUserLabels();
    const newUsersLabels = getAnalyticsNewUsersLabels();

    const overviewSheet = XLSX.utils.json_to_sheet([{
        '导出时间': data.exportDate,
        '日期范围': data.dateRangeLabel || `${data.dateRange} 天`,
        [activeUserLabels.dauLabel]: data.overview?.dau || 0,
        [activeUserLabels.mauLabel]: data.overview?.mau || 0,
        '登录日活参考': data.overview?.login_dau || 0,
        '登录月活参考': data.overview?.login_mau || 0,
        [newUsersLabels.todayLabel]: data.overview?.new_users_today || 0,
        [newUsersLabels.weekLabel]: data.overview?.new_users_week || 0,
        '今日已归因新增': data.overview?.site_attributed_new_users_today || 0,
        '近 7 天待归因注册': data.overview?.unattributed_new_users_week || 0,
        '积分流通总量': data.overview?.total_points || 0,
        '总评论数': data.overview?.total_comments || 0
    }]);
    XLSX.utils.book_append_sheet(wb, overviewSheet, '概览');

    if (data.metricContextRows?.length > 0) {
        const metricContextSheet = XLSX.utils.json_to_sheet(data.metricContextRows);
        XLSX.utils.book_append_sheet(wb, metricContextSheet, '指标口径');
    }

    if (data.overviewBusinessMix?.exportRows?.length > 0) {
        const mixSheet = XLSX.utils.json_to_sheet(data.overviewBusinessMix.exportRows);
        XLSX.utils.book_append_sheet(wb, mixSheet, '经营主线');
    }

    if (data.verifyServiceSummary?.metrics) {
        const verifySummarySheet = XLSX.utils.json_to_sheet([{
            '请求总数': data.verifyServiceSummary.metrics.requestCount || 0,
            '成功数': data.verifyServiceSummary.metrics.successCount || 0,
            '处理中': data.verifyServiceSummary.metrics.activeCount || 0,
            '失败/阻塞': data.verifyServiceSummary.metrics.failedCount || 0,
            '其他状态': data.verifyServiceSummary.metrics.otherCount || 0,
            '成功率(%)': data.verifyServiceSummary.metrics.successRate || 0,
            '积分消耗总计': data.verifyServiceSummary.metrics.totalPointsCost || 0,
            '单次成功平均成本': data.verifyServiceSummary.metrics.avgPointsCostPerSuccess || 0
        }]);
        XLSX.utils.book_append_sheet(wb, verifySummarySheet, '验证摘要');
    }

    if (data.verifyServiceSummary?.focusRows?.length > 0 || data.verifyServiceSummary?.recentRows?.length > 0) {
        const verifyFocusRows = data.verifyServiceSummary.focusRows?.length > 0
            ? data.verifyServiceSummary.focusRows
            : data.verifyServiceSummary.recentRows;
        const verifyFocusSheet = XLSX.utils.json_to_sheet(verifyFocusRows);
        XLSX.utils.book_append_sheet(wb, verifyFocusSheet, '验证关注');
    }

    if (data.verifyEventFunnel?.exportRows?.length > 0) {
        const verifyEventSheet = XLSX.utils.json_to_sheet(data.verifyEventFunnel.exportRows);
        XLSX.utils.book_append_sheet(wb, verifyEventSheet, '验证转化');
    }

    if (data.growthSummary?.exportRows?.length > 0) {
        const growthSheet = XLSX.utils.json_to_sheet(data.growthSummary.exportRows);
        XLSX.utils.book_append_sheet(wb, growthSheet, '社区裂变');
    }

    if (data.growthEventFunnel?.exportRows?.length > 0) {
        const growthEventSheet = XLSX.utils.json_to_sheet(data.growthEventFunnel.exportRows);
        XLSX.utils.book_append_sheet(wb, growthEventSheet, '增长动作');
    }

    if (data.operationsHealthSnapshot?.exportRows?.length > 0) {
        const operationsSheet = XLSX.utils.json_to_sheet(data.operationsHealthSnapshot.exportRows);
        XLSX.utils.book_append_sheet(wb, operationsSheet, '运营健康');
    }

    if (data.businessAnomalies?.length > 0) {
        const anomalySheet = XLSX.utils.json_to_sheet(data.businessAnomalies);
        XLSX.utils.book_append_sheet(wb, anomalySheet, '经营异常');
    }

    if (data.actionRecommendations?.length > 0) {
        const recommendationSheet = XLSX.utils.json_to_sheet(data.actionRecommendations);
        XLSX.utils.book_append_sheet(wb, recommendationSheet, '建议动作');
    }

    if (data.userTrend && data.userTrend.length > 0) {
        const trendSheet = XLSX.utils.json_to_sheet(data.userTrend.map((row) => ({
            '日期': row.stat_date || row.date || '-',
            [newUsersLabels.seriesLabel]: row.new_users || 0,
            [activeUserLabels.seriesLabel]: row.active_users || 0,
            '登录活跃用户': row.login_active_users || 0
        })));
        XLSX.utils.book_append_sheet(wb, trendSheet, '用户趋势');
    }

    if (data.contentTrend && data.contentTrend.length > 0) {
        const contentSheet = XLSX.utils.json_to_sheet(data.contentTrend.map((row) => ({
            '日期': row.stat_date || row.date || '-',
            '评论数': row.comments || 0,
            '解锁数': row.unlocks || 0,
            '点赞数': row.likes || 0
        })));
        XLSX.utils.book_append_sheet(wb, contentSheet, '内容趋势');
    }

    if (data.revenueTrend && data.revenueTrend.length > 0) {
        const revenueSheet = XLSX.utils.json_to_sheet(data.revenueTrend.map((row) => ({
            '日期': row.stat_date || row.date || '-',
            '积分收入': row.points_in || 0,
            '积分支出': row.points_out || 0,
            '兑换次数': row.redemptions || 0
        })));
        XLSX.utils.book_append_sheet(wb, revenueSheet, '积分趋势');
    }

    if (data.communityStats && data.communityStats.length > 0) {
        const communitySheet = XLSX.utils.json_to_sheet(data.communityStats.map((row) => ({
            '日期': row.stat_date || row.date || '-',
            '留言数': row.messages || 0,
            '评论数': row.comments || 0,
            '点赞数': row.likes || 0
        })));
        XLSX.utils.book_append_sheet(wb, communitySheet, '社区互动');
    }

    if (data.channelBreakdown && data.channelBreakdown.length > 0) {
        const channelSheet = XLSX.utils.json_to_sheet(data.channelBreakdown.map((row) => (
            hasEventChannelBreakdownData(data.channelBreakdown)
                ? {
                    '渠道': row.channel || '未分类',
                    '事件数': row.event_count || 0,
                    '覆盖用户': row.user_count || 0,
                    '内容解锁': row.unlock_success_count || 0,
                    '验证提交': row.verify_submit_count || 0,
                    '充值成功': row.recharge_success_count || 0,
                    '商城成交': row.shop_purchase_count || 0,
                    '占比(%)': row.share_rate || 0,
                    '来源类型': row.source_kind || '业务入口'
                }
                : {
                    '渠道': row.channel || '未分类',
                    '批次数': row.batch_count || 0,
                    '总码数': row.total_codes || 0,
                    '已使用': row.used_codes || 0,
                    '总积分': row.total_points || 0,
                    '使用率(%)': row.redemption_rate || 0
                }
        )));
        XLSX.utils.book_append_sheet(wb, channelSheet, '渠道分析');
    }

    if (data.topContent && data.topContent.length > 0) {
        const topSheet = XLSX.utils.json_to_sheet(data.topContent.map((row, index) => (
            hasEventTopContentData(data.topContent)
                ? {
                    '排名': index + 1,
                    'Prompt ID': row.prompt_id || '-',
                    '标题': row.title || '',
                    '浏览数': row.view_count || 0,
                    '解锁数': row.unlock_count || 0,
                    '评论数': row.comment_count || 0,
                    '热度分': row.score || 0,
                    '分类': row.category || '未分类'
                }
                : {
                    '排名': index + 1,
                    'Prompt ID': row.prompt_id || '-',
                    '标题': row.title || '',
                    '解锁数': row.unlock_count || 0,
                    '评论数': row.comment_count || 0,
                    '热度分': row.score || 0
                }
        )));
        XLSX.utils.book_append_sheet(wb, topSheet, '热门内容');
    }

    if (data.commerceEventFunnel?.exportRows?.length > 0) {
        const commerceEventSheet = XLSX.utils.json_to_sheet(data.commerceEventFunnel.exportRows);
        XLSX.utils.book_append_sheet(wb, commerceEventSheet, '交易事件');
    }

    if (data.pointsDistribution && data.pointsDistribution.length > 0) {
        const distSheet = XLSX.utils.json_to_sheet(data.pointsDistribution.map((row) => ({
            '持有区间': row.range_label,
            '用户数': row.user_count
        })));
        XLSX.utils.book_append_sheet(wb, distSheet, '积分分布');
    }

    if (data.pointsLeaderboard && data.pointsLeaderboard.length > 0) {
        const leadSheet = XLSX.utils.json_to_sheet(data.pointsLeaderboard.map((row, index) => ({
            '排名': index + 1,
            '用户名': row.username || '匿名',
            '积分余额': row.balance,
            '总消费': row.total_spent
        })));
        XLSX.utils.book_append_sheet(wb, leadSheet, '积分富豪榜');
    }

    if (data.redemptionFunnel && data.redemptionFunnel.length > 0) {
        const funnelSheet = XLSX.utils.json_to_sheet(data.redemptionFunnel.map((row) => ({
            '步骤': row.step,
            '数量': row.count,
            '转化率(%)': row.conversion_rate
        })));
        XLSX.utils.book_append_sheet(wb, funnelSheet, '兑换漏斗');
    }

    XLSX.writeFile(wb, `analytics_${new Date().toISOString().split('T')[0]}.xlsx`);
}

window.exportAsCSV = exportAsCSV;
window.exportAsExcel = exportAsExcel;
window.AdminAnalyticsExportBuilders = Object.assign({}, window.AdminAnalyticsExportBuilders || {}, {
    hasEventChannelBreakdownData,
    hasEventTopContentData,
    exportAsCSV,
    exportAsExcel
});
