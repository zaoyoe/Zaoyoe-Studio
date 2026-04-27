// ========================================
// ADMIN DISCOUNTS MODULE (Phase 2)
// Handles creation and management of Discount Codes
// ========================================

const DISCOUNTS_ACTIVATION_REFRESH_TTL_MS = 15000;

const AdminDiscounts = {
    requireWritableSite(options = {}) {
        return window.AdminSiteFilter?.requireWritableSite?.(options) || null;
    },

    emitCommandFeedback: function (message = '', feedbackState = 'saved', options = {}) {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) {
            return null;
        }

        const detail = {
            kind: 'module-result',
            source: String(options?.source || 'discounts-generate').trim().toLowerCase() || 'discounts-generate',
            module: 'discounts',
            state: String(feedbackState || options?.state || 'saved').trim().toLowerCase() || 'saved',
            tone: String(options?.tone || '').trim().toLowerCase(),
            message: normalizedMessage,
            persistent: options?.persistent === true,
            timestamp: Date.now()
        };

        if (typeof window.dispatchAdminStudioFeedbackSignal === 'function') {
            return window.dispatchAdminStudioFeedbackSignal(detail);
        }

        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            try {
                window.dispatchEvent(new CustomEvent('admin-feedback-signal', { detail }));
            } catch (_) {
                // Discount operations should not depend on Command Center rendering.
            }
        }

        return detail;
    },

    discounts: [],
    filteredDiscounts: [],
    scopeSummary: null,
    currentPage: 1,
    itemsPerPage: 10,
    controlsBound: false,
    moduleInitialized: false,
    restrictionOptionsLoaded: false,
    restrictionOptionsPromise: null,
    listLoadPromise: null,
    listRequestToken: 0,
    lastListLoadedAt: 0,
    lastListSite: '',
    generateSubmitInFlight: false,
    categories: [],
    products: [],
    categoryNameMap: new Map(),
    productNameMap: new Map(),
    workbenchContext: null,
    modalMode: 'create',
    editingDiscountId: '',
    detailCache: new Map(),
    activeDetailId: '',
    detailRequestToken: 0,
    detailTimelineFilter: 'all',
    restoreModalDiscountId: '',
    batchRestoreResult: null,
    batchRestoreHistoryState: {
        loaded: false,
        loading: false,
        error: '',
        runs: []
    },
    batchRestoreHistoryView: {
        status: 'all',
        search: ''
    },
    activeBatchRestoreHistoryRunId: '',
    filters: {
        status: 'all', // all, scheduled, active, paused_risk, paused_manual, expired, exhausted
        search: ''
    },

    getReadSite: function () {
        return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
    },

    isVisible: function () {
        const module = document.getElementById('module-discounts');
        return Boolean(module && module.classList.contains('active') && !module.hidden);
    },

    normalizeShellContextObject: function (value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    },

    resolveShellDiscountSearchValue: function (context = {}) {
        const normalizedContext = this.normalizeShellContextObject(context);
        const focus = this.normalizeShellContextObject(normalizedContext.focus);
        const payload = this.normalizeShellContextObject(normalizedContext.payload);
        const raw = this.normalizeShellContextObject(normalizedContext.raw);
        const referenceLabel = this.safeText(
            payload.referenceLabel
            || payload.reference_label
            || raw.referenceLabel
            || raw.reference_label
            || normalizedContext.referenceLabel
            || normalizedContext.reference_label
        ).trim();

        return this.safeText(
            focus.discountCode
            || focus.discount_code
            || payload.discountCode
            || payload.discount_code
            || raw.discountCode
            || raw.discount_code
            || normalizedContext.discountCode
            || normalizedContext.discount_code
            || ((referenceLabel === '优惠码' || referenceLabel === '优惠券码')
                ? (payload.referenceValue || payload.reference_value || raw.referenceValue || raw.reference_value || normalizedContext.referenceValue || normalizedContext.reference_value)
                : '')
            || payload.search
            || payload.searchQuery
            || payload.query
            || raw.search
            || raw.searchQuery
            || raw.query
            || normalizedContext.search
            || normalizedContext.searchQuery
            || normalizedContext.query
            || ''
        ).trim();
    },

    buildShellWorkbenchContext: function (context = {}) {
        const normalizedContext = this.normalizeShellContextObject(context);
        const payload = this.normalizeShellContextObject(normalizedContext.payload);
        const raw = this.normalizeShellContextObject(normalizedContext.raw);
        const focus = this.normalizeShellContextObject(normalizedContext.focus);

        return {
            ...raw,
            ...payload,
            title: payload.title || raw.title || normalizedContext.title || '',
            alertType: payload.alertType || payload.alert_type || raw.alertType || raw.alert_type || normalizedContext.alertType || normalizedContext.alert_type || '',
            referenceLabel: payload.referenceLabel || payload.reference_label || raw.referenceLabel || raw.reference_label || normalizedContext.referenceLabel || normalizedContext.reference_label || '',
            referenceValue: payload.referenceValue || payload.reference_value || raw.referenceValue || raw.reference_value || normalizedContext.referenceValue || normalizedContext.reference_value || '',
            targetId: payload.targetId || payload.target_id || raw.targetId || raw.target_id || normalizedContext.targetId || normalizedContext.target_id || '',
            discountCode: focus.discountCode || focus.discount_code || payload.discountCode || payload.discount_code || raw.discountCode || raw.discount_code || normalizedContext.discountCode || normalizedContext.discount_code || '',
            signalType: payload.signalType || payload.signal_type || raw.signalType || raw.signal_type || normalizedContext.signalType || normalizedContext.signal_type || '',
            site: normalizedContext.site || payload.site || raw.site || ''
        };
    },

    shouldReloadListOnActivate: function ({ force = false } = {}) {
        const currentSite = this.getReadSite();
        if (force || !this.lastListLoadedAt || !this.discounts.length) {
            return true;
        }

        if (this.lastListSite !== currentSite) {
            return true;
        }

        return (Date.now() - this.lastListLoadedAt) > DISCOUNTS_ACTIVATION_REFRESH_TTL_MS;
    },

    handleSiteChange: function () {
        this.lastListLoadedAt = 0;
        this.lastListSite = '';
        this.currentPage = 1;
        this.detailCache.clear();
        this.activeDetailId = '';
        this.batchRestoreResult = null;
        this.activeBatchRestoreHistoryRunId = '';
        this.batchRestoreHistoryState = {
            loaded: false,
            loading: false,
            error: '',
            runs: []
        };

        if (!this.isVisible()) {
            return false;
        }

        void this.loadDiscounts({
            force: true,
            showLoading: true
        });
        return true;
    },

    buildAdminDiscountsUrl: function (route, params = {}) {
        const url = new URL(`/api/admin/${route}`, window.location.origin);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            url.searchParams.set(key, String(value));
        });
        return `${url.pathname}${url.search}`;
    },

    parseAdminDiscountsResponse: async function (response) {
        let payload = {};
        try {
            payload = await response.json();
        } catch (_) {
            payload = {};
        }

        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || `优惠券请求失败 (${response.status})`);
        }

        return payload;
    },

    mutateDiscountsViaAdminApi: async function ({ action = '', site = '', payload = {} } = {}) {
        const response = await (window.AdminApi?.fetch || fetch)(this.buildAdminDiscountsUrl('discounts/mutate'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action,
                site,
                ...(payload && typeof payload === 'object' ? payload : {})
            })
        });

        return this.parseAdminDiscountsResponse(response);
    },

    loadDiscountDetailViaAdminApi: async function ({ id = '', code = '' } = {}) {
        const response = await (window.AdminApi?.fetch || fetch)(this.buildAdminDiscountsUrl('discounts/detail', {
            site: this.getReadSite(),
            id: this.safeText(id),
            code: this.safeText(code).toUpperCase()
        }), {
            credentials: 'include'
        });

        return this.parseAdminDiscountsResponse(response);
    },

    loadBatchRestoreHistoryViaAdminApi: async function () {
        const response = await (window.AdminApi?.fetch || fetch)(this.buildAdminDiscountsUrl('discounts/batch-history', {
            site: this.getReadSite()
        }), {
            credentials: 'include'
        });

        return this.parseAdminDiscountsResponse(response);
    },

    recordBatchRestoreRunViaAdminApi: async function (payload = {}) {
        const response = await (window.AdminApi?.fetch || fetch)(this.buildAdminDiscountsUrl('discounts/batch-history'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload && typeof payload === 'object' ? payload : {})
        });

        return this.parseAdminDiscountsResponse(response);
    },

    assignDiscountAssetsViaAdminApi: async function ({ site = '', payload = {} } = {}) {
        const response = await (window.AdminApi?.fetch || fetch)(this.buildAdminDiscountsUrl('discounts/assets'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'assign',
                site,
                ...(payload && typeof payload === 'object' ? payload : {})
            })
        });

        return this.parseAdminDiscountsResponse(response);
    },

    buildDiscountAssetAssignmentSummary: function (result = {}) {
        const assignedCount = Math.max(0, Number(result?.assigned_count || 0));
        const skippedCount = Math.max(0, Number(result?.skipped_count || 0));
        const unresolvedCount = Math.max(0, Number(result?.unresolved_count || 0));
        const summaryParts = [`成功发放 ${assignedCount} 张`];
        if (skippedCount > 0) summaryParts.push(`跳过 ${skippedCount} 张`);
        if (unresolvedCount > 0) summaryParts.push(`未识别 ${unresolvedCount} 个目标`);
        return summaryParts.join('，');
    },

    assignAssetsToDiscount: async function ({ site = '', discountId = '', recipients = '', recipientTags = '', sourceChannel = '', audienceSegment = '' } = {}) {
        return this.assignDiscountAssetsViaAdminApi({
            site,
            payload: {
                discount_id: this.safeText(discountId),
                recipients: this.safeText(recipients),
                recipient_tags: this.safeText(recipientTags),
                source_channel: this.safeText(sourceChannel),
                audience_segment: this.safeText(audienceSegment)
            }
        });
    },

    escapeHtml: function (value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    safeText: function (value) {
        return String(value ?? '').trim();
    },

    generateBatchRunId: function () {
        try {
            if (typeof globalThis.crypto?.randomUUID === 'function') {
                return globalThis.crypto.randomUUID();
            }
        } catch (_) {
            // fall back to timestamp-based id
        }

        return `discount-batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    },

    normalizeDiscountSite: function (value, fallback = 'all') {
        const normalized = String(value ?? '').trim().toLowerCase();
        if (!normalized) return fallback;
        if (normalized === 'global') return 'all';
        if (['all', 'cn', 'intl'].includes(normalized)) return normalized;
        return fallback;
    },

    formatSiteLabel: function (value, { includeScopeSuffix = false } = {}) {
        const normalized = this.normalizeDiscountSite(value, 'all');
        if (normalized === 'cn') {
            return includeScopeSuffix ? 'CN 专属' : 'CN';
        }
        if (normalized === 'intl') {
            return includeScopeSuffix ? 'INTL 专属' : 'INTL';
        }
        return includeScopeSuffix ? '全站通用' : '全站';
    },

    formatDate: function (value, options = {}) {
        const normalized = this.safeText(value);
        if (!normalized) return '';
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) {
            return normalized;
        }

        if (options.includeTime) {
            return parsed.toLocaleString();
        }
        return parsed.toLocaleDateString();
    },

    toDateInputValue: function (value) {
        const normalized = this.safeText(value);
        if (!normalized) return '';
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) return '';

        const year = parsed.getFullYear();
        const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
        const day = `${parsed.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    toTimeInputValue: function (value) {
        const normalized = this.safeText(value);
        if (!normalized) return '';
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) return '';

        const hours = `${parsed.getHours()}`.padStart(2, '0');
        const minutes = `${parsed.getMinutes()}`.padStart(2, '0');
        return `${hours}:${minutes}`;
    },

    normalizeWorkbenchContext: function (context = {}) {
        if (!context || typeof context !== 'object' || Array.isArray(context)) {
            return null;
        }

        return {
            title: this.safeText(context.title || context.workspaceTitle),
            alertType: this.safeText(context.alertType || context.alert_type).toLowerCase(),
            referenceLabel: this.safeText(context.referenceLabel || context.reference_label),
            referenceValue: this.safeText(context.referenceValue || context.reference_value),
            targetId: this.safeText(context.targetId || context.target_id),
            discountCode: this.safeText(context.discountCode || context.discount_code || context.workspaceDiscountCode),
            signalType: this.safeText(context.signalType || context.signal_type || context.workspaceSignalType).toLowerCase(),
            site: this.safeText(context.site || context.siteKey).toLowerCase()
        };
    },

    formatWorkbenchSignalLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (!normalized) return '';
        if (normalized === 'discount_code_spike') return '优惠码高频异常';
        if (normalized === 'coupon') return '优惠码风险';
        return normalized
            .split(/[_-]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    },

    formatRiskLevelLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (!normalized) return '';
        if (normalized === 'critical') return '高风险';
        if (normalized === 'warning') return '中风险';
        if (normalized === 'info') return '提示';
        return normalized;
    },

    formatCaseStatusLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (!normalized) return '';
        if (normalized === 'claimed') return '已认领';
        if (normalized === 'resolved') return '已解决';
        if (normalized === 'open') return '待处理';
        return normalized;
    },

    formatDetailTimelineStateLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (!normalized) return '';
        if (normalized === 'problem') return '风险告警';
        if (normalized === 'recovered') return '风险恢复';
        return this.formatCaseStatusLabel(normalized) || normalized;
    },

    normalizeDetailTimelineFilter: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        return ['all', 'alerts', 'cases', 'restore'].includes(normalized) ? normalized : 'all';
    },

    normalizeBatchRestoreHistoryFilter: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        return ['all', 'success', 'failed', 'retry'].includes(normalized) ? normalized : 'all';
    },

    formatDiscountStatusFilterLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (normalized === 'scheduled') return '待生效';
        if (normalized === 'active') return '生效中';
        if (normalized === 'paused_risk') return '风控停用';
        if (normalized === 'paused_manual') return '手动停用';
        if (normalized === 'expired') return '已过期';
        if (normalized === 'exhausted') return '已用尽';
        return '全部';
    },

    formatRecoveryStrategyLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (normalized === 'auto_restore') return '自动恢复';
        if (normalized === 'observation_then_restore') return '恢复后观察期';
        return '仅人工恢复';
    },

    formatDistributionModeLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (normalized === 'public_claim') return '公开领券';
        if (normalized === 'user_assigned') return '定向发券';
        return '通用暗码';
    },

    formatPricingApplyStageLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (normalized === 'catalog_price') return '目录价阶段';
        if (normalized === 'balance_offset') return '余额抵扣阶段';
        return '订单优惠阶段';
    },

    formatStackingModeLabel: function (discount = {}) {
        return discount?.is_exclusive === false ? '可并行权益' : '排他券';
    },

    formatAssetStatusLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (normalized === 'used') return '已使用';
        if (normalized === 'expired') return '已失效';
        if (normalized === 'revoked') return '已撤销';
        return '可使用';
    },

    formatStatusReasonLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (!normalized) return '';
        if (normalized === 'scheduled_start') return '等待生效';
        if (normalized === 'manual_pause') return '手动停用';
        if (normalized === 'manual_restore') return '人工恢复';
        if (normalized === 'manual_active') return '人工启用';
        if (normalized === 'risk_auto_pause') return '风控自动停用';
        if (normalized === 'risk_auto_restore') return '风控自动恢复';
        if (normalized === 'risk_observation') return '观察期';
        if (normalized === 'expired') return '自然过期';
        if (normalized === 'quota_exhausted') return '额度用尽';
        if (normalized === 'archived') return '历史归档';
        return normalized;
    },

    formatBatchRestoreSourceLabel: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (normalized === 'risk_restore_batch_modal') return '当前筛选批量恢复';
        if (normalized === 'risk_restore_history_retry') return '历史失败项重试';
        if (normalized === 'risk_restore_modal') return '单券恢复审批';
        return '';
    },

    buildWorkbenchContextState: function (context = this.workbenchContext) {
        const normalized = this.normalizeWorkbenchContext(context);
        if (!normalized) {
            return null;
        }

        const discountCode = this.safeText(
            normalized.discountCode
            || (normalized.referenceLabel === '优惠码' ? normalized.referenceValue : '')
            || (normalized.targetId.startsWith('shop_order_risk:coupon:') ? normalized.targetId.split(':').slice(2).join(':') : '')
        ).toUpperCase();
        const isRiskFocus = normalized.targetId.startsWith('shop_order_risk:coupon:')
            || normalized.signalType.includes('discount')
            || normalized.signalType.includes('coupon')
            || normalized.alertType.includes('shop_order_risk');

        if (!discountCode && !normalized.title && !normalized.referenceValue) {
            return null;
        }

        const chips = [];
        if (discountCode) {
            chips.push({ label: '优惠码', value: discountCode });
        }
        if (normalized.site === 'cn' || normalized.site === 'intl') {
            chips.push({ label: '站点', value: normalized.site === 'intl' ? 'INTL' : 'CN' });
        }
        if (normalized.referenceLabel && normalized.referenceValue && normalized.referenceLabel !== '优惠码') {
            chips.push({ label: normalized.referenceLabel, value: normalized.referenceValue });
        }
        if (normalized.signalType) {
            chips.push({ label: '信号', value: this.formatWorkbenchSignalLabel(normalized.signalType) });
        }

        return {
            eyebrow: isRiskFocus ? '优惠码风控焦点' : '优惠码联动上下文',
            title: normalized.title || (discountCode ? `当前聚焦优惠码 ${discountCode}` : '当前聚焦优惠券上下文'),
            summary: isRiskFocus
                ? '当前页由商城风控入口联动打开，建议先确认停券状态、适用范围和剩余次数，再决定是否恢复或调整配置。'
                : '当前页保留了外部工作区带来的优惠券上下文，适合围绕同一优惠码继续查看限制条件与生效状态。',
            chips
        };
    },

    showWorkbenchContext: function (context = {}) {
        const target = document.getElementById('discountsWorkbenchContext');
        if (!target) return false;

        this.workbenchContext = this.normalizeWorkbenchContext(context);
        const state = this.buildWorkbenchContextState(this.workbenchContext);
        if (!state) {
            target.hidden = true;
            target.innerHTML = '';
            return false;
        }

        target.innerHTML = `
            <div class="admin-workbench-context-note__eyebrow">${this.escapeHtml(state.eyebrow || '优惠码联动上下文')}</div>
            <div class="admin-workbench-context-note__title">${this.escapeHtml(state.title || '当前聚焦优惠券上下文')}</div>
            <div class="admin-workbench-context-note__summary">${this.escapeHtml(state.summary || '')}</div>
            <div class="admin-workbench-context-note__chips">
                ${(Array.isArray(state.chips) ? state.chips : []).map((item) => `
                    <span class="admin-workbench-context-note__chip">${this.escapeHtml(item.label || '')} · ${this.escapeHtml(item.value || '')}</span>
                `).join('')}
                <button type="button"
                    class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                    data-admin-action="discounts-clear-workbench-context">清除联动上下文</button>
            </div>
        `;
        target.hidden = false;
        return true;
    },

    clearWorkbenchContext: function () {
        return this.showWorkbenchContext(null);
    },

    renderScopeHint: function ({ status = 'idle', message = '', scopeSummary = null } = {}) {
        const target = document.getElementById('discountsScopeHint');
        if (!target) return;

        target.className = 'admin-discount-scope-hint';

        if (status === 'loading') {
            target.classList.add('admin-discount-scope-hint--loading');
            target.textContent = message || '正在按当前站点口径加载优惠券...';
            return;
        }

        if (status === 'error') {
            target.classList.add('admin-discount-scope-hint--error');
            target.textContent = message || '优惠券列表加载失败，请稍后重试。';
            return;
        }

        const summary = scopeSummary && typeof scopeSummary === 'object' ? scopeSummary : {};
        const currentSite = this.normalizeDiscountSite(this.getReadSite(), 'all');

        if (summary.mode === 'site_plus_global' && currentSite !== 'all') {
            const currentSiteLabel = this.formatSiteLabel(currentSite);
            const otherSite = summary.other_site || (currentSite === 'cn' ? 'intl' : 'cn');
            target.innerHTML = `当前为 ${this.escapeHtml(currentSiteLabel)} 视图，会显示该站点可用的优惠券：<strong class="admin-discount-scope-hint__count">${this.escapeHtml(String(summary.site_specific_count || 0))}</strong> 张 ${this.escapeHtml(this.formatSiteLabel(currentSite, { includeScopeSuffix: true }))} + <strong class="admin-discount-scope-hint__count">${this.escapeHtml(String(summary.global_count || 0))}</strong> 张全站券；<strong class="admin-discount-scope-hint__count">${this.escapeHtml(String(summary.other_site_count || 0))}</strong> 张 ${this.escapeHtml(this.formatSiteLabel(otherSite, { includeScopeSuffix: true }))} 已隐藏。`;
            return;
        }

        target.innerHTML = `当前为全站视图，共加载 <strong class="admin-discount-scope-hint__count">${this.escapeHtml(String(summary.visible_count || 0))}</strong> 张优惠券，其中全站券 <strong class="admin-discount-scope-hint__count">${this.escapeHtml(String(summary.global_count || 0))}</strong> 张，CN 专属 <strong class="admin-discount-scope-hint__count">${this.escapeHtml(String(summary.cn_count || 0))}</strong> 张，INTL 专属 <strong class="admin-discount-scope-hint__count">${this.escapeHtml(String(summary.intl_count || 0))}</strong> 张。`;
    },

    createTableStateRow: function ({ message, icon = 'fa-inbox', variant = 'empty', spinning = false }) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        const wrapper = document.createElement('div');
        const iconNode = document.createElement('i');
        const textNode = document.createElement('span');

        cell.colSpan = 6;
        cell.className = `empty-state admin-discount-table-state-cell admin-discount-table-state-cell--${variant}`;

        wrapper.className = 'admin-discount-table-state';
        iconNode.className = `fas ${icon}${spinning ? ' fa-spin' : ''} admin-discount-table-state-icon`;
        textNode.className = 'admin-discount-table-state-text';
        textNode.textContent = String(message ?? '暂无数据');

        wrapper.appendChild(iconNode);
        wrapper.appendChild(textNode);
        cell.appendChild(wrapper);
        row.appendChild(cell);
        return row;
    },

    buildTableLoadingSkeleton: function (rowCount = 6) {
        const rows = Math.max(4, Number.parseInt(rowCount, 10) || 6);
        const codeWidths = [92, 108, 96, 104];
        const typeWidths = [78, 92, 86, 94];
        const typeMetaWidths = ['admin-skeleton-w-20', 'admin-skeleton-w-30', 'admin-skeleton-w-20', 'admin-skeleton-w-30'];
        const usageWidths = ['admin-skeleton-w-50', 'admin-skeleton-w-60', 'admin-skeleton-w-50', 'admin-skeleton-w-40'];
        const expiryWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40', 'admin-skeleton-w-30', 'admin-skeleton-w-40'];
        const policyWidths = [
            ['admin-skeleton-w-50', 'admin-skeleton-w-40', 86],
            ['admin-skeleton-w-60', 'admin-skeleton-w-50', 92],
            ['admin-skeleton-w-50', 'admin-skeleton-w-40', 84],
            ['admin-skeleton-w-60', 'admin-skeleton-w-50', 88]
        ];

        return Array.from({ length: rows }, (_, index) => `
            <tr class="admin-table-skeleton-row admin-discount-table-skeleton-row" aria-hidden="true" data-skeleton-index="${index}">
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-discount-skeleton-code" style="width:${codeWidths[index % codeWidths.length]}px"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack admin-discount-skeleton-stack">
                        <span class="admin-skeleton-block admin-skeleton-block--title" style="width:${typeWidths[index % typeWidths.length]}px"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${typeMetaWidths[index % typeMetaWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack admin-discount-skeleton-stack">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${usageWidths[index % usageWidths.length]}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${expiryWidths[index % expiryWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack admin-discount-skeleton-stack admin-discount-skeleton-stack--center">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${expiryWidths[index % expiryWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack admin-discount-skeleton-stack admin-discount-skeleton-stack--center">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${policyWidths[index % policyWidths.length][0]}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${policyWidths[index % policyWidths.length][1]}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--pill" style="width:${policyWidths[index % policyWidths.length][2]}px"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-actions admin-discount-action-wrap">
                        <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    setGenerateModalVisible: function (visible) {
        const modal = document.getElementById('discountGenerateModal');
        if (!modal) return;
        modal.classList.toggle('is-visible', visible);
        modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
    },

    setTypeDropdownOpen: function (open) {
        const dropdown = document.getElementById('discountTypeDropdown');
        if (!dropdown) return;
        dropdown.classList.toggle('is-open', open);
        dropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
    },

    buildGenerateTimeOptions: function () {
        if (Array.isArray(this.generateTimeOptionsCache) && this.generateTimeOptionsCache.length) {
            return this.generateTimeOptionsCache;
        }

        const options = [];
        for (let hour = 0; hour < 24; hour += 1) {
            for (let minute = 0; minute < 60; minute += 15) {
                const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                options.push({ value: label, label });
            }
        }

        options.push({ value: '23:59', label: '23:59', meta: '自然日结束' });
        this.generateTimeOptionsCache = options;
        return options;
    },

    getGenerateCustomSelectConfigs: function () {
        const timeOptions = this.buildGenerateTimeOptions();

        return {
            site: {
                inputId: 'discountApplicableSite',
                triggerId: 'discountApplicableSiteTrigger',
                labelId: 'discountApplicableSiteLabel',
                dropdownId: 'discountApplicableSiteDropdown',
                optionSelector: '[data-discount-generate-select-option="site"]',
                defaultValue: '',
                options: [
                    { value: '', label: '全部站点', meta: '国内站和国际站都可以使用' },
                    { value: 'cn', label: '仅 CN', meta: '只在国内站生效' },
                    { value: 'intl', label: '仅 INTL', meta: '只在国际站生效' }
                ]
            },
            'scope-type': {
                inputId: 'discountScopeType',
                triggerId: 'discountScopeTypeTrigger',
                labelId: 'discountScopeTypeLabel',
                dropdownId: 'discountScopeTypeDropdown',
                optionSelector: '[data-discount-generate-select-option="scope-type"]',
                defaultValue: 'all',
                options: [
                    { value: 'all', label: '全部商品', meta: '不限制分类和具体商品' },
                    { value: 'category', label: '指定分类', meta: '只允许指定分类商品使用' },
                    { value: 'product', label: '指定商品', meta: '只允许单个商品使用' }
                ]
            },
            'scope-category': {
                inputId: 'discountScopeCategory',
                triggerId: 'discountScopeCategoryTrigger',
                labelId: 'discountScopeCategoryLabel',
                dropdownId: 'discountScopeCategoryDropdown',
                optionSelector: '[data-discount-generate-select-option="scope-category"]',
                defaultValue: '',
                options: [
                    { value: '', label: '请选择分类', meta: '按分类限制优惠券使用范围' },
                    ...this.categories.map((category) => {
                        const value = String(category.name ?? category.id ?? '').trim();
                        return { value, label: value || String(category.id || '') };
                    })
                ]
            },
            'scope-product': {
                inputId: 'discountScopeProduct',
                triggerId: 'discountScopeProductTrigger',
                labelId: 'discountScopeProductLabel',
                dropdownId: 'discountScopeProductDropdown',
                optionSelector: '[data-discount-generate-select-option="scope-product"]',
                defaultValue: '',
                options: [
                    { value: '', label: '请选择商品', meta: '按单个商品限制优惠券使用范围' },
                    ...this.products.map((product) => ({
                        value: String(product.id),
                        label: product.name || String(product.id)
                    }))
                ]
            },
            'recovery-strategy': {
                inputId: 'discountRecoveryStrategy',
                triggerId: 'discountRecoveryStrategyTrigger',
                labelId: 'discountRecoveryStrategyLabel',
                dropdownId: 'discountRecoveryStrategyDropdown',
                optionSelector: '[data-discount-generate-select-option="recovery-strategy"]',
                defaultValue: 'manual_only',
                options: [
                    { value: 'manual_only', label: '仅人工恢复', meta: '命中风控后需手动复核恢复' },
                    { value: 'auto_restore', label: '风险恢复后自动启用', meta: '恢复信号到达后自动恢复使用' },
                    { value: 'observation_then_restore', label: '自动恢复并进入观察期', meta: '恢复后继续观察一段时间' }
                ]
            },
            'distribution-mode': {
                inputId: 'discountDistributionMode',
                triggerId: 'discountDistributionModeTrigger',
                labelId: 'discountDistributionModeLabel',
                dropdownId: 'discountDistributionModeDropdown',
                optionSelector: '[data-discount-generate-select-option="distribution-mode"]',
                defaultValue: 'general_code',
                options: [
                    { value: 'general_code', label: '通用暗码', meta: '用户输入优惠码后直接核销' },
                    { value: 'public_claim', label: '公开领券', meta: '先领取到卡券包，再下单使用' },
                    { value: 'user_assigned', label: '定向发券', meta: '后台发到指定用户卡券包' }
                ]
            },
            'pricing-stage': {
                inputId: 'discountPricingApplyStage',
                triggerId: 'discountPricingApplyStageTrigger',
                labelId: 'discountPricingApplyStageLabel',
                dropdownId: 'discountPricingApplyStageDropdown',
                optionSelector: '[data-discount-generate-select-option="pricing-stage"]',
                defaultValue: 'order_discount',
                options: [
                    { value: 'catalog_price', label: '目录价阶段', meta: '先作用在商品目录价' },
                    { value: 'order_discount', label: '订单优惠阶段', meta: '在订单优惠阶段生效' },
                    { value: 'balance_offset', label: '余额抵扣阶段', meta: '在余额抵扣前后单独处理' }
                ]
            },
            'starts-at-time': {
                inputId: 'discountStartsAtTime',
                triggerId: 'discountStartsAtTimeTrigger',
                labelId: 'discountStartsAtTimeLabel',
                dropdownId: 'discountStartsAtTimeDropdown',
                optionSelector: '[data-discount-generate-select-option="starts-at-time"]',
                defaultValue: '00:00',
                options: timeOptions
            },
            'expiry-time': {
                inputId: 'discountExpiryTime',
                triggerId: 'discountExpiryTimeTrigger',
                labelId: 'discountExpiryTimeLabel',
                dropdownId: 'discountExpiryTimeDropdown',
                optionSelector: '[data-discount-generate-select-option="expiry-time"]',
                defaultValue: '23:59',
                options: timeOptions
            },
            'claim-starts-at-time': {
                inputId: 'discountClaimStartsAtTime',
                triggerId: 'discountClaimStartsAtTimeTrigger',
                labelId: 'discountClaimStartsAtTimeLabel',
                dropdownId: 'discountClaimStartsAtTimeDropdown',
                optionSelector: '[data-discount-generate-select-option="claim-starts-at-time"]',
                defaultValue: '10:00',
                options: timeOptions
            },
            'claim-expires-at-time': {
                inputId: 'discountClaimExpiresAtTime',
                triggerId: 'discountClaimExpiresAtTimeTrigger',
                labelId: 'discountClaimExpiresAtTimeLabel',
                dropdownId: 'discountClaimExpiresAtTimeDropdown',
                optionSelector: '[data-discount-generate-select-option="claim-expires-at-time"]',
                defaultValue: '23:59',
                options: timeOptions
            }
        };
    },

    getGenerateCustomSelectConfig: function (key = '') {
        const normalizedKey = this.safeText(key).toLowerCase();
        const configs = this.getGenerateCustomSelectConfigs();
        return configs[normalizedKey] || null;
    },

    getGenerateCustomSelectKeys: function () {
        return Object.keys(this.getGenerateCustomSelectConfigs());
    },

    getGenerateCustomSelectOptions: function (key = '', currentValue = '') {
        const config = this.getGenerateCustomSelectConfig(key);
        if (!config) {
            return [];
        }

        const options = Array.isArray(config.options) ? [...config.options] : [];
        const normalizedCurrentValue = this.normalizeGenerateCustomSelectValue(key, currentValue);
        const alreadyExists = options.some((item) => String(item.value) === String(normalizedCurrentValue));

        if (normalizedCurrentValue && !alreadyExists) {
            options.push({ value: normalizedCurrentValue, label: normalizedCurrentValue });
        }

        return options;
    },

    renderGenerateCustomSelectOptions: function (key = '', currentValue = '') {
        const config = this.getGenerateCustomSelectConfig(key);
        if (!config) return;

        const dropdown = document.getElementById(config.dropdownId);
        if (!(dropdown instanceof HTMLElement)) {
            return;
        }

        const options = this.getGenerateCustomSelectOptions(key, currentValue);
        dropdown.innerHTML = options.map((option) => `
            <button type="button"
                class="admin-discount-form-modal__select-option"
                data-discount-generate-select-option="${this.escapeHtml(key)}"
                data-select-value="${this.escapeHtml(String(option.value ?? ''))}"
                role="option"
                aria-selected="false">
                <span class="admin-discount-form-modal__select-option-copy">
                    <span class="admin-discount-form-modal__select-option-title">${this.escapeHtml(option.label || '')}</span>
                    ${option.meta ? `<span class="admin-discount-form-modal__select-option-meta">${this.escapeHtml(option.meta)}</span>` : ''}
                </span>
                <i class="fas fa-check admin-discount-form-modal__select-option-check" aria-hidden="true"></i>
            </button>
        `).join('');
    },

    normalizeGenerateCustomSelectValue: function (key = '', value = '') {
        const config = this.getGenerateCustomSelectConfig(key);
        if (!config) {
            return this.safeText(value);
        }

        const normalizedKey = this.safeText(key).toLowerCase();
        const rawValue = this.safeText(value);
        const loweredValue = rawValue.toLowerCase();
        const isTimeKey = normalizedKey.endsWith('-time');

        if (isTimeKey) {
            return /^\d{2}:\d{2}$/.test(rawValue) ? rawValue : config.defaultValue;
        }

        if (normalizedKey === 'site') {
            return ['', 'cn', 'intl'].includes(loweredValue) ? loweredValue : config.defaultValue;
        }

        if (normalizedKey === 'scope-type') {
            return ['all', 'category', 'product'].includes(loweredValue) ? loweredValue : config.defaultValue;
        }

        if (['recovery-strategy', 'distribution-mode', 'pricing-stage'].includes(normalizedKey)) {
            const optionValues = (Array.isArray(config.options) ? config.options : [])
                .map((item) => this.safeText(item?.value).toLowerCase())
                .filter(Boolean);
            return optionValues.includes(loweredValue) ? loweredValue : config.defaultValue;
        }

        if (!rawValue) {
            return config.defaultValue;
        }

        const optionValues = (Array.isArray(config.options) ? config.options : [])
            .map((item) => String(item?.value ?? ''));
        return optionValues.includes(rawValue) ? rawValue : rawValue;
    },

    setGenerateCustomSelectOpen: function (key = '', open = false) {
        const config = this.getGenerateCustomSelectConfig(key);
        if (!config) return;

        const trigger = document.getElementById(config.triggerId);
        const dropdown = document.getElementById(config.dropdownId);
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) {
            return;
        }

        trigger.classList.toggle('is-open', open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        dropdown.classList.toggle('is-open', open);
        dropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
    },

    closeGenerateCustomSelects: function (options = {}) {
        const except = this.safeText(options.except).toLowerCase();
        this.getGenerateCustomSelectKeys().forEach((key) => {
            if (key === except) return;
            this.setGenerateCustomSelectOpen(key, false);
        });
    },

    syncGenerateCustomSelect: function (key = '') {
        const config = this.getGenerateCustomSelectConfig(key);
        if (!config) return;

        const input = document.getElementById(config.inputId);
        const label = document.getElementById(config.labelId);
        const currentValue = input?.value || config.defaultValue;
        const selectedValue = this.normalizeGenerateCustomSelectValue(key, currentValue);
        const options = this.getGenerateCustomSelectOptions(key, selectedValue);
        const selectedOption = options.find((item) => String(item.value) === String(selectedValue))
            || options[0]
            || { value: config.defaultValue, label: config.defaultValue };

        this.renderGenerateCustomSelectOptions(key, selectedValue);

        if (input) {
            input.value = selectedOption?.value ?? config.defaultValue;
        }
        if (label) {
            label.textContent = selectedOption?.label || '';
        }

        document.querySelectorAll(config.optionSelector).forEach((option) => {
            const optionValue = this.normalizeGenerateCustomSelectValue(key, option.getAttribute('data-select-value') || '');
            const isSelected = String(optionValue) === String(selectedOption?.value ?? config.defaultValue);
            option.classList.toggle('is-selected', isSelected);
            option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    },

    refreshGenerateCustomSelects: function () {
        this.getGenerateCustomSelectKeys().forEach((key) => this.syncGenerateCustomSelect(key));
        this.toggleScopeFields();
        this.toggleDistributionFields();
    },

    setGenerateCustomSelectValue: function (key = '', value = '', options = {}) {
        const config = this.getGenerateCustomSelectConfig(key);
        if (!config) return;

        const input = document.getElementById(config.inputId);
        if (input) {
            input.value = this.normalizeGenerateCustomSelectValue(key, value);
        }

        this.syncGenerateCustomSelect(key);

        if (key === 'scope-type') {
            this.toggleScopeFields();
        }

        if (key === 'distribution-mode') {
            this.toggleDistributionFields();
        }

        if (options.close !== false) {
            this.setGenerateCustomSelectOpen(key, false);
        }
    },

    toggleGenerateCustomSelect: function (key = '') {
        const config = this.getGenerateCustomSelectConfig(key);
        if (!config) return;

        const dropdown = document.getElementById(config.dropdownId);
        if (!(dropdown instanceof HTMLElement)) {
            return;
        }

        const shouldOpen = !dropdown.classList.contains('is-open');
        this.setTypeDropdownOpen(false);
        this.closeGenerateCustomSelects({ except: key });
        this.setGenerateCustomSelectOpen(key, shouldOpen);
    },

    setModalMode: function (mode = 'create') {
        this.modalMode = mode === 'edit' ? 'edit' : 'create';

        const title = document.getElementById('discountModalTitle');
        const description = document.getElementById('discountModalDescription');

        if (title) {
            title.textContent = this.modalMode === 'edit' ? '编辑优惠券' : '生成新优惠券';
        }
        if (description) {
            description.textContent = '';
        }
        this.setGenerateSubmitBusyState(this.generateSubmitInFlight);
    },

    setGenerateSubmitBusyState: function (busy = false) {
        const submitButton = document.querySelector('[data-admin-action="discounts-submit-generate"]');
        const submitLabel = document.getElementById('discountModalSubmitLabel');
        const idleLabel = this.modalMode === 'edit' ? '保存更新' : '立即生成';
        const busyLabel = this.modalMode === 'edit' ? '保存中...' : '生成中...';

        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = !!busy;
            submitButton.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
        if (submitLabel) {
            submitLabel.textContent = busy ? busyLabel : idleLabel;
        }
    },

    getDiscountById: function (id = '') {
        const normalizedId = this.safeText(id);
        if (!normalizedId) return null;
        return this.discounts.find((row) => this.safeText(row?.id) === normalizedId) || null;
    },

    formatPercentDiscountValue: function (value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return '--折';
        }

        const folded = numericValue / 10;
        return `${Number.isInteger(folded) ? folded : folded.toFixed(1).replace(/\.0$/, '')}折`;
    },

    getDiscountTypeMarkup: function (discount) {
        if (discount.discount_type === 'percent') {
            return `
                <div>
                    <span class="admin-discount-type-value admin-discount-type-value--percent">${this.formatPercentDiscountValue(discount.discount_value)}</span>
                    <div class="admin-discount-expiry-meta">按比例打折</div>
                </div>
            `;
        }
        return `
            <div>
                <span class="admin-discount-type-value admin-discount-type-value--fixed">立减 ${discount.discount_value} 积分</span>
                <div class="admin-discount-expiry-meta">固定金额直减</div>
            </div>
        `;
    },

    normalizeScopeType: function (value) {
        if (value === 'category' || value === 'product') {
            return value;
        }
        return 'all';
    },

    normalizeDistributionMode: function (value = '') {
        const normalized = this.safeText(value).toLowerCase();
        if (normalized === 'public_claim' || normalized === 'user_assigned') {
            return normalized;
        }
        return 'general_code';
    },

    getCategoryLabel: function (categoryId) {
        const normalized = String(categoryId ?? '').trim();
        if (!normalized) return '全部分类';
        return this.categoryNameMap.get(normalized) || normalized;
    },

    getProductLabel: function (productId) {
        const normalized = String(productId ?? '').trim();
        if (!normalized) return '全部商品';
        return this.productNameMap.get(normalized) || normalized;
    },

    getLifecycleSummary: function (discount = {}, now = new Date()) {
        const source = discount?.lifecycle_summary && typeof discount.lifecycle_summary === 'object' && !Array.isArray(discount.lifecycle_summary)
            ? discount.lifecycle_summary
            : null;
        const startsAt = this.safeText(discount?.starts_at);
        const expiresAt = this.safeText(discount?.expires_at);
        const observationEndsAt = this.safeText(discount?.observation_ends_at);
        const lifecycleStatus = this.safeText(discount?.lifecycle_status).toLowerCase();
        const statusReason = this.safeText(discount?.status_reason).toLowerCase();
        const maxUses = Number.parseInt(discount?.max_uses, 10);
        const usedCount = Math.max(0, Number.parseInt(discount?.used_count, 10) || 0);
        const isExhausted = maxUses > 0 && usedCount >= maxUses;

        if (source?.key) {
            return {
                key: this.safeText(source.key).toLowerCase(),
                label: this.safeText(source.label) || '',
                reason_key: this.safeText(source.reason_key).toLowerCase(),
                detail_text: this.safeText(source.detail_text),
                is_practically_used: source.is_practically_used === true,
                is_observation_active: source.is_observation_active === true
            };
        }

        if (startsAt && new Date(startsAt) > now && discount?.is_active !== false) {
            return {
                key: 'scheduled',
                label: '待生效',
                reason_key: 'scheduled_start',
                detail_text: `开始时间: ${this.formatDate(startsAt, { includeTime: true })}`,
                is_practically_used: false,
                is_observation_active: false
            };
        }

        if (expiresAt && new Date(expiresAt) <= now) {
            return {
                key: 'expired',
                label: '已过期',
                reason_key: statusReason || 'expired',
                detail_text: `截止时间: ${this.formatDate(expiresAt, { includeTime: true })}`,
                is_practically_used: true,
                is_observation_active: false
            };
        }

        if (isExhausted) {
            return {
                key: 'exhausted',
                label: '已用尽',
                reason_key: 'quota_exhausted',
                detail_text: `总额度已被使用完 (${usedCount}/${maxUses})`,
                is_practically_used: true,
                is_observation_active: false
            };
        }

        if (discount?.is_active === false || lifecycleStatus === 'paused_manual' || lifecycleStatus === 'paused_risk') {
            const isRiskPause = lifecycleStatus === 'paused_risk' || statusReason.startsWith('risk_');
            return {
                key: isRiskPause ? 'paused_risk' : 'paused_manual',
                label: isRiskPause ? '风控停用' : '手动停用',
                reason_key: statusReason || (isRiskPause ? 'risk_auto_pause' : 'manual_pause'),
                detail_text: isRiskPause ? '需完成风险复核后再恢复。' : '当前不会在前台继续生效。',
                is_practically_used: true,
                is_observation_active: false
            };
        }

        if (observationEndsAt && new Date(observationEndsAt) > now && statusReason === 'risk_observation') {
            return {
                key: 'active',
                label: '观察中',
                reason_key: 'risk_observation',
                detail_text: `观察期至: ${this.formatDate(observationEndsAt, { includeTime: true })}`,
                is_practically_used: false,
                is_observation_active: true
            };
        }

        return {
            key: 'active',
            label: '生效中',
            reason_key: statusReason || 'manual_active',
            detail_text: expiresAt
                ? `截止时间: ${this.formatDate(expiresAt, { includeTime: true })}`
                : '当前未设置过期时间。',
            is_practically_used: false,
            is_observation_active: false
        };
    },

    getDiscountStatusState: function (discount, now = new Date()) {
        const summary = this.getLifecycleSummary(discount, now);
        const badgeMap = {
            scheduled: '<span class="status-badge away"><i class="fas fa-hourglass-start"></i> 待生效</span>',
            active: summary.is_observation_active
                ? '<span class="status-badge active"><i class="fas fa-binoculars"></i> 观察中</span>'
                : '<span class="status-badge active"><i class="fas fa-check-circle"></i> 生效中</span>',
            paused_manual: '<span class="status-badge banned"><i class="fas fa-pause-circle"></i> 手动停用</span>',
            paused_risk: '<span class="status-badge banned"><i class="fas fa-shield-halved"></i> 风控停用</span>',
            expired: '<span class="status-badge away"><i class="fas fa-clock"></i> 已过期</span>',
            exhausted: '<span class="admin-discount-status-muted"><i class="fas fa-check-double"></i> 已用尽</span>',
            archived: '<span class="admin-discount-status-muted"><i class="fas fa-box-archive"></i> 已归档</span>'
        };

        return {
            key: summary.key || 'active',
            label: summary.label || '生效中',
            badgeMarkup: badgeMap[summary.key] || badgeMap.active,
            detailText: summary.detail_text || '',
            reasonKey: summary.reason_key || '',
            isPracticallyUsed: summary.is_practically_used === true,
            isObservationActive: summary.is_observation_active === true
        };
    },

    getDiscountStatusCounts: function (rows = [], now = new Date()) {
        const counts = {
            scheduled: 0,
            active: 0,
            paused_manual: 0,
            paused_risk: 0,
            expired: 0,
            exhausted: 0,
            allowZeroTotal: 0,
            riskAlerted: 0
        };

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const statusKey = this.getDiscountStatusState(row, now).key;
            if (Object.prototype.hasOwnProperty.call(counts, statusKey)) {
                counts[statusKey] += 1;
            }
            if (row?.allow_zero_total) {
                counts.allowZeroTotal += 1;
            }
            if (this.getRiskSummary(row).has_recent_alert) {
                counts.riskAlerted += 1;
            }
        });

        return counts;
    },

    renderOverviewStats: function (options = {}) {
        const target = document.getElementById('discountsOverviewStats');
        if (!target) return;

        if (options.hidden) {
            target.hidden = true;
            target.innerHTML = '';
            return;
        }

        const counts = this.getDiscountStatusCounts(this.discounts, options.now instanceof Date ? options.now : new Date());
        const visibleCount = Math.max(0, Number(options.visibleCount) || 0);
        const totalCount = Math.max(0, Number(options.totalCount) || 0);

        target.innerHTML = [
            { label: '当前结果', value: `${visibleCount}/${totalCount}`, accent: true },
            { label: '待生效', value: counts.scheduled },
            { label: '生效中', value: counts.active },
            { label: '风控停用', value: counts.paused_risk },
            { label: '手动停用', value: counts.paused_manual },
            { label: '已过期', value: counts.expired },
            { label: '已用尽', value: counts.exhausted },
            { label: '允许全免', value: counts.allowZeroTotal },
            { label: '近 7 天风控', value: counts.riskAlerted }
        ].map((item) => `
            <span class="admin-discount-toolbar-chip${item.accent ? ' admin-discount-toolbar-chip--accent' : ''}">
                <span>${this.escapeHtml(item.label)}</span>
                <strong>${this.escapeHtml(String(item.value))}</strong>
            </span>
        `).join('');
        target.hidden = false;
    },

    getDiscountSearchText: function (discount, now = new Date()) {
        const status = this.getDiscountStatusState(discount, now);
        const usageSummary = this.getRecentUsageSummary(discount);
        const riskSummary = this.getRiskSummary(discount);
        const assetSummary = this.getAssetSummary(discount);
        const parts = [
            discount?.code,
            this.formatSiteLabel(discount?.applicable_site),
            status.label,
            this.formatRecoveryStrategyLabel(discount?.recovery_strategy),
            this.formatDistributionModeLabel(discount?.distribution_mode),
            this.formatPricingApplyStageLabel(discount?.pricing_apply_stage),
            this.formatStackingModeLabel(discount),
            Number.isFinite(Number(discount?.stack_priority)) ? `优先级 ${discount.stack_priority}` : '',
            this.formatStatusReasonLabel(status.reasonKey),
            this.normalizeScopeType(discount?.scope_type) === 'category' ? this.getCategoryLabel(discount?.scope_category) : '',
            this.normalizeScopeType(discount?.scope_type) === 'product' ? this.getProductLabel(discount?.scope_product_id) : '',
            discount?.allow_zero_total ? '允许全免' : '禁止全免',
            discount?.campaign_tag,
            discount?.audience_segment,
            ...(Array.isArray(usageSummary.top_product_names) ? usageSummary.top_product_names : []),
            usageSummary.recent_zero_total_count > 0 ? '0价订单风险' : '',
            usageSummary.recent_refund_count > 0 ? '存在退款回滚' : '',
            assetSummary.issued_count > 0 ? '卡券已发放' : '',
            riskSummary.latest_alert_title,
            riskSummary.latest_alert_summary,
            riskSummary.auto_response_summary,
            riskSummary.recovery_auto_summary,
            this.formatWorkbenchSignalLabel(riskSummary.signal_type),
            this.formatRiskLevelLabel(riskSummary.risk_level),
            this.formatCaseStatusLabel(riskSummary.case_status),
            riskSummary.case_owner_label
        ];

        return parts
            .map((part) => this.safeText(part).toLowerCase())
            .filter(Boolean)
            .join(' ');
    },

    getRecentUsageSummary: function (discount = {}) {
        const source = discount?.usage_summary && typeof discount.usage_summary === 'object' && !Array.isArray(discount.usage_summary)
            ? discount.usage_summary
            : {};

        return {
            window_days: Math.max(1, Number.parseInt(source.window_days, 10) || 30),
            recent_order_count: Math.max(0, Number.parseInt(source.recent_order_count, 10) || 0),
            recent_net_order_count: Math.max(0, Number.parseInt(source.recent_net_order_count, 10) || 0),
            recent_refund_count: Math.max(0, Number.parseInt(source.recent_refund_count, 10) || 0),
            recent_distinct_user_count: Math.max(0, Number.parseInt(source.recent_distinct_user_count, 10) || 0),
            recent_zero_total_count: Math.max(0, Number.parseInt(source.recent_zero_total_count, 10) || 0),
            last_used_at: this.safeText(source.last_used_at) || '',
            recent_discount_cost_gross: Math.max(0, Number(source.recent_discount_cost_gross) || 0),
            recent_discount_cost_net: Math.max(0, Number(source.recent_discount_cost_net) || 0),
            recent_revenue_gross: Math.max(0, Number(source.recent_revenue_gross) || 0),
            recent_revenue_net: Math.max(0, Number(source.recent_revenue_net) || 0),
            new_customer_order_count: Math.max(0, Number.parseInt(source.new_customer_order_count, 10) || 0),
            top_product_names: Array.isArray(source.top_product_names)
                ? source.top_product_names.map((item) => this.safeText(item)).filter(Boolean)
                : []
        };
    },

    getAssetSummary: function (discount = {}) {
        const source = discount?.asset_summary && typeof discount.asset_summary === 'object' && !Array.isArray(discount.asset_summary)
            ? discount.asset_summary
            : {};

        return {
            issued_count: Math.max(0, Number.parseInt(source.issued_count, 10) || 0),
            available_count: Math.max(0, Number.parseInt(source.available_count, 10) || 0),
            used_count: Math.max(0, Number.parseInt(source.used_count, 10) || 0),
            expired_count: Math.max(0, Number.parseInt(source.expired_count, 10) || 0),
            revoked_count: Math.max(0, Number.parseInt(source.revoked_count, 10) || 0),
            restored_count: Math.max(0, Number.parseInt(source.restored_count, 10) || 0),
            assigned_count: Math.max(0, Number.parseInt(source.assigned_count, 10) || 0),
            claimed_count: Math.max(0, Number.parseInt(source.claimed_count, 10) || 0),
            recent_assigned_at: this.safeText(source.recent_assigned_at),
            recent_claimed_at: this.safeText(source.recent_claimed_at),
            recent_consumed_at: this.safeText(source.recent_consumed_at)
        };
    },

    getFunnelSummary: function (discount = {}) {
        return (Array.isArray(discount?.funnel_summary) ? discount.funnel_summary : []).map((row) => ({
            key: this.safeText(row?.key).toLowerCase(),
            label: this.safeText(row?.label) || '阶段',
            count: Math.max(0, Number.parseInt(row?.count, 10) || 0),
            conversion_rate: Math.max(0, Number(row?.conversion_rate) || 0)
        }));
    },

    getSegmentSummary: function (discount = {}) {
        const source = discount?.segment_summary && typeof discount.segment_summary === 'object' && !Array.isArray(discount.segment_summary)
            ? discount.segment_summary
            : {};
        const normalizeRows = (rows = []) => (Array.isArray(rows) ? rows : []).map((row) => ({
            key: this.safeText(row?.key).toLowerCase(),
            label: this.safeText(row?.label) || '未知',
            count: Math.max(0, Number.parseInt(row?.count, 10) || 0)
        }));

        return {
            sites: normalizeRows(source.sites),
            source_channels: normalizeRows(source.source_channels),
            audience_segments: normalizeRows(source.audience_segments)
        };
    },

    getRiskSummary: function (discount = {}) {
        const source = discount?.risk_summary && typeof discount.risk_summary === 'object' && !Array.isArray(discount.risk_summary)
            ? discount.risk_summary
            : {};

        return {
            has_recent_alert: source.has_recent_alert === true,
            latest_alert_type: this.safeText(source.latest_alert_type).toLowerCase(),
            latest_alert_state: this.safeText(source.latest_alert_state).toLowerCase() || 'idle',
            latest_alert_title: this.safeText(source.latest_alert_title),
            latest_alert_summary: this.safeText(source.latest_alert_summary),
            latest_alert_at: this.safeText(source.latest_alert_at),
            signal_type: this.safeText(source.signal_type).toLowerCase(),
            risk_level: this.safeText(source.risk_level).toLowerCase(),
            risk_score: Number.isFinite(Number(source.risk_score)) ? Math.max(0, Math.round(Number(source.risk_score))) : null,
            auto_response_action: this.safeText(source.auto_response_action).toLowerCase(),
            auto_response_status: this.safeText(source.auto_response_status).toLowerCase(),
            auto_response_summary: this.safeText(source.auto_response_summary),
            auto_response_applied_at: this.safeText(source.auto_response_applied_at),
            response_summary: this.safeText(source.response_summary),
            recovery_auto_action: this.safeText(source.recovery_auto_action).toLowerCase(),
            recovery_auto_status: this.safeText(source.recovery_auto_status).toLowerCase(),
            recovery_auto_summary: this.safeText(source.recovery_auto_summary),
            recovery_auto_applied_at: this.safeText(source.recovery_auto_applied_at),
            previous_zero_total_count: Number.isFinite(Number(source.previous_zero_total_count))
                ? Math.max(0, Math.round(Number(source.previous_zero_total_count)))
                : null,
            case_status: this.safeText(source.case_status).toLowerCase(),
            case_owner_label: this.safeText(source.case_owner_label),
            case_latest_event_label: this.safeText(source.case_latest_event_label),
            case_latest_event_summary: this.safeText(source.case_latest_event_summary),
            case_latest_event_at: this.safeText(source.case_latest_event_at)
        };
    },

    buildRiskHeadlineText: function (riskSummary = {}) {
        if (!riskSummary.has_recent_alert) {
            return '';
        }

        const title = this.safeText(riskSummary.latest_alert_title)
            || this.formatWorkbenchSignalLabel(riskSummary.signal_type)
            || '商城风控';
        const stateLabel = riskSummary.latest_alert_state === 'recovered' ? '已恢复' : '告警中';
        const scoreLabel = Number.isFinite(Number(riskSummary.risk_score))
            ? ` · ${this.escapeHtml(String(riskSummary.risk_score))} 分`
            : '';

        return `${this.escapeHtml(stateLabel)} · ${this.escapeHtml(title)}${scoreLabel}`;
    },

    buildRiskActionText: function (riskSummary = {}) {
        if (!riskSummary.has_recent_alert) {
            return '';
        }

        if (riskSummary.auto_response_summary) {
            return this.escapeHtml(riskSummary.auto_response_summary);
        }

        if (riskSummary.recovery_auto_summary) {
            return this.escapeHtml(riskSummary.recovery_auto_summary);
        }

        const caseStatusLabel = this.formatCaseStatusLabel(riskSummary.case_status);
        if (caseStatusLabel && riskSummary.case_owner_label) {
            return `${this.escapeHtml(caseStatusLabel)} · ${this.escapeHtml(riskSummary.case_owner_label)}`;
        }
        if (caseStatusLabel) {
            return this.escapeHtml(caseStatusLabel);
        }
        if (riskSummary.response_summary) {
            return this.escapeHtml(riskSummary.response_summary);
        }

        return '';
    },

    shouldUseRiskRestoreFlow: function (discount = {}) {
        if (!discount) {
            return false;
        }

        const statusState = this.getDiscountStatusState(discount, new Date());
        if (statusState.key !== 'paused_risk') {
            return false;
        }

        const riskSummary = this.getRiskSummary(discount);
        if (riskSummary.has_recent_alert) {
            return true;
        }

        return ['open', 'claimed'].includes(riskSummary.case_status);
    },

    getBatchRestoreCandidates: function () {
        return (Array.isArray(this.filteredDiscounts) ? this.filteredDiscounts : [])
            .filter((discount) => this.shouldUseRiskRestoreFlow(discount));
    },

    updateBatchRestoreButtonState: function () {
        const button = document.getElementById('discountsBatchRestoreBtn');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const candidates = this.getBatchRestoreCandidates();
        const count = candidates.length;
        const disabledReason = '当前筛选结果里没有可批量恢复审批的优惠券';
        const title = count > 0
            ? `当前筛选结果里有 ${this.escapeHtml(String(count))} 张可批量恢复审批的优惠券`
            : disabledReason;

        button.disabled = false;
        button.classList.toggle('is-disabled', count === 0);
        button.setAttribute('aria-disabled', count === 0 ? 'true' : 'false');
        button.setAttribute('title', title);
        button.innerHTML = `<i class="fas fa-shield-heart"></i> 批量恢复审批 (${this.escapeHtml(String(count))})`;
    },

    buildBatchRestoreItemRecord: function (discount = {}, options = {}) {
        const riskSummary = this.getRiskSummary(discount);
        return {
            id: this.safeText(discount.id),
            code: this.safeText(discount.code).toUpperCase(),
            case_status: this.safeText(riskSummary.case_status).toLowerCase(),
            signal_type: this.safeText(riskSummary.signal_type).toLowerCase(),
            risk_score: Number.isFinite(Number(riskSummary.risk_score)) ? Math.max(0, Math.round(Number(riskSummary.risk_score))) : null,
            message: this.safeText(options.message),
            skipped: options.skipped === true,
            retry_count: Math.max(0, Number.parseInt(options.retry_count, 10) || 0)
        };
    },

    buildRiskRestoreCaseContext: function (discount = {}) {
        const code = this.safeText(discount.code).toUpperCase();
        const riskSummary = this.getRiskSummary(discount);
        return {
            title: this.safeText(riskSummary.latest_alert_title) || `优惠码风险复核（${code}）`,
            alertType: this.safeText(riskSummary.latest_alert_type) || 'shop_order_risk_anomaly',
            category: 'shop_risk',
            referenceLabel: '优惠码',
            referenceValue: code,
            targetId: `shop_order_risk:coupon:${code}`,
            discountCode: code,
            signalType: this.safeText(riskSummary.signal_type)
        };
    },

    getDetailCacheKey: function (id = '', site = this.getReadSite()) {
        return `${this.safeText(site) || 'all'}::${this.safeText(id)}`;
    },

    buildDiscountDetailFactsMarkup: function (rows = []) {
        return `
            <div class="admin-discount-detail-facts">
                ${(Array.isArray(rows) ? rows : []).map((row) => `
                    <div class="admin-discount-detail-fact">
                        <div class="admin-discount-detail-fact__label">${this.escapeHtml(row.label || '')}</div>
                        <div class="admin-discount-detail-fact__value">${this.escapeHtml(row.value || '—')}</div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    buildDiscountDetailOrdersMarkup: function (detail = {}) {
        const orders = Array.isArray(detail.recent_orders) ? detail.recent_orders : [];
        if (!orders.length) {
            return '<div class="admin-discount-detail-empty">近 30 天没有命中订单。</div>';
        }

        return `
            <div class="admin-discount-detail-list">
                ${orders.map((order) => {
                    const userId = this.safeText(order.user_id);
                    const analyticsContext = this.escapeHtml(JSON.stringify({
                        referenceLabel: '优惠码',
                        referenceValue: this.safeText(detail.discount?.code).toUpperCase(),
                        targetId: `shop_order_risk:coupon:${this.safeText(detail.discount?.code).toUpperCase()}`
                    }));

                    return `
                        <div class="admin-discount-detail-list-item">
                            <div class="admin-discount-detail-list-item__head">
                                <div>
                                    <div class="admin-discount-detail-list-item__title">${this.escapeHtml(order.product_name || '未知商品')}</div>
                                    <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(this.formatDate(order.created_at, { includeTime: true }) || '未知时间')}</div>
                                </div>
                                <div class="admin-discount-detail-inline-actions">
                                    <button type="button"
                                        class="admin-discount-detail-inline-btn"
                                        data-admin-action="discounts-open-related-order"
                                        data-order-id="${this.escapeHtml(order.id || '')}">查看订单</button>
                                    ${userId ? `
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="analytics-open-user-detail"
                                            data-user-id="${this.escapeHtml(encodeURIComponent(userId))}"
                                            data-analytics-context="${analyticsContext}">查看用户</button>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="admin-discount-detail-chip-row">
                                <span class="admin-discount-detail-chip">${this.escapeHtml(order.user_label || userId || '未知用户')}</span>
                                <span class="admin-discount-detail-chip">${this.escapeHtml(String(order.site || '').toUpperCase() || 'ALL')}</span>
                                <span class="admin-discount-detail-chip">数量 ${this.escapeHtml(String(order.item_count || 1))}</span>
                                <span class="admin-discount-detail-chip">实付 ${this.escapeHtml(String(order.price_paid ?? '—'))}</span>
                                <span class="admin-discount-detail-chip">原价 ${this.escapeHtml(String(order.total_price ?? '—'))}</span>
                                <span class="admin-discount-detail-chip">优惠 ${this.escapeHtml(String(order.discount_amount ?? 0))}</span>
                                ${order.is_zero_total_risk ? '<span class="admin-discount-detail-chip admin-discount-detail-chip--risk">0 价风险</span>' : ''}
                                ${this.safeText(order.refund_status) && this.safeText(order.refund_status).toLowerCase() !== 'none'
                                    ? `<span class="admin-discount-detail-chip">退款 ${this.escapeHtml(order.refund_status)}</span>`
                                    : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    buildDiscountDetailUsersMarkup: function (detail = {}) {
        const users = Array.isArray(detail.recent_users) ? detail.recent_users : [];
        if (!users.length) {
            return '<div class="admin-discount-detail-empty">近 30 天没有关联账号。</div>';
        }

        return `
            <div class="admin-discount-detail-list">
                ${users.map((user) => {
                    const userId = this.safeText(user.user_id);
                    const analyticsContext = this.escapeHtml(JSON.stringify({
                        referenceLabel: '优惠码',
                        referenceValue: this.safeText(detail.discount?.code).toUpperCase(),
                        targetId: `shop_order_risk:coupon:${this.safeText(detail.discount?.code).toUpperCase()}`
                    }));

                    return `
                        <div class="admin-discount-detail-list-item">
                            <div class="admin-discount-detail-list-item__head">
                                <div>
                                    <div class="admin-discount-detail-list-item__title">${this.escapeHtml(user.user_label || userId || '未知用户')}</div>
                                    <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(this.formatDate(user.latest_used_at, { includeTime: true }) || '未知时间')}</div>
                                </div>
                                ${userId ? `
                                    <button type="button"
                                        class="admin-discount-detail-inline-btn"
                                        data-admin-action="analytics-open-user-detail"
                                        data-user-id="${this.escapeHtml(encodeURIComponent(userId))}"
                                        data-analytics-context="${analyticsContext}">查看用户</button>
                                ` : ''}
                            </div>
                            <div class="admin-discount-detail-chip-row">
                                <span class="admin-discount-detail-chip">近 30 天 ${this.escapeHtml(String(user.usage_count || 0))} 单</span>
                                ${Number(user.zero_total_count || 0) > 0 ? `<span class="admin-discount-detail-chip admin-discount-detail-chip--risk">0 价 ${this.escapeHtml(String(user.zero_total_count || 0))} 笔</span>` : ''}
                                ${(Array.isArray(user.sites) ? user.sites : []).map((site) => `
                                    <span class="admin-discount-detail-chip">${this.escapeHtml(String(site || '').toUpperCase())}</span>
                                `).join('')}
                                ${(Array.isArray(user.top_products) ? user.top_products : []).map((product) => `
                                    <span class="admin-discount-detail-chip">${this.escapeHtml(product)}</span>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    buildDiscountAssetAssignmentMarkup: function (detail = {}) {
        const discount = detail.discount && typeof detail.discount === 'object' ? detail.discount : {};
        const assetSummary = this.getAssetSummary(discount);
        const assets = Array.isArray(detail.recent_assets) ? detail.recent_assets : [];
        const distributionMode = this.safeText(discount.distribution_mode).toLowerCase() || 'general_code';

        return `
            <div class="admin-discount-detail-section-grid">
                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">发放概览</div>
                    <div class="admin-discount-detail-summary-grid">
                        <div class="admin-discount-detail-summary-card">
                            <div class="admin-discount-detail-summary-card__label">发放总量</div>
                            <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(assetSummary.issued_count || 0))}</div>
                        </div>
                        <div class="admin-discount-detail-summary-card">
                            <div class="admin-discount-detail-summary-card__label">当前可用</div>
                            <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(assetSummary.available_count || 0))}</div>
                        </div>
                        <div class="admin-discount-detail-summary-card">
                            <div class="admin-discount-detail-summary-card__label">已核销</div>
                            <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(assetSummary.used_count || 0))}</div>
                        </div>
                        <div class="admin-discount-detail-summary-card">
                            <div class="admin-discount-detail-summary-card__label">发放模式</div>
                            <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(this.formatDistributionModeLabel(distributionMode))}</div>
                        </div>
                    </div>
                    <div class="admin-discount-detail-chip-row">
                        ${this.safeText(discount.campaign_tag) ? `<span class="admin-discount-detail-chip">渠道 ${this.escapeHtml(this.safeText(discount.campaign_tag))}</span>` : ''}
                        ${this.safeText(discount.audience_segment) ? `<span class="admin-discount-detail-chip">人群 ${this.escapeHtml(this.safeText(discount.audience_segment))}</span>` : ''}
                        ${assetSummary.recent_assigned_at ? `<span class="admin-discount-detail-chip">最近发放 ${this.escapeHtml(this.formatDate(assetSummary.recent_assigned_at, { includeTime: true }) || assetSummary.recent_assigned_at)}</span>` : ''}
                        ${assetSummary.recent_consumed_at ? `<span class="admin-discount-detail-chip">最近核销 ${this.escapeHtml(this.formatDate(assetSummary.recent_consumed_at, { includeTime: true }) || assetSummary.recent_consumed_at)}</span>` : ''}
                    </div>
                </section>
                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">定向发券</div>
                    <div class="admin-discount-detail-facts">
                        <div class="admin-discount-detail-fact">
                            <div class="admin-discount-detail-fact__label">目标用户</div>
                            <div class="admin-discount-detail-fact__value">支持登录邮箱、用户名、UUID，也支持按“用户管理”标签批量发放</div>
                        </div>
                        <div class="admin-discount-detail-fact">
                            <div class="admin-discount-detail-fact__label">默认建议</div>
                            <div class="admin-discount-detail-fact__value">补偿、召回、定向活动优先用“定向发券”</div>
                        </div>
                    </div>
                    <div class="admin-discount-detail-inline-actions">
                        <textarea id="discountAssetRecipientsInput" class="config-input" rows="4" placeholder="输入登录邮箱、用户名或 UUID，每行一个或逗号分隔"></textarea>
                        <input id="discountAssetRecipientTagsInput" class="config-input" type="text" placeholder="按用户标签发放，如 用户, 创作者, vip">
                        <input id="discountAssetSourceChannelInput" class="config-input" type="text" placeholder="渠道备注（统计），如 vip_recall / cs_compensation" value="${this.escapeHtml(this.safeText(discount.campaign_tag))}">
                        <input id="discountAssetAudienceSegmentInput" class="config-input" type="text" placeholder="人群备注（统计），如 new_user / vip / churn_risk" value="${this.escapeHtml(this.safeText(discount.audience_segment))}">
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-assign-assets"
                            data-discount-id="${this.escapeHtml(this.safeText(discount.id))}">发到用户卡券包</button>
                    </div>
                </section>
            </div>
            <section class="admin-discount-detail-section">
                <div class="admin-discount-detail-section__title">最近发放记录</div>
                ${assets.length ? `
                    <div class="admin-discount-detail-list">
                        ${assets.map((asset) => `
                            <div class="admin-discount-detail-list-item">
                                <div class="admin-discount-detail-list-item__head">
                                    <div>
                                        <div class="admin-discount-detail-list-item__title">${this.escapeHtml(asset.user_label || asset.user_id || '未知用户')}</div>
                                        <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(this.formatDate(asset.assigned_at, { includeTime: true }) || '未知时间')}</div>
                                    </div>
                                </div>
                                <div class="admin-discount-detail-chip-row">
                                    <span class="admin-discount-detail-chip">${this.escapeHtml(this.formatAssetStatusLabel(asset.asset_status))}</span>
                                    ${asset.source_channel ? `<span class="admin-discount-detail-chip">渠道 ${this.escapeHtml(asset.source_channel)}</span>` : ''}
                                    ${asset.audience_segment ? `<span class="admin-discount-detail-chip">人群 ${this.escapeHtml(asset.audience_segment)}</span>` : ''}
                                    ${asset.expires_at ? `<span class="admin-discount-detail-chip">失效 ${this.escapeHtml(this.formatDate(asset.expires_at, { includeTime: true }) || asset.expires_at)}</span>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="admin-discount-detail-empty">还没有定向发券记录。</div>'}
            </section>
        `;
    },

    buildDiscountFunnelMarkup: function (discount = {}) {
        const funnelRows = this.getFunnelSummary(discount);
        const usageSummary = this.getRecentUsageSummary(discount);
        if (!funnelRows.length) {
            return '<div class="admin-discount-detail-empty">当前没有可展示的漏斗数据。</div>';
        }

        return `
            <div class="admin-discount-detail-list">
                ${funnelRows.map((row) => `
                    <div class="admin-discount-detail-list-item">
                        <div class="admin-discount-detail-list-item__head">
                            <div>
                                <div class="admin-discount-detail-list-item__title">${this.escapeHtml(row.label)}</div>
                                <div class="admin-discount-detail-list-item__meta">转化率 ${this.escapeHtml(String(row.conversion_rate || 0))}%</div>
                            </div>
                            <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(row.count || 0))}</div>
                        </div>
                    </div>
                `).join('')}
                <div class="admin-discount-detail-list-item">
                    <div class="admin-discount-detail-list-item__head">
                        <div>
                            <div class="admin-discount-detail-list-item__title">ROI 摘要</div>
                            <div class="admin-discount-detail-list-item__meta">按近 ${this.escapeHtml(String(usageSummary.window_days || 30))} 天净核销口径计算</div>
                        </div>
                    </div>
                    <div class="admin-discount-detail-chip-row">
                        <span class="admin-discount-detail-chip">营收毛 / 净 ${this.escapeHtml(String(usageSummary.recent_revenue_gross || 0))} / ${this.escapeHtml(String(usageSummary.recent_revenue_net || 0))}</span>
                        <span class="admin-discount-detail-chip">让利毛 / 净 ${this.escapeHtml(String(usageSummary.recent_discount_cost_gross || 0))} / ${this.escapeHtml(String(usageSummary.recent_discount_cost_net || 0))}</span>
                        <span class="admin-discount-detail-chip">首单转化 ${this.escapeHtml(String(usageSummary.new_customer_order_count || 0))} 单</span>
                    </div>
                </div>
            </div>
        `;
    },

    buildDiscountSegmentMarkup: function (discount = {}) {
        const segments = this.getSegmentSummary(discount);
        const buildSegmentChips = (items = [], emptyLabel = '暂无') => (
            Array.isArray(items) && items.length
                ? items.slice(0, 6).map((item) => `<span class="admin-discount-detail-chip">${this.escapeHtml(item.label)} · ${this.escapeHtml(String(item.count || 0))}</span>`).join('')
                : `<span class="admin-discount-detail-chip">${this.escapeHtml(emptyLabel)}</span>`
        );

        return `
            <div class="admin-discount-detail-section-grid">
                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">站点拆分</div>
                    <div class="admin-discount-detail-chip-row">${buildSegmentChips(segments.sites, '暂无站点命中')}</div>
                </section>
                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">渠道拆分</div>
                    <div class="admin-discount-detail-chip-row">${buildSegmentChips(segments.source_channels, '暂无渠道标签')}</div>
                </section>
                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">人群拆分</div>
                    <div class="admin-discount-detail-chip-row">${buildSegmentChips(segments.audience_segments, '暂无人群标签')}</div>
                </section>
            </div>
        `;
    },

    getDiscountDetailTimelineItems: function (detail = {}) {
        return Array.isArray(detail.risk_timeline) ? detail.risk_timeline : [];
    },

    getFilteredDiscountDetailTimelineItems: function (detail = {}, filterValue = this.detailTimelineFilter) {
        const filter = this.normalizeDetailTimelineFilter(filterValue);
        const items = this.getDiscountDetailTimelineItems(detail);
        if (filter === 'all') {
            return items;
        }

        return items.filter((item) => {
            const type = this.safeText(item?.type).toLowerCase();
            const isRestoreAudit = type === 'audit_log'
                && (
                    item?.is_restore_action === true
                    || (this.safeText(item?.title).includes('恢复启用'))
                );

            if (filter === 'alerts') {
                return type === 'alert_job';
            }
            if (filter === 'cases') {
                return type === 'case_event';
            }
            if (filter === 'restore') {
                return isRestoreAudit;
            }
            return true;
        });
    },

    buildDiscountDetailTimelineFilterMarkup: function (detail = {}) {
        const items = this.getDiscountDetailTimelineItems(detail);
        const counts = {
            all: items.length,
            alerts: items.filter((item) => this.safeText(item?.type).toLowerCase() === 'alert_job').length,
            cases: items.filter((item) => this.safeText(item?.type).toLowerCase() === 'case_event').length,
            restore: items.filter((item) => this.safeText(item?.type).toLowerCase() === 'audit_log'
                && (item?.is_restore_action === true || this.safeText(item?.title).includes('恢复启用'))).length
        };

        const options = [
            { key: 'all', label: '全部' },
            { key: 'alerts', label: '风控告警' },
            { key: 'cases', label: 'Case 事件' },
            { key: 'restore', label: '恢复审批' }
        ];
        const activeFilter = this.normalizeDetailTimelineFilter(this.detailTimelineFilter);

        return `
            <div class="admin-discount-detail-timeline-filters">
                ${options.map((option) => `
                    <button type="button"
                        class="admin-discount-detail-timeline-filter${activeFilter === option.key ? ' is-active' : ''}"
                        data-admin-action="discounts-set-timeline-filter"
                        data-discount-timeline-filter="${this.escapeHtml(option.key)}">
                        <span>${this.escapeHtml(option.label)}</span>
                        <strong>${this.escapeHtml(String(counts[option.key] || 0))}</strong>
                    </button>
                `).join('')}
            </div>
        `;
    },

    getDetailTimelineFilterLabel: function (value = '') {
        const normalized = this.normalizeDetailTimelineFilter(value);
        if (normalized === 'alerts') return '风控告警';
        if (normalized === 'cases') return 'Case 事件';
        if (normalized === 'restore') return '恢复审批';
        return '全部';
    },

    getActiveDetailData: function () {
        if (!this.activeDetailId) {
            return null;
        }
        return this.detailCache.get(this.getDetailCacheKey(this.activeDetailId)) || null;
    },

    buildDiscountAuditSummaryText: function (detail = {}, options = {}) {
        const discount = detail.discount && typeof detail.discount === 'object' ? detail.discount : {};
        const usageSummary = this.getRecentUsageSummary(discount);
        const riskSummary = this.getRiskSummary(discount);
        const statusState = this.getDiscountStatusState(discount, new Date());
        const timelineFilter = this.normalizeDetailTimelineFilter(options.timelineFilter || this.detailTimelineFilter);
        const filterLabel = this.getDetailTimelineFilterLabel(timelineFilter);
        const timelineItems = this.getFilteredDiscountDetailTimelineItems(detail, timelineFilter);
        const scopeType = this.normalizeScopeType(discount.scope_type);
        const scopeLabel = scopeType === 'category'
            ? `分类 · ${this.getCategoryLabel(discount.scope_category)}`
            : (scopeType === 'product'
                ? `商品 · ${this.getProductLabel(discount.scope_product_id)}`
                : '全部商品');
        const lines = [
            '优惠券审计摘要',
            `生成时间：${new Date().toLocaleString()}`,
            `当前筛选：${filterLabel}`,
            '',
            `优惠码：${this.safeText(discount.code).toUpperCase() || '—'}`,
            `当前状态：${statusState.label || '—'}`,
            `状态原因：${this.formatStatusReasonLabel(statusState.reasonKey) || '—'}`,
            `优惠类型：${discount.discount_type === 'fixed' ? `固定立减 ${discount.discount_value || 0}` : this.formatPercentDiscountValue(discount.discount_value)}`,
            `适用站点：${this.formatSiteLabel(discount.applicable_site)}`,
            `叠加策略：${this.formatStackingModeLabel(discount)}`,
            `价格阶段：${this.formatPricingApplyStageLabel(discount.pricing_apply_stage)}`,
            `结算优先级：${Math.max(1, Number.parseInt(discount.stack_priority, 10) || 100)}`,
            `适用范围：${scopeLabel}`,
            `总使用限制：${Number(discount.max_uses || 0) > 0 ? `${discount.max_uses} 次` : '不限'}`,
            `每用户限制：${Number(discount.max_uses_per_user || 0) > 0 ? `${discount.max_uses_per_user} 次` : '不限'}`,
            `生效时间：${this.formatDate(discount.starts_at, { includeTime: true }) || '立即生效'}`,
            `过期时间：${this.formatDate(discount.expires_at, { includeTime: true }) || '永久有效'}`,
            `恢复策略：${this.formatRecoveryStrategyLabel(discount.recovery_strategy)}`,
            `规则版本：v${Math.max(1, Number.parseInt(discount.version_no, 10) || 1)}`,
            '',
            '近 30 天使用表现',
            `订单 / 用户：${usageSummary.recent_order_count || 0} 单 / ${usageSummary.recent_distinct_user_count || 0} 人`,
            `净核销 / 退款：${usageSummary.recent_net_order_count || 0} 单 / ${usageSummary.recent_refund_count || 0} 单`,
            `0 价订单：${usageSummary.recent_zero_total_count || 0} 笔`,
            `让利毛 / 净：${usageSummary.recent_discount_cost_gross || 0} / ${usageSummary.recent_discount_cost_net || 0}`,
            `最近使用：${this.formatDate(usageSummary.last_used_at, { includeTime: true }) || '无'}`,
            `命中商品：${Array.isArray(usageSummary.top_product_names) && usageSummary.top_product_names.length ? usageSummary.top_product_names.join('、') : '无'}`,
            '',
            '风控摘要',
            `最近信号：${this.formatWorkbenchSignalLabel(riskSummary.signal_type) || '无'}`,
            `风险等级：${this.formatRiskLevelLabel(riskSummary.risk_level) || '无'}${Number.isFinite(Number(riskSummary.risk_score)) ? ` · ${riskSummary.risk_score} 分` : ''}`,
            `自动处置：${riskSummary.auto_response_summary || riskSummary.response_summary || '无'}`,
            `恢复处置：${riskSummary.recovery_auto_summary || '无'}`,
            `Case 状态：${this.formatCaseStatusLabel(riskSummary.case_status) || '未建 case'}`,
            `负责人：${riskSummary.case_owner_label || '—'}`,
            `最近告警：${this.formatDate(riskSummary.latest_alert_at, { includeTime: true }) || '无'}`
        ];

        lines.push('');
        lines.push(`时间线（${filterLabel}，共 ${timelineItems.length} 条）`);
        if (!timelineItems.length) {
            lines.push('无');
        } else {
            timelineItems.forEach((item, index) => {
                lines.push(`${index + 1}. [${this.formatDetailTimelineStateLabel(item.state || item.type)}] ${this.safeText(item.title) || '时间线事件'}`);
                if (this.safeText(item.created_at)) {
                    lines.push(`   时间：${this.formatDate(item.created_at, { includeTime: true })}`);
                }
                if (this.safeText(item.summary)) {
                    lines.push(`   摘要：${this.safeText(item.summary)}`);
                }
                if (this.safeText(item.actor_label)) {
                    lines.push(`   操作人：${this.safeText(item.actor_label)}`);
                }
                if (this.safeText(item.owner_label)) {
                    lines.push(`   负责人：${this.safeText(item.owner_label)}`);
                }
            });
        }

        return lines.join('\n');
    },

    buildBatchDiscountAuditSummaryText: function (details = [], options = {}) {
        const siteLabel = this.formatSiteLabel(this.getReadSite());
        const statusFilter = this.filters.status || 'all';
        const searchFilter = this.safeText(this.filters.search);
        const entries = Array.isArray(details) ? details : [];
        const header = [
            '优惠券批量复盘摘要',
            `生成时间：${new Date().toLocaleString()}`,
            `站点视图：${siteLabel}`,
            `状态筛选：${statusFilter}`,
            `搜索条件：${searchFilter || '无'}`,
            `导出数量：${entries.length}`
        ];

        const body = entries.map((detail, index) => {
            const code = this.safeText(detail?.discount?.code).toUpperCase() || `优惠券 ${index + 1}`;
            return [
                '',
                `${'='.repeat(18)} ${code} ${'='.repeat(18)}`,
                this.buildDiscountAuditSummaryText(detail, {
                    timelineFilter: options.timelineFilter || 'all'
                })
            ].join('\n');
        });

        return [...header, ...body].join('\n');
    },

    buildBatchRestoreResultSummaryText: function (result = {}, options = {}) {
        const mode = this.safeText(options.mode).toLowerCase() === 'failed' ? 'failed' : 'all';
        const siteLabel = this.formatSiteLabel(result.site || this.getReadSite());
        const statusFilter = this.safeText(result.status_filter || this.filters.status || 'all');
        const statusFilterLabel = this.formatDiscountStatusFilterLabel(statusFilter);
        const sourceLabel = this.formatBatchRestoreSourceLabel(result.operation_source);
        const searchFilter = this.safeText(result.search_filter || this.filters.search);
        const restored = Array.isArray(result.restored) ? result.restored : [];
        const failed = Array.isArray(result.failed) ? result.failed : [];
        const activeFailed = failed.filter((item) => item.skipped !== true);
        const skippedFailed = failed.filter((item) => item.skipped === true);
        const lines = [
            mode === 'failed' ? '优惠券批量恢复失败项摘要' : '优惠券批量恢复结果摘要',
            `生成时间：${this.formatDate(result.generated_at, { includeTime: true }) || new Date().toLocaleString()}`,
            `站点视图：${siteLabel}`,
            `状态筛选：${statusFilterLabel}`,
            `搜索条件：${searchFilter || '无'}`,
            `处理结论：${this.safeText(result.resolution) || '未记录'}`,
            `批量处理数量：${Math.max(0, Number(result.total_attempted_count || 0) || 0)} 张`
        ];
        if (sourceLabel) {
            lines.splice(4, 0, `操作来源：${sourceLabel}`);
        }
        lines.push(`成功恢复：${restored.length} 张`);
        lines.push(`失败待重试：${activeFailed.length} 张`);
        lines.push(`已跳过失败项：${skippedFailed.length} 张`);
        if (Number(result.truncated_count || 0) > 0) {
            lines.push(`未纳入本轮处理：${Math.max(0, Number(result.truncated_count || 0))} 张`);
        }
        if (this.safeText(result.case_sync_warning)) {
            lines.push(`Case 同步提醒：${this.safeText(result.case_sync_warning)}`);
        }

        const appendItems = (title, items = []) => {
            lines.push('');
            lines.push(title);
            if (!items.length) {
                lines.push('无');
                return;
            }

            items.forEach((item, index) => {
                const parts = [];
                if (item.signal_type) {
                    parts.push(this.formatWorkbenchSignalLabel(item.signal_type) || item.signal_type);
                }
                if (Number.isFinite(Number(item.risk_score))) {
                    parts.push(`风险分 ${item.risk_score}`);
                }
                if (item.case_status) {
                    parts.push(this.formatCaseStatusLabel(item.case_status) || item.case_status);
                }
                if (Number(item.retry_count || 0) > 0) {
                    parts.push(`已重试 ${item.retry_count} 次`);
                }
                lines.push(`${index + 1}. ${this.safeText(item.code).toUpperCase() || '未知优惠码'}`);
                if (parts.length) {
                    lines.push(`   标签：${parts.join(' / ')}`);
                }
                if (this.safeText(item.message)) {
                    lines.push(`   说明：${this.safeText(item.message)}`);
                }
            });
        };

        if (mode === 'failed') {
            appendItems('失败待重试', activeFailed);
            appendItems('已跳过失败项', skippedFailed);
            return lines.join('\n');
        }

        appendItems('成功恢复', restored);
        appendItems('失败待重试', activeFailed);
        appendItems('已跳过失败项', skippedFailed);
        return lines.join('\n');
    },

    normalizeBatchRestoreHistoryRun: function (run = {}) {
        const source = run && typeof run === 'object' && !Array.isArray(run) ? run : {};
        const normalizedFailed = Array.isArray(source.failed) ? source.failed : [];
        const normalizedRestored = Array.isArray(source.restored) ? source.restored : [];

        return {
            run_id: this.safeText(source.run_id || source.batch_run_id),
            retry_of_run_id: this.safeText(source.retry_of_run_id),
            operation_source: this.safeText(source.operation_source).toLowerCase(),
            generated_at: this.safeText(source.generated_at || source.created_at),
            actor_label: this.safeText(source.actor_label),
            site: this.safeText(source.site || this.getReadSite()) || this.getReadSite(),
            status_filter: this.safeText(source.status_filter || 'all').toLowerCase() || 'all',
            search_filter: this.safeText(source.search_filter),
            resolution: this.safeText(source.resolution),
            should_resolve_cases: source.should_resolve_cases === true,
            total_candidate_count: Math.max(0, Number.parseInt(source.total_candidate_count, 10) || 0),
            total_attempted_count: Math.max(0, Number.parseInt(source.total_attempted_count, 10) || 0),
            truncated_count: Math.max(0, Number.parseInt(source.truncated_count, 10) || 0),
            restored: normalizedRestored.map((item) => ({
                ...item,
                code: this.safeText(item?.code).toUpperCase(),
                id: this.safeText(item?.id),
                case_status: this.safeText(item?.case_status).toLowerCase(),
                signal_type: this.safeText(item?.signal_type).toLowerCase()
            })),
            failed: normalizedFailed.map((item) => ({
                ...item,
                code: this.safeText(item?.code).toUpperCase(),
                id: this.safeText(item?.id),
                case_status: this.safeText(item?.case_status).toLowerCase(),
                signal_type: this.safeText(item?.signal_type).toLowerCase(),
                skipped: item?.skipped === true,
                retry_count: Math.max(0, Number.parseInt(item?.retry_count, 10) || 0)
            })),
            case_sync_warning: this.safeText(source.case_sync_warning)
        };
    },

    upsertBatchRestoreHistoryRun: function (run = {}) {
        const normalizedRun = this.normalizeBatchRestoreHistoryRun(run);
        if (!normalizedRun.run_id) {
            return;
        }

        const previousRuns = Array.isArray(this.batchRestoreHistoryState?.runs)
            ? this.batchRestoreHistoryState.runs
            : [];
        const nextRuns = [normalizedRun, ...previousRuns.filter((item) => this.safeText(item?.run_id) !== normalizedRun.run_id)]
            .sort((left, right) => Date.parse(this.safeText(right.generated_at)) - Date.parse(this.safeText(left.generated_at)));

        this.batchRestoreHistoryState = {
            ...this.batchRestoreHistoryState,
            loaded: true,
            error: '',
            runs: nextRuns.slice(0, 50)
        };
    },

    ensureDiscountDetailLoaded: async function (discount = {}) {
        const discountId = this.safeText(discount?.id);
        if (!discountId) {
            throw new Error('缺少优惠券 ID');
        }

        const cacheKey = this.getDetailCacheKey(discountId);
        const cached = this.detailCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const detail = await this.loadDiscountDetailViaAdminApi({ id: discountId });
        this.detailCache.set(cacheKey, detail);
        return detail;
    },

    copyAuditSummary: async function () {
        const detail = this.getActiveDetailData();
        if (!detail) {
            alert('当前没有可复制的审计摘要');
            return;
        }

        try {
            await navigator.clipboard.writeText(this.buildDiscountAuditSummaryText(detail));
            this.showFeedbackToast('已复制审计摘要');
        } catch (error) {
            alert(`复制失败: ${error.message || '未知错误'}`);
        }
    },

    exportAuditSummary: function () {
        const detail = this.getActiveDetailData();
        if (!detail) {
            alert('当前没有可导出的审计摘要');
            return;
        }

        const code = this.safeText(detail.discount?.code).toUpperCase() || 'discount';
        const filterKey = this.normalizeDetailTimelineFilter(this.detailTimelineFilter);
        const safeCode = code.replace(/[^A-Z0-9_-]+/gi, '_');
        const filename = `discount_audit_${safeCode}_${filterKey}_${new Date().toISOString().slice(0, 10)}.txt`;
        this.downloadTextFile(this.buildDiscountAuditSummaryText(detail), filename);
        this.showFeedbackToast('已导出审计摘要');
    },

    exportFilteredAuditSummaries: async function () {
        if (!Array.isArray(this.filteredDiscounts) || this.filteredDiscounts.length === 0) {
            alert('当前筛选结果为空，暂无可导出的复盘摘要');
            return;
        }

        const maxBatchSize = 20;
        const exportCandidates = this.filteredDiscounts.slice(0, maxBatchSize);
        if (this.filteredDiscounts.length > maxBatchSize) {
            const confirmed = confirm(`当前筛选共有 ${this.filteredDiscounts.length} 张优惠券。为避免导出内容过大，本次将仅导出前 ${maxBatchSize} 张，是否继续？`);
            if (!confirmed) {
                return;
            }
        }

        const exportButton = document.querySelector('[data-admin-action="discounts-export-filtered-audit-summaries"]');
        const originalMarkup = exportButton instanceof HTMLElement ? exportButton.innerHTML : '';
        if (exportButton instanceof HTMLButtonElement) {
            exportButton.disabled = true;
            exportButton.textContent = '导出中...';
        }

        try {
            const details = await Promise.all(exportCandidates.map((discount) => this.ensureDiscountDetailLoaded(discount)));
            const summaryText = this.buildBatchDiscountAuditSummaryText(details, { timelineFilter: 'all' });
            const filename = `discount_batch_audit_${this.getReadSite()}_${new Date().toISOString().slice(0, 10)}.txt`;
            this.downloadTextFile(summaryText, filename);
            this.showFeedbackToast(`已导出 ${details.length} 张券的复盘摘要`);
        } catch (error) {
            alert(`批量导出失败: ${error.message || '未知错误'}`);
        } finally {
            if (exportButton instanceof HTMLButtonElement) {
                exportButton.disabled = false;
                exportButton.innerHTML = originalMarkup || '<i class="fas fa-file-arrow-down"></i> 导出当前筛选复盘';
            }
        }
    },

    copyBatchRestoreResultSummary: async function (mode = 'all') {
        if (!this.batchRestoreResult) {
            alert('当前没有可复制的批量恢复结果');
            return;
        }

        try {
            await navigator.clipboard.writeText(this.buildBatchRestoreResultSummaryText(this.batchRestoreResult, { mode }));
            this.showFeedbackToast(mode === 'failed' ? '已复制失败项摘要' : '已复制批量恢复摘要');
        } catch (error) {
            alert(`复制失败: ${error.message || '未知错误'}`);
        }
    },

    exportBatchRestoreResultSummary: function (mode = 'all') {
        if (!this.batchRestoreResult) {
            alert('当前没有可导出的批量恢复结果');
            return;
        }

        const normalizedMode = this.safeText(mode).toLowerCase() === 'failed' ? 'failed' : 'all';
        const site = this.safeText(this.batchRestoreResult.site || this.getReadSite()) || 'all';
        const filename = normalizedMode === 'failed'
            ? `discount_batch_restore_failed_${site}_${new Date().toISOString().slice(0, 10)}.txt`
            : `discount_batch_restore_result_${site}_${new Date().toISOString().slice(0, 10)}.txt`;
        this.downloadTextFile(
            this.buildBatchRestoreResultSummaryText(this.batchRestoreResult, { mode: normalizedMode }),
            filename
        );
        this.showFeedbackToast(normalizedMode === 'failed' ? '已导出失败项摘要' : '已导出批量恢复摘要');
    },

    copyBatchRestoreSummary: async function () {
        await this.copyBatchRestoreResultSummary('all');
    },

    copyBatchRestoreFailedSummary: async function () {
        await this.copyBatchRestoreResultSummary('failed');
    },

    exportBatchRestoreSummary: function () {
        this.exportBatchRestoreResultSummary('all');
    },

    exportBatchRestoreFailedSummary: function () {
        this.exportBatchRestoreResultSummary('failed');
    },

    copyBatchRestoreHistoryRunSummary: async function (runId = '', mode = 'all') {
        const run = this.findBatchRestoreHistoryRun(runId);
        if (!run) {
            alert('未找到要复制的历史跑次');
            return;
        }

        try {
            await navigator.clipboard.writeText(this.buildBatchRestoreResultSummaryText(run, { mode }));
            this.showFeedbackToast(mode === 'failed' ? '已复制历史失败项摘要' : '已复制历史结果摘要');
        } catch (error) {
            alert(`复制失败: ${error.message || '未知错误'}`);
        }
    },

    exportBatchRestoreHistoryRunSummary: function (runId = '', mode = 'all') {
        const run = this.findBatchRestoreHistoryRun(runId);
        if (!run) {
            alert('未找到要导出的历史跑次');
            return;
        }

        const normalizedMode = this.safeText(mode).toLowerCase() === 'failed' ? 'failed' : 'all';
        const safeRunId = this.safeText(run.run_id).slice(0, 8) || 'run';
        const safeSite = this.safeText(run.site || this.getReadSite()) || 'all';
        const filename = normalizedMode === 'failed'
            ? `discount_batch_restore_failed_${safeSite}_${safeRunId}.txt`
            : `discount_batch_restore_history_${safeSite}_${safeRunId}.txt`;
        this.downloadTextFile(this.buildBatchRestoreResultSummaryText(run, { mode: normalizedMode }), filename);
        this.showFeedbackToast(normalizedMode === 'failed' ? '已导出历史失败项摘要' : '已导出历史结果摘要');
    },

    buildDiscountDetailTimelineMarkup: function (detail = {}) {
        const timeline = this.getFilteredDiscountDetailTimelineItems(detail);
        if (!timeline.length) {
            return '<div class="admin-discount-detail-empty">最近没有风险告警或 case 时间线。</div>';
        }

        return `
            <div class="admin-discount-detail-timeline">
                ${timeline.map((item) => `
                    <div class="admin-discount-detail-timeline-item${item.is_restore_action ? ' admin-discount-detail-timeline-item--restore' : ''}">
                        <div class="admin-discount-detail-timeline-item__dot"></div>
                        <div class="admin-discount-detail-timeline-item__body">
                            <div class="admin-discount-detail-list-item__head">
                                <div>
                                    <div class="admin-discount-detail-list-item__title">${this.escapeHtml(item.title || '时间线事件')}</div>
                                    <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(this.formatDate(item.created_at, { includeTime: true }) || '未知时间')}</div>
                                </div>
                                <span class="admin-discount-detail-chip${item.state === 'problem' ? ' admin-discount-detail-chip--risk' : ''}">${this.escapeHtml(this.formatDetailTimelineStateLabel(item.state || item.type))}</span>
                            </div>
                            ${item.summary ? `<div class="admin-discount-detail-timeline-item__summary">${this.escapeHtml(item.summary)}</div>` : ''}
                            <div class="admin-discount-detail-chip-row">
                                ${item.actor_label ? `<span class="admin-discount-detail-chip">操作人 ${this.escapeHtml(item.actor_label)}</span>` : ''}
                                ${item.owner_label ? `<span class="admin-discount-detail-chip">负责人 ${this.escapeHtml(item.owner_label)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderDiscountRestoreModal: function (discount = {}) {
        const riskSummary = this.getRiskSummary(discount);
        const usageSummary = this.getRecentUsageSummary(discount);
        const code = this.safeText(discount.code).toUpperCase() || '优惠码';
        const latestSignal = this.formatWorkbenchSignalLabel(riskSummary.signal_type) || '未知风控信号';
        const latestRiskLevel = this.formatRiskLevelLabel(riskSummary.risk_level) || '未知';
        const latestRiskScore = Number.isFinite(Number(riskSummary.risk_score)) ? `${riskSummary.risk_score} 分` : '未记录';
        const caseStatus = this.formatCaseStatusLabel(riskSummary.case_status) || '未建 case';
        const ownerLabel = this.safeText(riskSummary.case_owner_label) || '—';
        const autoResponseSummary = this.safeText(riskSummary.auto_response_summary)
            || this.safeText(riskSummary.response_summary)
            || '最近没有自动处置说明。';
        const recoveryStrategy = this.formatRecoveryStrategyLabel(discount.recovery_strategy);
        const observationHours = Math.max(1, Number.parseInt(discount.observation_window_hours, 10) || 24);
        const defaultChecked = ['open', 'claimed'].includes(riskSummary.case_status);

        return `
            <div class="admin-discount-restore-dialog">
                <div class="admin-discount-restore-header">
                    <div>
                        <div class="admin-discount-restore-header__eyebrow">恢复审批</div>
                        <h3 class="admin-discount-restore-header__title">恢复启用 ${this.escapeHtml(code)}</h3>
                        <p class="admin-discount-restore-header__summary">这张券最近命中过风控链路，恢复前建议先确认命中订单、关联账号和定价配置已经复核完成。</p>
                    </div>
                    <button type="button"
                        class="admin-discount-restore-close"
                        data-admin-action="discounts-close-restore-modal"
                        aria-label="关闭">&times;</button>
                </div>

                <div class="admin-discount-restore-grid">
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">最近信号</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(latestSignal)}</div>
                        <div class="admin-discount-restore-card__meta">${this.escapeHtml(latestRiskLevel)} · ${this.escapeHtml(latestRiskScore)}</div>
                    </div>
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">Case 状态</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(caseStatus)}</div>
                        <div class="admin-discount-restore-card__meta">负责人 ${this.escapeHtml(ownerLabel)}</div>
                    </div>
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">近 30 天使用</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(String(usageSummary.recent_order_count || 0))} 单 / ${this.escapeHtml(String(usageSummary.recent_distinct_user_count || 0))} 人</div>
                        <div class="admin-discount-restore-card__meta">${Number(usageSummary.recent_zero_total_count || 0) > 0 ? `0 价订单 ${this.escapeHtml(String(usageSummary.recent_zero_total_count || 0))} 笔` : '最近未出现 0 价订单'}</div>
                    </div>
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">恢复策略</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(recoveryStrategy)}</div>
                        <div class="admin-discount-restore-card__meta">${this.safeText(discount.recovery_strategy).toLowerCase() === 'observation_then_restore' ? `启用后观察 ${this.escapeHtml(String(observationHours))} 小时` : '恢复后按主状态直接生效'}</div>
                    </div>
                </div>

                <div class="admin-discount-restore-callout">
                    <div class="admin-discount-restore-callout__title">最近处置记录</div>
                    <div class="admin-discount-restore-callout__summary">${this.escapeHtml(autoResponseSummary)}</div>
                </div>

                <label class="admin-discount-restore-check">
                    <input type="checkbox" id="discountRestoreReviewed">
                    <span>我已复核最近命中订单、关联账号和商品定价，确认可以恢复。</span>
                </label>

                <label class="admin-discount-restore-check">
                    <input type="checkbox" id="discountRestoreResolveCase"${defaultChecked ? ' checked' : ''}>
                    <span>恢复后同步关闭关联风险 case</span>
                </label>

                <div class="admin-discount-restore-field">
                    <label for="discountRestoreResolution">复核结论</label>
                    <textarea id="discountRestoreResolution" rows="4" placeholder="例如：已人工复核最近命中订单与账号，确认活动配置正常，现恢复该优惠码。"></textarea>
                </div>

                <div class="admin-discount-restore-actions">
                    <button type="button"
                        class="admin-discount-restore-btn admin-discount-restore-btn--ghost"
                        data-admin-action="discounts-close-restore-modal">取消</button>
                    <button type="button"
                        class="admin-discount-restore-btn admin-discount-restore-btn--primary"
                        data-admin-action="discounts-submit-restore-modal">确认恢复启用</button>
                </div>
            </div>
        `;
    },

    renderBatchRestoreModal: function (candidates = []) {
        const items = Array.isArray(candidates) ? candidates : [];
        const visibleItems = items.slice(0, 8);
        const hiddenCount = Math.max(0, items.length - visibleItems.length);
        const caseEligibleCount = items.filter((discount) => ['open', 'claimed'].includes(this.getRiskSummary(discount).case_status)).length;
        const maxBatchSize = 20;
        const cappedCount = Math.min(items.length, maxBatchSize);
        const willTruncate = items.length > maxBatchSize;

        return `
            <div class="admin-discount-restore-dialog admin-discount-restore-dialog--batch">
                <div class="admin-discount-restore-header">
                    <div>
                        <div class="admin-discount-restore-header__eyebrow">批量恢复审批</div>
                        <h3 class="admin-discount-restore-header__title">批量恢复审批</h3>
                        <p class="admin-discount-restore-header__summary">将按当前筛选结果，对带有风险上下文的停用优惠券执行统一复核恢复流程。</p>
                    </div>
                    <button type="button"
                        class="admin-discount-restore-close"
                        data-admin-action="discounts-close-batch-restore-modal"
                        aria-label="关闭">&times;</button>
                </div>

                <div class="admin-discount-restore-grid">
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">候选优惠券</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(String(items.length))} 张</div>
                        <div class="admin-discount-restore-card__meta">当前筛选结果中满足恢复条件的停用券</div>
                    </div>
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">可同步关单</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(String(caseEligibleCount))} 张</div>
                        <div class="admin-discount-restore-card__meta">存在 open / claimed 风险 case</div>
                    </div>
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">本次处理上限</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(String(cappedCount))} 张</div>
                        <div class="admin-discount-restore-card__meta">${willTruncate ? '为了避免一次处理过多，超过 20 张时只处理前 20 张。' : '本次会全部处理。'}</div>
                    </div>
                </div>

                <div class="admin-discount-restore-callout">
                    <div class="admin-discount-restore-callout__title">本次恢复范围</div>
                    <div class="admin-discount-detail-chip-row">
                        ${visibleItems.map((discount) => `
                            <span class="admin-discount-detail-chip">${this.escapeHtml(this.safeText(discount.code).toUpperCase())}</span>
                        `).join('')}
                        ${hiddenCount > 0 ? `<span class="admin-discount-detail-chip">另有 ${this.escapeHtml(String(hiddenCount))} 张</span>` : ''}
                    </div>
                </div>

                <label class="admin-discount-restore-check">
                    <input type="checkbox" id="discountBatchRestoreReviewed">
                    <span>我已完成本批次优惠券的风险复核，确认可以统一恢复。</span>
                </label>

                <label class="admin-discount-restore-check">
                    <input type="checkbox" id="discountBatchRestoreResolveCases"${caseEligibleCount > 0 ? ' checked' : ''}>
                    <span>恢复后同步关闭关联风险 case</span>
                </label>

                <div class="admin-discount-restore-field">
                    <label for="discountBatchRestoreResolution">批量复核结论</label>
                    <textarea id="discountBatchRestoreResolution" rows="4" placeholder="例如：已批量复核最近命中订单、关联账号和商品定价，确认配置正常，现恢复当前筛选结果中的停用优惠券。"></textarea>
                </div>

                <div class="admin-discount-restore-actions">
                    <button type="button"
                        class="admin-discount-restore-btn admin-discount-restore-btn--ghost"
                        data-admin-action="discounts-close-batch-restore-modal">取消</button>
                    <button type="button"
                        class="admin-discount-restore-btn admin-discount-restore-btn--primary"
                        data-admin-action="discounts-submit-batch-restore-modal">确认批量恢复</button>
                </div>
            </div>
        `;
    },

    buildDiscountDetailLoadingMarkup: function (discount = null) {
        const code = this.safeText(discount?.code).toUpperCase() || '优惠券';
        return `
            <div class="admin-discount-detail-dialog custom-scrollbar">
                <div class="admin-discount-detail-header">
                    <div>
                        <div class="admin-discount-detail-header__eyebrow">优惠券详情</div>
                        <h3 class="admin-discount-detail-header__title">${this.escapeHtml(code)}</h3>
                    </div>
                </div>
                <div class="admin-discount-detail-loading">
                    <span class="modal-loading__label">正在加载优惠券详情...</span>
                </div>
            </div>
        `;
    },

    renderDiscountDetailModal: function (detail = {}) {
        const discount = detail.discount && typeof detail.discount === 'object' ? detail.discount : {};
        const statusState = this.getDiscountStatusState(discount, new Date());
        const usageSummary = this.getRecentUsageSummary(discount);
        const assetSummary = this.getAssetSummary(discount);
        const riskSummary = this.getRiskSummary(discount);
        const scopeType = this.normalizeScopeType(discount.scope_type);
        const scopeLabel = scopeType === 'category'
            ? `分类 · ${this.getCategoryLabel(discount.scope_category)}`
            : (scopeType === 'product'
                ? `商品 · ${this.getProductLabel(discount.scope_product_id)}`
                : '全部商品');

        const summaryCards = [
            { label: '生效状态', value: statusState.label || '—' },
            { label: '近 30 天订单', value: String(usageSummary.recent_order_count || 0) },
            { label: '净核销 / 退款', value: `${usageSummary.recent_net_order_count || 0} / ${usageSummary.recent_refund_count || 0}` },
            { label: '卡券发放 / 可用', value: `${assetSummary.issued_count || 0} / ${assetSummary.available_count || 0}` },
            { label: '风控分数', value: Number.isFinite(Number(riskSummary.risk_score)) ? String(riskSummary.risk_score) : '—' }
        ];

        const baseRows = [
            { label: '优惠类型', value: discount.discount_type === 'fixed' ? `固定立减 ${discount.discount_value || 0}` : this.formatPercentDiscountValue(discount.discount_value) },
            { label: '适用站点', value: this.formatSiteLabel(discount.applicable_site) },
            { label: '适用范围', value: scopeLabel },
            { label: '发放模式', value: this.formatDistributionModeLabel(discount.distribution_mode) },
            { label: '投放渠道', value: this.safeText(discount.campaign_tag) || '—' },
            { label: '目标人群', value: this.safeText(discount.audience_segment) || '—' },
            { label: '叠加策略', value: this.formatStackingModeLabel(discount) },
            { label: '价格阶段', value: this.formatPricingApplyStageLabel(discount.pricing_apply_stage) },
            { label: '结算优先级', value: `${Math.max(1, Number.parseInt(discount.stack_priority, 10) || 100)}` },
            { label: '总使用限制', value: Number(discount.max_uses || 0) > 0 ? `${discount.max_uses} 次` : '不限' },
            { label: '每用户限制', value: Number(discount.max_uses_per_user || 0) > 0 ? `${discount.max_uses_per_user} 次` : '不限' },
            { label: '生效时间', value: this.formatDate(discount.starts_at, { includeTime: true }) || '立即生效' },
            { label: '过期时间', value: this.formatDate(discount.expires_at, { includeTime: true }) || '永久有效' },
            { label: '领取开始', value: this.formatDate(discount.claim_starts_at, { includeTime: true }) || '立即' },
            { label: '领取截止', value: this.formatDate(discount.claim_expires_at, { includeTime: true }) || '长期' },
            { label: '每人领取上限', value: Number(discount.claim_limit_per_user || 0) > 0 ? `${discount.claim_limit_per_user} 次` : '不限' },
            { label: '状态原因', value: this.formatStatusReasonLabel(statusState.reasonKey) || '—' },
            { label: '恢复策略', value: this.formatRecoveryStrategyLabel(discount.recovery_strategy) },
            { label: '观察期时长', value: `${Math.max(1, Number.parseInt(discount.observation_window_hours, 10) || 24)} 小时` },
            { label: '观察期截止', value: this.formatDate(discount.observation_ends_at, { includeTime: true }) || '—' },
            { label: '规则版本', value: `v${Math.max(1, Number.parseInt(discount.version_no, 10) || 1)}` },
            { label: '创建时间', value: this.formatDate(discount.created_at, { includeTime: true }) || '未知时间' },
            { label: '零价策略', value: discount.allow_zero_total ? '允许全免' : '禁止全免' }
        ];

        const riskRows = [
            { label: '最近信号', value: this.formatWorkbenchSignalLabel(riskSummary.signal_type) || '无' },
            { label: '最新风险等级', value: this.formatRiskLevelLabel(riskSummary.risk_level) || '无' },
            { label: '自动处置', value: riskSummary.auto_response_summary || riskSummary.response_summary || '无' },
            { label: '恢复处置', value: riskSummary.recovery_auto_summary || '无' },
            { label: 'Case 状态', value: this.formatCaseStatusLabel(riskSummary.case_status) || '未建 case' },
            { label: '负责人', value: riskSummary.case_owner_label || '—' },
            { label: '最近告警', value: this.formatDate(riskSummary.latest_alert_at, { includeTime: true }) || '无' },
            { label: '让利毛 / 净', value: `${usageSummary.recent_discount_cost_gross || 0} / ${usageSummary.recent_discount_cost_net || 0}` },
            { label: '营收毛 / 净', value: `${usageSummary.recent_revenue_gross || 0} / ${usageSummary.recent_revenue_net || 0}` },
            { label: '首单转化', value: `${usageSummary.new_customer_order_count || 0} 单` }
        ];

        return `
            <div class="admin-discount-detail-dialog custom-scrollbar">
                <div class="admin-discount-detail-header">
                    <div>
                        <div class="admin-discount-detail-header__eyebrow">优惠券详情</div>
                        <h3 class="admin-discount-detail-header__title">${this.escapeHtml(this.safeText(discount.code).toUpperCase() || '优惠券详情')}</h3>
                        <div class="admin-discount-detail-header__meta">${statusState.badgeMarkup}</div>
                    </div>
                    <div class="admin-discount-detail-header__actions">
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-copy-code"
                            data-discount-code="${this.escapeHtml(this.safeText(discount.code).toUpperCase())}">复制优惠码</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-copy-audit-summary">复制审计摘要</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-export-audit-summary">导出审计摘要</button>
                        ${statusState.key === 'paused_risk' ? `
                            <button type="button"
                                class="admin-discount-detail-inline-btn"
                                data-admin-action="discounts-open-restore-modal"
                                data-discount-id="${this.escapeHtml(this.safeText(discount.id))}">风险复核后恢复</button>
                        ` : ''}
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-open-edit-from-detail"
                            data-discount-id="${this.escapeHtml(this.safeText(discount.id))}">编辑优惠券</button>
                    </div>
                </div>

                <div class="admin-discount-detail-summary-grid">
                    ${summaryCards.map((card) => `
                        <div class="admin-discount-detail-summary-card">
                            <div class="admin-discount-detail-summary-card__label">${this.escapeHtml(card.label)}</div>
                            <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(card.value)}</div>
                        </div>
                    `).join('')}
                </div>

                <div class="admin-discount-detail-section-grid">
                    <section class="admin-discount-detail-section">
                        <div class="admin-discount-detail-section__title">基础配置</div>
                        ${this.buildDiscountDetailFactsMarkup(baseRows)}
                    </section>
                    <section class="admin-discount-detail-section">
                        <div class="admin-discount-detail-section__title">风险摘要</div>
                        ${this.buildDiscountDetailFactsMarkup(riskRows)}
                    </section>
                </div>

                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">最近命中订单</div>
                    ${this.buildDiscountDetailOrdersMarkup(detail)}
                </section>

                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">关联账号</div>
                    ${this.buildDiscountDetailUsersMarkup(detail)}
                </section>

                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">卡券发放与定向投放</div>
                    ${this.buildDiscountAssetAssignmentMarkup(detail)}
                </section>

                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">兑换漏斗与 ROI</div>
                    ${this.buildDiscountFunnelMarkup(discount)}
                </section>

                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">站点 / 渠道 / 人群拆分</div>
                    ${this.buildDiscountSegmentMarkup(discount)}
                </section>

                <section class="admin-discount-detail-section">
                    <div class="admin-discount-detail-section__title">风险时间线</div>
                    ${this.buildDiscountDetailTimelineFilterMarkup(detail)}
                    ${this.buildDiscountDetailTimelineMarkup(detail)}
                </section>
            </div>
        `;
    },

    openDetailModal: async function (id = '') {
        return this.openDetailByReference({ id });
    },

    openDetailByReference: async function ({ id = '', code = '' } = {}) {
        const normalizedId = this.safeText(id);
        const normalizedCode = this.safeText(code).toUpperCase();
        const cachedDiscount = this.getCachedDiscountRecord({ id: normalizedId, code: normalizedCode });
        if (!cachedDiscount && !normalizedId && !normalizedCode) {
            alert('未找到要查看的优惠券');
            return;
        }

        if (this.activeBatchRestoreHistoryRunId) {
            this.closeBatchRestoreHistoryRunDetail();
        }

        const fallbackCode = this.safeText(cachedDiscount?.code).toUpperCase() || normalizedCode || '优惠券';
        this.activeDetailId = this.safeText(cachedDiscount?.id || normalizedId);
        this.detailTimelineFilter = 'all';
        const cacheKey = this.getDetailCacheKey(this.activeDetailId);
        let overlay = document.getElementById('discountDetailOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'discountDetailOverlay';
            overlay.className = 'admin-discount-detail-overlay';
            overlay.setAttribute('data-admin-overlay-close', 'discount-detail-modal');
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = this.buildDiscountDetailLoadingMarkup(cachedDiscount || { code: fallbackCode });
        requestAnimationFrame(() => {
            overlay?.classList.add('is-visible');
        });

        const requestToken = this.detailRequestToken + 1;
        this.detailRequestToken = requestToken;

        let detail = this.activeDetailId ? this.detailCache.get(cacheKey) : null;
        if (!detail) {
            try {
                detail = await this.ensureDiscountDetailLoadedByReference({ id: normalizedId, code: normalizedCode });
                this.activeDetailId = this.safeText(detail?.discount?.id || this.activeDetailId);
            } catch (error) {
                if (requestToken !== this.detailRequestToken) {
                    return;
                }

                overlay.innerHTML = `
                    <div class="admin-discount-detail-dialog custom-scrollbar">
                        <div class="admin-discount-detail-header">
                            <div>
                                <div class="admin-discount-detail-header__eyebrow">优惠券详情</div>
                                <h3 class="admin-discount-detail-header__title">${this.escapeHtml(fallbackCode || '优惠券详情')}</h3>
                            </div>
                        </div>
                        <div class="admin-discount-detail-empty">加载失败：${this.escapeHtml(error.message || '未知错误')}</div>
                    </div>
                `;
                return;
            }
        }

        if (requestToken !== this.detailRequestToken) {
            return;
        }

        overlay.innerHTML = this.renderDiscountDetailModal(detail);
    },

    closeDetailModal: function () {
        this.activeDetailId = '';
        this.detailTimelineFilter = 'all';
        const overlay = document.getElementById('discountDetailOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        setTimeout(() => {
            if (!overlay.classList.contains('is-visible')) {
                overlay.remove();
            }
        }, 180);
    },

    setDetailTimelineFilter: function (value = '') {
        this.detailTimelineFilter = this.normalizeDetailTimelineFilter(value);

        const overlay = document.getElementById('discountDetailOverlay');
        if (!overlay || !this.activeDetailId) {
            return;
        }

        const cacheKey = this.getDetailCacheKey(this.activeDetailId);
        const detail = this.detailCache.get(cacheKey);
        if (!detail) {
            return;
        }

        overlay.innerHTML = this.renderDiscountDetailModal(detail);
    },

    openRestoreModal: async function (id = '') {
        let discount = this.getCachedDiscountRecord({ id });
        if (!discount && this.safeText(id)) {
            const detail = await this.ensureDiscountDetailLoadedByReference({ id });
            discount = detail?.discount || null;
        }
        if (!discount) {
            alert('未找到要恢复的优惠券');
            return;
        }

        this.restoreModalDiscountId = this.safeText(discount.id);
        let overlay = document.getElementById('discountRestoreOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'discountRestoreOverlay';
            overlay.className = 'admin-discount-restore-overlay';
            overlay.setAttribute('data-admin-overlay-close', 'discount-restore-modal');
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = this.renderDiscountRestoreModal(discount);
        requestAnimationFrame(() => {
            overlay?.classList.add('is-visible');
        });
    },

    closeRestoreModal: function () {
        this.restoreModalDiscountId = '';
        const overlay = document.getElementById('discountRestoreOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        setTimeout(() => {
            if (!overlay.classList.contains('is-visible')) {
                overlay.remove();
            }
        }, 180);
    },

    openBatchRestoreModal: function () {
        const candidates = this.getBatchRestoreCandidates();
        if (!candidates.length) {
            alert('当前筛选结果里没有可批量恢复审批的优惠券');
            return;
        }

        let overlay = document.getElementById('discountBatchRestoreOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'discountBatchRestoreOverlay';
            overlay.className = 'admin-discount-restore-overlay';
            overlay.setAttribute('data-admin-overlay-close', 'discount-batch-restore-modal');
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = this.renderBatchRestoreModal(candidates);
        requestAnimationFrame(() => {
            overlay?.classList.add('is-visible');
        });
    },

    closeBatchRestoreModal: function () {
        const overlay = document.getElementById('discountBatchRestoreOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        setTimeout(() => {
            if (!overlay.classList.contains('is-visible')) {
                overlay.remove();
            }
        }, 180);
    },

    findBatchRestoreHistoryRun: function (runId = '') {
        const normalizedRunId = this.safeText(runId);
        return (Array.isArray(this.batchRestoreHistoryState?.runs) ? this.batchRestoreHistoryState.runs : [])
            .find((run) => this.safeText(run?.run_id) === normalizedRunId) || null;
    },

    resolveRetryableHistoryRunItems: function (run = {}, options = {}) {
        const onlyDiscountId = this.safeText(options.discountId);
        return (Array.isArray(run?.failed) ? run.failed : [])
            .filter((item) => item?.skipped !== true)
            .filter((item) => !onlyDiscountId || this.safeText(item?.id) === onlyDiscountId);
    },

    prepareHistoryRunRetryCandidates: async function (items = []) {
        const candidates = [];
        const preflightFailures = [];

        for (const item of (Array.isArray(items) ? items : [])) {
            try {
                const detail = await this.ensureDiscountDetailLoadedByReference({
                    id: this.safeText(item?.id),
                    code: this.safeText(item?.code).toUpperCase()
                });
                const discount = detail?.discount || null;
                if (!discount) {
                    throw new Error('未找到优惠券详情');
                }
                if (!this.shouldUseRiskRestoreFlow(discount)) {
                    preflightFailures.push(this.buildBatchRestoreItemRecord(discount, {
                        message: '当前已不需要走风险恢复流程',
                        retry_count: Math.max(0, Number(item?.retry_count || 0) + 1)
                    }));
                    continue;
                }
                candidates.push(discount);
            } catch (error) {
                preflightFailures.push({
                    id: this.safeText(item?.id),
                    code: this.safeText(item?.code).toUpperCase(),
                    case_status: this.safeText(item?.case_status).toLowerCase(),
                    signal_type: this.safeText(item?.signal_type).toLowerCase(),
                    risk_score: Number.isFinite(Number(item?.risk_score)) ? Math.max(0, Math.round(Number(item.risk_score))) : null,
                    message: error.message || '未找到优惠券详情',
                    skipped: false,
                    retry_count: Math.max(0, Number(item?.retry_count || 0) + 1)
                });
            }
        }

        return {
            candidates,
            preflightFailures
        };
    },

    getBatchRestoreHistoryRunStatus: function (run = {}) {
        const failedCount = Math.max(0, Number(run?.failed_count ?? ((Array.isArray(run?.failed) ? run.failed.filter((item) => item.skipped !== true).length : 0))));
        if (failedCount > 0) {
            return 'failed';
        }
        return 'success';
    },

    getBatchRestoreHistoryRunSearchText: function (run = {}) {
        const restoredCodes = (Array.isArray(run?.restored) ? run.restored : []).map((item) => this.safeText(item?.code));
        const failedCodes = (Array.isArray(run?.failed) ? run.failed : []).map((item) => this.safeText(item?.code));
        return [
            this.safeText(run?.run_id),
            this.safeText(run?.retry_of_run_id),
            this.safeText(run?.actor_label),
            this.safeText(run?.resolution),
            this.safeText(run?.site),
            this.safeText(run?.status_filter),
            this.safeText(run?.search_filter),
            ...restoredCodes,
            ...failedCodes
        ].map((item) => item.toLowerCase()).filter(Boolean).join(' ');
    },

    getFilteredBatchRestoreHistoryRuns: function (runs = []) {
        const items = Array.isArray(runs) ? runs : [];
        const statusFilter = this.normalizeBatchRestoreHistoryFilter(this.batchRestoreHistoryView?.status);
        const search = this.safeText(this.batchRestoreHistoryView?.search).toLowerCase();

        return items.filter((run) => {
            let matchStatus = true;
            if (statusFilter === 'success') {
                matchStatus = this.getBatchRestoreHistoryRunStatus(run) === 'success';
            } else if (statusFilter === 'failed') {
                matchStatus = this.getBatchRestoreHistoryRunStatus(run) === 'failed';
            } else if (statusFilter === 'retry') {
                matchStatus = Boolean(this.safeText(run?.retry_of_run_id));
            }

            let matchSearch = true;
            if (search) {
                matchSearch = this.getBatchRestoreHistoryRunSearchText(run).includes(search);
            }

            return matchStatus && matchSearch;
        });
    },

    getBatchRestoreHistorySummary: function (runs = []) {
        const items = Array.isArray(runs) ? runs : [];
        return items.reduce((summary, run) => {
            summary.total += 1;
            if (this.getBatchRestoreHistoryRunStatus(run) === 'failed') {
                summary.failed += 1;
            } else {
                summary.success += 1;
            }
            if (this.safeText(run?.retry_of_run_id)) {
                summary.retry += 1;
            }
            if (this.safeText(run?.case_sync_warning)) {
                summary.case_warning += 1;
            }
            return summary;
        }, {
            total: 0,
            success: 0,
            failed: 0,
            retry: 0,
            case_warning: 0
        });
    },

    getCachedDiscountRecord: function ({ id = '', code = '' } = {}) {
        const normalizedId = this.safeText(id);
        const normalizedCode = this.safeText(code).toUpperCase();
        const inList = normalizedId ? this.getDiscountById(normalizedId) : null;
        if (inList) {
            return inList;
        }

        for (const detail of this.detailCache.values()) {
            const discount = detail?.discount && typeof detail.discount === 'object' ? detail.discount : null;
            if (!discount) continue;
            if (normalizedId && this.safeText(discount.id) === normalizedId) {
                return discount;
            }
            if (normalizedCode && this.safeText(discount.code).toUpperCase() === normalizedCode) {
                return discount;
            }
        }

        return null;
    },

    ensureDiscountDetailLoadedByReference: async function ({ id = '', code = '' } = {}) {
        const normalizedId = this.safeText(id);
        const normalizedCode = this.safeText(code).toUpperCase();
        const cachedDiscount = this.getCachedDiscountRecord({ id: normalizedId, code: normalizedCode });
        if (cachedDiscount) {
            const cacheKey = this.getDetailCacheKey(this.safeText(cachedDiscount.id));
            if (this.detailCache.has(cacheKey)) {
                return this.detailCache.get(cacheKey);
            }
        }

        const detail = await this.loadDiscountDetailViaAdminApi({
            id: normalizedId,
            code: normalizedCode
        });
        const resolvedId = this.safeText(detail?.discount?.id || normalizedId);
        if (resolvedId) {
            this.detailCache.set(this.getDetailCacheKey(resolvedId), detail);
        }
        return detail;
    },

    refreshBatchRestoreHistoryModal: function () {
        const overlay = document.getElementById('discountBatchRestoreHistoryOverlay');
        if (!overlay) {
            return;
        }

        overlay.innerHTML = this.renderBatchRestoreHistoryModal(this.batchRestoreHistoryState);
    },

    loadBatchRestoreHistory: async function ({ force = false } = {}) {
        if (!force && this.batchRestoreHistoryState.loaded === true && Array.isArray(this.batchRestoreHistoryState.runs)) {
            return this.batchRestoreHistoryState.runs;
        }

        this.batchRestoreHistoryState = {
            ...this.batchRestoreHistoryState,
            loading: true,
            error: ''
        };
        this.refreshBatchRestoreHistoryModal();

        try {
            const payload = await this.loadBatchRestoreHistoryViaAdminApi();
            const runs = (Array.isArray(payload.runs) ? payload.runs : []).map((run) => this.normalizeBatchRestoreHistoryRun(run));
            this.batchRestoreHistoryState = {
                loaded: true,
                loading: false,
                error: '',
                runs
            };
            this.refreshBatchRestoreHistoryModal();
            return runs;
        } catch (error) {
            this.batchRestoreHistoryState = {
                ...this.batchRestoreHistoryState,
                loaded: false,
                loading: false,
                error: error.message || '未知错误'
            };
            this.refreshBatchRestoreHistoryModal();
            throw error;
        }
    },

    setBatchRestoreHistoryFilter: function (value = '') {
        this.batchRestoreHistoryView = {
            ...(this.batchRestoreHistoryView || {}),
            status: this.normalizeBatchRestoreHistoryFilter(value)
        };
        this.refreshBatchRestoreHistoryModal();
    },

    searchBatchRestoreHistory: function () {
        const input = document.getElementById('discountBatchHistorySearchInput');
        this.batchRestoreHistoryView = {
            ...(this.batchRestoreHistoryView || {}),
            search: this.safeText(input?.value)
        };
        this.refreshBatchRestoreHistoryModal();
    },

    openBatchRestoreHistoryModal: async function () {
        let overlay = document.getElementById('discountBatchRestoreHistoryOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'discountBatchRestoreHistoryOverlay';
            overlay.className = 'admin-discount-restore-overlay';
            overlay.setAttribute('data-admin-overlay-close', 'discount-batch-restore-history-modal');
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = this.renderBatchRestoreHistoryModal({
            ...this.batchRestoreHistoryState,
            loading: true,
            error: '',
            runs: Array.isArray(this.batchRestoreHistoryState.runs) ? this.batchRestoreHistoryState.runs : []
        });
        requestAnimationFrame(() => {
            overlay?.classList.add('is-visible');
        });

        try {
            await this.loadBatchRestoreHistory();
        } catch (_) {
            // modal already shows error state
        }
    },

    closeBatchRestoreHistoryModal: function () {
        const overlay = document.getElementById('discountBatchRestoreHistoryOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        setTimeout(() => {
            if (!overlay.classList.contains('is-visible')) {
                overlay.remove();
            }
        }, 180);
    },

    openBatchRestoreHistoryRunDetail: function (runId = '') {
        const run = this.findBatchRestoreHistoryRun(runId);
        if (!run) {
            alert('未找到要查看的历史跑次');
            return;
        }

        this.activeBatchRestoreHistoryRunId = this.safeText(run.run_id);
        let overlay = document.getElementById('discountBatchRestoreHistoryRunDetailOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'discountBatchRestoreHistoryRunDetailOverlay';
            overlay.className = 'admin-discount-restore-overlay';
            overlay.setAttribute('data-admin-overlay-close', 'discount-batch-restore-history-run-detail-modal');
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = this.renderBatchRestoreHistoryRunDetailModal(run);
        requestAnimationFrame(() => {
            overlay?.classList.add('is-visible');
        });
    },

    closeBatchRestoreHistoryRunDetail: function () {
        this.activeBatchRestoreHistoryRunId = '';
        const overlay = document.getElementById('discountBatchRestoreHistoryRunDetailOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        setTimeout(() => {
            if (!overlay.classList.contains('is-visible')) {
                overlay.remove();
            }
        }, 180);
    },

    retryBatchRestoreHistoryRun: async function (runId = '', options = {}) {
        const run = this.findBatchRestoreHistoryRun(runId);
        if (!run) {
            alert('未找到要重试的历史跑次');
            return;
        }

        const retryItems = this.resolveRetryableHistoryRunItems(run, {
            discountId: options.discountId
        });
        if (!retryItems.length) {
            alert('当前没有可重试的失败项');
            return;
        }

        const writableSite = this.requireWritableSite({ label: '重试历史跑次失败项' });
        if (!writableSite) {
            return;
        }

        const trigger = options.discountId
            ? document.querySelector(`[data-admin-action="discounts-retry-history-run-item"][data-discount-id="${CSS.escape(this.safeText(options.discountId))}"]`)
            : document.querySelector('[data-admin-action="discounts-retry-history-run"]');
        const originalText = trigger instanceof HTMLButtonElement ? trigger.textContent : '';
        if (trigger instanceof HTMLButtonElement) {
            trigger.disabled = true;
            trigger.textContent = '重试中...';
        }

        try {
            const { candidates, preflightFailures } = await this.prepareHistoryRunRetryCandidates(retryItems);
            const retryRunId = this.generateBatchRunId();
            const retryResult = candidates.length
                ? await this.performBatchRestore(candidates, {
                    writableSite,
                    resolution: this.safeText(run.resolution),
                    shouldResolveCases: run.should_resolve_cases === true,
                    operationSource: 'risk_restore_history_retry',
                    batchRunId: retryRunId,
                    retryOfRunId: this.safeText(run.run_id)
                })
                : {
                    run_id: retryRunId,
                    batch_run_id: retryRunId,
                    retry_of_run_id: this.safeText(run.run_id),
                    generated_at: new Date().toISOString(),
                    resolution: this.safeText(run.resolution),
                    should_resolve_cases: run.should_resolve_cases === true,
                    operation_source: 'risk_restore_history_retry',
                    site: this.getReadSite(),
                    status_filter: this.filters.status,
                    search_filter: this.safeText(this.filters.search),
                    total_attempted_count: 0,
                    restored: [],
                    failed: [],
                    case_sync_warning: ''
                };

            const mergedResult = {
                ...retryResult,
                total_candidate_count: retryItems.length,
                truncated_count: 0,
                failed: [...(Array.isArray(retryResult.failed) ? retryResult.failed : []), ...preflightFailures]
            };

            try {
                await this.recordBatchRestoreRun(mergedResult);
            } catch (recordError) {
                mergedResult.case_sync_warning = mergedResult.case_sync_warning
                    ? `${mergedResult.case_sync_warning}；历史归档失败：${recordError.message || '未知错误'}`
                    : `历史归档失败：${recordError.message || '未知错误'}`;
            }

            await this.loadDiscounts();
            await this.loadBatchRestoreHistory({ force: true });
            this.closeBatchRestoreHistoryRunDetail();
            this.openBatchRestoreResultModal(mergedResult);
        } catch (error) {
            alert(`重试历史失败项时出错: ${error.message || '未知错误'}`);
        } finally {
            if (trigger instanceof HTMLButtonElement) {
                trigger.disabled = false;
                trigger.textContent = originalText || '重试失败项';
            }
        }
    },

    openBatchRestoreResultModal: function (result = null) {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            return;
        }

        this.batchRestoreResult = {
            ...result,
            restored: Array.isArray(result.restored) ? result.restored.slice() : [],
            failed: Array.isArray(result.failed) ? result.failed.slice() : []
        };

        let overlay = document.getElementById('discountBatchRestoreResultOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'discountBatchRestoreResultOverlay';
            overlay.className = 'admin-discount-restore-overlay';
            overlay.setAttribute('data-admin-overlay-close', 'discount-batch-restore-result-modal');
            document.body.appendChild(overlay);
        }

        overlay.innerHTML = this.renderBatchRestoreResultModal(this.batchRestoreResult);
        requestAnimationFrame(() => {
            overlay?.classList.add('is-visible');
        });
    },

    rerenderBatchRestoreResultModal: function () {
        const overlay = document.getElementById('discountBatchRestoreResultOverlay');
        if (!overlay || !this.batchRestoreResult) {
            return;
        }

        overlay.innerHTML = this.renderBatchRestoreResultModal(this.batchRestoreResult);
    },

    closeBatchRestoreResultModal: function () {
        this.batchRestoreResult = null;
        const overlay = document.getElementById('discountBatchRestoreResultOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        setTimeout(() => {
            if (!overlay.classList.contains('is-visible')) {
                overlay.remove();
            }
        }, 180);
    },

    resolveRiskCaseAfterRestore: async function (discount = {}, resolution = '') {
        const context = this.buildRiskRestoreCaseContext(discount);
        const requestBody = {
            action: 'resolve',
            items: [{
                category_key: 'shop_risk',
                target_id: context.targetId,
                alert_type: context.alertType,
                title: context.title,
                reference_label: context.referenceLabel,
                reference_value: context.referenceValue,
                metadata: {
                    discount_code: context.discountCode,
                    restored_via: 'admin_discounts'
                }
            }],
            note: resolution,
            resolution,
            metadata: {
                alert_type: context.alertType,
                category: context.category,
                reference_label: context.referenceLabel,
                reference_value: context.referenceValue,
                signal_type: context.signalType,
                title: context.title,
                restored_via: 'admin_discounts'
            }
        };

        const response = await (window.AdminApi?.fetch || fetch)('/api/admin/settings/ops-alert-monitor-cases', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(requestBody)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || '同步关闭风险 case 失败');
        }

        return payload;
    },

    resolveRiskCasesAfterBatchRestore: async function (discounts = [], resolution = '') {
        const items = (Array.isArray(discounts) ? discounts : [])
            .filter((discount) => ['open', 'claimed'].includes(this.getRiskSummary(discount).case_status))
            .map((discount) => {
                const context = this.buildRiskRestoreCaseContext(discount);
                return {
                    category_key: 'shop_risk',
                    target_id: context.targetId,
                    alert_type: context.alertType,
                    title: context.title,
                    reference_label: context.referenceLabel,
                    reference_value: context.referenceValue,
                    metadata: {
                        discount_code: context.discountCode,
                        restored_via: 'admin_discounts_batch'
                    }
                };
            });

        if (!items.length) {
            return null;
        }

        const response = await (window.AdminApi?.fetch || fetch)('/api/admin/settings/ops-alert-monitor-cases', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                action: 'resolve',
                items,
                note: resolution,
                resolution,
                metadata: {
                    title: '批量恢复审批关闭风险 case',
                    restored_via: 'admin_discounts_batch'
                }
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || '批量同步关闭风险 case 失败');
        }

        return payload;
    },

    performBatchRestore: async function (discounts = [], options = {}) {
        const writableSite = this.safeText(options.writableSite);
        const resolution = this.safeText(options.resolution);
        const shouldResolveCases = options.shouldResolveCases === true;
        const operationSource = this.safeText(options.operationSource) || 'risk_restore_batch_modal';
        const batchRunId = this.safeText(options.batchRunId) || this.generateBatchRunId();
        const retryOfRunId = this.safeText(options.retryOfRunId);
        const candidates = Array.isArray(discounts) ? discounts : [];
        const restored = [];
        const failed = [];
        let caseSyncWarning = '';

        for (const discount of candidates) {
            try {
                await this.mutateDiscountsViaAdminApi({
                    action: 'toggle_status',
                    site: writableSite,
                    payload: {
                        id: discount.id,
                        isActive: true,
                        review_note: resolution,
                        risk_reviewed: true,
                        resolve_case_requested: shouldResolveCases,
                        operation_source: operationSource
                    }
                });
                restored.push(this.buildBatchRestoreItemRecord(discount));
            } catch (error) {
                failed.push(this.buildBatchRestoreItemRecord(discount, {
                    message: error.message || '未知错误',
                    retry_count: Number(options.retryCount || 0) || 0
                }));
            }
        }

        if (shouldResolveCases && restored.length > 0) {
            const restoredDiscounts = candidates.filter((discount) => restored.some((item) => item.id === this.safeText(discount.id)));
            try {
                await this.resolveRiskCasesAfterBatchRestore(restoredDiscounts, resolution);
            } catch (caseError) {
                caseSyncWarning = caseError.message || '批量同步关闭风险 case 失败';
            }
        }

        return {
            run_id: batchRunId,
            batch_run_id: batchRunId,
            retry_of_run_id: retryOfRunId || null,
            generated_at: new Date().toISOString(),
            resolution,
            should_resolve_cases: shouldResolveCases,
            operation_source: operationSource,
            site: this.getReadSite(),
            status_filter: this.filters.status,
            search_filter: this.safeText(this.filters.search),
            total_attempted_count: candidates.length,
            restored,
            failed,
            case_sync_warning: caseSyncWarning
        };
    },

    recordBatchRestoreRun: async function (result = {}) {
        const payload = {
            batch_run_id: this.safeText(result.batch_run_id || result.run_id),
            retry_of_run_id: this.safeText(result.retry_of_run_id) || null,
            operation_source: this.safeText(result.operation_source),
            generated_at: this.safeText(result.generated_at) || new Date().toISOString(),
            site: this.safeText(result.site || this.getReadSite()),
            status_filter: this.safeText(result.status_filter || this.filters.status),
            search_filter: this.safeText(result.search_filter || this.filters.search),
            resolution: this.safeText(result.resolution),
            should_resolve_cases: result.should_resolve_cases === true,
            total_candidate_count: Math.max(0, Number.parseInt(result.total_candidate_count, 10) || 0),
            total_attempted_count: Math.max(0, Number.parseInt(result.total_attempted_count, 10) || 0),
            truncated_count: Math.max(0, Number.parseInt(result.truncated_count, 10) || 0),
            restored: Array.isArray(result.restored) ? result.restored : [],
            failed: Array.isArray(result.failed) ? result.failed : [],
            case_sync_warning: this.safeText(result.case_sync_warning) || null
        };

        const response = await this.recordBatchRestoreRunViaAdminApi(payload);
        if (response?.run && typeof response.run === 'object') {
            this.upsertBatchRestoreHistoryRun(response.run);
        }
        return response;
    },

    renderBatchRestoreResultModal: function (result = {}) {
        const restored = Array.isArray(result.restored) ? result.restored : [];
        const failed = Array.isArray(result.failed) ? result.failed : [];
        const activeFailed = failed.filter((item) => item.skipped !== true);
        const skippedFailed = failed.filter((item) => item.skipped === true);
        const caseSyncWarning = this.safeText(result.case_sync_warning);
        const truncatedCount = Math.max(0, Number(result.truncated_count || 0) || 0);
        const contextParts = [
            this.formatSiteLabel(result.site || this.getReadSite()),
            `筛选 ${this.formatDiscountStatusFilterLabel(result.status_filter || this.filters.status || 'all')}`
        ];
        const sourceLabel = this.formatBatchRestoreSourceLabel(result.operation_source);
        if (sourceLabel) {
            contextParts.push(sourceLabel);
        }
        if (this.safeText(result.search_filter)) {
            contextParts.push(`关键词 ${this.safeText(result.search_filter)}`);
        }

        return `
            <div class="admin-discount-restore-dialog admin-discount-restore-dialog--batch">
                <div class="admin-discount-restore-header">
                    <div>
                        <div class="admin-discount-restore-header__eyebrow">批量恢复结果</div>
                        <h3 class="admin-discount-restore-header__title">批量恢复结果</h3>
                        <p class="admin-discount-restore-header__summary">本次批量恢复已执行完成。可以继续重试失败项，或将暂不处理的失败项从本次结果里跳过。</p>
                    </div>
                    <div class="admin-discount-restore-header__actions">
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-copy-batch-restore-result-summary">复制结果摘要</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-export-batch-restore-result-summary">导出结果摘要</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-copy-batch-restore-failed-summary"
                            ${activeFailed.length || skippedFailed.length ? '' : 'disabled'}>复制失败项</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-export-batch-restore-failed-summary"
                            ${activeFailed.length || skippedFailed.length ? '' : 'disabled'}>导出失败项</button>
                        <button type="button"
                            class="admin-discount-restore-close"
                            data-admin-action="discounts-close-batch-restore-result-modal"
                            aria-label="关闭">&times;</button>
                    </div>
                </div>

                <div class="admin-discount-restore-grid">
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">成功恢复</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(String(restored.length))} 张</div>
                        <div class="admin-discount-restore-card__meta">已重新启用的优惠券</div>
                    </div>
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">待重试失败项</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(String(activeFailed.length))} 张</div>
                        <div class="admin-discount-restore-card__meta">${skippedFailed.length > 0 ? `另有 ${this.escapeHtml(String(skippedFailed.length))} 张已跳过` : '当前没有被手动跳过的失败项'}</div>
                    </div>
                    <div class="admin-discount-restore-card">
                        <div class="admin-discount-restore-card__label">执行上下文</div>
                        <div class="admin-discount-restore-card__value">${this.escapeHtml(this.formatDate(result.generated_at, { includeTime: true }) || '未知时间')}</div>
                        <div class="admin-discount-restore-card__meta">${this.escapeHtml(contextParts.join(' · '))}</div>
                    </div>
                </div>

                <div class="admin-discount-restore-callout">
                    <div class="admin-discount-restore-callout__title">处理结论</div>
                    <div class="admin-discount-restore-callout__summary">${this.escapeHtml(this.safeText(result.resolution) || '未记录结论')}</div>
                </div>

                ${truncatedCount > 0 ? `
                    <div class="admin-discount-restore-callout">
                        <div class="admin-discount-restore-callout__title">未处理项</div>
                        <div class="admin-discount-restore-callout__summary">本次仅处理了前 20 张候选优惠券，仍有 ${this.escapeHtml(String(truncatedCount))} 张未纳入本轮批量恢复。</div>
                    </div>
                ` : ''}

                ${caseSyncWarning ? `
                    <div class="admin-discount-restore-callout admin-discount-restore-callout--warning">
                        <div class="admin-discount-restore-callout__title">Case 同步提醒</div>
                        <div class="admin-discount-restore-callout__summary">${this.escapeHtml(caseSyncWarning)}</div>
                    </div>
                ` : ''}

                <section class="admin-discount-batch-result-section">
                    <div class="admin-discount-batch-result-section__head">
                        <div class="admin-discount-batch-result-section__title">成功恢复</div>
                    </div>
                    <div class="admin-discount-detail-chip-row">
                        ${restored.length
                            ? restored.map((item) => `
                                <span class="admin-discount-detail-chip admin-discount-detail-chip--success">${this.escapeHtml(item.code)}</span>
                            `).join('')
                            : '<span class="admin-discount-detail-chip">无</span>'}
                    </div>
                </section>

                <section class="admin-discount-batch-result-section">
                    <div class="admin-discount-batch-result-section__head">
                        <div class="admin-discount-batch-result-section__title">失败项</div>
                        <div class="admin-discount-batch-result-section__actions">
                            <button type="button"
                                class="admin-discount-detail-inline-btn"
                                data-admin-action="discounts-retry-batch-restore-failures"
                                ${activeFailed.length ? '' : 'disabled'}>重试失败项</button>
                        </div>
                    </div>
                    ${activeFailed.length ? `
                        <div class="admin-discount-detail-list">
                            ${activeFailed.map((item) => `
                                <div class="admin-discount-detail-list-item">
                                    <div class="admin-discount-detail-list-item__head">
                                        <div>
                                            <div class="admin-discount-detail-list-item__title">${this.escapeHtml(item.code)}</div>
                                            <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(item.message || '未知错误')}</div>
                                        </div>
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="discounts-skip-batch-restore-item"
                                            data-discount-id="${this.escapeHtml(item.id)}">跳过</button>
                                    </div>
                                    <div class="admin-discount-detail-chip-row">
                                        ${item.signal_type ? `<span class="admin-discount-detail-chip">${this.escapeHtml(this.formatWorkbenchSignalLabel(item.signal_type) || item.signal_type)}</span>` : ''}
                                        ${Number.isFinite(Number(item.risk_score)) ? `<span class="admin-discount-detail-chip">风险分 ${this.escapeHtml(String(item.risk_score))}</span>` : ''}
                                        ${item.case_status ? `<span class="admin-discount-detail-chip">${this.escapeHtml(this.formatCaseStatusLabel(item.case_status) || item.case_status)}</span>` : ''}
                                        ${item.retry_count > 0 ? `<span class="admin-discount-detail-chip">已重试 ${this.escapeHtml(String(item.retry_count))} 次</span>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="admin-discount-detail-empty">当前没有待重试的失败项。</div>'}
                </section>

                ${skippedFailed.length ? `
                    <section class="admin-discount-batch-result-section">
                        <div class="admin-discount-batch-result-section__head">
                            <div class="admin-discount-batch-result-section__title">已跳过失败项</div>
                        </div>
                        <div class="admin-discount-detail-chip-row">
                            ${skippedFailed.map((item) => `
                                <span class="admin-discount-detail-chip">${this.escapeHtml(item.code)}</span>
                            `).join('')}
                        </div>
                    </section>
                ` : ''}

                <div class="admin-discount-restore-actions">
                    <button type="button"
                        class="admin-discount-restore-btn admin-discount-restore-btn--ghost"
                        data-admin-action="discounts-close-batch-restore-result-modal">关闭</button>
                </div>
            </div>
        `;
    },

    renderBatchRestoreHistoryModal: function (state = this.batchRestoreHistoryState) {
        const safeState = state && typeof state === 'object' && !Array.isArray(state)
            ? state
            : { loading: false, error: '', runs: [] };
        const runs = Array.isArray(safeState.runs) ? safeState.runs : [];
        const filteredRuns = this.getFilteredBatchRestoreHistoryRuns(runs);
        const summary = this.getBatchRestoreHistorySummary(runs);
        const activeFilter = this.normalizeBatchRestoreHistoryFilter(this.batchRestoreHistoryView?.status);

        let bodyMarkup = '';
        if (safeState.loading) {
            bodyMarkup = '<div class="admin-discount-detail-empty">正在加载批量恢复历史...</div>';
        } else if (this.safeText(safeState.error)) {
            bodyMarkup = `<div class="admin-discount-detail-empty">加载失败：${this.escapeHtml(this.safeText(safeState.error))}</div>`;
        } else if (!runs.length) {
            bodyMarkup = '<div class="admin-discount-detail-empty">最近还没有批量恢复记录。</div>';
        } else {
            bodyMarkup = `
                <div class="admin-discount-history-summary-grid">
                    <div class="admin-discount-detail-summary-card">
                        <div class="admin-discount-detail-summary-card__label">总跑次</div>
                        <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(summary.total))}</div>
                    </div>
                    <div class="admin-discount-detail-summary-card">
                        <div class="admin-discount-detail-summary-card__label">成功跑次</div>
                        <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(summary.success))}</div>
                    </div>
                    <div class="admin-discount-detail-summary-card">
                        <div class="admin-discount-detail-summary-card__label">带失败跑次</div>
                        <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(summary.failed))}</div>
                    </div>
                    <div class="admin-discount-detail-summary-card">
                        <div class="admin-discount-detail-summary-card__label">重试跑次</div>
                        <div class="admin-discount-detail-summary-card__value">${this.escapeHtml(String(summary.retry))}</div>
                    </div>
                </div>
                <div class="admin-discount-history-toolbar">
                    <div class="search-bar admin-discount-history-search">
                        <i class="fas fa-search"></i>
                        <input type="text"
                            id="discountBatchHistorySearchInput"
                            value="${this.escapeHtml(this.safeText(this.batchRestoreHistoryView?.search))}"
                            placeholder="搜索跑次号、执行人、优惠码或复核结论..."
                            data-admin-input-action="discounts-search-batch-history">
                    </div>
                    <div class="admin-discount-history-filters">
                        ${[
                            { key: 'all', label: '全部', count: summary.total },
                            { key: 'success', label: '成功', count: summary.success },
                            { key: 'failed', label: '失败', count: summary.failed },
                            { key: 'retry', label: '重试', count: summary.retry }
                        ].map((item) => `
                            <button type="button"
                                class="admin-discount-history-filter${activeFilter === item.key ? ' is-active' : ''}"
                                data-admin-action="discounts-set-batch-history-filter"
                                data-discount-history-filter="${this.escapeHtml(item.key)}">
                                <span>${this.escapeHtml(item.label)}</span>
                                <strong>${this.escapeHtml(String(item.count))}</strong>
                            </button>
                        `).join('')}
                    </div>
                </div>
                <div class="admin-discount-detail-list">
                    ${filteredRuns.length ? filteredRuns.map((run) => {
                        const restored = Array.isArray(run.restored) ? run.restored : [];
                        const failed = Array.isArray(run.failed) ? run.failed : [];
                        const activeFailed = failed.filter((item) => item.skipped !== true);
                        const skippedFailed = failed.filter((item) => item.skipped === true);
                        const retryLabel = this.safeText(run.retry_of_run_id)
                            ? `重试自跑次 ${this.escapeHtml(this.safeText(run.retry_of_run_id).slice(0, 8))}`
                            : '';
                        const sourceLabel = this.formatBatchRestoreSourceLabel(run.operation_source);

                        return `
                            <div class="admin-discount-detail-list-item">
                                <div class="admin-discount-detail-list-item__head">
                                    <div>
                                        <div class="admin-discount-detail-list-item__title">批量恢复跑次 ${this.escapeHtml(this.safeText(run.run_id).slice(0, 8) || '未命名')}</div>
                                        <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(this.formatDate(run.generated_at, { includeTime: true }) || '未知时间')}${retryLabel ? ` · ${retryLabel}` : ''}</div>
                                    </div>
                                    <div class="admin-discount-detail-inline-actions">
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="discounts-open-history-run-detail"
                                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}">查看详情</button>
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="discounts-copy-history-run-summary"
                                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}">复制摘要</button>
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="discounts-export-history-run-summary"
                                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}">导出摘要</button>
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="discounts-copy-history-run-failed-summary"
                                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}"
                                            ${activeFailed.length || skippedFailed.length ? '' : 'disabled'}>复制失败项</button>
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="discounts-export-history-run-failed-summary"
                                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}"
                                            ${activeFailed.length || skippedFailed.length ? '' : 'disabled'}>导出失败项</button>
                                    </div>
                                </div>
                                <div class="admin-discount-detail-chip-row">
                                    <span class="admin-discount-detail-chip admin-discount-detail-chip--success">成功 ${this.escapeHtml(String(restored.length))}</span>
                                    <span class="admin-discount-detail-chip admin-discount-detail-chip--risk">失败 ${this.escapeHtml(String(activeFailed.length))}</span>
                                    ${skippedFailed.length ? `<span class="admin-discount-detail-chip">跳过 ${this.escapeHtml(String(skippedFailed.length))}</span>` : ''}
                                    ${Number(run.truncated_count || 0) > 0 ? `<span class="admin-discount-detail-chip">未处理 ${this.escapeHtml(String(run.truncated_count))}</span>` : ''}
                                    <span class="admin-discount-detail-chip">${this.escapeHtml(this.formatSiteLabel(run.site))}</span>
                                    <span class="admin-discount-detail-chip">筛选 ${this.escapeHtml(this.formatDiscountStatusFilterLabel(run.status_filter || 'all'))}</span>
                                    ${sourceLabel ? `<span class="admin-discount-detail-chip">${this.escapeHtml(sourceLabel)}</span>` : ''}
                                    ${this.safeText(run.search_filter) ? `<span class="admin-discount-detail-chip">关键词 ${this.escapeHtml(this.safeText(run.search_filter))}</span>` : ''}
                                    ${this.safeText(run.actor_label) ? `<span class="admin-discount-detail-chip">执行人 ${this.escapeHtml(run.actor_label)}</span>` : ''}
                                </div>
                                <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(this.safeText(run.resolution) || '未记录复核结论')}</div>
                            </div>
                        `;
                    }).join('') : '<div class="admin-discount-detail-empty">当前筛选条件下没有批量恢复记录。</div>'}
                </div>
            `;
        }

        return `
            <div class="admin-discount-restore-dialog admin-discount-restore-dialog--batch admin-discount-restore-dialog--history">
                <div class="admin-discount-restore-header">
                    <div>
                        <div class="admin-discount-restore-header__eyebrow">恢复历史</div>
                        <h3 class="admin-discount-restore-header__title">批量恢复历史</h3>
                        <p class="admin-discount-restore-header__summary">这里会保留最近的批量恢复跑次，可用于值班交接和复盘导出。</p>
                    </div>
                    <div class="admin-discount-restore-header__actions">
                        <button type="button"
                            class="admin-discount-detail-inline-btn modal-action-btn admin-discount-restore-toolbar-btn"
                            data-admin-action="discounts-refresh-batch-restore-history">刷新</button>
                        <button type="button"
                            class="admin-discount-restore-close modal-close-btn"
                            data-admin-action="discounts-close-batch-restore-history-modal"
                            aria-label="关闭">&times;</button>
                    </div>
                </div>
                <div class="admin-discount-restore-dialog__body admin-discount-restore-dialog__body--history">
                    ${bodyMarkup}
                </div>
            </div>
        `;
    },

    renderBatchRestoreHistoryRunDetailModal: function (run = {}) {
        const restored = Array.isArray(run.restored) ? run.restored : [];
        const failed = Array.isArray(run.failed) ? run.failed : [];
        const activeFailed = failed.filter((item) => item.skipped !== true);
        const skippedFailed = failed.filter((item) => item.skipped === true);
        const sourceLabel = this.formatBatchRestoreSourceLabel(run.operation_source);
        const contextMeta = [
            this.formatSiteLabel(run.site),
            `筛选 ${this.formatDiscountStatusFilterLabel(run.status_filter || 'all')}`
        ];
        if (sourceLabel) {
            contextMeta.push(sourceLabel);
        }
        if (this.safeText(run.search_filter)) {
            contextMeta.push(`关键词 ${this.safeText(run.search_filter)}`);
        }
        if (this.safeText(run.actor_label)) {
            contextMeta.push(this.safeText(run.actor_label));
        }
        const renderRunItems = (items = [], options = {}) => {
            if (!items.length) {
                return '<div class="admin-discount-detail-empty">无</div>';
            }

            return `
                <div class="admin-discount-detail-list">
                    ${items.map((item) => `
                        <div class="admin-discount-detail-list-item">
                            <div class="admin-discount-detail-list-item__head">
                                <div>
                                    <div class="admin-discount-detail-list-item__title">${this.escapeHtml(this.safeText(item.code).toUpperCase() || '未知优惠码')}</div>
                                    <div class="admin-discount-detail-list-item__meta">${this.escapeHtml(this.safeText(item.message) || (options.defaultMessage || '无额外说明'))}</div>
                                </div>
                                <div class="admin-discount-detail-inline-actions">
                                    <button type="button"
                                        class="admin-discount-detail-inline-btn"
                                        data-admin-action="discounts-open-detail-by-reference"
                                        data-discount-id="${this.escapeHtml(this.safeText(item.id))}"
                                        data-discount-code="${this.escapeHtml(this.safeText(item.code).toUpperCase())}">查看优惠券</button>
                                    ${options.retryable === true ? `
                                        <button type="button"
                                            class="admin-discount-detail-inline-btn"
                                            data-admin-action="discounts-retry-history-run-item"
                                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}"
                                            data-discount-id="${this.escapeHtml(this.safeText(item.id))}">重试此券</button>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="admin-discount-detail-chip-row">
                                ${item.signal_type ? `<span class="admin-discount-detail-chip">${this.escapeHtml(this.formatWorkbenchSignalLabel(item.signal_type) || item.signal_type)}</span>` : ''}
                                ${Number.isFinite(Number(item.risk_score)) ? `<span class="admin-discount-detail-chip">风险分 ${this.escapeHtml(String(item.risk_score))}</span>` : ''}
                                ${this.safeText(item.case_status) ? `<span class="admin-discount-detail-chip">${this.escapeHtml(this.formatCaseStatusLabel(item.case_status) || item.case_status)}</span>` : ''}
                                ${Number(item.retry_count || 0) > 0 ? `<span class="admin-discount-detail-chip">已重试 ${this.escapeHtml(String(item.retry_count))} 次</span>` : ''}
                                ${item.skipped === true ? '<span class="admin-discount-detail-chip">已跳过</span>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        };

        return `
            <div class="admin-discount-restore-dialog admin-discount-restore-dialog--batch admin-discount-restore-dialog--detail">
                <div class="admin-discount-restore-header">
                    <div>
                        <div class="admin-discount-restore-header__eyebrow">跑次详情</div>
                        <h3 class="admin-discount-restore-header__title">跑次 ${this.escapeHtml(this.safeText(run.run_id).slice(0, 8) || '未命名')}</h3>
                        <p class="admin-discount-restore-header__summary">${this.escapeHtml(this.safeText(run.resolution) || '未记录复核结论')}</p>
                    </div>
                    <div class="admin-discount-restore-header__actions">
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-copy-history-run-summary"
                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}">复制摘要</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-export-history-run-summary"
                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}">导出摘要</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-copy-history-run-failed-summary"
                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}"
                            ${activeFailed.length || skippedFailed.length ? '' : 'disabled'}>复制失败项</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-export-history-run-failed-summary"
                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}"
                            ${activeFailed.length || skippedFailed.length ? '' : 'disabled'}>导出失败项</button>
                        <button type="button"
                            class="admin-discount-detail-inline-btn"
                            data-admin-action="discounts-retry-history-run"
                            data-discount-batch-run-id="${this.escapeHtml(run.run_id)}"
                            ${activeFailed.length ? '' : 'disabled'}>重试失败项</button>
                        <button type="button"
                            class="admin-discount-restore-close modal-close-btn"
                            data-admin-action="discounts-close-history-run-detail"
                            aria-label="关闭">&times;</button>
                    </div>
                </div>
                <div class="admin-discount-restore-dialog__body admin-discount-restore-dialog__body--detail">
                    <div class="admin-discount-restore-grid">
                        <div class="admin-discount-restore-card">
                            <div class="admin-discount-restore-card__label">成功恢复</div>
                            <div class="admin-discount-restore-card__value">${this.escapeHtml(String(restored.length))} 张</div>
                            <div class="admin-discount-restore-card__meta">恢复成功的优惠券</div>
                        </div>
                        <div class="admin-discount-restore-card">
                            <div class="admin-discount-restore-card__label">失败待重试</div>
                            <div class="admin-discount-restore-card__value">${this.escapeHtml(String(activeFailed.length))} 张</div>
                            <div class="admin-discount-restore-card__meta">${skippedFailed.length ? `另有 ${this.escapeHtml(String(skippedFailed.length))} 张已跳过` : '当前没有被跳过的失败项'}</div>
                        </div>
                        <div class="admin-discount-restore-card">
                            <div class="admin-discount-restore-card__label">执行上下文</div>
                            <div class="admin-discount-restore-card__value">${this.escapeHtml(this.formatDate(run.generated_at, { includeTime: true }) || '未知时间')}</div>
                            <div class="admin-discount-restore-card__meta">${this.escapeHtml(contextMeta.join(' · '))}</div>
                        </div>
                    </div>

                    ${this.safeText(run.case_sync_warning) ? `
                        <div class="admin-discount-restore-callout admin-discount-restore-callout--warning">
                            <div class="admin-discount-restore-callout__title">Case 同步提醒</div>
                            <div class="admin-discount-restore-callout__summary">${this.escapeHtml(this.safeText(run.case_sync_warning))}</div>
                        </div>
                    ` : ''}

                    <section class="admin-discount-batch-result-section">
                        <div class="admin-discount-batch-result-section__head">
                            <div class="admin-discount-batch-result-section__title">成功恢复</div>
                        </div>
                        ${renderRunItems(restored, { defaultMessage: '已恢复启用' })}
                    </section>

                    <section class="admin-discount-batch-result-section">
                        <div class="admin-discount-batch-result-section__head">
                            <div class="admin-discount-batch-result-section__title">失败待重试</div>
                        </div>
                        ${renderRunItems(activeFailed, { defaultMessage: '恢复失败', retryable: true })}
                    </section>

                    ${skippedFailed.length ? `
                        <section class="admin-discount-batch-result-section">
                            <div class="admin-discount-batch-result-section__head">
                                <div class="admin-discount-batch-result-section__title">已跳过失败项</div>
                            </div>
                            ${renderRunItems(skippedFailed, { defaultMessage: '已跳过' })}
                        </section>
                    ` : ''}
                </div>
            </div>
        `;
    },

    submitRestoreModal: async function () {
        const discount = this.getDiscountById(this.restoreModalDiscountId);
        if (!discount) {
            alert('未找到要恢复的优惠券');
            return;
        }

        const writableSite = this.requireWritableSite({ label: '启用折扣码' });
        if (!writableSite) {
            return;
        }

        const reviewedInput = document.getElementById('discountRestoreReviewed');
        const resolveCaseInput = document.getElementById('discountRestoreResolveCase');
        const resolutionInput = document.getElementById('discountRestoreResolution');
        const reviewed = !!reviewedInput?.checked;
        const shouldResolveCase = !!resolveCaseInput?.checked;
        const resolution = this.safeText(resolutionInput?.value);

        if (!reviewed) {
            alert('请先确认已经完成风险复核');
            return;
        }

        if (!resolution) {
            alert('请填写复核结论');
            resolutionInput?.focus();
            return;
        }

        const submitButton = document.querySelector('[data-admin-action="discounts-submit-restore-modal"]');
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
            submitButton.textContent = '恢复中...';
        }

        let caseSyncWarning = '';
        try {
            await this.mutateDiscountsViaAdminApi({
                action: 'toggle_status',
                site: writableSite,
                payload: {
                    id: discount.id,
                    isActive: true,
                    review_note: resolution,
                    risk_reviewed: true,
                    resolve_case_requested: shouldResolveCase,
                    operation_source: 'risk_restore_modal'
                }
            });

            if (shouldResolveCase) {
                try {
                    await this.resolveRiskCaseAfterRestore(discount, resolution);
                } catch (caseError) {
                    caseSyncWarning = caseError.message || '同步关闭风险 case 失败';
                }
            }

            this.closeRestoreModal();
            if (this.activeDetailId === this.safeText(discount.id)) {
                this.closeDetailModal();
            }
            await this.loadDiscounts();
            const successMessage = caseSyncWarning
                ? `已恢复优惠码 ${this.safeText(discount.code).toUpperCase()}，但未能同步关闭风险 case：${caseSyncWarning}`
                : `已恢复优惠码 ${this.safeText(discount.code).toUpperCase()}`;
            alert(successMessage);
            this.emitCommandFeedback(successMessage, caseSyncWarning ? 'partial' : 'saved', { source: 'discounts-restore' });
        } catch (err) {
            const failureMessage = `恢复失败: ${err.message || '未知错误'}`;
            alert(failureMessage);
            this.emitCommandFeedback(failureMessage, 'failed', { source: 'discounts-restore' });
        } finally {
            if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
                submitButton.textContent = '确认恢复启用';
            }
        }
    },

    submitBatchRestoreModal: async function () {
        const writableSite = this.requireWritableSite({ label: '批量恢复折扣码' });
        if (!writableSite) {
            return;
        }

        const candidates = this.getBatchRestoreCandidates();
        if (!candidates.length) {
            alert('当前筛选结果里没有可批量恢复审批的优惠券');
            return;
        }

        const reviewed = !!document.getElementById('discountBatchRestoreReviewed')?.checked;
        const shouldResolveCases = !!document.getElementById('discountBatchRestoreResolveCases')?.checked;
        const resolution = this.safeText(document.getElementById('discountBatchRestoreResolution')?.value);
        const maxBatchSize = 20;
        const processCandidates = candidates.slice(0, maxBatchSize);

        if (!reviewed) {
            alert('请先确认已经完成本批次风险复核');
            return;
        }

        if (!resolution) {
            alert('请填写批量复核结论');
            document.getElementById('discountBatchRestoreResolution')?.focus();
            return;
        }

        const submitButton = document.querySelector('[data-admin-action="discounts-submit-batch-restore-modal"]');
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
            submitButton.textContent = '批量恢复中...';
        }

        try {
            const batchRunId = this.generateBatchRunId();
            const result = await this.performBatchRestore(processCandidates, {
                writableSite,
                resolution,
                shouldResolveCases,
                operationSource: 'risk_restore_batch_modal',
                batchRunId
            });
            this.closeBatchRestoreModal();
            await this.loadDiscounts();
            const mergedResult = {
                ...result,
                site: this.getReadSite(),
                status_filter: this.filters.status,
                search_filter: this.safeText(this.filters.search),
                total_candidate_count: candidates.length,
                truncated_count: Math.max(0, candidates.length - processCandidates.length)
            };

            if (!mergedResult.restored.length && !mergedResult.failed.length) {
                throw new Error('没有任何优惠券进入批量恢复流程');
            }

            try {
                await this.recordBatchRestoreRun(mergedResult);
            } catch (recordError) {
                mergedResult.case_sync_warning = mergedResult.case_sync_warning
                    ? `${mergedResult.case_sync_warning}；历史归档失败：${recordError.message || '未知错误'}`
                    : `历史归档失败：${recordError.message || '未知错误'}`;
            }

            this.openBatchRestoreResultModal(mergedResult);
            const restoredCount = Array.isArray(mergedResult.restored) ? mergedResult.restored.length : 0;
            const failedCount = Array.isArray(mergedResult.failed) ? mergedResult.failed.length : 0;
            const truncatedCount = Math.max(0, Number(mergedResult.truncated_count || 0) || 0);
            const resultMessage = failedCount > 0 || truncatedCount > 0 || this.safeText(mergedResult.case_sync_warning)
                ? `批量恢复完成：成功 ${restoredCount} 张，待处理 ${failedCount + truncatedCount} 张`
                : `批量恢复完成：成功 ${restoredCount} 张`;
            this.emitCommandFeedback(
                resultMessage,
                failedCount > 0 || truncatedCount > 0 || this.safeText(mergedResult.case_sync_warning) ? 'partial' : 'saved',
                { source: 'discounts-batch' }
            );
        } catch (err) {
            const failureMessage = `批量恢复失败: ${err.message || '未知错误'}`;
            alert(failureMessage);
            this.emitCommandFeedback(failureMessage, 'failed', { source: 'discounts-batch' });
        } finally {
            if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
                submitButton.textContent = '确认批量恢复';
            }
        }
    },

    skipBatchRestoreResultItem: function (id = '') {
        const normalizedId = this.safeText(id);
        if (!this.batchRestoreResult || !normalizedId) {
            return;
        }

        this.batchRestoreResult = {
            ...this.batchRestoreResult,
            failed: (Array.isArray(this.batchRestoreResult.failed) ? this.batchRestoreResult.failed : []).map((item) => (
                this.safeText(item.id) === normalizedId
                    ? { ...item, skipped: true }
                    : item
            ))
        };
        this.rerenderBatchRestoreResultModal();
    },

    retryBatchRestoreFailures: async function () {
        if (!this.batchRestoreResult) {
            return;
        }

        const activeFailed = (Array.isArray(this.batchRestoreResult.failed) ? this.batchRestoreResult.failed : [])
            .filter((item) => item.skipped !== true);
        if (!activeFailed.length) {
            alert('当前没有可重试的失败项');
            return;
        }

        const writableSite = this.requireWritableSite({ label: '重试批量恢复折扣码' });
        if (!writableSite) {
            return;
        }

        const retryButton = document.querySelector('[data-admin-action="discounts-retry-batch-restore-failures"]');
        if (retryButton instanceof HTMLButtonElement) {
            retryButton.disabled = true;
            retryButton.textContent = '重试中...';
        }

        try {
            const retryCandidates = activeFailed
                .map((item) => this.getDiscountById(item.id))
                .filter(Boolean);

            if (!retryCandidates.length) {
                throw new Error('失败项已不在当前列表中，无法重试');
            }

            const retryRunId = this.generateBatchRunId();
            const result = await this.performBatchRestore(retryCandidates, {
                writableSite,
                resolution: this.safeText(this.batchRestoreResult.resolution),
                shouldResolveCases: this.batchRestoreResult.should_resolve_cases === true,
                operationSource: 'risk_restore_batch_retry',
                retryCount: 1,
                batchRunId: retryRunId,
                retryOfRunId: this.safeText(this.batchRestoreResult.run_id || this.batchRestoreResult.batch_run_id)
            });

            try {
                await this.recordBatchRestoreRun({
                    ...result,
                    total_candidate_count: retryCandidates.length,
                    truncated_count: 0
                });
            } catch (recordError) {
                result.case_sync_warning = result.case_sync_warning
                    ? `${result.case_sync_warning}；历史归档失败：${recordError.message || '未知错误'}`
                    : `历史归档失败：${recordError.message || '未知错误'}`;
            }

            const previousFailed = Array.isArray(this.batchRestoreResult.failed) ? this.batchRestoreResult.failed : [];
            const skippedFailed = previousFailed.filter((item) => item.skipped === true);
            const nextFailed = result.failed.map((item) => {
                const previous = previousFailed.find((candidate) => this.safeText(candidate.id) === this.safeText(item.id));
                return {
                    ...item,
                    retry_count: Math.max(1, Number(previous?.retry_count || 0) + 1)
                };
            });

            this.batchRestoreResult = {
                ...this.batchRestoreResult,
                run_id: this.safeText(result.run_id || result.batch_run_id) || this.safeText(this.batchRestoreResult.run_id),
                generated_at: new Date().toISOString(),
                restored: [
                    ...(Array.isArray(this.batchRestoreResult.restored) ? this.batchRestoreResult.restored : []),
                    ...result.restored
                ],
                failed: [...nextFailed, ...skippedFailed],
                case_sync_warning: result.case_sync_warning || this.batchRestoreResult.case_sync_warning || ''
            };
            await this.loadDiscounts();
            this.rerenderBatchRestoreResultModal();
            const successMessage = result.restored.length
                ? `已重试 ${result.restored.length} 张失败项`
                : '失败项重试完成';
            this.showFeedbackToast(successMessage);
            this.emitCommandFeedback(
                result.failed.length
                    ? `${successMessage}，仍有 ${result.failed.length} 张失败`
                    : successMessage,
                result.failed.length ? 'partial' : 'saved',
                { source: 'discounts-retry' }
            );
        } catch (error) {
            const failureMessage = `重试失败项时出错: ${error.message || '未知错误'}`;
            alert(failureMessage);
            this.emitCommandFeedback(failureMessage, 'failed', { source: 'discounts-retry' });
        } finally {
            if (retryButton instanceof HTMLButtonElement) {
                retryButton.disabled = false;
                retryButton.textContent = '重试失败项';
            }
        }
    },

    openRelatedOrder: async function (orderId = '') {
        const normalizedOrderId = this.safeText(orderId);
        if (!normalizedOrderId) {
            return;
        }

        this.closeDetailModal();

        if (typeof window.openAdminWorkbenchEntry === 'function') {
            await window.openAdminWorkbenchEntry('shop-risk-orders', {
                orderId: normalizedOrderId,
                referenceLabel: '订单号',
                referenceValue: `SHOP_ORDER_${normalizedOrderId}`,
                targetId: normalizedOrderId
            });
            return;
        }

        window.switchModule?.('shop');
        setTimeout(() => {
            const query = `SHOP_ORDER_${normalizedOrderId}`;
            const input = document.getElementById('orderSearchInput');
            if (input) {
                input.value = query;
            }
            window.ShopAdmin?.searchOrders?.(1, {
                queryOverride: query,
                focusOrderId: normalizedOrderId,
                openDetails: true
            });
        }, 0);
    },

    openEditFromDetail: async function (id = '') {
        this.closeDetailModal();
        await this.openEditModal(id);
    },

    getDiscountUsageMarkup: function (discount) {
        const totalLimit = Number.parseInt(discount.max_uses, 10);
        const perUserLimit = Number.parseInt(discount.max_uses_per_user, 10);
        const usedCount = Math.max(0, Number.parseInt(discount.used_count, 10) || 0);
        const usageSummary = this.getRecentUsageSummary(discount);
        const assetSummary = this.getAssetSummary(discount);
        const riskSummary = this.getRiskSummary(discount);
        const usageParts = [
            `<div class="admin-discount-usage-meta">已用: <span class="admin-discount-usage-count">${usedCount}</span> / ${totalLimit > 0 ? totalLimit : '∞'}</div>`
        ];

        usageParts.push(
            totalLimit > 0
                ? `<div class="admin-discount-expiry-meta">剩余可用 ${Math.max(0, totalLimit - usedCount)} 次</div>`
                : '<div class="admin-discount-expiry-meta">总次数不限</div>'
        );

        if (perUserLimit > 0) {
            usageParts.push(`<div class="admin-discount-expiry-meta">每人最多 ${perUserLimit} 次</div>`);
        } else {
            usageParts.push('<div class="admin-discount-expiry-meta">每人不限次数</div>');
        }

        if (usageSummary.recent_order_count > 0) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta">近 ${usageSummary.window_days} 天 ${usageSummary.recent_order_count} 单 / ${usageSummary.recent_distinct_user_count} 人</div>`
            );
        } else {
            usageParts.push(`<div class="admin-discount-expiry-meta">近 ${usageSummary.window_days} 天无新增使用</div>`);
        }

        if (usageSummary.recent_refund_count > 0) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta">退款回滚 ${usageSummary.recent_refund_count} 单，净核销 ${usageSummary.recent_net_order_count} 单</div>`
            );
        }

        if (usageSummary.recent_discount_cost_gross > 0 || usageSummary.recent_discount_cost_net > 0) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta">让利毛 / 净: ${this.escapeHtml(String(usageSummary.recent_discount_cost_gross))} / ${this.escapeHtml(String(usageSummary.recent_discount_cost_net))}</div>`
            );
        }

        if (usageSummary.recent_revenue_gross > 0 || usageSummary.recent_revenue_net > 0) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta">营收毛 / 净: ${this.escapeHtml(String(usageSummary.recent_revenue_gross))} / ${this.escapeHtml(String(usageSummary.recent_revenue_net))}</div>`
            );
        }

        if (usageSummary.new_customer_order_count > 0) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta">近 ${usageSummary.window_days} 天首单转化 ${this.escapeHtml(String(usageSummary.new_customer_order_count))} 单</div>`
            );
        }

        if (usageSummary.recent_zero_total_count > 0) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta admin-discount-expiry-meta--risk">近 ${usageSummary.window_days} 天 0 价订单 ${usageSummary.recent_zero_total_count} 笔</div>`
            );
        }

        if (assetSummary.issued_count > 0) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta">卡券发放 ${this.escapeHtml(String(assetSummary.issued_count))} 张，在库 ${this.escapeHtml(String(assetSummary.available_count))} 张</div>`
            );
        }

        if (usageSummary.top_product_names.length) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta">最近命中: ${this.escapeHtml(usageSummary.top_product_names.join('、'))}</div>`
            );
        }

        const riskHeadlineText = this.buildRiskHeadlineText(riskSummary);
        if (riskHeadlineText) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta admin-discount-expiry-meta--risk">${riskHeadlineText}</div>`
            );
        }

        const riskActionText = this.buildRiskActionText(riskSummary);
        if (riskActionText) {
            usageParts.push(
                `<div class="admin-discount-expiry-meta admin-discount-expiry-meta--risk-soft">${riskActionText}</div>`
            );
        }

        return usageParts.join('');
    },

    getDiscountPolicyMarkup: function (discount) {
        const policyLines = [];
        const applicableSite = this.normalizeDiscountSite(discount.applicable_site, 'all');
        const scopeType = this.normalizeScopeType(discount.scope_type);
        const distributionMode = this.safeText(discount.distribution_mode).toLowerCase() || 'general_code';

        policyLines.push(
            `<div class="admin-discount-expiry-meta"><i class="fas fa-earth-asia"></i> 站点: ${this.escapeHtml(this.formatSiteLabel(applicableSite, { includeScopeSuffix: false }))}</div>`
        );

        policyLines.push(
            `<div class="admin-discount-expiry-meta"><i class="fas fa-wallet"></i> 发放: ${this.escapeHtml(this.formatDistributionModeLabel(distributionMode))}</div>`
        );

        if (scopeType === 'category') {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-layer-group"></i> 分类: ${this.escapeHtml(this.getCategoryLabel(discount.scope_category))}</div>`
            );
        } else if (scopeType === 'product') {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-box-open"></i> 商品: ${this.escapeHtml(this.getProductLabel(discount.scope_product_id))}</div>`
            );
        } else {
            policyLines.push('<div class="admin-discount-expiry-meta"><i class="fas fa-tags"></i> 范围: 全部商品</div>');
        }

        if (discount.allow_zero_total) {
            policyLines.push('<div><span class="status-badge active"><i class="fas fa-unlock"></i> 允许全免</span></div>');
        } else {
            policyLines.push('<div><span class="admin-discount-status-muted"><i class="fas fa-shield-alt"></i> 禁止全免</span></div>');
        }

        if (this.safeText(discount.starts_at)) {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-hourglass-start"></i> 生效: ${this.escapeHtml(this.formatDate(discount.starts_at, { includeTime: true }) || '—')}</div>`
            );
        }

        if (distributionMode === 'public_claim') {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-gift"></i> 领取窗: ${this.escapeHtml(this.formatDate(discount.claim_starts_at, { includeTime: true }) || '立即')} - ${this.escapeHtml(this.formatDate(discount.claim_expires_at, { includeTime: true }) || '长期')}</div>`
            );
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-hand-pointer"></i> 每人领取: ${Number(discount.claim_limit_per_user || 0) > 0 ? `${this.escapeHtml(String(discount.claim_limit_per_user))} 次` : '不限'}</div>`
            );
        }

        if (this.safeText(discount.campaign_tag)) {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-bullhorn"></i> 渠道: ${this.escapeHtml(this.safeText(discount.campaign_tag))}</div>`
            );
        }

        if (this.safeText(discount.audience_segment)) {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-user-group"></i> 人群: ${this.escapeHtml(this.safeText(discount.audience_segment))}</div>`
            );
        }

        policyLines.push(
            `<div class="admin-discount-expiry-meta"><i class="fas fa-layer-group"></i> 叠加: ${this.escapeHtml(this.formatStackingModeLabel(discount))} · ${this.escapeHtml(this.formatPricingApplyStageLabel(discount.pricing_apply_stage))}</div>`
        );
        policyLines.push(
            `<div class="admin-discount-expiry-meta"><i class="fas fa-arrow-down-9-1"></i> 优先级: ${this.escapeHtml(String(Math.max(1, Number.parseInt(discount.stack_priority, 10) || 100)))}</div>`
        );

        policyLines.push(
            `<div class="admin-discount-expiry-meta"><i class="fas fa-life-ring"></i> 恢复: ${this.escapeHtml(this.formatRecoveryStrategyLabel(discount.recovery_strategy))}</div>`
        );

        return `<div class="admin-discount-status-stack">${policyLines.join('')}</div>`;
    },

    activate: async function (context = {}, options = {}) {
        console.log('🎟️ Initializing Discounts Module...');
        this.bindStaticControls();
        void this.ensureRestrictionOptionsLoaded();
        const shouldReload = this.shouldReloadListOnActivate({
            force: options?.force === true
        });
        this.moduleInitialized = true;

        if (!shouldReload) {
            this.renderScopeHint({ status: 'ready', scopeSummary: this.scopeSummary });
            this.render();
            return true;
        }

        await this.loadDiscounts({
            force: options?.force === true,
            showLoading: !this.discounts.length || this.lastListSite !== this.getReadSite()
        });
        return true;
    },

    handleShellContext: async function (context = {}, options = {}) {
        const searchValue = this.resolveShellDiscountSearchValue(context);
        this.showWorkbenchContext(this.buildShellWorkbenchContext(context));

        if (searchValue) {
            this.filters = {
                ...(this.filters || {}),
                search: searchValue.toLowerCase()
            };
            this.currentPage = 1;

            const searchInput = document.getElementById('discountSearchInput');
            if (searchInput) {
                searchInput.value = searchValue;
            }
        }

        if (!this.discounts.length || options?.force === true) {
            await this.loadDiscounts({
                force: options?.force === true,
                showLoading: false
            });
        } else {
            this.render();
        }

        return true;
    },

    init: function () {
        void this.activate();
    },

    bindStaticControls: function () {
        if (this.controlsBound) {
            return;
        }

        const form = document.getElementById('discountGenerateForm');

        const openBtn = document.querySelector('[data-admin-action="discounts-open-generate-modal"]');
        if (openBtn) {
            openBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.openGenerateModal();
            });
        }

        const closeBtn = document.querySelector('[data-admin-action="discounts-close-generate-modal"]');
        if (closeBtn) {
            closeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.closeGenerateModal();
            });
        }

        // Submit is delegated centrally from admin-studio-bootstrap.js to avoid duplicate create requests.

        const typeTrigger = document.getElementById('discountTypeTrigger');
        if (typeTrigger) {
            typeTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleTypeDropdown();
            });
        }

        document.querySelectorAll('#discountTypeDropdown [data-admin-action="discounts-select-type"]').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.selectDiscountType(option.dataset.discountType);
            });
        });

        if (form) {
            form.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target) {
                    return;
                }

                const option = target.closest('[data-discount-generate-select-option]');
                if (option) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.setGenerateCustomSelectValue(
                        option.getAttribute('data-discount-generate-select-option') || '',
                        option.getAttribute('data-select-value') || ''
                    );
                    return;
                }

                const trigger = target.closest('[data-discount-generate-select-trigger]');
                if (trigger) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.toggleGenerateCustomSelect(trigger.getAttribute('data-discount-generate-select-trigger') || '');
                }
            });
        }

        this.refreshGenerateCustomSelects();

        const modal = document.getElementById('discountGenerateModal');
        if (modal) {
            modal.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target) {
                    return;
                }

                if (target === modal) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.closeGenerateModal();
                }
            });
        }

        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;

            if (!target.closest('#discountGenerateModal .admin-discount-form-modal__custom-select')) {
                this.closeGenerateCustomSelects();
            }
            if (!target.closest('#discountTypeWrapper')) {
                this.setTypeDropdownOpen(false);
            }
        });

        this.controlsBound = true;
    },

    ensureRestrictionOptionsLoaded: async function () {
        if (this.restrictionOptionsLoaded) {
            return;
        }

        if (!this.restrictionOptionsPromise) {
            this.restrictionOptionsPromise = this.loadRestrictionOptions();
        }

        await this.restrictionOptionsPromise;
    },

    loadRestrictionOptions: async function () {
        if (this.restrictionOptionsLoaded) {
            return;
        }

        this.restrictionOptionsPromise = (async () => {
            let productData = [];
            let categoryData = [];

            try {
                const [{ data: products, error: productsError }, { data: categories, error: categoriesError }] = await Promise.all([
                    supabaseClient
                        .from('shop_products')
                        .select('id, name, category')
                        .eq('is_active', true)
                        .order('display_order', { ascending: false }),
                    supabaseClient
                        .from('shop_categories')
                        .select('id, name, sort_order')
                        .order('sort_order', { ascending: true })
                ]);

                if (productsError) {
                    console.warn('Failed to load discount product restriction options:', productsError);
                } else if (Array.isArray(products)) {
                    productData = products;
                }

                if (categoriesError) {
                    console.warn('Failed to load discount category restriction options:', categoriesError);
                } else if (Array.isArray(categories)) {
                    categoryData = categories;
                }
            } catch (err) {
                console.warn('Failed to load discount restriction options:', err);
            }

            if (categoryData.length === 0 && productData.length > 0) {
                const seenCategories = new Set();
                categoryData = productData
                    .map((product) => String(product.category ?? '').trim())
                    .filter((categoryId) => {
                        if (!categoryId || seenCategories.has(categoryId)) {
                            return false;
                        }
                        seenCategories.add(categoryId);
                        return true;
                    })
                    .map((categoryId, index) => ({
                        id: categoryId,
                        name: categoryId,
                        sort_order: index
                    }));
            }

            this.products = productData;
            this.categories = categoryData;
            this.productNameMap = new Map(productData.map((product) => [String(product.id), product.name || String(product.id)]));
            this.categoryNameMap = new Map();
            categoryData.forEach((category) => {
                const categoryId = String(category.id ?? '').trim();
                const categoryName = String(category.name ?? category.id ?? '').trim();
                if (categoryId) {
                    this.categoryNameMap.set(categoryId, categoryName || categoryId);
                }
                if (categoryName) {
                    this.categoryNameMap.set(categoryName, categoryName);
                }
            });
            this.populateRestrictionSelects();
            this.restrictionOptionsLoaded = true;

            if (this.discounts.length > 0) {
                this.render();
            }
        })();

        try {
            await this.restrictionOptionsPromise;
        } finally {
            this.restrictionOptionsPromise = null;
        }
    },

    populateRestrictionSelects: function () {
        this.syncGenerateCustomSelect('scope-category');
        this.syncGenerateCustomSelect('scope-product');
    },

    toggleScopeFields: function () {
        const scopeType = this.normalizeScopeType(document.getElementById('discountScopeType')?.value);
        const categoryWrapper = document.getElementById('discountScopeCategoryWrapper');
        const productWrapper = document.getElementById('discountScopeProductWrapper');
        const categorySelect = document.getElementById('discountScopeCategory');
        const productSelect = document.getElementById('discountScopeProduct');

        if (categoryWrapper) {
            categoryWrapper.hidden = scopeType !== 'category';
        }
        if (productWrapper) {
            productWrapper.hidden = scopeType !== 'product';
        }

        if (scopeType !== 'category' && categorySelect) {
            categorySelect.value = '';
            this.syncGenerateCustomSelect('scope-category');
        }
        if (scopeType !== 'product' && productSelect) {
            productSelect.value = '';
            this.syncGenerateCustomSelect('scope-product');
        }
    },

    toggleDistributionFields: function () {
        const distributionMode = this.normalizeDistributionMode(document.getElementById('discountDistributionMode')?.value);
        const modeCopy = document.getElementById('discountDistributionModeCopy');
        const modeHint = document.getElementById('discountDistributionModeHint');
        const claimGroup = document.getElementById('discountDistributionClaimGroup');
        const campaignField = document.getElementById('discountDistributionCampaignField');
        const audienceField = document.getElementById('discountDistributionAudienceField');
        const recipientsField = document.getElementById('discountDistributionRecipientsField');
        const recipientTagsField = document.getElementById('discountDistributionRecipientTagsField');
        const couponCodePanel = document.getElementById('discountCouponCodePanel');

        const modeUi = {
            general_code: {
                copy: '控制这张券是暗码输入、公开领取，还是后台直接下发到用户卡券包。',
                hint: '用户输入优惠码后直接核销，支持手动指定或自动生成优惠码。',
                showClaimGroup: false,
                showCampaignField: false,
                showAudienceField: false,
                showRecipientsField: false,
                showRecipientTagsField: false,
                showCouponCodePanel: true
            },
            public_claim: {
                copy: '用户先领取到卡券包，再在领取窗口内下单使用。',
                hint: '配置领取时间窗、每用户领取上限，以及公开渠道备注。',
                showClaimGroup: true,
                showCampaignField: true,
                showAudienceField: false,
                showRecipientsField: false,
                showRecipientTagsField: false,
                showCouponCodePanel: false
            },
            user_assigned: {
                copy: '后台直接把券发到指定用户卡券包，不依赖公开领取或手动输码。',
                hint: '可直接填写邮箱、用户名、UUID，或按用户管理标签立即发券；渠道备注和人群备注只用于统计。',
                showClaimGroup: false,
                showCampaignField: true,
                showAudienceField: true,
                showRecipientsField: true,
                showRecipientTagsField: true,
                showCouponCodePanel: false
            }
        }[distributionMode];

        if (modeCopy) {
            modeCopy.textContent = modeUi.copy;
        }
        if (modeHint) {
            modeHint.textContent = modeUi.hint;
        }
        if (claimGroup) {
            claimGroup.hidden = !modeUi.showClaimGroup;
        }
        if (campaignField) {
            campaignField.hidden = !modeUi.showCampaignField;
        }
        if (audienceField) {
            audienceField.hidden = !modeUi.showAudienceField;
        }
        if (recipientsField) {
            recipientsField.hidden = !modeUi.showRecipientsField;
        }
        if (recipientTagsField) {
            recipientTagsField.hidden = !modeUi.showRecipientTagsField;
        }
        if (couponCodePanel) {
            couponCodePanel.hidden = !modeUi.showCouponCodePanel;
        }
    },

    // ----------------------------------------
    // DATA LOADING & RENDERING
    // ----------------------------------------
    loadDiscounts: async function (options = {}) {
        const tableBody = document.getElementById('discountsTableBody');
        if (!tableBody) return;

        if (this.listLoadPromise && options?.force !== true) {
            return this.listLoadPromise;
        }

        const requestToken = this.listRequestToken + 1;
        this.listRequestToken = requestToken;
        const shouldShowLoading = options?.showLoading !== false || !this.discounts.length;
        if (shouldShowLoading) {
            tableBody.innerHTML = this.buildTableLoadingSkeleton();
            this.renderScopeHint({ status: 'loading' });
        }

        const loadPromise = (async () => {
            try {
                const currentSite = this.getReadSite();
                const response = await (window.AdminApi?.fetch || fetch)(
                    this.buildAdminDiscountsUrl('discounts/list', {
                        site: currentSite
                    }),
                    { credentials: 'include' }
                );
                const payload = await this.parseAdminDiscountsResponse(response);

                if (requestToken !== this.listRequestToken) {
                    return false;
                }

                this.discounts = Array.isArray(payload.rows) ? payload.rows : [];
                this.detailCache.clear();
                this.scopeSummary = payload.scope_summary && typeof payload.scope_summary === 'object'
                    ? payload.scope_summary
                    : null;
                this.lastListLoadedAt = Date.now();
                this.lastListSite = currentSite;
                this.renderScopeHint({ status: 'ready', scopeSummary: this.scopeSummary });
                this.render();
                return true;

            } catch (err) {
                if (requestToken !== this.listRequestToken) {
                    return false;
                }

                console.error('Failed to load discounts:', err);
                if (!shouldShowLoading && this.discounts.length > 0) {
                    return false;
                }

                this.scopeSummary = null;
                this.renderOverviewStats({ hidden: true });
                this.renderScopeHint({
                    status: 'error',
                    message: `优惠券列表加载失败：${err.message}`
                });
                tableBody.replaceChildren(this.createTableStateRow({
                    message: `加载失败: ${err.message}`,
                    icon: 'fa-circle-exclamation',
                    variant: 'error'
                }));
                return false;
            }
        })();

        this.listLoadPromise = loadPromise;

        try {
            return await loadPromise;
        } finally {
            if (this.listLoadPromise === loadPromise) {
                this.listLoadPromise = null;
            }
        }
    },

    search: function () {
        const input = document.getElementById('discountSearchInput');
        if (input) {
            this.filters.search = input.value.trim().toLowerCase();
            this.currentPage = 1;
            this.render();
        }
    },

    filter: function (status, btnElement) {
        this.filters.status = status;
        this.currentPage = 1;

        // Update active class on buttons
        const controls = document.querySelector('#module-discounts .filter-dropdowns');
        if (controls) {
            controls.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            if (btnElement) btnElement.classList.add('active');
        }

        this.render();
    },

    render: function () {
        const { status, search } = this.filters;
        const now = new Date();

        // 1. Filter
        this.filteredDiscounts = this.discounts.filter(d => {
            let matchSearch = true;
            if (search) {
                matchSearch = this.getDiscountSearchText(d, now).includes(search);
            }

            const statusState = this.getDiscountStatusState(d, now);

            let matchStatus = true;
            if (status !== 'all') {
                matchStatus = statusState.key === status;
            }

            return matchSearch && matchStatus;
        });

        // 2. Pagination
        const totalItems = this.filteredDiscounts.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage) || 1;

        if (this.currentPage > totalPages) {
            this.currentPage = totalPages;
        }

        const tableBody = document.getElementById('discountsTableBody');
        if (!tableBody) return;

        if (this.filteredDiscounts.length === 0) {
            tableBody.replaceChildren(this.createTableStateRow({
                message: '未找到匹配的优惠券',
                icon: 'fa-inbox',
                variant: 'empty'
            }));
            this.renderOverviewStats({
                now,
                visibleCount: 0,
                totalCount: this.discounts.length
            });
            const pContainer = document.getElementById('discountsPagination');
            if (pContainer) pContainer.innerHTML = '';
            this.updateBatchRestoreButtonState();
            return;
        }

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedDiscounts = this.filteredDiscounts.slice(startIndex, endIndex);

        // Render rows
        tableBody.innerHTML = paginatedDiscounts.map(d => {
            const statusState = this.getDiscountStatusState(d, now);
            const usageSummary = this.getRecentUsageSummary(d);
            const riskSummary = this.getRiskSummary(d);
            const escapedCode = this.escapeHtml(d.code);
            const escapedId = this.escapeHtml(d.id);
            const nextActiveState = (!d.is_active).toString();
            const typeLabel = this.getDiscountTypeMarkup(d);
            const createdAtLabel = this.formatDate(d.created_at, { includeTime: true }) || '未知时间';
            const recentUsageLabel = usageSummary.last_used_at
                ? `近 ${usageSummary.window_days} 天最近使用 ${this.formatDate(usageSummary.last_used_at, { includeTime: true })}`
                : (Number.parseInt(d.used_count, 10) > 0
                    ? `近 ${usageSummary.window_days} 天无新增使用`
                    : '尚未被使用');
            const latestRiskLabel = riskSummary.has_recent_alert
                ? `${riskSummary.latest_alert_state === 'recovered' ? '最近恢复' : '最近风控'} ${this.formatDate(riskSummary.latest_alert_at, { includeTime: true })}`
                : '';

            return `
            <tr class="${statusState.isPracticallyUsed ? 'opacity-70' : ''}">
                <td>
                    <div class="admin-discount-code-cell">
                        <button type="button"
                            class="admin-discount-code-btn"
                            data-admin-action="discounts-copy-code"
                            data-discount-code="${escapedCode}"
                            title="点击复制">
                            ${escapedCode}
                        </button>
                        <div class="admin-discount-code-meta">创建于 ${this.escapeHtml(createdAtLabel)}</div>
                        <div class="admin-discount-code-meta">${this.escapeHtml(recentUsageLabel)}</div>
                        ${latestRiskLabel ? `<div class="admin-discount-code-meta">${this.escapeHtml(latestRiskLabel)}</div>` : ''}
                    </div>
                </td>
                <td>${typeLabel}</td>
                <td>
                    ${this.getDiscountUsageMarkup(d)}
                </td>
                <td>
                    <div class="admin-discount-status-stack">
                        <div>${statusState.badgeMarkup}</div>
                        <div class="admin-discount-expiry-meta">${this.escapeHtml(statusState.detailText)}</div>
                    </div>
                </td>
                <td>${this.getDiscountPolicyMarkup(d)}</td>
                <td>
                    <div class="action-buttons admin-discount-action-wrap">
                        <button class="action-btn"
                                type="button"
                                data-admin-action="discounts-open-detail-modal"
                                data-discount-id="${escapedId}"
                                title="查看详情">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn"
                                type="button"
                                data-admin-action="discounts-open-edit-modal"
                                data-discount-id="${escapedId}"
                                title="编辑">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="action-btn ${d.is_active ? 'warning' : 'success'}"
                                type="button"
                                data-admin-action="discounts-toggle-status"
                                data-discount-id="${escapedId}"
                                data-discount-next-active="${nextActiveState}"
                                title="${d.is_active ? '停用' : '启用'}">
                            <i class="fas ${d.is_active ? 'fa-ban' : 'fa-check'}"></i>
                        </button>
                        <button class="action-btn danger"
                                type="button"
                                data-admin-action="discounts-delete-code"
                                data-discount-id="${escapedId}"
                                data-discount-code="${escapedCode}"
                                title="删除">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        this.renderOverviewStats({
            now,
            visibleCount: this.filteredDiscounts.length,
            totalCount: this.discounts.length
        });
        this.updateBatchRestoreButtonState();
        this.renderPagination(totalPages);
    },

    goToPage: function (page) {
        this.currentPage = page;
        this.render();
    },

    renderPagination: function (totalPages) {
        const pContainer = document.getElementById('discountsPagination');
        if (!pContainer) return;

        if (this.filteredDiscounts.length === 0) {
            pContainer.innerHTML = '';
            return;
        }

        pContainer.innerHTML = `
            <div class="admin-discount-pagination-shell">
                <div class="pagination-control">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="discounts-pagination-go"
                        data-discount-page="${Math.max(this.currentPage - 1, 1)}"
                        ${this.currentPage <= 1 ? 'disabled' : ''}>−</button>
                    <input type="number" class="pagination-input" value="${this.currentPage}" min="1" max="${totalPages}"
                        data-admin-change-action="discounts-pagination-go">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="discounts-pagination-go"
                        data-discount-page="${Math.min(this.currentPage + 1, totalPages)}"
                        ${this.currentPage >= totalPages ? 'disabled' : ''}>+</button>
                </div>
                <div class="pagination-total pagination-total--compact">共 ${totalPages} 页 / ${this.filteredDiscounts.length} 条</div>
            </div>
        `;
    },

    showFeedbackToast: function (message = '已复制') {
        let toast = document.getElementById('discountCopyToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'discountCopyToast';
            toast.className = 'admin-discount-copy-toast';
            document.body.appendChild(toast);
        }

        toast.innerHTML = `<i class="fas fa-check-circle admin-discount-copy-toast-icon"></i><span>${this.escapeHtml(message)}</span>`;
        toast.classList.add('is-visible');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 2000);
    },

    downloadTextFile: function (content = '', filename = 'discount_audit.txt') {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 500);
    },

    copyCode: function (code) {
        navigator.clipboard.writeText(code).then(() => {
            this.showFeedbackToast('已复制优惠码');
        });
    },

    // ----------------------------------------
    // ACTIONS (TOGGLE, DELETE)
    // ----------------------------------------
    toggleStatus: async function (id, newState) {
        const writableSite = this.requireWritableSite({ label: newState ? '启用折扣码' : '停用折扣码' });
        if (!writableSite) {
            return;
        }

        const discount = this.getDiscountById(id);
        if (newState && this.shouldUseRiskRestoreFlow(discount)) {
            this.openRestoreModal(id);
            return;
        }

        if (!confirm(`确定要${newState ? '启用' : '停用'}该优惠码吗？`)) return;

        try {
            await this.mutateDiscountsViaAdminApi({
                action: 'toggle_status',
                site: writableSite,
                payload: {
                    id,
                    isActive: newState
                }
            });
            await this.loadDiscounts();
        } catch (err) {
            alert('操作失败: ' + err.message);
        }
    },

    deleteCode: async function (id, code) {
        const writableSite = this.requireWritableSite({ action: 'discounts-delete-code' });
        if (!writableSite) {
            return;
        }

        if (!confirm(`警告：确定要永久删除优惠码 "${code}" 吗？这可能影响历史订单的关联显示。建议使用"停用"功能。`)) return;

        try {
            await this.mutateDiscountsViaAdminApi({
                action: 'delete',
                site: writableSite,
                payload: {
                    id
                }
            });
            await this.loadDiscounts();
        } catch (err) {
            alert('删除失败: ' + err.message);
        }
    },

    assignAssetsFromDetail: async function (id = '') {
        const writableSite = this.requireWritableSite({ label: '定向发券' });
        if (!writableSite) {
            return;
        }

        const discount = this.getCachedDiscountRecord({ id });
        if (!discount) {
            alert('未找到要发放的优惠券');
            return;
        }

        const recipientsInput = document.getElementById('discountAssetRecipientsInput');
        const recipientTagsInput = document.getElementById('discountAssetRecipientTagsInput');
        const sourceChannelInput = document.getElementById('discountAssetSourceChannelInput');
        const audienceSegmentInput = document.getElementById('discountAssetAudienceSegmentInput');

        const recipients = this.safeText(recipientsInput?.value);
        const recipientTags = this.safeText(recipientTagsInput?.value);
        if (!recipients && !recipientTags) {
            alert('请先输入要发券的用户，或填写用户管理标签');
            return;
        }

        try {
            const result = await this.assignAssetsToDiscount({
                site: writableSite,
                discountId: this.safeText(discount.id),
                recipients,
                recipientTags,
                sourceChannel: this.safeText(sourceChannelInput?.value),
                audienceSegment: this.safeText(audienceSegmentInput?.value)
            });

            alert(this.buildDiscountAssetAssignmentSummary(result));

            const detail = await this.ensureDiscountDetailLoadedByReference({ id: this.safeText(discount.id) });
            const cacheKey = this.getDetailCacheKey(this.safeText(discount.id));
            this.detailCache.set(cacheKey, detail);
            this.rerenderActiveDetailModal();
            await this.loadDiscounts();
        } catch (error) {
            alert(`定向发券失败: ${error.message || '未知错误'}`);
        }
    },

    // ----------------------------------------
    // GENERATE MODAL
    // ----------------------------------------
    resetGenerateForm: function () {
        document.getElementById('discountGenerateForm')?.reset();
        document.getElementById('discountCodeInput').value = '';
        document.getElementById('discountValue').value = '';
        document.getElementById('discountMaxUses').value = '1';
        document.getElementById('discountMaxUsesPerUser').value = '0';
        document.getElementById('discountStartsAtDate').value = '';
        document.getElementById('discountExpiryDate').value = '';
        document.getElementById('discountAllowZeroTotal').checked = false;
        document.getElementById('discountClaimStartsAtDate').value = '';
        document.getElementById('discountClaimExpiresAtDate').value = '';
        document.getElementById('discountClaimLimitPerUser').value = '1';
        document.getElementById('discountCampaignTag').value = '';
        document.getElementById('discountAudienceSegment').value = '';
        const assignedRecipientsInput = document.getElementById('discountAssignedRecipients');
        if (assignedRecipientsInput) {
            assignedRecipientsInput.value = '';
        }
        const assignedRecipientTagsInput = document.getElementById('discountAssignedRecipientTags');
        if (assignedRecipientTagsInput) {
            assignedRecipientTagsInput.value = '';
        }
        document.getElementById('discountIsExclusive').checked = true;
        document.getElementById('discountStackPriority').value = '100';
        document.getElementById('discountObservationWindowHours').value = '24';
        this.setGenerateCustomSelectValue('site', '', { close: false });
        this.setGenerateCustomSelectValue('scope-type', 'all', { close: false });
        this.setGenerateCustomSelectValue('scope-category', '', { close: false });
        this.setGenerateCustomSelectValue('scope-product', '', { close: false });
        this.setGenerateCustomSelectValue('starts-at-time', '00:00', { close: false });
        this.setGenerateCustomSelectValue('expiry-time', '23:59', { close: false });
        this.setGenerateCustomSelectValue('distribution-mode', 'general_code', { close: false });
        this.setGenerateCustomSelectValue('claim-starts-at-time', '10:00', { close: false });
        this.setGenerateCustomSelectValue('claim-expires-at-time', '23:59', { close: false });
        this.setGenerateCustomSelectValue('pricing-stage', 'order_discount', { close: false });
        this.setGenerateCustomSelectValue('recovery-strategy', 'manual_only', { close: false });
    },

    populateGenerateFormFromDiscount: function (discount = {}) {
        document.getElementById('discountCodeInput').value = this.safeText(discount.code).toUpperCase();
        this.selectDiscountType(discount.discount_type === 'fixed' ? 'fixed' : 'percent');
        document.getElementById('discountValue').value = Number.parseInt(discount.discount_value, 10) || '';
        document.getElementById('discountMaxUses').value = Math.max(0, Number.parseInt(discount.max_uses, 10) || 0);
        document.getElementById('discountMaxUsesPerUser').value = Math.max(0, Number.parseInt(discount.max_uses_per_user, 10) || 0);
        document.getElementById('discountStartsAtDate').value = this.toDateInputValue(discount.starts_at);
        document.getElementById('discountExpiryDate').value = this.toDateInputValue(discount.expires_at);
        this.setGenerateCustomSelectValue('site', this.safeText(discount.applicable_site).toLowerCase(), { close: false });
        this.setGenerateCustomSelectValue('scope-type', this.normalizeScopeType(discount.scope_type), { close: false });
        this.setGenerateCustomSelectValue('scope-category', this.safeText(discount.scope_category), { close: false });
        this.setGenerateCustomSelectValue('scope-product', this.safeText(discount.scope_product_id), { close: false });
        document.getElementById('discountAllowZeroTotal').checked = !!discount.allow_zero_total;
        document.getElementById('discountClaimStartsAtDate').value = this.toDateInputValue(discount.claim_starts_at);
        document.getElementById('discountClaimExpiresAtDate').value = this.toDateInputValue(discount.claim_expires_at);
        document.getElementById('discountClaimLimitPerUser').value = Math.max(0, Number.parseInt(discount.claim_limit_per_user, 10) || 0);
        document.getElementById('discountCampaignTag').value = this.safeText(discount.campaign_tag);
        document.getElementById('discountAudienceSegment').value = this.safeText(discount.audience_segment);
        document.getElementById('discountIsExclusive').checked = discount?.is_exclusive !== false;
        document.getElementById('discountStackPriority').value = Math.max(1, Number.parseInt(discount.stack_priority, 10) || 100);
        document.getElementById('discountObservationWindowHours').value = Math.max(1, Number.parseInt(discount.observation_window_hours, 10) || 24);
        this.setGenerateCustomSelectValue('starts-at-time', this.toTimeInputValue(discount.starts_at) || '00:00', { close: false });
        this.setGenerateCustomSelectValue('expiry-time', this.toTimeInputValue(discount.expires_at) || '23:59', { close: false });
        this.setGenerateCustomSelectValue('distribution-mode', this.safeText(discount.distribution_mode).toLowerCase() || 'general_code', { close: false });
        this.setGenerateCustomSelectValue('claim-starts-at-time', this.toTimeInputValue(discount.claim_starts_at) || '10:00', { close: false });
        this.setGenerateCustomSelectValue('claim-expires-at-time', this.toTimeInputValue(discount.claim_expires_at) || '23:59', { close: false });
        this.setGenerateCustomSelectValue('pricing-stage', this.safeText(discount.pricing_apply_stage).toLowerCase() || 'order_discount', { close: false });
        this.setGenerateCustomSelectValue('recovery-strategy', this.safeText(discount.recovery_strategy).toLowerCase() || 'manual_only', { close: false });
    },

    openGenerateModal: async function () {
        await this.ensureRestrictionOptionsLoaded();
        this.editingDiscountId = '';
        this.setModalMode('create');
        this.resetGenerateForm();
        this.selectDiscountType('percent');
        this.toggleScopeFields();
        this.closeGenerateCustomSelects();
        this.setGenerateModalVisible(true);
    },

    openEditModal: async function (id = '') {
        let discount = this.getCachedDiscountRecord({ id });
        if (!discount && this.safeText(id)) {
            const detail = await this.ensureDiscountDetailLoadedByReference({ id });
            discount = detail?.discount || null;
        }
        if (!discount) {
            alert('未找到要编辑的优惠券');
            return;
        }

        await this.ensureRestrictionOptionsLoaded();
        this.editingDiscountId = this.safeText(discount.id);
        this.setModalMode('edit');
        this.resetGenerateForm();
        this.populateGenerateFormFromDiscount(discount);
        this.setGenerateModalVisible(true);
    },

    closeGenerateModal: function () {
        this.editingDiscountId = '';
        this.setModalMode('create');
        this.setTypeDropdownOpen(false);
        this.closeGenerateCustomSelects();
        this.setGenerateModalVisible(false);
    },

    toggleTypeDropdown: function () {
        const dropdown = document.getElementById('discountTypeDropdown');
        if (!dropdown) return;
        this.closeGenerateCustomSelects();
        this.setTypeDropdownOpen(!dropdown.classList.contains('is-open'));
    },

    selectDiscountType: function (type) {
        const isFixed = type === 'fixed';
        const label = document.getElementById('discountTypeLabel');
        const valueType = document.getElementById('discountValueType');
        const dropdown = document.getElementById('discountTypeDropdown');
        const suffix = document.getElementById('discountValueSuffix');
        const valueInput = document.getElementById('discountValue');

        if (valueType) {
            valueType.value = isFixed ? 'fixed' : 'percent';
        }

        if (label) {
            label.innerHTML = isFixed
                ? '<span class="admin-discount-type-label-icon">💰</span> 固定金额立减'
                : '<span class="admin-discount-type-label-icon">📊</span> 按比例打折';
        }

        if (suffix) {
            suffix.innerText = isFixed ? '积分' : '折';
        }

        if (valueInput) {
            valueInput.placeholder = isFixed ? '如: 100' : '如: 80';
        }

        this.setTypeDropdownOpen(false);
    },

    formatExpiryDateInput: function (input) {
        if (!input) return;
        let value = String(input.value || '').replace(/[^0-9]/g, '');
        if (value.length > 4) value = `${value.slice(0, 4)}-${value.slice(4)}`;
        if (value.length > 7) value = `${value.slice(0, 7)}-${value.slice(7)}`;
        input.value = value.slice(0, 10);
    },

    formatExpiryTimeInput: function (input) {
        if (!input) return;
        let value = String(input.value || '').replace(/[^0-9]/g, '');
        if (value.length > 2) value = `${value.slice(0, 2)}:${value.slice(2)}`;
        input.value = value.slice(0, 5);
    },

    generateRandomCode: function (length = 8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    submitGenerate: async function () {
        const writableSite = this.requireWritableSite({ action: 'discounts-submit-generate' });
        if (!writableSite) {
            return;
        }

        if (this.generateSubmitInFlight) {
            return;
        }
        this.generateSubmitInFlight = true;
        this.setGenerateSubmitBusyState(true);
        try {
            let code = document.getElementById('discountCodeInput').value.trim().toUpperCase();
            if (!code) {
                code = this.generateRandomCode();
            }

            const type = document.getElementById('discountValueType').value;
            const value = parseInt(document.getElementById('discountValue').value);
            if (!value || value <= 0) {
                alert('请输入有效的优惠券面额');
                return;
            }

            if (type === 'percent' && value > 100) {
                alert('折扣比例不能大于 100，例如 80 表示 8 折');
                return;
            }

            const maxUses = parseInt(document.getElementById('discountMaxUses').value) || 0;
            if (maxUses < 0) {
                alert('最大核销次数不能小于 0');
                return;
            }
            const maxUsesPerUser = parseInt(document.getElementById('discountMaxUsesPerUser').value) || 0;
            if (maxUsesPerUser < 0) {
                alert('每用户最多使用次数不能小于 0');
                return;
            }

            const applicableSiteRaw = String(document.getElementById('discountApplicableSite')?.value || '').trim().toLowerCase();
            const applicableSite = applicableSiteRaw || null;
            if (applicableSite && !['cn', 'intl'].includes(applicableSite)) {
                alert('适用站点配置无效');
                return;
            }

            const scopeType = this.normalizeScopeType(document.getElementById('discountScopeType')?.value);
            const scopeCategory = scopeType === 'category'
                ? String(document.getElementById('discountScopeCategory')?.value || '').trim()
                : null;
            const scopeProductId = scopeType === 'product'
                ? String(document.getElementById('discountScopeProduct')?.value || '').trim()
                : null;

            if (scopeType === 'category' && !scopeCategory) {
                alert('请选择优惠券适用的分类');
                return;
            }

            if (scopeType === 'product' && !scopeProductId) {
                alert('请选择优惠券适用的商品');
                return;
            }

            const allowZeroTotal = !!document.getElementById('discountAllowZeroTotal')?.checked;
            const distributionMode = this.normalizeDistributionMode(document.getElementById('discountDistributionMode')?.value);
            const startsAtRaw = (document.getElementById('discountStartsAtDate') || {}).value || '';
            const startsAtTime = (document.getElementById('discountStartsAtTime') || {}).value || '00:00';
            let starts_at = null;
            if (startsAtRaw.trim()) {
                try { starts_at = new Date(startsAtRaw.trim() + 'T' + (startsAtTime.trim() || '00:00')).toISOString(); } catch (e) { starts_at = null; }
            }
            const expiryRaw = (document.getElementById('discountExpiryDate') || {}).value || '';
            const expiryTime = (document.getElementById('discountExpiryTime') || {}).value || '23:59';
            let expires_at = null;
            if (expiryRaw.trim()) {
                try { expires_at = new Date(expiryRaw.trim() + 'T' + (expiryTime.trim() || '23:59')).toISOString(); } catch (e) { expires_at = null; }
            }
            if (starts_at && expires_at && new Date(starts_at) >= new Date(expires_at)) {
                alert('生效时间必须早于过期时间');
                return;
            }

            const claimStartsAtRaw = (document.getElementById('discountClaimStartsAtDate') || {}).value || '';
            const claimStartsAtTime = (document.getElementById('discountClaimStartsAtTime') || {}).value || '00:00';
            let claim_starts_at = null;
            if (claimStartsAtRaw.trim()) {
                try { claim_starts_at = new Date(claimStartsAtRaw.trim() + 'T' + (claimStartsAtTime.trim() || '00:00')).toISOString(); } catch (e) { claim_starts_at = null; }
            }
            const claimExpiresAtRaw = (document.getElementById('discountClaimExpiresAtDate') || {}).value || '';
            const claimExpiresAtTime = (document.getElementById('discountClaimExpiresAtTime') || {}).value || '23:59';
            let claim_expires_at = null;
            if (claimExpiresAtRaw.trim()) {
                try { claim_expires_at = new Date(claimExpiresAtRaw.trim() + 'T' + (claimExpiresAtTime.trim() || '23:59')).toISOString(); } catch (e) { claim_expires_at = null; }
            }
            if (claim_starts_at && claim_expires_at && new Date(claim_starts_at) >= new Date(claim_expires_at)) {
                alert('领取开始时间必须早于领取截止时间');
                return;
            }
            let claimLimitPerUser = Math.max(0, parseInt(document.getElementById('discountClaimLimitPerUser')?.value, 10) || 0);
            let campaignTag = this.safeText(document.getElementById('discountCampaignTag')?.value);
            let audienceSegment = this.safeText(document.getElementById('discountAudienceSegment')?.value);
            const assignedRecipients = this.safeText(document.getElementById('discountAssignedRecipients')?.value);
            const assignedRecipientTags = this.safeText(document.getElementById('discountAssignedRecipientTags')?.value);
            const isExclusive = !!document.getElementById('discountIsExclusive')?.checked;
            const stackPriority = Math.max(1, parseInt(document.getElementById('discountStackPriority')?.value, 10) || 100);
            const pricingApplyStage = this.safeText(document.getElementById('discountPricingApplyStage')?.value).toLowerCase() || 'order_discount';

            const recoveryStrategy = this.safeText(document.getElementById('discountRecoveryStrategy')?.value).toLowerCase() || 'manual_only';
            const observationWindowHours = Math.max(1, parseInt(document.getElementById('discountObservationWindowHours')?.value, 10) || 24);
            const editingDiscount = this.modalMode === 'edit'
                ? this.getCachedDiscountRecord({ id: this.editingDiscountId })
                : null;

            if (distributionMode !== 'public_claim') {
                claim_starts_at = null;
                claim_expires_at = null;
                claimLimitPerUser = 0;
            }

            if (distributionMode === 'general_code') {
                campaignTag = '';
                audienceSegment = '';
            } else if (distributionMode === 'public_claim') {
                audienceSegment = '';
            }

            const payload = {
                id: this.modalMode === 'edit' ? this.editingDiscountId : undefined,
                code: code,
                discount_type: type,
                discount_value: value,
                max_uses: maxUses,
                max_uses_per_user: maxUsesPerUser,
                starts_at: starts_at,
                expires_at: expires_at,
                applicable_site: applicableSite,
                scope_type: scopeType,
                scope_category: scopeCategory,
                scope_product_id: scopeProductId,
                allow_zero_total: allowZeroTotal,
                distribution_mode: distributionMode,
                claim_starts_at: claim_starts_at,
                claim_expires_at: claim_expires_at,
                claim_limit_per_user: claimLimitPerUser,
                campaign_tag: campaignTag,
                audience_segment: audienceSegment,
                is_exclusive: isExclusive,
                stack_priority: stackPriority,
                pricing_apply_stage: pricingApplyStage,
                recovery_strategy: recoveryStrategy,
                observation_window_hours: observationWindowHours,
                is_active: editingDiscount ? editingDiscount.is_active !== false : true
            };

            const isEditMode = this.modalMode === 'edit';

            if (isEditMode && !this.editingDiscountId) {
                throw new Error('缺少要更新的优惠券 ID');
            }

            const mutationResult = await this.mutateDiscountsViaAdminApi({
                action: isEditMode ? 'update' : 'create',
                site: writableSite,
                payload
            });

            let assignmentSummary = '';
            let assignmentError = '';
            if (distributionMode === 'user_assigned' && (assignedRecipients || assignedRecipientTags)) {
                const savedDiscountId = this.safeText(mutationResult?.row?.id) || this.editingDiscountId;
                if (!savedDiscountId) {
                    assignmentError = '优惠券已保存，但缺少可发放的优惠券 ID';
                } else {
                    try {
                        const assignResult = await this.assignAssetsToDiscount({
                            site: writableSite,
                            discountId: savedDiscountId,
                            recipients: assignedRecipients,
                            recipientTags: assignedRecipientTags,
                            sourceChannel: campaignTag,
                            audienceSegment
                        });
                        assignmentSummary = this.buildDiscountAssetAssignmentSummary(assignResult);
                    } catch (assignErr) {
                        assignmentError = assignErr?.message || '未知错误';
                    }
                }
            }

            this.closeGenerateModal();
            await this.loadDiscounts();

            const baseMessage = isEditMode
                ? `已更新优惠码: ${code}`
                : `成功生成优惠码: ${code}`;
            if (assignmentError) {
                const partialMessage = `${baseMessage}；但立即发券失败：${assignmentError}`;
                alert(partialMessage);
                this.emitCommandFeedback(partialMessage, 'partial', { source: 'discounts-generate' });
                return;
            }

            const successMessage = assignmentSummary ? `${baseMessage}；${assignmentSummary}` : baseMessage;
            alert(successMessage);
            this.emitCommandFeedback(successMessage, 'saved', { source: 'discounts-generate' });

        } catch (err) {
            const failureMessage = (this.modalMode === 'edit' ? '更新失败: ' : '生成失败: ') + err.message;
            alert(failureMessage);
            this.emitCommandFeedback(failureMessage, 'failed', { source: 'discounts-generate' });
        } finally {
            this.generateSubmitInFlight = false;
            this.setGenerateSubmitBusyState(false);
        }
    }
};

// Auto-attach to window so admin-studio.html can find it
window.AdminDiscounts = AdminDiscounts;
window.handleAdminDiscountsSiteChange = () => AdminDiscounts.handleSiteChange();
window.openAdminDiscountsShellContext = async (context = {}, options = {}) => {
    await AdminDiscounts.activate(context, options);
    return AdminDiscounts.handleShellContext(context, options);
};

if (window.AdminShell?.registerModule) {
    window.AdminShell.registerModule('discounts', {
        activate: (context = {}, options = {}) => AdminDiscounts.activate(context, options),
        handleContext: (context = {}, options = {}) => AdminDiscounts.handleShellContext(context, options),
        onSiteChange: () => AdminDiscounts.handleSiteChange(),
        reload: () => AdminDiscounts.handleSiteChange()
    });
} else {
    window.addEventListener('admin-site-changed', () => {
        AdminDiscounts.handleSiteChange();
    });
}
