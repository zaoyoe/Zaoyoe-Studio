(function () {
    'use strict';

    const state = {
        initialized: false,
        initializing: false,
        loading: false,
        cleanupLoading: false,
        days: 30,
        rangeMode: 'preset',
        customStartDate: null,
        customEndDate: null,
        activeTab: 'overview',
        listenersBound: false,
        summary: null,
        cleanupPreview: null,
        requestToken: 0,
        viewCache: {},
        tooltipElement: null,
        tooltipTarget: null,
        lastSyncedAt: null,
        autoRefreshEnabled: true,
        autoRefreshIntervalMs: 5 * 60 * 1000,
        autoRefreshTimer: null,
        pagination: {
            anomalies: 1,
            orders: 1,
            cleanupOrders: 1,
            cleanupUsers: 1
        }
    };

    const PAYMENTS_PAGE_SIZE = 5;

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

    function formatDateForInput(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function parseDateInput(value) {
        const text = String(value || '').trim();
        const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!matched) return null;
        const year = Number(matched[1]);
        const monthIndex = Number(matched[2]) - 1;
        const day = Number(matched[3]);
        const date = new Date(year, monthIndex, day);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function toRangeIso(value, endOfDay = false) {
        const date = parseDateInput(value);
        if (!date) return null;
        if (endOfDay) {
            date.setHours(23, 59, 59, 999);
        } else {
            date.setHours(0, 0, 0, 0);
        }
        return date.toISOString();
    }

    function getDefaultRangeValues(days = 30) {
        const end = new Date();
        end.setHours(0, 0, 0, 0);
        const start = new Date(end);
        start.setDate(start.getDate() - Math.max(0, days - 1));
        return {
            start: formatDateForInput(start),
            end: formatDateForInput(end)
        };
    }

    function ensureRangeDefaults() {
        if (state.customStartDate && state.customEndDate) return;
        const range = getDefaultRangeValues(state.days || 30);
        state.customStartDate = range.start;
        state.customEndDate = range.end;
    }

    function formatRangeLabelFromInputs(startValue, endValue) {
        const start = parseDateInput(startValue);
        const end = parseDateInput(endValue);
        if (!start || !end) return getRangeLabel(state.days);
        const startLabel = `${start.getMonth() + 1}/${start.getDate()}`;
        const endLabel = `${end.getMonth() + 1}/${end.getDate()}`;
        return `${startLabel} - ${endLabel}`;
    }

    function getCurrentRangeLabel() {
        if (state.rangeMode === 'custom' && state.customStartDate && state.customEndDate) {
            return formatRangeLabelFromInputs(state.customStartDate, state.customEndDate);
        }
        return getRangeLabel(state.days);
    }

    function isMobileViewport() {
        return window.innerWidth <= 768;
    }

    function isUltraNarrowViewport() {
        return window.innerWidth <= 430;
    }

    function formatToolbarTime(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function getRangeDayDiff(startValue, endValue) {
        const start = parseDateInput(startValue);
        const end = parseDateInput(endValue);
        if (!start || !end) return 30;
        const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        return Math.max(1, diff);
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
        if (state.rangeMode === 'custom' && state.customStartDate && state.customEndDate) {
            return `custom:${state.customStartDate}:${state.customEndDate}:${site}`;
        }
        return `preset:${state.days}:${site}`;
    }

    function resetViewState() {
        state.viewCache = {};
        state.pagination = {
            anomalies: 1,
            orders: 1,
            cleanupOrders: 1,
            cleanupUsers: 1
        };
    }

    function syncCustomRangeInputs() {
        ensureRangeDefaults();
        const startInput = document.getElementById('paymentsCustomStartDate');
        const endInput = document.getElementById('paymentsCustomEndDate');
        if (startInput) startInput.value = state.customStartDate || '';
        if (endInput) endInput.value = state.customEndDate || '';
    }

    function paginateItems(items, pageKey, pageSize = PAYMENTS_PAGE_SIZE) {
        const list = Array.isArray(items) ? items : [];
        const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
        const requestedPage = Number(state.pagination?.[pageKey] || 1);
        const currentPage = Math.min(Math.max(1, requestedPage), totalPages);

        state.pagination[pageKey] = currentPage;

        const start = (currentPage - 1) * pageSize;
        return {
            pageItems: list.slice(start, start + pageSize),
            currentPage,
            totalPages,
            totalItems: list.length
        };
    }

    function renderPager(pageKey, currentPage, totalPages, totalItems) {
        if (totalItems <= PAYMENTS_PAGE_SIZE) return '';

        return `
            <div class="payments-pagination admin-pagination">
                <button class="payments-pagination-btn page-btn" type="button" onclick="AdminPayments.goToPage('${escapeHtml(pageKey)}', ${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} aria-label="上一页">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <div class="payments-pagination-info page-info">第 ${escapeHtml(formatNumber(currentPage))} / ${escapeHtml(formatNumber(totalPages))} 页 · 共 ${escapeHtml(formatNumber(totalItems))} 条</div>
                <button class="payments-pagination-btn page-btn" type="button" onclick="AdminPayments.goToPage('${escapeHtml(pageKey)}', ${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="下一页">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
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

    function buildSummaryQuery(view = state.activeTab) {
        const query = new URLSearchParams({
            view: String(view || state.activeTab || 'overview')
        });
        const site = getSiteParam();
        if (site) {
            query.set('site', site);
        }

        if (state.rangeMode === 'custom' && state.customStartDate && state.customEndDate) {
            const startIso = toRangeIso(state.customStartDate, false);
            const endIso = toRangeIso(state.customEndDate, true);
            if (startIso && endIso) {
                query.set('startDate', startIso);
                query.set('endDate', endIso);
                return query;
            }
        }

        query.set('days', String(state.days));
        return query;
    }

    function isPaymentsModuleActive() {
        const module = document.getElementById('module-payments');
        return Boolean(module && module.classList.contains('active') && module.style.display !== 'none');
    }

    function syncAutoRefreshToggle() {
        const toggle = document.getElementById('paymentsAutoRefreshToggle');
        if (!toggle) return;
        toggle.checked = Boolean(state.autoRefreshEnabled);
        const wrapper = toggle.closest('.auto-refresh-toggle');
        if (wrapper) {
            wrapper.title = `自动刷新（${Math.round(state.autoRefreshIntervalMs / 60000)} 分钟）`;
        }
    }

    function stopAutoRefresh() {
        if (state.autoRefreshTimer) {
            clearInterval(state.autoRefreshTimer);
            state.autoRefreshTimer = null;
        }
    }

    function startAutoRefresh() {
        if (!state.autoRefreshEnabled || state.autoRefreshTimer) return;
        state.autoRefreshTimer = window.setInterval(() => {
            if (!state.initialized || state.loading || !isPaymentsModuleActive()) return;
            reload({ silent: true });
        }, state.autoRefreshIntervalMs);
    }

    function setAutoRefreshEnabled(enabled) {
        state.autoRefreshEnabled = Boolean(enabled);
        localStorage.setItem('paymentsAutoRefreshEnabled', state.autoRefreshEnabled ? '1' : '0');
        syncAutoRefreshToggle();
        if (state.autoRefreshEnabled) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    }

    function setToolbarMeta(text, tone = 'muted') {
        const target = document.getElementById('paymentsToolbarMeta');
        if (!target) return;
        target.textContent = text || '';
        target.dataset.tone = tone;
        target.parentElement?.classList.toggle('is-loading', tone === 'info');
    }

    function updateLastSynced(dateLike = new Date()) {
        state.lastSyncedAt = dateLike instanceof Date ? dateLike.toISOString() : dateLike;
        setToolbarMeta(`上次刷新 ${formatToolbarTime(state.lastSyncedAt)}`, 'ready');
    }

    function updateRangeLabel() {
        const currentLabel = getCurrentRangeLabel();
        const label = document.getElementById('paymentsRangeLabel');
        if (label) {
            label.textContent = currentLabel;
        }

        const rangeMeta = document.getElementById('paymentsRangeMeta');
        if (rangeMeta) {
            rangeMeta.innerHTML = `
                <i class="fas fa-calendar-day"></i>
                <span>当前范围：${escapeHtml(currentLabel)}</span>
            `;
        }

        document.querySelectorAll('.payments-range-btn').forEach((button) => {
            const buttonDays = Number(button.dataset.days || 0);
            button.classList.toggle('active', state.rangeMode === 'preset' && buttonDays === state.days);
        });

        syncCustomRangeInputs();
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
        syncCustomRangeInputs();
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

    function updateOverviewBanner(data) {
        if (state.activeTab !== 'overview') {
            clearAccessState();
            return;
        }

        const anomaly = data?.anomaly_summary || {};
        const anomalyCount = Number(anomaly.review_orders || 0)
            + Number(anomaly.failed_orders || 0)
            + Number(anomaly.recent_event_anomalies || 0);

        if (anomalyCount > 0) {
            renderAccessState(`当前有 ${formatNumber(anomalyCount)} 项异常需要关注，请优先查看失败订单、待审核与异常回调。`, 'warning', { preserveBody: true });
            return;
        }

        clearAccessState();
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
        const normalizedMessage = String(message || '').trim();

        if (!normalizedMessage) {
            stateEl.hidden = true;
            bodyEl.hidden = false;
            return;
        }

        stateEl.className = `payments-access-state ${tone}`;
        stateEl.innerHTML = `
            <i class="fas ${tone === 'error' ? 'fa-ban' : 'fa-shield-alt'}"></i>
            <span>${escapeHtml(normalizedMessage)}</span>
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
        if (loading) {
            setToolbarMeta('正在刷新…', 'info');
        } else if (state.lastSyncedAt) {
            setToolbarMeta(`上次刷新 ${formatToolbarTime(state.lastSyncedAt)}`, 'ready');
        } else {
            setToolbarMeta('等待载入支付数据', 'muted');
        }
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
                <div class="payments-kpi-main">
                    <div class="kpi-icon payments-kpi-icon">
                        <i class="${escapeHtml(card.icon || 'fas fa-chart-line')}"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="payments-kpi-value">${escapeHtml(card.value)}</div>
                        <div class="payments-kpi-label-row">
                            <div class="payments-kpi-label">${escapeHtml(card.label)}</div>
                            ${renderInfoChip(card.help)}
                        </div>
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
                icon: 'fas fa-wallet',
                label: '支付金额',
                value: formatCurrency(overview.total_amount),
                help: `${formatNumber(overview.total_points)} 已入账`,
                tone: 'money'
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
        const labelStep = isUltraNarrowViewport() ? 8 : (isMobileViewport() ? 6 : 1);

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">最近 24 小时暂无回调数据。</div>';
            legend.innerHTML = '';
            return;
        }

        target.innerHTML = `
            <div class="payments-trend-bars">
                ${items.map((item, index) => {
                    const totalHeight = Math.max(6, Math.round((Number(item.total_events || 0) / maxValue) * 100));
                    const anomalyHeight = Math.max(0, Math.round((Number(item.anomaly_events || 0) / maxValue) * 100));
                    const rawLabel = String(item.label || '');
                    const timePart = rawLabel.includes(' ') ? rawLabel.split(' ')[1] : rawLabel.slice(6);
                    const shortLabel = isMobileViewport()
                        ? `${String(timePart || '').slice(0, 2)}时`
                        : timePart;
                    const showLabel = labelStep === 1 || index % labelStep === 0 || index === items.length - 1;
                    return `
                        <div class="payments-trend-bar ${showLabel ? 'show-label' : ''}" title="${escapeHtml(item.label)} · 总回调 ${escapeHtml(formatNumber(item.total_events))} · 异常 ${escapeHtml(formatNumber(item.anomaly_events))}">
                            <div class="payments-trend-bar-total" style="height:${totalHeight}%"></div>
                            <div class="payments-trend-bar-anomaly" style="height:${anomalyHeight}%"></div>
                            <span>${showLabel ? escapeHtml(shortLabel) : ''}</span>
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

        const pager = paginateItems(anomalies, 'anomalies');

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

        target.innerHTML = `
            <div class="payments-anomaly-items">
                ${pager.pageItems.map((item) => `
            <div class="payments-anomaly-item severity-${escapeHtml(item.severity || 'info')}">
                <div class="payments-anomaly-top">
                    <div class="payments-anomaly-copy">
                        <div class="payments-anomaly-title">${escapeHtml(item.title || '异常项')}</div>
                        <div class="payments-anomaly-message">${escapeHtml(item.message || '')}</div>
                    </div>
                    <span class="payments-anomaly-severity">${escapeHtml(getSeverityLabel(item.severity))}</span>
                </div>
                <div class="payments-anomaly-suggestion">
                    <i class="fas fa-lightbulb"></i>
                    <span>${escapeHtml(getHandlingSuggestion(item))}</span>
                </div>
                <div class="payments-anomaly-meta">
                    <span><small>类型</small><strong>${escapeHtml(item.type === 'event' ? '回调事件' : '订单')}</strong></span>
                    <span><small>通道</small><strong>${escapeHtml(getProviderLabel(item.provider))}</strong></span>
                    <span><small>订单号</small><strong>${escapeHtml(item.provider_order_no || '无订单号')}</strong></span>
                    <span><small>时间</small><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
                </div>
            </div>
                `).join('')}
            </div>
            ${renderPager('anomalies', pager.currentPage, pager.totalPages, pager.totalItems)}
        `;
    }

    function renderOrders(data) {
        const target = document.getElementById('paymentsOrdersTable');
        if (!target) return;
        const orders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];

        if (!orders.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无支付订单。</div>';
            return;
        }

        const pager = paginateItems(orders, 'orders');

        if (isMobileViewport()) {
            target.innerHTML = `
                <div class="payments-order-cards">
                    ${pager.pageItems.map((order) => `
                        <div class="payments-order-card">
                            <div class="payments-order-card-top">
                                <div>
                                    <div class="payments-order-no">${escapeHtml(order.provider_order_no || '—')}</div>
                                    <div class="payments-order-provider">${escapeHtml(getProviderLabel(order.provider))} · ${(order.site || 'cn').toUpperCase()}</div>
                                </div>
                                <span class="payments-status-badge status-${escapeHtml(order.status || 'pending')}">${escapeHtml(getStatusLabel(order.status))}</span>
                            </div>
                            <div class="payments-order-card-grid">
                                <div>
                                    <label>套餐</label>
                                    <strong>${escapeHtml(order.package_name || '未匹配套餐')}</strong>
                                </div>
                                <div>
                                    <label>金额</label>
                                    <strong>${escapeHtml(formatCurrency(order.paid_amount))}</strong>
                                </div>
                                <div>
                                    <label>积分</label>
                                    <span>${escapeHtml(formatNumber(order.points_amount))}</span>
                                </div>
                                <div>
                                    <label>创建时间</label>
                                    <span>${escapeHtml(formatDateTime(order.created_at))}</span>
                                </div>
                                <div>
                                    <label>认领时间</label>
                                    <span>${escapeHtml(formatDateTime(order.claimed_at))}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                ${renderPager('orders', pager.currentPage, pager.totalPages, pager.totalItems)}
            `;
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
                        ${pager.pageItems.map((order) => `
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
            ${renderPager('orders', pager.currentPage, pager.totalPages, pager.totalItems)}
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

        const orderPager = paginateItems(sampleOrders, 'cleanupOrders');
        const userPager = paginateItems(sampleUsers, 'cleanupUsers');

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
                            ${orderPager.pageItems.map((item) => `<li>${escapeHtml(item.provider_order_no)} · ${escapeHtml(getStatusLabel(item.status))} · ${escapeHtml(formatDateTime(item.created_at))}</li>`).join('')}
                        </ul>
                        ${renderPager('cleanupOrders', orderPager.currentPage, orderPager.totalPages, orderPager.totalItems)}
                    ` : '<div class="payments-empty-state compact">未扫描到测试订单。</div>'}
                </div>
                <div>
                    <h4>样例账号</h4>
                    ${sampleUsers.length ? `
                        <ul>
                            ${userPager.pageItems.map((item) => `<li>${escapeHtml(item.email || item.id)}</li>`).join('')}
                        </ul>
                        ${renderPager('cleanupUsers', userPager.currentPage, userPager.totalPages, userPager.totalItems)}
                    ` : '<div class="payments-empty-state compact">未扫描到测试账号。</div>'}
                </div>
            </div>
        `;
    }

    function rerenderCurrentView() {
        if (!state.summary) return;
        renderOverviewCards(state.summary);
        renderSitewideSummary(state.summary);
        renderBusinessBreakdown(state.summary);
        renderPointsBreakdown(state.summary);
        renderTrend(state.summary);
        renderAnomalies(state.summary);
        renderOrders(state.summary);
        if (state.cleanupPreview) {
            renderCleanupPreview({ preview: state.cleanupPreview });
        }
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
        const query = buildSummaryQuery(state.activeTab);
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
        updateOverviewBanner(data);

        updateLastSynced(new Date());
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
            ensureRangeDefaults();
            state.autoRefreshEnabled = localStorage.getItem('paymentsAutoRefreshEnabled') !== '0';

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
                const autoRefreshToggle = document.getElementById('paymentsAutoRefreshToggle');
                if (autoRefreshToggle) {
                    autoRefreshToggle.addEventListener('change', (event) => {
                        setAutoRefreshEnabled(Boolean(event.target.checked));
                    });
                }
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
                let resizeTimer = null;
                window.addEventListener('scroll', hideInfoTooltip, true);
                window.addEventListener('resize', () => {
                    syncTabIndicator();
                    hideInfoTooltip();
                    window.clearTimeout(resizeTimer);
                    resizeTimer = window.setTimeout(() => {
                        rerenderCurrentView();
                    }, 120);
                });
                state.listenersBound = true;
            }

            updateRangeLabel();
            syncAutoRefreshToggle();
            startAutoRefresh();
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
                const fallbackTime = state.lastSyncedAt ? `上次成功 ${formatToolbarTime(state.lastSyncedAt)}` : '刚刚刷新失败';
                setToolbarMeta(fallbackTime, 'warning');
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

    function applyCustomRange() {
        const startInput = document.getElementById('paymentsCustomStartDate');
        const endInput = document.getElementById('paymentsCustomEndDate');
        const startValue = String(startInput?.value || '').trim();
        const endValue = String(endInput?.value || '').trim();

        if (!startValue || !endValue) {
            window.showToast?.('请选择开始和结束日期', 'error');
            return;
        }

        const start = parseDateInput(startValue);
        const end = parseDateInput(endValue);
        if (!start || !end) {
            window.showToast?.('日期格式无效，请重新选择', 'error');
            return;
        }

        if (start.getTime() > end.getTime()) {
            window.showToast?.('开始日期不能晚于结束日期', 'error');
            return;
        }

        state.rangeMode = 'custom';
        state.customStartDate = startValue;
        state.customEndDate = endValue;
        state.days = getRangeDayDiff(startValue, endValue);
        resetViewState();
        updateRangeLabel();
        closeRangeMenu();
        if (state.initialized) {
            reload();
        }
    }

    function setDays(value, shouldCloseMenu = false) {
        const next = Number.parseInt(value, 10);
        ensureRangeDefaults();
        state.days = Number.isFinite(next) && next > 0 ? next : 30;
        state.rangeMode = 'preset';
        const presetRange = getDefaultRangeValues(state.days);
        state.customStartDate = presetRange.start;
        state.customEndDate = presetRange.end;
        resetViewState();
        updateRangeLabel();
        if (shouldCloseMenu) {
            closeRangeMenu();
        }
        if (state.initialized) {
            reload();
        }
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    async function fetchExportBundle() {
        const [overviewPayload, financePayload, opsPayload] = await Promise.all([
            fetchAdminJson(`/api/admin/payments/summary?${buildSummaryQuery('overview').toString()}`),
            fetchAdminJson(`/api/admin/payments/summary?${buildSummaryQuery('finance').toString()}`),
            fetchAdminJson(`/api/admin/payments/summary?${buildSummaryQuery('ops').toString()}`)
        ]);

        return {
            exportDate: new Date().toISOString(),
            rangeLabel: getCurrentRangeLabel(),
            siteLabel: (getSiteParam() || 'all').toUpperCase(),
            overview: overviewPayload.overview || {},
            anomaly_summary: overviewPayload.anomaly_summary || opsPayload.anomaly_summary || {},
            provider_stats: overviewPayload.provider_stats || [],
            trend_24h: overviewPayload.trend_24h || [],
            sitewide_summary: financePayload.sitewide_summary || {},
            business_breakdown: financePayload.business_breakdown || [],
            points_breakdown: financePayload.points_breakdown || [],
            recent_anomalies: opsPayload.recent_anomalies || [],
            recent_orders: opsPayload.recent_orders || []
        };
    }

    function exportAsCSV(bundle) {
        let csv = '';
        csv += '=== 支付对账概览 ===\n';
        csv += `导出时间,${bundle.exportDate}\n`;
        csv += `站点,${bundle.siteLabel}\n`;
        csv += `筛选范围,${bundle.rangeLabel}\n`;
        csv += `总订单,${bundle.overview.total_orders || 0}\n`;
        csv += `支付成功率,${bundle.overview.paid_rate || 0}%\n`;
        csv += `认领率,${bundle.overview.claim_rate || 0}%\n`;
        csv += `支付金额,${bundle.overview.total_amount || 0}\n\n`;

        csv += '=== 通道表现 ===\n';
        csv += '通道,总订单,支付成功,认领率,金额,积分\n';
        (bundle.provider_stats || []).forEach((item) => {
            csv += `${item.provider || ''},${item.total_orders || 0},${item.paid_rate || 0}%,${item.claim_rate || 0}%,${item.total_amount || 0},${item.total_points || 0}\n`;
        });
        csv += '\n=== 全站收支 ===\n';
        csv += '指标,数值,说明\n';
        (bundle.business_breakdown || []).forEach((item) => {
            csv += `${(item.title || '').replace(/,/g, '，')},${(item.metric || '').replace(/,/g, '，')},${(item.meta || '').replace(/,/g, '，')}\n`;
        });
        csv += '\n=== 积分流水分类 ===\n';
        csv += '分类,流入,流出,净值\n';
        (bundle.points_breakdown || []).forEach((item) => {
            csv += `${(item.label || '').replace(/,/g, '，')},${item.inflow || 0},${item.outflow || 0},${item.net || 0}\n`;
        });
        csv += '\n=== 异常队列 ===\n';
        csv += '标题,严重级别,通道,订单号,时间\n';
        (bundle.recent_anomalies || []).forEach((item) => {
            csv += `${(item.title || '').replace(/,/g, '，')},${getSeverityLabel(item.severity)},${getProviderLabel(item.provider)},${(item.provider_order_no || '').replace(/,/g, '，')},${formatDateTime(item.created_at)}\n`;
        });
        csv += '\n=== 最近订单 ===\n';
        csv += '订单号,通道,套餐,金额,积分,状态,创建时间\n';
        (bundle.recent_orders || []).forEach((item) => {
            csv += `${(item.provider_order_no || '').replace(/,/g, '，')},${getProviderLabel(item.provider)},${(item.package_name || '').replace(/,/g, '，')},${item.paid_amount || 0},${item.points_amount || 0},${getStatusLabel(item.status)},${formatDateTime(item.created_at)}\n`;
        });

        downloadBlob(
            new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
            `payments_${new Date().toISOString().split('T')[0]}.csv`
        );
    }

    function exportAsExcel(bundle) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel 导出组件未加载，请刷新后重试');
        }

        const wb = XLSX.utils.book_new();
        const overviewSheet = XLSX.utils.json_to_sheet([{
            导出时间: bundle.exportDate,
            站点: bundle.siteLabel,
            筛选范围: bundle.rangeLabel,
            总订单: bundle.overview.total_orders || 0,
            支付成功率: bundle.overview.paid_rate || 0,
            认领率: bundle.overview.claim_rate || 0,
            支付金额: bundle.overview.total_amount || 0,
            支付积分: bundle.overview.total_points || 0
        }]);
        XLSX.utils.book_append_sheet(wb, overviewSheet, '支付概览');

        if ((bundle.provider_stats || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.provider_stats || []).map((item) => ({
                通道: getProviderLabel(item.provider),
                总订单: item.total_orders || 0,
                支付成功率: item.paid_rate || 0,
                认领率: item.claim_rate || 0,
                金额: item.total_amount || 0,
                积分: item.total_points || 0
            }))), '通道表现');
        }

        if ((bundle.business_breakdown || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.business_breakdown || []).map((item) => ({
                分类: item.title,
                指标: item.metric,
                说明: item.description,
                补充: item.meta
            }))), '全站收支');
        }

        if ((bundle.points_breakdown || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.points_breakdown || []).map((item) => ({
                分类: item.label,
                流入: item.inflow || 0,
                流出: item.outflow || 0,
                净值: item.net || 0
            }))), '积分流水');
        }

        if ((bundle.recent_anomalies || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.recent_anomalies || []).map((item) => ({
                标题: item.title,
                严重级别: getSeverityLabel(item.severity),
                通道: getProviderLabel(item.provider),
                订单号: item.provider_order_no || '',
                时间: formatDateTime(item.created_at),
                描述: item.message || ''
            }))), '异常队列');
        }

        if ((bundle.recent_orders || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.recent_orders || []).map((item) => ({
                订单号: item.provider_order_no || '',
                通道: getProviderLabel(item.provider),
                套餐: item.package_name || '',
                金额: item.paid_amount || 0,
                积分: item.points_amount || 0,
                状态: getStatusLabel(item.status),
                创建时间: formatDateTime(item.created_at)
            }))), '最近订单');
        }

        XLSX.writeFile(wb, `payments_${new Date().toISOString().split('T')[0]}.xlsx`);
    }

    async function exportData(format) {
        try {
            const payload = await fetchExportBundle();
            if (format === 'csv') {
                exportAsCSV(payload);
            } else {
                exportAsExcel(payload);
            }
            window.showToast?.(`${String(format).toUpperCase()} 导出成功`, 'success');
        } catch (error) {
            console.error('[AdminPayments] Failed to export data:', error);
            window.showToast?.(getFriendlyErrorMessage(error, '支付对账导出失败，请稍后重试。'), 'error');
        }
    }

    function goToPage(pageKey, page) {
        const next = Number.parseInt(page, 10);
        if (!Number.isFinite(next) || next < 1) return;
        state.pagination[pageKey] = next;

        if (pageKey === 'cleanupOrders' || pageKey === 'cleanupUsers') {
            renderCleanupPreview({ preview: state.cleanupPreview });
            return;
        }

        if (!state.summary) return;
        if (pageKey === 'anomalies') {
            renderAnomalies(state.summary);
            return;
        }
        if (pageKey === 'orders') {
            renderOrders(state.summary);
        }
    }

    window.AdminPayments = {
        init,
        reload,
        switchTab,
        setDays,
        applyCustomRange,
        toggleRangeMenu,
        exportData,
        previewCleanup,
        cleanupTestData,
        goToPage
    };
})();
