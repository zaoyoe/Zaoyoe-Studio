/**
 * Admin Analytics Module
 * Data visualization dashboard for Admin Studio
 */

// Helper: Get site param for analytics RPC calls
function getAnalyticsSiteParam() {
    if (window.AdminSiteFilter) {
        const site = AdminSiteFilter.getSiteParam();
        return site; // null for 'all', 'cn' or 'intl'
    }
    return null;
}

// Chart instances
let userTrendChart = null;
let channelChart = null;
let contentTrendChart = null;
let communityChart = null;
let pointsDistributionChart = null;
let redemptionFunnelChart = null;

// AI Insight cache and debounce
let aiInsightCache = null;
let aiInsightCacheTime = 0;
const AI_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let aiInsightDebounce = false;

function hasAdminAI() {
    return Boolean(window.AdminAI?.configured);
}

function normalizeAnalyticsNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function averageAnalyticsValues(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function buildLocalAnalyticsInsight(data) {
    const overview = data?.overview || {};
    const dau = normalizeAnalyticsNumber(overview.dau);
    const mau = normalizeAnalyticsNumber(overview.mau);
    const newUsers = normalizeAnalyticsNumber(overview.new_users_week);
    const totalPoints = normalizeAnalyticsNumber(overview.total_points);
    const totalComments = normalizeAnalyticsNumber(overview.total_comments);
    const dauMauRatio = mau > 0 ? (dau / mau) * 100 : 0;

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
        highlights.push(`- DAU/MAU 约 ${dauMauRatio.toFixed(1)}%，近期活跃度表现稳健。`);
    } else if (dau > 0 || mau > 0) {
        highlights.push(`- 当前 DAU ${dau}、MAU ${mau}，活跃基础仍在持续累积。`);
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
    if (!highlights.length) {
        highlights.push('- 当前统计样本较少，建议继续观察近 7 天的真实行为数据。');
    }

    const risks = [];
    if (mau > 0 && dauMauRatio < 12) {
        risks.push('- DAU/MAU 偏低，短期活跃留存还有提升空间。');
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
    if (totalPoints > 0) {
        suggestions.push('- 联动积分消费与内容解锁活动，提升积分流通和转化。');
    } else {
        suggestions.push('- 先补齐积分或互动活动数据，后续 AI 分析会更稳定。');
    }

    return [
        '1. 数据亮点',
        ...highlights.slice(0, 3),
        '',
        '2. 潜在风险',
        ...risks.slice(0, 2),
        '',
        '3. 运营建议',
        ...suggestions.slice(0, 3)
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

// Chart theme colors
const chartColors = {
    primary: '#6b9ece',
    secondary: '#8b5cf6',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    gradientStart: 'rgba(107, 158, 206, 0.3)',
    gradientEnd: 'rgba(107, 158, 206, 0.0)'
};

// Get theme-aware colors
function getChartTheme() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    return {
        text: isDark ? '#e2e8f0' : '#1e293b',
        grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        background: isDark ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.9)'
    };
}

// Initialize Analytics Module
async function initAnalyticsModule() {
    console.log('[Analytics] Initializing...');

    // Initialize tab indicator
    initAnalyticsTabIndicator();

    try {
        // Load KPI data
        await loadOverviewStats();

        // Load charts
        await loadUserTrendChart(30);
        await loadChannelChart();
        await loadContentTrendChart(30);
        await loadTopContent();

        // Load advanced charts
        await loadActivityHeatmap();
        await loadTopContributors();
        await loadCommunityChart(30);

        // Load Phase 10 deep analytics (non-blocking)
        loadConversionFunnel();
        loadRetentionCohort();
        loadPointsFlow();

        // Load Phase 11, 14 (non-blocking)
        loadGeoDistribution();
        loadExperimentsList();

        // Initialize Phase 13 tracking SDK
        TrackingSDK.init();

        // Load Points Analytics (Phase 2)
        loadPointsStats();
        loadPointsDistribution();
        loadPointsLeaderboard();
        loadRedemptionFunnel();

        // Setup event listeners
        setupAnalyticsEvents();

        // Setup Realtime subscriptions
        setupRealtimeSubscriptions();

        console.log('[Analytics] Initialized successfully');
    } catch (err) {
        console.error('[Analytics] Init error:', err);
    }
}

// Setup Supabase Realtime subscriptions for live updates
function setupRealtimeSubscriptions() {
    try {
        // Subscribe to new user registrations
        supabaseClient.channel('analytics-users')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'profiles' },
                () => {
                    console.log('[Analytics] New user detected');
                    animateKPIIncrement('kpiMauValue');
                    animateKPIIncrement('kpiNewUsersValue');
                }
            )
            .subscribe();

        // Subscribe to new comments
        supabaseClient.channel('analytics-comments')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'prompt_comments' },
                () => {
                    console.log('[Analytics] New comment detected');
                    animateKPIIncrement('kpiCommentsValue');
                }
            )
            .subscribe();

        console.log('[Analytics] Realtime subscriptions active');
    } catch (err) {
        console.error('[Analytics] Realtime subscription error:', err);
    }
}

// Animate KPI increment with pulse effect
function animateKPIIncrement(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Get current value and increment
    const currentText = el.textContent;
    const currentNum = parseFloat(currentText.replace(/[^\d.]/g, '')) || 0;
    const suffix = currentText.match(/[a-zA-Z]+$/)?.[0] || '';

    // Add pulse animation
    el.classList.add('kpi-pulse');

    // Update value with animation
    if (suffix === 'w') {
        el.textContent = ((currentNum * 10000 + 1) / 10000).toFixed(1) + 'w';
    } else if (suffix === 'k') {
        el.textContent = ((currentNum * 1000 + 1) / 1000).toFixed(1) + 'k';
    } else {
        el.textContent = Math.round(currentNum + 1).toString();
    }

    // Remove animation class after transition
    setTimeout(() => {
        el.classList.remove('kpi-pulse');
    }, 600);
}

// Load Overview Statistics with Trend
async function loadOverviewStats() {
    try {
        // Try new trend function first, fallback to basic
        let data, error;
        const siteParam = getAnalyticsSiteParam();
        ({ data, error } = await supabaseClient.rpc('get_overview_stats_with_trend', { p_site: siteParam }));

        if (error) {
            // Fallback to basic stats
            ({ data, error } = await supabaseClient.rpc('get_overview_stats', { p_site: siteParam }));
            if (error) throw error;
        }

        // Update KPI cards with values
        document.getElementById('kpiDauValue').textContent = formatNumber(data.dau);
        document.getElementById('kpiMauValue').textContent = formatNumber(data.mau);
        document.getElementById('kpiNewUsersValue').textContent = formatNumber(data.new_users_week);
        document.getElementById('kpiPointsValue').textContent = formatNumber(data.total_points);
        document.getElementById('kpiCommentsValue').textContent = formatNumber(data.total_comments);

        // Add trend arrows if available
        if (data.dau_growth !== undefined) {
            updateTrendArrow('kpiDauTrend', data.dau_growth);
        }
        if (data.new_users_growth !== undefined) {
            updateTrendArrow('kpiNewUsersTrend', data.new_users_growth);
        }
        if (data.comments_growth !== undefined) {
            updateTrendArrow('kpiCommentsTrend', data.comments_growth);
        }

    } catch (err) {
        console.error('[Analytics] Failed to load overview:', err);
    }
}

// Helper: Update trend arrow
function updateTrendArrow(elementId, growthRate) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (growthRate === 0 || growthRate === null) {
        el.innerHTML = '<span class="trend-neutral">—</span>';
    } else if (growthRate > 0) {
        el.innerHTML = `<span class="trend-up">↑ ${Math.abs(growthRate)}%</span>`;
    } else {
        el.innerHTML = `<span class="trend-down">↓ ${Math.abs(growthRate)}%</span>`;
    }
}

