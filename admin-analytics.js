/**
 * Admin Analytics Module
 * Data visualization dashboard for Admin Studio
 */

// Chart instances
let userTrendChart = null;
let channelChart = null;
let contentTrendChart = null;
let communityChart = null;

// AI Insight cache and debounce
let aiInsightCache = null;
let aiInsightCacheTime = 0;
const AI_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let aiInsightDebounce = false;

// Helper: Get Gemini API Key (same format as admin-studio.js)
function getGeminiApiKey() {
    const storedKeys = JSON.parse(localStorage.getItem('gemini_api_keys') || '[]');
    const activeIndex = parseInt(localStorage.getItem('gemini_active_key_index') || '0');

    if (storedKeys.length > 0 && storedKeys[activeIndex]) {
        const keyEntry = storedKeys[activeIndex];
        return typeof keyEntry === 'object' ? keyEntry.key : keyEntry;
    }
    return null;
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
        ({ data, error } = await supabaseClient.rpc('get_overview_stats_with_trend'));

        if (error) {
            // Fallback to basic stats
            ({ data, error } = await supabaseClient.rpc('get_overview_stats'));
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
        const { data, error } = await supabaseClient.rpc('get_user_trend', { p_days: days });

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
        const { data, error } = await supabaseClient.rpc('get_channel_breakdown');

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
        const { data, error } = await supabaseClient.rpc('get_content_trend', { p_days: days });

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
        const { data, error } = await supabaseClient.rpc('get_content_top', { p_limit: 10 });

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
                <span class="title" title="${item.title || '无标题'}">${truncate(item.title || '无标题', 30)}</span>
                <span class="stats">
                    <span class="unlock"><i class="fas fa-unlock"></i> ${item.unlock_count}</span>
                    <span class="comment"><i class="fas fa-comment"></i> ${item.comment_count}</span>
                </span>
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
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        content.innerHTML = '<p class="ai-error">请先在设置中配置 Gemini API Key</p>';
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
        const { data, error } = await supabaseClient.rpc('get_ai_summary_data', { p_days: 7 });

        if (error) throw error;
        if (!data || !data.overview) throw new Error('数据获取失败');

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

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `API 错误 ${response.status}`);
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '分析失败，请重试';

        // Cache the result
        aiInsightCache = text;
        aiInsightCacheTime = Date.now();

        // Format and display
        content.innerHTML = `<div class="ai-report">${formatAIResponse(text)}</div>`;

    } catch (err) {
        console.error('[Analytics] AI insight error:', err);
        const errMsg = err.message || (err.details ? err.details : '未知错误');
        content.innerHTML = `<p class="ai-error">分析失败：${errMsg}</p>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> 生成分析';
    }
}

// Helper: Format AI Response
function formatAIResponse(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>')
        .replace(/^(\d+)\./gm, '<span class="ai-number">$1.</span>');
}

// Helper: Format Number
function formatNumber(num) {
    if (num === null || num === undefined) return '--';
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + 'w';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
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

// Export for global access
window.initAnalyticsModule = initAnalyticsModule;

// ============================================
// ADVANCED CHARTS
// ============================================

// Load Activity Heatmap
async function loadActivityHeatmap() {
    try {
        const { data, error } = await supabaseClient.rpc('get_activity_heatmap', { p_days: 30 });

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

                // GitHub-style green gradient (theme-aware)
                const isDark = document.documentElement.dataset.theme === 'dark';
                let cellColor;

                if (count === 0) {
                    cellColor = isDark ? '#161b22' : '#ebedf0'; // Empty cells
                } else if (intensity < 0.25) {
                    cellColor = isDark ? '#0e4429' : '#9be9a8'; // Light green
                } else if (intensity < 0.5) {
                    cellColor = isDark ? '#006d32' : '#40c463'; // Medium green
                } else if (intensity < 0.75) {
                    cellColor = isDark ? '#26a641' : '#30a14e'; // Dark green
                } else {
                    cellColor = isDark ? '#39d353' : '#216e39'; // Darkest green
                }

                html += `<div class="heatmap-cell" style="background: ${cellColor}" title="${dayNames[d]} ${h}:00 - ${count} 次活动"></div>`;
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
        const { data, error } = await supabaseClient.rpc('get_top_contributors', { p_limit: 10 });

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
        const { data, error } = await supabaseClient.rpc('get_community_stats', { p_days: days });

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
        const { data, error } = await supabaseClient.rpc('get_conversion_funnel', { p_days: 30 });

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
        const { data, error } = await supabaseClient.rpc('get_retention_cohort', { p_weeks: 8 });

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
                <td class="cohort-cell" style="--intensity: ${(row.week_0 || 0) / 100}">${row.week_0 || 0}%</td>
                <td class="cohort-cell" style="--intensity: ${(row.week_1 || 0) / 100}">${row.week_1 || 0}%</td>
                <td class="cohort-cell" style="--intensity: ${(row.week_2 || 0) / 100}">${row.week_2 || 0}%</td>
                <td class="cohort-cell" style="--intensity: ${(row.week_3 || 0) / 100}">${row.week_3 || 0}%</td>
                <td class="cohort-cell" style="--intensity: ${(row.week_4 || 0) / 100}">${row.week_4 || 0}%</td>
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
        const { data, error } = await supabaseClient.rpc('get_points_flow', { p_days: 30 });

        if (error) throw error;

        const container = document.getElementById('pointsFlow');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-exchange-alt"></i>
                <span>暂无积分流向数据</span>
            </div>`;
            return;
        }

        // Group by source -> target
        const inflows = data.filter(d => d.target_node === '用户余额');
        const outflows = data.filter(d => d.source_node === '用户余额');

        let html = '<div class="points-flow-container">';

        // Inflows
        html += '<div class="flow-section"><h4><i class="fas fa-arrow-right" style="color:#22c55e"></i> 收入来源</h4>';
        inflows.forEach(item => {
            html += `<div class="flow-item inflow">
                <span class="flow-label">${item.source_node}</span>
                <span class="flow-value">+${formatNumber(item.value)}</span>
            </div>`;
        });
        html += '</div>';

        // Outflows
        html += '<div class="flow-section"><h4><i class="fas fa-arrow-left" style="color:#ef4444"></i> 消费去向</h4>';
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
    }
}

