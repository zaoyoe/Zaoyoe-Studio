const AdminGrowthCenter = {
    state: {
        initialized: false,
        loading: false,
        detailLoading: false,
        loadedSite: '',
        detailsLoaded: false,
        requestId: 0,
        payload: null,
        error: '',
        detailError: ''
    },

    safeText(value, maxLength = 4000) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    getReadSite() {
        return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
    },

    isGrowthTabActive() {
        const activeTabId = String(document.querySelector('#analyticsTabsNav .admin-tab.active')?.dataset?.tab || '').trim().toLowerCase();
        return activeTabId === 'growth';
    },

    isAnalyticsVisible() {
        return typeof window.isAnalyticsModuleVisible === 'function'
            ? window.isAnalyticsModuleVisible()
            : !!document.querySelector('#module-business-overview.active, #module-growth-center.active, #module-commerce-center.active');
    },

    shouldDisplay() {
        return this.isAnalyticsVisible() && this.isGrowthTabActive() && !!document.getElementById('marketingAssetCenterWorkspace');
    },

    buildUrl(route, params = {}) {
        const url = new URL(`/api/admin/${route}`, window.location.origin);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            url.searchParams.set(key, String(value));
        });
        return `${url.pathname}${url.search}`;
    },

    normalizeLoadMode(value = '') {
        return this.safeText(value, 40).toLowerCase() === 'summary' ? 'summary' : 'full';
    },

    hasFullCacheForSite(site = this.getReadSite()) {
        return this.state.payload
            && this.state.loadedSite === site
            && this.state.detailsLoaded === true;
    },

    async fetchPayload({ force = false, mode = 'full' } = {}) {
        const site = this.getReadSite();
        const loadMode = this.normalizeLoadMode(mode);
        if (!force && this.state.payload && this.state.loadedSite === site) {
            if (loadMode === 'summary' || this.state.detailsLoaded === true) {
                return this.state.payload;
            }
        }

        if (!force && loadMode === 'full' && this.hasFullCacheForSite(site)) {
            return this.state.payload;
        }

        const response = await (window.AdminApi?.fetch || fetch)(this.buildUrl('marketing/assets-center', {
            site,
            mode: loadMode
        }), {
            credentials: 'include'
        });

        let payload = {};
        try {
            payload = await response.json();
        } catch (_) {
            payload = {};
        }

        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || `营销资产中心加载失败 (${response.status})`);
        }

        this.state.loadedSite = site;
        this.state.payload = payload;
        this.state.detailsLoaded = payload?.details_pending !== true && loadMode === 'full';
        this.state.error = '';
        this.state.detailError = '';
        return payload;
    },

    formatDate(value, { includeTime = true } = {}) {
        const normalized = this.safeText(value, 80);
        if (!normalized) return '';
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) {
            return normalized;
        }
        return includeTime ? parsed.toLocaleString() : parsed.toLocaleDateString();
    },

    formatSiteLabel(value = '') {
        const normalized = this.safeText(value, 20).toLowerCase();
        if (normalized === 'cn') return 'CN';
        if (normalized === 'intl') return 'INTL';
        return '全站';
    },

    formatDistributionLabel(value = '') {
        const normalized = this.safeText(value, 40).toLowerCase();
        if (normalized === 'public_claim') return '公开领券';
        if (normalized === 'user_assigned') return '定向发券';
        return '通用暗码';
    },

    renderSummaryCards(summary = {}) {
        const cards = [
            { label: '优惠券', value: summary.discount_count || 0, note: '当前可运营券种数' },
            { label: '兑换码/套餐', value: summary.package_count || 0, note: '统一资产目录' },
            { label: '卡券已发放', value: summary.issued_asset_count || 0, note: '用户侧私有资产' },
            { label: '兑换码生成量', value: summary.redemption_generated_count || 0, note: '批次累计生成' },
            { label: '近 30 天净营收', value: summary.recent_revenue_net || 0, note: '优惠券带来的实付 GMV' },
            { label: '待执行工作流', value: summary.due_workflow_count || 0, note: '建议收口的自动化任务' }
        ];

        return `
            <div class="marketing-asset-center__summary-grid">
                ${cards.map((card) => `
                    <div class="marketing-asset-center__summary-card">
                        <span class="marketing-asset-center__summary-label">${this.escapeHtml(card.label)}</span>
                        <strong class="marketing-asset-center__summary-value">${this.escapeHtml(String(card.value))}</strong>
                        <span class="marketing-asset-center__summary-note">${this.escapeHtml(card.note)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderFamilyCards(families = []) {
        return `
            <div class="marketing-asset-center__family-grid">
                ${(Array.isArray(families) ? families : []).map((family) => {
                    const summary = family?.summary && typeof family.summary === 'object' ? family.summary : {};
                    const primaryMetrics = family?.key === 'discount'
                        ? [
                            `生效 ${summary.active_count || 0}`,
                            `待生效 ${summary.scheduled_count || 0}`,
                            `卡券 ${summary.asset_issued_count || 0}`
                        ]
                        : [
                            `套餐 ${summary.package_count || 0}`,
                            `批次 ${summary.batch_count || 0}`,
                            `已核销 ${summary.used_code_count || 0}`
                        ];
                    return `
                        <div class="marketing-asset-center__family-card">
                            <div class="marketing-asset-center__family-top">
                                <div>
                                    <div class="marketing-asset-center__family-label">${this.escapeHtml(family?.label || '营销资产')}</div>
                                    <div class="marketing-asset-center__family-note">${this.escapeHtml(family?.key === 'discount' ? '价格规则 + 用户卡券' : '兑换批次 + 套餐目录')}</div>
                                </div>
                                <button type="button"
                                    class="marketing-asset-center__family-action"
                                    data-growth-center-action="open-module"
                                    data-growth-center-module="${this.escapeHtml(family?.primary_action?.module || '')}">
                                    ${this.escapeHtml(family?.primary_action?.label || '打开')}
                                </button>
                            </div>
                            <div class="marketing-asset-center__family-metrics">
                                ${primaryMetrics.map((metric) => `<span class="marketing-asset-center__family-chip">${this.escapeHtml(metric)}</span>`).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderUnifiedAssets(items = []) {
        const rows = Array.isArray(items) ? items : [];
        if (!rows.length) {
            return '<div class="marketing-asset-center__empty">当前没有可展示的营销资产。</div>';
        }

        return `
            <div class="marketing-asset-center__list">
                ${rows.map((item) => {
                    const stackingPolicy = item?.stacking_policy && typeof item.stacking_policy === 'object' ? item.stacking_policy : null;
                    const metaParts = [
                        item?.type === 'discount'
                            ? this.formatDistributionLabel(item?.delivery_label)
                            : '兑换码/套餐',
                        this.formatSiteLabel(item?.site_label)
                    ];
                    if (stackingPolicy?.apply_stage_label) {
                        metaParts.push(stackingPolicy.apply_stage_label);
                    }
                    if (stackingPolicy?.exclusivity_label) {
                        metaParts.push(stackingPolicy.exclusivity_label);
                    }

                    return `
                        <div class="marketing-asset-center__list-item">
                            <div class="marketing-asset-center__list-item-copy">
                                <div class="marketing-asset-center__list-item-top">
                                    <strong>${this.escapeHtml(item?.label || '营销资产')}</strong>
                                    <span class="marketing-asset-center__list-status">${this.escapeHtml(item?.status_label || '观察中')}</span>
                                </div>
                                <div class="marketing-asset-center__list-meta">${this.escapeHtml(metaParts.filter(Boolean).join(' · '))}</div>
                                <div class="marketing-asset-center__list-metrics">
                                    ${(Array.isArray(item?.metrics) ? item.metrics : []).map((metric) => `
                                        <span class="marketing-asset-center__metric-chip">${this.escapeHtml(metric)}</span>
                                    `).join('')}
                                </div>
                                ${item?.recent_activity_at ? `<div class="marketing-asset-center__list-meta">最近活动 ${this.escapeHtml(this.formatDate(item.recent_activity_at) || item.recent_activity_at)}</div>` : ''}
                            </div>
                            <button type="button"
                                class="marketing-asset-center__detail-btn"
                                data-growth-center-action="open-asset"
                                data-growth-center-module="${this.escapeHtml(item?.destination_module || '')}"
                                data-growth-center-asset-type="${this.escapeHtml(item?.type || '')}"
                                data-growth-center-id="${this.escapeHtml(item?.destination_id || '')}">
                                查看
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderWorkflows(workflows = []) {
        const rows = Array.isArray(workflows) ? workflows : [];
        if (!rows.length) {
            return '<div class="marketing-asset-center__empty">当前没有工作流配置。</div>';
        }

        return `
            <div class="marketing-asset-center__workflow-grid">
                ${rows.map((workflow) => `
                    <div class="marketing-asset-center__workflow-card${workflow?.status === 'paused' ? ' is-paused' : ''}">
                        <div class="marketing-asset-center__workflow-top">
                            <div>
                                <div class="marketing-asset-center__workflow-title">${this.escapeHtml(workflow?.workflow_name || '营销工作流')}</div>
                                <div class="marketing-asset-center__workflow-meta">${this.escapeHtml(workflow?.schedule_label || '手动执行')} · ${this.escapeHtml(workflow?.asset_family || 'combined')}</div>
                            </div>
                            <span class="marketing-asset-center__workflow-due${workflow?.due_count > 0 ? ' is-due' : ''}">${this.escapeHtml(String(workflow?.due_count || 0))} 待处理</span>
                        </div>
                        <div class="marketing-asset-center__workflow-summary">
                            ${this.escapeHtml(workflow?.latest_run?.summary || workflow?.last_run_summary || '还没有执行记录')}
                        </div>
                        <div class="marketing-asset-center__workflow-meta">
                            最近执行 ${this.escapeHtml(this.formatDate(workflow?.latest_run?.started_at || workflow?.last_run_at) || '未执行')}
                        </div>
                        <div class="marketing-asset-center__workflow-actions">
                            <button type="button"
                                class="marketing-asset-center__family-action"
                                data-growth-center-action="run-workflow"
                                data-growth-center-workflow-key="${this.escapeHtml(workflow?.workflow_key || '')}"
                                ${workflow?.status === 'paused' ? 'disabled' : ''}>
                                立即执行
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderDeferredDetailsPlaceholder(message = '明细后台补齐中...') {
        return `<div class="loading-text">${this.escapeHtml(message)}</div>`;
    },

    renderDetailError(message = '明细加载失败，请稍后刷新') {
        return `
            <div class="marketing-asset-center__error">
                <span>${this.escapeHtml(message)}</span>
                <button type="button" class="marketing-asset-center__family-action" data-growth-center-action="refresh">重试</button>
            </div>
        `;
    },

    renderPayload(payload = {}) {
        const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
        const families = Array.isArray(payload?.asset_families) ? payload.asset_families : [];
        const items = Array.isArray(payload?.unified_assets) ? payload.unified_assets : [];
        const workflows = Array.isArray(payload?.workflows) ? payload.workflows : [];
        const detailsPending = payload?.details_pending === true || this.state.detailLoading === true;
        const detailError = this.safeText(this.state.detailError, 240);

        return `
            <div class="marketing-asset-center">
                ${this.renderSummaryCards(summary)}
                <section class="marketing-asset-center__section">
                    <div class="marketing-asset-center__section-head">
                        <h4>统一资产目录</h4>
                        <span>把优惠券与兑换码/套餐放到同一运营视图里看。</span>
                    </div>
                    ${this.renderFamilyCards(families)}
                </section>
                <section class="marketing-asset-center__section">
                    <div class="marketing-asset-center__section-head">
                        <h4>最近活跃资产</h4>
                        <span>优先处理最近在跑、最近被核销或最近需要复核的资产。</span>
                    </div>
                    ${detailError
                        ? this.renderDetailError(detailError)
                        : detailsPending
                            ? this.renderDeferredDetailsPlaceholder('最近活跃资产后台补齐中...')
                            : this.renderUnifiedAssets(items)}
                </section>
                <section class="marketing-asset-center__section">
                    <div class="marketing-asset-center__section-head">
                        <h4>运营编排</h4>
                        <span>先收口生命周期同步、观察期收口、历史归档和复盘快照。</span>
                    </div>
                    ${detailError
                        ? this.renderDetailError(detailError)
                        : detailsPending
                            ? this.renderDeferredDetailsPlaceholder('运营编排后台补齐中...')
                            : this.renderWorkflows(workflows)}
                </section>
            </div>
        `;
    },

    renderState() {
        const container = document.getElementById('marketingAssetCenterWorkspace');
        const meta = document.getElementById('marketingAssetCenterMeta');
        if (!container) {
            return;
        }

        if (!this.shouldDisplay()) {
            container.innerHTML = '<div class="marketing-asset-center__empty">切到“用户增长”分栏后可查看统一营销资产中心。</div>';
            if (meta) {
                meta.textContent = '优惠券 / 兑换码 / 工作流';
            }
            return;
        }

        if (this.state.loading && !this.state.payload) {
            container.innerHTML = '<div class="loading-text">营销资产中心加载中...</div>';
            if (meta) {
                meta.textContent = '加载中';
            }
            return;
        }

        if (this.state.error) {
            container.innerHTML = `
                <div class="marketing-asset-center__error">
                    <span>${this.escapeHtml(this.state.error)}</span>
                    <button type="button" class="marketing-asset-center__family-action" data-growth-center-action="refresh">重试</button>
                </div>
            `;
            if (meta) {
                meta.textContent = '加载失败';
            }
            return;
        }

        container.innerHTML = this.renderPayload(this.state.payload || {});
        if (meta) {
            const statusLabel = this.state.detailLoading
                ? '明细补齐中'
                : this.state.detailError
                    ? '明细加载失败'
                    : '已同步';
            meta.textContent = `优惠券 / 兑换码 / 工作流 · ${this.escapeHtml(this.formatSiteLabel(this.getReadSite()))} · ${statusLabel}`;
        }
    },

    async load({ force = false } = {}) {
        if (!this.shouldDisplay()) {
            this.renderState();
            return;
        }

        const site = this.getReadSite();
        if (!force && this.hasFullCacheForSite(site)) {
            this.renderState();
            return;
        }

        const requestId = this.state.requestId + 1;
        this.state.requestId = requestId;
        this.state.loading = true;
        this.state.detailLoading = false;
        this.state.detailError = '';
        this.renderState();

        try {
            await this.fetchPayload({ force, mode: 'summary' });
            if (requestId !== this.state.requestId) {
                return;
            }
            this.state.loading = false;
            this.state.detailLoading = true;
            this.renderState();
            this.scheduleDetailLoad({ force, requestId });
        } catch (error) {
            this.state.error = error?.message || '营销资产中心加载失败';
            this.state.loading = false;
            this.state.detailLoading = false;
            this.renderState();
        }
    },

    scheduleDetailLoad({ force = false, requestId = this.state.requestId } = {}) {
        window.setTimeout(() => {
            void (async () => {
                if (requestId !== this.state.requestId || !this.shouldDisplay()) {
                    return;
                }

                try {
                    await this.fetchPayload({ force, mode: 'full' });
                } catch (error) {
                    if (requestId !== this.state.requestId) {
                        return;
                    }
                    this.state.detailError = error?.message || '营销资产中心明细加载失败';
                } finally {
                    if (requestId === this.state.requestId) {
                        this.state.detailLoading = false;
                        this.state.loading = false;
                        this.renderState();
                    }
                }
            })();
        }, 120);
    },

    resetSiteScopedState() {
        this.state.requestId += 1;
        this.state.loading = false;
        this.state.loadedSite = '';
        this.state.detailsLoaded = false;
        this.state.payload = null;
        this.state.error = '';
        this.state.detailError = '';
        this.state.detailLoading = false;
    },

    scheduleSync({ force = false } = {}) {
        window.setTimeout(() => {
            if (!this.state.initialized) {
                return;
            }
            void this.load({ force });
        }, 60);
    },

    async runWorkflow(workflowKey = '') {
        const normalizedKey = this.safeText(workflowKey, 80).toLowerCase();
        if (!normalizedKey) {
            return;
        }

        const response = await (window.AdminApi?.fetch || fetch)(this.buildUrl('marketing/assets-center'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'run_workflow',
                workflow_key: normalizedKey,
                site: this.getReadSite()
            })
        });

        let payload = {};
        try {
            payload = await response.json();
        } catch (_) {
            payload = {};
        }

        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || `工作流执行失败 (${response.status})`);
        }

        window.showToast?.(payload?.run_result?.summary || '工作流已执行', 'success');
        await this.load({ force: true });
    },

    openModule(moduleId = '') {
        const normalizedModuleId = this.safeText(moduleId, 80).toLowerCase();
        if (!normalizedModuleId) {
            return;
        }
        window.switchModule?.(normalizedModuleId);
    },

    openAsset(moduleId = '', assetType = '', id = '') {
        const normalizedModuleId = this.safeText(moduleId, 80).toLowerCase();
        const normalizedAssetType = this.safeText(assetType, 80).toLowerCase();
        const normalizedId = this.safeText(id, 160);
        if (!normalizedModuleId) {
            return;
        }

        window.switchModule?.(normalizedModuleId);
        if (!normalizedId) {
            return;
        }

        window.setTimeout(() => {
            if (normalizedModuleId === 'discounts' && normalizedAssetType === 'discount') {
                window.AdminDiscounts?.openDetailModal?.(normalizedId);
                return;
            }

            if (normalizedModuleId === 'points') {
                if (normalizedAssetType === 'points_batch') {
                    window.openAnalyticsPointsContext?.({
                        batchId: normalizedId,
                        view: 'batches'
                    });
                    return;
                }

                if (normalizedAssetType === 'points_package') {
                    window.switchPointsView?.('catalog');
                    window.openAnalyticsPointsContext?.({
                        view: 'catalog',
                        packageId: normalizedId
                    });
                    window.setTimeout(() => {
                        window.switchPointsView?.('catalog');
                        window.openPointsPackageEditor?.(normalizedId);
                    }, 120);
                }
            }
        }, 220);
    },

    bindRuntimeEvents() {
        if (document.documentElement.dataset.adminGrowthCenterBound === '1') {
            return;
        }
        document.documentElement.dataset.adminGrowthCenterBound = '1';

        document.addEventListener('click', (event) => {
            const actionEl = event.target instanceof Element
                ? event.target.closest('[data-growth-center-action], [data-admin-action="analytics-switch-tab"], [data-admin-action="switch-module"]')
                : null;
            if (!actionEl) {
                return;
            }

            const growthAction = actionEl.getAttribute('data-growth-center-action');
            if (growthAction === 'refresh') {
                event.preventDefault();
                void this.load({ force: true });
                return;
            }
            if (growthAction === 'open-module') {
                event.preventDefault();
                this.openModule(actionEl.getAttribute('data-growth-center-module') || '');
                return;
            }
            if (growthAction === 'open-asset') {
                event.preventDefault();
                this.openAsset(
                    actionEl.getAttribute('data-growth-center-module') || '',
                    actionEl.getAttribute('data-growth-center-asset-type') || '',
                    actionEl.getAttribute('data-growth-center-id') || ''
                );
                return;
            }
            if (growthAction === 'run-workflow') {
                event.preventDefault();
                void this.runWorkflow(actionEl.getAttribute('data-growth-center-workflow-key') || '');
                return;
            }

            this.scheduleSync({ force: false });
        });

        window.addEventListener('admin-site-changed', () => {
            this.resetSiteScopedState();
            this.scheduleSync({ force: true });
        });
        window.addEventListener('adminStudioAccessGranted', () => {
            this.scheduleSync({ force: true });
        });
    },

    init() {
        if (this.state.initialized) {
            this.scheduleSync({ force: false });
            return;
        }

        this.state.initialized = true;
        this.bindRuntimeEvents();
        this.renderState();
        this.scheduleSync({ force: true });
    }
};

window.AdminGrowthCenter = AdminGrowthCenter;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.AdminGrowthCenter?.init?.();
    }, { once: true });
} else {
    window.AdminGrowthCenter?.init?.();
}