// Load User Trend Chart
async function loadUserTrendChart(days = 30) {
    try {
        const { data, error } = await supabaseClient.rpc('get_user_trend', { p_days: days, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const ctx = document.getElementById('userTrendChart');
        if (!ctx) return;

        const theme = getChartTheme();

        // Create gradient
        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, chartColors.gradientStart);
        gradient.addColorStop(1, chartColors.gradientEnd);

        // Destroy existing chart
        if (userTrendChart) {
            userTrendChart.destroy();
        }

        userTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '活跃用户',
                        data: data.map(d => d.active_users),
                        borderColor: chartColors.primary,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: '新增用户',
                        data: data.map(d => d.new_users),
                        borderColor: chartColors.success,
                        backgroundColor: 'transparent',
                        borderDash: [5, 5],
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load user trend:', err);
    }
}

// Load Channel Distribution Chart
async function loadChannelChart() {
    try {
        const { data, error } = await supabaseClient.rpc('get_channel_breakdown', { p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const ctx = document.getElementById('channelChart');
        if (!ctx) return;

        // Check for empty data
        if (!data || data.length === 0 || data.every(d => !d.total_points)) {
            ctx.parentElement.innerHTML = `
                <div class="empty-state-hint">
                    <i class="fas fa-info-circle"></i>
                    <span>暂无渠道核销数据</span>
                </div>
            `;
            return;
        }

        const theme = getChartTheme();
        const colors = [chartColors.primary, chartColors.secondary, chartColors.success, chartColors.warning, chartColors.danger];

        // Destroy existing chart
        if (channelChart) {
            channelChart.destroy();
        }

        channelChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.channel || '未分类'),
                datasets: [{
                    data: data.map(d => d.total_points || 0),
                    backgroundColor: colors.slice(0, data.length),
                    borderWidth: 2,
                    borderColor: theme.background
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: theme.text }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const rate = data[context.dataIndex]?.redemption_rate || 0;
                                return `${label}: ${formatNumber(value)} 积分 (${rate}% 核销)`;
                            }
                        }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load channel chart:', err);
    }
}

// Load Content Trend Chart
async function loadContentTrendChart(days = 30) {
    try {
        const { data, error } = await supabaseClient.rpc('get_content_trend', { p_days: days, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const ctx = document.getElementById('contentTrendChart');
        if (!ctx) return;

        const theme = getChartTheme();

        // Destroy existing chart
        if (contentTrendChart) {
            contentTrendChart.destroy();
        }

        contentTrendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '评论',
                        data: data.map(d => d.comments),
                        backgroundColor: chartColors.primary,
                        borderRadius: 4
                    },
                    {
                        label: '解锁',
                        data: data.map(d => d.unlocks),
                        backgroundColor: chartColors.secondary,
                        borderRadius: 4
                    },
                    {
                        label: '点赞',
                        data: data.map(d => d.likes),
                        backgroundColor: chartColors.success,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: theme.text }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load content trend:', err);
    }
}

// Load Top Content
async function loadTopContent() {
    try {
        const { data, error } = await supabaseClient.rpc('get_content_top', { p_limit: 10, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('topContentList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无数据</div>';
            return;
        }

        container.innerHTML = data.map((item, index) => `
            <div class="top-content-item">
                <span class="rank rank-${index + 1}">${index + 1}</span>
                <span class="title" title="${item.title || '无标题'}">${truncate(item.title || '无标题', 25)}</span>
                <span class="stats">
                    <span class="unlock"><i class="fas fa-unlock"></i> ${item.unlock_count}</span>
                    <span class="comment"><i class="fas fa-comment"></i> ${item.comment_count}</span>
                </span>
                <button class="btn-view-context" type="button" data-admin-action="analytics-view-context" data-prompt-id="${item.prompt_id}" title="查看上下文">
                    <i class="fas fa-external-link-alt"></i>
                </button>
            </div>
        `).join('');

    } catch (err) {
        console.error('[Analytics] Failed to load top content:', err);
        const container = document.getElementById('topContentList');
        if (container) {
            container.innerHTML = '<div class="error-state">加载失败</div>';
        }
    }
}

// Setup Event Listeners
function setupAnalyticsEvents() {
    // Period selector for user trend
    document.querySelectorAll('.chart-period-selector .period-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
            const days = parseInt(this.dataset.days);

            // Update active state
            document.querySelectorAll('.chart-period-selector .period-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // Reload chart
            await loadUserTrendChart(days);
        });
    });

    // AI Insight button
    const insightBtn = document.getElementById('generateInsightBtn');
    if (insightBtn) {
        insightBtn.addEventListener('click', generateAIInsight);
    }
}

// Generate AI Insight
async function generateAIInsight() {
    const btn = document.getElementById('generateInsightBtn');
    const content = document.getElementById('aiInsightContent');
    let aiSummaryData = null;

    if (!btn || !content) return;

    // Debounce check - prevent rapid clicks
    if (aiInsightDebounce) {
        content.innerHTML = '<p class="ai-error">请稍候再试（5秒内只能请求一次）</p>';
        return;
    }

    // Cache check - reuse recent results
    const now = Date.now();
    if (aiInsightCache && (now - aiInsightCacheTime) < AI_CACHE_DURATION) {
        content.innerHTML = `<div class="ai-report">${formatAIResponse(aiInsightCache)}</div>
            <p class="ai-cache-hint">📋 缓存结果 (${Math.round((AI_CACHE_DURATION - (now - aiInsightCacheTime)) / 60000)} 分钟后刷新)</p>`;
        return;
    }

    // Check for API key (use same format as admin-studio.js)
    if (!hasAdminAI()) {
        try {
            await window.AdminAI?.checkHealth?.();
        } catch (err) {
            console.warn('[Analytics] AI proxy health check failed:', err);
        }
    }

    if (!hasAdminAI()) {
        content.innerHTML = '<p class="ai-error">请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key</p>';
        return;
    }

    // Set debounce
    aiInsightDebounce = true;
    setTimeout(() => { aiInsightDebounce = false; }, 5000);

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 分析中...';
    content.innerHTML = '<p class="ai-loading">AI 正在分析数据...</p>';

    try {
        // Get summary data
        const { data, error } = await supabaseClient.rpc('get_ai_summary_data', { p_days: 7, p_site: getAnalyticsSiteParam() });

        if (error) throw error;
        if (!data || !data.overview) throw new Error('数据获取失败');
        aiSummaryData = data;

        console.log('[Analytics] AI Summary Data:', data);

        // Safely extract values with defaults
        const overview = data.overview || {};
        const dau = overview.dau ?? 0;
        const mau = overview.mau ?? 0;
        const newUsers = overview.new_users_week ?? 0;
        const totalPoints = overview.total_points ?? 0;
        const totalComments = overview.total_comments ?? 0;

        // Call Gemini API
        const prompt = `你是一位专业的数据分析师。请基于以下平台数据，生成一份简洁的运营洞察报告（使用中文）：

数据概览：
- DAU: ${dau}
- MAU: ${mau}  
- 本周新增用户: ${newUsers}
- 积分流通总量: ${totalPoints}
- 总评论数: ${totalComments}

用户趋势（近7天）：
${JSON.stringify(data.user_trend || [], null, 2)}

渠道表现：
${JSON.stringify(data.channel_breakdown || [], null, 2)}

请输出：
1. 数据亮点（2-3条）
2. 潜在风险（1-2条）
3. 运营建议（2-3条）

请用简洁的要点形式，每条不超过一行。`;

        const text = await window.AdminAI.generateText(prompt, {
            model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024
            }
        });

        // Cache the result
        aiInsightCache = text || '分析失败，请重试';
        aiInsightCacheTime = Date.now();

        // Format and display
        content.innerHTML = `<div class="ai-report">${formatAIResponse(aiInsightCache)}</div>`;

    } catch (err) {
        console.error('[Analytics] AI insight error:', err);
        if (isGeminiQuotaError(err)) {
            aiInsightCache = buildLocalAnalyticsInsight(aiSummaryData || {});
            aiInsightCacheTime = Date.now();
            content.innerHTML = `<div class="ai-report">${formatAIResponse(aiInsightCache)}</div>${buildQuotaFallbackHint('已切换为本地规则洞察')}`;
        } else {
            const errMsg = err.message || (err.details ? err.details : '未知错误');
            content.innerHTML = `<p class="ai-error">分析失败：${errMsg}</p>`;
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> 生成分析';
    }
}

// Helper: Format AI Response
function formatAIResponse(text) {
    const escaped = escapeHtml(text || '');
    return escaped
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>')
        .replace(/^(\d+)\./gm, '<span class="ai-number">$1.</span>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper: Format Number
function formatNumber(num) {
    const value = toNumericValue(num);
    if (value === null) return '--';

    const absValue = Math.abs(value);
    if (absValue >= 10000) {
        return trimTrailingZeros((value / 10000).toFixed(1)) + 'w';
    }
    if (absValue >= 1000) {
        return trimTrailingZeros((value / 1000).toFixed(1)) + 'k';
    }
    if (!Number.isInteger(value)) {
        return trimTrailingZeros(value.toFixed(1));
    }
    return value.toString();
}

// Helper: Format Date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Helper: Truncate Text
function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
}

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

function formatPercent(value) {
    const numericValue = toNumericValue(value);
    if (numericValue === null) return '--';
    return `${trimTrailingZeros(numericValue.toFixed(2))}%`;
}

function renderHintState(iconClass, message, variant = 'empty') {
    const className = variant === 'error' ? 'error-state' : 'empty-state-hint';
    return `<div class="${className}">
        <i class="${iconClass}"></i>
        <span>${message}</span>
    </div>`;
}

function getPointsFlowIncomeLabel(reason = '') {
    if (/兑换码|redeem/i.test(reason)) return '兑换码';
    if (/充值|recharge|purchase|top-?up/i.test(reason)) return '充值';
    if (/奖励|reward|bonus|签到|check-?in|返佣|commission|拉新|signup/i.test(reason)) return '系统奖励';
    return '其他收入';
}

function getPointsFlowExpenseLabel(reason = '') {
    if (/解锁|unlock|consume|download|generate/i.test(reason)) return '内容解锁';
    if (/扣除|deduct|admin/i.test(reason)) return '管理扣除';
    return '其他消费';
}

function buildPointsFlowFromLedger(rows = []) {
    const incomes = new Map();
    const outflows = new Map();

    rows.forEach((row) => {
        const amount = toNumericValue(row.amount);
        if (amount === null || amount === 0) return;

        const reason = String(row.reason || '');
        const absAmount = Math.abs(amount);

        if (amount > 0) {
            const label = getPointsFlowIncomeLabel(reason);
            incomes.set(label, (incomes.get(label) || 0) + absAmount);
        } else {
            const label = getPointsFlowExpenseLabel(reason);
            outflows.set(label, (outflows.get(label) || 0) + absAmount);
        }
    });

    const data = [];

    incomes.forEach((value, label) => {
        data.push({
            source_node: label,
            target_node: '用户余额',
            value: roundTo(value, 1) || 0
        });
    });

    outflows.forEach((value, label) => {
        data.push({
            source_node: '用户余额',
            target_node: label,
            value: roundTo(value, 1) || 0
        });
    });

    return data.sort((a, b) => (toNumericValue(b.value) || 0) - (toNumericValue(a.value) || 0));
}

function sumPointsFlow(items = [], direction = 'in') {
    return roundTo(items.reduce((sum, item) => {
        const value = toNumericValue(item.value) || 0;

        if (direction === 'in' && item.target_node === '用户余额') {
            return sum + value;
        }

        if (direction === 'out' && item.source_node === '用户余额') {
            return sum + value;
        }

        return sum;
    }, 0), 1) || 0;
}

async function fetchPointsHealthData() {
    try {
        const { data, error } = await supabaseClient.rpc('get_points_health', { p_site: getAnalyticsSiteParam() });
        if (error) throw error;
        if (data && typeof data === 'object') return data;
    } catch (err) {
        console.warn('[Analytics] get_points_health RPC failed, falling back to direct queries:', err);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let balanceQuery = supabaseClient.from('points_balance').select('user_id,total_balance');
    balanceQuery = window.AdminSiteFilter?.applySiteFilter(balanceQuery) || balanceQuery;

    let ledgerQuery = supabaseClient
        .from('points_ledger')
        .select('user_id,amount,created_at')
        .lt('amount', 0)
        .gte('created_at', thirtyDaysAgo.toISOString());
    ledgerQuery = window.AdminSiteFilter?.applySiteFilter(ledgerQuery) || ledgerQuery;

    const [{ data: balanceRows, error: balanceError }, { data: spendRows, error: spendError }] = await Promise.all([
        balanceQuery,
        ledgerQuery
    ]);

    if (balanceError) throw balanceError;
    if (spendError) throw spendError;

    let totalCirculation = 0;
    let activeHolders = 0;

    (balanceRows || []).forEach((row) => {
        const balance = toNumericValue(row.total_balance) || 0;
        totalCirculation += balance;
        if (balance > 0) activeHolders += 1;
    });

    let monthlySpend = 0;
    const recentSpenders = new Set();

    (spendRows || []).forEach((row) => {
        const amount = toNumericValue(row.amount);
        if (amount === null || amount >= 0) return;

        monthlySpend += Math.abs(amount);
        if (row.user_id) recentSpenders.add(row.user_id);
    });

    const hoardingUsers = Math.max(activeHolders - recentSpenders.size, 0);
    const velocity = totalCirculation > 0 ? roundTo((monthlySpend / totalCirculation) * 100, 2) : 0;
    const hoardingRate = activeHolders > 0 ? roundTo((hoardingUsers / activeHolders) * 100, 2) : 0;

    return {
        total_circulation: roundTo(totalCirculation, 1) || 0,
        monthly_spend: roundTo(monthlySpend, 1) || 0,
        velocity: velocity || 0,
        hoarding_rate: hoardingRate || 0,
        active_holders: activeHolders,
        hoarding_users: hoardingUsers
    };
}

async function fetchPointsFlowData(days = 30) {
    try {
        const { data, error } = await supabaseClient.rpc('get_points_flow', {
            p_days: days,
            p_site: getAnalyticsSiteParam()
        });

        if (error) throw error;
        if (Array.isArray(data)) {
            return data.map((item) => ({
                ...item,
                value: roundTo(item.value, 1) || 0
            }));
        }
    } catch (err) {
        console.warn('[Analytics] get_points_flow RPC failed, falling back to direct ledger query:', err);
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = supabaseClient
        .from('points_ledger')
        .select('amount,reason,created_at')
        .gte('created_at', startDate.toISOString());
    query = window.AdminSiteFilter?.applySiteFilter(query) || query;

    const { data, error } = await query;
    if (error) throw error;

    return buildPointsFlowFromLedger(data || []);
}

async function fetchPointsLeaderboardData(limit = 10) {
    try {
        const { data, error } = await supabaseClient.rpc('get_points_leaderboard', {
            p_limit: limit,
            p_site: getAnalyticsSiteParam()
        });

        if (error) throw error;
        if (Array.isArray(data)) {
            return data.map((row) => ({
                ...row,
                balance: roundTo(row.balance, 1) || 0,
                total_spent: roundTo(row.total_spent, 1) || 0
            }));
        }
    } catch (err) {
        console.warn('[Analytics] get_points_leaderboard RPC failed, falling back to direct queries:', err);
    }

    let balanceQuery = supabaseClient.from('points_balance').select('user_id,total_balance');
    balanceQuery = window.AdminSiteFilter?.applySiteFilter(balanceQuery) || balanceQuery;

    const { data: balanceRows, error: balanceError } = await balanceQuery;
    if (balanceError) throw balanceError;

    const balanceByUser = new Map();
    (balanceRows || []).forEach((row) => {
        if (!row.user_id) return;
        const amount = toNumericValue(row.total_balance) || 0;
        balanceByUser.set(row.user_id, (balanceByUser.get(row.user_id) || 0) + amount);
    });

    const topUsers = Array.from(balanceByUser.entries())
        .map(([user_id, balance]) => ({ user_id, balance: roundTo(balance, 1) || 0 }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, limit);

    if (topUsers.length === 0) return [];

    const userIds = topUsers.map((row) => row.user_id);

    const [{ data: profiles, error: profileError }, { data: spentRows, error: spentError }] = await Promise.all([
        supabaseClient.from('profiles').select('id,username,avatar_url').in('id', userIds),
        (() => {
            let query = supabaseClient
                .from('points_ledger')
                .select('user_id,amount')
                .in('user_id', userIds)
                .lt('amount', 0);
            query = window.AdminSiteFilter?.applySiteFilter(query) || query;
            return query;
        })()
    ]);

    if (profileError) throw profileError;
    if (spentError) throw spentError;

    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const spentByUser = new Map();

    (spentRows || []).forEach((row) => {
        const amount = Math.abs(toNumericValue(row.amount) || 0);
        spentByUser.set(row.user_id, (spentByUser.get(row.user_id) || 0) + amount);
    });

    return topUsers.map((row) => {
        const profile = profileMap.get(row.user_id) || {};

        return {
            user_id: row.user_id,
            username: profile.username || '匿名用户',
            avatar_url: profile.avatar_url || '',
            balance: row.balance,
            total_spent: roundTo(spentByUser.get(row.user_id) || 0, 1) || 0
        };
    });
}

// Export for global access
// ============================================
// POINTS ANALYTICS (PHASE 2)
// ============================================

// Load Points Health Stats
async function loadPointsStats() {
    try {
        const [data, weeklyFlow] = await Promise.all([
            fetchPointsHealthData(),
            fetchPointsFlowData(7)
        ]);

        const totalCirculation = toNumericValue(data?.total_circulation);
        const weeklyIncome = toNumericValue(data?.weekly_income) ?? sumPointsFlow(weeklyFlow, 'in');
        const weeklySpend = toNumericValue(data?.weekly_spend) ?? sumPointsFlow(weeklyFlow, 'out');

        const circulationEl = document.getElementById('kpiPointsValue');
        if (circulationEl && totalCirculation !== null) {
            circulationEl.textContent = formatNumber(totalCirculation);
        }

        const incomeEl = document.getElementById('kpiPointsInValue');
        if (incomeEl) {
            incomeEl.textContent = formatNumber(weeklyIncome);
        }

        const spendEl = document.getElementById('kpiPointsOutValue');
        if (spendEl) {
            spendEl.textContent = formatNumber(weeklySpend);
        }

        const velocityEl = document.getElementById('kpiPointsVelocityValue');
        if (velocityEl) {
            velocityEl.textContent = formatPercent(data?.velocity || 0);
        }

    } catch (err) {
        console.error('[Analytics] Failed to load points health:', err);

        const incomeEl = document.getElementById('kpiPointsInValue');
        const spendEl = document.getElementById('kpiPointsOutValue');
        const velocityEl = document.getElementById('kpiPointsVelocityValue');

        if (incomeEl) incomeEl.textContent = '--';
        if (spendEl) spendEl.textContent = '--';
        if (velocityEl) velocityEl.textContent = '--';
    }
}

// Load Points Distribution Chart
async function loadPointsDistribution() {
    try {
        const { data, error } = await supabaseClient.rpc('get_points_distribution', { p_site: getAnalyticsSiteParam() });
        if (error) throw error;

        const ctx = document.getElementById('pointsDistChart');
        if (!ctx) return;

        const theme = getChartTheme();

        if (pointsDistributionChart) {
            pointsDistributionChart.destroy();
        }

        pointsDistributionChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.range_label),
                datasets: [{
                    label: '用户数',
                    data: data.map(d => d.user_count),
                    backgroundColor: chartColors.primary,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `用户数: ${ctx.raw}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load points distribution:', err);
        const ctx = document.getElementById('pointsDistChart');
        if (ctx?.parentElement) {
            ctx.parentElement.innerHTML = renderHintState('fas fa-chart-bar', '积分分布加载失败', 'error');
        }
    }
}

// Load Points Leaderboard
async function loadPointsLeaderboard() {
    try {
        const data = await fetchPointsLeaderboardData(10);
        const container = document.getElementById('pointsLeaderboard');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = renderHintState('fas fa-trophy', '暂无积分排行榜数据');
            return;
        }

        container.innerHTML = data.map((user, index) => `
            <div class="leaderboard-item">
                <div class="rank rank-${index + 1}">${index + 1}</div>
                <div class="user-info">
                    <img src="${user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.user_id}" class="avatar">
                    <div class="details">
                        <div class="name">${user.username || '匿名用户'}</div>
                        <div class="sub">总消费: ${formatNumber(user.total_spent)}</div>
                    </div>
                </div>
                <div class="points-value">
                    <i class="fas fa-coins text-warning"></i> ${formatNumber(user.balance)}
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('[Analytics] Failed to load leaderboard:', err);
        const container = document.getElementById('pointsLeaderboard');
        if (container) {
            container.innerHTML = renderHintState('fas fa-triangle-exclamation', '积分富豪榜加载失败', 'error');
        }
    }
}

// Load Redemption Funnel
async function loadRedemptionFunnel() {
    try {
        const { data, error } = await supabaseClient.rpc('get_redemption_funnel', { p_site: getAnalyticsSiteParam() });
        if (error) throw error;

        const ctx = document.getElementById('redemptionFunnelChart');
        if (!ctx) return;

        // Check if data is empty or all zeros
        if (!data || data.length === 0 || data.every(d => d.count === 0)) {
            ctx.parentElement.innerHTML = `
                <div class="empty-state-hint">
                    <i class="fas fa-info-circle"></i>
                    <span>暂无兑换码数据</span>
                </div>
            `;
            return;
        }

        // Calculate conversion rates for display
        // data: [{step: '已生成', count: 100, conversion_rate: 100}, ...]

        // Update Redeemed Rate KPI if exists
        const redeemRate = data.find(d => d.step === '已核销')?.conversion_rate;
        const rateEl = document.getElementById('kpiRedeemRateValue');
        if (rateEl && redeemRate !== undefined) {
            rateEl.textContent = redeemRate + '%';
        }

        const theme = getChartTheme();

        if (redemptionFunnelChart) {
            redemptionFunnelChart.destroy();
        }

        redemptionFunnelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.step),
                datasets: [{
                    label: '数量',
                    data: data.map(d => d.count),
                    backgroundColor: [chartColors.primary, chartColors.success, chartColors.secondary],
                    borderRadius: 4,
                    barPercentage: 0.5
                }]
            },
            options: {
                indexAxis: 'y', // Horizontal bar to simulate funnel
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => `${c.raw} (${data[c.dataIndex].conversion_rate}%)`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: theme.text, font: { weight: 'bold' } }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load redemption funnel:', err);
        const ctx = document.getElementById('redemptionFunnelChart');
        if (ctx?.parentElement) {
            ctx.parentElement.innerHTML = renderHintState('fas fa-ticket-alt', '兑换漏斗加载失败', 'error');
        }
    }
}

// ============================================
// ANALYTICS TABS LOGIC
// ============================================

function switchAnalyticsTab(tabId) {
    const nav = document.getElementById('analyticsTabsNav');
    if (!nav) return;

    // Update tab buttons
    const tabs = nav.querySelectorAll('.admin-tab');
    tabs.forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update indicator position
    const activeTab = nav.querySelector('.admin-tab.active');
    if (activeTab) {
        window.updateAdminTabIndicator(activeTab);
    }

    // Update tab content
    document.querySelectorAll('.analytics-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const activeContent = document.getElementById(`analytics-tab-${tabId}`);
    if (activeContent) {
        activeContent.classList.add('active');

        // Trigger resize for charts in case they were hidden
        window.dispatchEvent(new Event('resize'));
    }
}

// Initialize indicator position on page load
function initAnalyticsTabIndicator() {
    const nav = document.getElementById('analyticsTabsNav');
    if (!nav) return;

    const activeTab = nav.querySelector('.admin-tab.active');
    if (activeTab) {
        window.updateAdminTabIndicator(activeTab);
    }
}

function getAnalyticsToneLevel(intensity) {
    const normalized = Number.isFinite(intensity) ? intensity : 0;
    if (normalized <= 0) return 0;
    if (normalized < 0.25) return 1;
    if (normalized < 0.5) return 2;
    if (normalized < 0.75) return 3;
    return 4;
}

function getHeatmapToneClass(count, intensity) {
    return `heatmap-cell--level-${getAnalyticsToneLevel(count > 0 ? intensity : 0)}`;
}

function getCohortToneClass(percent) {
    return `cohort-cell cohort-cell--level-${getAnalyticsToneLevel((Number(percent) || 0) / 100)}`;
}

function setAnalyticsVisibility(element, hidden) {
    if (!element) return;
    element.hidden = hidden;
}

// Export for global access
window.switchAnalyticsTab = switchAnalyticsTab;
window.initAnalyticsModule = initAnalyticsModule;

// ============================================
// ADVANCED CHARTS
// ============================================

// Load Activity Heatmap
async function loadActivityHeatmap() {
    try {
        const { data, error } = await supabaseClient.rpc('get_activity_heatmap', { p_days: 30, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('activityHeatmap');
        if (!container) return;

        // Day names (Sunday = 0)
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        // Build heatmap matrix (7 days x 24 hours)
        const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
        let maxCount = 0;
        let totalCount = 0;

        data.forEach(d => {
            matrix[d.day_of_week][d.hour_of_day] = d.activity_count;
            totalCount += d.activity_count;
            if (d.activity_count > maxCount) maxCount = d.activity_count;
        });

        // Check if no data
        if (totalCount === 0) {
            container.innerHTML = `
                <div class="empty-state-hint">
                    <i class="fas fa-info-circle"></i>
                    <span>近30天暂无登录活动数据</span>
                </div>
            `;
            return;
        }

        // Generate HTML with gradient colors
        let html = '<div class="heatmap-grid">';

        // Header row (hours)
        html += '<div class="heatmap-row header"><div class="heatmap-label"></div>';
        for (let h = 0; h < 24; h += 2) {
            html += `<div class="heatmap-hour">${h}</div>`;
        }
        html += '</div>';

        // Data rows
        for (let d = 0; d < 7; d++) {
            html += `<div class="heatmap-row"><div class="heatmap-label">${dayNames[d]}</div>`;
            for (let h = 0; h < 24; h++) {
                const count = matrix[d][h];
                const intensity = maxCount > 0 ? count / maxCount : 0;
                html += `<div class="heatmap-cell ${getHeatmapToneClass(count, intensity)}" title="${dayNames[d]} ${h}:00 - ${count} 次活动"></div>`;
            }
            html += '</div>';
        }
        html += '</div>';

        // Add legend
        html += `
            <div class="heatmap-legend">
                <span class="legend-label">少</span>
                <div class="legend-gradient"></div>
                <span class="legend-label">多</span>
            </div>
        `;

        container.innerHTML = html;

    } catch (err) {
        console.error('[Analytics] Failed to load heatmap:', err);
        const container = document.getElementById('activityHeatmap');
        if (container) container.innerHTML = '<div class="empty-state">暂无数据</div>';
    }
}

// Load Top Contributors
async function loadTopContributors() {
    try {
        const { data, error } = await supabaseClient.rpc('get_top_contributors', { p_limit: 10, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('topContributorsList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无数据</div>';
            return;
        }

        container.innerHTML = data.map((user, index) => `
            <div class="contributor-item">
                <span class="rank rank-${index + 1}">${index + 1}</span>
                <img class="contributor-avatar" src="${user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.user_id}" alt="avatar">
                <div class="contributor-info">
                    <span class="contributor-name">${user.username || '匿名用户'}</span>
                    <span class="contributor-stats">
                        <span><i class="fas fa-comment"></i> ${user.comment_count}</span>
                        <span><i class="fas fa-envelope"></i> ${user.message_count}</span>
                        <span><i class="fas fa-heart"></i> ${user.total_likes_received}</span>
                    </span>
                </div>
                <span class="contributor-score">${Math.round(user.contribution_score)}</span>
            </div>
        `).join('');

    } catch (err) {
        console.error('[Analytics] Failed to load contributors:', err);
        const container = document.getElementById('topContributorsList');
        if (container) container.innerHTML = '<div class="error-state">加载失败</div>';
    }
}

// Load Community Chart
async function loadCommunityChart(days = 30) {
    try {
        const { data, error } = await supabaseClient.rpc('get_community_stats', { p_days: days, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const ctx = document.getElementById('communityChart');
        if (!ctx) return;

        const theme = getChartTheme();

        // Destroy existing chart
        if (communityChart) {
            communityChart.destroy();
        }

        communityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '留言',
                        data: data.map(d => d.messages),
                        borderColor: chartColors.primary,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    },
                    {
                        label: '评论',
                        data: data.map(d => d.comments),
                        borderColor: chartColors.secondary,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    },
                    {
                        label: '点赞',
                        data: data.map(d => d.likes),
                        borderColor: chartColors.success,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load community chart:', err);
    }
}

// ============================================
// PHASE 10: ADVANCED ANALYTICS
// ============================================

// Chart instance for funnel
let funnelChart = null;

// Load Conversion Funnel
async function loadConversionFunnel() {
    try {
        const { data, error } = await supabaseClient.rpc('get_conversion_funnel', { p_days: 30, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('conversionFunnel');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-filter"></i>
                <span>暂无转化数据</span>
            </div>`;
            return;
        }

        const theme = getChartTheme();
        const ctx = document.getElementById('funnelChart');
        if (!ctx) return;

        // Destroy existing chart
        if (funnelChart) funnelChart.destroy();

        // Horizontal bar chart for funnel
        funnelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.step_name),
                datasets: [{
                    label: '用户数',
                    data: data.map(d => d.user_count),
                    backgroundColor: [
                        'rgba(107, 158, 206, 0.8)',
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(34, 197, 94, 0.8)'
                    ],
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const rate = data[ctx.dataIndex]?.conversion_rate || 0;
                                return `${ctx.raw} 用户 (${rate}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load funnel:', err);
    }
}

// Load Retention Cohort Heatmap
async function loadRetentionCohort() {
    try {
        const { data, error } = await supabaseClient.rpc('get_retention_cohort', { p_weeks: 8, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('retentionCohort');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-th"></i>
                <span>暂无留存数据</span>
            </div>`;
            return;
        }

        // Build cohort table
        let html = `
            <table class="cohort-table">
                <thead>
                    <tr>
                        <th>注册周</th>
                        <th>W0</th>
                        <th>W1</th>
                        <th>W2</th>
                        <th>W3</th>
                        <th>W4</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.forEach(row => {
            html += `<tr>
                <td>${row.cohort_week}</td>
                <td class="${getCohortToneClass(row.week_0)}">${row.week_0 || 0}%</td>
                <td class="${getCohortToneClass(row.week_1)}">${row.week_1 || 0}%</td>
                <td class="${getCohortToneClass(row.week_2)}">${row.week_2 || 0}%</td>
                <td class="${getCohortToneClass(row.week_3)}">${row.week_3 || 0}%</td>
                <td class="${getCohortToneClass(row.week_4)}">${row.week_4 || 0}%</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (err) {
        console.error('[Analytics] Failed to load retention cohort:', err);
    }
}

// Load Points Flow (Sankey-style list)
async function loadPointsFlow() {
    try {
        const data = await fetchPointsFlowData(30);
        const container = document.getElementById('pointsFlow');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = renderHintState('fas fa-exchange-alt', '暂无积分流向数据');
            return;
        }

        // Group by source -> target
        const inflows = data.filter(d => d.target_node === '用户余额');
        const outflows = data.filter(d => d.source_node === '用户余额');

        let html = '<div class="points-flow-container">';

        // Inflows
        html += '<div class="flow-section"><h4><i class="fas fa-arrow-right flow-section-icon flow-section-icon--inflow"></i> 收入来源</h4>';
        inflows.forEach(item => {
            html += `<div class="flow-item inflow">
                <span class="flow-label">${item.source_node}</span>
                <span class="flow-value">+${formatNumber(item.value)}</span>
            </div>`;
        });
        html += '</div>';

        // Outflows
        html += '<div class="flow-section"><h4><i class="fas fa-arrow-left flow-section-icon flow-section-icon--outflow"></i> 消费去向</h4>';
        outflows.forEach(item => {
            html += `<div class="flow-item outflow">
                <span class="flow-label">${item.target_node}</span>
                <span class="flow-value">-${formatNumber(item.value)}</span>
            </div>`;
        });
        html += '</div></div>';

        container.innerHTML = html;

    } catch (err) {
        console.error('[Analytics] Failed to load points flow:', err);
        const container = document.getElementById('pointsFlow');
        if (container) {
            container.innerHTML = renderHintState('fas fa-triangle-exclamation', '积分流向加载失败', 'error');
        }
    }
}

// ============================================
// PHASE 12: AI PREDICTION
// ============================================

async function loadAIPrediction() {
    const container = document.getElementById('aiPredictionContent');
    if (!container) return;
    let trendSeries = [];

    if (!hasAdminAI()) {
        try {
            await window.AdminAI?.checkHealth?.();
        } catch (err) {
            console.warn('[Analytics] AI proxy health check failed:', err);
        }
    }

    if (!hasAdminAI()) {
        container.innerHTML = '<p class="ai-error">请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key</p>';
        return;
    }

    container.innerHTML = '<p class="ai-loading">AI 正在生成预测...</p>';

    try {
        // Get trend data
        const { data, error } = await supabaseClient.rpc('get_user_trend', { p_days: 30, p_site: getAnalyticsSiteParam() });
        if (error) throw error;
        trendSeries = Array.isArray(data) ? data.map((item) => item?.new_users) : [];

        const prompt = `基于以下30天的用户数据趋势，预测未来7天的走势（每天一个数字）。
只返回JSON数组格式，例如: [15, 18, 20, 22, 19, 21, 25]

数据：${JSON.stringify(trendSeries)}`;

        const text = await window.AdminAI.generateText(prompt, {
            model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 256
            }
        });

        // Parse prediction
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
            container.innerHTML = `<p class="ai-error">预测失败: ${err.message}</p>`;
        }
    }
}

// ============================================
// PHASE 11: GEO DISTRIBUTION
// ============================================

// Geo chart instance
let geoChart = null;

async function loadGeoDistribution() {
    try {
        const { data, error } = await supabaseClient.rpc('get_geo_distribution_by_site', {
            p_site: getAnalyticsSiteParam()
        });

        if (error) throw error;

        const container = document.getElementById('geoDistribution');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-globe-asia"></i>
                <span>暂无地理数据</span>
            </div>`;
            return;
        }

        const theme = getChartTheme();
        const ctx = document.getElementById('geoChart');
        if (!ctx) return;

        if (geoChart) geoChart.destroy();

        geoChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.region),
                datasets: [{
                    data: data.map(d => d.user_count),
                    backgroundColor: [
                        '#6b9ece', '#8b5cf6', '#22c55e', '#f59e0b',
                        '#ef4444', '#ec4899', '#14b8a6', '#64748b'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Geo distribution error:', err);
    }
}

// ============================================
// PHASE 13: TRACKING SDK
// Frontend event tracking
// ============================================

const TrackingSDK = {
    sessionId: null,

    init() {
        this.sessionId = this.generateSessionId();
        console.log('[Tracking] SDK initialized, session:', this.sessionId);
    },

    generateSessionId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `sess_${crypto.randomUUID()}`;
        }
        return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    async track(eventType, eventName, eventData = {}) {
        try {
            const { data, error } = await supabaseClient.rpc('track_event', {
                p_event_type: eventType,
                p_event_name: eventName,
                p_event_data: eventData,
                p_page_url: window.location.href,
                p_session_id: this.sessionId
            });

            if (error) throw error;
            console.log('[Tracking] Event tracked:', eventName);
            return data;
        } catch (err) {
            console.warn('[Tracking] Failed to track event:', err);
            return null;
        }
    },

    // Convenience methods
    pageView(pageName) {
        return this.track('page_view', pageName, { url: window.location.pathname });
    },

    click(elementName, data = {}) {
        return this.track('click', elementName, data);
    },

    conversion(conversionName, data = {}) {
        return this.track('conversion', conversionName, data);
    }
};

// Initialize tracking on load
if (typeof window !== 'undefined') {
    window.TrackingSDK = TrackingSDK;
}

// ============================================
// PHASE 14: A/B TESTING UI
// ============================================

async function loadExperimentsList() {
    try {
        const { data, error } = await supabaseClient
            .from('ab_experiments')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const container = document.getElementById('experimentsList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-flask"></i>
                <span>暂无实验</span>
            </div>`;
            return;
        }

        container.innerHTML = data.map(exp => `
            <div class="experiment-card">
                <div class="exp-header">
                    <span class="exp-name">${exp.name}</span>
                    <span class="exp-status status-${exp.status}">${exp.status}</span>
                </div>
                <div class="exp-meta">
                    <span>${exp.description || '无描述'}</span>
                </div>
                <div class="exp-variants">
                    ${(exp.variants || []).map(v => `
                        <span class="variant-badge">${v.name} (${v.weight}%)</span>
                    `).join('')}
                </div>
                <button class="btn-sm btn-secondary view-results-btn"
                    data-admin-action="analytics-show-ab-results"
                    data-experiment-id="${encodeURIComponent(String(exp.id || ''))}"
                    data-experiment-name="${encodeURIComponent(String(exp.name || ''))}"
                    data-experiment-variants="${encodeURIComponent(JSON.stringify(exp.variants || []))}">
                    <i class="fas fa-chart-bar"></i> 查看结果
                </button>
            </div>
        `).join('');

    } catch (err) {
        console.error('[Analytics] Experiments list error:', err);
    }
}

async function getExperimentVariant(experimentName) {
    try {
        const { data, error } = await supabaseClient.rpc('get_experiment_variant', {
            p_experiment_name: experimentName
        });

        if (error) throw error;
        return data;
    } catch (err) {
        console.warn('[A/B] Failed to get variant:', err);
        return null;
    }
}

// Expose A/B testing to window
if (typeof window !== 'undefined') {
    window.ABTest = {
        getVariant: getExperimentVariant
    };
}

// ============================================
// A/B EXPERIMENT MANAGEMENT UI
// ============================================

function bindExperimentModalOverlayDismiss() {
    const modal = document.getElementById('experimentModal');
    if (!(modal instanceof HTMLElement) || modal.dataset.overlayDismissBound === '1') {
        return;
    }

    modal.dataset.overlayDismissBound = '1';
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeExperimentModal();
        }
    });
}

function openExperimentModal() {
    const modal = document.getElementById('experimentModal');
    if (modal) {
        bindExperimentModalOverlayDismiss();
        modal.classList.add('active');
        document.getElementById('expName').value = '';
        document.getElementById('expDescription').value = '';
    }
}

function closeExperimentModal() {
    const modal = document.getElementById('experimentModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function addVariantRow() {
    const list = document.getElementById('variantsList');
    if (!list) return;

    const count = list.querySelectorAll('.variant-row').length;
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.innerHTML = `
        <input type="text" placeholder="Variant ${String.fromCharCode(65 + count)}" class="variant-name">
        <input type="number" placeholder="0" value="0" class="variant-weight" min="0" max="100">
        <span>%</span>
        <button type="button" class="btn-icon-sm" data-admin-action="analytics-remove-variant-row">
            <i class="fas fa-times"></i>
        </button>
    `;
    list.appendChild(row);
}

async function handleCreateExperiment(event) {
    event.preventDefault();

    const name = document.getElementById('expName').value.trim();
    const description = document.getElementById('expDescription').value.trim();
    const targetMetric = document.getElementById('expTargetMetric')?.value || 'page_view';

    // Collect variants
    const variantRows = document.querySelectorAll('#variantsList .variant-row');
    const variants = [];

    variantRows.forEach(row => {
        const nameInput = row.querySelector('.variant-name');
        const weightInput = row.querySelector('.variant-weight');
        if (nameInput && weightInput) {
            variants.push({
                name: nameInput.value.trim() || `Variant ${variants.length + 1}`,
                weight: parseInt(weightInput.value) || 0
            });
        }
    });

    // Validate
    if (!name) {
        alert('请输入实验名称');
        return;
    }

    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight !== 100) {
        alert(`变体权重总和必须为 100%，当前为 ${totalWeight}%`);
        return;
    }

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();

        const { error } = await supabaseClient
            .from('ab_experiments')
            .insert({
                name: name,
                description: description,
                status: 'running',
                variants: variants,
                target_metric: targetMetric,
                created_by: user?.id
            });

        if (error) throw error;

        closeExperimentModal();
        loadExperimentsList();
        if (typeof showToast === 'function') {
            showToast('实验创建成功！', 'success');
        }
    } catch (err) {
        console.error('[A/B] Create experiment error:', err);
        alert('创建失败: ' + err.message);
    }
}

// Expose to window
window.loadAIPrediction = loadAIPrediction;
window.loadExperimentsList = loadExperimentsList;
window.openExperimentModal = openExperimentModal;
window.closeExperimentModal = closeExperimentModal;
window.addVariantRow = addVariantRow;
window.handleCreateExperiment = handleCreateExperiment;

// A/B Results Chart
let abCompareChartInstance = null;

async function showABResults(experimentId, experimentName, variants) {
    console.log('[A/B] Showing results for:', experimentName);

    const chartContainer = document.getElementById('abResultsChart');
    const chartTitle = document.getElementById('abChartTitle');
    const canvas = document.getElementById('abCompareChart');

    if (!chartContainer || !canvas) return;

    // Show chart area
    setAnalyticsVisibility(chartContainer, false);
    if (chartTitle) chartTitle.textContent = `${experimentName} - 结果对比`;

    try {
        const { data: results, error } = await supabaseClient.rpc('get_experiment_results', {
            p_experiment_id: experimentId
        });

        if (error) throw error;

        const normalizedResults = Array.isArray(results) ? results : [];
        const variantMap = new Map();

        (variants || []).forEach((variant) => {
            if (!variant?.name) return;
            variantMap.set(variant.name, {
                variant_name: variant.name,
                user_count: 0,
                conversion_count: 0,
                conversion_rate: 0
            });
        });

        normalizedResults.forEach((row) => {
            if (row?.variant_name) {
                variantMap.set(row.variant_name, row);
            }
        });

        const labels = Array.from(variantMap.keys());
        const assignedData = labels.map((label) => Number(variantMap.get(label)?.user_count || 0));
        const conversionData = labels.map((label) => Number(variantMap.get(label)?.conversion_count || 0));
        const conversionRates = labels.map((label) => Number(variantMap.get(label)?.conversion_rate || 0));

        // Destroy previous chart
        if (abCompareChartInstance) {
            abCompareChartInstance.destroy();
        }

        chartContainer.querySelectorAll('.ab-results-summary').forEach((node) => node.remove());

        // Create chart with multiple datasets
        const ctx = canvas.getContext('2d');
        abCompareChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '分配用户数',
                        data: assignedData,
                        backgroundColor: 'rgba(107, 158, 206, 0.7)',
                        borderColor: '#6b9ece',
                        borderWidth: 1,
                        borderRadius: 6
                    },
                    {
                        label: '转化用户数',
                        data: conversionData,
                        backgroundColor: 'rgba(52, 211, 153, 0.7)',
                        borderColor: '#34d399',
                        borderWidth: 1,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-main') || '#333' }
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function (context) {
                                const index = context[0].dataIndex;
                                return `转化率: ${conversionRates[index]}%`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#888' }
                    },
                    x: {
                        ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-main') || '#333' }
                    }
                }
            }
        });

        // Add conversion rate summary below chart
        const summaryEl = document.createElement('div');
        summaryEl.className = 'ab-results-summary';
        summaryEl.innerHTML = labels.map((label, i) =>
            `<div class="summary-item"><span class="variant-name">${escapeHtml(label)}</span><span class="conversion-rate">${conversionRates[i]}%</span></div>`
        ).join('');
        chartContainer.appendChild(summaryEl);

        if (conversionData.every((value) => value === 0)) {
            const emptyState = document.createElement('div');
            emptyState.className = 'ab-results-summary';
            emptyState.innerHTML = '<div class="summary-item"><span class="variant-name">当前还没有匹配到真实转化事件</span><span class="conversion-rate">0%</span></div>';
            chartContainer.appendChild(emptyState);
        }

    } catch (err) {
        console.error('[A/B] Results error:', err);
        chartContainer.innerHTML = `<div class="empty-state-hint"><span>加载失败: ${err.message}</span></div>`;
    }
}

function closeABResultsChart() {
    const chartContainer = document.getElementById('abResultsChart');
    if (chartContainer) {
        setAnalyticsVisibility(chartContainer, true);
    }
    if (abCompareChartInstance) {
        abCompareChartInstance.destroy();
        abCompareChartInstance = null;
    }
}

window.showABResults = showABResults;
window.closeABResultsChart = closeABResultsChart;

// ============================================
// PHASE 1: DATE RANGE & EXPORT
// ============================================

// Global date range state
let globalDateRange = {
    days: 7,
    startDate: null,
    endDate: null
};

// Calendar state
let calendarState = {
    start: { year: 2026, month: 0, selectedDate: null },
    end: { year: 2026, month: 0, selectedDate: null },
    activeCalendar: null
};

// Initialize date range controls with dropdown menu
function initDateRangeControls() {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Set default dates
    calendarState.start.selectedDate = sevenDaysAgo;
    calendarState.start.year = sevenDaysAgo.getFullYear();
    calendarState.start.month = sevenDaysAgo.getMonth();

    calendarState.end.selectedDate = today;
    calendarState.end.year = today.getFullYear();
    calendarState.end.month = today.getMonth();

    // Initialize custom date inputs
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');
    if (startInput && endInput) {
        startInput.value = formatDateForInput(sevenDaysAgo);
        endInput.value = formatDateForInput(today);
    }

    // Close dropdown when clicking outside (but not on calendar)
    document.addEventListener('click', function (e) {
        const dropdown = document.getElementById('dateRangeDropdown');
        if (dropdown && !e.target.closest('.date-range-dropdown') && !e.target.closest('.inline-calendar')) {
            dropdown.classList.remove('open');
        }
    });
}

// Toggle date range dropdown
function toggleDateRangeDropdown() {
    const dropdown = document.getElementById('dateRangeDropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

// Select preset range
function selectPresetRange(days) {
    globalDateRange.days = days;

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    calendarState.start.selectedDate = start;
    calendarState.end.selectedDate = end;

    // Update label
    const labels = { 7: '最近 7 天', 30: '最近 30 天', 90: '最近 90 天', 365: '最近 1 年' };
    const labelEl = document.getElementById('dateRangeLabel');
    if (labelEl) labelEl.textContent = labels[days] || `最近 ${days} 天`;

    // Update active state
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.range) === days);
    });

    // Update custom inputs
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');
    if (startInput && endInput) {
        startInput.value = formatDateForInput(start);
        endInput.value = formatDateForInput(end);
    }

    // Close dropdown
    document.getElementById('dateRangeDropdown')?.classList.remove('open');

    // Refresh charts
    refreshChartsWithDateRange(days);
}

// Apply custom date range
function applyCustomRange() {
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');

    if (!startInput || !endInput || !startInput.value || !endInput.value) {
        showToast('请选择开始和结束日期', 'error');
        return;
    }

    const start = new Date(startInput.value);
    const end = new Date(endInput.value);

    if (start > end) {
        showToast('开始日期不能晚于结束日期', 'error');
        return;
    }

    calendarState.start.selectedDate = start;
    calendarState.end.selectedDate = end;

    // Calculate days difference
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    globalDateRange.days = days;

    // Update label
    const labelEl = document.getElementById('dateRangeLabel');
    if (labelEl) {
        const startStr = `${start.getMonth() + 1}/${start.getDate()}`;
        const endStr = `${end.getMonth() + 1}/${end.getDate()}`;
        labelEl.textContent = `${startStr} - ${endStr}`;
    }

    // Clear preset active states
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    // Close dropdown
    document.getElementById('dateRangeDropdown')?.classList.remove('open');

    // Refresh charts
    refreshChartsWithDateRange(days);
}

// Format date for input value (YYYY-MM-DD)
function formatDateForInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ============================================
// INLINE CALENDAR COMPONENT
// ============================================

let inlineCalendarState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    startDate: null,
    endDate: null,
    selectingEnd: false
};

// Initialize inline calendar when dropdown opens
function initInlineCalendar() {
    const today = new Date();
    inlineCalendarState.year = today.getFullYear();
    inlineCalendarState.month = today.getMonth();

    // Set default dates (last 7 days)
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    inlineCalendarState.startDate = start;
    inlineCalendarState.endDate = today;

    renderInlineCalendar();
    updateCustomDateDisplays();

    // Show calendar
    document.getElementById('inlineCalendar')?.classList.add('visible');
}

// Render inline calendar
function renderInlineCalendar() {
    const { year, month, startDate, endDate } = inlineCalendarState;
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月',
        '七月', '八月', '九月', '十月', '十一月', '十二月'];

    // Update title
    const title = document.getElementById('calendarTitle');
    if (title) title.textContent = `${monthNames[month]} ${year}`;

    // Calculate days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    // Previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    let html = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Previous month padding
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthLastDay - i;
        html += `<div class="cal-day other-month" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month - 1}" data-analytics-day="${day}">${day}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);

        let classes = ['cal-day'];

        // Today
        if (date.getTime() === today.getTime()) {
            classes.push('today');
        }

        // Range highlighting
        if (startDate && endDate) {
            const start = new Date(startDate); start.setHours(0, 0, 0, 0);
            const end = new Date(endDate); end.setHours(0, 0, 0, 0);

            if (date.getTime() === start.getTime()) {
                classes.push('range-start');
            } else if (date.getTime() === end.getTime()) {
                classes.push('range-end');
            } else if (date > start && date < end) {
                classes.push('in-range');
            }
        } else if (startDate) {
            const start = new Date(startDate); start.setHours(0, 0, 0, 0);
            if (date.getTime() === start.getTime()) {
                classes.push('selected');
            }
        }

        html += `<div class="${classes.join(' ')}" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month}" data-analytics-day="${day}">${day}</div>`;
    }

    // Next month padding
    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        html += `<div class="cal-day other-month" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month + 1}" data-analytics-day="${i}">${i}</div>`;
    }

    const container = document.getElementById('calendarDays');
    if (container) container.innerHTML = html;
}

// Select date in inline calendar
function selectInlineDate(year, month, day, event) {
    // Prevent event bubbling to avoid closing dropdown
    if (event) event.stopPropagation();

    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    if (!inlineCalendarState.selectingEnd || !inlineCalendarState.startDate) {
        // First selection: set start date
        inlineCalendarState.startDate = date;
        inlineCalendarState.endDate = null;
        inlineCalendarState.selectingEnd = true;
    } else {
        // Second selection: set end date
        if (date < inlineCalendarState.startDate) {
            // Swap if end is before start
            inlineCalendarState.endDate = inlineCalendarState.startDate;
            inlineCalendarState.startDate = date;
        } else {
            inlineCalendarState.endDate = date;
        }
        inlineCalendarState.selectingEnd = false;
    }

    // Update view
    inlineCalendarState.year = year;
    inlineCalendarState.month = month;

    renderInlineCalendar();
    updateCustomDateDisplays();
}

// Update display values
function updateCustomDateDisplays() {
    const { startDate, endDate, selectingEnd } = inlineCalendarState;

    const startEl = document.getElementById('customStartDisplay');
    const endEl = document.getElementById('customEndDisplay');
    const hintEl = document.getElementById('calendarHint');

    if (startEl) {
        startEl.textContent = startDate
            ? `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}`
            : '选择开始日期';
    }

    if (endEl) {
        endEl.textContent = endDate
            ? `${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()}`
            : '选择结束日期';
    }

    // Update hint
    if (hintEl) {
        if (!startDate) {
            hintEl.textContent = '选择开始日期';
        } else if (selectingEnd) {
            hintEl.textContent = '选择结束日期';
        } else {
            hintEl.textContent = `${startDate.getMonth() + 1}/${startDate.getDate()} — ${endDate.getMonth() + 1}/${endDate.getDate()}`;
        }
    }
}

// Change month
function changeInlineMonth(delta) {
    inlineCalendarState.month += delta;

    if (inlineCalendarState.month > 11) {
        inlineCalendarState.month = 0;
        inlineCalendarState.year++;
    } else if (inlineCalendarState.month < 0) {
        inlineCalendarState.month = 11;
        inlineCalendarState.year--;
    }

    renderInlineCalendar();
}

// Reset calendar
function resetInlineCalendar() {
    inlineCalendarState.startDate = null;
    inlineCalendarState.endDate = null;
    inlineCalendarState.selectingEnd = false;
    renderInlineCalendar();
    updateCustomDateDisplays();
}

// Set to today
function setInlineToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    inlineCalendarState.year = today.getFullYear();
    inlineCalendarState.month = today.getMonth();
    inlineCalendarState.endDate = today;

    if (!inlineCalendarState.startDate || inlineCalendarState.startDate > today) {
        const start = new Date(today);
        start.setDate(start.getDate() - 7);
        inlineCalendarState.startDate = start;
    }

    inlineCalendarState.selectingEnd = false;
    renderInlineCalendar();
    updateCustomDateDisplays();
}

// Override applyCustomRange to use inline calendar
function applyCustomRange() {
    const { startDate, endDate } = inlineCalendarState;

    if (!startDate || !endDate) {
        showToast('请选择开始和结束日期', 'error');
        return;
    }

    calendarState.start.selectedDate = startDate;
    calendarState.end.selectedDate = endDate;

    // Calculate days difference
    const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    globalDateRange.days = days;

    // Update label
    const labelEl = document.getElementById('dateRangeLabel');
    if (labelEl) {
        const startStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
        const endStr = `${endDate.getMonth() + 1}/${endDate.getDate()}`;
        labelEl.textContent = `${startStr} - ${endStr}`;
    }

    // Clear preset active states
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    // Close dropdown
    document.getElementById('dateRangeDropdown')?.classList.remove('open');

    // Refresh charts
    refreshChartsWithDateRange(days);
}

// Enhanced toggle to init calendar
const originalToggle = toggleDateRangeDropdown;
function toggleDateRangeDropdown() {
    const dropdown = document.getElementById('dateRangeDropdown');
    if (dropdown) {
        const wasOpen = dropdown.classList.contains('open');
        dropdown.classList.toggle('open');

        if (!wasOpen) {
            initInlineCalendar();
        }
    }
}

// Toggle inline calendar visibility
function toggleInlineCalendar(event) {
    if (event) event.stopPropagation();

    const calendar = document.getElementById('inlineCalendar');
    if (calendar) {
        const isVisible = calendar.classList.contains('visible');
        if (!isVisible) {
            // Show calendar and initialize
            calendar.classList.add('visible');
            renderInlineCalendar();
            updateCustomDateDisplays();
        } else {
            calendar.classList.remove('visible');
        }
    }
}

// Export functions
window.toggleDateRangeDropdown = toggleDateRangeDropdown;
window.selectPresetRange = selectPresetRange;
window.applyCustomRange = applyCustomRange;
window.changeInlineMonth = changeInlineMonth;
window.selectInlineDate = selectInlineDate;
window.resetInlineCalendar = resetInlineCalendar;
window.setInlineToday = setInlineToday;
window.toggleInlineCalendar = toggleInlineCalendar;

// Toggle calendar dropdown
function toggleDatePicker(type) {
    const calendarId = type === 'start' ? 'calendarStart' : 'calendarEnd';
    const calendar = document.getElementById(calendarId);

    if (!calendar) return;

    // Close other calendar
    const otherId = type === 'start' ? 'calendarEnd' : 'calendarStart';
    document.getElementById(otherId)?.classList.remove('active');

    // Toggle this calendar
    const isActive = calendar.classList.contains('active');
    if (isActive) {
        calendar.classList.remove('active');
        calendarState.activeCalendar = null;
    } else {
        calendarState.activeCalendar = type;
        renderCalendar(type);
        calendar.classList.add('active');
    }
}

// Close all calendars
function closeAllCalendars() {
    document.querySelectorAll('.calendar-dropdown').forEach(c => c.classList.remove('active'));
    calendarState.activeCalendar = null;
}

// Render calendar - Range selection mode
function renderCalendar(type) {
    const calendar = document.getElementById('calendarStart');
    if (!calendar) return;

    // Use start state for navigation
    const state = calendarState.start;
    const months = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

    const firstDay = new Date(state.year, state.month, 1);
    const lastDay = new Date(state.year, state.month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = calendarState.start.selectedDate;
    const endDate = calendarState.end.selectedDate;

    let daysHtml = '';

    // Previous month days
    const prevMonthDays = new Date(state.year, state.month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        daysHtml += `<div class="calendar-day other-month">${prevMonthDays - i}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const thisDate = new Date(state.year, state.month, day);
        thisDate.setHours(0, 0, 0, 0);
        const isToday = thisDate.getTime() === today.getTime();

        const isStart = startDate && thisDate.getTime() === new Date(startDate).setHours(0, 0, 0, 0);
        const isEnd = endDate && thisDate.getTime() === new Date(endDate).setHours(0, 0, 0, 0);
        const inRange = startDate && endDate && thisDate > startDate && thisDate < endDate;

        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isStart) classes += ' range-start';
        if (isEnd) classes += ' range-end';
        if (inRange) classes += ' in-range';

        daysHtml += `<div class="${classes}" data-admin-action="analytics-range-select-date" data-analytics-year="${state.year}" data-analytics-month="${state.month}" data-analytics-day="${day}">${day}</div>`;
    }

    // Next month days
    const totalCells = Math.ceil((startDayOfWeek + daysInMonth) / 7) * 7;
    const nextDays = totalCells - (startDayOfWeek + daysInMonth);
    for (let i = 1; i <= nextDays; i++) {
        daysHtml += `<div class="calendar-day other-month">${i}</div>`;
    }

    // Determine which date is being selected
    const selectionHint = !calendarState.rangeStep || calendarState.rangeStep === 'start'
        ? '选择开始日期'
        : '选择结束日期';

    calendar.innerHTML = `
        <div class="calendar-header">
            <button type="button" data-admin-action="analytics-range-change-month" data-calendar-type="start" data-month-delta="-1"><i class="fas fa-chevron-left"></i></button>
            <span class="month-year">${months[state.month]} ${state.year}</span>
            <button type="button" data-admin-action="analytics-range-change-month" data-calendar-type="start" data-month-delta="1"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="calendar-hint">${selectionHint}</div>
        <div class="calendar-weekdays">
            ${weekdays.map(d => `<span>${d}</span>`).join('')}
        </div>
        <div class="calendar-days">
            ${daysHtml}
        </div>
        <div class="calendar-footer">
            <button type="button" data-admin-action="analytics-range-reset">重置</button>
            <button type="button" data-admin-action="analytics-range-apply">确定</button>
        </div>
    `;
}

// Select date in range mode
function selectRangeDate(year, month, day) {
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    if (!calendarState.rangeStep || calendarState.rangeStep === 'start') {
        // First click: set start date
        calendarState.start.selectedDate = date;
        calendarState.start.year = year;
        calendarState.start.month = month;
        calendarState.rangeStep = 'end';
    } else {
        // Second click: set end date
        if (date < calendarState.start.selectedDate) {
            // If end is before start, swap
            calendarState.end.selectedDate = calendarState.start.selectedDate;
            calendarState.start.selectedDate = date;
        } else {
            calendarState.end.selectedDate = date;
        }
        calendarState.end.year = date.getFullYear();
        calendarState.end.month = date.getMonth();
        calendarState.rangeStep = 'start';
    }

    updateDateDisplay('start');
    updateDateDisplay('end');
    renderCalendar('start');
}

// Reset date range
function resetDateRange() {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    calendarState.start.selectedDate = sevenDaysAgo;
    calendarState.end.selectedDate = today;
    calendarState.rangeStep = 'start';

    updateDateDisplay('start');
    updateDateDisplay('end');
    renderCalendar('start');
}

// Apply and close
function applyAndClose() {
    applyDateRange();
    closeAllCalendars();
}

// Expose new functions
window.selectRangeDate = selectRangeDate;
window.resetDateRange = resetDateRange;
window.applyAndClose = applyAndClose;

// Change month
function changeMonth(type, delta) {
    const state = calendarState[type];
    state.month += delta;

    if (state.month > 11) {
        state.month = 0;
        state.year++;
    } else if (state.month < 0) {
        state.month = 11;
        state.year--;
    }

    renderCalendar(type);
}

// Select date
function selectDate(type, year, month, day) {
    const date = new Date(year, month, day);
    calendarState[type].selectedDate = date;
    updateDateDisplay(type);
    closeAllCalendars();
}

// Set to today
function setToday(type) {
    const today = new Date();
    calendarState[type].selectedDate = today;
    calendarState[type].year = today.getFullYear();
    calendarState[type].month = today.getMonth();
    updateDateDisplay(type);
    renderCalendar(type);
}

// Clear date
function clearDate(type) {
    calendarState[type].selectedDate = null;
    updateDateDisplay(type);
}

// Update date display
function updateDateDisplay(type) {
    const displayId = type === 'start' ? 'dateStartDisplay' : 'dateEndDisplay';
    const display = document.getElementById(displayId);
    const date = calendarState[type].selectedDate;

    if (display) {
        if (date) {
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            display.textContent = `${m}/${d}`;
        } else {
            display.textContent = '--/--';
        }
    }
}

// Apply custom date range (updated for custom picker)
function applyDateRange() {
    const startDate = calendarState.start.selectedDate;
    const endDate = calendarState.end.selectedDate;

    if (!startDate || !endDate) {
        alert('请选择开始和结束日期');
        return;
    }

    if (startDate > endDate) {
        alert('开始日期不能晚于结束日期');
        return;
    }

    const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    globalDateRange.days = days;
    globalDateRange.startDate = startDate.toISOString().split('T')[0];
    globalDateRange.endDate = endDate.toISOString().split('T')[0];

    document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));

    refreshChartsWithDateRange(days);

    if (typeof showToast === 'function') {
        showToast(`已应用 ${days} 天的数据范围`, 'success');
    }
}

// Adjust date by days
function adjustDate(type, days) {
    const state = calendarState[type];
    if (!state.selectedDate) {
        state.selectedDate = new Date();
    }

    const newDate = new Date(state.selectedDate);
    newDate.setDate(newDate.getDate() + days);
    state.selectedDate = newDate;
    state.year = newDate.getFullYear();
    state.month = newDate.getMonth();

    updateDateDisplay(type);

    // Auto apply when using arrows
    const startDate = calendarState.start.selectedDate;
    const endDate = calendarState.end.selectedDate;
    if (startDate && endDate && startDate <= endDate) {
        const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        refreshChartsWithDateRange(daysDiff);
    }
}

// Expose calendar functions
window.toggleDatePicker = toggleDatePicker;
window.changeMonth = changeMonth;
window.selectDate = selectDate;
window.setToday = setToday;
window.clearDate = clearDate;
window.adjustDate = adjustDate;
window.applyDateRange = applyDateRange;

// Refresh all charts with new date range
async function refreshChartsWithDateRange(days) {
    console.log(`[Analytics] Refreshing charts for ${days} days`);

    try {
        await Promise.all([
            loadUserTrendChart(days),
            loadContentTrendChart(days),
            loadCommunityChart(days)
        ]);
    } catch (err) {
        console.error('[Analytics] Error refreshing charts:', err);
    }
}

// Export analytics data
async function exportAnalyticsData(format) {
    console.log(`[Analytics] Exporting data as ${format}`);

    try {
        // Collect all data
        const days = globalDateRange?.days || 7;

        // Fetch Phase 1 data
        const sp = getAnalyticsSiteParam();
        const { data: overviewData } = await supabaseClient.rpc('get_overview_stats', { p_site: sp });
        const { data: userTrendData } = await supabaseClient.rpc('get_user_trend', { p_days: days, p_site: sp });
        const { data: contentTrendData } = await supabaseClient.rpc('get_content_trend', { p_days: days, p_site: sp });
        const { data: revenueTrendData } = await supabaseClient.rpc('get_revenue_trend', { p_days: days, p_site: sp });
        const { data: channelData } = await supabaseClient.rpc('get_channel_breakdown', { p_site: sp });
        const { data: communityData } = await supabaseClient.rpc('get_community_stats', { p_days: days, p_site: sp });
        const { data: topContentData } = await supabaseClient.rpc('get_content_top', { p_limit: 100, p_site: sp }); // More rows for export

        // Fetch Phase 2 (Points) data
        const { data: pointsDist } = await supabaseClient.rpc('get_points_distribution', { p_site: sp });
        const { data: pointsLead } = await supabaseClient.rpc('get_points_leaderboard', { p_limit: 100, p_site: sp });
        const { data: funnelData } = await supabaseClient.rpc('get_redemption_funnel', { p_site: sp });

        // Prepare export data
        const exportData = {
            overview: overviewData,
            userTrend: userTrendData || [],
            contentTrend: contentTrendData || [],
            revenueTrend: revenueTrendData || [],
            channelBreakdown: channelData || [],
            communityStats: communityData || [],
            topContent: topContentData || [],
            // New data
            pointsDistribution: pointsDist || [],
            pointsLeaderboard: pointsLead || [],
            redemptionFunnel: funnelData || [],

            exportDate: new Date().toISOString(),
            dateRange: days
        };

        if (format === 'csv') {
            exportAsCSV(exportData);
        } else if (format === 'excel') {
            exportAsExcel(exportData);
        }

        if (typeof showToast === 'function') {
            showToast(`${format.toUpperCase()} 导出成功！`, 'success');
        }
    } catch (err) {
        console.error('[Analytics] Export error:', err);
        alert('导出失败: ' + err.message);
    }
}

// Export as CSV - Comprehensive multi-section export
function exportAsCSV(data) {
    let csv = '';
    const separator = ',';

    // ========================================
    // Section 1: Overview Summary
    // ========================================
    csv += '=== 数据概览 ===\n';
    csv += `导出时间,${data.exportDate}\n`;
    csv += `日期范围,${data.dateRange} 天\n`;
    if (data.overview) {
        csv += `日活用户 (DAU),${data.overview.dau || 0}\n`;
        csv += `月活用户 (MAU),${data.overview.mau || 0}\n`;
        csv += `今日新用户,${data.overview.new_users_today || 0}\n`;
        csv += `本周新用户,${data.overview.new_users_week || 0}\n`;
        csv += `积分流通总量,${data.overview.total_points || 0}\n`;
        csv += `总评论数,${data.overview.total_comments || 0}\n`;
    }
    csv += '\n';

    // ========================================
    // Section 2: User Trend (Daily)
    // ========================================
    csv += '=== 用户趋势 ===\n';
    csv += '日期,新用户数,活跃用户数\n';
    if (data.userTrend && data.userTrend.length > 0) {
        data.userTrend.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.new_users || 0},${row.active_users || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 3: Content Trend (Daily)
    // ========================================
    csv += '=== 内容趋势 ===\n';
    csv += '日期,评论数,解锁数,点赞数\n';
    if (data.contentTrend && data.contentTrend.length > 0) {
        data.contentTrend.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.comments || 0},${row.unlocks || 0},${row.likes || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 4: Revenue/Points Trend (Daily)
    // ========================================
    csv += '=== 积分趋势 ===\n';
    csv += '日期,积分收入,积分支出,兑换次数\n';
    if (data.revenueTrend && data.revenueTrend.length > 0) {
        data.revenueTrend.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.points_in || 0},${row.points_out || 0},${row.redemptions || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 5: Community Stats (Daily)
    // ========================================
    csv += '=== 社区互动 ===\n';
    csv += '日期,留言数,评论数,点赞数\n';
    if (data.communityStats && data.communityStats.length > 0) {
        data.communityStats.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.messages || 0},${row.comments || 0},${row.likes || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 6: Channel Breakdown
    // ========================================
    csv += '=== 渠道分析 ===\n';
    csv += '渠道,批次数,总码数,已使用,总积分,使用率(%)\n';
    if (data.channelBreakdown && data.channelBreakdown.length > 0) {
        data.channelBreakdown.forEach(row => {
            csv += `${row.channel || '未分类'},${row.batch_count || 0},${row.total_codes || 0},${row.used_codes || 0},${row.total_points || 0},${row.redemption_rate || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 7: Top Content
    // ========================================
    csv += '=== 热门内容 Top 100 ===\n';
    csv += '排名,Prompt ID,标题,解锁数,评论数,热度分\n';
    if (data.topContent && data.topContent.length > 0) {
        data.topContent.forEach((row, index) => {
            // Escape title if it contains comma
            const title = (row.title || '').replace(/,/g, '，');
            csv += `${index + 1},${row.prompt_id || '-'},${title},${row.unlock_count || 0},${row.comment_count || 0},${row.score || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 8: Points Distribution
    // ========================================
    csv += '=== 积分分布 ===\n';
    csv += '持有区间,用户数\n';
    if (data.pointsDistribution && data.pointsDistribution.length > 0) {
        data.pointsDistribution.forEach(row => {
            csv += `${row.range_label},${row.user_count}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 9: Points Leaderboard
    // ========================================
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

    // ========================================
    // Section 10: Redemption Funnel
    // ========================================
    csv += '=== 兑换漏斗 ===\n';
    csv += '步骤,数量,转化率(%)\n';
    if (data.redemptionFunnel && data.redemptionFunnel.length > 0) {
        data.redemptionFunnel.forEach(row => {
            csv += `${row.step},${row.count},${row.conversion_rate}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }

    // Download
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `analytics_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// Export as Excel using SheetJS
function exportAsExcel(data) {
    if (typeof XLSX === 'undefined') {
        alert('Excel 导出组件未加载，请刷新页面重试');
        return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Overview
    const overviewSheet = XLSX.utils.json_to_sheet([{
        '导出时间': data.exportDate,
        '日期范围': `${data.dateRange} 天`,
        'DAU': data.overview?.dau || 0,
        'MAU': data.overview?.mau || 0,
        '今日新用户': data.overview?.new_users_today || 0,
        '本周新用户': data.overview?.new_users_week || 0,
        '积分流通总量': data.overview?.total_points || 0,
        '总评论数': data.overview?.total_comments || 0
    }]);
    XLSX.utils.book_append_sheet(wb, overviewSheet, '概览');

    // Sheet 2: User Trend
    if (data.userTrend && data.userTrend.length > 0) {
        const trendSheet = XLSX.utils.json_to_sheet(data.userTrend.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '新用户': row.new_users || 0,
            '活跃用户': row.active_users || 0
        })));
        XLSX.utils.book_append_sheet(wb, trendSheet, '用户趋势');
    }

    // Sheet 3: Content Trend
    if (data.contentTrend && data.contentTrend.length > 0) {
        const contentSheet = XLSX.utils.json_to_sheet(data.contentTrend.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '评论数': row.comments || 0,
            '解锁数': row.unlocks || 0,
            '点赞数': row.likes || 0
        })));
        XLSX.utils.book_append_sheet(wb, contentSheet, '内容趋势');
    }

    // Sheet 4: Revenue/Points Trend
    if (data.revenueTrend && data.revenueTrend.length > 0) {
        const revenueSheet = XLSX.utils.json_to_sheet(data.revenueTrend.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '积分收入': row.points_in || 0,
            '积分支出': row.points_out || 0,
            '兑换次数': row.redemptions || 0
        })));
        XLSX.utils.book_append_sheet(wb, revenueSheet, '积分趋势');
    }

    // Sheet 5: Community Stats
    if (data.communityStats && data.communityStats.length > 0) {
        const communitySheet = XLSX.utils.json_to_sheet(data.communityStats.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '留言数': row.messages || 0,
            '评论数': row.comments || 0,
            '点赞数': row.likes || 0
        })));
        XLSX.utils.book_append_sheet(wb, communitySheet, '社区互动');
    }

    // Sheet 6: Channel Breakdown
    if (data.channelBreakdown && data.channelBreakdown.length > 0) {
        const channelSheet = XLSX.utils.json_to_sheet(data.channelBreakdown.map(row => ({
            '渠道': row.channel || '未分类',
            '批次数': row.batch_count || 0,
            '总码数': row.total_codes || 0,
            '已使用': row.used_codes || 0,
            '总积分': row.total_points || 0,
            '使用率(%)': row.redemption_rate || 0
        })));
        XLSX.utils.book_append_sheet(wb, channelSheet, '渠道分析');
    }

    // Sheet 7: Top Content
    if (data.topContent && data.topContent.length > 0) {
        const topSheet = XLSX.utils.json_to_sheet(data.topContent.map((row, index) => ({
            '排名': index + 1,
            'Prompt ID': row.prompt_id || '-',
            '标题': row.title || '',
            '解锁数': row.unlock_count || 0,
            '评论数': row.comment_count || 0,
            '热度分': row.score || 0
        })));
        XLSX.utils.book_append_sheet(wb, topSheet, '热门内容');
    }

    // Sheet 8: Points Distribution
    if (data.pointsDistribution && data.pointsDistribution.length > 0) {
        const distSheet = XLSX.utils.json_to_sheet(data.pointsDistribution.map(row => ({
            '持有区间': row.range_label,
            '用户数': row.user_count
        })));
        XLSX.utils.book_append_sheet(wb, distSheet, '积分分布');
    }

    // Sheet 9: Points Leaderboard
    if (data.pointsLeaderboard && data.pointsLeaderboard.length > 0) {
        const leadSheet = XLSX.utils.json_to_sheet(data.pointsLeaderboard.map((row, index) => ({
            '排名': index + 1,
            '用户名': row.username || '匿名',
            '积分余额': row.balance,
            '总消费': row.total_spent
        })));
        XLSX.utils.book_append_sheet(wb, leadSheet, '积分富豪榜');
    }

    // Sheet 10: Redemption Funnel
    if (data.redemptionFunnel && data.redemptionFunnel.length > 0) {
        const funnelSheet = XLSX.utils.json_to_sheet(data.redemptionFunnel.map(row => ({
            '步骤': row.step,
            '数量': row.count,
            '转化率(%)': row.conversion_rate
        })));
        XLSX.utils.book_append_sheet(wb, funnelSheet, '兑换漏斗');
    }

    // Download
    XLSX.writeFile(wb, `analytics_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', function () {
    const initAnalyticsBoot = () => {
        // Delay to ensure DOM is ready
        setTimeout(initDateRangeControls, 500);
        setTimeout(initRealtimeFeatures, 1000);
    };

    if (window.adminStudioAccessGranted) {
        initAnalyticsBoot();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initAnalyticsBoot, { once: true });
});

// Expose to window
window.applyDateRange = applyDateRange;
window.exportAnalyticsData = exportAnalyticsData;

// ============================================
// PHASE 3: REALTIME FEATURES
// ============================================

let autoRefreshInterval = null;
let currentRefreshIntervalMs = 300000; // Default 5 minutes

// Initialize realtime features
function initRealtimeFeatures() {
    // Load saved interval from localStorage
    const savedInterval = localStorage.getItem('analyticsAutoRefreshInterval');
    if (savedInterval) {
        currentRefreshIntervalMs = parseInt(savedInterval);
        const selectEl = document.getElementById('autoRefreshInterval');
        if (selectEl) selectEl.value = savedInterval;
    }

    // Auto refresh toggle
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle) {
        toggle.addEventListener('change', function () {
            if (this.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });

        // Start auto refresh by default
        startAutoRefresh();
    }

    // Initial online users update
    updateOnlineUsers();

    // Update timestamp
    updateLastUpdateTime();
}

// Update auto refresh interval from settings
function updateAutoRefreshInterval(ms) {
    currentRefreshIntervalMs = parseInt(ms);
    localStorage.setItem('analyticsAutoRefreshInterval', ms);

    // Restart auto refresh with new interval if active
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle && toggle.checked) {
        stopAutoRefresh();
        startAutoRefresh();
    }

    // Update tooltip
    const intervalText = {
        60000: '1分钟',
        180000: '3分钟',
        300000: '5分钟',
        600000: '10分钟',
        900000: '15分钟',
        1800000: '30分钟'
    }[ms] || '5分钟';

    const toggleContainer = document.querySelector('.auto-refresh-toggle');
    if (toggleContainer) {
        toggleContainer.title = `自动刷新 (${intervalText})`;
    }

    showToast(`自动刷新间隔已更新为 ${intervalText}`, 'success');
}

// Start auto refresh
function startAutoRefresh() {
    if (autoRefreshInterval) return;

    autoRefreshInterval = setInterval(() => {
        refreshAllAnalytics();
    }, currentRefreshIntervalMs);

    console.log(`[Analytics] Auto refresh started (${currentRefreshIntervalMs / 1000}s interval)`);
}

// Stop auto refresh
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    console.log('[Analytics] Auto refresh stopped');
}

// Toggle custom dropdown
function toggleCustomDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
        // Close all other dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            if (d.id !== dropdownId) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    }
}

// Select dropdown option
function selectDropdownOption(dropdownId, value, label) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
        // Update display value
        const valueEl = dropdown.querySelector('.dropdown-value');
        if (valueEl) valueEl.textContent = label;

        // Update selected state
        dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });

        // Close dropdown
        dropdown.classList.remove('open');

        // Trigger the update based on dropdown type
        if (dropdownId === 'refreshIntervalDropdown') {
            updateAutoRefreshInterval(value);
        } else if (dropdownId === 'lockoutDurationDropdown') {
            // 🔒 保存锁定时长设置
            saveSecurityDropdownSetting('lockout_duration', parseInt(value));
        } else if (dropdownId === 'sessionTimeoutDropdown') {
            // 🔒 保存会话超时设置
            saveSecurityDropdownSetting('session_timeout', parseInt(value));
        }
    }
}

// 🔒 Save security dropdown settings
async function saveSecurityDropdownSetting(key, value) {
    try {
        // Get current security config from system_config table
        const { data: currentData } = await supabaseClient
            .from('system_config')
            .select('value')
            .eq('key', 'security')
            .single();

        const config = currentData?.value || {
            login_lockout_attempts: 5,
            lockout_duration: 900000,
            session_timeout: 3600000
        };

        // Update the specific key
        config[key] = value;

        // Save back using RPC (admin-config.js saveConfig pattern)
        const { error } = await supabaseClient.rpc('update_system_config', {
            p_key: 'security',
            p_value: config
        });

        if (error) throw error;

        console.log(`✅ 安全设置已保存: ${key} = ${value}`);

        if (typeof showToast === 'function') {
            showToast('设置已保存', 'success');
        }
    } catch (err) {
        console.error('保存安全设置失败:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function (e) {
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
    }
});

// Export
window.updateAutoRefreshInterval = updateAutoRefreshInterval;
window.toggleCustomDropdown = toggleCustomDropdown;
window.selectDropdownOption = selectDropdownOption;

// Refresh all analytics data
async function refreshAllAnalytics() {
    console.log('[Analytics] Refreshing all data...');

    // Add spinning animation to all refresh buttons
    const refreshBtns = document.querySelectorAll('.toolbar-icon-btn i.fa-sync-alt, .btn-icon-sm i.fa-redo');
    refreshBtns.forEach(btn => btn.classList.add('fa-spin'));

    try {
        // Update online users
        await updateOnlineUsers();

        // Reload KPI
        if (typeof loadOverviewStats === 'function') {
            await loadOverviewStats();
        }

        // Reload charts with current date range
        const days = globalDateRange?.days || 7;
        await refreshChartsWithDateRange(days);

        // Update timestamp
        updateLastUpdateTime();

        // Show success feedback
        if (typeof showToast === 'function') {
            showToast('数据已刷新', 'success');
        }

    } catch (err) {
        console.error('[Analytics] Refresh error:', err);
        if (typeof showToast === 'function') {
            showToast('刷新失败', 'error');
        }
    } finally {
        // Remove spinning animation
        setTimeout(() => {
            refreshBtns.forEach(btn => btn.classList.remove('fa-spin'));
        }, 500);
    }
}

// Update online users count (users active in last 5 minutes)
async function updateOnlineUsers() {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const countEl = document.getElementById('onlineUsersCount');

        if (!countEl) return;

        const uniqueUsers = new Set();

        // 1. Query comments for recent activity
        try {
            let commentsQuery = supabaseClient
                .from('prompt_comments')
                .select('user_id')
                .gte('created_at', fiveMinutesAgo);
            commentsQuery = window.AdminSiteFilter?.applySiteFilter(commentsQuery) || commentsQuery;
            const { data: comments } = await commentsQuery;

            if (comments) {
                comments.forEach(c => c.user_id && uniqueUsers.add(c.user_id));
            }
        } catch (e) {
            console.warn('[Analytics] Comments query failed');
        }

        // 2. Query comment_likes for recent activity
        try {
            let likesQuery = supabaseClient
                .from('comment_likes')
                .select('user_id')
                .gte('created_at', fiveMinutesAgo);
            likesQuery = window.AdminSiteFilter?.applySiteFilter(likesQuery) || likesQuery;
            const { data: likes } = await likesQuery;

            if (likes) {
                likes.forEach(l => l.user_id && uniqueUsers.add(l.user_id));
            }
        } catch (e) {
            console.warn('[Analytics] Likes query failed');
        }

        // 3. Query user_events for page views (if table exists)
        try {
            let eventsQuery = supabaseClient
                .from('user_events')
                .select('user_id')
                .gte('created_at', fiveMinutesAgo);
            eventsQuery = window.AdminSiteFilter?.applySiteFilter(eventsQuery) || eventsQuery;
            const { data: events } = await eventsQuery;

            if (events) {
                events.forEach(ev => ev.user_id && uniqueUsers.add(ev.user_id));
            }
        } catch (e) {
            // user_events table may not exist, ignore
        }

        // 4. Fallback: check profiles updated_at
        if (uniqueUsers.size === 0) {
            try {
                const { count: profileCount } = await supabaseClient
                    .from('profiles')
                    .select('*', { count: 'exact', head: true })
                    .gte('updated_at', fiveMinutesAgo);

                if (profileCount) {
                    countEl.textContent = profileCount;
                    return;
                }
            } catch (e2) { }
        }

        countEl.textContent = uniqueUsers.size;

    } catch (err) {
        console.warn('[Analytics] Online users error:', err.message);
        const countEl = document.getElementById('onlineUsersCount');
        if (countEl) countEl.textContent = '0';
    }
}

// Update last update time
function updateLastUpdateTime() {
    const el = document.getElementById('lastUpdateTime');
    if (el) {
        const now = new Date();
        el.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    }
}

// View prompt context - jump to Gallery page with prompt highlighted
function viewPromptContext(promptId) {
    if (!promptId) return;
    // Open Gallery page with prompt ID in URL hash
    window.open(`prompts.html#prompt-${promptId}`, '_blank');
}

// Expose to window
window.refreshAllAnalytics = refreshAllAnalytics;
window.viewPromptContext = viewPromptContext;

// ============================================
// PHASE 4: ANOMALY DETECTION
// ============================================

// Store previous values for comparison
let previousValues = {
    dau: null,
    comments: null,
    points: null
};

// Check for anomalies after data refresh
async function checkForAnomalies() {
    const alerts = [];

    try {
        // Get current values
        const dauEl = document.getElementById('kpiDauValue');
        const commentsEl = document.getElementById('kpiCommentsValue');

        const currentDau = dauEl ? parseInt(dauEl.textContent) || 0 : 0;
        const currentComments = commentsEl ? parseInt(commentsEl.textContent) || 0 : 0;

        // Check DAU anomaly (drop > 50%)
        if (previousValues.dau !== null && previousValues.dau > 0) {
            const dauChange = ((currentDau - previousValues.dau) / previousValues.dau) * 100;
            if (dauChange < -50) {
                alerts.push({
                    type: 'dau_drop',
                    text: 'DAU 异常下降',
                    value: `${dauChange.toFixed(0)}%`
                });
            }
        }

        // Check for zero activity
        if (currentDau === 0 && previousValues.dau > 5) {
            alerts.push({
                type: 'zero_dau',
                text: 'DAU 降为 0',
                value: '需要关注'
            });
        }

        // Store for next comparison
        previousValues.dau = currentDau;
        previousValues.comments = currentComments;

        // Display alerts
        displayAlerts(alerts);

    } catch (err) {
        console.error('[Anomaly] Detection error:', err);
    }
}

// Display alerts in UI
function displayAlerts(alerts) {
    const area = document.getElementById('anomalyAlertsArea');
    const list = document.getElementById('alertsList');

    if (!area || !list) return;

    if (alerts.length === 0) {
        setAnalyticsVisibility(area, true);
        return;
    }

    setAnalyticsVisibility(area, false);
    list.innerHTML = alerts.map(alert => `
        <div class="alert-item">
            <i class="fas fa-exclamation-circle"></i>
            <span class="alert-text">${alert.text}</span>
            <span class="alert-value">${alert.value}</span>
        </div>
    `).join('');
}

// Dismiss all alerts
function dismissAllAlerts() {
    const area = document.getElementById('anomalyAlertsArea');
    if (area) {
        setAnalyticsVisibility(area, true);
    }
}

// Hook into refresh cycle
const originalRefresh = refreshAllAnalytics;
refreshAllAnalytics = async function () {
    await originalRefresh();
    // Check for anomalies after refresh
    setTimeout(checkForAnomalies, 500);
};

window.dismissAllAlerts = dismissAllAlerts;
