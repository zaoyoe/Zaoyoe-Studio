(function () {
    'use strict';

    const state = {
        initialized: false,
        initializing: false,
        loading: false,
        cleanupLoading: false,
        days: 30,
        activeTab: 'overview',
        listenersBound: false,
        summary: null,
        cleanupPreview: null,
        requestToken: 0,
        viewCache: {},
        tooltipElement: null,
        tooltipTarget: null
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNumber(value) {
        const num = Number(value || 0);
        return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '0';
    }

    function formatCurrency(value) {
        const num = Number(value || 0);
        return Number.isFinite(num)
            ? `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
            : '¥0';
    }

    function formatPoints(value) {
        const num = Number(value || 0);
        return Number.isFinite(num)
            ? num.toLocaleString('zh-CN', { minimumFractionDigits: num % 1 ? 1 : 0, maximumFractionDigits: 1 })
            : '0';
    }

    function formatSignedPoints(value) {
        const num = Number(value || 0);
        if (!Number.isFinite(num)) return '0';
        const sign = num > 0 ? '+' : '';
        return `${sign}${num.toLocaleString('zh-CN', { minimumFractionDigits: num % 1 ? 1 : 0, maximumFractionDigits: 1 })}`;
    }

    function formatPercent(value) {
        const num = Number(value || 0);
        return Number.isFinite(num) ? `${num.toFixed(2).replace(/\.00$/, '')}%` : '0%';
    }

    function getFriendlyErrorMessage(error, fallback = '支付数据刷新失败，请稍后重试。') {
        const message = String(error?.message || '').trim();
        if (!message || message === 'Failed to fetch' || message === 'NetworkError when attempting to fetch resource.') {
            return fallback;
        }
        return message;
    }

    function renderInfoChip(help) {
        if (!help) return '';
        return `
            <button type="button" class="payments-info-chip" data-payments-tooltip="${escapeHtml(help)}" aria-label="查看说明">
                <span class="payments-info-glyph" aria-hidden="true"></span>
            </button>
        `;
    }

    function ensureTooltipElement() {
        const existingElements = Array.from(document.querySelectorAll('.payments-floating-tooltip'));
        if (existingElements.length > 1) {
            existingElements.slice(1).forEach((el) => el.remove());
        }

        const existing = existingElements[0];
        if (existing && document.body.contains(existing)) {
            state.tooltipElement = existing;
            return existing;
        }

        const element = document.createElement('div');
        element.className = 'payments-floating-tooltip';
        element.hidden = true;
        document.body.appendChild(element);
        state.tooltipElement = element;
        return element;
    }

    function positionTooltip(target, tooltip) {
        if (!target || !tooltip) return;

        const rect = target.getBoundingClientRect();
        const width = tooltip.offsetWidth || 260;
        const height = tooltip.offsetHeight || 64;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const gutter = 14;

        let left = rect.left + rect.width / 2 - width / 2;
        left = Math.max(gutter, Math.min(left, viewportWidth - width - gutter));

        let top = rect.bottom + 14;
        let placeAbove = false;
        if (top + height + gutter > viewportHeight) {
            placeAbove = true;
            top = rect.top - height - 14;
        }
        top = Math.max(gutter, top);

        const targetCenter = rect.left + rect.width / 2;
        const arrowLeft = Math.max(20, Math.min(width - 20, targetCenter - left));

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.setProperty('--payments-tooltip-arrow-left', `${arrowLeft}px`);
        tooltip.classList.toggle('is-above', placeAbove);
    }

    function showInfoTooltip(target) {
        const help = String(target?.dataset?.paymentsTooltip || '').trim();
        if (!help) return;

        const tooltip = ensureTooltipElement();
        tooltip.textContent = help;
        tooltip.hidden = false;
        tooltip.classList.add('is-visible');
        positionTooltip(target, tooltip);
        state.tooltipTarget = target;
    }

    function hideInfoTooltip() {
        const tooltip = state.tooltipElement;
        if (!tooltip) return;
        tooltip.hidden = true;
        tooltip.classList.remove('is-visible', 'is-above');
        tooltip.style.left = '';
        tooltip.style.top = '';
        tooltip.style.removeProperty('--payments-tooltip-arrow-left');
        state.tooltipTarget = null;
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function getStatusLabel(status) {
        const map = {
            paid: '已支付',
            redeemed: '已兑换',
            pending_review: '待审核',
            rejected: '已拒绝',
            amount_mismatch: '金额异常',
            pending: '待处理',
            refunded: '已退款',
            expired: '已过期'
        };
        return map[String(status || '')] || String(status || '未知');
    }

    function getProviderLabel(provider) {
        const map = {
            mock: '模拟支付',
            afdian: '爱发电',
            hupijiao: '虎皮椒'
        };
        return map[String(provider || '').trim().toLowerCase()] || String(provider || '未知通道');
    }

    function getProviderIcon(provider) {
        const map = {
            mock: 'fas fa-bolt',
            afdian: 'fas fa-heart',
            hupijiao: 'fas fa-pepper-hot'
        };
        return map[String(provider || '').trim().toLowerCase()] || 'fas fa-credit-card';
    }

    function getSeverityLabel(severity) {
        const map = {
            critical: '高危',
            warning: '需跟进',
            info: '提示'
        };
        return map[String(severity || '')] || '提示';
    }

    function getRangeLabel(days) {
        const num = Number(days || state.days || 30);
        const labels = {
            7: '最近 7 天',
            30: '最近 30 天',
            90: '最近 90 天',
            365: '最近 1 年'
        };
        return labels[num] || `最近 ${num} 天`;
    }

    function getCurrentCacheKey() {
        const site = getSiteParam() || 'all';
        return `${state.days}:${site}`;
    }

    async function getAccessToken() {
        const client = window.supabaseClient;
        if (!client) return '';

        const { data } = await client.auth.getSession();
        return data?.session?.access_token || '';
    }

    async function fetchAdminJson(url, options = {}) {
        const token = await getAccessToken();
        const headers = {
            ...(options.headers || {})
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        if (options.body && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url, {
            ...options,
            headers
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            const error = new Error(payload?.message || '请求失败');
            error.statusCode = response.status;
            throw error;
        }

        return payload;
    }

    function hasCachedDataForTab(tabId) {
        const normalizedTab = String(tabId || 'overview');
        if (state.viewCache[normalizedTab] !== getCurrentCacheKey()) {
            return false;
        }

        const data = state.summary || {};
        if (normalizedTab === 'overview') {
            return Boolean(data.overview) && Array.isArray(data.provider_stats);
        }
        if (normalizedTab === 'finance') {
            return Boolean(data.sitewide_summary)
                && Array.isArray(data.business_breakdown)
                && Array.isArray(data.points_breakdown);
        }
        if (normalizedTab === 'ops') {
            return Array.isArray(data.recent_anomalies) && Array.isArray(data.recent_orders);
        }
        return false;
    }

    async function ensureAdminAccess() {
        if (window.isAdmin) return true;
        if (typeof window.loadUserPermissions === 'function') {
            await window.loadUserPermissions();
        }
        return Boolean(window.isAdmin);
    }

    function getSiteParam() {
        return window.AdminSiteFilter?.getSiteParam?.() || null;
    }

    function setToolbarMeta(text, tone = 'muted') {
        const target = document.getElementById('paymentsToolbarMeta');
        if (!target) return;
        target.textContent = text || '';
        target.dataset.tone = tone;
    }

    function updateRangeLabel() {
        const label = document.getElementById('paymentsRangeLabel');
        if (label) {
            label.textContent = getRangeLabel(state.days);
        }

        document.querySelectorAll('.payments-range-btn').forEach((button) => {
            const buttonDays = Number(button.dataset.days || 0);
            button.classList.toggle('active', buttonDays === state.days);
        });
    }

    function closeRangeMenu() {
        const dropdown = document.getElementById('paymentsRangeDropdown');
        if (dropdown) {
            dropdown.classList.remove('open');
        }
    }

    function toggleRangeMenu(event) {
        if (event) event.stopPropagation();
        const dropdown = document.getElementById('paymentsRangeDropdown');
        if (!dropdown) return;
        dropdown.classList.toggle('open');
    }

    function updateToolbarHighlights(data) {
        const target = document.getElementById('paymentsToolbarHighlights');
        if (!target) return;

        const overview = data?.overview || {};
        const anomaly = data?.anomaly_summary || {};
        const sitewide = data?.sitewide_summary || {};
        const providerCount = Array.isArray(data?.provider_stats) ? data.provider_stats.length : 0;
        const anomalyCount = Number(anomaly.review_orders || 0)
            + Number(anomaly.failed_orders || 0)
            + Number(anomaly.recent_event_anomalies || 0);
        const incomeValue = sitewide.recharge_amount != null
            ? sitewide.recharge_amount
            : overview.total_amount;

        target.innerHTML = `
            <div class="payments-highlight-pill">
                <i class="fas fa-credit-card"></i>
                <span>通道 ${escapeHtml(formatNumber(providerCount))}</span>
            </div>
            <div class="payments-highlight-pill">
                <i class="fas fa-circle-check"></i>
                <span>成功率 ${escapeHtml(formatPercent(overview.paid_rate))}</span>
            </div>
            <div class="payments-highlight-pill ${anomalyCount > 0 ? 'warning' : ''}">
                <i class="fas fa-triangle-exclamation"></i>
                <span>异常 ${escapeHtml(formatNumber(anomalyCount))}</span>
            </div>
            <div class="payments-highlight-pill">
                <i class="fas fa-wallet"></i>
                <span>收入 ${escapeHtml(formatCurrency(incomeValue))}</span>
            </div>
        `;
    }

    function syncTabIndicator() {
        const nav = document.getElementById('paymentsTabsNav');
        if (!nav) return;
        const activeButton = nav.querySelector('.admin-tab.active');
        if (!activeButton) return;

        if (typeof window.updateAdminTabIndicator === 'function') {
            window.updateAdminTabIndicator(activeButton);
            return;
        }

        const indicator = nav.querySelector('.admin-tab-indicator');
        if (indicator) {
            indicator.style.left = `${activeButton.offsetLeft}px`;
            indicator.style.width = `${activeButton.offsetWidth}px`;
            indicator.style.opacity = '1';
        }
    }

    function switchTab(tabId, options = {}) {
        const shouldReload = options.reload !== false;
        state.activeTab = String(tabId || 'overview');
        const nav = document.getElementById('paymentsTabsNav');
        if (nav) {
            nav.querySelectorAll('.admin-tab').forEach((button) => {
                button.classList.toggle('active', button.dataset.tab === state.activeTab);
            });
        }

        document.querySelectorAll('.payments-tab-content').forEach((section) => {
            section.classList.toggle('active', section.id === `payments-tab-${state.activeTab}`);
        });

        syncTabIndicator();
        window.dispatchEvent(new Event('resize'));

        if (shouldReload && state.initialized && !state.loading && !hasCachedDataForTab(state.activeTab)) {
            reload();
        }
    }

    function renderAccessState(message, tone = 'warning', options = {}) {
        const stateEl = document.getElementById('paymentsAccessState');
        const bodyEl = document.getElementById('paymentsDashboardBody');
        if (!stateEl || !bodyEl) return;
        const preserveBody = options.preserveBody === true;

        stateEl.className = `payments-access-state ${tone}`;
        stateEl.innerHTML = `
            <i class="fas ${tone === 'error' ? 'fa-ban' : 'fa-shield-alt'}"></i>
            <span>${escapeHtml(message)}</span>
        `;
        stateEl.hidden = false;
        bodyEl.hidden = preserveBody ? false : true;
    }

    function clearAccessState() {
        const stateEl = document.getElementById('paymentsAccessState');
        const bodyEl = document.getElementById('paymentsDashboardBody');
        if (!stateEl || !bodyEl) return;
        stateEl.hidden = true;
        bodyEl.hidden = false;
    }

    function setLoading(loading) {
        state.loading = loading;
        const refreshBtn = document.getElementById('paymentsRefreshBtn');
        if (refreshBtn) {
            refreshBtn.disabled = loading;
            refreshBtn.innerHTML = loading
                ? '<i class="fas fa-spinner fa-spin"></i>'
                : '<i class="fas fa-sync-alt"></i>';
            refreshBtn.title = loading ? '正在刷新支付数据' : '刷新支付数据';
        }
        setToolbarMeta(loading ? '正在刷新支付数据…' : '支付数据已同步', loading ? 'info' : 'ready');
    }

    function setCleanupLoading(loading) {
        state.cleanupLoading = loading;
        const cleanupBtn = document.getElementById('paymentsCleanupBtn');
        const previewBtn = document.getElementById('paymentsCleanupPreviewBtn');
        if (cleanupBtn) {
            cleanupBtn.disabled = loading;
            cleanupBtn.innerHTML = loading
                ? '<i class="fas fa-spinner fa-spin"></i> 清理中'
                : '<i class="fas fa-broom"></i> 清理测试数据';
        }
        if (previewBtn) {
            previewBtn.disabled = loading;
        }
    }

    function renderMetricCards(target, cards) {
        if (!target) return;

        target.innerHTML = cards.map((card) => `
            <div class="kpi-card payments-kpi-card-visual ${card.tone ? `is-${card.tone}` : ''}">
                <div class="kpi-icon payments-kpi-icon">
                    <i class="${escapeHtml(card.icon || 'fas fa-chart-line')}"></i>
                </div>
                <div class="kpi-content">
                    <div class="kpi-value-row">
                        <div class="kpi-value">${escapeHtml(card.value)}</div>
                        ${card.badge ? `<div class="kpi-trend ${card.badgeTone ? `trend-${card.badgeTone}` : ''}">${escapeHtml(card.badge)}</div>` : ''}
                    </div>
                    <div class="payments-kpi-label-row">
                        <div class="kpi-label">${escapeHtml(card.label)}</div>
                        ${renderInfoChip(card.help)}
                    </div>
                </div>
            </div>
        `).join('');
    }

    function renderOverviewCards(data) {
        const overview = data?.overview || {};
        const anomaly = data?.anomaly_summary || {};
        const target = document.getElementById('paymentsOverviewGrid');
        if (!target) return;

        const cards = [
            {
                icon: 'fas fa-file-invoice-dollar',
                label: '总订单',
                value: formatNumber(overview.total_orders),
                help: `近 ${state.days} 天支付订单总数`
            },
            {
                icon: 'fas fa-circle-check',
                label: '支付成功率',
                value: formatPercent(overview.paid_rate),
                help: `${formatNumber(overview.paid_orders)} 笔已支付/已兑换`
            },
            {
                icon: 'fas fa-user-check',
                label: '认领率',
                value: formatPercent(overview.claim_rate),
                help: `${formatNumber(overview.claimed_orders)} 笔已认领`
            },
            {
                icon: 'fas fa-sack-dollar',
                label: '支付金额',
                value: formatCurrency(overview.total_amount),
                help: `${formatNumber(overview.total_points)} 已入账`
            },
            {
                icon: 'fas fa-hourglass-half',
                label: '待审核',
                value: formatNumber(anomaly.review_orders),
                help: '套餐匹配、金额或签名需人工确认',
                tone: 'warning'
            },
            {
                icon: 'fas fa-triangle-exclamation',
                label: '失败订单',
                value: formatNumber(anomaly.failed_orders),
                help: '签名失败或金额校验失败',
                tone: 'critical'
            },
            {
                icon: 'fas fa-unlink',
                label: '未认领订单',
                value: formatNumber(anomaly.unclaimed_paid_orders),
                help: '已支付但尚未输入订单号',
                tone: 'info'
            },
            {
                icon: 'fas fa-wave-square',
                label: '异常回调',
                value: formatNumber(anomaly.recent_event_anomalies),
                help: `${formatNumber(anomaly.duplicate_webhook_orders)} 个订单出现重复回调`,
                tone: 'warning'
            }
        ];

        renderMetricCards(target, cards);
    }

    function renderProviderStats(data) {
        const target = document.getElementById('paymentsProviderStats');
        if (!target) return;
        const providerStats = Array.isArray(data?.provider_stats) ? data.provider_stats : [];

        if (!providerStats.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无支付通道数据。</div>';
            return;
        }

        target.innerHTML = providerStats.map((item) => `
            <div class="payments-provider-row">
                <div class="payments-provider-copy">
                    <div class="payments-provider-name"><i class="${escapeHtml(getProviderIcon(item.provider))}"></i>${escapeHtml(getProviderLabel(item.provider))}</div>
                    <div class="payments-provider-meta">
                        ${escapeHtml(formatNumber(item.total_orders))} 单
                        · 支付成功 ${escapeHtml(formatPercent(item.paid_rate))}
                        · 认领 ${escapeHtml(formatPercent(item.claim_rate))}
                    </div>
                    <div class="payments-provider-extra">
                        <span>${escapeHtml(formatCurrency(item.total_amount))}</span>
                        <span>${escapeHtml(formatPoints(item.total_points))}</span>
                    </div>
                </div>
                <div class="payments-provider-badges">
                    <span class="payments-mini-badge">${escapeHtml(formatNumber(item.review_orders))} 待审核</span>
                    <span class="payments-mini-badge danger">${escapeHtml(formatNumber(item.failed_orders))} 异常</span>
                </div>
            </div>
        `).join('');
    }

    function renderSitewideSummary(data) {
        const target = document.getElementById('paymentsSitewideGrid');
        if (!target) return;

        const summary = data?.sitewide_summary || {};
        const cards = [
            {
                icon: 'fas fa-wallet',
                label: '充值收入',
                value: formatCurrency(summary.recharge_amount),
                help: `${formatNumber(summary.recharge_order_count)} 笔充值 · ${formatPoints(summary.recharge_points)} 已入账`
            },
            {
                icon: 'fas fa-store',
                label: '商城消耗',
                value: formatPoints(summary.shop_points_spent),
                help: `${formatNumber(summary.shop_order_count)} 笔消费 · 退款 ${formatPoints(summary.refunded_shop_points)}`
            },
            {
                icon: 'fas fa-arrow-trend-up',
                label: '流入',
                value: formatPoints(summary.points_inflow),
                help: '包含充值、兑换码、奖励和管理入账'
            },
            {
                icon: 'fas fa-arrow-trend-down',
                label: '流出',
                value: formatPoints(summary.points_outflow),
                help: '包含商城消费、内容解锁、验证和管理扣减',
                tone: 'warning'
            },
            {
                icon: 'fas fa-scale-balanced',
                label: '净流动',
                value: formatSignedPoints(summary.net_points_flow),
                help: '流入减去流出后的净变化'
            },
            {
                icon: 'fas fa-coins',
                label: '当前流通余额',
                value: formatPoints(summary.circulating_points),
                help: `付费 ${formatPoints(summary.paid_balance)} · 奖励 ${formatPoints(summary.bonus_balance)}`
            }
        ];

        renderMetricCards(target, cards);
    }

    function renderBusinessBreakdown(data) {
        const target = document.getElementById('paymentsBusinessBreakdown');
        if (!target) return;
        const items = Array.isArray(data?.business_breakdown) ? data.business_breakdown : [];

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">当前暂无全站业务收支数据。</div>';
            return;
        }

        target.innerHTML = items.map((item) => `
            <div class="payments-breakdown-card">
                <div class="payments-row-head">
                    <div class="payments-row-title-wrap">
                        <div class="payments-breakdown-title">${escapeHtml(item.title || '业务项')}</div>
                        ${renderInfoChip(item.help || '')}
                    </div>
                    <div class="payments-row-metric-wrap">
                        <div class="payments-breakdown-metric">${escapeHtml(item.metric || '—')}</div>
                    </div>
                </div>
                <div class="payments-breakdown-description">${escapeHtml(item.description || '')}</div>
                <div class="payments-breakdown-meta">${escapeHtml(item.meta || '')}</div>
            </div>
        `).join('');
    }

    function renderPointsBreakdown(data) {
        const target = document.getElementById('paymentsPointsBreakdown');
        if (!target) return;
        const items = Array.isArray(data?.points_breakdown) ? data.points_breakdown : [];

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无积分流水可汇总。</div>';
            return;
        }

        target.innerHTML = `
            <div class="payments-points-table">
                ${items.map((item) => `
                    <div class="payments-points-row">
                        <div class="payments-row-head">
                            <div class="payments-row-title-wrap">
                                <div class="payments-points-label">${escapeHtml(item.label || item.key || '未分类')}</div>
                                ${renderInfoChip(item.help || '')}
                            </div>
                            <div class="payments-row-metric-wrap">
                                <div class="payments-points-net ${Number(item.net || 0) < 0 ? 'is-negative' : 'is-positive'}">${escapeHtml(formatSignedPoints(item.net))}</div>
                            </div>
                        </div>
                        <div class="payments-points-values">
                            <span>流入 ${escapeHtml(formatPoints(item.inflow))}</span>
                            <span>流出 ${escapeHtml(formatPoints(item.outflow))}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderTrend(data) {
        const target = document.getElementById('paymentsTrendChart');
        const legend = document.getElementById('paymentsTrendLegend');
        if (!target || !legend) return;

        const items = Array.isArray(data?.trend_24h) ? data.trend_24h : [];
        const maxValue = items.reduce((max, item) => Math.max(max, Number(item.total_events || 0), Number(item.anomaly_events || 0)), 1);

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">最近 24 小时暂无回调数据。</div>';
            legend.innerHTML = '';
            return;
        }

        target.innerHTML = `
            <div class="payments-trend-bars">
                ${items.map((item) => {
                    const totalHeight = Math.max(6, Math.round((Number(item.total_events || 0) / maxValue) * 100));
                    const anomalyHeight = Math.max(0, Math.round((Number(item.anomaly_events || 0) / maxValue) * 100));
                    return `
                        <div class="payments-trend-bar" title="${escapeHtml(item.label)} · 总回调 ${escapeHtml(formatNumber(item.total_events))} · 异常 ${escapeHtml(formatNumber(item.anomaly_events))}">
                            <div class="payments-trend-bar-total" style="height:${totalHeight}%"></div>
                            <div class="payments-trend-bar-anomaly" style="height:${anomalyHeight}%"></div>
                            <span>${escapeHtml(item.label.slice(6))}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        const totalEvents = items.reduce((sum, item) => sum + Number(item.total_events || 0), 0);
        const anomalyEvents = items.reduce((sum, item) => sum + Number(item.anomaly_events || 0), 0);
        const failedEvents = items.reduce((sum, item) => sum + Number(item.failed_events || 0), 0);
        legend.innerHTML = `
            <span><i class="fas fa-circle"></i> 总回调 ${escapeHtml(formatNumber(totalEvents))}</span>
            <span class="danger"><i class="fas fa-circle"></i> 异常 ${escapeHtml(formatNumber(anomalyEvents))}</span>
            <span class="warning"><i class="fas fa-circle"></i> 高危 ${escapeHtml(formatNumber(failedEvents))}</span>
        `;
    }

    function renderAnomalies(data) {
        const target = document.getElementById('paymentsAnomalyList');
        if (!target) return;
        const anomalies = Array.isArray(data?.recent_anomalies) ? data.recent_anomalies : [];

        if (!anomalies.length) {
            target.innerHTML = '<div class="payments-empty-state">当前没有新的异常项，继续保持监控即可。</div>';
            return;
        }

        function getHandlingSuggestion(item) {
            const title = String(item?.title || '');
            const message = String(item?.message || '');

            if (title.includes('签名') || message.toLowerCase().includes('signature')) {
                return '处理建议：检查支付通道密钥、回调签名算法和回调来源地址。';
            }
            if (title.includes('金额') || message.includes('金额')) {
                return '处理建议：核对套餐价格、支付金额和通道回传金额是否一致。';
            }
            if (title.includes('未认领') || message.includes('未输入订单号')) {
                return '处理建议：提醒用户在钱包输入订单号，或后台人工补认领。';
            }
            if (title.includes('待审核')) {
                return '处理建议：检查套餐映射、金额校验和订单来源后再决定是否放行。';
            }
            return '处理建议：先核对订单号、支付通道配置和回调时间，再决定是否人工补单。';
        }

        target.innerHTML = anomalies.map((item) => `
            <div class="payments-anomaly-item severity-${escapeHtml(item.severity || 'info')}">
                <div class="payments-anomaly-top">
                    <div class="payments-anomaly-title">${escapeHtml(item.title || '异常项')}</div>
                    <span class="payments-anomaly-severity">${escapeHtml(getSeverityLabel(item.severity))}</span>
                </div>
                <div class="payments-anomaly-message">${escapeHtml(item.message || '')}</div>
                <div class="payments-anomaly-suggestion">${escapeHtml(getHandlingSuggestion(item))}</div>
                <div class="payments-anomaly-meta">
                    <span>${escapeHtml(item.type === 'event' ? '回调事件' : '订单')}</span>
                    <span>${escapeHtml(getProviderLabel(item.provider))}</span>
                    <span>${escapeHtml(item.provider_order_no || '无订单号')}</span>
                    <span>${escapeHtml(formatDateTime(item.created_at))}</span>
                </div>
            </div>
        `).join('');
    }

    function renderOrders(data) {
        const target = document.getElementById('paymentsOrdersTable');
        if (!target) return;
        const orders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];

        if (!orders.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无支付订单。</div>';
            return;
        }

        target.innerHTML = `
            <div class="payments-table-wrap">
                <table class="payments-table">
                    <thead>
                        <tr>
                            <th>订单号</th>
                            <th>套餐</th>
                            <th>金额</th>
                            <th>积分</th>
                            <th>状态</th>
                            <th>站点</th>
                            <th>创建时间</th>
                            <th>认领时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${orders.map((order) => `
                            <tr>
                                <td>
                                    <div class="payments-order-no">${escapeHtml(order.provider_order_no || '—')}</div>
                                    <div class="payments-order-provider">${escapeHtml(getProviderLabel(order.provider))}</div>
                                </td>
                                <td>${escapeHtml(order.package_name || '未匹配套餐')}</td>
                                <td>${escapeHtml(formatCurrency(order.paid_amount))}</td>
                                <td>${escapeHtml(formatNumber(order.points_amount))}</td>
                                <td><span class="payments-status-badge status-${escapeHtml(order.status || 'pending')}">${escapeHtml(getStatusLabel(order.status))}</span></td>
                                <td>${escapeHtml((order.site || 'cn').toUpperCase())}</td>
                                <td>${escapeHtml(formatDateTime(order.created_at))}</td>
                                <td>${escapeHtml(formatDateTime(order.claimed_at))}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderCleanupPreview(payload) {
        const target = document.getElementById('paymentsCleanupPreview');
        if (!target) return;

        const preview = payload?.preview || payload || {};
        const counts = preview.counts || {};
        const sampleOrders = preview.samples?.orders || [];
        const sampleUsers = preview.samples?.users || [];
        state.cleanupPreview = preview;

        target.innerHTML = `
            <div class="payments-cleanup-grid">
                <div class="payments-cleanup-stat">
                    <span>测试订单</span>
                    <strong>${escapeHtml(formatNumber(counts.payment_orders))}</strong>
                </div>
                <div class="payments-cleanup-stat">
                    <span>测试回调</span>
                    <strong>${escapeHtml(formatNumber(counts.payment_events))}</strong>
                </div>
                <div class="payments-cleanup-stat">
                    <span>爱发电映射单</span>
                    <strong>${escapeHtml(formatNumber(counts.afdian_orders))}</strong>
                </div>
                <div class="payments-cleanup-stat">
                    <span>测试账号</span>
                    <strong>${escapeHtml(formatNumber(counts.auth_users))}</strong>
                </div>
            </div>
            <div class="payments-cleanup-note">
                只会清理订单号前缀为 <code>AUTO_CDX_</code> 的测试订单，以及邮箱匹配 <code>codex.*@example.com</code> 的测试账号。
            </div>
            <div class="payments-cleanup-samples">
                <div>
                    <h4>样例订单</h4>
                    ${sampleOrders.length ? `
                        <ul>
                            ${sampleOrders.map((item) => `<li>${escapeHtml(item.provider_order_no)} · ${escapeHtml(getStatusLabel(item.status))} · ${escapeHtml(formatDateTime(item.created_at))}</li>`).join('')}
                        </ul>
                    ` : '<div class="payments-empty-state compact">未扫描到测试订单。</div>'}
                </div>
                <div>
                    <h4>样例账号</h4>
                    ${sampleUsers.length ? `
                        <ul>
                            ${sampleUsers.map((item) => `<li>${escapeHtml(item.email || item.id)}</li>`).join('')}
                        </ul>
                    ` : '<div class="payments-empty-state compact">未扫描到测试账号。</div>'}
                </div>
            </div>
        `;
    }

    function renderCleanupPreviewFallback(message) {
        const target = document.getElementById('paymentsCleanupPreview');
        if (!target) return;
        state.cleanupPreview = null;

        target.innerHTML = `
            <div class="payments-access-state warning">
                <i class="fas fa-triangle-exclamation"></i>
                <span>${escapeHtml(message || '测试数据扫描暂时不可用，请稍后再试。')}</span>
            </div>
            <div class="payments-cleanup-note">
                不影响上方支付概览和异常队列。这个区域仅用于清理 <code>AUTO_CDX_</code> 测试订单与 <code>codex.*@example.com</code> 测试账号。
            </div>
        `;
    }

    async function loadSummary(requestToken) {
        const site = getSiteParam();
        const query = new URLSearchParams({
            days: String(state.days),
            view: String(state.activeTab || 'overview')
        });

        if (site) {
            query.set('site', site);
        }

        const payload = await fetchAdminJson(`/api/admin/payments/summary?${query.toString()}`);
        if (requestToken !== state.requestToken) {
            return false;
        }

        state.summary = {
            ...(state.summary || {}),
            ...payload
        };

        const data = state.summary;
        state.viewCache[state.activeTab] = getCurrentCacheKey();
        updateToolbarHighlights(data);
        renderOverviewCards(data);
        renderProviderStats(data);
        renderSitewideSummary(data);
        renderBusinessBreakdown(data);
        renderPointsBreakdown(data);
        renderTrend(data);
        renderAnomalies(data);
        renderOrders(data);

        const siteLabel = site ? `站点 ${(site || '').toUpperCase()}` : '全部站点';
        setToolbarMeta(`${siteLabel} · ${getRangeLabel(state.days)} · 更新于 ${formatDateTime(new Date().toISOString())}`, 'ready');
        return true;
    }

    async function loadCleanupPreview({ silent = false } = {}) {
        const payload = await fetchAdminJson('/api/admin/payments/cleanup');
        renderCleanupPreview(payload);
        if (!silent && typeof window.showToast === 'function') {
            window.showToast('已刷新测试数据扫描结果', 'success');
        }
    }

    async function init() {
        if (state.initializing) return;
        state.initializing = true;
        try {
            if (!(await ensureAdminAccess())) {
                renderAccessState('当前账号没有支付对账权限，请使用管理员账号登录后再试。', 'error');
                return;
            }

            clearAccessState();

            if (state.initialized) {
                updateRangeLabel();
                switchTab(state.activeTab, { reload: false });
                return reload();
            }

            state.initialized = true;

            if (!state.listenersBound) {
                document.addEventListener('click', (event) => {
                    if (!event.target.closest('#paymentsRangeDropdown')) {
                        closeRangeMenu();
                    }
                });
                document.addEventListener('mouseover', (event) => {
                    const chip = event.target.closest('.payments-info-chip[data-payments-tooltip]');
                    if (!chip) return;
                    showInfoTooltip(chip);
                });
                document.addEventListener('mouseout', (event) => {
                    const chip = event.target.closest('.payments-info-chip[data-payments-tooltip]');
                    if (!chip) return;
                    hideInfoTooltip();
                });
                document.addEventListener('focusin', (event) => {
                    const chip = event.target.closest('.payments-info-chip[data-payments-tooltip]');
                    if (!chip) return;
                    showInfoTooltip(chip);
                });
                document.addEventListener('focusout', (event) => {
                    const chip = event.target.closest('.payments-info-chip[data-payments-tooltip]');
                    if (!chip) return;
                    hideInfoTooltip();
                });
                window.addEventListener('scroll', hideInfoTooltip, true);
                window.addEventListener('resize', syncTabIndicator);
                window.addEventListener('resize', hideInfoTooltip);
                state.listenersBound = true;
            }

            updateRangeLabel();
            switchTab(state.activeTab, { reload: false });
            await reload();
        } finally {
            state.initializing = false;
        }
    }

    async function reload() {
        if (!(await ensureAdminAccess())) {
            renderAccessState('当前账号没有支付对账权限，请使用管理员账号登录后再试。', 'error');
            return;
        }

        const requestToken = Date.now() + Math.random();
        state.requestToken = requestToken;

        try {
            clearAccessState();
            syncTabIndicator();
            setLoading(true);
            const applied = await loadSummary(requestToken);
            if (!applied || requestToken !== state.requestToken) {
                return;
            }

            if (state.activeTab === 'ops') {
                try {
                    await loadCleanupPreview({ silent: true });
                } catch (cleanupError) {
                    console.error('[AdminPayments] Failed to load cleanup preview:', cleanupError);
                    renderCleanupPreviewFallback(getFriendlyErrorMessage(cleanupError, '测试数据扫描失败，但不影响支付对账查看。'));
                }
            }
        } catch (error) {
            if (requestToken !== state.requestToken) {
                return;
            }

            console.error('[AdminPayments] Failed to load dashboard:', error);
            if (error.statusCode === 403) {
                renderAccessState(getFriendlyErrorMessage(error, '当前账号没有支付对账权限，请使用管理员账号登录后再试。'), 'error');
                return;
            }

            if (state.summary) {
                renderAccessState(getFriendlyErrorMessage(error, '支付数据刷新失败，当前展示的是上一次成功结果。'), 'warning', { preserveBody: true });
                setToolbarMeta('部分数据刷新失败，当前展示的是上一次成功结果', 'warning');
                return;
            }

            renderAccessState(getFriendlyErrorMessage(error, '支付对账加载失败，请稍后重试。'), 'warning');
        } finally {
            if (requestToken === state.requestToken) {
                setLoading(false);
            }
        }
    }

    async function previewCleanup() {
        try {
            setCleanupLoading(true);
            await loadCleanupPreview();
        } catch (error) {
            console.error('[AdminPayments] Failed to preview cleanup:', error);
            renderCleanupPreviewFallback(getFriendlyErrorMessage(error, '测试数据扫描失败，请稍后再试。'));
            if (typeof window.showToast === 'function') {
                window.showToast(getFriendlyErrorMessage(error, '测试数据扫描失败'), 'error');
            }
        } finally {
            setCleanupLoading(false);
        }
    }

    async function cleanupTestData() {
        if (state.cleanupLoading) return;

        const preview = state.cleanupPreview || {};
        const counts = preview.counts || {};
        const totalRows = Number(counts.payment_orders || 0) + Number(counts.auth_users || 0);
        if (!totalRows) {
            if (typeof window.showToast === 'function') {
                window.showToast('当前没有待清理的测试数据。', 'info');
            }
            return;
        }

        const confirmed = window.confirm('将删除 AUTO_CDX_* 测试订单与 codex.*@example.com 测试账号。此操作不可撤销，是否继续？');
        if (!confirmed) return;

        try {
            setCleanupLoading(true);
            const payload = await fetchAdminJson('/api/admin/payments/cleanup', {
                method: 'POST',
                body: JSON.stringify({ confirm: true })
            });

            if (typeof window.showToast === 'function') {
                window.showToast(payload.message || '测试数据已清理', payload.warnings?.length ? 'warning' : 'success');
            }
            state.viewCache = {};
            await reload();
            try {
                await loadCleanupPreview({ silent: true });
            } catch (previewError) {
                console.error('[AdminPayments] Failed to reload cleanup preview after cleanup:', previewError);
                renderCleanupPreviewFallback(getFriendlyErrorMessage(previewError, '测试数据已清理，但扫描预览暂时不可用。'));
            }
        } catch (error) {
            console.error('[AdminPayments] Failed to cleanup test data:', error);
            if (typeof window.showToast === 'function') {
                window.showToast(getFriendlyErrorMessage(error, '测试数据清理失败'), 'error');
            }
        } finally {
            setCleanupLoading(false);
        }
    }

    function setDays(value, shouldCloseMenu = false) {
        const next = Number.parseInt(value, 10);
        state.days = Number.isFinite(next) && next > 0 ? next : 30;
        state.viewCache = {};
        updateRangeLabel();
        if (shouldCloseMenu) {
            closeRangeMenu();
        }
        if (state.initialized) {
            reload();
        }
    }

    window.AdminPayments = {
        init,
        reload,
        switchTab,
        setDays,
        toggleRangeMenu,
        previewCleanup,
        cleanupTestData
    };
})();