// ============================================
// PHASE 12: AI PREDICTION
// ============================================

async function loadAIPrediction() {
    const container = document.getElementById('aiPredictionContent');
    if (!container) return;

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        container.innerHTML = '<p class="ai-error">请先配置 Gemini API Key</p>';
        return;
    }

    container.innerHTML = '<p class="ai-loading">AI 正在生成预测...</p>';

    try {
        // Get trend data
        const { data, error } = await supabaseClient.rpc('get_user_trend', { p_days: 30 });
        if (error) throw error;

        const prompt = `基于以下30天的用户数据趋势，预测未来7天的走势（每天一个数字）。
只返回JSON数组格式，例如: [15, 18, 20, 22, 19, 21, 25]

数据：${JSON.stringify(data.map(d => d.new_users))}`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

        // Parse prediction
        const match = text.match(/\[[\d,\s]+\]/);
        if (match) {
            const predictions = JSON.parse(match[0]);
            container.innerHTML = `
                <div class="prediction-result">
                    <p><strong>未来7天预测:</strong></p>
                    <div class="prediction-values">
                        ${predictions.map((v, i) => `<span class="pred-day">D${i + 1}: ${v}</span>`).join('')}
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = '<p class="ai-error">预测解析失败</p>';
        }

    } catch (err) {
        console.error('[Analytics] AI prediction error:', err);
        container.innerHTML = `<p class="ai-error">预测失败: ${err.message}</p>`;
    }
}

// ============================================
// PHASE 11: GEO DISTRIBUTION
// ============================================

// Geo chart instance
let geoChart = null;

async function loadGeoDistribution() {
    try {
        const { data, error } = await supabaseClient.rpc('get_geo_distribution');

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

function openExperimentModal() {
    const modal = document.getElementById('experimentModal');
    if (modal) {
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
        <button type="button" class="btn-icon-sm" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    list.appendChild(row);
}

async function handleCreateExperiment(event) {
    event.preventDefault();

    const name = document.getElementById('expName').value.trim();
    const description = document.getElementById('expDescription').value.trim();

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
window.openExperimentModal = openExperimentModal;
window.closeExperimentModal = closeExperimentModal;
window.addVariantRow = addVariantRow;
window.handleCreateExperiment = handleCreateExperiment;
