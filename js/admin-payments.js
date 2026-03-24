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
        lastSyncedAt: null,
        autoRefreshEnabled: true,
        autoRefreshIntervalMs: 5 * 60 * 1000,
        autoRefreshTimer: null,
        anomalyActionLoading: {},
        exceptionTopicFilter: 'all',
        pagination: {
            anomalies: 1,
            orders: 1,
            cleanupOrders: 1,
            cleanupUsers: 1
        }
    };

    const PAYMENTS_PAGE_SIZE = 5;
    const NOTE_REQUIRED_ACTIONS = new Set([
        'approve_review',
        'reject_review',
        'approve_amount_mismatch',
        'reject_amount_mismatch',
        'refund_hupijiao'
    ]);
    const CLEANUP_SCOPE_HTML = '只会清理订单号前缀为 <code>AUTO_CDX_*</code> 或 <code>SMOKE_*</code> 的测试订单，以及邮箱匹配 <code>codex.*@example.com</code> 或 <code>smoke-payment-*@zaoyoe.invalid</code> 的测试账号。';
    const CLEANUP_SCOPE_TEXT = '将删除 AUTO_CDX_* / SMOKE_* 测试订单，以及 codex.*@example.com / smoke-payment-*@zaoyoe.invalid 测试账号。此操作不可撤销，是否继续？';

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
            <button type="button" class="payments-info-chip" aria-label="查看说明">
                <span class="payments-info-glyph" aria-hidden="true"></span>
                <span class="payments-info-tooltip" role="tooltip">${escapeHtml(help)}</span>
            </button>
        `;
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

    function getAnomalyOpsStatusLabel(status) {
        const map = {
            open: '待处理',
            handled: '已处理',
            ignored: '已忽略',
            retry_requested: '已登记重试',
            approved: '已审核通过',
            rejected: '已驳回'
        };
        return map[String(status || '').trim().toLowerCase()] || '待处理';
    }

    function getAnomalyActionLabel(action) {
        const map = {
            mark_handled: '标记已处理',
            ignore: '忽略',
            request_retry: '登记重试',
            reopen: '重新打开',
            approve_review: '审核通过',
            reject_review: '驳回',
            approve_amount_mismatch: '人工放行',
            reject_amount_mismatch: '拒绝入账',
            refund_hupijiao: '执行退款'
        };
        return map[String(action || '').trim().toLowerCase()] || '执行操作';
    }

    function getAnomalyActionPrompt(action) {
        if (String(action || '').trim().toLowerCase() === 'refund_hupijiao') {
            return '请填写退款备注，这条备注会进入后台审计记录，并作为退款原因传给虎皮椒：';
        }
        return '请填写处理备注，这条备注会进入后台审计记录：';
    }

    function getAnomalyOpsTone(status) {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'handled' || normalized === 'approved') return 'success';
        if (normalized === 'ignored') return 'muted';
        if (normalized === 'retry_requested') return 'warning';
        if (normalized === 'rejected') return 'danger';
        return 'info';
    }

    function isAnomalyActionLoading(targetType, targetId) {
        const key = `${String(targetType || '').trim().toLowerCase()}:${String(targetId || '').trim()}`;
        return Boolean(state.anomalyActionLoading[key]);
    }

    function getSessionStatusLabel(status) {
        const map = {
            created: '已创建',
            redirect_ready: '待支付',
            completed: '已完成',
            failed: '失败',
            expired: '已过期',
            cancelled: '已取消'
        };
        return map[String(status || '').trim().toLowerCase()] || String(status || '未知');
    }

    function getSessionLinkSourceLabel(linkedBy) {
        const value = String(linkedBy || '').trim().toLowerCase();
        if (!value) return '已匹配';
        if (value.includes('webhook')) return '自动回填';
        if (value.includes('query') || value.includes('claim') || value.includes('fallback')) return '认领兜底';
        return '已匹配';
    }

    function getCheckoutSessionMatchInfo(order) {
        const linkedBy = String(order?.checkout_session_linked_by || '').trim().toLowerCase();
        const status = String(order?.checkout_session_status || '').trim().toLowerCase();
        const required = Boolean(order?.checkout_session_required);
        const matched = Boolean(order?.checkout_session_matched || order?.checkout_session_id);

        if (matched) {
            return {
                label: getSessionLinkSourceLabel(linkedBy),
                tone: linkedBy.includes('query') || linkedBy.includes('claim') || linkedBy.includes('fallback') ? 'warning' : 'success',
                detail: status ? `会话 ${getSessionStatusLabel(status)}` : '已成功关联支付意图'
            };
        }

        if (required) {
            if (status === 'completed') {
                return {
                    label: '待回填',
                    tone: 'warning',
                    detail: '支付意图已完成，但尚未回填最终订单'
                };
            }

            if (['failed', 'expired', 'cancelled'].includes(status)) {
                return {
                    label: '意图失败',
                    tone: 'danger',
                    detail: `支付意图状态：${getSessionStatusLabel(status)}`
                };
            }

            return {
                label: '待回填',
                tone: 'muted',
                detail: '等待 webhook 或钱包认领阶段完成关联'
            };
        }

        return {
            label: '历史订单',
            tone: 'muted',
            detail: '该订单创建时还未启用支付意图链路'
        };
    }

    function getHandlingSuggestion(item) {
        const title = String(item?.title || '');
        const message = String(item?.message || '');
        const type = String(item?.type || '').trim().toLowerCase();

        if (type === 'query' || title.includes('查码')) {
            return '处理建议：先判断是用户输错订单号，还是 webhook 未落单、订单被拦截或兑换码尚未生成。';
        }
        if (title.includes('支付意图') || type === 'session') {
            if (title.includes('待回填')) {
                return '处理建议：先检查支付入口是否成功创建，再核对 webhook 是否到达；必要时引导用户查码认领兜底。';
            }
            if (title.includes('已完成但未回填')) {
                return '处理建议：优先检查 provider_order_no 与 checkout session 的关联是否丢失，再决定是否人工回填。';
            }
            return '处理建议：检查支付通道拉起参数、支付跳转结果以及 checkout session 状态。';
        }
        if (title.includes('重复回调')) {
            return '处理建议：确认是否只是重复通知，还是已经触发重复写单、重复回填或重复入账。';
        }
        if (title.includes('签名') || message.toLowerCase().includes('signature')) {
            return '处理建议：检查支付通道密钥、回调签名算法和回调来源地址。';
        }
        if (title.includes('金额') || message.includes('金额')) {
            return '处理建议：核对套餐价格、支付金额和通道回传金额是否一致，金额异常放行前务必补处理备注。';
        }
        if (title.includes('未认领') || message.includes('未输入订单号')) {
            return '处理建议：提醒用户在钱包输入订单号，或后台人工补认领。';
        }
        if (title.includes('待审核')) {
            return '处理建议：检查套餐映射、金额校验和订单来源后再决定是否放行。';
        }
        return '处理建议：先核对订单号、支付通道配置和回调时间，再决定是否人工补单。';
    }

    function getAnomalyTypeLabel(item) {
        if (item?.type === 'session') return '支付意图';
        if (item?.type === 'event') return '回调事件';
        if (item?.type === 'query') return '查码记录';
        return '订单';
    }

    function getAnomalyReferenceLabel(item) {
        return item?.type === 'session' ? '会话' : '订单号';
    }

    function getAnomalyReferenceValue(item) {
        if (item?.type === 'session') {
            return item.session_key || item.provider_order_no || '无会话号';
        }
        return item?.provider_order_no || '无订单号';
    }

    function renderAnomalyOpsState(item) {
        const status = String(item?.ops_status || 'open').trim().toLowerCase();
        const tone = getAnomalyOpsTone(status);
        const label = getAnomalyOpsStatusLabel(status);
        const resolution = String(item?.ops_resolution || '').trim();
        const actionTime = item?.ops_last_action_at ? formatDateTime(item.ops_last_action_at) : '';

        return `
            <div class="payments-anomaly-ops">
                <span class="payments-anomaly-state ${escapeHtml(`status-${status}`)} ${escapeHtml(tone)}">${escapeHtml(label)}</span>
                ${resolution ? `<span class="payments-anomaly-resolution">${escapeHtml(resolution)}</span>` : ''}
                ${actionTime ? `<span class="payments-anomaly-resolution-meta">最近处理：${escapeHtml(actionTime)}</span>` : ''}
            </div>
        `;
    }

    function renderAnomalyActions(item) {
        const actions = Array.isArray(item?.ops_available_actions) ? item.ops_available_actions : [];
        if (!actions.length) return '';

        const loading = isAnomalyActionLoading(item.type, item.id);
        return `
            <div class="payments-anomaly-actions">
                ${actions.map((action) => `
                    <button
                        type="button"
                        class="payments-anomaly-action-btn ${escapeHtml(action)}"
                        data-admin-action="payments-handle-anomaly-action"
                        data-payments-target-type="${escapeHtml(item.type)}"
                        data-payments-target-id="${escapeHtml(item.id)}"
                        data-payments-action="${escapeHtml(action)}"
                        ${loading ? 'disabled' : ''}
                    >
                        ${escapeHtml(getAnomalyActionLabel(action))}
                    </button>
                `).join('')}
            </div>
        `;
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
                <button class="payments-pagination-btn page-btn" type="button" data-admin-action="payments-go-to-page" data-payments-page-key="${escapeHtml(pageKey)}" data-payments-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''} aria-label="上一页">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <div class="payments-pagination-info page-info">第 ${escapeHtml(formatNumber(currentPage))} / ${escapeHtml(formatNumber(totalPages))} 页 · 共 ${escapeHtml(formatNumber(totalItems))} 条</div>
                <button class="payments-pagination-btn page-btn" type="button" data-admin-action="payments-go-to-page" data-payments-page-key="${escapeHtml(pageKey)}" data-payments-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="下一页">
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
        return Boolean(module && module.classList.contains('active') && window.getComputedStyle(module).display !== 'none');
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
        const sessionSummary = data?.session_summary || {};
        const providerCount = Array.isArray(data?.provider_stats) ? data.provider_stats.length : 0;
        const anomalyCount = Number(anomaly.review_orders || 0)
            + Number(anomaly.failed_orders || 0)
            + Number(anomaly.recent_event_anomalies || 0)
            + Number(anomaly.session_anomalies || 0)
            + Number(anomaly.query_failures || 0);
        const incomeValue = sitewide.recharge_amount != null
            ? sitewide.recharge_amount
            : overview.total_amount;
        const hasSessionSummary = Number(sessionSummary.total_sessions || 0) > 0;

        target.innerHTML = `
            <div class="payments-highlight-pill">
                <i class="fas ${hasSessionSummary ? 'fa-link' : 'fa-credit-card'}"></i>
                <span>${hasSessionSummary ? `匹配 ${escapeHtml(formatPercent(sessionSummary.order_match_rate || sessionSummary.match_rate))}` : `通道 ${escapeHtml(formatNumber(providerCount))}`}</span>
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
            + Number(anomaly.recent_event_anomalies || 0)
            + Number(anomaly.session_anomalies || 0)
            + Number(anomaly.query_failures || 0);

        if (anomalyCount > 0) {
            renderAccessState(`当前有 ${formatNumber(anomalyCount)} 项异常需要关注，请优先查看金额异常、待审核、重复回调、查码失败与支付意图回填。`, 'warning', { preserveBody: true });
            return;
        }

        clearAccessState();
    }

    function syncTabIndicator() {
        const nav = document.getElementById('paymentsTabsNav');
        if (!nav) return;
        const activeButton = nav.querySelector('.admin-tab.active');
        if (!activeButton) return;
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
        const sessionSummary = data?.session_summary || {};
        const querySummary = data?.query_summary || {};
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
                icon: 'fas fa-link',
                label: '意图匹配率',
                value: formatPercent(sessionSummary.order_match_rate || sessionSummary.match_rate),
                help: Number(sessionSummary.total_sessions || 0) > 0
                    ? `${formatNumber(sessionSummary.matched_sessions)} / ${formatNumber(sessionSummary.total_sessions)} 会话已回填 · 自动 ${formatNumber(sessionSummary.webhook_linked_sessions)} · 兜底 ${formatNumber(sessionSummary.fallback_linked_sessions)}`
                    : '当前时间范围内暂无可统计的支付意图'
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
                value: formatNumber(Number(anomaly.recent_event_anomalies || 0) + Number(anomaly.session_anomalies || 0)),
                help: `${formatNumber(anomaly.duplicate_webhook_orders)} 个订单出现重复回调 · 会话异常 ${formatNumber(anomaly.session_anomalies)}`,
                tone: 'warning'
            },
            {
                icon: 'fas fa-magnifying-glass-chart',
                label: '查码成功率',
                value: Number(querySummary.total_attempts || 0) > 0 ? formatPercent(querySummary.success_rate) : '—',
                help: Number(querySummary.total_attempts || 0) > 0
                    ? `${formatNumber(querySummary.failed_attempts)} 次失败 · 总查询 ${formatNumber(querySummary.total_attempts)} 次`
                    : '当前时间范围内暂无查码请求',
                tone: Number(querySummary.failed_attempts || 0) > 0 ? 'warning' : 'info'
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
                        · 意图匹配 ${escapeHtml(formatPercent(item.order_match_rate || item.session_match_rate))}
                        · webhook ${escapeHtml(formatPercent(item.webhook_success_rate || 0))}
                        · 查码 ${Number(item.query_total || 0) > 0 ? escapeHtml(formatPercent(item.query_success_rate || 0)) : '—'}
                    </div>
                    <div class="payments-provider-extra">
                        <span>${escapeHtml(formatCurrency(item.total_amount))}</span>
                        <span>${escapeHtml(formatPoints(item.total_points))}</span>
                        <span>会话 ${escapeHtml(formatNumber(item.session_total))} · 已匹配 ${escapeHtml(formatNumber(item.session_matched))}</span>
                        <span>自动回填 ${escapeHtml(formatPercent(item.auto_link_rate || 0))} · 人工/兜底 ${escapeHtml(formatPercent(item.fallback_link_rate || 0))}</span>
                    </div>
                </div>
                <div class="payments-provider-badges">
                    <span class="payments-mini-badge">${escapeHtml(formatNumber(item.review_orders))} 待审核</span>
                    <span class="payments-mini-badge danger">${escapeHtml(formatNumber(item.failed_orders))} 异常</span>
                    ${Number(item.session_stale || 0) > 0 ? `<span class="payments-mini-badge warning">${escapeHtml(formatNumber(item.session_stale))} 待回填</span>` : ''}
                    ${Number(item.session_failed || 0) > 0 ? `<span class="payments-mini-badge danger">${escapeHtml(formatNumber(item.session_failed))} 会话失败</span>` : ''}
                    ${Number(item.fallback_links || 0) > 0 ? `<span class="payments-mini-badge info">${escapeHtml(formatNumber(item.fallback_links))} 兜底</span>` : ''}
                    ${Number(item.webhook_4xx || 0) > 0 ? `<span class="payments-mini-badge warning">${escapeHtml(formatNumber(item.webhook_4xx))} webhook 4xx</span>` : ''}
                    ${Number(item.webhook_5xx || 0) > 0 ? `<span class="payments-mini-badge danger">${escapeHtml(formatNumber(item.webhook_5xx))} webhook 5xx</span>` : ''}
                    ${Number(item.query_failed || 0) > 0 ? `<span class="payments-mini-badge warning">${escapeHtml(formatNumber(item.query_failed))} 查码失败</span>` : ''}
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
                            <div class="payments-trend-bar-visual" aria-hidden="true">
                                <svg class="payments-trend-bar-svg" viewBox="0 0 24 100" preserveAspectRatio="none">
                                    <defs>
                                        <linearGradient id="paymentsTrendTotalGradient-${index}" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.95"></stop>
                                            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.36"></stop>
                                        </linearGradient>
                                        <linearGradient id="paymentsTrendAnomalyGradient-${index}" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#f87171" stop-opacity="0.96"></stop>
                                            <stop offset="100%" stop-color="#dc2626" stop-opacity="0.42"></stop>
                                        </linearGradient>
                                    </defs>
                                    <rect class="payments-trend-bar-total" x="0" y="${100 - totalHeight}" width="24" height="${totalHeight}" rx="12" fill="url(#paymentsTrendTotalGradient-${index})"></rect>
                                    <rect class="payments-trend-bar-anomaly" x="0" y="${100 - anomalyHeight}" width="24" height="${anomalyHeight}" rx="12" fill="url(#paymentsTrendAnomalyGradient-${index})"></rect>
                                </svg>
                            </div>
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
                ${renderAnomalyOpsState(item)}
                <div class="payments-anomaly-suggestion">
                    <i class="fas fa-lightbulb"></i>
                    <span>${escapeHtml(getHandlingSuggestion(item))}</span>
                </div>
                <div class="payments-anomaly-meta">
                    <span><small>类型</small><strong>${escapeHtml(getAnomalyTypeLabel(item))}</strong></span>
                    <span><small>通道</small><strong>${escapeHtml(getProviderLabel(item.provider))}</strong></span>
                    <span><small>${escapeHtml(getAnomalyReferenceLabel(item))}</small><strong>${escapeHtml(getAnomalyReferenceValue(item))}</strong></span>
                    <span><small>时间</small><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
                </div>
                ${renderAnomalyActions(item)}
            </div>
                `).join('')}
            </div>
            ${renderPager('anomalies', pager.currentPage, pager.totalPages, pager.totalItems)}
        `;
    }

    function renderExceptionTopics(data) {
        const topicsTarget = document.getElementById('paymentsExceptionTopics');
        const listTarget = document.getElementById('paymentsExceptionTopicList');
        if (!topicsTarget || !listTarget) return;

        const topics = Array.isArray(data?.exception_topics) ? data.exception_topics : [];
        const items = Array.isArray(data?.exception_topic_items) ? data.exception_topic_items : [];
        const activeFilter = String(state.exceptionTopicFilter || 'all').trim().toLowerCase() || 'all';
        const filteredItems = activeFilter === 'all'
            ? items
            : items.filter((item) => String(item?.topic_key || '').trim().toLowerCase() === activeFilter);
        const totalTopicCount = topics.reduce((sum, topic) => sum + Number(topic?.count || 0), 0);

        if (!topics.length) {
            topicsTarget.innerHTML = '<div class="payments-empty-state">当前时间范围内没有需要专题跟进的支付异常。</div>';
            listTarget.innerHTML = '';
            return;
        }

        topicsTarget.innerHTML = `
            <div class="payments-provider-row">
                <div class="payments-provider-copy">
                    <div class="payments-provider-name"><i class="fas fa-layer-group"></i>全部专题</div>
                    <div class="payments-provider-meta">当前范围内共 ${escapeHtml(formatNumber(totalTopicCount))} 项专题异常，点击下方专题查看聚合详情。</div>
                </div>
                <div class="payments-provider-badges">
                    <button type="button" class="payments-anomaly-action-btn ${activeFilter === 'all' ? 'mark_handled' : ''}" data-admin-action="payments-set-exception-topic-filter" data-payments-topic-key="all">查看全部</button>
                </div>
            </div>
            ${topics.map((topic) => `
                <div class="payments-provider-row">
                    <div class="payments-provider-copy">
                        <div class="payments-provider-name"><i class="fas fa-bullseye"></i>${escapeHtml(topic.label || '专题')}</div>
                        <div class="payments-provider-meta">${escapeHtml(topic.description || '')}</div>
                    </div>
                    <div class="payments-provider-badges">
                        <span class="payments-mini-badge ${escapeHtml(topic.severity === 'critical' ? 'danger' : (topic.severity === 'warning' ? 'warning' : 'info'))}">${escapeHtml(formatNumber(topic.count || 0))} 项</span>
                        <button type="button" class="payments-anomaly-action-btn ${activeFilter === String(topic.key || '').trim().toLowerCase() ? 'mark_handled' : ''}" data-admin-action="payments-set-exception-topic-filter" data-payments-topic-key="${escapeHtml(topic.key)}">查看</button>
                    </div>
                </div>
            `).join('')}
        `;

        if (!filteredItems.length) {
            listTarget.innerHTML = '<div class="payments-empty-state compact">当前专题下没有新的明细项。</div>';
            return;
        }

        listTarget.innerHTML = `
            <div class="payments-anomaly-items">
                ${filteredItems.map((item) => `
                    <div class="payments-anomaly-item severity-${escapeHtml(item.severity || 'info')}">
                        <div class="payments-anomaly-top">
                            <div class="payments-anomaly-copy">
                                <div class="payments-anomaly-title">${escapeHtml(item.title || '专题项')}</div>
                                <div class="payments-anomaly-message">${escapeHtml(item.message || '')}</div>
                            </div>
                            <span class="payments-anomaly-severity">${escapeHtml(getSeverityLabel(item.severity))}</span>
                        </div>
                        ${item.type === 'query' ? '' : renderAnomalyOpsState(item)}
                        <div class="payments-anomaly-suggestion">
                            <i class="fas fa-lightbulb"></i>
                            <span>${escapeHtml(getHandlingSuggestion(item))}</span>
                        </div>
                        <div class="payments-anomaly-meta">
                            <span><small>专题</small><strong>${escapeHtml(item.topic_label || '支付异常')}</strong></span>
                            <span><small>通道</small><strong>${escapeHtml(getProviderLabel(item.provider))}</strong></span>
                            <span><small>${escapeHtml(getAnomalyReferenceLabel(item))}</small><strong>${escapeHtml(getAnomalyReferenceValue(item))}</strong></span>
                            <span><small>时间</small><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
                        </div>
                        ${renderAnomalyActions(item)}
                    </div>
                `).join('')}
            </div>
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

        function renderOrderMatchBadge(order) {
            const info = getCheckoutSessionMatchInfo(order);
            return `<span class="payments-mini-badge ${escapeHtml(info.tone || 'muted')}">${escapeHtml(info.label)}</span>`;
        }

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
                                    <label>意图匹配</label>
                                    <span>${renderOrderMatchBadge(order)}</span>
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
                            <th>意图匹配</th>
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
                                <td>${renderOrderMatchBadge(order)}</td>
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
                ${CLEANUP_SCOPE_HTML}
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
        renderExceptionTopics(state.summary);
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
                不影响上方支付概览和异常队列。${CLEANUP_SCOPE_HTML}
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
        renderExceptionTopics(data);
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

    async function handleAnomalyAction(targetType, targetId, action) {
        const normalizedTargetType = String(targetType || '').trim().toLowerCase();
        const normalizedTargetId = String(targetId || '').trim();
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!normalizedTargetType || !normalizedTargetId || !normalizedAction) return;

        let note = '';
        if (NOTE_REQUIRED_ACTIONS.has(normalizedAction)) {
            note = String(window.prompt(getAnomalyActionPrompt(normalizedAction), '') || '').trim();
            if (!note) {
                window.showToast?.('敏感操作必须填写处理备注。', 'warning');
                return;
            }
        }

        const actionKey = `${normalizedTargetType}:${normalizedTargetId}`;
        if (state.anomalyActionLoading[actionKey]) return;

        state.anomalyActionLoading[actionKey] = true;
        renderAnomalies(state.summary || {});

        try {
            const payload = await fetchAdminJson('/api/admin/payments/actions', {
                method: 'POST',
                body: JSON.stringify({
                    targetType: normalizedTargetType,
                    targetId: normalizedTargetId,
                    action: normalizedAction,
                    note: note || undefined
                })
            });

            window.showToast?.(`${getAnomalyActionLabel(normalizedAction)}成功`, 'success');
            state.viewCache = {};
            await reload();
            return payload;
        } catch (error) {
            console.error('[AdminPayments] Failed to handle anomaly action:', error);
            window.showToast?.(getFriendlyErrorMessage(error, '异常操作执行失败，请稍后重试。'), 'error');
            throw error;
        } finally {
            delete state.anomalyActionLoading[actionKey];
            if (state.summary) {
                renderAnomalies(state.summary);
            }
        }
    }

    function setExceptionTopicFilter(topicKey = 'all') {
        state.exceptionTopicFilter = String(topicKey || 'all').trim().toLowerCase() || 'all';
        renderExceptionTopics(state.summary || {});
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
                let resizeTimer = null;
                window.addEventListener('resize', () => {
                    syncTabIndicator();
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

        const confirmed = window.confirm(CLEANUP_SCOPE_TEXT);
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
            query_summary: overviewPayload.query_summary || {},
            anomaly_summary: overviewPayload.anomaly_summary || opsPayload.anomaly_summary || {},
            provider_stats: overviewPayload.provider_stats || [],
            trend_24h: overviewPayload.trend_24h || [],
            sitewide_summary: financePayload.sitewide_summary || {},
            business_breakdown: financePayload.business_breakdown || [],
            points_breakdown: financePayload.points_breakdown || [],
            exception_topics: opsPayload.exception_topics || [],
            exception_topic_items: opsPayload.exception_topic_items || [],
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
        goToPage,
        handleAnomalyAction,
        setExceptionTopicFilter
    };
})();
